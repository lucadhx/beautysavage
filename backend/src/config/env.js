import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// Le profil du projet est une FEUILLE : il n'importe rien, et peut donc être lu
// depuis la configuration sans créer de cycle.
import { PROJECT_SLUG } from '../deployment-engine/config/project.profile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load the .env at the backend root regardless of the process cwd.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Central configuration.
 *
 * The whole application (vitrine + manager) is driven by a single `ENV`
 * variable. A single MONGODB_URI (same cluster) is shared; only the database
 * NAME changes: ENV=TEST -> DB_TEST, ENV=PROD -> DB_PROD. No other change is
 * ever required to switch environments.
 */
// Fail-closed : ENV doit être explicitement TEST ou PROD. Aucune valeur par
// défaut — un ENV oublié en production activait auparavant le mode TEST
// (dev-login sans mot de passe, listing des comptes). On refuse de démarrer.
const RAW_ENV = process.env.ENV;
if (!RAW_ENV || !['TEST', 'PROD'].includes(RAW_ENV.toUpperCase())) {
  // eslint-disable-next-line no-console
  console.error(
    `[config] ENV doit valoir explicitement "TEST" ou "PROD" (reçu : ${RAW_ENV ?? 'undefined'}).`
  );
  process.exit(1);
}
const ENV = RAW_ENV.toUpperCase();
const isProd = ENV === 'PROD';

const mongoUri = process.env.MONGODB_URI;
const dbName = isProd ? process.env.DB_PROD : process.env.DB_TEST;

/**
 * Base du PLAN DE CONTRÔLE (P2). Elle est DISTINCTE des bases métier (DB_TEST/
 * DB_PROD) et INDÉPENDANTE de l'ENV : les destinations de déploiement et leurs
 * releases y vivent, de sorte qu'une destination PROD reste visible même quand le
 * moteur tourne en ENV=TEST (et inversement). Même MONGODB_URI, nom de base
 * dédié. Configurable via CONTROL_DB_NAME ; sinon dérivée du préfixe métier
 * (`sbauto06_prod` → `sbauto06_control`).
 */
function deriveControlDbName(fromDb) {
  // Le repli portait « sbauto » en dur. Il ne sert qu'à un démarrage sans
  // aucun nom de base — cas que le contrôle juste en dessous refuse — mais un
  // nom de base fabriqué doit tout de même désigner CE projet : c'est le rôle
  // du slug, et la duplication le réécrit déjà.
  const base = String(fromDb || PROJECT_SLUG).replace(/_(prod|test)$/i, '').replace(/-/g, '_');
  return `${base}_control`;
}
const controlDbName = process.env.CONTROL_DB_NAME || deriveControlDbName(process.env.DB_PROD || process.env.DB_TEST);

if (!mongoUri) {
  // eslint-disable-next-line no-console
  console.error('[config] Missing MONGODB_URI in your .env file.');
  process.exit(1);
}

if (!dbName) {
  // eslint-disable-next-line no-console
  console.error(
    `[config] Missing database name for ENV=${ENV}. ` +
      `Set ${isProd ? 'DB_PROD' : 'DB_TEST'} in your .env file.`
  );
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('[config] Missing JWT_SECRET in your .env file.');
  process.exit(1);
}

// Un secret court rend le HS256 bruteforçable hors-ligne. On avertit sans
// bloquer (les tests utilisent un secret court volontairement).
if (isProd && process.env.JWT_SECRET.length < 32) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] AVERTISSEMENT : JWT_SECRET fait moins de 32 caractères. ' +
      'Utilisez une chaîne longue et aléatoire en production.'
  );
}

/** Entier positif optionnel, avec repli. Refuse une valeur absurde. */
function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    // eslint-disable-next-line no-console
    console.error(`[config] ${name} doit être un entier positif (reçu : ${raw}).`);
    process.exit(1);
  }
  return value;
}

