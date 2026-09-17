export function logUiError(context, error, extra = null) {
  const safeContext = String(context || 'UI');
  console.groupCollapsed(`[UI] ${safeContext} - Echec`);
  console.error(error);
  if (extra !== null && extra !== undefined) {
    console.log('extra', extra);
  }
  console.groupEnd();
}
