/**
 * STUB DE PANEL (LOT 5) — un « Panel » simulé, en mémoire, sans écran ni
 * persistance. Il implémente l'interface PanelClient (PanelClient.js) et se
 * comporte comme un serveur conforme à la spec
 * docs/panelXvitrine/spec/PanelBridge.openapi.yaml :
 *
 *   - il VALIDE chaque DTO reçu contre les schémas du contrat (c'est le cœur
 *     de sa valeur : un PanelBridge qui passe le stub parle le contrat) ;
 *   - il applique l'idempotence par writeId (relivraison -> DUPLICATE) ;
 *   - il sert un pull paginé par curseur opaque ;
 *   - il sait simuler des pannes (`failNextWith`) et l'injoignabilité
 *     (`goOffline`) pour tester la reprise après erreur du pont.
 *
 * AUCUNE logique métier. Même patron que les doubles du projet : `calls` enregistre
 * tout pour inspection par les tests.
 */
import { createHash } from 'node:crypto';
import {
  CONTRACT_VERSION,
  ACK_STATUS,
  EMITTERS,
  newBridgeId,
  nowIso,
  parseOrThrow,
  assertContractCompatible,
  bootstrapRequestSchema,
  heartbeatSchema,
  syncPushRequestSchema,
} from './bridgeContract.js';
import {
  bridgeError,
  BRIDGE_ERROR_CODES,
  BRIDGE_LOCAL_ERROR_CODES,
} from './bridgeErrors.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.pairingCode] Code d'appairage accepté (défaut PAIR-OK).
 * @param {string} [opts.panelName]   Nom d'affichage du stub.
 * @param {string} [opts.panelFrontendUrl] Origine publique annoncee au projet.
 */
