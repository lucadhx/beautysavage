const EVENT_NAME = 'acquisition:animation-complete';
const CLONE_CLASS = 'acquisition-fly-clone';
const DURATION_MS = 650;
const FALLBACK_SIZE = 80;
const FALLBACK_ICON = '🐾';
const MODE_CONFIG = {
  acquisition: {
    defaultTargetSelector: '.header-burger-button',
    emitCompletion: true
  },
  cart: {
    defaultTargetSelector: '.header-icon-button[data-header-icon="panier"]',
    emitCompletion: false
  }
};

const queue = [];
let queueInFlight = false;

function normalizeMode(value) {
  const mode = String(value || 'acquisition').trim().toLowerCase();
  return MODE_CONFIG[mode] ? mode : 'acquisition';
}

function getModeConfig(mode) {
  return MODE_CONFIG[normalizeMode(mode)];
}

function getDocumentRect(element) {
  if (!element || typeof element.getBoundingClientRect !== 'function') {
    return null;
  }
  return element.getBoundingClientRect();
}

function getThemePrimaryColor() {
  if (typeof window === 'undefined') return '#5f4ff7';
  const color = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue('--color-primary')
    .trim();
  return color || '#5f4ff7';
}

function resolveSourceImage(sourceElement) {
  if (!sourceElement || !(sourceElement instanceof Element)) {
    return null;
  }
  if (sourceElement.tagName === 'IMG') {
    return sourceElement;
  }
  return sourceElement.querySelector('[data-acquisition-image], img');
}

function createFallbackClone() {
  const placeholder = document.createElement('div');
  placeholder.classList.add(CLONE_CLASS, `${CLONE_CLASS}--fallback`);
  placeholder.style.background = `linear-gradient(145deg, ${getThemePrimaryColor()}, #0f172a)`;
  placeholder.style.display = 'flex';
  placeholder.style.alignItems = 'center';
  placeholder.style.justifyContent = 'center';
  placeholder.style.fontSize = '1.35rem';
  placeholder.style.fontWeight = '600';
  placeholder.style.color = '#fff';
  placeholder.style.width = `${FALLBACK_SIZE}px`;
  placeholder.style.height = `${FALLBACK_SIZE}px`;
  placeholder.textContent = FALLBACK_ICON;
  return placeholder;
}

function applyGeometry(element, rect) {
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
  element.style.top = `${rect.top}px`;
  element.style.left = `${rect.left}px`;
}

function computeDelta(startRect, endRect) {
  const startCenterX = startRect.left + startRect.width / 2;
  const startCenterY = startRect.top + startRect.height / 2;
  const endCenterX = endRect.left + endRect.width / 2;
  const endCenterY = endRect.top + endRect.height / 2;
  return {
    x: endCenterX - startCenterX,
    y: endCenterY - startCenterY
  };
}

function dispatchCompletion({ mode, targetSelector }) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }
  const config = getModeConfig(mode);
  if (!config.emitCompletion) return;
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: {
        mode: normalizeMode(mode),
        targetSelector: targetSelector || config.defaultTargetSelector
      }
    })
  );
}

function resolveTargetRect(selector, mode) {
  const fallbackSelector = getModeConfig(mode).defaultTargetSelector;
  const target = document.querySelector(selector || fallbackSelector);
  if (target) {
    return target.getBoundingClientRect();
  }
  return {
    top: 32,
    left: window.innerWidth - 64,
    width: 40,
    height: 40
  };
}

function resolveAnimationSource(sourceElement, targetSelector, mode) {
  const sourceImage = resolveSourceImage(sourceElement);
  const imageRect = getDocumentRect(sourceImage);
  if (sourceImage && imageRect) {
    const imageClone = sourceImage.cloneNode(true);
    imageClone.classList.add(CLONE_CLASS, `${CLONE_CLASS}--image`);
    imageClone.removeAttribute('id');
    imageClone.alt = '';
    return { clone: imageClone, rect: imageRect };
  }
  const sourceRect = getDocumentRect(sourceElement);
  const fallbackClone = createFallbackClone();
  const fallbackRect = sourceRect
    ? {
        top: sourceRect.top,
        left: sourceRect.left,
        width: Math.max(64, Math.min(sourceRect.width, FALLBACK_SIZE)),
        height: Math.max(64, Math.min(sourceRect.height, FALLBACK_SIZE))
      }
    : resolveTargetRect(targetSelector, mode);
  return { clone: fallbackClone, rect: fallbackRect };
}

function runAnimation({ sourceElement, targetSelector, mode }) {
  const { clone, rect: initialRect } = resolveAnimationSource(sourceElement, targetSelector, mode);
  applyGeometry(clone, initialRect);
  clone.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
  clone.style.opacity = '0.96';
  document.body.appendChild(clone);
  return new Promise(resolve => {
    let settled = false;
    const handleTransitionEnd = event => {
      if (event.propertyName !== 'transform') return;
      finalize();
    };
    const finalize = () => {
      if (settled) return;
      settled = true;
      clone.removeEventListener('transitionend', handleTransitionEnd);
      clone.remove();
      dispatchCompletion({ mode, targetSelector });
      resolve();
    };
    clone.addEventListener('transitionend', handleTransitionEnd);
    // Ensure reflow before starting transition.
    window.requestAnimationFrame(() => {
      const finalRect = resolveTargetRect(targetSelector, mode);
      const delta = computeDelta(initialRect, finalRect);
      clone.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0) scale(0.74)`;
      clone.style.opacity = '0.1';
    });
    setTimeout(finalize, DURATION_MS + 120);
  });
}

function runQueue() {
  if (queueInFlight) return;
  if (!queue.length) return;
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    const nextWithoutDom = queue.shift();
    dispatchCompletion(nextWithoutDom || {});
    runQueue();
    return;
  }
  queueInFlight = true;
  const next = queue.shift();
  runAnimation(next)
    .catch(error => {
      console.error('Acquisition animation error', error);
      dispatchCompletion(next || {});
    })
    .finally(() => {
      queueInFlight = false;
      runQueue();
    });
}

export function triggerFlyToTarget({ sourceElement, targetSelector, mode = 'acquisition' } = {}) {
  const normalizedMode = normalizeMode(mode);
  const config = getModeConfig(normalizedMode);
  queue.push({
    sourceElement,
    targetSelector: targetSelector || config.defaultTargetSelector,
    mode: normalizedMode
  });
  runQueue();
}

export function triggerAcquisitionAnimation({ sourceElement, targetSelector } = {}) {
  triggerFlyToTarget({ sourceElement, targetSelector, mode: 'acquisition' });
}

export const ACQUISITION_ANIMATION_COMPLETE_EVENT = EVENT_NAME;
