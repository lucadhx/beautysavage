import crypto from 'node:crypto';
import { EmailDelivery } from '../../models/EmailDelivery.model.js';
/**
 * LA SEULE PORTE VERS LE PANEL — façade `capabilityClient`, jamais le
 * runtime du pont. `bridge-conformity` interdit au métier d'atteindre le
 * mécanisme (appairage, file, transport) : on demande un verbe, rien de plus.
 */
import { invokeCapability, capabilitiesAvailable } from '../panelBridge/capabilityClient.js';
// R10.5B — plus aucune lecture de l'expéditeur local : il n'y en a plus.
// L'expéditeur utilisé est celui que le Panel rend dans la sortie de la capacité.
import { normalizeProviderMessageId } from '../../utils/providerMessageId.js';
import { getEmailReadiness } from './emailReadiness.service.js';
import { validateProvidedVariables } from './emailTemplateContract.service.js';
import { maskEmail, safeErrorMessage } from '../../utils/eventPayloadSafety.js';
import { logger } from '../../utils/logger.js';
import {
  DELIVERY_STATUS,
  EMAIL_DELIVERY_ERROR_CODES as D,
} from '../../utils/emailTemplateConstants.js';

/**
 * Envoi d'un template à UN destinataire, et journalisation de ce qui s'est passé.
 *
 * ═══ LE SEUL CHEMIN VERS BREVO ═══════════════════════════════════════════════
 *
 * Aucune route, aucun handler, aucun script n'appelle `BrevoEmailProvider`
 * directement. Tout passe par ici, et donc par `getEmailReadiness()`. C'est cette
 * unicité qui rend la garantie vérifiable : un expéditeur non vérifié ne peut pas
 * produire un envoi par un chemin qu'on aurait oublié de protéger.
 *
 * ═══ IDEMPOTENCE : CE QUI EST GARANTI, ET CE QUI NE PEUT PAS L'ÊTRE ══════════
 *
 * L'index unique partiel sur `actionExecutionId` garantit UNE livraison par
 * exécution. Trois situations, trois traitements :
 *
 *  ── SENT ────────────────────────────────────────────────────────────────────
 *  L'e-mail est parti et Brevo l'a confirmé. On renvoie le résultat existant sans
 *  rien faire. C'est la garantie forte : un retry du dispatcher, une reprise au
 *  démarrage, deux workers en concurrence — aucun ne renverra cet e-mail.
 *
 *  ── SENDING (la fenêtre de crash) ───────────────────────────────────────────
 *  Le processus est mort entre l'appel à Brevo et l'écriture du résultat. On ne
 *  peut PAS savoir si l'e-mail est parti : Brevo n'expose aucune clé
 *  d'idempotence sur `/smtp/email` (contrairement à Stripe), et rien ne permet de
 *  rejouer la question.
 *
 *  DÉCISION : on ne renvoie PAS automatiquement. La livraison passe en FAILED,
 *  non retryable, avec un code lisible — donc DEAD_LETTER côté dispatcher, donc
 *  visible. Un humain tranche.
 *
 *  POURQUOI : les deux erreurs ne se valent pas. Un doublon est irréversible et
 *  arrive chez un client ; une notification manquante est réparable d'un clic, et
 *  elle est SIGNALÉE. La consigne « aucun double envoi » impose ce sens-là. Le
 *  jour où Brevo exposera une clé d'idempotence, ce compromis disparaîtra.
 *
 *  ── FAILED / BLOCKED ────────────────────────────────────────────────────────
 *  Rien n'est parti (ou un humain a décidé de reprendre) : on réessaie sur la
 *  MÊME livraison, en incrémentant `attempts`. Le journal garde une ligne par
 *  destinataire, pas une par tentative.
 */

/** Résultat canonique — la seule forme que les appelants connaissent. */
function result(delivery, { alreadySent = false } = {}) {
  return {
    deliveryId: delivery.deliveryId,
    status: delivery.status,
    providerMessageId: delivery.providerMessageId || null,
    templateId: delivery.templateId,
    templateVersion: delivery.templateVersion,
    providerMode: delivery.providerMode,
    attempts: delivery.attempts,
    alreadySent,
  };
}

