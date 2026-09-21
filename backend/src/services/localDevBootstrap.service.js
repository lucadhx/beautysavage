import crypto from 'node:crypto';

import { User } from '../models/User.model.js';
import { LocalDevActivation } from '../models/LocalDevActivation.model.js';
import { Company } from '../models/Company.model.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { getSingleton } from '../utils/singleton.js';
import { ApiError } from '../utils/ApiError.js';
import { ROLES, USER_STATUS } from '../utils/constants.js';
import { ENTITY_TYPE } from '../utils/domainEventRegistry.js';
import { maskEmail, safeErrorMessage, keyHash } from '../utils/eventPayloadSafety.js';
import { logger } from '../utils/logger.js';

/**
 * L'AMORÇAGE D'UN PREMIER DÉVELOPPEUR LOCAL — LOT 2C.
 *
 * ══ CE QUE CE MODULE REMPLACE ═══════════════════════════════════════════════
 *
 * Avant lui, dupliquer un projet écrivait `SEED_DEV_PASSWORD` dans le `.env` de
 * la copie et le premier démarrage en faisait un compte. Le mot de passe par
 * défaut — `123dev` — était le même sur tous les projets, restait en clair sur
 * le disque, et survivait à la mise en production parce que rien n'obligeait
 * jamais à le changer.
 *
 * Ce n'était pas un oubli : c'était le seul moyen connu de livrer un projet
 * administrable. Le remplacer demandait une primitive qui n'existait pas.
 *
 * ══ CE QU'IL FAIT À LA PLACE ════════════════════════════════════════════════
 *
 *     duplication  →  compte créé SANS mot de passe (PENDING_ACTIVATION)
 *                  →  lien à usage unique, envoyé à l'adresse du titulaire
 *                  →  le titulaire choisit son mot de passe
 *                  →  le lien meurt
 *
 * Aucun secret n'est jamais transmis : le lien ne prouve que la possession de
 * la boîte, et ce qu'on en fait — poser un mot de passe — ne peut être fait
 * qu'une fois.
 *
 * ══ CE QU'IL NE FAIT PAS ════════════════════════════════════════════════════
 *
 * Il ne connaît pas le Panel. L'e-mail EMPRUNTE la plateforme d'envoi de L.Y
 * Solution — c'est elle qui détient le compte Brevo — mais l'identité créée ici
 * est LOCALE : elle s'authentifie sans le Panel, survit à sa disparition, et
 * n'est révoquée par personne d'autre que ce projet. Un développeur fédéré,
 * lui, n'a jamais de mot de passe ici (voir `federatedAuth.service.js`).
 */

/** Durée de validité du lien d'activation (minutes) — cohérente avec les resets. */
export const ACTIVATION_TTL_MINUTES = Number(process.env.LOCAL_DEV_ACTIVATION_TTL_MINUTES) || 60;

/**
 * DÉLAI ENTRE DEUX ENVOIS. Sans lui, le formulaire de renvoi devient un moyen
 * commode d'inonder la boîte de quelqu'un d'autre — et de consommer le quota
 * d'envoi de la plateforme au passage.
 */
export const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

const hashActivationToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Émission best-effort : un défaut de journal ne casse jamais une activation. */
async function trace(type, payloadSafe, userId) {
  try {
    const { emitSafe } = await import('./events/domainEvent.service.js');
    await emitSafe({
      type,
      entityType: ENTITY_TYPE.LOCAL_ACCOUNT,
      entityId: userId ? String(userId) : null,
      payloadSafe,
    });
  } catch (err) {
    logger.warn(`[localdev] événement « ${type} » non journalisé : ${err?.message}`);
  }
}

/**
 * L'URL DU MANAGER — source canonique, jamais un domaine codé en dur.
 *
 * Renvoie une chaîne vide si elle n'est pas configurée. L'appelant en fait un
 * ÉCHEC D'ENVOI, pas un échec de création : un projet dont l'URL publique n'est
 * pas encore renseignée doit pouvoir être terminé plus tard, pas repartir de
 * zéro.
 */
