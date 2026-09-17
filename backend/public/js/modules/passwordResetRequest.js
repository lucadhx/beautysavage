const API_REQUEST = '/auth/password-reset/request';

const requestForm = document.querySelector('[data-reset-request-form]');
const emailInput = document.getElementById('reset-email');
const feedbackNode = document.querySelector('[data-reset-request-feedback]');
const submitButton = document.querySelector('[data-reset-request-submit]');

function setFeedback(message = '', tone = '') {
  if (!feedbackNode) return;
  feedbackNode.textContent = message;
  if (tone) {
    feedbackNode.dataset.status = tone;
  } else {
    delete feedbackNode.dataset.status;
  }
}

function setLoading(loading) {
  if (submitButton) {
    submitButton.disabled = Boolean(loading);
  }
}

async function sendResetRequest(email) {
  const payload = { email };
  const response = await fetch(API_REQUEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Impossible d'envoyer le lien de réinitialisation.");
  }
  return true;
}

if (requestForm) {
  requestForm.addEventListener('submit', async event => {
    event.preventDefault();
    const email = emailInput?.value?.trim() || '';
    if (!email) {
      setFeedback('Merci de saisir votre adresse email.', 'error');
      return;
    }
    setFeedback('');
    setLoading(true);
    try {
      await sendResetRequest(email);
      setFeedback('Si un compte existe avec cet email, un lien de réinitialisation a été envoyé.', 'success');
    } catch (error) {
      console.error('Erreur envoi reset password', error);
      setFeedback(error?.message || "Impossible d'envoyer le lien pour le moment.", 'error');
    } finally {
      setLoading(false);
    }
  });
}


