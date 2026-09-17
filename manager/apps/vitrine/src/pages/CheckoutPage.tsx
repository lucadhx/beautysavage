import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SectionHeader, Card, Button, EmptyState, ErrorState, LoadingState, StickyBar } from '@bs/ui';
import {
  EMPTY_LEGAL_CONSENT,
  isLegalConsentComplete,
  buildServiceCheckoutState,
  buildIdempotencyKey,
  createCheckoutSession,
  finalizeFreeCheckout,
  formatPrice,
  ApiError,
  type LegalConsentState,
  type CheckoutLine,
} from '@bs/api-client';
import { resolveErrorUx } from '@bs/config';
import { useCart } from '../features/cart/CartProvider';
import { isFormationItem, isServiceItem, type ServiceCartItem } from '../features/cart/cartTypes';
import { LegalConsentChecklist } from '../features/legal/LegalConsentChecklist';
import { formatSlotLabel } from '../features/booking/dateUtils';
import { buildLegalRequirements, isLegalComplete, buildCartLegalPayload, type LegalAcceptState } from '../features/legal/cartLegalRequirements';
import { buildCartCheckoutState, computeCartTotals } from '../features/checkout/buildCartCheckoutState';
import { useCartAvailability } from '../features/checkout/useCartAvailability';
import { useGiftCardApply } from '../features/checkout/useGiftCardApply';
import {
  CheckoutItemCard,
  GiftCardApplyBox,
  AppliedGiftCardCard,
  CheckoutLegalRequirements,
  CheckoutPaymentSummary,
  allocationForCard,
} from '../features/checkout/components';
import '../features/checkout/checkout.css';

type Phase = 'idle' | 'submitting' | 'redirecting' | 'error' | 'login_required';

function toServiceLine(items: ReturnType<typeof useCart>['items']): CheckoutLine | null {
  const it = items.find((x) => x.kind === 'service' && (x as ServiceCartItem).selectedSlot) as ServiceCartItem | undefined;
  if (!it || !it.selectedSlot) return null;
  return {
    kind: 'service',
    refId: it.refId,
    slug: it.slug,
    name: it.name,
    indicativePrice: it.indicativePrice,
    service: {
      serviceId: it.refId,
      slotStart: it.selectedSlot.slotStart,
      slotEnd: it.selectedSlot.slotEnd,
      practitionerId: it.selectedSlot.practitionerId,
      selectedOptions: it.selectedOptions ?? [],
    },
  };
}

export function CheckoutPage() {
  const { items, removeItem } = useCart();
  const formationItems = items.filter(isFormationItem);
  const serviceItems = items.filter(isServiceItem);
  const hasFormationCart = formationItems.length > 0;

  if (items.length === 0) {
    return (
      <section>
        <SectionHeader title="Checkout" />
        <EmptyState label="Votre panier est vide." />
        <p>
          <Link to="/formations">Découvrir les formations →</Link>
        </p>
      </section>
    );
  }

  // Panier de formations → checkout multi-item premium. Sinon → prestation single-item (parcours S2).
  if (hasFormationCart) {
    return <CartCheckout />;
  }
  return <ServiceCheckout serviceItems={serviceItems} removeItem={removeItem} />;
}

