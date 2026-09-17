// services/mail/mailRenderer.js
// Sprint F3B — Split de mailService (extraction PUREMENT STRUCTURELLE, comportement
// identique). Bloc déplacé verbatim depuis services/mailService.js ; seuls les imports/exports
// et les chemins des imports dynamiques ont été adaptés au nouvel emplacement.

import Theme from '../../models/Theme.js';

const MAIL_THEME = Object.freeze({
  surfaceHeader: '#201535',
  accent: '#7c3aed',
  accentStrong: '#f24692',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#5b6475',
  border: '#e7def8',
  soft: '#faf7ff',
  softAlt: '#fff4fb',
  white: '#ffffff',
  dark: '#140d24'
});

function joinHtml(parts = []) {
  return parts.filter(Boolean).join('');
}

function buildThemeStyle(property, fallback, token, cssVarName = '') {
  void cssVarName;
  return `${property}:${fallback};${property}:{{${token}}};`;
}

function buildTextParagraphs(paragraphs = []) {
  return paragraphs
    .filter(Boolean)
    .map(paragraph => `<p>${paragraph}</p>`)
    .join('');
}

function buildTextDetailLines(items = []) {
  return items
    .filter(item => item?.label && item?.value !== undefined && item?.value !== null && item?.value !== '')
    .map(item => `<p><strong>${item.label} :</strong> ${item.value}</p>`)
    .join('');
}

function buildPremiumParagraphs(paragraphs = []) {
  return paragraphs
    .filter(Boolean)
    .map(
      paragraph => `<p style="margin:0 0 16px;font-size:16px;line-height:1.72;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}">${paragraph}</p>`
    )
    .join('');
}

