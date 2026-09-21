import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import type { ActivationStep, LaunchFeeStatusView, SubscriptionReconciliation } from '@/types';

/**
 * Pages de retour paiement / signature.
 *
 * Ne déclarent JAMAIS un succès sur la foi d'un paramètre d'URL (`session_id`,
 * `status=success` ne valent pas paiement) : elles interrogent le backend
 * (source de vérité = webhook) et attendent avant de conclure.
 *
 * En cas de SUCCÈS, elles ne demandent plus de cliquer « Revenir à mon
 * contrat » : elles ramènent d'elles-mêmes sur /contrat en passant l'étape qui
 * vient d'aboutir, que « Mon contrat » transforme en animation de validation.
 * Le clic n'apprenait rien à personne — l'utilisateur revient de Stripe, il veut
 * voir la suite, pas accuser réception.
 *
 * Le bouton de repli reste présent sur les issues NON conclues (échec,
 * interruption, confirmation trop lente) : là, l'utilisateur doit garder la
 * main.
 */
const TITLES: Record<string, string> = {
  'retour-signature': 'Retour de signature',
  'retour-paiement': 'Retour de paiement',
  'retour-abonnement': "Retour d'abonnement",
};

const MAX_ATTEMPTS = 15; // ~30 s à 2 s d'intervalle
const TERMINAL: Record<string, boolean> = { PAID: true, FAILED: true, CANCELLED: true, EXPIRED: true, REFUNDED: true };

/** Délai avant le retour automatique — le temps de lire la confirmation. */
const HANDOFF_MS = 900;

/**
 * Ramène sur /contrat en annonçant l'étape franchie.
 *
 * `replace` : la page de retour ne doit pas rester dans l'historique — un
 * « Précédent » depuis le contrat rejouerait une vérification déjà faite.
 */
function useHandoff() {
  const navigate = useNavigate();
  return React.useCallback(
    (celebrate?: ActivationStep) => {
      navigate('/contrat', { replace: true, state: celebrate ? { celebrate } : undefined });
    },
    [navigate]
  );
}

function Checking({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </>
  );
}

