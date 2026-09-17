// M13 — Layout Gift Card Template Studio (dev-only) : en-tête + Outlet. Importe le CSS de la feature.
import { Outlet } from 'react-router-dom';
import './giftCardTemplates.css';

export function GiftCardTemplateStudioLayout() {
  return (
    <section className="gct-page">
      <div className="gct-head">
        <h1 className="gct-head__title">Templates carte cadeau</h1>
        <p className="gct-head__subtitle">
          Édition des modèles de carte (HTML / CSS) avec versions, publication et aperçu live sans envoi.
          Le QR code de l'aperçu est factice : aucune carte réelle n'est générée ici.
        </p>
      </div>
      <Outlet />
    </section>
  );
}