function buildPremiumDetailRows(items = []) {
  const rows = items
    .filter(item => item?.label && item?.value !== undefined && item?.value !== null && item?.value !== '')
    .map(
      item => `<tr>
        <td style="padding:0 0 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:18px 20px;border:1px solid ${MAIL_THEME.border};border-radius:18px;background:${MAIL_THEME.soft};">
                <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${MAIL_THEME.accentStrong};${buildThemeStyle('color', MAIL_THEME.accentStrong, 'themeaccentstrong', 'theme-accent-strong')}font-weight:700;">${item.label}</p>
                <p style="margin:0;font-size:16px;line-height:1.55;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}font-weight:600;">${item.value}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
    )
    .join('');

  if (!rows) return '';

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;">${rows}</table>`;
}

function buildPremiumCallout({ label = '', content = '', tone = 'default' } = {}) {
  if (!content) return '';

  const tones = {
    default: {
      background: MAIL_THEME.soft,
      border: MAIL_THEME.accent,
      label: MAIL_THEME.accentStrong
    },
    accent: {
      background: MAIL_THEME.softAlt,
      border: MAIL_THEME.accent,
      label: MAIL_THEME.accentStrong
    },
    warning: {
      background: '#fff7ed',
      border: '#f59e0b',
      label: '#b45309'
    },
    danger: {
      background: '#fff1f2',
      border: '#e11d48',
      label: '#be123c'
    },
    success: {
      background: '#ecfdf3',
      border: '#16a34a',
      label: '#15803d'
    }
  };

  const palette = tones[tone] || tones.default;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;">
    <tr>
      <td style="padding:18px 20px;border:1px solid ${palette.border};border-radius:20px;background:${palette.background};">
        ${label
          ? `<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:${palette.label};font-weight:700;">${label}</p>`
          : ''}
        <div style="font-size:15px;line-height:1.7;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}">${content}</div>
      </td>
    </tr>
  </table>`;
}

function buildPremiumButton({ label = '', url = '' } = {}) {
  if (!label || !url) return '';

  return `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 28px;">
    <tr>
      <td align="center" style="border-radius:999px;background:${MAIL_THEME.accent};${buildThemeStyle('background', MAIL_THEME.accent, 'themeaccent', 'theme-accent')}">
        <a href="${url}" style="display:inline-block;padding:15px 28px;border-radius:999px;background:${MAIL_THEME.accent};${buildThemeStyle('background', MAIL_THEME.accent, 'themeaccent', 'theme-accent')}color:${MAIL_THEME.white};${buildThemeStyle('color', MAIL_THEME.white, 'colorsurface', 'color-surface')}text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.02em;">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}

function buildPremiumMailTemplate({
  siteName = 'Beauty Savage',
  eyebrow = '',
  title = '',
  intro = '',
  paragraphs = [],
  detailItems = [],
  callout = null,
  cta = null,
  footnote = '',
  signature = ''
} = {}) {
  const currentYear = new Date().getFullYear();

  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;${buildThemeStyle('background', MAIL_THEME.surface, 'colorsurface', 'color-surface')}font-family:Inter,Segoe UI,Arial,sans-serif;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${title}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;${buildThemeStyle('background', MAIL_THEME.surface, 'colorsurface', 'color-surface')}">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;max-width:680px;">
            <tr>
              <td style="padding:0 0 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="height:8px;border-radius:999px 0 0 999px;background:${MAIL_THEME.accentStrong};${buildThemeStyle('background', MAIL_THEME.accentStrong, 'themeaccentstrong', 'theme-accent-strong')}font-size:0;line-height:0;">&nbsp;</td>
                    <td style="width:28%;height:8px;border-radius:0 999px 999px 0;background:${MAIL_THEME.accent};${buildThemeStyle('background', MAIL_THEME.accent, 'themeaccent', 'theme-accent')}font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-radius:28px;border:1px solid ${MAIL_THEME.border};background:${MAIL_THEME.surface};${buildThemeStyle('background', MAIL_THEME.surface, 'colorsurface', 'color-surface')}box-shadow:0 24px 50px rgba(15,23,42,0.08);overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:28px 28px 18px;background:${MAIL_THEME.surfaceHeader};${buildThemeStyle('background', MAIL_THEME.surfaceHeader, 'themesurfaceheader', 'theme-surface-header')}color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}">
                      <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}opacity:0.74;">${siteName}</p>
                      ${eyebrow
                        ? `<p style="margin:0 0 10px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:${MAIL_THEME.accent};${buildThemeStyle('color', MAIL_THEME.accent, 'themeaccent', 'theme-accent')}font-weight:700;">${eyebrow}</p>`
                        : ''}
                      <h1 style="margin:0;font-size:31px;line-height:1.14;color:${MAIL_THEME.accentStrong};${buildThemeStyle('color', MAIL_THEME.accentStrong, 'themeaccentstrong', 'theme-accent-strong')}font-weight:700;">${title}</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:30px 28px 28px;">
                      ${intro
                        ? `<p style="margin:0 0 18px;font-size:17px;line-height:1.7;color:${MAIL_THEME.text};${buildThemeStyle('color', MAIL_THEME.text, 'colortext', 'color-text')}font-weight:600;">${intro}</p>`
                        : ''}
                      ${buildPremiumParagraphs(paragraphs)}
                      ${buildPremiumDetailRows(detailItems)}
                      ${callout ? buildPremiumCallout(callout) : ''}
                      ${cta ? buildPremiumButton(cta) : ''}
                      ${footnote
                        ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:${MAIL_THEME.muted};">${footnote}</p>`
                        : ''}
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px;">
                        <tr>
                          <td style="padding-top:18px;border-top:1px solid ${MAIL_THEME.border};font-size:13px;line-height:1.7;color:${MAIL_THEME.muted};">
                            ${signature || siteName}<br />
                            ${currentYear}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function createMailTemplateDefinition({
  subject,
  siteName = 'Beauty Savage',
  eyebrow = '',
  title = '',
  intro = '',
  paragraphs = [],
  detailItems = [],
  callout = null,
  cta = null,
  footnote = '',
  signature = ''
} = {}) {
  return {
    subject,
    bodyHtml: joinHtml([
      intro ? `<p>${intro}</p>` : '',
      buildTextParagraphs(paragraphs),
      buildTextDetailLines(detailItems),
      cta?.url ? `<p><a href="${cta.url}">${cta.label || 'Ouvrir le lien'}</a></p>` : '',
      footnote ? `<p>${footnote}</p>` : '',
      `<p>${signature || siteName}</p>`
    ]),
    fullHtml: buildPremiumMailTemplate({
      siteName,
      eyebrow,
      title,
      intro,
      paragraphs,
      detailItems,
      callout,
      cta,
      footnote,
      signature
    }),
    mode: 'html'
  };
}

// Guardrail: keep HTML/mail templates in template literals (`...`) only.

const VARIABLE_KEYS = new Set([
  'saleid',
  'firstname',
  'lastname',
  'amount',
  'link',
  'invoicedownloadurl',
  'invoicepageurl',
  'period',
  'reason',
  'eta',
  'date',
  'startedat',
  'endedat',
  'email',
  'customername',
  'clientemail',
  'code',
  'expiresminutes',
  'sitename',
  'institutename',
  'formationtitle',
  'formationname',
  'productname',
  'sessiondatelabel',
  'sessiontimelabel',
  'sessiondate',
  'sessiontime',
  'sessiondatetime',
  'actionurl',
  'autorefunddays',
  'amountpaid',
  'refundamount',
  'refundstatus',
  'refunddatetime',
  'refundid',
  'giftcardcode',
  'giftcardpassword',
  'giftcardbalance',
  'refundedatformatted',
  'trackingurl',
  'year',
  'daysleft',
  'daystotal',
  'platformurl',
  'themesurfaceheader',
  'themeaccent',
  'themeaccentstrong',
  'colortext',
  'colorsurface',
  'themeprimary',
  'themesecondary',
  'themebackground',
  'themesurface',
  'themetext',
  'servicename',
  'bookingdate',
  'bookingtime',
  'bookingdatetime',
  'practitionername',
  'cancellationdays',
  'timelabel',
  'bookingid',
  'depositamount',
  'remainingamount',
  'paymenttype',
  'eligiblerefund',
  'noshowcount',
  'suspensionthreshold',
  'refundreason',
  'refundsection',
  'itemdetail',
  'oldbookingdate',
  'oldbookingtime',
  'newbookingdate',
  'newbookingtime',
  'clientname',
  // LOT2 — variables jusqu'ici absentes de l'allowlist (rendues littérales dans les corps mail
  // carte cadeau / leçon) + variables des nouvelles communications.
  'recipientname',
  'purchasername',
  'pin',
  'message',
  'balance',
  'paymentlabel',
  'transactionreason',
  'cardlink',
  'lessonname',
  'location',
  'linklabel'
]);

const ALLOWED_MODES = new Set(['text', 'html']);

// P0-1 — Variables dont la valeur est intentionnellement du HTML/CSS/URL et NE DOIT PAS être
// échappée en mode HTML : URLs (href/src), valeurs de couleur/thème (attributs style), et fragments
// HTML pré-construits côté serveur (ex. refundsection). Toutes les autres valeurs (noms clients,
// e-mails, libellés, montants…) sont échappées à l'interpolation HTML pour neutraliser l'injection.
const RAW_HTML_VARIABLE_KEYS = new Set([
  'link',
  'invoicedownloadurl',
  'invoicepageurl',
  'actionurl',
  'trackingurl',
  'platformurl',
  'themesurfaceheader',
  'themeaccent',
  'themeaccentstrong',
  'colortext',
  'colorsurface',
  'themeprimary',
  'themesecondary',
  'themebackground',
  'themesurface',
  'themetext',
  'refundsection',
  'cardlink'
]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// P0-2 — Masque une adresse e-mail pour les logs serveur (jamais l'adresse complète en clair).
// `jean.dupont@gmail.com` → `j***@gmail.com`. Accepte une string ou un destinataire Brevo {email}.
function maskEmail(value) {
  const str = String((value && value.email) || value || '').trim();
  const at = str.indexOf('@');
  if (at <= 0) return str ? '[masqué]' : '';
  return `${str.slice(0, 1)}***@${str.slice(at + 1)}`;
}



function normalizeFunctionName(value) {

  if (!value) return null;

  const candidate = String(value || '').trim().toLowerCase();

  return candidate || null;

}



function normalizeMode(value) {

  if (!value) return 'text';

  const candidate = String(value).trim().toLowerCase();

  return ALLOWED_MODES.has(candidate) ? candidate : 'text';

}



function formatAmount(value) {

  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;

  return new Intl.NumberFormat('fr-FR', {

    minimumFractionDigits: 2,

    maximumFractionDigits: 2

  }).format(amount);

}

function clampColorChannel(value) {

  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

}

function normalizeHexColor(value) {

  const candidate = String(value || '').trim();

  const shortMatch = candidate.match(/^#([0-9a-f]{3})$/i);

  if (shortMatch) {

    return `#${shortMatch[1].split('').map(char => `${char}${char}`).join('')}`.toLowerCase();

  }

  const longMatch = candidate.match(/^#([0-9a-f]{6})$/i);

  if (longMatch) {

    return `#${longMatch[1].toLowerCase()}`;

  }

  return null;

}

function hexToRgb(value) {

  const normalized = normalizeHexColor(value);

  if (!normalized) return null;

  return {

    r: parseInt(normalized.slice(1, 3), 16),

    g: parseInt(normalized.slice(3, 5), 16),

    b: parseInt(normalized.slice(5, 7), 16)

  };

}

function rgbToHex({ r = 0, g = 0, b = 0 } = {}) {

  return `#${[r, g, b]
    .map(channel => clampColorChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

}

function mixHexColors(first, firstWeight, second, secondWeight) {

  const firstRgb = hexToRgb(first);

  const secondRgb = hexToRgb(second);

  if (!firstRgb || !secondRgb) return null;

  const total = Number(firstWeight || 0) + Number(secondWeight || 0) || 100;

  const firstRatio = Number(firstWeight || 0) / total;

  const secondRatio = Number(secondWeight || 0) / total;

  return rgbToHex({

    r: (firstRgb.r * firstRatio) + (secondRgb.r * secondRatio),

    g: (firstRgb.g * firstRatio) + (secondRgb.g * secondRatio),

    b: (firstRgb.b * firstRatio) + (secondRgb.b * secondRatio)

  });

}

function resolveThemeColorReference(value = '', colors = {}) {

  const candidate = String(value || '').trim();

  const normalizedHex = normalizeHexColor(candidate);

  if (normalizedHex) return normalizedHex;

  return normalizeHexColor(colors[candidate]) || normalizeHexColor(MAIL_THEME[candidate]) || null;

}

function resolveColorMixExpression(value = '', colors = {}) {

  const candidate = String(value || '').trim();

  const match = candidate.match(
    /^color-mix\(\s*in\s+[a-z0-9-]+\s*,\s*([^,]+?)\s+([0-9.]+)%\s*,\s*([^)]+?)\s+([0-9.]+)%\s*\)$/i
  );

  if (!match) return null;

  const first = resolveThemeColorReference(match[1], colors);

  const second = resolveThemeColorReference(match[3], colors);

  if (!first || !second) return null;

  return mixHexColors(first, Number(match[2]), second, Number(match[4]));

}

function resolveEmailColor(value = '', fallback = '', colors = {}) {

  const normalizedHex = normalizeHexColor(value);

  if (normalizedHex) return normalizedHex;

  const mixedColor = resolveColorMixExpression(value, colors);

  if (mixedColor) return mixedColor;

  const fallbackHex = normalizeHexColor(fallback);

  if (fallbackHex) return fallbackHex;

  return String(fallback || value || '').trim() || MAIL_THEME.text;

}

function resolveDefaultThemeDerivedTokens(colors = {}) {

  const primary = normalizeHexColor(colors.primary) || normalizeHexColor(MAIL_THEME.accent);

  const secondary = normalizeHexColor(colors.secondary) || normalizeHexColor(MAIL_THEME.accentStrong);

  const background = normalizeHexColor(colors.background) || normalizeHexColor(MAIL_THEME.surface);

  return {

    surfaceHeader:
      mixHexColors(primary, 26, background, 74) ||
      normalizeHexColor(MAIL_THEME.surfaceHeader) ||
      MAIL_THEME.surfaceHeader,

    accent:
      mixHexColors(primary, 70, secondary, 30) ||
      normalizeHexColor(MAIL_THEME.accent) ||
      MAIL_THEME.accent,

    accentStrong:
      mixHexColors(primary, 45, secondary, 55) ||
      normalizeHexColor(MAIL_THEME.accentStrong) ||
      MAIL_THEME.accentStrong

  };

}

async function getActiveMailThemeVars() {

  try {

    const theme = await Theme.findOne({ isActive: true }).lean();

    const colors = theme?.colors || {};

    const derivedTokens = theme?.derivedTokens || {};

    const defaultDerivedTokens = resolveDefaultThemeDerivedTokens(colors);

    const colorSurface = String(colors.surface || MAIL_THEME.surface);

    const colorText = String(colors.text || MAIL_THEME.text);

    const themeSurfaceHeader = resolveEmailColor(
      derivedTokens.surfaceHeader,
      defaultDerivedTokens.surfaceHeader,
      colors
    );

    const themeAccent = resolveEmailColor(
      derivedTokens.accent,
      defaultDerivedTokens.accent,
      colors
    );

    const themeAccentStrong = resolveEmailColor(
      derivedTokens.accentStrong,
      defaultDerivedTokens.accentStrong,
      colors
    );

    return {

      themesurfaceheader: themeSurfaceHeader,

      themeaccent: themeAccent,

      themeaccentstrong: themeAccentStrong,

      colortext: colorText,

      colorsurface: colorSurface,

      themeprimary: themeAccent,

      themesecondary: themeAccentStrong,

      themebackground: colorSurface,

      themesurface: colorSurface,

      themetext: colorText

    };

  } catch (error) {

    console.error('[mailService] Impossible de charger le theme actif pour les emails', error);

    return {

      themesurfaceheader: MAIL_THEME.surfaceHeader,

      themeaccent: MAIL_THEME.accent,

      themeaccentstrong: MAIL_THEME.accentStrong,

      colortext: MAIL_THEME.text,

      colorsurface: MAIL_THEME.surface,

      themeprimary: MAIL_THEME.accent,

      themesecondary: MAIL_THEME.accentStrong,

      themebackground: MAIL_THEME.surface,

      themesurface: MAIL_THEME.surface,

      themetext: MAIL_THEME.text

    };

  }

}

async function withMailThemeVars(values = {}) {

  const themeVars = await getActiveMailThemeVars();

  return {

    ...themeVars,

    ...(values || {})

  };

}



function sanitizeFullHtml(value) {

  if (!value) return '';

  let sanitized = String(value);

  sanitized = sanitized.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');

  sanitized = sanitized.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');

  sanitized = sanitized.replace(/<\s*(iframe|object|embed|link|meta|base)[\s\S]*?>[\s\S]*?<\/\1>/gi, '');

  sanitized = sanitized.replace(/<\s*(iframe|object|embed|link|meta|base)[^>]*?>/gi, '');

  sanitized = sanitized.replace(/\s(on[a-z]+)\s*=\s*(".*?"|'.*?'|[^>\s]*)/gi, '');

  sanitized = sanitized.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '');

  return sanitized.trim();

}



function stripHtml(value = '') {

  return String(value)

    .replace(/<[^>]+>/g, ' ')

    .replace(/\s+/g, ' ')

    .trim();

}



// P0-1 — `options.html === true` active l'échappement HTML des valeurs interpolées (sauf les clés
// listées dans RAW_HTML_VARIABLE_KEYS). Défaut = false : rendu identique à l'existant pour les
// contextes texte (sujet, corps texte), 100 % rétro-compatible.
function replaceTemplateVariables(content = '', replacements = {}, options = {}) {

  if (!content) return '';

  const escapeValues = Boolean(options && options.html);

  return String(content).replace(/{{\s*([a-zA-Z0-9]+)\s*}}/g, (match, key) => {

    const lowerKey = key.toLowerCase();

    if (!VARIABLE_KEYS.has(lowerKey)) {

      return match;

    }

    const raw = replacements[lowerKey];

    if (raw === undefined || raw === null) {

      return '';

    }

    const value = String(lowerKey === 'amount' ? formatAmount(raw) : raw);

    if (escapeValues && !RAW_HTML_VARIABLE_KEYS.has(lowerKey)) {

      return escapeHtml(value);

    }

    return value;

  });

}

export {
  MAIL_THEME,
  joinHtml,
  buildThemeStyle,
  buildTextParagraphs,
  buildTextDetailLines,
  buildPremiumParagraphs,
  buildPremiumDetailRows,
  buildPremiumCallout,
  buildPremiumButton,
  buildPremiumMailTemplate,
  createMailTemplateDefinition,
  VARIABLE_KEYS,
  ALLOWED_MODES,
  normalizeFunctionName,
  normalizeMode,
  formatAmount,
  clampColorChannel,
  normalizeHexColor,
  hexToRgb,
  rgbToHex,
  mixHexColors,
  resolveThemeColorReference,
  resolveColorMixExpression,
  resolveEmailColor,
  resolveDefaultThemeDerivedTokens,
  getActiveMailThemeVars,
  withMailThemeVars,
  sanitizeFullHtml,
  stripHtml,
  escapeHtml,
  maskEmail,
  replaceTemplateVariables
};