/** Confirmation brève avant la bascule automatique vers le contrat. */
function Handoff({ label }: { label: string }) {
  const reduce = useReducedMotion();
  return (
    <>
      <motion.span
        className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100"
        initial={reduce ? false : { scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 20 }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </motion.span>
      <p className="text-sm font-medium text-emerald-700">{label}</p>
      <p className="text-xs text-muted-foreground">Retour à votre contrat…</p>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">{children}</CardContent>
    </Card>
  );
}

/** Retour de paiement des frais de lancement : suit le statut réel côté serveur. */
function LaunchFeeReturn({ cancelled }: { cancelled: boolean }) {
  const handoff = useHandoff();
  const [fee, setFee] = React.useState<LaunchFeeStatusView | null>(null);
  const [checking, setChecking] = React.useState(true);
  const attempts = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = React.useCallback(async () => {
    attempts.current += 1;
    let status: LaunchFeeStatusView | null = null;
    try {
      status = await api.getLaunchFeeStatus();
      setFee(status);
    } catch { /* on retente */ }
    const done = status ? TERMINAL[status.status] : false;
    if (!done && attempts.current < MAX_ATTEMPTS) {
      timer.current = setTimeout(poll, 2000);
    } else {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    attempts.current = 0;
    setChecking(true);
    poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);

  const paid = fee?.status === 'PAID';

  // Payé : on rend la main au parcours, qui jouera « Frais de lancement réglés ».
  React.useEffect(() => {
    if (!paid) return;
    const t = setTimeout(() => handoff('LAUNCH_FEE'), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [paid, handoff]);

  const processing = fee?.status === 'PROCESSING' || fee?.status === 'CHECKOUT_CREATED';
  const failed = fee?.status === 'FAILED' || fee?.status === 'EXPIRED';
  const recheck = () => { attempts.current = 0; setChecking(true); poll(); };

  if (paid) return <Shell><Handoff label="Frais de lancement payés. Merci !" /></Shell>;

  return (
    <Shell>
      {checking ? (
        <Checking>
          Vérification du paiement auprès de notre serveur…<br />
          La confirmation peut prendre quelques secondes (nous attendons la notification de la banque).
        </Checking>
      ) : processing ? (
        <>
          <Clock className="h-10 w-10 text-blue-500" />
          <p className="text-sm text-muted-foreground">
            Votre paiement est en cours de confirmation. Vous pouvez fermer cette page : le statut se mettra à jour
            automatiquement dès réception de la confirmation.
          </p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      ) : failed ? (
        <>
          <XCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-muted-foreground">Le paiement n'a pas abouti. Vous pourrez réessayer depuis votre contrat.</p>
        </>
      ) : cancelled ? (
        <>
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">Paiement interrompu. Aucun montant n'a été débité. Vous pouvez reprendre quand vous le souhaitez.</p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      ) : (
        <>
          <Clock className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Nous n'avons pas encore reçu la confirmation. Réessayez dans quelques instants.</p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      )}
      <Button onClick={() => handoff()}>Revenir à mon contrat</Button>
    </Shell>
  );
}

/** Retour d'abonnement : suit le statut réel de l'abonnement côté serveur. */
function SubscriptionReturn({ cancelled }: { cancelled: boolean }) {
  const handoff = useHandoff();
  const [sub, setSub] = React.useState<SubscriptionReconciliation | null>(null);
  const [checking, setChecking] = React.useState(true);
  const attempts = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * ON DEMANDE À STRIPE, on ne sonde plus notre propre base.
   *
   * ── LE DÉFAUT CORRIGÉ ───────────────────────────────────────────────────
   * Cette page relisait le statut LOCAL en boucle. Or ce statut ne bouge que
   * sur webhook : quand celui-ci se perdait, la page sondait un état qui ne
   * changerait jamais, puis rendait la main sur un contrat payé chez Stripe et
   * resté « à régler » ici. La réconciliation interroge Stripe et répare —
   * elle est idempotente, donc la répéter ne coûte rien et ne crée rien.
   */
  const poll = React.useCallback(async () => {
    attempts.current += 1;
    let etat: SubscriptionReconciliation | null = null;
    try { etat = await api.reconcileSubscription(); setSub(etat); } catch { /* retry */ }
    // On s'arrête sur une ISSUE, pas sur un statut : « payé » et « échoué »
    // sont des fins, « en cours de confirmation » n'en est pas une.
    const done = etat ? ['PAID', 'FAILED', 'ENDED', 'NOT_REQUIRED'].includes(etat.outcome) : false;
    if (!done && attempts.current < MAX_ATTEMPTS) timer.current = setTimeout(poll, 2000);
    else setChecking(false);
  }, []);

  React.useEffect(() => {
    attempts.current = 0; setChecking(true); poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [poll]);

  // « Terminé » ne se dit QUE sur un état local réconcilié comme payé.
  const active = sub?.outcome === 'PAID';

  React.useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => handoff('SUBSCRIPTION'), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [active, handoff]);

  const pending = sub?.outcome === 'PROCESSING' || sub?.outcome === 'AWAITING_PAYMENT';
  const failed = sub?.outcome === 'FAILED';
  const recheck = () => { attempts.current = 0; setChecking(true); poll(); };

  if (active) return <Shell><Handoff label="Abonnement actif." /></Shell>;

  return (
    <Shell>
      {checking ? (
        <Checking>
          Vérification de l'abonnement auprès de notre serveur…<br />La confirmation peut prendre quelques secondes.
        </Checking>
      ) : pending ? (
        <>
          <Clock className="h-10 w-10 text-blue-500" />
          <p className="text-sm text-muted-foreground">Souscription en cours de confirmation. Le statut se mettra à jour automatiquement.</p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      ) : failed ? (
        <>
          <XCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-muted-foreground">
            {sub?.lastError?.message
              || "Le paiement n'a pas abouti. Vous pouvez réessayer depuis votre contrat."}
          </p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      ) : cancelled ? (
        <>
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">Souscription interrompue. Aucun montant n'a été débité. Vous pouvez reprendre quand vous le souhaitez.</p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      ) : (
        <>
          <XCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-muted-foreground">La souscription n'a pas abouti. Vous pourrez réessayer depuis votre contrat.</p>
        </>
      )}
      <Button onClick={() => handoff()}>Revenir à mon contrat</Button>
    </Shell>
  );
}

/**
 * Retour de signature.
 *
 * On ne se fie pas au fait d'avoir été redirigé : la plateforme renvoie ici dès la fin
 * du flux, mais c'est son webhook qui fait foi. On attend donc que l'étape
 * dérivée quitte réellement `SIGNATURE`.
 */
function SignatureReturn({ outcome }: { outcome: 'success' | 'error' | 'decline' }) {
  const handoff = useHandoff();
  const [signed, setSigned] = React.useState(false);
  const [checking, setChecking] = React.useState(outcome === 'success');
  const attempts = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = React.useCallback(async () => {
    attempts.current += 1;
    let done = false;
    try {
      const res = await api.getMyActivation();
      // L'étape a quitté SIGNATURE : le webhook est passé, la signature compte.
      done = res.activation.step !== 'SIGNATURE';
      if (done) setSigned(true);
    } catch { /* on retente */ }
    if (!done && attempts.current < MAX_ATTEMPTS) timer.current = setTimeout(poll, 2000);
    else setChecking(false);
  }, []);

  React.useEffect(() => {
    if (outcome !== 'success') return;
    attempts.current = 0;
    setChecking(true);
    poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [outcome, poll]);

  React.useEffect(() => {
    if (!signed) return;
    const t = setTimeout(() => handoff('SIGNATURE'), HANDOFF_MS);
    return () => clearTimeout(t);
  }, [signed, handoff]);

  const recheck = () => { attempts.current = 0; setChecking(true); poll(); };

  if (signed) return <Shell><Handoff label="Contrat signé. Merci !" /></Shell>;

  return (
    <Shell>
      {outcome === 'decline' ? (
        <>
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">
            Signature refusée. Le contrat n'a pas été signé — contactez l'équipe technique si c'est une erreur.
          </p>
        </>
      ) : outcome === 'error' ? (
        <>
          <XCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-muted-foreground">La signature n'a pas abouti. Vous pourrez réessayer depuis votre contrat.</p>
        </>
      ) : checking ? (
        <Checking>
          Vérification de la signature auprès de notre serveur…<br />La confirmation peut prendre quelques secondes.
        </Checking>
      ) : (
        <>
          <Clock className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nous n'avons pas encore reçu la confirmation de signature. Elle arrivera d'elle-même ; réessayez dans quelques instants.
          </p>
          <Button variant="outline" onClick={recheck}>Vérifier à nouveau</Button>
        </>
      )}
      <Button onClick={() => handoff()}>Revenir à mon contrat</Button>
    </Shell>
  );
}

export default function ContractReturnPage() {
  const location = useLocation();
  const kind = location.pathname.split('/').pop() || '';
  const params = new URLSearchParams(location.search);
  const status = params.get('status');
  const cancelled = status === 'cancel';

  return (
    <div>
      <PageHeader title={TITLES[kind] || 'Retour'} />
      {kind === 'retour-paiement' ? (
        <LaunchFeeReturn cancelled={cancelled} />
      ) : kind === 'retour-abonnement' ? (
        <SubscriptionReturn cancelled={cancelled} />
      ) : (
        <SignatureReturn outcome={status === 'decline' ? 'decline' : status === 'error' ? 'error' : 'success'} />
      )}
    </div>
  );
}