async function resolveManagerUrl() {
  const cfg = await getSingleton(SystemConfiguration);
  return String(cfg?.network?.managerUrl || '').trim().replace(/\/+$/, '');
}

/**
 * Crée une activation et INVALIDE toutes les précédentes du même compte.
 *
 * L'invalidation est le point délicat : deux liens valides simultanément
 * signifieraient qu'un lien intercepté reste utilisable après qu'on en a
 * demandé un nouveau — exactement le scénario contre lequel on renvoie un lien.
 *
 * @returns {Promise<{ rawToken: string, activation: object }>} le token BRUT ne
 *          sort d'ici que pour construire une URL ; il n'est ni stocké ni
 *          journalisé.
 */
export async function issueActivation(user, { reason = 'BOOTSTRAP' } = {}) {
  await LocalDevActivation.updateMany(
    { userId: user._id, consumedAt: null },
    { $set: { consumedAt: new Date(), emailErrorSafe: 'Remplacée par une nouvelle demande.' } }
  );

  const rawToken = crypto.randomBytes(32).toString('base64url');
  const activation = await LocalDevActivation.create({
    userId: user._id,
    tokenHash: hashActivationToken(rawToken),
    expiresAt: new Date(Date.now() + ACTIVATION_TTL_MINUTES * 60 * 1000),
    reason,
  });
  return { rawToken, activation };
}

/**
 * Envoie le lien. BEST-EFFORT ET HONNÊTE : l'issue est ENREGISTRÉE sur
 * l'activation (`emailStatus`), pas seulement journalisée.
 *
 * C'est ce qui permet à l'exploitant de distinguer « le développeur n'a pas
 * encore cliqué » de « le message n'est jamais parti » — deux situations qui se
 * ressemblent beaucoup vues du dehors et qui ne se réparent pas pareil.
 */
export async function sendActivationEmail(user, rawToken, activation, { controlPlane } = {}) {
  const managerUrl = await resolveManagerUrl();
  if (!managerUrl) {
    const message = 'URL publique du manager non configurée (Configuration système → Réseau).';
    await LocalDevActivation.updateOne(
      { _id: activation._id },
      { $set: { emailStatus: 'ERROR', emailErrorSafe: message } }
    );
    logger.warn(`[localdev] LOCAL_DEV_ACTIVATION_FAILED — ${message}`);
    await trace('localdev.activation.failed', {
      emailMasked: maskEmail(user.email),
      stage: 'SEND',
      error: { code: 'MANAGER_URL_MISSING', message },
    }, user._id);
    return { sent: false, reason: 'MANAGER_URL_MISSING' };
  }

  const activationUrl = `${managerUrl}/activer-mon-compte?token=${rawToken}`;
  try {
    const { sendTemplate } = await import('./email/emailDelivery.service.js');
    const company = await getSingleton(Company);
    await sendTemplate({
      /**
       * LE MÊME POINT D'INJECTION QUE `sendTemplate` — et pour la même raison.
       *
       * Éprouver « le lien part, le compte s'active, le lien meurt » ne doit
       * pas exiger un Panel appairé : on testerait l'appairage, pas
       * l'activation. En exploitation, `controlPlane` est absent et c'est la
       * vraie façade qui répond — il n'existe aucun chemin d'envoi local.
       */
      ...(controlPlane ? { controlPlane } : {}),
      templateId: 'DEV_ACCOUNT_ACTIVATION',
      recipient: { email: user.email, name: user.name || '', key: keyHash(user.email) },
      variables: {
        'company.name': company?.name || 'votre projet',
        'user.name': user.name || user.email,
        'auth.activationUrl': activationUrl,
        'auth.expiresMinutes': String(ACTIVATION_TTL_MINUTES),
      },
    });
    await LocalDevActivation.updateOne(
      { _id: activation._id },
      { $set: { emailStatus: 'SENT', sentAt: new Date(), emailErrorSafe: '' } }
    );
    logger.success(`[localdev] LOCAL_DEV_ACTIVATION_SENT — lien envoyé à ${maskEmail(user.email)}.`);
    await trace('localdev.activation.sent', {
      emailMasked: maskEmail(user.email),
      expiresMinutes: ACTIVATION_TTL_MINUTES,
      reason: activation.reason || 'BOOTSTRAP',
    }, user._id);
    return { sent: true };
  } catch (err) {
    const message = safeErrorMessage(err?.message || 'envoi impossible');
    await LocalDevActivation.updateOne(
      { _id: activation._id },
      { $set: { emailStatus: 'ERROR', emailErrorSafe: message } }
    );
    // Ni token, ni URL : l'URL PORTE le token.
    logger.warn(`[localdev] LOCAL_DEV_ACTIVATION_FAILED — ${err?.code || message}`);
    await trace('localdev.activation.failed', {
      emailMasked: maskEmail(user.email),
      stage: 'SEND',
      error: { code: String(err?.code || 'SEND_FAILED').slice(0, 64), message },
    }, user._id);
    return { sent: false, reason: 'SEND_FAILED' };
  }
}

