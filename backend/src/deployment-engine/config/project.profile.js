/**
 * PROFIL DE PROJET — le SEUL fichier du moteur de déploiement qui connaisse
 * ce projet précis.
 *
 * Règle d'architecture de l'écosystème L.Y Solution (Phase 2D) : le cœur du
 * moteur est strictement générique et identique dans tous les projets ; ce
 * qui distingue un projet d'un autre passe par ce profil, par les templates
 * et par les adapters — jamais par un fork du moteur.
 *
 * Concrètement, ce fichier répond à cinq questions :
 *   1. quel est le SLUG du projet (préfixes PM2, staging, backups) ;
 *   2. quelles APPLICATIONS composent le projet (à builder, à publier) ;
 *   3. quels HÔTES sont dérivés du domaine choisi ;
 *   4. quelles BASES WILDCARD sont gérées par défaut ;
 *   5. quelles VARIABLES d'environnement sont vitales côté serveur.
 *
 * Le reste du moteur ne contient aucun nom de projet, aucun domaine, aucun
 * chemin propre à un client.
 */

/** Slug technique du projet — préfixe des ressources serveur. */
export const PROJECT_SLUG = 'beautysavage';

/** Identifiant inscrit dans le manifeste de build (`/api/version`). */
export const PROJECT_ID = 'beautysavage';

/**
 * Applications construites et publiées par le déploiement.
 *
 * `role` :
 *   - `web`      application front servie en statique sur l'hôte principal ;
 *   - `web-sub`  application front servie sur un sous-domaine dérivé ;
 *   - `server`   backend Node (jamais buildé, jamais servi en statique).
 *
 * `nginxRole` décrit, lui, ce que le moteur Nginx doit produire :
 *   `web` · `web-subdomain` · `api` · `static` · `proxy` · `server`.
 * Le générateur Nginx ne connaît QUE ces rôles — jamais un nom d'application.
 *
 * L'ordre compte : les applications sont installées puis construites dans
 * cet ordre.
 */
export const APPS = Object.freeze([
  Object.freeze({
    id: 'vitrine',
    dir: 'vitrine',
    role: 'web',
    nginxRole: 'web',
    remoteDir: 'vitrine',
    installPhase: 'install_site',
    buildPhase: 'build_site',
    installLabel: 'installation des dépendances de la vitrine',
    buildLabel: 'construction de la vitrine',
    installFailedCode: 'ARTIFACT_INSTALL_SITE_FAILED',
    buildFailedCode: 'ARTIFACT_BUILD_SITE_FAILED',
    missingArtifactCode: 'ARTIFACT_BUILD_SITE_MISSING',
  }),
  Object.freeze({
    id: 'manager',
    dir: 'manager',
    role: 'web-sub',
    nginxRole: 'web-subdomain',
    subdomain: 'manager',
    remoteDir: 'manager',
    installPhase: 'install_manager',
    buildPhase: 'build_manager',
    installLabel: 'installation des dépendances du Manager',
    buildLabel: 'construction du Manager',
    installFailedCode: 'ARTIFACT_INSTALL_MANAGER_FAILED',
    buildFailedCode: 'ARTIFACT_BUILD_MANAGER_FAILED',
    missingArtifactCode: 'ARTIFACT_BUILD_MANAGER_MISSING',
  }),
  Object.freeze({
    id: 'backend',
    dir: 'backend',
    role: 'server',
    nginxRole: 'server',
    remoteDir: 'backend',
  }),
]);

/**
 * Sous-domaine réservé à l'API. Le backend est joignable à la fois sur
 * l'hôte principal (chemin `/api/`) et sur ce sous-domaine dédié.
 */
export const API_SUBDOMAIN = 'api';

/**
 * SCHÉMA RÉSEAU de la destination : quelles clés de son `SystemConfiguration`
 * le déploiement renseigne, et depuis quelle application.
 *
 * C'est une donnée de PROJET, pas de moteur : le schéma appartient à
 * l'application déployée (CORS dynamiques, liens d'e-mails, retours Stripe).
 */
export const RUNTIME_NETWORK_URLS = Object.freeze({
  websiteUrl: Object.freeze({ app: 'vitrine' }),
  managerUrl: Object.freeze({ app: 'manager' }),
  backendUrl: Object.freeze({ api: true }),
});

/**
 * Bases wildcard gérées par l'infrastructure : un certificat `*.base` unique
 * couvre toutes les cibles d'un seul niveau sous cette base.
 * Surchargeable par la variable d'environnement `DEPLOY_WILDCARD_BASES`.
 */
