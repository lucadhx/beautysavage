/**
 * Couche de TRADUCTION « métier ».
 *
 * Le moteur parle technique (ssh, nginx, certbot, pm2, health…). Ici, on le
 * traduit en langage rassurant pour un utilisateur non technique. Aucun terme
 * Linux/DevOps ne doit fuiter dans l'UI principale — les détails techniques
 * restent accessibles dans un panneau « Voir les détails », fermé par défaut.
 */
import type { PreflightCheck } from '@/types';
import {
  Server,
  Globe,
  ShieldCheck,
  Wand2,
  BadgeCheck,
  type LucideIcon,
} from 'lucide-react';

/* --------------------------- Préflight : 5 étapes --------------------------- */

export interface FriendlyGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Ids de contrôles techniques rattachés à ce groupe. */
  checkIds: string[];
}

/** Regroupe les contrôles techniques en 5 étapes lisibles (cahier des charges §7). */
export const PREFLIGHT_GROUPS: FriendlyGroup[] = [
  { id: 'server', label: 'Connexion au serveur', icon: Server, checkIds: ['ssh'] },
  {
    id: 'domain',
    label: 'Configuration du domaine',
    icon: Globe,
    // `occupied` : l'adresse n'est pas déjà prise par un autre site.
    checkIds: ['dns', 'dns-resolves', 'dns-points', 'occupied'],
  },
  {
    id: 'prepare',
    label: 'Préparation du site',
    icon: Wand2,
    checkIds: ['nginx', 'node', 'pm2', 'nginx-config', 'permissions', 'disk', 'mongo'],
  },
  // `wildcard-cert` : présence du certificat wildcard *.base (sous-domaine géré).
  { id: 'https', label: 'Sécurisation HTTPS', icon: ShieldCheck, checkIds: ['certbot', 'wildcard-cert'] },
];

/** Étape de synthèse finale, calculée à partir de l'ensemble. */
export const FINAL_GROUP: FriendlyGroup = {
  id: 'final',
  label: 'Vérification finale',
  icon: BadgeCheck,
  checkIds: [],
};

export type GroupStatus = 'pending' | 'running' | 'ok' | 'error';

export interface GroupResult {
  group: FriendlyGroup;
  status: GroupStatus;
  checks: PreflightCheck[];
}

/**
 * Projette la liste de contrôles techniques sur les groupes lisibles.
 * Un groupe est « ok » si tous ses contrôles requis passent ; « error » si un
 * contrôle requis échoue ; ignoré s'il n'a aucun contrôle applicable.
 */
export function groupPreflight(checks: PreflightCheck[]): GroupResult[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const results: GroupResult[] = [];
  for (const group of PREFLIGHT_GROUPS) {
    const applicable = group.checkIds.map((id) => byId.get(id)).filter(Boolean) as PreflightCheck[];
    if (applicable.length === 0) continue;
    const requiredFailed = applicable.some((c) => c.required && !c.ok);
    results.push({ group, status: requiredFailed ? 'error' : 'ok', checks: applicable });
  }
  const anyError = results.some((r) => r.status === 'error');
  results.push({ group: FINAL_GROUP, status: anyError ? 'error' : 'ok', checks: [] });
  return results;
}

/**
 * ══ IL N'Y A PLUS AUCUNE LISTE D'ÉTAPES DE DÉPLOIEMENT ICI ═══════════════════
 *
 * Quatre constantes occupaient cette place :
 *
 *   · la checklist du déploiement — ids, libellés, icônes et ORDRE, recopiés à
 *     la main depuis le catalogue du moteur ;
 *   · celle du préflight — le même sous-ensemble, avec des libellés DIFFÉRENTS
 *     pour les mêmes identifiants ;
 *   · une table indexée par les identifiants BRUTS du pipeline distant (dirs,
 *     certbot, reload), que l'interface n'a aucune raison de connaître ;
 *   · l'ordre de cette dernière.
 *
 * Elles ont dérivé, et le contrôle de gouvernance l'a constaté : le moteur avait
 * renommé une étape, l'écran a continué d'afficher une ligne qui ne recevait
 * plus jamais d'événement. Elle restait « en attente » sur un déploiement
 * pourtant réussi, et la barre de progression comptait une étape fantôme.
 *
 * La définition vit désormais dans le registre canonique du moteur
 * (`backend/src/deployment-engine/steps.js`), servie par `GET /deployment/phases`
 * et consommée par `deploymentChecklist.ts`, qui en dérive les DEUX checklists.
 *
 * ══ NE RAJOUTEZ PAS D'ÉTAPE ICI ══════════════════════════════════════════════
 *
 * Ce fichier ne fait plus que de la PRÉSENTATION D'ERREURS : traduire un code
 * technique en cause et en solution lisibles. Une étape ajoutée ici ne serait
 * jamais émise par le moteur. Une garde d'architecture le vérifie.
 */

/* --------------------------- Erreurs humanisées --------------------------- */

export interface FriendlyError {
  title: string;
  cause: string;
  solution: string;
}

