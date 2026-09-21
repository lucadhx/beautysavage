/**
 * RETRAIT ET SUPPRESSION D'UNE DESTINATION — deux gestes, dans cet ordre.
 *
 * ══ POURQUOI UNE FENÊTRE DÉDIÉE, ET NON UN `confirm()` ══════════════════════
 *
 * Un `confirm()` du navigateur pose une question sans montrer de réponse : il
 * ne peut afficher ni le port, ni le service, ni la taille, ni le nombre de
 * médias qui vont disparaître. On ne fait pas confirmer une destruction sans
 * montrer ce qui sera détruit — sinon l'opérateur ne confirme pas un retrait,
 * il valide une phrase.
 *
 * C'est exactement ce qui s'est produit : une fiche supprimée d'un clic, et
 * sur le serveur un service PM2 toujours en ligne détenant son port, une
 * configuration Nginx active et des fichiers. Plus aucune fiche ne disait
 * qu'il restait quelque chose à nettoyer.
 *
 * ══ LE DÉROULÉ ═════════════════════════════════════════════════════════════
 *
 *   1. session serveur → INVENTAIRE réel, lu sur la machine ;
 *   2. confirmation SÉPARÉE de la perte des données persistantes ;
 *   3. saisie EXACTE du nom d'hôte ;
 *   4. exécution, étape par étape, en direct.
 *
 * La saisie du nom d'hôte n'est pas une friction décorative : c'est le seul
 * contrôle qui distingue « je veux retirer CETTE destination » de « j'ai
 * cliqué sur la mauvaise ligne ». Une case à cocher ne fait pas cette
 * distinction.
 */
import * as React from 'react';
import { AlertTriangle, Loader2, ServerCog, X } from 'lucide-react';
import { api, API_BASE, ApiError, tokenStore } from '@/lib/api';
import type { DeploymentTarget, DestinationInspection } from '@/types';
import { cn } from '@/lib/utils';
import { describeServerFailure } from '@/lib/serverErrors';
import { estRunIdDeCeProjet, PREFIXE_MEMOIRE } from '@/lib/deploymentRunId';
import { useScrollLock } from '@/lib/scrollLock';

type Mode = 'deprovision' | 'delete';

/**
 * LE RUN EN COURS, MÉMORISÉ HORS DU COMPOSANT.
 *
 * ══ POURQUOI LE NAVIGATEUR DOIT S'EN SOUVENIR ═══════════════════════════════
 *
 * Une suppression qui aboutit fait disparaître la destination pendant que le
 * flux est encore ouvert. Si le canal se rompt à cet instant — onglet
 * rafraîchi, réseau qui hoquette, composant remonté — le travail est FAIT et
 * l'écran ne le sait pas. Sans mémoire, il ne pourrait que proposer de
 * recommencer une opération déjà terminée.
 *
 * On retient donc l'identifiant du run, associé à la destination et au geste.
 * Au montage suivant, l'écran relit CE run — il n'en lance jamais un second.
 *
 * `sessionStorage` : la mémoire meurt avec l'onglet, comme le contexte de
 * l'opération. Rien de sensible n'y transite — un identifiant de run.
 */
/**
 * Le préfixe vient de `deploymentRunId`, qui le cloisonne par projet et le
 * relit lors de la purge. Le reconstruire ici ferait diverger l'écriture de la
 * purge — et une entrée non purgée est exactement ce que cette purge existe
 * pour empêcher.
 */
const cleRun = (targetId: string, mode: Mode) => `${PREFIXE_MEMOIRE}${mode}.${targetId}`;

function memoriserRun(targetId: string, mode: Mode, runId: string) {
  try { sessionStorage.setItem(cleRun(targetId, mode), runId); } catch { /* stockage refusé */ }
}
function runMemorise(targetId: string, mode: Mode): string | null {
  try {
    const memorise = sessionStorage.getItem(cleRun(targetId, mode));
    /**
     * UN IDENTIFIANT MÉMORISÉ N'EST PAS UNE VÉRITÉ — c'est une entrée.
     *
     * Le backend de ce projet a reçu quatre requêtes portant un identifiant
     * qu'il ne sait pas produire (un UUID, là où ses runs sont des ObjectId).
     * Restaurer une telle valeur revient à demander le suivi d'une opération
     * qui n'existe pas ici : la réponse ressemble alors à une panne
     * d'authentification, et l'on cherche au mauvais endroit.
     *
     * On la refuse ET on l'oublie : la laisser en place la ferait revenir à
     * chaque montage.
     */
    if (memorise !== null && !estRunIdDeCeProjet(memorise)) {
      oublierRun(targetId, mode);
      return null;
    }
    return memorise;
  } catch { return null; }
}
function oublierRun(targetId: string, mode: Mode) {
  try { sessionStorage.removeItem(cleRun(targetId, mode)); } catch { /* idem */ }
}

