/**
 * CONTRAT DU PONT PANEL ↔ PROJET — miroir exécutable des spécifications
 * officielles :
 *
 *   docs/panelXvitrine/spec/PanelBridge.openapi.yaml   (sens PROJET → PANEL)
 *   docs/panelXvitrine/spec/ProjectBridge.openapi.yaml (sens PANEL → PROJET)
 *
 * Ce module est la SEULE définition côté code des DTO, codes d'erreur, routes
 * et constantes du contrat. PanelBridge, ProjectBridge, le stub de Panel et
 * les tests de conformité l'importent tous : si la spec évolue, on change ICI
 * et le test `bridge-conformity.test.js` vérifie que les fichiers OpenAPI
 * racontent la même histoire (routes, codes, types d'entités).
 *
 * Règles de synchronisation implémentées par ces DTO
 * (docs/panelXvitrine/11_DONNEES_CENTRALISEES.md §1.1) :
 *   1. LWW  — `modifiedAt` posé par l'émetteur, granularité document ;
 *   2. UUID — `entityId` généré par le côté créateur ;
 *   3. tombstones — `deleted: true` + `payload: null` ;
 *   4. anti-écho — `writeId` = identifiant d'ORIGINE de l'écriture ;
 *   5. idempotence — rejouer un `writeId` déjà vu est un non-événement.
 *
 * AUCUNE dépendance métier ici : uniquement zod + node:crypto. Le découplage
 * est verrouillé par le test de conformité.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { bridgeError, BRIDGE_ERROR_CODES } from './bridgeErrors.js';

/**
 * Version sémantique du contrat parlée par CE code.
 * 1.1.0 (Phase 2A, additif) : manifeste officiel du projet — endpoint
 * GET /manifest côté ProjectBridge + champ optionnel `manifest` du bootstrap.
 */
// 1.2.0 (Phase 3A, additif) : supervision passive — Heartbeat.runtime,
//   Heartbeat.engines, ProjectManifest.engines / .network / .descriptor.
// 1.3.0 (Phase 4, additif) : découverte descendante — le bootstrap rend
//   l'entreprise et les APIs intégrées accordées à CE projet ; l'identité
//   déclare ce que le projet a RÉELLEMENT appliqué. Tous optionnels.
// 1.8.0 (ADDITIF, rétrocompatible) : DÉCLARATION D'USAGE DES MODÈLES D'E-MAIL
//   — entité `PROJECT_EMAIL_TEMPLATE_USAGE`, poussée par le projet. Un Panel
//   antérieur la refuse proprement (BRIDGE_ENTITY_TYPE_UNSUPPORTED) et tout le
//   reste continue : l'entité est additive, aucune existante ne change de forme.
// 1.4.0 (additif) : IDENTITÉ AU PING — le ping public du ProjectBridge annonce
//   `projectKey` et `projectName`. Le Panel peut ainsi reconnaître un projet
//   AVANT l'appairage, au lieu de faire ressaisir une clé que le projet
//   connaît déjà. Optionnels : un Panel 1.3.x les ignore sans rien casser.
// 1.9.0 (ADDITIF, rétrocompatible) : LE PROJET DÉCLARE SON RÉSEAU COURANT —
//   `Heartbeat.runtime.network` porte les adresses publiques que ce projet SERT
//   réellement, à chaque battement. Le Panel cesse ainsi de conserver l'adresse
//   figée au jour de l'appairage. Entièrement optionnel : un Panel antérieur
//   valide le battement en `.strict()` et REFUSERAIT un champ inconnu — c'est
//   pourquoi l'émission est conditionnée à la version que le Panel annonce
//   (voir `bridgeRuntime.js` / `panelSpeaks`). Aucune entité de synchronisation
//   ne change de forme.
// 1.10.0 (ADDITIF, rétrocompatible) : L'ENTREPRISE CLIENTE, LA VENTILATION
//   FISCALE, ET LA SANTÉ DE CONSOMMATION DU PONT.
//
//   · `CLIENT_COMPANY` — entité poussée par le Panel vers CE projet et lui
//     seul. Elle porte l'identité JURIDIQUE du client (raison sociale, SIREN,
//     adresses, signataire contractuel). Le projet l'APPLIQUE et l'AFFICHE ; il
//     ne l'écrit jamais — l'autorité est le Panel, exactement comme pour
//     `DEV_COMPANY`, dont elle reste rigoureusement distincte : l'une est le
//     prestataire, l'autre est le client.
//
//   · `Contract.pricing.*.amountExcludingTax` / `.taxAmount` / `.taxRate` — la
//     ventilation que `computePricing` calcule DÉJÀ ici et que le projet
//     gardait pour lui. Le Panel, devenu émetteur des factures, ne connaissait
//     que le TTC : il ne pouvait produire qu'un document muet sur la TVA.
//
//   · `Heartbeat.bridgeStats.consumption` — ce que ce pont CONSOMME. Les
//     champs existants décrivent la file SORTANTE ; un projet dont le TIRAGE
//     est mort a une file sortante vide et un battement parfait. Le Panel ne
//     pouvait donc pas distinguer « rien à recevoir » de « plus rien n'arrive ».
//
//   ÉMISSION CONDITIONNÉE : les schémas d'entrée du Panel sont `.strict()`, et
//   un champ inconnu fait refuser le battement ENTIER — un projet sain rendu
//   muet par une extension censée être additive. On ne publie donc les
//   nouveautés qu'à un Panel qui a ANNONCÉ savoir les lire (`panelSpeaks`).
export const CONTRACT_VERSION = '1.15.0';

/** Version du FORMAT du manifeste de projet (indépendante du contrat). */
export const MANIFEST_FORMAT_VERSION = '1.0.0';

/** En-tête portant la version du contrat (requêtes ET réponses, deux sens). */
export const CONTRACT_VERSION_HEADER = 'x-bridge-contract-version';

/**
 * Types d'entités synchronisables (catégorie 2 — 00_ECOSYSTEME §5.2).
 * Phase 1 : seul DIAGNOSTIC est APPLIQUÉ (échange de test sans effet métier) ;
 * les autres sont déclarés RÉSERVÉS et refusés proprement
 * (BRIDGE_ENTITY_TYPE_UNSUPPORTED) tant que leur lot Phase 3+ n'est pas livré.
 */
