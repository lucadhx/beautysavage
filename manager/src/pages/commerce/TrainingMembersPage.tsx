import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Gift, GraduationCap, Loader2, Package, RefreshCw, Search, ShoppingBag, Trash2, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { CommercePageFrame, Metric, Panel, dateShort } from './CommerceShared';

/**
 * MEMBRES DES FORMATIONS EN LIGNE — qui a accès à chaque formation (achat,
 * pack, accès offert), mis à jour en continu, et l'AJOUT MANUEL d'une cliente
 * sans paiement : cliente existante ou compte créé ici. L'ajout passe par une
 * étape de validation ; une fois validé, la cliente reçoit l'e-mail
 * « Félicitations, vous avez accès à… » (et, si son compte vient d'être créé,
 * le lien habituel pour choisir son mot de passe).
 */

const REFRESH_MS = 15_000;

type Origin = { type: 'PURCHASE' | 'PACK' | 'MANUAL'; at: string; saleNumber?: string; packTitle?: string; grantId?: string };
type Member = {
  customerId: string; firstName: string; lastName: string; email: string; phone: string;
  accessPending: boolean; since: string | null; origins: Origin[]; manualGrantId: string | null;
  submissionStatus: string | null; progressPercent: number;
};
type TrainingSummary = { id: string; title: string; status: string; coverUrl: string; moduleCount: number; memberCount: number };
type Customer = { _id: string; firstName?: string; lastName?: string; email: string; phone?: string };
type NewCustomer = { firstName: string; lastName: string; email: string; phone: string };

