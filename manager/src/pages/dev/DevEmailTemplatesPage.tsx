import * as React from 'react';
import {
  Mail, ArrowLeft, Send, AlertTriangle, CheckCircle2, Info,
  ShieldAlert, Lock,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, Badge, Field, Input, Spinner, EmptyState, SegmentedControl } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Modal } from '@/components/ui/dialog';
import { useResource, useAction } from '@/hooks/useResource';
import { api } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import type {
  EmailTemplateSummary, EmailTemplateDetail,
  EmailTemplatePreview, EmailReadiness, EmailVariable,
} from '@/types';
import {
  VIEW_TABS, TAB_LABEL, orderedTemplates, orderedVariables,
  readinessCodeLabel, isSenderMissing, previewWidth,
  variableTypeLabel, unusableCodeLabel,
  type ViewTab, type PreviewDevice,
} from '@/lib/emailTemplates';
import { EmailTemplateGuide } from '@/components/dev/EmailTemplateGuide';
import { EmailConfigurationSection } from '@/components/dev/EmailConfigurationSection';
import { messageUtilisateur } from '@/lib/erreurs';

/**
 * TEMPLATES E-MAIL — CONSULTATION. DEV uniquement.
 *
 * ── CE QUE CET ÉCRAN ÉTAIT, ET POURQUOI IL A CHANGÉ (L12.1) ─────────────────
 *
 * Il éditait : sujet, HTML, interrupteur, enregistrement, historique,
 * restauration. Tout cela écrivait dans une base de modèles propre au projet
 * — et le contenu réellement expédié venait du Panel depuis le lot L8.4C.
 *
 * L'audit a mesuré l'écart : sept modèles sur quatorze affichaient ici un
 * contenu différent de celui qui partait, sans qu'aucun signal ne l'indique.
 * Pire, l'interrupteur « inactif » de cet écran COUPAIT réellement l'envoi
 * d'un e-mail que le Panel aurait expédié : un écran sans autorité sur le
 * contenu exerçait un veto sur l'expédition.
 *
 * ── CE QU'IL EST DEVENU ─────────────────────────────────────────────────────
 *
 * Une projection de ce que le Panel résoudrait à l'envoi, pour CE projet. Tout
 * ce qui s'affiche ici traverse le pont à chaque lecture — il n'y a plus de
 * copie locale à afficher, et c'est délibéré : un écran qui prétend montrer
 * « ce qui part » ne peut pas montrer ce qui partait ce matin.
 *
 * Il reste utile, et c'est pourquoi il n'a pas été supprimé : voir les modèles
 * de ce projet, leur portée, leur version, leur sujet, prévisualiser leur
 * contenu, lire les variables attendues, diagnostiquer une configuration
 * absente, et lancer un envoi de test. Ce sont les questions d'un exploitant de
 * projet. Aucune d'elles n'exige d'écrire.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Aperçu
// ═══════════════════════════════════════════════════════════════════════════

function PreviewFrame({ html, device }: { html: string; device: PreviewDevice }) {
  return (
    <div className="flex justify-center overflow-x-auto rounded-md border border-border bg-muted/30 p-4">
      <iframe
        key={device}
        title="Aperçu de l’e-mail"
        srcDoc={html}
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-[calc(var(--m-viewport-h)*0.7)] shrink-0 rounded border border-border bg-white"
        style={{ width: previewWidth(device) }}
      />
    </div>
  );
}

/**
 * POURQUOI CE MODÈLE NE PARTIRAIT PAS — et où le corriger.
 *
 * Le message vient du Panel : il est écrit par celui qui possède le modèle, et
 * il est produit sur le même chemin que l'envoi. On l'affiche tel quel plutôt
 * que d'en réinventer une traduction qui divergerait.
 */
function UnusableNotice({ reason, message }: { reason: string | null; message: string }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <AlertTriangle className="h-3.5 w-3.5" /> {unusableCodeLabel(reason)}
      </p>
      {message ? <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{message}</p> : null}
      <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
        Les templates e-mail sont administrés depuis L.Y Solution.
      </p>
    </div>
  );
}

function ReadinessNotice({ readiness }: { readiness: EmailReadiness | null }) {
  if (!readiness || readiness.ready) return null;
  return (
    <div className="rounded-md border border-red-300 bg-red-50 p-3">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-800">
        <ShieldAlert className="h-3.5 w-3.5" /> Envoi impossible pour l’instant
      </p>
      <ul className="space-y-0.5">
        {readiness.blockers.map((b, i) => (
          <li key={i} className="text-[11px] leading-relaxed text-red-700">
            <span className="font-medium">{readinessCodeLabel(b.code)}</span> — {b.message}
          </li>
        ))}
      </ul>
      {isSenderMissing(readiness) ? (
        <p className="mt-2 text-[11px] text-red-700">
          L’expéditeur global est administré depuis L.Y Solution.
        </p>
      ) : null}
    </div>
  );
}

