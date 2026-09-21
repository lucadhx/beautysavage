import * as React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

import { toast } from 'sonner';

import { Spinner } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { checklistFor, useDeploymentStepContract } from './deploymentChecklist';
import { FENETRE_REDEMARRAGE_S, useDeploymentObserver } from './useDeploymentResume';
import { RadialProgress } from './ui';
import {
  verdictDeRun, progressionDeRun, etapeCourante, etatAnneau,
} from '@/lib/deploymentProgress';
import type { DeploymentRunSnapshot, DeploymentRunStepSnapshot } from '@/types';

/**
 * ══ LE SUIVI D'UN DÉPLOIEMENT — L'UNIQUE MODÈLE DE LECTURE ═════════════════
 *
 * ── LE DOUBLE MODÈLE QU'IL SUPPRIME ────────────────────────────────────────
 *
 * Il en existait DEUX, et ils ne pouvaient pas s'accorder :
 *
 *   LANCEMENT  `DeployRunning` ouvrait le POST qui démarre le travail et
 *              construisait sa checklist en ACCUMULANT les évènements reçus
 *              depuis. Il ne pouvait donc rien afficher d'un déploiement
 *              commencé avant lui — un aller-retour effaçait tout.
 *
 *   REPRISE    cet écran-ci lisait l'instantané persistant du backend.
 *
 * Deux algorithmes de reconstruction pour une même checklist, dont un
 * structurellement incapable de survivre à un démontage. Le premier a été
 * retiré : `DeployRunning` et `DeployResume` sont désormais deux enveloppes
 * minces autour de CE composant.
 *
 * ── LA RÈGLE, ET ELLE TIENT PAR CONSTRUCTION ───────────────────────────────
 *
 * Ce composant n'a AUCUNE mémoire métier. Ce qu'il montre EST le dernier
 * instantané reçu du backend — jamais une somme d'évènements. Il ignore donc
 * complètement si le run vient d'être lancé, s'il tourne depuis deux minutes,
 * si la page a été rafraîchie, ou si l'instantané vient du premier `GET` ou
 * d'un relevé ultérieur. Ces quatre situations produisent le même écran parce
 * qu'elles produisent la même donnée.
 */
