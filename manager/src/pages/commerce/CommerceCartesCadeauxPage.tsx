import * as React from 'react';
import { api } from '@/lib/api';
import { Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { CommercePageFrame, Metric, Panel, StatusBadge, cents, dateShort, type CommerceProduct, type GiftCard } from './CommerceShared';

export default function CommerceCartesCadeauxPage() {
  const [cards, setCards] = React.useState<GiftCard[]>([]);
  const [giftProduct, setGiftProduct] = React.useState<CommerceProduct | null>(null);
  const [minimumEuros, setMinimumEuros] = React.useState('0');
  const [form, setForm] = React.useState({ amountEuros: '50', recipientName: '', recipientEmail: '', message: '' });
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [adjustDraft, setAdjustDraft] = React.useState<{ card: GiftCard; type: 'DEBIT' | 'CREDIT' | 'VOID'; amountEuros: string; reason: string } | null>(null);
  const [message, setMessage] = React.useState('');
  const refresh = React.useCallback(() => {
    api.commerceGiftCards().then((list) => setCards(list as GiftCard[])).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
    api.commerceProducts()
      .then((items) => {
        const product = (items as CommerceProduct[]).find((item) => item.kind === 'GIFT_CARD') ?? null;
        setGiftProduct(product);
        setMinimumEuros(String(Math.round((product?.price?.amountCents || 0) / 100)));
      })
      .catch(() => null);
  }, []);
  React.useEffect(refresh, [refresh]);

  async function issue() {
    const created = await api.issueCommerceGiftCard({
      amountCents: Math.round(Number(form.amountEuros || 0) * 100),
      recipientName: form.recipientName,
      recipientEmail: form.recipientEmail,
      message: form.message,
    });
    setMessage(created.oneTimeCode ? `Carte emise. Code a remettre une seule fois : ${created.oneTimeCode}` : 'Carte emise.');
    setIssueOpen(false);
    refresh();
  }

  async function adjust() {
    if (!adjustDraft) return;
    await api.adjustCommerceGiftCard(adjustDraft.card._id, { type: adjustDraft.type, amountCents: Math.round(Number(adjustDraft.amountEuros || 0) * 100), reason: adjustDraft.reason });
    setAdjustDraft(null);
    setMessage('Carte cadeau mise a jour.');
    refresh();
  }

  async function saveMinimum() {
    const amountCents = Math.max(0, Math.round(Number(minimumEuros || 0) * 100));
    const saved = await api.saveCommerceProduct({
      id: giftProduct?._id,
      slug: giftProduct?.slug || 'carte-cadeau-beautysavage',
      title: giftProduct?.title || 'Carte cadeau BeautySavage',
      subtitle: giftProduct?.subtitle || 'Offrir une experience institut.',
      description: giftProduct?.description || 'Carte cadeau utilisable sur les prestations et achats BeautySavage.',
      kind: 'GIFT_CARD',
      status: giftProduct?.status || 'PUBLISHED',
      price: { amountCents, currency: 'EUR' },
      coverUrl: giftProduct?.coverUrl || '/gift-card-master.jpg',
      gallery: giftProduct?.gallery || [],
      options: giftProduct?.options || [],
    });
    setGiftProduct(saved as CommerceProduct);
    setMinimumEuros(String(Math.round(((saved as CommerceProduct).price?.amountCents || 0) / 100)));
    setMessage(amountCents > 0 ? 'Montant minimum de la carte cadeau enregistre.' : 'Montant minimum retire.');
  }

  return (
    <CommercePageFrame title="Cartes cadeaux" description="Emission, solde, debit/recredit et ledger. Les codes restent masques apres creation.">
      {message && <p className="rounded-md border p-3 text-sm text-muted-foreground">{message}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="Cartes" value={cards.length} />
        <Metric label="Actives" value={cards.filter((card) => card.status === 'ACTIVE').length} />
        <Metric label="Solde total" value={cents(cards.reduce((sum, card) => sum + (card.balanceCents || 0), 0))} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => setIssueOpen(true)}>Emettre une carte cadeau</Button>
      </div>
      <Panel title="Reglage vitrine">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Field
            label="Montant minimum des cartes cadeaux"
            hint="Laissez 0 pour ne pas afficher de prix sur la vitrine. Si un minimum est saisi, la vitrine affichera A partir de ce montant."
          >
            <Input type="number" min="0" step="1" value={minimumEuros} onChange={(e) => setMinimumEuros(e.target.value)} />
          </Field>
          <Button onClick={saveMinimum}>Enregistrer</Button>
        </div>
      </Panel>
      <Panel title="Cartes emises">
        <div className="grid gap-3">
          {cards.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Aucune carte cadeau.</p>}
          {cards.map((card) => (
            <div key={card._id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{card.codeMasked} · {card.recipientName || 'Beneficiaire libre'}</p>
                  <p className="text-sm text-muted-foreground">{dateShort(card.createdAt)} · initial {cents(card.initialAmountCents)} · solde {cents(card.balanceCents)}</p>
                  {card.senderName && <p className="text-xs text-muted-foreground">De la part de {card.senderName}</p>}
                </div>
                <StatusBadge>{card.status}</StatusBadge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {card.pdfUrl && <a className="rounded-md border px-3 py-1.5 text-xs font-semibold" href={card.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}
                <Button size="sm" variant="outline" onClick={() => setAdjustDraft({ card, type: 'DEBIT', amountEuros: '0', reason: '' })}>Debiter</Button>
                <Button size="sm" variant="outline" onClick={() => setAdjustDraft({ card, type: 'CREDIT', amountEuros: '0', reason: '' })}>Recrediter</Button>
                <Button size="sm" variant="destructive" onClick={() => setAdjustDraft({ card, type: 'VOID', amountEuros: '0', reason: '' })}>Annuler</Button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Emettre une carte cadeau"
        className="max-w-2xl"
      >
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Montant EUR"><Input type="number" min="10" step="1" value={form.amountEuros} onChange={(e) => setForm({ ...form, amountEuros: e.target.value })} /></Field>
            <Field label="Beneficiaire"><Input value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} /></Field>
            <Field label="E-mail beneficiaire"><Input type="email" value={form.recipientEmail} onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} /></Field>
          </div>
          <Field label="Message"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIssueOpen(false)}>Annuler</Button>
            <Button onClick={issue}>Emettre</Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={Boolean(adjustDraft)}
        onClose={() => setAdjustDraft(null)}
        title={adjustDraft?.type === 'VOID' ? 'Annuler la carte cadeau' : adjustDraft?.type === 'DEBIT' ? 'Debiter la carte cadeau' : 'Recrediter la carte cadeau'}
        className="max-w-md"
      >
        {adjustDraft && (
          <div className="grid gap-4">
            {adjustDraft.type !== 'VOID' && (
              <Field label="Montant EUR">
                <Input type="number" min="0" step="0.01" value={adjustDraft.amountEuros} onChange={(event) => setAdjustDraft({ ...adjustDraft, amountEuros: event.target.value })} />
              </Field>
            )}
            <Field label="Motif">
              <Textarea value={adjustDraft.reason} onChange={(event) => setAdjustDraft({ ...adjustDraft, reason: event.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAdjustDraft(null)}>Annuler</Button>
              <Button variant={adjustDraft.type === 'VOID' ? 'destructive' : 'default'} onClick={adjust}>Valider</Button>
            </div>
          </div>
        )}
      </Modal>
    </CommercePageFrame>
  );
}
