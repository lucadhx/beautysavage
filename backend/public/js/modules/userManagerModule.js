const API_ROOT = '/api/gestion/users';
const ROLES = [
  { value: 'client', label: 'Client' },
  { value: 'admin', label: 'Admin' },
  { value: 'dev', label: 'Dev' }
];

const state = {
  users: [],
  currentUserId: null,
  editingId: null
};

function getJson(response) {
  return response.json ? response.json() : Promise.resolve({});
}

function showFeedback(element, message, status = 'info') {
  if (!element) return;
  element.textContent = message || '';
  if (!message) {
    element.removeAttribute('data-status');
    return;
  }
  element.dataset.status = status;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function buildUserItem(user) {
  const activeLabel = user.isActive ? 'Actif' : 'Inactif';
  return `
    <article class="data-item">
      <div>
        <strong>${user.email}</strong>
        <p>
          Rôle : ${user.role} · Inscrit ${formatDate(user.createdAt)}
        </p>
        <p class="muted">
          Dernière connexion : ${user.lastLogin ? formatDate(user.lastLogin) : '—'}
        </p>
        <div class="access-tags">
          <span class="badge ${user.isActive ? 'badge--success' : 'badge--muted'}">${activeLabel}</span>
        </div>
      </div>
      <div class="item-actions">
        <button type="button" class="secondary-button" data-action="edit-user" data-id="${user.id}">Modifier</button>
      </div>
    </article>
  `;
}

function renderUserList(container) {
  if (!container) return;
  if (!state.users.length) {
    container.innerHTML = '<p class="module-placeholder">Aucun utilisateur enregistré.</p>';
    return;
  }
  container.innerHTML = state.users.map(buildUserItem).join('');
  attachUserActions(container);
}

function attachUserActions(container) {
  const buttons = container.querySelectorAll('[data-action="edit-user"]');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const userId = button.dataset.id;
      const user = state.users.find(item => item.id === userId);
      if (user) {
        fillEditForm(user);
      }
    });
  });
}

function fillEditForm(user) {
  const form = document.querySelector('[data-user-edit-form]');
  if (!form) return;
  form.querySelector('[name="id"]').value = user.id || '';
  form.querySelector('[name="email"]').value = user.email || '';
  const roleSelect = form.querySelector('[name="role"]');
  if (roleSelect) {
    roleSelect.value = user.role || 'client';
    const disableRole = user.id === state.currentUserId;
    roleSelect.disabled = disableRole;
    const note = form.querySelector('[data-self-role-note]');
    if (note) {
      note.textContent = disableRole ? 'Vous ne pouvez pas modifier votre propre rôle.' : '';
    }
  }
  const activeInput = form.querySelector('[name="active"]');
  if (activeInput) {
    activeInput.checked = Boolean(user.isActive);
  }
  state.editingId = user.id;
}

function resetEditForm() {
  const form = document.querySelector('[data-user-edit-form]');
  if (!form) return;
  form.reset();
  form.querySelector('[name="id"]').value = '';
  const roleSelect = form.querySelector('[name="role"]');
  if (roleSelect) {
    roleSelect.disabled = false;
  }
  const note = form.querySelector('[data-self-role-note]');
  if (note) {
    note.textContent = '';
  }
  state.editingId = null;
  showFeedback(form.querySelector('[data-user-edit-feedback]'), '');
}

