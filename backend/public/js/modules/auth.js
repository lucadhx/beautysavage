import { showToast } from '../helpers/toastService.js';

import { updateSiteFavicon } from '../helpers/siteFavicon.js';

const API_ROOT = '/auth';
const RESEND_VERIFICATION_ENDPOINT = '/auth/resend-verification';
const SIGNUP_PAGE_URL = '/vitrine.html?page=signup';
const MY_ACCOUNT_PAGE_URL = '/vitrine.html?page=myaccount';
const INVOICE_CONTEXT = 'invoice';
const ACTIVE_THEME_ENDPOINT = '/api/vitrine/theme';
const SITE_IDENTITY_ENDPOINT = '/api/vitrine/site-identity';
const SITE_SUSPENDED_MESSAGE =
  "Le site est suspendu, l'accès administrateur est impossible jusqu'à réactivation.";
const SITE_MAINTENANCE_MESSAGE =
  'Le site est en maintenance, vous pourrez bientôt y accéder.';
const EMAIL_NOT_VERIFIED_MESSAGE = 'Email non confirmé. Vérifiez votre boîte mail.';

const THEME_DEFAULTS = {
  primary: '#5f4ff7',
  secondary: '#f24692',
  background: '#f5f4ef',
  surface: '#ffffff',
  text: '#0f172a'
};

let cachedUser = null;
let pendingVerificationEmail = '';
let resendCooldownTimer = null;
let resendCooldownSeconds = 0;

const loginContext = (() => {
  const params = new URLSearchParams(window.location.search);
  const context = (params.get('context') || '').trim().toLowerCase();
  const rawInvoiceId = params.get('invoiceId') || '';
  const invoiceId = rawInvoiceId.trim();
  return {
    type: context,
    invoiceId: invoiceId || null
  };
})();

function showError(container, message) {
  if (container) {
    container.textContent = message;
    container.setAttribute('aria-live', 'assertive');
  }
}

function sanitizeThemeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function resolveDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...THEME_DEFAULTS, ...colors };
  const surfaceHeader =
    sanitizeThemeColor(overrides.surfaceHeader) ||
    `color-mix(in oklab, ${palette.primary} 26%, ${palette.background} 74%)`;
  const accent =
    sanitizeThemeColor(overrides.accent) ||
    `color-mix(in oklab, ${palette.primary} 70%, ${palette.secondary} 30%)`;
  const accentStrong =
    sanitizeThemeColor(overrides.accentStrong) ||
    `color-mix(in oklab, ${palette.primary} 45%, ${palette.secondary} 55%)`;
  return { surfaceHeader, accent, accentStrong };
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
  root.style.setProperty('--theme-surface-header', derived.surfaceHeader);
  root.style.setProperty('--theme-accent', derived.accent);
  root.style.setProperty('--theme-accent-strong', derived.accentStrong);
}

