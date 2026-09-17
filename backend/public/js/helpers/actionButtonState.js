const resetTimers = new WeakMap();

const DEFAULT_LABELS = {
  loading: 'Enregistrement...',
  success: 'R?ussi',
  error: '\u00c9chec'
};

function clearResetTimer(button) {
  const currentTimer = resetTimers.get(button);
  if (currentTimer) {
    clearTimeout(currentTimer);
    resetTimers.delete(button);
  }
}

function saveOriginalButtonState(button) {
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = (button.textContent || '').trim();
  }
  if (!button.dataset.originalHtml) {
    button.dataset.originalHtml = button.innerHTML;
  }
}

function setButtonInnerContent(button, state, labels) {
  if (state === 'loading') {
    button.innerHTML = `<span class="ui-action-button-state"><i class="bi bi-arrow-repeat spin" aria-hidden="true"></i><span>${labels.loading}</span></span>`;
    return;
  }
  if (state === 'success') {
    button.innerHTML = `<span class="ui-action-button-state"><i class="bi bi-check2-circle" aria-hidden="true"></i><span>${labels.success}</span></span>`;
    return;
  }
  if (state === 'error') {
    button.innerHTML = `<span class="ui-action-button-state"><i class="bi bi-x-circle" aria-hidden="true"></i><span>${labels.error}</span></span>`;
    return;
  }
  button.innerHTML = button.dataset.originalHtml || button.dataset.originalLabel || '';
}

export function setActionButtonState(button, state = 'idle', opts = {}) {
  if (!button) return;
  const safeState = ['idle', 'loading', 'success', 'error'].includes(state) ? state : 'idle';
  const labels = {
    loading: String(opts.loadingLabel || DEFAULT_LABELS.loading),
    success: String(opts.successLabel || DEFAULT_LABELS.success),
    error: String(opts.errorLabel || DEFAULT_LABELS.error)
  };
  saveOriginalButtonState(button);
  clearResetTimer(button);
  button.dataset.actionState = safeState;
  button.classList.toggle('is-loading', safeState === 'loading');
  button.classList.toggle('is-success', safeState === 'success');
  button.classList.toggle('is-error', safeState === 'error');
  button.disabled = safeState === 'loading';
  button.setAttribute('aria-busy', safeState === 'loading' ? 'true' : 'false');
  setButtonInnerContent(button, safeState, labels);

  if (safeState === 'success' || safeState === 'error') {
    const durationMs = Math.max(300, Number(opts.resetAfterMs) || 1000);
    const timer = setTimeout(() => {
      if (!button.isConnected) return;
      setActionButtonState(button, 'idle');
    }, durationMs);
    resetTimers.set(button, timer);
  }
}