async function fetchUsers() {
  try {
    const response = await fetch(API_ROOT, { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Impossible de charger la liste des utilisateurs.');
    }
    const payload = await getJson(response);
    state.users = Array.isArray(payload.users) ? payload.users : [];
  } catch (error) {
    console.error(error);
    state.users = [];
  }
}

async function loadCurrentUser() {
  try {
    const response = await fetch('/auth/me', { credentials: 'include' });
    if (!response.ok) return null;
    const payload = await getJson(response);
    state.currentUserId = payload?.user?.id || null;
  } catch (error) {
    console.error("Impossible de charger l'utilisateur courant", error);
    state.currentUserId = null;
  }
}

async function refreshData(listContainer) {
  await Promise.all([loadCurrentUser(), fetchUsers()]);
  renderUserList(listContainer);
}

async function handleUserCreation(event) {
  event.preventDefault();
  const form = event.target;
  if (!form) return;
  const feedback = form.querySelector('[data-user-create-feedback]');
  const email = (form.querySelector('[name="email"]')?.value || '').trim();
  const password = form.querySelector('[name="password"]')?.value;
  const role = form.querySelector('[name="role"]')?.value;
  if (!email || !password || !role) {
    return showFeedback(feedback, 'Email, mot de passe et rôle requis.', 'error');
  }
  try {
    const response = await fetch(API_ROOT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    const payload = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, payload?.error || "Impossible de créer l'utilisateur.", 'error');
    }
    form.reset();
    showFeedback(feedback, 'Utilisateur créé.', 'success');
    await refreshData(document.querySelector('[data-user-list]'));
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

async function handleUserEdit(event) {
  event.preventDefault();
  const form = event.target;
  if (!form) return;
  const feedback = form.querySelector('[data-user-edit-feedback]');
  const id = form.querySelector('[name="id"]')?.value;
  const email = (form.querySelector('[name="email"]')?.value || '').trim();
  if (!id || !email) {
    return showFeedback(feedback, 'Identifiant et email requis.', 'error');
  }
  const payload = { email };
  const roleSelect = form.querySelector('[name="role"]');
  if (roleSelect && !roleSelect.disabled) {
    payload.role = roleSelect.value;
  }
  const activeInput = form.querySelector('[name="active"]');
  if (activeInput) {
    payload.active = activeInput.checked;
  }
  try {
    const response = await fetch(`${API_ROOT}/${id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const payloadJson = await getJson(response);
    if (!response.ok) {
      return showFeedback(feedback, payloadJson?.error || 'Impossible de mettre à jour.', 'error');
    }
    showFeedback(feedback, 'Utilisateur mis à jour.', 'success');
    await refreshData(document.querySelector('[data-user-list]'));
    resetEditForm();
  } catch (error) {
    console.error(error);
    showFeedback(feedback, 'Erreur réseau.', 'error');
  }
}

export async function renderModule(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="vitrine-manager">
      <header>
        <h2>Utilisateurs</h2>
        <p>Gérez les comptes internes (clients, admin, dev) depuis la gestion.</p>
      </header>
      <section class="manager-section">
        <div class="section-header">
          <h3>Liste des utilisateurs</h3>
        </div>
        <div data-user-list class="data-list"></div>
      </section>
      <section class="manager-section">
        <div class="section-header">
          <h3>Créer un utilisateur</h3>
        </div>
        <form data-user-create-form class="manager-form">
          <label>
            Email
            <input name="email" type="email" placeholder="ex : nom@domaine.fr" required>
          </label>
          <label>
            Mot de passe
            <input name="password" type="password" minlength="8" required>
          </label>
          <label>
            Rôle
            <select name="role">
              ${ROLES.map(role => `<option value="${role.value}">${role.label}</option>`).join('')}
            </select>
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">Créer</button>
          </div>
        </form>
        <p data-user-create-feedback class="form-message"></p>
      </section>
      <section class="manager-section">
        <div class="section-header">
          <h3>Modifier un utilisateur</h3>
        </div>
        <form data-user-edit-form class="manager-form">
          <input type="hidden" name="id">
          <label>
            Email
            <input name="email" type="email" required>
          </label>
          <label>
            Rôle
            <select name="role">
              ${ROLES.map(role => `<option value="${role.value}">${role.label}</option>`).join('')}
            </select>
            <small data-self-role-note class="muted"></small>
          </label>
          <label>
            <input type="checkbox" name="active" checked>
            Actif
          </label>
          <div class="form-actions">
            <button class="primary-button" type="submit">Enregistrer</button>
            <button type="button" class="secondary-button" data-action="reset-edit-form">Annuler</button>
          </div>
        </form>
        <p data-user-edit-feedback class="form-message"></p>
      </section>
    </div>
  `;
  const listContainer = container.querySelector('[data-user-list]');
  const createForm = container.querySelector('[data-user-create-form]');
  const editForm = container.querySelector('[data-user-edit-form]');
  createForm?.addEventListener('submit', handleUserCreation);
  editForm?.addEventListener('submit', handleUserEdit);
  const resetButton = container.querySelector('[data-action="reset-edit-form"]');
  resetButton?.addEventListener('click', () => {
    resetEditForm();
  });
  await refreshData(listContainer);
}


