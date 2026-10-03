import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, CheckCircle2, CreditCard, Loader2, Mail, PlugZap, Save, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Field, Input } from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/Skeleton';
import { registerLeaveGuard } from '@/components/LeaveGuard';
import { CommercePageFrame } from './CommerceShared';

type Provider = 'STRIPE_INSTITUTE' | 'BREVO_INSTITUTE';
type Integration = {
  provider: Provider;
  activeMode: 'TEST' | 'PROD';
  verified: boolean;
  lastTestAt: string | null;
  lastTestError?: string;
  senderEmail: string;
  senderName: string;
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
  webhookUrl: string;
  webhookLastError: string;
};
type FieldDef = { key: string; label: string; placeholder: (live: boolean) => string; secret: boolean; type?: string; hint?: string };

const PROVIDERS: Record<Provider, { title: string; Icon: typeof CreditCard; fields: FieldDef[] }> = {
  STRIPE_INSTITUTE: {
    title: 'Paiements clients — Stripe',
    Icon: CreditCard,
    fields: [
      { key: 'publicKey', label: 'Clé publique', placeholder: (live) => (live ? 'pk_live_…' : 'pk_test_…'), secret: true },
      { key: 'secretKey', label: 'Clé secrète', placeholder: (live) => (live ? 'sk_live_…' : 'sk_test_…'), secret: true },
      { key: 'webhookSecret', label: 'Secret webhook', placeholder: () => 'whsec_… (facultatif)', secret: true, hint: 'Créé automatiquement à l’enregistrement de la clé secrète ; à saisir seulement pour en imposer un.' },
    ],
  },
  BREVO_INSTITUTE: {
    title: 'E-mails — Brevo',
    Icon: Mail,
    fields: [
      { key: 'senderName', label: 'Nom expéditeur', placeholder: () => 'BeautySavage', secret: false },
      { key: 'senderEmail', label: 'Adresse expéditeur', placeholder: () => 'contact@institut.fr', secret: false, type: 'email', hint: 'Les e-mails aux clientes (codes, confirmations, cartes cadeaux) partent de cette adresse, qui doit être validée dans Brevo.' },
      { key: 'secretKey', label: 'Clé API Brevo', placeholder: () => 'xkeysib-…', secret: true },
    ],
  },
};

const blank = (provider: Provider, saved?: Integration) => Object.fromEntries(
  PROVIDERS[provider].fields.map((f) => [f.key, f.secret ? '' : String((saved as Record<string, unknown> | undefined)?.[f.key] ?? '')]),
) as Record<string, string>;

/**
 * LES CLÉS API DE L'INSTITUT — une carte par fournisseur.
 *
 * Le bouton dit l'état : « Enregistré » (vert) quand rien n'a changé,
 * « Enregistrer » (couleur principale) dès qu'une saisie n'est pas sauvée — et
 * quitter la page dans cet état demande confirmation. Sous les champs, chaque
 * valeur attendue porte une coche verte (renseignée) ou une croix grise
 * (vide) ; « Tester » interroge le fournisseur avec les clés enregistrées.
 */
export default function CommerceApiKeysPage() {
  const [items, setItems] = React.useState<Integration[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [loadError, setLoadError] = React.useState('');

  const refresh = React.useCallback(() => api.commerceIntegrations()
    .then((list) => setItems(list as Integration[]))
    .catch((err) => setLoadError(err instanceof Error ? err.message : 'Accès réservé développeur'))
    .finally(() => setLoaded(true)), []);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const mode: 'TEST' | 'PROD' = items[0]?.activeMode === 'PROD' ? 'PROD' : 'TEST';
  const live = mode === 'PROD';

  return (
    <CommercePageFrame
      title="Clés API institut"
      description="Paiements clients (Stripe) et e-mails (Brevo) de l'institut. L'environnement du site décide des clés utilisées."
    >
      <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm', live ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-900')} data-testid="institute-env">
        <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold">ENVIRONNEMENT {mode}</span>
        <span>{live ? 'Ce site encaisse en réel : seules des clés live (sk_live_…, pk_live_…) sont acceptées.' : 'Ce site est une recette : seules des clés de test (sk_test_…, pk_test_…) sont acceptées.'}</span>
      </div>
      {loadError && <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{loadError}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {(['STRIPE_INSTITUTE', 'BREVO_INSTITUTE'] as Provider[]).map((provider) => (
          !loaded
            ? <Skeleton key={provider} className="h-96 w-full" />
            : <ProviderCard key={provider} provider={provider} live={live} saved={items.find((i) => i.provider === provider)} onSaved={refresh} />
        ))}
      </div>
    </CommercePageFrame>
  );
}