function getBrandInitials(siteName) {
  const cleaned = String(siteName || '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim();
  if (!cleaned) return 'BS';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (!words.length) return 'BS';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase();
}

function applySiteIdentity(identity = {}) {
  const siteName = String(identity?.siteName || 'Beauty Savage').trim() || 'Beauty Savage';
  const logoUrl = String(identity?.logoUrlResolved || '').trim();
  updateSiteFavicon(logoUrl);
  const titleNode = document.querySelector('[data-login-site-name]');
  const logoNode = document.querySelector('[data-login-logo]');
  const fallbackNode = document.querySelector('[data-login-logo-fallback]');

  document.title = `Connexion - ${siteName}`;
  if (titleNode) {
    titleNode.textContent = siteName;
  }
  if (!logoNode || !fallbackNode) return;
  if (logoUrl) {
    logoNode.src = logoUrl;
    logoNode.alt = `Logo de ${siteName}`;
    logoNode.hidden = false;
    fallbackNode.hidden = true;
    fallbackNode.textContent = '';
    return;
  }
  logoNode.removeAttribute('src');
  logoNode.hidden = true;
  fallbackNode.textContent = getBrandInitials(siteName);
  fallbackNode.hidden = false;
}

async function hydrateLoginAppearance() {
  try {
    const [themeResponse, identityResponse] = await Promise.all([
      fetch(ACTIVE_THEME_ENDPOINT, { credentials: 'include' }),
      fetch(SITE_IDENTITY_ENDPOINT, { credentials: 'include' })
    ]);

    if (themeResponse.ok) {
      const themePayload = await themeResponse.json().catch(() => ({}));
      applyTheme(themePayload?.theme || null);
    } else {
      applyTheme(null);
    }

    if (identityResponse.ok) {
      const identityPayload = await identityResponse.json().catch(() => ({}));
      applySiteIdentity(identityPayload || {});
    } else {
      applySiteIdentity(null);
    }
  } catch (error) {
    console.error('Impossible de charger le theme ou l identite du login', error);
    applyTheme(null);
    applySiteIdentity(null);
  }
}

function getLoginResendButton() {
  return document.querySelector('[data-login-resend]');
}

function clearResendCooldown() {
  if (resendCooldownTimer) {
    clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
  }
  resendCooldownSeconds = 0;
}

function updateResendButtonLabel() {
  const button = getLoginResendButton();
  if (!button) return;
  if (resendCooldownSeconds > 0) {
    button.textContent = `Renvoyer le code (${resendCooldownSeconds}s)`;
  } else {
    button.textContent = 'Renvoyer le code de vérification';
  }
}

function setResendButtonVisible(visible) {
  const button = getLoginResendButton();
  if (!button) return;
  button.hidden = !visible;
}

function setResendButtonDisabled(disabled) {
  const button = getLoginResendButton();
  if (!button) return;
  button.disabled = Boolean(disabled || resendCooldownSeconds > 0);
}

function startResendCooldown(seconds) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Math.ceil(Number(seconds))) : 0;
  clearResendCooldown();
  resendCooldownSeconds = safeSeconds;
  updateResendButtonLabel();
  setResendButtonDisabled(false);
  if (resendCooldownSeconds <= 0) {
    return;
  }
  resendCooldownTimer = setInterval(() => {
    resendCooldownSeconds -= 1;
    if (resendCooldownSeconds <= 0) {
      clearResendCooldown();
      updateResendButtonLabel();
      setResendButtonDisabled(false);
      return;
    }
    updateResendButtonLabel();
    setResendButtonDisabled(false);
  }, 1000);
}

function isInvoiceContext() {
  return loginContext.type === INVOICE_CONTEXT && Boolean(loginContext.invoiceId);
}

function getInvoiceDownloadUrl() {
  if (!isInvoiceContext()) return null;
  return `/invoice/${encodeURIComponent(loginContext.invoiceId)}`;
}

function applySuspensionMessageFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const reason = String(params.get('reason') || '').trim().toLowerCase();
  if (!reason) return;
  const loginErrorNode = document.querySelector('[data-login-error]');
  if (reason === 'site-suspended') {
    showError(loginErrorNode, SITE_SUSPENDED_MESSAGE);
    return;
  }
  if (reason === 'site-maintenance') {
    showError(loginErrorNode, SITE_MAINTENANCE_MESSAGE);
  }
}

function applyLoginContextMessaging() {
  const heading = document.querySelector('[data-login-context-heading]');
  const detail = document.querySelector('[data-login-context-subtext]');
  if (!isInvoiceContext()) {
    if (heading) heading.hidden = true;
    if (detail) detail.hidden = true;
    return;
  }
  if (heading) {
    heading.textContent = 'Connectez-vous pour télécharger votre facture';
    heading.hidden = false;
  }
  if (detail) {
    detail.textContent = 'Après connexion, votre facture sera téléchargée automatiquement.';
    detail.hidden = false;
  }
}

function redirectAuthenticatedLoginUser(user) {
  if (!user) return;
  if (isInvoiceContext()) {
    const downloadUrl = getInvoiceDownloadUrl();
    if (downloadUrl) {
      window.location.href = downloadUrl;
      return;
    }
  }
  window.location.href = MY_ACCOUNT_PAGE_URL;
}

async function handleResendVerification(errorNode) {
  const button = getLoginResendButton();
  const emailField = document.getElementById('email');
  const candidateEmail = String(pendingVerificationEmail || emailField?.value || '').trim().toLowerCase();
  if (!candidateEmail) {
    showError(errorNode, 'Saisissez votre email pour renvoyer un code.');
    return;
  }

  setResendButtonDisabled(true);
  try {
    const response = await fetch(RESEND_VERIFICATION_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: candidateEmail })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body?.code === 'VERIFICATION_RESEND_THROTTLED') {
        const retryAfter = Number(body?.retryAfterSeconds || 0);
        startResendCooldown(retryAfter);
        showError(errorNode, body?.error || `Attendez ${retryAfter}s avant de renvoyer le code.`);
        return;
      }
      showError(errorNode, body?.error || 'Impossible de renvoyer le code.');
      return;
    }

    pendingVerificationEmail = candidateEmail;
    showError(errorNode, 'Nouveau code envoye. Verifiez votre email.');
    startResendCooldown(body?.resendAfterSeconds || 30);
    showToast({ type: 'success', message: 'Code renvoye', durationMs: 1000 });
  } catch (error) {
    console.error(error);
    showError(errorNode, 'Impossible de contacter le serveur.');
  } finally {
    setResendButtonDisabled(false);
  }
}

