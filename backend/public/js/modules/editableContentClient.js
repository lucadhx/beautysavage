const EDITORIAL_API_ROOT = '/api/gestion/editable-content';

async function parseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

export async function fetchEditableContent(targetType, targetId) {
  const params = new URLSearchParams({ targetType, targetId });
  const response = await fetch(`${EDITORIAL_API_ROOT}?${params.toString()}`, {
    credentials: 'include'
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de charger le contenu éditorial.');
  }
  return payload;
}

export async function saveEditableContent(targetType, targetId, zoneKey, contentHtml) {
  const response = await fetch(EDITORIAL_API_ROOT, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetType,
      targetId,
      zoneKey,
      contentHtml
    })
  });
  const payload = await parseJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de sauvegarder le contenu éditorial.');
  }
  return payload;
}