function VariablesTable({ variables }: { variables: EmailVariable[] }) {
  if (!variables.length) {
    return <p className="text-xs text-muted-foreground">Ce modèle n’attend aucune variable.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Clé</th>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">Requise</th>
            <th className="py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {orderedVariables(variables).map((v) => (
            <tr key={v.key}>
              <td className="py-2 pr-3 align-top font-mono text-[11px]">{`{{${v.key}}}`}</td>
              <td className="py-2 pr-3 align-top text-muted-foreground">{variableTypeLabel(v.type)}</td>
              <td className="py-2 pr-3 align-top">
                {v.required
                  ? <Badge className="bg-amber-100 text-[10px] text-amber-900">obligatoire</Badge>
                  : <span className="text-[11px] text-muted-foreground">facultative</span>}
              </td>
              <td className="py-2 align-top text-muted-foreground">{v.description || v.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fiche d'un modèle
// ═══════════════════════════════════════════════════════════════════════════

function TemplateView({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const [template, setTemplate] = React.useState<EmailTemplateDetail | null>(null);
  const [readiness, setReadiness] = React.useState<EmailReadiness | null>(null);
  const [preview, setPreview] = React.useState<EmailTemplatePreview | null>(null);
  const [tab, setTab] = React.useState<ViewTab>('preview');
  const [device, setDevice] = React.useState<PreviewDevice>('desktop');
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [testOpen, setTestOpen] = React.useState(false);
  const [testEmail, setTestEmail] = React.useState('');
  const [testResult, setTestResult] = React.useState<string | null>(null);
  const testSend = useAction();

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const [detail, ready] = await Promise.all([
          api.getEmailTemplate(templateId),
          api.emailTemplateReadiness(templateId).catch(() => null),
        ]);
        if (!alive) return;
        setTemplate(detail);
        setReadiness(ready);
      } catch (err) {
        if (!alive) return;
        setLoadError(messageUtilisateur(err, 'Lecture impossible.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [templateId]);

  // L'aperçu est demandé À PART : il rend, donc il peut échouer pour une raison
  // propre (variable d'exemple refusée). Le mêler au chargement de la fiche
  // ferait disparaître le diagnostic sous une erreur générique.
  React.useEffect(() => {
    let alive = true;
    if (tab !== 'preview' || !template) return () => { alive = false; };
    (async () => {
      try {
        const p = await api.previewEmailTemplate(templateId);
        if (alive) setPreview(p);
      } catch {
        if (alive) setPreview(null);
      }
    })();
    return () => { alive = false; };
  }, [tab, templateId, template]);

  async function doTestSend() {
    setTestResult(null);
    try {
      const r = await testSend.run(
        () => api.testSendEmailTemplate(templateId, testEmail.trim()),
        { error: 'L’envoi de test a été refusé.' },
      );
      setTestResult(r.message || 'E-mail de test accepté par la plateforme.');
      setTestOpen(false);
    } catch {
      // `useAction` a déjà présenté l'erreur ; la fenêtre reste ouverte pour
      // qu'on puisse corriger l'adresse sans la ressaisir entièrement.
    }
  }

  if (loading) return <BrandLoader />;

  if (loadError || !template) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="mt-4 rounded-md border border-border p-4" role="status">
          <p className="text-sm text-muted-foreground">
            {loadError || 'Ce modèle n’a pas pu être lu.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> Tous les modèles
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!template.usable || !readiness?.ready}
          onClick={() => setTestOpen(true)}
        >
          <Send className="h-3.5 w-3.5" /> Envoyer un test
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{template.name}</h2>
            <Badge className="bg-muted text-[10px] text-muted-foreground">
              {template.scope.label}
            </Badge>
            {template.usable
              ? <Badge className="bg-emerald-100 text-[10px] text-emerald-800">actif</Badge>
              : <Badge className="bg-amber-100 text-[10px] text-amber-900">inutilisable</Badge>}
            <Badge className="bg-muted text-[10px] text-muted-foreground">v{template.version}</Badge>
          </div>

          <p className="text-xs text-muted-foreground">{template.description}</p>

          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Identifiant</dt>
              <dd className="font-mono text-[11px]">{template.templateId}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Sujet expédié</dt>
              <dd className="break-words">{template.subject || '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Dernière modification</dt>
              <dd>{template.updatedAt ? formatDateTime(template.updatedAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">Contrat de variables</dt>
              <dd className="font-mono text-[10px]">{template.contract.fingerprint || '—'}</dd>
            </div>
          </dl>

          <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Les templates e-mail sont administrés depuis L.Y Solution.
          </p>

          {!template.usable
            ? <UnusableNotice reason={template.unusableReason} message={template.unusableMessage} />
            : null}
          <ReadinessNotice readiness={readiness} />
        </CardContent>
      </Card>

      <SegmentedControl
        value={tab}
        onChange={(v) => setTab(v as ViewTab)}
        options={VIEW_TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
      />

      <Card>
        <CardContent className="space-y-3 p-5">
          {tab === 'preview' ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Rendu par la plateforme, avec ses valeurs d’exemple.
                </p>
                <SegmentedControl
                  value={device}
                  onChange={(v) => setDevice(v as PreviewDevice)}
                  options={[
                    { value: 'desktop', label: 'Bureau' },
                    { value: 'mobile', label: 'Mobile' },
                  ]}
                />
              </div>
              {preview?.usable && preview.html ? (
                <>
                  <p className="text-xs">
                    <span className="text-muted-foreground">Sujet rendu : </span>
                    <span className="font-medium">{preview.subject}</span>
                  </p>
                  <PreviewFrame html={preview.html} device={device} />
                </>
              ) : preview ? (
                <UnusableNotice reason={preview.unusableReason} message={preview.unusableMessage} />
              ) : (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Aperçu en cours…
                </div>
              )}
            </>
          ) : null}

          {tab === 'variables' ? (
            <>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Le vocabulaire est défini par la plateforme ; ce projet fournit les valeurs au moment
                de l’envoi.
              </p>
              <VariablesTable variables={template.variables} />
            </>
          ) : null}

          {tab === 'guide' ? <EmailTemplateGuide /> : null}
        </CardContent>
      </Card>

      {testResult ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> {testResult}
        </p>
      ) : null}

      <Modal open={testOpen} onClose={() => setTestOpen(false)} title="Envoyer un e-mail de test">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            L’envoi est exécuté par la plateforme, avec le contenu et les valeurs d’exemple qu’elle
            détient — exactement la chaîne qu’emprunte un e-mail réel.
          </p>
          <Field label="Adresse de réception">
            <Input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="vous@exemple.fr"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTestOpen(false)}>Annuler</Button>
            <Button size="sm" disabled={!testEmail.trim() || testSend.pending} onClick={doTestSend}>
              {testSend.pending ? <Spinner className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              Envoyer
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Liste
// ═══════════════════════════════════════════════════════════════════════════

export default function DevEmailTemplatesPage() {
  const { data, loading, error } = useResource(() => api.listEmailTemplates());
  const [selected, setSelected] = React.useState<string | null>(null);

  if (selected) return <TemplateView templateId={selected} onBack={() => setSelected(null)} />;

  const templates = orderedTemplates((data || []) as EmailTemplateSummary[]);

  return (
    <div>
      <PageHeader
        title="Mails institut"
        description="E-mails envoyes pour les demandes, reservations, annulations, achats, verification e-mail et mot de passe oublie. Le contenu vient du Panel et s'affiche ici avec apercu et variables."
      />

      {/*
        CONFIGURATION E-MAIL — RECUEILLIE ICI EN R11.

        Elle vivait dans la carte Brevo de « Intégrations API ». Cette page a
        disparu : ses quatre fournisseurs sont administrés par le Panel, et il
        n'y restait plus rien à saisir.

        Ce bloc-là, lui, n'était PAS de l'administration de fournisseur — c'est
        de la configuration métier : sous quel régime le service tourne, et un
        envoi de test pour le vérifier.
      */}
      <EmailConfigurationSection />

      {loading ? (
        <BrandLoader />
      ) : error ? (
        <div className="mt-4 rounded-md border border-border p-4" role="status">
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Les templates e-mail sont administrés depuis L.Y Solution : ce projet n’en conserve
            aucune copie, et ne peut donc rien afficher tant que la plateforme est injoignable.
          </p>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Aucun modèle affecté à ce projet"
          description="Ce projet ne déclare consommer aucun modèle, ou la plateforme ne lui en a encore affecté aucun."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {templates.map((t) => (
              <button
                key={t.templateId}
                onClick={() => setSelected(t.templateId)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-muted/50',
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    {!t.usable && (
                      <Badge className="bg-amber-100 text-[10px] text-amber-900">
                        {unusableCodeLabel(t.unusableReason)}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                    {t.subject || t.description}
                  </p>
                  {/* L'ID technique est en LECTURE SEULE : il vient du code. */}
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{t.templateId}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">{t.variableCount} var.</span>
                  <span className="tabular-nums">v{t.version}</span>
                  <span className="hidden sm:inline">
                    {t.updatedAt ? formatDateTime(t.updatedAt) : '—'}
                  </span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
