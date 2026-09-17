import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Button, Chip, FormField, TextInput, TextArea, Checkbox, ErrorState, LoadingState } from '@bs/ui';
import {
  buildGiftCardCheckoutState,
  createCheckoutSession,
  formatPrice,
  ApiError,
  type PublicGiftCardConfig,
} from '@bs/api-client';
import { resolveErrorUx } from '@bs/config';
import { GiftCardPreview } from './GiftCardPreview';

// RX3 S4 — Achat carte cadeau : montant (presets/min/max) + bénéficiaire + message + aperçu + CGV → paiement
// Stripe hébergé (montant toujours > 0). La carte est créée par le backend À LA FINALISATION (jamais avant).

type Phase = 'idle' | 'submitting' | 'redirecting' | 'error' | 'login_required';

export function GiftCardPurchasePanel({ config }: { config: PublicGiftCardConfig }) {
  const min = config.minAmount > 0 ? config.minAmount : 20;
  const max = config.maxAmount > 0 ? config.maxAmount : 0;
  const presets = config.presetAmounts.length ? config.presetAmounts : [50, 80, 100, 150];

  const [amount, setAmount] = useState<number>(presets[0] ?? min);
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [acceptedCgv, setAcceptedCgv] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const belowMin = amount < min;
  const aboveMax = max > 0 && amount > max;
  const amountError = belowMin ? `Montant minimum : ${formatPrice(min)}.` : aboveMax ? `Montant maximum : ${formatPrice(max)}.` : '';
  const canPay = !amountError && acceptedCgv && phase !== 'submitting' && phase !== 'redirecting';

  const onPay = async () => {
    if (!canPay) return;
    setPhase('submitting');
    setErrorMsg('');
    const state = buildGiftCardCheckoutState(amount, { recipientName, message, acceptedCgv });
    try {
      const res = await createCheckoutSession(state);
      if (res.mode === 'hosted') {
        setPhase('redirecting');
        window.location.assign(res.url);
        return;
      }
      // Un achat de carte cadeau est toujours > 0 → jamais 'free'. 'elements' = flag off.
      setPhase('error');
      setErrorMsg('Le paiement hébergé n’est pas activé. Réessayez plus tard.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPhase('login_required');
        return;
      }
      const ux = err instanceof ApiError ? resolveErrorUx(err.code) : null;
      setPhase('error');
      setErrorMsg(ux?.message || (err instanceof ApiError ? err.message : 'Le paiement a échoué.'));
    }
  };

  return (
    <div className="gc-layout">
      <div className="gc-main">
        <Card>
          <h2 className="gc-block__title">Montant</h2>
          <div className="gc-presets" role="group" aria-label="Montants suggérés">
            {presets.map((p) => (
              <Chip key={p} tap active={amount === p} onClick={() => setAmount(p)}>
                {formatPrice(p)}
              </Chip>
            ))}
          </div>
          <FormField label="Montant personnalisé" htmlFor="gc-amount" error={amountError || undefined} hint={max > 0 ? `Entre ${formatPrice(min)} et ${formatPrice(max)}` : `Minimum ${formatPrice(min)}`}>
            <TextInput
              id="gc-amount"
              type="number"
              inputMode="numeric"
              min={min}
              max={max > 0 ? max : undefined}
              value={String(amount)}
              onChange={(e) => setAmount(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              invalid={Boolean(amountError)}
            />
          </FormField>
        </Card>

        <Card>
          <h2 className="gc-block__title">Bénéficiaire</h2>
          <FormField label="Nom du bénéficiaire" htmlFor="gc-recipient" hint="Apparaît sur la carte.">
            <TextInput id="gc-recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Ex. Camille" autoComplete="off" maxLength={120} />
          </FormField>
          <FormField label="Message (optionnel)" htmlFor="gc-message">
            <TextArea id="gc-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Un petit mot…" maxLength={500} rows={3} />
          </FormField>
        </Card>
      </div>

      <aside className="gc-aside">
        <Card>
          <GiftCardPreview amount={amount} recipientName={recipientName} message={message} />
          <div className="gc-summary">
            <div className="gc-summary__row gc-summary__row--total">
              <span>Total</span>
              <span>{formatPrice(amount)}</span>
            </div>
          </div>
          <Checkbox
            checked={acceptedCgv}
            onChange={(e) => setAcceptedCgv(e.target.checked)}
            label={
              <>
                J’accepte les <Link to="/cgv">conditions générales de vente</Link>.
              </>
            }
          />
          {phase === 'login_required' ? (
            <div className="gc-notice">
              <ErrorState title="Connexion requise pour payer." />
              <Link className="bs-btn" to="/connexion?redirect=/cartes-cadeaux">Se connecter</Link>
            </div>
          ) : null}
          {phase === 'error' ? (
            <div className="gc-notice">
              <ErrorState title="Le paiement n’a pas pu démarrer." detail={errorMsg} />
            </div>
          ) : null}
          {phase === 'redirecting' ? <LoadingState label="Redirection vers le paiement sécurisé…" /> : null}
          <Button type="button" className="gc-pay" onClick={() => void onPay()} disabled={!canPay}>
            {phase === 'submitting' ? 'Préparation…' : `Offrir · ${formatPrice(amount)}`}
          </Button>
          <p className="bs-note gc-trust">
            <i className="bi bi-shield-lock" aria-hidden="true" /> Paiement sécurisé via Stripe. Carte valable selon les conditions de l’institut.
          </p>
        </Card>
      </aside>
    </div>
  );
}
