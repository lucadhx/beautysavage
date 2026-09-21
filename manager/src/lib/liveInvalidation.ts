/**
 * CANAL D'INVALIDATION LOCALE — un seul par session, pour toute l'application.
 *
 * ══ LE MANQUE QUE CE MODULE COMBLE ══════════════════════════════════════════
 *
 * Le protocole métier fonctionne : le Panel enregistre, livre, et le backend
 * persiste en quelques dizaines de millisecondes. Mais un Manager DÉJÀ OUVERT
 * ne l'apprenait jamais — `useResource` charge une fois, au montage, et ne
 * revalide pas. L'utilisateur voyait l'ancienne valeur jusqu'au rechargement.
 *
 * ══ CE QUE CE CANAL N'EST PAS ═══════════════════════════════════════════════
 *
 * Ce n'est PAS une seconde source de vérité. Il ne transporte AUCUN objet
 * métier : seulement le NOM d'une ressource qui vient de changer. Prévenu,
 * l'écran redemande la donnée à l'API — qui reste la seule autorité.
 *
 *     FLUX PERDU ≠ DONNÉE PERDUE.
 *
 * Si le flux tombe, si le backend redémarre, si personne n'écoute : la donnée
 * est déjà persistée, et un rechargement la montre. Ce canal évite d'avoir à
 * recharger, rien de plus.
 *
 * ══ POURQUOI PAS `EventSource` ══════════════════════════════════════════════
 *
 * Il ne permet pas d'en-tête `Authorization`, et le jeton n'a rien à faire
 * dans une URL — journaux d'accès, historique, référents. On réutilise donc la
 * primitive déjà présente dans ce dépôt : un flux NDJSON lu par `fetch` +
 * reader, exactement comme la progression des déploiements.
 *
 * ══ UN SEUL CANAL, ET IL VIT AU NIVEAU DU MODULE ════════════════════════════
 *
 * Un flux par écran ouvrirait autant de connexions longues que de pages
 * visitées. L'état vit donc ici, partagé : les abonnés vont et viennent, la
 * connexion reste.
 */
import { API_BASE, tokenStore } from '@/lib/api';

export type LiveResource = 'panel-company' | 'client-company' | 'site-status' | 'contract';

export type LiveStatus = 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';

type Ecouteur = (resource: LiveResource) => void;

interface Evenement {
  type: 'resource.changed' | 'live.ready' | 'live.keepalive';
  resource?: LiveResource;
}

const ecouteurs = new Map<LiveResource, Set<Ecouteur>>();
const observateursStatut = new Set<(s: LiveStatus) => void>();

let controleur: AbortController | null = null;
let statut: LiveStatus = 'DISCONNECTED';
let tentative = 0;
let minuteur: ReturnType<typeof setTimeout> | null = null;
let arreteDefinitivement = false;

/**
 * BACKOFF BORNÉ — 1 s, 2 s, 5 s, 10 s, puis 30 s.
 *
 * Le premier report est court : un backend qui redémarre revient en quelques
 * secondes, et faire attendre trente secondes un écran ouvert donnerait
 * l'impression que le live ne marche pas. Les paliers s'écartent ensuite : un
 * backend durablement absent ne doit pas être martelé par chaque onglet.
 */
const PALIERS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function annoncerStatut(prochain: LiveStatus) {
  if (statut === prochain) return;
  statut = prochain;
  observateursStatut.forEach((o) => o(prochain));
}

export function getLiveStatus(): LiveStatus {
  return statut;
}

export function observeLiveStatus(observateur: (s: LiveStatus) => void): () => void {
  observateursStatut.add(observateur);
  observateur(statut);
  return () => observateursStatut.delete(observateur);
}

function diffuser(resource: LiveResource) {
  ecouteurs.get(resource)?.forEach((cb) => {
    try {
      cb(resource);
    } catch {
      /* un abonné fautif n'empêche pas les autres d'être prévenus */
    }
  });
}

