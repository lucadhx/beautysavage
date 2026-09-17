const API_ROOT = '/api/gestion/themes';
const BASE_COLOR_KEYS = ['primary', 'secondary', 'background', 'surface', 'text'];
const DERIVED_KEYS = ['surfaceHeader', 'accent', 'accentStrong'];

const DERIVED_CONFIG = {
  surfaceHeader: {
    label: 'Surface header',
    hint: 'Fond header vitrine et overlays',
    compute: colors => `color-mix(in oklab, ${colors.primary} 26%, ${colors.background} 74%)`
  },
  accent: {
    label: 'Accent',
    hint: 'Prix, pictos, cœurs',
    compute: colors => `color-mix(in oklab, ${colors.primary} 70%, ${colors.secondary} 30%)`
  },
  accentStrong: {
    label: 'Accent fort',
    hint: 'Badges forts, compteurs',
    compute: colors => `color-mix(in oklab, ${colors.primary} 45%, ${colors.secondary} 55%)`
  }
};

const DEFAULT_THEME = {
  name: 'Aperçu',
  slogan: 'Identité premium en attente',
  logoUrl: '',
  colors: {
    primary: '#5f4ff7',
    secondary: '#f24692',
    background: '#f5f4ef',
    surface: '#ffffff',
    text: '#0f172a'
  },
  derivedTokens: {
    surfaceHeader: null,
    accent: null,
    accentStrong: null
  }
};

const state = {
  themes: [],
  editingId: null
};

let colorPickerOverlay = null;
let colorPickerInputElement = null;
let colorPickerCurrentControl = null;

function sanitizeColor(value) {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function computeDerivedTokens(colors = {}, overrides = {}) {
  const palette = { ...DEFAULT_THEME.colors, ...colors };
  return {
    surfaceHeader: sanitizeColor(overrides.surfaceHeader) || DERIVED_CONFIG.surfaceHeader.compute(palette),
    accent: sanitizeColor(overrides.accent) || DERIVED_CONFIG.accent.compute(palette),
    accentStrong: sanitizeColor(overrides.accentStrong) || DERIVED_CONFIG.accentStrong.compute(palette)
  };
}

function applySelectedColor(input, swatch, color) {
  if (!input) return;
  input.value = color;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (swatch) {
    swatch.style.setProperty('background', color);
  }
}

function hideColorPicker() {
  if (!colorPickerOverlay) return;
  colorPickerOverlay.classList.remove('active');
  colorPickerCurrentControl = null;
}

function ensureColorPickerOverlay() {
  if (colorPickerOverlay) return colorPickerOverlay;
  colorPickerOverlay = document.createElement('div');
  colorPickerOverlay.className = 'theme-color-picker-backdrop';
  colorPickerOverlay.innerHTML = `
    <div class="theme-color-picker-panel" role="dialog" aria-modal="true">
      <header class="theme-color-picker-header">
        <strong>Choisir la couleur</strong>
        <button type="button" class="theme-color-picker-close" aria-label="Fermer">&times;</button>
      </header>
      <input type="color" class="theme-color-picker-input">
      <div class="theme-color-picker-actions">
        <button type="button" class="secondary-button" data-picker-close>Fermer</button>
      </div>
    </div>
  `;
  document.body.appendChild(colorPickerOverlay);
  colorPickerInputElement = colorPickerOverlay.querySelector('.theme-color-picker-input');
  colorPickerOverlay.addEventListener('click', event => {
    if (event.target === colorPickerOverlay || event.target.closest('[data-picker-close]')) {
      hideColorPicker();
    }
  });
  colorPickerOverlay.querySelector('.theme-color-picker-close')?.addEventListener('click', hideColorPicker);
  colorPickerInputElement.addEventListener('input', () => {
    if (!colorPickerCurrentControl) return;
    applySelectedColor(colorPickerCurrentControl.input, colorPickerCurrentControl.swatch, colorPickerInputElement.value);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideColorPicker();
    }
  });
  return colorPickerOverlay;
}

