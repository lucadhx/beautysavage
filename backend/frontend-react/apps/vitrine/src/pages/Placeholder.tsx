import { Card } from '@bs/ui';

export interface PlaceholderProps {
  title: string;
  description: string;
  /** Lien vers la doc du scope (architecture / contexte). */
  docHref?: string;
}

/** Page placeholder R0 — aucun appel métier. Remplacée par une vraie page en R1+. */
export function Placeholder({ title, description, docHref = '../docs/VitrineArchitecture.md' }: PlaceholderProps) {
  return (
    <Card>
      <h1>{title}</h1>
      <p>{description}</p>
      <p>
        <small>
          Page placeholder (R0) — voir <a href={docHref}>documentation vitrine</a>.
        </small>
      </p>
    </Card>
  );
}
