const STATE_DEFAULT = 'default';
const STATE_ADDED = 'added';
const STATE_LOADING = 'loading';
const BUTTON_BASE_CLASS = 'add-to-cart-button';
const BUTTON_ADDED_CLASS = 'add-to-cart-button--added';
const BUTTON_LOADING_CLASS = 'add-to-cart-button--loading';

function ensureDefaults(button) {
  if (!button) return;
  button.classList.add(BUTTON_BASE_CLASS);
  if (!button.dataset.addToCartDefaultHtml) {
    button.dataset.addToCartDefaultHtml = button.innerHTML;
  }
  if (!button.dataset.addToCartDefaultAriaLabel) {
    const fallback = button.getAttribute('aria-label') || button.textContent || 'Ajouter au panier';
    button.dataset.addToCartDefaultAriaLabel = fallback.trim();
  }
}

export function setAddToCartButtonState(button, state = STATE_DEFAULT) {
  if (!button) return;
  const normalizedState = String(state || STATE_DEFAULT).trim().toLowerCase();
  ensureDefaults(button);
  button.classList.remove(BUTTON_ADDED_CLASS, BUTTON_LOADING_CLASS);
  if (normalizedState === STATE_LOADING) {
    button.dataset.addToCartState = STATE_LOADING;
    button.classList.add(BUTTON_LOADING_CLASS);
    button.disabled = true;
    button.setAttribute('aria-label', 'Ajout au panier en cours');
    button.innerHTML = '<i class="bi bi-arrow-repeat" aria-hidden="true"></i><span>Ajout...</span>';
    return;
  }
  if (normalizedState === STATE_ADDED) {
    button.dataset.addToCartState = STATE_ADDED;
    button.classList.add(BUTTON_ADDED_CLASS);
    button.disabled = true;
    button.setAttribute('aria-label', 'Article d?j? ajout? au panier');
    button.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i><span>Ajout&eacute;</span>';
    return;
  }
  button.dataset.addToCartState = STATE_DEFAULT;
  button.setAttribute('aria-label', button.dataset.addToCartDefaultAriaLabel || 'Ajouter au panier');
  if (button.dataset.addToCartDefaultHtml) {
    button.innerHTML = button.dataset.addToCartDefaultHtml;
  }
}

export function isAddToCartButtonAdded(button) {
  if (!button) return false;
  return button.dataset.addToCartState === STATE_ADDED;
}