function showColorPicker(control, input, swatch) {
  if (!input || !swatch) return;
  if (control?.dataset.colorLocked === 'true') return;
  const overlay = ensureColorPickerOverlay();
  colorPickerCurrentControl = { control, input, swatch };
  const colorValue = input.value || control.dataset.fallbackColor || '#ffffff';
  colorPickerInputElement.value = colorValue;
  overlay.classList.add('active');
  setTimeout(() => colorPickerInputElement.focus(), 0);
}

function initializeColorControls(container) {
  if (!container) return;
  container.querySelectorAll('[data-color-control]').forEach(control => {
    if (control.dataset.themeColorBound) return;
    const input = control.querySelector('.theme-color-input');
    const swatch = control.querySelector('[data-color-swatch]');
    const trigger = control.querySelector('.theme-color-trigger');
    const fallbackKey = control.dataset.colorKey;
    const fallbackColor = (fallbackKey && DEFAULT_THEME.colors[fallbackKey]) || '#ffffff';
    const updateSwatch = () => {
      const color = input?.value || control.dataset.fallbackColor || fallbackColor;
      if (swatch) swatch.style.setProperty('background', color);
    };
    input?.addEventListener('input', updateSwatch);
    swatch?.addEventListener('click', () => showColorPicker(control, input, swatch));
    swatch?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        showColorPicker(control, input, swatch);
      }
    });
    trigger?.addEventListener('click', event => {
      event.preventDefault();
      showColorPicker(control, input, swatch);
    });
    control.dataset.themeColorBound = '1';
    updateSwatch();
  });
}

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

function buildThemeCard(theme) {
  const colorSwatches = BASE_COLOR_KEYS.map(
    key => `<span class="theme-card-swatch" style="background:${theme.colors[key]};" aria-label="${key}"></span>`
  ).join('');
  return `
    <article class="theme-card ${theme.isActive ? 'theme-card--active' : ''}" data-theme-id="${theme.id}">
      <div class="theme-card-swatch-row">
        ${colorSwatches}
      </div>
      <div class="theme-card-meta">
        <strong>${theme.name}</strong>
        <p>${theme.slogan || 'Slogan vide'}</p>
      </div>
      <div class="theme-card-actions">
        <button type="button" class="secondary-button" data-action="edit-theme" data-id="${theme.id}">Modifier</button>
        <button type="button" class="primary-button theme-card-activate" data-action="activate-theme" data-id="${theme.id}" ${theme.isActive ? 'disabled' : ''}>
          ${theme.isActive ? 'Thème actif' : 'Activer ce thème'}
        </button>
      </div>
    </article>
  `;
}

function renderThemeList(container) {
  if (!container) return;
  if (!state.themes.length) {
    container.innerHTML = '<p class="module-placeholder">Aucun thème enregistré.</p>';
    return;
  }
  container.innerHTML = state.themes.map(buildThemeCard).join('');
  attachThemeCardActions(container);
}

