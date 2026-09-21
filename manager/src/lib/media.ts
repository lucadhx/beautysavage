import { API_ROOT } from './api';

/**
 * ADRESSE D'APERÇU d'un média, POUR CET ÉCRAN — et rien d'autre.
 *
 * ── POURQUOI LE NOM A CHANGÉ ────────────────────────────────────────────────
 * Elle s'appelait `resolveMediaUrl`, comme deux autres fonctions du workspace
 * qui n'ont rien à voir avec elle : le résolveur backend du Panel et celui du
 * projet, qui prennent un DESCRIPTEUR et un ENVIRONNEMENT et produisent
 * l'adresse publique d'un média. Trois homonymes pour trois responsabilités
 * distinctes : un lecteur qui cherchait « le résolveur » en trouvait trois.
 *
 * Celle-ci ne décide rien : elle prend une valeur déjà stockée et la rend
 * affichable depuis la page courante (même origine, garde-fou mixed-content).
 * Elle ne produit JAMAIS l'adresse publiée à un tiers — c'est le rôle de
 * `resolveProjectMediaUrl`, côté backend.
 *
 * RÈGLE (LOT logos) : un média est TOUJOURS servi par l'origine que le Manager
 * utilise déjà pour son API — même origine (proxy Vite en dev, Nginx déployé)
 * ou `VITE_API_URL` (cross-origin volontaire). JAMAIS par la « backendUrl »
 * PUBLIQUE de la Configuration réseau : celle-ci décrit l'exposition externe
 * (webhooks, liens partagés) et peut pointer vers un tunnel ngrok périmé ou un
 * domaine pas encore déployé — c'est exactement ce qui faisait disparaître le
 * logo (login/header) selon le domaine backend, alors que l'upload, résolu en
 * même origine, fonctionnait.
 *
 * Aucun composant ne construit d'URL « à la main » : tout `<img>` d'un média
 * stocké passe par `resolvePreviewMediaUrl`.
 *
 * Détails :
 *  - Les uploads sont stockés en chemin RELATIF (`/uploads/x.webp`) ; en même
 *    origine le chemin relatif suffit (proxy Vite en dev, Nginx en prod).
 *  - Garde-fou MIXED-CONTENT : d'anciennes valeurs absolues
 *    `http://localhost:6060/…` peuvent subsister en base. Sur une page HTTPS on
 *    ne doit JAMAIS émettre une URL http/localhost (bloquée par le navigateur) :
 *    on la ramène à son chemin relatif (même origine).
 */
function isHttpsPage(): boolean {
  return typeof window !== 'undefined' && window.location?.protocol === 'https:';
}

function isLocalOrInsecure(host: string, protocol: string): boolean {
  return protocol === 'http:' || host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Cœur PUR de la résolution (testable sans environnement Vite) : `apiRoot` est
 * la racine API effective du Manager — jamais une URL de configuration réseau.
 */
export function resolvePreviewMediaUrlWith(url: string | null | undefined, apiRoot: string, httpsPage: boolean): string {
  if (!url) return '';

  // Valeur absolue (http(s):// ou data:).
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) {
    if (url.startsWith('data:')) return url;
    if (httpsPage) {
      try {
        const u = new URL(url);
        // Ancienne URL locale/non sécurisée sur une page HTTPS → chemin relatif
        // (même origine, servi par Nginx). Évite le Mixed Content / loopback.
        if (isLocalOrInsecure(u.hostname, u.protocol)) return `${u.pathname}${u.search}`;
      } catch {
        /* URL malformée : on la laisse telle quelle */
      }
    }
    return url;
  }

  // Chemin relatif : même origine par défaut, préfixe API_ROOT si défini.
  let base = (apiRoot || '').replace(/\/+$/, '');
  // Sur une page HTTPS, ne jamais préfixer avec une racine http (mixed content).
  if (base && httpsPage && /^http:\/\//i.test(base)) base = '';
  if (!base) return url.startsWith('/') ? url : `/${url}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Résout l'URL d'un média stocké (logo, favicon, photo, image de service…).
 * SIGNATURE VOLONTAIREMENT SANS deuxième paramètre : la résolution ne dépend
 * d'aucune configuration réseau — même origine ou VITE_API_URL, point.
 */
export function resolvePreviewMediaUrl(url?: string | null): string {
  return resolvePreviewMediaUrlWith(url, API_ROOT || '', isHttpsPage());
}
