import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { User } from '../models/User.model.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { Company } from '../models/Company.model.js';
import { getSingleton } from '../utils/singleton.js';
import { ApiError } from '../utils/ApiError.js';
import { keyHash } from '../utils/eventPayloadSafety.js';
import { logger } from '../utils/logger.js';

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

export async function login(email, password) {
  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user) throw ApiError.unauthorized('Email ou mot de passe incorrect');

  /**
   * ══ UN COMPTE EN ATTENTE D'ACTIVATION NE SE CONNECTE PAS (LOT 2C) ═════════
   *
   * ── POURQUOI LE MÊME MESSAGE QU'UN MAUVAIS MOT DE PASSE ──────────────────
   *
   * Répondre « ce compte n'est pas encore activé » serait plus aimable, et
   * c'est précisément le problème : cette phrase confirme qu'une adresse
   * correspond à un compte d'ADMINISTRATION, et qu'il est en cours
   * d'ouverture. On offrirait un annuaire des cibles les plus intéressantes du
   * projet, au moment exact où elles sont le plus vulnérables.
   *
   * Le titulaire légitime, lui, n'a pas besoin de ce message : il a reçu le
   * lien d'activation, et la page de connexion lui propose d'en redemander un.
   *
   * La garde vient AVANT la comparaison : un compte en attente n'a pas de mot
   * de passe, donc aucune valeur ne saurait convenir — autant le dire ici
   * plutôt que de le laisser dépendre d'un `undefined`.
   */
  if (user.isPendingActivation()) {
    logger.info(
      `[auth] connexion refusée : compte en attente d'activation (${keyHash(user.email)}).`
    );
    throw ApiError.unauthorized('Email ou mot de passe incorrect');
  }

  const valid = await user.comparePassword(password);
  if (!valid) throw ApiError.unauthorized('Email ou mot de passe incorrect');

  return { token: signToken(user), user: user.toJSON() };
}

/**
 * LES COMPTES DU WIDGET DE CONNEXION RAPIDE — TEST uniquement.
 *
 * ══ POURQUOI CE CORPS A DISPARU ═════════════════════════════════════════════
 *
 * Il lisait `User.find({ status: 'ACTIVE' })`, c'est-à-dire une TROISIÈME
 * description des comptes du projet, à côté de `/api/accounts` et de la
 * projection servie au Panel. Elle avait ses propres défauts :
 *
 *   · un filtre d'ÉGALITÉ sur `status` ne matche pas un document où le champ
 *     est ABSENT — le défaut du schéma s'applique à l'écriture, pas à la
 *     relecture. Tout compte antérieur au LOT 2C avait donc disparu du widget,
 *     sans erreur et sans trace ;
 *
 *   · elle ne connaissait que `User`, donc aucune identité L.Y Solution.
 *     Depuis la fédération, c'est précisément la population qui administre le
 *     projet : le widget ne proposait plus personne d'utile.
 *
 * L'autorité est désormais `listProjectAccounts()` — la même lecture que le
 * Manager et que le Panel. Voir `accounts/testLoginAccounts.service.js`.
 */
export async function listTestAccounts() {
  const { describeTestLogin } = await import('./accounts/testLoginAccounts.service.js');
  return describeTestLogin();
}

/**
 * Connexion instantanée à un compte sans mot de passe.
 * STRICTEMENT réservée à l'environnement TEST (désactivée en PROD).
 *
 * ══ POURQUOI ELLE SURVIT AU LOT 2C, ET SOUS QUELLE CONDITION ════════════════
 *
 * C'est la seule porte du projet qui ouvre une session sans preuve. Elle est
 * gardée par `config.isTest`, qui n'est pas un réglage de confort : `ENV=PROD`
 * la rend inatteignable, et la recette l'éprouve explicitement.
 *
 * Elle refuse en revanche les comptes EN ATTENTE D'ACTIVATION. Sans cela, elle
 * aurait rendu tout ce lot décoratif en environnement de recette : on aurait pu
 * entrer dans un compte qui n'a jamais choisi de mot de passe, et donc ne
 * jamais éprouver le parcours qu'on vient d'écrire.
 */
export async function devLogin(email) {
  if (!config.isTest) throw ApiError.forbidden('Fonction indisponible dans cet environnement');
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    /**
     * ══ UNE IDENTITÉ L.Y SOLUTION N'ENTRE PAS PAR CETTE PORTE ═══════════════
     *
     * Le widget de recette montre les deux populations, et l'adresse d'un
     * développeur du Panel peut donc être tapée ici — par un script, par un
     * copier-coller, ou par un futur écran distrait. La réponse honnête n'est
     * pas « compte introuvable » : le compte existe, il n'est simplement pas
     * À NOUS.
     *
     * On le DIT, et l'on ne fait RIEN d'autre. Surtout pas ce que la facilité
     * suggérerait : créer un `User` local portant cette adresse pour que le
     * mécanisme existant s'applique. Ce serait fabriquer un mot de passe pour
     * une identité que ce projet ne possède pas, et rapprocher deux mondes par
     * l'adresse e-mail — la seule clé dont `ExternalPrincipal` explique
     * qu'elle ne doit JAMAIS servir de correspondance.
     */
    const { ExternalPrincipal, EXTERNAL_PROVIDERS } = await import('../models/ExternalPrincipal.model.js');
    const federe = await ExternalPrincipal.findOne({
      provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
      email: String(email ?? '').toLowerCase(),
    }).lean();
    if (federe) {
      throw ApiError.badRequest(
        'Cet accès est administré par L.Y Solution : connectez-vous par la fédération.',
        { code: 'FEDERATED_IDENTITY_NOT_LOCAL' },
      );
    }
    throw ApiError.notFound('Compte introuvable');
  }
  if (user.isPendingActivation()) {
    throw ApiError.forbidden("Ce compte attend son activation : aucun accès n'est possible avant.", {
      code: 'LOCAL_DEV_PENDING_ACTIVATION',
    });
  }
  return { token: signToken(user), user: user.toJSON() };
}

