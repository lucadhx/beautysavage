// Types catalogue public. Mapping FIDÈLE des payloads backend (rapport 158).
// Règle : tout est optionnel sauf `id`/`name` — on tolère les champs absents, on n'invente rien.
import type { MoneyAmount, DateIso } from '../types';

/** Promotion active (forme backend variable) — on n'expose qu'un éventuel libellé. */
export interface PublicPromotion {
  label?: string;
  [key: string]: unknown;
}

/** Média résolu (URL + texte alternatif). */
export interface PublicMedia {
  url: string;
  alt?: string;
}

/** Entrée FAQ (question / réponse) — prestation, formation ou accueil. */
export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Catégorie publique. NON peuplée par les endpoints publics actuels (cf. 158) ;
 * définie pour un usage futur (filtrage catalogue).
 */
export interface PublicCategory {
  id: string;
  name: string;
}

/** Prestation (service) — `GET /api/vitrine/services` + `/services/:slug`. Clé = `slug`. */
export interface PublicService {
  id: string;
  slug: string;
  name: string;
  shortDescription?: string;
  description?: string;
  duration?: number; // minutes
  price: MoneyAmount;
  effectivePrice?: MoneyAmount;
  hasPromo?: boolean;
  promotionLabel?: string | null;
  photos?: string[];
  isBookable?: boolean;
  paymentType?: 'full' | 'deposit' | 'free' | string;
  capacity?: number;
  options?: PublicServiceOption[];
  practitioners?: PublicPractitioner[]; // détail seulement
  averageRating?: number; // note moyenne publiée (listing)
  reviewCount?: number; // nombre d'avis publiés (listing)
  faq?: FaqItem[]; // FAQ éditable (détail)
}

export interface PublicServiceOption {
  id: string;
  name: string;
  description?: string;
  price?: MoneyAmount;
}

export interface PublicPractitioner {
  id: string;
  displayName: string;
  photo?: string | null;
  color?: string;
}

/** Formation — `GET /api/vitrine/shop` (formations[]) + `/formations/:id`. Clé = `id`. */
export interface PublicTraining {
  id: string;
  name: string;
  description?: string;
  price: MoneyAmount;
  finalPrice?: MoneyAmount;
  coverImage?: string;
  type?: 'distanciel' | 'presentiel' | string;
  refundDays?: number;
  status?: string;
  activePromotion?: PublicPromotion | null;
  createdAt?: DateIso;
  averageRating?: number; // note moyenne publiée (listing)
  reviewCount?: number; // nombre d'avis publiés (listing)
  // détail
  photos?: string[];
  trailerVideoUrl?: string;
  editorialHtml?: string;
  salesCount?: number;
  options?: PublicServiceOption[];
  faq?: FaqItem[]; // FAQ éditable (détail)
}

/** Produit — `GET /api/vitrine/shop` (products[]) + `/products/:id`. Clé = `id`. */
export interface PublicProduct {
  id: string;
  name: string;
  price: MoneyAmount;
  finalPrice?: MoneyAmount;
  coverImage?: string;
  activePromotion?: PublicPromotion | null;
  createdAt?: DateIso;
  // détail
  photos?: string[];
  editorialHtml?: string;
}

/** Réponse `GET /api/vitrine/shop` (formations + produits ensemble). */
export interface PublicShopResponse {
  formations: PublicTraining[];
  products: PublicProduct[];
}

/** Config carte cadeau — `GET /api/vitrine/gift-cards` (pas de liste/détail). */
export interface PublicGiftCardConfig {
  minAmount: number;
  /** 0 = illimité. */
  maxAmount: number;
  /** Montants suggérés (chips). */
  presetAmounts: number[];
  description?: string;
  image?: string;
}

/**
 * Thème vitrine public — `GET /api/vitrine/theme`. Forme NEUTRE (pas de dépendance à @bs/ui) :
 * l'app vitrine mappe ces couleurs vers ses tokens. Tout optionnel (fallback côté UI).
 */
export interface PublicVitrineTheme {
  colors: {
    primary?: string;
    secondary?: string;
    background?: string;
    surface?: string;
    text?: string;
  };
  derivedTokens: {
    surfaceHeader?: string;
    accent?: string;
    accentStrong?: string;
  };
  // M5 — tokens visuels optionnels additifs (Theme Studio). Absents = repli sur les défauts UI.
  typography?: { fontFamily?: string };
  radius?: string;
  shadow?: string;
  spacing?: { x1?: string; x2?: string; x3?: string; x4?: string };
  slogan?: string;
  logoUrl?: string;
}

export type PublicSiteStatusValue = 'active' | 'suspended' | 'maintenance';

/** Statut site — `GET /api/site-status`. */
export interface PublicSiteStatus {
  status: PublicSiteStatusValue;
  reason?: string;
  eta?: string;
  startedAt?: DateIso | null;
  updatedAt?: DateIso | null;
}