// ─── Checkout PANIER (formations + cartes cadeaux en paiement) ──────────────────────────────────
function CartCheckout() {
  const { items, removeItem } = useCart();
  const navigate = useNavigate();
  const formationItems = items.filter(isFormationItem);
  const serviceItems = items.filter(isServiceItem);

  const availability = useCartAvailability(items);
  const requirements = useMemo(() => buildLegalRequirements(items), [items]);
  const [accepted, setAccepted] = useState<LegalAcceptState>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const subtotal = formationItems.reduce((s, it) => s + (it.indicativePrice ?? 0), 0);
  const gc = useGiftCardApply(subtotal);
  const totals = computeCartTotals(items, gc.allocations);

  const anyUnavailable = formationItems.some((it) => availability[it.lineId]?.available === false);
  const legalOk = isLegalComplete(requirements, accepted);
  const canPay = !anyUnavailable && legalOk && phase !== 'submitting' && phase !== 'redirecting';

  const onPay = async () => {
    if (!canPay) return;
    const acceptedAt = new Date().toISOString();
    const legalPayload = buildCartLegalPayload(requirements, accepted, acceptedAt);
    const checkoutState = buildCartCheckoutState(items, gc.allocations, legalPayload);
    setPhase('submitting');
    setErrorMsg('');
    try {
      if (totals.remainingToPay <= 0) {
        const idem = buildIdempotencyKey(`cart${formationItems.map((i) => i.refId).join('')}${acceptedAt}`);
        const free = await finalizeFreeCheckout(checkoutState, idem);
        navigate(`/paiement/succes?free=1&checkoutId=${encodeURIComponent(free.saleId)}`);
        return;
      }
      const res = await createCheckoutSession(checkoutState);
      if (res.mode === 'hosted') {
        setPhase('redirecting');
        window.location.assign(res.url);
        return;
      }
      if (res.mode === 'free') {
        const idem = buildIdempotencyKey(`cart${formationItems.map((i) => i.refId).join('')}${acceptedAt}`);
        const free = await finalizeFreeCheckout(checkoutState, idem);
        navigate(`/paiement/succes?free=1&checkoutId=${encodeURIComponent(free.saleId)}`);
        return;
      }
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
    <section className="co">
      <SectionHeader title="Votre commande" subtitle="Vérifiez votre panier, appliquez une carte cadeau, puis payez en toute sécurité." />

      <div className="co-layout">
        <div className="co-main">
          <Card>
            <h3 className="co-block__title">Articles</h3>
            {formationItems.map((it) => {
              const av = availability[it.lineId];
              return (
                <CheckoutItemCard
                  key={it.lineId}
                  title={it.name}
                  subtitle={
                    it.formationType === 'distanciel'
                      ? 'Formation en ligne — accès à vie'
                      : it.sessionStartAt
                        ? `Session du ${new Date(it.sessionStartAt).toLocaleDateString('fr-FR')}`
                        : 'Présentiel'
                  }
                  price={it.indicativePrice}
                  unavailableReason={av?.available === false ? av.reason : undefined}
                  onRemove={() => removeItem(it.lineId)}
                />
              );
            })}
            {serviceItems.length > 0 ? (
              <p className="bs-note co-separate">
                Vos prestations se règlent séparément (paiement individuel) — retrouvez-les dans votre panier.
              </p>
            ) : null}
          </Card>

          <Card>
            <h3 className="co-block__title">Carte cadeau</h3>
            {gc.cards.map((c) => (
              <AppliedGiftCardCard
                key={c.code}
                card={c}
                amountUsed={allocationForCard(gc.allocations, c.code)}
                onRemove={() => gc.remove(c.code)}
              />
            ))}
            <GiftCardApplyBox
              onApply={gc.apply}
              onSubmitPassword={gc.submitPassword}
              onCancelPassword={gc.cancelPassword}
              needsPasswordFor={gc.needsPasswordFor}
              pending={gc.pending}
              error={gc.error}
            />
          </Card>

          <Card>
            <CheckoutLegalRequirements
              requirements={requirements}
              accepted={accepted}
              onToggle={(id) => setAccepted((prev) => ({ ...prev, [id]: !prev[id] }))}
            />
          </Card>
        </div>

        <aside className="co-aside">
          <Card>
            <CheckoutPaymentSummary subtotal={totals.subtotal} giftCardUsed={totals.giftCardUsed} remaining={totals.remainingToPay} />
            {phase === 'login_required' ? (
              <div className="co-notice">
                <ErrorState title="Connexion requise pour payer." detail="Votre panier est conservé." />
                <Link className="bs-btn" to="/connexion?redirect=/checkout">
                  Se connecter
                </Link>
              </div>
            ) : null}
            {phase === 'error' ? (
              <div className="co-notice">
                <ErrorState title="Le paiement n’a pas pu démarrer." detail={errorMsg} />
              </div>
            ) : null}
            {phase === 'redirecting' ? <LoadingState label="Redirection vers le paiement sécurisé…" /> : null}
            {anyUnavailable ? <p className="bs-note">Retirez les articles non disponibles pour continuer.</p> : null}
            {!legalOk ? <p className="bs-note">Cochez les consentements requis pour continuer.</p> : null}
            <Button type="button" className="co-pay" onClick={() => void onPay()} disabled={!canPay}>
              {phase === 'submitting'
                ? 'Préparation…'
                : totals.remainingToPay <= 0
                  ? 'Valider ma commande'
                  : `Payer ${formatPrice(totals.remainingToPay)}`}
            </Button>
            <p className="bs-note co-trust">
              <i className="bi bi-shield-lock" aria-hidden="true" /> Paiement sécurisé via Stripe. Aucune donnée bancaire ne transite par ce site.
            </p>
          </Card>
        </aside>
      </div>

      {/* Sticky CTA mobile */}
      <StickyBar className="co-stickybar" desktopInline={false}>
        <span className="co-stickybar__price">{formatPrice(totals.remainingToPay)}</span>
        <Button type="button" onClick={() => void onPay()} disabled={!canPay} className="co-stickybar__cta">
          {totals.remainingToPay <= 0 ? 'Valider' : 'Payer'}
        </Button>
      </StickyBar>
    </section>
  );
}

// ─── Checkout PRESTATION single-item (parcours S2, inchangé) ────────────────────────────────────
function ServiceCheckout({
  serviceItems,
  removeItem,
}: {
  serviceItems: ServiceCartItem[];
  removeItem: (lineId: string) => void;
}) {
  const navigate = useNavigate();
  const [consent, setConsent] = useState<LegalConsentState>(EMPTY_LEGAL_CONSENT);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const hasDatedService = serviceItems.some((it) => it.selectedSlot);
  const serviceLine = useMemo(() => toServiceLine(serviceItems), [serviceItems]);
  const complete = isLegalConsentComplete(consent, { datedService: hasDatedService, retractation: false });

  const onPay = async () => {
    if (!complete || !serviceLine) return;
    const checkoutState = buildServiceCheckoutState(serviceLine, consent);
    if (!checkoutState) {
      setPhase('error');
      setErrorMsg('Article non payable.');
      return;
    }
    setPhase('submitting');
    setErrorMsg('');
    try {
      const res = await createCheckoutSession(checkoutState);
      if (res.mode === 'hosted') {
        setPhase('redirecting');
        window.location.assign(res.url);
        return;
      }
      if (res.mode === 'free') {
        const idempotencyKey = buildIdempotencyKey(`${serviceLine.refId}${serviceLine.service?.slotStart ?? ''}`);
        const free = await finalizeFreeCheckout(checkoutState, idempotencyKey);
        navigate(`/paiement/succes?free=1&checkoutId=${encodeURIComponent(free.saleId)}`);
        return;
      }
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
    <section>
      <SectionHeader title="Checkout" subtitle="Validez vos consentements puis procédez au paiement sécurisé." />
      <Card>
        <h3 className="co-block__title">Récapitulatif</h3>
        {serviceItems.map((it) => (
          <CheckoutItemCard
            key={it.lineId}
            title={it.name}
            subtitle={it.selectedSlot ? formatSlotLabel(it.selectedSlot.slotStart) : undefined}
            price={it.indicativePrice}
            onRemove={() => removeItem(it.lineId)}
          />
        ))}
      </Card>

      <div style={{ marginTop: 'var(--bs-space-3)' }}>
        <h3 className="co-block__title">Consentements</h3>
        <LegalConsentChecklist value={consent} onChange={setConsent} showDatedService={hasDatedService} />
      </div>

      {phase === 'login_required' ? (
        <div className="co-notice">
          <ErrorState title="Connexion requise pour payer." detail="Votre panier est conservé." />
          <Link className="bs-btn" to="/connexion?redirect=/checkout">
            Se connecter
          </Link>
        </div>
      ) : null}
      {phase === 'error' ? (
        <div className="co-notice">
          <ErrorState title="Le paiement n’a pas pu démarrer." detail={errorMsg} />
        </div>
      ) : null}
      {phase === 'redirecting' ? <LoadingState label="Redirection vers le paiement sécurisé…" /> : null}

      <div style={{ marginTop: 'var(--bs-space-3)' }}>
        <Button type="button" onClick={() => void onPay()} disabled={!complete || !serviceLine || phase === 'submitting' || phase === 'redirecting'}>
          {phase === 'submitting' ? 'Préparation…' : 'Payer / Confirmer'}
        </Button>
        {!complete ? <p className="bs-note">Cochez les consentements requis pour continuer.</p> : null}
        {!serviceLine ? <p className="bs-note">Aucune prestation avec créneau dans le panier.</p> : null}
      </div>
    </section>
  );
}