/**
 * ══ LE PREMIER COMPTE LOCAL D'UN PROJET ═════════════════════════════════════
 *
 * Appelé au démarrage. Trois gardes, dans cet ordre, et l'ordre est le sujet :
 *
 *  1. UN SEUL DEV STRUCTUREL. Si un compte de ce rôle existe déjà — quelle que
 *     soit son adresse — on ne fait rien. C'est ce qui empêche un changement de
 *     `FIRST_DEV_EMAIL` de fabriquer un second administrateur sur un projet
 *     déjà vivant.
 *  2. FAIL-CLOSED SANS ADRESSE. Sans destinataire explicite, on ne crée RIEN.
 *     L'ancien code retombait sur `dev@mail.com` : une adresse que personne ne
 *     relève, sur un compte que tout le monde pouvait deviner.
 *  3. JAMAIS D'ÉCRASEMENT. Un compte existant portant cette adresse est laissé
 *     strictement intact — on ne lui retire pas son mot de passe pour lui
 *     imposer une activation.
 *
 * @returns {Promise<{status: string, user?: object, emailSent?: boolean}>}
 */
export async function ensureInitialLocalUser({ email, name, role = ROLES.DEV, origin = 'BOOTSTRAP', controlPlane } = {}) {
  const existingOfRole = await User.exists({ role });
  if (existingOfRole) return { status: 'ALREADY_PRESENT' };

  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    /**
     * LE BLOCAGE EST LA BONNE RÉPONSE, ET IL EST BRUYANT.
     *
     * Un projet sans premier développeur n'est pas administrable — c'est un
     * défaut sérieux. Mais un projet avec un développeur que personne n'a
     * choisi est pire : il est administrable PAR QUELQU'UN D'AUTRE.
     */
    logger.warn(
      `[localdev] FIRST_DEV_REQUIRED — aucun premier compte ${role} n'a été créé : ` +
        'FIRST_DEV_EMAIL est absente ou invalide. Renseignez-la puis redémarrez.'
    );
    return { status: 'FIRST_DEV_REQUIRED' };
  }

  const sameEmail = await User.findOne({ email: normalized });
  if (sameEmail) return { status: 'ALREADY_PRESENT', user: sameEmail };

  const user = await User.create({
    email: normalized,
    name: String(name || '').trim() || 'Développeur',
    role,
    status: USER_STATUS.PENDING_ACTIVATION,
  });
  logger.success(
    `[localdev] LOCAL_DEV_CREATED — compte ${role} ${maskEmail(user.email)} créé en attente d'activation.`
  );
  await trace('localdev.created', {
    emailMasked: maskEmail(user.email),
    role,
    origin,
  }, user._id);

  const { rawToken, activation } = await issueActivation(user, { reason: origin === 'BOOTSTRAP' ? 'BOOTSTRAP' : 'LEGACY_MIGRATION' });
  const envoi = await sendActivationEmail(user, rawToken, activation, { controlPlane });
  return { status: 'CREATED', user, emailSent: envoi.sent };
}

