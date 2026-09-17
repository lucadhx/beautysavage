import { SectionHeader } from '@bs/ui';

// RX3 S4 — « Pourquoi Beauty Savage » : cartes de réassurance (valeurs institut). Contenu générique
// mais véridique (aucune donnée inventée). Icônes Bootstrap, animation d'entrée discrète.

const REASONS = [
  { icon: 'bi-gem', title: 'Expertise premium', text: 'Des prestations réalisées avec soin et exigence.' },
  { icon: 'bi-mortarboard', title: 'Formations reconnues', text: 'En présentiel ou en ligne, à votre rythme.' },
  { icon: 'bi-shield-check', title: 'Paiement sécurisé', text: 'Réservation en ligne, paiement protégé via Stripe.' },
  { icon: 'bi-gift', title: 'Cartes cadeaux', text: 'Offrez la beauté — utilisable sur tout le catalogue.' },
];

export function HomeWhy() {
  return (
    <section className="home-section" aria-label="Pourquoi Beauty Savage">
      <SectionHeader title="Pourquoi Beauty Savage" />
      <div className="home-why">
        {REASONS.map((r) => (
          <div key={r.title} className="home-why__card">
            <span className="home-why__icon" aria-hidden="true">
              <i className={`bi ${r.icon}`} />
            </span>
            <h3 className="home-why__title">{r.title}</h3>
            <p className="home-why__text">{r.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
