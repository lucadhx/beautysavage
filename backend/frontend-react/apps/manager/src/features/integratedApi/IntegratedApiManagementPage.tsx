import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listIntegrations,
  updateIntegrationCredentials,
  deleteIntegrationRuntime,
  testIntegration,
  setIntegrationMode,
  type IntegratedApiView,
  type IntegrationRuntimeView,
  type IntegrationRuntime,
} from '@bs/api-client';
import { ApiError } from '@bs/api-client';
import { Button, Card, LoadingState, ErrorState, Badge, FormField, TextInput, Drawer } from '@bs/ui';

const QUERY_KEY = ['dev', 'integrated-api'];

function runtimeLabel(rt: IntegrationRuntime): string {
  if (rt === 'test') return 'TEST';
  if (rt === 'prod') return 'PROD';
  return 'Clé unique';
}

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : 'Erreur inattendue.';
}

interface ConfigureState {
  slug: string;
  name: string;
  runtime: IntegrationRuntime;
  fields: { role: string; required: boolean; configured: boolean; expectedPrefix: string | null }[];
}

interface ActivateState {
  slug: string;
  name: string;
  confirmVerb: string;
}

export function IntegratedApiManagementPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: listIntegrations });
  const [configure, setConfigure] = useState<ConfigureState | null>(null);
  const [activate, setActivate] = useState<ActivateState | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [confirmText, setConfirmText] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const saveMut = useMutation({
    mutationFn: (v: { slug: string; runtime: IntegrationRuntime; credentials: Record<string, string | null> }) =>
      updateIntegrationCredentials(v.slug, v.runtime, v.credentials),
    onSuccess: () => {
      setFeedback({ tone: 'success', text: 'Credentials enregistrés.' });
      setConfigure(null);
      setFormValues({});
      invalidate();
    },
    onError: (e) => setFeedback({ tone: 'danger', text: errMessage(e) }),
  });

  const deleteMut = useMutation({
    mutationFn: (v: { slug: string; runtime: IntegrationRuntime }) => deleteIntegrationRuntime(v.slug, v.runtime),
    onSuccess: () => {
      setFeedback({ tone: 'success', text: 'Configuration supprimée pour ce mode.' });
      invalidate();
    },
    onError: (e) => setFeedback({ tone: 'danger', text: errMessage(e) }),
  });

  const testMut = useMutation({
    mutationFn: (v: { slug: string; runtime: IntegrationRuntime }) => testIntegration(v.slug, v.runtime),
    onSuccess: (res) => {
      setFeedback({
        tone: res.result.status === 'success' ? 'success' : 'danger',
        text: `${res.result.status === 'success' ? '✓' : '✗'} ${res.result.message}`,
      });
      invalidate();
    },
    onError: (e) => setFeedback({ tone: 'danger', text: errMessage(e) }),
  });

  const modeMut = useMutation({
    mutationFn: (v: { slug: string; mode: 'test' | 'prod'; confirmation?: string }) =>
      setIntegrationMode(v.slug, v.mode, v.confirmation),
    onSuccess: (_r, v) => {
      setFeedback({ tone: 'success', text: `Mode actif : ${v.mode.toUpperCase()}.` });
      setActivate(null);
      setConfirmText('');
      invalidate();
    },
    onError: (e) => setFeedback({ tone: 'danger', text: errMessage(e) }),
  });

  const busy = saveMut.isPending || deleteMut.isPending || testMut.isPending || modeMut.isPending;

  const openConfigure = (i: IntegratedApiView, rt: IntegrationRuntimeView) => {
    setConfigure({
      slug: i.slug,
      name: i.name,
      runtime: rt.runtime,
      fields: rt.credentials.map((c) => ({
        role: c.role,
        required: c.required,
        configured: c.configured,
        expectedPrefix: c.expectedPrefix,
      })),
    });
    setFormValues({});
  };

  const submitConfigure = () => {
    if (!configure) return;
    const credentials: Record<string, string> = {};
    for (const [k, v] of Object.entries(formValues)) {
      if (v.trim()) credentials[k] = v.trim();
    }
    if (Object.keys(credentials).length === 0) {
      setFeedback({ tone: 'danger', text: 'Aucun champ saisi. Un champ vide conserve la valeur existante.' });
      return;
    }
    saveMut.mutate({ slug: configure.slug, runtime: configure.runtime, credentials });
  };

  const integrations = query.data ?? [];

  if (query.isLoading) return <LoadingState label="Chargement des intégrations…" />;
  if (query.isError) return <ErrorState title="Impossible de charger les intégrations." detail={errMessage(query.error)} />;

  return (
    <div>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>API intégrée</h1>
        <p style={{ marginTop: 4, opacity: 0.8 }}>
          Clés Stripe (institut / plateforme) et Brevo, chiffrées au coffre. Aucun secret n’est jamais réaffiché —
          un champ vide conserve la valeur existante.
        </p>
      </header>

      {feedback && (
        <div role="status" style={{ marginBottom: 16 }}>
          <Badge tone={feedback.tone}>{feedback.text}</Badge>
        </div>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {integrations.map((i) => (
          <IntegrationCard
            key={i.slug}
            integration={i}
            busy={busy}
            onConfigure={openConfigure}
            onTest={(rt) => testMut.mutate({ slug: i.slug, runtime: rt.runtime })}
            onDelete={(rt) => {
              if (window.confirm(`Supprimer toute la configuration ${runtimeLabel(rt.runtime)} de ${i.name} ?`)) {
                deleteMut.mutate({ slug: i.slug, runtime: rt.runtime });
              }
            }}
            onActivate={(rt) => {
              if (rt.runtime === 'prod') {
                setActivate({ slug: i.slug, name: i.name, confirmVerb: i.confirmVerb ?? '' });
                setConfirmText('');
              } else {
                modeMut.mutate({ slug: i.slug, mode: 'test' });
              }
            }}
          />
        ))}
      </div>

      {/* Drawer de configuration des credentials */}
      <Drawer
        open={Boolean(configure)}
        title={configure ? `${configure.name} — ${runtimeLabel(configure.runtime)}` : ''}
        onClose={() => setConfigure(null)}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setConfigure(null)} disabled={saveMut.isPending}>
              Annuler
            </Button>
            <Button onClick={submitConfigure} disabled={saveMut.isPending}>
              {saveMut.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        }
      >
        <p style={{ opacity: 0.8, marginTop: 0 }}>Un champ laissé vide conserve la valeur existante.</p>
        {configure?.fields.map((f) => (
          <FormField
            key={f.role}
            label={`${f.role}${f.required ? ' *' : ''}`}
            htmlFor={`cred-${f.role}`}
            hint={f.expectedPrefix ? `Préfixe attendu : ${f.expectedPrefix}` : undefined}
          >
            <TextInput
              id={`cred-${f.role}`}
              type="password"
              autoComplete="off"
              placeholder={f.configured ? '•••••••• (défini)' : 'Non configuré'}
              value={formValues[f.role] ?? ''}
              onChange={(e) => setFormValues((s) => ({ ...s, [f.role]: e.target.value }))}
            />
          </FormField>
        ))}
      </Drawer>

      {/* Drawer d'activation PROD (phrase de confirmation) */}
      <Drawer
        open={Boolean(activate)}
        title={activate ? `Activer la PRODUCTION — ${activate.name}` : ''}
        onClose={() => setActivate(null)}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setActivate(null)} disabled={modeMut.isPending}>
              Annuler
            </Button>
            <Button
              onClick={() => activate && modeMut.mutate({ slug: activate.slug, mode: 'prod', confirmation: confirmText })}
              disabled={modeMut.isPending || confirmText.trim() !== (activate?.confirmVerb ?? '')}
            >
              {modeMut.isPending ? 'Activation…' : 'Activer la production'}
            </Button>
          </div>
        }
      >
        <p style={{ marginTop: 0 }}>
          Le mode PROD doit être configuré <strong>et testé</strong>. Pour confirmer, saisissez exactement :
        </p>
        <p>
          <code>{activate?.confirmVerb}</code>
        </p>
        <FormField label="Phrase de confirmation" htmlFor="confirm-verb">
          <TextInput id="confirm-verb" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </FormField>
      </Drawer>
    </div>
  );
}