export function createPanelStub({ pairingCode = 'PAIR-OK', panelName = 'panel-stub', panelFrontendUrl = 'https://panel.stub.test' } = {}) {
  const calls = [];
  /** Écritures reçues du projet, par writeId (idempotence). */
  const receivedByWriteId = new Map();
  /** File d'écritures « côté Panel » servies au pull (curseur = index). */
  const panelQueue = [];

  /**
   * CAPACITÉS SERVIES — le stub reproduit la FRONTIÈRE DU PANEL, pas Brevo.
   *
   * Il ne rend jamais un objet de fournisseur : il rend ce que la passerelle
   * rend, tel que le contrat le décrit. En faire un second `brevoEmail`
   * recréerait exactement le transport que le cutover a supprimé.
   */
  const capabilityCalls = [];
  /** Force la réponse de la PROCHAINE invocation : `Error` ⇒ refus. */
  let nextCapabilityOutcome = null;
  let messageSeq = 0;
  /**
   * LE FOURNISSEUR QUE CE STUB IMITE.
   *
   * Il n'est pas decoratif : les sorties de capacite le PORTENT depuis que le
   * domaine a deux executants, et un projet qui persiste `provider: undefined`
   * perdrait la seule information permettant de relire ses contrats plus tard.
   */
  const PROVIDER_SIGNATURE = 'OPENSIGN';

  /** Les demandes de signature ouvertes par ce stub. */
  let signatureSeq = 0;
  const signatureRequests = [];
  /** Le stub n a qu un projet : tout ce qu il cree lui appartient. */
  const STUB_OWNER = 'stub-project';

  let paired = false;
  let issuedToken = null;
  let failNextCode = null;
  let offline = false;
  let lastBootstrapRequest = null;

  function record(method, payload) {
    calls.push([method, payload]);
  }

  /**
   * LA PROJECTION DES MODÈLES SERVIE PAR LE DOUBLE (1.11.0).
   *
   * Un seul modèle par défaut, celui que les recettes d'envoi utilisent le plus
   * souvent. Les tests qui en veulent d'autres appellent `setEmailTemplates`.
   */
  let emailTemplates = [
    {
      templateId: 'PASSWORD_RESET_REQUEST',
      name: 'Compte — réinitialisation du mot de passe',
      subject: 'Réinitialisation de votre mot de passe',
      enabled: true,
      configured: true,
      usable: true,
      unusableReason: null,
      unusableMessage: '',
      version: 1,
      source: 'PROJECT',
      ownedBy: 'PROJECT',
      variableContractFingerprint: 'stub-fingerprint',
      variables: [],
    },
  ];

  /** Simule une panne ponctuelle : le PROCHAIN appel échoue avec ce code. */
  function failNextWith(code) {
    failNextCode = code;
  }

  /** Simule un Panel injoignable (tous les appels) jusqu'à goOnline(). */
  function goOffline() {
    offline = true;
  }
  function goOnline() {
    offline = false;
  }

  function gate(method) {
    if (offline) {
      throw bridgeError(
        BRIDGE_LOCAL_ERROR_CODES.PANEL_UNREACHABLE,
        `Panel stub hors-ligne (${method}).`
      );
    }
    if (failNextCode) {
      const code = failNextCode;
      failNextCode = null;
      throw bridgeError(code, `Panne simulée par le stub (${method}).`);
    }
  }

  function assertAuthed() {
    if (!paired || !issuedToken) {
      throw bridgeError(BRIDGE_ERROR_CODES.UNAUTHORIZED);
    }
  }

  return {
    name: 'panel-stub',
    // ------------------------------------------------ helpers de test
    calls,
    failNextWith,
    goOffline,
    goOnline,
    /** Enfile une écriture « faite côté Panel » qui sera servie au pull. */
    enqueuePanelChange(change) {
      panelQueue.push(change);
    },
    /**
     * CE QUE FAIT LE PANEL QUAND IL ACHEMINE UN FAIT TERMINAL.
     *
     * Côté production, `dispatchSignatureEvent` ferme le lien d'appartenance
     * dès qu'une demande est achevée, refusée, expirée ou annulée : c'est cette
     * fermeture qui libère le contrat, car l'index partiel n'autorise qu'UNE
     * demande vivante par contrat.
     *
     * Le stub n'a pas de webhook ; sans cette bascule explicite, un contrat
     * refusé puis relancé se verrait resservir l'ANCIENNE demande, et le test
     * conclurait à tort que la relance ne crée rien. On expose donc le même
     * effet, appelé au même moment du scénario.
     */
    closeSignatureFor(contractRef) {
      const cible = signatureRequests.find(
        (r) => r.contractRef === String(contractRef) && !r.closed,
      );
      if (cible) cible.closed = true;
      return Boolean(cible);
    },
    /**
     * LE FOURNISSEUR A ACHEVÉ LA DEMANDE — avant que le fait n'arrive.
     *
     * C'est l'ordre réel : le document est achevé chez le fournisseur, PUIS le
     * webhook part. Un test qui projette l'achèvement sans passer par ici
     * demanderait le certificat d'une demande que le stub croit encore en
     * cours — et obtiendrait le même refus qu'en production, au mauvais moment.
     */
    completeSignatureFor(contractRef) {
      const cible = signatureRequests.find((r) => r.contractRef === String(contractRef) && !r.closed);
      if (cible) { cible.status = 'done'; cible.state = 'DONE'; }
      return Boolean(cible);
    },
    /** Les demandes de signature ouvertes par ce stub — pour les assertions. */
    signatureRequests,
    /** Vue interne pour les assertions. */
    inspect() {
      return {
        paired,
        issuedToken,
        received: [...receivedByWriteId.values()],
        panelQueueSize: panelQueue.length,
        lastBootstrapRequest,
      };
    },

    // ------------------------------------------------ interface PanelClient
    async ping() {
      record('ping', {});
      gate('ping');
      return { status: 'ok', service: 'panel-bridge-api', time: nowIso() };
    },

    async bootstrap(request) {
      record('bootstrap', request);
      gate('bootstrap');
      const dto = parseOrThrow(bootstrapRequestSchema, request, 'BootstrapRequest');
      lastBootstrapRequest = dto;
      assertContractCompatible(dto.contractVersion);
      if (paired) throw bridgeError(BRIDGE_ERROR_CODES.ALREADY_PAIRED);
      if (dto.pairingCode !== pairingCode) {
        throw bridgeError(BRIDGE_ERROR_CODES.PAIRING_CODE_INVALID);
      }
      paired = true;
      issuedToken = `stub-bridge-token-${newBridgeId()}`;
      return {
        projectId: newBridgeId(),
        bridgeToken: issuedToken,
        panel: { name: panelName, contractVersion: CONTRACT_VERSION },
        /**
         * L'adresse publique du Panel, DECLAREE — comme le vrai Panel le fait
         * depuis que la confusion entre son adresse d'API et son adresse
         * humaine a casse la connexion federee d'un projet duplique.
         */
        panelFrontendUrl,
      };
    },

    async unpair() {
      record('unpair', {});
      gate('unpair');
      // Idempotent : désappairer un projet déjà désappairé répond pareil.
      paired = false;
      issuedToken = null;
      return { unpaired: true };
    },

    async heartbeat(heartbeat) {
      record('heartbeat', heartbeat);
      gate('heartbeat');
      assertAuthed();
      parseOrThrow(heartbeatSchema, heartbeat, 'Heartbeat');
      return { acknowledged: true, panelTime: nowIso() };
    },

    async pushChanges(request) {
      record('pushChanges', request);
      gate('pushChanges');
      assertAuthed();
      const { changes } = parseOrThrow(syncPushRequestSchema, request, 'SyncPushRequest');
      const results = changes.map((change) => {
        // Le sens projet -> Panel ne transporte que des écritures du PROJET.
        if (change.emitter !== EMITTERS.PROJECT) {
          return {
            writeId: change.writeId,
            status: ACK_STATUS.REJECTED,
            code: BRIDGE_ERROR_CODES.INVALID_PAYLOAD,
            message: 'emitter doit être PROJECT sur ce sens.',
          };
        }
        if (receivedByWriteId.has(change.writeId)) {
          return { writeId: change.writeId, status: ACK_STATUS.DUPLICATE };
        }
        receivedByWriteId.set(change.writeId, change);
        return { writeId: change.writeId, status: ACK_STATUS.APPLIED };
      });
      return { results };
    },

    async pullChanges({ cursor, limit = 100 } = {}) {
      record('pullChanges', { cursor, limit });
      gate('pullChanges');
      assertAuthed();
      const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const page = panelQueue.slice(start, start + limit);
      const nextCursor = String(start + page.length);
      return {
        changes: page,
        cursor: nextCursor,
        hasMore: start + page.length < panelQueue.length,
      };
    },

    /**
     * Passerelle de capacités (contrat 1.5.0) — VOLONTAIREMENT INERTE.
     *
     * Le stub sert à éprouver le PONT hors réseau : appairage, battements,
     * synchronisation. Une capacité, elle, s'exécute chez un FOURNISSEUR RÉEL
     * derrière un Panel réel — la simuler ici produirait un succès qui ne
     * prouve rien, et masquerait précisément ce que le lot L3 doit démontrer.
     *
     * Le refus est donc explicite : la preuve de bout en bout appartient à
     * l'E2E, qui lance un vrai Panel et un vrai projet.
     */
    /**
     * L6.3A — le canal étroit du secret de vérification.
     *
     * Le stub rend un secret DE FORME VALIDE mais évidemment factice : les
     * suites qui éprouvent le rapatriement doivent pouvoir le distinguer d'un
     * vrai d'un seul coup d'œil dans un journal.
     */
    async fetchWebhookVerificationSecret(provider) {
      record('fetchWebhookVerificationSecret', { provider });
      gate('fetchWebhookVerificationSecret');
      assertAuthed();
      return { webhookSecret: `whsec_stub_${String(provider).toLowerCase()}_verification` };
    },

    /**
     * L12.B — le stub répond TOUJOURS « actif ».
     *
     * C'est le bon défaut pour un double de test : les recettes qui éprouvent
     * un REFUS le font en remplaçant explicitement cette réponse, et celles
     * qui n'ont pas la fédération pour sujet ne doivent pas se mettre à
     * échouer parce qu'un double dit non.
     */
    async introspectFederatedPrincipal(input = {}) {
      record('introspectFederatedPrincipal', input);
      gate('introspectFederatedPrincipal');
      assertAuthed();
      return {
        active: true,
        principal: {
          panelUserId: input.panelUserId ?? 'stub-panel-user',
          displayName: 'Développeur (stub)',
          email: 'dev@stub.test',
          role: 'DEV',
          enabled: true,
          tokenVersion: input.tokenVersion ?? 0,
        },
      };
    },

    /* ------------------------------------------------ modèles d'e-mail --- */
    /*
     * LA PROJECTION DU PANEL, EN DOUBLE (1.11.0).
     *
     * Volontairement MINIMALE et volontairement AUTORITATIVE : le double rend
     * un modèle utilisable, avec un sujet et une empreinte de contrat. Les
     * tests qui veulent éprouver un refus le demandent explicitement via
     * `setEmailTemplates` — un double qui rendrait « non configuré » par défaut
     * ferait passer pour une panne l'absence de configuration du double.
     */
    setEmailTemplates(items) {
      emailTemplates = Array.isArray(items) ? items : [];
    },

    async listEmailTemplates() {
      record('listEmailTemplates', {});
      gate('listEmailTemplates');
      assertAuthed();
      return { data: emailTemplates };
    },

    async getEmailTemplate(templateCode) {
      record('getEmailTemplate', { templateCode });
      gate('getEmailTemplate');
      assertAuthed();
      const found = emailTemplates.find((t) => t.templateId === templateCode);
      if (!found) throw bridgeError(BRIDGE_ERROR_CODES.INTERNAL, `Modèle inconnu du stub : ${templateCode}.`);
      return { data: found };
    },

    async previewEmailTemplate(templateCode) {
      record('previewEmailTemplate', { templateCode });
      gate('previewEmailTemplate');
      assertAuthed();
      const found = emailTemplates.find((t) => t.templateId === templateCode);
      return {
        data: {
          templateId: templateCode,
          usable: Boolean(found?.usable),
          subject: found?.subject ?? null,
          html: found?.usable ? '<p>aperçu (stub)</p>' : null,
          unusableReason: found?.usable ? null : (found?.unusableReason ?? 'EMAIL_TEMPLATE_NOT_CONFIGURED'),
          unusableMessage: found?.usable ? '' : 'Modèle non exploitable (stub).',
          sampleVariables: {},
        },
      };
    },

    async emailTemplateReadiness(templateCode) {
      record('emailTemplateReadiness', { templateCode });
      gate('emailTemplateReadiness');
      assertAuthed();
      const found = emailTemplates.find((t) => t.templateId === templateCode);
      const ready = Boolean(found?.usable);
      return {
        data: {
          ready,
          blockers: ready ? [] : [{ code: 'EMAIL_TEMPLATE_NOT_CONFIGURED', message: 'Stub : modèle non exploitable.' }],
          warnings: [],
          context: { provider: 'BREVO', template: { templateId: templateCode } },
        },
      };
    },

    async sendEmailTemplateTest(templateCode, recipientEmail) {
      record('sendEmailTemplateTest', { templateCode, recipientEmail });
      gate('sendEmailTemplateTest');
      assertAuthed();
      return {
        data: {
          templateId: templateCode,
          operationId: `stub-test-${templateCode}`,
          providerMessageId: `stub-msg-${templateCode}`,
          message: 'Accepté (stub).',
        },
      };
    },

    async invokeCapability(code, input = {}) {
      record('invokeCapability', { code, input });
      gate('invokeCapability');
      assertAuthed();

      /**
       * ══ CE QUE CE STUB SERT, ET CE QU'IL NE SERVIRA JAMAIS ═══════════════
       *
       * Depuis le cutover L8.4C, un envoi métier N'EST PLUS un appel HTTP
       * local : c'est une capacité demandée au Panel. Les suites qui éprouvent
       * une fonctionnalité dont l'e-mail est un effet de bord — réinitialiser
       * un mot de passe, notifier un contact — n'ont donc plus rien à
       * observer si le stub refuse tout.
       *
       * Refuser les laisserait devant un choix également mauvais : perdre la
       * couverture, ou réintroduire le transport supprimé. Le stub sert donc
       * la capacité, et RIEN de plus : il rend ce que la passerelle rend,
       * jamais ce que le fournisseur rendrait.
       *
       * Il ne rend AUCUN contenu et ne connaît AUCUN identifiant Brevo : le
       * sujet et le HTML sont rendus par le Panel, hors de portée du projet.
       */
      if (nextCapabilityOutcome) {
        const forced = nextCapabilityOutcome;
        nextCapabilityOutcome = null;
        if (forced instanceof Error) throw forced;
        return forced;
      }

      if (code === 'email.send_template') {
        const operationId = String(input?.operationId ?? '');
        if (!operationId) {
          // Le contrat l'exige : sans clé d'idempotence, la passerelle refuse.
          throw bridgeError(
            BRIDGE_ERROR_CODES.INVALID_PAYLOAD,
            'email.send_template : operationId requis (clé d’idempotence).',
          );
        }
        /**
         * IDEMPOTENCE — même `operationId`, même réponse, aucun second envoi.
         * C'est la garantie que le vrai Panel donne ; un stub qui l'ignorerait
         * laisserait passer un doublon que la production, elle, refuserait.
         */
        const deja = capabilityCalls.find(
          (c) => c.code === code && c.operationId === operationId && c.providerMessageId,
        );
        if (deja) {
          capabilityCalls.push({ ...deja, replayed: true });
          return {
            capability: code,
            outcome: 'SUCCEEDED',
            operationId,
            result: {
              status: 'ALREADY_SENT',
              providerMessageId: deja.providerMessageId,
              operationId,
            },
          };
        }

        messageSeq += 1;
        const providerMessageId = `<msg-stub-${messageSeq}@panel>`;
        capabilityCalls.push({
          code,
          operationId,
          providerMessageId,
          // Le DESTINATAIRE LOGIQUE et le MODÈLE LOGIQUE, rien d'autre : ni
          // credential, ni contenu rendu. Une observation de test n'a aucune
          // raison de porter ce que la production refuse de transporter.
          recipient: input?.recipient?.email ?? null,
          templateRef: input?.templateRef ?? null,
          // Le REPLY-TO fait partie de l'intention métier — répondre doit
          // écrire au demandeur, pas à notre expéditeur — donc il s'observe.
          replyTo: input?.replyTo?.email ?? null,
          /**
           * LES VARIABLES MÉTIER — pas le contenu rendu.
           *
           * Ce sont les DONNÉES que le projet fournit (une URL de
           * réinitialisation, un nom, une référence de contrat) : elles lui
           * appartiennent, il vient de les produire, et c'est sur elles que
           * portent ses assertions. Le sujet et le HTML, eux, sont rendus par
           * le Panel et n'ont rien à faire ici.
           */
          variables: { ...(input?.variables ?? {}) },
          replayed: false,
        });
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          operationId,
          /**
           * L'EXPÉDITEUR RÉSOLU — rendu par le vrai Panel depuis R10.4/R10.5.
           *
           * Le stub doit le rendre aussi, sinon la livraison du projet resterait
           * sans expéditeur en recette alors qu'elle en porterait un en
           * production : le test passerait pour une raison qui n'existe pas.
           *
           * Il n'apparaît PAS dans la branche `ALREADY_SENT` ci-dessus, et c'est
           * fidèle : un rejeu est rendu depuis le registre d'opérations, sans
           * réexécuter l'adaptateur, donc sans re-résoudre l'expéditeur.
           */
          result: {
            status: 'ACCEPTED',
            providerMessageId,
            operationId,
            sender: { email: 'support@exemple.fr', name: 'SB Auto' },
          },
        };
      }

      /* ── SIGNATURE (R10.5C) ──────────────────────────────────────────── */

      /**
       * LE STUB REPRODUIT LA GARANTIE DU VRAI PANEL, PAS SON IMPLÉMENTATION.
       *
       * Ce qui compte pour le projet : deux ouvertures du MÊME contrat ne
       * produisent qu'UNE demande. Un stub qui ignorerait cela laisserait
       * passer un doublon que la production refuserait — le test serait vert
       * pour une raison qui n'existe pas.
       */
      if (code === 'signature.request.open') {
        const contractRef = String(input?.contractRef ?? '');
        const deja = signatureRequests.find((r) => r.contractRef === contractRef && !r.closed);
        if (deja) {
          capabilityCalls.push({ code, contractRef, replayed: true });
          return {
            capability: code,
            outcome: 'SUCCEEDED',
            operationId: input?.operationId,
            result: {
              status: 'ALREADY_OPEN',
              provider: PROVIDER_SIGNATURE,
              signatureRequestId: deja.id,
              documentId: deja.documentId,
              contractRef,
              signers: deja.signers,
            },
          };
        }

        signatureSeq += 1;
        /**
         * L'IDENTIFIANT IMITE CELUI DU FOURNISSEUR REEL.
         *
         * Le contrat de capacite borne `signatureRequestId` a 8 caracteres au
         * minimum, et la plateforme en rend dix. Un identifiant plus court
         * passerait ici et serait REFUSE en production, par un schema d'entree
         * -- c'est-a-dire au pire endroit : loin, et sans rapport apparent.
         */
        const id = `sig${String(signatureSeq).padStart(7, '0')}`;
        const signers = (input?.signers ?? []).map((sg, i) => ({
          role: sg.role,
          /**
           * UNE POIGNEE OPAQUE DE 32 CARACTERES, comme celle que la plateforme
           * derive. Un identifiant lisible (`...-signer-1`) laisserait croire
           * qu'on peut le composer soi-meme, et masquerait le fait qu'il est
           * DERIVE du document et de l'adresse.
           */
          signerId: createHash('sha256').update(`${id}:${sg.email}`).digest('hex').slice(0, 32),
          signatureLink: `https://signature.test/login/${id}-${i + 1}`,
        }));
        const entry = {
          id, contractRef, documentId: `${id}-doc`, signers, closed: false,
          status: 'ongoing',
          projectId: STUB_OWNER,
          /**
           * LE DOCUMENT DÉPOSÉ EST CONSERVÉ POUR ÊTRE RENDU SIGNÉ.
           *
           * Le projet ne se contente pas de stocker les octets reçus : il les
           * OUVRE pour en compter les pages avant de les ranger. Rendre une
           * chaîne en forme de PDF ferait échouer cette lecture — et comme
           * l'échec de récupération est volontairement non bloquant (le contrat
           * est signé quoi qu'il arrive), on obtiendrait un contrat achevé sans
           * document, sans savoir pourquoi.
           *
           * Fabriquer un PDF valide ici obligerait ce module à importer une
           * bibliothèque métier, ce que la règle de découplage du pont interdit
           * — et elle a raison. Renvoyer le document DÉPOSÉ résout les deux
           * problèmes : il est valide par construction, puisque c'est celui que
           * l'appelant a fourni.
           */
          documentBase64: String(input?.documentBase64 ?? ''),
        };
        signatureRequests.push(entry);
        capabilityCalls.push({
          code, contractRef, signatureRequestId: id,
          signerCount: signers.length,
          fieldCount: (input?.fields ?? []).length,
          documentBytes: Buffer.byteLength(String(input?.documentBase64 ?? ''), 'base64'),
        });
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          operationId: input?.operationId,
          result: {
            status: 'OPENED',
            provider: PROVIDER_SIGNATURE,
            signatureRequestId: id,
            documentId: entry.documentId,
            contractRef,
            signers,
          },
        };
      }

      /**
       * L'APPARTENANCE EST VÉRIFIÉE ICI AUSSI.
       *
       * Le vrai Panel refuse une ressource étrangère AVANT d'ouvrir le coffre.
       * Un stub permissif rendrait le test incapable de distinguer « le projet
       * a le droit » de « personne ne vérifie ».
       */
      const cibleSignature = (ref) => signatureRequests.find((r) => r.id === ref);

      if (code === 'signature.request.retrieve' || code === 'signature.signer.retrieve'
        || code === 'signature.document.download' || code === 'signature.certificate.download'
        || code === 'signature.request.cancel') {
        const cible = cibleSignature(input?.signatureRequestId);
        if (!cible || cible.projectId !== STUB_OWNER) {
          throw bridgeError(
            'CAPABILITY_RESOURCE_NOT_OWNED',
            'Demande de signature inconnue pour ce projet.',
          );
        }
        capabilityCalls.push({ code, signatureRequestId: cible.id });

        if (code === 'signature.request.retrieve') {
          return {
            capability: code, outcome: 'SUCCEEDED',
            result: {
              signatureRequestId: cible.id,
              provider: PROVIDER_SIGNATURE,
              /**
               * L'ETAT NEUTRE, comme le vrai Panel le rend depuis la bascule.
               * Rendre le vocabulaire d'un fournisseur ferait passer le test la
               * ou la production repondrait « inconnu » sur chaque etat.
               */
              state: cible.state ?? 'ONGOING',
              status: cible.status,
              signers: cible.signers.map((sg) => ({
                signerId: sg.signerId, role: sg.role, state: 'PENDING', status: null,
              })),
            },
          };
        }
        if (code === 'signature.signer.retrieve') {
          const sg = cible.signers.find((x) => x.signerId === input?.signerId);
          return {
            capability: code, outcome: 'SUCCEEDED',
            result: {
              signerId: sg?.signerId ?? null,
              provider: PROVIDER_SIGNATURE,
              state: 'PENDING',
              status: null,
              signatureLink: sg?.signatureLink ?? null,
            },
          };
        }
        if (code === 'signature.document.download') {
          /**
           * LE DOCUMENT SIGNÉ EST CELUI QUI A ÉTÉ DÉPOSÉ.
           *
           * Voir le commentaire à l'ouverture : le projet OUVRE ce qu'il
           * reçoit, donc les octets doivent être un PDF valide — et le seul
           * PDF valide dont ce module dispose sans importer de bibliothèque
           * métier est celui que l'appelant a déposé.
           */
          const contenu = Buffer.from(cible.documentBase64, 'base64');
          return {
            capability: code, outcome: 'SUCCEEDED',
            result: {
              signatureRequestId: cible.id,
              provider: PROVIDER_SIGNATURE,
              /**
               * LE CERTIFICAT N'EXISTE QU'UNE FOIS LA DEMANDE ACHEVÉE — comme
               * chez le vrai fournisseur. Le rendre « disponible » en toutes
               * circonstances ferait passer un test qui, en production,
               * demanderait une pièce qui n'est pas encore publiée.
               */
              certificateAvailable: cible.status === 'done' || cible.state === 'DONE',
              documentId: cible.documentId,
              contentBase64: contenu.toString('base64'),
              byteLength: contenu.length,
              sha256: createHash('sha256').update(contenu).digest('hex'),
            },
          };
        }
        if (code === 'signature.certificate.download') {
          /**
           * LA PREUVE D'AUDIT — UNE PIÈCE DISTINCTE, ET ELLE LE RESTE ICI.
           *
           * Le stub aurait pu rendre le même contenu que le contrat : c'aurait
           * été plus court, et ça aurait masqué la seule chose qui compte —
           * qu'un projet qui confond les deux archive deux fois l'engagement et
           * jamais sa preuve.
           *
           * Le refus AVANT achèvement est reproduit à l'identique : c'est le
           * chemin le plus fréquent en vrai, puisque le certificat n'existe
           * qu'à la toute fin.
           */
          if (!(cible.status === 'done' || cible.state === 'DONE')) {
            throw bridgeError(
              'CAPABILITY_NOT_AVAILABLE',
              'Aucun certificat d’audit n’est publié pour cette demande.',
              { reason: 'CERTIFICATE_NOT_PUBLISHED_YET' },
            );
          }
          const preuve = Buffer.from(
            `%PDF-1.7
% certificat d'audit du stub — demande ${cible.id}
`,
            'utf8',
          );
          return {
            capability: code, outcome: 'SUCCEEDED',
            result: {
              signatureRequestId: cible.id,
              documentId: cible.documentId,
              provider: PROVIDER_SIGNATURE,
              contentBase64: preuve.toString('base64'),
              byteLength: preuve.length,
              sha256: createHash('sha256').update(preuve).digest('hex'),
              contentType: 'application/pdf',
            },
          };
        }
        cible.closed = true;
        cible.status = 'canceled';
        return { capability: code, outcome: 'SUCCEEDED', result: { signatureRequestId: cible.id, status: 'CANCELED' } };
      }
      throw bridgeError(
        BRIDGE_ERROR_CODES.OPERATION_UNKNOWN,
        `Le stub de Panel ne sert pas la capacité « ${code} ».`,
      );
    },

    /* ── OBSERVATION DE TEST ────────────────────────────────────────────── */

    /** Les invocations reçues — sans credential, sans contenu rendu. */
    capabilityCalls: () => capabilityCalls.slice(),
    /** Les seuls envois logiques, rejeux exclus. */
    emailSendRequests: () => capabilityCalls.filter(
      (c) => c.code === 'email.send_template' && !c.replayed,
    ),
    resetCapabilityCalls: () => { capabilityCalls.length = 0; },
    /**
     * Force l'issue de la PROCHAINE invocation. Une `Error` portant un code
     * `CAPABILITY_*` reproduit un refus de la passerelle ; un objet reproduit
     * une réponse. Sert à éprouver la classification des refus — notamment
     * qu'un fournisseur indisponible reste REJOUABLE, puisque rien n'est parti.
     */
    forceNextCapability: (outcome) => { nextCapabilityOutcome = outcome; },
  };
}
