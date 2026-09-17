const SITE_STATUS_ENDPOINT = '/api/site-status';
const THEME_ENDPOINT = '/api/vitrine/theme';

const THEME_DEFAULTS = {
  primary: '#5f4ff7',
  secondary: '#f24692',
  background: '#f5f4ef',
  surface: '#ffffff',
  text: '#0f172a'
};

function sanitizeThemeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function resolveDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...THEME_DEFAULTS, ...colors };
  const accent =
    sanitizeThemeColor(overrides.accent) ||
    `color-mix(in oklab, ${palette.primary} 70%, ${palette.secondary} 30%)`;
  const accentStrong =
    sanitizeThemeColor(overrides.accentStrong) ||
    `color-mix(in oklab, ${palette.primary} 45%, ${palette.secondary} 55%)`;
  return { accent, accentStrong };
}

function applyTheme(theme) {
  const colors = { ...THEME_DEFAULTS, ...(theme?.colors || {}) };
  const derived = resolveDerivedTokens(colors, theme?.derivedTokens || {});
  const root = document.documentElement;
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--theme-accent', derived.accent);
  root.style.setProperty('--theme-accent-strong', derived.accentStrong);
}

function normalizeStatus(value) {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'maintenance') return 'maintenance';
  if (candidate === 'suspended') return 'suspended';
  return 'active';
}

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateMetaField(selector, label, value) {
  const node = document.querySelector(selector);
  if (!node) return;
  const safeValue = String(value || '').trim();
  if (!safeValue) {
    node.hidden = true;
    node.textContent = '';
    return;
  }
  node.hidden = false;
  node.textContent = `${label} ${safeValue}`;
}

async function loadTheme() {
  try {
    const response = await fetch(THEME_ENDPOINT, { credentials: 'include' });
    if (!response.ok) return;
    const payload = await response.json().catch(() => ({}));
    applyTheme(payload?.theme || null);
  } catch (error) {
    console.error('Erreur chargement theme maintenance', error);
  }
}

async function loadMaintenanceStatus() {
  try {
    const response = await fetch(SITE_STATUS_ENDPOINT, { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    const status = normalizeStatus(payload?.status);
    if (status !== 'maintenance') {
      window.location.replace('/vitrine.html');
      return;
    }
    updateMetaField('[data-maintenance-reason]', 'Motif :', payload?.reason);
    updateMetaField('[data-maintenance-eta]', 'Duree estimee :', payload?.eta);
    updateMetaField(
      '[data-maintenance-started]',
      'Début :',
      formatDate(payload?.startedAt)
    );
  } catch (error) {
    console.error('Erreur chargement maintenance', error);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme();
  await loadMaintenanceStatus();
});
