const LEGACY_CART_STORAGE_KEY = 'beautysavage_cart';
const CART_STORAGE_PREFIX = 'cart:';
const ANON_CART_SCOPE = 'anon';
const CART_SNAPSHOT_ENDPOINT = '/api/client/cart-snapshot';

let localStorageRef = null;
let storageAvailable = false;
if (typeof window !== 'undefined') {
  try {
    localStorageRef = window.localStorage;
    const testKey = '__beautysavage_cart_test__';
    localStorageRef.setItem(testKey, testKey);
    localStorageRef.removeItem(testKey);
    storageAvailable = true;
  } catch (_error) {
    storageAvailable = false;
    localStorageRef = null;
  }
}

let activeScope = ANON_CART_SCOPE;
const memoryCartByScope = new Map([[ANON_CART_SCOPE, []]]);
let legacyMigrated = false;

function emitCartUpdate(detail = {}) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('cart:updated', { detail }));
  }
}

function parseStoredValue(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Keep silent in production flows.
  }
  return [];
}

function sanitizeScopeToken(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9@._-]/g, '');
}

function normalizeScope(scope) {
  const normalized = String(scope || '').trim().toLowerCase();
  if (!normalized || normalized === ANON_CART_SCOPE) return ANON_CART_SCOPE;
  if (normalized.startsWith('user:')) return normalized;
  return `user:${sanitizeScopeToken(normalized)}`;
}

function getStorageKeyForScope(scope) {
  const normalizedScope = normalizeScope(scope);
  return `${CART_STORAGE_PREFIX}${normalizedScope}`;
}

function getScopeFromUser(user) {
  const userId = String(user?.id || user?._id || user?.userId || '').trim();
  if (userId) return `user:${sanitizeScopeToken(userId)}`;
  const email = String(user?.email || '').trim().toLowerCase();
  if (email) return `user:${sanitizeScopeToken(email)}`;
  return ANON_CART_SCOPE;
}

function readScopedCart(scope) {
  const normalizedScope = normalizeScope(scope);
  if (storageAvailable && localStorageRef) {
    const key = getStorageKeyForScope(normalizedScope);
    const raw = localStorageRef.getItem(key);
    return parseStoredValue(raw);
  }
  return [...(memoryCartByScope.get(normalizedScope) || [])];
}

function writeScopedMemory(scope, entries = []) {
  memoryCartByScope.set(normalizeScope(scope), [...entries]);
}

function migrateLegacyCartIfNeeded() {
  if (!storageAvailable || !localStorageRef || legacyMigrated) return;
  legacyMigrated = true;
  const legacyRaw = localStorageRef.getItem(LEGACY_CART_STORAGE_KEY);
  if (!legacyRaw) return;
  const anonKey = getStorageKeyForScope(ANON_CART_SCOPE);
  const hasAnon = Boolean(localStorageRef.getItem(anonKey));
  if (!hasAnon) {
    const legacyItems = parseStoredValue(legacyRaw);
    if (legacyItems.length) {
      localStorageRef.setItem(anonKey, JSON.stringify(legacyItems));
    }
  }
  localStorageRef.removeItem(LEGACY_CART_STORAGE_KEY);
}

function loadActiveCart() {
  migrateLegacyCartIfNeeded();
  const scoped = readScopedCart(activeScope);
  writeScopedMemory(activeScope, scoped);
  return scoped;
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || entry.itemId || '').trim();
  if (!id) return null;
  const type = entry.type === 'product' ? 'product' : 'formation';
  const sessionId = entry.sessionId ? String(entry.sessionId).trim() : null;
  const name = String(entry.name || entry.label || '').trim();
  const price = Number.isFinite(Number(entry.price)) ? Number(entry.price) : 0;
  return {
    type,
    id,
    sessionId,
    selected: entry.selected !== false,
    name,
    price
  };
}

async function syncCartSnapshot(entries) {
  if (typeof window === 'undefined') return;
  if (activeScope === ANON_CART_SCOPE) return;
  if (!Array.isArray(entries)) return;
  const payload = entries
    .map(entry => ({
      type: entry.type,
      itemId: entry.id,
      name: entry.name || '',
      price: entry.price || 0,
      sessionId: entry.sessionId || null
    }));
  try {
    await fetch(CART_SNAPSHOT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ items: payload })
    });
  } catch (error) {
    console.error('Erreur snapshot panier', error);
  }
}