async function handleLogin(form) {
  const errorNode = form.querySelector('[data-login-error]');
  showError(errorNode, '');
  const formData = new FormData(form);
  const payload = {
    email: formData.get('email') || '',
    password: formData.get('password') || ''
  };
  try {
    const response = await fetch(`${API_ROOT}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body?.code === 'SITE_SUSPENDED_ADMIN_LOGIN') {
        setResendButtonVisible(false);
        clearResendCooldown();
        return showError(errorNode, SITE_SUSPENDED_MESSAGE);
      }
      if (body?.code === 'SITE_MAINTENANCE_LOGIN') {
        setResendButtonVisible(false);
        clearResendCooldown();
        return showError(errorNode, SITE_MAINTENANCE_MESSAGE);
      }
      if (body?.code === 'EMAIL_NOT_VERIFIED') {
        pendingVerificationEmail = String(body?.email || payload.email || '').trim().toLowerCase();
        setResendButtonVisible(true);
        updateResendButtonLabel();
        startResendCooldown(body?.retryAfterSeconds || 0);
        return showError(errorNode, body?.error || EMAIL_NOT_VERIFIED_MESSAGE);
      }
      setResendButtonVisible(false);
      clearResendCooldown();
      return showError(errorNode, body?.error || 'Impossible de se connecter.');
    }

    pendingVerificationEmail = '';
    clearResendCooldown();
    setResendButtonVisible(false);
    cachedUser = {
      role: body.role,
      currentMode: body.currentMode
    };
    updateModeToggle(cachedUser);
    if (isInvoiceContext()) {
      const downloadUrl = getInvoiceDownloadUrl();
      if (downloadUrl) {
        window.location.href = downloadUrl;
        return;
      }
    }
    const nextUrl = new URLSearchParams(window.location.search).get('next');
    const targetMode = body.currentMode === 'gestion' ? '/gestion.html' : '/vitrine.html';
    window.location.href = nextUrl || targetMode;
  } catch (error) {
    console.error(error);
    showError(errorNode, "Impossible d'atteindre le serveur.");
  }
}

async function refreshDevBootstrapSection() {
  const section = document.querySelector('[data-dev-bootstrap-section]');
  if (!section) return;
  try {
    const response = await fetch('/auth/dev-bootstrap/status', { cache: 'no-store', credentials: 'include' });
    if (!response.ok) return;
    const body = await response.json().catch(() => ({ devExists: true }));
    section.hidden = Boolean(body.devExists);
  } catch (error) {
    console.error(error);
  }
}

function updateModeToggle(user) {
  const isPrivileged = user && ['admin', 'dev'].includes(user.role);
  const switchRoots = document.querySelectorAll('[data-mode-switch]');
  switchRoots.forEach(switchRoot => {
    switchRoot.hidden = !isPrivileged;
    if (!isPrivileged) return;
    const activeMode = user.currentMode === 'gestion' ? 'gestion' : 'vitrine';
    switchRoot.dataset.activeMode = activeMode;
    switchRoot.querySelectorAll('[data-mode-option]').forEach(option => {
      const isActive = option.dataset.modeOption === activeMode;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      option.disabled = isActive;
    });
  });
  if (!isPrivileged) return;
  cachedUser = user;
}

async function toggleMode(trigger) {
  if (!trigger) return;
  trigger.disabled = true;
  try {
    const response = await fetch('/api/mode/toggle', { method: 'POST', credentials: 'include' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 503 && body?.code === 'MAINTENANCE') {
        window.location.href = '/maintenance';
        return;
      }
      console.error('Mode toggle failed', body?.error);
      return;
    }
    if (cachedUser) {
      cachedUser.currentMode = body.currentMode || cachedUser.currentMode;
    }
    updateModeToggle(cachedUser);
    if (body.currentMode === 'gestion' && window.location.pathname !== '/gestion.html') {
      window.location.href = '/gestion.html';
    }
    if (body.currentMode === 'vitrine' && window.location.pathname === '/gestion.html') {
      window.location.href = '/vitrine.html';
    }
  } catch (error) {
    console.error(error);
  } finally {
    trigger.disabled = false;
  }
}

async function handleDevBootstrap(form) {
  const errorNode = form.querySelector('[data-dev-bootstrap-error]');
  showError(errorNode, '');
  const formData = new FormData(form);
  const payload = {
    email: formData.get('dev-email') || '',
    password: formData.get('dev-password') || '',
    role: 'dev'
  };
  try {
    const response = await fetch('/auth/dev-bootstrap', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return showError(errorNode, body?.error || 'Impossible de créer le compte développeur.');
    }
    showError(errorNode, 'Compte développeur créé. Connectez-vous avec vos identifiants.');
    form.reset();
    await refreshDevBootstrapSection();
  } catch (error) {
    console.error(error);
    showError(errorNode, 'Impossible de créer le compte développeur.');
  }
}

async function handleLogout() {
  try {
    const response = await fetch(`${API_ROOT}/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    if (response.ok) {
      window.location.href = '/login.html';
    }
  } catch (error) {
    console.error(error);
  }
}

async function fetchUserState({ redirect = false } = {}) {
  try {
    const response = await fetch(`${API_ROOT}/me`, { credentials: 'include' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 && payload?.code === 'MAINTENANCE') {
        if (window.location.pathname !== '/login.html') {
          window.location.href = '/maintenance';
          return null;
        }
        const loginErrorNode = document.querySelector('[data-login-error]');
        showError(loginErrorNode, payload?.message || SITE_MAINTENANCE_MESSAGE);
        return null;
      }
      if (payload?.code === 'MAINTENANCE') {
        if (window.location.pathname !== '/login.html') {
          window.location.href = '/maintenance';
          return null;
        }
        const loginErrorNode = document.querySelector('[data-login-error]');
        showError(loginErrorNode, payload?.message || SITE_MAINTENANCE_MESSAGE);
        return null;
      }
      if (payload?.code === 'SUSPENDED_ADMIN_LOGOUT') {
        if (window.location.pathname !== '/login.html') {
          window.location.href = '/login.html?reason=site-suspended';
          return null;
        }
        const loginErrorNode = document.querySelector('[data-login-error]');
        showError(loginErrorNode, payload?.message || SITE_SUSPENDED_MESSAGE);
      }
      if (redirect) window.location.href = '/login.html';
      return null;
    }
    const body = await response.json().catch(() => ({}));
    const user = body.user || null;
    if (user) {
      cachedUser = user;
    }
    return user;
  } catch (error) {
    console.error(error);
    if (redirect) window.location.href = '/login.html';
    return null;
  }
}

async function hydrateUserInfo(target) {
  const user = await fetchUserState({ redirect: true });
  if (!user) return;
  target.textContent = user.email || 'Utilisateur';
  updateModeToggle(user);
}

document.addEventListener('DOMContentLoaded', async () => {
  await hydrateLoginAppearance();

  const loginForm = document.querySelector('[data-login-form]');
  const loginErrorNode = document.querySelector('[data-login-error]');
  const resendButton = getLoginResendButton();
  const createAccountLink = document.querySelector(`a[href="${SIGNUP_PAGE_URL}"]`);

  if (createAccountLink) {
    createAccountLink.hidden = false;
  }

  if (loginForm) {
    setResendButtonVisible(false);
    updateResendButtonLabel();
    loginForm.addEventListener('submit', event => {
      event.preventDefault();
      handleLogin(loginForm);
    });
    if (resendButton) {
      resendButton.addEventListener('click', event => {
        event.preventDefault();
        handleResendVerification(loginErrorNode);
      });
    }
    fetchUserState().then(user => {
      if (user) {
        redirectAuthenticatedLoginUser(user);
      }
    });
  }

  const logoutButton = document.querySelector('[data-logout]');
  if (logoutButton) {
    logoutButton.addEventListener('click', event => {
      event.preventDefault();
      handleLogout();
    });
  }

  const userEmailNode = document.querySelector('[data-user-email]');
  if (userEmailNode) {
    hydrateUserInfo(userEmailNode);
  }

  const devBootstrapForm = document.querySelector('[data-dev-bootstrap-form]');
  if (devBootstrapForm) {
    devBootstrapForm.addEventListener('submit', event => {
      event.preventDefault();
      handleDevBootstrap(devBootstrapForm);
    });
  }

  const modeSwitches = document.querySelectorAll('[data-mode-switch]');
  if (modeSwitches.length) {
    fetchUserState().then(user => updateModeToggle(user));
    modeSwitches.forEach(modeSwitch => {
      modeSwitch.addEventListener('click', event => {
        const option = event.target.closest('[data-mode-option]');
        if (!option || option.disabled) return;
        event.preventDefault();
        toggleMode(option);
      });
    });
  }

  refreshDevBootstrapSection();
  applyLoginContextMessaging();
  applySuspensionMessageFromQuery();

  window.addEventListener('beforeunload', () => {
    clearResendCooldown();
  });
});
