import * as React from 'react';
import { FileSignature, Plus, ArrowLeft, Upload, Download, PenLine, ShieldCheck, RefreshCw, Trash2, ExternalLink, Eye, FlaskConical, Ban, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input, SegmentedControl, Stepper, Switch, Spinner, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Modal, ConfirmDialog } from '@/components/ui/dialog';
import { ContractStatusBadge } from '@/components/contracts/status';
import { SignatureZoneEditor } from '@/components/contracts/SignatureZoneEditor';
import { ContractTimeline } from '@/components/contracts/ContractTimeline';
import { ContractProgressTracker } from '@/components/contracts/ContractProgressTracker';
import { GuidedSteps } from '@/components/contracts/GuidedSteps';
import { SubscriptionCostCard } from '@/components/contracts/SubscriptionCostCard';
import { TechnicalTools, SyncAction } from '@/components/contracts/TechnicalTools';
import { CollapsibleCard } from '@/components/contracts/CollapsibleCard';
import { DevStripeDetails } from '@/components/contracts/DevStripeDetails';
import { DevJourney } from '@/components/contracts/journey/DevJourney';
import { SignatureStateBadge, LaunchFeeStatusBadge, SubscriptionStatusBadge } from '@/components/contracts/status';
import { useResource, useAction } from '@/hooks/useResource';
import { usePollWhile } from '@/hooks/useContractJourney';
import { shouldPoll } from '@/lib/journey';
import {
  api, uploadContractPdf, downloadContractDocument,
  type ContractDocumentKind, fetchContractDocumentBlob, ApiError,
} from '@/lib/api';
import { formatCents, formatDateTime } from '@/lib/utils';
import { zonesEqual } from '@/lib/signatureZones';
import { deriveContractSetup, type ConfirmedSteps, type SetupStepKey } from '@/lib/contractSetup';
import {
  recurrenceOf, describeRecurrence, monthsPerCycle, MAX_INTERVAL_BY_UNIT, type Recurrence,
} from '@/lib/subscriptionPricing';
import type { Contract, SignatureZone } from '@/types';

