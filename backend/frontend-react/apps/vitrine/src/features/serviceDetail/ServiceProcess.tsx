import { formatDuration } from '@bs/api-client';

// RX3 — « Comment se déroule votre rendez-vous » : 3 étapes lisibles (icônes + temps). Contenu générique
// volontairement neutre (pas de donnée institut inventée) ; la durée affichée vient du backend.

export function ServiceProcess({ duration }: { duration?: number }) {
  const steps = [
    { icon: 'bi-emoji-smile', title: 'Accueil', text: 'Un échange rapide pour cerner vos attentes.' },
    {
      icon: 'bi-stars',
      title: 'Votre soin',
      text: duration ? `La prestation dure environ ${formatDuration(duration)}.` : 'La prestation réalisée par nos soins.',
    },
    { icon: 'bi-hand-thumbs-up', title: 'Conseils', text: 'Des recommandations personnalisées avant de partir.' },
  ];
  return (
    <section className="sd-section" aria-label="Déroulement">
      <h2 className="sd-section__title">Comment se déroule votre rendez-vous</h2>
      <ol className="sd-steps">
        {steps.map((s) => (
          <li key={s.title} className="sd-step">
            <span className="sd-step__icon" aria-hidden="true">
              <i className={`bi ${s.icon}`} />
            </span>
            <span className="sd-step__body">
              <span className="sd-step__title">{s.title}</span>
              <span className="sd-step__text">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
