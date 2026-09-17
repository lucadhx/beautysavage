import { Checkbox } from '@bs/ui';
import { formatPrice, type PublicServiceOption } from '@bs/api-client';

// RX3 — Sélection d'options prestation. Impact PRIX uniquement (le backend ne fournit pas d'impact durée).
// Chaque option cochée alimente selectedOptions + le total indicatif (backend = autorité au paiement).

export interface ServiceOptionsProps {
  options: PublicServiceOption[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

export function ServiceOptions({ options, selectedIds, onToggle }: ServiceOptionsProps) {
  if (!options.length) return null;
  return (
    <section className="sd-section" aria-label="Options">
      <h2 className="sd-section__title">Options</h2>
      <ul className="sd-options">
        {options.map((opt) => (
          <li key={opt.id} className="sd-option">
            <Checkbox
              checked={selectedIds.has(opt.id)}
              onChange={() => onToggle(opt.id)}
              label={
                <span className="sd-option__body">
                  <span className="sd-option__name">{opt.name}</span>
                  {opt.description ? <span className="sd-option__desc">{opt.description}</span> : null}
                </span>
              }
            />
            {typeof opt.price === 'number' && opt.price > 0 ? (
              <span className="sd-option__price">+ {formatPrice(opt.price)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
