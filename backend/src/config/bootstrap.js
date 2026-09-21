import { User } from '../models/User.model.js';
import { Company } from '../models/Company.model.js';
import { Theme } from '../models/Theme.model.js';
import { HomeContent } from '../models/HomeContent.model.js';
import { ManagerTheme } from '../models/ManagerTheme.model.js';
import { SiteStatus } from '../models/SiteStatus.model.js';

import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import Contract from '../models/Contract.model.js';
import { RoleAppearance } from '../models/RoleAppearance.model.js';
import { EmailConfiguration } from '../models/EmailConfiguration.model.js';
import { getSingleton } from '../utils/singleton.js';
import { refreshCorsOrigins } from './corsOrigins.js';
import {
  validateEncryptionKeyAtBoot,
  seedIntegratedApis,
  migrateIntegratedApiModes,
} from './integratedApiBootstrap.js';
import { reconcileSiteStatus } from '../services/siteEnforcement.service.js';
import { purgePanelProvidedApis } from '../services/panelConfiguration/panelConfiguration.service.js';
import { activeProviders } from '../utils/integratedApiCatalog.js';
/**
 * LE RAPPORT D'AMORÇAGE — chaque étape y dépose un constat TYPÉ, avec sa
 * preuve. C'est lui qui transforme un journal en conclusion, et « API PRÊTE »
 * en décision plutôt qu'en habitude.
 */
import {
  BOOT_SECTION,
  BOOT_OUTCOME,
  recordCheck,
} from '../services/lifecycle/bootstrapReport.service.js';
import {
  auditIntegratedApiStartup,
  replayStartupReconciliations,
} from '../services/lifecycle/integratedApiStartup.service.js';
import {
  registerStartupJob,
  scheduleStartupRetry,
  pendingStartupJobCount,
} from '../services/lifecycle/startupReconciliation.service.js';
/**
 * LES REPRISES STRUCTURELLES — importées ICI parce qu'elles font désormais
 * partie de la PRÉPARATION, et non plus d'un après-coup dans `server.js`.
 */
import {
  runStructuralRecovery,
  assertStructuralInvariants,
  structuralRecoveryCompleted,
} from '../services/lifecycle/structuralRecovery.service.js';
import { isAcceptingWork as lifecycleAcceptingWork } from '../services/lifecycle/runtimeLifecycle.js';
import { ROLES } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { config } from './env.js';

const FIRST_ACCOUNT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * ══ L'AMORÇAGE DES COMPTES D'ADMINISTRATION — RÉÉCRIT PAR LE LOT 2C ═════════
 *
 * ── CE QUI SE TROUVAIT ICI, ET POURQUOI C'ÉTAIT UN DÉFAUT ───────────────────
 *
 * Deux comptes étaient créés au premier démarrage avec des mots de passe écrits
 * dans ce fichier : `123dev` et `123admin`. Chaque projet dupliqué recevait les
 * mêmes. La duplication pouvait les remplacer via `SEED_DEV_PASSWORD`, mais le
 * remplaçant était alors écrit EN CLAIR dans le `.env` de la copie, où il
 * restait — et le défaut public revenait dès que la variable manquait.
 *
 * Le problème n'était pas la faiblesse de `123dev` : c'était son UNIVERSALITÉ.
 * Un secret identique sur N projets ne vaut que le moins bien gardé des N.
 *
 * ── CE QUI LE REMPLACE ──────────────────────────────────────────────────────
 *
 * Un compte est créé SANS mot de passe, et son titulaire choisit le sien par un
 * lien à usage unique (`localDevBootstrap.service.js`). Aucun secret ne
 * transite, aucun n'est écrit sur un disque, aucun n'est partagé entre projets.
 *
 * ── ET SANS ADRESSE EXPLICITE ? ─────────────────────────────────────────────
 *
 * Rien n'est créé. L'ancien code retombait sur `dev@mail.com` — une adresse que
 * personne ne relève, sur un compte que tout le monde pouvait deviner. Un
 * projet sans administrateur se répare en une minute ; un projet avec un
 * administrateur que personne n'a choisi ne se répare qu'après l'incident.
 *
 * ── POURQUOI L'ADMIN DISPARAÎT DE L'AMORÇAGE AUTOMATIQUE ────────────────────
 *
 * `admin@mail.com` n'est l'adresse de personne. Créer un compte en attente
 * d'activation sur une boîte fictive aurait produit un lien parti nulle part,
 * et un compte bloqué à vie. Le premier développeur crée le compte du client
 * depuis le Manager, où il voit à qui il l'attribue. Un `FIRST_ADMIN_EMAIL`
 * explicite reste accepté pour les créations automatisées.
 */
function resolveFirstAccount(role) {
  const cles = role === ROLES.DEV
    ? { email: 'FIRST_DEV_EMAIL', legacyEmail: 'SEED_DEV_EMAIL', name: 'FIRST_DEV_NAME', defaultName: 'Développeur' }
    : { email: 'FIRST_ADMIN_EMAIL', legacyEmail: null, name: 'FIRST_ADMIN_NAME', defaultName: 'Administrateur' };

  let email = String(process.env[cles.email] || '').trim().toLowerCase();
  /**
   * `SEED_DEV_EMAIL` EST ACCEPTÉE, DÉPRÉCIÉE ET BRUYANTE.
   *
   * Les copies produites avant ce lot portent cette variable dans leur `.env`.
   * L'ignorer d'un coup laisserait un projet en cours d'installation sans
   * premier développeur, pour une raison que rien n'expliquerait. On la lit
   * donc encore — sans jamais lire son ancienne jumelle `SEED_DEV_PASSWORD`,
   * qui est le vrai défaut et qui, elle, est morte.
   */
  if (!email && cles.legacyEmail) {
    const legacy = String(process.env[cles.legacyEmail] || '').trim().toLowerCase();
    if (FIRST_ACCOUNT_EMAIL_RE.test(legacy)) {
      logger.warn(
        `[bootstrap] ${cles.legacyEmail} est dépréciée : renommez-la en ${cles.email} dans le .env.`
      );
      email = legacy;
    }
  }
  if (!FIRST_ACCOUNT_EMAIL_RE.test(email)) return null;
  return { email, name: String(process.env[cles.name] || '').trim() || cles.defaultName, role };
}

/**
 * Amorçage IDEMPOTENT des comptes d'administration.
 *
 * Les deux gardes historiques sont conservées — elles étaient justes, c'est le
 * credential qui ne l'était pas :
 *  1. AU PLUS UN compte par rôle structurel : si un compte de ce rôle existe
 *     déjà, quelle que soit son adresse, aucun second n'est créé — même si
 *     `FIRST_DEV_EMAIL` a changé depuis ;
 *  2. AUCUN ÉCRASEMENT : un compte existant n'est jamais modifié.
 */
export async function seedDefaultUsers() {
  const { ensureInitialLocalUser } = await import('../services/localDevBootstrap.service.js');
  const created = [];
  for (const role of [ROLES.DEV, ROLES.ADMIN]) {
    const souhaite = resolveFirstAccount(role);
    if (!souhaite) {
      // Rien à créer pour ce rôle. Le DEV est le seul dont l'absence se signale :
      // sans lui, personne ne peut administrer le projet.
      if (role === ROLES.DEV && !(await User.exists({ role: ROLES.DEV }))) {
        logger.warn(
          '[bootstrap] FIRST_DEV_REQUIRED — aucun compte développeur : renseignez FIRST_DEV_EMAIL '
            + '(et FIRST_DEV_NAME) dans le .env, puis redémarrez.'
        );
      }
      continue;
    }
    const issue = await ensureInitialLocalUser(souhaite);
    if (issue.status === 'CREATED') {
      created.push({ email: souhaite.email, role, activationEmailSent: issue.emailSent });
    }
  }
  return created;
}

/* ══════════════════════════════════════════════════════════════════════════
   AUCUNE DONNÉE CLIENT N'EST PLUS INJECTÉE AU DÉMARRAGE.

   ══ CE QUI VIVAIT ICI ════════════════════════════════════════════════════

   Vingt avis nominatifs, cinq questions de FAQ, treize prestations
   complémentaires et suppléments — tarifs compris — répartis dans les
   catégories par correspondance de mots-clés sur leur titre. C'était le
   catalogue d'UN client, écrit dans le code applicatif de TOUS.

   Conséquence directe : tout projet dupliqué naissait avec les avis, la FAQ
   et les extras de SB Auto. Un centre de detailing héritait de « Lavage
   moto » ; un nettoyeur de bateaux, de « Poils d'animaux ». Et la FAQ
   affirmait que « nos tarifs s'adaptent au gabarit du véhicule (citadine,
   berline, SUV, monospace) » — une phrase qu'aucun opérateur n'avait écrite,
   sur un site qui pouvait ne rien avoir d'automobile.

   ══ POURQUOI LE RETRAIT NE PERD RIEN ═════════════════════════════════════

   Les trois amorçages étaient GARDÉS : ils ne s'exécutaient que sur une
   collection vide. Sur la base réelle, les avis, la FAQ et les extras
   existent déjà — ils y ont été écrits une fois, puis retravaillés par le
   client. Les gardes ne s'ouvraient donc plus, et le code ne faisait plus
   rien depuis longtemps. Le vérifier AVANT de supprimer était la seule
   manière de le savoir ; `catalog-no-seed.test.js` le verrouille désormais.

   ══ CE QUI LES REMPLACE ══════════════════════════════════════════════════

   Rien, et c'est le but. Un projet neuf démarre vide : zéro service, zéro
   catégorie, zéro forfait, zéro gamme, zéro avis, zéro question. Le contenu
   vient du Manager, d'un import, ou d'un seed client EXPLICITE — jamais du
   runtime générique.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Migration : initialise `signer` à null sur les fiches Entreprise qui n'en ont
 * pas (toutes celles créées avant les signataires contractuels configurables).
 *
 * Idempotente par construction : le filtre `$exists: false` ne matche plus rien
 * après le premier passage. Le champ est explicitement posé à `null` (plutôt
 * que laissé absent) pour que « pas encore configuré » soit un état lisible en
 * base et non une devinette. Aucune donnée existante n'est touchée : on n'écrit
 * que sur les documents où le champ est absent.
 *
 * ══ POURQUOI ELLE SURVIT À LA BASCULE D'AUTORITÉ ═══════════════════════════
 *
 * Le signataire client vient désormais du Panel (`ClientCompany
 * .contractualSigner`), et `Company.signer` est un champ GELÉ — plus aucune
 * écriture ne le renseigne, plus aucune lecture métier ne s'en sert.
 *
 * Cette migration reste néanmoins, et il ne faut pas la retirer : elle ne
 * FABRIQUE rien, elle rend seulement lisible un état absent. La supprimer
 * laisserait les fiches antérieures sans le champ, et la lecture d'archive
 * — « quel signataire ce projet déclarait-il avant la bascule ? » — ne saurait
 * plus distinguer « jamais configuré » de « champ jamais posé ».
 *
 * Voir docs/CONTRACT_SIGNERS.md.
 */
async function migrateCompanySigners() {
  let initialized = 0;
  // La fiche CLIENT porte encore le champ, GELÉ : l'autorité du signataire
  // client est passée au Panel, comme celle du développeur avant elle.
  for (const Model of [Company]) {
    const res = await Model.collection.updateMany(
      { signer: { $exists: false } },
      { $set: { signer: null } }
    );
    initialized += res.modifiedCount || 0;
  }
  if (initialized) {
    logger.info(`Migration: signataire contractuel initialisé à null (${initialized} fiche(s))`);
  }
}

