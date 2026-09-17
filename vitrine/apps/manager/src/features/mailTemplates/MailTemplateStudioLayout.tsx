// M6 — Layout Mail Template Studio (dev-only) : en-tête + Outlet. Importe le CSS de la feature.
import { Outlet } from 'react-router-dom';
import './mailTemplates.css';

export function MailTemplateStudioLayout() {
  return (
    <section className="mt-page">
      <div className="mt-head">
        <h1 className="mt-head__title">Templates e-mail</h1>
        <p className="mt-head__subtitle">
          Édition des modèles (objet, HTML, texte) avec versions, publication et aperçu sans envoi. Les
          adresses ne sont jamais stockées ici : expéditeur/destinataire sont des rôles, résolus à l'envoi.
        </p>
      </div>
      <Outlet />
    </section>
  );
}