function attachThemeCardActions(container) {
  container.querySelectorAll('[data-action="edit-theme"]').forEach(button => {
    button.addEventListener('click', () => {
      const theme = state.themes.find(item => item.id === button.dataset.id);
      if (theme) {
        fillEditForm(theme);
      }
    });
  });
  container.querySelectorAll('[data-action="activate-theme"]').forEach(button => {
    button.addEventListener('click', async () => {
      const themeId = button.dataset.id;
      if (!themeId) return;
      button.disabled = true;
      try {
        const response = await fetch(`${API_ROOT}/${themeId}/activate`, {
          method: 'POST',
          credentials: 'include'
        });
        const payload = await getJson(response);
        if (!response.ok) {
          console.error(payload);
          return;
        }
        await refreshThemeList(container);
      } catch (error) {
        console.error(error);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function fetchThemes() {
  const response = await fetch(API_ROOT, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Impossible de récupérer les thèmes.');
  }
  const payload = await getJson(response);
  state.themes = Array.isArray(payload.themes) ? payload.themes : [];
}

async function refreshThemeList(container) {
  if (!container) return;
  try {
    await fetchThemes();
    renderThemeList(container);
  } catch (error) {
    console.error(error);
    container.innerHTML = '<p class="module-placeholder">Impossible de charger les thèmes.</p>';
  }
}

function updatePreview(element, values = {}) {
  if (!element) return;
  const colors = { ...DEFAULT_THEME.colors, ...(values.colors || {}) };
  element.style.setProperty('--preview-primary', colors.primary);
  element.style.setProperty('--preview-secondary', colors.secondary);
  element.style.setProperty('--preview-background', colors.background);
  element.style.setProperty('--preview-surface', colors.surface);
  element.style.setProperty('--preview-text', colors.text);
  const logo = element.querySelector('[data-preview-logo]');
  if (logo) {
    if (values.logoUrl) {
      logo.src = values.logoUrl;
      logo.hidden = false;
    } else {
      logo.removeAttribute('src');
      logo.hidden = true;
    }
  }
  const name = element.querySelector('[data-preview-name]');
  if (name) {
    name.textContent = values.name || DEFAULT_THEME.name;
  }
  const slogan = element.querySelector('[data-preview-slogan]');
  if (slogan) {
    slogan.textContent = values.slogan || DEFAULT_THEME.slogan;
  }
}

function updatePreviewFromValues(values = {}) {
  const preview = document.querySelector('[data-theme-preview]');
  updatePreview(preview, values);
}

function getColorsFromForm(form) {
  const colors = { ...DEFAULT_THEME.colors };
  BASE_COLOR_KEYS.forEach(key => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input && input.value) {
      colors[key] = input.value;
    }
  });
  return colors;
}

function setDerivedMode(row, mode) {
  if (!row) return;
  row.dataset.derivedMode = mode;
  row.querySelectorAll('[data-derived-toggle]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.derivedToggle === mode);
  });
  const control = row.querySelector('[data-color-control]');
  const input = control?.querySelector('.theme-color-input');
  if (control && input) {
    const locked = mode === 'auto';
    control.dataset.colorLocked = locked ? 'true' : 'false';
    input.disabled = locked;
  }
}

function refreshDerivedPreview(form, derived) {
  const preview = form.closest('.theme-section')?.querySelector('[data-derived-preview]');
  if (!preview || !derived) return;
  preview.style.setProperty('--derived-surface-header', derived.surfaceHeader);
  preview.style.setProperty('--derived-accent', derived.accent);
  preview.style.setProperty('--derived-accent-strong', derived.accentStrong);
}

function refreshDerivedUI(form) {
  if (!form) return;
  const colors = getColorsFromForm(form);
  const overrides = {};
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    const mode = row?.dataset.derivedMode || 'auto';
    const input = row?.querySelector('[data-derived-input]');
    overrides[key] = mode === 'manual' ? sanitizeColor(input?.value) : null;
  });
  const derived = computeDerivedTokens(colors, overrides);
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    if (!row) return;
    const control = row.querySelector('[data-color-control]');
    const input = control?.querySelector('.theme-color-input');
    const swatch = control?.querySelector('[data-color-swatch]');
    const mode = row.dataset.derivedMode || 'auto';
    if (control) {
      control.dataset.fallbackColor = derived[key];
    }
    if (mode === 'auto' && input) {
      input.value = derived[key];
    }
    if (swatch) {
      const displayColor = mode === 'manual' && input?.value ? input.value : derived[key];
      swatch.style.setProperty('background', displayColor);
    }
  });
  refreshDerivedPreview(form, derived);
}

