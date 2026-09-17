const CONFIRM_TRANSITION_MS = 180;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getIntentClass(intent = 'primary') {
  const normalized = String(intent || 'primary').trim().toLowerCase();
  return normalized === 'danger' ? 'danger-button' : 'primary-button';
}

export function openUiConfirmModal(options = {}) {
  const title = String(options.title || 'Confirmation').trim() || 'Confirmation';
  const confirmLabel = String(options.confirmLabel || 'Confirmer').trim() || 'Confirmer';
  const cancelLabel = String(options.cancelLabel || 'Annuler').trim() || 'Annuler';
  const loadingLabel = String(options.loadingLabel || 'Traitement...').trim() || 'Traitement...';
  const message = String(options.message || 'Confirmez cette action.').trim();
  const allowHtml = Boolean(options.allowHtml);
  const intent = options.intent || (options.danger ? 'danger' : 'primary');
  const confirmClass = getIntentClass(intent);

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-action-overlay';
    overlay.tabIndex = -1;
    overlay.innerHTML = `
      <div class="confirm-action-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="confirm-action-header">
          <span class="confirm-action-icon" aria-hidden="true"><i class="bi bi-exclamation-triangle"></i></span>
          <h3>${escapeHtml(title)}</h3>
        </div>
        <div class="confirm-action-message" data-confirm-message></div>
        <p class="form-message" data-confirm-error hidden></p>
        <div class="confirm-action-buttons">
          <button type="button" class="secondary-button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
          <button type="button" class="${confirmClass}" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    const messageNode = overlay.querySelector('[data-confirm-message]');
    if (messageNode) {
      if (allowHtml) {
        messageNode.innerHTML = message;
      } else {
        messageNode.textContent = message;
      }
    }

    const errorNode = overlay.querySelector('[data-confirm-error]');
    const cancelButton = overlay.querySelector('[data-confirm-cancel]');
    const confirmButton = overlay.querySelector('[data-confirm-ok]');
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    let resolved = false;
    let busy = false;

    const resolveOnce = value => {
      if (resolved) return;
      resolved = true;
      resolve(Boolean(value));
    };

    const close = (value, { canceled = false } = {}) => {
      if (busy) return;
      overlay.classList.remove('is-open');
      overlay.classList.add('is-closing');
      window.setTimeout(() => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        if (canceled && typeof options.onCancel === 'function') {
          options.onCancel();
        }
        if (previousActiveElement && document.contains(previousActiveElement)) {
          previousActiveElement.focus();
        }
        resolveOnce(value);
      }, CONFIRM_TRANSITION_MS);
    };

    const onKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false, { canceled: true });
      }
    };

    const setBusy = value => {
      busy = Boolean(value);
      if (cancelButton) cancelButton.disabled = busy;
      if (confirmButton) {
        confirmButton.disabled = busy;
        confirmButton.setAttribute('aria-busy', busy ? 'true' : 'false');
        confirmButton.textContent = busy ? loadingLabel : confirmLabel;
      }
    };

    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        close(false, { canceled: true });
      }
    });

    cancelButton?.addEventListener('click', () => close(false, { canceled: true }));

    confirmButton?.addEventListener('click', async () => {
      if (busy) return;
      if (errorNode) {
        errorNode.hidden = true;
        errorNode.textContent = '';
      }
      setBusy(true);
      try {
        if (typeof options.onConfirm === 'function') {
          await options.onConfirm();
        }
        setBusy(false);
        close(true);
      } catch (error) {
        setBusy(false);
        if (errorNode) {
          errorNode.hidden = false;
          errorNode.textContent = String(error?.message || 'Action impossible.');
        }
      }
    });

    document.addEventListener('keydown', onKeyDown);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      confirmButton?.focus();
    });
  });
}
