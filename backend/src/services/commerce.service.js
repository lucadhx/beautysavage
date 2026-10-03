import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { Cart } from '../models/Cart.model.js';
import { CommerceProduct, PRODUCT_STATUS } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { CommerceCommission } from '../models/CommerceCommission.model.js';
import { Customer } from '../models/Customer.model.js';
import { InstituteIntegration } from '../models/InstituteIntegration.model.js';
import { Review } from '../models/Review.model.js';
import { RefundRequest } from '../models/RefundRequest.model.js';
import { GiftCard, hashGiftSecret, maskGiftCode, encryptGiftCode, decryptGiftCode, normalizeGiftCode } from '../models/GiftCard.model.js';
import { TrainingSubmission } from '../models/TrainingSubmission.model.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/eventPayloadSafety.js';
import { EVENT_ACTOR_TYPE } from '../utils/domainEventConstants.js';
import { decryptSecret, encryptSecret, lastFourOf, maskFromLastFour } from '../utils/integratedApiCrypto.js';
import { provisionInstituteBrevoWebhook } from './email/instituteEmail.service.js';
import { signCustomerToken } from '../middlewares/customerAuth.middleware.js';
import { assertNoOverlap, cancelEvent, sessionBlocks } from './calendar.service.js';
import { activeCommissionRule, applyCommissionCap, computeSaleCommission } from './commissionRules.js';
import { activePromotion, effectivePriceCents } from './commercePromotion.js';
import { paymentSplit, publicPaymentRule } from './commercePaymentRules.js';
import { configuredSiteUrl } from '../utils/siteOrigin.js';
import { view as commissionView } from './commissionPayment.service.js';
import { emitAppointmentBooked, isPendingInstituteAccount, sendCustomerAccessLink } from './commerceCustomer.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import {
  activeInstituteMode,
  assertInstituteKeyMatchesMode,
  createInstituteCheckoutSession,
  instituteStripeReady,
  provisionInstituteStripeWebhook,
  refundInstitutePayment,
  retrieveInstituteCheckoutSession,
  expireInstituteCheckoutSession,
  createInstituteCoupon,
  retrieveInstituteInvoice,
} from './instituteStripe.service.js';
import {
  generateCreditNotePdf,
  generateGiftCardPdf,
  generateSaleInvoicePdf,
} from './commerceDocuments.service.js';

/**
 * La FAQ telle que la vitrine peut l'afficher : une question ET une réponse,
 * rien d'autre. Le Manager la saisissait déjà, mais la fiche publique ne la
 * transportait pas — elle n'apparaissait donc nulle part.
 */
function publicFaq(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      question: String(row?.question || '').trim(),
      answer: String(row?.answer || '').trim(),
    }))
    .filter((row) => row.question && row.answer);
}

function publicProduct(product) {
  const promotion = activePromotion(product);
  return {
    id: String(product._id),
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    kind: product.kind,
    status: product.status,
    // Le prix À PAYER (promotion comprise) ; le prix d'origine, barré, quand une promotion court.
    price: promotion ? { ...(product.price?.toObject?.() ?? product.price), amountCents: promotion.priceCents } : product.price,
    compareAtPrice: promotion ? { amountCents: promotion.originalCents, currency: product.price?.currency || 'EUR' } : null,
    paymentRule: publicPaymentRule(product),
    promotion: promotion ? { percentOff: promotion.percentOff, discountCents: promotion.discountCents, type: promotion.type, value: promotion.value, startsAt: promotion.startsAt, endsAt: promotion.endsAt } : null,
    coverUrl: product.coverUrl,
    gallery: product.gallery || [],
    durationMinutes: product.durationMinutes || 0,
    trailer: product.trailer || {},
    whatsappGroup: product.whatsappGroup || {},
    bookingRules: product.bookingRules || {},
    modules: product.modules || [],
    faq: publicFaq(product.faq),
    consentRequirements: lineConsentRequirements(product),
    options: (product.options || []).filter((option) => option.active),
    sessions: (product.sessions || [])
      .filter((session) => session.status === 'ACTIVE')
      .map((session) => ({
        id: String(session._id),
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        // Les jours de la session (jour 1, jour 2…) avec leurs horaires.
        days: sessionBlocks(session),
        capacity: session.capacity,
        remaining: Math.max(0, (session.capacity || 0) - (session.reservedCount || 0)),
      })),
    distanceDeliveryMode: product.distanceDeliveryMode,
    requiresLegalWaiver: product.requiresLegalWaiver,
    boostRank: product.boostRank,
    homeFeatured: Boolean(product.homeFeatured),
    homeFeaturedRank: product.homeFeaturedRank ?? null,
    training: {
      location: product.training?.location || '',
      durationDays: product.training?.durationDays || null,
      dayHours: Array.isArray(product.training?.dayHours) ? product.training.dayHours : [],
    },
  };
}

export function sanitizeGoogleDriveFileId(value) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) {
    throw ApiError.badRequest('ID de fichier Google Drive invalide');
  }
  return id;
}

function googleDriveFileId(url) {
  const raw = String(url || '').trim();
  if (!raw) throw ApiError.badRequest('URL Google Drive requise');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw ApiError.badRequest('URL Google Drive invalide');
  }
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('drive.google.com') && !host.endsWith('drive.usercontent.google.com')) {
    throw ApiError.badRequest('Collez une URL Google Drive du type https://drive.google.com/file/d/.../view');
  }
  const match = raw.match(/\/file\/d\/([^/]+)/) || raw.match(/[?&]id=([^&]+)/);
  const id = match?.[1] ? decodeURIComponent(match[1]) : '';
  try {
    return sanitizeGoogleDriveFileId(id);
  } catch {
    throw ApiError.badRequest('ID de fichier Google Drive introuvable dans cette URL');
  }
}

function hiddenInputs(html) {
  const inputs = {};
  for (const match of String(html || '').matchAll(/<input[^>]+type=["']hidden["'][^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
    const value = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? '';
    if (name) inputs[name] = value.replace(/&amp;/g, '&');
  }
  return inputs;
}

const DRIVE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 BeautySavage/1.0';
const googleDrivePlaybackCache = new Map();

const STREAMABLE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 BeautySavage/1.0';

export function sanitizeStreamableShortcode(value) {
  const shortcode = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9]{4,12}$/.test(shortcode)) {
    throw ApiError.badRequest('Code Streamable invalide');
  }
  return shortcode;
}

function streamableShortcode(url) {
  const raw = String(url || '').trim();
  if (!raw) throw ApiError.badRequest('URL Streamable requise');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw ApiError.badRequest('URL Streamable invalide');
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'streamable.com' && !host.endsWith('.streamable.com')) {
    throw ApiError.badRequest('Collez une URL Streamable du type https://streamable.com/xxxxxx');
  }
  const shortcode = parsed.pathname.split('/').filter(Boolean).at(0) || '';
  return sanitizeStreamableShortcode(shortcode);
}

function decodeStreamableEscapes(value = '') {
  return String(value)
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/gi, '/');
}

function normalizeStreamableUrl(value = '') {
  const url = decodeStreamableEscapes(value).trim();
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function extractStreamableMp4Urls(html) {
  const decoded = decodeStreamableEscapes(html);
  const urls = new Set();
  for (const attr of ['og:video', 'og:video:secure_url']) {
    const match = decoded.match(new RegExp(`<meta[^>]+property=["']${attr}["'][^>]+content=["']([^"']+)["']`, 'i'));
    const url = normalizeStreamableUrl(match?.[1] || '');
    if (/^https:\/\/.+\.mp4(?:[?#].*)?$/i.test(url)) urls.add(url);
  }
  for (const match of decoded.matchAll(/(?:https?:)?\/\/[^"'<>\\\s]+\/video\/(?:mp4|mp4-mobile)\/[^"'<>\\\s]+\.mp4[^"'<>\\\s]*/gi)) {
    const url = normalizeStreamableUrl(match[0]);
    if (/^https:\/\//i.test(url)) urls.add(url);
  }
  return [...urls];
}

async function fetchStreamableHtml(shortcode) {
  const page = `https://streamable.com/${encodeURIComponent(shortcode)}`;
  const response = await fetch(page, {
    redirect: 'follow',
    headers: {
      'User-Agent': STREAMABLE_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = await response.text();
  return {
    page,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type') || '',
    html,
  };
}

async function probeStreamableMp4(url, attempts = []) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': STREAMABLE_USER_AGENT,
        Accept: 'video/mp4,*/*',
        Range: 'bytes=0-4095',
      },
    });
    const contentType = response.headers.get('content-type') || '';
    const contentRange = response.headers.get('content-range') || '';
    attempts.push({ strategy: 'streamable-cdn-range', status: response.status, type: contentType, range: contentRange, url: response.url || url });
    if (!response.ok || !/^video\/mp4/i.test(contentType)) return null;
    return {
      url: response.url || url,
      contentType: 'video/mp4',
      contentLength: totalFromRange(contentRange) || Number(response.headers.get('content-length') || 0),
    };
  } catch (err) {
    attempts.push({ strategy: 'streamable-cdn-range', error: err.message, url });
    return null;
  }
}

async function resolveStreamablePlayback(shortcode) {
  const safeCode = sanitizeStreamableShortcode(shortcode);
  const attempts = [];
  const page = await fetchStreamableHtml(safeCode);
  attempts.push({ strategy: 'streamable-page', status: page.status, type: page.contentType, page: page.page });
  if (!page.ok) throw ApiError.badRequest('Vidéo Streamable introuvable ou non publique.');
  const candidates = extractStreamableMp4Urls(page.html);
  for (const candidate of candidates) {
    const probe = await probeStreamableMp4(candidate, attempts);
    if (probe) {
      return {
        shortcode: safeCode,
        sourceUrl: `https://streamable.com/${safeCode}`,
        playbackUrl: probe.url,
        contentType: probe.contentType,
        mimeType: 'video/mp4',
        contentLength: probe.contentLength,
        strategy: 'streamable-page-source',
        resolvedAt: new Date().toISOString(),
      };
    }
  }
  logger.warn('[streamable-video] resolution failed', { shortcode: safeCode, attempts });
  throw ApiError.badRequest('Impossible de récupérer la source MP4 Streamable pour cette vidéo.');
}

export async function resolveStreamableVideo(payload = {}) {
  const sourceUrl = String(payload.url || '').trim();
  const shortcode = streamableShortcode(sourceUrl);
  const playback = await resolveStreamablePlayback(shortcode);
  return {
    sourceUrl: `https://streamable.com/${shortcode}`,
    provider: 'STREAMABLE',
    shortcode,
    contentType: playback.contentType,
    size: playback.contentLength,
    strategy: playback.strategy,
    resolvedAt: playback.resolvedAt,
  };
}

export async function getStreamableTemporaryPlayback(shortcode) {
  return resolveStreamablePlayback(shortcode);
}

function decodeHeaderFilename(value = '') {
  const star = String(value).match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try { return decodeURIComponent(star.replace(/^"|"$/g, '')); } catch { return star; }
  }
  return String(value).match(/filename="?([^";]+)"?/i)?.[1] || '';
}

function looksLikeMp4(probe = {}) {
  return /^video\/mp4/i.test(probe.contentType || '')
    || /\.mp4(?:$|[?#])/i.test(probe.url || '')
    || /\.mp4$/i.test(decodeHeaderFilename(probe.contentDisposition || ''));
}

function totalFromRange(value = '') {
  const total = String(value).match(/\/(\d+)$/)?.[1];
  return total ? Number(total) : 0;
}

function probeFromResponse(response, fallbackUrl) {
  return {
    ok: response.ok,
    status: response.status,
    url: response.url || fallbackUrl,
    contentType: response.headers.get('content-type') || '',
    contentDisposition: response.headers.get('content-disposition') || '',
    contentRange: response.headers.get('content-range') || '',
    contentLength: totalFromRange(response.headers.get('content-range') || '')
      || Number(response.headers.get('content-length') || 0),
  };
}

async function headVideo(url) {
  const response = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    headers: { 'User-Agent': DRIVE_USER_AGENT },
  });
  return probeFromResponse(response, url);
}

async function sniffVideo(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': DRIVE_USER_AGENT,
      Accept: 'video/mp4,application/octet-stream,*/*',
      Range: 'bytes=0-4095',
    },
  });
  const probe = probeFromResponse(response, url);
  if (!response.ok || !response.body) return { ...probe, hasMp4Signature: false };
  const reader = response.body.getReader();
  const { value } = await reader.read();
  await reader.cancel().catch(() => {});
  const bytes = Buffer.from(value || []);
  const ascii = bytes.subarray(0, Math.min(bytes.length, 64)).toString('latin1');
  return { ...probe, hasMp4Signature: ascii.includes('ftyp') };
}

async function probeMp4Url(url, strategy, attempts) {
  try {
    const head = await headVideo(url);
    attempts.push({ strategy: `${strategy}:head`, status: head.status, type: head.contentType, disposition: head.contentDisposition, url: head.url });
    if (head.ok && looksLikeMp4(head)) return { ...head, strategy };
  } catch (err) {
    attempts.push({ strategy: `${strategy}:head`, error: err.message });
  }

  try {
    const sniff = await sniffVideo(url);
    attempts.push({
      strategy: `${strategy}:range`,
      status: sniff.status,
      type: sniff.contentType,
      disposition: sniff.contentDisposition,
      range: sniff.contentRange,
      signature: sniff.hasMp4Signature,
      url: sniff.url,
    });
    if (sniff.ok && (looksLikeMp4(sniff) || sniff.hasMp4Signature)) {
      return { ...sniff, contentType: 'video/mp4', strategy };
    }
  } catch (err) {
    attempts.push({ strategy: `${strategy}:range`, error: err.message });
  }
  return null;
}

function googleDriveDownloadUrl(fileId) {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
}