export const SYNC_ENTITY_TYPES = Object.freeze([
  'DIAGNOSTIC',
  'CONTRACT',
  'INVOICE',
  'PAYMENT',
  'CONTRACT_DOCUMENT',
  'DEV_COMPANY',
  'TEAM_MEMBER',
  /*
   * `EMAIL_TEMPLATE` a ete RETIRE en 1.11.0 — des deux cotes du pont.
   *
   * Il figurait ici depuis l'origine sans qu'aucun emetteur ne le produise ni
   * qu'aucun projecteur ne l'applique. Le garder laissait croire, a la lecture
   * du contrat, que le CONTENU des modeles voyage. Il ne voyage pas : le Panel
   * en est la seule autorite, et ce projet n'en consomme que la projection en
   * lecture, hors synchronisation d'entites.
   */
  'INTEGRATED_API_CONFIG',
  'INTEGRATED_API_MODE',
  'EVENT',
  'MEETING',
  // >= 1.4.x — IDENTITE COMMERCIALE poussee par le projet. Le manifeste
  // ne la porte qu'au (re)chargement ; cette entite la fait remonter a
  // CHAQUE modification, sans action humaine.
  'PROJECT_PRESENTATION',
  /**
   * >= 1.4.x — ETAT D'ACCESSIBILITE DU SITE, poussé par le projet.
   *
   * AGREGAT DISTINCT DE `CONTRACT`, et il doit le rester. Une suspension
   * TECHNIQUE (maintenance) n'a aucun rapport avec un contrat : la
   * transporter sous l'etiquette contractuelle ferait afficher « probleme de
   * contrat » devant une operation de maintenance, et inversement. Le statut
   * du site est DERIVE des deux causes, mais il n'appartient a aucune.
   */
  'PROJECT_SITE_STATUS',
  /**
   * >= 1.8.0 — CE QUE LE PROJET UTILISE COMME MODÈLES D'E-MAIL.
   *
   * ══ UNE DÉCLARATION D'ÉTAT, PAS UNE DEMANDE DE MUTATION ═══════════════════
   *
   * Le projet ne demande pas « provisionne-moi ces dix modèles » : il ANNONCE
   * les codes qu'il consomme. Le Panel en tire les conséquences — poser une
   * instance manquante, retirer de la vue active un code qui n'est plus
   * annoncé. C'est la différence entre un ordre, qu'il faudrait rejouer à
   * l'identique après une coupure, et un état, qui converge tout seul.
   *
   * Elle passe donc par la synchronisation d'entités, avec tout ce qu'elle
   * apporte gratuitement : LWW sur `modifiedAt`, anti-écho par `writeId`,
   * idempotence, file durable, rattrapage au pull. Une capacité impérative
   * n'aurait eu aucune de ces propriétés.
   *
   * UNE SEULE entité par projet — `entityId` stable — comme
   * `PROJECT_PRESENTATION` : c'est un état, pas une collection.
   *
   * Le projet reste l'autorité de l'USAGE ; le Panel garde l'autorité du
   * CONTRAT (quels codes existent, leurs variables) et du CONTENU.
   */
  'PROJECT_EMAIL_TEMPLATE_USAGE',
  /**
   * >= 1.11.0 — UN INCIDENT TECHNIQUE DURABLE, poussé par CE projet.
   *
   * Le projet envoyait lui-même l'alerte, avec le modèle
   * `PLATFORM_INCIDENT_DEV_ALERT`. Elle ne pouvait pas aboutir : ce modèle est
   * une communication de L.Y Solution, donc de portée PANEL, et un projet ne
   * peut pas demander une portée PANEL. Chaque incident finissait en refus
   * silencieux.
   *
   * Il RAPPORTE désormais un fait ; le control plane décide de l'alerte, de ses
   * destinataires et de son contenu. Passer par la synchronisation plutôt que
   * par une capacité donne en prime la file durable : un incident survenu
   * pendant que le Panel était injoignable — le cas le plus probable — n'est
   * plus perdu.
   */
  'PLATFORM_INCIDENT',
  /**
   * >= 1.6.x — RETOUR DE LIVRAISON D'UN E-MAIL, poussé par le Panel (L8.4C).
   *
   * Depuis que les envois partent du compte Brevo du Panel, les webhooks de
   * livraison suivent le COMPTE et n'atteignent plus le projet. Cette entité
   * est le chemin de retour : elle porte un verbe métier déjà normalisé
   * (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`), jamais un événement brut du
   * fournisseur — le projet n'a pas à connaître le vocabulaire de Brevo pour
   * savoir qu'un message est arrivé.
   */
  'EMAIL_DELIVERY_EVENT',
  /**
   * >= 1.7.x — LE RETOUR DE SIGNATURE, poussé par le Panel (R10.5C).
   *
   * Même raison d'être que `EMAIL_DELIVERY_EVENT`, et même leçon : après
   * cutover, les webhooks Yousign suivent le COMPTE, donc le Panel. Sans cette
   * entité, un contrat signé resterait « en cours » côté projet, et un projet
   * éteint au mauvais moment perdrait le fait définitivement.
   *
   * Elle porte un fait NORMALISÉ — `SIGNATURE_SIGNER_SIGNED`,
   * `SIGNATURE_COMPLETED`, `SIGNATURE_FAILED` — jamais l'événement brut du
   * fournisseur : le projet n'a pas à connaître le vocabulaire de Yousign pour
   * savoir qu'un contrat est signé.
   */
  'SIGNATURE_EVENT',
  /**
   * >= 1.7.x — UNE PRESTATION À RÉGLER, poussée par le Panel (L10.5).
   *
   * DISTINCTE de `INVOICE` et de `PAYMENT`, et elle doit le rester. Ces deux-là
   * décrivent ce qui a EU LIEU — une facture Stripe émise, un paiement encaissé.
   * Celle-ci décrit ce qui est RÉCLAMÉ : une somme due, qui n'a produit aucune
   * facture et qui n'en produira peut-être jamais.
   *
   * Les confondre aurait fait apparaître, dans l'historique de facturation du
   * client, des factures qui n'existent pas.
   */
  'PAYMENT_REQUEST',
  /**
   * >= 1.7.x — UNE CAUSE DE SUSPENSION, poussée par le Panel (L10.6).
   *
   * Elle transporte un FAIT COMMERCIAL — « le défaut de paiement est actif pour
   * ce projet » — jamais un état de site. Le Panel est l'autorité de la
   * politique de grâce ; ce projet reste l'autorité de son accessibilité, et il
   * combine cette cause avec les siennes.
   *
   * Un ordre `status: SUSPENDED` aurait créé un second maître : une maintenance
   * technique en cours aurait été levée par le Panel, ou l'aurait levé — dans
   * les deux cas une décision que personne n'a prise.
   */
  'PAYMENT_DEFAULT_CAUSE',
  /**
   * >= 1.7.x — L'INCIDENT DE PAIEMENT, poussé par le Panel (L10.6B-3).
   *
   * ══ IL N'EST PAS LA CAUSE, ET C'EST TOUT L'INTÉRÊT ════════════════════════
   *
   * `PAYMENT_DEFAULT_CAUSE.active` est une ENTRÉE du moteur de suspension :
   * l'applicateur l'écrit dans `siteStatus.paymentDefault`, et
   * `reconcileSiteStatus()` en tire l'accessibilité du site.
   *
   * Or un défaut de paiement EXISTE avant que cette cause ne devienne active —
   * c'est très exactement ce que le délai de grâce définit. Pendant toute cette
   * période :
   *
   *     incident existe            = vrai
   *     cause de suspension active = faux
   *     site accessible            = vrai
   *
   * Les trois sont vraies EN MÊME TEMPS. Aucun booléen ne peut les porter
   * ensemble, et détourner `active` pour signifier « il y a un incident »
   * aurait fermé les sites pendant leur grâce.
   *
   * Ce type transporte donc l'incident lui-même — échec, tentatives observées
   * chez Stripe, délai figé, échéance, demande de suspension, confirmation,
   * résolution. En LECTURE SEULE : il n'entre dans aucune décision
   * d'accessibilité, et son applicateur ne touche jamais `SiteStatus`.
   */
  'PAYMENT_DEFAULT_INCIDENT',
  /**
   * >= 1.10.0 — L'ENTREPRISE CLIENTE, poussée par le Panel vers CE projet.
   *
   * ══ POURQUOI ELLE N'EMPRUNTE PAS `DEV_COMPANY` ════════════════════════════
   *
   * Ce sont DEUX personnes morales, et elles se font face :
   *
   *     DEV_COMPANY     L.Y Solution — le PRESTATAIRE. Ce que le pied de page
   *                     de ce site affiche déjà, et ce qui signe nos contrats
   *                     du côté développeur.
   *
   *     CLIENT_COMPANY  L'ENTREPRISE DE CE PROJET — l'ACHETEUR. Ce que la
   *                     facture doit porter en « Facturer à », et qui désigne
   *                     le signataire client.
   *
   * Les fondre aurait obligé ce projet à deviner, à la lecture, laquelle des
   * deux il reçoit — et la page « Mon entreprise » aurait fini par afficher les
   * mentions légales de son prestataire.
   *
   * ══ LECTURE SEULE, SANS EXCEPTION ════════════════════════════════════════
   *
   * Ce projet ne publie JAMAIS cette entité. Elle n'apparaît dans aucune
   * projection sortante, aucun déclencheur, aucune file. Pouvoir l'écrire
   * reviendrait à laisser un client choisir la raison sociale sur laquelle il
   * est facturé et la personne qui l'engage.
   */
  'CLIENT_COMPANY',
  /**
   * >= 1.14.0 — UN DOCUMENT LÉGAL RÉSOLU, poussé par le Panel vers CE projet.
   *
   * Titre, sections, paragraphes, listes et lignes d'identification, avec les
   * valeurs du client, du concepteur et de l'hébergeur DÉJÀ substituées. Aucune
   * variable, aucune règle, aucun HTML : ce projet affiche, il ne résout pas.
   *
   * Répliqué plutôt que lu à la demande : une page de mentions légales ne doit
   * pas disparaître quand le Panel est injoignable. C'est l'autonomie du projet
   * (04_STANDALONE) appliquée à une obligation légale.
   *
   * SENS UNIQUE : ce projet ne publie JAMAIS cette entité. Pouvoir l'écrire
   * reviendrait à rédiger localement des mentions légales — la copie divergente
   * que le référentiel central existe pour supprimer.
   */
  'LEGAL_DOCUMENT',
]);