/**
 * ══ BACKFILL : LA RÉCURRENCE D'ABONNEMENT DES CONTRATS EXISTANTS ════════════
 *
 * ── CE QU'IL TRADUIT ────────────────────────────────────────────────────────
 *
 *     interval: 'MONTH'  →  recurrence: { unit: 'MONTH', interval: 1 }
 *     interval: 'YEAR'   →  recurrence: { unit: 'YEAR',  interval: 1 }
 *
 * Rien d'autre. Aucun montant n'est recalculé, aucune périodicité n'est
 * réinterprétée : « 768 € par an » reste « 768 € tous les ans ». Toucher au
 * montant historique d'un contrat signé serait réécrire un engagement.
 *
 * ── POURQUOI LE DRIVER NATIF, ET UN FILTRE SUR L'ABSENCE ────────────────────
 *
 * `updateMany` avec `recurrence: { $exists: false }` fait de l'idempotence une
 * propriété du FILTRE, pas une précaution de l'appelant : au deuxième passage,
 * plus aucun document ne correspond, et rien n'est réécrit. Un contrat déjà
 * migré — ou saisi depuis — ne peut donc pas être ramené à « tous les 1 mois »
 * par une reprise, ce qu'une boucle « lire, décider, sauvegarder » aurait fini
 * par faire le jour d'une erreur de garde.
 *
 * Le driver natif court-circuite les validateurs Mongoose : le parc contient
 * des contrats anciens dont d'autres champs ne satisferaient plus le schéma
 * courant, et un backfill de périodicité n'a aucune raison de buter dessus.
 *
 * ── LES CONTRATS SANS PÉRIODICITÉ DU TOUT ───────────────────────────────────
 *
 * Ils existent : brouillons d'avant l'abonnement, documents partiels. Ils
 * reçoivent « tous les 1 mois », qui est exactement ce que le code leur
 * appliquait déjà par défaut. On n'invente donc aucune offre — on écrit ce qui
 * était déjà lu.
 */
async function migrateContractSubscriptionRecurrence() {
  const cible = 'pricing.subscription.recurrence';
  let migres = 0;

  for (const unit of ['MONTH', 'YEAR']) {
    const res = await Contract.collection.updateMany(
      { [cible]: { $exists: false }, 'pricing.subscription.interval': unit },
      { $set: { [cible]: { unit, interval: 1 } } }
    );
    migres += res.modifiedCount || 0;
  }

  // Ni `recurrence`, ni `interval` héritée : le défaut historique, écrit.
  const orphelins = await Contract.collection.updateMany(
    {
      [cible]: { $exists: false },
      'pricing.subscription.interval': { $nin: ['MONTH', 'YEAR'] },
    },
    { $set: { [cible]: { unit: 'MONTH', interval: 1 } } }
  );
  migres += orphelins.modifiedCount || 0;

  if (migres) {
    logger.info(`Migration: récurrence d'abonnement initialisée (${migres} contrat(s))`);
  }
}

/**
 * Migration : configuration e-mail « miroir de Brevo » -> modèle simplifié.
 *
 * ANCIEN document : `sender { email, name, modes.{TEST,PROD}{verificationStatus,
 * providerSenderId, verifiedAt, lastErrorSafe, …} }` + `domain { domain,
 * modes.{TEST,PROD}{status, brevoDomainId, authenticated, verified, dnsRecords,
 * …} }`.
 *
 * NOUVEAU document : `modes.{TEST,PROD}{ sender{email,name}, test{…} }`.
 *
 * ─── POURQUOI LE DRIVER NATIF ────────────────────────────────────────────────
 *
 * Le schéma actuel ne déclare plus `sender` ni `domain`. Hydrater l'ancien
 * document avec Mongoose les IGNORERAIT purement et simplement : l'adresse et le
 * nom seraient perdus au premier `save()`. La reprise doit donc lire le document
 * BRUT et écrire avant toute hydratation — d'où l'appel en tête de `bootstrap()`,
 * avant `getSingleton(EmailConfiguration)`.
 *
 * Le driver natif évite en prime tout cast : les anciens `lastErrorSafe` (string
 * chez l'expéditeur, objet chez le domaine) ne traversent aucun validateur.
 *
 * ─── CE QUI EST CONSERVÉ, CE QUI EST JETÉ ────────────────────────────────────
 *
 * L'identité (adresse + nom) était PARTAGÉE entre les modes ; elle est désormais
 * par mode. On la RECOPIE donc à l'identique dans TEST et PROD : c'est le seul
 * choix qui ne perd rien et ne ment pas — les deux modes utilisaient réellement
 * cette adresse. Tout le reste (OTP, statuts de vérification, domaine, DKIM,
 * DNS) est supprimé : ces états vivent chez Brevo.
 *
 * IDEMPOTENTE : ne touche qu'aux documents portant encore un `sender.email` de
 * l'ancienne forme, et rejouable sans risque.
 */
export async function migrateEmailConfigurationToSimpleModel() {
  const legacy = await EmailConfiguration.collection
    .find({ $or: [{ sender: { $exists: true } }, { domain: { $exists: true } }] })
    .toArray();
  if (legacy.length === 0) return 0;

  for (const doc of legacy) {
    /**
     * ── L'IDENTITÉ N'EST PLUS REPRISE (R10.5B) ────────────────────────────────
     *
     * Cette migration recopiait `sender` de l'ancienne forme partagée vers les
     * deux modes. Le champ n'existe plus : l'expéditeur du parc est unique et
     * détenu par le Panel. Continuer à l'écrire ressusciterait, sur les bases
     * les plus anciennes, exactement la surface que le lot supprime.
     *
     * Le reste de la migration garde tout son sens : elle crée la structure par
     * mode et retire les états OTP/domaine, qui vivent chez Brevo.
     */
    const set = {};
    for (const mode of ['TEST', 'PROD']) {
      if (doc.modes?.[mode]) continue;
      set[`modes.${mode}`] = {
        // Aucun test n'a jamais été fait dans l'ancien modèle : le statut de
        // vérification legacy ne prouvait PAS qu'un e-mail était déjà parti.
        test: {
          status: 'NOT_TESTED',
          lastTestedAt: null,
          lastSuccessAt: null,
          lastMessageIdSafe: '',
          lastErrorSafe: { code: '', message: '' },
        },
      };
    }

    await EmailConfiguration.collection.updateOne(
      { _id: doc._id },
      {
        ...(Object.keys(set).length ? { $set: set } : {}),
        $unset: { sender: '', domain: '' },
      }
    );
  }

  logger.info(
    `Migration: configuration e-mail simplifiée (${legacy.length} document(s)) — ` +
      'identité reprise dans TEST et PROD, états OTP/domaine supprimés.'
  );
  return legacy.length;
}

/**
 * Migration : ancien statut de test `SUCCESS` (doctrine « messageId = réussi »)
 * → `NOT_TESTED`.
 *
 * `SUCCESS` n'existe plus dans l'énumération : un document qui le porte encore
 * ferait échouer la validation Mongoose au prochain enregistrement. Surtout,
 * `SUCCESS` ne prouvait qu'une ACCEPTATION, jamais une livraison — le remettre à
 * `NOT_TESTED` est la seule valeur honnête : sans livraison confirmée, on ne peut
 * pas affirmer que la configuration fonctionne. `FAILED` reste valide et intact.
 *
 * Driver natif, idempotente.
 */
export async function migrateEmailTestStatus() {
  let fixed = 0;
  for (const mode of ['TEST', 'PROD']) {
    const path = `modes.${mode}.test.status`;
    const res = await EmailConfiguration.collection.updateMany(
      { [path]: 'SUCCESS' },
      {
        $set: { [path]: 'NOT_TESTED' },
        // Champs de l'ancienne forme, sans objet dans la nouvelle doctrine.
        $unset: {
          [`modes.${mode}.test.lastSuccessAt`]: '',
          [`modes.${mode}.test.lastMessageIdSafe`]: '',
        },
      }
    );
    fixed += res.modifiedCount || 0;
  }
  if (fixed) logger.info(`Migration: test.status SUCCESS -> NOT_TESTED (${fixed} mode(s), livraison jamais confirmée)`);
  return fixed;
}

/**
 * PURGE DE L'EXPÉDITEUR LOCAL — après preuve cumulative (R10.5B).
 *
 * ── POURQUOI CETTE PURGE EST LÉGITIME, ET QUAND ELLE NE L'AURAIT PAS ÉTÉ ────
 *
 * La doctrine du lot interdit de supprimer une donnée tant qu'un lecteur, un
 * writer, un écran, une projection, un diagnostic, un webhook ou une migration
 * en dépend. Les sept conditions sont réunies AVANT cette ligne, et c'est
 * l'ordre qui les rend vraies :
 *
 *   · plus aucun service ne lit `modes[].sender` ;
 *   · plus aucune route ni contrôleur ne l'écrit ;
 *   · la projection Manager ne l'expose plus ;
 *   · le diagnostic ne le consulte plus ;
 *   · la migration legacy ne le réécrit plus.
 *
 * Sans cet ordre, la purge aurait vidé un champ encore affiché, et l'écran
 * aurait montré une adresse vide là où il montrait une adresse fausse — un
 * progrès nul.
 *
 * ── `$unset` CIBLÉ, ET RIEN D'AUTRE ────────────────────────────────────────
 *
 * On ne touche qu'aux deux chemins concernés. Un `$set` de document entier
 * écraserait l'état de test, qui reste utile et n'a rien à voir.
 *
 * IDEMPOTENTE : le filtre exige la PRÉSENCE du champ, donc un second passage
 * ne modifie plus rien — ce que la recette de purge vérifie explicitement.
 */
