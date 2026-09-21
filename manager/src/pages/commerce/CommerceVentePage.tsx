import * as React from 'react';
import { api } from '@/lib/api';
import { CustomSelect } from '@/components/ui/CustomSelect';
import {
  CommercePageFrame,
  Metric,
  Panel,
  ProductForm,
  ProductTable,
  cents,
  type CommerceProduct,
  type CommerceSale,
} from './CommerceShared';

interface Integration {
  provider: string;
  mode: 'TEST' | 'PROD';
  verified?: boolean;
  publicKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  senderEmail?: string;
}

export default function CommerceVentePage() {
  const [products, setProducts] = React.useState<CommerceProduct[]>([]);
  const [sales, setSales] = React.useState<CommerceSale[]>([]);
  const [integrations, setIntegrations] = React.useState<Integration[]>([]);
  const [stripeMode, setStripeMode] = React.useState<'TEST' | 'PROD'>('TEST');
  const [brevoMode, setBrevoMode] = React.useState<'TEST' | 'PROD'>('TEST');
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(() => {
    Promise.all([api.commerceProducts(), api.commerceSales()])
      .then(([productList, saleList]) => {
        setProducts(productList as CommerceProduct[]);
        setSales(saleList as CommerceSale[]);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
    api.commerceIntegrations()
      .then((list) => setIntegrations(list as Integration[]))
      .catch(() => setIntegrations([]));
  }, []);

  React.useEffect(refresh, [refresh]);

  async function saveStripe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api.saveCommerceIntegration({
      provider: 'STRIPE_INSTITUTE',
      mode: stripeMode,
      publicKey: form.get('publicKey'),
      secretKey: form.get('secretKey'),
      webhookSecret: form.get('webhookSecret'),
    });
    setMessage('Paiement institut enregistre.');
    refresh();
  }

  async function saveBrevo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api.saveCommerceIntegration({
      provider: 'BREVO_INSTITUTE',
      mode: brevoMode,
      secretKey: form.get('secretKey'),
      senderEmail: form.get('senderEmail'),
    });
    setMessage('Configuration Brevo Institut enregistree.');
    refresh();
  }

  const sellable = products.filter((product) => product.kind === 'PRODUCT' || product.kind === 'GIFT_CARD');
  const paidSales = sales.filter((sale) => sale.paymentStatus === 'PAID');
  const revenue = paidSales.reduce((sum, sale) => sum + (sale.totalCents || 0), 0);

  return (
    <CommercePageFrame
      title="Vente en ligne"
      description="Boutique, cartes cadeaux, paiements et e-mails envoyes par l'institut."
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Articles vendables" value={sellable.length} />
        <Metric label="Ventes payees" value={paidSales.length} />
        <Metric label="CA encaisse" value={cents(revenue)} />
      </div>
      <ProductForm
        title="Ajouter un article boutique ou une carte cadeau"
        allowedKinds={['PRODUCT', 'GIFT_CARD']}
        defaultKind="PRODUCT"
        onSaved={refresh}
      />
      <Panel title="Catalogue vente">
        <ProductTable products={sellable} />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Paiement institut">
          <form onSubmit={saveStripe} className="grid gap-3">
            <CustomSelect value={stripeMode} onChange={(value) => setStripeMode(value as 'TEST' | 'PROD')} options={[{ value: 'TEST', label: 'TEST' }, { value: 'PROD', label: 'PROD' }]} />
            <input name="publicKey" placeholder="Identifiant public de paiement" className="rounded-md border bg-background px-3 py-2" />
            <input name="secretKey" placeholder="Identifiant prive de paiement" className="rounded-md border bg-background px-3 py-2" />
            <input name="webhookSecret" placeholder="Signature de confirmation paiement" className="rounded-md border bg-background px-3 py-2" />
            <button className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground">Enregistrer le paiement</button>
          </form>
        </Panel>
        <Panel title="E-mails institut">
          <form onSubmit={saveBrevo} className="grid gap-3">
            <CustomSelect value={brevoMode} onChange={(value) => setBrevoMode(value as 'TEST' | 'PROD')} options={[{ value: 'TEST', label: 'TEST' }, { value: 'PROD', label: 'PROD' }]} />
            <input name="senderEmail" type="email" placeholder="Expediteur institut" className="rounded-md border bg-background px-3 py-2" />
            <input name="secretKey" placeholder="Identifiant prive d'envoi" className="rounded-md border bg-background px-3 py-2" />
            <button className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground">Enregistrer les e-mails</button>
          </form>
        </Panel>
      </div>
      <Panel title="Etat des connexions institut">
        {integrations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune connexion institut configuree pour le moment.</p>
        ) : (
          <div className="grid gap-2">
            {integrations.map((integration) => (
              <div key={integration.provider} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-3">
                  <strong>{integration.provider}</strong>
                  <span>{integration.verified ? 'Verifie' : 'A tester'}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Mode {integration.mode}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </CommercePageFrame>
  );
}
