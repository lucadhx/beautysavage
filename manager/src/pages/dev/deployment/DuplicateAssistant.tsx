/**
 * Assistant de DUPLICATION — une décision à la fois, progression en direct,
 * aucun log brut. Nom → Bases → Compte développeur → Résumé → Création → Succès.
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  Copy,
  Database,
  UserPlus,
  FolderGit2,
  ArrowLeft,
  PartyPopper,
  FolderCheck,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { DuplicateStreamEvent, DuplicationResult, DuplicationPhaseContract, DuplicationPhaseEvent } from '@/types';
import { Input, Label, Button } from '@/components/ui/primitives';
import { WizardShell, Panel, Reveal, PhaseRow, DynIcon, StatTile, DetailsDisclosure } from './ui';
import { buildChecklist, type ChecklistRow } from './duplicationChecklist';
import { DuplicateArt } from './illustrations';
import { ErrorPanel } from './ErrorPanel';
import { validateGithubRepositoryUrl } from '@/lib/githubRepositoryUrl';

const STEPS = ['Projet', 'Bases', 'Comptes', 'Résumé', 'Création'];
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

type Phase = 'form' | 'running' | 'success' | 'error';

export function DuplicateAssistant({ onExit }: { onExit: () => void }) {
  const [step, setStep] = React.useState(0);
  const [phase, setPhase] = React.useState<Phase>('form');
  const [form, setForm] = React.useState({
    projectName: '',
    folderName: '',
    githubRepositoryUrl: '',
    dbTest: '',
    dbProd: '',
    devEmail: '',
    devName: '',
    adminEmail: '',
    adminPassword: '',
    adminPasswordConfirmation: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  /**
   * ON CONSERVE LES ÉVÉNEMENTS, PAS UN ÉTAT PRÉ-CALCULÉ.
   *
   * L'écran tenait une carte `{ id → état }` initialisée depuis sa propre liste
   * de phases : il devait donc CONNAÎTRE les phases avant d'en recevoir une, et
   * c'est cette connaissance recopiée à la main qui a dérivé. Il garde
   * désormais ce qu'il a réellement reçu, et la checklist se DÉRIVE du contrat
   * canonique croisé avec ces faits.
   */
  const [events, setEvents] = React.useState<DuplicationPhaseEvent[]>([]);
  const [contract, setContract] = React.useState<DuplicationPhaseContract[]>([]);
  const [result, setResult] = React.useState<DuplicationResult | null>(null);
  // Le contrat est demandé une fois : c'est une DÉFINITION, elle ne change pas
  // pendant une exécution.
  React.useEffect(() => {
    void api.deployment.duplicationPhases().then(setContract).catch(() => setContract([]));
  }, []);
  const [error, setError] = React.useState<{ code?: string; message?: string } | null>(null);

  const repoCheck = validateGithubRepositoryUrl(form.githubRepositoryUrl);
  const stepValid = (i: number): boolean => {
    if (i === 0) return form.projectName.trim().length > 0 && repoCheck.valid;
    if (i === 1) return form.dbTest.trim().length > 0 && form.dbProd.trim().length > 0 && form.dbTest.trim() !== form.dbProd.trim();
    /**
     * DEUX COMPTES, DEUX EXIGENCES — et c'est la même étape.
     *
     * Du DÉVELOPPEUR on ne demande qu'une identité : il choisira son mot de
     * passe par le lien d'activation reçu par e-mail.
     *
     * De l'ADMINISTRATEUR on demande aussi un mot de passe : c'est le compte
     * que l'exploitant remet au client à la livraison, souvent de vive voix,
     * parfois avant que la boîte du client ne soit relevée.
     *
     * L'écran refuse d'avancer si quoi que ce soit manque — mais il n'est pas
     * l'autorité : le moteur revérifie tout, et refuse en plus les secrets
     * historiques du parc.
     */
    if (i === 2) {
      return emailOk(form.devEmail.trim())
        && emailOk(form.adminEmail.trim())
        && form.adminPassword.length >= 6
        && form.adminPassword === form.adminPasswordConfirmation;
    }
    return true;
  };

  const next = () => {
    if (!stepValid(step)) return toast.error('Complétez cette étape pour continuer.');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => (step === 0 ? onExit() : setStep((s) => s - 1));

  const start = async () => {
    setPhase('running');
    setStep(4);
    setError(null);
    setResult(null);
    setEvents([]);
    try {
      for await (const evt of api.deployment.streamDuplicate({
        projectName: form.projectName.trim(),
        folderName: form.folderName.trim() || undefined,
        githubRepositoryUrl: repoCheck.normalized ?? form.githubRepositoryUrl.trim(),
        dbTest: form.dbTest.trim(),
        dbProd: form.dbProd.trim(),
        devEmail: form.devEmail.trim(),
        devName: form.devName.trim(),
        adminEmail: form.adminEmail.trim(),
        adminPassword: form.adminPassword,
        adminPasswordConfirmation: form.adminPasswordConfirmation,
      })) {
        const e = evt as DuplicateStreamEvent;
        if (e.type === 'phase') {
          // Aucun filtrage, aucun aiguillage : ce que le moteur dit est conservé
          // tel quel, et c'est le contrat qui décide de sa présentation.
          setEvents((prev) => [...prev, e]);
        } else if (e.type === 'result') {
          setResult(e);
          setPhase('success');
        } else if (e.type === 'error') {
          setError({ code: e.code, message: e.message });
          setPhase('error');
        }
      }
    } catch (err) {
      setError({ code: 'OFFLINE', message: err instanceof Error ? err.message : undefined });
      setPhase('error');
    }
  };

  if (phase === 'error') {
    return (
      <ErrorPanel
        code={error?.code}
        message={error?.message}
        onRetry={() => {
          setPhase('form');
          setStep(3);
        }}
        onBack={onExit}
      />
    );
  }

  if (phase === 'running' || phase === 'success') {
    return (
      <RunningView phase={phase} rows={buildChecklist(contract, events)} result={result} form={form} onExit={onExit} onAnother={() => resetAll()} />
    );
  }

  function resetAll() {
    setForm({
      projectName: '', folderName: '', githubRepositoryUrl: '', dbTest: '', dbProd: '',
      devEmail: '', devName: '', adminEmail: '', adminPassword: '', adminPasswordConfirmation: '',
    });
    setPhase('form');
    setStep(0);
    setResult(null);
  }

  /* ------------------------------- Formulaire ------------------------------- */
  return (
    <WizardShell
      steps={STEPS}
      current={step}
      title={
        step === 0
          ? 'Nommez votre nouveau projet'
          : step === 1
          ? 'Choisissez les bases de données'
          : step === 2
          ? 'Créez le compte développeur'
          : 'Tout est prêt'
      }
      subtitle={
        step === 0
          ? 'Une copie complète de ce projet, prête à personnaliser.'
          : step === 1
          ? 'Deux espaces séparés : un pour tester, un pour la production.'
          : step === 2
          ? 'Le compte qui vous permettra d’administrer la copie.'
          : 'Vérifiez, puis lancez la création.'
      }
      onBack={back}
      backLabel={step === 0 ? 'Annuler' : 'Précédent'}
      onNext={step < 3 ? next : start}
      nextLabel={step < 3 ? 'Suivant' : 'Créer le projet'}
      nextDisabled={!stepValid(step)}
    >
      {step === 0 && (
        <div className="space-y-4">
          <Field label="Nom du projet" hint="Ex. « Garage Dupont ».">
            <Input value={form.projectName} onChange={(e) => set('projectName', e.target.value)} placeholder="Garage Dupont" autoFocus />
          </Field>
          <Field label="Nom du dossier" hint="Laissez vide pour le déduire automatiquement.">
            <Input value={form.folderName} onChange={(e) => set('folderName', e.target.value)} placeholder="garage-dupont" />
          </Field>
          <Field
            label="URL du dépôt GitHub du nouveau projet"
            hint="Dépôt GitHub qui contiendra cette nouvelle instance — jamais celui du projet source. Ex. https://github.com/mon-organisation/mon-nouveau-projet.git"
          >
            <Input
              value={form.githubRepositoryUrl}
              onChange={(e) => set('githubRepositoryUrl', e.target.value)}
              placeholder="https://github.com/mon-organisation/mon-nouveau-projet.git"
            />
            {form.githubRepositoryUrl.trim().length > 0 && !repoCheck.valid && (
              <p className="mt-1 text-xs text-red-600">{repoCheck.error}</p>
            )}
            {repoCheck.valid && repoCheck.normalized !== form.githubRepositoryUrl.trim() && (
              <p className="mt-1 text-xs text-muted-foreground">
                Sera enregistrée comme : <span className="font-mono">{repoCheck.normalized}</span>
              </p>
            )}
          </Field>
        </div>
      )}
      {step === 1 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
            <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Deux bases distinctes sont nécessaires : elles seront créées automatiquement si elles n’existent pas.
          </div>
          <Field label="Base de test">
            <Input value={form.dbTest} onChange={(e) => set('dbTest', e.target.value)} placeholder="dupont_test" autoFocus />
          </Field>
          <Field label="Base de production">
            <Input value={form.dbProd} onChange={(e) => set('dbProd', e.target.value)} placeholder="dupont_prod" />
          </Field>
          {form.dbTest && form.dbTest.trim() === form.dbProd.trim() && (
            <p className="text-xs text-red-600">Les deux bases doivent être différentes.</p>
          )}
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          {/*
            AUCUN CHAMP MOT DE PASSE — et c'est le sujet du lot 2C.

            L'assistant en demandait un. Il finissait en clair dans le `.env` de
            la copie, identique pour quiconque relisait ce fichier, et rien
            n'obligeait jamais à en changer. Le compte est désormais créé SANS
            mot de passe : son titulaire choisit le sien par un lien à usage
            unique, envoyé à l'adresse ci-dessous.
          */}
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            Ce compte est indépendant de L.Y Solution et permet d’administrer le projet
            localement. Il recevra un lien d’activation pour choisir son mot de passe —
            aucun mot de passe n’est défini ici.
          </div>
          <Field label="Adresse e-mail" hint="Le lien d’activation y sera envoyé.">
            <Input type="email" value={form.devEmail} onChange={(e) => set('devEmail', e.target.value)} placeholder="dev@dupont.fr" autoFocus />
          </Field>
          <Field label="Nom (facultatif)" hint="Affiché dans le manager et dans l’e-mail d’activation.">
            <Input value={form.devName} onChange={(e) => set('devName', e.target.value)} placeholder="Jean Dupont" />
          </Field>

          <div className="pt-2 text-sm font-semibold">Premier administrateur</div>
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <UserPlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            C’est le compte que vous remettrez au client. Il est créé immédiatement avec
            le mot de passe défini ici — contrairement au développeur, qui active le sien
            par e-mail.
          </div>
          <Field label="Adresse e-mail">
            <Input
              type="email"
              value={form.adminEmail}
              onChange={(e) => set('adminEmail', e.target.value)}
              placeholder="contact@dupont.fr"
            />
          </Field>
          <Field label="Mot de passe" hint="6 caractères minimum, propre à ce projet.">
            <Input
              type="password"
              value={form.adminPassword}
              onChange={(e) => set('adminPassword', e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label="Confirmer le mot de passe">
            <Input
              type="password"
              value={form.adminPasswordConfirmation}
              onChange={(e) => set('adminPasswordConfirmation', e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          {form.adminPasswordConfirmation
            && form.adminPassword !== form.adminPasswordConfirmation && (
            <p className="text-xs text-red-600">Les deux mots de passe ne correspondent pas.</p>
          )}
        </div>
      )}
      {step === 3 && (
        <div className="space-y-3">
          <SummaryRow icon={Copy} label="Projet" value={form.projectName} />
          <SummaryRow icon={FolderGit2} label="Dossier" value={form.folderName || '(automatique)'} />
          <SummaryRow icon={FolderGit2} label="Dépôt GitHub" value={repoCheck.normalized ?? form.githubRepositoryUrl} />
          <SummaryRow icon={Database} label="Bases" value={`${form.dbTest} · ${form.dbProd}`} />
          <SummaryRow icon={UserPlus} label="Premier développeur local" value={form.devEmail} />
          <SummaryRow icon={UserPlus} label="Accès développeur" value="Lien d’activation — mot de passe choisi par lui" />
          <SummaryRow icon={UserPlus} label="Premier administrateur" value={form.adminEmail} />
          <SummaryRow icon={UserPlus} label="Accès administrateur" value="Mot de passe défini à l’instant — compte actif immédiatement" />
        </div>
      )}
    </WizardShell>
  );
}

/* --------------------------- Vue création / succès --------------------------- */

function RunningView({
  phase,
  rows,
  result,
  form,
  onExit,
  onAnother,
}: {
  phase: 'running' | 'success';
  rows: ChecklistRow[];
  result: DuplicationResult | null;
  form: { projectName: string };
  onExit: () => void;
  onAnother: () => void;
}) {


  if (phase === 'success' && result) {
    return (
      <Reveal>
        <Panel className="mx-auto max-w-xl text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
            <PartyPopper className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">Projet dupliqué</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            « {result.project} » est prêt. Vous pouvez maintenant l’ouvrir et le personnaliser.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <StatTile label="Bases créées" value={`${result.dbTest.name} · ${result.dbProd.name}`} icon={Database} />
            <StatTile label="Fichiers copiés" value={result.copy.files} icon={FolderCheck} />
          </div>
          <div className="mt-3 rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-left">
            <div className="text-xs text-muted-foreground">Emplacement</div>
            <div className="mt-0.5 break-all font-mono text-xs">{result.path}</div>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Button variant="ghost" onClick={onExit}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
            <Button onClick={onAnother}>
              <Sparkles className="h-4 w-4" /> Dupliquer un autre
            </Button>
          </div>
        </Panel>
      </Reveal>
    );
  }

  return (
    <Reveal>
      <Panel className="mx-auto max-w-xl">
        <div className="flex items-center gap-4">
          <div className="text-primary">
            <DuplicateArt className="h-14 w-14" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Création en cours…</h2>
            <p className="text-sm text-muted-foreground">Nous préparons « {form.projectName} ». Cela prend quelques instants.</p>
          </div>
        </div>
        <div className="mt-5 space-y-1">
          {rows.map((r) => (
            <PhaseRow
              key={r.key}
              icon={<DynIcon name={r.icon} className="h-4 w-4 text-muted-foreground" />}
              label={r.label}
              state={r.state}
            />
          ))}
        </div>
        <DetailsDisclosure label="À propos de cette étape">
          Nous préparons les bases, copions le projet, configurons son environnement, détectons backend, manager et vitrine,
          installons leurs dépendances puis validons la copie. Aucune action de votre part n’est requise.
        </DetailsDisclosure>
      </Panel>
    </Reveal>
  );
}


/* -------------------------------- Sous-vues -------------------------------- */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof Copy; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground/70">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

export default DuplicateAssistant;
