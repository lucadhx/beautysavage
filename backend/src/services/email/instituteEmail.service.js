import crypto from 'node:crypto';
import { InstituteIntegration } from '../../models/InstituteIntegration.model.js';
import { EmailDelivery } from '../../models/EmailDelivery.model.js';
import { EmailDeliveryEvent } from '../../models/EmailDeliveryEvent.model.js';
import { Company } from '../../models/Company.model.js';
import { Theme } from '../../models/Theme.model.js';
import { config } from '../../config/env.js';
import { decryptSecret, encryptSecret, lastFourOf } from '../../utils/integratedApiCrypto.js';
import { configuredSiteUrl } from '../../utils/siteOrigin.js';
import { normalizeBrevoEvent } from '../../utils/brevoTransactionalEventRegistry.js';
import { normalizeProviderMessageId } from '../../utils/providerMessageId.js';
import { maskEmail } from '../../utils/eventPayloadSafety.js';
import { logger } from '../../utils/logger.js';
import { applyBrevoEventToDelivery } from './brevoDeliveryTransitions.js';
import { INSTITUTE_TEMPLATES, isInstituteTemplate } from './instituteTemplates.js';

/**
 * E-MAILS CLIENTS PAR LA CLÉ BREVO DE L'INSTITUT.
 *
 * Un e-mail destiné à un CLIENT de l'institut (code de vérification,
 * confirmation de rendez-vous, carte cadeau…) est rendu ici à partir des
 * modèles locaux (`instituteTemplates.js`) et part par le compte Brevo de
 * l'institut, sous son expéditeur. Le Panel n'intervient pas : ce sont les
 * messages de l'institut, pas ceux de la plateforme.
 *
 * Tant que l'institut n'a pas renseigné sa clé ET son expéditeur, l'envoi
 * retombe sur le chemin historique (Panel) : un code de vérification ne doit
 * jamais rester bloqué faute de configuration.
 *
 * Le suivi de remise passe par un webhook Brevo créé automatiquement à
 * l'enregistrement de la clé (`provisionInstituteBrevoWebhook`) ; il rapproche
 * chaque événement de la livraison par son identifiant (`X-Mailin-custom`),
 * à défaut par le `message-id`.
 */

export const INSTITUTE_PROVIDER = 'BREVO_INSTITUTE';
const BREVO_API = 'https://api.brevo.com/v3';
const WEBHOOK_EVENTS = ['request', 'delivered', 'deferred', 'softBounce', 'hardBounce', 'blocked', 'spam', 'invalid', 'error', 'unsubscribed', 'opened', 'uniqueOpened', 'click'];

const activeMode = () => (config.env === 'PROD' ? 'PROD' : 'TEST');
const clear = (ref) => {
  try { return ref?.encryptedValue ? decryptSecret(ref.encryptedValue) : ''; } catch { return ''; }
};

/** Clé + expéditeur de l'institut pour l'environnement du site, ou `null` s'il manque l'un des deux. */
export async function instituteBrevoSender() {
  const doc = await InstituteIntegration.findOne({ provider: INSTITUTE_PROVIDER }).lean();
  const slot = doc?.modes?.[activeMode()] || {};
  const apiKey = clear(slot.secretKey);
  const email = String(slot.senderEmail || '').trim();
  if (!apiKey || !email) return null;
  return { apiKey, email, name: String(slot.senderName || '').trim(), mode: activeMode() };
}

/** Un modèle client ET une configuration complète : c'est l'institut qui envoie. */
export async function shouldSendAsInstitute(templateId) {
  if (!isInstituteTemplate(templateId)) return null;
  return instituteBrevoSender();
}

/* ───────────────────────── Rendu ───────────────────────── */

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
// « lundi 5 octobre 2026 à 09:00 » — le « à » n'est pas garanti par toutes les versions d'ICU.
const formatDate = (d) => dateFmt.format(d).replace(/(\d{4})(?: à|,)? (\d{2}:\d{2})$/, '$1 à $2');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Valeur lisible : montant en euros, date en clair (heure de Paris), texte tel quel. */
function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && Number.isInteger(value.amount)) {
    if (value.currency && value.currency.toUpperCase() !== 'EUR') {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: value.currency.toUpperCase() }).format(value.amount / 100);
    }
    return euro.format(value.amount / 100);
  }
  if (value instanceof Date) return formatDate(value);
  const text = String(value).trim();
  if (ISO_DATE.test(text) && !Number.isNaN(Date.parse(text))) return formatDate(new Date(text));
  return text;
}

