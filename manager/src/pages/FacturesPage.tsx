import * as React from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { motion } from 'framer-motion';
import {
  ReceiptText, Eye, Download, RefreshCw, Rocket, RotateCw, Wrench, FileText,
  Plus, CalendarClock, AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  Card, CardContent, CardHeader, CardTitle, EmptyState, Button, Input, Field, Badge, buttonVariants,
} from '@/components/ui/primitives';
import { Modal } from '@/components/ui/dialog';
import { ContractStatusBadge, InvoiceStatusBadge, PaymentStatusBadge } from '@/components/contracts/status';
import { SubscriptionIncidentCard } from '@/components/contracts/SubscriptionIncidentCard';
import { useResource, useAction } from '@/hooks/useResource';
import { useAuth } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { formatCents, formatDate } from '@/lib/utils';
import { invoiceIdentity, upcomingInvoice } from '@/lib/billing';
import { messageUtilisateur } from '@/lib/erreurs';
import type {
  BillingGroup, ContractStatus, InvoiceView, MyCompanyView, PaymentView, PaymentRequestView,
} from '@/types';

/** Icônes par type de facture — cohérentes avec le reste du manager (Lucide). */
const ICON = { Rocket, RotateCw, Wrench, FileText } as const;

/**
 * Statut du contrat vu depuis la FACTURATION.
 *
 * Ici, un contrat n'est intéressant que s'il court encore. Afficher l'état
 * détaillé d'un contrat dépassé (« En attente signature DEV » sur un ancien
 * contrat déjà remplacé) laisse croire qu'une action est attendue : sur cette
 * page, tout ce qui n'est pas en cours est simplement « Inactif ».
 * La fiche Contrat, elle, garde le statut complet — c'est là qu'il a un sens.
 */
function BillingContractBadge({ status }: { status: ContractStatus }) {
  const live = status === 'ACTIVE' || status === 'CANCEL_AT_PERIOD_END';
  if (live) return <ContractStatusBadge status={status} />;
  return <Badge className="bg-red-100 text-red-700">Inactif</Badge>;
}

function InvoiceRow({ inv }: { inv: InvoiceView }) {
  const identity = invoiceIdentity(inv);
  const Icon = ICON[identity.icon];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${identity.tone}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{identity.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {inv.number || 'Numéro en attente'}
            {inv.invoiceDate && ` · ${formatDate(inv.invoiceDate)}`}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div className="text-right">
          <p className="text-sm font-semibold">{formatCents(inv.amountIncludingTax)} TTC</p>
          <p className="text-xs text-muted-foreground">
            {formatCents(inv.amountExcludingTax)} HT · {formatCents(inv.taxAmount)} TVA
          </p>
        </div>
        <InvoiceStatusBadge status={inv.status} />
        {inv.hostedInvoiceUrl && (
          <a
            href={inv.hostedInvoiceUrl}
            target="_blank"
            rel="noreferrer"
            title="Voir la facture Stripe"
            aria-label="Voir la facture Stripe"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Eye className="h-4 w-4" />
          </a>
        )}
        {inv.invoicePdfUrl && (
          // Vrai lien (clic milieu, nouvel onglet) à l'allure d'un CTA.
          <a
            href={inv.invoicePdfUrl}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: 'sm' })}
          >
            <Download className="h-4 w-4" /> Télécharger
          </a>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Tentative de paiement — affichée UNIQUEMENT quand elle n'a PAS abouti.
 *
 * Un paiement réussi produit toujours une facture Stripe : la ligne ferait
 * doublon. Une tentative échouée/annulée/expirée, elle, ne génère AUCUNE
 * facture : c'est la seule trace de « j'ai essayé de payer et ça n'a pas
 * marché ». D'où la section, renommée en conséquence.
 */
function AttemptRow({ p }: { p: PaymentView }) {
  const label = p.type === 'LAUNCH_FEE' ? 'Frais de lancement' : 'Abonnement';
  const when = p.failedAt || p.createdAt;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm">
      <span className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        {label}
        {when && <span className="text-xs text-muted-foreground">{formatDate(when)}</span>}
      </span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground">{formatCents(p.amountIncludingTax)} TTC</span>
        <PaymentStatusBadge status={p.status} />
      </div>
    </div>
  );
}

