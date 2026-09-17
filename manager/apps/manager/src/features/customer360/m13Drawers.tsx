// M13 — Drawers d'actions inline de la fiche client (Customer 360) : créer une carte cadeau
// (paiement sur place), débit manuel d'une carte (lookup code/QR → preview → confirmation),
// réservation manuelle (hold + confirmation, solde sur place) et note interne. Mobile-first
// bottom-sheet (réutilise le look CustomerDrawer), tokens --bs-* uniquement, cibles ≥44px,
// Escape pour fermer. Le backend reste l'autorité (montants, soldes, anti-doublon).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  createManualGiftCard,
  lookupGiftCardByCode,
  lookupGiftCardByQr,
  previewManualDebit,
  manualDebitGiftCard,
  listGiftCardLibrary,
  listBookableServices,
  getAvailabilitySlots,
  holdBookingSlot,
  releaseBookingSlot,
  createManualBooking,
  listCustomerNotes,
  createCustomerNote,
  type GiftCardSummary,
  type ManualGiftCardCreated,
  type GiftCardManualPaymentMethod,
  type BookableService,
  type ManualBookingSlot,
  type SlotHold,
} from '@bs/api-client';
import { CustomerDrawer, money, fmtDate, fmtDateTime } from './components';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || 'Erreur.';
  return 'Une erreur est survenue.';
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ── Créer une carte cadeau ────────────────────────────────────────────────────
const PAYMENT_METHODS: { value: GiftCardManualPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Espèces' },
  { value: 'card', label: 'Carte bancaire' },
  { value: 'other', label: 'Autre' },
];

