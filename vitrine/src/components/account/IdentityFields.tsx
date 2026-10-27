import * as React from 'react';
import type { Customer } from '@/lib/api';

/**
 * PRÉNOM · NOM · TÉLÉPHONE — obligatoires pour réserver.
 *
 * Un seul groupe de champs, trois usages : l'inscription, le profil, et la
 * fenêtre de réservation d'une cliente inscrite avant la règle. Même libellés,
 * même contrôle (10 chiffres au moins, comme le serveur).
 */
export type Identity = { firstName: string; lastName: string; phone: string };

export const identityOf = (c?: Partial<Customer> | null): Identity => ({
  firstName: c?.firstName || '',
  lastName: c?.lastName || '',
  phone: c?.phone || '',
});

export function identityComplete(c?: Partial<Customer> | null) {
  const i = identityOf(c);
  return Boolean(i.firstName.trim() && i.lastName.trim() && phoneOk(i.phone));
}

export function phoneOk(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return /^[+\d][\d\s.\-()]*$/.test(phone.trim()) && digits.length >= 10 && digits.length <= 15;
}

export function IdentityFields({ value, onChange, compact = false }: { value: Identity; onChange: (next: Identity) => void; compact?: boolean }) {
  const set = (key: keyof Identity) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  const field = `v-field rounded-md px-3 ${compact ? 'py-2.5' : 'py-3'}`;
  const showPhoneHint = value.phone.trim().length > 0 && !phoneOk(value.phone);
  return (
    <div className="grid gap-4" data-testid="identity-fields">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium">
          Prénom
          <input className={field} autoComplete="given-name" value={value.firstName} onChange={set('firstName')} required maxLength={60} data-testid="identity-first-name" />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Nom
          <input className={field} autoComplete="family-name" value={value.lastName} onChange={set('lastName')} required maxLength={60} data-testid="identity-last-name" />
        </label>
      </div>
      <label className="grid gap-2 text-sm font-medium">
        Téléphone
        <input className={field} type="tel" inputMode="tel" autoComplete="tel" value={value.phone} onChange={set('phone')} required maxLength={30} placeholder="06 12 34 56 78" data-testid="identity-phone" />
        {showPhoneHint && <span className="text-xs font-normal" style={{ color: '#b91c1c' }}>Un numéro à 10 chiffres au moins.</span>}
      </label>
    </div>
  );
}
