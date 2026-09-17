// RX-BLOCKER-2 — Coquille autonome des pages d'auth manager (invitation, mot de passe oublié/reset). Pas de
// nav gestion : colonne unique centrée. Sans auth.
import type { ReactNode } from 'react';
import { Card } from '@bs/ui';
import './managerAuth.css';

export function ManagerAuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ma">
      <header className="ma__brand">Beauty Savage — Gestion</header>
      <main className="ma__main">
        <Card className="ma__card">
          <h1 className="ma__title">{title}</h1>
          {children}
        </Card>
      </main>
    </div>
  );
}

/** Politique mot de passe (parité backend signup/accept) : ≥8, au moins une lettre et un chiffre. */
export function passwordError(pwd: string, confirm: string): string {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(pwd)) return 'Au moins 8 caractères, dont une lettre et un chiffre.';
  if (pwd !== confirm) return 'Les mots de passe ne correspondent pas.';
  return '';
}
