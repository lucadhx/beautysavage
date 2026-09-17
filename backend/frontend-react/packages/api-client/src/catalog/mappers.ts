// Mappers fidèles payload backend → types catalogue (cf. 158). Tolérants aux champs absents.
import type {
  PublicService,
  PublicServiceOption,
  PublicPractitioner,
  PublicTraining,
  PublicProduct,
  PublicGiftCardConfig,
  PublicSiteStatus,
  PublicSiteStatusValue,
  PublicPromotion,
} from './types';
import { asRaw, id, str, optStr, num, optNum, rawArr, strArr, type Raw } from './raw';

const mapPromotion = (v: unknown): PublicPromotion | null => {
  if (!v || typeof v !== 'object') return null;
  return v as PublicPromotion;
};

const mapOption = (r: Raw): PublicServiceOption => ({
  id: id(r),
  name: str(r.name),
  description: optStr(r.description),
  price: optNum(r.price),
});

const mapPractitioner = (r: Raw): PublicPractitioner => ({
  id: id(r),
  displayName: str(r.displayName),
  photo: optStr(r.photo) ?? null,
  color: optStr(r.color),
});

export const mapFaq = (input: unknown): { question: string; answer: string }[] =>
  rawArr(input)
    .map((raw) => {
      const r = asRaw(raw);
      return { question: str(r.question), answer: str(r.answer) };
    })
    .filter((f) => f.question && f.answer);

export const mapService = (input: unknown): PublicService => {
  const r = asRaw(input);
  return {
    id: id(r),
    slug: str(r.slug),
    name: str(r.name),
    shortDescription: optStr(r.shortDescription),
    description: optStr(r.description),
    duration: optNum(r.duration),
    price: num(r.price),
    effectivePrice: optNum(r.effectivePrice),
    hasPromo: Boolean(r.hasPromo),
    promotionLabel: optStr(r.promotionLabel) ?? null,
    photos: strArr(r.photos),
    isBookable: r.isBookable !== false,
    paymentType: optStr(r.paymentType),
    capacity: optNum(r.capacity),
    options: rawArr(r.options).map(mapOption),
    practitioners: Array.isArray(r.practitioners) ? rawArr(r.practitioners).map(mapPractitioner) : undefined,
    averageRating: optNum(r.averageRating),
    reviewCount: optNum(r.reviewCount),
    faq: mapFaq(r.faq),
  };
};

export const mapTraining = (input: unknown): PublicTraining => {
  const r = asRaw(input);
  return {
    id: id(r),
    name: str(r.name),
    description: optStr(r.description),
    price: num(r.price),
    finalPrice: optNum(r.finalPrice),
    coverImage: optStr(r.coverImage),
    type: optStr(r.type),
    refundDays: optNum(r.refundDays),
    status: optStr(r.status),
    activePromotion: mapPromotion(r.activePromotion),
    createdAt: optStr(r.createdAt),
    photos: strArr(r.photos),
    trailerVideoUrl: optStr(r.trailerVideoUrl),
    editorialHtml: optStr(r.editorialHtml),
    salesCount: optNum(r.salesCount),
    options: rawArr(r.options).map(mapOption),
    averageRating: optNum(r.averageRating),
    reviewCount: optNum(r.reviewCount),
    faq: mapFaq(r.faq),
  };
};

export const mapProduct = (input: unknown): PublicProduct => {
  const r = asRaw(input);
  return {
    id: id(r),
    name: str(r.name),
    price: num(r.price),
    finalPrice: optNum(r.finalPrice),
    coverImage: optStr(r.coverImage),
    activePromotion: mapPromotion(r.activePromotion),
    createdAt: optStr(r.createdAt),
    photos: strArr(r.photos),
    editorialHtml: optStr(r.editorialHtml),
  };
};

export const mapGiftCardConfig = (input: unknown): PublicGiftCardConfig => {
  const r = asRaw(input);
  const presets = Array.isArray(r.presetAmounts)
    ? (r.presetAmounts as unknown[]).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    : [];
  return {
    minAmount: num(r.minAmount),
    maxAmount: num(r.maxAmount),
    presetAmounts: presets,
    description: optStr(r.description),
    image: optStr(r.image),
  };
};

const SITE_STATUS_VALUES: PublicSiteStatusValue[] = ['active', 'suspended', 'maintenance'];

export const mapSiteStatus = (input: unknown): PublicSiteStatus => {
  const r = asRaw(input);
  const raw = str(r.status, 'active');
  const status = (SITE_STATUS_VALUES as string[]).includes(raw)
    ? (raw as PublicSiteStatusValue)
    : 'active';
  return {
    status,
    reason: optStr(r.reason),
    eta: optStr(r.eta),
    startedAt: optStr(r.startedAt) ?? null,
    updatedAt: optStr(r.updatedAt) ?? null,
  };
};