function plain(variables) {
  return variables instanceof Map ? Object.fromEntries(variables) : (variables ?? {});
}

/**
 * Remplace les `{{variables}}` d'un fragment. Renvoie `null` si l'une d'elles
 * est vide : le bloc entier disparaît (« Remboursement : » sans montant n'a
 * pas sa place dans un e-mail). `…Html` est inséré tel quel — le résolveur l'a
 * déjà échappé ; tout le reste est échappé ici.
 */
function fill(fragment, vars, { html = true } = {}) {
  if (!fragment) return null;
  let missing = false;
  const out = fragment.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const raw = vars[key];
    const shown = displayValue(raw);
    if (!shown) { missing = true; return ''; }
    if (!html) return shown;
    return key.endsWith('Html') ? String(raw) : escapeHtml(shown);
  });
  return missing ? null : out;
}

/** Texte lisible sur une couleur : noir ou blanc selon sa luminance. */
function readableOn(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}

function absoluteUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  const base = config.publicBackendUrl || config.publicUrl || '';
  return base ? `${base}${u.startsWith('/') ? '' : '/'}${u}` : '';
}

async function brand() {
  const [company, theme, siteUrl] = await Promise.all([
    Company.findOne().lean().catch(() => null),
    Theme.findOne().lean().catch(() => null),
    configuredSiteUrl().catch(() => ''),
  ]);
  const media = (company?.media || []).filter((m) => m.enabled && m.value);
  const contact = (key) => media.find((m) => m.key === key)?.value || '';
  const primary = /^#[0-9a-f]{6}$/i.test(theme?.colors?.primary || '') ? theme.colors.primary : '#111111';
  const accent = /^#[0-9a-f]{6}$/i.test(theme?.colors?.accent || '') ? theme.colors.accent : '#c7a98a';
  return {
    name: company?.name || 'BeautySavage',
    logoUrl: absoluteUrl(company?.logos?.header),
    primary,
    onPrimary: readableOn(primary),
    accent,
    siteUrl: siteUrl || '',
    address: contact('address'),
    phone: contact('phone'),
    email: contact('email'),
  };
}

/**
 * Rend un modèle client : `{ subject, html, text }`. Pur vis-à-vis du réseau ;
 * lit seulement l'identité de l'institut (nom, logo, couleurs, coordonnées).
 */
