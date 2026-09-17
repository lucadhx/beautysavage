const API_ROOT = '/api/gestion/vitrine';

const state = {
  pages: [],
  menu: [],
  editingPageId: null,
  editingMenuId: null
};

function getJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function showFeedback(el, message, status = 'info') {
  if (!el) return;
  el.textContent = message;
  el.dataset.status = status;
}

function buildAccessTag(access) {
  const flags = [];
  if (access?.public) flags.push('Public');
  if (access?.requiresAuth) flags.push('Auth');
  if (access?.requiresPurchase) flags.push('Payant');
  return flags.map(flag => `<span class="badge">${flag}</span>`).join(' ');
}

async function fetchPages() {
  const response = await fetch(`${API_ROOT}/pages`, { credentials: 'include' });
  if (!response.ok) throw new Error('Impossible de charger les pages.');
  const payload = await response.json();
  state.pages = Array.isArray(payload.pages) ? payload.pages : [];
}

async function fetchMenu() {
  const response = await fetch(`${API_ROOT}/menu`, { credentials: 'include' });
  if (!response.ok) throw new Error('Impossible de charger le menu.');
  const payload = await response.json();
  state.menu = Array.isArray(payload.menu) ? payload.menu : [];
}

function renderList(items, container, type) {
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<p class="module-placeholder">Aucun élément pour le moment.</p>';
    return;
  }
  container.innerHTML = items
    .map(item => {
      if (type === 'page') {
        return `
          <article class="data-item">
            <div>
              <strong>${item.slug}</strong>
              <p>Module : ${item.moduleFile} · Ordre : ${item.order}</p>
              <div class="access-tags">${buildAccessTag(item.access)}</div>
            </div>
            <div class="item-actions">
              <button data-action="edit-page" data-id="${item.id}">Modifier</button>
              <button data-action="delete-page" data-id="${item.id}">Supprimer</button>
            </div>
          </article>
        `;
      }
      return `
        <article class="data-item">
          <div>
            <strong>${item.label}</strong>
            <p>Slug : ${item.slug} · Ordre : ${item.order}</p>
            <div class="access-tags">${buildAccessTag(item.access)}</div>
          </div>
          <div class="item-actions">
            <button data-action="edit-menu" data-id="${item.id}">Modifier</button>
            <button data-action="delete-menu" data-id="${item.id}">Supprimer</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function populateAccessInputs(form, record = {}) {
  ['public', 'requiresAuth', 'requiresPurchase'].forEach(name => {
    const checkbox = form.querySelector(`[name="${name}"]`);
    if (checkbox) {
      checkbox.checked = Boolean(record.access && record.access[name]);
    }
  });
}

function resetForm(form, feedback, isPage = true) {
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  showFeedback(feedback, '');
  if (isPage) state.editingPageId = null;
  else state.editingMenuId = null;
}

function fillPageForm(page) {
  const form = document.querySelector('[data-page-form]');
  if (!form) return;
  form.querySelector('[name="id"]').value = page.id || '';
  form.querySelector('[name="slug"]').value = page.slug || '';
  form.querySelector('[name="moduleFile"]').value = page.moduleFile || '';
  form.querySelector('[name="order"]').value = page.order ?? 0;
  populateAccessInputs(form, page);
  state.editingPageId = page.id;
}

function fillMenuForm(item) {
  const form = document.querySelector('[data-menu-form]');
  if (!form) return;
  form.querySelector('[name="id"]').value = item.id || '';
  form.querySelector('[name="label"]').value = item.label || '';
  form.querySelector('[name="slug"]').value = item.slug || '';
  form.querySelector('[name="order"]').value = item.order ?? 0;
  populateAccessInputs(form, item);
  state.editingMenuId = item.id;
}

async function handlePageSubmission(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = document.querySelector('[data-page-form-message]');
  const data = new FormData(form);
  const payload = {
    slug: data.get('slug')?.trim(),
    moduleFile: data.get('moduleFile')?.trim(),
    order: Number(data.get('order')) || 0,
    public: data.get('public') === 'on',
    requiresAuth: data.get('requiresAuth') === 'on',
    requiresPurchase: data.get('requiresPurchase') === 'on'
  };
  if (!payload.slug || !payload.moduleFile) {
    return showFeedback(feedback, 'Slug et moduleFile obligatoires.', 'error');
  }
  const editId = form.querySelector('[name="id"]').value;
  const method = editId ? 'PUT' : 'POST';
  const endpoint = editId ? `${API_ROOT}/pages/${editId}` : `${API_ROOT}/pages`;
  try {
    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible de sauvegarder la page.', 'error');
    }
    await loadData();
    resetForm(form, feedback, true);
    showFeedback(feedback, editId ? 'Page mise à jour.' : 'Page créée.', 'success');
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function handleMenuSubmission(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = document.querySelector('[data-menu-form-message]');
  const data = new FormData(form);
  const payload = {
    label: data.get('label')?.trim(),
    slug: data.get('slug')?.trim(),
    order: Number(data.get('order')) || 0,
    public: data.get('public') === 'on',
    requiresAuth: data.get('requiresAuth') === 'on',
    requiresPurchase: data.get('requiresPurchase') === 'on'
  };
  if (!payload.label || !payload.slug) {
    return showFeedback(feedback, 'Label et slug obligatoires.', 'error');
  }
  const editId = form.querySelector('[name="id"]').value;
  const method = editId ? 'PUT' : 'POST';
  const endpoint = editId ? `${API_ROOT}/menu/${editId}` : `${API_ROOT}/menu`;
  try {
    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible de sauver le menu.', 'error');
    }
    await loadData();
    resetForm(form, feedback, false);
    showFeedback(feedback, editId ? 'Menu mis à jour.' : 'Menu créé.', 'success');
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function deleteEntity(type, id, feedback) {
  if (!id) return;
  const endpoint = `${API_ROOT}/${type}/${id}`;
  try {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      credentials: 'include'
    });
    const body = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, body?.error || 'Impossible de supprimer.', 'error');
    }
    await loadData();
    showFeedback(feedback, 'Supprimé.', 'success');
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

function attachListActions() {
  const pageList = document.querySelector('[data-page-list]');
  const menuList = document.querySelector('[data-menu-list]');
  const pageFeedback = document.querySelector('[data-page-form-message]');
  const menuFeedback = document.querySelector('[data-menu-form-message]');

  if (pageList) {
    pageList.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', event => {
        const action = event.currentTarget.dataset.action;
        const id = event.currentTarget.dataset.id;
        const item = state.pages.find(page => page.id === id);
        if (action === 'edit-page' && item) fillPageForm(item);
        if (action === 'delete-page') deleteEntity('pages', id, pageFeedback);
      });
    });
  }
  if (menuList) {
    menuList.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', event => {
        const action = event.currentTarget.dataset.action;
        const id = event.currentTarget.dataset.id;
        const item = state.menu.find(menu => menu.id === id);
        if (action === 'edit-menu' && item) fillMenuForm(item);
        if (action === 'delete-menu') deleteEntity('menu', id, menuFeedback);
      });
    });
  }
}

async function loadData() {
  try {
    await Promise.all([fetchPages(), fetchMenu()]);
    renderList(state.pages, document.querySelector('[data-page-list]'), 'page');
    renderList(state.menu, document.querySelector('[data-menu-list]'), 'menu');
    attachListActions();
  } catch (error) {
    const target = document.querySelector('[data-page-list]');
    const fallback = document.querySelector('[data-menu-list]');
    showFeedback(target, 'Impossible de charger les données.', 'error');
    if (fallback) showFeedback(fallback, 'Impossible de charger les données.', 'error');
  }
}

export async function renderModule(container) {
  container.innerHTML = `
    <div class="vitrine-manager">
      <header>
        <h2>Gestion vitrine</h2>
        <p>Modifiez les pages et le menu directement depuis le dashboard.</p>
      </header>
      <div class="vitrine-manager-grid">
        <section class="manager-section">
          <div class="section-header">
            <h3>Pages vitrines</h3>
          </div>
          <div data-page-list class="data-list"></div>
          <form data-page-form class="manager-form">
            <input type="hidden" name="id">
            <label>
              Slug
              <input name="slug" placeholder="home" required>
            </label>
            <label>
              Module JS
              <input name="moduleFile" placeholder="homeModule.js" required>
            </label>
            <label>
              Ordre
              <input name="order" type="number" value="0" min="0">
            </label>
            <fieldset class="checkbox-group">
              <legend>Accès</legend>
              <label class="checkbox-field"><input type="checkbox" name="public"> Public</label>
              <label class="checkbox-field"><input type="checkbox" name="requiresAuth"> Authentifié</label>
              <label class="checkbox-field"><input type="checkbox" name="requiresPurchase"> Achat requis</label>
            </fieldset>
            <button class="primary-button" type="submit">Enregistrer la page</button>
          </form>
          <p data-page-form-message class="form-message"></p>
        </section>
        <section class="manager-section">
          <div class="section-header">
            <h3>Menu vitrine</h3>
          </div>
          <div data-menu-list class="data-list"></div>
          <form data-menu-form class="manager-form">
            <input type="hidden" name="id">
            <label>
              Label
              <input name="label" placeholder="Accueil" required>
            </label>
            <label>
              Slug associé
              <input name="slug" placeholder="home" required>
            </label>
            <label>
              Ordre
              <input name="order" type="number" value="0" min="0">
            </label>
            <fieldset class="checkbox-group">
              <legend>Accès</legend>
              <label class="checkbox-field"><input type="checkbox" name="public"> Public</label>
              <label class="checkbox-field"><input type="checkbox" name="requiresAuth"> Authentifié</label>
              <label class="checkbox-field"><input type="checkbox" name="requiresPurchase"> Achat requis</label>
            </fieldset>
            <button class="primary-button" type="submit">Enregistrer le menu</button>
          </form>
          <p data-menu-form-message class="form-message"></p>
        </section>
      </div>
    </div>
  `;
  document.querySelector('[data-page-form]')?.addEventListener('submit', handlePageSubmission);
  document.querySelector('[data-menu-form]')?.addEventListener('submit', handleMenuSubmission);
  await loadData();
}