export const config = {
  env: ENV,
  isProd,
  isTest: !isProd,
  port: Number(process.env.PORT) || 4000,
  mongoUri,
  dbName,
  controlDbName,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // URL canonique du dépôt GitHub de CETTE instance (métadonnée, facultative
  // sur les instances existantes ; OBLIGATOIRE à la duplication — le moteur
  // l'écrit dans le .env de chaque copie). Jamais de défaut inventé.
  githubRepositoryUrl: (process.env.PROJECT_GITHUB_REPOSITORY_URL || '').trim() || null,
  // Nom lisible du projet (écrit par le moteur de duplication ; facultatif sur
  // les instances historiques). Sert d'identité au ProjectBridge.
  projectName: (process.env.PROJECT_NAME || '').trim() || null,
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 4000}`).replace(
    /\/$/,
    ''
  ),
  paths: {
    root: path.resolve(__dirname, '../..'),
    uploads: path.resolve(__dirname, '../../uploads'),
    // Stockage PRIVÉ (jamais servi statiquement) : PDF de contrats (données
    // contractuelles). Accès uniquement via endpoint authentifié + streaming.
    //
    // Par défaut `backend/storage/contracts`. En production, ce dossier est un
    // LIEN vers `shared/storage`, posé par le déploiement : les documents
    // survivent ainsi aux redéploiements. Le chemin résolu est donc le même
    // des deux côtés, et c'est ce qui rend le comportement local et distant
    // identique — le code, lui, ne connaît qu'un seul chemin.
    //
    // La variable d'environnement n'existe que pour les cas où le stockage
    // vit ailleurs (montage dédié, sauvegarde, test) : elle ne change pas la
    // règle, elle déplace la racine.
    contractStorage: (process.env.CONTRACT_STORAGE_DIR || '').trim()
      ? path.resolve(process.env.CONTRACT_STORAGE_DIR.trim())
      : path.resolve(__dirname, '../../storage/contracts'),
  },
  // La protection contractuelle N'EST PLUS un réglage d'environnement : elle
  // vit sur la fiche `SiteStatus` (`contractProtectionEnabled`) et se pilote
  // depuis le Manager comme depuis le Panel. La laisser ici en parallèle
  // recréerait les deux vérités que ce champ supprime.
  // Le DÉLAI DE GRÂCE n'est pas non plus un réglage d'environnement : il vit
  // sur le CONTRAT (`paymentGraceDays`), se règle depuis le Manager et voyage
  // vers le Panel avec le reste du contrat. Un réglage global aurait imposé la
  // même clémence à tous les clients d'un serveur, et surtout : ce champ-ci
  // n'était lu par personne. Il donnait l'illusion d'une politique là où il n'y
  // en avait aucune.

  // ── PONT VERS LE PANEL (Phase 4) ─────────────────────────────────────────
  // Tout est OPTIONNEL : un projet sans Panel démarre, tourne et sert son
  // site exactement comme avant. C'est la règle d'autonomie (04_STANDALONE),
  // et elle vaut aussi pour la configuration.
  panel: {
    // URL du Panel. Requise seulement pour l'appairage automatique au
    // démarrage ; un appairage manuel la fournit à la main.
    url: (process.env.PANEL_URL || '').trim().replace(/\/$/, '') || null,
    // Code d'appairage à usage unique. Présent uniquement le temps du premier
    // démarrage : une fois l'appairage fait, il peut (et devrait) être retiré
    // du .env — il est déjà consommé côté Panel.
    pairingCode: (process.env.PANEL_PAIRING_CODE || '').trim() || null,
    // URL publique de CE backend, transmise au Panel à l'appairage. Sans
    // elle, le Panel connaît le projet mais ne peut pas le rappeler : ni
    // contrôle de santé, ni relecture de manifeste, ni pilotage.
    publicBackendUrl:
      (process.env.PUBLIC_BACKEND_URL || '').trim().replace(/\/$/, '') || null,
    // Cadences. Les défauts suivent les seuils de vivacité du Panel : il
    // classe « périmé » au-delà de 2 intervalles et « hors ligne » au-delà
    // de 6. Un heartbeat toutes les 60 s laisse donc 2 min avant alerte.
    heartbeatIntervalS: positiveInt('PANEL_HEARTBEAT_INTERVAL_S', 60),
    /**
     * CADENCE DE SYNCHRONISATION — 30 s, et non plus 120.
     *
     * ── CE QUE LA VALEUR PRÉCÉDENTE COÛTAIT ──────────────────────────────
     * Ce cycle porte le RATTRAPAGE DESCENDANT : c'est lui, et lui seul, qui
     * va chercher au Panel une configuration d'entreprise fraîchement
     * enregistrée. À deux minutes, un développeur qui modifie « Mon
     * entreprise » puis ouvre la page Aide d'un projet y lit l'ancienne
     * valeur — et conclut, légitimement, que la synchronisation est cassée.
     * Elle ne l'était pas : elle était lente au point de ne plus se voir.
     *
     * ── POURQUOI PAS PLUS COURT ──────────────────────────────────────────
     * Le cycle montant, lui, n'attend plus rien : chaque enregistrement
     * déclenche une poussée immédiate (`runPushCycle`). Cette cadence ne sert
     * donc qu'au sens descendant et au filet de sécurité. Trente secondes
     * suffisent à faire paraître le changement immédiat, sans transformer le
     * parc en sondage permanent du Panel.
     */
    syncIntervalS: positiveInt('PANEL_SYNC_INTERVAL_S', 30),
    // Permet de couper l'ordonnanceur sans désappairer — utile en recette,
    // et indispensable pour que les tests ne déclenchent pas de réseau.
    schedulerEnabled: process.env.PANEL_SCHEDULER_ENABLED !== 'false',
  },
};

export default config;
