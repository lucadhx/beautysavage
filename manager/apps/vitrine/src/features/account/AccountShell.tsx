// RX4 — Coquille commune des sous-pages compte : garde d'authentification + en-tête retour. Évite de
// répéter le motif « loading / non connecté / contenu » sur chaque écran.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Skeleton } from '@bs/ui';
import { useAuth } from '@bs/auth';
import { AccountPageHeader } from './AccountPageHeader';
import './account.css';

export function AccountShell({ title, children }: { title: string; children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <section className="bs-hub">
        <AccountPageHeader title={title} />
        <Skeleton variant="block" height="120px" />
      </section>
    );
  }

  if (status !== 'authenticated') {
    return (
      <section className="bs-hub">
        <AccountPageHeader title={title} />
        <Card>
          <p>Connectez-vous pour accéder à cette section.</p>
          <Link className="bs-btn" to="/connexion?redirect=/mon-compte">Se connecter</Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="bs-hub">
      <AccountPageHeader title={title} />
      {children}
    </section>
  );
}