function persistCart(entries, options = {}) {
  const normalized = Array.isArray(entries) ? entries.map(entry => normalizeEntry(entry)).filter(Boolean) : [];
  writeScopedMemory(activeScope, normalized);
  if (storageAvailable && localStorageRef) {
    const key = getStorageKeyForScope(activeScope);
    if (!normalized.length) {
      localStorageRef.removeItem(key);
    } else {
      try {
        localStorageRef.setItem(key, JSON.stringify(normalized));
      } catch (error) {
        console.warn('Impossible de sauvegarder le panier', error);
      }
    }
  }
  void syncCartSnapshot(normalized);
  emitCartUpdate({ count: normalized.length, action: options.action || null, scope: activeScope });
  return normalized;
}

function normalizeInput(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const rawType = String(item.type || '').toLowerCase();
  const type = rawType === 'product' || rawType === 'formation' ? rawType : null;
  if (!type) {
    return null;
  }
  const id = String(item.id || '').trim();
  if (!id) {
    return null;
  }
  return {
    type,
    id,
    sessionId: item.sessionId ? String(item.sessionId).trim() : null,
    selected: item.selected !== false,
    name: String(item.name || item.label || '').trim(),
    price: Number.isFinite(Number(item.price)) ? Number(item.price) : 0,
    selectedOptions: Array.isArray(item.selectedOptions)
      ? item.selectedOptions.filter(o => o && String(o.optionId || '').trim())
      : []
  };
}

export function getItems() {
  return loadActiveCart();
}

export function getActiveCartStorageKey() {
  return getStorageKeyForScope(activeScope);
}

export function isCartStorageEvent(event) {
  const key = String(event?.key || '').trim();
  if (!key) return true;
  if (key === LEGACY_CART_STORAGE_KEY) return true;
  if (key === getActiveCartStorageKey()) return true;
  return key.startsWith(CART_STORAGE_PREFIX);
}

export function setCartUser(user = null, options = {}) {
  const nextScope = normalizeScope(getScopeFromUser(user));
  const sameScope = nextScope === activeScope;
  if (sameScope && !options.forceReload) {
    return getItems();
  }
  activeScope = nextScope;
  const scopedItems = loadActiveCart();
  if (options.sync !== false) {
    void syncCartSnapshot(scopedItems);
  }
  if (options.emit !== false) {
    emitCartUpdate({
      count: scopedItems.length,
      action: 'scope-change',
      scope: activeScope
    });
  }
  return [...scopedItems];
}

export function addItem(rawItem) {
  const normalized = normalizeInput(rawItem);
  if (!normalized) return false;
  const current = loadActiveCart();
  const existingIndex = current.findIndex(
    entry => entry.type === normalized.type && entry.id === normalized.id
  );
  if (existingIndex >= 0) {
    const updated = { ...current[existingIndex], ...normalized, selected: true };
    current[existingIndex] = updated;
  } else {
    current.push(normalized);
  }
  persistCart(current, { action: 'add' });
  return true;
}

export function removeItem(itemId) {
  const targetId = String(itemId || '').trim();
  if (!targetId) return false;
  const current = loadActiveCart();
  const filtered = current.filter(entry => entry.id !== targetId);
  if (filtered.length === current.length) return false;
  persistCart(filtered, { action: 'remove' });
  return true;
}

export function toggleSelect(itemId) {
  const targetId = String(itemId || '').trim();
  if (!targetId) return false;
  const current = loadActiveCart();
  const index = current.findIndex(entry => entry.id === targetId);
  if (index < 0) return false;
  current[index] = {
    ...current[index],
    selected: !current[index].selected
  };
  persistCart(current, { action: 'toggle' });
  return true;
}

export function getSelectedItems() {
  return loadActiveCart().filter(entry => entry.selected);
}

export function clearCart() {
  persistCart([], { action: 'clear' });
}