function IconeEtat({ statut }: { statut: DeploymentRunStepSnapshot['status'] }) {
  if (statut === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (statut === 'warning') return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (statut === 'error') return <XCircle className="h-4 w-4 text-destructive" />;
  if (statut === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

/** `03:18` — une durée qui se lit sans réfléchir. */
function duree(depuis: string, jusqua: string | null): string {
  const ms = (jusqua ? new Date(jusqua).getTime() : Date.now()) - new Date(depuis).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const heure = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function DeploymentFollowUp({
  runId,
  instantaneInitial,
  onTermine,
  onFermer,
  onRapport,
}: {
  runId: string;
  /**
   * L'instantané déjà obtenu par la découverte.
   *
   * Il évite l'écran vide d'une seconde pendant que le flux s'ouvre (§12) :
   * l'utilisateur qui revient voit immédiatement où en est son déploiement,
   * puis la progression reprend d'elle-même.
   */
  instantaneInitial?: DeploymentRunSnapshot | null;
  onTermine?: (snapshot: DeploymentRunSnapshot) => void;
  /**
   * Refermer le résultat. Absent tant que le run tourne : on ne propose pas de
   * masquer un déploiement en cours.
   */
  onFermer?: () => void;
  /** Ouvre le rapport complet (modale). Absent = le bouton n'apparaît pas. */
  onRapport?: (runId: string) => void;
}) {
  const { snapshot, chargement, liveperdu, redemarrage, backendAbsent } = useDeploymentObserver(runId);

  /**
   * État du bouton « Copier le rapport ». Déclaré ICI, avec les autres hooks :
   * les gardes de rendu qui suivent (`if (!vue) return null`) rendraient l'ordre
   * des hooks variable s'il vivait plus bas — la panne exacte que
   * `rulesOfHooks` verrouille.
   */
  const [copie, setCopie] = React.useState<'idle' | 'encours' | 'ok'>('idle');

  const copierRapport = React.useCallback(async () => {
    if (!runId) return;
    setCopie('encours');
    try {
      const complet = await api.deployment.getRun(runId);
      const texte = complet.markdownReport
        || `Déploiement ${complet.targetName ?? ''} — ${complet.status}
Étape finale : ${complet.finalStepId ?? '—'}`;
      await navigator.clipboard.writeText(texte);
      setCopie('ok');
      toast.success('Rapport copié dans le presse-papiers.');
    } catch {
      setCopie('idle');
      toast.error('Rapport indisponible : impossible de le copier.');
    }
  }, [runId]);
  const { contract } = useDeploymentStepContract();

  /** L'instantané du flux prime ; celui de la découverte évite le vide initial. */
  const vue = snapshot ?? instantaneInitial ?? null;

  /** Une horloge locale pour la durée — l'état, lui, vient du backend. */
  const [, tic] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    if (!vue?.active) return undefined;
    const t = setInterval(tic, 1000);
    return () => clearInterval(t);
  }, [vue?.active]);

  const previenu = React.useRef(false);
  React.useEffect(() => {
    if (vue && !vue.active && !previenu.current) { previenu.current = true; onTermine?.(vue); }
  }, [vue, onTermine]);

  if (!vue && chargement) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Récupération du déploiement en cours…
      </div>
    );
  }
  if (!vue) return null;

  /**
   * L'ORDRE VIENT DU CONTRAT DU MOTEUR, LES ÉTATS DU RUN.
   *
   * Le run ne porte que les étapes déjà atteintes : sans le contrat, les
   * étapes À VENIR n'existeraient pas à l'écran et la checklist paraîtrait
   * s'allonger toute seule. Sans le run, on n'aurait que des cases vides.
   */
  const parId = new Map(vue.steps.map((s) => [s.id, s]));
  const attendues = checklistFor(contract, vue.operationType === 'PRECHECK' ? 'PRECHECK' : 'DEPLOYMENT');
  const lignes = (attendues.length
    ? attendues.map((c) => ({ id: c.id, label: c.label }))
    : vue.steps.map((s) => ({ id: s.id, label: s.label ?? s.id })))
    .map((c) => ({ ...c, etat: parId.get(c.id) ?? null }));

  /**
   * ══ LE VERDICT VIENT D'UNE SEULE AUTORITÉ (lot R12) ══════════════════════
   *
   * Ici vivait `const succes = vue.status === 'success'`. Le moteur n'écrit
   * JAMAIS `success` : son vocabulaire terminal est `ok | error | warning |
   * cancelled | interrupted | finalization_failed`. **Tout déploiement réussi
   * s'affichait donc « échoué ».**
   *
   * Le test était prudent dans son intention et faux dans son vocabulaire. La
   * recette navigateur ne l'a pas vu : son faux moteur émettait `success` — le
   * harnais parlait une langue que la production ne parle pas.
   *
   * Verdict, progression et état de la roue sortent désormais du même module,
   * comparé à l'énumération réelle du modèle par un test.
   */
  const verdict = verdictDeRun(vue);
  const fini = verdict !== 'en-cours';
  const succes = verdict === 'succes' || verdict === 'reserve';
  const echec = fini && !succes;
  const interrompu = verdict === 'interrompu';

  /**
   * LA ROUE EST ALIMENTÉE PAR L'INSTANTANÉ PERSISTANT, PAS PAR UNE HORLOGE.
   *
   * C'est ce qui la fait reprendre au bon pourcentage après une navigation, un
   * rechargement ou l'ouverture d'un second onglet : il n'y a rien à
   * reconstituer, la valeur est une lecture du run.
   */
  const progression = progressionDeRun(vue, lignes.map((l) => l.id));
  const courante = etapeCourante(vue);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          {!fini && <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />}
          <h2 className="text-lg font-semibold">
            {fini
              ? (echec ? `Déploiement ${vue.env ?? ''} échoué` : `Déploiement ${vue.env ?? ''} terminé`)
              : `Déploiement ${vue.env ?? ''} en cours`}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {vue.targetName} · Démarré à {heure(vue.startedAt)} · Durée {duree(vue.startedAt, vue.finishedAt)}
        </p>

        {/*
          ══ LA ROUE EST LE FOCUS VISUEL — restaurée en R12 ═══════════════════

          Elle existait dans l'écran historique, et le chantier du suivi
          persistant l'avait fait disparaître : `RadialProgress` était resté
          dans `ui.tsx` SANS AUCUN CONSOMMATEUR. Le lot devait changer la source
          de vérité, pas dégrader l'UX — une checklist nue ne dit pas d'un coup
          d'œil « où en est-on ».

          Ce qui change par rapport à l'ancienne version : la valeur ne vient
          plus d'un état React accumulé au fil du flux, mais du snapshot
          persistant. Même dessin, autre source — c'est tout l'objet du lot.
        */}
        <div className="mt-6 flex flex-col items-center">
          <RadialProgress
            value={progression.valeur}
            state={etatAnneau(verdict)}
            label={(
              <div className="text-3xl font-semibold tabular-nums" data-testid="deploiement-pourcentage">
                {progression.pourcentage}%
              </div>
            )}
            sublabel={`${progression.achevees}/${progression.total} étapes`}
          />

          {/*
            L'ÉTAPE EN COURS EST NOMMÉE.

            Sans elle, une étape longue — l'installation des dépendances en est
            une — laisse l'opérateur devant une roue immobile, sans savoir si
            quelque chose travaille ou si tout est bloqué.
          */}
          <p className="mt-3 text-center text-sm font-medium" data-testid="deploiement-etape-courante">
            {redemarrage && !fini
              ? 'Redémarrage du serveur…'
              : interrompu
                ? `Interrompu pendant « ${courante?.label ?? 'une étape'} »`
                : (courante?.label ?? 'Préparation…')}
          </p>
        </div>

        {/*
          UNE COUPURE DE SUIVI N'EST PAS UN ÉCHEC (§15).
          Le travail continue côté serveur ; on le dit, sans jamais afficher
          « déploiement échoué » pour une connexion qui a lâché.
        */}
        {/*
          LE SERVEUR REDÉMARRE — annoncé comme tel, jamais comme une erreur.

          Déployer ce projet sur la machine qui héberge l'API coupe l'API. Le
          déploiement, lui, se poursuit : il vit dans le run persisté, pas dans
          la connexion. On reprend depuis ce run, avec une patience BORNÉE.
        */}
        {redemarrage && !fini && (
          <p className="mt-3 flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {redemarrage} Le déploiement se poursuit, on reprend le suivi dès son retour.
          </p>
        )}

        {/*
          …ET S'IL NE REVIENT PAS, ON LE DIT.

          Un spinner éternel laisserait croire à un travail suivi alors que plus
          personne ne répond. Ce n'est toujours pas « déploiement échoué » — on
          ne sait pas ce qu'est devenu le run — mais l'utilisateur doit pouvoir
          aller voir.
        */}
        {backendAbsent && !fini && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Le serveur n’est pas revenu après son redémarrage
            ({FENETRE_REDEMARRAGE_S}s d’attente). Le déploiement peut avoir abouti :
            rechargez la page pour retrouver son état.
          </p>
        )}

        {liveperdu && !redemarrage && !backendAbsent && !fini && (
          <p className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reconnexion au suivi… le déploiement continue sur le serveur.
          </p>
        )}

        {/*
          ══ LES ACTIONS DE FIN DE RUN — restaurées en R12 ═══════════════════

          « Copier le rapport » existait dans l'écran historique et avait disparu
          avec lui. C'est l'action la plus demandée après un échec : elle rend le
          Markdown complet, celui qu'on colle dans un ticket ou dans une
          conversation. Sans elle, il faut relire l'écran et retaper.

          Le rapport n'est PAS dans l'instantané de suivi — celui-ci est
          volontairement minimal. On va donc le chercher au clic, sur le run
          persisté : c'est la même autorité, et cela évite de charger un
          document que la plupart des runs n'auront jamais besoin d'exposer.
        */}
        {fini && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copierRapport}
              disabled={copie === 'encours'}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60"
            >
              {copie === 'ok' ? 'Rapport copié' : copie === 'encours' ? 'Copie…' : 'Copier le rapport'}
            </button>
            {onRapport && (
              <button
                type="button"
                onClick={() => onRapport(vue.id)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Voir le rapport
              </button>
            )}
            {onFermer && (
              <button
                type="button"
                onClick={onFermer}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Fermer le suivi
              </button>
            )}
          </div>
        )}

        <ul className="mt-5 space-y-2">
          {lignes.map((l) => (
            <li key={l.id} className="flex items-center gap-3 text-sm">
              <IconeEtat statut={l.etat?.status ?? 'pending'} />
              <span className={l.etat?.status === 'pending' || !l.etat ? 'text-muted-foreground' : ''}>
                {l.label}
              </span>
              {l.etat?.publicMessage && (
                <span className="truncate text-xs text-muted-foreground">— {l.etat.publicMessage}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </motion.div>
  );
}

export default DeploymentFollowUp;
