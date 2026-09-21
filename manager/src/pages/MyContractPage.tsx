import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { FileCheck2, PenLine, CreditCard, RefreshCw, CheckCircle2, Download, Clock, Mail } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, CardHeader, CardTitle, Badge, Spinner, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { ConfirmDialog } from '@/components/ui/dialog';
import { LaunchFeeStatusBadge, SubscriptionStatusBadge } from '@/components/contracts/status';
import { ContractTimeline } from '@/components/contracts/ContractTimeline';
import { ContractProgressTracker } from '@/components/contracts/ContractProgressTracker';
import { JourneyStage, StepCelebration, stageMotion } from '@/components/contracts/journey/JourneyStage';
import { PriceRecap } from '@/components/contracts/journey/PriceRecap';
import { SubscriptionCostCard } from '@/components/contracts/SubscriptionCostCard';
import {
  SignatureArt, LaunchFeeArt, SubscriptionArt, ActivationArt, WaitingArt, LiveArt, PreparationArt,
} from '@/components/contracts/journey/art';
import { useResource, useAction } from '@/hooks/useResource';
import { useJourneyCelebration, usePollWhile } from '@/hooks/useContractJourney';
import { journeyOrderFor, stepPosition, shouldPoll } from '@/lib/journey';
import { getContractPresentationState } from '@/lib/contractPresentation';
import { recurrenceOf, describeRecurrence, monthsPerCycle } from '@/lib/subscriptionPricing';
import { api, downloadContractDocument, type ContractDocumentKind } from '@/lib/api';
import { formatCents, formatDate } from '@/lib/utils';
import type { ContractPresentation } from '@/lib/contractPresentation';
import type { ActivationStep, Contract, MyCompanyView, PaymentMethodView, TimelineEvent } from '@/types';

/** Couleur du badge d'état — la même échelle que partout ailleurs. */
const BADGE_TONE: Record<ContractPresentation['tone'], string> = {
  neutral: 'bg-slate-100 text-slate-600',
  info: 'bg-blue-100 text-blue-700',
  action: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-orange-100 text-orange-700',
  danger: 'bg-red-100 text-red-700',
};

/** Libellé de l'accusé « étape franchie ». */
const DONE_LABEL: Record<ActivationStep, string> = {
  SIGNATURE: 'Contrat signé',
  LAUNCH_FEE: 'Frais de lancement réglés',
  SUBSCRIPTION: 'Abonnement activé',
  ACTIVATION: 'Site activé',
  DONE: 'Parcours terminé',
};

/**
 * MOYEN DE PAIEMENT — nous n'en savons presque rien, et c'est voulu.
 *
 * ── POURQUOI LE PORTAIL CLIENT STRIPE ─────────────────────────────────────
 * Deux parcours permettent de changer une carte : le portail hébergé par
 * Stripe, ou un SetupIntent avec Stripe Elements intégré ici. Le second
 * demanderait d'écrire et de maintenir la saisie, l'authentification forte, la
 * gestion des cartes expirées, des moyens locaux et des traductions — pour le
 * même résultat, avec une surface à sécuriser bien plus large. Le portail fait
 * tout cela, et aucune donnée bancaire n'approche notre backend.
 *
 * Conséquence assumée : nous ne pouvons pas afficher « Visa •••• 4242 », car
 * nous ne le stockons pas. On dit ce qu'on sait — qu'un moyen de paiement est
 * enregistré, et quand tombe la prochaine échéance. Inventer le reste serait
 * pire que de se taire.
 *
 * Le retour du navigateur ne prouve rien : la mise à jour est constatée par les
 * webhooks Stripe, déjà traités. L'écran ne s'auto-félicite de rien.
 */