export async function purgeLocalSenderIdentity({ dryRun = false } = {}) {
  let candidates = 0;
  let purged = 0;
  for (const mode of ['TEST', 'PROD']) {
    const path = `modes.${mode}.sender`;
    const filter = { [path]: { $exists: true } };
    candidates += await EmailConfiguration.collection.countDocuments(filter);
    if (dryRun) continue;
    const res = await EmailConfiguration.collection.updateMany(filter, { $unset: { [path]: '' } });
    purged += res.modifiedCount || 0;
  }
  if (dryRun) return { candidates, purged: 0, dryRun: true };
  if (purged) {
    logger.info(
      `Migration: expéditeur local retiré (${purged} mode(s)) — l’expéditeur du parc est détenu par le Panel.`,
    );
  }
  return { candidates, purged, dryRun: false };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  L'AMORÇAGE — QUATRE ÉTAPES, UN ORDRE QUI EST UNE DÉPENDANCE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── LE DÉFAUT QUE CETTE STRUCTURE FERME ────────────────────────────────────
 *
 * L'ordre du démarrage était celui des lignes, pas celui des dépendances. La
 * réconciliation des webhooks venait AVANT la restauration de l'appairage, si
 * bien que le provisionnement Stripe — qui passe par le Panel depuis L6.3A —
 * était systématiquement sauté :
 *
 *     Webhook STRIPE/payment (TEST) : réconciliation sautée (PANEL_NOT_PAIRED).
 *     Pont Panel : appairage restauré (Panel L.Y Solution).
 *     …
 *     API PRÊTE
 *
 * Le Panel arrivait DEUX LIGNES plus bas. Rien ne relançait le geste, rien ne
 * le comptait, et « PRÊTE » ne recouvrait aucune vérification.
 *
 * ── L'ORDRE, ET CE QUI LE JUSTIFIE ─────────────────────────────────────────
 *
 *   ENV → Mongo (server.js)
 *     ↓
 *   1. CŒUR      clé de chiffrement, comptes, reprises de données, singletons,
 *                catalogue IntegratedAPI. Rien de ce qui suit n'est lisible
 *                sans lui.
 *     ↓
 *   2. PANEL     persistance de l'appairage, HYDRATATION, câblage du pont.
 *                Placé ICI parce que les IntegratedAPI sous autorité Panel en
 *                dépendent — c'est le correctif, et il tient dans l'ordre.
 *     ↓
 *   3. INTEGRATED APIs   réconciliation des webhooks, puis AUDIT : chaque
 *                fournisseur reçoit un état, une preuve ou une reprise.
 *     ↓
 *   4. SERVICES  déclencheurs, photographie, ordonnanceur, veille de tunnel.
 *                Après, parce qu'ils supposent tout ce qui précède branché.
 *     ↓
 *   INVARIANTS puis READY (server.js)
 *
 * ── CE QUE L'ORDRE NE SUFFIT PAS À GARANTIR ────────────────────────────────
 *
 * Un appairage peut arriver APRÈS le démarrage — un développeur qui appaire
 * depuis le Manager. L'ordre n'y peut rien : c'est l'observateur d'appairage
 * (`onPairingChanged`) et le gestionnaire de reprises qui rejouent alors les
 * gestes restés dus. Les deux mécanismes sont nécessaires ; aucun ne remplace
 * l'autre.
 */

/**
 * LES RESSOURCES QUE CE MODULE DÉMARRE — mémorisées pour pouvoir les fermer.
 *
 * Un amorçage rejoué dans le MÊME processus (recettes, redémarrage à chaud) ne
 * doit pas empiler une seconde veille de tunnel ni un second abonnement à
 * l'appairage. Les garder ici est ce qui rend `bootstrap()` idempotent sur ses
 * effets de bord, et non seulement sur ses écritures.
 */
let veilleTunnel = null;
let desabonnerAppairage = null;

/**
 * BORNE une promesse — et rend TROIS informations, jamais une seule.
 *
 * ── POURQUOI PAS UN SIMPLE `.catch(() => null)` ─────────────────────────────
 *
 * Parce que `null` confond deux faits que le démarrage doit distinguer :
 * « le geste a échoué, voici pourquoi » et « le geste n'a pas répondu à
 * temps ». Les aplatir produirait exactement le constat sans cause que ce lot
 * supprime — un DEGRADED dont personne ne peut dire ce qu'il faut réparer.
 *
 * @returns {Promise<{valeur: any, erreur: Error|null, expire: boolean}>}
 */
async function avecPlafond(promesse, ms) {
  const EXPIRE = Symbol('délai dépassé');
  let erreur = null;
  const issue = await Promise.race([
    Promise.resolve(promesse).catch((err) => { erreur = err; return null; }),
    new Promise((resoudre) => {
      const t = setTimeout(() => resoudre(EXPIRE), ms);
      t.unref?.();
    }),
  ]);
  return { valeur: issue === EXPIRE ? null : issue, erreur, expire: issue === EXPIRE };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  1. CŒUR                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

async function amorcerCoeur() {
  /**
   * COFFRE-FORT DES SECRETS — fail-closed en PROD, et le constat est COMPTÉ.
   *
   * En PROD, une clé absente ou mal formée lève : `server.js` journalise et
   * arrête le processus. En TEST, elle n'est qu'un avertissement — mais un
   * avertissement qui apparaît désormais dans le résumé, au lieu de se perdre
   * entre deux migrations.
   */
  const crypto = validateEncryptionKeyAtBoot();
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Chiffrement IntegratedAPI',
    outcome: crypto.ok ? BOOT_OUTCOME.OK : BOOT_OUTCOME.DEGRADED,
    proof: crypto.ok ? crypto.message : '',
    reason: crypto.ok ? '' : 'ENCRYPTION_KEY_INVALID',
    detail: crypto.ok ? '' : crypto.message,
  });

  const comptes = await seedDefaultUsers();
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Comptes d’administration',
    outcome: BOOT_OUTCOME.OK,
    proof: comptes.length
      ? `${comptes.length} compte(s) créé(s) en attente d’activation`
      : 'aucun compte à créer (amorçage déjà fait)',
  });

  /**
   * ══ LE LIEN D'ACTIVATION QUI N'A PAS PU PARTIR EST UNE DETTE, PAS UN OUBLI ══
   *
   * ── LE DÉFAUT, CONSTATÉ SUR LE PREMIER PROJET DUPLIQUÉ ────────────────────
   *
   * Le compte est créé au premier démarrage ; le courriel, lui, part par le
   * PANEL. Un projet neuf n'est pas encore appairé à cet instant — l'envoi
   * échoue donc, `PROVIDER_NOT_CONFIGURED`, ce qui est parfaitement normal.
   *
   * Ce qui ne l'était pas : plus rien ensuite. Le jeton a expiré au bout d'une
   * heure, l'appairage est arrivé, le projet a été déployé, et le lien n'est
   * finalement parti que parce qu'un humain a pensé à appeler `/activation/
   * resend`. La livraison d'un projet dépendait d'un souvenir.
   *
   * ── POURQUOI UNE OBLIGATION *ARMÉE*, ET NON UNE REPRISE PROGRAMMÉE ────────
   *
   * Parce que la dépendance manquante ne revient pas d'elle-même : un projet
   * autonome n'aura pas de Panel dans quinze secondes, ni dans cinq minutes. Il
   * en aura un le jour où quelqu'un l'appairera. Une reprise programmée
   * martèlerait un rendez-vous que personne n'a pris, puis s'abandonnerait
   * « épuisée » alors que rien n'a échoué.
   *
   * Armée, elle ne consomme aucun minuteur, ne s'épuise jamais, apparaît dans
   * le résumé de démarrage tant qu'elle est due — et part exactement quand
   * l'appairage s'établit, par l'observateur branché en section PANEL.
   *
   * ── ET UN REDÉMARRAGE N'ENVOIE RIEN « AU CAS OÙ » ─────────────────────────
   *
   * L'obligation n'est inscrite que si l'ÉTAT DURABLE la justifie : un compte
   * en attente dont la dernière activation n'est pas partie. Si le lien est
   * parti, rien n'est inscrit et rien ne repart.
   */
  const { pendingActivationDelivery, deliverPendingActivations } = await import(
    '../services/localDevBootstrap.service.js'
  );
  const dette = await pendingActivationDelivery();
  if (dette.due) {
    registerStartupJob({
      key: 'localdev:activation-delivery',
      label: 'Lien d’activation du premier compte',
      gated: true,
      reason: 'EMAIL_PROVIDER_UNAVAILABLE',
      detail: `${dette.accounts.length} compte(s) en attente — le courriel passe par le Panel`,
      run: () => deliverPendingActivations(),
    });
  }
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Lien d’activation du premier compte',
    outcome: dette.due ? BOOT_OUTCOME.DEFERRED : BOOT_OUTCOME.OK,
    proof: dette.due ? '' : 'aucun lien d’activation en souffrance',
    reason: dette.due ? 'EMAIL_PROVIDER_UNAVAILABLE' : '',
    detail: dette.due
      ? `${dette.accounts.length} compte(s) en attente — envoi armé, il partira à l’appairage`
      : '',
  });

  // AVANT de charger le singleton config e-mail : reprendre l'ancienne forme
  // (sender/domain à la racine) vers `modes.{TEST,PROD}`. Hydrater d'abord
  // perdrait l'adresse et le nom — le schéma ne déclare plus ces chemins.
  await migrateEmailConfigurationToSimpleModel();
  // Puis remettre à zéro un `test.status: SUCCESS` legacy (jamais une preuve de
  // livraison) : sinon la validation d'énumération échouerait au prochain save.
  await migrateEmailTestStatus();
  // Enfin, retirer l'expéditeur local devenu inerte (R10.5B).
  await purgeLocalSenderIdentity();

  /**
   * LES SINGLETONS SONT CRÉÉS S'ILS MANQUENT — et RIEN de plus n'en est fait.
   *
   * Aucune destructuration : plus aucun code d'amorçage ne LIT ni ne MUTE ces
   * documents. Les deux migrations qui le faisaient ont été retirées (voir plus
   * bas), et garder les variables aurait laissé croire qu'on s'en sert encore —
   * l'invitation exacte à y rebrancher une réécriture.
   */
  await Promise.all([
    getSingleton(Company),
    getSingleton(HomeContent),
    getSingleton(Theme),
    getSingleton(ManagerTheme),
    getSingleton(SiteStatus),
    getSingleton(SystemConfiguration),
    getSingleton(RoleAppearance),
    getSingleton(EmailConfiguration),
  ]);
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Singletons projet',
    outcome: BOOT_OUTCOME.OK,
    proof: '7 documents uniques chargés (entreprise, thèmes, état du site, configuration, apparences, e-mail)',
  });

  // Module e-mail : templates en base + handler SEND_EMAIL branché sur le
  // dispatcher.
  //
  // ⚠️ AVANT la reprise ci-dessous, et l'ordre n'est pas cosmétique : une
  // exécution SEND_EMAIL reprise au démarrage tomberait sur le handler de repli
  // (« module non enregistré ») et partirait en DEAD_LETTER pour rien.
  try {
    const { initEmailModule } = await import('../services/email/emailModule.js');
    await initEmailModule();
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Module e-mail',
      outcome: BOOT_OUTCOME.OK,
      proof: 'gabarits en base et handler SEND_EMAIL enregistré auprès du dispatcher',
    });
  } catch (err) {
    /**
     * NON BLOQUANT, MAIS PLUS JAMAIS SILENCIEUX.
     *
     * L'erreur partait dans `logger.error` et s'arrêtait là : le résumé de
     * démarrage ne pouvait pas la compter, et un projet incapable d'envoyer le
     * moindre e-mail annonçait néanmoins un démarrage nominal.
     */
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Module e-mail',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'EMAIL_MODULE_INIT_FAILED',
      detail: `aucun e-mail ne pourra partir — ${err?.message || err}`,
    });
  }

  // Reprise des actions d'événements laissées en plan par un arrêt brutal. Le
  // dispatch est normalement immédiat après l'émission ; ce passage rattrape les
  // exécutions orphelines (verrou expiré) et les échecs retryable en attente.
  try {
    const { processPendingEventActions } = await import('../services/events/domainEventDispatcher.service.js');
    const { processed } = await processPendingEventActions();
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Reprise des actions d’événements',
      outcome: BOOT_OUTCOME.OK,
      proof: processed > 0 ? `${processed} action(s) orpheline(s) reprise(s)` : 'aucune action en attente',
    });
  } catch (err) {
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Reprise des actions d’événements',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'EVENT_REPLAY_FAILED',
      detail: String(err?.message || err),
    });
  }


  /**
   * ══ DEUX MIGRATIONS ONT ÉTÉ RETIRÉES ICI, ET C'EST UN CORRECTIF ═══════════
   *
   * ── CE QU'ELLES FAISAIENT ────────────────────────────────────────────────
   *
   *   1. « si le thème est resté sur l'ancien défaut clair, basculer sur le
   *      défaut sombre » — testé sur `colors.background === '#ffffff'` ;
   *   2. « retirer le média "site internet" » — à chaque démarrage.
   *
   * ── POURQUOI ELLES ÉTAIENT NUISIBLES ─────────────────────────────────────
   *
   * Elles s'exécutaient à CHAQUE amorçage, indéfiniment, alors qu'une
   * migration est par nature un passage UNIQUE. Ce qui les rendait
   * inoffensives le premier jour les rendait destructrices ensuite :
   *
   *   · un opérateur qui choisit délibérément un thème à fond BLANC voyait sa
   *     palette entière — fond, texte, primaire, accent — réécrite au
   *     redémarrage suivant. C'est le symptôme rapporté : « la police du thème
   *     revient toute seule » ;
   *   · un opérateur qui rajoute son site dans ses canaux de contact le voyait
   *     disparaître au prochain démarrage, sans message.
   *
   * Une reprise de données ne se distingue d'une réinitialisation périodique
   * que par sa CONDITION DE SORTIE. Celles-ci n'en avaient aucune : leur
   * condition était l'état courant, qu'un humain a le droit de reproduire.
   *
   * ── LE PARC EST DÉJÀ PASSÉ ───────────────────────────────────────────────
   *
   * Les deux ont tourné à chaque démarrage depuis leur livraison. Il n'existe
   * plus aucune base qui en ait besoin, et les rejouer ne peut donc plus
   * produire qu'un dégât.
   *
   * ── LA RÈGLE, DÉSORMAIS ──────────────────────────────────────────────────
   *
   * L'amorçage ne MUTE PLUS aucun contenu client : ni thème, ni entreprise, ni
   * catalogue. Il crée les singletons manquants, aligne les SCHÉMAS, et rien
   * d'autre. Voir `docs/PROTOCOL.md` § « Seeds et résidus de seed ».
   */

  /**
   * AUCUN CONTENU N'EST INJECTÉ ICI — ni en TEST, ni en PROD.
   *
   * Le garde `isProd` qui protégeait la production disait déjà que ces données
   * n'avaient rien à faire dans une base réelle. Il ne les protégeait qu'à
   * moitié : la base de TEST est celle du client, et c'est bien elle que les
   * seeds ont peuplée.
   *
   * Le démarrage ne mute plus le catalogue. C'est ce que
   * `catalog-no-seed.test.js` vérifie, en comptant AVANT et APRÈS un bootstrap
   * complet sur une base déjà remplie.
   */

  // Migrations structurelles idempotentes (jamais du contenu).
  await migrateCompanySigners(); // signer=null sur les fiches Entreprise antérieures
  await migrateContractSubscriptionRecurrence(); // mensuel/annuel -> { unit, interval }
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Reprises de données',
    outcome: BOOT_OUTCOME.OK,
    proof: 'signataires, récurrences et configuration e-mail alignés sur le schéma courant',
  });

  /**
   * LE CATALOGUE INTEGRATED API AVANT TOUT LE RESTE DE SON MONDE.
   *
   * La réconciliation des webhooks lit `IntegratedApi`, et le provisionnement
   * Stripe y ÉCRIT son secret de vérification. Un fournisseur absent du
   * registre ferait échouer les deux avec `PROVIDER_NOT_REGISTERED` — une
   * panne dont la cause serait un ordre d'exécution, ce qui est la pire espèce.
   */
  await migrateIntegratedApiModes(); // environments->modes + activeMode (idempotent, sans perte)
  await seedIntegratedApis(); // catalogue (credentials vides, idempotent)
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Catalogue IntegratedAPI',
    outcome: BOOT_OUTCOME.OK,
    proof: `${activeProviders().length} fournisseur(s) actif(s) inscrits au registre local`,
  });

  /**
   * PURGE DES IDENTIFIANTS HÉRITÉS DU PANEL (lot L4) — idempotente.
   *
   * Une instance appairée avant L4 détient, chiffrés, des identifiants
   * fournisseurs que le Panel lui avait envoyés et qu'aucun module n'a jamais
   * lus. Le modèle a disparu ; les documents, eux, seraient restés.
   */
  try {
    await purgePanelProvidedApis();
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Purge des identifiants hérités du Panel',
      outcome: BOOT_OUTCOME.OK,
      proof: 'aucun identifiant fournisseur livré par le Panel ne subsiste en base',
    });
  } catch (err) {
    recordCheck({
      section: BOOT_SECTION.CORE,
      name: 'Purge des identifiants hérités du Panel',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'LEGACY_PURGE_FAILED',
      detail: `${err?.message || err} — nouvelle tentative au prochain démarrage`,
    });
  }

  await reconcileSiteStatus(); // aligne le statut du site sur l'enforcement + contrats
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'État du site',
    outcome: BOOT_OUTCOME.OK,
    proof: 'accessibilité recalculée depuis les contrats et l’enforcement',
  });

  await refreshCorsOrigins(); // charge managerUrl/websiteUrl configurées dans le cache CORS
  recordCheck({
    section: BOOT_SECTION.CORE,
    name: 'Origines CORS',
    outcome: BOOT_OUTCOME.OK,
    proof: 'cache rechargé depuis la configuration réseau',
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  2. PANEL — AVANT les IntegratedAPI, et c'est le cœur du correctif         */
/* ────────────────────────────────────────────────────────────────────────── */

async function amorcerPanel() {
  const contexte = { restored: null, wired: false, modules: null };

  try {
    const { configurePairingPersistence, hydratePairing, onPairingChanged } = await import(
      '../services/panelBridge/pairingStore.js'
    );
    const { createMongoPairingAdapter } = await import(
      '../services/panelBridge/persistence/mongoPairingAdapter.js'
    );
    configurePairingPersistence(createMongoPairingAdapter());

    /**
     * ══ L'APPAIRAGE QUI ARRIVE PLUS TARD ═══════════════════════════════════
     *
     * L'ordre corrige le cas du DÉMARRAGE. Il ne peut rien pour l'autre : un
     * développeur qui appaire depuis le Manager trois minutes après le boot.
     * Sans cet abonnement, tout ce qui avait été différé faute de Panel
     * resterait différé jusqu'au prochain redémarrage — et le webhook Stripe
     * d'un projet fraîchement appairé n'existerait jamais.
     *
     * L'abonnement est UNIQUE : un amorçage rejoué dans le même processus
     * désabonne d'abord. Deux abonnements rejoueraient deux fois chaque
     * reprise — inoffensif grâce à l'idempotence, mais illisible.
     */
    desabonnerAppairage?.();
    desabonnerAppairage = onPairingChanged((evenement) => {
      if (evenement.type !== 'PAIRED') return;
      void replayStartupReconciliations(`panel-${String(evenement.source).toLowerCase()}`);
    });

    const restored = await hydratePairing();
    contexte.restored = restored;
    recordCheck({
      section: BOOT_SECTION.PANEL,
      name: 'Appairage Panel',
      outcome: restored ? BOOT_OUTCOME.OK : BOOT_OUTCOME.NOT_REQUIRED,
      proof: restored
        ? `restauré depuis la base chiffrée — « ${restored.panelName || restored.panelUrl} »`
        : '',
      reason: restored ? '' : 'STANDALONE',
      detail: restored ? '' : 'aucun appairage persisté — mode autonome (état normal)',
    });

    /**
     * ══ LE CURSEUR DE CONSOMMATION — RESTAURÉ, ET C'EST LE GESTE DU LOT ══════
     *
     * ── CE QUI SE PASSAIT AVANT ────────────────────────────────────────────
     *
     * Le curseur de tirage vivait dans une propriété d'instance du pont. Il ne
     * survivait donc ni à un redémarrage, ni à une release, ni à un
     * `pm2 restart` : le projet repartait du curseur reçu à l'appairage —
     * c'est-à-dire, en pratique, de zéro — et rejouait tout le journal.
     *
     * ── POURQUOI L'HYDRATATION VIENT APRÈS CELLE DE L'APPAIRAGE ────────────
     *
     * Elle a besoin de savoir À QUEL PROJET le curseur appartient. Un curseur
     * est une position dans un journal FILTRÉ par destinataire : le conserver
     * après un réappairage ferait démarrer le nouveau projet au milieu d'un
     * journal qui ne le concernait pas, et tout ce qui précède serait sauté,
     * définitivement. C'est la SEULE remise à zéro légitime, avec le changement
     * de génération — et les deux se détectent ici, pas ailleurs.
     */
    const { createMongoSyncStateAdapter } = await import(
      '../services/panelBridge/persistence/mongoSyncStateAdapter.js'
    );
    const {
      configureConsumptionPersistence, hydrateConsumption,
      claimConsumerLease, PROCESS_IDENTITY, CONSUMER_LEASE_TTL_MS,
    } = await import('../services/panelBridge/consumptionStore.js');
    configureConsumptionPersistence(createMongoSyncStateAdapter());
    const consommation = await hydrateConsumption({
      projectId: restored?.projectId ?? null,
      generation: config.env,
    });
    recordCheck({
      section: BOOT_SECTION.PANEL,
      name: 'Curseur de consommation',
      outcome: consommation.restored ? BOOT_OUTCOME.OK : BOOT_OUTCOME.NOT_REQUIRED,
      proof: consommation.restored
        ? 'restauré — le rattrapage reprend où il s’était arrêté'
        : '',
      reason: consommation.restored ? '' : (consommation.reason ?? 'AUCUN'),
      detail: consommation.restored
        ? ''
        : {
          NOTHING_STORED: 'aucun curseur persisté — le rattrapage repart de l’origine',
          PROJECT_CHANGED: 'le projet appairé a changé — curseur remis à zéro (correct)',
          GENERATION_CHANGED: 'l’environnement a changé — curseur remis à zéro (correct)',
          NO_PERSISTENCE: 'aucune persistance branchée',
        }[consommation.reason] ?? '',
    });

    /**
     * ══ LE BAIL DE CONSOMMATION — RÉCLAMÉ AVANT TOUTE CONSOMMATION ═══════════
     *
     * L'ordre est celui de la doctrine : appairage hydraté, curseur hydraté,
     * PUIS réclamation, PUIS seulement les services de fond. Réclamer après
     * aurait laissé un cycle partir sans savoir s'il en avait le droit.
     *
     * Un refus n'est PAS une panne : c'est un autre runtime du même projet qui
     * consomme, et ce runtime-ci sert parfaitement ses requêtes sans tirer. Il
     * réessaiera au cycle suivant, et reprendra à l'expiration si l'autre meurt.
     */
    const bail = await claimConsumerLease({
      projectId: restored?.projectId ?? null,
      generation: config.env,
    }).catch((err) => ({ granted: false, reason: err?.message ?? 'CLAIM_FAILED' }));
    recordCheck({
      section: BOOT_SECTION.PANEL,
      name: 'Bail de consommation',
      outcome: bail.granted ? BOOT_OUTCOME.OK : BOOT_OUTCOME.DEGRADED,
      proof: bail.granted
        ? `accordé à ${PROCESS_IDENTITY} pour ${Math.round(CONSUMER_LEASE_TTL_MS / 1000)} s`
        : '',
      reason: bail.granted ? '' : (bail.reason ?? 'LEASE_HELD'),
      detail: bail.granted
        ? ''
        : `un autre runtime consomme (${bail.owner ?? 'inconnu'}) — celui-ci sert sans tirer, `
          + 'et reprendra à l’expiration du bail',
    });

    const {
      configureBridgeRuntime, configureOutboxAdapter, configureInitialProjections,
      configureReconnectHook,
      startupBridgeHello, pairWithPanel,
    } = await import(
      '../services/panelBridge/bridgeRuntime.js'
    );
    const {
      getBridgeIdentity, buildProjectManifest, getBridgeHealth, configureProjectBridge,
    } = await import('../services/projectBridge/projectBridge.service.js');
    const panelConfiguration = await import(
      '../services/panelConfiguration/panelConfiguration.service.js'
    );

    /**
     * LES APPLICATEURS — une seule table, branchée sur les DEUX chemins.
     *
     * `changeAppliers` sert quand le Panel LIVRE (poussée immédiate) ;
     * `applyHandlers` sert quand le projet TIRE (rattrapage). Un type inscrit
     * dans un seul des deux fonctionne tant que le projet est en ligne, puis
     * disparaît silencieusement dès qu'il a été absent — soit exactement le cas
     * que le rattrapage existe pour couvrir.
     *
     * Ils étaient recopiés à l'identique dans deux littéraux de trente lignes.
     * Une seule table les définit désormais : ajouter un type ne peut plus
     * n'en servir qu'un.
     */
    const applicateurs = {
      DEV_COMPANY: panelConfiguration.applyCompanyChange,
      /**
       * L'ENTREPRISE CLIENTE — l'identité JURIDIQUE du propriétaire de ce site.
       *
       * Distincte de `DEV_COMPANY`, qui porte l'identité du PRESTATAIRE : l'une
       * signe nos contrats côté développeur et s'affiche en pied de page,
       * l'autre est ce que la facture porte en « Facturer à ». Les confondre
       * ferait afficher les mentions légales de l'agence sur le site du client.
       */
      CLIENT_COMPANY: (
        await import('../services/panelConfiguration/clientCompany.service.js')
      ).applyClientCompanyChange,
      INTEGRATED_API_CONFIG: panelConfiguration.applyIntegratedApiChange,
      /** L8.4C — le RETOUR DE LIVRAISON d'un e-mail (envois partis du Panel). */
      EMAIL_DELIVERY_EVENT: (
        await import('../services/email/emailDeliveryEvent.applier.js')
      ).applyEmailDeliveryEvent,
      /** R10.5C — le RETOUR DE SIGNATURE (webhook Yousign reçu par le Panel). */
      SIGNATURE_EVENT: (
        await import('../services/signature/signatureEvent.applier.js')
      ).applySignatureEvent,
      /** L10.5 — les PRESTATIONS que le Panel facture au client. */
      PAYMENT_REQUEST: (
        await import('../services/billing/paymentRequest.applier.js')
      ).applyPaymentRequestChange,
      /** L10.6 — la cause « défaut de paiement ». */
      PAYMENT_DEFAULT_CAUSE: (
        await import('../services/billing/paymentDefaultCause.applier.js')
      ).applyPaymentDefaultCause,
      /**
       * L10.6B-3 — l'INCIDENT de paiement, qui n'est pas la cause. Il arrive
       * dès le PREMIER prélèvement refusé, bien avant que la cause ne devienne
       * active. Son applicateur ne touche PAS `SiteStatus` : une observation ne
       * ferme aucun site.
       */
      PAYMENT_DEFAULT_INCIDENT: (
        await import('../services/billing/paymentDefaultIncident.applier.js')
      ).applyPaymentDefaultIncidentChange,
      /**
       * LES DOCUMENTS LÉGAUX — mentions légales et politique de
       * confidentialité, résolus par le Panel et servis par ce site.
       *
       * Inscrit dans cette table UNIQUE, donc branché sur les DEUX chemins :
       * la poussée immédiate et le rattrapage au tirage.
       */
      LEGAL_DOCUMENT: (
        await import('../services/panelConfiguration/legalDocument.service.js')
      ).applyLegalDocumentChange,
    };

    /**
     * ── QUI SOMMES-NOUS ? — câblé ICI, et nulle part ailleurs ──────────────
     *
     * L'applicateur de documents légaux REFUSE tout document qui ne nomme pas
     * ce projet : c'est la seconde barrière multi-tenant. Elle a besoin de
     * notre `projectId`, qui vit dans l'appairage — qu'un service métier n'a
     * pas le droit d'importer (règle vérifiée par `bridge-conformity`).
     *
     * Le fournisseur est une FONCTION : l'appairage peut changer en cours de
     * vie, et une valeur figée au démarrage ferait refuser tous les documents
     * d'un projet appairé après le lancement.
     */
    const { describePairing } = await import('../services/panelBridge/pairingStore.js');
    (await import('../services/panelConfiguration/legalDocument.service.js'))
      .configureLegalDocumentIdentity(() => describePairing()?.projectId ?? null);

    // Le pont ne connaît pas le métier : on lui confie ce qu'il doit appeler.
    configureProjectBridge({
      changeAppliers: { ...applicateurs },
      appliedConfigurationProvider: panelConfiguration.describeAppliedConfiguration,
      // Identité PUBLIQUE du projet (nom commercial, slogan, logo, contacts,
      // adresses) : le pont ne lit pas la base, on lui confie le lecteur.
      presentationProvider: (
        await import('../services/projectBridge/projectPresentation.service.js')
      ).describeProjectPresentation,
    });

    // ── SYNCHRONISATION AUTOMATIQUE ────────────────────────────────────
    // L'outbox DURABLE d'abord : elle doit exister avant qu'un déclencheur
    // puisse y écrire. Le pont reçoit un adaptateur, jamais un modèle.
    const { createMongoOutboxAdapter } = await import(
      '../services/panelBridge/persistence/mongoOutboxAdapter.js'
    );
    /**
     * LA GÉNÉRATION VIENT D'ICI — le bootstrap est l'un des rares endroits
     * autorisés à lire la configuration, et l'outbox du pont n'en est pas un.
     * Sans elle, deux environnements dériveraient les mêmes `writeId` pour des
     * données différentes, et le Panel les prendrait pour des doublons.
     */
    const outboxAdapter = createMongoOutboxAdapter({ generation: config.env });
    configureOutboxAdapter(outboxAdapter);

    const projectSync = await import('../services/projectBridge/projectSync.service.js');
    const teamSync = await import('../services/projectBridge/teamSync.service.js');
    /**
     * ══ LA POUSSÉE IMMÉDIATE PASSE PAR `runPushCycle`, ET C'EST UN CORRECTIF ══
     *
     * Elle passait par `runSyncCycle` — le cycle COMPLET, qui est gardé contre
     * le chevauchement. Quand le tic périodique tournait au moment où
     * l'utilisateur enregistrait, la poussée immédiate était SAUTÉE en
     * silence, et la modification attendait le tic suivant.
     *
     * `runPushCycle` a sa propre garde ET mémorise les demandes arrivées en
     * vol : la file est toujours revisitée APRÈS la dernière mise en file.
     */
    const { runPushCycle: pousserVersPanel } = await import(
      '../services/panelBridge/bridgeScheduler.js'
    );
    projectSync.configureProjectSync({
      enqueueProjection: (change) => outboxAdapter.enqueue(change),
      // Tentative IMMÉDIATE, jamais attendue par l'appelant : la sauvegarde
      // métier a déjà répondu à l'utilisateur.
      flush: () => { void pousserVersPanel(); },
    });
    teamSync.configureTeamSync({
      enqueueProjection: (change) => outboxAdapter.enqueue(change),
      flush: () => { void pousserVersPanel(); },
    });

    // RECONNEXION : pendant une coupure, le Panel a pu manquer un dépôt de
    // document ou une signature — des faits que rien ne rejouera autrement.
    // On lui redonne donc la photographie complète dès que le lien revient.
    configureReconnectHook(async () => {
      await projectSync.reconcileAll();
      await teamSync.reconcileTeam();
    });

    // Amorçage juste après un appairage réussi : identité + contrat en file,
    // puis tentative immédiate. Le premier affichage métier du Panel n'attend
    // donc pas une future modification du Manager.
    configureInitialProjections(async () => {
      /**
       * LA PHOTOGRAPHIE D'AMORÇAGE PASSE PAR `reconcileAll` — une seule liste.
       * `reconcileAll` EST la définition de « photographie complète ». On
       * l'appelle, on ne la recopie pas.
       */
      await projectSync.reconcileAll();
      await teamSync.reconcileTeam();
      const outcome = await pousserVersPanel();
      return { delivered: (outcome?.delivered ?? 0) > 0 };
    });

    configureBridgeRuntime({
      identityProvider: getBridgeIdentity,
      manifestProvider: buildProjectManifest,
      applyHandlers: { ...applicateurs },
      /**
       * LE RÉSEAU QUE CE PROJET SERT (contrat 1.9.0) — déclaré à chaque battement.
       *
       * ══ POURQUOI IL EST BRANCHÉ ICI ═══════════════════════════════════════
       *
       * Le pont ne connaît aucun modèle : importer le lecteur de configuration
       * réseau dans `PanelBridge` aurait fait entrer Mongo dans son cœur, et la
       * garde de découplage le refuse — à juste titre. Le bootstrap est le seul
       * endroit qui a le droit de connaître les deux.
       *
       * Ce que ce fournisseur ferme : le Panel posait `runtime.publicBackendUrl`
       * à l'appairage et ne la relisait jamais ; sa fiche annonçait encore
       * `api.demo-sbauto.lycarz.com` longtemps après la migration, et seul un
       * RÉAPPAIRAGE pouvait la corriger. L'appairage est une relation
       * d'identité ; l'URL publique est un état courant.
       */
      networkProvider: async () => {
        const { currentRuntimeNetwork } = await import(
          '../services/projectBridge/runtimeNetworkAuthority.js'
        );
        return currentRuntimeNetwork();
      },
      /**
       * Découverte jointe au bootstrap (contrat >= 1.3.0).
       *
       * `integratedApis` n'est plus appliqué : depuis L4, un Panel à jour ne
       * l'envoie plus, et un Panel antérieur qui l'enverrait encore se voit
       * refusé — aucun identifiant fournisseur ne franchit le pont.
       */
      discoveryApplier: async ({ company, integratedApis }) => {
        if (company) await panelConfiguration.applyCompanyProfile(company, 'BOOTSTRAP');
        for (const api of integratedApis ?? []) {
          panelConfiguration.refuseIntegratedApi(api);
        }
      },
    });

    contexte.wired = true;
    contexte.modules = {
      projectSync, teamSync, pousserVersPanel, startupBridgeHello,
      getBridgeIdentity, getBridgeHealth,
    };
    recordCheck({
      section: BOOT_SECTION.PANEL,
      name: 'Pont Panel',
      outcome: BOOT_OUTCOME.OK,
      proof: `runtime configuré — ${Object.keys(applicateurs).length} applicateurs sur les deux registres, outbox durable (génération ${config.env})`,
    });

    // APPAIRAGE AUTOMATIQUE au premier démarrage. Ne s'exécute que si le
    // projet n'est PAS déjà appairé : un code déjà consommé ne doit pas être
    // rejoué à chaque redémarrage, et l'appairage n'est pas idempotent côté
    // Panel (il répondrait BRIDGE_ALREADY_PAIRED).
    if (!restored && config.panel.url && config.panel.pairingCode) {
      try {
        const pairing = await pairWithPanel({
          panelUrl: config.panel.url,
          pairingCode: config.panel.pairingCode,
          publicBackendUrl: config.panel.publicBackendUrl,
        });
        contexte.restored = { panelName: pairing.panelName, panelUrl: config.panel.url };
        recordCheck({
          section: BOOT_SECTION.PANEL,
          name: 'Appairage automatique',
          outcome: BOOT_OUTCOME.OK,
          proof: `réussi auprès de « ${pairing.panelName} » — jeton de pont persisté`,
        });
      } catch (err) {
        // Un code périmé ou déjà utilisé est le cas NORMAL d'un redémarrage
        // avec un .env non nettoyé : on le dit sans dramatiser.
        recordCheck({
          section: BOOT_SECTION.PANEL,
          name: 'Appairage automatique',
          outcome: BOOT_OUTCOME.DEGRADED,
          reason: err.code || 'PAIRING_FAILED',
          detail: `${err.message} — le projet démarre en mode autonome`,
        });
      }
    }
  } catch (err) {
    /**
     * LE PONT EST OPTIONNEL, DONC NON BLOQUANT — mais son absence est un fait
     * qui compte. Un projet autonome (04_STANDALONE) sert parfaitement son
     * métier ; ce qu'il ne peut pas faire, c'est provisionner ce qui dépend du
     * Panel. Le résumé le dira, et l'audit des IntegratedAPI aussi.
     */
    recordCheck({
      section: BOOT_SECTION.PANEL,
      name: 'Pont Panel',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'BRIDGE_INIT_FAILED',
      detail: String(err?.message || err),
    });
  }

  return contexte;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  3. INTEGRATED APIs — réconciliation PUIS audit                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * RÉCONCILIATION AUTOMATIQUE des webhooks gérés — GÉNÉRIQUE : le bootstrap ne
 * connaît AUCUN fournisseur. Il appelle l'orchestrateur, qui itère le registre
 * des drivers (`IntegrationWebhookProvider`) ; chaque provider répond de ses
 * propres webhooks (0, 1 ou plusieurs).
 *
 *  - PROD (config.isProd) : un déploiement redémarre PM2 → c'est ici, sur le
 *    backend déployé (URL publique écrite par l'étape runtime_config), que les
 *    webhooks PROD se réconcilient. Sans ngrok.
 *  - DEV (ENV=TEST) : les webhooks TEST suivent AUTOMATIQUEMENT le tunnel
 *    ngrok courant — synchronisation au démarrage puis VEILLE périodique. Le
 *    mode PROD n'est JAMAIS touché depuis un poste de dev.
 *
 * ── CE QUI A CHANGÉ, ET CE QUE ÇA CORRIGE ───────────────────────────────────
 *
 * Le rapport n'est plus seulement journalisé : il est AUDITÉ. Chaque
 * fournisseur reçoit un état du vocabulaire commun, et tout geste sauté pour
 * une dépendance qui peut revenir devient une reprise inscrite — plus jamais un
 * `skipped` orphelin suivi, deux lignes plus bas, de l'arrivée de la dépendance.
 */
async function amorcerIntegratedApis() {
  const mode = config.isProd ? 'PROD' : 'TEST';
  const ENSURE_TIMEOUT_MS = 20_000;

  let rapportWebhooks = null;
  let motifAbsence = 'RECONCILIATION_NOT_RUN';
  try {
    const { ensureAllWebhooks } = await import('../services/webhooks/webhookOrchestrator.service.js');
    const issue = await avecPlafond(ensureAllWebhooks(mode), ENSURE_TIMEOUT_MS);
    rapportWebhooks = issue.valeur;
    /**
     * TROIS ISSUES, TROIS MOTIFS DISTINCTS — et l'audit s'en servira pour
     * décider s'il faut reprendre. « Expiré » se retente ; « le module n'a pas
     * pu être chargé » aussi, mais ce n'est pas le même incident, et un seul
     * code pour les deux enverrait chercher au mauvais endroit.
     */
    if (issue.expire) motifAbsence = 'RECONCILIATION_TIMEOUT';
    else if (issue.erreur) motifAbsence = issue.erreur.code || 'RECONCILIATION_FAILED';
  } catch (err) {
    motifAbsence = err?.code || 'RECONCILIATION_FAILED';
  }

  /**
   * L'AUDIT EST LA SEULE SOURCE DES LIGNES « INTEGRATED APIs ».
   *
   * Le rapport brut n'est plus journalisé séparément : deux journaux pour un
   * même fait finissent par se contredire, et c'est celui qui ne compte pas
   * qu'on croit. Ici, la ligne lue et la ligne comptée sont la même.
   */
  const { retries } = await auditIntegratedApiStartup({
    mode,
    webhookReport: rapportWebhooks,
    reconciliationFailure: motifAbsence,
  });

  // Les reprises inscrites reçoivent leur première échéance. Bornées,
  // sérialisées, arrêtées au drainage — voir startupReconciliation.service.js.
  for (const cle of retries) {
    const { delayMs } = scheduleStartupRetry(cle);
    if (delayMs) {
      logger.info(`       ↳ reprise programmée dans ${Math.round(delayMs / 1000)} s (clé ${cle}).`);
    }
  }

  return { mode, retries };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  4. SERVICES DE FOND                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * LES RESSOURCES VIVANTES, DANS LEUR ORDRE DE DÉMARRAGE.
 *
 * ── POURQUOI UNE LISTE, ET NON N INSCRIPTIONS AU DRAINAGE ──────────────────
 *
 * Chaque service inscrivait sa propre fermeture. C'était correct, mais rien ne
 * pouvait RÉPONDRE à la question « tout ce qui a démarré s'arrête-t-il ? » :
 * il fallait relire le code et espérer n'avoir rien oublié.
 *
 * Une liste rend la symétrie CONSTATABLE. Le contrôle d'invariants de services
 * la compare à ce qui a réellement démarré, l'arrêt la parcourt À L'ENVERS, et
 * un doublon d'inscription devient un fait mesurable au lieu d'un soupçon.
 */
let ressourcesDeFond = [];
let servicesDemarres = false;
let desinscrireArretServices = null;

function inscrireRessource(label, stop) {
  ressourcesDeFond.push({ label, stop });
}

/** Les libellés des ressources démarrées — lecture seule, pour les invariants. */
export function describeBackgroundServices() {
  const libelles = ressourcesDeFond.map((r) => r.label);
  const doublons = libelles.filter((l, i) => libelles.indexOf(l) !== i);
  return { started: servicesDemarres, resources: libelles, duplicates: [...new Set(doublons)] };
}

async function demarrerServices(panel) {
  const { onDrain } = await import('../services/lifecycle/runtimeLifecycle.js');

  /**
   * VEILLE DU TUNNEL — l'adresse publique de développement bouge.
   *
   * Quand l'URL du tunnel change, TOUS les webhooks TEST synchronisables sont
   * réalignés (même id distant, pas de doublon). Un tunnel qui APPARAÎT rejoue
   * en outre les reprises restées dues : une dépendance qui arrive doit
   * débloquer ce qu'elle bloquait.
   */
  if (!config.isProd) {
    try {
      const { detectNgrokPublicUrl } = await import('../services/ngrokTunnel.service.js');
      const { ensureAllWebhooks } = await import('../services/webhooks/webhookOrchestrator.service.js');
      const WATCH_INTERVAL_MS = 60_000;
      let lastSeen = null;
      let watching = false;

      if (veilleTunnel) clearInterval(veilleTunnel);
      veilleTunnel = setInterval(async () => {
        if (watching) return; // pas de réentrance
        watching = true;
        try {
          const current = await detectNgrokPublicUrl({ force: true });
          if (current && current !== lastSeen) {
            lastSeen = current;
            const r = await ensureAllWebhooks('TEST');
            if (r.summary.ensured > 0) {
              logger.success(`Webhooks TEST resynchronisés sur ${current} (tunnel ngrok).`);
            }
            await replayStartupReconciliations('ngrok-tunnel');
          }
        } catch { /* best-effort : la veille ne casse jamais rien */ }
        finally { watching = false; }
      }, WATCH_INTERVAL_MS);
      veilleTunnel.unref?.();
      inscrireRessource('veille du tunnel de développement', () => {
        if (veilleTunnel) clearInterval(veilleTunnel);
        veilleTunnel = null;
      });

      recordCheck({
        section: BOOT_SECTION.BACKGROUND,
        name: 'Veille du tunnel de développement',
        outcome: BOOT_OUTCOME.OK,
        proof: `minuteur armé (${WATCH_INTERVAL_MS / 1000} s) et inscrit à l’arrêt`,
      });
    } catch (err) {
      recordCheck({
        section: BOOT_SECTION.BACKGROUND,
        name: 'Veille du tunnel de développement',
        outcome: BOOT_OUTCOME.DEGRADED,
        reason: 'TUNNEL_WATCH_FAILED',
        detail: String(err?.message || err),
      });
    }
  }

  /**
   * LE CONCIERGE DES MÉDIAS — il balaye ce que plus aucune fiche ne rend.
   *
   * Il est démarré AVANT la garde de câblage du pont : le nettoyage du stockage
   * ne dépend pas du Panel, et un pont non câblé ne doit pas laisser un dossier
   * `uploads` grossir sans fin. Il ne balaye que si cette instance est
   * l'autorité média — voir `startMediaJanitor`.
   */
  try {
    const { startMediaJanitor, MEDIA_JANITOR } = await import('../services/storage.service.js');
    const arreter = startMediaJanitor();
    inscrireRessource('concierge des médias', arreter);
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Concierge des médias',
      outcome: BOOT_OUTCOME.OK,
      proof: `balayage toutes les ${MEDIA_JANITOR.INTERVAL_MS / 3_600_000} h, `
        + `premier passage dans ${MEDIA_JANITOR.FIRST_DELAY_MS / 60_000} min`,
    });
  } catch (err) {
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Concierge des médias',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'MEDIA_JANITOR_FAILED',
      detail: String(err?.message || err),
    });
  }

  if (!panel.wired || !panel.modules) {
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Services du pont Panel',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'BRIDGE_NOT_WIRED',
      detail: 'ni déclencheurs, ni photographie, ni ordonnanceur — le pont n’a pas pu être câblé',
    });
    /**
     * L'ARRÊT S'INSCRIT MÊME QUAND PRESQUE RIEN N'A DÉMARRÉ : la veille du
     * tunnel, elle, tourne peut-être. Sortir sans inscrire la laisserait courir
     * après la fermeture de la base.
     */
    desinscrireArretServices = onDrain(() => stopBackgroundServices({ reason: 'drain' }),
      { label: 'services de fond' });
    return;
  }

  const { projectSync, teamSync, startupBridgeHello, getBridgeIdentity, getBridgeHealth } = panel.modules;

  try {
    const { installSyncTriggers } = await import('../services/projectBridge/syncTriggers.js');
    const { resetSyncNotifier } = await import('../utils/syncNotifier.js');
    installSyncTriggers();
    inscrireRessource('déclencheurs de synchronisation', () => resetSyncNotifier());
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Déclencheurs de synchronisation',
      outcome: BOOT_OUTCOME.OK,
      proof: 'branchés (entreprise, réseau, contrat, état du site, équipe)',
    });
  } catch (err) {
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Déclencheurs de synchronisation',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'TRIGGERS_FAILED',
      detail: String(err?.message || err),
    });
  }

  /**
   * ══ PLUS AUCUN `void` PENDANT L'AMORÇAGE ═══════════════════════════════════
   *
   * Ces gestes partaient en `void` : le démarrage annonçait « PRÊTE » pendant
   * qu'ils tournaient encore, et leur résultat n'atteignait personne. Un signe
   * de vie jamais parti et un signe de vie parti se ressemblaient beaucoup trop.
   *
   * Ils sont ATTENDUS, sous plafond : le journal dit ce qui s'est réellement
   * passé, et un Panel injoignable coûte quelques secondes de démarrage au lieu
   * d'une ligne fausse.
   */
  if (panel.restored) {
    const issue = await avecPlafond(startupBridgeHello({ timeoutMs: 8_000 }), 10_000);
    const hello = issue.valeur;
    const livre = hello?.heartbeat?.delivered === true;
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Signe de vie Panel',
      outcome: livre ? BOOT_OUTCOME.OK : BOOT_OUTCOME.DEGRADED,
      proof: livre ? 'heartbeat accepté par le Panel et outbox vidée' : '',
      reason: livre
        ? ''
        : (issue.expire ? 'HELLO_TIMEOUT'
          : issue.erreur?.code || hello?.heartbeat?.reason || hello?.reason || 'PANEL_UNREACHABLE'),
      detail: livre
        ? ''
        : `${issue.erreur?.message || 'le Panel n’a pas répondu'} — pont DEGRADED, reprise automatique par l’ordonnanceur`,
    });
  } else {
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Signe de vie Panel',
      outcome: BOOT_OUTCOME.NOT_REQUIRED,
      reason: 'STANDALONE',
      detail: 'projet non appairé — aucun signe de vie à envoyer',
    });
  }

  /**
   * RÉCONCILIATION au démarrage — répare le trou possible entre une écriture
   * métier réussie et une mise en file qui aurait échoué. La file étant
   * idempotente, rejouer un état déjà connu ne crée rien.
   *
   * ── ELLE EST ICI, ET PAS AVANT LES REPRISES ────────────────────────────────
   *
   * Elle LIT l'état métier pour en faire une photographie envoyée au Panel.
   * La construire pendant que les reprises structurelles corrigent encore la
   * base enverrait au Panel une image de l'état intermédiaire — c'est-à-dire
   * exactement ce que ce lot interdit.
   */
  const photo = await avecPlafond(
    (async () => {
      await projectSync.reconcileAll();
      await teamSync.reconcileTeam();
      return true;
    })(),
    15_000,
  );
  recordCheck({
    section: BOOT_SECTION.BACKGROUND,
    name: 'Photographie complète mise en file',
    outcome: photo.valeur ? BOOT_OUTCOME.OK : BOOT_OUTCOME.DEGRADED,
    proof: photo.valeur ? 'projections projet et équipe déposées dans l’outbox durable' : '',
    reason: photo.valeur
      ? ''
      : (photo.expire ? 'RECONCILE_TIMEOUT' : photo.erreur?.code || 'RECONCILE_FAILED'),
    detail: photo.valeur
      ? ''
      : `${photo.erreur?.message || 'délai dépassé'} — l’ordonnanceur reprendra la mise en file`,
  });

  /**
   * ORDONNANCEUR : heartbeat et synchronisation PÉRIODIQUES.
   *
   * Il est TOUJOURS configuré, même quand il ne tourne pas : les cycles restent
   * déclenchables à la main depuis le Manager. Couper la cadence ne doit pas
   * couper la commande — sinon « resynchroniser maintenant » échouerait
   * précisément quand on en a besoin, en recette.
   */
  const { configureBridgeScheduler, startBridgeScheduler, drainBridgeScheduler } = await import(
    '../services/panelBridge/bridgeScheduler.js'
  );
  const { isAcceptingWork } = await import('../services/lifecycle/runtimeLifecycle.js');
  configureBridgeScheduler({
    identityProvider: getBridgeIdentity,
    healthProvider: getBridgeHealth,
    /**
     * L'ORDONNANCEUR APPREND À DISTINGUER « EN PANNE » DE « EN TRAIN DE
     * S'ARRÊTER » — et il l'apprend d'ici. Le module de pont ne peut pas lire le
     * runtime lui-même (bridge-conformity) : c'est le câblage qui le lui confie.
     */
    acceptingWorkProvider: isAcceptingWork,
  });
  if (config.panel.schedulerEnabled) {
    const cadences = startBridgeScheduler({
      heartbeatIntervalMs: config.panel.heartbeatIntervalS * 1000,
      syncIntervalMs: config.panel.syncIntervalS * 1000,
    });
    /**
     * ── POURQUOI `drainBridgeScheduler` ET NON `stopBridgeScheduler` ─────────
     *
     * Arrêter les minuteurs ne suffit pas : un cycle DÉJÀ parti continue et
     * atteint une base que l'arrêt vient de refermer. Le drainage arrête PUIS
     * attend, sous plafond.
     */
    inscrireRessource('ordonnanceur du pont', () => drainBridgeScheduler());
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Ordonnanceur du pont',
      outcome: BOOT_OUTCOME.OK,
      proof: `démarré — heartbeat ${cadences.heartbeatIntervalMs / 1000} s, synchronisation ${cadences.syncIntervalMs / 1000} s`,
    });
  } else {
    /**
     * Cadence coupée : l'ordonnanceur ne bat pas, mais un cycle DÉCLENCHÉ À LA
     * MAIN peut être en vol au moment de l'arrêt. On inscrit donc son drainage
     * quand même — l'oublier laisserait ce cas précis écrire sur une base
     * fermée, et c'est celui qu'on rencontre en recette.
     */
    inscrireRessource('ordonnanceur du pont (cadence coupée)', () => drainBridgeScheduler());
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Ordonnanceur du pont',
      outcome: BOOT_OUTCOME.NOT_REQUIRED,
      reason: 'SCHEDULER_DISABLED',
      detail: 'cadence coupée par configuration — les cycles restent déclenchables à la main',
    });
  }

  /**
   * DERNIER INSCRIT, DONC PREMIER ARRÊTÉ.
   *
   * L'inventaire est parcouru à l'envers au drainage. Ce minuteur ne fait que
   * relancer des envois : le couper en premier libère la base pour les
   * services qui, eux, doivent finir leur cycle en cours.
   */
  /**
   * ══ LA REPRISE DES ACTIONS DEVIENT PÉRIODIQUE — EN PHASE 2, ET PAS AVANT ══
   *
   * Le passage unique d'amorçage (`processPendingEventActions`, phase 1)
   * rattrape ce qui traînait au démarrage. Il ne dit rien de ce qui échouera
   * dans dix minutes — d'où ce minuteur, qui appelle la même fonction. Toute la
   * mécanique de nouvelle tentative existait — `availableAt`, backoff borné,
   * verrou atomique — mais personne ne regardait l'heure.
   *
   * ── POURQUOI IL A ÉTÉ DÉPLACÉ ICI ───────────────────────────────────────
   *
   * Il démarrait dans `amorcerCoeur()`, c'est-à-dire en PHASE 1, avant les
   * reprises structurelles. C'était un worker de fond parti trop tôt —
   * exactement ce que la doctrine « recovery-before-workers » interdit — et le
   * rapport d'amorçage le disait déjà : il portait un constat
   * `BACKGROUND SERVICES` horodaté AVANT les constats `RECOVERY`, et
   * `bootstrap-recovery-before-workers.test.js` échouait dessus depuis.
   *
   * Ce minuteur envoie des e-mails décidés à partir de l'état contractuel :
   * le laisser partir avant la reprise des webhooks abandonnés, c'est risquer
   * une relance d'impayé fondée sur un contrat que la reprise allait corriger.
   *
   * `immediate: false` — la phase 1 vient d'en faire un passage.
   */
  try {
    const { startEventActionScheduler, drainEventActionScheduler } = await import(
      '../services/events/eventActionScheduler.js'
    );
    const { intervalMs } = startEventActionScheduler({ immediate: false });
    inscrireRessource('reprise des actions d’événements', () => drainEventActionScheduler());
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Reprise automatique des actions',
      outcome: BOOT_OUTCOME.OK,
      proof: `cadence ${Math.round(intervalMs / 1000)} s`,
    });
  } catch (err) {
    recordCheck({
      section: BOOT_SECTION.BACKGROUND,
      name: 'Reprise automatique des actions',
      outcome: BOOT_OUTCOME.DEGRADED,
      reason: 'EVENT_RETRY_SCHEDULER_FAILED',
      detail: String(err?.message || err),
    });
  }

  /**
   * ── UN SEUL VIDANGEUR POUR TOUS LES SERVICES ────────────────────────────
   *
   * L'arrêt parcourt `ressourcesDeFond` À L'ENVERS de l'ordre de démarrage.
   * Une inscription par service aurait le même effet ; ce qu'elle n'aurait pas,
   * c'est la possibilité de PROUVER que rien n'a été oublié.
   */
  desinscrireArretServices = onDrain(() => stopBackgroundServices({ reason: 'drain' }),
    { label: 'services de fond' });
}

