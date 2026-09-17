// RX4 — En-tête de sous-page compte : retour vers le dashboard + titre. Cible 44px, accessible.
import { Link } from 'react-router-dom';

export function AccountPageHeader({ title, backTo = '/mon-compte' }: { title: string; backTo?: string }) {
  return (
    <div className="bs-acc-head">
      <Link to={backTo} className="bs-acc-head__back" aria-label="Retour à mon compte">
        <i className="bi bi-arrow-left" aria-hidden="true" />
      </Link>
      <h1 className="bs-acc-head__title">{title}</h1>
    </div>
  );
}
