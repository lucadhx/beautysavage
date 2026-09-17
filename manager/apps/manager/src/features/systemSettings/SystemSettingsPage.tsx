// S1 — Paramètres Système (dev-only). Source unique de la config métier globale.
// Sections : 🌐 Domaines · 🏢 Institut · 🌍 Localisation · 💰 Fiscalité · 🔧 Système · ⚠️ Maintenance.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Badge, LoadingState, ErrorState } from '@bs/ui';
import {
  getSystemConfiguration,
  updateSystemConfiguration,
  validateDomainUrl,
  type SystemConfiguration,
  type SystemConfigurationPatch,
} from '@bs/api-client';
import './systemSettings.css';

type Draft = Omit<SystemConfiguration, 'resolved' | 'updatedAt'>;

function toDraft(cfg: SystemConfiguration): Draft {
  const { resolved: _resolved, updatedAt: _updatedAt, ...rest } = cfg;
  return JSON.parse(JSON.stringify(rest)) as Draft;
}

const QUERY_KEY = ['system-configuration'];

export function SystemSettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getSystemConfiguration, retry: false });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setDraft(toDraft(query.data));
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (patch: SystemConfigurationPatch) => updateSystemConfiguration(patch),
    onSuccess: (cfg) => {
      queryClient.setQueryData(QUERY_KEY, cfg);
      setDraft(toDraft(cfg));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const panelValidity = useMemo(
    () => (draft?.domains.panelUrl ? validateDomainUrl(draft.domains.panelUrl, 'URL du panel') : null),
    [draft?.domains.panelUrl],
  );
  const vitrineValidity = useMemo(
    () => (draft?.domains.vitrineUrl ? validateDomainUrl(draft.domains.vitrineUrl, 'URL de la vitrine') : null),
    [draft?.domains.vitrineUrl],
  );

  const hasInvalidDomain =
    (panelValidity != null && !panelValidity.ok) || (vitrineValidity != null && !vitrineValidity.ok);

  if (query.status === 'pending') return <LoadingState label="Chargement de la configuration…" />;
  if (query.status === 'error' || !draft) {
    return <ErrorState title="Configuration indisponible." detail="Réservé au rôle dev." />;
  }

  const update = (mutate: (d: Draft) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Draft;
      mutate(next);
      return next;
    });
  };

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard indisponible — ignoré */
    }
  };

  const save = () => {
    if (hasInvalidDomain) return;
    mutation.mutate(draft);
  };

  return (
    <div className="sys-page">
      <p className="sys-page__intro">
        Source unique de vérité pour la configuration métier de Beauty Savage. Aucun secret ici
        (les secrets restent dans le <code>.env</code>).
      </p>

      {/* 🌐 Domaines */}
      <Card>
        <h3 className="sys-section__title">🌐 Domaines</h3>
        <p className="sys-section__help">
          URLs publiques officielles. HTTPS obligatoire (hors localhost/dev), sans slash final.
          Toutes les URLs générées (mails, factures, QR, cartes cadeaux…) en découlent.
        </p>

        <div className="sys-field">
          <label htmlFor="vitrineUrl">URL vitrine</label>
          <div className="sys-url-row">
            <input
              id="vitrineUrl"
              type="url"
              inputMode="url"
              placeholder="https://beautysavage.fr"
              value={draft.domains.vitrineUrl}
              onChange={(e) => update((d) => { d.domains.vitrineUrl = e.target.value; })}
            />
            <button
              type="button"
              className="sys-copy-btn"
              title="Copier l'URL"
              aria-label="Copier l'URL"
              disabled={!draft.domains.vitrineUrl}
              onClick={() => copy(draft.domains.vitrineUrl)}
            >
              {copied === draft.domains.vitrineUrl ? '✓' : '⧉'}
            </button>
          </div>
          <DomainValidity validity={vitrineValidity} fallback={query.data.resolved.vitrineBaseUrl} />
        </div>

        <div className="sys-field">
          <label htmlFor="panelUrl">URL panel</label>
          <div className="sys-url-row">
            <input
              id="panelUrl"
              type="url"
              inputMode="url"
              placeholder="https://manager.beautysavage.fr"
              value={draft.domains.panelUrl}
              onChange={(e) => update((d) => { d.domains.panelUrl = e.target.value; })}
            />
            <button
              type="button"
              className="sys-copy-btn"
              title="Copier l'URL"
              aria-label="Copier l'URL"
              disabled={!draft.domains.panelUrl}
              onClick={() => copy(draft.domains.panelUrl)}
            >
              {copied === draft.domains.panelUrl ? '✓' : '⧉'}
            </button>
          </div>
          <DomainValidity validity={panelValidity} fallback={query.data.resolved.panelBaseUrl} />
        </div>
      </Card>

      {/* 🏢 Institut */}
      <Card>
        <h3 className="sys-section__title">🏢 Informations de l'institut</h3>
        <p className="sys-section__help">Identité globale utilisée sur les factures, cartes cadeaux et e-mails.</p>
        <div className="sys-grid sys-grid--2">
          <Field label="Nom" value={draft.institute.name} onChange={(v) => update((d) => { d.institute.name = v; })} />
          <Field label="E-mail de contact" type="email" value={draft.institute.email} onChange={(v) => update((d) => { d.institute.email = v; })} />
          <Field label="Téléphone" value={draft.institute.phone} onChange={(v) => update((d) => { d.institute.phone = v; })} />
          <Field label="SIRET" value={draft.institute.siret} onChange={(v) => update((d) => { d.institute.siret = v; })} />
          <Field label="Adresse" value={draft.institute.address.line1} onChange={(v) => update((d) => { d.institute.address.line1 = v; })} />
          <Field label="Complément" value={draft.institute.address.line2} onChange={(v) => update((d) => { d.institute.address.line2 = v; })} />
          <Field label="Code postal" value={draft.institute.address.postalCode} onChange={(v) => update((d) => { d.institute.address.postalCode = v; })} />
          <Field label="Ville" value={draft.institute.address.city} onChange={(v) => update((d) => { d.institute.address.city = v; })} />
          <Field label="Pays" value={draft.institute.address.country} onChange={(v) => update((d) => { d.institute.address.country = v; })} />
        </div>
      </Card>

      {/* 🌍 Localisation */}
      <Card>
        <h3 className="sys-section__title">🌍 Localisation</h3>
        <p className="sys-section__help">Fuseau d'affichage, langue et devise. Le fuseau runtime reste piloté par <code>TZ</code>.</p>
        <div className="sys-grid sys-grid--2">
          <Field label="Fuseau horaire" value={draft.localization.timezone} onChange={(v) => update((d) => { d.localization.timezone = v; })} />
          <Field label="Langue" value={draft.localization.language} onChange={(v) => update((d) => { d.localization.language = v; })} />
          <Field label="Devise" value={draft.localization.currency} onChange={(v) => update((d) => { d.localization.currency = v; })} />
        </div>
      </Card>

      {/* 💰 Fiscalité */}
      <Card>
        <h3 className="sys-section__title">💰 Fiscalité</h3>
        <p className="sys-section__help">TVA par défaut et mention légale des factures.</p>
        <div className="sys-grid sys-grid--2">
          <div className="sys-field">
            <label htmlFor="vatRate">TVA par défaut (%)</label>
            <input
              id="vatRate"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draft.tax.defaultVatRate}
              onChange={(e) => update((d) => { d.tax.defaultVatRate = Number(e.target.value); })}
            />
          </div>
          <Field label="Mention TVA" value={draft.tax.vatMention} onChange={(v) => update((d) => { d.tax.vatMention = v; })} />
        </div>
      </Card>

      {/* 🔧 Système */}
      <Card>
        <h3 className="sys-section__title">🔧 Configuration système</h3>
        <p className="sys-section__help">Paramètres techniques exposables (jamais de secret).</p>
        <Field label="Nom de la plateforme (facturation commissions)" value={draft.system.platformName} onChange={(v) => update((d) => { d.system.platformName = v; })} />
      </Card>

      {/* ⚠️ Maintenance */}
      <Card>
        <h3 className="sys-section__title">⚠️ Maintenance</h3>
        <p className="sys-section__help">Intention de mise en maintenance et message associé.</p>
        <div className="sys-field sys-field--inline">
          <input
            id="maintenanceEnabled"
            type="checkbox"
            checked={draft.maintenance.enabled}
            onChange={(e) => update((d) => { d.maintenance.enabled = e.target.checked; })}
          />
          <label htmlFor="maintenanceEnabled">Mode maintenance activé</label>
          {draft.maintenance.enabled ? <Badge>actif</Badge> : null}
        </div>
        <div className="sys-field">
          <label htmlFor="maintenanceMessage">Message</label>
          <textarea
            id="maintenanceMessage"
            value={draft.maintenance.message}
            onChange={(e) => update((d) => { d.maintenance.message = e.target.value; })}
          />
        </div>
      </Card>

      <div className="sys-actions">
        <Button type="button" onClick={save} disabled={mutation.isPending || hasInvalidDomain}>
          {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
        {saved ? <span className="sys-saved">✓ Enregistré</span> : null}
        {hasInvalidDomain ? <span className="sys-error">Corrigez les URLs invalides.</span> : null}
        {mutation.isError ? (
          <span className="sys-error">
            {(mutation.error as { message?: string })?.message || 'Échec de l’enregistrement.'}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function DomainValidity({
  validity,
  fallback,
}: {
  validity: { ok: boolean; value?: string; error?: string } | null;
  fallback: string;
}) {
  if (validity == null) {
    return <span className="sys-validity">Vide → repli automatique : {fallback}</span>;
  }
  if (validity.ok) {
    return <span className="sys-validity sys-validity--ok">✓ valide — {validity.value}</span>;
  }
  return <span className="sys-validity sys-validity--err">✗ {validity.error}</span>;
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="sys-field">
      <label>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