function PaymentCard() {
  const { data, loading } = useResource(() => api.getPaymentMethod());
  const { pending, run } = useAction();
  const vue = data as PaymentMethodView | null;

  if (loading) return <Card><CardContent className="py-6"><Spinner className="h-5 w-5" /></CardContent></Card>;
  if (!vue?.hasCustomer) return null; // rien à modifier tant qu'aucun règlement n'a eu lieu

  const ouvrir = async () => {
    try {
      const { url } = await run(() => api.openBillingPortal());
      // Redirection PLEINE PAGE : le portail refuse d'être affiché en cadre.
      if (url) window.location.href = url;
    } catch { /* le toast dit ce qui bloque */ }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Paiement</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2 text-sm">
          <Row label="Moyen de paiement" value="Enregistré chez Stripe" />
          {vue.currentPeriodEnd && (
            <Row
              label={vue.cancelAtPeriodEnd ? 'Fin de période' : 'Prochaine échéance'}
              value={formatDate(vue.currentPeriodEnd)}
            />
          )}
        </div>
        {/*
          CE QUE LE PORTAIL PERMET, DIT EXACTEMENT.

          Le bouton annonçait « Modifier le moyen de paiement » alors que le
          portail ouvre aussi la résiliation — un client y arrivait sans le
          savoir. À l'inverse, il n'y modifiera JAMAIS son adresse ni sa raison
          sociale : la configuration du portail le lui interdit désormais, et
          ces informations appartiennent au prestataire. Promettre l'un ou taire
          l'autre enverrait le client se heurter à une porte, dans les deux sens.
        */}
        <p className="text-xs text-muted-foreground">
          Paiement et résiliation se gèrent sur la page sécurisée de Stripe. Vos
          coordonnées bancaires ne transitent jamais par nos serveurs. Vos
          informations légales, elles, n’y sont pas modifiables — elles sont
          tenues par votre prestataire.
        </p>
        {vue.canUpdate && (
          <Button variant="outline" onClick={ouvrir} loading={pending}>
            <CreditCard className="h-4 w-4" /> Gérer le paiement et l’abonnement
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TimelineCard({ events, loading }: { events: TimelineEvent[]; loading: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>Suivi du contrat</CardTitle></CardHeader>
      <CardContent>{loading ? <Spinner className="h-5 w-5" /> : <ContractTimeline events={events} />}</CardContent>
    </Card>
  );
}

export default function MyContractPage() {
  /**
   * `live: 'contract'` — le contrat change SANS que personne n'ait cliqué ici.
   *
   * Un paiement confirmé, une signature achevée, une échéance atteinte, une
   * correction administrative faite depuis un autre poste : aucun de ces faits
   * ne naît dans cet onglet. La page chargeait une fois au montage et affichait
   * donc « actif » un contrat terminé, jusqu'au rechargement.
   *
   * Le flux ne transporte que le NOM de la ressource : c'est cette page qui
   * redemande la donnée à l'API, laquelle reste la seule autorité.
   */
  const { data, loading, refresh } = useResource(
    () => api.getMyContract(), [], { live: 'contract' },
  );
  /**
   * ── L’ENTREPRISE CLIENTE — ce qui décide si les boutons existent ────────
   *
   * ══ POURQUOI CETTE PAGE LA LIT ════════════════════════════════════════
   *
   * Depuis le chantier « facturation légale », aucun paiement et aucune
   * signature ne s’ouvrent pour un projet sans identité juridique de client.
   * Le refus est BACKEND et autoritatif — mais un bouton qui mène à un refus
   * est un bouton qui ment.
   *
   * L’écran lit donc le même verdict que la garde, et remplace le bouton par
   * l’explication quand il ne peut pas aboutir.
   *
   * `live: 'client-company'` : quand L.Y Solution complète la fiche, cette
   * page passe de « paiement indisponible » à « payer » SANS rechargement.
   * C’est exactement le moment où le client attend quelque chose.
   */
  const client = useResource(() => api.getMyCompany(), [], { live: 'client-company' });
  const timeline = useResource(() => api.getMyTimeline());
  // ENV APPLICATIF courant : en TEST la résiliation est IMMÉDIATE (recette) —
  // le dialogue doit l'annoncer sans ambiguïté. PROD : fin de période, inchangé.
  const meta = useResource(() => api.meta());
  const isTestEnv = meta.data?.environment === 'TEST';
  const { pending, run } = useAction();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const contract = data as Contract | null;
  const location = useLocation();
  const navigate = useNavigate();

  // Relais depuis la page de retour paiement/signature : elle SAIT quelle étape
  // vient d'aboutir, alors que l'application a été rechargée entre-temps (on a
  // quitté le site). Sans lui, le retour de paiement afficherait l'étape
  // suivante sans jamais confirmer que le paiement est passé.
  const seed = (location.state as { celebrate?: ActivationStep } | null)?.celebrate ?? null;
  const celebrating = useJourneyCelebration(contract?.step, seed);

  // Consommé une fois, l'accusé est retiré de l'historique : sans ça, l'entrée
  // /contrat garde `celebrate` et tout remontage rejouerait « ✓ étape franchie »
  // pour une étape déjà actée.
  React.useEffect(() => {
    if (seed) navigate(location.pathname, { replace: true });
  }, [seed, navigate, location.pathname]);

  // Le contrat avance sur notification externe (webhook paiement/signature) : sans
  // sondage, l'écran resterait sur l'étape précédente jusqu'à un rechargement
  // manuel. `shouldPoll` (testé) décide quand s'arrêter — se fier à la seule
  // étape ferait sonder à vie sur un contrat résilié.
  //
  // `refresh` et NON `reload` : ce dernier rallume `loading`, donc l'écran de
  // chargement — la page clignotait toutes les 5 s et perdait sa position.
  // Ici, rien ne doit bouger tant que l'étape ne change pas.
  usePollWhile(shouldPoll(contract?.status, contract?.step), () => { refresh(); timeline.refresh(); });

  // Le téléchargement se DÉCLENCHE, il ne s'affiche pas : voir
  // `downloadAuthenticatedFile`. Le toast dit ce qui bloque, le cas échéant.
  const downloadDoc = async (kind: ContractDocumentKind) => {
    if (!contract) return;
    await run(() => downloadContractDocument(contract._id, kind));
  };
  const downloadSigned = () => downloadDoc('signed');
  /**
   * LA PREUVE D'AUDIT — qui a signé, quand, depuis où.
   *
   * Elle n'est proposée qu'aux étapes TERMINALES : c'est là que le dossier est
   * figé, et c'est le seul moment où quelqu'un a besoin de la produire. La
   * mettre partout ajouterait un bouton à chaque écran pour un geste rare.
   */
  const downloadCertificate = () => downloadDoc('certificate');

  // Après une action, l'écran a déjà tout ce qu'il faut : le recharger derrière
  // un `BrandLoader` ferait clignoter la page entre le clic et l'animation de
  // l'étape franchie. Le retour visuel du clic, c'est le `pending` du bouton.
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    try { await run(fn, success ? { success } : undefined); refresh(); timeline.refresh(); } catch { /* toast */ }
  };
  const sign = async () => {
    try {
      const { signatureLink } = await run(() => api.startAdminSignature());
      if (signatureLink) window.location.href = signatureLink;
    } catch { /* */ }
  };
  const payLaunchFee = async () => {
    try {
      const { url } = await run(() => api.createLaunchCheckout());
      if (url) window.location.href = url;
      else refresh(); // déjà payé / session réutilisée -> on rafraîchit l'état réel
    } catch { /* toast */ }
  };
  const subscribe = async () => {
    try {
      const { url, alreadyPaid } = await run(() => api.createSubscriptionCheckout());
      // Session déjà complète : le serveur a réconcilié, il n'y a rien à
      // repayer. On rafraîchit plutôt que de renvoyer l'utilisateur chez
      // Stripe, qui lui afficherait « Vous avez terminé » sur un parcours que
      // l'écran croyait encore à faire.
      if (alreadyPaid) { refresh(); timeline.refresh(); return; }
      if (url) window.location.href = url;
      else refresh();
    } catch { /* toast */ }
  };

  /**
   * VÉRIFIER LE PAIEMENT — demande à Stripe, répare, et le dit.
   *
   * Sans cela, un webhook perdu laissait l'écran proposer indéfiniment de
   * régler un abonnement déjà payé. L'appel est idempotent : il ne crée jamais
   * de souscription.
   */
  const verifierPaiement = async () => {
    try {
      /**
       * PAS DE `success` GLOBAL — la phrase dépend de ce qui s'est passé.
       *
       * « État du paiement vérifié » était affiché même quand l'autorité
       * n'avait PAS répondu : la réconciliation rendait alors le dernier état
       * connu, indiscernable d'un état fraîchement constaté. L'utilisateur
       * lisait « vérifié », puis voyait l'écran lui réclamer à nouveau un
       * paiement qu'il venait de faire — et en concluait qu'il avait échoué.
       *
       * On dit donc ce qu'on sait : constaté, ou pas joignable.
       */
      const etat = await run(() => api.reconcileSubscription());
      if (etat?.authorityReached === false) {
        toast.info(
          'Nous n’avons pas pu joindre le service de paiement à l’instant. '
          + 'Votre règlement n’est pas remis en cause : réessayez dans quelques minutes.',
        );
      } else if (etat?.outcome === 'PAID') {
        toast.success('Paiement confirmé — votre abonnement est actif.');
      } else {
        toast.success('État du paiement vérifié.');
      }
      refresh();
      timeline.refresh();
    } catch { /* toast */ }
  };

  if (loading) return <BrandLoader />;

  if (!contract) {
    return (
      <div>
        <PageHeader title="Mon contrat" />
        <EmptyState icon={FileCheck2} title="Aucun contrat disponible"
          description="Aucun contrat n'est disponible pour le moment. Veuillez contacter l'équipe technique." />
      </div>
    );
  }

  const sub = contract.stripe.subscription;
  /**
   * MÊME calcul que la vue DEV — `getContractPresentationState` — avec le
   * vocabulaire du client. Les deux écrans ne peuvent donc pas se contredire :
   * ils ne diffèrent que par les phrases, jamais par l'état.
   *
   * Il remplace trois booléens locaux qui recouvraient mal la machine : un
   * contrat mort gardait une étape dérivée « Abonnement » (elle ne rend `DONE`
   * que si le statut vaut ACTIVE), et l'écran proposait de souscrire sur un
   * contrat terminé.
   */
  const etat = getContractPresentationState(contract, 'ADMIN');
  const isPreparation = etat.phase === 'DRAFT' || etat.phase === 'DEV_SIGNATURE';
  const isActiveLike = etat.phase === 'LIVE' || etat.phase === 'ENDING';
  const isOver = etat.phase === 'ENDED' || etat.phase === 'CANCELLED' || etat.phase === 'FAILED';

  return (
    <div>
      {/* Le client lit ce qu'on attend de lui, pas un statut interne : sur un
          contrat qui attend un règlement, « Inactif » ne veut rien dire et
          contredit la scène juste en dessous. */}
      <PageHeader title={contract.name || 'Mon contrat'}
        description={`Référence ${contract.reference}`}
        action={<Badge className={BADGE_TONE[etat.tone]}>{etat.badge}</Badge>} />

      <Card>
        <CardContent className="py-6 sm:py-8">
          {/* Le guide reste en haut quelle que soit l'étape : c'est le repère
              fixe du parcours. Ce qui change, c'est la scène en dessous. */}
          <ContractProgressTracker contract={contract} className="mb-8" />

          <AnimatePresence mode="wait">
            {celebrating ? (
              <motion.div key={`done-${celebrating}`} {...stageMotion}>
                <StepCelebration label={DONE_LABEL[celebrating]} />
              </motion.div>
            ) : (
              <motion.div key={etat.phase} {...stageMotion}>
                {isPreparation ? (
                  <PreparationStage contract={contract} etat={etat} onDownload={() => downloadDoc('original')} />
                ) : isActiveLike ? (
                  <LiveStage contract={contract} onDownload={downloadSigned} onCancel={() => setConfirmCancel(true)} />
                ) : isOver ? (
                  <OverStage
                    contract={contract}
                    onDownload={downloadSigned}
                    onDownloadCertificate={downloadCertificate}
                  />
                ) : (
                  <JourneyScreen
                    contract={contract}
                    clientCompany={client.data ?? null}
                    pending={pending}
                    onSign={sign}
                    onPay={payLaunchFee}
                    onSubscribe={subscribe}
                    onVerify={verifierPaiement}
                    onActivate={() => act(() => api.activateMyContract(), 'Site activé')}
                    onDownloadSigned={downloadSigned}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* PAIEMENT — visible dès qu'un client Stripe existe, quel que soit
          l'avancement du contrat : changer de carte ne dépend pas de l'étape. */}
      <div className="mt-5">
        <PaymentCard />
      </div>

      <div className="mt-5">
        <TimelineCard events={timeline.data || []} loading={timeline.loading} />
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          act(() => api.cancelMyContract(), isTestEnv ? 'Contrat résilié immédiatement (TEST)' : 'Résiliation enregistrée');
        }}
        title={isTestEnv ? 'Résiliation immédiate (TEST)' : 'Résilier le contrat'}
        description={
          isTestEnv
            ? "Environnement TEST : le contrat sera terminé IMMÉDIATEMENT, l'abonnement Stripe annulé immédiatement et le site suspendu immédiatement. En production, la résiliation prend effet en fin de période. Confirmer ?"
            : `Le site restera actif jusqu'à la fin de la période en cours${sub.currentPeriodEnd ? ` (${formatDate(sub.currentPeriodEnd)})` : ''}. À cette date, le site sera automatiquement suspendu. Confirmer la résiliation ?`
        }
        confirmLabel={isTestEnv ? 'Résilier maintenant (TEST)' : 'Résilier'}
        destructive
        loading={pending}
      />
    </div>
  );
}

/* ------------------------------ Préparation -------------------------------- */
/** Rien à faire pour le client : l'équipe technique prépare encore le contrat. */
function PreparationStage({
  contract, etat, onDownload,
}: { contract: Contract; etat: ContractPresentation; onDownload: () => void }) {
  return (
    <JourneyStage
      art={<PreparationArt />}
      eyebrow="Avant de commencer"
      title={etat.title}
      description={etat.description}
      note={etat.signatureNote ? <span>{etat.signatureNote}</span> : undefined}
      cta={
        contract.document.hasOriginal ? (
          <Button variant="outline" onClick={onDownload}>
            <Download className="h-4 w-4" /> Consulter le PDF du contrat
          </Button>
        ) : undefined
      }
    >
      <PriceSummary contract={contract} fallback="Aucun montant configuré pour le moment." />
    </JourneyStage>
  );
}

/* -------------------------------- Site actif -------------------------------- */
function LiveStage({
  contract, onDownload, onCancel,
}: { contract: Contract; onDownload: () => void; onCancel: () => void }) {
  const sub = contract.stripe.subscription;
  return (
    <JourneyStage
      art={<LiveArt />}
      eyebrow="Parcours terminé"
      title="Votre site est en ligne"
      description={
        contract.status === 'CANCEL_AT_PERIOD_END' && sub.currentPeriodEnd
          ? `Résiliation enregistrée : votre site reste actif jusqu'au ${formatDate(sub.currentPeriodEnd)}.`
          : 'Tout est en place. Votre site est accessible au public.'
      }
      cta={
        <>
          <Button onClick={onDownload}><Download className="h-4 w-4" /> Télécharger le contrat signé</Button>
          {contract.status === 'ACTIVE' && (
            <Button variant="outline" onClick={onCancel}>Résilier</Button>
          )}
        </>
      }
    >
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Site actif</Badge>
          {contract.pricing.subscription.enabled && <SubscriptionStatusBadge status={sub.status} />}
        </div>
        {sub.status === 'PAST_DUE' && (
          <p className="flex items-start gap-2 rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Le dernier paiement a échoué. Stripe tentera éventuellement un nouveau prélèvement selon la configuration du compte. Votre site reste actif.</span>
          </p>
        )}
        {contract.pricing.launchFee.enabled && (
          <Row label="Frais de lancement" value={`Payés — ${formatCents(contract.pricing.launchFee.amountIncludingTax)}`} />
        )}
        {sub.currentPeriodStart && sub.currentPeriodEnd && (
          <Row label="Période en cours" value={`${formatDate(sub.currentPeriodStart)} → ${formatDate(sub.currentPeriodEnd)}`} />
        )}
        {sub.currentPeriodEnd && (
          <Row
            label={contract.status === 'CANCEL_AT_PERIOD_END' ? 'Fin de période' : 'Prochaine échéance'}
            value={formatDate(sub.currentPeriodEnd)}
          />
        )}
        {contract.activation.activatedAt && <Row label="Activé le" value={formatDate(contract.activation.activatedAt)} />}
      </div>
    </JourneyStage>
  );
}

/* ------------------------------ Contrat clos -------------------------------- */
/**
 * Fin de vie du contrat — terminé, annulé, ou en échec bloquant.
 *
 * Aucun CTA : il n'y a rien à reprendre soi-même. L'étape dérivée désigne encore
 * « Abonnement » dans ces états (elle ne rend `DONE` que si le statut vaut
 * ACTIVE) — sans cet écran, le client verrait « Activez votre abonnement » sur
 * un contrat mort.
 */
function OverStage({ contract, onDownload, onDownloadCertificate }: {
  contract: Contract; onDownload: () => void; onDownloadCertificate: () => void;
}) {
  const copy: Record<string, { title: string; description: string }> = {
    ENDED: {
      title: 'Votre contrat est terminé',
      description: "La période est arrivée à son terme et votre site n'est plus accessible au public. Contactez l'équipe technique pour repartir sur un nouveau contrat.",
    },
    CANCELLED: {
      title: 'Votre contrat a été annulé',
      description: "Ce contrat n'est plus actif. Contactez l'équipe technique si vous souhaitez en établir un nouveau.",
    },
    FAILED: {
      title: 'Le parcours est interrompu',
      description: "Une étape a échoué et bloque la suite. L'équipe technique en a été informée et doit relancer le processus — vous n'avez rien à faire.",
    },
  };
  const { title, description } = copy[contract.status] ?? copy.CANCELLED;

  return (
    <JourneyStage
      art={<WaitingArt />}
      eyebrow="Contrat clos"
      title={title}
      description={description}
      cta={
        contract.document.hasSigned ? (
          <>
            <Button variant="outline" onClick={onDownload}>
              <Download className="h-4 w-4" /> Télécharger le contrat signé
            </Button>
            {/*
              DEUX BOUTONS, PARCE QUE CE SONT DEUX PIÈCES.

              Le contrat porte les engagements ; la preuve atteste qu'ils ont
              été signés, par qui et quand. Un seul bouton obligerait à
              choisir — et le jour où il faut produire l'une, on aurait
              téléchargé l'autre.

              Un contrat signé avant la bascule n'a pas de preuve de ce
              côté-ci : le bouton n'apparaît pas. C'est un fait, pas une panne.
            */}
            {contract.document.hasCertificate && (
              <Button variant="ghost" onClick={onDownloadCertificate}>
                <Download className="h-4 w-4" /> Preuve de signature
              </Button>
            )}
          </>
        ) : undefined
      }
    />
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/* ------------------------------ Les 4 écrans -------------------------------- */
function JourneyScreen({
  contract, clientCompany, pending, onSign, onPay, onSubscribe, onVerify, onActivate,
  onDownloadSigned,
}: {
  contract: Contract;
  /** `null` tant que la lecture n’a pas abouti : on ne bloque pas sur un chargement. */
  clientCompany: MyCompanyView | null;
  pending: boolean;
  onSign: () => void;
  onPay: () => void;
  onSubscribe: () => void;
  onVerify: () => void;
  onActivate: () => void;
  onDownloadSigned: () => void;
}) {
  // « Étape 2 sur 4 » — situer l'effort restant, pas seulement l'effort courant.
  const eyebrow = `Étape ${stepPosition(contract.step, contract)} sur ${journeyOrderFor(contract).length}`;

  /**
   * ── CE QUI MANQUE, ET QUI DOIT AGIR ────────────────────────────────────
   *
   * `null` tant que la lecture n’est pas revenue : on ne bloque JAMAIS sur un
   * chargement. Le backend, lui, refusera de toute façon — l’écran n’a pas à
   * deviner à sa place pendant une milliseconde d’attente.
   */
  const paiementBloque = clientCompany ? !clientCompany.readiness?.billing?.ready : false;
  const signatureBloquee = clientCompany ? !clientCompany.readiness?.signing?.ready : false;
  const contactPrestataire = clientCompany?.support?.contactEmail ?? null;
  const nomPrestataire = clientCompany?.support?.providerName ?? "L.Y Solution";

  /**
   * L’ÉCRAN DE BLOCAGE — il DIT ce qui manque, et il ne propose PAS de le
   * corriger ici.
   *
   * « Configurez votre signataire » enverrait le client chercher un réglage
   * qui n’existe pas dans ce Manager, et qui ne doit pas y exister : son
   * identité juridique est ce qui figure sur ses factures.
   */
  const blocage = (titre: string, description: string) => (
    <JourneyStage
      art={<WaitingArt />}
      eyebrow={eyebrow}
      title={titre}
      description={description}
      cta={contactPrestataire ? (
        <a
          className="inline-flex h-11 items-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground"
          href={`mailto:${contactPrestataire}`}
        >
          <Mail className="mr-2 h-4 w-4" /> Nous contacter
        </a>
      ) : undefined}
    >
      <PriceSummary contract={contract} />
    </JourneyStage>
  );

  if (contract.step === 'SIGNATURE') {
    // Le DEV signe en premier (ordre imposé à la plateforme) : tant qu'il n'a pas
    // signé, le client n'a rien à faire. On le DIT, plutôt que de lui présenter
    // un bouton désactivé sans explication.
    if (!contract.devSigned) {
      return (
        <JourneyStage
          art={<WaitingArt />}
          eyebrow={eyebrow}
          title="En attente de l'équipe technique"
          description="Le contrat part à la signature. L'équipe technique signe en premier ; vous recevrez la main juste après. Cette page se met à jour toute seule."
        >
          <PriceSummary contract={contract} />
        </JourneyStage>
      );
    }
    // La plateforme ne ramène pas toujours le signataire : on ne le promet donc
    // que si c'est vrai, et on dit quoi faire sinon. La signature est détectée
    // par le webhook dans les deux cas — seul le trajet de retour change.
    /**
     * SIGNATURE BLOQUÉE — l’entreprise ou son signataire manquent.
     *
     * Le message ne parle pas de configuration : l’autorité est le Panel,
     * et le client n’a rien à remplir. Il a quelqu’un à contacter.
     */
    if (signatureBloquee) {
      return blocage(
        'Signature indisponible',
        'La signature du contrat est indisponible tant que votre entreprise et son '
        + `signataire contractuel ne sont pas configurés par ${nomPrestataire}.`,
      );
    }
    const autoReturn = contract.signature.autoReturn;
    return (
      <JourneyStage
        art={<SignatureArt />}
        eyebrow={eyebrow}
        title="Signez votre contrat"
        description={
          autoReturn
            ? "Le contrat est prêt et déjà signé par l'équipe technique. La signature se fait en ligne, en quelques secondes — vous serez ramené ici automatiquement."
            : "Le contrat est prêt et déjà signé par l'équipe technique. La signature se fait en ligne, en quelques secondes."
        }
        cta={<Button size="lg" onClick={onSign} loading={pending}><PenLine className="h-4 w-4" /> Voir et signer</Button>}
        note={!autoReturn ? <ReturnNote /> : undefined}
      >
        <PriceSummary contract={contract} />
      </JourneyStage>
    );
  }

  if (contract.step === 'LAUNCH_FEE') {
    /**
     * PAIEMENT BLOQUÉ — on n’ouvre PAS Stripe.
     *
     * Le refus est backend ; ce retour anticipé évite au client de
     * cliquer, d’attendre l’ouverture d’une page de paiement, et de
     * recevoir une erreur formulée dans le vocabulaire du plan de
     * contrôle.
     */
    if (paiementBloque) {
      return blocage(
        'Paiement indisponible',
        'Les informations légales de votre entreprise doivent être complétées par '
        + `${nomPrestataire} avant de pouvoir effectuer un paiement.`,
      );
    }
    const st = contract.stripe.launchFee.status;
    const retryable = st === 'FAILED' || st === 'EXPIRED' || st === 'CANCELLED';
    const label = st === 'CHECKOUT_CREATED'
      ? 'Reprendre le paiement'
      : retryable ? 'Réessayer le paiement' : 'Payer les frais de lancement';

    // PROCESSING : la banque n'a pas encore confirmé. Offrir un bouton de
    // paiement ici serait le meilleur moyen d'encaisser deux fois.
    if (st === 'PROCESSING') {
      return (
        <JourneyStage
          art={<WaitingArt />}
          eyebrow={eyebrow}
          title="Paiement en cours de confirmation"
          description="Votre banque confirme le paiement — cela prend généralement quelques secondes. Cette page se met à jour toute seule, vous pouvez la laisser ouverte."
        >
          <PriceRecap title="Frais de lancement" line={contract.pricing.launchFee} highlight />
        </JourneyStage>
      );
    }
    return (
      <JourneyStage
        art={<LaunchFeeArt />}
        eyebrow={eyebrow}
        title="Réglez les frais de lancement"
        description="Paiement unique, sécurisé par Stripe. Vous serez ramené ici automatiquement une fois le règlement confirmé."
        cta={<Button size="lg" onClick={onPay} loading={pending}><CreditCard className="h-4 w-4" /> {label}</Button>}
        note={<span className="inline-flex items-center gap-2">Frais de lancement <LaunchFeeStatusBadge status={st} /></span>}
      >
        <PriceRecap title="Frais de lancement" line={contract.pricing.launchFee} highlight />
        {retryable && (
          <p className="mt-3 text-sm text-red-600">
            {st === 'FAILED' ? "Le paiement n'a pas abouti." : 'La session de paiement a été interrompue.'} Aucun montant n'a été débité, vous pouvez réessayer.
          </p>
        )}
      </JourneyStage>
    );
  }

  if (contract.step === 'SUBSCRIPTION') {
    const st = contract.stripe.subscription.status;
    /**
     * UNE TENTATIVE EST EN COURS — pas « reprenez », mais « vérifions ».
     *
     * « Reprendre la souscription » renvoyait vers Stripe. Quand la session
     * avait abouti sans que le webhook n'arrive, Stripe affichait sa propre
     * page « Vous avez terminé » : l'utilisateur avait payé, l'écran le niait,
     * et le bouton ne menait nulle part. On propose donc d'abord de VÉRIFIER —
     * c'est-à-dire d'interroger Stripe et de réparer l'état local.
     */
    const tentativeEnCours = st === 'CHECKOUT_CREATED' || st === 'INCOMPLETE';
    return (
      <JourneyStage
        art={<SubscriptionArt />}
        eyebrow={eyebrow}
        title={tentativeEnCours ? 'Paiement à confirmer' : 'Activez votre abonnement'}
        description={
          tentativeEnCours
            ? "Une souscription a été lancée et n'est pas encore confirmée ici. Vérifiez son état : si le paiement est passé, votre contrat repart aussitôt."
            /*
              La phrase se construit sur la RÉCURRENCE réelle, plus sur un
              binaire mensuel/annuel : un contrat trimestriel décrivait jusqu'ici
              un « renouvellement automatique chaque mois » qu'aucune facture ne
              venait confirmer.
            */
            : monthsPerCycle(recurrenceOf(contract.pricing.subscription)) > 1
              ? `C'est lui qui maintient votre site en ligne. Facturé en une seule fois par période, renouvellement automatique — ${describeRecurrence(recurrenceOf(contract.pricing.subscription)).toLowerCase()} — la résiliation prend effet en fin de période déjà réglée.`
              : "C'est lui qui maintient votre site en ligne. Renouvellement automatique chaque mois, résiliable à tout moment — la résiliation prend effet en fin de période."
        }
        cta={
          tentativeEnCours ? (
            <>
              <Button size="lg" onClick={onVerify} loading={pending}>
                <RefreshCw className="h-4 w-4" /> Vérifier le paiement
              </Button>
              <Button variant="outline" onClick={onSubscribe} loading={pending}>
                Reprendre le paiement
              </Button>
            </>
          ) : (
            <Button size="lg" onClick={onSubscribe} loading={pending}>
              <RefreshCw className="h-4 w-4" /> Activer l'abonnement
            </Button>
          )
        }
        note={<span className="inline-flex items-center gap-2">Abonnement <SubscriptionStatusBadge status={st} /></span>}
      >
        {/* L'échéance et l'équivalent mensuel, sans confusion possible entre
            les deux — voir `subscriptionPricing.ts`. */}
        <SubscriptionCostCard line={contract.pricing.subscription} variant="due" />
      </JourneyStage>
    );
  }

  // ACTIVATION — tout est réuni, il ne reste qu'à publier.
  return (
    <JourneyStage
      art={<ActivationArt />}
      eyebrow={eyebrow}
      title="Tout est prêt — mettez votre site en ligne"
      description="Dernière étape. Un clic, et votre site devient accessible au public."
      cta={
        <>
          <Button size="lg" onClick={onActivate} loading={pending}>
            <CheckCircle2 className="h-4 w-4" /> Activer mon site
          </Button>
          {contract.document.hasSigned && (
            <Button variant="outline" onClick={onDownloadSigned}>
              <Download className="h-4 w-4" /> Contrat signé
            </Button>
          )}
        </>
      }
    >
      <ul className="space-y-2 text-sm">
        <Done>{contract.signatureApplicable === false ? 'Signature non requise' : 'Contrat signé'}</Done>
        <Done>{contract.launchFeeRequired ? 'Frais de lancement payés' : 'Frais de lancement non requis'}</Done>
        <Done>{contract.subscriptionRequired ? 'Abonnement actif' : 'Abonnement non requis'}</Done>
      </ul>
    </JourneyStage>
  );
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-emerald-700">
      <CheckCircle2 className="h-4 w-4 shrink-0" />{children}
    </li>
  );
}

/**
 * Quoi faire quand la plateforme ne ramène pas le signataire.
 *
 * Affiché uniquement si les redirections ont été refusées (abonnement en
 * Trial). Rien d'autre ne change : la signature est détectée par le webhook, et
 * cette page se met à jour toute seule.
 */
function ReturnNote() {
  return (
    <span className="inline-flex items-start gap-1.5">
      <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>
        Après avoir signé le contrat sur la plateforme de signature, revenez sur cette page.
        La signature sera détectée automatiquement.
      </span>
    </span>
  );
}

/** Rappel des montants sur les étapes qui ne portent pas sur un paiement. */
function PriceSummary({ contract, fallback }: { contract: Contract; fallback?: string }) {
  const { launchFee, subscription } = contract.pricing;
  if (!launchFee.enabled && !subscription.enabled) {
    return fallback ? <p className="text-sm text-muted-foreground">{fallback}</p> : null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <PriceRecap title="Frais de lancement" line={launchFee} />
      <PriceRecap title="Abonnement mensuel" line={subscription} />
    </div>
  );
}
