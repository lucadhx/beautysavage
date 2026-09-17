import { loadEditablePageContent } from './pageContentLoader.js';

const DEFAULT_ABOUT_TEXT =
  `<p>Beauty Savage est un prototype pensé pour aligner vitrine et gestion sans compromis.</p>`;

export async function renderPage(container) {
  if (!container) return;
  container.innerHTML = `<p class="module-placeholder">Chargement...</p>`;
  try {
    const { content } = await loadEditablePageContent('about');
    const mainText = content.mainText || DEFAULT_ABOUT_TEXT;
    container.innerHTML = `
      <article class="home-page">
        <header>
          <p class="eyebrow">À propos</p>
          <h2>Beauty Savage</h2>
          <p class="muted">Découvrez l'intention derrière la vitrine.</p>
        </header>
        <div class="about-content">
          ${mainText}
        </div>
      </article>
    `;
  } catch (error) {
    console.error('Erreur chargement page À propos', error);
    container.innerHTML =
      `<p class="module-placeholder">Impossible de charger la page À propos.</p>`;
  }
}
