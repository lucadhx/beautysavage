/**
 * Assistant de DÉPLOIEMENT : Destination → Serveur → Résumé, puis expérience de
 * vérification (préflight) → publication en direct → succès. Une décision à la
 * fois. Le mot de passe du serveur n'est jamais enregistré.
 */
import * as React from 'react';
// `Link` a disparu avec le renvoi vers « Configurez Hostinger dans Intégrations
// API » : aucune cause d'indisponibilité DNS ne se répare plus dans cet écran.
import { toast } from 'sonner';
import { Server, Lock, Globe, GitCommitHorizontal, MonitorSmartphone, ShieldCheck, Plus, X, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { DeploymentTarget } from '@/types';
import { Input, Label } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { WizardShell, StatTile, AdvancedDisclosure } from './ui';
import { TargetCard } from './TargetCard';
import { NewTargetForm } from './TargetsGrid';
import { PreflightExperience } from './PreflightExperience';
import { DeployRunning, type DeployOutcome } from './DeployRunning';
import { SuccessScreen } from './SuccessScreen';
import { ErrorPanel } from './ErrorPanel';

const STEPS = ['Destination', 'Serveur', 'Résumé'];

export interface VpsSessionInfo {
  sessionId: string;
  host: string;
  username: string;
}

type RunPhase = 'form' | 'preflight' | 'deploying' | 'success' | 'error';

export function DeployAssistant({
  targets,
  reload,
  version,
  session,
  connect,
  connecting,
  initialTargetId,
  onExit,
  onViewReport,
}: {
  targets: DeploymentTarget[];
  reload: () => Promise<void>;
  version: string | null;
  session: VpsSessionInfo | null;
  connect: (creds: { host: string; username: string; password: string }) => Promise<boolean>;
  connecting: boolean;
  initialTargetId?: string | null;
  onExit: () => void;
  onViewReport: (runId: string) => void;
}) {
  // Si une destination est déjà choisie (« Déployer ici »), on démarre à l'étape
  // Serveur pour éviter une décision inutile.
  const [step, setStep] = React.useState(initialTargetId ? 1 : 0);
  const [runPhase, setRunPhase] = React.useState<RunPhase>('form');
  const [selectedId, setSelectedId] = React.useState<string | null>(initialTargetId ?? null);
  /*
    ── LE SELECTEUR D'ENVIRONNEMENT A DISPARU ────────────────────────────────

    Il etait un etat de cet assistant, initialise a PROD. La meme destination
    pouvait donc etre deployee en TEST puis en PROD - deux bases, deux jeux de
    medias, un seul domaine - et un clic de trop publiait en production.

    L'environnement appartient a la DESTINATION : il est choisi a sa creation,
    il est immuable, et le backend le lit sur la fiche. L'assistant ne fait
    plus que le MONTRER.
  */
  /** Confirmation nominative exigee avant toute mise en ligne en production. */
  const [confirmProd, setConfirmProd] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const [outcome, setOutcome] = React.useState<DeployOutcome | null>(null);
  const [deployedMs, setDeployedMs] = React.useState<number | null>(null);
  const startRef = React.useRef(0);
  const target = targets.find((t) => t.id === selectedId) || null;

  /**
   * LA GESTION DNS EST-ELLE UTILISABLE POUR CETTE DESTINATION ? (L9.2)
   *
   * ══ CE QUE CE BLOC DISAIT DE FAUX ═══════════════════════════════════════
   *
   * Il lisait l'état du credential Hostinger LOCAL du projet. Depuis que la
   * plateforme administre les domaines, un projet sans clé locale — l'état
   * cible — s'y voyait annoncer « gestion automatique non configurée » et
   * renvoyer vers un écran de saisie de secret, pendant que le déploiement
   * fonctionnait parfaitement. Le déploiement réel du 2026-08-11 l'a montré.
   *
   * La question est désormais posée à la plateforme, POUR L'HÔTE VISÉ : c'est
   * la même que celle du déploiement, donc la réponse ne peut plus diverger.
   */
  const [dns, setDns] = React.useState<{ available: boolean; message: string; wildcard: boolean | null } | null>(null);
  React.useEffect(() => {
    let vivant = true;
    setDns(null);
    api.deployment.dnsStatus(target?.host)
      .then((s) => { if (vivant) setDns({ available: s.available, message: s.message, wildcard: s.wildcard }); })
      .catch(() => {
        if (vivant) {
          setDns({
            available: false,
            message: 'État de la gestion automatique du domaine indisponible : le DNS devra déjà pointer vers le serveur.',
            wildcard: null,
          });
        }
      });
    return () => { vivant = false; };
  }, [target?.host]);

  // Champs de connexion serveur (mot de passe jamais conservé au-delà de l'envoi).
  // L'adresse et l'utilisateur sont préremplis depuis la destination : le parcours
  // courant ne demande que le serveur + le mot de passe.
  const [host, setHost] = React.useState(session?.host ?? target?.sshHost ?? '');
  const [username, setUsername] = React.useState(session?.username ?? target?.sshUser ?? 'root');
  const [password, setPassword] = React.useState('');

  // Change de destination -> pré-remplit le serveur/utilisateur associés (tant
  // qu'aucune session n'est ouverte).
  React.useEffect(() => {
    if (session) return;
    setHost(target?.sshHost ?? '');
    setUsername(target?.sshUser ?? 'root');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  const canNext = (): boolean => {
    if (step === 0) return Boolean(selectedId);
    if (step === 1) return Boolean(session) || (host.trim().length > 0 && username.trim().length > 0 && password.length > 0);
    /*
      DERNIERE ETAPE : une mise en ligne en PRODUCTION exige la confirmation
      nominative. Le bouton reste inerte tant qu'elle n'est pas donnée — c'est
      le seul moment où l'opérateur peut encore reculer.
    */
    if (step === 2 && target?.environment === 'PROD') return confirmProd;
    return true;
  };

  const next = async () => {
    if (step === 0) {
      if (!selectedId) return toast.error('Choisissez une destination.');
      setStep(1);
    } else if (step === 1) {
      if (session) return setStep(2);
      const okc = await connect({ host: host.trim(), username: username.trim(), password });
      if (okc) {
        setPassword(''); // on efface le mot de passe dès la session ouverte
        setStep(2);
      }
    } else if (step === 2) {
      setRunPhase('preflight');
    }
  };
  const back = () => (step === 0 ? onExit() : setStep((s) => s - 1));

  /* ------------------------- Phases post-formulaire ------------------------- */
  if (runPhase === 'preflight' && target && session) {
    return (
      <PreflightExperience
        targetId={target.id}
        targetHost={target.host}
        sessionId={session.sessionId}
        onReady={() => {
          startRef.current = Date.now();
          setRunPhase('deploying');
        }}
        onBack={() => setRunPhase('form')}
        onViewReport={onViewReport}
      />
    );
  }

  if (runPhase === 'deploying' && target && session) {
    return (
      <DeployRunning
        body={{ targetId: target.id, sessionId: session.sessionId }}
        onRapport={onViewReport}
        siteUrl={target.url}
        managerUrl={target.managerUrl}
        version={version || ''}
        onDone={async (o) => {
          setOutcome(o);
          setDeployedMs(o.ok ? Date.now() - startRef.current : null);
          await reload();
          setRunPhase(o.ok ? 'success' : 'error');
        }}
      />
    );
  }

  if (runPhase === 'success' && outcome && target) {
    return (
      <SuccessScreen
        siteUrl={target.url}
        managerUrl={target.managerUrl}
        version={outcome.version}
        durationMs={deployedMs}
        runId={outcome.runId}
        onBack={onExit}
        onViewReport={onViewReport}
        onRedeploy={() => {
          setOutcome(null);
          setRunPhase('form');
          setStep(2);
        }}
      />
    );
  }

  if (runPhase === 'error') {
    return (
      <ErrorPanel
        code={outcome?.error?.code}
        message={outcome?.error?.message}
        onRetry={() => setRunPhase('preflight')}
        onBack={() => setRunPhase('form')}
        onViewReport={outcome?.runId ? () => onViewReport(outcome.runId as string) : undefined}
      />
    );
  }

  /* -------------------------------- Formulaire -------------------------------- */
  return (
    <WizardShell
      steps={STEPS}
      current={step}
      title={step === 0 ? 'Où publier votre site ?' : step === 1 ? 'Connexion au serveur' : 'Prêt à publier'}
      subtitle={
        step === 0
          ? 'Choisissez une destination existante ou ajoutez-en une.'
          : step === 1
          ? 'Ces informations servent uniquement à publier. Elles ne sont pas enregistrées.'
          : 'Vérifiez les informations, puis lancez la publication.'
      }
      onBack={back}
      backLabel={step === 0 ? 'Annuler' : 'Précédent'}
      onNext={next}
      nextLabel={step === 2 ? 'Lancer la publication' : 'Suivant'}
      nextDisabled={!canNext()}
      nextLoading={step === 1 && connecting}
    >
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {adding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {adding ? 'Annuler' : 'Nouvelle destination'}
            </button>
          </div>
          {adding && (
            <NewTargetForm
              onCreated={async (t) => {
                setAdding(false);
                await reload();
                setSelectedId(t.id);
              }}
            />
          )}
          {targets.length === 0 && !adding ? (
            <p className="rounded-xl bg-muted/50 p-4 text-center text-sm text-muted-foreground">
              Aucune destination pour l’instant. Ajoutez-en une pour commencer.
            </p>
          ) : (
            <div className="grid gap-3">
              {targets.map((t) => (
                <TargetCard key={t.id} target={t} mode="select" selected={selectedId === t.id} onSelect={() => setSelectedId(t.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {session ? (
            <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-emerald-700">
                <ShieldCheck className="h-4 w-4" /> Connecté à <span className="font-mono">{session.username}@{session.host}</span>
              </span>
            </div>
          ) : (
            <>
              <Field label="Adresse du serveur" hint="L’adresse IP ou le nom d’hôte de votre serveur.">
                <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" autoFocus />
              </Field>
              <Field label="Mot de passe">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </Field>
              <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div>
                  {/* Le réglage « conserver la session » a disparu : la durée
                      de vie d'un secret en RAM n'est pas une décision
                      d'utilisateur. Le backend la repousse tant que
                      l'opération est active. */}
                  <p className="mt-1 text-xs text-muted-foreground">Votre mot de passe n’est jamais enregistré.</p>
                </div>
              </div>
              <AdvancedDisclosure>
                <Field label="Utilisateur du serveur">
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Préconfiguré sur « root ». Ne le modifiez que si votre hébergeur l’exige.
                </p>
              </AdvancedDisclosure>
            </>
          )}
        </div>
      )}

      {step === 2 && target && (
        <div className="space-y-3">
          {dns && !dns.available && target.type === 'domain' && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
              <Wand2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                {/*
                  Le message vient de la plateforme et NOMME le responsable :
                  droit manquant, clé absente chez elle, domaine hors de son
                  portefeuille. Aucun de ces cas ne se répare dans cet écran, et
                  y renvoyer l'opérateur lui ferait saisir un secret inutile.
                */}
                {dns.message} Sinon, le DNS doit déjà pointer vers le serveur.
              </div>
            </div>
          )}
          {dns?.available && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-300/70 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-800">
              <Wand2 className="h-4 w-4" />
              Gestion automatique du domaine active via la plateforme — les adresses seront préparées pour vous.
              {dns.wildcard === true && ' Une entrée générique couvre déjà ce domaine : aucun enregistrement inutile ne sera créé.'}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Adresse du site" value={target.host} icon={Globe} />
            <StatTile label="Adresse du Manager" value={target.managerHost} icon={MonitorSmartphone} />
            <StatTile label="Version à publier" value={<span className="font-mono">{version ?? '—'}</span>} icon={GitCommitHorizontal} />
            <StatTile label="Serveur" value={session ? `${session.username}@${session.host}` : '—'} icon={Server} />
          </div>
          {/*
            L'ENVIRONNEMENT SE LIT, IL NE SE CHOISIT PLUS.
            Il vient de la destination et ne changera pas : le montrer evite
            d'avoir a s'en souvenir, sans rouvrir la porte a l'erreur.
          */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 px-3 py-2">
            <Label className="!mb-0">Environnement</Label>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
                target.environment === 'PROD' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              {target.environment === 'PROD' ? 'PRODUCTION' : 'TEST'}
            </span>
            <span className="text-xs text-muted-foreground">
              Fixe par la destination, immuable.
            </span>
          </div>

          {target.environment === 'PROD' && (
            /*
              CONFIRMATION NOMINATIVE - le domaine est ECRIT dans la phrase.
              Une case « je confirme » generique se coche sans lire ; nommer
              l'hote oblige a verifier qu'il s'agit bien de celui-la.
            */
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900">
              <input
                type="checkbox"
                checked={confirmProd}
                onChange={(e) => setConfirmProd(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Je confirme publier en <strong>PRODUCTION</strong> sur{' '}
                <code className="font-mono">{target.host}</code>. Le site actuellement
                en ligne sera remplace.
              </span>
            </label>
          )}
        </div>
      )}
    </WizardShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default DeployAssistant;
