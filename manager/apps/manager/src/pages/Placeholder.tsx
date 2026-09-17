import { Card } from '@bs/ui';

export interface PlaceholderProps {
  title: string;
  description: string;
  docHref?: string;
}

/** Page placeholder R0 — aucun appel métier. Remplacée par une vraie page en R3. */
export function Placeholder({ title, description, docHref = '../docs/ManagerArchitecture.md' }: PlaceholderProps) {
  return (
    <Card>
      <h1>{title}</h1>
      <p>{description}</p>
      <p>
        <small>
          Page placeholder (R0) — voir <a href={docHref}>documentation manager</a>.
        </small>
      </p>
    </Card>
  );
}
