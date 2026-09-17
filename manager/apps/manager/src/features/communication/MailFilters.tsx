// M4 — Barre de filtres mail. Desktop : inline. Mobile : bouton + drawer (bottom sheet).
import { useState } from 'react';
import { Button } from '@bs/ui';
import type { MailSupervisionFilters } from '@bs/api-client';

export interface MailFilterFieldsProps {
  value: MailSupervisionFilters;
  onChange: (next: MailSupervisionFilters) => void;
  showRoles?: boolean;
}

const DELIVERY_STATUSES = ['sent', 'failed', 'shadow', 'identity_missing', 'client_missing', 'skipped_duplicate_direct_sender', 'skipped_rule_disabled', 'skipped_template_missing'];

function FilterFields({ value, onChange, showRoles = true }: MailFilterFieldsProps) {
  const set = (patch: Partial<MailSupervisionFilters>) => onChange({ ...value, ...patch });
  return (
    <div className="cc-filter-bar">
      <div className="cc-field">
        <label className="cc-label" htmlFor="cc-f-status">Statut</label>
        <select id="cc-f-status" className="cc-input cc-select" value={value.status ?? ''} onChange={(e) => set({ status: e.target.value || undefined })}>
          <option value="">Tous</option>
          {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="cc-field">
        <label className="cc-label" htmlFor="cc-f-event">Événement</label>
        <input id="cc-f-event" className="cc-input" type="text" value={value.eventName ?? ''} onChange={(e) => set({ eventName: e.target.value || undefined })} placeholder="ex. refund.succeeded" />
      </div>
      <div className="cc-field">
        <label className="cc-label" htmlFor="cc-f-template">Template</label>
        <input id="cc-f-template" className="cc-input" type="text" value={value.templateKey ?? ''} onChange={(e) => set({ templateKey: e.target.value || undefined })} placeholder="ex. refund_confirmed" />
      </div>
      {showRoles ? (
        <>
          <div className="cc-field">
            <label className="cc-label" htmlFor="cc-f-from">De (rôle)</label>
            <select id="cc-f-from" className="cc-input cc-select" value={value.fromRole ?? ''} onChange={(e) => set({ fromRole: e.target.value || undefined })}>
              <option value="">Tous</option>
              <option value="commerciale">commerciale</option>
              <option value="support">support</option>
            </select>
          </div>
          <div className="cc-field">
            <label className="cc-label" htmlFor="cc-f-to">Vers (rôle)</label>
            <select id="cc-f-to" className="cc-input cc-select" value={value.toRole ?? ''} onChange={(e) => set({ toRole: e.target.value || undefined })}>
              <option value="">Tous</option>
              <option value="client">client</option>
              <option value="commerciale">commerciale</option>
            </select>
          </div>
        </>
      ) : null}
      <div className="cc-field">
        <label className="cc-label" htmlFor="cc-f-from-date">Depuis</label>
        <input id="cc-f-from-date" className="cc-input" type="date" value={value.dateFrom ?? ''} onChange={(e) => set({ dateFrom: e.target.value || undefined })} />
      </div>
      <div className="cc-field">
        <label className="cc-label" htmlFor="cc-f-to-date">Jusqu'à</label>
        <input id="cc-f-to-date" className="cc-input" type="date" value={value.dateTo ?? ''} onChange={(e) => set({ dateTo: e.target.value || undefined })} />
      </div>
    </div>
  );
}

export function MailFilterBar(props: MailFilterFieldsProps) {
  // Visible ≥ desktop (le CSS masque .cc-filter-bar dans le drawer mobile via la classe parente).
  return <FilterFields {...props} />;
}

export function MobileFilterDrawer({ value, onChange, showRoles, onReset }: MailFilterFieldsProps & { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="cc-filter-toggle cc-actions">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Filtres
        </Button>
        <Button type="button" variant="secondary" onClick={onReset}>
          Réinitialiser
        </Button>
      </div>
      {open ? (
        <div className="cc-drawer__backdrop" role="dialog" aria-modal="true" aria-label="Filtres" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="cc-drawer">
            <span className="cc-drawer__handle" aria-hidden="true" />
            <strong>Filtres</strong>
            <div className="cc-filter-bar--mobile">
              <FilterFields value={value} onChange={onChange} showRoles={showRoles} />
            </div>
            <div className="cc-actions">
              <Button type="button" onClick={() => setOpen(false)}>Appliquer</Button>
              <Button type="button" variant="secondary" onClick={() => { onReset(); setOpen(false); }}>Réinitialiser</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