function bindDerivedControls(form) {
  if (!form) return;
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    if (!row) return;
    row.querySelectorAll('[data-derived-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        setDerivedMode(row, button.dataset.derivedToggle);
        if (button.dataset.derivedToggle === 'auto') {
          const input = row.querySelector('[data-derived-input]');
          if (input) input.value = '';
        }
        refreshDerivedUI(form);
      });
    });
    row.querySelector('[data-derived-reset]')?.addEventListener('click', () => {
      setDerivedMode(row, 'auto');
      const input = row.querySelector('[data-derived-input]');
      if (input) input.value = '';
      refreshDerivedUI(form);
    });
    row.querySelector('[data-derived-input]')?.addEventListener('input', () => refreshDerivedUI(form));
    setDerivedMode(row, row.dataset.derivedMode || 'auto');
  });
}

function bindFormPreview(form) {
  if (!form) return;
  const handler = () => {
    updatePreviewFromValues({
      name: form.querySelector('[name="name"]')?.value?.trim(),
      slogan: form.querySelector('[name="slogan"]')?.value?.trim(),
      logoUrl: form.querySelector('[name="logoUrl"]')?.value?.trim(),
      colors: getColorsFromForm(form)
    });
    refreshDerivedUI(form);
  };
  form.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', handler);
  });
}

function serializeColors(form) {
  const colors = {};
  BASE_COLOR_KEYS.forEach(key => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input && input.value) {
      colors[key] = input.value;
    }
  });
  return colors;
}

function serializeDerivedTokens(form) {
  const tokens = {};
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    const mode = row?.dataset.derivedMode || 'auto';
    const input = row?.querySelector('[data-derived-input]');
    tokens[key] = mode === 'manual' ? sanitizeColor(input?.value) : null;
  });
  return tokens;
}

function validateDerivedTokens(form, feedback) {
  const invalid = DERIVED_KEYS.filter(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    if (!row || row.dataset.derivedMode !== 'manual') return false;
    const input = row.querySelector('[data-derived-input]');
    return !input?.value;
  });
  if (invalid.length) {
    showFeedback(feedback, `Couleur requise pour: ${invalid.join(', ')}`, 'error');
    return false;
  }
  return true;
}

function fillEditForm(theme) {
  const form = document.querySelector('[data-theme-edit-form]');
  if (!form) return;
  state.editingId = theme.id;
  form.querySelector('[name="id"]').value = theme.id;
  form.querySelector('[name="name"]').value = theme.name;
  form.querySelector('[name="slogan"]').value = theme.slogan || '';
  form.querySelector('[name="logoUrl"]').value = theme.logoUrl || '';
  BASE_COLOR_KEYS.forEach(key => {
    const input = form.querySelector(`[name="${key}"]`);
    if (input) {
      input.value = theme.colors[key] || DEFAULT_THEME.colors[key];
    }
  });
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    const input = row?.querySelector('[data-derived-input]');
    const manualValue = sanitizeColor(theme.derivedTokens?.[key]);
    if (input) {
      input.value = manualValue || '';
    }
    setDerivedMode(row, manualValue ? 'manual' : 'auto');
  });
  refreshDerivedUI(form);
  updatePreviewFromValues({
    name: theme.name,
    slogan: theme.slogan,
    logoUrl: theme.logoUrl,
    colors: theme.colors
  });
}

function resetEditForm() {
  const form = document.querySelector('[data-theme-edit-form]');
  if (!form) return;
  state.editingId = null;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  DERIVED_KEYS.forEach(key => {
    const row = form.querySelector(`[data-derived-token="${key}"]`);
    const input = row?.querySelector('[data-derived-input]');
    if (input) input.value = '';
    setDerivedMode(row, 'auto');
  });
  refreshDerivedUI(form);
  showFeedback(form.querySelector('[data-theme-edit-feedback]'), '');
  updatePreviewFromValues();
}

