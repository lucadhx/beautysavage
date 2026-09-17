// RX3 — Accordéon partagé (FAQ, modules de formation, sections repliables). Un seul pattern accordéon
// produit. Accessible : bouton + region liée (aria-expanded/aria-controls), clavier natif (button),
// animation via motionPreset('accordion') (neutralisée en reduced-motion). Tokens --bs-* only.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

export interface AccordionItemData {
  id: string;
  title: ReactNode;
  content: ReactNode;
}

export interface AccordionProps {
  items: AccordionItemData[];
  /** Autoriser plusieurs panneaux ouverts en même temps (défaut : un seul). */
  multiple?: boolean;
  /** Ids ouverts par défaut. */
  defaultOpen?: string[];
}

export function Accordion({ items, multiple = false, defaultOpen = [] }: AccordionProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen));
  const baseId = useId();

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(multiple ? prev : []);
      if (prev.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="bs-acc">
      {items.map((item) => {
        const isOpen = open.has(item.id);
        const btnId = `${baseId}-${item.id}-btn`;
        const panelId = `${baseId}-${item.id}-panel`;
        return (
          <div key={item.id} className="bs-acc__item">
            <h3 className="bs-acc__heading">
              <button
                type="button"
                id={btnId}
                className="bs-acc__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span className="bs-acc__title">{item.title}</span>
                <i className={`bi bi-chevron-down bs-acc__chevron${isOpen ? ' bs-acc__chevron--open' : ''}`} aria-hidden="true" />
              </button>
            </h3>
            {/* Dropdown animé (ease-in-out à l'ouverture ET à la fermeture) via grid-template-rows. */}
            <div className={`bs-acc__panelwrap${isOpen ? ' bs-acc__panelwrap--open' : ''}`}>
              <div id={panelId} role="region" aria-labelledby={btnId} className="bs-acc__panel" aria-hidden={!isOpen}>
                <div className="bs-acc__panelinner">{item.content}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default { Accordion };
