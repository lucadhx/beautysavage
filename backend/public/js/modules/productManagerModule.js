import { openEditorialEditor } from './editorialEditor.js';
import { fetchEditableContent, saveEditableContent } from './editableContentClient.js';

const API_ROOT = '/api/gestion/business';
const ENDPOINT = `${API_ROOT}/products`;
const EDITORIAL_API_ROOT = '/api/gestion/editable-content';

const state = {
  items: [],
  editingId: null,
  activePromotion: null
};

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Prix indisponible';
  return `${number.toFixed(2)} €`;
}

function roundToCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function calculateProductPromotionPreview(basePrice, discountType, discountValue) {
  const normalizedBase = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
  const normalizedDiscount = Number.isFinite(Number(discountValue)) ? Number(discountValue) : 0;
  let finalPrice = normalizedBase;
  if (
    normalizedDiscount > 0 &&
    (discountType === 'fixed' || discountType === 'percentage')
  ) {
    if (discountType === 'percentage') {
      finalPrice = normalizedBase - (normalizedBase * normalizedDiscount) / 100;
    } else {
      finalPrice = normalizedBase - normalizedDiscount;
    }
  }
  finalPrice = Math.max(0, roundToCents(finalPrice));
  return {
    basePrice: roundToCents(normalizedBase),
    finalPrice
  };
}

function formatPromotionLabel(promotion) {
  if (!promotion) return '';
  const valueLabel =
    promotion.discountType === 'percentage'
      ? `${promotion.discountValue}%`
      : formatPrice(promotion.discountValue);
  const start = promotion.startAt ? new Date(promotion.startAt).toLocaleString() : null;
  const end = promotion.endAt ? new Date(promotion.endAt).toLocaleString() : null;
  if (start && end) {
    return `${valueLabel} du ${start} au ${end}`;
  }
  if (end) {
    return `${valueLabel} jusqu'au ${end}`;
  }
  if (start) {
    return `${valueLabel} à partir du ${start}`;
  }
  return `${valueLabel} (promotion en cours)`;
}

function renderPromotionStatus(container, promotion) {
  if (!container) return;
  const target = container.querySelector('[data-product-promotion-status]');
  if (!target) return;
  if (!promotion) {
    target.textContent = 'Aucune promotion active.';
    target.removeAttribute('data-status');
    return;
  }
  target.textContent = formatPromotionLabel(promotion);
  target.dataset.status = 'success';
}

function updateProductPromotionPricePreview(container) {
  if (!container) return;
  const basePreview = container.querySelector('[data-product-promotion-preview-base]');
  const finalPreview = container.querySelector('[data-product-promotion-preview-final]');
  if (!basePreview && !finalPreview) return;
  const form = container.querySelector('[data-product-form]');
  const promotionForm = container.querySelector('[data-promotion-form]');
  const baseValue = form?.querySelector('[name="price"]')?.value;
  const discountType = promotionForm?.querySelector('[name="discountType"]')?.value;
  const discountValue = promotionForm?.querySelector('[name="discountValue"]')?.value;
  const preview = calculateProductPromotionPreview(baseValue, discountType, discountValue);
  if (basePreview) {
    basePreview.innerHTML = `Prix actuel : <s>${formatPrice(preview.basePrice)}</s>`;
  }
  if (finalPreview) {
    finalPreview.textContent = `Prix après réduction : ${formatPrice(preview.finalPrice)}`;
  }
}

function parseLocalDatetime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function updatePromotionMode(container, mode) {
  if (!container) return;
  const fields = container.querySelectorAll('[data-promotion-field]');
  fields.forEach(field => {
    const modes = String(field.dataset.promotionField || '')
      .split(' ')
      .map(entry => entry.trim())
      .filter(Boolean);
    const shouldShow = modes.length === 0 || modes.includes(mode);
    field.style.display = shouldShow ? '' : 'none';
  });
}

function getJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function showFeedback(target, message, status = '') {
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
}

async function fetchProducts() {
  const response = await fetch(ENDPOINT, { credentials: 'include' });
  const payload = await getJson(response);
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de charger les produits.');
  }
  state.items = Array.isArray(payload.products) ? payload.products : [];
}