/**
 * ARRÊT DES SERVICES DE FOND — l'exact symétrique de leur démarrage.
 *
 * Ordre INVERSE : le dernier démarré s'arrête le premier. C'est ce qui évite
 * qu'un service encore vivant écrive dans un stockage que son voisin vient de
 * fermer.
 *
 * Ne lève JAMAIS : un arrêt qui échoue parce qu'un service a hoqueté serait un
 * arrêt forcé, c'est-à-dire précisément ce qu'on cherche à éviter.
 */
export async function stopBackgroundServices({ reason = 'shutdown' } = {}) {
  if (!servicesDemarres && ressourcesDeFond.length === 0) {
    return { stopped: false, reason: 'NOOP_NOT_STARTED', count: 0 };
  }
  const aArreter = [...ressourcesDeFond].reverse();
  for (const { label, stop } of aArreter) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await stop();
    } catch (err) {
      logger.warn(`[lifecycle] arrêt « ${label} » incomplet : ${err?.message ?? err}`);
    }
  }
  ressourcesDeFond = [];
  servicesDemarres = false;
  desinscrireArretServices?.();
  desinscrireArretServices = null;
  return { stopped: true, reason, count: aArreter.length };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  INVARIANTS DE SERVICES                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * « LES SERVICES ONT-ILS RÉELLEMENT DÉMARRÉ ? »
 *
 * ── POURQUOI UN `startX()` QUI REND SANS LEVER NE SUFFIT PAS ───────────────
 *
 * Il prouve qu'aucune exception n'a traversé, rien de plus. Un minuteur non
 * armé, un écouteur écrasé par un second câblage, un ordonnanceur arrêté par
 * une remise à zéro : aucun de ces cas ne lève, et tous laissent un backend
 * qui croit travailler.
 *
 * On interroge donc les composants eux-mêmes — un minuteur EXISTE, un écouteur
 * EST branché, une ressource EST inscrite à l'arrêt.
 *
 * ── LA CRITICITÉ VIENT DU RÔLE, PAS DU TYPE ────────────────────────────────
 *
 * Classer tous les ordonnanceurs « non bloquants » serait commode et faux. Sur
 * un projet APPAIRÉ, l'ordonnanceur du pont et les déclencheurs portent la
 * synchronisation entière : sans eux, le Panel voit un parc figé et le client
 * un site qui ne remonte plus rien. Sur un projet AUTONOME, ils n'ont
 * personne à servir — leur absence est un constat, pas une panne.
 */