async function lireLeFlux(): Promise<void> {
  const token = tokenStore.get();
  // Sans session, il n'y a rien à écouter : ouvrir le flux ne produirait qu'un
  // 401 immédiat, puis une boucle de reconnexion sur un refus certain.
  if (!token) throw new Error('NO_SESSION');

  controleur = new AbortController();
  const res = await fetch(`${API_BASE}/live/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controleur.signal,
  });

  /**
   * UN 401 N'EST PAS UNE PANNE RÉSEAU.
   *
   * Le jeton a expiré : reconnecter en boucle ne ferait qu'enchaîner des refus
   * certains. On s'arrête, et l'application reprendra un flux au prochain
   * chargement — après une nouvelle authentification.
   */
  if (res.status === 401 || res.status === 403) {
    arreteDefinitivement = true;
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok || !res.body) throw new Error(`HTTP_${res.status}`);

  annoncerStatut('CONNECTED');
  tentative = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tampon = '';
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    tampon += decoder.decode(value, { stream: true });
    let idx: number;
    // eslint-disable-next-line no-cond-assign
    while ((idx = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, idx).trim();
      tampon = tampon.slice(idx + 1);
      if (!ligne) continue;
      try {
        const evenement = JSON.parse(ligne) as Evenement;
        if (evenement.type === 'resource.changed' && evenement.resource) {
          diffuser(evenement.resource);
        }
        // `live.ready` et `live.keepalive` n'appellent aucune action : ils
        // maintiennent la connexion et confirment qu'elle est ouverte.
      } catch {
        /* une ligne illisible ne casse pas le flux */
      }
    }
  }
  throw new Error('STREAM_CLOSED');
}

function planifierReconnexion() {
  if (arreteDefinitivement || minuteur) return;
  const delai = PALIERS_MS[Math.min(tentative, PALIERS_MS.length - 1)];
  tentative += 1;
  annoncerStatut('RECONNECTING');
  minuteur = setTimeout(() => {
    minuteur = null;
    void boucle();
  }, delai);
}

async function boucle(): Promise<void> {
  if (arreteDefinitivement) return;
  try {
    await lireLeFlux();
  } catch (err) {
    if ((err as Error)?.message === 'UNAUTHORIZED') {
      annoncerStatut('DISCONNECTED');
      return;
    }
    if ((err as Error)?.name === 'AbortError') return;
  }
  if (!arreteDefinitivement) planifierReconnexion();
}

/** Ouvre le canal s'il ne l'est pas déjà. Idempotent. */
export function startLiveChannel(): void {
  arreteDefinitivement = false;
  if (controleur || minuteur) return;
  void boucle();
}

/** Ferme le canal — déconnexion, démontage de l'application. */
export function stopLiveChannel(): void {
  arreteDefinitivement = true;
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  controleur?.abort();
  controleur = null;
  annoncerStatut('DISCONNECTED');
}

/**
 * S'ABONNE à une ressource. Rend la fonction de désabonnement.
 *
 * Le canal s'ouvre au PREMIER abonné : une application dont aucun écran
 * n'écoute n'ouvre aucune connexion.
 */
export function onResourceChanged(resource: LiveResource, cb: Ecouteur): () => void {
  if (!ecouteurs.has(resource)) ecouteurs.set(resource, new Set());
  ecouteurs.get(resource)!.add(cb);
  startLiveChannel();
  return () => {
    ecouteurs.get(resource)?.delete(cb);
  };
}

/** Réinitialisation — tests uniquement. */
export function resetLiveChannelForTests(): void {
  stopLiveChannel();
  ecouteurs.clear();
  observateursStatut.clear();
  tentative = 0;
  arreteDefinitivement = false;
  statut = 'DISCONNECTED';
}

export default {
  onResourceChanged,
  startLiveChannel,
  stopLiveChannel,
  observeLiveStatus,
  getLiveStatus,
};