function renderList(container) {
  const list = container.querySelector('[data-product-list]');
  if (!list) return;
  if (state.items.length === 0) {
    list.innerHTML = '<p class="module-placeholder">Aucun produit pour le moment.</p>';
    return;
  }
  list.innerHTML = state.items
    .map(item => {
      const statusClass = item.active ? 'badge badge-active' : 'badge badge-inactive';
      return `
        <article class="data-item">
          <div>
            <strong>${item.name}</strong>
            <p class="muted">${formatPrice(item.price)}</p>
            ${item.activePromotion ? `<p class="muted" data-product-promotion-summary>${formatPromotionLabel(item.activePromotion)}</p>` : ''}
            <p>
              <span class="${statusClass}">${item.active ? 'Actif' : 'Inactif'}</span>
              <small>${formatDate(item.createdAt)}</small>
            </p>
          </div>
          <div class="item-actions">
            <button data-action="edit" data-id="${item.id}">Modifier</button>
            <button type="button" data-action="edit-content" data-id="${item.id}">Description éditoriale</button>
            <button data-action="delete" data-id="${item.id}">Supprimer</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function resetForm(form, feedback) {
  if (!form) return;
  form.reset();
  const idField = form.querySelector('[name="id"]');
  if (idField) idField.value = '';
  const activeField = form.querySelector('[name="active"]');
  if (activeField) activeField.checked = true;
  const priceField = form.querySelector('[name="price"]');
  if (priceField) priceField.value = '';
  const descriptionField = form.querySelector('[name="description"]');
  if (descriptionField) descriptionField.value = '';
  const coverImageField = form.querySelector('[name="coverImage"]');
  if (coverImageField) coverImageField.value = '';
  const trailerVideoUrlField = form.querySelector('[name="trailerVideoUrl"]');
  if (trailerVideoUrlField) trailerVideoUrlField.value = '';
  const photosField = form.querySelector('[name="photos"]');
  if (photosField) photosField.value = '';
  state.editingId = null;
  showFeedback(feedback, '', '');
  resetPromotionForm(form.closest('[data-module-root]'));
}

function resetPromotionForm(container) {
  if (!container) return;
  const form = container.querySelector('[data-promotion-form]');
  const feedback = container.querySelector('[data-promotion-form-message]');
  if (!form) return;
  form.reset();
  updatePromotionMode(container, form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate');
  showFeedback(feedback, '', '');
  state.activePromotion = null;
  renderPromotionStatus(container, null);
  updateProductPromotionPricePreview(container);
}

async function handlePromotionSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const container = form.closest('[data-module-root]');
  const feedback = container?.querySelector('[data-promotion-form-message]');
  if (!state.editingId) {
    showFeedback(feedback, 'Sélectionnez un produit pour planifier une promotion.', 'error');
    return;
  }
  const discountType = form.querySelector('[name="discountType"]')?.value;
  const discountValue = Number(form.querySelector('[name="discountValue"]')?.value);
  if (!discountType || !Number.isFinite(discountValue) || discountValue <= 0) {
    showFeedback(feedback, 'Valeur de promotion invalide.', 'error');
    return;
  }
  if (discountType === 'percentage' && discountValue > 100) {
    showFeedback(feedback, 'Le pourcentage doit être entre 0 et 100.', 'error');
    return;
  }
  const mode = form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate';
  let startAt = null;
  let endAt = null;
  if (mode === 'limited') {
    endAt = parseLocalDatetime(form.querySelector('[name="endAt"]')?.value);
    if (!endAt) {
      showFeedback(feedback, 'Date de fin requise.', 'error');
      return;
    }
    startAt = new Date().toISOString();
  } else if (mode === 'scheduled') {
    startAt = parseLocalDatetime(form.querySelector('[name="startAt"]')?.value);
    if (!startAt) {
      showFeedback(feedback, 'Date de début requise.', 'error');
      return;
    }
    endAt = parseLocalDatetime(form.querySelector('[name="endAt"]')?.value);
    if (endAt && endAt <= startAt) {
      showFeedback(feedback, 'La fin doit suivre le début.', 'error');
      return;
    }
  } else {
    startAt = new Date().toISOString();
  }
  const payload = {
    targetType: 'product',
    targetId: state.editingId,
    discountType,
    discountValue,
    startAt
  };
  if (endAt) {
    payload.endAt = endAt;
  }
  try {
    const response = await fetch('/api/gestion/promotions', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await getJson(response);
    if (!response.ok) {
      showFeedback(feedback, data?.error || 'Impossible de sauvegarder la promotion.', 'error');
      return;
    }
    showFeedback(feedback, 'Promotion planifiée.', 'success');
    state.activePromotion = data?.promotion || null;
    renderPromotionStatus(container, state.activePromotion);
    updateProductPromotionPricePreview(container);
    await loadData(container);
  } catch (error) {
    console.error('Erreur promotion produit', error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

function attachPromotionFormEvents(container) {
  if (!container) return;
  const form = container.querySelector('[data-promotion-form]');
  if (!form) return;
  const modeInputs = form.querySelectorAll('[name="promotionMode"]');
  modeInputs.forEach(input => {
    input.addEventListener('change', () => updatePromotionMode(container, input.value));
  });
  const previewInputs = [
    form.querySelector('[name="discountType"]'),
    form.querySelector('[name="discountValue"]')
  ];
  previewInputs.forEach(input => {
    input?.addEventListener('input', () => updateProductPromotionPricePreview(container));
  });
  form.addEventListener('submit', handlePromotionSubmit);
  updatePromotionMode(container, form.querySelector('[name="promotionMode"]:checked')?.value || 'immediate');
  updateProductPromotionPricePreview(container);
}

function fillForm(container, item) {
  const form = container.querySelector('[data-product-form]');
  const feedback = container.querySelector('[data-product-form-message]');
  if (!form || !item) return;
  const idField = form.querySelector('[name="id"]');
  const nameField = form.querySelector('[name="name"]');
  const activeField = form.querySelector('[name="active"]');
  const descriptionField = form.querySelector('[name="description"]');
  const priceField = form.querySelector('[name="price"]');
  const coverField = form.querySelector('[name="coverImage"]');
  const videoField = form.querySelector('[name="trailerVideoUrl"]');
  const photosField = form.querySelector('[name="photos"]');
  if (idField) idField.value = item.id || '';
  if (nameField) nameField.value = item.name || '';
  if (activeField) activeField.checked = Boolean(item.active);
  if (descriptionField) descriptionField.value = item.description || '';
  if (priceField) priceField.value = item.price ?? '';
  if (coverField) coverField.value = item.coverImage || '';
  if (videoField) videoField.value = item.trailerVideoUrl || '';
  if (photosField) {
    photosField.value = Array.isArray(item.photos) ? item.photos.join('\n') : '';
  }
  state.editingId = item.id;
  showFeedback(feedback, 'Modification en cours.', 'info');
  state.activePromotion = item.activePromotion || null;
  renderPromotionStatus(container, state.activePromotion);
  updateProductPromotionPricePreview(container);
}

async function handleDelete(container, id) {
  if (!id) return;
  const feedback = container.querySelector('[data-product-form-message]');
  try {
    const response = await fetch(`${ENDPOINT}/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const payload = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, payload?.error || 'Impossible de supprimer.', 'error');
    }
    if (state.editingId === id) {
      resetForm(container.querySelector('[data-product-form]'), feedback);
    }
    showFeedback(feedback, 'Produit supprimé.', 'success');
    await loadData(container);
  } catch (error) {
    console.error('Erreur suppression produit', error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!form) return;
  const container = form.closest('[data-module-root]');
  const feedback = container?.querySelector('[data-product-form-message]');
  const nameField = form.querySelector('[name="name"]');
  const activeField = form.querySelector('[name="active"]');
  const idField = form.querySelector('[name="id"]');
  const description = form.querySelector('[name="description"]')?.value || '';
  const priceValue = Number(form.querySelector('[name="price"]')?.value);
  const price = Number.isFinite(priceValue) ? priceValue : 0;
  const coverImage = form.querySelector('[name="coverImage"]')?.value || '';
  const video = form.querySelector('[name="trailerVideoUrl"]')?.value || '';
  const photos = form.querySelector('[name="photos"]')?.value || '';
  const name = nameField ? String(nameField.value || '').trim() : '';
  const active = activeField ? activeField.checked : true;
  if (!name) {
    return showFeedback(feedback, 'Nom requis.', 'error');
  }
  const isEditing = Boolean(idField?.value);
  const endpoint = isEditing ? `${ENDPOINT}/${idField.value}` : ENDPOINT;
  try {
    const response = await fetch(endpoint, {
      method: isEditing ? 'PUT' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      description,
      price,
      coverImage,
      trailerVideoUrl: video,
      photos,
      active
    })
    });
    const payload = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, payload?.error || 'Impossible de sauvegarder.', 'error');
    }
    showFeedback(feedback, isEditing ? 'Produit mis à jour.' : 'Produit créé.', 'success');
    resetForm(form, feedback);
    await loadData(container);
  } catch (error) {
    console.error('Erreur sauvegarde produit', error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

function attachListActions(container) {
  const list = container.querySelector('[data-product-list]');
  if (!list) return;
  const feedback = container.querySelector('[data-product-form-message]');
  list.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('click', event => {
      const id = event.currentTarget.dataset.id;
      const action = event.currentTarget.dataset.action;
      const item = state.items.find(entry => entry.id === id);
      if (action === 'edit' && item) {
        fillForm(container, item);
      }
      if (action === 'edit-content' && item) {
        openProductEditorial(container, item);
      }
      if (action === 'delete') {
        handleDelete(container, id);
      }
    });
  });
  if (feedback && state.items.length === 0) {
    showFeedback(feedback, '', '');
  }
}

