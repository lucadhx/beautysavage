import * as React from 'react';
import { commerceApi, type CommerceProduct, type ServiceCollection } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';

/**
 * LE CATALOGUE, CHARGÉ EN AMONT.
 *
 * L'accueil ne demandait le catalogue qu'une fois monté : le loader
 * disparaissait, puis les rubriques « formations » et « prestations » restaient
 * vides le temps d'un aller-retour à l'API avant de s'afficher d'un coup.
 *
 * Désormais la requête part au DÉMARRAGE de l'application (`main.tsx`), en
 * parallèle du bootstrap — le loader couvre donc ce temps-là. Le résultat est
 * aussi mémorisé d'une visite à l'autre : à la suivante, les fiches mises en
 * avant s'affichent dès la première image, puis se rafraîchissent en silence.
 */
const CATALOG_KEY = 'vitrine.catalog.cache.v1';
const REVIEWS_KEY = 'vitrine.reviews.cache.v1';
const COLLECTIONS_KEY = 'vitrine.collections.cache.v1';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota ou navigation privée : le cache mémoire suffit pour cette visite */
  }
}

let catalog: CommerceProduct[] | null = read<CommerceProduct[]>(CATALOG_KEY);
let reviews: unknown[] | null = read<unknown[]>(REVIEWS_KEY);
let catalogRequest: Promise<CommerceProduct[]> | null = null;
let reviewsRequest: Promise<unknown[]> | null = null;
let collections: ServiceCollection[] | null = read<ServiceCollection[]>(COLLECTIONS_KEY);
let collectionsRequest: Promise<ServiceCollection[]> | null = null;

/** Collections de prestations : même principe que le catalogue (cache + fraîcheur). */
export function prefetchCollections() {
  if (!collectionsRequest) {
    collectionsRequest = commerceApi.collections()
      .then((list) => { collections = list; write(COLLECTIONS_KEY, list); return list; })
      .catch((err) => { collectionsRequest = null; throw err; });
  }
  return collectionsRequest;
}

export function useCollections() {
  const [list, setList] = React.useState<ServiceCollection[] | null>(() => collections);
  React.useEffect(() => {
    let alive = true;
    prefetchCollections().then((fresh) => { if (alive) setList(fresh); }).catch(() => { if (alive) setList((l) => l ?? []); });
    return () => { alive = false; };
  }, []);
  return list;
}

/** Les visuels des fiches de l'accueil : téléchargés avant d'être affichés. */
function preloadFeaturedCovers(list: CommerceProduct[]) {
  const pick = (kinds: CommerceProduct['kind'][]) => {
    const group = list.filter((p) => kinds.includes(p.kind));
    const chosen = group.filter((p) => p.homeFeatured);
    return chosen.length ? chosen : group.slice(0, 3);
  };
  for (const product of [...pick(['DISTANCE_TRAINING', 'IN_PERSON_TRAINING']), ...pick(['SERVICE'])]) {
    const url = resolvePreviewMediaUrl(product.coverUrl || product.gallery?.[0] || '');
    if (url) { const img = new Image(); img.decoding = 'async'; img.src = url; }
  }
}

export function prefetchCatalog() {
  if (!catalogRequest) {
    catalogRequest = commerceApi.catalog()
      .then((list) => { catalog = list; write(CATALOG_KEY, list); preloadFeaturedCovers(list); return list; })
      .catch((err) => { catalogRequest = null; throw err; });
  }
  return catalogRequest;
}

export function prefetchReviews() {
  if (!reviewsRequest) {
    reviewsRequest = commerceApi.reviews(undefined)
      .then((list) => { reviews = list; write(REVIEWS_KEY, list); return list; })
      .catch((err) => { reviewsRequest = null; throw err; });
  }
  return reviewsRequest;
}

/** Le catalogue : immédiatement ce qu'on sait déjà, puis la version fraîche. */
export function useCatalog() {
  const [list, setList] = React.useState<CommerceProduct[]>(() => catalog ?? []);
  React.useEffect(() => {
    let alive = true;
    prefetchCatalog().then((fresh) => { if (alive) setList(fresh); }).catch(() => null);
    return () => { alive = false; };
  }, []);
  return list;
}

export function useReviews() {
  const [list, setList] = React.useState<unknown[]>(() => reviews ?? []);
  React.useEffect(() => {
    let alive = true;
    prefetchReviews().then((fresh) => { if (alive) setList(fresh); }).catch(() => null);
    return () => { alive = false; };
  }, []);
  return list;
}