/**
 * ══ L'ÉVÉNEMENT MÉTIER ET LA CONDITION TECHNIQUE NE SONT PAS LE MÊME FAIT ═══
 *
 * ── CE QUI S'EST RÉELLEMENT PASSÉ SUR LE PREMIER PROJET DUPLIQUÉ ───────────
 *
 * Au premier démarrage, le compte a été créé — l'ÉVÉNEMENT MÉTIER : « un accès
 * nécessitant une activation existe ». L'envoi, lui, a échoué :
 * `PROVIDER_NOT_CONFIGURED`. Et pour cause — le courriel part par le Panel, et
 * le projet n'était pas encore appairé. La CONDITION TECHNIQUE n'était pas
 * remplie.
 *
 * Ensuite : rien. Le jeton a expiré au bout d'une heure avec
 * `emailStatus: ERROR`, l'appairage est arrivé, le projet a été déployé — et
 * personne n'a relié les deux. Le lien n'est finalement parti que parce qu'un
 * humain a pensé à appeler `/activation/resend` à la main.
 *
 * Un projet livré dépendait donc de ce qu'un opérateur se souvienne. C'est le
 * défaut, et il n'est pas dans l'envoi : il est dans l'absence de reprise.
 *
 * ── CE QUI LE REMPLACE ────────────────────────────────────────────────────
 *
 * Cette fonction est la REPRISE, et elle est gouvernée par un état DURABLE —
 * un compte `PENDING_ACTIVATION` dont la dernière activation n'est pas partie.
 * Elle ne décide pas QUAND : c'est le gestionnaire de reprises de démarrage
 * qui l'arme sur l'événement « appairage établi ».
 *
 * D'où les propriétés que le lot exigeait, et d'où elles viennent :
 *
 *   DURABLE     l'état vit en base (`LocalDevActivation`), pas dans un
 *               minuteur : un redémarrage le retrouve ;
 *   IDEMPOTENTE un envoi déjà réussi rend `done` — plus rien n'est dû ;
 *   SANS DOUBLE le délai de garde de `resendActivation` s'applique ici aussi,
 *               et `issueActivation` invalide le lien précédent ;
 *   OBSERVABLE  chaque tentative écrit `emailStatus` sur l'activation et
 *               émet un événement de domaine ;
 *   SANS PERTE  un projet jamais appairé garde son obligation ARMÉE, sans
 *               s'épuiser : elle partira le jour de l'appairage.
 *
 * ── ET UN REDÉMARRAGE N'ENVOIE JAMAIS « AU CAS OÙ » ───────────────────────
 *
 * Un redémarrage ne déclenche rien par lui-même : il relit l'état durable. Si
 * le dernier envoi a réussi, il n'y a plus d'obligation et rien ne part. Ce
 * n'est pas un envoi au redémarrage, c'est une dette qu'on solde quand on
 * peut enfin la payer.
 *
 * @returns {Promise<{ok: boolean, done: boolean, reason?: string, detail?: string, sent?: number}>}
 */