const ERROR_MAP: Record<string, FriendlyError> = {
  NO_VPS_SESSION: {
    title: 'Connexion au serveur perdue',
    cause: 'La connexion sécurisée au serveur a expiré ou a été fermée.',
    solution: 'Reconnectez-vous au serveur, puis relancez la publication.',
  },
  PREFLIGHT_FAILED: {
    title: 'Le serveur n’est pas tout à fait prêt',
    cause: 'Une vérification préalable n’a pas pu aboutir.',
    solution: 'Consultez les points signalés ci-dessous, corrigez-les puis réessayez.',
  },
  WILDCARD_CERT_MISSING: {
    title: 'Certificat de sécurité introuvable',
    cause: 'Le certificat partagé pour ce type d’adresse n’a pas été trouvé sur le serveur.',
    solution: 'Vérifiez la préparation du serveur avec votre prestataire, puis réessayez.',
  },
  CERT_ISSUANCE_FAILED: {
    title: 'La sécurisation HTTPS a échoué',
    cause: 'Le certificat de sécurité n’a pas pu être délivré pour cette adresse.',
    solution: 'Assurez-vous que l’adresse pointe bien vers ce serveur, puis relancez la publication.',
  },
  NGINX_CONFIG_INVALID: {
    title: 'La configuration du site est invalide',
    cause: 'Les réglages du domaine n’ont pas pu être appliqués.',
    solution: 'Réessayez ; si le problème persiste, ouvrez les détails techniques.',
  },
  PM2_RESTART_FAILED: {
    title: 'L’application n’a pas redémarré',
    cause: 'Le service du site n’a pas pu démarrer.',
    solution: 'Relancez la publication ; si cela recommence, consultez les détails techniques.',
  },
  HEALTH_LOCAL_FAILED: {
    title: 'Le site ne répond pas encore',
    cause: 'L’application ne s’est pas lancée correctement.',
    solution: 'Réessayez dans un instant.',
  },
  HEALTH_PUBLIC_FAILED: {
    title: 'Le site n’est pas joignable publiquement',
    cause: 'Le site ne répond pas encore en ligne.',
    solution: 'Vérifiez l’adresse et réessayez dans un instant.',
  },
  ENV_MISMATCH: {
    title: 'Environnement inattendu',
    cause: 'La version en ligne n’utilise pas l’environnement prévu.',
    solution: 'Relancez la publication en vérifiant l’environnement choisi.',
  },
  BUILD_FAILED: {
    title: 'La préparation de la version a échoué',
    cause: 'Le site n’a pas pu être préparé avant l’envoi.',
    solution: 'Réessayez ; ouvrez les détails techniques si le problème persiste.',
  },
  REMOTE_COMMAND_FAILED: {
    title: 'Une opération sur le serveur a échoué',
    cause: 'Une étape n’a pas pu être menée à bien sur le serveur.',
    solution: 'Relancez la publication.',
  },
  VALIDATION_ERROR: {
    title: 'Informations incomplètes',
    cause: 'Certaines informations saisies sont invalides.',
    solution: 'Vérifiez les champs, puis réessayez.',
  },
  OFFLINE: {
    title: 'Serveur momentanément injoignable',
    cause: 'Le service n’a pas répondu.',
    solution: 'Vérifiez votre connexion puis réessayez.',
  },
  // Le flux s'est tu sans se fermer : ni fin, ni erreur, ni rapport. On ne
  // prétend pas savoir pourquoi — on rend la main plutôt que de faire tourner
  // une roue indéfiniment sur une étape que plus personne n'exécute.
  STREAM_SILENT: {
    title: 'La vérification ne répond plus',
    cause: 'Le serveur a cessé d’envoyer des nouvelles pendant la vérification, '
      + 'sans signaler ni fin ni erreur. Rien n’a été déployé.',
    solution: 'Relancez la vérification. Si le silence se répète, le rapport '
      + 'technique indique la dernière étape atteinte.',
  },
  // Refus AVANT tout démarrage : rien n'a été déployé, rien n'a été touché sur
  // le serveur. Le dire explicitement évite de chercher une panne côté serveur.
  PANEL_DEPLOY_LOCAL_PREREQUISITES_FAILED: {
    title: 'Impossible de lancer le déploiement',
    cause: 'Source Git non commitée.',
    solution: 'Committez vos modifications puis réessayez.',
  },
};

const DEFAULT_ERROR: FriendlyError = {
  title: 'Nous n’avons pas pu terminer l’opération',
  cause: 'Une erreur inattendue est survenue.',
  solution: 'Réessayez ; si le problème persiste, consultez les détails techniques.',
};

export function humanizeError(code: string | undefined, message?: string): FriendlyError {
  const base = (code && ERROR_MAP[code]) || DEFAULT_ERROR;
  // On enrichit la cause avec le message précis quand il est parlant et court.
  if (message && message.length < 140 && (!code || !ERROR_MAP[code])) {
    return { ...base, cause: message };
  }
  return base;
}

/** Formate une durée en ms → « 12 s » ou « 1 min 05 ». */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m} min ${String(rem).padStart(2, '0')}`;
}
