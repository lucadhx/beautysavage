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
import { GiftCard, hashGiftSecret, maskGiftCode } from '../models/GiftCard.model.js';
import { TrainingSubmission } from '../models/TrainingSubmission.model.js';
import { ApiError } from '../utils/ApiError.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskEmail } from '../utils/eventPayloadSafety.js';
import { EVENT_ACTOR_TYPE } from '../utils/domainEventConstants.js';
import { encryptSecret, lastFourOf, maskFromLastFour } from '../utils/integratedApiCrypto.js';
import { signCustomerToken } from '../middlewares/customerAuth.middleware.js';
import { assertNoOverlap } from './calendar.service.js';
import { emitAndDispatch } from './events/domainEvent.service.js';
import {
  createInstituteCheckoutSession,
  provisionInstituteStripeWebhook,
  refundInstitutePayment,
  retrieveInstituteCheckoutSession,
} from './instituteStripe.service.js';
import {
  generateCreditNotePdf,
  generateGiftCardPdf,
  generateSaleInvoicePdf,
} from './commerceDocuments.service.js';

function publicProduct(product) {
  return {
    id: String(product._id),
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    kind: product.kind,
    status: product.status,
    price: product.price,
    coverUrl: product.coverUrl,
    gallery: product.gallery || [],
    durationMinutes: product.durationMinutes || 0,
    trailer: product.trailer || {},
    whatsappGroup: product.whatsappGroup || {},
    bookingRules: product.bookingRules || {},
    modules: product.modules || [],
    options: (product.options || []).filter((option) => option.active),
    sessions: (product.sessions || [])
      .filter((session) => session.status === 'ACTIVE')
      .map((session) => ({
        id: String(session._id),
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        capacity: session.capacity,
        remaining: Math.max(0, (session.capacity || 0) - (session.reservedCount || 0)),
      })),
    distanceDeliveryMode: product.distanceDeliveryMode,
    requiresLegalWaiver: product.requiresLegalWaiver,
    boostRank: product.boostRank,
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
  if (!page.ok) throw ApiError.badRequest('Video Streamable introuvable ou non publique.');
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
  throw ApiError.badRequest('Impossible de recuperer la source MP4 Streamable pour cette video.');
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
  throw ApiError.badRequest('Impossible de recuperer une source MP4 lisible depuis ce lien Google Drive. Le fichier doit etre public et lisible/telechargeable.');
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
  const unitPriceCents = (giftCard?.amountCents ?? product.price.amountCents) + optionsTotalCents;
  const totalCents = unitPriceCents * line.quantity;
  return { optionKeys: [...optionKeys], optionsTotalCents, unitPriceCents, totalCents };
}

function websiteBaseUrl() {
  const fromCors = (process.env.CORS_ORIGINS || '').split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .find((origin) => origin && !origin.includes('manager.') && !origin.includes('api.') && origin.includes('beautysavage'));
  return fromCors || 'https://beautysavage.ly-solution.com';
}

async function hydrateCart(cart) {
  const productIds = cart.lines.map((line) => line.productId);
  const products = await CommerceProduct.find({ _id: { $in: productIds } });
  const byId = new Map(products.map((product) => [String(product._id), product]));
  const lines = cart.lines.map((line) => {
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
      giftCard: giftCardLinePayload(product, line),
      consentRequirements: lineConsentRequirements(product),
    };
  }).filter(Boolean);
  return {
    id: String(cart._id),
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.totalCents, 0),
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
  if (exists) throw ApiError.conflict('Un compte client existe deja pour cette adresse');
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
    customer,
    token: signCustomerToken(customer),
    ...(process.env.ENV === 'TEST' ? { verificationCode: code } : {}),
  };
}

export async function loginCustomer(email, password) {
  const customer = await Customer.findOne({ email: String(email || '').trim().toLowerCase() }).select('+password');
  if (!customer || !(await customer.comparePassword(String(password || '')))) {
    throw ApiError.unauthorized('Identifiants client invalides');
  }
  return { customer, token: signCustomerToken(customer) };
}