/** Prochaine facture d'abonnement — informative, jamais téléchargeable. */
function UpcomingInvoiceCard({ g }: { g: BillingGroup }) {
  const next = upcomingInvoice(g);
  if (!next) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4 flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-700">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div>
          <p className="text-sm font-medium">Prochaine facture</p>
          <p className="text-xs text-muted-foreground">Abonnement · {formatDate(next.date)}</p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold">{formatCents(next.amountExcludingTax)} HT</p>
        <p className="text-xs text-muted-foreground">Non encore générée</p>
      </div>
    </motion.div>
  );
}

/** DEV — rattacher une facture Stripe existante depuis son lien. */
function AttachInvoiceDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const { pending, run } = useAction();

  React.useEffect(() => {
    if (open) { setUrl(''); setLabel(''); setError(null); }
  }, [open]);

  const submit = async () => {
    setError(null);
    try {
      await run(() => api.attachInvoice({ url: url.trim(), label: label.trim() }), {
        success: 'Facture rattachée depuis Stripe',
      });
      onDone();
      onClose();
    } catch (e) {
      setError(messageUtilisateur(e, 'Rattachement impossible.'));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ajouter une facture Stripe">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Collez le lien Stripe de la facture (facture hébergée ou dashboard), ou son identifiant
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">in_…</code>. Montants, statut, dates,
          numéro, PDF et contrat sont récupérés automatiquement depuis Stripe.
        </p>
        <Field label="Lien ou identifiant de la facture" error={error || undefined}>
          <Input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://invoice.stripe.com/i/… ou in_1AbC…"
          />
        </Field>
        <Field label="Nom (facultatif)" hint="Seul champ libre : « Migration », « Mise à jour »…">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Facture exceptionnelle" maxLength={80} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={submit} loading={pending} disabled={!url.trim()}>
            <Plus className="h-4 w-4" /> Rattacher
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ContractBilling({ g, isDev, onSynced }: { g: BillingGroup; isDev: boolean; onSynced: () => void }) {
  const { pending, run } = useAction();
  // Un paiement abouti est déjà représenté par sa facture : seules les
  // tentatives NON abouties apportent une information de plus.
  const attempts = g.payments.filter((p) => p.status !== 'PAID' && p.status !== 'REFUNDED');
  const refunds = g.payments.filter((p) => p.status === 'REFUNDED');

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {g.reference} <BillingContractBadge status={g.status} />
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          {g.subscription.currentPeriodEnd && (
            <span className="text-xs text-muted-foreground">
              {g.subscription.cancelAtPeriodEnd ? 'Se termine le ' : 'Prochaine échéance : '}
              {formatDate(g.subscription.currentPeriodEnd)}
            </span>
          )}
          {isDev && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => run(() => api.syncContractInvoices(g.contractId), { success: 'Factures synchronisées avec Stripe' }).then(onSynced)}
              loading={pending}
            >
              <RefreshCw className="h-4 w-4" /> Synchroniser
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <UpcomingInvoiceCard g={g} />

        {g.invoices.length === 0 && attempts.length === 0 && refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune facture pour ce contrat.</p>
        ) : (
          <>
            {g.invoices.length > 0 && <div>{g.invoices.map((inv) => <InvoiceRow key={inv._id} inv={inv} />)}</div>}

            {refunds.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Remboursements</p>
                {refunds.map((p) => <AttemptRow key={p._id} p={p} />)}
              </div>
            )}

            {attempts.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground">Tentatives de paiement</p>
                <p className="mb-1 text-xs text-muted-foreground">
                  Tentatives qui n'ont pas abouti : elles ne génèrent aucune facture.
                </p>
                {attempts.map((p) => <AttemptRow key={p._id} p={p} />)}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * LES PRESTATIONS PONCTUELLES (L10.5).
 *
 * ══ POURQUOI UNE SECTION À PART, ET NON UNE LIGNE DE PLUS PAR CONTRAT ═══════
 *
 * Une prestation n'appartient à aucun contrat : c'est un travail ponctuel, hors
 * abonnement. La ranger sous un contrat aurait obligé à en choisir un — et à
 * mentir dès qu'un client en a deux, ou aucun.
 *
 * ══ LA VENTILATION EST AFFICHÉE, JAMAIS RECALCULÉE ══════════════════════════
 *
 * Le HT, le taux et le TTC viennent du Panel, qui les a figés à la facturation.
 * Les recalculer ici ferait diverger l'écran de la facture Stripe le jour où le
 * contrat changerait de taux.
 */
/**
 * ── LE BLOCAGE EST DIT AVANT LE CLIC, PAS APRÈS ─────────────────────────────
 *
 * Sans entreprise cliente — ou avec une identité de facturation incomplète —
 * le Panel REFUSE d’ouvrir la session de paiement. C’est le refus autoritatif,
 * et il est juste.
 *
 * Mais un bouton « Payer » qui mène à une erreur apprend au client que le
 * système est cassé, alors que c’est un dossier qui est incomplet. On affiche
 * donc la raison À LA PLACE du bouton, avec le seul geste utile : nous écrire.
 *
 * L’écran ne propose JAMAIS de corriger l’information ici : l’identité
 * juridique du client est ce qui figure sur ses factures, et elle est tenue
 * par L.Y Solution.
 */
function PrestationRow({ p, onPaid, clientCompany }: {
  p: PaymentRequestView;
  onPaid: () => void;
  clientCompany: MyCompanyView | null;
}) {
  const [enCours, setEnCours] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  async function payer() {
    /**
     * LE DOUBLE CLIC EST ARRÊTÉ ICI *ET* PLUS BAS.
     *
     * Ce drapeau est du confort : il évite deux requêtes. Il ne PROTÈGE rien —
     * un rechargement de page le remet à zéro. La vraie garantie est l'identité
     * d'acte dérivée de la prestation, côté serveur : huit clics rendent la
     * même session Stripe.
     */
    if (enCours) return;
    setEnCours(true);
    setErreur(null);
    try {
      const { url } = await api.payPaymentRequest(p.paymentRequestId);
      window.location.href = url;
    } catch (e) {
      setErreur(messageUtilisateur(e, 'Le paiement n’a pas pu être ouvert.'));
      setEnCours(false);
      onPaid();
    }
  }

  const paye = p.status === 'PAID';
  const annule = p.status === 'CANCELED' || p.status === 'EXPIRED';

  /**
   * `null` tant que la vue n’est pas chargée : on ne bloque pas sur une
   * ignorance passagère. Le refus du serveur reste, lui, inconditionnel.
   */
  const facturationBloquee = clientCompany ? !clientCompany.readiness?.billing?.ready : false;
  const contactPrestataire = clientCompany?.support?.contactEmail ?? null;
  const motifBlocage = !clientCompany?.linked
    ? 'Aucune information sur votre entreprise n’est rattachée à ce projet.'
    : 'Les informations légales nécessaires à la facturation sont incomplètes.';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-700">
          <Wrench className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{p.label}</p>
          {p.description ? (
            <p className="truncate text-xs text-muted-foreground">{p.description}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {p.issuedAt ? formatDate(p.issuedAt) : '—'}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <div className="text-right">
          <p className="text-sm font-semibold">{formatCents(p.grossAmountCents)} TTC</p>
          {/* La ventilation, telle que le Panel l'a figée. Jamais recalculée. */}
          <p className="text-xs text-muted-foreground">
            {formatCents(p.netAmountCents)} HT · TVA {p.taxRate} % : {formatCents(p.taxAmountCents)}
          </p>
        </div>

        {paye ? <Badge className="bg-green-100 text-green-700">Payé</Badge> : null}
        {annule ? <Badge className="bg-zinc-100 text-zinc-600">Annulée</Badge> : null}
        {!paye && !annule ? <Badge className="bg-amber-100 text-amber-700">À payer</Badge> : null}

        {/*
          LE BOUTON N'APPARAÎT QUE SI LE SERVEUR DIT « PAYABLE ».
          L'écran ne décide pas de l'éligibilité — il la lit. Et le serveur la
          revérifie au clic : une projection en retard ferait au pire perdre un
          appel, jamais gagner un paiement.
        */}
        {p.payable && !facturationBloquee ? (
          <Button onClick={payer} disabled={enCours}>
            {enCours ? 'Ouverture…' : 'Payer'}
          </Button>
        ) : null}

        {/*
          LE MOTIF PREND LA PLACE DU BOUTON — il ne le double pas.

          Un bouton désactivé sans explication laisse croire à une panne. Une
          phrase qui NOMME ce qui manque, avec le seul geste utile — nous
          écrire — laisse le client comprendre et agir.

          Aucune invitation à corriger l’information ici : son identité
          juridique est ce qui figure sur ses factures, et elle est tenue par
          son prestataire.
        */}
        {p.payable && facturationBloquee ? (
          <div className="max-w-xs text-right">
            <p className="text-xs text-amber-700">{motifBlocage}</p>
            {contactPrestataire ? (
              <a
                href={`mailto:${contactPrestataire}`}
                className="mt-1 inline-flex text-xs font-medium underline"
              >
                Nous contacter
              </a>
            ) : null}
          </div>
        ) : null}

        {/*
          « Voir la facture » n'apparaît QUE si Stripe en a réellement émis une.
          Un bouton qui ne mène nulle part est pire que pas de bouton.
        */}
        {paye && p.invoiceUrl ? (
          <a
            href={p.invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Eye className="h-4 w-4" /> Voir la facture
          </a>
        ) : null}
        {paye && p.invoicePdfUrl ? (
          <a
            href={p.invoicePdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Download className="h-4 w-4" /> PDF
          </a>
        ) : null}
      </div>

      {erreur ? <p className="text-xs text-red-600 sm:basis-full sm:text-right">{erreur}</p> : null}
    </motion.div>
  );
}

function PrestationsSection() {
  const { data, loading, reload } = useResource(() => api.getMyPaymentRequests(), []);
  /**
   * LE VERDICT DE FACTURATION, lu à la même source que « Mon entreprise ».
   *
   * `live: 'client-company'` : rattacher une entreprise depuis le Panel
   * débloque l'écran SANS rechargement — c'est la même ressource vivante que
   * celle du parcours contractuel, et deux abonnements distincts finiraient
   * par afficher deux vérités.
   */
  const client = useResource(() => api.getMyCompany(), [], { live: 'client-company' });
  const items = data?.items ?? [];

  /**
   * SECTION MASQUÉE QUAND ELLE EST VIDE.
   *
   * Un client qui n'a jamais eu de prestation n'a pas à voir un bloc « aucune
   * prestation » sous son abonnement : ce serait lui annoncer une facturation
   * qui ne le concerne pas.
   */
  if (loading || items.length === 0) return null;

  const du = items
    .filter((p) => p.payable)
    .reduce((somme, p) => somme + p.grossAmountCents, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prestations</CardTitle>
        {du > 0 ? (
          <p className="text-sm text-muted-foreground">
            {formatCents(du)} TTC en attente de règlement.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        {items.map((p) => (
          <PrestationRow
            key={p.paymentRequestId}
            p={p}
            onPaid={reload}
            clientCompany={client.data ?? null}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default function FacturesPage() {
  const { isDev } = useAuth();
  const { data, loading, reload } = useResource(() => (isDev ? api.getAllInvoices() : api.getMyInvoices()), [isDev]);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const groups = data || [];

  return (
    <div>
      <PageHeader
        title="Facturation & abonnement"
        description={
          isDev
            ? 'Vue globale des factures Stripe par contrat.'
            : 'Vos frais de lancement, abonnements et factures (PDF Stripe téléchargeables).'
        }
        action={
          isDev ? (
            <Button variant="outline" onClick={() => setAttachOpen(true)}>
              <Plus className="h-4 w-4" /> Ajouter une facture Stripe
            </Button>
          ) : undefined
        }
      />
      {/*
        ══ L'INCIDENT D'ABONNEMENT EN PREMIER (L10.6B-3) ══════════════════════

        Avant les prestations et avant les factures, parce que c'est le seul
        élément de cette page qui puisse FERMER le site du client. Il apparaît
        dès le premier prélèvement refusé — pas à l'expiration du délai de
        grâce : découvrir l'impayé et la suspension dans le même écran priverait
        le client des jours qu'on lui laisse pour l'éviter.

        Réservé au client (`!isDev`) : un compte DEV n'a pas d'abonnement à
        payer, et l'incident du client se lit dans le Panel, avec son contexte.
      */}
      {!isDev ? <SubscriptionIncidentCard /> : null}

      {/*
        LES PRESTATIONS ENSUITE — ce qui est DÛ se lit avant ce qui est réglé.
        Elles sont indépendantes des contrats : un client sans contrat vivant
        peut parfaitement avoir une prestation à payer.

        ══ ET ELLES NE SE MÉLANGENT JAMAIS À L'INCIDENT CI-DESSUS ═════════════

        Une prestation impayée peut être « à payer », mais elle n'ouvre AUCUN
        incident d'abonnement, ne déclenche aucune échéance de grâce et ne
        suspend aucun site. Deux blocs distincts, parce que ce sont deux
        natures distinctes.
      */}
      {!isDev ? <PrestationsSection /> : null}

      {loading ? (
        <BrandLoader />
      ) : groups.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Aucune facture" description="Les factures apparaîtront ici après le premier paiement." />
      ) : (
        <div className="mt-5 space-y-5">
          {groups.map((g) => <ContractBilling key={g.contractId} g={g} isDev={isDev} onSynced={reload} />)}
        </div>
      )}
      {isDev && <AttachInvoiceDialog open={attachOpen} onClose={() => setAttachOpen(false)} onDone={reload} />}
    </div>
  );
}
