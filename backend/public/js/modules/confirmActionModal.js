import { openUiConfirmModal } from './uiConfirmModal.js';

export function confirmAction(options = {}) {
  return openUiConfirmModal({
    ...options,
    intent: options.intent || (options.danger ? 'danger' : 'primary')
  });
}
