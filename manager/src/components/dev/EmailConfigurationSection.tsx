import * as React from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2, AlertTriangle, Mail, RefreshCw, ExternalLink, XCircle, Clock, Settings2, Info,
} from 'lucide-react';
import { Button, Badge, Spinner } from '@/components/ui/primitives';
import { useResource, useAction } from '@/hooks/useResource';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { ProviderMode, EmailConfiguration, EmailTestStatusView } from '@/types';
import { TONE_BADGE, TONE_BANNER, type EmailIcon } from '@/lib/emailStates';
import {
  selectActiveMode,
  lastTestView,
  shouldOfferBrevoLink,
  serviceView,
  trackingView,
  restoreOutcome,
  BREVO_DASHBOARD_URL,
  trackingStalled,
  testFailureView,
  isTestStatusTransitory,
  pollBudgetMs,
  nextPollDelayMs,
} from '@/lib/emailConfiguration';

/**
 * Configuration des emails — rendue DANS la carte Brevo de `/dev/integrations`.
 *
 * ─── CE QUE CET ÉCRAN NE MONTRE PAS ──────────────────────────────────────────
 *
 * Ni OTP, ni code de vérification, ni domaine, ni DKIM, ni DMARC, ni records
 * DNS, ni statut distant, ni bouton « Synchroniser ». Toute cette configuration
 * technique s'administre ailleurs. Un commerçant doit pouvoir comprendre et
 * tester sa configuration email en moins d'une minute, sans jamais rencontrer
 * ces mots. Le détail technique vit dans le DIAGNOSTIC, qui est un outil de
 * développeur — pas ici.
 *
 * ─── UN SEUL ÉTAT AFFICHÉ ────────────────────────────────────────────────────
 *
 * Le badge et le bandeau dérivent tous deux de `cardState()`. Ils ne peuvent
 * donc pas se contredire — ce sont deux vues de la même phrase, l'une brève,
 * l'autre développée.
 *
 * INVARIANT : cet écran ne déduit AUCUN statut. Chaque action renvoie la
 * configuration canonique complète, qui remplace l'état local. Aucun
 * `setState('FUNCTIONAL')` optimiste — le backend est l'autorité.
 */

/** Icône métier → composant. La tonalité choisit la couleur, l'état l'icône. */
const ICONS: Record<EmailIcon, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  waiting: Clock,
  warning: AlertTriangle,
  settings: Settings2,
  neutral: Info,
};

