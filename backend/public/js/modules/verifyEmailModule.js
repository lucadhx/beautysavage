import { showToast } from '../helpers/toastService.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const VERIFY_ENDPOINT = '/auth/verify-email';
const RESEND_ENDPOINT = '/auth/resend-verification';
const LOGIN_PAGE_URL = '/login.html';
const MY_ACCOUNT_PAGE_URL = '/vitrine.html?page=myaccount';
const DEFAULT_RESEND_SECONDS = 30;

let resendTimer = null;
let resendSecondsRemaining = 0;

function buildLoaderMarkup(label = 'Chargement...') {
  return `
    <div class="gcg-inline-loader auth-flow-loader" role="status" aria-live="polite">
      <div class="gcg-inline-loader__paws" aria-hidden="true">
        <span class="gcg-inline-loader__paw">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay">${PAW_ICON_SVG}</span>
        <span class="gcg-inline-loader__paw gcg-inline-loader__paw--delay-2">${PAW_ICON_SVG}</span>
      </div>
      <p class="gcg-inline-loader__label">${label}</p>
    </div>
  `;
}

function setFeedback(container, message = '', status = '') {
  if (!container) return;
  container.textContent = message;
  if (status) {
    container.dataset.status = status;
  } else {
    delete container.dataset.status;
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 6);
}

function clearResendTimer() {
  if (resendTimer) {
    clearInterval(resendTimer);
    resendTimer = null;
  }
  resendSecondsRemaining = 0;
}

function updateResendButton(button) {
  if (!button) return;
  if (resendSecondsRemaining > 0) {
    button.textContent = `Renvoyer (${resendSecondsRemaining}s)`;
    button.disabled = true;
  } else {
    button.textContent = 'Renvoyer le code';
    button.disabled = false;
  }
}

function startResendCountdown(button, seconds = DEFAULT_RESEND_SECONDS) {
  const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Math.ceil(Number(seconds))) : 0;
  clearResendTimer();
  resendSecondsRemaining = safeSeconds;
  updateResendButton(button);
  if (resendSecondsRemaining <= 0) return;
  resendTimer = setInterval(() => {
    resendSecondsRemaining -= 1;
    if (resendSecondsRemaining <= 0) {
      clearResendTimer();
      updateResendButton(button);
      return;
    }
    updateResendButton(button);
  }, 1000);
}

function setActionLoading(button, loading, idleLabel, loadingLabel) {
  if (!button) return;
  button.disabled = Boolean(loading);
  button.textContent = loading ? loadingLabel : idleLabel;
}

function setInlineLoader(container, active, label) {
  if (!container) return;
  container.hidden = !active;
  container.innerHTML = active ? buildLoaderMarkup(label) : '';
}

function resolveErrorMessage(payload = {}) {
  const code = String(payload?.code || '').trim();
  if (code === 'VERIFICATION_CODE_INVALID') return 'Code invalide.';
  if (code === 'VERIFICATION_CODE_EXPIRED') return 'Code expiré. Demandez un nouveau code.';
  if (code === 'VERIFICATION_TOO_MANY_ATTEMPTS') return 'Trop de tentatives. Renvoyez un nouveau code.';
  if (code === 'EMAIL_ALREADY_VERIFIED') return 'Email déjà confirmé. Connectez-vous.';
  return payload?.error || 'Vérification impossible.';
}

function renderMissingEmailState(container) {
  container.innerHTML = `
    <section class="auth-flow auth-flow--verify">
      <article class="auth-flow-card auth-flow-card--compact">
        <header class="auth-flow-card__header">
          <h2>Vérification email</h2>
          <p>Aucune adresse email à vérifier.</p>
        </header>
        <div class="auth-flow-actions auth-flow-actions--stack">
          <a class="gcg-accent-button auth-flow-submit" href="${LOGIN_PAGE_URL}">Retour au login</a>
          <a class="gcg-minimal-action" href="/vitrine.html?page=signup">Créer un compte</a>
        </div>
      </article>
    </section>
  `;
}