export function CreateGiftCardDrawer({ open, customerId, onClose, onDone }: {
  open: boolean; customerId: string; onClose: () => void; onDone: () => void;
}) {
  const [recipientName, setRecipientName] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<GiftCardManualPaymentMethod>('cash');
  const [paymentNote, setPaymentNote] = useState('');
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [created, setCreated] = useState<ManualGiftCardCreated | null>(null);

  const library = useQuery({ queryKey: ['gift-card-library'], queryFn: listGiftCardLibrary, enabled: open, retry: false });

  useEffect(() => {
    if (!open) {
      setRecipientName(''); setAmount(''); setMethod('cash'); setPaymentNote(''); setMessage(''); setTemplateId(''); setCreated(null);
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: () => createManualGiftCard({
      customerId, recipientName: recipientName.trim(), amount: Number(amount),
      manualPaymentMethod: method, manualPaymentNote: paymentNote.trim() || undefined,
      message: message.trim() || undefined, templateId: templateId || undefined,
    }),
    onSuccess: (card) => { setCreated(card); onDone(); },
  });

  const canSubmit = recipientName.trim().length > 0 && Number(amount) > 0 && !mut.isPending;

  return (
    <CustomerDrawer open={open} title="Créer une carte cadeau" onClose={onClose}>
      {created ? (
        <div className="gc-success" data-testid="gc-create-success">
          <i className="bi-check-circle-fill gc-success__icon" aria-hidden="true" />
          <strong>Carte cadeau créée</strong>
          <div className="c3-row"><span>Code</span><strong>{created.code}</strong></div>
          <div className="c3-row"><span>Mot de passe</span><strong>{created.password}</strong></div>
          <div className="c3-row"><span>Montant</span><strong>{money(created.amount)}</strong></div>
          <div className="c3-row"><span>Paiement</span><strong>{created.paymentLabel}</strong></div>
          <div className="gc-links">
            {created.cardVisualUrl ? <a className="c3-quickbtn" href={created.cardVisualUrl} target="_blank" rel="noreferrer"><i className="bi-image" aria-hidden="true" /><span>Visuel</span></a> : null}
            {created.generatedPdfUrl ? <a className="c3-quickbtn" href={created.generatedPdfUrl} target="_blank" rel="noreferrer"><i className="bi-file-pdf" aria-hidden="true" /><span>PDF</span></a> : null}
          </div>
          <button type="button" className="c3-quickbtn gc-btn--block" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <form className="gc-form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }}>
          <label className="gc-field">
            <span className="gc-label">Bénéficiaire *</span>
            <input className="gc-input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Nom du bénéficiaire" />
          </label>
          <label className="gc-field">
            <span className="gc-label">Montant (€) *</span>
            <input className="gc-input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50" />
          </label>
          <div className="gc-field">
            <span className="gc-label">Mode de paiement sur place</span>
            <div className="gc-segmented" role="group" aria-label="Mode de paiement">
              {PAYMENT_METHODS.map((m) => (
                <button type="button" key={m.value} className={`gc-seg${method === m.value ? ' gc-seg--active' : ''}`} onClick={() => setMethod(m.value)}>{m.label}</button>
              ))}
            </div>
          </div>
          <label className="gc-field">
            <span className="gc-label">Note de paiement</span>
            <input className="gc-input" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="Facultatif" />
          </label>
          <label className="gc-field">
            <span className="gc-label">Message</span>
            <textarea className="gc-textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message facultatif sur la carte" />
          </label>
          <label className="gc-field">
            <span className="gc-label">Modèle de carte</span>
            <select className="gc-input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">Modèle actif (par défaut)</option>
              {(library.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <p className="gc-note"><i className="bi-info-circle" aria-hidden="true" /> Paiement sur place — aucun encaissement en ligne.</p>
          {mut.isError ? <p className="gc-error" role="alert">{errorMessage(mut.error)}</p> : null}
          <button type="submit" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={!canSubmit}>
            {mut.isPending ? 'Création…' : 'Créer la carte cadeau'}
          </button>
        </form>
      )}
    </CustomerDrawer>
  );
}

// ── Débit manuel d'une carte cadeau ────────────────────────────────────────────
export function ManualGiftCardDebitDrawer({ open, onClose, onDone }: {
  open: boolean; onClose: () => void; onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [qr, setQr] = useState('');
  const [card, setCard] = useState<GiftCardSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<{ balanceBefore: number; balanceAfter: number; amount: number } | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) { setCode(''); setQr(''); setCard(null); setAmount(''); setReason(''); setPreview(null); setDone(false); setError(null); }
  }, [open]);

  const lookupMut = useMutation({
    mutationFn: async () => {
      if (qr.trim()) return lookupGiftCardByQr(qr.trim());
      return lookupGiftCardByCode(code.trim());
    },
    onSuccess: (c) => { setCard(c); setError(null); setPreview(null); },
    onError: (e) => { setError(errorMessage(e)); setCard(null); },
  });

  const previewMut = useMutation({
    mutationFn: () => previewManualDebit(card!.id, Number(amount), reason.trim()),
    onSuccess: (p) => { setPreview({ balanceBefore: p.balanceBefore, balanceAfter: p.balanceAfter, amount: p.amount }); setError(null); },
    onError: (e) => { setError(errorMessage(e)); setPreview(null); },
  });

  const confirmMut = useMutation({
    mutationFn: () => manualDebitGiftCard(card!.id, Number(amount), reason.trim()),
    onSuccess: () => { setDone(true); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });

  const canLookup = (code.trim().length > 0 || qr.trim().length > 0) && !lookupMut.isPending;
  const canPreview = Boolean(card) && Number(amount) > 0 && reason.trim().length > 0 && !previewMut.isPending;

  return (
    <CustomerDrawer open={open} title="Débit manuel d'une carte" onClose={onClose}>
      {done ? (
        <div className="gc-success" data-testid="gc-debit-success">
          <i className="bi-check-circle-fill gc-success__icon" aria-hidden="true" />
          <strong>Débit effectué</strong>
          <button type="button" className="c3-quickbtn gc-btn--block" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <div className="gc-form">
          {!card ? (
            <>
              <label className="gc-field">
                <span className="gc-label">Code de la carte</span>
                <input className="gc-input" value={code} onChange={(e) => { setCode(e.target.value); setQr(''); }} placeholder="GC-XXXX" />
              </label>
              <label className="gc-field">
                <span className="gc-label">Scanner / coller le QR</span>
                <input className="gc-input" value={qr} onChange={(e) => { setQr(e.target.value); setCode(''); }} placeholder="Coller le contenu du QR code" data-testid="gc-debit-qr" />
              </label>
              {error ? <p className="gc-error" role="alert">{error}</p> : null}
              <button type="button" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={!canLookup} onClick={() => lookupMut.mutate()}>
                {lookupMut.isPending ? 'Recherche…' : 'Rechercher la carte'}
              </button>
            </>
          ) : (
            <>
              <div className="gc-card-recap" data-testid="gc-debit-card">
                <div className="c3-row"><span>Carte</span><strong>{card.code}</strong></div>
                <div className="c3-row"><span>Solde disponible</span><strong>{money(card.availableBalance ?? card.balance)}</strong></div>
                <div className="c3-row"><span>Statut</span><strong>{card.status}</strong></div>
              </div>
              <label className="gc-field">
                <span className="gc-label">Montant à débiter (€) *</span>
                <input className="gc-input" type="number" min="0" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} />
              </label>
              <label className="gc-field">
                <span className="gc-label">Motif *</span>
                <input className="gc-input" value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="Motif du débit" />
              </label>
              {error ? <p className="gc-error" role="alert">{error}</p> : null}
              {preview ? (
                <div className="gc-preview" data-testid="gc-debit-preview">
                  <div className="c3-row"><span>Débit</span><strong>{money(preview.amount)}</strong></div>
                  <div className="c3-row"><span>Solde restant</span><strong>{money(preview.balanceAfter)}</strong></div>
                  <button type="button" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={confirmMut.isPending} onClick={() => confirmMut.mutate()}>
                    {confirmMut.isPending ? 'Débit…' : 'Confirmer le débit'}
                  </button>
                </div>
              ) : (
                <button type="button" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={!canPreview} onClick={() => previewMut.mutate()}>
                  {previewMut.isPending ? 'Calcul…' : 'Aperçu du solde restant'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </CustomerDrawer>
  );
}

// ── Réservation manuelle ───────────────────────────────────────────────────────
export function ManualBookingDrawer({ open, customerId, onClose, onDone }: {
  open: boolean; customerId: string; onClose: () => void; onDone: () => void;
}) {
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [slot, setSlot] = useState<ManualBookingSlot | null>(null);
  const [hold, setHold] = useState<SlotHold | null>(null);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const services = useQuery({ queryKey: ['bookable-services'], queryFn: listBookableServices, enabled: open, retry: false });
  const selectedService: BookableService | undefined = useMemo(
    () => (services.data ?? []).find((s) => s.id === serviceId),
    [services.data, serviceId],
  );

  const slots = useQuery({
    queryKey: ['availability-slots', serviceId, date],
    queryFn: () => getAvailabilitySlots(serviceId, date),
    enabled: open && Boolean(serviceId) && Boolean(date),
    retry: false,
  });

  const releaseHold = () => { if (hold) { void releaseBookingSlot(hold.holdToken).catch(() => {}); } };

  // Libère le hold quand le drawer se ferme.
  useEffect(() => {
    if (!open) {
      releaseHold();
      setServiceId(''); setDate(todayStr()); setSlot(null); setHold(null); setNote(''); setDone(false); setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const holdMut = useMutation({
    mutationFn: (s: ManualBookingSlot) => holdBookingSlot(serviceId, s.start, s.end),
    onSuccess: (h, s) => { setHold(h); setSlot(s); setError(null); },
    onError: (e) => { setError(errorMessage(e)); setSlot(null); setHold(null); },
  });

  const confirmMut = useMutation({
    mutationFn: () => createManualBooking({
      clientId: customerId, serviceId, startAt: slot!.start, note: note.trim() || undefined, holdToken: hold?.holdToken,
    }),
    onSuccess: () => { setHold(null); setDone(true); onDone(); },
    onError: (e) => setError(errorMessage(e)),
  });

  const onSelectSlot = (s: ManualBookingSlot) => { releaseHold(); holdMut.mutate(s); };

  return (
    <CustomerDrawer open={open} title="Réserver une prestation" onClose={onClose}>
      {done ? (
        <div className="gc-success" data-testid="mb-success">
          <i className="bi-check-circle-fill gc-success__icon" aria-hidden="true" />
          <strong>Réservation confirmée</strong>
          <p className="gc-note">Solde à régler sur place.</p>
          <button type="button" className="c3-quickbtn gc-btn--block" onClick={onClose}>Fermer</button>
        </div>
      ) : (
        <div className="gc-form">
          <label className="gc-field">
            <span className="gc-label">Prestation *</span>
            <select className="gc-input" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlot(null); releaseHold(); setHold(null); }} data-testid="mb-service">
              <option value="">Choisir une prestation</option>
              {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.effectivePrice ?? s.price)}</option>)}
            </select>
          </label>
          {serviceId ? (
            <label className="gc-field">
              <span className="gc-label">Date *</span>
              <input className="gc-input" type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(null); releaseHold(); setHold(null); }} data-testid="mb-date" />
            </label>
          ) : null}
          {serviceId && date ? (
            <div className="gc-field">
              <span className="gc-label">Créneau *</span>
              {slots.isLoading ? <p className="gc-note">Chargement des créneaux…</p> : null}
              {!slots.isLoading && (slots.data ?? []).length === 0 ? <p className="gc-note">Aucun créneau disponible ce jour.</p> : null}
              <div className="gc-slots" data-testid="mb-slots">
                {(slots.data ?? []).map((s) => (
                  <button type="button" key={s.start} className={`gc-slot${slot?.start === s.start ? ' gc-slot--active' : ''}`} onClick={() => onSelectSlot(s)} disabled={holdMut.isPending}>
                    {fmtTime(s.start)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {hold ? (
            <p className="gc-note" data-testid="mb-hold"><i className="bi-clock-history" aria-hidden="true" /> Créneau réservé jusqu'à {fmtTime(hold.expiresAt)}.</p>
          ) : null}
          {slot ? (
            <>
              <div className="gc-card-recap">
                <div className="c3-row"><span>Prestation</span><strong>{selectedService?.name || '—'}</strong></div>
                <div className="c3-row"><span>Quand</span><strong>{fmtDate(slot.start)} · {fmtTime(slot.start)}</strong></div>
                <div className="c3-row"><span>Total</span><strong>{money(selectedService?.effectivePrice ?? selectedService?.price)}</strong></div>
              </div>
              <label className="gc-field">
                <span className="gc-label">Note</span>
                <input className="gc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note interne facultative" />
              </label>
              <p className="gc-note"><i className="bi-cash-coin" aria-hidden="true" /> Paiement sur place — solde à régler sur place.</p>
            </>
          ) : null}
          {error ? <p className="gc-error" role="alert">{error}</p> : null}
          <button type="button" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={!slot || !hold || confirmMut.isPending} onClick={() => confirmMut.mutate()}>
            {confirmMut.isPending ? 'Confirmation…' : 'Confirmer la réservation'}
          </button>
        </div>
      )}
    </CustomerDrawer>
  );
}

// ── Note interne ───────────────────────────────────────────────────────────────
export function CustomerNoteDrawer({ open, customerId, onClose, onDone }: {
  open: boolean; customerId: string; onClose: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const notes = useQuery({
    queryKey: ['customer-notes', customerId],
    queryFn: () => listCustomerNotes(customerId),
    enabled: open && Boolean(customerId),
    retry: false,
  });

  useEffect(() => { if (!open) setBody(''); }, [open]);

  const mut = useMutation({
    mutationFn: () => createCustomerNote(customerId, body.trim()),
    onSuccess: () => {
      setBody('');
      void qc.invalidateQueries({ queryKey: ['customer-notes', customerId] });
      onDone();
    },
  });

  const canSubmit = body.trim().length > 0 && !mut.isPending;

  return (
    <CustomerDrawer open={open} title="Ajouter une note" onClose={onClose}>
      <form className="gc-form" onSubmit={(e) => { e.preventDefault(); if (canSubmit) mut.mutate(); }}>
        <label className="gc-field">
          <span className="gc-label">Note interne *</span>
          <textarea className="gc-textarea" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Note visible par l'équipe" data-testid="note-body" />
        </label>
        {mut.isError ? <p className="gc-error" role="alert">{errorMessage(mut.error)}</p> : null}
        {mut.isSuccess ? <p className="gc-success-inline" data-testid="note-success">Note ajoutée.</p> : null}
        <button type="submit" className="c3-quickbtn gc-btn--block gc-btn--primary" disabled={!canSubmit}>
          {mut.isPending ? 'Ajout…' : 'Ajouter la note'}
        </button>
      </form>
      <div className="gc-notes" data-testid="note-list">
        {(notes.data ?? []).length === 0 ? <p className="gc-note">Aucune note pour l'instant.</p> : (notes.data ?? []).map((n) => (
          <div className="gc-note-item" key={n.id}>
            <div className="gc-note-item__body">{n.body}</div>
            <div className="gc-note-item__meta">{n.authorLabel || n.authorRole} · {fmtDateTime(n.createdAt)}</div>
          </div>
        ))}
      </div>
    </CustomerDrawer>
  );
}