function decodeDriveEscapes(value = '') {
  return String(value)
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function extractDriveCandidateUrls(html) {
  const decoded = decodeDriveEscapes(html);
  const candidates = new Set();
  for (const match of decoded.matchAll(/https?:\/\/[^"'<>\\\s]+/gi)) {
    const url = match[0];
    if (/videoplayback|drive\.usercontent\.google\.com\/download|drive\.google\.com\/uc/i.test(url)) {
      candidates.add(url);
    }
  }
  for (const match of decoded.matchAll(/https%3A%2F%2F[^"'<>\\\s]+/gi)) {
    try {
      const url = decodeURIComponent(match[0]);
      if (/videoplayback|drive\.usercontent\.google\.com\/download|drive\.google\.com\/uc/i.test(url)) {
        candidates.add(url);
      }
    } catch {
      // Un fragment partiellement encodé n'est pas une URL exploitable.
    }
  }
  return [...candidates];
}

function extractDriveViewerApiKeys(html) {
  return [...new Set(String(html || '').match(/AIza[0-9A-Za-z_-]{20,}/g) || [])];
}

async function fetchDrivePreviewHtml(fileId) {
  const page = `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
  const response = await fetch(page, {
    redirect: 'follow',
    headers: { 'User-Agent': DRIVE_USER_AGENT },
  });
  return {
    page,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    html: await response.text(),
  };
}

function directPlaybackExpiry(url) {
  try {
    const expire = Number(new URL(url).searchParams.get('expire') || 0);
    return expire ? new Date(expire * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function qualityRank(format = {}) {
  const label = String(format.qualityLabel || '').match(/(\d+)/)?.[1];
  return Number(label || 0) || Number(format.height || 0) || 0;
}

function parseWorkspacePlaybackPayload(payload) {
  const serialized = payload?.mediaStreamingData?.serializedHouseBrandPlayerResponse;
  if (!serialized) return null;
  let player;
  try {
    player = JSON.parse(serialized);
  } catch {
    return null;
  }
  const streamingData = player.streamingData || {};
  const formats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])]
    .filter((format) => format?.url && /video\/mp4/i.test(format.mimeType || '') && /videoplayback/i.test(format.url))
    .map((format) => ({
      itag: format.itag,
      url: format.url,
      mimeType: format.mimeType,
      bitrate: Number(format.bitrate || format.averageBitrate || 0),
      width: Number(format.width || 0),
      height: Number(format.height || 0),
      quality: format.quality || '',
      qualityLabel: format.qualityLabel || '',
      durationMs: Number(format.approxDurationMs || 0),
      contentLength: Number(format.contentLength || 0),
      hasAudio: Boolean(format.audioQuality || format.audioChannels),
    }))
    .sort((a, b) => {
      if (a.hasAudio !== b.hasAudio) return a.hasAudio ? -1 : 1;
      return qualityRank(b) - qualityRank(a) || b.bitrate - a.bitrate;
    });
  return {
    expiresInSeconds: Number(streamingData.expiresInSeconds || 0),
    formats,
  };
}

async function fetchDrivePlaybackPayload(fileId, apiKey, attempts) {
  const unique = `bs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const url = `https://content-workspacevideo-pa.googleapis.com/v1/drive/media/${encodeURIComponent(fileId)}/playback?auditContext=forDisplay&key=${encodeURIComponent(apiKey)}&%24unique=${encodeURIComponent(unique)}`;
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': DRIVE_USER_AGENT,
      Accept: 'application/json',
      Origin: 'https://drive.google.com',
      Referer: `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
    },
  });
  const text = await response.text();
  attempts.push({ strategy: 'workspace-video-playback', status: response.status, type: response.headers.get('content-type') || '', key: `${apiKey.slice(0, 10)}...` });
  if (!response.ok) return null;
  try {
    return JSON.parse(text);
  } catch {
    attempts.push({ strategy: 'workspace-video-playback:parse', error: 'JSON invalide' });
    return null;
  }
}

async function resolveGoogleDriveTemporaryPlayback(fileId, attempts = []) {
  const cached = googleDrivePlaybackCache.get(fileId);
  if (cached?.cacheUntil > Date.now()) {
    attempts.push({ strategy: 'workspace-video-playback-cache', status: 200, type: cached.contentType });
    return { ...cached, fromCache: true };
  }
  const preview = await fetchDrivePreviewHtml(fileId);
  attempts.push({ strategy: 'drive-preview-html', status: preview.status, type: preview.contentType, page: preview.page });
  const keys = extractDriveViewerApiKeys(preview.html);
  for (const apiKey of keys) {
    const payload = await fetchDrivePlaybackPayload(fileId, apiKey, attempts);
    const parsed = parseWorkspacePlaybackPayload(payload);
    const selected = parsed?.formats?.[0];
    if (!selected) continue;
    const playback = {
      fileId,
      playbackUrl: selected.url,
      contentType: 'video/mp4',
      mimeType: selected.mimeType,
      expiresInSeconds: parsed.expiresInSeconds,
      expiresAt: directPlaybackExpiry(selected.url),
      qualityLabel: selected.qualityLabel,
      width: selected.width,
      height: selected.height,
      bitrate: selected.bitrate,
      durationMs: selected.durationMs,
      contentLength: selected.contentLength,
      strategy: 'workspace-video-playback',
      formats: parsed.formats.map((format) => ({
        itag: format.itag,
        mimeType: format.mimeType,
        qualityLabel: format.qualityLabel,
        width: format.width,
        height: format.height,
        bitrate: format.bitrate,
        durationMs: format.durationMs,
        contentLength: format.contentLength,
        hasAudio: format.hasAudio,
      })),
    };
    const expiresAtMs = playback.expiresAt ? Date.parse(playback.expiresAt) : 0;
    googleDrivePlaybackCache.set(fileId, {
      ...playback,
      cacheUntil: expiresAtMs ? Math.max(Date.now(), expiresAtMs - 10 * 60 * 1000) : Date.now() + 15 * 60 * 1000,
    });
    return playback;
  }
  return null;
}

async function scrapeGoogleDriveVideoCandidates(fileId, attempts) {
  const pages = [
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view?usp=sharing`,
    `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`,
  ];
  const candidates = new Set();
  for (const page of pages) {
    try {
      const response = await fetch(page, {
        redirect: 'follow',
        headers: { 'User-Agent': DRIVE_USER_AGENT },
      });
      const html = await response.text();
      attempts.push({ strategy: 'scrape:page', status: response.status, type: response.headers.get('content-type') || '', page });
      for (const url of extractDriveCandidateUrls(html)) candidates.add(url);
    } catch (err) {
      attempts.push({ strategy: 'scrape:page', page, error: err.message });
    }
  }
  return [...candidates];
}

async function resolveGoogleDriveMp4Download(fileId, options = {}) {
  const attempts = [];
  if (options.preferPlayback !== false) {
    const playback = await resolveGoogleDriveTemporaryPlayback(fileId, attempts);
    if (playback) {
      return {
        ok: true,
        status: 200,
        url: playback.playbackUrl,
        contentType: playback.contentType,
        contentDisposition: '',
        contentRange: '',
        contentLength: playback.contentLength,
        strategy: playback.strategy,
        playback,
        attempts,
      };
    }
  }
  const firstUrl = googleDriveDownloadUrl(fileId);
  let probe = await probeMp4Url(firstUrl, 'drive-usercontent-direct', attempts);
  if (probe) return { ...probe, attempts };

  probe = await probeMp4Url(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`, 'drive-uc-direct', attempts);
  if (probe) return { ...probe, attempts };

  const warning = await fetch(firstUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': DRIVE_USER_AGENT },
  });
  const html = await warning.text();
  const formAction = html.match(/<form[^>]+id=["']download-form["'][^>]+action=["']([^"']+)["']/i)?.[1]
    || 'https://drive.usercontent.google.com/download';
  const values = hiddenInputs(html);
  if (values.id) {
    const confirmed = new URL(formAction.replace(/&amp;/g, '&'));
    for (const [key, value] of Object.entries(values)) confirmed.searchParams.set(key, value);
    probe = await probeMp4Url(confirmed.toString(), 'drive-confirm-form', attempts);
    if (probe) return { ...probe, attempts };
  }

  for (const candidate of extractDriveCandidateUrls(html)) {
    probe = await probeMp4Url(candidate, 'download-page-scrape', attempts);
    if (probe) return { ...probe, attempts };
  }

  for (const candidate of await scrapeGoogleDriveVideoCandidates(fileId, attempts)) {
    probe = await probeMp4Url(candidate, 'preview-page-scrape', attempts);
    if (probe) return { ...probe, attempts };
  }

  logger.warn('[google-drive-video] resolution failed', {
    fileId,
    attempts: attempts.map((attempt) => ({
      strategy: attempt.strategy,
      status: attempt.status,
      type: attempt.type,
      disposition: attempt.disposition,
      range: attempt.range,
      signature: attempt.signature,
      error: attempt.error,
    })),
  });
  throw ApiError.badRequest('Impossible de récupérer une source MP4 lisible depuis ce lien Google Drive. Le fichier doit être public et lisible/téléchargeable.');
}

export function googleDriveVideoStreamPath(fileId) {
  const safeId = sanitizeGoogleDriveFileId(fileId);
  return `/api/public/commerce/videos/google-drive/${encodeURIComponent(safeId)}/stream`;
}

export async function resolveGoogleDriveVideo(payload = {}) {
  const sourceUrl = String(payload.url || '').trim();
  const fileId = googleDriveFileId(sourceUrl);
  const probe = await resolveGoogleDriveMp4Download(fileId);
  const streamPath = googleDriveVideoStreamPath(fileId);
  const playback = probe.playback || null;
  return {
    sourceUrl,
    fileId,
    playbackUrl: playback?.playbackUrl || probe.url,
    playbackUrlExpiresAt: playback?.expiresAt || directPlaybackExpiry(probe.url),
    expiresInSeconds: playback?.expiresInSeconds || null,
    streamPath,
    streamUrl: '',
    contentType: probe.contentType,
    size: probe.contentLength,
    strategy: probe.strategy,
    qualityLabel: playback?.qualityLabel || null,
    width: playback?.width || null,
    height: playback?.height || null,
    bitrate: playback?.bitrate || null,
    durationMs: playback?.durationMs || null,
    formats: playback?.formats || [],
    resolvedAt: new Date().toISOString(),
  };
}

export async function getGoogleDriveTemporaryPlayback(fileId) {
  const safeId = sanitizeGoogleDriveFileId(fileId);
  const attempts = [];
  const playback = await resolveGoogleDriveTemporaryPlayback(safeId, attempts);
  if (playback) return { ...playback, resolvedAt: new Date().toISOString() };
  logger.warn('[google-drive-video] playback url resolution failed', { fileId: safeId, attempts });
  const fallback = await resolveGoogleDriveMp4Download(safeId, { preferPlayback: false });
  return {
    fileId: safeId,
    playbackUrl: fallback.url,
    contentType: fallback.contentType || 'video/mp4',
    mimeType: fallback.contentType || 'video/mp4',
    expiresInSeconds: 0,
    expiresAt: null,
    qualityLabel: null,
    width: null,
    height: null,
    bitrate: null,
    durationMs: null,
    contentLength: fallback.contentLength || 0,
    strategy: `fallback:${fallback.strategy}`,
    formats: [],
    resolvedAt: new Date().toISOString(),
  };
}

export async function getGoogleDriveVideoUpstream(fileId, range = '') {
  const safeId = sanitizeGoogleDriveFileId(fileId);
  let probe = await resolveGoogleDriveMp4Download(safeId);
  const headers = { 'User-Agent': DRIVE_USER_AGENT };
  if (range) headers.Range = range;
  let upstream = await fetch(probe.url, {
    method: 'GET',
    redirect: 'follow',
    headers,
  });
  if (!upstream.ok && probe.playback) {
    probe = await resolveGoogleDriveMp4Download(safeId, { preferPlayback: false });
    upstream = await fetch(probe.url, {
      method: 'GET',
      redirect: 'follow',
      headers,
    });
  }
  const contentType = upstream.headers.get('content-type') || probe.contentType || '';
  const contentDisposition = upstream.headers.get('content-disposition') || probe.contentDisposition || '';
  if (!upstream.ok || (!/^video\/mp4/i.test(contentType) && !/\.mp4$/i.test(decodeHeaderFilename(contentDisposition)) && !looksLikeMp4(probe))) {
    throw new ApiError(502, 'Google Drive ne renvoie pas une video MP4 lisible pour ce fichier.');
  }
  return { upstream, contentType: 'video/mp4' };
}

function money(amountCents) {
  return { amountCents, currency: 'EUR' };
}

function lineConsentRequirements(product) {
  const keys = [];
  if (product.kind === 'DISTANCE_TRAINING' && product.distanceDeliveryMode === 'IMMEDIATE') {
    keys.push('DIGITAL_IMMEDIATE_START', 'DIGITAL_WITHDRAWAL_WAIVER');
  }
  if (product.kind === 'SERVICE' || product.kind === 'IN_PERSON_TRAINING') {
    keys.push('DATED_SERVICE_EXECUTION_REQUEST');
  }
  return keys.map((key) => ({
    key,
    label: key === 'DIGITAL_IMMEDIATE_START'
      ? "Je demande l'acces immediat au contenu numerique."
      : key === 'DIGITAL_WITHDRAWAL_WAIVER'
        ? "Je reconnais perdre mon droit de retractation apres acces immediat."
        : "Je demande l'execution de la prestation/date reservee selon les conditions affichees.",
    required: true,
  }));
}

function giftCardLinePayload(product, line) {
  if (product.kind !== 'GIFT_CARD') return null;
  const giftCard = line.giftCard || {};
  const minimumCents = Math.max(0, Number(product.price?.amountCents || 0));
  const requestedCents = Math.max(0, Number(giftCard.amountCents || minimumCents || 0));
  const amountCents = Math.max(minimumCents, requestedCents);
  return {
    senderName: String(giftCard.senderName || '').trim(),
    recipientName: String(giftCard.recipientName || '').trim(),
    recipientEmail: String(giftCard.recipientEmail || '').trim(),
    message: String(giftCard.message || '').trim(),
    amountCents,
  };
}

function lineTotals(product, line) {
  const optionKeys = new Set(line.optionKeys || []);
  const optionsTotalCents = (product.options || [])
    .filter((option) => option.active && optionKeys.has(option.key))
    .reduce((sum, option) => sum + (option.priceCents || 0), 0);
  const giftCard = giftCardLinePayload(product, line);
  const unitPriceCents = (giftCard?.amountCents ?? effectivePriceCents(product)) + optionsTotalCents;
  const fullTotalCents = unitPriceCents * line.quantity;
  // Acompte ou prestation gratuite : seule la part « maintenant » est encaissée en ligne.
  const split = paymentSplit(product, fullTotalCents);
  return { optionKeys: [...optionKeys], optionsTotalCents, unitPriceCents, totalCents: split.payNowCents, fullTotalCents, balanceDueCents: split.balanceDueCents, paymentRule: split.rule };
}

const KIND_LABEL_FR = {
  SERVICE: 'Prestation',
  IN_PERSON_TRAINING: 'Formation en présentiel',
  DISTANCE_TRAINING: 'Formation en ligne',
  GIFT_CARD: 'Carte cadeau',
  PRODUCT: 'Produit',
};

function lineWhen(line) {
  const fmt = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(d));
  if (line.bookingSnapshot?.startsAt) return `le ${fmt(line.bookingSnapshot.startsAt)}`;
  const session = line.sessionId ? (line.productSnapshot?.sessions || []).find((s) => String(s.id) === String(line.sessionId)) : null;
  return session ? `session du ${fmt(session.startsAt)}` : '';
}

/**
 * LES LIGNES DE LA PAGE STRIPE (et de la facture Stripe) — une par article,
 * une par option payante. La somme vaut le total de la commande ; la part
 * carte cadeau est déduite par une remise, jamais en retouchant un prix.
 */
export function stripeLineItems(sale) {
  const items = [];
  for (const line of sale.lines || []) {
    const kind = KIND_LABEL_FR[line.productSnapshot?.kind] || 'Article';
    const options = line.optionsSnapshot || [];
    const freeOptions = options.filter((o) => !(o.priceCents > 0)).map((o) => o.label);
    const description = [kind, lineWhen(line), freeOptions.length ? `inclus : ${freeOptions.join(', ')}` : '']
      .filter(Boolean).join(' · ').slice(0, 500);
    if ((line.balanceDueCents || 0) > 0) {
      // Acompte : une seule ligne, le solde sur place est écrit dans la description.
      const optionText = options.length ? ` · options : ${options.map((o) => o.label).join(', ')}` : '';
      items.push({
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Number(line.totalCents || 0),
          product_data: {
            name: `Acompte — ${line.productSnapshot?.title || 'Prestation'}`.slice(0, 250),
            description: [kind, lineWhen(line), `solde de ${(line.balanceDueCents / 100).toFixed(2).replace('.', ',')} € à régler sur place`].filter(Boolean).join(' · ').concat(optionText).slice(0, 500),
          },
        },
      });
      continue;
    }
    const base = Math.max(0, Number(line.unitPriceCents || 0) - Number(line.optionsTotalCents || 0));
    items.push({
      quantity: line.quantity || 1,
      price_data: {
        currency: 'eur',
        unit_amount: base,
        product_data: {
          name: String(line.productSnapshot?.kind === 'GIFT_CARD' ? `Carte cadeau${line.giftCardSnapshot?.recipientName ? ` pour ${line.giftCardSnapshot.recipientName}` : ''}` : (line.productSnapshot?.title || 'Article')).slice(0, 250),
          ...(description ? { description } : {}),
        },
      },
    });
    for (const option of options.filter((o) => o.priceCents > 0)) {
      items.push({
        quantity: line.quantity || 1,
        price_data: {
          currency: 'eur',
          unit_amount: option.priceCents,
          product_data: { name: `Option : ${option.label}`.slice(0, 250), description: `Pour ${line.productSnapshot?.title || 'l’article'}`.slice(0, 500) },
        },
      });
    }
  }
  // Une ligne à 0 € n'apporte rien au total et certains moyens de paiement la refusent.
  const payable = items.filter((i) => i.price_data.unit_amount > 0);
  items.length = 0;
  items.push(...payable);
  // Filet : un écart d'arrondi éventuel ne doit jamais faire facturer un autre montant que la commande.
  const sum = items.reduce((s, i) => s + i.price_data.unit_amount * i.quantity, 0);
  if (sum !== sale.totalCents) {
    return [{ quantity: 1, price_data: { currency: 'eur', unit_amount: sale.totalCents, product_data: { name: `Commande ${sale.saleNumber}` } } }];
  }
  return items;
}


async function hydrateCart(cart) {
  const hydrated = await hydrateLines(cart.lines);
  return { id: String(cart._id), ...hydrated };
}

/**
 * Le calcul d'une commande à partir de lignes brutes — celles du panier, ou
 * l'unique ligne d'un achat rapide. Un seul calcul pour les deux chemins : un
 * prix, une option ou un consentement ne peut pas différer selon la porte.
 */
async function hydrateLines(rawLines = []) {
  const productIds = rawLines.map((line) => line.productId);
  const products = await CommerceProduct.find({ _id: { $in: productIds } });
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const lines = rawLines.map((line) => {
    const product = byId.get(String(line.productId));
    if (!product) return null;
    const totals = lineTotals(product, line);
    return {
      id: String(line._id),
      product: publicProduct(product),
      quantity: line.quantity,
      sessionId: line.sessionId ? String(line.sessionId) : null,
      bookingSnapshot: line.bookingSnapshot || null,
      optionKeys: totals.optionKeys,
      unitPriceCents: totals.unitPriceCents,
      optionsTotalCents: totals.optionsTotalCents,
      totalCents: totals.totalCents,
      fullTotalCents: totals.fullTotalCents,
      balanceDueCents: totals.balanceDueCents,
      paymentRule: totals.paymentRule,
      giftCard: giftCardLinePayload(product, line),
      consentRequirements: lineConsentRequirements(product),
    };
  }).filter(Boolean);
  return {
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
    balanceDueCents: lines.reduce((sum, line) => sum + (line.balanceDueCents || 0), 0),
    currency: 'EUR',
  };
}

export async function listCatalog() {
  const products = await CommerceProduct.find({ status: PRODUCT_STATUS.PUBLISHED })
    .sort({ boostRank: 1, title: 1 })
    .lean();
  return products.map(publicProduct);
}

export async function getProductBySlug(slug) {
  const product = await CommerceProduct.findOne({ slug, status: PRODUCT_STATUS.PUBLISHED }).lean();
  if (!product) throw ApiError.notFound('Produit introuvable');
  return publicProduct(product);
}

export async function registerCustomer(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw ApiError.badRequest('Adresse e-mail invalide');
  if (password.length < 8) throw ApiError.badRequest('Mot de passe trop court');
  const exists = await Customer.findOne({ email }).lean();
  if (exists) {
    // Compte ouvert par l'institut lors d'une réservation : on le dit, et la
    // vitrine propose d'envoyer le lien d'accès plutôt qu'un cul-de-sac.
    const managed = isPendingInstituteAccount(exists);
    throw ApiError.conflict(
      managed
        ? 'Un espace client a déjà été créé pour vous lors d’une réservation à l’institut. Recevez votre lien d’accès par e-mail pour l’activer.'
        : 'Un compte client existe déjà pour cette adresse. Connectez-vous, ou recevez un lien pour choisir un nouveau mot de passe.',
      { code: 'CUSTOMER_EXISTS', createdByInstitute: managed },
    );
  }
  const code = verificationCode();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const customer = await Customer.create({
    email,
    password,
    firstName: payload.firstName || '',
    lastName: payload.lastName || '',
    phone: payload.phone || '',
    marketingConsent: Boolean(payload.marketingConsent),
    emailVerified: false,
    emailVerification: {
      tokenHash: hashCustomerSecret(code),
      expiresAt,
      requestedAt: new Date(),
      verifiedAt: null,
    },
  });
  await emitAndDispatch({
    type: 'customer.registered',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      customerId: String(customer._id),
      customerEmailMasked: maskEmail(customer.email),
      registeredAt: customer.createdAt?.toISOString?.() || new Date().toISOString(),
    },
    idempotencyKey: `customer-registered:${customer._id}`,
  });
  await emitCustomerVerificationRequested(customer, code, expiresAt);
  return {
    // Relu sans les champs `select: false` : le document créé porte encore le
    // mot de passe haché et l'empreinte du code (6 chiffres : réversible).
    customer: await Customer.findById(customer._id).lean(),
    token: signCustomerToken(customer),
    ...(process.env.ENV === 'TEST' ? { verificationCode: code } : {}),
  };
}

export async function loginCustomer(email, password) {
  const customer = await Customer.findOne({ email: String(email || '').trim().toLowerCase() }).select('+password');
  if (!customer || !(await customer.comparePassword(String(password || '')))) {
    throw ApiError.unauthorized('Identifiants client invalides');
  }
  // Relu sans `+password` : l'empreinte du mot de passe ne quitte jamais le serveur.
  return { customer: await Customer.findById(customer._id).lean(), token: signCustomerToken(customer) };
}

export async function requestCustomerEmailVerification(customerId) {
  const customer = await Customer.findById(customerId).select('+emailVerification.tokenHash');
  if (!customer) throw ApiError.notFound('Compte client introuvable');
  if (customer.emailVerified) return { message: 'Adresse e-mail déjà vérifiée.' };
  const code = verificationCode();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  customer.emailVerification = {
    tokenHash: hashCustomerSecret(code),
    expiresAt,
    requestedAt: new Date(),
    verifiedAt: null,
  };
  await customer.save();
  await emitCustomerVerificationRequested(customer, code, expiresAt);
  return { message: 'Code de vérification envoyé.', ...(process.env.ENV === 'TEST' ? { verificationCode: code } : {}) };
}

export async function verifyCustomerEmail(code) {
  const tokenHash = hashCustomerSecret(code);
  const customer = await Customer.findOne({
    'emailVerification.tokenHash': tokenHash,
    'emailVerification.expiresAt': { $gt: new Date() },
  }).select('+emailVerification.tokenHash');
  if (!customer) throw ApiError.badRequest('Code de vérification invalide ou expiré');
  customer.emailVerified = true;
  customer.emailVerification.verifiedAt = new Date();
  customer.emailVerification.tokenHash = '';
  await customer.save();
  await emitAndDispatch({
    type: 'customer.email_verified',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      customerId: String(customer._id),
      verifiedAt: customer.emailVerification.verifiedAt.toISOString(),
    },
    idempotencyKey: `customer-email-verified:${customer._id}:${customer.emailVerification.verifiedAt.getTime()}`,
  });
  return { customer, token: signCustomerToken(customer), message: 'Adresse e-mail vérifiée.' };
}


function verificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCustomerSecret(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

async function emitCustomerVerificationRequested(customer, code, expiresAt) {
  await emitAndDispatch({
    type: 'customer.email_verification.requested',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      customerId: String(customer._id),
      customerEmailMasked: maskEmail(customer.email),
      verificationPin: code,
      expiresAt: expiresAt.toISOString(),
      requestedAt: new Date().toISOString(),
    },
    idempotencyKey: `customer-email-verification:${customer._id}:${hashCustomerSecret(code).slice(0, 12)}`,
  });
}

export async function requestCustomerPasswordReset(email, { siteUrl = '' } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  const customer = await Customer.findOne({ email: normalized }).select('+passwordReset.tokenHash');
  const response = { message: 'Si ce compte existe, un lien de réinitialisation va être envoyé.' };
  if (!customer) return response;
  // Compte ouvert par l'institut, jamais activé : le bon message est « votre
  // espace est prêt », pas « réinitialisez votre mot de passe ».
  if (isPendingInstituteAccount(customer)) {
    // Réponse identique quoi qu'il arrive : elle ne doit pas révéler qu'un compte existe.
    await sendCustomerAccessLink(customer, { origin: 'SELF_REQUEST', siteUrl }).catch(() => null);
    return response;
  }
  const token = crypto.randomBytes(32).toString('hex');
  customer.passwordReset = {
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    requestedAt: new Date(),
    usedAt: null,
  };
  await customer.save();
  const resetUrl = `${siteUrl || await configuredSiteUrl()}/espace-client/mot-de-passe?token=${token}`;
  await emitAndDispatch({
    type: 'customer.password_reset.requested',
    entityType: 'Customer',
    entityId: customer._id,
    payloadSafe: {
      customerId: String(customer._id),
      customerEmailMasked: maskEmail(customer.email),
      actionUrl: resetUrl,
      expiresAt: customer.passwordReset.expiresAt.toISOString(),
      requestedAt: customer.passwordReset.requestedAt.toISOString(),
    },
    idempotencyKey: `customer-password-reset:${customer._id}:${customer.passwordReset.requestedAt.getTime()}`,
  });
  if (process.env.ENV === 'TEST') response.resetUrl = resetUrl;
  return response;
}

export async function resetCustomerPassword(payload = {}) {
  const tokenHash = crypto.createHash('sha256').update(String(payload.token || '')).digest('hex');
  const customer = await Customer.findOne({
    'passwordReset.tokenHash': tokenHash,
    'passwordReset.expiresAt': { $gt: new Date() },
    'passwordReset.usedAt': null,
  }).select('+password +passwordReset.tokenHash');
  if (!customer) throw ApiError.badRequest('Lien de réinitialisation invalide ou expiré');
  const password = String(payload.password || '');
  if (password.length < 8) throw ApiError.badRequest('Mot de passe trop court');
  customer.password = password;
  customer.passwordReset.usedAt = new Date();
  customer.passwordReset.tokenHash = '';
  // Le lien est arrivé dans SA boîte : l'adresse est prouvée, aucun code OTP
  // n'est redemandé (compte ouvert par l'institut comme mot de passe oublié).
  if (!customer.emailVerified) {
    customer.emailVerified = true;
    customer.emailVerification = { ...(customer.emailVerification?.toObject?.() || {}), verifiedAt: new Date() };
  }
  await customer.save();
  return {
    message: 'Mot de passe enregistré. Bienvenue dans votre espace client.',
    token: signCustomerToken(customer),
    customer: await Customer.findById(customer._id).lean(),
  };
}

export async function getCustomerCart(customerId) {
  const cart = await Cart.findOneAndUpdate(
    { customerId },
    { $setOnInsert: { customerId, lines: [] } },
    { new: true, upsert: true }
  );
  return hydrateCart(cart);
}

export async function addCartItem(customerId, payload) {
  // Au panier, une prestation peut arriver SANS créneau : il se choisit depuis
  // le panier, et le paiement attend qu'il le soit (voir checkoutHydratedLines).
  const line = await buildOrderLine(payload, { allowUnscheduled: true });
  const cart = await Cart.findOneAndUpdate(
    { customerId },
    { $push: { lines: line } },
    { new: true, upsert: true }
  );
  return hydrateCart(cart);
}

/**
 * UNE LIGNE DE COMMANDE VALIDÉE — produit publié, session ouverte, créneau
 * libre, carte cadeau renseignée. Le panier et l'achat rapide passent tous deux
 * par ici : la règle d'admissibilité n'existe qu'à un endroit.
 */
async function buildOrderLine(payload = {}, { allowUnscheduled = false } = {}) {
  const product = await CommerceProduct.findOne({ _id: payload.productId, status: PRODUCT_STATUS.PUBLISHED });
  if (!product) throw ApiError.notFound('Article indisponible');
  let bookingSnapshot = null;
  if (product.kind === 'IN_PERSON_TRAINING' && !payload.sessionId) {
    throw ApiError.badRequest('Une session est requise pour cette formation présentielle');
  }
  if (product.kind === 'IN_PERSON_TRAINING' && payload.sessionId) {
    const session = product.sessions.id(payload.sessionId);
    if (!session || session.status !== 'ACTIVE') throw ApiError.badRequest('Session indisponible');
    if ((session.reservedCount || 0) >= (session.capacity || 0)) throw ApiError.conflict('Cette session est complète');
  }
  const hasSlot = Boolean(payload.serviceBooking?.startsAt || payload.bookingSnapshot?.startsAt);
  if (product.kind === 'SERVICE' && (hasSlot || !allowUnscheduled)) {
    bookingSnapshot = await serviceBookingSnapshot(product, payload);
  }
  const giftCard = product.kind === 'GIFT_CARD'
    ? giftCardLinePayload(product, { giftCard: payload.giftCard || payload })
    : null;
  if (product.kind === 'GIFT_CARD') {
    if (!giftCard.recipientName) throw ApiError.badRequest('Bénéficiaire requis pour la carte cadeau');
    if (!giftCard.senderName) throw ApiError.badRequest("Nom de l'expéditeur requis pour la carte cadeau");
  }
  return {
    productId: product._id,
    quantity: Math.max(1, Number(payload.quantity || 1)),
    sessionId: payload.sessionId || null,
    bookingSnapshot,
    optionKeys: Array.isArray(payload.optionKeys) ? payload.optionKeys : [],
    giftCard,
  };
}

/** Le créneau réservé d'une prestation : l'heure choisie + la durée de la fiche, contrôlé contre le planning. */
async function serviceBookingSnapshot(product, payload = {}) {
  const startsAt = new Date(payload.serviceBooking?.startsAt || payload.bookingSnapshot?.startsAt || '');
  const durationMinutes = Math.max(5, Number(product.durationMinutes || payload.serviceBooking?.durationMinutes || 60));
  /*
    LE CRÉNEAU RÉSERVÉ = L'HEURE CHOISIE + LA DURÉE DE LA PRESTATION.
    La fin n'est plus reprise du navigateur : c'est la fiche prestation qui
    dit combien de temps bloquer au planning. Seule une prestation sans
    durée renseignée garde la fin proposée par le créneau choisi.
  */
  const endsAt = product.durationMinutes
    ? new Date(startsAt.getTime() + durationMinutes * 60_000)
    : new Date(payload.serviceBooking?.endsAt || startsAt.getTime() + durationMinutes * 60_000);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw ApiError.badRequest('Choisissez un créneau disponible pour cette prestation');
  }
  await assertNoOverlap({ startsAt, endsAt });
  return {
    startsAt,
    endsAt,
    durationMinutes,
    timezone: 'Europe/Paris',
  };
}

/**
 * CHOISIR (OU CHANGER) LE CRÉNEAU d'une prestation déjà au panier.
 */
export async function setCartItemBooking(customerId, lineId, payload = {}) {
  const cart = await Cart.findOne({ customerId });
  const line = cart?.lines?.id(lineId);
  if (!line) throw ApiError.notFound('Article introuvable dans le panier');
  const product = await CommerceProduct.findOne({ _id: line.productId, status: PRODUCT_STATUS.PUBLISHED });
  if (!product) throw ApiError.notFound('Article indisponible');
  if (product.kind !== 'SERVICE') throw ApiError.badRequest('Seule une prestation se planifie depuis le panier');
  line.bookingSnapshot = await serviceBookingSnapshot(product, payload);
  cart.markModified('lines');
  await cart.save();
  return hydrateCart(cart);
}

/** Identifiant de la ligne unique d'un achat rapide — il préfixe ses consentements. */
export const QUICK_BUY_LINE_ID = 'achat-rapide';

/**
 * ACHAT RAPIDE — une prestation, une formation ou une carte cadeau payée
 * directement depuis sa fiche, sans transiter par le panier.
 *
 * Le panier n'est ni lu ni vidé : ce que la cliente y avait mis reste là. La
 * ligne est validée exactement comme un ajout au panier, puis la commande suit
 * le même chemin de paiement que le panier.
 */
export async function createQuickCheckout(customerId, payload = {}) {
  const line = await buildOrderLine(payload.item || payload);
  const hydrated = await hydrateLines([{ _id: QUICK_BUY_LINE_ID, ...line }]);
  if (hydrated.lines.length === 0) throw ApiError.notFound('Article indisponible');
  return checkoutHydratedLines(customerId, hydrated, payload, { checkoutSource: 'QUICK_BUY' });
}

export async function removeCartItem(customerId, lineId) {
  const cart = await Cart.findOneAndUpdate(
    { customerId },
    { $pull: { lines: { _id: lineId } } },
    { new: true, upsert: true }
  );
  return hydrateCart(cart);
}

export async function createCheckout(customerId, payload = {}) {
  const cart = await Cart.findOne({ customerId });
  if (!cart || cart.lines.length === 0) throw ApiError.badRequest('Panier vide');
  const hydrated = await hydrateCart(cart);
  return checkoutHydratedLines(customerId, hydrated, payload, { checkoutSource: 'CART' });
}

async function checkoutHydratedLines(customerId, hydrated, payload = {}, { checkoutSource = 'CART' } = {}) {
  const unscheduled = hydrated.lines.filter((line) => line.product?.kind === 'SERVICE' && !line.bookingSnapshot?.startsAt);
  if (unscheduled.length > 0) {
    throw ApiError.badRequest(
      unscheduled.length > 1 ? 'Choisissez un créneau pour chaque prestation de votre panier.' : `Choisissez un créneau pour « ${unscheduled[0].product.title} ».`,
      { code: 'SLOT_REQUIRED', lineIds: unscheduled.map((line) => line.id) },
    );
  }
  const accepted = new Set(Array.isArray(payload.consents) ? payload.consents : []);
  const missingConsents = hydrated.lines.flatMap((line) => (
    (line.consentRequirements || [])
      .filter((requirement) => requirement.required && !accepted.has(`${line.id}:${requirement.key}`))
      .map((requirement) => ({ lineId: line.id, key: requirement.key, label: requirement.label }))
  ));
  if (missingConsents.length > 0) {
    throw ApiError.badRequest('Consentements requis manquants', { code: 'CONSENTS_REQUIRED', missingConsents });
  }
  const customer = await Customer.findById(customerId).lean();
  if (!customer) throw ApiError.notFound('Compte client introuvable');
  if (!customer.emailVerified) {
    throw ApiError.forbidden('Vérification e-mail obligatoire avant achat', { code: 'CUSTOMER_EMAIL_NOT_VERIFIED' });
  }
  // Les clés de l'environnement courant (ENV=PROD → clés live) décident seules.
  const stripeReady = await instituteStripeReady();
  const instituteMode = activeInstituteMode();
  if ((payload.giftCardCodes || payload.giftCards || []).length) await releaseAbandonedCheckouts(customerId);
  let giftCardAllocations = await reserveGiftCardAllocations(payload.giftCardCodes || payload.giftCards || [], hydrated.totalCents);
  let giftCardAmountCents = giftCardAllocations.reduce((sum, item) => sum + item.amountCents, 0);
  let stripeAmountCents = Math.max(0, hydrated.totalCents - giftCardAmountCents);
  if (!stripeReady && stripeAmountCents > 0 && giftCardAllocations.length > 0) {
    await releaseGiftCardReservations(giftCardAllocations);
    throw ApiError.conflict(
      'Le paiement par carte bancaire est momentanément indisponible : votre carte cadeau ne couvre pas toute la commande. Rien n’a été débité.',
      { code: 'CARD_PAYMENT_UNAVAILABLE' },
    );
  }

  const saleNumber = `BS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const idempotencyKey = payload.idempotencyKey || crypto.randomUUID();
  const lines = hydrated.lines.map((line) => ({
    productId: line.product.id,
    productSnapshot: line.product,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    optionsTotalCents: line.optionsTotalCents,
    optionsSnapshot: (line.product.options || [])
      .filter((option) => (line.optionKeys || []).includes(option.key))
      .map((option) => ({ key: option.key, label: option.label, priceCents: Number(option.priceCents || 0) })),
    totalCents: line.totalCents,
    fullTotalCents: line.fullTotalCents ?? line.totalCents,
    balanceDueCents: line.balanceDueCents || 0,
    paymentRule: line.paymentRule || 'FULL',
    sessionId: line.sessionId,
    bookingSnapshot: line.bookingSnapshot || null,
    giftCardSnapshot: line.giftCard,
    consentSnapshot: {
      acceptedAt: new Date(),
      checkoutMode: stripeReady ? 'STRIPE_CHECKOUT_HOSTED' : 'CONFIGURATION_REQUIRED',
      lineKind: line.product.kind,
      requiredConsents: line.consentRequirements || [],
      acceptedConsentKeys: [...accepted]
        .filter((key) => key.startsWith(`${line.id}:`))
        .map((key) => key.slice(String(line.id).length + 1)),
    },
  }));
  const sale = await CommerceSale.findOneAndUpdate(
    { idempotencyKey },
    {
      $setOnInsert: {
        saleNumber,
        customerId,
        status: 'CHECKOUT_PENDING',
        paymentStatus: stripeReady ? 'CHECKOUT_CREATED' : 'REQUIRES_INSTITUTE_STRIPE',
        totalCents: hydrated.totalCents,
        stripeAmountCents,
        giftCardAmountCents,
        currency: 'EUR',
        lines,
        giftCardAllocations,
        checkoutSource,
        siteUrl: String(payload.siteUrl || '').replace(/\/+$/, '') || await configuredSiteUrl(),
        stripe: {
          checkoutSessionId: '',
          mode: instituteMode,
        },
      },
    },
    { new: true, upsert: true }
  );

  if (sale.paymentStatus === 'PAID') {
    return {
      saleId: String(sale._id),
      saleNumber: sale.saleNumber,
      total: money(sale.totalCents),
      paymentStatus: sale.paymentStatus,
      checkoutUrl: '/paiement/succes',
      message: 'Commande déjà payée.',
    };
  }

  if (stripeAmountCents === 0) {
    const paidSale = await finalizePaidSale(sale, { paymentIntentId: 'gift_card_only' });
    return {
      saleId: String(paidSale._id),
      saleNumber: paidSale.saleNumber,
      total: money(paidSale.totalCents),
      paymentStatus: paidSale.paymentStatus,
      checkoutUrl: `/paiement/succes?commande=${encodeURIComponent(paidSale.saleNumber)}`,
      message: 'Commande réglée par carte cadeau.',
    };
  }

  if (stripeReady && !sale.stripe.checkoutSessionId) {
    // Le site d'où vient la cliente (fourni par la route, origine vérifiée), sinon celui de cette instance.
    const site = String(payload.siteUrl || '').replace(/\/+$/, '') || await configuredSiteUrl();
    try {
      // La part carte cadeau devient une remise : la page Stripe et la facture détaillent les articles.
      const giftCents = Number(sale.giftCardAmountCents || 0);
      const coupon = giftCents > 0
        ? await createInstituteCoupon({
          amountOffCents: giftCents,
          name: `Carte cadeau ${(sale.giftCardAllocations || []).map((a) => a.codeMasked).join(', ')}`,
          idempotencyKey: `coupon:${sale.idempotencyKey}`,
        })
        : null;
      const checkout = await createInstituteCheckoutSession({
        sale,
        customer,
        lineItems: stripeLineItems(sale),
        discounts: coupon ? [{ coupon: coupon.id }] : null,
        successUrl: `${site}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
        expiresInMinutes: sale.giftCardAllocations?.length ? 30 : null,
        // Un achat rapide annulé ramène sur la fiche, pas sur un panier qu'il n'a jamais touché.
        cancelUrl: checkoutSource === 'QUICK_BUY' && payload.returnPath && /^\/[a-z0-9/_-]*$/i.test(String(payload.returnPath))
          ? `${site}${payload.returnPath}?paiement=annule`
          : `${site}/panier?paiement=annule`,
      });
      sale.stripe.checkoutSessionId = checkout.id || '';
      sale.stripe.checkoutUrl = checkout.url || '';
      sale.paymentStatus = 'CHECKOUT_CREATED';
      await sale.save();
    } catch (err) {
      await releaseGiftCardReservations(sale.giftCardAllocations || []);
      sale.giftCardAllocations = [];
      sale.giftCardAmountCents = 0;
      sale.stripeAmountCents = sale.totalCents;
      sale.paymentStatus = 'FAILED';
      await sale.save();
      throw err;
    }
  }

  return {
    saleId: String(sale._id),
    saleNumber: sale.saleNumber,
    total: money(sale.totalCents),
    paymentStatus: sale.paymentStatus,
    checkoutUrl: sale.stripe.checkoutUrl || null,
    message: stripeReady
      ? 'Session Stripe Checkout institut preparee.'
      : 'Configurez les cles Stripe Institut dans le manager avant un encaissement client reel.',
  };
}

async function reserveGiftCardAllocations(rawCodes, maxAmountCents) {
  const codes = Array.isArray(rawCodes)
    ? rawCodes.map((entry) => typeof entry === 'string' ? { code: entry } : entry).filter(Boolean)
    : [];
  const allocations = [];
  const seen = new Set();
  let remaining = Math.max(0, Number(maxAmountCents || 0));
  for (const entry of codes) {
    if (remaining <= 0) break;
    const code = normalizeGiftCode(entry.code);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const card = await GiftCard.findOne({ codeHash: hashGiftSecret(code) });
    const refusal = giftCardRefusal(card);
    if (refusal) {
      await releaseGiftCardReservations(allocations);
      throw ApiError.badRequest(refusal.message, { code: refusal.code });
    }
    const available = Math.max(0, (card.balanceCents || 0) - (card.reservedCents || 0));
    if (available <= 0) {
      await releaseGiftCardReservations(allocations);
      throw ApiError.conflict(GIFT_RESERVED_MESSAGE, { code: 'GIFT_CARD_RESERVED' });
    }
    const requested = Number(entry.amountCents || entry.amount || 0);
    const amountCents = Math.min(remaining, available, requested > 0 ? requested : available);
    card.reservedCents = (card.reservedCents || 0) + amountCents;
    await card.save();
    allocations.push({
      giftCardId: card._id,
      codeMasked: card.codeMasked,
      amountCents,
      appliedAt: null,
    });
    remaining -= amountCents;
  }
  return allocations;
}

async function applyGiftCardAllocations(sale, issues = null) {
  for (const allocation of sale.giftCardAllocations || []) {
    if (allocation.appliedAt) continue;
    const card = await GiftCard.findById(allocation.giftCardId);
    if (!card) {
      if (issues) { issues.push(`Carte cadeau ${allocation.codeMasked || ''} introuvable à la finalisation`); continue; }
      throw ApiError.notFound('Carte cadeau allouée introuvable');
    }
    // Déjà débitée pour cette vente (finalisation reprise) : on ne redébite pas.
    const ledgerKey = `sale:${sale._id}:gift:${card._id}`;
    if ((card.ledger || []).some((entry) => entry.idempotencyKey === ledgerKey)) {
      allocation.appliedAt = allocation.appliedAt || new Date();
      continue;
    }
    const amount = Number(allocation.amountCents || 0);
    const before = card.balanceCents;
    if (before < amount) {
      if (issues) { issues.push(`Solde insuffisant sur la carte cadeau ${card.codeMasked || ''} à la finalisation`); continue; }
      throw ApiError.conflict('Solde carte cadeau insuffisant à la finalisation');
    }
    card.balanceCents = before - amount;
    card.reservedCents = Math.max(0, (card.reservedCents || 0) - amount);
    card.status = card.balanceCents === 0 ? 'EMPTY' : 'ACTIVE';
    // Une carte avec laquelle on a payé se retrouve ensuite dans son portefeuille.
    if (sale.customerId && !(card.walletCustomerIds || []).some((id) => String(id) === String(sale.customerId))) {
      card.walletCustomerIds.push(sale.customerId);
    }
    card.ledger.push({
      type: 'DEBIT',
      amountCents: amount,
      balanceBeforeCents: before,
      balanceAfterCents: card.balanceCents,
      source: 'CHECKOUT',
      reason: `Commande ${sale.saleNumber}`,
      actorCustomerId: sale.customerId,
      idempotencyKey: `sale:${sale._id}:gift:${card._id}`,
    });
    await card.save();
    allocation.appliedAt = new Date();
  }
}

async function releaseGiftCardReservations(allocations = []) {
  for (const allocation of allocations) {
    if (allocation.appliedAt || !allocation.giftCardId) continue;
    const amount = Number(allocation.amountCents || 0);
    if (amount <= 0) continue;
    await GiftCard.updateOne(
      { _id: allocation.giftCardId },
      [{ $set: { reservedCents: { $max: [0, { $subtract: [{ $ifNull: ['$reservedCents', 0] }, amount] }] } } }]
    );
  }
}

async function incrementReservedSessions(sale, issues = null) {
  for (const line of sale.lines || []) {
    if (line.productSnapshot?.kind !== 'IN_PERSON_TRAINING' || !line.sessionId) continue;
    const product = await CommerceProduct.findById(line.productId);
    const session = product?.sessions.id(line.sessionId);
    if (!session || session.status !== 'ACTIVE') {
      if (issues) { issues.push(`Session de « ${line.productSnapshot?.title || 'formation'} » indisponible au moment du paiement`); if (!session) continue; }
      else throw ApiError.conflict('Session de formation indisponible');
    }
    if ((session.reservedCount || 0) + (line.quantity || 1) > (session.capacity || 0)) {
      if (issues) issues.push(`Session de « ${line.productSnapshot?.title || 'formation'} » complète : place payée en surnombre`);
      else throw ApiError.conflict('Session de formation complète');
    }
    session.reservedCount = (session.reservedCount || 0) + (line.quantity || 1);
    await product.save();
  }
}

async function createServiceBookingsFromSale(sale, customer, issues = null) {
  for (const line of sale.lines || []) {
    if (line.productSnapshot?.kind !== 'SERVICE' || !line.bookingSnapshot?.startsAt || !line.bookingSnapshot?.endsAt) continue;
    const startsAt = new Date(line.bookingSnapshot.startsAt);
    const endsAt = new Date(line.bookingSnapshot.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) continue;
    const source = { saleId: String(sale._id), lineId: String(line._id), kind: 'SERVICE_CHECKOUT' };
    const existing = await CalendarEvent.findOne({ 'source.saleId': source.saleId, 'source.lineId': source.lineId }).lean();
    if (existing) continue;
    // Le créneau a pu être pris entre la réservation et le paiement : l'argent
    // est encaissé, le rendez-vous est donc créé QUAND MÊME et signalé.
    let overlapNote = '';
    try {
      await assertNoOverlap({ startsAt, endsAt });
    } catch (err) {
      if (!issues) throw err;
      overlapNote = ' ⚠ Créneau déjà occupé au moment du paiement : à replacer.';
      issues.push(`Rendez-vous « ${line.productSnapshot?.title || 'prestation'} » en chevauchement : à replacer`);
    }
    const booked = await CalendarEvent.create({
      type: 'SERVICE_BOOKING',
      title: line.productSnapshot?.title || 'Rendez-vous institut',
      productId: line.productId,
      saleId: sale._id,
      lineId: String(line._id),
      customerSnapshot: {
        customerId: String(sale.customerId),
        name: [customer?.firstName, customer?.lastName].filter(Boolean).join(' ') || customer?.email || 'Cliente',
        email: customer?.email || '',
        phone: customer?.phone || '',
      },
      startsAt,
      endsAt,
      status: 'SCHEDULED',
      paymentSnapshot: {
        totalCents: line.fullTotalCents ?? line.totalCents ?? 0,
        paidCents: line.totalCents || 0,
        depositCents: line.balanceDueCents > 0 ? (line.totalCents || 0) : 0,
        balanceDueCents: line.balanceDueCents || 0,
        currency: sale.currency || 'EUR',
      },
      notes: `Reservation issue de ${sale.saleNumber}.${overlapNote}`,
      source,
    });
    await emitAppointmentBooked(booked, { saleNumber: sale.saleNumber, origin: 'CHECKOUT' });
  }
}

async function issueGiftCardsFromSale(sale) {
  for (const line of sale.lines || []) {
    if (line.productSnapshot?.kind !== 'GIFT_CARD') continue;
    const giftCard = line.giftCardSnapshot || {};
    for (let i = 0; i < (line.quantity || 1); i += 1) {
      const issued = await issueGiftCard({
        amountCents: giftCard.amountCents || line.unitPriceCents,
        senderName: giftCard.senderName,
        recipientName: giftCard.recipientName,
        message: giftCard.message,
        siteUrl: sale.siteUrl,
        reason: `Achat ${sale.saleNumber}`,
        saleId: sale._id,
        idempotencyKey: `sale:${sale._id}:line:${line._id}:gift:${i}`,
      }, { customerId: sale.customerId, source: 'CHECKOUT', revealCode: false });
      await emitAndDispatch({
        type: 'commerce.gift_card.issued',
        entityType: 'CommerceSale',
        entityId: sale._id,
        payloadSafe: {
          saleId: String(sale._id),
          saleNumber: sale.saleNumber,
          customerId: String(sale.customerId),
          giftCardCodeMasked: issued.codeMasked || '',
          recipientName: issued.recipientName || giftCard.recipientName || '',
          amount: Number(issued.amountCents || giftCard.amountCents || line.unitPriceCents || 0),
          ...(issued.pdfUrl ? { giftCardPdfUrl: issued.pdfUrl } : {}),
          issuedAt: (issued.issuedAt || new Date()).toISOString(),
        },
        idempotencyKey: `gift-card-issued:${sale._id}:${line._id}:${i}`,
      });
    }
  }
}

function commissionPeriod(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, start, end };
}

const commissionLabel = (periodKey) => `Commissions ${periodKey}`;

function commissionDueAt(period) {
  return new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), period.end.getUTCDate() + 7));
}

/**
 * LA COMMISSION D'UNE VENTE PAYÉE → photographiée sur la vente, puis ajoutée
 * à la commission du mois (une ligne par vente, avec son numéro). Un mois
 * déjà facturé ne bouge plus : une vente qui y arriverait en retard part
 * dans le mois en cours.
 */
/** Le total déjà prélevé (tous mois confondus, hors commissions annulées) — la jauge du plafond. */
async function commissionsChargedCents(excludeSaleId = null) {
  const docs = await CommerceCommission.find({ status: { $ne: 'CANCELLED' } }).select('amountCents sourceSnapshot.lines').lean();
  return docs.reduce((sum, d) => sum + Number(d.amountCents || 0), 0)
    - (excludeSaleId ? docs.flatMap((d) => d.sourceSnapshot?.lines || []).filter((l) => String(l.saleId) === String(excludeSaleId)).reduce((s, l) => s + Number(l.amountCents || 0), 0) : 0);
}

async function recalculateMonthlyCommissionForSale(sale) {
  const rule = await activeCommissionRule();
  const snapshot = applyCommissionCap(computeSaleCommission(sale, rule), rule, rule.capCents ? await commissionsChargedCents(sale._id) : 0);
  await CommerceSale.updateOne({ _id: sale._id }, { $set: { commission: snapshot } });
  if (!snapshot.subject || snapshot.amountCents <= 0) return null;
  let period = commissionPeriod(sale.finalizedAt || sale.updatedAt || new Date());
  const existing = await CommerceCommission.findOne({ periodKey: period.key, label: commissionLabel(period.key) }).lean();
  if (existing && existing.status !== 'DUE') period = commissionPeriod(new Date());
  const label = commissionLabel(period.key);
  if (await CommerceCommission.exists({ periodKey: period.key, label, saleIds: sale._id })) {
    return CommerceCommission.findOne({ periodKey: period.key, label });
  }
  return CommerceCommission.findOneAndUpdate(
    { periodKey: period.key, label, status: 'DUE' },
    {
      $setOnInsert: { periodStart: period.start, periodEnd: period.end, dueAt: commissionDueAt(period), currency: 'EUR' },
      $set: { ratePercent: snapshot.ratePercent, basis: snapshot.basis, rateBps: Math.round(snapshot.ratePercent * 100) },
      $inc: { amountCents: snapshot.amountCents, basisCents: snapshot.basisCents },
      $addToSet: { saleIds: sale._id },
      $push: {
        'sourceSnapshot.lines': {
          saleId: String(sale._id),
          saleNumber: sale.saleNumber,
          basisCents: snapshot.basisCents,
          amountCents: snapshot.amountCents,
          ratePercent: snapshot.ratePercent,
          basis: snapshot.basis,
          ...(snapshot.capped ? { capped: true } : {}),
        },
      },
    },
    { new: true, upsert: true }
  );
}

/** Une vente remboursée quitte la commission de son mois, tant que celui-ci n'est pas facturé. */
async function removeSaleFromCommission(sale) {
  const doc = await CommerceCommission.findOne({ saleIds: sale._id, status: 'DUE' });
  if (!doc) return null;
  const lines = doc.sourceSnapshot?.lines || [];
  const line = lines.find((l) => String(l.saleId) === String(sale._id) || l.saleNumber === sale.saleNumber);
  doc.saleIds = doc.saleIds.filter((id) => String(id) !== String(sale._id));
  doc.amountCents = Math.max(0, doc.amountCents - Number(line?.amountCents || 0));
  doc.basisCents = Math.max(0, doc.basisCents - Number(line?.basisCents || 0));
  doc.sourceSnapshot = { ...(doc.sourceSnapshot || {}), lines: lines.filter((l) => l !== line) };
  doc.markModified('sourceSnapshot');
  if (!doc.saleIds.length) { await doc.deleteOne(); return null; }
  await doc.save();
  return doc;
}

/**
 * RECALCUL COMPLET — reconstruit les mois NON facturés à partir des ventes
 * payées. Chaque vente garde la règle photographiée à son paiement ; une
 * vente sans photo reçoit la règle en vigueur. Les mois en paiement ou payés
 * ne sont jamais réécrits.
 */
export async function recalculateMonthlyCommissions() {
  const rule = await activeCommissionRule();
  const locked = new Set((await CommerceCommission.find({ status: { $ne: 'DUE' } }).select('periodKey').lean()).map((d) => d.periodKey));
  const paidSales = await CommerceSale.find({ paymentStatus: 'PAID' }).sort({ finalizedAt: 1, createdAt: 1 }).lean();
  const groups = new Map();
  // Le plafond se remplit d'abord avec ce qui est déjà facturé (mois payés ou en paiement).
  let charged = rule.capCents
    ? (await CommerceCommission.find({ status: { $nin: ['DUE', 'CANCELLED'] } }).select('amountCents').lean()).reduce((s, d) => s + Number(d.amountCents || 0), 0)
    : 0;
  for (const sale of paidSales) {
    const period = commissionPeriod(sale.finalizedAt || sale.updatedAt || sale.createdAt || new Date());
    if (locked.has(period.key)) continue;
    const before = sale.commission || computeSaleCommission(sale, rule);
    const snapshot = applyCommissionCap(before, rule, charged);
    if (!sale.commission || snapshot.amountCents !== sale.commission.amountCents || snapshot.capReached !== sale.commission.capReached) {
      await CommerceSale.updateOne({ _id: sale._id }, { $set: { commission: snapshot } });
    }
    charged += snapshot.amountCents;
    if (!snapshot.subject || snapshot.amountCents <= 0) continue;
    const group = groups.get(period.key) || { period, basisCents: 0, amountCents: 0, saleIds: [], lines: [], ratePercent: snapshot.ratePercent, basis: snapshot.basis };
    group.basisCents += snapshot.basisCents;
    group.amountCents += snapshot.amountCents;
    group.saleIds.push(sale._id);
    group.lines.push({ saleId: String(sale._id), saleNumber: sale.saleNumber, basisCents: snapshot.basisCents, amountCents: snapshot.amountCents, ratePercent: snapshot.ratePercent, basis: snapshot.basis, ...(snapshot.capped ? { capped: true } : {}) });
    groups.set(period.key, group);
  }
  // Les anciennes fiches « Commission formations en ligne … » encore dues sont remplacées.
  await CommerceCommission.deleteMany({ status: 'DUE', label: { $regex: '^Commission formations en ligne ' } });
  await CommerceCommission.deleteMany({ status: 'DUE', periodKey: { $nin: [...groups.keys()] } });
  const docs = [];
  for (const group of groups.values()) {
    docs.push(await CommerceCommission.findOneAndUpdate(
      { periodKey: group.period.key, label: commissionLabel(group.period.key) },
      {
        $set: {
          periodStart: group.period.start,
          periodEnd: group.period.end,
          dueAt: commissionDueAt(group.period),
          amountCents: group.amountCents,
          basisCents: group.basisCents,
          ratePercent: group.ratePercent,
          basis: group.basis,
          rateBps: Math.round(group.ratePercent * 100),
          currency: 'EUR',
          sourceSnapshot: { lines: group.lines },
          saleIds: group.saleIds,
        },
        $setOnInsert: { status: 'DUE' },
      },
      { new: true, upsert: true }
    ));
  }
  return docs;
}

const FINALIZE_LOCK_MS = 5 * 60_000;

/**
 * FINALISER UNE VENTE PAYÉE — sûr, quelle que soit la façon d'y arriver.
 *
 * Trois chemins y mènent, et ils peuvent arriver EN MÊME TEMPS : le webhook
 * Stripe, la page de succès qui vérifie le paiement, le rattrapage
 * automatique. D'où :
 *
 *   1. un VERROU atomique — une seule finalisation à la fois ; les autres
 *      répondent « en cours » (le webhook sera rejoué par Stripe) ;
 *   2. « PAYÉE » enregistré D'ABORD : dès que Stripe a encaissé, la vente
 *      l'est chez nous, avant tout le reste ;
 *   3. des ÉTAPES MARQUÉES : une finalisation interrompue (redémarrage,
 *      erreur) reprend où elle s'était arrêtée, sans redébiter une carte
 *      cadeau ni compter deux fois une place ;
 *   4. RIEN DE BLOQUANT après encaissement : un créneau pris entre-temps ou
 *      une session complète deviennent des incidents signalés à l'institut,
 *      pas une erreur qui laisserait l'argent encaissé sans vente.
 *
 * `finalizedAt` n'est posé qu'à la fin : tant qu'il manque, une nouvelle
 * finalisation termine les étapes restantes.
 */
export async function finalizePaidSale(saleOrId, stripePayload = {}) {
  const id = typeof saleOrId === 'string' ? saleOrId : saleOrId?._id;
  const current = await CommerceSale.findById(id);
  if (!current) throw ApiError.notFound('Vente introuvable');
  if (current.paymentStatus === 'PAID' && current.finalizedAt) return current;

  const sale = await CommerceSale.findOneAndUpdate(
    {
      _id: id,
      finalizedAt: null,
      $or: [{ 'finalizing.at': null }, { 'finalizing.at': { $lt: new Date(Date.now() - FINALIZE_LOCK_MS) } }],
    },
    { $set: { 'finalizing.at': new Date() } },
    { new: true },
  );
  if (!sale) {
    const fresh = await CommerceSale.findById(id);
    if (fresh?.finalizedAt) return fresh;
    throw ApiError.conflict('Finalisation déjà en cours pour cette vente', { code: 'SALE_FINALIZING' });
  }

  try {
    const issues = [];
    // 1. Payée, tout de suite.
    sale.status = 'PAID';
    sale.paymentStatus = 'PAID';
    sale.stripe.paymentIntentId = stripePayload.paymentIntentId || stripePayload.payment_intent || sale.stripe.paymentIntentId || '';
    await sale.save();

    const customer = await Customer.findById(sale.customerId).lean();
    if (!sale.finalizeSteps?.giftCards) {
      await applyGiftCardAllocations(sale, issues);
      sale.finalizeSteps.giftCards = true;
      sale.markModified('giftCardAllocations');
      await sale.save();
    }
    if (!sale.finalizeSteps?.sessions) {
      await incrementReservedSessions(sale, issues);
      sale.finalizeSteps.sessions = true;
      await sale.save();
    }
    if (!sale.finalizeSteps?.bookings) {
      await createServiceBookingsFromSale(sale, customer, issues);
      sale.finalizeSteps.bookings = true;
      await sale.save();
    }
    if (issues.length) {
      sale.finalizeIssues = [...new Set([...(sale.finalizeIssues || []), ...issues])];
      await sale.save();
    }

    sale.invoice = {
      number: sale.invoice?.number || `FAC-${sale.saleNumber}`,
      issuedAt: sale.invoice?.issuedAt || new Date(),
      pdfUrl: sale.invoice?.pdfUrl || '',
    };
    if (!sale.invoice.pdfUrl) sale.invoice.pdfUrl = await generateSaleInvoicePdf(sale, customer);
    await sale.save();

    if (!sale.finalizeSteps?.giftIssued) {
      await issueGiftCardsFromSale(sale);
      sale.finalizeSteps.giftIssued = true;
      await sale.save();
    }
    if (!sale.finalizeSteps?.commission) {
      await recalculateMonthlyCommissionForSale(sale);
      sale.finalizeSteps.commission = true;
      await sale.save();
    }
    if (!sale.finalizeSteps?.cart) {
      if (sale.checkoutSource !== 'QUICK_BUY') {
        await Cart.updateOne({ customerId: sale.customerId }, { $set: { lines: [], updatedByCheckoutAt: new Date() } });
      }
      sale.finalizeSteps.cart = true;
    }
    sale.finalizedAt = sale.finalizedAt || new Date();
    sale.finalizing = { at: null };
    await sale.save();

    await emitAndDispatch({
      type: 'commerce.sale.paid',
      entityType: 'CommerceSale',
      entityId: sale._id,
      actor: { type: EVENT_ACTOR_TYPE.SYSTEM },
      payloadSafe: {
        saleId: String(sale._id),
        saleNumber: sale.saleNumber,
        customerId: String(sale.customerId),
        totalAmount: Number(sale.totalCents || 0),
        ...(sale.invoice?.pdfUrl ? { invoiceUrl: sale.invoice.pdfUrl } : {}),
        paidAt: sale.finalizedAt.toISOString(),
      },
      idempotencyKey: `commerce-sale-paid:${sale._id}`,
    });
    return sale;
  } catch (err) {
    // Le verrou tombe : le prochain passage (webhook rejoué, rattrapage) reprend.
    await CommerceSale.updateOne({ _id: id }, { $set: { 'finalizing.at': null } }).catch(() => null);
    throw err;
  }
}

/** Libère ce que la vente tenait (cartes cadeaux réservées) quand elle ne sera jamais payée. */
async function closeUnpaidSale(sale, paymentStatus) {
  if (sale.paymentStatus === 'PAID' || sale.finalizedAt) return sale;
  await releaseGiftCardReservations(sale.giftCardAllocations || []);
  // Libérées une fois pour toutes : une seconde clôture ne les relâcherait pas deux fois.
  sale.giftCardAllocations = [];
  sale.giftCardAmountCents = 0;
  sale.paymentStatus = paymentStatus;
  sale.status = 'CANCELLED';
  await sale.save();
  return sale;
}

async function saleForSession(session) {
  const saleId = session?.metadata?.saleId || session?.client_reference_id;
  if (saleId) return CommerceSale.findById(saleId);
  return CommerceSale.findOne({ 'stripe.checkoutSessionId': session?.id });
}

/**
 * UNE SESSION STRIPE → L'ÉTAT DE LA VENTE. Même logique pour le webhook, la
 * page de succès et le rattrapage : c'est Stripe qui dit si c'est payé.
 *   paid / no_payment_required  → finalisée ;
 *   complete + unpaid           → paiement différé en cours (PROCESSING) ;
 *   expired                     → expirée, cartes cadeaux libérées ;
 *   open                        → rien à faire encore.
 */
export async function finalizeInstituteStripeCheckout(sessionOrId) {
  const session = typeof sessionOrId === 'string'
    ? await retrieveInstituteCheckoutSession(sessionOrId)
    : sessionOrId;
  const sale = await saleForSession(session);
  if (!sale) throw ApiError.notFound('Vente Stripe introuvable');
  if (session?.id && !sale.stripe.checkoutSessionId) sale.stripe.checkoutSessionId = session.id;
  const invoiceId = typeof session?.invoice === 'string' ? session.invoice : session?.invoice?.id;
  if (invoiceId && !sale.stripe.invoiceId) sale.stripe.invoiceId = invoiceId;
  const paid = session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
  if (paid) {
    if (Number.isFinite(session?.amount_total) && session.amount_total !== sale.stripeAmountCents) {
      sale.finalizeIssues = [...new Set([...(sale.finalizeIssues || []), `Montant encaissé par Stripe (${session.amount_total} c) différent du montant attendu (${sale.stripeAmountCents} c)`])];
    }
    await sale.save();
    return finalizePaidSale(sale, { paymentIntentId: session?.payment_intent });
  }
  if (session?.status === 'expired') return closeUnpaidSale(sale, 'EXPIRED');
  if (session?.status === 'complete' && sale.paymentStatus !== 'PAID') {
    sale.paymentStatus = 'PROCESSING';
    await sale.save();
    // Paiement différé accepté par la cliente : ses articles sont engagés dans CETTE commande.
    // Le panier se vide, sinon elle pourrait le payer une seconde fois pendant que la banque confirme.
    if (sale.checkoutSource !== 'QUICK_BUY') {
      await Cart.updateOne({ customerId: sale.customerId }, { $set: { lines: [], updatedByCheckoutAt: new Date() } });
    }
  }
  return sale;
}

/** Paiement différé refusé : la vente n'aboutira pas. */
export async function failInstituteStripeCheckout(session) {
  const sale = await saleForSession(session);
  if (!sale) return null;
  return closeUnpaidSale(sale, 'FAILED');
}

/**
 * REMBOURSEMENT FAIT DEPUIS STRIPE — reporté chez nous : une vente
 * remboursée en totalité passe « remboursée » et libère ses rendez-vous.
 */
export async function recordInstituteStripeRefund(charge) {
  const paymentIntentId = charge?.payment_intent;
  if (!paymentIntentId) return null;
  const sale = await CommerceSale.findOne({ 'stripe.paymentIntentId': paymentIntentId });
  if (!sale || sale.paymentStatus === 'REFUNDED') return sale;
  const refunded = Number(charge.amount_refunded || 0);
  if (refunded < Number(charge.amount || 0)) {
    sale.finalizeIssues = [...new Set([...(sale.finalizeIssues || []), `Remboursement partiel de ${refunded} c fait depuis Stripe`])];
    await sale.save();
    return sale;
  }
  sale.status = 'REFUNDED';
  sale.paymentStatus = 'REFUNDED';
  sale.refund = { ...(sale.refund?.toObject?.() || sale.refund || {}), amountCents: refunded, reason: 'Remboursement effectué depuis Stripe', refundedAt: new Date() };
  await sale.save();
  await cancelSaleAppointments(sale, `Vente ${sale.saleNumber} remboursée depuis Stripe`);
  await removeSaleFromCommission(sale);
  return sale;
}

/**
 * LA PAGE DE SUCCÈS DEMANDE OÙ EN EST LE PAIEMENT — la cliente ne voit
 * « confirmé » que lorsque la vente est réellement payée CHEZ NOUS. Si le
 * webhook n'est pas encore arrivé, on interroge Stripe directement et on
 * finalise : la confirmation ne dépend plus d'un seul chemin.
 */
export async function getCustomerCheckoutStatus(customerId, sessionId, saleNumber = '') {
  const id = String(sessionId || '').trim();
  const number = String(saleNumber || '').trim();
  let sale;
  if (id) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw ApiError.badRequest('Session de paiement invalide');
    sale = await CommerceSale.findOne({ 'stripe.checkoutSessionId': id, customerId });
  } else if (/^BS-[0-9]{8}-[0-9A-F]{6}$/.test(number)) {
    // Commande réglée entièrement par carte cadeau : pas de session Stripe.
    sale = await CommerceSale.findOne({ saleNumber: number, customerId });
  } else {
    throw ApiError.badRequest('Session de paiement invalide');
  }
  if (!sale) throw ApiError.notFound('Commande introuvable');
  if (id && !(sale.paymentStatus === 'PAID' && sale.finalizedAt) && !['FAILED', 'EXPIRED', 'REFUNDED'].includes(sale.paymentStatus)) {
    try {
      await finalizeInstituteStripeCheckout(id);
    } catch (err) {
      if (err?.details?.code !== 'SALE_FINALIZING') logger.warn(`[checkout] vérification ${sale.saleNumber} : ${err.message}`);
    }
    sale = await CommerceSale.findById(sale._id);
  }
  const state = sale.paymentStatus === 'PAID'
    ? (sale.finalizedAt ? 'PAID' : 'FINALIZING')
    : ['FAILED', 'EXPIRED', 'REFUNDED', 'PROCESSING'].includes(sale.paymentStatus) ? sale.paymentStatus : 'PENDING';
  return {
    state,
    saleNumber: sale.saleNumber,
    totalCents: sale.totalCents,
    giftCardAmountCents: sale.giftCardAmountCents || 0,
    cardAmountCents: sale.stripeAmountCents ?? sale.totalCents,
    giftCards: (sale.giftCardAllocations || []).map((a) => ({ codeMasked: a.codeMasked, amountCents: a.amountCents })),
    invoiceUrl: sale.finalizedAt ? await stripeInvoiceUrl(sale) : '',
    balanceDueCents: (sale.lines || []).reduce((s, l) => s + (l.balanceDueCents || 0), 0),
  };
}

/**
 * LA FACTURE STRIPE DE LA VENTE — page hébergée par Stripe, relue une fois puis
 * gardée. Une commande sans paiement Stripe (carte cadeau seule, gratuit) n'en
 * a pas : rien n'est proposé plutôt qu'un document maison.
 */
export async function stripeInvoiceUrl(sale) {
  if (sale?.stripe?.hostedInvoiceUrl) return sale.stripe.hostedInvoiceUrl;
  let invoiceId = sale?.stripe?.invoiceId || '';
  try {
    if (!invoiceId && sale?.stripe?.checkoutSessionId) {
      const session = await retrieveInstituteCheckoutSession(sale.stripe.checkoutSessionId);
      invoiceId = typeof session?.invoice === 'string' ? session.invoice : session?.invoice?.id || '';
    }
    if (!invoiceId) return '';
    const invoice = await retrieveInstituteInvoice(invoiceId);
    const url = invoice?.hosted_invoice_url || '';
    if (url) await CommerceSale.updateOne({ _id: sale._id }, { $set: { 'stripe.invoiceId': invoiceId, 'stripe.hostedInvoiceUrl': url } });
    return url;
  } catch (err) {
    logger.warn(`[checkout] facture Stripe ${sale?.saleNumber} pas encore lisible : ${err.message}`);
    return '';
  }
}

/**
 * RATTRAPAGE — toutes les quelques minutes, les ventes encore « en paiement »
 * sont confrontées à Stripe. Un webhook perdu (serveur redémarré, secret
 * changé, panne réseau) ne laisse donc jamais un paiement encaissé sans vente
 * enregistrée, ni une vente bloquée « en attente » pour toujours.
 */
export async function reconcileInstituteCheckouts({ olderThanMs = 2 * 60_000, limit = 50 } = {}) {
  const now = Date.now();
  const candidates = await CommerceSale.find({
    $or: [
      { paymentStatus: { $in: ['CHECKOUT_CREATED', 'PROCESSING'] }, 'stripe.checkoutSessionId': { $ne: '' } },
      { paymentStatus: 'PAID', finalizedAt: null },
    ],
    createdAt: { $lt: new Date(now - olderThanMs), $gt: new Date(now - 30 * 86400_000) },
    $and: [{ $or: [{ lastStripeCheckAt: null }, { lastStripeCheckAt: { $lt: new Date(now - olderThanMs) } }] }],
  }).sort({ createdAt: 1 }).limit(limit).select('_id stripe paymentStatus saleNumber finalizedAt');
  const result = { checked: 0, finalized: 0, closed: 0, errors: 0 };
  for (const candidate of candidates) {
    result.checked += 1;
    await CommerceSale.updateOne({ _id: candidate._id }, { $set: { lastStripeCheckAt: new Date() } });
    try {
      const after = candidate.paymentStatus === 'PAID'
        ? await finalizePaidSale(String(candidate._id))
        : await finalizeInstituteStripeCheckout(candidate.stripe.checkoutSessionId);
      if (after?.finalizedAt) result.finalized += 1;
      else if (['EXPIRED', 'FAILED'].includes(after?.paymentStatus)) result.closed += 1;
    } catch (err) {
      if (err?.details?.code !== 'SALE_FINALIZING') {
        result.errors += 1;
        logger.warn(`[checkout] rattrapage ${candidate.saleNumber} : ${err.message}`);
      }
    }
  }
  if (result.finalized || result.closed || result.errors) logger.info(`[checkout] rattrapage : ${JSON.stringify(result)}`);
  return result;
}

export async function listCustomerOrders(customerId) {
  const sales = await CommerceSale.find({ customerId }).sort({ createdAt: -1 }).lean();
  const urls = await Promise.all(sales.map((sale) => (sale.paymentStatus === 'PAID' || sale.paymentStatus === 'REFUNDED' ? stripeInvoiceUrl(sale) : '')));
  return sales.map((sale, i) => ({
    invoiceUrl: urls[i] || '',
    totalCents: sale.totalCents,
    balanceDueCents: (sale.lines || []).reduce((s, l) => s + (l.balanceDueCents || 0), 0),
    id: String(sale._id),
    saleNumber: sale.saleNumber,
    status: sale.status,
    paymentStatus: sale.paymentStatus,
    total: money(sale.totalCents),
    createdAt: sale.createdAt,
    invoice: sale.invoice,
    lines: sale.lines,
  }));
}

export async function listManagerProducts() {
  return CommerceProduct.find().sort({ kind: 1, title: 1 }).lean();
}

function dateOrNull(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date : null;
}

async function assertFormationSessionsAvailable(sessions, productId = null) {
  // Une session de plusieurs jours compte jour par jour : la nuit entre deux
  // jours de formation reste libre.
  const blocks = (sessions || [])
    .filter((session) => session.status !== 'CANCELLED' && session.startsAt && session.endsAt)
    .flatMap((session) => sessionBlocks({
      startsAt: dateOrNull(session.startsAt),
      endsAt: dateOrNull(session.endsAt),
      days: (session.days || []).map((d) => ({ startsAt: dateOrNull(d.startsAt), endsAt: dateOrNull(d.endsAt) })),
    }));
  for (const block of blocks) {
    if (!block.startsAt || !block.endsAt || Number.isNaN(block.startsAt.getTime()) || Number.isNaN(block.endsAt.getTime()) || block.endsAt <= block.startsAt) {
      throw ApiError.badRequest('Session de formation invalide : début et fin requis, fin après début');
    }
  }
  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      if (blocks[i].startsAt < blocks[j].endsAt && blocks[i].endsAt > blocks[j].startsAt) {
        throw ApiError.conflict('Deux sessions de cette formation se chevauchent', { code: 'CALENDAR_OVERLAP' });
      }
    }
    await assertNoOverlap({
      startsAt: blocks[i].startsAt,
      endsAt: blocks[i].endsAt,
      ignoreProductId: productId,
    });
  }
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * L'ADRESSE DE LA FICHE — plus jamais saisie dans le Manager.
 *
 * Une fiche existante GARDE son adresse, même renommée : les liens déjà
 * partagés et les commandes passées continuent de mener quelque part. Une
 * fiche nouvelle la reçoit de son titre, suffixée si le titre est déjà pris
 * (deux prestations peuvent porter le même nom, pas la même adresse).
 */
async function productSlug(payload, previous) {
  if (previous?.slug) return previous.slug;
  const base = slugify(payload.slug || payload.title) || 'fiche';
  let candidate = base;
  for (let n = 2; await CommerceProduct.exists({ slug: candidate }); n += 1) {
    candidate = `${base}-${n}`;
  }
  return candidate;
}

export async function upsertProduct(payload) {
  const previous = payload.id ? await CommerceProduct.findById(payload.id).lean() : null;
  if (previous && previous.kind !== payload.kind) {
    const hasActivity = await CommerceSale.exists({ 'lines.productId': previous._id });
    if (hasActivity) {
      throw ApiError.conflict('Le type est verrouillé après une vente, réservation ou progression client', { code: 'PRODUCT_KIND_LOCKED' });
    }
  }
  const data = {
    slug: await productSlug(payload, previous),
    title: String(payload.title || '').trim(),
    subtitle: payload.subtitle || '',
    description: payload.description || '',
    kind: payload.kind,
    status: payload.status || PRODUCT_STATUS.DRAFT,
    price: { amountCents: Number(payload.amountCents || payload.price?.amountCents || 0), currency: 'EUR' },
    coverUrl: payload.coverUrl || '',
    gallery: Array.isArray(payload.gallery) ? payload.gallery : [],
    options: Array.isArray(payload.options) ? payload.options : [],
    /**
     * Les sessions ne passent plus par l'enregistrement de la fiche : elles ont
     * leurs propres opérations (créer, déplacer, annuler — avec leurs
     * participantes, remboursements et e-mails). Une fiche enregistrée sans
     * `sessions` garde donc les siennes ; les écraser d'un formulaire ouvert
     * depuis dix minutes effacerait un déplacement fait entre-temps.
     */
    sessions: Array.isArray(payload.sessions) ? payload.sessions : (previous?.sessions || []),
    durationMinutes: Number(payload.durationMinutes || 0),
    distanceDeliveryMode: payload.distanceDeliveryMode || null,
    requiresLegalWaiver: Boolean(payload.requiresLegalWaiver),
    boostRank: payload.boostRank === undefined ? (previous?.boostRank ?? null) : payload.boostRank,
    homeFeatured: previous ? Boolean(previous.homeFeatured) : false,
    homeFeaturedRank: previous ? (previous.homeFeaturedRank ?? null) : null,
    trailer: payload.trailer || {},
    whatsappGroup: payload.whatsappGroup || {},
    faq: Array.isArray(payload.faq) ? payload.faq : [],
    training: payload.training || {},
    modules: Array.isArray(payload.modules) ? payload.modules : [],
    promotion: payload.promotion || {},
    evaluation: payload.evaluation || {},
    service: payload.service || {},
    paymentRules: payload.paymentRules || {},
    bookingRules: payload.bookingRules || {},
    seo: {
      metaTitle: String(payload.seo?.metaTitle ?? previous?.seo?.metaTitle ?? '').trim().slice(0, 120),
      metaDescription: String(payload.seo?.metaDescription ?? previous?.seo?.metaDescription ?? '').trim().slice(0, 320),
    },
  };
  if (!data.slug || !data.title || !data.kind) throw ApiError.badRequest('Titre et type requis');
  if (data.kind === 'IN_PERSON_TRAINING' && Array.isArray(payload.sessions)) {
    await assertFormationSessionsAvailable(data.sessions, payload.id || null);
  }
  if (payload.id) {
    return CommerceProduct.findByIdAndUpdate(payload.id, data, { new: true, runValidators: true });
  }
  return CommerceProduct.create(data);
}

export async function deleteProduct(productId) {
  const product = await CommerceProduct.findById(productId);
  if (!product) throw ApiError.notFound('Prestation introuvable');

  const hasActivity = await CommerceSale.exists({ 'lines.productId': product._id });
  if (hasActivity) {
    product.status = PRODUCT_STATUS.ARCHIVED;
    await product.save();
    return { deleted: false, archived: true, product };
  }

  await CommerceProduct.deleteOne({ _id: product._id });
  return { deleted: true, archived: false };
}

export async function listManagerSales() {
  const [sales, rule] = await Promise.all([
    CommerceSale.find().populate('customerId', 'email firstName lastName').sort({ createdAt: -1 }).lean(),
    activeCommissionRule(),
  ]);
  // Une vente payée avant la photo de commission reçoit la règle en vigueur (affichage seulement).
  return sales.map((sale) => (sale.commission ? sale : { ...sale, commission: computeSaleCommission(sale, rule) }));
}

export async function refundSale(saleId, payload = {}, userId = null) {
  const sale = await CommerceSale.findById(saleId);
  if (!sale) throw ApiError.notFound('Vente introuvable');
  if (sale.status === 'REFUNDED' || sale.paymentStatus === 'REFUNDED') {
    throw ApiError.conflict('Cette vente est déjà remboursée');
  }
  const amountCents = Number(payload.amountCents || sale.totalCents);
  if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > sale.totalCents) {
    throw ApiError.badRequest('Montant de remboursement invalide');
  }
  const customer = await Customer.findById(sale.customerId).lean();
  let stripeRefundId = '';
  if (sale.stripe?.paymentIntentId && sale.stripe.paymentIntentId !== 'gift_card_only' && amountCents > 0) {
    const refund = await refundInstitutePayment({
      paymentIntentId: sale.stripe.paymentIntentId,
      amountCents: Math.min(amountCents, sale.stripeAmountCents || amountCents),
      reason: payload.reason,
      saleId: sale._id,
    });
    stripeRefundId = refund.id || '';
  }
  const creditNoteNumber = sale.creditNote?.number || `AV-${sale.saleNumber}`;
  const creditPdf = await generateCreditNotePdf(sale, customer, {
    amountCents,
    reason: payload.reason,
  });
  sale.status = 'REFUNDED';
  sale.paymentStatus = 'REFUNDED';
  sale.refund = {
    amountCents,
    reason: String(payload.reason || '').trim(),
    refundedAt: new Date(),
    requestedBy: userId,
    stripeRefundId,
  };
  sale.creditNote = {
    number: creditNoteNumber,
    issuedAt: new Date(),
    pdfUrl: creditPdf,
  };
  await sale.save();
  await cancelSaleAppointments(sale, `Vente ${sale.saleNumber} remboursée`);
  await removeSaleFromCommission(sale);
  return sale.populate('customerId', 'email firstName lastName');
}

/**
 * UNE VENTE REMBOURSÉE LIBÈRE SES CRÉNEAUX.
 *
 * Le rendez-vous né du paiement restait « prévu » au planning après le
 * remboursement : il occupait encore la place et bloquait les disponibilités
 * proposées aux clientes. Chaque rendez-vous encore actif de la vente est
 * annulé par le même chemin qu'une annulation depuis le calendrier (statut,
 * motif, message à la cliente).
 */
async function cancelSaleAppointments(sale, reason) {
  const saleId = String(sale._id);
  const events = await CalendarEvent.find({
    status: { $ne: 'CANCELLED' },
    $or: [{ saleId: sale._id }, { 'source.saleId': saleId }],
  }).select('_id').lean();
  for (const event of events) {
    await cancelEvent(event._id, { reason });
  }
  return events.length;
}

export async function listManagerCustomers() {
  const customers = await Customer.find().sort({ createdAt: -1 }).lean();
  return customers.map((c) => ({ ...c, accessPending: isPendingInstituteAccount(c) }));
}

/** Manager : renvoie le lien d'accès d'un compte ouvert par l'institut. */
export async function resendCustomerAccessLink(customerId) {
  const customer = await Customer.findById(customerId).lean();
  if (!customer) throw ApiError.notFound('Client introuvable');
  if (customer.emailVerified) throw ApiError.badRequest('Ce compte est déjà activé : la cliente se connecte avec son mot de passe.');
  return sendCustomerAccessLink(customer, { origin: 'MANAGER_RESEND' });
}

export async function listCommissions() {
  const docs = await CommerceCommission.find().populate('saleIds', 'saleNumber totalCents createdAt').sort({ periodStart: -1, createdAt: -1 }).lean();
  return docs.map(commissionView);
}

export async function getInstituteIntegrations() {
  const mode = activeInstituteMode();
  const docs = await InstituteIntegration.find().lean();
  return docs.map((doc) => {
    const slot = doc.modes?.[mode] || {};
    return {
      provider: doc.provider,
      // L'environnement du site décide des clés utilisées : pas de choix manuel.
      mode,
      activeMode: mode,
      verified: Boolean(slot.verified),
      lastTestAt: slot.lastTestAt || null,
      senderEmail: slot.senderEmail || '',
      senderName: slot.senderName || '',
      publicKey: slot.publicKey?.lastFour ? maskFromLastFour(slot.publicKey.lastFour) : '',
      secretKey: slot.secretKey?.lastFour ? maskFromLastFour(slot.secretKey.lastFour) : '',
      webhookSecret: slot.webhookSecret?.lastFour ? maskFromLastFour(slot.webhookSecret.lastFour) : '',
      webhookEndpointId: slot.webhookEndpointId || '',
      webhookUrl: slot.webhookUrl || '',
      webhookLastProvisionedAt: slot.webhookLastProvisionedAt || null,
      webhookLastError: slot.webhookLastError || '',
      lastTestError: slot.lastTestError || '',
    };
  });
}

/**
 * ENREGISTRER LES CLÉS DE L'INSTITUT — toujours dans le jeu de
 * l'environnement du site (`ENV`). Une clé qui ne correspond pas (clé de
 * test sur la PROD, clé live sur la recette) est refusée avant d'être écrite.
 */
export async function saveInstituteIntegration(payload) {
  const provider = payload.provider;
  if (!['STRIPE_INSTITUTE', 'BREVO_INSTITUTE'].includes(provider)) {
    throw ApiError.badRequest('Fournisseur institut inconnu');
  }
  const mode = activeInstituteMode();
  if (payload.mode && payload.mode !== mode) {
    throw ApiError.badRequest(`Ce site tourne en ${mode} : seules les clés ${mode} s'enregistrent ici.`);
  }
  if (provider === 'STRIPE_INSTITUTE') {
    if (payload.secretKey) assertInstituteKeyMatchesMode('secretKey', String(payload.secretKey).trim(), mode);
    if (payload.publicKey) assertInstituteKeyMatchesMode('publicKey', String(payload.publicKey).trim(), mode);
  }
  const prefix = `modes.${mode}`;
  const set = { provider, mode, [`${prefix}.verified`]: false, [`${prefix}.lastTestError`]: '' };
  for (const key of ['publicKey', 'secretKey', 'webhookSecret']) {
    if (payload[key]) {
      const value = String(payload[key]).trim();
      set[`${prefix}.${key}`] = { encryptedValue: encryptSecret(value), lastFour: lastFourOf(value), verifiedAt: null };
    }
  }
  if (payload.senderEmail !== undefined) set[`${prefix}.senderEmail`] = String(payload.senderEmail || '').trim();
  if (payload.senderName !== undefined) set[`${prefix}.senderName`] = String(payload.senderName || '').trim();
  const doc = await InstituteIntegration.findOneAndUpdate({ provider }, { $set: set }, { upsert: true, new: true });
  if (provider === 'STRIPE_INSTITUTE' && payload.secretKey) {
    const ok = await provisionInstituteStripeWebhook().then(() => true).catch(async (err) => {
      await InstituteIntegration.updateOne({ provider }, { $set: { [`${prefix}.webhookLastError`]: err instanceof Error ? err.message : 'Provision webhook impossible' } });
      return false;
    });
    if (ok) await InstituteIntegration.updateOne({ provider }, { $set: { [`${prefix}.verified`]: true, [`${prefix}.lastTestAt`]: new Date() } });
  }
  // Nouvelle clé Brevo : le webhook de suivi des e-mails clients est créé s'il
  // n'existe pas encore (réutilisé sinon). Un échec n'empêche pas d'enregistrer
  // la clé ; il est noté et affiché sur la carte.
  if (provider === 'BREVO_INSTITUTE' && payload.secretKey) {
    await provisionInstituteBrevoWebhook().catch(async (err) => {
      await InstituteIntegration.updateOne({ provider }, { $set: { [`${prefix}.webhookLastError`]: err instanceof Error ? err.message : 'Création du webhook Brevo impossible' } });
    });
  }
  // Réponse masquée : jamais de secret, même chiffré, vers le navigateur.
  return (await getInstituteIntegrations()).find((item) => item.provider === provider) || null;
}

/**
 * « TESTER » — vérifie auprès du fournisseur que les clés enregistrées pour
 * l'environnement du site fonctionnent. Rien n'est jamais renvoyé des clés ;
 * seulement un verdict lisible.
 */
export async function testInstituteIntegration(provider) {
  if (!['STRIPE_INSTITUTE', 'BREVO_INSTITUTE'].includes(provider)) throw ApiError.badRequest('Fournisseur institut inconnu');
  const mode = activeInstituteMode();
  const prefix = `modes.${mode}`;
  const doc = await InstituteIntegration.findOne({ provider }).lean();
  const slot = doc?.modes?.[mode] || {};
  const clear = (ref) => (ref?.encryptedValue ? decryptSecret(ref.encryptedValue) : '');
  let ok = false;
  let message = '';
  try {
    if (provider === 'STRIPE_INSTITUTE') {
      const secret = clear(slot.secretKey);
      if (!secret) throw new Error('Renseignez d’abord la clé secrète Stripe.');
      const res = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${secret}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || 'Stripe refuse la clé secrète.');
      if (!slot.publicKey?.lastFour) {
        ok = true;
        message = 'Clé secrète valide. Ajoutez la clé publique pour compléter la configuration.';
      } else {
        ok = true;
        message = `Connexion Stripe réussie (${mode === 'PROD' ? 'mode réel' : 'mode test'}).`;
      }
    } else {
      const key = clear(slot.secretKey);
      if (!key) throw new Error('Renseignez d’abord la clé API Brevo.');
      const res = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': key, accept: 'application/json' } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Brevo refuse la clé API.');
      ok = true;
      message = `Connexion Brevo réussie${json.email ? ` (compte ${json.email})` : ''}.`;
      if (!slot.senderEmail) message += ' Renseignez l’adresse expéditeur.';
      // Clé valide sans suivi de remise : on le crée maintenant (clé saisie avant
      // l'existence de cette création automatique, ou webhook supprimé chez Brevo).
      if (!slot.webhookUrl) {
        await provisionInstituteBrevoWebhook()
          .then((r) => { if (r?.created || r?.reused) message += ' Suivi de remise des e-mails activé.'; })
          .catch(async (err) => {
            await InstituteIntegration.updateOne({ provider }, { $set: { [`${prefix}.webhookLastError`]: err instanceof Error ? err.message : 'Création du webhook Brevo impossible' } });
          });
      }
    }
  } catch (err) {
    message = err instanceof Error ? err.message : 'Test impossible.';
  }
  await InstituteIntegration.updateOne({ provider }, { $set: { [`${prefix}.verified`]: ok, [`${prefix}.lastTestAt`]: new Date(), ...(ok ? {} : { [`${prefix}.lastTestError`]: message }) } });
  return { ok, message, integration: (await getInstituteIntegrations()).find((item) => item.provider === provider) || null };
}

export async function listPublishedReviews(query = {}) {
  const filter = { status: 'PUBLISHED' };
  if (query.productId) filter.productId = query.productId;
  return Review.find(filter)
    .populate('productId', 'title kind slug')
    .sort({ createdAt: -1 })
    .limit(Math.min(50, Number(query.limit || 20)))
    .lean();
}

function reviewTargetKind(kind) {
  if (kind === 'SERVICE') return 'SERVICE';
  if (kind === 'DISTANCE_TRAINING' || kind === 'IN_PERSON_TRAINING') return 'TRAINING';
  if (kind === 'GIFT_CARD') return 'GIFT_CARD';
  return 'PRODUCT';
}

export async function createReview(customerId, payload) {
  const sale = await CommerceSale.findOne({ _id: payload.saleId, customerId }).lean();
  if (!sale) throw ApiError.notFound('Achat introuvable');
  const line = sale.lines.find((item) => String(item.productId) === String(payload.productId));
  if (!line) throw ApiError.badRequest('La cible ne fait pas partie de cet achat');
  const rating = Number(payload.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw ApiError.badRequest('Note invalide');
  return Review.findOneAndUpdate(
    { customerId, productId: payload.productId },
    {
      $setOnInsert: {
        saleId: sale._id,
        targetKind: reviewTargetKind(line.productSnapshot.kind),
      },
      $set: {
        rating,
        comment: String(payload.comment || '').trim(),
        displayName: String(payload.displayName || '').trim(),
        status: 'PENDING',
      },
    },
    { new: true, upsert: true, runValidators: true }
  );
}

export async function listManagerReviews() {
  return Review.find()
    .populate('customerId', 'email firstName lastName')
    .populate('productId', 'title kind slug')
    .sort({ createdAt: -1 })
    .lean();
}

export async function createManualReview(payload = {}, userId = null) {
  const rating = Number(payload.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) throw ApiError.badRequest('Note invalide');
  const product = payload.productId ? await CommerceProduct.findById(payload.productId).lean() : null;
  const status = ['PENDING', 'PUBLISHED', 'REJECTED'].includes(payload.status) ? payload.status : 'PUBLISHED';
  const createdAt = dateOrNull(payload.createdAt) || new Date();
  const review = await Review.create({
    customerId: new mongoose.Types.ObjectId(),
    productId: product?._id || new mongoose.Types.ObjectId(),
    saleId: new mongoose.Types.ObjectId(),
    targetKind: product ? reviewTargetKind(product.kind) : (payload.targetKind || 'PRODUCT'),
    rating,
    comment: String(payload.comment || '').trim(),
    displayName: String(payload.displayName || 'Cliente BeautySavage').trim(),
    status,
    moderationComment: String(payload.moderationComment || '').trim(),
    moderatedAt: status === 'PUBLISHED' || status === 'REJECTED' ? new Date() : null,
    moderatedBy: userId,
    manual: true,
    sourceLabel: String(payload.sourceLabel || 'Avis manuel institut').trim(),
    createdAt,
    updatedAt: new Date(),
  });
  return review.populate('productId', 'title kind slug');
}

export async function moderateReview(id, payload = {}, userId = null) {
  const status = payload.status === 'PUBLISHED' ? 'PUBLISHED' : payload.status === 'REJECTED' ? 'REJECTED' : null;
  if (!status) throw ApiError.badRequest('Statut de modération invalide');
  const review = await Review.findByIdAndUpdate(id, {
    status,
    moderationComment: String(payload.moderationComment || '').trim(),
    moderatedAt: new Date(),
    moderatedBy: userId,
  }, { new: true, runValidators: true });
  if (!review) throw ApiError.notFound('Avis introuvable');
  return review;
}

export async function listCustomerRefundRequests(customerId) {
  return RefundRequest.find({ customerId }).populate('saleId', 'saleNumber totalCents paymentStatus lines').sort({ createdAt: -1 }).lean();
}

export async function createRefundRequest(customerId, payload) {
  const sale = await CommerceSale.findOne({ _id: payload.saleId, customerId });
  if (!sale) throw ApiError.notFound('Vente introuvable');
  const line = sale.lines.id(payload.lineId);
  if (!line) throw ApiError.badRequest('Ligne de vente introuvable');
  const amount = Math.min(line.totalCents || 0, Math.max(0, Number(payload.amountCents || line.totalCents || 0)));
  return RefundRequest.create({
    customerId,
    saleId: sale._id,
    lineId: line._id,
    requestedAmountCents: amount,
    eligibleAmountCents: amount,
    reason: String(payload.reason || '').trim(),
    policySnapshot: line.productSnapshot?.bookingRules || line.productSnapshot?.training || {},
    paymentAllocationSnapshot: { stripeCents: amount, giftCardCents: 0, currency: 'EUR' },
    idempotencyKey: payload.idempotencyKey || `${sale._id}:${line._id}:${customerId}`,
    actions: [{ action: 'REQUESTED', byCustomer: customerId, comment: String(payload.reason || '').trim() }],
  });
}

export async function listManagerRefundRequests() {
  return RefundRequest.find()
    .populate('customerId', 'email firstName lastName')
    .populate('saleId', 'saleNumber totalCents paymentStatus')
    .sort({ createdAt: -1 })
    .lean();
}

export async function decideRefundRequest(id, payload = {}, userId = null) {
  const refund = await RefundRequest.findById(id);
  if (!refund) throw ApiError.notFound('Demande de remboursement introuvable');
  const nextStatus = payload.status;
  if (!['ACCEPTED', 'PROCESSING', 'REFUNDED', 'REJECTED', 'FAILED', 'CANCELLED'].includes(nextStatus)) {
    throw ApiError.badRequest('Statut de remboursement invalide');
  }
  refund.status = nextStatus;
  refund.managerComment = String(payload.comment || refund.managerComment || '').trim();
  if (nextStatus === 'REFUNDED') {
    refund.refundedAmountCents = Math.min(refund.eligibleAmountCents, Number(payload.refundedAmountCents || refund.eligibleAmountCents || 0));
  }
  refund.actions.push({ action: nextStatus, byUser: userId, comment: refund.managerComment });
  await refund.save();
  if (nextStatus === 'REFUNDED' && refund.saleId) {
    const sale = await CommerceSale.findById(refund.saleId).select('_id saleNumber').lean();
    if (sale) await cancelSaleAppointments(sale, `Vente ${sale.saleNumber} remboursée`);
  }
  return refund;
}

function generateGiftCode() {
  return `BS-${crypto.randomBytes(3).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function issueGiftCard(payload = {}, actor = {}) {
  const amountCents = Number(payload.amountCents || 0);
  if (!Number.isFinite(amountCents) || amountCents < 1000) throw ApiError.badRequest('Montant carte cadeau invalide');
  const code = payload.code || generateGiftCode();
  const card = await GiftCard.create({
    codeHash: hashGiftSecret(code),
    codeMasked: maskGiftCode(code),
    codeEncrypted: encryptGiftCode(code),
    purchaserCustomerId: actor.customerId || null,
    saleId: payload.saleId || null,
    senderName: String(payload.senderName || '').trim(),
    recipientName: String(payload.recipientName || '').trim(),
    recipientEmail: String(payload.recipientEmail || '').trim(),
    message: String(payload.message || '').trim(),
    initialAmountCents: amountCents,
    balanceCents: amountCents,
    pdfUrl: payload.pdfUrl || '',
    templateSnapshot: payload.templateSnapshot || {},
    ledger: [{
      type: 'ISSUE',
      amountCents,
      balanceBeforeCents: 0,
      balanceAfterCents: amountCents,
      source: actor.source || 'MANAGER',
      reason: payload.reason || 'Emission carte cadeau',
      actorUserId: actor.userId || null,
      actorCustomerId: actor.customerId || null,
      idempotencyKey: payload.idempotencyKey || crypto.randomUUID(),
    }], 
  });
  card.pdfUrl = await generateGiftCardPdf({
    cardId: card._id,
    codeMasked: card.codeMasked,
    code,
    senderName: card.senderName,
    recipientName: card.recipientName,
    amountCents: card.initialAmountCents,
    message: card.message,
    // Le site d'achat (recette ou production) ; une carte émise au Manager : le site de cette instance.
    siteUrl: payload.siteUrl || await configuredSiteUrl(),
  });
  await card.save();
  return { ...card.toObject(), oneTimeCode: actor.revealCode ? code : undefined };
}

export async function listManagerGiftCards() {
  return GiftCard.find().populate('purchaserCustomerId', 'email firstName lastName').sort({ createdAt: -1 }).lean();
}

/**
 * LE PORTEFEUILLE D'UNE CLIENTE — les cartes qu'elle a achetées, celles qui lui
 * sont adressées (son e-mail), et celles qu'elle a ajoutées avec leur code.
 * Le code complet n'est rendu qu'ici, à qui la carte appartient.
 */
export async function listCustomerGiftCards(customerId) {
  const customer = await Customer.findById(customerId).select('email').lean();
  const email = String(customer?.email || '').toLowerCase();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cards = await GiftCard.find({
    $or: [
      { purchaserCustomerId: customerId },
      { walletCustomerIds: customerId },
      ...(email ? [{ recipientEmail: new RegExp(`^${escaped}$`, 'i') }] : []),
    ],
  }).select('+codeEncrypted').sort({ createdAt: -1 }).lean();
  return cards.map((card) => giftCardWalletView(card, customerId, email));
}

function giftCardWalletView(card, customerId, email) {
  const bought = String(card.purchaserCustomerId || '') === String(customerId);
  const received = Boolean(email) && String(card.recipientEmail || '').toLowerCase() === email;
  const usage = (card.ledger || []).filter((e) => e.type === 'DEBIT').map((e) => ({ at: e.at, amountCents: e.amountCents, reason: e.reason }));
  return {
    id: String(card._id),
    code: decryptGiftCode(card.codeEncrypted) || null,
    codeMasked: card.codeMasked,
    initialAmountCents: card.initialAmountCents,
    balanceCents: card.balanceCents,
    availableCents: Math.max(0, (card.balanceCents || 0) - (card.reservedCents || 0)),
    status: card.status,
    origin: received && !bought ? 'RECEIVED' : bought ? 'BOUGHT' : 'ADDED',
    recipientName: card.recipientName || '',
    senderName: card.senderName || '',
    message: card.message || '',
    pdfUrl: card.pdfUrl || '',
    createdAt: card.createdAt,
    usage,
  };
}

function giftCardRefusal(card) {
  if (!card) return { code: 'GIFT_CARD_UNKNOWN', message: 'Ce code ne correspond à aucune carte cadeau. Vérifiez-le et réessayez.' };
  if (card.status === 'VOID') return { code: 'GIFT_CARD_VOID', message: 'Cette carte cadeau a été annulée.' };
  if (card.status === 'EXPIRED') return { code: 'GIFT_CARD_EXPIRED', message: 'Cette carte cadeau a expiré.' };
  if (card.status === 'EMPTY' || (card.balanceCents || 0) <= 0) return { code: 'GIFT_CARD_EMPTY', message: 'Cette carte cadeau a déjà été entièrement utilisée.' };
  return null;
}

const GIFT_RESERVED_MESSAGE = 'Le solde de cette carte est retenu par un paiement en cours. Réessayez dans quelques minutes.';

/**
 * VÉRIFIER UN CODE AVANT DE PAYER — ce que la carte paiera sur ce montant, et
 * ce qu'il restera à régler. Rien n'est réservé ici.
 */
export async function checkCustomerGiftCard(customerId, payload = {}) {
  const code = normalizeGiftCode(payload.code);
  if (!code) throw ApiError.badRequest('Saisissez le code de votre carte cadeau.', { code: 'GIFT_CARD_UNKNOWN' });
  await releaseAbandonedCheckouts(customerId);
  const card = await GiftCard.findOne({ codeHash: hashGiftSecret(code) }).lean();
  const refusal = giftCardRefusal(card);
  if (refusal) throw ApiError.badRequest(refusal.message, { code: refusal.code });
  const availableCents = Math.max(0, (card.balanceCents || 0) - (card.reservedCents || 0));
  if (availableCents <= 0) throw ApiError.conflict(GIFT_RESERVED_MESSAGE, { code: 'GIFT_CARD_RESERVED' });
  const totalCents = Math.max(0, Math.round(Number(payload.totalCents) || 0));
  const debitCents = Math.min(availableCents, totalCents);
  return { code, codeMasked: card.codeMasked, availableCents, debitCents, remainingToPayCents: totalCents - debitCents, balanceAfterCents: availableCents - debitCents };
}

/** Ajouter une carte reçue (papier, e-mail d'un tiers) à son portefeuille, avec son code. */
export async function addGiftCardToWallet(customerId, payload = {}) {
  const code = normalizeGiftCode(payload.code);
  const card = code ? await GiftCard.findOne({ codeHash: hashGiftSecret(code) }).select('+codeEncrypted') : null;
  if (!card) throw ApiError.badRequest('Ce code ne correspond à aucune carte cadeau. Vérifiez-le et réessayez.', { code: 'GIFT_CARD_UNKNOWN' });
  if (!card.codeEncrypted) card.codeEncrypted = encryptGiftCode(code);
  if (!card.walletCustomerIds.some((id) => String(id) === String(customerId))) card.walletCustomerIds.push(customerId);
  await card.save();
  return listCustomerGiftCards(customerId);
}

/**
 * LES PAIEMENTS ABANDONNÉS DE CETTE CLIENTE retiennent le solde de ses cartes.
 * Avant d'en réutiliser une, on ferme chez Stripe les sessions qu'elle a
 * laissées ouvertes : une session expirée ne peut plus être payée, la
 * réservation peut donc être rendue sans risque.
 */
async function releaseAbandonedCheckouts(customerId) {
  const stale = await CommerceSale.find({
    customerId,
    paymentStatus: 'CHECKOUT_CREATED',
    finalizedAt: null,
    'giftCardAllocations.0': { $exists: true },
  }).limit(5);
  for (const sale of stale) {
    try {
      if (sale.stripe?.checkoutSessionId) {
        const session = await expireInstituteCheckoutSession(sale.stripe.checkoutSessionId);
        if (session?.status === 'complete') { await finalizeInstituteStripeCheckout(session.id).catch(() => null); continue; }
      }
      await closeUnpaidSale(sale, 'EXPIRED');
    } catch (err) {
      logger.warn(`[gift-card] paiement abandonné ${sale.saleNumber} non refermé : ${err.message}`);
    }
  }
}

export async function adjustGiftCard(id, payload = {}, userId = null) {
  const card = await GiftCard.findById(id);
  if (!card) throw ApiError.notFound('Carte cadeau introuvable');
  const type = payload.type === 'CREDIT' ? 'CREDIT' : payload.type === 'VOID' ? 'VOID' : 'DEBIT';
  const amount = Math.max(0, Number(payload.amountCents || 0));
  const before = card.balanceCents;
  const after = type === 'DEBIT' ? before - amount : type === 'CREDIT' ? before + amount : before;
  if (after < 0) throw ApiError.conflict('Solde carte cadeau insuffisant');
  card.balanceCents = after;
  if (type === 'VOID') card.status = 'VOID';
  else if (after === 0) card.status = 'EMPTY';
  else card.status = 'ACTIVE';
  card.ledger.push({
    type,
    amountCents: amount,
    balanceBeforeCents: before,
    balanceAfterCents: after,
    source: 'MANAGER',
    reason: String(payload.reason || '').trim(),
    actorUserId: userId,
    idempotencyKey: payload.idempotencyKey || crypto.randomUUID(),
  });
  await card.save();
  return card;
}

export async function listCustomerTrainingSubmissions(customerId) {
  return TrainingSubmission.find({ customerId })
    .populate('productId', 'title slug kind evaluation modules')
    .populate('saleId', 'saleNumber')
    .sort({ createdAt: -1 })
    .lean();
}

function safeUploadExtension(file) {
  const fromName = path.extname(file?.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
  if (fromName && fromName.length <= 12) return fromName;
  const mime = String(file?.mimetype || '');
  if (mime === 'application/pdf') return '.pdf';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('mp4')) return '.mp4';
  if (mime.includes('quicktime')) return '.mov';
  if (mime.includes('webm')) return '.webm';
  return '.bin';
}

export async function uploadCustomerTrainingDeliverable(customerId, file) {
  if (!file?.path && !file?.buffer?.length) throw ApiError.badRequest('Aucun fichier reçu');
  const mime = String(file.mimetype || 'application/octet-stream');
  const kind = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime === 'application/pdf' ? 'PDF' : 'FILE';
  const dir = path.join(config.paths.uploads, 'training-deliverables');
  let filename;
  if (file.path) {
    // Déjà écrit sur le disque par multer, sous le nom qui porte la cliente.
    filename = path.basename(file.path);
  } else {
    await fs.mkdir(dir, { recursive: true });
    filename = `${Date.now()}-${crypto.randomUUID()}${safeUploadExtension(file)}`;
    await fs.writeFile(path.join(dir, filename), file.buffer);
  }
  return {
    url: `/uploads/training-deliverables/${filename}`,
    name: file.originalname || filename,
    mimeType: mime,
    size: file.size || file.buffer.length,
    kind,
    uploadedAt: new Date().toISOString(),
    customerId: String(customerId),
  };
}

/**
 * SUPPRIMER un livrable envoyé mais pas encore soumis — remplacement ou retrait.
 *
 * Seule sa propriétaire le peut (le nom du fichier porte son identifiant), et
 * jamais un fichier déjà joint à un dossier soumis : la correctrice doit voir
 * ce que la cliente a réellement envoyé. Le fichier quitte le disque — sans
 * cela, chaque remplacement laisserait une vidéo orpheline sur le serveur.
 */
export async function deleteCustomerTrainingDeliverable(customerId, url) {
  const match = String(url || '').match(/\/uploads\/training-deliverables\/([A-Za-z0-9._-]+)$/);
  if (!match) throw ApiError.badRequest('Fichier invalide');
  const filename = match[1];
  if (!filename.startsWith(`c${customerId}-`)) throw ApiError.forbidden('Ce fichier ne vous appartient pas');
  const submissions = await TrainingSubmission.find({ customerId }).select('deliverablesSnapshot').lean();
  const used = submissions.some((submission) => JSON.stringify(submission.deliverablesSnapshot || {}).includes(filename));
  if (used) throw ApiError.conflict("Ce fichier fait partie d'un dossier déjà soumis");
  await fs.rm(path.join(config.paths.uploads, 'training-deliverables', filename), { force: true });
  return { deleted: true };
}

export async function uploadTrainingResourceFile(file) {
  const result = await uploadCustomerTrainingDeliverable('manager', file);
  return { ...result, customerId: null };
}

export async function listCustomerFormations(customerId) {
  const sales = await CommerceSale.find({ customerId, paymentStatus: 'PAID' }).sort({ createdAt: -1 }).lean();
  const lines = [];
  for (const sale of sales) {
    for (const line of sale.lines || []) {
      if (!['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'].includes(line.productSnapshot?.kind)) continue;
      lines.push({ sale, line });
    }
  }
  const productIds = [...new Set(lines.map(({ line }) => String(line.productId)).filter(Boolean))];
  const [products, submissions] = await Promise.all([
    CommerceProduct.find({ _id: { $in: productIds } }).lean(),
    TrainingSubmission.find({ customerId, productId: { $in: productIds } }).sort({ createdAt: -1 }).lean(),
  ]);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const submissionsByProduct = new Map();
  for (const submission of submissions) {
    const key = String(submission.productId);
    const current = submissionsByProduct.get(key) || [];
    current.push(submission);
    submissionsByProduct.set(key, current);
  }
  return lines.map(({ sale, line }) => {
    const product = productById.get(String(line.productId));
    const productSubmissions = submissionsByProduct.get(String(line.productId)) || [];
    const latestSubmission = productSubmissions[0] || null;
    const modules = Array.isArray(product?.modules) ? product.modules : [];
    const completedModules = Number(latestSubmission?.progressSnapshot?.completedModules || 0);
    const totalModules = modules.length;
    const progressPercent = totalModules > 0 ? Math.min(100, Math.round((completedModules / totalModules) * 100)) : latestSubmission?.status === 'VALIDATED' ? 100 : 0;
    return {
      saleId: String(sale._id),
      saleNumber: sale.saleNumber,
      lineId: String(line._id || line.productId),
      purchasedAt: sale.finalizedAt || sale.createdAt,
      productId: String(line.productId),
      productSnapshot: line.productSnapshot,
      product: product ? publicProduct(product) : null,
      modules,
      evaluation: product?.evaluation || {},
      progress: { percent: progressPercent, completedModules, totalModules },
      submissions: productSubmissions,
      latestSubmission,
    };
  });
}

export async function createTrainingSubmission(customerId, payload = {}) {
  const sale = await CommerceSale.findOne({ _id: payload.saleId, customerId }).lean();
  if (!sale) throw ApiError.notFound('Achat introuvable');
  const line = sale.lines.find((item) => String(item.productId) === String(payload.productId));
  if (!line || !['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'].includes(line.productSnapshot.kind)) {
    throw ApiError.badRequest('Formation non admissible');
  }
  const product = await CommerceProduct.findById(payload.productId).lean();
  const evaluation = product?.evaluation || {};
  if (evaluation.enabled === false) throw ApiError.badRequest('Évaluation finale inactive pour cette formation');
  const pending = await TrainingSubmission.exists({ customerId, productId: payload.productId, status: 'PENDING' });
  if (pending) throw ApiError.conflict('Une soumission est déjà en attente pour cette formation');
  const last = await TrainingSubmission.findOne({ customerId, productId: payload.productId }).sort({ attempt: -1 }).lean();
  const scoreSnapshot = scoreEvaluationSubmission(evaluation, payload.answers || {});
  const submission = await TrainingSubmission.create({
    customerId,
    productId: payload.productId,
    saleId: sale._id,
    attempt: (last?.attempt || 0) + 1,
    evaluationVersion: Number(payload.evaluationVersion || evaluation.version || 1),
    answersSnapshot: payload.answers || {},
    deliverablesSnapshot: payload.deliverables || {},
    scoreSnapshot,
  });
  await emitAndDispatch({
    type: 'training.submission.created',
    entityType: 'TrainingSubmission',
    entityId: submission._id,
    payloadSafe: {
      submissionId: String(submission._id),
      customerId: String(customerId),
      trainingTitle: String(product?.title || line.productSnapshot?.title || 'Formation').slice(0, 180),
      attempt: submission.attempt,
      ...(scoreSnapshot.percent === null ? {} : { scorePercent: scoreSnapshot.percent }),
      submittedAt: submission.createdAt.toISOString(),
    },
    idempotencyKey: `training-submission-created:${submission._id}`,
  });
  const object = submission.toObject();
  if (!evaluation.showScoreToCustomer) delete object.scoreSnapshot;
  return object;
}

function normalizeAnswer(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim().toLowerCase()).sort().join('|');
  return String(value ?? '').trim().toLowerCase();
}

function questionOptions(item = {}) {
  if (item.type === 'TRUE_FALSE') {
    return [
      { id: 'true', label: 'Vrai', correct: (item.correctOptionIds || [])[0] === 'true' },
      { id: 'false', label: 'Faux', correct: (item.correctOptionIds || [])[0] === 'false' },
    ];
  }
  return Array.isArray(item.options) ? item.options : [];
}

function correctIdsFor(item = {}) {
  const explicit = Array.isArray(item.correctOptionIds) ? item.correctOptionIds.map(String) : [];
  if (explicit.length > 0) return explicit.sort();
  return questionOptions(item).filter((option) => option.correct).map((option) => String(option.id)).sort();
}

function answerIds(value) {
  if (Array.isArray(value)) return value.map(String).sort();
  if (typeof value === 'boolean') return [value ? 'true' : 'false'];
  if (value === null || value === undefined || value === '') return [];
  return [String(value)];
}

export function scoreEvaluationSubmission(evaluation = {}, answers = {}) {
  const sections = Array.isArray(evaluation.sections) ? evaluation.sections : [];
  let totalPoints = 0;
  let earnedPoints = 0;
  const details = [];
  for (const section of sections) {
    const items = Array.isArray(section.items) ? section.items : [];
    for (const item of items) {
      const points = Math.max(0, Number(item.points || 0));
      if (points <= 0) continue;
      totalPoints += points;
      const answer = answers[item.id] ?? answers[item.label] ?? '';
      const correctOptionIds = correctIdsFor(item);
      const chosenOptionIds = answerIds(answer);
      const ok = correctOptionIds.length > 0
        ? normalizeAnswer(chosenOptionIds) === normalizeAnswer(correctOptionIds)
        : normalizeAnswer(answer) === normalizeAnswer(item.correctAnswerText);
      if (ok) earnedPoints += points;
      details.push({
        questionId: item.id || '',
        label: item.label || '',
        type: item.type || 'SINGLE',
        options: questionOptions(item).map((option) => ({ id: String(option.id), label: option.label, correct: correctIdsFor(item).includes(String(option.id)) })),
        selectedOptionIds: chosenOptionIds,
        correctOptionIds,
        points,
        earnedPoints: ok ? points : 0,
        correct: ok,
      });
    }
  }
  const percent = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : null;
  return { totalPoints, earnedPoints, percent, details, calculatedAt: new Date() };
}

/**
 * LE SCORE QUE LA CORRECTRICE VOIT — toujours détaillé question par question.
 *
 * Un score enregistré sans son détail (dossier importé, soumission antérieure
 * au barème détaillé, barème retouché depuis) laissait la fiche de correction
 * sans rien à quoi rattacher chaque question : toutes s'affichaient « 0 / 4 »,
 * bonne réponse comprise. Le détail est alors recalculé depuis les réponses
 * DE LA CLIENTE et le barème de la formation — jamais inventé.
 */
function withDetailedScore(submission) {
  const stored = submission.scoreSnapshot || {};
  if (Array.isArray(stored.details) && stored.details.length > 0) return submission;
  const evaluation = submission.productId && typeof submission.productId === 'object'
    ? submission.productId.evaluation || {}
    : {};
  const computed = scoreEvaluationSubmission(evaluation, submission.answersSnapshot || {});
  if (computed.details.length === 0) return submission;
  return {
    ...submission,
    scoreSnapshot: { ...stored, ...computed, recomputedFrom: 'answersSnapshot' },
  };
}

export async function listManagerTrainingSubmissions() {
  const rows = await TrainingSubmission.find()
    .populate('customerId', 'email firstName lastName')
    .populate('productId', 'title slug kind evaluation modules')
    .populate('saleId', 'saleNumber')
    .sort({ createdAt: -1 })
    .lean();
  return rows.map(withDetailedScore);
}

export async function decideTrainingSubmission(id, payload = {}, userId = null) {
  const submission = await TrainingSubmission.findById(id);
  if (!submission) throw ApiError.notFound('Soumission introuvable');
  const status = payload.status === 'VALIDATED' ? 'VALIDATED' : payload.status === 'REJECTED' ? 'REJECTED' : null;
  if (!status) throw ApiError.badRequest('Décision invalide');
  if (status === 'REJECTED' && !String(payload.comment || '').trim()) {
    throw ApiError.badRequest('Un commentaire est obligatoire en cas de refus');
  }
  submission.status = status;
  submission.scoreSnapshot = payload.scoreSnapshot || submission.scoreSnapshot || {};
  submission.decision = {
    status,
    comment: String(payload.comment || '').trim(),
    decidedAt: new Date(),
    decidedBy: userId,
    certificateUrl: status === 'VALIDATED' ? (payload.certificateUrl || `/certificats/${submission._id}.pdf`) : '',
  };
  await submission.save();
  const product = await CommerceProduct.findById(submission.productId).select('title').lean();
  await emitAndDispatch({
    type: status === 'VALIDATED' ? 'training.submission.validated' : 'training.submission.rejected',
    entityType: 'TrainingSubmission',
    entityId: submission._id,
    payloadSafe: {
      submissionId: String(submission._id),
      customerId: String(submission.customerId),
      trainingTitle: String(product?.title || 'Formation').slice(0, 180),
      attempt: submission.attempt,
      comment: submission.decision.comment.slice(0, 1000),
      decidedAt: submission.decision.decidedAt.toISOString(),
    },
    idempotencyKey: `training-submission-decided:${submission._id}:${submission.decision.decidedAt.getTime()}`,
  });
  return submission;
}

const HOME_GROUPS = Object.freeze({
  TRAINING: ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'],
  SERVICE: ['SERVICE'],
});

/**
 * MISE EN AVANT SUR L'ACCUEIL — une rubrique à la fois, dans l'ordre choisi.
 * Les fiches de la rubrique absentes de la liste perdent leur mise en avant.
 * Aucun plafond : l'institut met en avant autant de fiches qu'il le souhaite.
 */
export async function setHomeFeatured(group, productIds = []) {
  const kinds = HOME_GROUPS[group];
  if (!kinds) throw ApiError.badRequest('Rubrique inconnue');
  const ids = [...new Set((Array.isArray(productIds) ? productIds : []).map(String))];
  const found = await CommerceProduct.find({ _id: { $in: ids }, kind: { $in: kinds } }).select('_id').lean();
  if (found.length !== ids.length) throw ApiError.badRequest('Fiche introuvable dans cette rubrique');
  await CommerceProduct.updateMany({ kind: { $in: kinds }, _id: { $nin: ids } }, { $set: { homeFeatured: false, homeFeaturedRank: null } });
  for (let index = 0; index < ids.length; index += 1) {
    await CommerceProduct.updateOne({ _id: ids[index] }, { $set: { homeFeatured: true, homeFeaturedRank: index + 1 } });
  }
  return CommerceProduct.find({ kind: { $in: kinds }, homeFeatured: true }).sort({ homeFeaturedRank: 1 }).lean();
}
