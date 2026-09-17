// Dropdown custom partagé — animé à l'ouverture ET à la fermeture (le menu reste monté ;
// visibility+opacity+transform en transition). Accessible (listbox), clavier Escape, clic extérieur.
import { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
}

export interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Icône Bootstrap optionnelle affichée dans le déclencheur. */
  icon?: string;
}

export function Dropdown({ value, options, onChange, ariaLabel, placeholder = 'Sélectionner', disabled, icon }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`bs-dd${open ? ' bs-dd--open' : ''}`} ref={ref}>
      <button
        type="button"
        className="bs-dd__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? <i className={`bi ${icon} bs-dd__ic`} aria-hidden="true" /> : null}
        <span className={`bs-dd__value${selected ? '' : ' bs-dd__value--ph'}`}>{selected ? selected.label : placeholder}</span>
        <i className="bi bi-chevron-down bs-dd__chev" aria-hidden="true" />
      </button>
      <ul className="bs-dd__menu" role="listbox" aria-label={ariaLabel}>
        {options.map((o) => (
          <li key={o.value} role="option" aria-selected={o.value === value}>
            <button
              type="button"
              className={`bs-dd__opt${o.value === value ? ' bs-dd__opt--active' : ''}`}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.value === value ? <i className="bi bi-check2" aria-hidden="true" /> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default { Dropdown };