interface CardProps {
  integration: IntegratedApiView;
  busy: boolean;
  onConfigure: (i: IntegratedApiView, rt: IntegrationRuntimeView) => void;
  onTest: (rt: IntegrationRuntimeView) => void;
  onDelete: (rt: IntegrationRuntimeView) => void;
  onActivate: (rt: IntegrationRuntimeView) => void;
}

function IntegrationCard({ integration: i, busy, onConfigure, onTest, onDelete, onActivate }: CardProps) {
  const dual = i.runtimeModel === 'dual_environment';
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <strong style={{ fontSize: '1.1rem' }}>{i.name}</strong>
        <Badge tone="muted">{i.provider}</Badge>
        {i.accountPurpose && <Badge tone="neutral">{i.accountPurpose}</Badge>}
        {dual && <Badge tone={i.mode === 'prod' ? 'danger' : 'info'}>Mode actif : {i.mode.toUpperCase()}</Badge>}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: dual ? 'repeat(auto-fit, minmax(260px, 1fr))' : '1fr' }}>
        {i.runtimes.map((rt) => (
          <RuntimeBlock
            key={String(rt.runtime)}
            integration={i}
            rt={rt}
            dual={dual}
            busy={busy}
            onConfigure={onConfigure}
            onTest={onTest}
            onDelete={onDelete}
            onActivate={onActivate}
          />
        ))}
      </div>
    </Card>
  );
}