/** Une étape telle que le moteur la rapporte, pendant l'exécution. */
interface Etape {
  id: string;
  label: string;
  /** `pending` : pas encore commencée. Ce n'est PAS « ignorée ». */
  status: 'pending' | 'running' | 'ok' | 'error' | 'skipped';
  detail?: string | null;
  code?: string | null;
}

/**
 * LE PLAN VIENT DU SERVEUR — plus d'une copie tenue à la main ici.
 *
 * Cette liste était recopiée dans l'écran, avec des libellés qui avaient déjà
 * divergé de ceux du moteur (« Arrêt du service (PM2) » contre « Arrêt du
 * service applicatif »). Une checklist qui ne nomme pas les mêmes étapes que
 * le journal oblige à traduire mentalement au moment le plus délicat.
 *
 * Le flux ouvre désormais sur un évènement `deprovision.started` qui porte le
 * plan tel que le moteur l'exécutera. Cette liste ne sert plus que de repli
 * pour un backend antérieur : elle ne fait plus autorité.
 */
const PLAN_DE_SECOURS: Array<{ id: string; label: string }> = [
  { id: 'deprovision.lock', label: 'Verrouillage de la destination' },
  { id: 'deprovision.inventory', label: 'Inventaire du serveur' },
  { id: 'deprovision.services.stop', label: 'Arrêt du service applicatif' },
  { id: 'deprovision.services.verify', label: 'Vérification de l’arrêt' },
  { id: 'deprovision.port.release', label: 'Libération du port' },
  { id: 'deprovision.nginx.remove', label: 'Retrait du routage applicatif' },
  { id: 'deprovision.quarantine', label: 'Installation de la quarantaine (410)' },
  { id: 'deprovision.files.remove', label: 'Suppression des fichiers' },
  { id: 'deprovision.verify', label: 'Vérification finale' },
  { id: 'deprovision.finalize', label: 'Destination vidée' },
];

/** Le rapport du run, tel que le serveur le produit. Jamais reconstruit ici. */
interface RapportRetrait {
  identification: {
    runId: string; operationType: string; targetName: string; host: string;
    url: string; environment: string; startedAt: string; finishedAt: string; durationMs: number;
  };
  outcome: { ok: boolean; status: string; failedStep: string | null; error: { code: string; message: string } | null };
  steps: Array<{ id: string; label: string; status: string; durationMs: number | null; errorCode: string | null }>;
  removed: Record<string, unknown>;
  verifications: Record<string, unknown>;
}