export function EmailConfigurationSection() {
  const { isDev } = useAuth();

  /**
   * ══ LE MONDE VIENT DE LA CONFIGURATION ELLE-MÊME (R11) ═══════════════════
   *
   * Il arrivait par une prop, depuis la carte Brevo de « Intégrations API ».
   * Cette page a disparu : ses quatre fournisseurs sont administrés par la
   * plateforme, et il ne restait plus rien à y saisir.
   *
   * ══ ET IL S'APPELLE `environment` (L12.1) ════════════════════════════════
   *
   * Il était lu sous le nom `activeMode`. Le serveur l'avait renommé
   * `environment` sans que ce composant ni son type ne suivent : la lecture
   * valait `undefined`, la sélection du mode rendait `null`, et la garde
   * ci-dessous affichait « La configuration des emails n'a pas pu être
   * chargée » — en permanence, sur une requête qui répondait pourtant 200.
   *
   * L'extraction elle-même a disparu : `selectActiveMode` reçoit désormais la
   * configuration entière. Un champ qu'un appelant doit ressortir à la main est
   * un champ qu'un appelant peut ressortir sous le mauvais nom.
   */
  const { data: cfg, setData, loading, error, reload } = useResource<EmailConfiguration>(
    () => api.getEmailConfiguration(),
    []
  );
  const environment: ProviderMode | null = cfg?.environment ?? null;

  // Un état de requête par action : l'utilisateur doit savoir CE QUI tourne.
  const restore = useAction();


  // Zone « destinataire du test » — l'adresse de RÉCEPTION, distincte de
  // l'expéditeur. Ouverte au clic sur « Tester la configuration ».



  const mode = selectActiveMode(cfg);

  /**
   * SUIVI CIBLÉ de la livraison du test.
   *
   * ─── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────
   *
   * Ce suivi rechargeait TOUTE la configuration toutes les trois secondes, sans
   * relâche. Trois défauts en un : l'écran entier se réévaluait (formulaire
   * compris) pour un seul champ ; la cadence fixe donnait l'impression d'une
   * page qui travaille en permanence ; et rien ne s'arrêtait quand l'onglet
   * passait en arrière-plan.
   *
   * Désormais : un endpoint dédié à l'issue du test, une cadence dégressive
   * (3 s, 5 s, puis 10 s), un arrêt NET dès que le serveur dit `terminal`, et
   * une suspension quand l'onglet est masqué. Le résultat ne remplace que la
   * carte « Dernier test » — jamais la configuration.
   */
  const [testStatus, setTestStatus] = React.useState<EmailTestStatusView | null>(null);
  const [pollDone, setPollDone] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  // L'issue affichée vient du suivi ciblé s'il en a produit une, sinon de la
  // configuration chargée. Une seule valeur en sortie : pas deux sources.
  const effectiveTest = React.useMemo(
    () => (testStatus && mode ? { ...mode, test: { ...mode.test, ...testStatus } } : mode),
    [mode, testStatus]
  );
  const transitory = isTestStatusTransitory(effectiveTest?.test.status);

  React.useEffect(() => {
    if (!transitory) { setPollDone(false); return; }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    let attempt = 0;

    const tick = async () => {
      if (cancelled) return;
      // Onglet masqué : on ne consomme rien. Le navigateur relance le cycle à
      // la réouverture (écouteur ci-dessous) — suivre une page que personne ne
      // regarde n'apporte rien.
      if (document.hidden) { schedule(); return; }

      const budget = pollBudgetMs(effectiveTest?.test.status);
      if (Date.now() - startedAt >= budget) { setPollDone(true); return; }

      try {
        const next = await api.getEmailTestStatus();
        if (cancelled) return;
        setTestStatus(next);
        setNow(Date.now());
        if (next.terminal) return; // issue connue : on s'arrête NET
      } catch {
        // Une lecture ratée n'interrompt pas le suivi : le prochain cycle
        // réessaiera, et l'écran garde la dernière issue connue.
      }
      schedule();
    };

    const schedule = () => {
      timer = setTimeout(tick, nextPollDelayMs(attempt));
      attempt += 1;
    };
    schedule();

    const onVisible = () => { if (!document.hidden && !cancelled) { clearTimeout(timer); attempt = 0; schedule(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [transitory, effectiveTest?.test.status]);

  /** Relecture manuelle — proposée UNIQUEMENT si le suivi s'est arrêté sans issue. */
  const refreshTestStatus = async () => {
    try {
      setTestStatus(await api.getEmailTestStatus());
      setNow(Date.now());
      setPollDone(false);
    } catch { /* toast inutile ici : l'écran garde la dernière issue connue */ }
  };

  const lastTest = lastTestView(effectiveTest);
  const offerBrevo = shouldOfferBrevoLink(effectiveTest, isDev);
  const stalled = trackingStalled(effectiveTest, null, now);
  const failure = testFailureView(effectiveTest);
  // L'ÉTAT UNIQUE du service : trois valeurs possibles, et rien d'autre.
  // `restore.pending` produit l'état « Vérification en cours… » — l'utilisateur
  // doit voir que le système travaille, pas un état figé qui n'est plus vrai.
  const service = serviceView(mode, restore.pending);
  const tracking = trackingView(mode);
  const ServiceIcon = ICONS[service.icon];

  /**
   * Répare le suivi, puis RELIT la configuration.
   *
   * La relecture est ce qui réactive le bouton de test tout seul : demander un
   * rafraîchissement manuel de la page après une réparation réussie serait faire
   * porter à l'utilisateur une limite de notre implémentation.
   */
  async function onRestore() {
    try {
      const next = await restore.run(() => api.restoreEmailService());
      // UNE réponse, TOUT l'écran : la carte, les boutons et le message
      // dérivent du même objet. Mettre à jour le toast sans l'écran (ou
      // l'inverse) est précisément ce qui produisait un succès vert au-dessus
      // d'un blocage orange.
      setData(next);
      const outcome = restoreOutcome(next.restore.ready, next.restore.code, environment === 'TEST');
      if (outcome.ok) toast.success(outcome.message);
      else toast.warning(outcome.message);
    } catch {
      // `run` a déjà affiché la cause ; on relit pour ne pas laisser un
      // affichage périmé derrière une action qui a échoué.
      await reload();
    }
  }

  /**
   * UNIQUE chemin vers l'envoi de test, ENTIÈREMENT MANUEL : aucun déclenchement
   * automatique — l'utilisateur maîtrise à qui et quand le mail de test part.
   *
   * Un refus répond 200 avec `status = FAILED` : c'est un résultat, pas une
   * panne. On lit le statut de la RÉPONSE pour le toast — jamais deux toasts
   * contradictoires.
   */





  if (loading) {
    return (
      <div
        className="mt-4 flex items-center gap-2 rounded-md border border-border p-4 text-sm text-muted-foreground"
        role="status"
      >
        <Spinner className="h-4 w-4" aria-hidden="true" /> Chargement de la configuration des emails…
      </div>
    );
  }

  if (error || !cfg || !mode) {
    return (
      <div className="mt-4 rounded-md border border-border p-4" role="status">
        <p className="text-sm text-muted-foreground">
          {error || "La configuration des emails n'a pas pu être chargée."}
        </p>
        <Button size="sm" variant="outline" className="mt-2" onClick={reload}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Réessayer
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4" aria-hidden="true" /> E-mails
        </h4>
        <Badge className={TONE_BADGE.neutral}>
          Mode {environment === 'PROD' ? 'production' : 'test'}
        </Badge>
      </div>

      {/*
        L'ÉTAT DU SERVICE — la seule réponse à « puis-je envoyer, maintenant ? ».

        Il n'y en a qu'une, et elle est en haut. L'écran affichait auparavant
        quatre vérités indépendantes (webhook enregistré / déjà utilisé /
        joignable / envois possibles), si bien qu'un badge vert « Actif »
        pouvait surplomber un bandeau orange « Suivi indisponible » — les deux
        exacts dans leur registre, contradictoires à la lecture.
      */}
      <div
        className={`flex items-start gap-3 rounded-md border p-3 ${TONE_BANNER[service.tone]}`}
        role="status"
      >
        <ServiceIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold">{service.title}</p>
          <p className="text-xs opacity-90">{service.subtitle}</p>
          {/* CANAL D'ENVOI désactivé : la CAUSE exacte et sa date — jamais un
              message générique qui laisse deviner. */}
          {service.state === 'ACTION_NEEDED' && (
            <>
              {(mode?.operational?.deliveryBlockers ?? mode?.operational?.blockers ?? []).length > 0 && (
                <ul className="list-inside list-disc text-xs opacity-90">
                  {(mode?.operational?.deliveryBlockers ?? mode?.operational?.blockers ?? []).map((b) => (
                    <li key={b.code}>{b.message}</li>
                  ))}
                </ul>
              )}
              {mode?.operational?.statusSince && (
                <p className="text-[11px] opacity-70">
                  État constaté depuis le {new Date(mode.operational.statusSince).toLocaleString()}.
                </p>
              )}
              {isDev ? (
                <Button size="sm" variant="outline" onClick={onRestore} loading={restore.pending}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Rétablir le service
                </Button>
              ) : (
                <p className="text-xs font-medium">
                  Contactez votre prestataire technique pour rétablir l’envoi des e-mails.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/*
        SUIVI DE LIVRAISON — panneau SÉPARÉ du canal d'envoi (LOT états).
        Un webhook bien installé sans événement reste VERT (« Aucun événement
        reçu pour le moment ») ; absent/désynchronisé → « Configurer le suivi »,
        sans jamais prétendre que les e-mails sont désactivés.
      */}
      {tracking && (
        <div
          className={`flex items-start gap-3 rounded-md border p-3 ${TONE_BANNER[tracking.tone]}`}
          role="status"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-semibold">{tracking.title}</p>
            <p className="text-xs opacity-90">{tracking.subtitle}</p>
            {/* URLs RÉSOLUES automatiquement — lecture seule : personne ne
                saisit une URL de webhook. Le domaine change ? Elles suivent. */}
            {tracking.publicBackendUrl && (
              <p className="break-all text-[11px] opacity-70">
                Backend public : <span className="font-medium">{tracking.publicBackendUrl}</span>
                {tracking.publicUrlSourceLabel && <> — {tracking.publicUrlSourceLabel}</>}
              </p>
            )}
            {tracking.expectedWebhookUrl && (
              <p className="break-all text-[11px] opacity-70">
                Webhook calculé : <span className="font-medium">{tracking.expectedWebhookUrl}</span>
              </p>
            )}
            <p className="text-[11px] opacity-70">{tracking.activity}</p>
            {tracking.needsAction &&
              (isDev ? (
                <Button size="sm" variant="outline" onClick={onRestore} loading={restore.pending}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {tracking.title}
                </Button>
              ) : (
                <p className="text-xs font-medium">
                  Contactez votre prestataire technique pour configurer le suivi de livraison.
                </p>
              ))}
          </div>
        </div>
      )}

      {/*
        -- LE FORMULAIRE D’EXPÉDITEUR ET L’ENVOI DE TEST ONT DISPARU (R10.5) --

        Le premier écrivait le From de CE projet ; le second envoyait un e-mail
        en appelant Brevo directement, avec une clé locale — sans passerelle,
        sans coffre du Panel et sans registre d’opérations.

        L’expéditeur du parc est unique et administré dans le Panel, et c’est là
        que le test d’expédition vit désormais : il y emprunte la chaîne réelle,
        jusqu’au webhook de livraison.

        On ne laisse PAS un champ grisé « pour information » : une valeur morte
        encore visible se lit comme un réglage, et la première question devient
        « pourquoi ma saisie ne part-elle pas ? ».
      */}
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
        <p className="font-medium">Expéditeur administré par la plateforme</p>
        <p className="opacity-80">
          L’adresse et le nom d’expédition sont communs à tous les sites et se
          configurent dans le Panel. Ce site n’en définit aucun. L’envoi de test
          s’effectue également depuis le Panel, afin d’éprouver la chaîne complète
          — expéditeur, modèle, fournisseur et accusé de livraison.
        </p>
      </div>

      {/*
        DERNIER TEST — cinq informations, pas une de plus : état, date, adresse
        testée, message, action. Tout le détail technique (identifiants, codes,
        horodatages fournisseur) appartient au diagnostic. Le mélanger ici
        obligeait le lecteur à trier lui-même l'utile de l'accessoire.

        `role="status"` : le polling fait changer ce bloc tout seul, deux à trois
        secondes après l'envoi. Sans annonce, ce changement — qui est justement
        l'information attendue — passait inaperçu au lecteur d'écran.
      */}
      {lastTest && (
        <div className="rounded-md border border-border p-3 text-xs" role="status">
          <p className="mb-1.5 font-medium text-muted-foreground">Dernier test</p>

          <p className={`flex flex-wrap items-center gap-1.5 font-medium ${
            lastTest.outcome === 'success'
              ? 'text-emerald-800'
              : lastTest.outcome === 'pending'
                ? 'text-sky-800'
                : lastTest.outcome === 'deferred'
                  ? 'text-amber-900'
                  : 'text-red-800'
          }`}>
            {lastTest.outcome === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : lastTest.outcome === 'pending' ? (
              <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : lastTest.outcome === 'deferred' ? (
              // Un retard n'est pas un échec : ambre, jamais rouge.
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {lastTest.label}
            <span className="font-normal text-muted-foreground">· {formatDateTime(lastTest.at)}</span>
          </p>

          {mode.test.recipientMasked && (
            <p className="mt-1 text-muted-foreground">
              Envoyé à <span className="break-all font-medium">{mode.test.recipientMasked}</span>
            </p>
          )}

          {/* Le MESSAGE : la cause en cas d'échec, l'attente sinon. */}
          {failure ? (
            <div className="mt-1.5 space-y-1">
              <p className="text-red-800">{failure.message}</p>
              {failure.senderIssue && (
                <p className="text-muted-foreground">
                  Adresse refusée : <span className="break-all font-medium">{failure.testedSender}</span>
                </p>
              )}
              <p className="font-medium">{failure.action}</p>
            </div>
          ) : lastTest.outcome === 'pending' && stalled ? (
            <p className="mt-1.5 text-amber-900">{stalled.message}</p>
          ) : lastTest.detail ? (
            <p className="mt-1.5 text-muted-foreground">{lastTest.detail}</p>
          ) : null}

          {/*
            Le suivi automatique s'est arrêté sans issue définitive. On le DIT,
            sobrement, et on offre une relecture — plutôt que de laisser tourner
            un indicateur perpétuel qui promet une réponse qui ne vient plus.
            Aucune animation : l'attente n'est pas un chargement.
          */}
          {pollDone && (lastTest.outcome === 'pending' || lastTest.outcome === 'deferred') && (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-muted-foreground">
                Aucun résultat définitif n’a encore été reçu.
              </p>
              <Button size="sm" variant="outline" onClick={refreshTestStatus}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Actualiser le statut
              </Button>
            </div>
          )}

          {/* L'ACTION éventuelle — réservée au DEV, dont c'est le compte. */}
          {offerBrevo && (
            <a
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 font-medium hover:bg-muted"
              href={BREVO_DASHBOARD_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Autoriser l’adresse chez le fournisseur
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          )}
        </div>
      )}

      {/*
        ─── SUPPRIMÉ : le second bandeau d'état ───────────────────────────────
        Il redisait, en bas de carte, ce que l'en-tête affirme désormais en
        haut — et pouvait le contredire, puisqu'il dérivait d'un autre calcul.
        Une seule surface d'état par écran : celle qu'on lit en premier.
      */}

      {/* Note discrète : le commerçant n'a rien à faire ici, il doit seulement
          savoir que ce n'est pas un oubli. MASQUÉE après un refus d'expéditeur —
          affirmer que « tout est géré à l'installation » juste après un refus
          serait faux, et détournerait de la seule action utile. */}
      {!failure?.senderIssue && (
        <p className="text-xs text-muted-foreground">
          La configuration technique de la messagerie est gérée lors de l’installation du site.
        </p>
      )}
    </div>
  );
}

export default EmailConfigurationSection;
