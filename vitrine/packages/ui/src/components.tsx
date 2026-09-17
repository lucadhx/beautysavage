import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  const cls = ['bs-btn', variant === 'secondary' ? 'bs-btn--secondary' : '', className]
    .filter(Boolean)
    .join(' ');
  return <button className={cls} {...rest} />;
}

export interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return <div className={`bs-card ${className}`.trim()}>{children}</div>;
}

export function LoadingState({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="bs-state" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function ErrorState({ title = 'Une erreur est survenue.', detail }: { title?: string; detail?: string }) {
  return (
    <div className="bs-state bs-state--error" role="alert">
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export interface AppShellProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function AppShell({ header, footer, children }: AppShellProps) {
  return (
    <div className="bs-shell">
      {header ? <header className="bs-shell__header">{header}</header> : null}
      <main className="bs-shell__main">{children}</main>
      {footer ? <footer className="bs-shell__footer">{footer}</footer> : null}
    </div>
  );
}