export function RemovalDialog({
  mode,
  target,
  sessionId,
  onConnect,
  connecting = false,
  onCancel,
  onDone,
  onClosed,
}: {
  mode: Mode;
  target: DeploymentTarget;
  /** Session serveur déjà ouverte, s'il y en a une. */
  sessionId: string | null;
  /**
   * OUVRIR UNE SESSION DEPUIS CETTE FENÊTRE.
   *
   * ── LE DÉFAUT QUE CETTE PROP FERME ───────────────────────────────────────
   * Le retrait EXIGE une session serveur, et la seule façon d'en ouvrir une
   * était l'assistant de déploiement. Depuis « Mes sites », la fenêtre
   * s'ouvrait donc dans un cul-de-sac : le message « ouvrez d'abord une
   * session » s'affichait, le bouton d'inventaire attendait un `sessionId`
   * qui n'arriverait jamais, et le bouton de retrait attendait un inventaire
   * qui ne pouvait pas être fait. Aucune action n'était atteignable.
   *
   * La fenêtre est désormais autonome : elle ouvre sa propre session, avec la
   * MÊME capacité que l'assistant — aucun second chemin d'authentification.
   */
  onConnect?: (creds: {
    host: string; username: string; password: string;
  }) => Promise<boolean>;
  connecting?: boolean;
  onCancel: () => void;
  /** Le succès est NOTIFIÉ ; il ne ferme pas la fenêtre. */
  onDone: (message: string) => void;
  /** Fermeture demandée par l’opérateur, une fois le verdict lu. */
  onClosed?: () => void;
}) {
  // Montée seulement quand la fenêtre est ouverte : le verrou vit tant qu'elle vit.
  useScrollLock(true);

  const [inspection, setInspection] = React.useState<DestinationInspection | null>(null);
  /**
   * Identifiants de session — préremplis depuis la destination : elle sait
   * déjà quel serveur et quel compte la servent. Le mot de passe n'est jamais
   * conservé : il est effacé dès la session ouverte.
   */
  const [sshHost, setSshHost] = React.useState(target.sshHost ?? '');
  const [sshUser, setSshUser] = React.useState(target.sshUser ?? 'root');
  const [sshPass, setSshPass] = React.useState('');
  const [hostname, setHostname] = React.useState('');
  const [dropData, setDropData] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [etapes, setEtapes] = React.useState<Etape[]>([]);
  const [termine, setTermine] = React.useState<'ok' | 'error' | null>(null);
  /** Le rapport RENVOYÉ par le run — pas une reconstitution de ce qu'on a vu. */
  const [rapport, setRapport] = React.useState<RapportRetrait | null>(null);
  const [copie, setCopie] = React.useState(false);
  /** Le run de CETTE opération — connu dès son annonce, retenu au-delà du flux. */
  const [runId, setRunId] = React.useState<string | null>(null);
  /** Vrai pendant qu'on relit un run dont on a perdu le flux. */
  const [reconnexion, setReconnexion] = React.useState(false);
  /**
   * CE QUI A ÉTÉ SUPPRIMÉ — instantané reçu avec le verdict.
   *
   * L’écran affiche son succès APRÈS que la destination a cessé d’exister.
   * S’il devait la relire pour se raconter, il lirait une ressource supprimée
   * — un cas NORMAL, pas une exception : entre la suppression et le
   * rafraîchissement de la liste, l’interface détient encore des références
   * vers un objet qui n’est plus là.
   */
  const [supprimee, setSupprimee] = React.useState<{
    id: string; name: string; host: string; environment: string; backendPort: number | null;
  } | null>(null);

  /**
   * RECONSTRUIT L'ÉTAT DEPUIS LE RUN — la seule source qui survit à la
   * disparition de la destination.
   *
   * Le run porte ses étapes, son statut terminal et son rapport structuré. Il
   * suffit donc à raconter l'opération, y compris quand la fiche n'existe plus
   * — ce qui est précisément le cas d'une suppression réussie.
   */
  const relireRun = React.useCallback(async (id: string) => {
    const run = await api.deployment.getRun(id);
    const plan = (run.steps ?? []).map((e) => ({
      id: e.id, label: e.label,
      status: (e.status as Etape['status']) ?? 'pending',
      detail: e.technicalMessage ?? null,
      code: e.errorCode ?? null,
    }));
    if (plan.length > 0) setEtapes(plan);
    const rapportRun = run.structuredReport as unknown as RapportRetrait | null;
    if (rapportRun) {
      setRapport(rapportRun);
      const instantane = (rapportRun as unknown as { deletedTargetSnapshot?: typeof supprimee })
        .deletedTargetSnapshot;
      if (instantane) setSupprimee(instantane);
    }
    if (run.status === 'running') return 'running' as const;
    if (run.status === 'ok') { setTermine('ok'); return 'ok' as const; }
    setTermine('error');
    setErreur(run.errorSummary?.message ?? run.summary ?? 'L’opération s’est terminée en échec.');
    return 'error' as const;
  }, []);

  /**
   * AU MONTAGE : si un run de cette destination est mémorisé, on s'y rattache.
   *
   * ── CE QUE CE RATTACHEMENT N'EST PAS ──────────────────────────────────────
   * Ce n'est pas un second flux, et surtout pas une seconde opération. On
   * RELIT un run persistant. S'il tourne encore, on le relit à cadence bornée ;
   * s'il est terminal, on affiche son verdict — succès compris, même si la
   * destination a disparu entre-temps.
   */
  React.useEffect(() => {
    const memoire = runMemorise(target.id, mode);
    if (!memoire) return;
    let vivant = true;
    let tentatives = 0;
    setRunId(memoire);
    setReconnexion(true);
    const lire = async () => {
      if (!vivant) return;
      tentatives += 1;
      try {
        const etat = await relireRun(memoire);
        if (etat === 'running') {
          // BORNÉ, jamais infini : au-delà, on cesse d'interroger et l'on dit
          // ce qu'on sait, plutôt que de faire tourner une roue sans fin.
          if (tentatives < 60 && vivant) { window.setTimeout(lire, 2000); return; }
          setReconnexion(false);
          return;
        }
        setReconnexion(false);
        oublierRun(target.id, mode);
      } catch {
        // Le run est illisible : on ne conclut ni succès ni échec.
        setReconnexion(false);
      }
    };
    void lire();
    return () => { vivant = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id, mode]);

  const inv = inspection?.inventory ?? null;
  const hostOk = hostname.trim().toLowerCase() === target.host.toLowerCase();
  // Une suppression de fiche ne touche pas au serveur, SAUF si une quarantaine
  // 410 y subsiste : la lever exige une connexion.
  const sessionRequise = mode === 'deprovision' || target.quarantineEnabled;
  const bloqueParSymlinks = (inv?.outboundSymlinks?.length ?? 0) > 0;
  const perteNonConfirmee = mode === 'deprovision' && (inv?.persistentFiles ?? 0) > 0 && !dropData;
  const sessionSaisie = sshHost.trim().length > 0 && sshUser.trim().length > 0 && sshPass.length > 0;

  const titre = mode === 'deprovision'
    ? 'Retirer le déploiement'
    : 'Supprimer définitivement la destination';

  /**
   * OUVRE LA SESSION, PUIS ENCHAÎNE SUR L'INVENTAIRE.
   *
   * Se connecter n'est pas le but : c'est un préalable. Rendre la main après
   * la connexion obligerait à cliquer une seconde fois pour obtenir ce qu'on
   * était venu chercher.
   */
  const ouvrirSession = async () => {
    if (!onConnect || !sessionSaisie) return;
    setErreur(null);
    const ok = await onConnect({
      host: sshHost.trim(), username: sshUser.trim(), password: sshPass,
    });
    // Le mot de passe disparaît de la mémoire de l'écran dès qu'il a servi.
    if (ok) setSshPass('');
  };

  const inspecter = React.useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setErreur(null);
    try {
      setInspection(await api.deployment.inspectTarget(target.id, sessionId));
    } catch (e) {
      /**
       * L'INVENTAIRE ÉCHOUE SUR LE VPS, PAS SUR LE BACKEND.
       *
       * « le serveur n'a pas répondu » désignait n'importe laquelle des deux
       * machines. On nomme la portée, et l'on dit si réessayer a un sens.
       */
      const verdict = describeServerFailure(
        e instanceof ApiError ? e.code : undefined,
        e instanceof ApiError ? e.message : undefined,
      );
      setErreur(verdict.title);
    } finally {
      setBusy(false);
    }
  }, [sessionId, target.id]);

  /**
   * DÈS QU'UNE SESSION EXISTE, ON LIT L'ÉTAT RÉEL — UNE SEULE FOIS.
   *
   * L'inventaire est un PRÉALABLE, pas une option : sans lui, aucun bouton de
   * retrait n'est proposé. Le déclencher automatiquement évite un clic dont la
   * seule fonction serait de débloquer l'écran suivant.
   *
   * ── POURQUOI UN VERROU, ET PAS SEULEMENT UNE CONDITION ───────────────────
   * En développement, React exécute chaque effet DEUX FOIS (StrictMode). Les
   * deux passages voyaient `inspection` à `null` — la première réponse n'était
   * pas encore arrivée — et lançaient donc deux inventaires concurrents, donc
   * deux connexions SSH simultanées vers le même hôte avec les mêmes
   * identifiants. Un serveur qui limite les sessions naissantes
   * (`MaxStartups`, fail2ban) en refuse alors une sur deux : la panne paraît
   * aléatoire alors qu'on la fabrique.
   *
   * La condition ne peut pas suffire : elle lit un état que le second passage
   * n'a pas encore vu. Le verrou, lui, est posé AVANT l'attente.
   */
  const inventaireLance = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!sessionRequise || !sessionId) return;
    if (inventaireLance.current === sessionId) return;
    if (inspection || etapes.length > 0) return;
    inventaireLance.current = sessionId;
    void inspecter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /**
   * EXÉCUTION DU RETRAIT — flux NDJSON, lu ligne par ligne.
   *
   * On n'attend pas la fin pour afficher : la seule opération qui DÉTRUIT
   * mérite au moins autant de traçabilité qu'un déploiement, et un écran qui
   * reste figé pendant qu'un serveur se vide n'inspire aucune confiance.
   */
  const executerRetrait = async () => {
    setBusy(true);
    setErreur(null);
    setRapport(null);
    // Le plan de secours s'affiche IMMÉDIATEMENT ; l'évènement d'ouverture le
    // remplacera par celui du moteur dès qu'il arrivera.
    setEtapes(PLAN_DE_SECOURS.map((e) => ({ ...e, status: 'pending' })));

    const jeton = tokenStore.get();
    const reponse = await fetch(`${API_BASE}/deployment/deprovision/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify({
        targetId: target.id,
        sessionId,
        confirmHostname: hostname.trim(),
        removePersistentData: dropData,
      }),
    }).catch(() => null);

    if (!reponse || !reponse.body) {
      setBusy(false);
      setErreur('Le retrait n’a pas pu être lancé : le backend est injoignable.');
      return;
    }
    if (!reponse.ok && reponse.headers.get('content-type')?.includes('application/json')) {
      const json = await reponse.json().catch(() => ({}));
      setBusy(false);
      setErreur(json.message ?? 'Retrait refusé.');
      return;
    }

    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();
    let reste = '';
    let issue: 'ok' | 'error' | null = null;

    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      reste += decodeur.decode(value, { stream: true });
      const lignes = reste.split('\n');
      reste = lignes.pop() ?? '';

      for (const ligne of lignes) {
        if (!ligne.trim()) continue;
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(ligne); } catch { continue; }

        /**
         * LE PLAN DU MOTEUR — reçu avant la première commande distante.
         *
         * C'est ce qui fait qu'un clic produit TOUT DE SUITE quelque chose à
         * l'écran, y compris pendant la création du run et la pose du verrou.
         */
        if (evt.type === 'deprovision.started' && Array.isArray(evt.steps)) {
          const plan = (evt.steps as Array<{ id: string; label: string }>)
            .map((s) => ({ id: s.id, label: s.label, status: 'pending' as const }));
          if (plan.length > 0) setEtapes(plan);
        }
        // Le run est créé : le verrou de la destination est en train d'être
        // posé. On le montre « en cours » plutôt que de laisser la liste inerte.
        if (evt.type === 'deprovision.run' && typeof evt.runId === 'string') {
          setRunId(evt.runId);
          memoriserRun(target.id, mode, evt.runId);
        }
        if (evt.type === 'deprovision.run') {
          setEtapes((prev) => prev.map((e, i) => (i === 0 && e.status === 'pending'
            ? { ...e, status: 'running' } : e)));
        }

        if (evt.type === 'step' && typeof evt.step === 'string') {
          const id = evt.step as string;
          setEtapes((prev) => prev.map((e) => (e.id === id
            ? {
              ...e,
              status: (evt.status as Etape['status']) ?? 'running',
              detail: (evt.detail as string) ?? e.detail ?? null,
              code: (evt.error as { code?: string } | undefined)?.code ?? null,
            }
            : e)));
        }
        if (evt.type === 'deprovision.failed') {
          issue = 'error';
          setErreur(String(evt.message ?? 'Le retrait s’est interrompu.'));
          if (evt.report) setRapport(evt.report as RapportRetrait);
          // Ce qui n'a jamais commencé n'est pas « fait » : les étapes restées
          // en attente le restent, et la fautive est déjà en rouge.
        }
        if (evt.type === 'deprovision.succeeded') {
          issue = 'ok';
          if (evt.report) setRapport(evt.report as RapportRetrait);
          setEtapes((prev) => prev.map((e) => (e.status === 'ok' || e.status === 'error'
            ? e : { ...e, status: 'ok' })));
        }
      }
    }

    setBusy(false);
    setTermine(issue ?? 'error');
    if (issue === 'ok') onDone('Destination vidée. Sa fiche peut maintenant être supprimée.');
  };

  /**
   * SUPPRESSION DÉFINITIVE — désormais une opération, plus un appel muet.
   *
   * ══ L'IMPASSE QU'ELLE FERME ═══════════════════════════════════════════════
   *
   * Elle appelait `deleteTarget`, qui refusait dès qu'une quarantaine 410
   * subsistait — en renvoyant vers « Supprimer la destination avec une session
   * serveur ouverte », c'est-à-dire vers elle-même. L'opérateur n'avait aucune
   * sortie : le retrait répondait « déjà vidée », la suppression « quarantaine
   * présente ».
   *
   * Elle passe maintenant par le même flux que le retrait : plan annoncé par le
   * moteur, checklist en direct, levée réelle de la quarantaine, rapport
   * copiable venu du run.
   */
  const executerSuppression = async () => {
    setBusy(true);
    setErreur(null);
    setRapport(null);
    setEtapes([]);

    const jeton = tokenStore.get();
    const reponse = await fetch(`${API_BASE}/deployment/destination-delete/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      },
      body: JSON.stringify({
        targetId: target.id,
        // La session n'est envoyée que si elle existe : sans quarantaine, le
        // serveur n'a rien à faire et n'en réclame pas.
        ...(sessionId ? { sessionId } : {}),
        confirmHostname: hostname.trim(),
      }),
    }).catch(() => null);

    if (!reponse || !reponse.body) {
      setBusy(false);
      setErreur(describeServerFailure('BACKEND_INJOIGNABLE').title);
      return;
    }
    if (!reponse.ok && reponse.headers.get('content-type')?.includes('application/json')) {
      const json = await reponse.json().catch(() => ({}));
      setBusy(false);
      setErreur(describeServerFailure(json.code, json.message).title);
      return;
    }

    const lecteur = reponse.body.getReader();
    const decodeur = new TextDecoder();
    let reste = '';
    let issue: 'ok' | 'error' | null = null;

    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      reste += decodeur.decode(value, { stream: true });
      const lignes = reste.split('\n');
      reste = lignes.pop() ?? '';

      for (const ligne of lignes) {
        if (!ligne.trim()) continue;
        let evt: Record<string, unknown>;
        try { evt = JSON.parse(ligne); } catch { continue; }

        if (evt.type === 'delete.run' && typeof evt.runId === 'string') {
          setRunId(evt.runId);
          memoriserRun(target.id, mode, evt.runId);
        }
        if (evt.type === 'delete.started' && Array.isArray(evt.steps)) {
          setEtapes((evt.steps as Array<{ id: string; label: string }>)
            .map((s) => ({ id: s.id, label: s.label, status: 'pending' as const })));
        }
        if (evt.type === 'step' && typeof evt.step === 'string') {
          const id = evt.step as string;
          setEtapes((prev) => prev.map((e) => (e.id === id
            ? {
              ...e,
              status: (evt.status as Etape['status']) ?? 'running',
              detail: (evt.reason as string) ?? (evt.detail as string) ?? e.detail ?? null,
              code: (evt.error as { code?: string } | undefined)?.code ?? null,
            }
            : e)));
        }
        if (evt.type === 'delete.failed') {
          issue = 'error';
          setErreur(String(evt.message ?? 'La suppression s’est interrompue.'));
          if (evt.report) setRapport(evt.report as RapportRetrait);
        }
        if (evt.type === 'delete.succeeded') {
          // IDEMPOTENT : un second évènement terminal identique ne fait que
          // réécrire les mêmes valeurs. Rien à défaire, rien à recompter.
          issue = 'ok';
          if (evt.report) setRapport(evt.report as RapportRetrait);
          if (evt.deletedTargetSnapshot) {
            setSupprimee(evt.deletedTargetSnapshot as typeof supprimee);
          }
        }
      }
    }

    setBusy(false);
    setTermine(issue ?? 'error');
    if (issue === 'ok') {
      /**
       * On NOTIFIE, on ne ferme pas. La fenêtre affiche son verdict à partir
       * du rapport reçu — jamais en relisant une destination qui n'existe
       * plus. Le rafraîchissement de la liste est une opération secondaire :
       * son échec ne peut pas changer ce que le serveur a fait.
       */
      onDone(`Destination « ${supprimee?.name ?? target.name} » supprimée.`
        + (target.quarantineEnabled ? ' La quarantaine 410 a été levée sur le serveur.' : ''));
    }
  };

  const ligne = (label: string, valeur: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-xs font-medium">{valeur}</span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titre}
    >
      {/* Responsive : plein écran en bas sur mobile (320/375), carte centrée
          au-delà. Une modale de destruction ne doit jamais être coupée.

          UN SEUL défilement : il vit sur la carte. L'overlay portait lui aussi
          un `overflow-y-auto`, ce qui faisait deux conteneurs verticaux
          emboîtés — le geste tactile partait dans l'un ou l'autre selon le
          point de départ, et la carte semblait « bloquée » un geste sur deux. */}
      <div className="max-h-[var(--m-viewport-h)] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:max-h-[calc(var(--m-viewport-h)-2rem)] sm:max-w-lg sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{titre}</h2>
            <p className="truncate font-mono text-xs text-muted-foreground">{target.url}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {reconnexion && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reconnexion au suivi de l’opération…
          </p>
        )}

        {erreur && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erreur}</p>
        )}

        {/* — CE QUI SERA TOUCHÉ — */}
        <div className="mb-4 rounded-xl border border-border/70 bg-muted/30 px-3 py-1">
          {ligne('Nom d’hôte', <code>{target.host}</code>)}
          {ligne('Environnement', target.environment)}
          {ligne('Serveur', `${target.sshUser}@${target.sshHost ?? '—'}`)}
          {ligne('Port applicatif', String(target.backendPort))}
          {ligne('Service PM2', <code>{inv?.pm2Name ?? '—'}</code>)}
          {ligne('Dossier', <code>{inv?.siteRoot ?? '—'}</code>)}
          {ligne('Taille', inv ? (inv.size ?? '—') : <span className="text-muted-foreground">à lire sur le serveur</span>)}
          {ligne('Fichiers', inv ? String(inv.files) : <span className="text-muted-foreground">à lire</span>)}
          {ligne('Médias (shared/uploads)', inv ? String(inv.uploads) : <span className="text-muted-foreground">à lire</span>)}
          {ligne('Données persistantes', inv ? String(inv.persistentFiles) : <span className="text-muted-foreground">à lire</span>)}
          {ligne('Liens sortants', inv
            ? (inv.outboundSymlinks.length > 0 ? `${inv.outboundSymlinks.length} — bloquant` : 'aucun')
            : <span className="text-muted-foreground">à lire</span>)}
        </div>

        <p className="mb-4 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {mode === 'deprovision' ? (
            <span>
              <strong>Cette opération est irréversible.</strong> Le service sera arrêté et
              supprimé, le port {target.backendPort} libéré, le routage retiré, les fichiers
              effacés. Le domaine <code>{target.host}</code> répondra ensuite <code>410 Gone</code>.
              Les médias publiés ici redeviendront locaux. L’historique, lui, est conservé.
            </span>
          ) : (
            <span>
              <strong>Cette opération est irréversible.</strong> La fiche sortira des
              destinations actives
              {target.quarantineEnabled
                ? ` et la quarantaine 410 sera levée : ${target.host} ne sera plus servi du tout`
                : ''}. Son historique et son audit restent consultables.
            </span>
          )}
        </p>

        {bloqueParSymlinks && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            <strong>Retrait bloqué :</strong> {inv?.outboundSymlinks.length} lien(s)
            symbolique(s) pointent hors de la destination (<code>{inv?.outboundSymlinks.join(', ')}</code>).
            Les suivre effacerait des fichiers d’un autre projet. Corrigez-les d’abord.
          </p>
        )}

        {mode === 'deprovision' && (inv?.persistentFiles ?? 0) > 0 && (
          <label className="mb-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={dropData}
              onChange={(e) => setDropData(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Je confirme la perte de <strong>{inv?.persistentFiles} fichier(s)</strong> de
              données persistantes (médias et documents). Sans cette confirmation, le retrait
              est refusé.
            </span>
          </label>
        )}

        {/* — SESSION SERVEUR — */}
        {sessionRequise && !sessionId && (
          <div className="mb-3 rounded-lg border border-border bg-muted/40 p-3">
            <p className="mb-2 flex gap-2 text-xs">
              <ServerCog className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Lire l’état réel du serveur et exécuter le retrait exigent une connexion.
                Le mot de passe n’est jamais enregistré.
              </span>
            </p>

            {onConnect ? (
              <form
                className="grid gap-2 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ouvrirSession();
                }}
              >
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Serveur</span>
                  <input
                    type="text"
                    value={sshHost}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setSshHost(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Utilisateur</span>
                  <input
                    type="text"
                    value={sshUser}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setSshUser(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[11px] font-medium text-muted-foreground">Mot de passe</span>
                  <input
                    type="password"
                    value={sshPass}
                    autoComplete="current-password"
                    onChange={(e) => setSshPass(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </label>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={connecting || busy || !sessionSaisie}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {connecting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Se connecter au serveur
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        )}

        {sessionRequise && sessionId && !inspection && etapes.length === 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void inspecter()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lire l’état réel du serveur
            </button>
            <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-xs">
              Annuler
            </button>
          </div>
        )}

        {/* — CONFIRMATION PAR LE NOM D'HÔTE — */}
        {((inspection || !sessionRequise) && etapes.length === 0) && (
          <>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium">
                Saisissez <code>{target.host}</code> pour confirmer
              </span>
              <input
                type="text"
                value={hostname}
                autoComplete="off"
                spellCheck={false}
                placeholder={target.host}
                onChange={(e) => setHostname(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || Boolean(runId) || reconnexion || !hostOk || bloqueParSymlinks
                  || perteNonConfirmee || (sessionRequise && !sessionId)}
                onClick={() => void (mode === 'deprovision' ? executerRetrait() : executerSuppression())}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white',
                  'bg-red-600 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {mode === 'deprovision' ? 'Retirer le déploiement' : 'Supprimer la destination'}
              </button>
              <button type="button" onClick={onCancel} className="rounded-lg border border-border px-3 py-2 text-xs">
                Annuler
              </button>
            </div>
          </>
        )}

        {/* — AVANCEMENT, ÉTAPE PAR ÉTAPE — */}
        {etapes.length > 0 && (
          <ol className="mt-2 space-y-1.5">
            {etapes.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    e.status === 'ok' && 'bg-emerald-100 text-emerald-700',
                    e.status === 'error' && 'bg-red-100 text-red-700',
                    e.status === 'running' && 'animate-pulse bg-blue-100 text-blue-700',
                    (e.status === 'pending' || e.status === 'skipped') && 'bg-muted text-muted-foreground',
                  )}
                >
                  {e.status === 'ok' ? '✓' : e.status === 'error' ? '!' : e.status === 'running' ? '●' : '○'}
                </span>
                <span className={cn('min-w-0 flex-1',
                  (e.status === 'pending' || e.status === 'skipped') && 'text-muted-foreground',
                  e.status === 'error' && 'text-red-700')}>
                  {e.label}
                  {e.detail && <span className="ml-1 text-muted-foreground">— {e.detail}</span>}
                  {/* Le CODE MÉTIER est affiché : « échec » sans code n'aide
                      personne à comprendre ce qu'il faut corriger. */}
                  {e.code && <span className="ml-1 font-mono text-red-600">({e.code})</span>}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* — LE RAPPORT DU RUN — produit par le serveur, pas par cet écran — */}
        {rapport && (
          <div className="mt-4 rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold">
                {rapport.outcome.ok ? 'Retrait réussi' : 'Retrait en échec'}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground">
                {Math.round(rapport.identification.durationMs / 1000)} s
              </span>
            </div>
            {ligne('Destination', <code>{rapport.identification.host}</code>)}
            {ligne('Environnement', rapport.identification.environment)}
            {ligne('Étapes', `${rapport.steps.filter((s) => s.status === 'ok').length}/${rapport.steps.length} réussies`)}
            {ligne('Service retiré', <code>{String(rapport.removed.service ?? '—')}</code>)}
            {ligne('Port libéré', String(rapport.removed.port ?? '—'))}
            {ligne('Fichiers supprimés', String(rapport.removed.files ?? 0))}
            {ligne('Données persistantes', rapport.removed.persistentDataRemoved ? 'supprimées' : 'conservées')}
            {ligne('Médias redevenus locaux', String(rapport.removed.unpublishedMedia ?? 0))}
            {ligne('Quarantaine 410', rapport.verifications.quarantine410 ? 'posée' : 'non posée')}
            {ligne('Port constaté libre', rapport.verifications.portFree ? 'oui' : 'non')}
            {rapport.outcome.error && ligne('Erreur',
              <span className="text-red-700">{rapport.outcome.error.code}</span>)}
            {ligne('Run', <code className="text-[10px]">{rapport.identification.runId}</code>)}

            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(JSON.stringify(rapport, null, 2));
                setCopie(true);
                window.setTimeout(() => setCopie(false), 2000);
              }}
              className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium"
            >
              {copie ? 'Rapport copié' : 'Copier le rapport'}
            </button>
          </div>
        )}

        {termine === 'ok' && mode === 'delete' && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left">
            <h3 className="text-sm font-semibold text-emerald-900">Destination supprimée</h3>
            <p className="mt-1 text-xs text-emerald-800">
              <code>{supprimee?.host ?? target.host}</code> a été supprimée définitivement.
              {target.quarantineEnabled ? ' La quarantaine 410 a été levée sur le serveur.' : ''}
            </p>
          </div>
        )}

        {termine && (
          <div className="mt-4 flex gap-2">
            {termine === 'error' && (
              <button
                type="button"
                onClick={() => { setEtapes([]); setTermine(null); }}
                className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white"
              >
                Reprendre le retrait
              </button>
            )}
            <button
              type="button"
              onClick={() => (onClosed ?? onCancel)()}
              className="rounded-lg border border-border px-3 py-2 text-xs"
            >
              Fermer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default RemovalDialog;