function PricingEditor({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const { pending, run } = useAction();
  const [launch, setLaunch] = React.useState(contract.pricing.launchFee.enabled);
  const [launchEur, setLaunchEur] = React.useState(String(contract.pricing.launchFee.amountExcludingTax / 100 || ''));
  const [sub, setSub] = React.useState(contract.pricing.subscription.enabled);
  const [subEur, setSubEur] = React.useState(String(contract.pricing.subscription.amountExcludingTax / 100 || ''));
  /**
   * LA RÉCURRENCE — lue par le même helper que les écrans d'affichage.
   *
   * Le formulaire ne refait pas le repli sur l'héritage pour son compte : un
   * contrat annuel d'avant ce lot doit se PRÉSENTER annuel dans son propre
   * éditeur, faute de quoi le premier enregistrement — même sans toucher à la
   * périodicité — le ramènerait à mensuel. C'est ainsi qu'on perd une donnée
   * contractuelle sans qu'aucune ligne n'ait demandé de la changer.
   */
  const [recurrence, setRecurrence] = React.useState<Recurrence>(
    () => recurrenceOf(contract.pricing.subscription)
  );
  const [tax, setTax] = React.useState(String(contract.taxRate));

  const plafond = MAX_INTERVAL_BY_UNIT[recurrence.unit];

  /**
   * CHANGER D'UNITÉ RAMÈNE L'INTERVALLE DANS SES BORNES.
   *
   * « Tous les 12 mois » puis un passage en années donnerait « tous les 12 ans »
   * — que le serveur refuse (le fournisseur borne une période à trois ans), et
   * que personne n'a voulu. On ramène au plafond de la nouvelle unité plutôt
   * que de laisser composer une saisie condamnée.
   */
  const changerUnite = (unit: 'MONTH' | 'YEAR') => {
    setRecurrence((r) => ({ unit, interval: Math.min(r.interval, MAX_INTERVAL_BY_UNIT[unit]) }));
  };

  const save = async () => {
    try {
      await run(() => api.updateContractDraft(contract._id, {
        launchFee: { enabled: launch, amountExcludingTax: Number(launchEur) || 0 },
        subscription: { enabled: sub, amountExcludingTax: Number(subEur) || 0, recurrence },
        taxRate: Number(tax) || 0,
      }), { success: 'Configuration enregistrée' });
      onSaved();
    } catch { /* */ }
  };
  const rate = Number(tax) || 0;
  const ttcCents = (eur: string) => Math.round((Number(eur) || 0) * 100 * (1 + rate / 100));
  const ttc = (eur: string) => formatCents(ttcCents(eur));
  // Le nombre de mois couverts par une échéance — base des repères informatifs.
  const cycleMois = monthsPerCycle(recurrence);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Frais de mise en service</span>
        <Switch checked={launch} onChange={setLaunch} />
      </div>
      {launch && (
        <Field label="Montant HT (€) — paiement unique" hint={`TTC : ${ttc(launchEur)}`}>
          <Input type="number" min="0" step="0.01" value={launchEur} onChange={(e) => setLaunchEur(e.target.value)} />
        </Field>
      )}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Abonnement</span>
        <Switch checked={sub} onChange={setSub} />
      </div>
      {sub && (
        <>
          {/*
            « Tous les [3] [mois] » — une phrase, composée de ses deux termes.

            Le choix binaire « Mensuelle / Annuelle » ne manquait pas d'options :
            il énumérait des offres au lieu de décrire une périodicité. Ajouter
            « Trimestrielle » puis « Semestrielle » aurait rallongé la liste sans
            jamais la clore. Un compteur et une unité en couvrent l'infinité, et
            se lisent comme on les dit à l'oral.
          */}
          <Field
            label="Récurrence"
            hint={`${describeRecurrence(recurrence)} — c'est la fréquence à laquelle le client sera débité.`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Tous les</span>
              <Stepper
                value={recurrence.interval}
                onChange={(interval) => setRecurrence((r) => ({ ...r, interval }))}
                min={1}
                max={plafond}
                label="Nombre de périodes entre deux échéances"
              />
              <SegmentedControl
                value={recurrence.unit}
                onChange={changerUnite}
                label="Unité de récurrence"
                /* « mois » est invariable ; « an » ne l'est pas. L'étiquette
                   s'accorde au compteur pour que la ligne se lise d'un trait. */
                options={[
                  { value: 'MONTH', label: 'mois' },
                  { value: 'YEAR', label: recurrence.interval > 1 ? 'ans' : 'an' },
                ]}
              />
            </div>
          </Field>
          <Field
            label="Montant HT facturé à CHAQUE échéance"
            /*
              Le libellé ne dit plus « par mois » ni « par an » : le montant
              saisi est celui d'UNE échéance, quelle que soit la périodicité.
              900 € « tous les 3 mois » vaut 900 € tous les trois mois — jamais
              300 €/mois. Le repère mensuel reste dit, mais nommé comme tel.
            */
            hint={
              cycleMois > 1
                ? `Facturé en une fois : ${ttc(subEur)} TTC ${describeRecurrence(recurrence).toLowerCase()} — équivalent informatif : ${formatCents(Math.round(ttcCents(subEur) / cycleMois))} TTC/mois`
                : `Facturé : ${ttc(subEur)} TTC chaque mois`
            }
          >
            <Input type="number" min="0" step="0.01" value={subEur} onChange={(e) => setSubEur(e.target.value)} />
          </Field>
        </>
      )}
      <Field label="Taux de TVA (%)">
        <Input type="number" min="0" max="100" value={tax} onChange={(e) => setTax(e.target.value)} className="w-28" />
      </Field>

      {/*
        APERÇU EN DIRECT — calculé sur la SAISIE, pas sur le contrat enregistré.
        Configurer un abonnement annuel sans voir son équivalent mensuel oblige
        à faire la division de tête, et c'est là qu'on se trompe d'un facteur
        douze. Les montants viennent du même calcul en centimes que la
        facturation.
      */}
      {sub && (
        <SubscriptionCostCard
          line={{
            enabled: true,
            amountExcludingTax: Math.round((Number(subEur) || 0) * 100),
            taxAmount: Math.round((Number(subEur) || 0) * 100 * ((Number(tax) || 0) / 100)),
            amountIncludingTax: Math.round((Number(subEur) || 0) * 100 * (1 + (Number(tax) || 0) / 100)),
            currency: 'EUR',
            recurrence,
          }}
        />
      )}

      <Button onClick={save} loading={pending}>Enregistrer la configuration</Button>
    </div>
  );
}

/**
 * DÉLAI DE GRÂCE EN CAS D'IMPAYÉ — la clémence accordée avant de fermer.
 *
 * ── POURQUOI CE RÉGLAGE N'EST PAS DANS LA TARIFICATION ──────────────────────
 * La tarification se verrouille à la validation du contrat, et c'est juste.
 * Le délai de grâce, lui, ne sert qu'une fois l'abonnement en cours — et son
 * cas d'usage réel est celui d'une facture déjà refusée, sur un contrat déjà
 * signé, pour laquelle on décide d'accorder une semaine de plus. Le placer
 * derrière le verrou l'aurait rendu inutilisable au seul moment où il compte.
 *
 * ── POURQUOI UN INTERRUPTEUR, ET PAS SEULEMENT UN NOMBRE ────────────────────
 * « Aucune politique » et « zéro jour » sont deux décisions OPPOSÉES :
 *
 *     aucune politique → l'impayé est suivi, aucune fermeture programmée
 *     zéro jour        → l'échéance tombe au premier refus
 *
 * Un champ numérique seul les aurait confondues dès qu'on l'efface. Le
 * changement modifie les impayés À VENIR ; un incident déjà ouvert garde le
 * délai figé à son ouverture, et l'écran le dit.
 */
function PaymentGracePolicyEditor({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const { pending, run } = useAction();
  const configuree = contract.paymentGraceDays !== null;
  const [actif, setActif] = React.useState(configuree);
  const [jours, setJours] = React.useState(configuree ? String(contract.paymentGraceDays) : '7');

  const saisi = Number(jours);
  const valide = !actif || (Number.isInteger(saisi) && saisi >= 0 && saisi <= 365);
  const suivant = actif ? saisi : null;
  const inchange = suivant === contract.paymentGraceDays;

  const save = async () => {
    try {
      await run(() => api.updateContractPaymentGracePolicy(contract._id, suivant), {
        success: suivant === null ? 'Politique de grâce retirée' : 'Politique de grâce enregistrée',
      });
      onSaved();
    } catch { /* le bandeau d'erreur suffit */ }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Accorder un délai avant fermeture du site</span>
        <Switch checked={actif} onChange={setActif} />
      </div>

      {actif ? (
        <Field
          label="Délai de grâce (jours)"
          hint={
            saisi === 0
              ? 'Zéro jour : l’échéance tombe dès le premier paiement refusé.'
              : `Le site pourra être fermé ${saisi} jour(s) après le PREMIER refus de paiement.`
          }
        >
          <Input
            type="number"
            min="0"
            max="365"
            step="1"
            value={jours}
            onChange={(e) => setJours(e.target.value)}
            className="w-28"
          />
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucune politique : un impayé reste suivi et visible, mais aucune fermeture
          automatique n'est programmée. La suspension resterait une décision manuelle.
        </p>
      )}

      {/*
        ── CE QUI SE PASSE PENDANT CE DÉLAI — LA VÉRITÉ, PAS UNE PROMESSE ──────

        Il aurait été rassurant d’écrire « une nouvelle tentative par jour ».
        Ce serait faux : ce parc ne programme AUCUNE tentative. Stripe est
        l’unique ordonnanceur, et sa cadence est celle configurée sur le compte
        — souvent quatre tentatives réparties sur environ trois semaines, avec
        des dates que Stripe choisit lui-même.

        Écrire une cadence que personne n’applique ferait attendre à un
        exploitant un prélèvement qui n’arriverait pas au moment annoncé. On dit
        donc ce qui est, et l’on nomme le geste qui, lui, est immédiat.
      */}
      <p className="text-xs text-muted-foreground">
        Pendant ce délai, les nouvelles tentatives automatiques suivent la politique
        de relance configurée chez Stripe — cette plateforme n’en programme aucune
        de son côté. Une nouvelle tentative peut être déclenchée immédiatement
        depuis l’impayé, dans le Panel.
      </p>

      {!valide && (
        <p className="text-sm text-destructive">
          Indiquez un nombre entier de jours entre 0 et 365.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Ce réglage s'applique aux impayés à venir. Un impayé déjà en cours conserve le
        délai qui était en vigueur le jour du premier refus.
      </p>

      <Button onClick={save} loading={pending} disabled={!valide || inchange}>
        Enregistrer la politique
      </Button>
    </div>
  );
}

/**
 * SIGNATURE REQUISE — la question qui décide de tout le parcours.
 *
 * ── POURQUOI ELLE EST ICI, ET PLUS DANS LA TARIFICATION ─────────────────────
 * Ce réglage vivait dans l'étape « Tarification », c'est-à-dire APRÈS les zones
 * de signature. Pour déclarer qu'aucune signature n'était nécessaire, il fallait
 * donc d'abord configurer la signature : le réglage était piégé derrière l'étape
 * qu'il sert précisément à supprimer. Il vient maintenant juste après le
 * document, avant tout le reste.
 *
 * ── UN CHANGEMENT NE SE FAIT JAMAIS EN SILENCE ──────────────────────────────
 * Le passage d'un mode à l'autre est confirmé, et le serveur refuse de toute
 * façon de désactiver la signature tant qu'une demande est ouverte : elle
 * doit être annulée d'abord, explicitement. Un contrat déjà verrouillé ne se
 * modifie plus du tout.
 */
function SignatureRequirementEditor({
  contract,
  onSaved,
  onConfirmed,
}: {
  contract: Contract;
  onSaved: () => void;
  /** L'étape est FRANCHIE — même si la valeur n'a pas changé. */
  onConfirmed?: () => void;
}) {
  const { pending, run } = useAction();
  const actuel: 'REQUIRED' | 'NOT_REQUIRED' =
    contract.signatureRequirement === 'NOT_REQUIRED' ? 'NOT_REQUIRED' : 'REQUIRED';
  const [choix, setChoix] = React.useState<'REQUIRED' | 'NOT_REQUIRED'>(actuel);
  const [confirmation, setConfirmation] = React.useState(false);

  // Verrouillé dès qu'une procédure existe ou que le contrat n'est plus un
  // brouillon : on ne réécrit pas une histoire déjà commencée.
  const procedureEnCours = Boolean(contract.signature?.signatureRequestId);
  const verrouille = contract.status !== 'DRAFT'
    || contract.signatureConfiguration.locked
    || procedureEnCours;

  const enregistrer = async () => {
    /**
     * CONFIRMER SANS CHANGER reste une décision.
     *
     * La valeur par défaut du serveur est « requise ». Répondre « oui » ne
     * modifie donc rien à enregistrer — mais c'est bien à cet instant que
     * l'utilisateur a choisi, et que le parcours peut passer aux zones. Sans
     * cela, le bouton restait inerte et l'étape ne se franchissait jamais.
     */
    if (choix === actuel) {
      onConfirmed?.();
      return;
    }
    /**
     * DÉSACTIVER la signature retire une étape du parcours : cela se confirme.
     * L'ACTIVER n'enlève rien — le réglage reste modifiable tant qu'aucune
     * procédure n'a démarré, et une boîte de dialogue n'apprendrait rien.
     */
    if (choix === 'NOT_REQUIRED') { setConfirmation(true); return; }
    await appliquer('REQUIRED');
  };

  const appliquer = async (valeur: 'REQUIRED' | 'NOT_REQUIRED') => {
    try {
      await run(() => api.updateContractDraft(contract._id, { signatureRequirement: valeur }), {
        success: 'Signature : réglage enregistré',
      });
      setConfirmation(false);
      onSaved();
    } catch { /* le toast dit ce qui bloque */ }
  };

  // Une configuration déjà posée n'est pas perdue : le dire évite qu'on croie
  // devoir la refaire après un aller-retour sur ce réglage.
  const configurationExistante = (contract.signatureConfiguration?.zones?.length || 0) > 0
    || (contract.signatureConfiguration?.signers?.length || 0) > 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Signature requise</span>
          <Switch
            checked={choix === 'REQUIRED'}
            disabled={verrouille}
            onChange={(v: boolean) => setChoix(v ? 'REQUIRED' : 'NOT_REQUIRED')}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {choix === 'REQUIRED'
            ? 'Le contrat devra être configuré puis envoyé en signature.'
            : 'Le contrat sera généré sans procédure de signature et pourra être téléchargé directement.'}
        </p>
      </div>

      {choix === 'NOT_REQUIRED' && (
        <p className="text-sm font-medium">Signature non requise</p>
      )}

      {verrouille ? (
        <p className="text-xs text-muted-foreground">
          {procedureEnCours
            ? 'Une procédure de signature existe déjà : annulez-la avant de modifier ce réglage.'
            : 'Le contrat est verrouillé : ce réglage ne peut plus changer.'}
        </p>
      ) : (
        <Button onClick={enregistrer} loading={pending}>
          {choix === actuel ? 'Confirmer ce choix' : 'Enregistrer'}
        </Button>
      )}

      <ConfirmDialog
        open={confirmation}
        onClose={() => setConfirmation(false)}
        onConfirm={() => appliquer('NOT_REQUIRED')}
        title="Désactiver la signature électronique ?"
        description={
          <>
            <p>
              Le contrat sera validé sans procédure de signature. Les signataires et les
              zones de signature ne seront plus requis.
            </p>
            {configurationExistante && (
              <p>
                La configuration existante sera conservée mais ignorée tant que la
                signature restera désactivée.
              </p>
            )}
          </>
        }
        confirmLabel="Confirmer sans signature"
        loading={pending}
      />
    </div>
  );
}

function ContractDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const { data, loading, refresh } = useResource(() => api.getContract(id), [id]);
  // ENV APPLICATIF courant — surtout PAS `contract.environment`, figé à la
  // création : une base PROD promue depuis TEST porte des contrats « TEST » et
  // afficherait ici des outils de recette en production.
  const meta = useResource(() => api.meta());
  const isTestEnv = meta.data?.environment === 'TEST';
  /** Le monde tel que le BACKEND le déclare — jamais déduit d'un domaine. */
  const envLabel = meta.data?.environment ?? 'inconnu';
  const timeline = useResource(() => api.getContractTimeline(id), [id]);
  const payments = useResource(() => api.getContractPayments(id), [id]);
  const { pending, run } = useAction();
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [viewOnly, setViewOnly] = React.useState(false);
  const [pdfBlob, setPdfBlob] = React.useState<Blob | null>(null);
  const [draftZones, setDraftZones] = React.useState<SignatureZone[]>([]);
  const [toDelete, setToDelete] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [confirmEndNow, setConfirmEndNow] = React.useState(false);
  const [confirmImmediate, setConfirmImmediate] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  /**
   * ÉTAPES CONFIRMÉES — une valeur par défaut n'est pas un choix.
   *
   * « Signature requise » vaut REQUIRED côté serveur avant toute décision, et un
   * contrat sans montant est légitime. Sans cette distinction, le parcours
   * sautait l'étape de signature (« c'est déjà REQUIRED ») puis la tarification
   * (« rien à facturer »), et ouvrait les zones puis la validation.
   *
   * La confirmation est mémorisée PAR CONTRAT, le temps de la préparation. Le
   * serveur ne la porte pas — et n'a pas à la porter : c'est un fil de parcours,
   * pas une donnée contractuelle. Un brouillon rouvert ailleurs retrouve
   * malgré tout sa place grâce aux traces persistées (zones posées, montant
   * saisi, signature déclarée non requise).
   */
  const [confirmes, setConfirmes] = React.useState<ConfirmedSteps>({});
  // Déclaré ICI, avec les autres hooks : au-dessus de tout retour anticipé.
  // Placé plus bas — après le garde de chargement — le composant appelait deux
  // hooks de plus une fois le contrat arrivé, et React ne pouvait plus apparier
  // les rendus (« Rendered more hooks than during the previous render »).
  // La remise à zéro se fait à l'identique si rien n'a été confirmé : monter le
  // composant ne provoque pas de rendu supplémentaire pour rien.
  React.useEffect(() => {
    setConfirmes((actuel) => (Object.keys(actuel).length ? {} : actuel));
  }, [id]);
  const confirmer = (etape: keyof ConfirmedSteps) =>
    setConfirmes((actuel) => ({ ...actuel, [etape]: true }));

  const contract = data as Contract | null;

  React.useEffect(() => { if (contract) setNameDraft(contract.name); }, [contract?.name]);

  /**
   * Rafraîchissement SILENCIEUX de ce qui est à l'écran.
   *
   * `refresh` et non `reload` : ce dernier rallume `loading`, or cette page
   * retombe sur `<BrandLoader/>` dès qu'il est vrai — le détail entier
   * disparaissait, modale de zones comprise, à chaque tour de sondage comme
   * après chaque action.
   */
  const refreshWatched = () => { refresh(); timeline.refresh(); payments.refresh(); };
  /** Idem + la liste parente : réservé aux ACTIONS, qui peuvent la changer. */
  const refreshAll = () => { refreshWatched(); onChanged(); };

  // Après validation, le DEV n'agit plus : il OBSERVE le client avancer. Sans
  // sondage, il devrait recharger la page pour voir bouger quoi que ce soit.
  // Un BROUILLON est exclu en plus des états terminaux : il n'avance que par
  // les actions du DEV lui-même, déjà suivies d'un `refreshAll()`.
  //
  // Le sondage ne touche PAS la liste parente : elle n'est pas affichée tant
  // qu'un contrat est ouvert — la rafraîchir toutes les 5 s serait une requête
  // pour personne.
  const watching = contract?.status !== 'DRAFT' && shouldPoll(contract?.status, contract?.step);
  usePollWhile(watching, refreshWatched);

  const saveName = async () => {
    if (!contract || !nameDraft.trim() || nameDraft.trim() === contract.name) return;
    try { await run(() => api.updateContractDraft(id, { name: nameDraft.trim() }), { success: 'Nom mis à jour' }); refreshAll(); } catch { /* */ }
  };

  const upload = async (file: File) => {
    try {
      await run(() => uploadContractPdf(id, file), { success: 'PDF importé' });
      refreshAll();
    } catch { /* */ }
  };
  const openEditor = async (readonly = false) => {
    if (!contract) return;
    try {
      // L'éditeur AFFICHE le PDF, il ne le télécharge pas : on récupère le
      // binaire sans déclencher d'enregistrement.
      const blob = await run(() => fetchContractDocumentBlob(id, 'original'));
      setPdfBlob(blob);
      setDraftZones(contract.signatureConfiguration.zones);
      setViewOnly(readonly);
      setEditorOpen(true);
    } catch { /* */ }
  };
  /**
   * L'éditeur reste OUVERT après l'enregistrement : le widget flottant permet
   * d'enregistrer sans quitter le document, on continue donc à placer ses zones
   * et l'état « ✓ Enregistré » a le temps d'être vu.
   *
   * Ne PAS avaler l'erreur : le widget s'appuie sur le rejet pour repasser en
   * « Enregistrer » plutôt que d'afficher un succès mensonger. Le toast est
   * déjà émis par `run`.
   */
  const saveZones = async () => {
    await run(() => api.updateSignatureConfig(id, draftZones), { success: 'Zones enregistrées' });
    refreshAll();
  };
  /** Fermer ne doit jamais jeter du travail en silence. */
  const closeEditor = () => {
    const dirty = !viewOnly && !zonesEqual(contract?.signatureConfiguration.zones || [], draftZones);
    if (dirty) setConfirmDiscard(true);
    else setEditorOpen(false);
  };
  const validate = async () => {
    try { await run(() => api.validateContract(id), { success: 'Contrat validé et verrouillé' }); refreshAll(); }
    catch (e) { if (e instanceof ApiError && e.details) { /* details toastés */ } }
  };
  const signDev = async () => {
    try {
      const { signatureLink } = await run(() => api.startDevSignature(id));
      // Navigation dans le MÊME onglet (et non `window.open`) : la plateforme nous
      // ramène ici à la fin du flux via `redirect_urls`. Ouvert dans un onglet
      // séparé, ce retour atterrirait dans un onglet orphelin pendant que
      // l'onglet d'origine continuerait d'afficher « à signer ».
      if (signatureLink) window.location.href = signatureLink;
      else refreshAll();
    } catch { /* */ }
  };
  // Le téléchargement se DÉCLENCHE, il ne s'affiche pas : voir
  // `downloadAuthenticatedFile`. Une erreur remonte au toast comme les autres.
  const download = (kind: ContractDocumentKind) =>
    run(() => downloadContractDocument(id, kind));

  if (loading || !contract) return <BrandLoader />;

  const isDraft = contract.status === 'DRAFT' && !contract.signatureConfiguration.locked;
  // Seul un contrat en cours peut être « terminé » (l'outil de recette simule
  // l'échéance) — cohérent avec la précondition imposée côté service.
  const isActiveLike = contract.status === 'ACTIVE' || contract.status === 'CANCEL_AT_PERIOD_END';
  // Étapes de préparation dérivées du contrat réel (aucun index stocké).
  const setup = deriveContractSetup(contract, confirmes);

  const STEP_CONTENT: Record<SetupStepKey, React.ReactNode> = {
    NAME: (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Donnez un nom parlant à ce contrat : c'est lui qui apparaîtra dans la liste.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder="Ex. Contrat annuel 2026"
            onKeyDown={(e) => e.key === 'Enter' && saveName()}
          />
          <Button onClick={saveName} disabled={!nameDraft.trim() || nameDraft.trim() === contract.name} loading={pending}>
            Enregistrer le nom
          </Button>
        </div>
      </div>
    ),
    DOCUMENT: (
      <div className="space-y-3">
        {contract.document.hasOriginal ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{contract.document.pageCount} page(s) importée(s)</span>
            <Button size="sm" variant="outline" onClick={() => download('original')}>
              <Download className="h-4 w-4" />Original
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Importez le PDF du contrat (20 Mo et 40 pages maximum).</p>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" hidden
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <Button variant={contract.document.hasOriginal ? 'outline' : 'default'} size="sm"
          onClick={() => fileRef.current?.click()} loading={pending}>
          <Upload className="h-4 w-4" /> {contract.document.hasOriginal ? 'Remplacer le PDF' : 'Importer le PDF'}
        </Button>
      </div>
    ),
    ZONES: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Placez au moins une zone de signature par signataire : la validation l'exige.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openEditor(false)} loading={pending}>
            <PenLine className="h-4 w-4" /> Configurer les signatures
          </Button>
          <Button variant="outline" size="sm" onClick={() => openEditor(true)} loading={pending}>
            <Eye className="h-4 w-4" /> Voir
          </Button>
        </div>
      </div>
    ),
    SIGNATURE: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ce choix décide du parcours : avec signature, les signataires et les zones sont à
          configurer ; sans signature, le contrat est généré et téléchargeable directement.
        </p>
        <SignatureRequirementEditor
          contract={contract}
          onSaved={() => { confirmer('SIGNATURE'); refreshAll(); }}
          onConfirmed={() => confirmer('SIGNATURE')}
        />
      </div>
    ),
    PRICING: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Facultatif : sans montant, le contrat est gratuit et s'activera sans paiement.
        </p>
        <PricingEditor contract={contract} onSaved={() => { confirmer('PRICING'); refreshAll(); }} />
        {/* La politique d'impayé se décide au même moment que l'abonnement —
            mais elle reste modifiable après, contrairement aux montants. */}
        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-medium">En cas d'impayé</p>
          <PaymentGracePolicyEditor contract={contract} onSaved={refreshAll} />
        </div>
      </div>
    ),
    VALIDATE: (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          La validation verrouille le PDF, les zones et les montants, et fige l'identité des
          signataires. Elle est définitive.
        </p>
        <Button onClick={validate} loading={pending} disabled={!setup.readyToValidate}>
          <ShieldCheck className="h-4 w-4" /> Valider le contrat
        </Button>
      </div>
    ),
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour à la liste
      </button>

      <PageHeader title={contract.name || contract.reference} description={`Référence ${contract.reference} · v${contract.signatureConfiguration.version} (${contract.signatureConfiguration.versionCount} version(s))`} action={<ContractStatusBadge status={contract.status} />} />

      <div className="space-y-5">
        {/* Préparation GUIDÉE (brouillon) : une étape à la fois, dans l'ordre
            imposé par le métier — on ne place pas de zones sans PDF. */}
        {isDraft ? (
          <>
            <Card>
              <CardContent className="pt-5">
                <ContractProgressTracker contract={contract} />
              </CardContent>
            </Card>
            <GuidedSteps
              currentIndex={setup.currentIndex}
              steps={setup.steps.map((step) => ({ ...step, content: STEP_CONTENT[step.key] }))}
            />
          </>
        ) : (
          /* Contrat VALIDÉ : le DEV cesse d'être un administrateur qui inspecte
             un objet technique — il est partie au contrat. Il voit donc le même
             parcours que le client. Le détail technique reste atteignable, mais
             replié : cf. « Voir les détails » plus bas. */
          <Card>
            <CardContent className="py-6 sm:py-8">
              <DevJourney
                contract={contract}
                pending={pending}
                onSign={signDev}
                onDownloadSigned={() => download('signed')}
              />
            </CardContent>
          </Card>
        )}

        {/* Tout le technique, replié. Ce qui est secondaire doit rester
            ATTEIGNABLE sans encombrer le parcours. */}
        {!isDraft && (
          <CollapsibleCard
            icon={Eye}
            title="Voir les détails"
            description="Document, zones, tarification, état des fournisseurs et actions de cycle de vie. Rien ici n'est nécessaire au parcours."
          >
            <div className="space-y-4">
              {/* Document + zones + tarification */}
              {/* Le réglage de signature reste LISIBLE après verrouillage : il
                  explique le parcours qu'a suivi ce contrat. */}
              {/* MODIFIABLE malgré le verrou : voir `PaymentGracePolicyEditor`.
                  C'est le seul réglage du contrat qui reste ouvert après
                  validation, parce qu'il ne décrit pas un engagement signé mais
                  la clémence que nous appliquons avant d'agir. */}
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-medium">En cas d'impayé</p>
                <PaymentGracePolicyEditor contract={contract} onSaved={refreshAll} />
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-medium">Signature</p>
                <SignatureRequirementEditor contract={contract} onSaved={refreshAll} />
              </div>

              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-medium">Document et zones</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {contract.document.pageCount} page(s) · {contract.signatureConfiguration.zones.length} zone(s) · verrouillé
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => download('original')}>
                    <Download className="h-4 w-4" />Original
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openEditor(true)} disabled={!contract.document.hasOriginal} loading={pending}>
                    <Eye className="h-4 w-4" /> Voir les zones
                  </Button>
                  {contract.document.hasSigned && (
                    <Button size="sm" variant="outline" onClick={() => download('signed')}>
                      <Download className="h-4 w-4" />PDF signé
                    </Button>
                  )}
                  {/*
                    LA PREUVE D'AUDIT — un bouton à part, jamais fusionné.

                    Elle atteste qui a signé, quand et depuis où. Un seul bouton
                    pour les deux pièces obligerait à choisir, et le jour où il
                    faut produire l'une on aurait téléchargé l'autre.

                    Les contrats signés chez le fournisseur historique n'en ont
                    pas : le bouton n'apparaît pas, et c'est un fait, pas une
                    panne — leur preuve vit dans l'espace du compte.
                  */}
                  {contract.document.hasCertificate && (
                    <Button size="sm" variant="outline" onClick={() => download('certificate')}>
                      <Download className="h-4 w-4" />Preuve d’audit
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-border p-3 text-sm">
                <p className="mb-2 font-medium">Tarification</p>
                {contract.pricing.launchFee.enabled && <div className="flex justify-between"><span className="text-muted-foreground">Frais de lancement TTC</span><span>{formatCents(contract.pricing.launchFee.amountIncludingTax)}</span></div>}
                {contract.pricing.subscription.enabled && <div className="flex justify-between"><span className="text-muted-foreground">Abonnement TTC / mois</span><span>{formatCents(contract.pricing.subscription.amountIncludingTax)}</span></div>}
                {!contract.pricing.launchFee.enabled && !contract.pricing.subscription.enabled && <span className="text-muted-foreground">Contrat gratuit</span>}
              </div>

              {/* Actions de cycle de vie — elles n'existent nulle part ailleurs,
                  mais elles n'ont rien à faire dans le parcours. */}
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-medium">Cycle de vie</p>
                <div className="flex flex-wrap gap-2">
                  {contract.status === 'FAILED' && (
                    <Button variant="outline" size="sm" onClick={() => run(() => api.restartSignature(id), { success: 'Signature relancée' }).then(refreshAll)} loading={pending}>
                      <RefreshCw className="h-4 w-4" /> Relancer la signature
                    </Button>
                  )}
                  {contract.status === 'ACTIVE' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        run(() => api.cancelContract(id), {
                          success: isTestEnv ? 'Contrat résilié immédiatement (TEST)' : 'Résiliation demandée',
                        }).then(refreshAll)
                      }
                    >
                      {isTestEnv ? 'Résiliation immédiate (TEST)' : 'Résilier'}
                    </Button>
                  )}
                  {/*
                    ── CORRECTION ADMINISTRATIVE — réservée aux comptes DEV ────

                    ══ POURQUOI CE BOUTON EXISTE ═════════════════════════════

                    Un contrat créé ou configuré par erreur en PRODUCTION devait
                    attendre son échéance pour disparaître : la résiliation
                    immédiate était interdite par l'environnement, c'est-à-dire
                    par une propriété du monde qui ne dit rien des droits de
                    celui qui agit.

                    Il ne remplace PAS « Résilier » : celle-ci reste la
                    résiliation ordinaire, avec sa doctrine intacte. Deux gestes
                    distincts pour deux intentions distinctes.

                    Cette page est déjà réservée aux DEV ; le SERVICE revérifie
                    la permission, car masquer un bouton ne protège rien.
                  */}
                  {(contract.status === 'ACTIVE' || contract.status === 'CANCEL_AT_PERIOD_END') && !isTestEnv && (
                    <Button variant="destructive" size="sm" onClick={() => setConfirmImmediate(true)}>
                      <Ban className="h-4 w-4" /> Résilier immédiatement
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setToDelete(true)}>
                    <Trash2 className="h-4 w-4" /> Supprimer / archiver
                  </Button>
                </div>
              </div>

              {/* Signature */}
              {contract.signature.hasRequest && (
                <div className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">Signature</p>
                    <SignatureStateBadge state={contract.signature.signatureState} />
                  </div>
                  <div className="space-y-1.5">
                    {contract.signature.signers.map((s) => (
                      <div key={s.role} className="flex items-center justify-between text-sm">
                        <span>{s.displayName} <span className="text-muted-foreground">({s.role === 'DEVELOPER' ? 'Équipe technique' : 'Client'})</span></span>
                        <span className={s.signed ? 'text-emerald-700' : 'text-muted-foreground'}>
                          {s.signed ? `Signé${s.signedAt ? ` · ${formatDateTime(s.signedAt)}` : ''}` : 'En attente'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {contract.signature.signatureRequestId && (
                    <p className="mt-2 text-xs text-muted-foreground">Demande : <span className="font-mono">{contract.signature.signatureRequestId}</span></p>
                  )}
                </div>
              )}

              <DevStripeDetails contract={contract} payments={payments.data || []} />
            </div>
          </CollapsibleCard>
        )}

        {/* Timeline */}
        <Card>
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent>
            {timeline.loading ? <Spinner className="h-5 w-5" /> : <ContractTimeline events={timeline.data || []} />}
          </CardContent>
        </Card>

        {/* Outils de RECETTE — ENV=TEST uniquement. Le backend refuse en PROD
            même si ces boutons étaient forcés : la garde est côté service. */}
        {isTestEnv && (
          <Card className="border-dashed border-amber-300 bg-amber-50/40">
            <CardHeader className="flex flex-col gap-1">
              <CardTitle className="flex items-center gap-2 text-amber-900">
                <FlaskConical className="h-4 w-4" /> Recette (TEST)
              </CardTitle>
              <p className="text-xs text-amber-800">
                Raccourcis réservés à l'environnement de test — invisibles et refusés en production.
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {isActiveLike && (
                <Button variant="destructive" size="sm" onClick={() => setConfirmEndNow(true)}>
                  <Ban className="h-4 w-4" /> Résilier immédiatement
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="h-4 w-4" /> Réinitialiser la recette
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Outils de dépannage — repliés, à l'écart des CTA contractuels. */}
        <TechnicalTools>
          <SyncAction
            label="Contrat et signature"
            description="Interroge la plateforme de signature et remet à jour l'état de la signature, puis réconcilie les paiements. N'envoie aucune nouvelle demande de signature."
            onSync={async () => { const r = await api.syncContract(id); refreshAll(); return r?.result; }}
            currentStatus={<><span className="text-muted-foreground">Signature</span><SignatureStateBadge state={contract.signature.signatureState} /></>}
          />
          {contract.pricing.launchFee.enabled && (
            <SyncAction
              label="Frais de lancement (Stripe)"
              description="Interroge Stripe et remet à jour l'état local du paiement. Cette action ne déclenche aucun paiement."
              onSync={async () => { const r = await api.syncContractPayment(id); refreshAll(); return r?.result; }}
              currentStatus={<><span className="text-muted-foreground">Paiement</span><LaunchFeeStatusBadge status={contract.stripe.launchFee.status} /></>}
            />
          )}
          {contract.pricing.subscription.enabled && (
            <SyncAction
              label="Abonnement (Stripe)"
              description="Interroge Stripe et remet à jour l'état local de l'abonnement. Cette action ne crée aucun abonnement et ne déclenche aucun prélèvement."
              onSync={async () => { const r = await api.syncContractSubscription(id); refreshAll(); return r?.result; }}
              currentStatus={<><span className="text-muted-foreground">Abonnement</span><SubscriptionStatusBadge status={contract.stripe.subscription.status} /></>}
            />
          )}
        </TechnicalTools>

        <p className="text-xs text-muted-foreground">Dernière mise à jour : {formatDateTime(contract.updatedAt)}</p>
      </div>

      <Modal open={editorOpen} onClose={closeEditor} title={viewOnly ? 'Aperçu des zones de signature' : 'Zones de signature'} className="max-w-6xl">
        {pdfBlob && (
          <SignatureZoneEditor
            pdfBlob={pdfBlob}
            initialZones={draftZones}
            onChange={setDraftZones}
            // Enregistrer vit DANS l'éditeur (widget flottant au-dessus du
            // document), mais l'action reste celle du parent.
            onSave={viewOnly ? undefined : saveZones}
            readOnly={viewOnly}
          />
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" onClick={closeEditor}>{viewOnly ? 'Fermer' : 'Fermer'}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmEndNow}
        onClose={() => setConfirmEndNow(false)}
        onConfirm={async () => {
          setConfirmEndNow(false);
          try {
            await run(() => api.endContractNow(id), { success: 'Contrat terminé (recette)' });
            refreshAll();
          } catch { /* toast */ }
        }}
        title="Terminer le contrat immédiatement ?"
        description="Le contrat passera en « terminé », l'abonnement sera coupé et le site suspendu — exactement comme si l'échéance venait d'arriver. Réservé à la recette (TEST)."
        confirmLabel="Résilier immédiatement"
        destructive
      />

      {/*
        CONFIRMATION FORTE — on nomme ce qui va se passer, et où.

        Un bouton rouge seul se clique par réflexe. Le texte dit l'effet
        (« prend fin IMMÉDIATEMENT »), l'environnement, et la référence du
        contrat : trois informations qui rendent l'erreur de cible visible
        AVANT le clic, pas après.
      */}
      <ConfirmDialog
        open={confirmImmediate}
        onClose={() => setConfirmImmediate(false)}
        onConfirm={async () => {
          setConfirmImmediate(false);
          try {
            /**
             * « DÉJÀ TERMINÉ » N'EST PAS UN ÉCHEC.
             *
             * Le service répond de façon stable plutôt que de lever : le
             * message de succès le dit tel quel, sans présenter une
             * idempotence comme une erreur ni comme une seconde résiliation.
             */
            const issue = await run(() => api.cancelContractImmediately(id), {
              success: 'Contrat terminé immédiatement',
            });
            if (issue?.alreadyEnded) {
              await run(async () => issue, { success: 'Ce contrat était déjà terminé.' });
            }
            refreshAll();
          } catch { /* toast */ }
        }}
        title="Mettre fin immédiatement à ce contrat ?"
        description={(
          <div className="space-y-2 text-sm">
            <p className="font-semibold text-red-700">
              Vous allez mettre fin immédiatement au contrat de production.
            </p>
            <p>
              Le contrat passera en « terminé », l'abonnement sera coupé, et si la
              protection contractuelle est activée le site sera suspendu — sans
              attendre l'échéance.
            </p>
            <dl className="rounded border border-red-200 bg-red-50/60 p-2">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Environnement</dt>
                <dd className="font-semibold">{envLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Contrat</dt>
                <dd className="font-mono">{contract.reference || id}</dd>
              </div>
            </dl>
            <p className="text-muted-foreground">
              Cette correction administrative est réservée aux comptes développeur
              et reste tracée dans le registre d'audit.
            </p>
          </div>
        )}
        confirmLabel="Résilier immédiatement"
        destructive
      />

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          try {
            const s = await run(() => api.resetRecette(), { success: 'Recette réinitialisée' });
            onChanged();
            onBack();
            void s;
          } catch { /* toast */ }
        }}
        title="Réinitialiser la recette ?"
        description="Tous les contrats, paiements et factures seront supprimés, les demandes de signature et abonnements annulés, et la suspension technique levée. Le site revient à « aucun contrat ». Réservé à la recette (TEST)."
        confirmLabel="Tout réinitialiser"
        destructive
      />

      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => { setConfirmDiscard(false); setEditorOpen(false); }}
        title="Abandonner les modifications ?"
        description="Les zones modifiées ne sont pas enregistrées. En fermant maintenant, elles seront perdues."
        confirmLabel="Fermer sans enregistrer"
        destructive
      />

      <ConfirmDialog open={toDelete} onClose={() => setToDelete(false)}
        onConfirm={async () => {
          setToDelete(false);
          try { await run(() => api.deleteContract(id), { success: 'Contrat supprimé / archivé' }); onBack(); onChanged(); } catch { /* */ }
        }}
        title="Supprimer le contrat" destructive confirmLabel="Confirmer"
        description="Un contrat signé/payé sera archivé (jamais supprimé physiquement). Un brouillon sans transaction sera supprimé." />
    </div>
  );
}

export default function DevContractsPage() {
  const { data, loading, reload, refresh } = useResource(() => api.listContracts());
  const { pending, run } = useAction();
  const [selected, setSelected] = React.useState<string | null>(null);
  const contracts = data || [];

  const create = async () => {
    try { const c = await run(() => api.createContract(), { success: 'Contrat créé' }); reload(); if (c) setSelected(c._id); }
    catch { /* INTEGRATIONS_NOT_READY toasté */ }
  };

  // `refresh` : la liste se remet à jour en silence. Avec `reload`, revenir au
  // sommaire juste après une action pouvait retomber sur l'écran de chargement.
  if (selected) return <ContractDetail id={selected} onBack={() => setSelected(null)} onChanged={refresh} />;

  return (
    <div>
      <PageHeader title="Contrats"
        description="Créez et pilotez les contrats d'activation du site (paiement + signature requis)."
        action={<Button onClick={create} loading={pending}><Plus className="h-4 w-4" /> Nouveau contrat</Button>} />

      {loading ? (
        <BrandLoader />
      ) : contracts.length === 0 ? (
        <EmptyState icon={FileSignature} title="Aucun contrat"
          description="Configurez d'abord le paiement et la signature, puis créez un contrat."
          action={<Button onClick={create} loading={pending}><Plus className="h-4 w-4" /> Nouveau contrat</Button>} />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {contracts.map((c) => (
              <button key={c._id} onClick={() => setSelected(c._id)}
                className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-muted/50">
                {/* Le nom d'abord : la liste affichait la référence, si bien qu'un
                    contrat renommé semblait revenir à son nom d'origine dès qu'on
                    quittait sa fiche. La référence reste visible, en second. */}
                <div className="min-w-0">
                  <span className="font-medium">{c.name || c.reference}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.reference}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.environment}</span>
                </div>
                <div className="flex items-center gap-3">
                  <ContractStatusBadge status={c.status} />
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
