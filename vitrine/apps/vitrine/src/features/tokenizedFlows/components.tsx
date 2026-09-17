// RX4 S3 — Coquille + composants partagés des parcours tokenisés (lien e-mail, sans compte). Colonne unique,
// premium, rassurant. Tokens --bs-* only.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@bs/ui';
import type { TokenState } from './format';
import './tokenizedFlows.css';

/** Layout autonome minimal (pas de nav storefront) pour les pages ouvertes depuis un e-mail. */
export function TokenFlowLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bs-tf">
      <header className="bs-tf__brand">
        <Link to="/" className="bs-tf__brand-link">Beauty Savage</Link>
      </header>
      <main className="bs-tf__main">{children}</main>
      <footer className="bs-tf__foot">
        <DecisionSecurityNote />
      </footer>
    </div>
  );
}

/** Note de sécurité (lien personnel, à usage unique). */
export function DecisionSecurityNote() {
  return (
    <p className="bs-tf__security">
      <i className="bi bi-shield-lock" aria-hidden="true" /> Lien personnel et sécurisé, valable une seule fois.
      Ne le partagez pas.
    </p>
  );
}

/** État token invalide / expiré / erreur — rassurant, jamais technique. */
export function TokenErrorState({ state }: { state: Exclude<TokenState, 'ok'> }) {
  const map = {
    invalid: {
      icon: 'bi-link-45deg',
      title: 'Ce lien n’est plus valide',
      body: "Le lien reçu est incorrect ou a expiré. Si vous aviez une décision à prendre, contactez l'institut, nous vous aiderons.",
    },
    expired: {
      icon: 'bi-hourglass-bottom',
      title: 'Ce lien a déjà été utilisé ou a expiré',
      body: 'Votre choix a peut-être déjà été enregistré. En l’absence de réponse, un remboursement automatique est prévu. Contactez l’institut au besoin.',
    },
    error: {
      icon: 'bi-exclamation-circle',
      title: 'Une erreur est survenue',
      body: 'Nous n’avons pas pu charger votre demande. Réessayez dans un instant.',
    },
  }[state];
  return (
    <Card className="bs-tf-state">
      <i className={`bi ${map.icon} bs-tf-state__icon`} aria-hidden="true" />
      <h1 className="bs-tf-state__title">{map.title}</h1>
      <p className="bs-tf-state__body">{map.body}</p>
      <Link className="bs-btn bs-btn--secondary" to="/">Retour à l’accueil</Link>
    </Card>
  );
}

/** Bloc « situation » en tête de la page décision. */
export function DecisionHeroCard({ icon, kicker, title, meta, children }: {
  icon: string; kicker: string; title: string; meta?: ReactNode; children?: ReactNode;
}) {
  return (
    <Card className="bs-tf-hero">
      <span className="bs-tf-hero__kicker"><i className={`bi ${icon}`} aria-hidden="true" /> {kicker}</span>
      <h1 className="bs-tf-hero__title">{title}</h1>
      {meta ? <div className="bs-tf-hero__meta">{meta}</div> : null}
      {children}
    </Card>
  );
}