async function openProductEditorial(container, product) {
  try {
    const payload = await fetchEditableContent('product', product.id);
    const zone = Array.isArray(payload?.zones) && payload.zones.length
      ? payload.zones[0]
      : { key: 'description', label: 'Description éditoriale', description: '' };
    const entry = Array.isArray(payload?.entries)
      ? payload.entries.find(entry => entry.zoneKey === zone.key)
      : null;
    openEditorialEditor({
      title: zone.label,
      description: zone.description || 'Ce texte sera affiché sous le titre du produit.',
      label: `${product.name} · ${zone.label}`,
      initialHtml: entry?.contentHtml || product.description || '',
      onSave: html => saveProductEditorial(product.id, zone.key, html, container)
    });
  } catch (error) {
    console.error('Erreur chargement contenu éditorial', error);
    showFeedback(container?.querySelector('[data-product-form-message]'), 'Impossible de charger le contenu éditorial.', 'error');
  }
}

async function saveProductEditorial(targetId, zoneKey, html, container) {
  await saveEditableContent('product', targetId, zoneKey, html);
  showFeedback(container?.querySelector('[data-product-form-message]'), 'Description éditoriale mise à jour.', 'success');
  await loadData(container);
}

async function loadData(container) {
  const list = container.querySelector('[data-product-list]');
  try {
    await fetchProducts();
    renderList(container);
    attachListActions(container);
    if (state.editingId) {
      const selected = state.items.find(entry => entry.id === state.editingId);
      if (selected) {
        fillForm(container, selected);
      } else {
        resetForm(container.querySelector('[data-product-form]'), container?.querySelector('[data-product-form-message]'));
      }
    }
  } catch (error) {
    console.error('Erreur chargement produits', error);
    if (list) {
      list.innerHTML = '<p class="module-placeholder">Impossible de charger les produits.</p>';
    }
  }
}

