import { loadEditablePageContent } from './pageContentLoader.js';

const LEGAL_PAGE_META = {
  'mentions-legales': {
    title: 'Mentions légales',
    description: "Informations sur l'éditeur et les responsables.",
    defaultText:
      `<p>Les mentions légales de Beauty Savage identifient l'institut, son activité et les responsables éditoriaux.</p><p>Le directeur de publication est le responsable technique en charge de la plateforme.</p>`
  },
  'politique-confidentialite': {
    title: 'Politique de confidentialité',
    description: 'Engagement sur la collecte et la protection des données personnelles.',
    defaultText:
      `<p>Beauty Savage collecte uniquement les données nécessaires à la gestion des comptes et des formations, dans le respect du RGPD.</p><p>Les informations restent confidentielles et ne sont jamais cédées à des tiers sans consentement explicite.</p>`
  },
  cgv: {
    title: 'Conditions générales de vente',
    description: 'Règles de vente des prestations proposées par Beauty Savage.',
    defaultText:
      `<p>Les présentes conditions régissent l'achat de prestations proposées par Beauty Savage.</p><p>Le paiement valide la commande, les délais et les modalités de rétractation y sont détaillés.</p>`
  }
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function renderPage(container, data = {}) {
  if (!container) return;
  const requested = String(data.slug || 'mentions-legales').trim().toLowerCase();
  const slug = Object.prototype.hasOwnProperty.call(LEGAL_PAGE_META, requested)
    ? requested
    : 'mentions-legales';
  const meta = LEGAL_PAGE_META[slug];
  container.innerHTML = `<p class="module-placeholder">Chargement...</p>`;
  try {
    const { content } = await loadEditablePageContent(slug, { targetType: 'legal-page' });
    const bodyContent = content.mainText || meta.defaultText;
    container.innerHTML = `
      <article class="legal-page">
        <header>
          <h2 class="legal-page__title">${escapeHtml(meta.title)}</h2>
          <p class="legal-page__subtitle">${escapeHtml(meta.description)}</p>
        </header>
        <div class="legal-page__body">
          ${bodyContent}
        </div>
      </article>
    `;
  } catch (error) {
    console.error(`Erreur chargement page ${slug}`, error);
    container.innerHTML = `<p class="module-placeholder">Impossible de charger la page ${escapeHtml(
      meta.title
    )}.</p>`;
  }
}