export async function deliverPendingActivations({ controlPlane, now = Date.now() } = {}) {
  const enAttente = await User.find({ status: USER_STATUS.PENDING_ACTIVATION }).select('_id email name role');
  if (enAttente.length === 0) {
    return { ok: true, done: true, reason: 'NO_PENDING_ACCOUNT', detail: 'aucun compte en attente d’activation', sent: 0 };
  }

  let envoyes = 0;
  let dus = 0;
  const motifs = [];

  for (const user of enAttente) {
    const derniere = await LocalDevActivation.findOne({ userId: user._id }).sort({ createdAt: -1 });

    /**
     * UNE ACTIVATION PARTIE NE SE REJOUE PAS.
     *
     * Que son titulaire ait cliqué ou non ne nous regarde pas : le lien est
     * chez lui. Le renvoyer d'office invaliderait celui qu'il s'apprête
     * peut-être à ouvrir.
     */
    if (derniere?.emailStatus === 'SENT') continue;

    dus += 1;

    if (derniere && now - new Date(derniere.createdAt).getTime() < RESEND_COOLDOWN_MS) {
      motifs.push('délai de garde');
      continue;
    }

    const { rawToken, activation } = await issueActivation(user, { reason: 'RECOVERY' });
    const envoi = await sendActivationEmail(user, rawToken, activation, { controlPlane });
    if (envoi.sent) envoyes += 1;
    else motifs.push(envoi.reason || 'SEND_FAILED');
  }

  if (dus === 0) {
    return { ok: true, done: true, reason: 'ALREADY_SENT', detail: 'le lien d’activation est déjà parti', sent: 0 };
  }
  if (envoyes === dus) {
    logger.success(`[localdev] LOCAL_DEV_ACTIVATION_RECOVERED — ${envoyes} lien(s) d’activation enfin envoyé(s).`);
    return { ok: true, done: true, detail: `${envoyes} lien(s) envoyé(s)`, sent: envoyes };
  }
  return {
    ok: false,
    done: false,
    reason: motifs[0] || 'SEND_FAILED',
    detail: `${envoyes}/${dus} lien(s) envoyé(s) — ${[...new Set(motifs)].join(', ')}`,
    sent: envoyes,
  };
}

/**
 * Y a-t-il une obligation d'activation NON HONORÉE ? Lecture seule.
 *
 * Le démarrage s'en sert pour décider d'ARMER une reprise plutôt que d'en
 * inscrire une inutile : un projet dont le lien est parti ne doit pas traîner
 * une obligation dans son résumé de démarrage.
 */
export async function pendingActivationDelivery() {
  const enAttente = await User.find({ status: USER_STATUS.PENDING_ACTIVATION }).select('_id email');
  const dus = [];
  for (const user of enAttente) {
    const derniere = await LocalDevActivation.findOne({ userId: user._id }).sort({ createdAt: -1 });
    if (derniere?.emailStatus === 'SENT') continue;
    dus.push({ emailMasked: maskEmail(user.email), lastStatus: derniere?.emailStatus ?? 'NONE' });
  }
  return { due: dus.length > 0, accounts: dus };
}