const fullName = (c: { firstName?: string; lastName?: string; email?: string }) => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Cliente';
const norm = (v?: string) => (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function OriginBadge({ origin }: { origin: Origin }) {
  const conf = origin.type === 'MANUAL'
    ? { Icon: Gift, label: 'Accès offert', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' }
    : origin.type === 'PACK'
      ? { Icon: Package, label: `Pack${origin.packTitle ? ` « ${origin.packTitle} »` : ''}`, cls: 'bg-violet-50 text-violet-800 border-violet-200' }
      : { Icon: ShoppingBag, label: `Achat${origin.saleNumber ? ` ${origin.saleNumber}` : ''}`, cls: 'bg-sky-50 text-sky-800 border-sky-200' };
  return (
    <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-xs font-medium ${conf.cls}`} data-testid={`origin-${origin.type}`}>
      <conf.Icon className="h-3 w-3 shrink-0" /> <span className="truncate">{conf.label}</span>
    </span>
  );
}

function submissionLabel(status: string | null) {
  if (status === 'VALIDATED') return 'Validée';
  if (status === 'PENDING') return 'Dossier envoyé';
  if (status === 'REJECTED') return 'À reprendre';
  return null;
}

export default function TrainingMembersPage() {
  const [params, setParams] = useSearchParams();
  const [trainings, setTrainings] = React.useState<TrainingSummary[] | null>(null);
  const selectedId = params.get('formation') || trainings?.[0]?.id || '';
  const [data, setData] = React.useState<{ training: { id: string; title: string; moduleCount: number }; members: Member[]; refreshedAt: string } | null>(null);
  const [loadingMembers, setLoadingMembers] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [revoking, setRevoking] = React.useState<Member | null>(null);
  const [revokeBusy, setRevokeBusy] = React.useState(false);

  const loadOverview = React.useCallback(() => {
    api.trainingMembersOverview().then((list) => setTrainings(list as TrainingSummary[])).catch((err) => setMessage(err instanceof Error ? err.message : 'Chargement impossible'));
  }, []);
  const loadMembers = React.useCallback((silent = false) => {
    if (!selectedId) return;
    if (!silent) setLoadingMembers(true);
    api.trainingMembers(selectedId)
      .then((res) => setData(res))
      .catch((err) => { if (!silent) setMessage(err instanceof Error ? err.message : 'Chargement impossible'); })
      .finally(() => setLoadingMembers(false));
  }, [selectedId]);

  React.useEffect(loadOverview, [loadOverview]);
  React.useEffect(() => { setData(null); loadMembers(); }, [loadMembers]);
  // EN CONTINU : un achat ou un pack payé sur le site apparaît sans recharger la page.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      loadMembers(true);
      loadOverview();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadMembers, loadOverview]);

  const members = (data?.training.id === selectedId ? data.members : []).filter((m) => !query || norm(`${m.firstName} ${m.lastName} ${m.email} ${m.phone}`).includes(norm(query)));
  const all = data?.training.id === selectedId ? data.members : [];
  const selected = trainings?.find((t) => t.id === selectedId) || null;

  async function revoke() {
    if (!revoking?.manualGrantId) return;
    setRevokeBusy(true);
    try {
      await api.revokeTrainingAccess(selectedId, revoking.manualGrantId);
      setMessage(`Accès offert retiré à ${fullName(revoking)}.`);
      setRevoking(null);
      loadMembers(true);
      loadOverview();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Retrait impossible');
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <CommercePageFrame
      title="Membres des formations"
      description="Qui a accès à chaque formation en ligne (achat, pack ou accès offert), mis à jour en continu. Ajoutez une cliente sans paiement : elle reçoit un e-mail pour accéder à sa formation."
      actions={selected ? <Button onClick={() => setAdding(true)} data-testid="member-add"><UserPlus className="h-4 w-4" /> Ajouter une cliente</Button> : undefined}
    >
      {message && (
        <p className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm" data-testid="members-message">
          <span>{message}</span>
          <button type="button" onClick={() => setMessage('')} aria-label="Fermer"><X className="h-4 w-4" /></button>
        </p>
      )}

      {trainings === null ? <Skeleton className="h-24 w-full rounded-lg" /> : trainings.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">Aucune formation en ligne pour le moment.</p>
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div className="grid content-start gap-2" data-testid="members-trainings">
            {trainings.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setParams({ formation: t.id }, { replace: true }); setQuery(''); }}
                className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition ${t.id === selectedId ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                data-testid="members-training"
              >
                {t.coverUrl ? <img src={resolvePreviewMediaUrl(t.coverUrl)} alt="" className="h-10 w-10 shrink-0 rounded object-cover" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-muted"><GraduationCap className="h-4 w-4" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-semibold">{t.title}</span>
                  <span className="text-xs text-muted-foreground">{t.memberCount} membre{t.memberCount > 1 ? 's' : ''}{t.status !== 'PUBLISHED' ? ' · non publiée' : ''}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid min-w-0 content-start gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Membres" value={all.length} />
              <Metric label="Accès offerts" value={all.filter((m) => m.origins.some((o) => o.type === 'MANUAL')).length} />
              <Metric label="Comptes à activer" value={all.filter((m) => m.accessPending).length} detail="Mot de passe pas encore choisi" />
            </div>
            <Panel title={selected ? selected.title : 'Membres'}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <label className="relative block w-full sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une membre" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" data-testid="members-search" />
                </label>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="members-live">
                  <RefreshCw className="h-3 w-3" /> Mis à jour en continu{data?.refreshedAt ? ` · ${new Date(data.refreshedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
                </span>
              </div>
              {loadingMembers && !data ? <Skeleton className="h-40 w-full rounded-lg" /> : members.length === 0 ? (
                <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground" data-testid="members-empty">{query ? 'Aucune membre ne correspond.' : 'Aucune membre pour le moment.'}</p>
              ) : (
                <ul className="grid gap-2" data-testid="members-list">
                  {members.map((m) => (
                    <li key={m.customerId} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="member-row">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{fullName(m)}</p>
                        <p className="truncate text-xs text-muted-foreground">{m.email}{m.phone ? ` · ${m.phone}` : ''}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {m.origins.map((o, i) => <OriginBadge key={`${o.type}-${i}`} origin={o} />)}
                          {m.accessPending && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800" data-testid="member-pending">Compte à activer</span>}
                          {submissionLabel(m.submissionStatus) && <span className="rounded-full border px-2 py-0.5 text-xs">{submissionLabel(m.submissionStatus)}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>Depuis le {dateShort(m.since)}</span>
                        {m.manualGrantId && (
                          <Button size="sm" variant="outline" onClick={() => setRevoking(m)} data-testid="member-revoke"><Trash2 className="h-3.5 w-3.5" /> Retirer</Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}

      {adding && selected && (
        <AddMemberDialog
          training={selected}
          memberIds={new Set(all.map((m) => m.customerId))}
          onClose={() => setAdding(false)}
          onDone={(text) => { setAdding(false); setMessage(text); loadMembers(true); loadOverview(); }}
        />
      )}

      <Modal open={Boolean(revoking)} onClose={() => !revokeBusy && setRevoking(null)} title="Retirer l’accès offert ?" busy={revokeBusy}>
        <div className="grid gap-4">
          <p className="text-sm">{revoking ? fullName(revoking) : ''} n’aura plus accès à « {selected?.title} ». Ses achats éventuels ne sont pas concernés.</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevoking(null)} disabled={revokeBusy}>Annuler</Button>
            <Button variant="destructive" onClick={revoke} loading={revokeBusy} data-testid="member-revoke-confirm">Retirer l’accès</Button>
          </div>
        </div>
      </Modal>
    </CommercePageFrame>
  );
}

/**
 * AJOUT EN DEUX ÉTAPES — choisir (cliente existante ou nouveau compte), puis
 * VALIDER : rien n'est ouvert ni envoyé avant la validation.
 */
function AddMemberDialog({ training, memberIds, onClose, onDone }: {
  training: TrainingSummary; memberIds: Set<string>; onClose: () => void; onDone: (message: string) => void;
}) {
  const [mode, setMode] = React.useState<'existing' | 'new'>('existing');
  const [step, setStep] = React.useState<'choose' | 'confirm'>('choose');
  const [customers, setCustomers] = React.useState<Customer[] | null>(null);
  const [search, setSearch] = React.useState('');
  const [picked, setPicked] = React.useState<Customer | null>(null);
  const [form, setForm] = React.useState<NewCustomer>({ firstName: '', lastName: '', email: '', phone: '' });
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => { api.commerceCustomers().then((list) => setCustomers(list as Customer[])).catch(() => setCustomers([])); }, []);

  const matches = (customers || [])
    .filter((c) => !search || norm(`${c.firstName} ${c.lastName} ${c.email} ${c.phone}`).includes(norm(search)))
    .slice(0, 50);
  const formComplete = form.firstName.trim() && form.lastName.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) && form.phone.replace(/\D/g, '').length >= 10;
  const knownEmail = mode === 'new' ? (customers || []).find((c) => c.email.toLowerCase() === form.email.trim().toLowerCase()) : null;
  const canContinue = mode === 'existing' ? Boolean(picked) : Boolean(formComplete);
  const who = mode === 'existing' ? picked : { ...form, _id: '' };

  async function validate() {
    setBusy(true);
    setError('');
    try {
      const body = mode === 'existing' ? { customerId: picked!._id } : { newCustomer: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() } };
      const res = await api.grantTrainingAccess(training.id, body);
      const name = who ? fullName(who) : 'La cliente';
      onDone(res.accountCreated
        ? `${name} a désormais accès à « ${training.title} ». Son compte a été créé : elle reçoit le lien pour choisir son mot de passe, puis l’e-mail de la formation.`
        : `${name} a désormais accès à « ${training.title} ». L’e-mail de la formation lui a été envoyé.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ajout impossible');
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={step === 'choose' ? 'Ajouter une cliente' : 'Valider l’ajout'} description={`Formation en ligne « ${training.title} » — sans paiement`} busy={busy}>
      {step === 'choose' ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="tablist">
            {([['existing', 'Cliente existante'], ['new', 'Nouvelle cliente']] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => { setMode(value); setError(''); }}
                className={`rounded-md px-3 py-2 text-sm font-medium ${mode === value ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} data-testid={`member-mode-${value}`}>{label}</button>
            ))}
          </div>

          {mode === 'existing' ? (
            <div className="grid gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, e-mail ou téléphone" className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm" data-testid="member-customer-search" />
              </label>
              <div className="max-h-72 overflow-y-auto rounded-md border" data-testid="member-customer-list">
                {customers === null ? <div className="p-4 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Chargement…</div>
                  : matches.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Aucune cliente trouvée. Créez-la avec « Nouvelle cliente ».</p>
                    : matches.map((c) => {
                      const member = memberIds.has(c._id);
                      return (
                        <button key={c._id} type="button" disabled={member} onClick={() => setPicked(c)}
                          className={`flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${picked?._id === c._id ? 'bg-primary/10' : 'hover:bg-muted/50'} disabled:cursor-not-allowed disabled:opacity-50`}
                          data-testid="member-customer-option">
                          <span className="min-w-0"><span className="block truncate font-medium">{fullName(c)}</span><span className="block truncate text-xs text-muted-foreground">{c.email}{c.phone ? ` · ${c.phone}` : ''}</span></span>
                          {member ? <span className="shrink-0 text-xs">Déjà membre</span> : picked?._id === c._id ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : null}
                        </button>
                      );
                    })}
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Prénom"><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="member-new-firstName" /></Field>
              <Field label="Nom"><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="member-new-lastName" /></Field>
              <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="member-new-email" /></Field>
              <Field label="Téléphone"><Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="member-new-phone" /></Field>
              {knownEmail && (
                <p className="text-xs text-amber-800 sm:col-span-2">Cette adresse appartient déjà à {fullName(knownEmail)} : son compte existant sera utilisé, sans être modifié.</p>
              )}
              <p className="text-xs text-muted-foreground sm:col-span-2">La cliente recevra l’e-mail habituel pour choisir son mot de passe (qui confirme son adresse), puis l’e-mail d’accès à la formation.</p>
            </div>
          )}

          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button onClick={() => setStep('confirm')} disabled={!canContinue} data-testid="member-continue">Continuer</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4" data-testid="member-confirm">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p>Donner l’accès à la formation en ligne <strong>« {training.title} »</strong> à :</p>
            <p className="mt-2 font-semibold">{who ? fullName(who) : ''}</p>
            <p className="text-muted-foreground">{who?.email}{who?.phone ? ` · ${who.phone}` : ''}</p>
          </div>
          <ul className="grid gap-1.5 text-sm text-muted-foreground">
            <li>• Accès immédiat à tous les modules, sans paiement.</li>
            {mode === 'new' && !knownEmail && <li>• Création de son compte client, et envoi du lien pour choisir son mot de passe.</li>}
            <li>• Envoi de l’e-mail « Félicitations, vous avez accès à {training.title} ».</li>
          </ul>
          {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setStep('choose'); setError(''); }} disabled={busy}>Retour</Button>
            <Button onClick={validate} loading={busy} data-testid="member-validate">Valider et envoyer</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