/** Erreur d'envoi normalisée. `retryable` pilote la décision du dispatcher. */
export class EmailDeliveryError extends Error {
  constructor(code, message, { retryable = false, deliveryId = null, details = [] } = {}) {
    super(message);
    this.name = 'EmailDeliveryError';
    this.code = code;
    this.retryable = retryable;
    this.deliveryId = deliveryId;
    this.details = details;
  }
}

/**
 * Crée la livraison, ou récupère celle de cette exécution.
 *
 * `upsert` sur `actionExecutionId` : atomique, donc deux workers concurrents
 * obtiennent le MÊME document — c'est l'index qui tranche, pas une lecture suivie
 * d'une écriture qui perdrait la course.
 *
 * Sans `actionExecutionId` (envoi de test DEV), chaque appel crée une livraison :
 * c'est voulu, un test est justement une action qu'on veut pouvoir répéter.
 */
async function createOrGetDelivery({ templateId, templateVersion, providerMode, sender, recipient, subjectSnapshot, eventId, actionExecutionId }) {
  const base = {
    templateId,
    templateVersion,
    provider: 'BREVO',
    providerMode,
    sender: { name: sender.name, emailMasked: maskEmail(sender.email) },
    recipientKey: recipient.key,
    recipientEmailMasked: maskEmail(recipient.email),
    subjectSnapshot,
    eventId: eventId || null,
  };

  if (!actionExecutionId) {
    return EmailDelivery.create({ ...base, deliveryId: crypto.randomUUID(), status: DELIVERY_STATUS.PENDING });
  }

  return EmailDelivery.findOneAndUpdate(
    { actionExecutionId },
    {
      $setOnInsert: {
        ...base,
        actionExecutionId,
        deliveryId: crypto.randomUUID(),
        status: DELIVERY_STATUS.PENDING,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Envoie un template à un destinataire.
 *
 * @param {object} input
 * @param {string} input.templateId
 * @param {{email:string, name?:string, key:string}} input.recipient
 * @param {Map|object} input.variables
 * @param {string} [input.eventId]
 * @param {string} [input.actionExecutionId] Présent ⇒ idempotence garantie.
 * @returns {Promise<object>} résultat canonique
 * @throws {EmailDeliveryError}
 */
/**
 * Variables du projet → forme acceptée par la capacité.
 *
 * Le schéma de la passerelle accepte des chaînes, des nombres, des booléens —
 * et, depuis qu'il a été corrigé, un MONTANT sous sa forme complète. Une `Map`
 * mongoose ou une `Date` traverseraient en `{}` silencieusement, et le modèle
 * rendu par le Panel afficherait un trou. On convertit ici, une fois, plutôt
 * que de découvrir le trou dans la boîte d'un destinataire.
 *
 * ══ UN MONTANT N'EST PAS UN OBJET QUELCONQUE ════════════════════════════════
 *
 * ── LE DÉFAUT FERMÉ ICI ───────────────────────────────────────────────────
 *
 * Cette fonction datait d'un contrat d'entrée qui n'admettait QUE des
 * scalaires : tout objet finissait donc en `String(valeur)`, c'est-à-dire en
 * « [object Object] ». Le contrat de la passerelle a ensuite été élargi pour
 * accepter `{ amount, currency }` — parce que le RENDU, lui, l'attendait
 * depuis toujours, « sans quoi un montant en USD s'afficherait avec € ».
 *
 * Les deux côtés du Panel ont été mis d'accord ; ce côté-ci ne l'a jamais été.
 * Un montant partait donc en `"[object Object]"`, traversait le schéma sans
 * broncher (c'est une chaîne valide), et échouait au RENDU sur « montant non
 * numérique » — que le projet recevait sous la forme opaque
 * `CAPABILITY_INPUT_INVALID`.
 *
 * Ce que cela cassait, concrètement : TOUS les e-mails de facturation du
 * client — paiement reçu, impayé, dernier avertissement, régularisation.
 * Aucun n'a jamais pu partir, et aucun test ne le voyait : les suites
 * vérifiaient le rendu LOCAL, qui accepte la forme complète.
 *
 * ── POURQUOI ON N'ÉCRIT PLUS « [object Object] » ──────────────────────────
 *
 * Le commentaire d'origine disait déjà qu'une telle chaîne « serait pire que
 * l'omettre » — puis l'écrivait quand même. Un objet non reconnu est désormais
 * OMIS et TRACÉ : si la variable est obligatoire, l'autorité refuse en la
 * NOMMANT, ce qui se diagnostique ; si elle ne l'est pas, le message part sans
 * elle plutôt qu'avec une horreur dans le corps.
 */
function estMontant(valeur) {
  return valeur !== null
    && typeof valeur === 'object'
    && !Array.isArray(valeur)
    && Number.isInteger(valeur.amount)
    && (valeur.currency === undefined || typeof valeur.currency === 'string');
}

function plainVariables(variables) {
  const source = variables instanceof Map ? Object.fromEntries(variables) : (variables ?? {});
  const plat = {};
  for (const [cle, valeur] of Object.entries(source)) {
    if (valeur === null || valeur === undefined) continue;
    if (typeof valeur === 'string' || typeof valeur === 'number' || typeof valeur === 'boolean') {
      plat[cle] = valeur;
    } else if (valeur instanceof Date) {
      plat[cle] = valeur.toISOString();
    } else if (estMontant(valeur)) {
      /**
       * Recopié CHAMP PAR CHAMP, jamais étalé : le schéma de la passerelle est
       * `.strict()`, et une clé de plus — un `taxAmount` ajouté un jour par
       * commodité — ferait refuser l'envoi entier.
       */
      plat[cle] = valeur.currency
        ? { amount: valeur.amount, currency: String(valeur.currency).toUpperCase() }
        : { amount: valeur.amount };
    } else {
      logger.warn(
        `Envoi e-mail — variable « ${cle} » ignorée : sa forme n'est pas transportable `
        + '(ni texte, ni nombre, ni date, ni montant).',
      );
    }
  }
  return plat;
}

export async function sendTemplate({
  templateId, recipient, variables, replyTo = null, eventId = null, actionExecutionId = null,
  /**
   * LA FAÇADE DU PLAN DE CONTRÔLE — injectable, comme tout ce qui SORT de ce
   * module.
   *
   * ══ POURQUOI CETTE INJECTION EXISTE ═══════════════════════════════════════
   *
   * Ce service porte deux responsabilités qu'il faut pouvoir éprouver
   * séparément : la LOGIQUE LOCALE (journal, minimisation, idempotence de
   * livraison, canonicalisation de l'identifiant) et le TRANSPORT vers le
   * Panel. La seconde est prouvée de bout en bout par l'E2E de convergence,
   * avec un vrai pont et un vrai Panel.
   *
   * Sans ce point d'injection, la première ne serait plus testable du tout :
   * il faudrait monter un Panel appairé pour vérifier qu'une adresse est bien
   * masquée dans le journal. On testerait l'appairage, pas la minimisation.
   *
   * En exploitation, c'est TOUJOURS la vraie façade — et il n'existe aucun
   * chemin qui retomberait sur un envoi Brevo local.
   */
  controlPlane = { available: capabilitiesAvailable, invoke: invokeCapability },
}) {
  // --- 1. Idempotence — AVANT tout travail ----------------------------------
  if (actionExecutionId) {
    const existing = await EmailDelivery.findOne({ actionExecutionId });

    if (existing?.status === DELIVERY_STATUS.SENT) {
      logger.info(
        `E-mail déjà envoyé pour l'exécution ${actionExecutionId} (livraison ${existing.deliveryId}) — aucun renvoi.`
      );
      return result(existing, { alreadySent: true });
    }

    if (existing?.status === DELIVERY_STATUS.SENDING) {
      // Fenêtre de crash : voir l'en-tête. On refuse de deviner.
      const message =
        "Une tentative d'envoi précédente a été interrompue : impossible de savoir si l'e-mail est parti. " +
        'Aucun renvoi automatique (risque de doublon). Relancez manuellement si le destinataire n’a rien reçu.';
      existing.status = DELIVERY_STATUS.FAILED;
      existing.lastErrorSafe = { code: 'SEND_INTERRUPTED', message, retryable: false };
      await existing.save();
      throw new EmailDeliveryError('SEND_INTERRUPTED', message, {
        retryable: false,
        deliveryId: existing.deliveryId,
      });
    }
  }

  // --- 2. Readiness — le point de passage obligé -----------------------------
  const readiness = await getEmailReadiness({
    templateId,
    recipientEmail: recipient?.email,
    controlPlaneAvailable: controlPlane.available,
  });
  if (!readiness.ready) {
    const first = readiness.blockers[0];
    throw new EmailDeliveryError(first.code, first.message, {
      /**
       * ON RELAIE CE QUE LA PRÉCONDITION A DÉCLARÉ — on ne le décide plus ici.
       *
       * Cette ligne valait `false` sans condition, avec un motif juste pour le
       * cas courant : « une configuration manquante ne se répare pas en
       * réessayant ». Elle écrasait pourtant le seul blocage qui, lui, se
       * répare tout seul — la plateforme momentanément injoignable.
       *
       * Le coût était réel : une confirmation d'encaissement rejouée pendant
       * le redémarrage d'un déploiement est partie en DEAD_LETTER, pour une
       * indisponibilité qui a duré deux secondes.
       */
      retryable: first.retryable === true,
      details: readiness.blockers,
    });
  }
  for (const w of readiness.warnings) {
    logger.warn(`Envoi e-mail — avertissement ${w.code} : ${w.message}`);
  }

  // --- 3. Contrôle des VARIABLES — jamais du contenu (L12.1) ---------------
  /**
   * ══ CE QUI SE TROUVAIT ICI, ET POURQUOI C'EST PARTI ═══════════════════════
   *
   * Ce projet lisait sa propre copie du modèle et la RENDAIT. Le résultat
   * n'était jamais expédié — le Panel rend le sien — mais l'exercice avait
   * trois conséquences bien réelles, que l'audit a nommées :
   *
   *   1. un HTML local irrendable faisait échouer un envoi que le Panel aurait
   *      parfaitement produit : un VETO, exercé par une copie sans autorité ;
   *   2. le sujet du suivi venait de cette copie, donc pouvait décrire un
   *      e-mail différent de celui qui partait — sept modèles sur quatorze
   *      divergeaient déjà ;
   *   3. l'existence même de cette copie justifiait un écran d'édition qui
   *      donnait l'illusion de changer quelque chose.
   *
   * ══ CE QUI RESTE, ET POURQUOI C'EST LÉGITIME ══════════════════════════════
   *
   * Le projet reste autorité de la FAÇON de produire les valeurs. Il vérifie
   * donc ce qu'IL fournit, à l'aune du contrat que le PANEL sert — pas d'un
   * ancien HTML. Une variable obligatoire absente est ainsi refusée localement,
   * avec un diagnostic précis, plutôt que sous forme d'un refus générique après
   * un aller-retour réseau.
   *
   * ══ POURQUOI UN CONTRAT INCONNU NE BLOQUE PAS ═════════════════════════════
   *
   * Un projet qui n'a pas encore lu son contrat (démarrage, Panel injoignable
   * au boot) doit pouvoir envoyer : l'autorité de validation est le Panel, et
   * refuser d'avance recréerait le veto qu'on vient de retirer.
   */
  const variableProblems = await validateProvidedVariables(templateId, variables);
  if (variableProblems.length) {
    throw new EmailDeliveryError(
      variableProblems[0].code,
      safeErrorMessage(variableProblems[0].message),
      { retryable: false, details: variableProblems },
    );
  }

  const providerMode = readiness.context.providerMode;
  /**
   * L'EXPÉDITEUR N'EST PAS CONNU À CE STADE (R10.5B).
   *
   * Il l'était : ce projet en gardait une copie par mode. Depuis que le From est
   * unique et détenu par le Panel, seule la réponse de la capacité peut dire
   * sous quelle adresse le message est parti — et elle arrive après.
   *
   * La livraison est donc créée SANS expéditeur, et le renseigne à
   * l'acceptation. Y placer une valeur provisoire aurait été pire que de la
   * laisser vide : elle serait restée en cas d'échec, et le suivi aurait affiché
   * une adresse d'où rien n'est jamais parti.
   */
  const sender = { email: '', name: '' };

  // --- 4. Livraison ----------------------------------------------------------
  const delivery = await createOrGetDelivery({
    templateId,
    /**
     * `0` = PAS ENCORE SU (L11.1). Seul le Panel décidera quelle version il
     * rend, et il ne le dira qu'à l'acceptation. Y placer la version LOCALE
     * serait une devinette qui resterait en cas d'échec — le suivi afficherait
     * alors le numéro d'un contenu qui n'est jamais parti.
     */
    templateVersion: 0,
    providerMode,
    sender,
    recipient,
    /**
     * VIDE À LA CRÉATION — et c'est le même raisonnement que `templateVersion`.
     *
     * Le sujet réellement expédié est celui que le PANEL rend ; il ne le dit
     * qu'à l'acceptation. Y placer une valeur provisoire serait pire que de
     * laisser vide : elle resterait en cas d'échec, et le suivi afficherait le
     * sujet d'un message qui n'est jamais parti. Le code du modèle sert
     * d'étiquette de repli tant que rien n'est confirmé.
     */
    subjectSnapshot: '',
    eventId,
    actionExecutionId,
  });

  // Un second passage peut trouver une livraison déjà SENT (course serrée entre
  // le contrôle initial et l'upsert). L'index a fait son travail : on s'arrête.
  if (delivery.status === DELIVERY_STATUS.SENT) {
    return result(delivery, { alreadySent: true });
  }

  // --- 5. SENDING ------------------------------------------------------------
  delivery.status = DELIVERY_STATUS.SENDING;
  delivery.attempts += 1;
  // La version n'est PAS réécrite ici : elle sera celle que le Panel rendra,
  // et lui seul la connaît. Une tentative qui échoue laisse donc la valeur
  // du dernier envoi RÉUSSI, ou `0` s'il n'y en a jamais eu.
  await delivery.save();

  // --- 6. Envoi PAR LE PLAN DE CONTRÔLE (L8.4C) ------------------------------
  //
  // ══ CE QUI A CHANGÉ, ET CE QUI N'A PAS BOUGÉ ═══════════════════════════════
  //
  // Le projet ne parle plus à Brevo. Il DEMANDE un verbe au Panel, qui choisit
  // le monde, ouvre son coffre, résout le modèle et l'expéditeur, et parle au
  // fournisseur. Tout ce qui précède — readiness, rendu local, création de la
  // livraison, statuts — reste identique : c'est la façade métier du projet,
  // et elle demeure l'autorité de SA communication.
  //
  // ══ `operationId` = `deliveryId`, ET C'EST TOUT LE MÉCANISME ═══════════════
  //
  // La livraison existe DÉJÀ, avec un identifiant unique et durable, créé
  // avant tout appel au fournisseur et réutilisé au rejeu grâce à l'index sur
  // `actionExecutionId`. Il possède exactement les propriétés qu'une clé
  // d'idempotence doit avoir. En frapper une seconde aurait créé un identifiant
  // de plus à corréler, pour la même intention métier.
  //
  // C'est aussi ce qui referme la course « webhook avant réponse » : le Panel
  // renvoie cet identifiant dans l'événement de livraison, et le projet le
  // connaît avant même que l'envoi soit parti.
  try {
    const outcome = await controlPlane.invoke('email.send_template', {
      // Un CODE métier, jamais un identifiant de modèle Brevo : le contenu
      // appartient au Panel et reste dans nos versions.
      templateRef: templateId,
      recipient: { email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) },
      variables: plainVariables(variables),
      // Reply-To (visiteur) : répondre écrit au demandeur, pas à notre expéditeur.
      ...(replyTo?.email ? { replyTo } : {}),
      operationId: delivery.deliveryId,
    });

    /**
     * `ALREADY_SENT` : le Panel avait déjà exécuté cette opération et rend
     * l'identifiant MÉMORISÉ. Ce n'est pas un échec et surtout pas un second
     * envoi — on converge sur le même message.
     */
    const messageId = outcome?.result?.providerMessageId ?? null;

    // --- 7-8. SENT — et SURTOUT PAS DELIVERED -------------------------------
    // Brevo a ACCEPTÉ. Le destinataire n'a peut-être rien reçu, et ne recevra
    // peut-être jamais. Seul un webhook pourra dire « livré ».
    delivery.status = DELIVERY_STATUS.SENT;
    delivery.providerMessageId = normalizeProviderMessageId(messageId);
    /**
     * L'EXPÉDITEUR RÉELLEMENT UTILISÉ — rendu par le Panel (R10.4/R10.5).
     *
     * On ne le déduit plus d'une copie locale : elle serait juste tant que
     * personne ne change l'adresse, et FAUSSE pour tous les envois passés le
     * jour où quelqu'un la change — le suivi afficherait l'expéditeur
     * d'aujourd'hui pour un message d'hier.
     *
     * `sender` est absent d'un rejeu (`ALREADY_SENT`) : le premier appel a
     * réussi et la livraison porte déjà la valeur enregistrée alors. On ne
     * l'écrase donc que si le Panel en rend une.
     */
    if (outcome?.result?.sender?.email) {
      delivery.sender = {
        name: outcome.result.sender.name || outcome.result.sender.email,
        emailMasked: maskEmail(outcome.result.sender.email),
      };
    }
    /**
     * LA VERSION RÉELLEMENT EXPÉDIÉE — celle du Panel, plus la nôtre (L11.1).
     *
     * ══ CE QUE CE CHAMP DISAIT, ET POURQUOI C'ÉTAIT FAUX ══════════════════════
     *
     * Il portait `template.version` : le numéro du document LOCAL, celui que
     * l'éditeur de ce projet écrit — et qui n'a jamais été expédié depuis que
     * l'autorité de contenu est passée au Panel (L8.4C). Un exploitant qui
     * enquêtait sur un e-mail lisait donc un numéro sans rapport avec ce qui
     * était parti, et le lisait avec confiance : rien ne signalait l'écart.
     *
     * Un champ qui prétend décrire ce qui est parti doit décrire ce qui est
     * parti, ou ne pas exister. Le seul composant qui SAIT est celui qui a
     * rendu ; il le dit désormais dans sa réponse.
     *
     * ══ POURQUOI UN REJEU NE L'ÉCRASE PAS ═════════════════════════════════════
     *
     * `ALREADY_SENT` est rendu depuis le registre d'opérations du Panel, sans
     * réexécuter l'adaptateur, donc sans re-résoudre le modèle : la réponse ne
     * porte pas de version. La livraison garde alors celle enregistrée au
     * premier envoi — qui est la vérité de CE message. L'écraser avec `null`
     * effacerait la seule trace exacte que nous ayons.
     */
    if (Number.isInteger(outcome?.result?.templateVersion)) {
      delivery.templateVersion = outcome.result.templateVersion;
    }
    /**
     * LE SUJET RÉELLEMENT EXPÉDIÉ (L12.1) — même règle que la version.
     *
     * Absent d'un rejeu (`ALREADY_SENT`, rendu depuis le registre d'opérations
     * sans re-résoudre le modèle) : la livraison garde alors celui enregistré
     * au premier envoi, qui est la vérité de CE message. L'écraser par une
     * chaîne vide effacerait la seule trace exacte dont on dispose.
     */
    if (typeof outcome?.result?.subject === 'string' && outcome.result.subject) {
      delivery.subjectSnapshot = outcome.result.subject;
    }
    delivery.sentAt = new Date();
    delivery.lastErrorSafe = { code: '', message: '', retryable: false };
    await delivery.save();

    logger.info(
      `E-mail accepté par la plateforme — modèle ${templateId} `
        + `v${delivery.templateVersion ?? '(inconnue)'} `
        + `(${outcome?.result?.templateScope ?? 'portée inconnue'}), `
        + `destinataire ${maskEmail(recipient.email)}, mode ${providerMode}, livraison ${delivery.deliveryId}.`
    );
    return result(delivery);
  } catch (err) {
    // --- 9. Normalisation des erreurs ---------------------------------------
    //
    // Les codes `CAPABILITY_*` traversent le pont TELS QUELS (contrat 1.5.0) :
    // on peut donc distinguer « le Panel a refusé » de « le fournisseur a dit
    // non » de « personne n'a répondu ». Les aplatir perdrait la seule
    // information qui décide s'il est sûr de rejouer.
    const capabilityCode = typeof err?.code === 'string' && err.code.startsWith('CAPABILITY_')
      ? err.code
      : null;
    const code = capabilityCode ?? D.PROVIDER_ERROR;
    /**
     * UN DOUTE NE SE REJOUE PAS.
     *
     * `CAPABILITY_TIMEOUT` signifie que l'issue est INDÉTERMINÉE : le message
     * est peut-être parti. Le marquer rejouable ferait envoyer un second
     * e-mail à une personne réelle. `CAPABILITY_OPERATION_UNRESOLVED` porte le
     * même doute, hérité d'une tentative antérieure.
     */
    const indecidable = code === 'CAPABILITY_TIMEOUT'
      || code === 'CAPABILITY_OPERATION_UNRESOLVED';
    /**
     * REJOUABLE = « rien n'est parti, et la cause peut disparaître seule ».
     *
     * Un fournisseur injoignable ou qui refuse ponctuellement entre dans cette
     * catégorie : la tentative suivante a de vraies chances d'aboutir, et il
     * n'y a aucun risque de doublon puisque rien n'a été accepté.
     *
     * Tout le reste — octroi manquant, entrée invalide, modèle coupé,
     * identité absente — est une CONFIGURATION. Rejouer à l'identique
     * échouerait exactement pareil, indéfiniment : le marquer rejouable
     * ferait tourner un dispatcher dans le vide au lieu d'alerter un humain.
     */
    const retryable = !indecidable && (
      code === D.PROVIDER_ERROR
      || code === 'CAPABILITY_PROVIDER_UNAVAILABLE'
    );
    const message = safeErrorMessage(err?.message || 'Envoi impossible.');

    /**
     * Un refus de NOTRE garde-fou n'est pas un échec de livraison.
     *
     * `PRECONDITION_FAILED` sépare les deux : rien n'a été tenté chez Brevo, donc
     * rien ne s'est « mal passé » à l'envoi. Écrire `FAILED` ici gonflerait les
     * statistiques d'échec fournisseur d'incidents purement internes et enverrait
     * quiconque lit ce journal enquêter du mauvais côté.
     */
    delivery.status =
      code === D.NOT_OPERATIONAL ? DELIVERY_STATUS.PRECONDITION_FAILED : DELIVERY_STATUS.FAILED;
    delivery.lastErrorSafe = { code, message, retryable };
    await delivery.save();

    throw new EmailDeliveryError(code, message, { retryable, deliveryId: delivery.deliveryId });
  }
}

/** Projection SÛRE d'une livraison (routes DEV). Aucune adresse en clair. */
export function serializeDelivery(doc) {
  return {
    deliveryId: doc.deliveryId,
    eventId: doc.eventId || null,
    actionExecutionId: doc.actionExecutionId || null,
    templateId: doc.templateId,
    templateVersion: doc.templateVersion,
    provider: doc.provider,
    providerMode: doc.providerMode,
    sender: { name: doc.sender?.name || '', emailMasked: doc.sender?.emailMasked || '' },
    recipientEmailMasked: doc.recipientEmailMasked,
    subjectSnapshot: doc.subjectSnapshot,
    status: doc.status,
    providerMessageId: doc.providerMessageId || null,
    attempts: doc.attempts,
    lastErrorSafe: {
      code: doc.lastErrorSafe?.code || '',
      message: doc.lastErrorSafe?.message || '',
      retryable: Boolean(doc.lastErrorSafe?.retryable),
    },
    sentAt: doc.sentAt || null,
    deliveredAt: doc.deliveredAt || null,
    lastEventType: doc.lastEventType || null,
    lastEventAt: doc.lastEventAt || null,
    engagement: {
      openCount: doc.engagement?.openCount || 0,
      firstOpenedAt: doc.engagement?.firstOpenedAt || null,
      lastOpenedAt: doc.engagement?.lastOpenedAt || null,
      clickCount: doc.engagement?.clickCount || 0,
      firstClickedAt: doc.engagement?.firstClickedAt || null,
      lastClickedAt: doc.engagement?.lastClickedAt || null,
    },
    createdAt: doc.createdAt,
  };
}

export default { sendTemplate, serializeDelivery, EmailDeliveryError };