/** Le lien présenté est-il utilisable ? Ne révèle rien qu'il ne prouve déjà. */
export async function describeActivation(rawToken) {
  const activation = await LocalDevActivation.findOne({
    tokenHash: hashActivationToken(rawToken),
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!activation) return { valid: false };
  const user = await User.findById(activation.userId);
  if (!user || user.status !== USER_STATUS.PENDING_ACTIVATION) return { valid: false };
  const company = await getSingleton(Company);
  /**
   * ON RENVOIE LE NOM, PAS L'ADRESSE. Le porteur du lien connaît déjà l'adresse
   * — le message y est arrivé. Le nom sert à confirmer qu'il active le bon
   * compte ; l'adresse complète, elle, n'ajouterait qu'une donnée à exposer si
   * le lien traînait dans un historique de navigateur partagé.
   */
  return {
    valid: true,
    name: user.name || '',
    role: user.role,
    projectName: company?.name || '',
    expiresAt: activation.expiresAt,
  };
}

/**
 * CONSOMME LE LIEN ET POSE LE MOT DE PASSE.
 *
 * ── POURQUOI LA CONSOMMATION EST UNE ÉCRITURE CONDITIONNELLE ────────────────
 *
 * `findOneAndUpdate({ consumedAt: null }, { consumedAt: now })` est ATOMIQUE :
 * deux requêtes simultanées portant le même token ne peuvent pas gagner toutes
 * les deux. Une lecture suivie d'une écriture, elle, aurait laissé les deux
 * passer — un double-clic suffit à produire la course.
 *
 * La consommation a lieu AVANT de poser le mot de passe : si l'écriture du mot
 * de passe échoue, le lien est perdu et il faut en redemander un. C'est le bon
 * sens de l'échec — un lien mort de trop vaut mieux qu'un lien rejouable.
 */
export async function activateAccount(rawToken, newPassword) {
  const now = new Date();
  const activation = await LocalDevActivation.findOneAndUpdate(
    { tokenHash: hashActivationToken(rawToken), consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true }
  );
  if (!activation) {
    await trace('localdev.activation.failed', {
      stage: 'CONSUME',
      error: { code: 'LOCAL_DEV_ACTIVATION_INVALID', message: 'Lien invalide, expiré ou déjà utilisé.' },
    }, null);
    throw ApiError.badRequest(
      'Lien d’activation invalide, expiré ou déjà utilisé. Demandez-en un nouveau.',
      { code: 'LOCAL_DEV_ACTIVATION_INVALID' }
    );
  }

  const user = await User.findById(activation.userId).select('+password');
  if (!user) {
    throw ApiError.badRequest('Lien d’activation invalide, expiré ou déjà utilisé.', {
      code: 'LOCAL_DEV_ACTIVATION_INVALID',
    });
  }

  user.password = newPassword; // le hash bcrypt passe par le pre('save') canonique
  user.status = USER_STATUS.ACTIVE;
  user.mustResetPassword = false;
  await user.save();

  logger.success(`[localdev] LOCAL_DEV_ACTIVATED — compte ${maskEmail(user.email)} activé.`);
  await trace('localdev.activated', {
    emailMasked: maskEmail(user.email),
    role: user.role,
  }, user._id);

  return { email: user.email, role: user.role, name: user.name };
}

/**
 * RENVOI D'UN LIEN — réponse TOUJOURS générique.
 *
 * Le message ne dit jamais si l'adresse correspond à un compte, ni si ce compte
 * attend une activation : sans cela, ce formulaire deviendrait un annuaire des
 * comptes d'administration du projet.
 */
export async function resendActivation(email, { controlPlane } = {}) {
  const generic = {
    message: "Si un compte en attente d'activation correspond à cette adresse, un nouveau lien vient d'être envoyé.",
  };
  const normalized = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalized, status: USER_STATUS.PENDING_ACTIVATION });
  if (!user) return generic;

  const derniere = await LocalDevActivation.findOne({ userId: user._id }).sort({ createdAt: -1 });
  if (derniere && Date.now() - new Date(derniere.createdAt).getTime() < RESEND_COOLDOWN_MS) {
    // Le demandeur ne l'apprend pas : lui dire « trop tôt » confirmerait le compte.
    logger.info(`[localdev] renvoi ignoré (délai d'attente) pour ${maskEmail(user.email)}.`);
    return generic;
  }

  const { rawToken, activation } = await issueActivation(user, { reason: 'RESEND' });
  await sendActivationEmail(user, rawToken, activation, { controlPlane });
  return generic;
}

/**
 * ÉTAT D'AMORÇAGE, pour l'exploitant (route DEV) et la recette : y a-t-il un
 * compte en attente, et son lien est-il parti ?
 */
export async function describeBootstrapStatus() {
  const pending = await User.find({ status: USER_STATUS.PENDING_ACTIVATION })
    .select('email name role')
    .lean();
  const activations = await LocalDevActivation.find({
    userId: { $in: pending.map((u) => u._id) },
    consumedAt: null,
  })
    .select('userId emailStatus emailErrorSafe expiresAt sentAt')
    .lean();

  return {
    pendingAccounts: pending.map((u) => {
      const a = activations.find((x) => String(x.userId) === String(u._id));
      return {
        email: u.email,
        name: u.name,
        role: u.role,
        activationEmailStatus: a?.emailStatus || 'NONE',
        activationEmailError: a?.emailErrorSafe || '',
        activationExpiresAt: a?.expiresAt || null,
      };
    }),
  };
}