export async function assertServiceInvariants(panel = null) {
  return verifierInvariantsDeServices(panel ?? etatStructurel?.panel ?? null);
}

async function verifierInvariantsDeServices(panel) {
  const { hasSyncListener } = await import('../utils/syncNotifier.js');
  const { describeScheduler } = await import('../services/panelBridge/bridgeScheduler.js');
  const { drainHookLabels } = await import('../services/lifecycle/runtimeLifecycle.js');
  const { describeStartupReconciliation } = await import(
    '../services/lifecycle/startupReconciliation.service.js'
  );

  const appaire = Boolean(panel?.restored);
  const ponte = Boolean(panel?.wired);

  /* ── 1. Déclencheurs de synchronisation — branchés EXACTEMENT une fois ─── */
  const brancheUneFois = hasSyncListener();
  recordCheck({
    section: BOOT_SECTION.SERVICE_INVARIANTS,
    name: 'Déclencheurs de synchronisation branchés',
    outcome: brancheUneFois
      ? BOOT_OUTCOME.OK
      : (appaire ? BOOT_OUTCOME.FAILED : BOOT_OUTCOME.DEGRADED),
    blocking: !brancheUneFois && appaire,
    proof: brancheUneFois
      ? 'un écouteur unique répond aux sauvegardes (emplacement unique par construction)'
      : '',
    reason: brancheUneFois ? '' : 'SYNC_TRIGGERS_MISSING',
    detail: brancheUneFois
      ? ''
      : (appaire
        ? 'projet appairé sans déclencheur : plus aucune modification ne partirait vers le Panel'
        : 'projet autonome — aucune projection à déclencher'),
  });

  /* ── 2. Ordonnanceur du pont — un minuteur EXISTE vraiment ──────────────── */
  const cadenceVoulue = config.panel.schedulerEnabled;
  const ordonnanceur = describeScheduler();
  if (!cadenceVoulue) {
    recordCheck({
      section: BOOT_SECTION.SERVICE_INVARIANTS,
      name: 'Ordonnanceur du pont actif',
      outcome: BOOT_OUTCOME.NOT_REQUIRED,
      reason: 'SCHEDULER_DISABLED',
      detail: 'cadence coupée par configuration — aucun minuteur n’est attendu',
    });
  } else {
    const requis = appaire && ponte;
    recordCheck({
      section: BOOT_SECTION.SERVICE_INVARIANTS,
      name: 'Ordonnanceur du pont actif',
      outcome: ordonnanceur.running
        ? BOOT_OUTCOME.OK
        : (requis ? BOOT_OUTCOME.FAILED : BOOT_OUTCOME.DEGRADED),
      blocking: !ordonnanceur.running && requis,
      proof: ordonnanceur.running
        ? `minuteurs armés — heartbeat ${ordonnanceur.heartbeatIntervalS} s, synchronisation ${ordonnanceur.syncIntervalS} s`
        : '',
      reason: ordonnanceur.running ? '' : 'SCHEDULER_NOT_RUNNING',
      detail: ordonnanceur.running
        ? ''
        : (requis
          ? 'projet appairé sans cadence : le Panel classerait ce projet hors ligne'
          : 'aucun Panel à servir'),
    });
  }

  /* ── 3. Gestionnaire de reprises — il ACCEPTE encore du travail ─────────── */
  const reprises = describeStartupReconciliation();
  const accepte = isAcceptingWorkNow();
  recordCheck({
    section: BOOT_SECTION.SERVICE_INVARIANTS,
    name: 'Gestionnaire de reprises opérationnel',
    outcome: accepte ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: !accepte,
    proof: accepte
      ? `accepte les travaux — ${reprises.length} inscrit(s) au moment du contrôle`
      : '',
    reason: accepte ? '' : 'RUNTIME_NOT_ACCEPTING_WORK',
    detail: accepte ? '' : 'le runtime refuse déjà du travail : aucune reprise ne partirait',
  });

  /* ── 4. Symétrie de l'arrêt — chaque ressource a sa fermeture ───────────── */
  const inventaire = describeBackgroundServices();
  const vidangeurs = drainHookLabels();
  const inscrit = vidangeurs.includes('services de fond');
  recordCheck({
    section: BOOT_SECTION.SERVICE_INVARIANTS,
    name: 'Toutes les ressources sont inscrites à l’arrêt',
    outcome: inscrit ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: !inscrit,
    proof: inscrit
      ? `${inventaire.resources.length} ressource(s) — ${inventaire.resources.join(', ') || 'aucune'} — arrêtées en ordre inverse au drainage`
      : '',
    reason: inscrit ? '' : 'DRAIN_HOOK_MISSING',
    detail: inscrit ? '' : 'des services tourneraient encore pendant la fermeture de la base',
  });

  /* ── 5. Aucun worker en double ──────────────────────────────────────────── */
  const doublons = inventaire.duplicates;
  recordCheck({
    section: BOOT_SECTION.SERVICE_INVARIANTS,
    name: 'Aucun service démarré en double',
    outcome: doublons.length === 0 ? BOOT_OUTCOME.OK : BOOT_OUTCOME.FAILED,
    blocking: doublons.length > 0,
    proof: doublons.length === 0 ? 'chaque ressource n’apparaît qu’une fois dans l’inventaire' : '',
    reason: doublons.length === 0 ? '' : 'DUPLICATE_WORKER',
    detail: doublons.length === 0 ? '' : doublons.join(', '),
  });

  return describeBackgroundServices();
}

