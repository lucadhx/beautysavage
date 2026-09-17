const DEFAULT_DURATION_MS = 1000;
const TOAST_HOST_ID = 'ui-toast-host';

let toastHost = null;
let hideTimer = null;
let removeTimer = null;

function ensureToastHost() {
  if (toastHost && document.body.contains(toastHost)) {
    return toastHost;
  }
  toastHost = document.getElementById(TOAST_HOST_ID);
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = TOAST_HOST_ID;
    toastHost.className = 'ui-toast-host';
    toastHost.setAttribute('aria-live', 'polite');
    toastHost.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastHost);
  }
  return toastHost;
}

function clearTimers() {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (removeTimer) {
    clearTimeout(removeTimer);
    removeTimer = null;
  }
}

export function hideToast() {
  if (!toastHost) return;
  clearTimers();
  toastHost.classList.remove('is-visible');
  toastHost.classList.add('is-hiding');
  removeTimer = setTimeout(() => {
    if (!toastHost) return;
    toastHost.classList.remove('is-hiding');
    toastHost.innerHTML = '';
  }, 240);
}

export function showToast({ type = 'info', message = '', durationMs = DEFAULT_DURATION_MS } = {}) {
  const host = ensureToastHost();
  if (!host) return;
  clearTimers();
  const safeType = ['success', 'error', 'info'].includes(type) ? type : 'info';
  host.innerHTML = '';
  const toast = document.createElement('div');
  toast.className = `ui-toast ui-toast--${safeType}`;
  toast.setAttribute('role', 'status');
  const icon = document.createElement('span');
  icon.className = 'ui-toast__icon';
  icon.setAttribute('aria-hidden', 'true');
  const msg = document.createElement('p');
  msg.className = 'ui-toast__message';
  msg.textContent = String(message || '').trim();
  toast.append(icon, msg);
  host.appendChild(toast);
  host.classList.remove('is-hiding');
  requestAnimationFrame(() => {
    host.classList.add('is-visible');
  });
  hideTimer = setTimeout(() => {
    hideToast();
  }, Math.max(250, Number(durationMs) || DEFAULT_DURATION_MS));
}