export async function renderInstituteEmail(templateId, variables, brandOverride = null) {
  const tpl = INSTITUTE_TEMPLATES[templateId];
  if (!tpl) throw new Error(`Modèle client inconnu : ${templateId}`);
  const vars = plain(variables);
  const b = brandOverride || await brand();

  const subject = (fill(tpl.subject, vars, { html: false }) ?? tpl.subject.replace(/\{\{[^}]+\}\}/g, '').replace(/\s{2,}/g, ' ')).trim();
  const paragraphs = (tpl.paragraphs || []).map((p) => fill(p, vars)).filter(Boolean);
  const rows = (tpl.rows || []).map(([label, v]) => [label, fill(v, vars)]).filter(([, v]) => v);
  const code = fill(tpl.code, vars);
  const list = fill(tpl.list, vars);
  const quote = fill(tpl.quote, vars);
  const ctaUrl = tpl.cta ? fill(tpl.cta.url, vars, { html: false }) : null;
  const note = fill(tpl.note, vars);
  const preheader = fill(tpl.preheader, vars) || '';

  const P = (t) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#27272a;">${t}</p>`;
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
<style>@media only screen and (max-width:600px){.wrap{width:100%!important}.pad{padding:24px 20px!important}.code{font-size:30px!important;letter-spacing:8px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e4e4e7;">
<tr><td align="center" style="background:${b.primary};padding:22px 24px;">
${b.logoUrl ? `<img src="${escapeHtml(b.logoUrl)}" alt="${escapeHtml(b.name)}" height="44" style="display:block;height:44px;max-width:220px;border:0;">` : `<span style="font-size:22px;font-weight:700;letter-spacing:.5px;color:${b.onPrimary};">${escapeHtml(b.name)}</span>`}
</td></tr>
<tr><td class="pad" style="padding:34px 36px;">
<h1 style="margin:0 0 18px;font-size:22px;line-height:1.3;color:#111111;">${escapeHtml(tpl.title)}</h1>
${paragraphs.map(P).join('\n')}
${code ? `<div class="code" style="margin:8px 0 22px;padding:18px;border-radius:12px;background:#fafafa;border:1px dashed ${b.accent};text-align:center;font-size:36px;font-weight:700;letter-spacing:12px;color:#111111;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${code}</div>` : ''}
${list ? `<div style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#27272a;">${list}</div>` : ''}
${rows.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 8px;border-top:1px solid #eeeeef;">${rows.map(([label, v]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eeeeef;font-size:14px;color:#71717a;width:42%;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #eeeeef;font-size:14px;color:#111111;font-weight:600;">${v}</td></tr>`).join('')}</table>` : ''}
${quote ? `<div style="margin:6px 0 18px;padding:14px 16px;border-left:3px solid ${b.accent};background:#fafafa;font-size:14px;line-height:1.6;color:#3f3f46;">${quote}</div>` : ''}
${ctaUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px;"><tr><td style="background:${b.primary};border-radius:8px;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 26px;font-size:15px;font-weight:600;color:${b.onPrimary};text-decoration:none;">${escapeHtml(tpl.cta.label)}</a></td></tr></table>` : ''}
${note ? `<p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#71717a;">${note}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 36px;background:#fafafa;border-top:1px solid #eeeeef;font-size:12px;line-height:1.7;color:#71717a;text-align:center;">
<strong style="color:#3f3f46;">${escapeHtml(b.name)}</strong>${b.address ? `<br>${escapeHtml(b.address)}` : ''}
${[b.phone, b.email].filter(Boolean).length ? `<br>${[b.phone, b.email].filter(Boolean).map(escapeHtml).join(' · ')}` : ''}
${b.siteUrl ? `<br><a href="${escapeHtml(b.siteUrl)}" style="color:#71717a;">${escapeHtml(b.siteUrl.replace(/^https?:\/\//, ''))}</a>` : ''}
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    tpl.title, '',
    ...paragraphs.map(stripTags),
    code ? `\n${stripTags(code)}\n` : '',
    list ? stripTags(list.replace(/<li>/g, '\n- ')) : '',
    ...rows.map(([label, v]) => `${label} : ${stripTags(v)}`),
    quote ? `\n« ${stripTags(quote)} »` : '',
    ctaUrl ? `\n${tpl.cta.label} : ${ctaUrl}` : '',
    note ? `\n${stripTags(note)}` : '',
    '', '—', b.name, b.address, [b.phone, b.email].filter(Boolean).join(' · '),
  ].filter((l) => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject, html, text };
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/* ───────────────────────── Envoi ───────────────────────── */

export class InstituteSendError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Expédie un message déjà rendu par l'API transactionnelle Brevo de l'institut.
 * `deliveryId` voyage dans `X-Mailin-custom` : Brevo le rend dans chaque
 * événement du webhook, ce qui rapproche même un événement arrivé avant la
 * réponse de l'envoi.
 */
export async function sendViaInstituteBrevo({ sender, recipient, rendered, replyTo, deliveryId, templateId, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl(`${BREVO_API}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': sender.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender.email, ...(sender.name ? { name: sender.name } : {}) },
        to: [{ email: recipient.email, ...(recipient.name ? { name: recipient.name } : {}) }],
        subject: rendered.subject,
        htmlContent: rendered.html,
        textContent: rendered.text,
        ...(replyTo?.email ? { replyTo: { email: replyTo.email } } : {}),
        headers: { 'X-Mailin-custom': deliveryId },
        tags: ['institut', templateId],
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // Délai dépassé : Brevo a peut-être accepté. On ne rejoue pas un doute
    // (un doublon arrive chez une vraie cliente) ; un refus de connexion, lui,
    // n'a rien envoyé.
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new InstituteSendError(timeout ? 'INSTITUTE_SEND_TIMEOUT' : 'INSTITUTE_PROVIDER_UNREACHABLE',
      timeout ? 'Brevo n’a pas répondu à temps : l’e-mail est peut-être parti. Aucun renvoi automatique.' : 'Brevo est injoignable pour le moment.',
      !timeout);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    const message = res.status === 401
      ? 'Brevo refuse la clé API de l’institut. Vérifiez-la dans « Clés API ».'
      : `Brevo a refusé l’envoi (${res.status}) : ${String(json.message || json.code || 'refus').slice(0, 200)}`;
    throw new InstituteSendError(res.status === 401 ? 'INSTITUTE_KEY_REJECTED' : 'INSTITUTE_PROVIDER_REFUSED', message, retryable);
  }
  return { messageId: normalizeProviderMessageId(json.messageId || (json.messageIds || [])[0] || '') };
}

/* ───────────────────────── Webhook de suivi ───────────────────────── */

function webhookBase() {
  return config.publicBackendUrl || config.publicUrl || '';
}

/**
 * Crée (une fois) le webhook transactionnel Brevo de l'institut. Un webhook
 * qui pointe déjà vers notre adresse est réutilisé : on n'en empile pas un par
 * enregistrement de clé. Une adresse locale (http://localhost) n'est pas
 * joignable par Brevo : rien n'est créé, et la raison est notée.
 */
export async function provisionInstituteBrevoWebhook({ fetchImpl = fetch } = {}) {
  const mode = activeMode();
  const prefix = `modes.${mode}`;
  const doc = await InstituteIntegration.findOne({ provider: INSTITUTE_PROVIDER });
  const slot = doc?.modes?.[mode];
  const apiKey = clear(slot?.secretKey);
  if (!apiKey) throw new Error('Renseignez d’abord la clé API Brevo.');
  const base = webhookBase();
  if (!/^https:\/\//i.test(base)) {
    await InstituteIntegration.updateOne({ provider: INSTITUTE_PROVIDER }, { $set: { [`${prefix}.webhookLastError`]: 'Adresse publique du site non joignable par Brevo (pas en https) : suivi de remise non créé.' } });
    return { created: false, reason: 'NOT_PUBLIC' };
  }
  let token = clear(slot?.webhookSecret);
  if (!token) token = crypto.randomBytes(24).toString('hex');
  const url = `${base}/api/webhooks/brevo-institute?token=${token}`;
  const urlPrefix = `${base}/api/webhooks/brevo-institute`;

  const headers = { 'api-key': apiKey, accept: 'application/json', 'content-type': 'application/json' };
  const listRes = await fetchImpl(`${BREVO_API}/webhooks?type=transactional`, { headers });
  const list = await listRes.json().catch(() => ({}));
  if (!listRes.ok) throw new Error(list.message || 'Brevo refuse la lecture des webhooks.');
  const existing = (list.webhooks || []).find((w) => String(w.url || '').startsWith(urlPrefix));

  let id = existing?.id;
  if (existing && existing.url !== url) {
    // Même adresse, ancien jeton : on la réaligne plutôt que d'en créer une seconde.
    const up = await fetchImpl(`${BREVO_API}/webhooks/${existing.id}`, { method: 'PUT', headers, body: JSON.stringify({ url, events: WEBHOOK_EVENTS, description: 'BeautySavage — suivi des e-mails clients' }) });
    if (!up.ok) throw new Error((await up.json().catch(() => ({}))).message || 'Brevo refuse la mise à jour du webhook.');
  } else if (!existing) {
    const created = await fetchImpl(`${BREVO_API}/webhooks`, { method: 'POST', headers, body: JSON.stringify({ url, events: WEBHOOK_EVENTS, type: 'transactional', description: 'BeautySavage — suivi des e-mails clients' }) });
    const body = await created.json().catch(() => ({}));
    if (!created.ok) throw new Error(body.message || 'Brevo refuse la création du webhook.');
    id = body.id;
  }

  await InstituteIntegration.updateOne({ provider: INSTITUTE_PROVIDER }, { $set: {
    [`${prefix}.webhookEndpointId`]: String(id || ''),
    [`${prefix}.webhookUrl`]: urlPrefix,
    [`${prefix}.webhookSecret`]: { encryptedValue: encryptSecret(token), lastFour: lastFourOf(token), verifiedAt: new Date() },
    [`${prefix}.webhookLastProvisionedAt`]: new Date(),
    [`${prefix}.webhookLastError`]: '',
  } });
  return { created: !existing, reused: Boolean(existing), id };
}

/** Le jeton de l'URL est-il celui du webhook de l'institut ? (comparaison à temps constant) */
export async function verifyInstituteBrevoToken(token) {
  const doc = await InstituteIntegration.findOne({ provider: INSTITUTE_PROVIDER }).lean();
  const expected = clear(doc?.modes?.[activeMode()]?.webhookSecret);
  const given = String(token || '');
  if (!expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Applique un événement Brevo (ou un lot) aux livraisons de l'institut. Même
 * règle de transition que le suivi historique : seul `delivered` prouve une
 * remise, une ouverture n'est qu'un signal d'engagement.
 */
export async function applyInstituteBrevoEvents(body) {
  const events = Array.isArray(body) ? body : [body];
  const out = [];
  for (const e of events) {
    const { normalized } = normalizeBrevoEvent(e?.event);
    if (!normalized) { out.push({ applied: false, reason: 'EVENT_UNKNOWN' }); continue; }
    const deliveryId = String(e['X-Mailin-custom'] || e['x-mailin-custom'] || '').trim();
    const messageId = normalizeProviderMessageId(e['message-id'] || e.messageId || '');
    let delivery = deliveryId ? await EmailDelivery.findOne({ deliveryId, provider: INSTITUTE_PROVIDER }) : null;
    if (!delivery && messageId) delivery = await EmailDelivery.findOne({ providerMessageId: messageId, provider: INSTITUTE_PROVIDER });
    if (!delivery) { out.push({ applied: false, reason: 'DELIVERY_NOT_FOUND' }); continue; }

    const occurredAt = e.ts_event ? new Date(Number(e.ts_event) * 1000) : (e.date ? new Date(e.date) : null);
    const at = occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null;
    const webhookEventId = ['institut', delivery.deliveryId, e.event, e.ts_event || e.date || '', e.id || ''].join(':');
    if (await EmailDeliveryEvent.findOne({ webhookEventId }).lean()) { out.push({ applied: false, reason: 'ALREADY_APPLIED' }); continue; }

    const decision = applyBrevoEventToDelivery({ currentStatus: delivery.status, engagement: delivery.engagement, normalizedEvent: normalized, occurredAt: at });
    if (decision.kind !== 'NOOP') {
      delivery.status = decision.statusAfter;
      delivery.engagement = decision.engagement;
    }
    if (decision.setDeliveredAt && !delivery.deliveredAt) delivery.deliveredAt = at || new Date();
    await delivery.save();
    await EmailDeliveryEvent.create({
      deliveryId: delivery.deliveryId, webhookEventId, type: normalized, occurredAt: at || new Date(),
      statusBefore: decision.statusBefore, statusAfter: decision.statusAfter,
    }).catch(() => {});
    logger.info(`[email-institut] ${delivery.deliveryId} (${maskEmail(e.email || '')}) : ${decision.statusBefore} → ${decision.statusAfter} (${e.event}).`);
    out.push({ applied: decision.kind !== 'NOOP', status: delivery.status });
  }
  return out;
}

export default {
  instituteBrevoSender, shouldSendAsInstitute, renderInstituteEmail, sendViaInstituteBrevo,
  provisionInstituteBrevoWebhook, verifyInstituteBrevoToken, applyInstituteBrevoEvents,
};
