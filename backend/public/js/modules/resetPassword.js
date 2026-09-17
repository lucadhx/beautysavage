const API_VALIDATE = '/auth/password-reset/validate';
const API_COMPLETE = '/auth/password-reset/complete';

const STATUS_MESSAGES = {
  invalid: 'Ce lien est invalide ou a déjà été utilisé.',
  expired: 'Ce lien a expiré.',
  used: 'Ce lien a déjà été utilisé.',
  missing_token: 'Lien de réinitialisation manquant.',
  default: 'Impossible de valider ce lien pour le moment.'
};

const statusBanner = document.querySelector('[data-reset-status]');
const resetForm = document.querySelector('[data-reset-form]');
const submitButton = document.querySelector('[data-reset-submit]');
const feedbackNode = document.querySelector('[data-reset-feedback]');
const passwordInput = document.getElementById('new-password');
const confirmInput = document.getElementById('confirm-password');

function updateStatus(message, tone = '') {
  if (!statusBanner) return;
  statusBanner.querySelector('p')?.remove();
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  paragraph.className = tone ? `status-${tone}` : '';
  paragraph.setAttribute('aria-live', 'polite');
  statusBanner.innerHTML = '';
  statusBanner.appendChild(paragraph);
  if (tone) {
    statusBanner.dataset.status = tone;
  } else {
    delete statusBanner.dataset.status;
  }
}

function showForm(visible) {
  if (!resetForm) return;
  resetForm.hidden = !visible;
}

function setFeedback(message = '', tone = '') {
  if (!feedbackNode) return;
  feedbackNode.textContent = message;
  if (tone) {
    feedbackNode.dataset.status = tone;
  } else {
    delete feedbackNode.dataset.status;
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function resolveStatusMessage(body) {
  if (!body?.errorCode) {
    return STATUS_MESSAGES.default;
  }
  return STATUS_MESSAGES[body.errorCode] || STATUS_MESSAGES.default;
}

async function verifyToken(token) {
  updateStatus('Vérification du lien en cours...', 'info');
  try {
    const { response, body } = await fetchJson(API_VALIDATE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    if (!response.ok) {
      updateStatus(resolveStatusMessage(body), 'error');
      showForm(false);
      return null;
    }
    updateStatus('Lien validé. Choisissez un nouveau mot de passe.', 'success');
    showForm(true);
    return true;
  } catch (error) {
    console.error('Erreur validation reset', error);
    updateStatus('Impossible de vérifier ce lien pour le moment.', 'error');
    showForm(false);
    return null;
  }
}

async function submitNewPassword(token, password) {
  setFeedback('');
  if (!submitButton) return;
  submitButton.disabled = true;
  try {
    const { response, body } = await fetchJson(API_COMPLETE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password })
    });
    if (!response.ok) {
      const message = body?.error || resolveStatusMessage(body);
      setFeedback(message, 'error');
      return false;
    }
    updateStatus('Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.', 'success');
    showForm(false);
    return true;
  } catch (error) {
    console.error('Erreur envoi nouveau mot de passe', error);
    setFeedback('Impossible de réinitialiser votre mot de passe.', 'error');
    return false;
  } finally {
    submitButton.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    updateStatus('Lien de réinitialisation invalide.', 'error');
    showForm(false);
    return;
  }
  verifyToken(token);
  if (resetForm) {
    resetForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!passwordInput || !confirmInput) return;
      const password = passwordInput.value.trim();
      const confirmation = confirmInput.value.trim();
      if (!password || !confirmation) {
        setFeedback('Merci de renseigner les deux champs.', 'error');
        return;
      }
      if (password !== confirmation) {
        setFeedback('Les mots de passe ne correspondent pas.', 'error');
        return;
      }
      if (password.length < 8) {
        setFeedback('Le mot de passe doit contenir au moins 8 caractères.', 'error');
        return;
      }
      await submitNewPassword(token, password);
    });
  }
});