/**
 * Types que ce projet APPLIQUE réellement.
 *
 * Phase 1 : DIAGNOSTIC seul (échange de test, sans effet métier).
 * Phase 4 : + DEV_COMPANY et INTEGRATED_API_CONFIG — le projet reçoit
 *   désormais l'identité de l'entreprise qu'il représente et les accès aux
 *   services tiers qui lui sont accordés.
 *
 * Tout type absent de cette liste est refusé PROPREMENT
 * (BRIDGE_ENTITY_TYPE_UNSUPPORTED) : déclaré au contrat ne veut pas dire
 * implémenté, et prétendre le contraire ferait diverger les deux côtés en
 * silence.
 */
export const APPLIED_ENTITY_TYPES = Object.freeze([
  'DIAGNOSTIC',
  'DEV_COMPANY',
  'INTEGRATED_API_CONFIG',
  // L8.4C — le retour de livraison. Déclaré ET appliqué : son applicateur est
  // branché au bootstrap, et la chaîne est prouvée de bout en bout.
  'EMAIL_DELIVERY_EVENT',
  /**
   * R10.5C — le retour de signature. Déclaré ET appliqué : son applicateur est
   * branché sur les DEUX chemins (push temps réel et rattrapage au pull), et
   * un garde-fou statique le vérifie.
   */
  'SIGNATURE_EVENT',
  /**
   * L10.5 — les prestations à régler. Appliquées dans une collection LOCALE,
   * en lecture seule pour le projet : le Panel décide, le Manager affiche.
   */
  'PAYMENT_REQUEST',
  /**
   * L10.6 — la cause « défaut de paiement ». Appliquée en rendant la main au
   * moteur de réconciliation, qui seul écrit l'état du site.
   */
  'PAYMENT_DEFAULT_CAUSE',
  /**
   * L10.6B-3 — l'incident de paiement. Appliqué dans une collection LOCALE, en
   * lecture seule, EXACTEMENT comme une prestation : le Panel décide, le
   * Manager affiche. Son applicateur n'appelle jamais le moteur de
   * réconciliation — un incident ne ferme aucun site, seule la cause le fait.
   */
  'PAYMENT_DEFAULT_INCIDENT',
  /**
   * >= 1.10.0 — l'entreprise cliente. Déclarée ET appliquée : son applicateur
   * est branché sur les DEUX chemins (poussée immédiate et rattrapage au
   * tirage), et elle est persistée dans une collection LOCALE en lecture
   * seule. Le Panel décide, le Manager affiche, les gardes s'y fient.
   */
  'CLIENT_COMPANY',
  /**
   * >= 1.14.0 — le document légal résolu. Déclaré ET appliqué : son applicateur
   * est branché sur les DEUX chemins (poussée immédiate et rattrapage au
   * tirage), et le document est persisté dans une collection LOCALE en lecture
   * seule, servie par la route publique du site.
   */
  'LEGAL_DOCUMENT',
]);

/**
 * @deprecated Nom historique conservé pour ne pas casser les appelants
 * existants. `APPLIED_ENTITY_TYPES` est la source de vérité.
 */
export const PHASE1_APPLIED_ENTITY_TYPES = APPLIED_ENTITY_TYPES;

/** Côtés émetteurs d'une écriture. */
export const EMITTERS = Object.freeze({ PANEL: 'PANEL', PROJECT: 'PROJECT' });

/** Statuts d'accusé de réception d'une écriture (SyncAck.status). */
export const ACK_STATUS = Object.freeze({
  APPLIED: 'APPLIED', // appliquée localement
  DUPLICATE: 'DUPLICATE', // writeId déjà vu — idempotence
  IGNORED: 'IGNORED', // perdante LWW ou anti-écho
  REJECTED: 'REJECTED', // invalide / type non supporté (code + message)
});

/**
 * Routes du contrat — miroirs EXACTS des `paths` des fichiers OpenAPI.
 * Le test de conformité vérifie que chaque chemin apparaît dans la spec.
 */
export const PANEL_API_ROUTES = Object.freeze({
  ping: '/bridge/v1/ping',
  bootstrap: '/bridge/v1/pairings',
  unpair: '/bridge/v1/pairings/current',
  heartbeat: '/bridge/v1/heartbeats',
  syncPush: '/bridge/v1/sync/push',
  syncPull: '/bridge/v1/sync/pull',
  /**
   * PASSERELLE DE CAPACITÉS (contrat 1.5.0). `{code}` est substitué à l'appel.
   *
   * Le projet nomme une INTENTION MÉTIER ; il n'apprend jamais quel
   * fournisseur l'exécute, et ne peut choisir ni le monde, ni la clé. C'est le
   * seul chemin par lequel un projet fera un jour agir un tiers sans détenir
   * son credential.
   */
  capabilityInvoke: '/bridge/v1/capabilities/{code}/invoke',
  /**
   * LA PROJECTION AUTORITATIVE DES MODÈLES (1.11.0) — lecture seule.
   *
   * Ce n'est PAS une synchronisation d'entités : le contenu ne se réplique pas,
   * il se consulte. Un projet qui en garderait une copie de travail
   * redeviendrait une seconde autorité — exactement ce que ce lot supprime.
   */
  emailTemplates: '/bridge/v1/email-templates',
  emailTemplate: '/bridge/v1/email-templates/{code}',
  emailTemplatePreview: '/bridge/v1/email-templates/{code}/preview',
  emailTemplateReadiness: '/bridge/v1/email-templates/{code}/readiness',
  emailTemplateTestSend: '/bridge/v1/email-templates/{code}/test-send',
  /**
   * LE SECRET DE VÉRIFICATION DE CE PROJET (L6.3A).
   *
   * Une route à part, et non un champ dans la réponse du provisionnement : le
   * résultat d'une capacité traverse la garde du Panel qui refuse tout
   * identifiant fournisseur. Ce canal-ci ne transporte QUE cela, et le Panel
   * le vérifie avant d'écrire.
   *
   * `{provider}` est substitué à l'appel. Aucun identifiant de projet dans le
   * chemin : celui qui fait autorité est celui du jeton de pont — un projet ne
   * peut donc demander que le sien.
   */
  webhookVerificationSecret: '/bridge/v1/webhooks/{provider}/verification-secret',
  /**
   * L'INTROSPECTION D'IDENTITÉ FÉDÉRÉE (L12.B).
   *
   * Une session développeur fédérée repose sur un compte que ce projet ne
   * possède pas. Ce verbe est le seul moyen d'apprendre qu'il a été fermé —
   * sans lui, couper l'accès exigerait d'éditer la base du projet à la main.
   *
   * Aucun identifiant de projet dans le chemin : celui qui fait autorité est
   * celui du jeton de pont. Un projet ne peut donc demander que pour lui-même.
   */
  federationIntrospect: '/bridge/v1/federation/introspect',
});