export const DEFAULT_WILDCARD_BASES = Object.freeze(['ly-solution.com']);

/** Racine des sauvegardes sur le serveur. */
export const BACKUP_ROOT = `/var/backups/${PROJECT_SLUG}`;

/** Racine par défaut des déploiements sur le serveur. */
export const DEFAULT_REMOTE_ROOT = '/var/www';

/**
 * Variables devant impérativement être présentes et non vides dans le `.env`
 * distant : le déploiement relit le fichier écrit et refuse de démarrer le
 * service si l'une manque. `__DB_FOR_ENV__` est remplacée à la volée par
 * `DB_TEST` ou `DB_PROD` selon l'ENV déployé.
 */
export const REQUIRED_REMOTE_ENV = Object.freeze([
  'ENV',
  'MONGODB_URI',
  '__DB_FOR_ENV__',
  'JWT_SECRET',
  'INTEGRATED_API_ENCRYPTION_KEY',
]);

/**
 * Sonde publique servant au contrôle FONCTIONNEL des médias après déploiement :
 * la ressource qui expose les URLs de médias du site.
 */
export const PUBLIC_MEDIA_PROBE_PATH = '/api/public/bootstrap';

/** Préfixe des processus PM2 : `<slug>-<host>`. */
export function serviceName(host) {
  return `${PROJECT_SLUG}-${String(host).replace(/[^a-z0-9.-]/gi, '-')}`;
}

/** Préfixe des dossiers temporaires locaux de build. */
/**
 * TAILLE MAXIMALE D'UN CORPS DE REQUÊTE, en mégaoctets — pour Nginx.
 *
 * ══ LE DÉFAUT QUE CETTE CONSTANTE FERME ═════════════════════════════════════
 *
 * Le générateur de vhost n'émettait PAS `client_max_body_size`. Nginx applique
 * alors son défaut : 1 Mo. L'application, elle, acceptait 12 Mo.
 *
 * Un logo de 3 Mo passait donc en local (Express seul) et repartait en 413
 * derrière Nginx — le meme fichier, accepte ici, refuse la. Le refus venait du
 * serveur web : il n'atteignait jamais Node, donc aucun code metier, aucun
 * message utile, aucune trace applicative.
 *
 * La valeur DOIT rester >= au plafond de la politique media (voir
 * `mediaPolicy.js`), marge multipart comprise. Un test de derive le verifie.
 */
export const HTTP_MAX_BODY_MB = 20;

export const BUILD_STAGING_PREFIX = `${PROJECT_SLUG}-build-`;

export default {
  PROJECT_SLUG,
  PROJECT_ID,
  RUNTIME_NETWORK_URLS,
  PUBLIC_MEDIA_PROBE_PATH,
  APPS,
  API_SUBDOMAIN,
  DEFAULT_WILDCARD_BASES,
  BACKUP_ROOT,
  DEFAULT_REMOTE_ROOT,
  REQUIRED_REMOTE_ENV,
  serviceName,
  BUILD_STAGING_PREFIX,
  HTTP_MAX_BODY_MB,
};

/**
 * ══ LES CONSEILS DNS — ce que l'opérateur DE CE PROJET doit aller vérifier ══
 *
 * Ces deux phrases vivaient dans le cœur du moteur, et elles ne le pouvaient
 * pas : elles nomment un ÉCRAN, et l'écran n'est pas le même des deux côtés.
 * Le Panel administre lui-même ses intégrations ; un projet client, non — son
 * DNS est tenu par la plateforme. Le cœur, resté identique dans les deux
 * dépôts, disait donc nécessairement faux à l'un des deux.
 *
 * La différence descend ici, où elle a un sens et une seule définition.
 */
export const DNS_REMEDIATION_HINTS = Object.freeze({
  /** `dns.verify` / `DNS_NOT_RESOLVED` — le domaine ne pointe pas vers le VPS. */
  notResolved: 'Vérifiez que le domaine résout vers l’IP du VPS. La gestion automatique '
    + 'du domaine est assurée par la plateforme L.Y Solution.',
  /** `dns.provider` / `HOSTINGER_*` — le fournisseur DNS a refusé. */
  provider: 'Le DNS est administré par la plateforme L.Y Solution : vérifiez l’appairage '
    + 'du projet et les droits DNS côté Panel.',
});