export async function updateProfile(userId, { name }) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('Compte introuvable');
  user.name = name;
  await user.save();
  return user.toJSON();
}

/* --- Mot de passe oublié ---------------------------------------------------- */

/** Durée de validité du lien (minutes) — configurable, défaut 60. */
export const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES) || 60;

const hashResetToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Demande de réinitialisation — réponse TOUJOURS générique (aucune énumération
 * de comptes). Si le compte existe : génère un token aléatoire (jamais stocké
 * en clair, jamais journalisé), écrase toute demande précédente, envoie
 * l'e-mail tokenisé via le système transactionnel canonique.
 *
 * L'URL est construite depuis « Configuration Système → Réseau » (managerUrl) —
 * jamais un localhost codé en dur : TEST et PROD résolvent leur propre domaine.
 */
export async function requestPasswordReset(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const generic = {
    message: 'Si un compte correspond à cette adresse, un lien de réinitialisation a été envoyé.',
  };
  const user = await User.findOne({ email: normalized });
  if (!user) return generic;
  /**
   * ON NE RÉINITIALISE PAS CE QUI N'EXISTE PAS (LOT 2C).
   *
   * Un compte en attente d'activation n'a pas de mot de passe. Lui envoyer un
   * lien de réinitialisation ouvrirait un SECOND chemin pour poser le premier
   * mot de passe — avec sa propre durée, son propre usage, et aucune trace
   * d'activation. Le parcours d'activation est le seul, et il a son renvoi.
   */
  if (user.isPendingActivation()) {
    logger.info(`[auth] réinitialisation ignorée : compte en attente d'activation (${keyHash(user.email)}).`);
    return generic;
  }

  const cfg = await getSingleton(SystemConfiguration);
  const managerUrl = String(cfg?.network?.managerUrl || '').trim().replace(/\/+$/, '');
  if (!managerUrl) {
    // On ne révèle rien au demandeur ; l'exploitant, lui, doit le savoir.
    logger.warn('[auth] réinitialisation demandée mais network.managerUrl non configurée — e-mail non envoyé.');
    return generic;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordReset: { tokenHash: hashResetToken(token), expiresAt, requestedAt: new Date() } } }
  );

  const resetUrl = `${managerUrl}/reinitialiser-mot-de-passe?token=${token}`;
  try {
    const { sendTemplate } = await import('./email/emailDelivery.service.js');
    const company = await getSingleton(Company);
    await sendTemplate({
      templateId: 'PASSWORD_RESET_REQUEST',
      recipient: { email: user.email, name: user.name || '', key: keyHash(user.email) },
      variables: {
        'company.name': company?.name || 'votre site',
        'user.name': user.name || user.email,
        'auth.resetUrl': resetUrl,
        'auth.expiresMinutes': String(PASSWORD_RESET_TTL_MINUTES),
      },
    });
  } catch (err) {
    // Jamais d'énumération ni de token dans les logs — seulement le fait.
    logger.warn(`[auth] envoi de l'e-mail de réinitialisation échoué : ${err?.code || err?.message}`);
  }
  return generic;
}

/**
 * Confirmation : consomme un token VALIDE, NON expiré, à USAGE UNIQUE.
 * Le hash bcrypt passe par le pre('save') canonique — jamais à la main.
 */
export async function resetPassword(token, newPassword) {
  const tokenHash = hashResetToken(token);
  const user = await User.findOne({
    'passwordReset.tokenHash': tokenHash,
    'passwordReset.expiresAt': { $gt: new Date() },
  }).select('+password +passwordReset');
  if (!user) {
    throw ApiError.badRequest('Lien invalide, expiré ou déjà utilisé. Redemandez un lien de réinitialisation.', {
      code: 'PASSWORD_RESET_TOKEN_INVALID',
    });
  }
  user.password = newPassword;
  user.passwordReset = null; // usage unique : le token meurt ici
  await user.save();
  logger.info(`[auth] mot de passe réinitialisé (compte ${keyHash(user.email)}).`); // empreinte, jamais l'adresse
  return { message: 'Mot de passe mis à jour. Vous pouvez vous connecter.' };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('Compte introuvable');

  const valid = await user.comparePassword(currentPassword);
  if (!valid) throw ApiError.badRequest('Le mot de passe actuel est incorrect');

  user.password = newPassword;
  await user.save();
  return user.toJSON();
}
