// RX-GO-2 — Écran « bientôt disponible » utile (jamais un écran vide). Explique + propose des liens utiles.
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@bs/ui';

export function ComingSoon({ title, description, links = [] }: {
  title: string;
  description: string;
  links?: { to: string; label: string }[];
}): ReactNode {
  return (
    <section style={{ maxWidth: 560 }}>
      <Card>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p style={{ color: 'var(--bs-color-muted)' }}>{description}</p>
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'var(--bs-color-background)', color: 'var(--bs-color-muted)', fontSize: '0.8rem' }}>
          <i className="bi bi-hourglass-split" aria-hidden="true" /> Bientôt disponible
        </p>
        {links.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--bs-space-1)', marginTop: 'var(--bs-space-2)' }}>
            {links.map((l) => (
              <Link key={l.to} to={l.to} className="bs-nav-link" style={{ color: 'var(--bs-color-primary)' }}>
                {l.label} →
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