export const PROJECT_API_ROUTES = Object.freeze({
  ping: '/api/project-bridge/v1/ping',
  identity: '/api/project-bridge/v1/identity',
  health: '/api/project-bridge/v1/health',
  manifest: '/api/project-bridge/v1/manifest',
  syncPush: '/api/project-bridge/v1/sync/push',
  syncPull: '/api/project-bridge/v1/sync/pull',
  /**
   * LES COMPTES DU PROJET — lecture VIVANTE (contrat 1.6.0).
   *
   * MANQUAIT À CE MIROIR : le Panel la sert et l'appelle depuis des mois, le
   * miroir du Panel la déclare, la spec la documente — seul ce côté l'ignorait.
   * Aucune garde ne comparait ce registre-ci à la spec, et la dérive a vécu.
   */
  accounts: '/api/project-bridge/v1/accounts',
  /**
   * LES ÉCRITURES GARÉES — lecture seule (contrat 1.13.0).
   *
   * Le battement ne porte qu'un COMPTE : c'est ce qu'il faut pour alerter, pas
   * pour agir. Un opérateur qui veut rejouer doit NOMMER l'écriture, et seul le
   * projet sait laquelle il n'a pas su appliquer.
   *
   * Ni charge utile, ni secret : un type, un identifiant, un motif tronqué, des
   * tentatives, des dates. Assez pour décider, rien qui transforme ce canal en
   * second entrepôt de données personnelles.
   */
  deadLetters: '/api/project-bridge/v1/dead-letters',
  operations: '/api/project-bridge/v1/operations',
  invoke: '/api/project-bridge/v1/operations/{operationId}/invoke',
  /**
   * LE DOCUMENT CONTRACTUEL — récupéré, jamais transporté (contrat 1.13.0).
   *
   * ── POURQUOI IL MANQUAIT AUX DEUX MIROIRS ────────────────────────────────
   *
   * Le projet SERT cette route depuis qu'un contrat porte un PDF, et le Panel
   * la CONSOMME pour relayer le document à l'écran. Elle n'était déclarée nulle
   * part : ni dans les registres de chemins, ni dans les specs. La garde qui
   * aurait dû le voir — « miroir ↔ spec : ensembles identiques » — était
   * elle-même en panne, et la dérive a vécu.
   *
   * Le document ne voyage JAMAIS dans la file de synchronisation : un PDF au
   * journal durable serait rejoué à chaque rattrapage, et conservé sans durée
   * de rétention. Le Panel va donc le chercher chez son propriétaire, avec son
   * jeton de pont, au moment où quelqu'un le demande.
   */
  contractDocument: '/api/project-bridge/v1/contracts/{contractId}/document',
  unpair: '/api/project-bridge/v1/unpair',
});

// ---------------------------------------------------------------- schémas zod

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'Version sémantique attendue (ex. 1.0.0)');
const isoDate = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

/** UNE écriture de synchronisation (schéma SyncChange des deux specs). */
export const syncChangeSchema = z
  .object({
    writeId: uuid,
    entityType: z.enum(SYNC_ENTITY_TYPES),
    entityId: uuid,
    deleted: z.boolean(),
    payload: z.unknown().nullable().optional(),
    modifiedAt: isoDate,
    emitter: z.enum([EMITTERS.PANEL, EMITTERS.PROJECT]),
  })
  .strict()
  .superRefine((change, ctx) => {
    // Tombstone : la suppression est une écriture SANS contenu.
    if (change.deleted && change.payload != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload'],
        message: 'Un tombstone (deleted=true) doit porter payload=null.',
      });
    }
  });

export const syncPushRequestSchema = z
  .object({ changes: z.array(syncChangeSchema).min(1).max(500) })
  .strict();

