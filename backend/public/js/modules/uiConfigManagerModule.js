const API_ROOT = '/api/gestion/ui-config';

const FALLBACK = {
  patienceTitle: 'Patience, l’expérience arrive…',
  patienceDescription: 'Nous préparons actuellement une expérience premium pour vous.',
  showTimer: true
};

const state = {
  config: null
};

function getJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function showFeedback(element, message, status = 'info') {
  if (!element) return;
  element.textContent = message || '';
  if (message) {
    element.dataset.status = status;
  } else {
    element.removeAttribute('data-status');
  }
}

function populateForm(form, config = {}) {
  if (!form) return;
  const titleInput = form.querySelector('[name="patienceTitle"]');
  const descInput = form.querySelector('[name="patienceDescription"]');
  const timerInput = form.querySelector('[name="showTimer"]');
  if (titleInput) titleInput.value = config.patienceTitle || FALLBACK.patienceTitle;
  if (descInput) descInput.value = config.patienceDescription || FALLBACK.patienceDescription;
  if (timerInput) timerInput.checked = typeof config.showTimer === 'boolean' ? config.showTimer : FALLBACK.showTimer;
}

function updatePreview(values = {}) {
  const preview = document.querySelector('[data-ui-config-preview]');
  if (!preview) return;
  const titleEl = preview.querySelector('[data-preview-title]');
  const descEl = preview.querySelector('[data-preview-description]');
  const timerEl = preview.querySelector('[data-preview-timer]');
  const showTimer = typeof values.showTimer === 'boolean' ? values.showTimer : FALLBACK.showTimer;
  if (titleEl) {
    titleEl.textContent = values.patienceTitle || FALLBACK.patienceTitle;
  }
  if (descEl) {
    descEl.textContent = values.patienceDescription || FALLBACK.patienceDescription;
  }
  if (timerEl) {
    timerEl.textContent = showTimer ? 'Affiché' : 'Masqué';
    timerEl.dataset.state = showTimer ? 'active' : 'inactive';
  }
}

function getFormValues(form) {
  if (!form) return {};
  return {
    patienceTitle: form.querySelector('[name="patienceTitle"]')?.value?.trim(),
    patienceDescription: form.querySelector('[name="patienceDescription"]')?.value?.trim(),
    showTimer: form.querySelector('[name="showTimer"]')?.checked
  };
}

async function loadConfig(form) {
  try {
    const response = await fetch(API_ROOT, {
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      throw new Error(payload?.error || 'Impossible de charger la configuration.');
    }
    state.config = payload?.config || FALLBACK;
    populateForm(form, state.config);
    updatePreview(state.config);
    showFeedback(form.querySelector('[data-ui-config-feedback]'), '');
  } catch (error) {
    console.error('Erreur chargement configuration UI', error);
    state.config = FALLBACK;
    populateForm(form, state.config);
    updatePreview(state.config);
    showFeedback(form.querySelector('[data-ui-config-feedback]'), 'Impossible de récupérer la configuration globale.', 'error');
  }
}

async function handleSave(event) {
  event.preventDefault();
  const form = event.target;
  if (!form) return;
  const feedback = form.querySelector('[data-ui-config-feedback]');
  const payload = getFormValues(form);
  if (!payload.patienceTitle || !payload.patienceDescription) {
    return showFeedback(feedback, 'Le titre et la description sont requis.', 'error');
  }
  try {
    const response = await fetch(API_ROOT, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible d’enregistrer la configuration.', 'error');
    }
    state.config = body?.config || payload;
    populateForm(form, state.config);
    updatePreview(state.config);
    showFeedback(feedback, 'Configuration sauvegardée avec succès.', 'success');
  } catch (error) {
    console.error('Erreur sauvegarde configuration UI', error);
    showFeedback(feedback, 'Erreur réseau lors de la sauvegarde.', 'error');
  }
}

function bindForm(form) {
  if (!form) return;
  form.addEventListener('input', () => {
    const values = getFormValues(form);
    updatePreview(values);
  });
  form.addEventListener('submit', handleSave);
}

export async function renderModule(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="ui-config-manager">
      <header>
        <h2>Écran de patience</h2>
        <p>Personnalisez le message que verront vos visiteurs pendant les temps d’attente.</p>
      </header>
      <div class="ui-config-body">
        <form class="ui-config-form" data-ui-config-form>
          <label>
            Titre
            <input name="patienceTitle" type="text" required placeholder="Patience, l’expérience arrive…">
          </label>
          <label>
            Description
            <textarea name="patienceDescription" rows="3" required placeholder="Nous préparons actuellement une expérience premium pour vous."></textarea>
          </label>
          <label class="ui-config-toggle">
            <input name="showTimer" type="checkbox">
            Afficher le timer de réactivation
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">Sauvegarder</button>
          </div>
          <p data-ui-config-feedback class="form-message"></p>
        </form>
        <aside class="ui-config-preview" data-ui-config-preview>
          <span class="preview-label">Aperçu mobile</span>
          <strong data-preview-title>${FALLBACK.patienceTitle}</strong>
          <p data-preview-description>${FALLBACK.patienceDescription}</p>
          <div class="preview-timer-row">
            <span>Timer</span>
            <strong data-preview-timer>Affiché</strong>
          </div>
        </aside>
      </div>
    </div>
  `;
  const form = container.querySelector('[data-ui-config-form]');
  bindForm(form);
  await loadConfig(form);
}
