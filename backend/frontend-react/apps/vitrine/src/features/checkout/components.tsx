import { useState } from 'react';
import { Badge, Button, TextInput } from '@bs/ui';
import { formatPrice, type AppliedGiftCard } from '@bs/api-client';
import type { AppliedCardEntry } from './useGiftCardApply';
import type { LegalRequirement, LegalAcceptState } from '../legal/cartLegalRequirements';

// RX3 S3 — Composants du checkout multi-item premium. Tokens --bs-* only, ≥44px, mobile-first.

function maskCode(code: string): string {
  const tail = code.slice(-4);
  return `•••• ${tail}`;
}

export function CheckoutItemCard({
  title,
  subtitle,
  price,
  unavailableReason,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  price?: number;
  unavailableReason?: string;
  onRemove?: () => void;
}) {
  return (
    <div className={`co-item${unavailableReason ? ' co-item--off' : ''}`}>
      <div className="co-item__body">
        <span className="co-item__title">{title}</span>
        {subtitle ? <span className="co-item__subtitle">{subtitle}</span> : null}
        {unavailableReason ? (
          <span className="co-item__off">
            <Badge tone="danger">Non disponible</Badge> {unavailableReason}
          </span>
        ) : null}
      </div>
      <div className="co-item__aside">
        {typeof price === 'number' ? <span className="co-item__price">{formatPrice(price)}</span> : null}
        {onRemove ? (
          <button type="button" className="co-item__remove" onClick={onRemove}>
            Retirer
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function GiftCardApplyBox({
  onApply,
  onSubmitPassword,
  onCancelPassword,
  needsPasswordFor,
  pending,
  error,
}: {
  onApply: (code: string) => void;
  onSubmitPassword: (password: string) => void;
  onCancelPassword: () => void;
  needsPasswordFor: string | null;
  pending: boolean;
  error: string;
}) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  if (needsPasswordFor) {
    return (
      <div className="co-gc">
        <label className="co-gc__label" htmlFor="gc-pwd">
          Mot de passe de la carte {maskCode(needsPasswordFor)}
        </label>
        <div className="co-gc__row">
          <TextInput
            id="gc-pwd"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            autoComplete="off"
          />
          <Button
            type="button"
            onClick={() => {
              onSubmitPassword(password);
              setPassword('');
            }}
            disabled={pending || !password}
          >
            Valider
          </Button>
        </div>
        <button type="button" className="co-gc__cancel" onClick={onCancelPassword}>
          Annuler
        </button>
        {error ? <p className="co-gc__error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="co-gc">
      <label className="co-gc__label" htmlFor="gc-code">
        Carte cadeau
      </label>
      <div className="co-gc__row">
        <TextInput
          id="gc-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Entrer un code"
          autoComplete="off"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onApply(code);
            setCode('');
          }}
          disabled={pending || !code.trim()}
        >
          Appliquer
        </Button>
      </div>
      {error ? <p className="co-gc__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function AppliedGiftCardCard({
  card,
  amountUsed,
  onRemove,
}: {
  card: AppliedCardEntry;
  amountUsed: number;
  onRemove: () => void;
}) {
  const newBalance = Math.max(0, card.availableBalance - amountUsed);
  return (
    <div className="co-applied">
      <div className="co-applied__body">
        <span className="co-applied__code">Carte {maskCode(card.code)}</span>
        <span className="co-applied__meta">
          Solde {formatPrice(card.availableBalance)} · utilisé {formatPrice(amountUsed)} · reste {formatPrice(newBalance)}
        </span>
      </div>
      <button type="button" className="co-item__remove" onClick={onRemove}>
        Retirer
      </button>
    </div>
  );
}

export function CheckoutLegalRequirements({
  requirements,
  accepted,
  onToggle,
}: {
  requirements: LegalRequirement[];
  accepted: LegalAcceptState;
  onToggle: (id: LegalRequirement['id']) => void;
}) {
  return (
    <fieldset className="co-legal">
      <legend className="co-legal__title">Consentements nécessaires</legend>
      {requirements.map((r) => (
        <label key={r.id} className="bs-check co-legal__item" htmlFor={`legal-${r.id}`}>
          <input
            id={`legal-${r.id}`}
            type="checkbox"
            className="bs-check__input"
            checked={accepted[r.id] === true}
            onChange={() => onToggle(r.id)}
          />
          <span className="bs-check__label">{r.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function CheckoutPaymentSummary({
  subtotal,
  giftCardUsed,
  remaining,
}: {
  subtotal: number;
  giftCardUsed: number;
  remaining: number;
}) {
  return (
    <div className="co-summary" aria-label="Récapitulatif du paiement">
      <div className="co-summary__row">
        <span>Total articles</span>
        <span>{formatPrice(subtotal)}</span>
      </div>
      {giftCardUsed > 0 ? (
        <div className="co-summary__row co-summary__row--gc">
          <span>Carte cadeau utilisée</span>
          <span>− {formatPrice(giftCardUsed)}</span>
        </div>
      ) : null}
      <div className="co-summary__row co-summary__row--total">
        <span>Reste à payer</span>
        <span>{formatPrice(remaining)}</span>
      </div>
    </div>
  );
}

/** Alloue le montant utilisé par carte (mêmes règles que le hook) pour l'affichage. */
export function allocationForCard(allocations: AppliedGiftCard[], code: string): number {
  return allocations.find((a) => a.code === code)?.amount ?? 0;
}
