import { showToast } from '../helpers/toastService.js';
import { PAW_ICON_SVG } from '../ui/pawIcon.js';

const SIGNUP_ENDPOINT = '/auth/signup';
const VERIFY_PAGE_URL = '/vitrine.html?page=verify-email';
const LOGIN_PAGE_URL = '/login.html';
const MY_ACCOUNT_PAGE_URL = '/vitrine.html?page=myaccount';

function buildLoaderMarkup(label = 'Traitement...') {
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

function setLoading(form, loading, label = 'Création...') {
  if (!form) return;
  const button = form.querySelector('[data-signup-submit]');
  const loader = form.querySelector('[data-signup-loader]');
  const inputs = form.querySelectorAll('input');
  inputs.forEach(input => {
    input.disabled = Boolean(loading);
  });
  if (button) {
    button.disabled = Boolean(loading);
    button.textContent = loading ? label : 'Créer mon compte';
  }
  if (loader) {
    loader.hidden = !loading;
    loader.innerHTML = loading ? buildLoaderMarkup('Envoi du code...') : '';
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getPasswordError(password) {
  const value = String(password || '');
  if (value.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return '';
}

function redirectToVerify(email) {
  const url = `${VERIFY_PAGE_URL}&email=${encodeURIComponent(email)}`;
  window.location.href = url;
}

export async function renderPage(container, context = {}) {
  if (!container) return;

  if (context?.user) {
    window.location.href = MY_ACCOUNT_PAGE_URL;
    return;
  }

  container.innerHTML = `
    <section class="auth-flow auth-flow--signup">
      <article class="auth-flow-card">
        <header class="auth-flow-card__header">
          <h2>Créer un compte</h2>
          <p>Inscrivez-vous pour accéder à votre espace client.</p>
        </header>

        <form class="auth-flow-form" data-signup-form novalidate>
          <label class="auth-flow-field" for="signup-email">
            <span>Email</span>
            <input
              id="signup-email"
              type="email"
              name="email"
              class="gcg-minimal-input"
              autocomplete="email"
              required
            />
          </label>

          <label class="auth-flow-field" for="signup-password">
            <span>Mot de passe</span>
            <input
              id="signup-password"
              type="password"
              name="password"
              class="gcg-minimal-input"
              autocomplete="new-password"
              required
            />
          </label>

          <label class="auth-flow-field" for="signup-password-confirm">
            <span>Confirmer le mot de passe</span>
            <input
              id="signup-password-confirm"
              type="password"
              name="passwordConfirm"
              class="gcg-minimal-input"
              autocomplete="new-password"
              required
            />
          </label>

          <p class="form-message" data-signup-feedback></p>

          <div class="auth-flow-actions">
            <button type="submit" class="gcg-accent-button auth-flow-submit" data-signup-submit>
              Créer mon compte
            </button>
            <a class="gcg-minimal-action" href="${LOGIN_PAGE_URL}">Retour au login</a>
          </div>

          <div data-signup-loader hidden></div>
        </form>
      </article>
    </section>
  `;

  const form = container.querySelector('[data-signup-form]');
  const feedback = container.querySelector('[data-signup-feedback]');

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const email = normalizeEmail(formData.get('email'));
    const password = String(formData.get('password') || '');
    const passwordConfirm = String(formData.get('passwordConfirm') || '');

    setFeedback(feedback, '');

    if (!email || !password || !passwordConfirm) {
      setFeedback(feedback, 'Tous les champs sont obligatoires.', 'error');
      return;
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      setFeedback(feedback, passwordError, 'error');
      return;
    }

    if (password !== passwordConfirm) {
      setFeedback(feedback, 'Les mots de passe ne correspondent pas.', 'error');
      return;
    }

    setLoading(form, true, 'Création...');
    try {
      const response = await fetch(SIGNUP_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirm })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (payload?.code === 'EMAIL_NOT_VERIFIED_PENDING') {
          const pendingEmail = normalizeEmail(payload?.email || email);
          setFeedback(feedback, 'Compte déjà en attente de vérification. Vous allez être redirigé.', 'error');
          showToast({ type: 'info', message: 'Vérification en attente', durationMs: 1000 });
          window.setTimeout(() => redirectToVerify(pendingEmail), 450);
          return;
        }
        setFeedback(feedback, payload?.error || 'Impossible de créer le compte.', 'error');
        showToast({ type: 'error', message: 'Échec inscription', durationMs: 1000 });
        return;
      }

      const signupEmail = normalizeEmail(payload?.email || email);
      setFeedback(feedback, 'Code envoyé par email.', 'success');
      showToast({ type: 'success', message: 'Code envoyé par email', durationMs: 1000 });
      window.setTimeout(() => {
        redirectToVerify(signupEmail);
      }, 350);
    } catch (error) {
      console.error('[signupModule] signup failed', error);
      setFeedback(feedback, "Impossible de contacter le serveur.", 'error');
      showToast({ type: 'error', message: 'Échec inscription', durationMs: 1000 });
    } finally {
      setLoading(form, false);
    }
  });
}