export async function renderModule(container) {
  container.innerHTML = `
    <section class="module-panel" data-module-root>
      <header>
        <h2>Produits</h2>
        <p>Module basique pour créer des produits utilisables dans la vitrine.</p>
      </header>
      <div class="manager-section">
        <div class="section-header">
          <h3>Catalogue</h3>
        </div>
        <div data-product-list class="data-list"></div>
        <form data-product-form class="manager-form">
          <input type="hidden" name="id">
          <label>
            Nom
            <input name="name" required placeholder="Ex : Edition studio">
          </label>
          <label>
            Description
            <textarea name="description" rows="2" placeholder="Résumé du produit"></textarea>
          </label>
          <label>
            Prix (€)
            <input name="price" type="number" min="0" step="0.01" placeholder="0.00">
          </label>
          <label>
            Image de couverture (URL)
            <input name="coverImage" type="url" placeholder="https://...">
          </label>
          <label>
            Vidéo bande-annonce (iframe URL)
            <input name="trailerVideoUrl" type="url" placeholder="https://player.vimeo.com/...">
          </label>
          <label>
            Photos (une URL par ligne)
            <textarea name="photos" rows="2" placeholder="https://..."></textarea>
          </label>
          <label class="checkbox-field">
            <input type="checkbox" name="active" checked>
            Actif
          </label>
          <button class="primary-button" type="submit">Enregistrer</button>
        </form>
        <p data-product-form-message class="form-message"></p>
      </div>
      <section class="manager-section">
      <div class="section-header">
        <h3>Promotions</h3>
      </div>
      <p data-product-promotion-status class="form-message muted">Aucune promotion active.</p>
      <div class="promotion-price-preview">
        <p class="muted" data-product-promotion-preview-base>Prix actuel : <s>--</s></p>
        <p class="muted" data-product-promotion-preview-final>Prix après réduction : --</p>
      </div>
      <form data-promotion-form class="manager-form">
          <label>
            Type de remise
            <select name="discountType">
              <option value="percentage">Pourcentage</option>
              <option value="fixed">Montant fixe</option>
            </select>
          </label>
          <label>
            Valeur
            <input name="discountValue" type="number" min="0" step="0.01" placeholder="Ex : 15">
          </label>
          <div class="form-actions">
            <label class="radio-field">
              <input type="radio" name="promotionMode" value="immediate" checked>
              Immédiate (sans date de fin)
            </label>
            <label class="radio-field">
              <input type="radio" name="promotionMode" value="limited">
              Jusqu'à une date de fin
            </label>
            <label class="radio-field">
              <input type="radio" name="promotionMode" value="scheduled">
              À partir d'une date
            </label>
          </div>
          <label data-promotion-field="scheduled">
            Date de début
            <input name="startAt" type="datetime-local">
          </label>
          <label data-promotion-field="limited scheduled">
            Date de fin
            <input name="endAt" type="datetime-local">
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">Planifier la promotion</button>
          </div>
        </form>
        <p data-promotion-form-message class="form-message"></p>
      </section>
    </section>
  `;
  container.querySelector('[data-product-form]')?.addEventListener('submit', handleSubmit);
  const priceInput = container.querySelector('[data-product-form] [name="price"]');
  priceInput?.addEventListener('input', () => updateProductPromotionPricePreview(container));
  attachPromotionFormEvents(container);
  await loadData(container);
}