function RuntimeBlock({
  integration: i,
  rt,
  dual,
  busy,
  onConfigure,
  onTest,
  onDelete,
  onActivate,
}: {
  integration: IntegratedApiView;
  rt: IntegrationRuntimeView;
  dual: boolean;
  busy: boolean;
} & Pick<CardProps, 'onConfigure' | 'onTest' | 'onDelete' | 'onActivate'>) {
  const testTone = rt.lastTest?.status === 'success' ? 'success' : rt.lastTest?.status === 'failed' ? 'danger' : 'muted';
  const testLabel = rt.lastTest?.status === 'success' ? (rt.lastTest.stale ? 'Testé (clé changée)' : 'Testé') : rt.lastTest?.status === 'failed' ? 'Échec du test' : 'Non testé';

  const canActivateProd = rt.runtime === 'prod' && rt.configured && rt.verified;

  return (
    <section style={{ border: '1px solid var(--bs-border, #e2e2e2)', borderRadius: 12, padding: 12 }} aria-label={runtimeLabel(rt.runtime)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        <strong>{runtimeLabel(rt.runtime)}</strong>
        {dual && rt.isActiveMode && <Badge tone="accent">Actif</Badge>}
        <Badge tone={rt.configured ? 'success' : 'warning'}>{rt.configured ? 'Configuré' : 'Non configuré'}</Badge>
        <Badge tone={testTone}>{testLabel}</Badge>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'grid', gap: 4 }}>
        {rt.credentials.map((c) => (
          <li key={c.role} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.9rem' }}>
            <span>
              {c.role}
              {c.required ? ' *' : ''}
            </span>
            <span style={{ opacity: 0.85 }}>{c.configured ? c.maskedValue : '—'}</span>
          </li>
        ))}
      </ul>

      {rt.lastTest?.message && (
        <p style={{ fontSize: '0.82rem', opacity: 0.8, margin: '0 0 8px' }}>
          {rt.lastTest.message}
          {rt.lastTest.testedAt ? ` · ${new Date(rt.lastTest.testedAt).toLocaleString('fr-FR')}` : ''}
        </p>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => onConfigure(i, rt)} disabled={busy}>
          Configurer
        </Button>
        <Button variant="secondary" onClick={() => onTest(rt)} disabled={busy || !rt.configured}>
          Tester
        </Button>
        {dual && !rt.isActiveMode && (
          <Button onClick={() => onActivate(rt)} disabled={busy || (rt.runtime === 'prod' && !canActivateProd)}>
            {rt.runtime === 'prod' ? 'Activer la production' : 'Activer TEST'}
          </Button>
        )}
        {rt.configured && (
          <Button variant="secondary" onClick={() => onDelete(rt)} disabled={busy}>
            Supprimer
          </Button>
        )}
      </div>
    </section>
  );
}