function ProviderCard({ provider, live, saved, onSaved }: { provider: Provider; live: boolean; saved?: Integration; onSaved: () => Promise<unknown> }) {
  const def = PROVIDERS[provider];
  const [draft, setDraft] = React.useState<Record<string, string>>(() => blank(provider, saved));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [feedback, setFeedback] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Les valeurs non secrètes suivent l'enregistré tant qu'on n'y a pas touché.
  const baseline = React.useMemo(() => blank(provider, saved), [provider, saved]);
  const dirty = def.fields.some((f) => (f.secret ? draft[f.key].trim() !== '' : draft[f.key].trim() !== baseline[f.key].trim()));
  React.useEffect(() => { if (!dirty) setDraft(baseline); }, [baseline]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(): Promise<boolean> {
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, string> = { provider };
      for (const f of def.fields) if (f.secret ? draft[f.key].trim() : draft[f.key].trim() !== baseline[f.key].trim()) payload[f.key] = draft[f.key].trim();
      const result = await api.saveCommerceIntegration(payload);
      const webhookError = result?.webhookLastError ? ` Le webhook n’a pas pu être créé : ${result.webhookLastError}` : '';
      setFeedback(webhookError ? { tone: 'error', text: `Clés enregistrées.${webhookError}` } : { tone: 'ok', text: 'Enregistré.' });
      setDraft(blank(provider, result ?? saved));
      await onSaved();
      return true;
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Enregistrement impossible.' });
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Quitter avec des saisies non enregistrées : confirmation (liens internes, retour, fermeture d'onglet).
  const guardId = React.useRef(Symbol(provider));
  const saveRef = React.useRef(save);
  saveRef.current = save;
  React.useEffect(() => {
    registerLeaveGuard(guardId.current, { dirty, save: () => saveRef.current() });
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  React.useEffect(() => { const id = guardId.current; return () => registerLeaveGuard(id, null); }, []);

  async function test() {
    setTesting(true);
    setFeedback(null);
    try {
      const r = await api.testCommerceIntegration(provider);
      setFeedback({ tone: r.ok ? 'ok' : 'error', text: r.message });
      await onSaved();
    } catch (err) {
      setFeedback({ tone: 'error', text: err instanceof Error ? err.message : 'Test impossible.' });
    } finally {
      setTesting(false);
    }
  }

  const status = def.fields.map((f) => {
    const value = String((saved as Record<string, unknown> | undefined)?.[f.key] ?? '');
    return { key: f.key, label: f.label, filled: Boolean(value), value };
  });
  const canTest = provider === 'STRIPE_INSTITUTE' ? Boolean(saved?.secretKey) : Boolean(saved?.secretKey);

  return (
    <section className="flex flex-col rounded-xl border bg-card" data-testid={`card-${provider}`}>
      <div className="flex items-center justify-between gap-3 rounded-t-xl border-b bg-primary/5 px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><def.Icon className="h-5 w-5 text-primary" /> {def.title}</h2>
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
          saved?.verified ? 'border-emerald-300 bg-emerald-100 text-emerald-900' : 'border-slate-200 bg-slate-50 text-slate-600')} data-testid={`verified-${provider}`}>
          {saved?.verified ? <><CheckCircle2 className="h-3.5 w-3.5" /> Testé</> : 'Non testé'}
        </span>
      </div>

      <div className="grid gap-3 p-4">
        {def.fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <Input
              type={f.type || 'text'}
              value={draft[f.key]}
              onChange={(e) => { setDraft((d) => ({ ...d, [f.key]: e.target.value })); setFeedback(null); }}
              placeholder={f.secret && status.find((s) => s.key === f.key)?.filled ? `${status.find((s) => s.key === f.key)?.value} — saisir pour remplacer` : f.placeholder(live)}
              autoComplete="off"
              data-testid={`input-${provider}-${f.key}`}
            />
          </Field>
        ))}

        <ul className="grid gap-1.5 rounded-lg border bg-muted/20 p-3" data-testid={`status-${provider}`}>
          {status.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-sm" data-testid={`state-${provider}-${s.key}`} data-filled={s.filled}>
              <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', s.filled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500')} aria-hidden>
                {s.filled ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className={s.filled ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">{s.filled ? s.value : 'vide'}</span>
            </li>
          ))}
          {provider === 'BREVO_INSTITUTE' && (
            <li className="flex items-center gap-2 text-sm" data-testid="state-BREVO_INSTITUTE-webhook" data-filled={Boolean(saved?.webhookUrl)}>
              <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full', saved?.webhookUrl ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500')} aria-hidden>
                {saved?.webhookUrl ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
              <span className={saved?.webhookUrl ? 'font-medium' : 'text-muted-foreground'}>Suivi de remise (webhook)</span>
              <span className="ml-auto text-xs text-muted-foreground">{saved?.webhookUrl ? 'créé automatiquement' : 'créé au prochain test'}</span>
            </li>
          )}
          {saved?.webhookLastError && (
            <li className="mt-1 text-xs text-rose-700">Webhook : {saved.webhookLastError}</li>
          )}
          {saved?.lastTestAt && (
            <li className="mt-1 text-xs text-muted-foreground">
              Dernier test le {new Date(saved.lastTestAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}{!saved.verified && saved.lastTestError ? ` — ${saved.lastTestError}` : ''}
            </li>
          )}
        </ul>

        <AnimatePresence>
          {feedback && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" data-testid={`feedback-${provider}`}
              className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', feedback.tone === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-rose-300 bg-rose-50 text-rose-800')}>
              {feedback.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              {feedback.text}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            layout
            data-testid={`save-${provider}`}
            data-state={dirty ? 'dirty' : 'saved'}
            className={cn('inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors',
              dirty ? 'bg-primary text-primary-foreground shadow-sm hover:opacity-90' : 'cursor-default border border-emerald-300 bg-emerald-50 text-emerald-800')}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {saving ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Enregistré'}
          </motion.button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || !canTest || dirty}
            title={dirty ? 'Enregistrez d’abord vos modifications' : !canTest ? 'Enregistrez d’abord la clé secrète' : 'Tester la connexion avec les clés enregistrées'}
            data-testid={`test-${provider}`}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Tester
          </button>
        </div>
      </div>
    </section>
  );
}
