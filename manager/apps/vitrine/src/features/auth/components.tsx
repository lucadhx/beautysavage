// RX-GO-2 — Primitives partagées des écrans auth React (coquille centrée + champ mot de passe afficher/masquer).
// Réutilise @bs/ui (Card, FormField, TextInput). Mobile-first, 44px, tokens --bs-* only.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, FormField, TextInput } from '@bs/ui';
import { ApiError } from '@bs/api-client';
import './auth.css';

/** Coquille centrée pour un écran auth (colonne unique, marque, retour accueil). */
export function AuthShell({ title, subtitle, icon = 'bi-heart-fill', children, footer }: {
  title: string; subtitle?: string; icon?: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <section className="bs-auth">
      <span className="bs-auth__aura" aria-hidden="true" />
      <Card className="bs-auth__card">
        <div className="bs-auth__brand">
          <span className="bs-auth__emblem" aria-hidden="true"><i className={`bi ${icon}`} /></span>
          <span className="bs-auth__brandname">Beauty Savage</span>
        </div>
        <h1 className="bs-auth__title">{title}</h1>
        {subtitle ? <p className="bs-auth__subtitle">{subtitle}</p> : null}
        {children}
        {footer ? <div className="bs-auth__footer">{footer}</div> : null}
        <p className="bs-auth__home"><Link to="/"><i className="bi bi-arrow-left" aria-hidden="true" /> Retour à l’accueil</Link></p>
      </Card>
    </section>
  );
}

/** Champ mot de passe avec bascule afficher/masquer (cible 44px, aria). */
export function PasswordField({ label, value, onChange, autoComplete = 'current-password', hint, error, id }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete?: string; hint?: ReactNode; error?: ReactNode; id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [visible, setVisible] = useState(false);
  return (
    <FormField label={label} htmlFor={inputId} hint={hint} error={error} required>
      <div className="bs-auth__pw">
        <TextInput
          id={inputId}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="bs-auth__pw-toggle" aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          <i className={`bi ${visible ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
        </button>
      </div>
    </FormField>
  );
}

/** Message d'erreur lisible depuis une ApiError (le serveur reste l'autorité). */
export function friendlyAuthError(err: unknown, fallback = 'Une erreur est survenue. Réessayez.'): string {
  if (err instanceof ApiError) {
    // Le backend renvoie déjà des messages FR ; on les affiche tels quels, sinon fallback.
    return err.message && !/^HTTP \d+$/.test(err.message) ? err.message : fallback;
  }
  return fallback;
}
