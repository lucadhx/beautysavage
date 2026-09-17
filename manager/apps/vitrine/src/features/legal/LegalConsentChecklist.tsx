import type { LegalConsentState } from '@bs/api-client';

export interface LegalConsentChecklistProps {
  value: LegalConsentState;
  onChange: (next: LegalConsentState) => void;
  /** Affiche l'ack « prestation datée » (créneau choisi). */
  showDatedService?: boolean;
}

// Checklist de consentements (UX). Le backend reste l'autorité (re-dérive les waivers requis).
export function LegalConsentChecklist({ value, onChange, showDatedService = true }: LegalConsentChecklistProps) {
  const set = (patch: Partial<LegalConsentState>) => onChange({ ...value, ...patch });

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <label className="bs-consent">
        <input
          type="checkbox"
          checked={value.acceptedCgv}
          onChange={(e) => set({ acceptedCgv: e.target.checked })}
        />
        <span>J’accepte les conditions générales de vente (CGV).</span>
      </label>

      <label className="bs-consent">
        <input
          type="checkbox"
          checked={value.acknowledgedRetractation}
          onChange={(e) => set({ acknowledgedRetractation: e.target.checked })}
        />
        <span>J’ai pris connaissance de mon droit de rétractation et de ses limites.</span>
      </label>

      {showDatedService ? (
        <label className="bs-consent">
          <input
            type="checkbox"
            checked={value.acknowledgedDatedService}
            onChange={(e) => set({ acknowledgedDatedService: e.target.checked })}
          />
          <span>J’accepte que la prestation soit exécutée à la date du créneau choisi.</span>
        </label>
      ) : null}
    </fieldset>
  );
}