async function handleCreateTheme(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = form.querySelector('[data-theme-create-feedback]');
  const payload = {
    name: form.querySelector('[name="name"]')?.value?.trim(),
    slogan: form.querySelector('[name="slogan"]')?.value?.trim(),
    logoUrl: form.querySelector('[name="logoUrl"]')?.value?.trim(),
    colors: serializeColors(form),
    derivedTokens: serializeDerivedTokens(form)
  };
  if (!payload.name || Object.keys(payload.colors).length !== BASE_COLOR_KEYS.length) {
    return showFeedback(feedback, 'Le nom et toutes les couleurs sont requis.', 'error');
  }
  if (!validateDerivedTokens(form, feedback)) return;
  try {
    const response = await fetch(API_ROOT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible de créer le thème.', 'error');
    }
    form.reset();
    DERIVED_KEYS.forEach(key => {
      const row = form.querySelector(`[data-derived-token="${key}"]`);
      setDerivedMode(row, 'auto');
      const input = row?.querySelector('[data-derived-input]');
      if (input) input.value = '';
    });
    refreshDerivedUI(form);
    showFeedback(feedback, 'Thème créé.', 'success');
    updatePreviewFromValues();
    await refreshThemeList(document.querySelector('[data-theme-list]'));
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function handleEditTheme(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.querySelector('[name="id"]')?.value;
  const feedback = form.querySelector('[data-theme-edit-feedback]');
  if (!id) {
    return showFeedback(feedback, 'Sélectionnez un thème pour le modifier.', 'error');
  }
  const payload = {
    name: form.querySelector('[name="name"]')?.value?.trim(),
    slogan: form.querySelector('[name="slogan"]')?.value?.trim(),
    logoUrl: form.querySelector('[name="logoUrl"]')?.value?.trim(),
    colors: serializeColors(form),
    derivedTokens: serializeDerivedTokens(form)
  };
  if (!validateDerivedTokens(form, feedback)) return;
  try {
    const response = await fetch(`${API_ROOT}/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible de mettre à jour.', 'error');
    }
    showFeedback(feedback, 'Thème mis à jour.', 'success');
    await refreshThemeList(document.querySelector('[data-theme-list]'));
    resetEditForm();
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

function getColorFieldMarkup(key, value = DEFAULT_THEME.colors[key], required = false) {
  const normalizedValue = value || DEFAULT_THEME.colors[key] || '#ffffff';
  return `
    <label class="theme-color-field">
      <span>Couleur ${key}</span>
      <div class="theme-color-control" data-color-control data-color-key="${key}">
        <div class="theme-color-swatch" data-color-swatch role="button" tabindex="0" aria-label="Couleur ${key}" style="background:${normalizedValue};"></div>
        <button type="button" class="theme-color-trigger" aria-label="Modifier la couleur ${key}">
          <span aria-hidden="true">🎨</span>
        </button>
        <input class="theme-color-input" name="${key}" type="color" value="${normalizedValue}" ${required ? 'required' : ''}>
      </div>
    </label>
  `;
}

function getDerivedFieldMarkup(key) {
  const config = DERIVED_CONFIG[key];
  return `
    <div class="derived-token" data-derived-token="${key}" data-derived-mode="auto">
      <div class="derived-token__header">
        <div>
          <p class="derived-token__title">${config.label}</p>
          <p class="derived-token__hint">${config.hint}</p>
        </div>
        <div class="derived-token__actions">
          <button type="button" class="derived-chip is-active" data-derived-toggle="auto">Auto</button>
          <button type="button" class="derived-chip" data-derived-toggle="manual">Manuel</button>
          <button type="button" class="derived-reset" data-derived-reset title="Revenir en auto">Reset</button>
        </div>
      </div>
      <div class="derived-token__body">
        <div class="theme-color-control" data-color-control data-color-key="${key}" data-derived-control data-color-locked="true">
          <div class="theme-color-swatch" data-color-swatch role="button" tabindex="0" aria-label="Couleur ${config.label}"></div>
          <button type="button" class="theme-color-trigger" aria-label="Modifier la couleur ${config.label}">
            <span aria-hidden="true">🎨</span>
          </button>
          <input class="theme-color-input" data-derived-input name="derived-${key}" type="color" value="">
        </div>
      </div>
    </div>
  `;
}

function getDerivedSectionMarkup() {
  return `
    <div class="derived-section">
      <div class="derived-section__header">
        <div>
          <h5>Tokens dérivés</h5>
          <p>Auto-calculés depuis les couleurs de base, avec surcharge manuelle optionnelle.</p>
        </div>
        <div class="derived-preview" data-derived-preview>
          <div class="derived-preview__header">
            <span class="derived-preview__brand">Header</span>
            <span class="derived-preview__badge">Accent</span>
            <span class="derived-preview__badge derived-preview__badge--strong">+3</span>
          </div>
        </div>
      </div>
      <div class="derived-grid">
        ${DERIVED_KEYS.map(getDerivedFieldMarkup).join('')}
      </div>
    </div>
  `;
}

export async function renderModule(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="theme-manager">
      <header>
        <h2>Thèmes & identité visuelle</h2>
        <p>Paramétrez les couleurs, le logo et les tokens dérivés de la vitrine premium.</p>
      </header>
      <section class="theme-section">
        <div class="section-header">
          <h3>Bibliothèque de thèmes</h3>
        </div>
        <div class="theme-list" data-theme-list>
          <p class="module-placeholder">Chargement des thèmes…</p>
        </div>
      </section>
      <section class="theme-section theme-section--forms">
        <div class="theme-forms">
          <form class="theme-form" data-theme-create-form>
            <h4>Créer un thème</h4>
            <label>
              Nom
              <input name="name" type="text" required placeholder="Institut Premium">
            </label>
            <label>
              Slogan
              <input name="slogan" type="text" placeholder="Beautés d’exception">
            </label>
            <label>
              Logo (URL)
              <input name="logoUrl" type="url" placeholder="https://...">
            </label>
            ${BASE_COLOR_KEYS.map(key => getColorFieldMarkup(key, DEFAULT_THEME.colors[key], true)).join('')}
            ${getDerivedSectionMarkup()}
            <div class="form-actions">
              <button class="primary-button" type="submit">Créer un thème</button>
            </div>
          </form>
          <p data-theme-create-feedback class="form-message"></p>
          <form class="theme-form" data-theme-edit-form>
            <h4>Modifier un thème</h4>
            <input type="hidden" name="id">
            <label>
              Nom
              <input name="name" type="text" placeholder="Sélectionner un thème">
            </label>
            <label>
              Slogan
              <input name="slogan" type="text">
            </label>
            <label>
              Logo (URL)
              <input name="logoUrl" type="url">
            </label>
            ${BASE_COLOR_KEYS.map(key => getColorFieldMarkup(key, DEFAULT_THEME.colors[key])).join('')}
            ${getDerivedSectionMarkup()}
            <div class="form-actions">
              <button class="primary-button" type="submit">Enregistrer</button>
              <button class="secondary-button" type="button" data-action="reset-edit-form">Annuler</button>
            </div>
          </form>
          <p data-theme-edit-feedback class="form-message"></p>
        </div>
        <div class="theme-preview" data-theme-preview>
          <img class="theme-preview-logo" data-preview-logo hidden alt="Logo du thème">
          <strong data-preview-name>${DEFAULT_THEME.name}</strong>
          <p data-preview-slogan>${DEFAULT_THEME.slogan}</p>
        </div>
      </section>
    </div>
  `;
  const list = container.querySelector('[data-theme-list]');
  const createForm = container.querySelector('[data-theme-create-form]');
  const editForm = container.querySelector('[data-theme-edit-form]');
  createForm?.addEventListener('submit', handleCreateTheme);
  editForm?.addEventListener('submit', handleEditTheme);
  const resetButton = container.querySelector('[data-action="reset-edit-form"]');
  resetButton?.addEventListener('click', resetEditForm);
  initializeColorControls(container);
  bindDerivedControls(createForm);
  bindDerivedControls(editForm);
  bindFormPreview(createForm);
  bindFormPreview(editForm);
  refreshDerivedUI(createForm);
  refreshDerivedUI(editForm);
  updatePreviewFromValues();
  await refreshThemeList(list);
}
