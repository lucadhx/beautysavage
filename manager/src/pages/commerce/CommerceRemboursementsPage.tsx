import * as React from 'react';
import { api } from '@/lib/api';
import { Button, Field, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { CommercePageFrame, Metric, Panel, StatusBadge, cents, dateShort, type RefundRequest } from './CommerceShared';

function customer(value: RefundRequest['customerId']) {
  if (typeof value === 'object' && value) return [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email || 'Client';
  return 'Client';
}

function sale(value: RefundRequest['saleId']) {
  return typeof value === 'object' && value ? value.saleNumber || 'Vente' : 'Vente';
}

export default function CommerceRemboursementsPage() {
  const [items, setItems] = React.useState<RefundRequest[]>([]);
  const [decision, setDecision] = React.useState<{ item: RefundRequest; status: string; comment: string } | null>(null);
  const [message, setMessage] = React.useState('');
  const refresh = React.useCallback(() => {
    api.commerceRefundRequests().then((list) => setItems(list as RefundRequest[])).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);
  React.useEffect(refresh, [refresh]);

  async function decide() {
    if (!decision) return;
    await api.decideCommerceRefundRequest(decision.item._id, { status: decision.status, comment: decision.comment, refundedAmountCents: decision.item.eligibleAmountCents });
    setDecision(null);
    setMessage('Demande mise a jour.');
    refresh();
  }

  return (
    <CommercePageFrame title="Remboursements" description="Demandes clients, eligibilite calculee, decisions manager et traçabilite par ligne de vente.">
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-4">
        <Metric label="Demandes" value={items.length} />
        <Metric label="A traiter" value={items.filter((item) => item.status === 'REQUESTED').length} />
        <Metric label="Remboursees" value={items.filter((item) => item.status === 'REFUNDED').length} />
        <Metric label="Montant eligible" value={cents(items.reduce((sum, item) => sum + (item.eligibleAmountCents || 0), 0))} />
      </div>
      <Panel title="File de traitement">
        <div className="grid gap-3">
          {items.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune demande de remboursement.</p>}
          {items.map((item) => (
            <div key={item._id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{sale(item.saleId)} · {customer(item.customerId)}</p>
                  <p className="text-sm text-muted-foreground">{dateShort(item.createdAt)} · demande {cents(item.requestedAmountCents)} · eligible {cents(item.eligibleAmountCents)}</p>
                </div>
                <StatusBadge>{item.status}</StatusBadge>
              </div>
              <p className="mt-3 text-sm">{item.reason || 'Aucun motif client.'}</p>
              {item.managerComment && <p className="mt-2 text-xs text-muted-foreground">Manager : {item.managerComment}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setDecision({ item, status: 'ACCEPTED', comment: item.managerComment || '' })}>Accepter</Button>
                <Button size="sm" variant="outline" onClick={() => setDecision({ item, status: 'REFUNDED', comment: item.managerComment || '' })}>Marquer rembourse</Button>
                <Button size="sm" variant="destructive" onClick={() => setDecision({ item, status: 'REJECTED', comment: item.managerComment || '' })}>Refuser</Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Modal
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={decision?.status === 'REJECTED' ? 'Refuser la demande' : 'Traiter la demande'}
        className="max-w-md"
      >
        {decision && (
          <div className="grid gap-4">
            <Field label={decision.status === 'REJECTED' ? 'Motif du refus' : 'Commentaire manager'}>
              <Textarea value={decision.comment} onChange={(event) => setDecision({ ...decision, comment: event.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDecision(null)}>Annuler</Button>
              <Button variant={decision.status === 'REJECTED' ? 'destructive' : 'default'} onClick={decide}>Valider</Button>
            </div>
          </div>
        )}
      </Modal>
    </CommercePageFrame>
  );
}
