const API_ROOT = '/api/dev';

function showFeedback(target, message, status = 'info') {
  if (!target) return;
  target.textContent = message;
  target.dataset.status = status;
  if (!message) {
    target.removeAttribute('data-status');
  }
}

async function ensureDevAccess() {
  try {
    const response = await fetch('/auth/me', { credentials: 'include' });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => ({}));
    const role = String(payload?.user?.role || '').trim().toLowerCase();
    return role === 'admin' || role === 'dev';
  } catch (error) {
    console.error("Impossible de vérifier l'accès développeur", error);
    return false;
  }
}

function renderAccessDenied(container) {
  if (!container) return;
  container.innerHTML = `
    <section class="module-panel">
      <header>
        <h2>Utilisateurs (test)</h2>
        <p>Module temporaire rÃ©servÃ© aux admins et dÃ©veloppeurs.</p>
      </header>
      <div class="status-banner status-forbidden">
        <p>AccÃ¨s refusÃ© : uniquement pour les admins et dÃ©veloppeurs.</p>
      </div>
    </section>
  `;
}

function renderForm(container) {
  if (!container) return;
  container.innerHTML = `
    <section class="module-panel">
      <header>
        <h2>Utilisateurs (test)</h2>
        <p>CrÃ©ation temporaire de comptes admin ou client. Ã€ supprimer avant production.</p>
      </header>
      <form class="manager-form" data-user-test-form>
        <label>
          Email
          <input type="email" name="email" required placeholder="test@exemple.com">
        </label>
        <label>
          Mot de passe
          <input type="password" name="password" required placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢">
        </label>
        <label>
          RÃ´le
          <select name="role">
            <option value="admin">Admin</option>
            <option value="client">Client</option>
          </select>
        </label>
        <button class="primary-button" type="submit">CrÃ©er utilisateur (test)</button>
      </form>
      <p class="form-message" data-user-test-feedback></p>
    </section>
  `;
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const feedback = form?.closest('.module-panel')?.querySelector('[data-user-test-feedback]');
  if (!form) return;
  const email = form.querySelector('[name="email"]')?.value?.trim();
  const password = form.querySelector('[name="password"]')?.value;
  const role = form.querySelector('[name="role"]')?.value;
  if (!email || !password || !role) {
    showFeedback(feedback, 'Tous les champs sont requis.', 'error');
    return;
  }
  showFeedback(feedback, 'CrÃ©ation en cours...', 'info');
  try {
    const response = await fetch(`${API_ROOT}/create-user`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return showFeedback(feedback, body?.error || "Impossible de créer l'utilisateur.", 'error');
    }
    form.reset();
    showFeedback(feedback, 'Utilisateur test crÃ©Ã©.', 'success');
  } catch (error) {
    console.error('Erreur crÃ©ation utilisateur test', error);
    showFeedback(feedback, 'Erreur rÃ©seau.', 'error');
  }
}

export async function renderModule(container) {
  if (!container) return;
  const devAccess = await ensureDevAccess();
  if (!devAccess) {
    renderAccessDenied(container);
    return;
  }
  renderForm(container);
  const form = container.querySelector('[data-user-test-form]');
  if (form) {
    form.addEventListener('submit', handleSubmit);
  }
}