export async function renderPage(container, context = {}) {
  if (!container) return;

  if (context?.user) {
    window.location.href = MY_ACCOUNT_PAGE_URL;
    return;
  }

  const queryEmail = normalizeEmail(context?.query?.email || new URLSearchParams(window.location.search).get('email'));
  if (!queryEmail) {
    renderMissingEmailState(container);
    return;
  }

  container.innerHTML = `
    <section class="auth-flow auth-flow--verify">
      <article class="auth-flow-card">
        <header class="auth-flow-card__header">
          <h2>Confirmez votre email</h2>
          <p>Entrez le code à 6 chiffres reçu par email.</p>
          <p class="auth-flow-email">${queryEmail}</p>
        </header>

        <form class="auth-flow-form" data-verify-form novalidate>
          <label class="auth-flow-field auth-flow-field--code" for="verify-code">
            <span>Code de vérification</span>
            <input
              id="verify-code"
              name="code"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              class="gcg-minimal-input auth-flow-code-input"
              maxlength="6"
              required
            />
          </label>

          <p class="form-message" data-verify-feedback></p>

          <div class="auth-flow-actions auth-flow-actions--stack">
            <button type="submit" class="gcg-accent-button auth-flow-submit" data-verify-submit>
              Valider
            </button>
            <button type="button" class="gcg-outline-button auth-flow-resend" data-verify-resend>
              Renvoyer le code
            </button>
            <a class="gcg-minimal-action" href="${LOGIN_PAGE_URL}">Retour au login</a>
          </div>

          <div data-verify-loader hidden></div>
        </form>
      </article>
    </section>
  `;

  const form = container.querySelector('[data-verify-form]');
  const codeInput = container.querySelector('#verify-code');
  const feedback = container.querySelector('[data-verify-feedback]');
  const verifyButton = container.querySelector('[data-verify-submit]');
  const resendButton = container.querySelector('[data-verify-resend]');
  const loader = container.querySelector('[data-verify-loader]');

  codeInput?.addEventListener('input', event => {
    const input = event.currentTarget;
    input.value = normalizeCode(input.value);
  });

  codeInput?.addEventListener('paste', event => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') || '';
    codeInput.value = normalizeCode(pasted);
  });

  startResendCountdown(resendButton, DEFAULT_RESEND_SECONDS);

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const code = normalizeCode(codeInput?.value || '');
    setFeedback(feedback, '');

    if (code.length !== 6) {
      setFeedback(feedback, 'Le code doit contenir 6 chiffres.', 'error');
      return;
    }

    setActionLoading(verifyButton, true, 'Valider', 'Vérification...');
    setInlineLoader(loader, true, 'Vérification du code...');
    if (codeInput) codeInput.disabled = true;
    if (resendButton) resendButton.disabled = true;

    try {
      const response = await fetch(VERIFY_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: queryEmail, code })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = resolveErrorMessage(payload);
        setFeedback(feedback, message, 'error');
        showToast({ type: 'error', message: message, durationMs: 1000 });
        return;
      }

      setFeedback(feedback, 'Email confirmé, compte créé.', 'success');
      showToast({ type: 'success', message: 'Email confirmé, compte créé', durationMs: 1000 });
      window.setTimeout(() => {
        window.location.href = MY_ACCOUNT_PAGE_URL;
      }, 320);
    } catch (error) {
      console.error('[verifyEmailModule] verify failed', error);
      setFeedback(feedback, 'Impossible de vérifier le code.', 'error');
      showToast({ type: 'error', message: 'Échec vérification', durationMs: 1000 });
    } finally {
      setActionLoading(verifyButton, false, 'Valider', 'Vérification...');
      setInlineLoader(loader, false, '');
      if (codeInput) codeInput.disabled = false;
      updateResendButton(resendButton);
    }
  });

  resendButton?.addEventListener('click', async event => {
    event.preventDefault();
    if (resendSecondsRemaining > 0) {
      return;
    }

    setFeedback(feedback, '');
    setActionLoading(resendButton, true, 'Renvoyer le code', 'Envoi...');
    setInlineLoader(loader, true, 'Renvoi du code...');

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: queryEmail })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.code === 'VERIFICATION_RESEND_THROTTLED') {
          startResendCountdown(resendButton, payload?.retryAfterSeconds || DEFAULT_RESEND_SECONDS);
          const message = payload?.error || 'Attendez avant de renvoyer le code.';
          setFeedback(feedback, message, 'error');
          showToast({ type: 'error', message, durationMs: 1000 });
          return;
        }
        const message = resolveErrorMessage(payload);
        setFeedback(feedback, message, 'error');
        showToast({ type: 'error', message, durationMs: 1000 });
        return;
      }

      setFeedback(feedback, 'Nouveau code envoyé.', 'success');
      showToast({ type: 'success', message: 'Code renvoyé', durationMs: 1000 });
      startResendCountdown(resendButton, payload?.resendAfterSeconds || DEFAULT_RESEND_SECONDS);
    } catch (error) {
      console.error('[verifyEmailModule] resend failed', error);
      setFeedback(feedback, 'Impossible de renvoyer le code.', 'error');
      showToast({ type: 'error', message: 'Échec renvoi code', durationMs: 1000 });
    } finally {
      setInlineLoader(loader, false, '');
      updateResendButton(resendButton);
    }
  });

  window.addEventListener('beforeunload', clearResendTimer, { once: true });
}
