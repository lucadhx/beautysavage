const EDITABLE_PAGE_ENDPOINT = '/api/vitrine/editable-content';

async function parseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

export async function loadEditablePageContent(targetId, options = {}) {
  const normalizedTarget = String(targetId || '').trim();
  const targetType = String(options.targetType || 'page').trim().toLowerCase();
  const params = new URLSearchParams({
    targetType,
    targetId: normalizedTarget
  });
  if (options.zoneKey) {
    params.set('zoneKey', String(options.zoneKey || '').trim());
  }
  const response = await fetch(`${EDITABLE_PAGE_ENDPOINT}?${params.toString()}`);
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de charger le contenu éditorial.');
  }
  return {
    content: payload.content || {},
    zones: Array.isArray(payload.zones) ? payload.zones : []
  };
}