export async function requestCustomerEmailVerification(customerId) {
  const customer = await Customer.findById(customerId).select('+emailVerification.tokenHash');
  if (!customer) throw ApiError.notFound('Compte client introuvable');
  if (customer.emailVerified) return { message: 'Adresse e-mail deja verifiee.' };
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
  return { message: 'Code de verification envoye.', ...(process.env.ENV === 'TEST' ? { verificationCode: code } : {}) };
}

export async function verifyCustomerEmail(code) {
  const tokenHash = hashCustomerSecret(code);
  const customer = await Customer.findOne({
    'emailVerification.tokenHash': tokenHash,
    'emailVerification.expiresAt': { $gt: new Date() },
  }).select('+emailVerification.tokenHash');
  if (!customer) throw ApiError.badRequest('Code de verification invalide ou expire');
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
  return { customer, token: signCustomerToken(customer), message: 'Adresse e-mail verifiee.' };
}

function customerWebsiteBaseUrl() {
  const fromCors = (process.env.CORS_ORIGINS || '').split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .find((origin) => origin && origin.includes('beautysavage') && !origin.includes('api.') && !origin.includes('manager.'));
  return fromCors || 'https://beautysavage.ly-solution.com';
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

export async function requestCustomerPasswordReset(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const customer = await Customer.findOne({ email: normalized }).select('+passwordReset.tokenHash');
  const response = { message: 'Si ce compte existe, un lien de reinitialisation va etre envoye.' };
  if (!customer) return response;
  const token = crypto.randomBytes(32).toString('hex');
  customer.passwordReset = {
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    requestedAt: new Date(),
    usedAt: null,
  };
  await customer.save();
  const resetUrl = `${customerWebsiteBaseUrl()}/espace-client/mot-de-passe?token=${token}`;
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
  if (!customer) throw ApiError.badRequest('Lien de reinitialisation invalide ou expire');
  const password = String(payload.password || '');
  if (password.length < 8) throw ApiError.badRequest('Mot de passe trop court');
  customer.password = password;
  customer.passwordReset.usedAt = new Date();
  customer.passwordReset.tokenHash = '';
  await customer.save();
  return { message: 'Mot de passe client mis a jour.' };
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
  const product = await CommerceProduct.findOne({ _id: payload.productId, status: PRODUCT_STATUS.PUBLISHED });
  if (!product) throw ApiError.notFound('Article indisponible');
  let bookingSnapshot = null;
  if (product.kind === 'IN_PERSON_TRAINING' && !payload.sessionId) {
    throw ApiError.badRequest('Une session est requise pour cette formation presentielle');
  }
  if (product.kind === 'IN_PERSON_TRAINING' && payload.sessionId) {
    const session = product.sessions.id(payload.sessionId);
    if (!session || session.status !== 'ACTIVE') throw ApiError.badRequest('Session indisponible');
    if ((session.reservedCount || 0) >= (session.capacity || 0)) throw ApiError.conflict('Cette session est complete');
  }
  if (product.kind === 'SERVICE') {
    const startsAt = new Date(payload.serviceBooking?.startsAt || payload.bookingSnapshot?.startsAt || '');
    const durationMinutes = Math.max(5, Number(product.durationMinutes || payload.serviceBooking?.durationMinutes || 60));
    const endsAt = new Date(payload.serviceBooking?.endsAt || startsAt.getTime() + durationMinutes * 60_000);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw ApiError.badRequest('Choisissez un creneau disponible pour cette prestation');
    }
    await assertNoOverlap({ startsAt, endsAt });
    bookingSnapshot = {
      startsAt,
      endsAt,
      durationMinutes,
      timezone: 'Europe/Paris',
    };
  }
  const giftCard = product.kind === 'GIFT_CARD'
    ? giftCardLinePayload(product, { giftCard: payload.giftCard || payload })
    : null;
  if (product.kind === 'GIFT_CARD') {
    if (!giftCard.recipientName) throw ApiError.badRequest('Beneficiaire requis pour la carte cadeau');
    if (!giftCard.senderName) throw ApiError.badRequest('Nom de l expediteur requis pour la carte cadeau');
  }
  const cart = await Cart.findOneAndUpdate(
    { customerId },
    {
      $push: {
        lines: {
          productId: product._id,
          quantity: Math.max(1, Number(payload.quantity || 1)),
          sessionId: payload.sessionId || null,
          bookingSnapshot,
          optionKeys: Array.isArray(payload.optionKeys) ? payload.optionKeys : [],
          giftCard,
        },
      },
    },
    { new: true, upsert: true }
  );
  return hydrateCart(cart);
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
    throw ApiError.forbidden('Verification e-mail obligatoire avant achat', { code: 'CUSTOMER_EMAIL_NOT_VERIFIED' });
  }
  const integration = await InstituteIntegration.findOne({ provider: 'STRIPE_INSTITUTE' }).lean();
  const stripeReady = Boolean(integration?.verified);
  let giftCardAllocations = await reserveGiftCardAllocations(payload.giftCardCodes || payload.giftCards || [], hydrated.totalCents);
  let giftCardAmountCents = giftCardAllocations.reduce((sum, item) => sum + item.amountCents, 0);
  let stripeAmountCents = Math.max(0, hydrated.totalCents - giftCardAmountCents);
  if (!stripeReady && stripeAmountCents > 0 && giftCardAllocations.length > 0) {
    await releaseGiftCardReservations(giftCardAllocations);
    giftCardAllocations = [];
    giftCardAmountCents = 0;
    stripeAmountCents = hydrated.totalCents;
  }

  const saleNumber = `BS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const idempotencyKey = payload.idempotencyKey || crypto.randomUUID();
  const lines = hydrated.lines.map((line) => ({
    productId: line.product.id,
    productSnapshot: line.product,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    optionsTotalCents: line.optionsTotalCents,
    totalCents: line.totalCents,
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
        stripe: {
          checkoutSessionId: '',
          mode: integration?.mode || 'TEST',
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
      message: 'Commande deja payee.',
    };
  }

  if (stripeAmountCents === 0) {
    const paidSale = await finalizePaidSale(sale, { paymentIntentId: 'gift_card_only' });
    return {
      saleId: String(paidSale._id),
      saleNumber: paidSale.saleNumber,
      total: money(paidSale.totalCents),
      paymentStatus: paidSale.paymentStatus,
      checkoutUrl: '/paiement/succes',
      message: 'Commande reglee par carte cadeau.',
    };
  }

  if (stripeReady && !sale.stripe.checkoutSessionId) {
    try {
      const checkout = await createInstituteCheckoutSession({
        sale,
        customer,
        lineItems: [{
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: stripeAmountCents,
            product_data: { name: `Commande BeautySavage ${sale.saleNumber}` },
          },
        }],
        successUrl: `${websiteBaseUrl()}/paiement/succes?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${websiteBaseUrl()}/panier?paiement=annule`,
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
  let remaining = Math.max(0, Number(maxAmountCents || 0));
  for (const entry of codes) {
    if (remaining <= 0) break;
    const code = String(entry.code || '').trim();
    if (!code) continue;
    const card = await GiftCard.findOne({ codeHash: hashGiftSecret(code), status: 'ACTIVE' });
    if (!card) throw ApiError.badRequest('Carte cadeau invalide ou inactive');
    const available = Math.max(0, (card.balanceCents || 0) - (card.reservedCents || 0));
    if (available <= 0) throw ApiError.conflict('Solde carte cadeau insuffisant');
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

async function applyGiftCardAllocations(sale) {
  for (const allocation of sale.giftCardAllocations || []) {
    if (allocation.appliedAt) continue;
    const card = await GiftCard.findById(allocation.giftCardId);
    if (!card) throw ApiError.notFound('Carte cadeau allouee introuvable');
    const amount = Number(allocation.amountCents || 0);
    const before = card.balanceCents;
    if (before < amount) throw ApiError.conflict('Solde carte cadeau insuffisant a la finalisation');
    card.balanceCents = before - amount;
    card.reservedCents = Math.max(0, (card.reservedCents || 0) - amount);
    card.status = card.balanceCents === 0 ? 'EMPTY' : 'ACTIVE';
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
      { $inc: { reservedCents: -amount } }
    );
  }
}

async function incrementReservedSessions(sale) {
  for (const line of sale.lines || []) {
    if (line.productSnapshot?.kind !== 'IN_PERSON_TRAINING' || !line.sessionId) continue;
    const product = await CommerceProduct.findById(line.productId);
    const session = product?.sessions.id(line.sessionId);
    if (!session || session.status !== 'ACTIVE') throw ApiError.conflict('Session de formation indisponible');
    if ((session.reservedCount || 0) + (line.quantity || 1) > (session.capacity || 0)) {
      throw ApiError.conflict('Session de formation complete');
    }
    session.reservedCount = (session.reservedCount || 0) + (line.quantity || 1);
    await product.save();
  }
}

async function createServiceBookingsFromSale(sale, customer) {
  for (const line of sale.lines || []) {
    if (line.productSnapshot?.kind !== 'SERVICE' || !line.bookingSnapshot?.startsAt || !line.bookingSnapshot?.endsAt) continue;
    const startsAt = new Date(line.bookingSnapshot.startsAt);
    const endsAt = new Date(line.bookingSnapshot.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) continue;
    const source = { saleId: String(sale._id), lineId: String(line._id), kind: 'SERVICE_CHECKOUT' };
    const existing = await CalendarEvent.findOne({ 'source.saleId': source.saleId, 'source.lineId': source.lineId }).lean();
    if (existing) continue;
    await assertNoOverlap({ startsAt, endsAt });
    await CalendarEvent.create({
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
        totalCents: line.totalCents || 0,
        paidCents: line.totalCents || 0,
        depositCents: 0,
        balanceDueCents: 0,
        currency: sale.currency || 'EUR',
      },
      notes: `Reservation issue de ${sale.saleNumber}.`,
      source,
    });
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
        recipientEmail: giftCard.recipientEmail,
        message: giftCard.message,
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

async function recalculateMonthlyCommissionForSale(sale) {
  const basisCents = (sale.lines || [])
    .filter((line) => line.productSnapshot?.kind === 'DISTANCE_TRAINING')
    .reduce((sum, line) => sum + (line.totalCents || 0), 0);
  if (basisCents <= 0) return null;
  const rateBps = 1000;
  const amountCents = Math.round((basisCents * rateBps) / 10000);
  const period = commissionPeriod(sale.finalizedAt || sale.updatedAt || new Date());
  const label = `Commission formations en ligne ${period.key}`;
  const alreadyIncluded = await CommerceCommission.exists({ periodKey: period.key, label, saleIds: sale._id });
  if (alreadyIncluded) return CommerceCommission.findOne({ periodKey: period.key, label });
  return CommerceCommission.findOneAndUpdate(
    { periodKey: period.key, label },
    {
      $setOnInsert: {
        periodStart: period.start,
        periodEnd: period.end,
        dueAt: new Date(Date.UTC(period.end.getUTCFullYear(), period.end.getUTCMonth(), period.end.getUTCDate() + 7)),
        currency: 'EUR',
        status: 'DUE',
      },
      $set: { rateBps },
      $inc: { amountCents, basisCents },
      $addToSet: { saleIds: sale._id },
      $push: { 'sourceSnapshot.lines': { saleNumber: sale.saleNumber, basisCents, amountCents, rateBps } },
    },
    { new: true, upsert: true }
  );
}

export async function recalculateMonthlyCommissions() {
  const paidSales = await CommerceSale.find({ paymentStatus: 'PAID' }).sort({ finalizedAt: 1, createdAt: 1 }).lean();
  const groups = new Map();
  for (const sale of paidSales) {
    const basisCents = (sale.lines || [])
      .filter((line) => line.productSnapshot?.kind === 'DISTANCE_TRAINING')
      .reduce((sum, line) => sum + (line.totalCents || 0), 0);
    if (basisCents <= 0) continue;
    const period = commissionPeriod(sale.finalizedAt || sale.updatedAt || sale.createdAt || new Date());
    const current = groups.get(period.key) || { period, basisCents: 0, saleIds: [], lines: [] };
    current.basisCents += basisCents;
    current.saleIds.push(sale._id);
    current.lines.push({ saleNumber: sale.saleNumber, basisCents, rateBps: 1000, amountCents: Math.round(basisCents * 0.1) });
    groups.set(period.key, current);
  }
  const docs = [];
  for (const group of groups.values()) {
    const label = `Commission formations en ligne ${group.period.key}`;
    docs.push(await CommerceCommission.findOneAndUpdate(
      { periodKey: group.period.key, label },
      {
        $set: {
          periodStart: group.period.start,
          periodEnd: group.period.end,
          dueAt: new Date(Date.UTC(group.period.end.getUTCFullYear(), group.period.end.getUTCMonth(), group.period.end.getUTCDate() + 7)),
          amountCents: Math.round(group.basisCents * 0.1),
          basisCents: group.basisCents,
          rateBps: 1000,
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

export async function finalizePaidSale(saleOrId, stripePayload = {}) {
  const sale = typeof saleOrId === 'string' ? await CommerceSale.findById(saleOrId) : saleOrId;
  if (!sale) throw ApiError.notFound('Vente introuvable');
  if (sale.paymentStatus === 'PAID' && sale.finalizedAt) return sale;
  const customer = await Customer.findById(sale.customerId).lean();
  await applyGiftCardAllocations(sale);
  await incrementReservedSessions(sale);
  await createServiceBookingsFromSale(sale, customer);
  sale.status = 'PAID';
  sale.paymentStatus = 'PAID';
  sale.finalizedAt = sale.finalizedAt || new Date();
  sale.stripe.paymentIntentId = stripePayload.paymentIntentId || stripePayload.payment_intent || sale.stripe.paymentIntentId || '';
  sale.invoice = {
    number: sale.invoice?.number || `FAC-${sale.saleNumber}`,
    issuedAt: sale.invoice?.issuedAt || new Date(),
    pdfUrl: sale.invoice?.pdfUrl || '',
  };
  if (!sale.invoice.pdfUrl) {
    sale.invoice.pdfUrl = await generateSaleInvoicePdf(sale, customer);
  }
  await sale.save();
  await issueGiftCardsFromSale(sale);
  await recalculateMonthlyCommissionForSale(sale);
  await Cart.updateOne({ customerId: sale.customerId }, { $set: { lines: [], updatedByCheckoutAt: new Date() } });
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
}

export async function finalizeInstituteStripeCheckout(sessionOrId) {
  const session = typeof sessionOrId === 'string'
    ? await retrieveInstituteCheckoutSession(sessionOrId)
    : sessionOrId;
  const saleId = session?.metadata?.saleId || session?.client_reference_id;
  const sale = saleId
    ? await CommerceSale.findById(saleId)
    : await CommerceSale.findOne({ 'stripe.checkoutSessionId': session?.id });
  if (!sale) throw ApiError.notFound('Vente Stripe introuvable');
  if (session?.payment_status && session.payment_status !== 'paid') {
    sale.paymentStatus = 'FAILED';
    await sale.save();
    return sale;
  }
  sale.stripe.checkoutSessionId = session?.id || sale.stripe.checkoutSessionId;
  return finalizePaidSale(sale, { paymentIntentId: session?.payment_intent });
}

export async function listCustomerOrders(customerId) {
  const sales = await CommerceSale.find({ customerId }).sort({ createdAt: -1 }).lean();
  return sales.map((sale) => ({
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
  const active = (sessions || [])
    .filter((session) => session.status !== 'CANCELLED' && session.startsAt && session.endsAt)
    .map((session) => ({
      startsAt: dateOrNull(session.startsAt),
      endsAt: dateOrNull(session.endsAt),
    }));
  for (const session of active) {
    if (!session.startsAt || !session.endsAt || session.endsAt <= session.startsAt) {
      throw ApiError.badRequest('Session de formation invalide : debut et fin requis, fin apres debut');
    }
  }
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      if (active[i].startsAt < active[j].endsAt && active[i].endsAt > active[j].startsAt) {
        throw ApiError.conflict('Deux sessions de cette formation se chevauchent', { code: 'CALENDAR_OVERLAP' });
      }
    }
    await assertNoOverlap({
      startsAt: active[i].startsAt,
      endsAt: active[i].endsAt,
      ignoreProductId: productId,
    });
  }
}

export async function upsertProduct(payload) {
  const previous = payload.id ? await CommerceProduct.findById(payload.id).lean() : null;
  if (previous && previous.kind !== payload.kind) {
    const hasActivity = await CommerceSale.exists({ 'lines.productId': previous._id });
    if (hasActivity) {
      throw ApiError.conflict('Le type est verrouille apres une vente, reservation ou progression client', { code: 'PRODUCT_KIND_LOCKED' });
    }
  }
  const data = {
    slug: String(payload.slug || payload.title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title: String(payload.title || '').trim(),
    subtitle: payload.subtitle || '',
    description: payload.description || '',
    kind: payload.kind,
    status: payload.status || PRODUCT_STATUS.DRAFT,
    price: { amountCents: Number(payload.amountCents || payload.price?.amountCents || 0), currency: 'EUR' },
    coverUrl: payload.coverUrl || '',
    gallery: Array.isArray(payload.gallery) ? payload.gallery : [],
    options: Array.isArray(payload.options) ? payload.options : [],
    sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
    durationMinutes: Number(payload.durationMinutes || 0),
    distanceDeliveryMode: payload.distanceDeliveryMode || null,
    requiresLegalWaiver: Boolean(payload.requiresLegalWaiver),
    boostRank: payload.boostRank ?? null,
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
  };
  if (!data.slug || !data.title || !data.kind) throw ApiError.badRequest('Titre, slug et type requis');
  if (data.kind === 'IN_PERSON_TRAINING') {
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
  return CommerceSale.find().populate('customerId', 'email firstName lastName').sort({ createdAt: -1 }).lean();
}

export async function refundSale(saleId, payload = {}, userId = null) {
  const sale = await CommerceSale.findById(saleId);
  if (!sale) throw ApiError.notFound('Vente introuvable');
  if (sale.status === 'REFUNDED' || sale.paymentStatus === 'REFUNDED') {
    throw ApiError.conflict('Cette vente est deja remboursee');
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
  return sale.populate('customerId', 'email firstName lastName');
}

export async function listManagerCustomers() {
  return Customer.find().sort({ createdAt: -1 }).lean();
}

export async function listCommissions() {
  return CommerceCommission.find().populate('saleIds', 'saleNumber totalCents createdAt').sort({ createdAt: -1 }).lean();
}

export async function markCommissionPaid(id, payload = {}) {
  const commission = await CommerceCommission.findById(id);
  if (!commission) throw ApiError.notFound('Commission introuvable');
  if (commission.status === 'PAID') throw ApiError.conflict('Cette commission est deja payee');
  commission.status = 'PAID';
  commission.paidAt = new Date();
  commission.paymentReference = String(payload.paymentReference || '').trim();
  await commission.save();
  return commission;
}

export async function getInstituteIntegrations() {
  const docs = await InstituteIntegration.find().lean();
  return docs.map((doc) => ({
    provider: doc.provider,
    mode: doc.mode,
    verified: doc.verified,
    lastTestAt: doc.lastTestAt,
    senderEmail: doc.senderEmail,
    publicKey: doc.publicKey?.lastFour ? maskFromLastFour(doc.publicKey.lastFour) : '',
    secretKey: doc.secretKey?.lastFour ? maskFromLastFour(doc.secretKey.lastFour) : '',
    webhookSecret: doc.webhookSecret?.lastFour ? maskFromLastFour(doc.webhookSecret.lastFour) : '',
    webhookEndpointId: doc.webhookEndpointId,
    webhookUrl: doc.webhookUrl,
    webhookLastProvisionedAt: doc.webhookLastProvisionedAt,
    webhookLastError: doc.webhookLastError,
    senderName: doc.senderName,
  }));
}

export async function saveInstituteIntegration(payload) {
  const provider = payload.provider;
  if (!['STRIPE_INSTITUTE', 'BREVO_INSTITUTE'].includes(provider)) {
    throw ApiError.badRequest('Fournisseur institut inconnu');
  }
  const set = { provider, mode: payload.mode === 'PROD' ? 'PROD' : 'TEST', verified: false };
  for (const key of ['publicKey', 'secretKey', 'webhookSecret']) {
    if (payload[key]) {
      set[key] = {
        encryptedValue: encryptSecret(String(payload[key])),
        lastFour: lastFourOf(payload[key]),
        verifiedAt: null,
      };
    }
  }
  if (payload.senderEmail !== undefined) set.senderEmail = String(payload.senderEmail || '').trim();
  if (payload.senderName !== undefined) set.senderName = String(payload.senderName || '').trim();
  const doc = await InstituteIntegration.findOneAndUpdate({ provider }, { $set: set }, { upsert: true, new: true });
  if (provider === 'STRIPE_INSTITUTE' && payload.secretKey) {
    try {
      await provisionInstituteStripeWebhook();
      doc.verified = true;
      doc.lastTestAt = new Date();
      await doc.save();
    } catch (err) {
      doc.webhookLastError = err instanceof Error ? err.message : 'Provision webhook impossible';
      await doc.save();
    }
  }
  return doc;
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
  if (!status) throw ApiError.badRequest('Statut de moderation invalide');
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
  });
  await card.save();
  return { ...card.toObject(), oneTimeCode: actor.revealCode ? code : undefined };
}

export async function listManagerGiftCards() {
  return GiftCard.find().populate('purchaserCustomerId', 'email firstName lastName').sort({ createdAt: -1 }).lean();
}

export async function listCustomerGiftCards(customerId) {
  return GiftCard.find({ purchaserCustomerId: customerId }).sort({ createdAt: -1 }).lean();
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
  if (!file?.buffer?.length) throw ApiError.badRequest('Aucun fichier recu');
  const mime = String(file.mimetype || 'application/octet-stream');
  const kind = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime === 'application/pdf' ? 'PDF' : 'FILE';
  const dir = path.join(config.paths.uploads, 'training-deliverables');
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomUUID()}${safeUploadExtension(file)}`;
  const absolute = path.join(dir, filename);
  await fs.writeFile(absolute, file.buffer);
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
  if (evaluation.enabled === false) throw ApiError.badRequest('Evaluation finale inactive pour cette formation');
  const pending = await TrainingSubmission.exists({ customerId, productId: payload.productId, status: 'PENDING' });
  if (pending) throw ApiError.conflict('Une soumission est deja en attente pour cette formation');
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

function scoreEvaluationSubmission(evaluation = {}, answers = {}) {
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

export async function listManagerTrainingSubmissions() {
  return TrainingSubmission.find()
    .populate('customerId', 'email firstName lastName')
    .populate('productId', 'title slug kind evaluation modules')
    .populate('saleId', 'saleNumber')
    .sort({ createdAt: -1 })
    .lean();
}

export async function decideTrainingSubmission(id, payload = {}, userId = null) {
  const submission = await TrainingSubmission.findById(id);
  if (!submission) throw ApiError.notFound('Soumission introuvable');
  const status = payload.status === 'VALIDATED' ? 'VALIDATED' : payload.status === 'REJECTED' ? 'REJECTED' : null;
  if (!status) throw ApiError.badRequest('Decision invalide');
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
  return submission;
}