/** Lecture directe — évite un import circulaire au chargement du module. */
function isAcceptingWorkNow() {
  try {
    // eslint-disable-next-line global-require
    return lifecycleAcceptingWork();
  } catch {
    return true;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  LE CYCLE DE VIE PUBLIC — DEUX FRONTIÈRES EXPLICITES                       */
/* ────────────────────────────────────────────────────────────────────────── */

/** L'état structurel construit par la première phase, pour la seconde. */
let etatStructurel = null;

/**
 * PHASE 1 — PRÉPARER L'ÉTAT. Aucun service de fond n'est démarré.
 *
 * CORE → PANEL → INTEGRATED APIs → REPRISES → INVARIANTS STRUCTURELS
 *
 * ── CE QUE CETTE FRONTIÈRE GARANTIT ────────────────────────────────────────
 *
 * À son retour, l'état que les workers vont lire et écrire est RÉPARÉ et ses
 * garanties sont CONSTATÉES. Aucun worker n'a encore pu l'observer.
 *
 * Elle LÈVE si une reprise bloquante échoue — et c'est le cœur du lot : le
 * processus meurt alors sans avoir annoncé au Panel une santé qu'il n'avait
 * pas, sans avoir armé un minuteur, sans avoir branché un déclencheur.
 */
export async function bootstrapStructuralState() {
  await amorcerCoeur();
  const panel = await amorcerPanel();
  await amorcerIntegratedApis();

  /**
   * LES REPRISES VIENNENT ICI, ET C'EST TOUT LE LOT.
   *
   * Elles vivaient dans `server.js`, APRÈS `bootstrap()` — donc après le
   * démarrage des services de fond. L'ordonnanceur battait, le signe de vie
   * partait et les déclencheurs étaient armés pendant que l'état structurel
   * était encore en cours de réparation.
   */
  await runStructuralRecovery();
  assertStructuralInvariants();

  etatStructurel = { panel, completedAt: new Date().toISOString() };
  return etatStructurel;
}

/** L'état structurel est-il prêt à supporter des services de fond ? */
export function structuralStateReady() {
  return Boolean(etatStructurel) && structuralRecoveryCompleted();
}

/**
 * PHASE 2 — ACTIVER. Les services de fond démarrent, puis on VÉRIFIE qu'ils
 * tournent réellement.
 *
 * ── LA GARDE N'EST PAS UNE POLITESSE ───────────────────────────────────────
 *
 * Elle REFUSE de démarrer quoi que ce soit tant que la phase 1 n'a pas abouti.
 * Sans elle, l'ordre ne serait qu'une convention — et une convention se perd au
 * premier appelant pressé. C'est la garde qui rend l'invariant vrai, pas la
 * position des lignes.
 *
 * Idempotente : un second appel ne démarre rien et le DIT.
 */
export async function startBackgroundServices() {
  if (!structuralStateReady()) {
    throw new Error(
      'startBackgroundServices : l’état structurel n’est pas prêt. '
      + 'Appelez bootstrapStructuralState() d’abord — aucun service de fond ne doit '
      + 'observer un état que les reprises doivent encore réparer.',
    );
  }
  if (servicesDemarres) {
    /**
     * L'ORDRE DES CHAMPS COMPTE : l'inventaire est étalé D'ABORD, la décision
     * ENSUITE. L'inverse laissait `describeBackgroundServices().started` — qui
     * vaut `true` puisque les services tournent — écraser le `started: false`
     * de ce refus. Le NOOP se déguisait alors en démarrage réussi : exactement
     * le genre de réponse qui rend une idempotence invérifiable.
     */
    return { ...describeBackgroundServices(), started: false, reason: 'NOOP_ALREADY_STARTED' };
  }

  servicesDemarres = true;
  ressourcesDeFond = [];
  await demarrerServices(etatStructurel.panel);
  await verifierInvariantsDeServices(etatStructurel.panel);

  return { ...describeBackgroundServices(), started: true };
}

/**
 * FAÇADE HISTORIQUE — préservée pour la cinquantaine d'appelants existants.
 *
 * ── POURQUOI ELLE DÉMARRE ENCORE LES SERVICES PAR DÉFAUT ───────────────────
 *
 * Parce que des recettes en dépendent réellement : les déclencheurs de
 * synchronisation, sans lesquels aucune projection ne part, sont un service de
 * fond. Les couper par défaut aurait cassé une dizaine de suites pour un gain
 * nul — le risque à fermer n'est pas « bootstrap démarre des workers », c'est
 * « des workers démarrent avant les reprises ».
 *
 * Et cet ordre-là est désormais garanti DANS la façade : elle enchaîne les deux
 * phases, donc même un appelant qui ignore tout du lifecycle obtient la
 * séquence sûre.
 *
 * `startBackgroundServices: false` sert aux recettes qui veulent éprouver l'état
 * structurel seul, ou activer les services à la main.
 */
export async function bootstrap(options = {}) {
  const etat = await bootstrapStructuralState();
  const avecServices = options.startBackgroundServices !== false;
  if (avecServices) await startBackgroundServices();

  return {
    structural: etat,
    backgroundServices: describeBackgroundServices(),
    pendingRetries: pendingStartupJobCount(),
  };
}

/** Remise à zéro du cycle de vie — recettes uniquement. */
export function resetLifecycleForTests() {
  ressourcesDeFond = [];
  servicesDemarres = false;
  desinscrireArretServices = null;
  etatStructurel = null;
  if (veilleTunnel) clearInterval(veilleTunnel);
  veilleTunnel = null;
}
