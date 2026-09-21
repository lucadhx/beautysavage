import * as React from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { customerApi, type CartView } from '@/lib/api';
import { useCustomer } from '@/context/CustomerContext';

const formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export default function CartPage() {
  const { customer } = useCustomer();
  const [cart, setCart] = React.useState<CartView | null>(null);
  const [message, setMessage] = React.useState('');
  const [consents, setConsents] = React.useState<string[]>([]);
  const [giftCardCode, setGiftCardCode] = React.useState('');

  const refresh = React.useCallback(() => {
    if (!customer) return;
    customerApi.cart().then(setCart).catch((err) => setMessage(err.message));
  }, [customer]);

  React.useEffect(refresh, [refresh]);

  async function checkout() {
    try {
      if (!customer?.emailVerified) {
        setMessage('Verifiez votre e-mail avant de passer au paiement.');
        return;
      }
      const required = (cart?.lines ?? []).flatMap((line) => (line.consentRequirements ?? []).filter((item) => item.required).map((item) => `${line.id}:${item.key}`));
      const missing = required.filter((key) => !consents.includes(key));
      if (missing.length > 0) {
        setMessage('Veuillez accepter les consentements requis pour chaque article concerne.');
        return;
      }
      const result = await customerApi.checkout(consents, giftCardCode.trim() ? [giftCardCode.trim()] : []);
      setMessage(result.message);
      if (result.checkoutUrl) window.location.href = result.checkoutUrl;
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Checkout indisponible');
    }
  }

  if (!customer) {
    return (
      <section className="mx-auto min-h-screen max-w-3xl px-5 pt-32">
        <h1 className="text-4xl font-semibold">Panier</h1>
        <p className="mt-4" style={{ color: 'var(--v-muted-foreground)' }}>Connectez-vous pour gerer votre panier.</p>
        <Link to="/connexion-client" className="mt-6 inline-flex rounded-md px-5 py-3 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Me connecter</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto min-h-screen max-w-4xl px-5 pb-24 pt-32 md:px-8">
      <h1 className="text-4xl font-semibold">Panier</h1>
      <div className="mt-8 grid gap-4">
        {(cart?.lines ?? []).map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-4 rounded-lg border p-4" style={{ borderColor: 'var(--v-border)' }}>
            <div>
              <p className="font-semibold">{line.product.title}</p>
              <p className="text-sm" style={{ color: 'var(--v-muted-foreground)' }}>Quantite {line.quantity}</p>
              {line.giftCard && (
                <p className="mt-1 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>
                  Carte cadeau pour {line.giftCard.recipientName || 'beneficiaire'} de la part de {line.giftCard.senderName || 'vous'}
                </p>
              )}
              {(line.consentRequirements ?? []).map((requirement) => {
                const key = `${line.id}:${requirement.key}`;
                return (
                  <label key={key} className="mt-3 flex items-start gap-2 text-xs" style={{ color: 'var(--v-muted-foreground)' }}>
                    <input
                      type="checkbox"
                      checked={consents.includes(key)}
                      onChange={(event) => setConsents((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))}
                    />
                    <span>{requirement.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-4">
              <span className="font-semibold">{formatter.format(line.totalCents / 100)}</span>
              <button aria-label="Retirer" onClick={() => customerApi.removeCartItem(line.id).then(setCart)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between border-t pt-6" style={{ borderColor: 'var(--v-border)' }}>
        <span>Total</span>
        <strong>{formatter.format((cart?.totalCents ?? 0) / 100)}</strong>
      </div>
      <label className="mt-6 grid gap-2 text-sm font-medium">
        Regler avec une carte cadeau
        <input
          className="v-field rounded-md px-3 py-3"
          value={giftCardCode}
          onChange={(event) => setGiftCardCode(event.target.value)}
          placeholder="Code carte cadeau"
        />
      </label>
      {!customer.emailVerified && (
        <div className="mt-6 rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--v-border)', background: 'color-mix(in srgb, var(--v-primary) 10%, transparent)' }}>
          <p className="font-semibold">Verification e-mail requise avant achat</p>
          <p className="mt-1" style={{ color: 'var(--v-muted-foreground)' }}>Votre panier est conserve. Validez le code recu par e-mail depuis votre profil pour acceder au paiement.</p>
          <Link to="/espace-client" className="mt-3 inline-flex rounded-md px-4 py-2 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>Verifier mon compte</Link>
        </div>
      )}
      <button onClick={checkout} className="mt-6 w-full rounded-md px-5 py-3 font-semibold" style={{ background: 'var(--v-primary)', color: 'var(--v-primary-foreground)' }}>
        Passer au paiement
      </button>
      {message && <p className="mt-4 text-sm" style={{ color: 'var(--v-muted-foreground)' }}>{message}</p>}
    </section>
  );
}