export const syncAckSchema = z
  .object({
    writeId: uuid,
    status: z.enum([
      ACK_STATUS.APPLIED,
      ACK_STATUS.DUPLICATE,
      ACK_STATUS.IGNORED,
      ACK_STATUS.REJECTED,
    ]),
    code: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const syncPushResponseDataSchema = z
  .object({ results: z.array(syncAckSchema) })
  .strict();

export const syncPullResponseDataSchema = z
  .object({
    changes: z.array(syncChangeSchema),
    cursor: z.string(),
    hasMore: z.boolean(),
  })
  .strict();

/**
 * LA MÊME RÉPONSE, MAIS DONT LES ÉCRITURES RESTENT À VALIDER UNE PAR UNE.
 *
 * ══ POURQUOI DEUX SCHÉMAS POUR UNE SEULE RÉPONSE ═══════════════════════════
 *
 * Le curseur et la pagination doivent être valides : sans eux, on ne sait ni où
 * l'on en est, ni s'il reste des pages. Une enveloppe illisible est donc bien
 * une page perdue, et `PULL_FAILED` est la bonne réponse.
 *
 * Les ÉCRITURES, elles, sont indépendantes les unes des autres. Les valider en
 * bloc revenait à faire dépendre trente-huit écritures saines de la
 * trente-neuvième — et une seule entrée malformée a suffi à arrêter tout le
 * rattrapage Panel → projet pendant des semaines, sans erreur visible.
 *
 * Ce schéma laisse donc `changes` en `unknown` : l'appelant valide chaque
 * élément et écarte NOMMÉMENT ce qu'il ne sait pas lire. Le contrat n'est pas
 * assoupli — il est appliqué au bon grain.
 */
export const syncPullEnvelopeSchema = z
  .object({
    changes: z.array(z.unknown()),
    cursor: z.string(),
    hasMore: z.boolean(),
  })
  .strict();

export const heartbeatSchema = z
  .object({
    sentAt: isoDate,
    softwareVersion: z.string().min(1),
    environment: z.enum(['TEST', 'PROD']),
    health: z
      .object({
        status: z.enum(['OK', 'DEGRADED']),
        details: z.string().nullable().optional(),
      })
      .strict(),
    bridgeStats: z
      .object({
        outboxSize: z.number().int().min(0),
        lastSyncAt: isoDate.nullable().optional(),
        /**
         * ── CE QUE « CONNECTÉ » NE DISAIT PAS (>= 1.4.x, ADDITIF) ───────────
         *
         * Une instance dont toutes les écritures métier sont REFUSÉES bat
         * parfaitement : le battement prouve qu'on répond, jamais qu'on livre.
         * Le Panel affichait donc une fiche verte devant une donnée figée
         * depuis des semaines, sans aucun moyen de l'apprendre.
         *
         * Ces deux champs portent le fait manquant. Ils ne transportent ni
         * charge utile, ni secret : un compte, un code, une date.
         *
         * Optionnels : un projet antérieur reste pleinement conforme, et son
         * silence ne vaut pas « aucun refus » — seulement « ne sait pas dire ».
         */
        rejectedCount: z.number().int().min(0).optional(),
        oldestRejection: z
          .object({
            entityType: z.string().min(1),
            failureClass: z.string().min(1).nullable().optional(),
            code: z.string().min(1).nullable().optional(),
            since: isoDate.nullable().optional(),
            rejections: z.number().int().min(0).optional(),
          })
          .strict()
          .optional(),
        /**
         * ── CE QUE CE PONT CONSOMME (>= 1.10.0, ADDITIF) ───────────────────
         *
         * ══ LE DÉFAUT QUE CE BLOC FERME ═══════════════════════════════════
         *
         * Tout ce qui précède décrit la file SORTANTE. Le tirage de ce projet
         * est resté mort pendant 91 cycles — `applied: 0`, `lastError: null`,
         * `state: DEGRADED` — avec une file sortante parfaitement vide et un
         * battement régulier. Rien n'en parvenait au Panel, et rien ne pouvait
         * y parvenir : aucun champ ne décrivait la descente.
         *
         * Ces compteurs la décrivent. Le signal maître est
         * `lastCursorAdvanceAt` : un curseur qui n'avance plus est un tirage
         * mort, qu'il y ait eu des erreurs ou non.
         *
         * Aucune charge utile, aucun secret : des compteurs, des dates, et un
         * curseur opaque que le Panel a lui-même émis.
         */
        consumption: z
          .object({
            cursor: z.string().nullable().optional(),
            lastCursorAdvanceAt: isoDate.nullable().optional(),
            lastSuccessfulApplyAt: isoDate.nullable().optional(),
            consecutivePullFailures: z.number().int().min(0).optional(),
            consecutiveUnreadableChanges: z.number().int().min(0).optional(),
            /**
             * COMBIEN D'ÉCRITURES LE PROJET A RENONCÉ À APPLIQUER (>= 1.12.0).
             *
             * Une écriture garée est passée SOUS le curseur : le calcul de
             * retard ne la verra jamais. Sans ce compte, renoncer proprement
             * redeviendrait perdre en silence.
             */
            parkedChanges: z.number().int().min(0).optional(),
            lastParkedAt: isoDate.nullable().optional(),
            appliedTotal: z.number().int().min(0).optional(),
            /**
             * CE QUI RETIENT LE CURSEUR (>= 1.15.0) — le champ qui empêche
             * « synchronisé » de mentir.
             *
             * ══ L'INCIDENT QUI L'A RENDU NÉCESSAIRE ═════════════════════════
             *
             * Le Panel est monté en 1.14.0 et a publié LEGAL_DOCUMENT vers des
             * projets encore en 1.13.0. Ils ont SAUTÉ le type inconnu et leur
             * curseur a dépassé les écritures : les documents étaient réputés
             * consommés alors qu'ils n'existaient nulle part. Le Panel voyait un
             * retard nul et une fiche verte.
             *
             * Un consommateur retenu déclare désormais CE QUI le retient. Le
             * Panel en tire « projet incompatible — mise à niveau requise »,
             * plutôt qu'un vert trompeur.
             *
             * Aucune charge utile : un type, une identité, un motif, des dates.
             * OPTIONNEL — un projet antérieur ne l'envoie pas, et son absence se
             * lit « rien ne bloque », ce qui est vrai pour lui : son runtime ne
             * sait pas retenir.
             */
            blocked: z
              .object({
                entityType: z.string().min(1).max(60).nullable().optional(),
                entityId: z.string().min(1).max(120).nullable().optional(),
                writeId: z.string().min(1).max(120).nullable().optional(),
                reason: z.string().min(1).max(60).nullable().optional(),
                contractVersion: z.string().min(1).max(20).nullable().optional(),
                since: isoDate.nullable().optional(),
                lastSeenAt: isoDate.nullable().optional(),
                attempts: z.number().int().min(0).optional(),
              })
              .strict()
              .nullable()
              .optional(),
            state: z.string().min(1).max(40).nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    // Contrat >= 1.2.0 — SUPERVISION EN LECTURE SEULE. Tous optionnels : un
    // projet qui ne les publie pas reste pleinement conforme.
    runtime: z
      .object({
        uptimeSeconds: z.number().int().min(0).optional(),
        startedAt: isoDate.nullable().optional(),
        load: z
          .object({
            cpuPercent: z.number().min(0).optional(),
            memoryUsedMb: z.number().min(0).optional(),
            memoryTotalMb: z.number().min(0).optional(),
          })
          .strict()
          .optional(),
        components: z.record(z.string().min(1), z.enum(['OK', 'WARNING', 'ERROR', 'UNKNOWN'])).optional(),
        /**
         * ══ >= 1.9.0, ADDITIF — LE RÉSEAU QUE CE PROJET SERT MAINTENANT ═════
         *
         * ── LE DÉFAUT QUE CE CHAMP FERME ──────────────────────────────────
         *
         * Le Panel posait `runtime.publicBackendUrl` au bootstrap et ne la
         * relisait plus jamais. Après une migration de domaine, sa fiche
         * annonçait donc une adresse morte — constaté en recette :
         * `api.demo-sbauto.lycarz.com` conservée des semaines après le passage
         * à `api.demo-sbauto06.ly-solution.com`. La corriger imposait de
         * RÉAPPAIRER, c'est-à-dire de casser une relation de confiance pour
         * rafraîchir une donnée d'exploitation.
         *
         * Le battement était le seul canal qui parle en permanence, et il ne
         * transportait aucune adresse.
         *
         * ── L'AUTORITÉ EST `SystemConfiguration.network`, ET ELLE SEULE ────
         *
         * Ce que ce projet publie ici est ce qu'il UTILISE réellement : la
         * configuration réseau appliquée par son propre déploiement. Jamais
         * `APP_URL`, jamais une valeur recomposée, jamais `localhost`. Un
         * champ vide s'OMET — le Panel doit distinguer « non configuré » d'une
         * adresse fausse, et conserve alors ce qu'il savait.
         *
         * ── POURQUOI PAS UNE ENTITÉ DE SYNCHRONISATION ────────────────────
         *
         * `PROJECT_PRESENTATION.network` porte déjà ces adresses et reste
         * l'autorité ARBITRÉE (LWW, anti-écho, file durable). Elle n'est pas
         * remplacée. Mais une projection ne part que lorsque l'état CHANGE :
         * un réseau stable n'émet plus rien, et une projection perdue ou
         * refusée n'est jamais rejouée. Le battement, lui, RÉPÈTE — c'est ce
         * qu'on attend d'une donnée de liveness.
         */
        network: z
          .object({
            /** L'API publique — celle que le Panel doit appeler. */
            publicBackendUrl: z.string().url().nullable().optional(),
            /** Le site public — celui que le client consulte. */
            publicSiteUrl: z.string().url().nullable().optional(),
            /** L'espace de gestion du client. */
            managerUrl: z.string().url().nullable().optional(),
            /** L'horloge de CE projet — informative ; le Panel arbitre. */
            declaredAt: isoDate.nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    engines: z
      .object({
        deployment: semver.optional(),
        duplication: semver.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * MANIFESTE OFFICIEL DU PROJET (contrat ≥ 1.1.0) — la carte d'identité
 * complète que le Panel LIT au lieu de déduire : projet, pont, contrats
 * parlés, capacités de synchronisation, modules installés, fonctionnalités.
 * Servi par GET /manifest (ProjectBridge) et joint (optionnellement) au
 * bootstrap. Déclaratif : la source est un registre code-first côté projet
 * (services/projectBridge/projectManifest.js) — jamais une déduction.
 */
/**
 * DESCRIPTEUR MÉDIA CANONIQUE (>= 1.5.0, ADDITIF) — miroir exact du Panel.
 *
 * Le pont ne transportait qu'une URL. Ce projet ne pouvait donc savoir ni si
 * l'image avait changé (aucune empreinte), ni son type réel, ni ses
 * dimensions, ni si la projection reçue était plus récente que celle déjà
 * appliquée : il ne pouvait que recharger l'adresse et espérer.
 *
 * Le descripteur ACCOMPAGNE `logoUrl` / `photoUrl` / `faviconUrl` — il ne les
 * remplace pas. Un Panel antérieur ne l'envoie pas, et rien ne casse.
 *
 * `null` est une valeur SIGNIFIANTE : elle publie la SUPPRESSION du média.
 */
export const mediaDescriptorSchema = z
  .object({
    /**
     * QUI DÉTIENT CE MÉDIA — ADDITIF, déclaré, jamais déduit.
     *
     * ── LE DÉFAUT QUE CE CHAMP FERME ──────────────────────────────────────
     * Les deux côtés du pont décrivaient leurs médias de la même façon : clé
     * d'objet, empreinte, dimensions. Le lecteur concluait donc « média du
     * projet » sur la simple présence d'une clé, et recomposait l'adresse
     * contre le domaine du CLIENT. Le logo du développeur, servi par le Panel,
     * devenait `https://<client>/uploads/<clé du Panel>` — un 404.
     *
     * `PANEL` : le média reste sur le Panel et garde l'adresse qu'il publie.
     * `PROJECT` : le média suit la destination active du projet.
     *
     * Optionnel pour la LECTURE des projections antérieures — l'autorité leur
     * est alors donnée par le schéma du champ qui les porte. Toute émission
     * nouvelle le renseigne.
     */
    authority: z.enum(['PANEL', 'PROJECT']).nullable().optional(),
    mediaId: z.string().nullable().optional(),
    url: z.string().url(),
    mime: z.string().nullable().optional(),
    size: z.number().int().nonnegative().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    sha256: z.string().nullable().optional(),
    version: z.number().int().nonnegative().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    /**
     * Servi par une destination ACTIVE — relevé sur le serveur, jamais déduit.
     * Un descripteur `LOCAL_ONLY` décrit un média qui existe, mais que
     * personne d'autre ne peut encore atteindre.
     */
    publicationState: z.enum(['LOCAL_ONLY', 'PUBLISHED']).nullable().optional(),
    external: z.boolean().optional(),
  })
  .passthrough();

export const projectManifestSchema = z
  .object({
    manifestVersion: semver,
    project: z
      .object({
        key: z.string().min(3).max(120),
        name: z.string().min(1),
        environment: z.enum(['TEST', 'PROD']),
        softwareVersion: z.string().min(1),
      })
      .strict(),
    bridge: z
      .object({
        contractVersion: semver,
        projectBridgeBasePath: z.string().min(1),
      })
      .strict(),
    contracts: z
      .object({ panelBridge: semver, projectBridge: semver })
      .strict(),
    sync: z
      .object({
        supportedEntityTypes: z.array(z.enum(SYNC_ENTITY_TYPES)),
        operations: z.array(z.string()),
      })
      .strict(),
    modules: z.array(
      z
        .object({
          id: z.string().min(1),
          title: z.string().min(1),
          status: z.enum(['ACTIVE', 'OPTIONAL']),
        })
        .strict()
    ),
    features: z.array(
      z
        .object({
          id: z.string().min(1),
          status: z.enum(['AVAILABLE', 'RESERVED']),
        })
        .strict()
    ),
    // Contrat >= 1.2.0 — supervision en lecture seule : tous optionnels.
    engines: z
      .object({ deployment: semver.optional(), duplication: semver.optional() })
      .strict()
      .optional(),
    network: z
      .object({
        primaryDomain: z.string().nullable().optional(),
        urls: z.record(z.string().min(1), z.string()).optional(),
      })
      .strict()
      .optional(),
    // PRÉSENTATION (>= 1.4.x, ADDITIF) — l'identité COMMERCIALE du projet.
    // Sans elle, le Panel affichait le nom technique du projet et l'URL de son
    // API comme s'il s'agissait du client et de son site. Tous les champs sont
    // optionnels : un projet qui ne publie rien reste pleinement conforme, et
    // l'absence se distingue d'une valeur vide.
    //
    // `logoUrl` / `faviconUrl` sont TOUJOURS des URL absolues joignables : le
    // projet résout lui-même ses chemins locaux contre son domaine public (voir
    // docs/panelXvitrine/MEDIAS_PUBLICS.md). Le Panel ne copie aucun fichier.
    presentation: z
      .object({
        companyName: z.string().min(1).optional(),
        tagline: z.string().min(1).optional(),
        logoUrl: z.string().url().optional(),
        faviconUrl: z.string().url().optional(),
        /**
         * ADDITIF — le descripteur complet, à côté de l'URL historique.
         * Le Panel en publiait déjà ; le projet, non. Le Bridge était
         * asymétrique : deux instances du même contrat ne disaient pas la
         * même chose du même objet.
         */
        logo: mediaDescriptorSchema.optional(),
        favicon: mediaDescriptorSchema.optional(),
        contacts: z
          .object({
            email: z.string().min(1).optional(),
            phone: z.string().min(1).optional(),
            website: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    descriptor: z
      .object({
        // Nom LISIBLE du projet, tel qu'il se nomme (>= 1.4.x).
        name: z.string().min(1).optional(),
        type: z.string().optional(),
        description: z.string().optional(),
        layout: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const bootstrapRequestSchema = z
  .object({
    contractVersion: semver,
    projectKey: z.string().min(3).max(120),
    projectName: z.string().min(1),
    environment: z.enum(['TEST', 'PROD']),
    softwareVersion: z.string().min(1),
    publicBackendUrl: z.string().url().nullable().optional(),
    pairingCode: z.string().min(1),
    // ≥ 1.1.0, OPTIONNEL (compatibilité ascendante) : le projet se présente
    // complètement dès l'appairage — le Panel n'a rien à déduire.
    manifest: projectManifestSchema.optional(),
  })
  .strict();

// ------------------------------------------------- découverte (>= 1.3.0) ----
// Ce que le Panel joint au bootstrap. Le projet le REÇOIT : ces schémas sont
// donc de vraies gardes d'entrée. Tolérants (`passthrough`) car un Panel plus
// récent peut en dire davantage, et refuser un appairage pour un champ
// inconnu contredirait la règle d'évolution additive.

export const companyProfileSchema = z
  .object({
    companyId: uuid,
    slug: z.string().min(2),
    environment: z.enum(['TEST', 'PROD']),
    version: z.number().int().positive().optional(),
    identity: z.object({
      name: z.string().min(1),
      legalName: z.string().nullable().optional(),
      tagline: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    }),
    branding: z.record(z.unknown()).optional(),
    domains: z.record(z.unknown()).optional(),
    contacts: z.record(z.unknown()).optional(),
    legal: z.record(z.unknown()).optional(),
    settings: z.record(z.unknown()).optional(),
    // ADDITIF : un Panel antérieur ne les envoie pas, et rien ne casse. Le
    // Panel est désormais l'autorité de l'identité développeur.
    signer: z.record(z.unknown()).nullable().optional(),
    references: z.array(z.record(z.unknown())).optional(),
    // L'ÉQUIPE — additive elle aussi. Un Panel antérieur ne l'envoie pas, et
    // le projet affiche alors une équipe vide : une information manquante,
    // jamais une équipe inventée.
    team: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

/**
 * L'ENTREPRISE CLIENTE TELLE QUE LE PANEL LA PUBLIE (>= 1.10.0).
 *
 * ══ POURQUOI UNE GARDE D'ENTRÉE, ET PAS UN `record` PERMISSIF ══════════════
 *
 * Parce que ce que ce schéma laisse passer FINIT DEVANT LE CLIENT — la page
 * « Mon entreprise » — et DÉCIDE de ce que ce projet s'autorise : un paiement,
 * une signature. Une charge utile mal formée doit être écartée nommément, pas
 * appliquée à moitié.
 *
 * ══ TOLÉRANT SUR CE QU'IL NE CONNAÎT PAS ══════════════════════════════════
 *
 * `.passthrough()`, comme les autres schémas de DESCENTE : un Panel plus
 * récent peut publier davantage, et refuser l'entité entière pour un champ
 * inconnu contredirait la règle d'évolution additive. Ce qui est EXIGÉ, c'est
 * le strict minimum sans lequel l'écran n'a rien à montrer : un identifiant,
 * un monde, une raison sociale.
 *
 * ══ AUCUNE RÈGLE MÉTIER ICI ═══════════════════════════════════════════════
 *
 * Ni « le SIREN doit faire neuf chiffres », ni « l'adresse doit être
 * complète ». Ces règles appartiennent au Panel, qui est l'autorité de la
 * saisie, et les redire ici les ferait diverger au premier changement de
 * mention obligatoire. Le projet reçoit le VERDICT (`readiness`) et l'affiche.
 */
export const clientCompanyProfileSchema = z
  .object({
    clientCompanyId: z.string().min(1),
    version: z.number().int().min(0).optional(),
    environment: z.enum(['TEST', 'PROD']),
    status: z.string().min(1).optional(),

    legalName: z.string().min(1),
    tradingName: z.string().nullable().optional(),
    legalForm: z.string().nullable().optional(),
    siren: z.string().nullable().optional(),
    siret: z.string().nullable().optional(),
    vatNumber: z.string().nullable().optional(),
    registrationCity: z.string().nullable().optional(),

    registeredOffice: z.record(z.unknown()).nullable().optional(),
    billingAddress: z.record(z.unknown()).nullable().optional(),

    billingEmail: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    website: z.string().nullable().optional(),

    contractualSigner: z.record(z.unknown()).nullable().optional(),
    /**
     * LE VERDICT DE COMPLÉTUDE, calculé par le Panel.
     *
     * Le projet POURRAIT le recalculer — il a tous les champs. Il ne doit pas :
     * la complétude est une décision de FACTURATION, elle appartient à
     * l'émetteur des factures, et deux implémentations divergeraient. Le projet
     * s'y fie pour peindre ses écrans ; le refus autoritatif, lui, reste côté
     * Panel, au point d'usage.
     */
    readiness: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();

/**
 * UN DOCUMENT LÉGAL RÉSOLU (1.14.0) — ce que ce projet ACCEPTE de recevoir.
 *
 * ══ POURQUOI CE SCHÉMA EST FERMÉ ALORS QUE SES VOISINS SONT OUVERTS ═══════
 *
 * `companyProfileSchema` et `clientCompanyProfileSchema` sont `passthrough()` :
 * ils décrivent des IDENTITÉS que le Panel peut enrichir, et refuser un champ
 * inconnu ferait échouer tout le parc à la première addition. Le compromis y
 * est bon, parce que les champs inconnus sont simplement ignorés à la lecture.
 *
 * Ici, la charge utile n'est pas une identité mais un CONTENU À RENDRE. Un
 * champ inconnu voudrait dire que le Panel envoie une forme de bloc que ce
 * projet ne sait pas afficher — et l'ignorer produirait une page où un
 * paragraphe manque, sans que rien ne le signale. Sur des mentions légales,
 * une omission silencieuse est le pire résultat possible : mieux vaut refuser
 * l'écriture, garder le document précédent, et que l'incident se voie
 * (`CHANGE_UNREADABLE`).
 *
 * ══ AUCUNE RÈGLE MÉTIER ICI ══════════════════════════════════════════════
 *
 * Ni « une section doit avoir un titre », ni « le SIRET doit apparaître ». La
 * composition du document appartient au Panel, qui est l'autorité du contenu.
 * Ce schéma ne vérifie que la FORME de ce qui arrive.
 */
export const legalDocumentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PARAGRAPH'), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal('LIST'), items: z.array(z.string().min(1)).min(1) }).strict(),
  z
    .object({
      type: z.literal('FIELDS'),
      items: z
        .array(z.object({ label: z.string().min(1), value: z.string().min(1) }).strict())
        .min(1),
    })
    .strict(),
]);

export const legalDocumentPayloadSchema = z
  .object({
    type: z.enum(['LEGAL_NOTICE', 'PRIVACY_POLICY']),
    /**
     * LE PROJET DESTINATAIRE — vérifié contre notre propre identité.
     *
     * L'audience de l'écriture décide déjà de qui reçoit quoi, et c'est la
     * barrière qui compte. Celle-ci est une VÉRIFICATION CROISÉE, tenue par
     * l'autre côté : un document qui ne nous nomme pas est REFUSÉ. Une erreur
     * d'audience devient ainsi un refus bruyant au lieu d'un affichage
     * silencieux des mentions légales d'un autre client.
     */
    projectId: uuid,
    templateId: z.string().min(1),
    templateName: z.string().min(1),
    templateVersion: z.number().int().min(0),
    /** Compteur PAR PROJET — la seule base valide de la garde de version. */
    documentVersion: z.number().int().positive(),
    environment: z.enum(['TEST', 'PROD']),
    title: z.string().min(1),
    sections: z
      .array(
        z
          .object({ heading: z.string(), blocks: z.array(legalDocumentBlockSchema).min(1) })
          .strict(),
      )
      .min(1),
    updatedAt: z.string().nullable().optional(),
  })
  .strict();

export const integratedApiConfigSchema = z
  .object({
    apiId: uuid,
    key: z.string().min(1),
    label: z.string().optional(),
    provider: z.string().min(1),
    category: z.string().optional(),
    enabled: z.boolean().optional(),
    mode: z.enum(['TEST', 'PROD']),
    settings: z.record(z.unknown()).optional(),
    credentials: z.record(z.string()),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export const bootstrapResponseDataSchema = z
  .object({
    projectId: uuid,
    bridgeToken: z.string().min(16),
    /**
     * ══ `passthrough()`, ET C'EST UNE LECON PAYEE ═════════════════════════
     *
     * Cet objet etait `strict()` alors que la racine est `passthrough()`. La
     * racine avait raison, et son commentaire le disait deja : « le bootstrap
     * est le point d'entree d'un Panel potentiellement plus recent ; refuser
     * une reponse pour un champ inconnu rendrait toute evolution additive
     * impossible cote Panel ».
     *
     * La meme phrase valait ici, et `strict()` la contredisait : un Panel qui
     * aurait enrichi `panel` d'un champ — son adresse publique, par exemple —
     * aurait fait ECHOUER le bootstrap de TOUS les projets deja deployes. Une
     * evolution additive devenue une panne de parc, par un mot.
     *
     * La correction qui a revele le piege a donc pose son champ A LA RACINE
     * (`panelFrontendUrl`) plutot que de l'attendre ici. Ce relachement rend
     * la prochaine addition possible au bon endroit.
     */
    panel: z
      .object({ name: z.string().min(1), contractVersion: semver })
      .passthrough(),
    // >= 1.3.0 — optionnels : un Panel 1.2.x reste pleinement conforme.
    company: companyProfileSchema.nullable().optional(),
    integratedApis: z.array(integratedApiConfigSchema).optional(),
    syncCursor: z.string().nullable().optional(),
  })
  // Plus de `.strict()` : le bootstrap est le point d'entrée d'un Panel
  // potentiellement plus récent. Refuser une réponse pour un champ inconnu
  // rendrait toute évolution additive impossible côté Panel.
  .passthrough();

/** Ce que le projet déclare avoir appliqué (ProjectBridge >= 1.3.0). */
export const appliedConfigurationSchema = z
  .object({
    companyId: z.string().nullable().optional(),
    companySlug: z.string().nullable().optional(),
    companyVersion: z.number().int().nullable().optional(),
    companyAppliedAt: z.string().nullable().optional(),
    integratedApiCount: z.number().int().min(0).optional(),
    integratedApiKeys: z.array(z.string()).optional(),
    lastSyncAt: z.string().nullable().optional(),
  })
  .strict();

export const identitySchema = z
  .object({
    projectKey: z.string().min(3).max(120),
    projectName: z.string().min(1),
    environment: z.enum(['TEST', 'PROD']),
    softwareVersion: z.string().min(1),
    contractVersion: semver,
    // >= 1.3.0 — convergence : sans cela, le Panel ne saurait que ce qu'il a
    // ÉMIS, jamais ce qui a pris effet.
    appliedConfiguration: appliedConfigurationSchema.nullable().optional(),
  })
  .strict();

export const operationInvocationSchema = z
  .object({ invocationId: uuid, params: z.record(z.unknown()) })
  .strict();

// ------------------------------------------------------------------- helpers

/** Nouveau writeId / entityId / invocationId (UUID v4). */
export const newBridgeId = () => randomUUID();

/** Horodatage ISO courant (posé par l'émetteur — règle LWW n°1). */
export const nowIso = () => new Date().toISOString();

/**
 * Valide une valeur contre un schéma du contrat. Toute non-conformité devient
 * une BridgeError BRIDGE_INVALID_PAYLOAD (HTTP 400) portant les chemins fautifs
 * — jamais une ZodError brute qui fuiterait hors du module.
 */
export function parseOrThrow(schema, value, label) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.errors.map((e) => ({
    path: Array.isArray(e.path) ? e.path.join('.') : String(e.path ?? ''),
    message: e.message,
  }));
  throw bridgeError(
    BRIDGE_ERROR_CODES.INVALID_PAYLOAD,
    `Payload non conforme au contrat (${label}).`,
    { issues }
  );
}

/**
 * Deux versions sont compatibles si (et seulement si) leur MAJEURE est égale.
 *
 * La valeur est ROGNÉE avant analyse : elle arrive d'un en-tête HTTP, où un
 * espace de bordure est légal et sémantiquement nul (RFC 9110 §5.5). Ne pas
 * le rogner ferait dépendre l'appairage du client HTTP employé. Miroir exact
 * de la fonction homonyme du Panel.
 */
export function isContractCompatible(version) {
  if (typeof version !== 'string') return false;
  const value = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(value)) return false;
  return value.split('.')[0] === CONTRACT_VERSION.split('.')[0];
}

/** Refus propre d'une majeure inconnue (409 — jamais deviner). */
export function assertContractCompatible(version) {
  if (isContractCompatible(version)) return;
  throw bridgeError(
    BRIDGE_ERROR_CODES.CONTRACT_VERSION_UNSUPPORTED,
    `Version majeure du contrat non supportée (reçu : ${version ?? 'aucune'}, attendu : ${CONTRACT_VERSION}).`
  );
}

/**
 * Fabrique une écriture DIAGNOSTIC (seul type appliqué en Phase 1) — utilisée
 * par les tests et par la future page « Connexion Panel » pour prouver le
 * canal de bout en bout sans toucher au métier.
 */
export function buildDiagnosticChange({ emitter, payload = { ping: true }, entityId } = {}) {
  return parseOrThrow(
    syncChangeSchema,
    {
      writeId: newBridgeId(),
      entityType: 'DIAGNOSTIC',
      entityId: entityId || newBridgeId(),
      deleted: false,
      payload,
      modifiedAt: nowIso(),
      emitter,
    },
    'SyncChange'
  );
}

/**
 * Exemples canoniques de DTO valides — consommés par le test de conformité
 * (chaque exemple DOIT valider contre son schéma ; un contrat qui ne valide
 * plus ses propres exemples est cassé).
 */
export const CONTRACT_EXAMPLES = Object.freeze({
  syncChange: {
    writeId: '3f2f1a10-6a58-4c8e-9d3a-1c2b3d4e5f60',
    entityType: 'DIAGNOSTIC',
    entityId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    deleted: false,
    payload: { ping: true },
    modifiedAt: '2026-07-26T12:00:00.000Z',
    emitter: 'PROJECT',
  },
  tombstone: {
    writeId: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d',
    entityType: 'DIAGNOSTIC',
    entityId: '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
    deleted: true,
    payload: null,
    modifiedAt: '2026-07-26T12:05:00.000Z',
    emitter: 'PANEL',
  },
  heartbeat: {
    sentAt: '2026-07-26T12:00:00.000Z',
    softwareVersion: 'abc1234',
    environment: 'TEST',
    health: { status: 'OK' },
    bridgeStats: { outboxSize: 0, lastSyncAt: null },
  },
  bootstrapRequest: {
    contractVersion: CONTRACT_VERSION,
    projectKey: 'sb-auto-06',
    projectName: 'SB Auto 06',
    environment: 'TEST',
    softwareVersion: 'abc1234',
    publicBackendUrl: null,
    pairingCode: 'PAIR-OK',
  },
  identity: {
    projectKey: 'sb-auto-06',
    projectName: 'SB Auto 06',
    environment: 'TEST',
    softwareVersion: 'abc1234',
    contractVersion: CONTRACT_VERSION,
  },
  operationInvocation: {
    invocationId: '7c6d5e4f-3a2b-4c1d-9e8f-7a6b5c4d3e2f',
    params: {},
  },
  projectManifest: {
    manifestVersion: MANIFEST_FORMAT_VERSION,
    project: {
      key: 'sb-auto-06',
      name: 'SB Auto 06',
      environment: 'TEST',
      softwareVersion: 'abc1234',
    },
    bridge: {
      contractVersion: CONTRACT_VERSION,
      projectBridgeBasePath: '/api/project-bridge/v1',
    },
    contracts: { panelBridge: CONTRACT_VERSION, projectBridge: CONTRACT_VERSION },
    sync: { supportedEntityTypes: ['DIAGNOSTIC'], operations: [] },
    modules: [
      { id: 'vitrine', title: 'Site vitrine public', status: 'ACTIVE' },
      { id: 'deployment-engine', title: 'Moteur de déploiement', status: 'ACTIVE' },
    ],
    features: [{ id: 'sync.diagnostic', status: 'AVAILABLE' }],
  },
});
