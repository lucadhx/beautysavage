import * as React from 'react';
import { api } from '@/lib/api';
import { Button, Field, Input, SegmentedControl } from '@/components/ui/primitives';
import { CommercePageFrame, Panel, StatusBadge } from './CommerceShared';

type Mode = 'TEST' | 'PROD';

export default function CommerceApiKeysPage() {
  const [items, setItems] = React.useState<any[]>([]);
  const [stripe, setStripe] = React.useState({ mode: 'TEST' as Mode, publicKey: '', secretKey: '', webhookSecret: '' });
  const [brevo, setBrevo] = React.useState({ mode: 'TEST' as Mode, senderName: '', senderEmail: '', secretKey: '' });
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(() => {
    api.commerceIntegrations()
      .then(setItems)
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Acces reserve developpeur'));
  }, []);
  React.useEffect(refresh, [refresh]);

  async function saveStripe() {
    await api.saveCommerceIntegration({ provider: 'STRIPE_INSTITUTE', ...stripe });
    setMessage('Cles Stripe Institut enregistrees. Les paiements client restent separes des commissions plateforme.');
    refresh();
  }

  async function saveBrevo() {
    await api.saveCommerceIntegration({ provider: 'BREVO_INSTITUTE', ...brevo });
    setMessage('Configuration Brevo Institut enregistree.');
    refresh();
  }

  return (
    <CommercePageFrame
      title="Cles API institut"
      description="Configuration technique separee : paiements clients Stripe Institut et e-mails Brevo Institut. Les commissions utilisent les cles plateforme du panel."
    >
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Paiements clients - Stripe Institut">
          <div className="grid gap-3">
            <SegmentedControl value={stripe.mode} onChange={(mode) => setStripe({ ...stripe, mode })} options={[{ value: 'TEST', label: 'TEST' }, { value: 'PROD', label: 'PROD' }]} />
            <Field label="Cle publique"><Input value={stripe.publicKey} onChange={(e) => setStripe({ ...stripe, publicKey: e.target.value })} placeholder="pk_test_..." /></Field>
            <Field label="Cle secrete"><Input value={stripe.secretKey} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} placeholder="sk_test_..." /></Field>
            <Field label="Secret webhook"><Input value={stripe.webhookSecret} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} placeholder="whsec_..." /></Field>
            <Button onClick={saveStripe}>Enregistrer Stripe Institut</Button>
          </div>
        </Panel>
        <Panel title="E-mails institut - Brevo">
          <div className="grid gap-3">
            <SegmentedControl value={brevo.mode} onChange={(mode) => setBrevo({ ...brevo, mode })} options={[{ value: 'TEST', label: 'TEST' }, { value: 'PROD', label: 'PROD' }]} />
            <Field label="Nom expediteur"><Input value={brevo.senderName} onChange={(e) => setBrevo({ ...brevo, senderName: e.target.value })} placeholder="BeautySavage" /></Field>
            <Field label="Adresse expediteur"><Input type="email" value={brevo.senderEmail} onChange={(e) => setBrevo({ ...brevo, senderEmail: e.target.value })} placeholder="contact@institut.fr" /></Field>
            <Field label="Cle API Brevo"><Input value={brevo.secretKey} onChange={(e) => setBrevo({ ...brevo, secretKey: e.target.value })} /></Field>
            <Button onClick={saveBrevo}>Enregistrer Brevo Institut</Button>
          </div>
        </Panel>
      </div>
      <Panel title="Etat masque des integrations">
        <div className="grid gap-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">Aucune integration institut configuree.</p>}
          {items.map((item) => (
            <div key={item.provider} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <p className="font-semibold">{item.provider}</p>
                <p className="text-xs text-muted-foreground">
                  Mode {item.mode} - expediteur {item.senderName || item.senderEmail || 'non renseigne'} - public {item.publicKey || 'non renseigne'} - secret {item.secretKey || 'non renseigne'} - webhook {item.webhookSecret || 'non renseigne'}
                </p>
              </div>
              <StatusBadge>{item.verified ? 'VERIFIE' : 'A TESTER'}</StatusBadge>
            </div>
          ))}
        </div>
      </Panel>
    </CommercePageFrame>
  );
}
