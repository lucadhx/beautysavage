import type { Contract } from '@/types';
import { missingRoles } from '@/lib/signatureZones';

/**
 * Préparation guidée d'un contrat (DEV, brouillon) — module PUR (testable).
 *
 * Le parcours est linéaire par nature : on ne peut pas placer des zones sans
 * PDF, ni valider sans zones. Plutôt que d'afficher quatre cartes également
 * disponibles et de laisser l'utilisateur découvrir l'ordre par ses erreurs, on
 * le rend explicite : une étape verrouillée reste visible mais inerte.
 *
 * Comme partout ailleurs, RIEN n'est stocké : l'état de chaque étape est dérivé
 * du contrat réel (cf. deriveContractProgress).
 */

export type SetupStatus = 'done' | 'current' | 'locked' | 'optional';

export type SetupStepKey = 'NAME' | 'DOCUMENT' | 'SIGNATURE' | 'ZONES' | 'PRICING' | 'VALIDATE';

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  status: SetupStatus;
  /** Résumé de l'état courant, affiché à droite du titre. */
  hint: string;
}

export interface ContractSetup {
  steps: SetupStep[];
  /** Index de l'étape à traiter maintenant, -1 si la préparation est complète. */
  currentIndex: number;
  /** Toutes les étapes bloquantes sont franchies : la validation est possible. */
  readyToValidate: boolean;
}

/**
 * Le contrat a-t-il été nommé ?
 *
 * Un contrat naît SANS nom (aucun pré-remplissage) : la question se réduit donc
 * à « le champ est-il rempli ». Il a existé ici une comparaison au nom auto
 * `Contrat ${reference}` posé par le backend — deux couches qui devaient
 * s'accorder sur une chaîne, et le front reportait « nommé » à tort si l'une
 * des deux changeait. Le pré-remplissage supprimé, le couplage disparaît.
 *
 * Les contrats créés AVANT ce changement portent encore ce nom auto : ils
 * comptent désormais comme nommés. C'est voulu — ils ont un nom, et le DEV peut
 * le corriger.
 */
export function isNamed(contract: Pick<Contract, 'name'>): boolean {
  return (contract.name || '').trim() !== '';
}

/**
 * Étapes dont l'achèvement est une DÉCISION, pas une donnée.
 *
 * ── POURQUOI CETTE NOTION EXISTE ────────────────────────────────────────────
 * « Signature requise » vaut REQUIRED par défaut côté serveur. Le parcours en
 * concluait que le choix était fait, sautait l'étape et ouvrait directement les
 * zones de signature : l'utilisateur n'avait jamais dit qu'il en voulait. De
 * même, un contrat gratuit est légitime — « pas de montant » n'est donc pas
 * « étape non traitée », mais rien ne distinguait les deux.
 *
 * Une valeur par défaut n'est pas un choix. Ces deux étapes sont franchies
 * quand l'utilisateur les a CONFIRMÉES, ou quand le contrat porte une trace qui
 * ne peut venir que d'une décision.
 */
export interface ConfirmedSteps {
  SIGNATURE?: boolean;
  PRICING?: boolean;
}

export function deriveContractSetup(
  contract: Contract,
  confirmed: ConfirmedSteps = {},
): ContractSetup {
  const zones = contract.signatureConfiguration?.zones || [];
  const missing = missingRoles(zones);

  const named = isNamed(contract);
  const hasPdf = Boolean(contract.document?.hasOriginal);
  const zonesReady = zones.length > 0 && missing.length === 0;

  const launch = contract.pricing?.launchFee;
  const sub = contract.pricing?.subscription;
  const priced = Boolean(launch?.enabled || sub?.enabled);

  const signatureApplicable = contract.signatureApplicable !== false;

  /**
   * Le choix de signature a-t-il été FAIT ?
   *
   * Trois façons de le savoir, et aucune n'est la valeur par défaut :
   *   · l'utilisateur vient de le confirmer dans cette session ;
   *   · le contrat porte NOT_REQUIRED — impossible sans décision, le défaut
   *     étant REQUIRED ;
   *   · des zones existent déjà — on ne les place pas sans avoir voulu signer.
   *
   * La dernière condition est ce qui fait qu'un brouillon rouvert ailleurs
   * reprend au bon endroit, sans mémoire locale.
   */
  const signatureDecided = confirmed.SIGNATURE === true || !signatureApplicable || zones.length > 0;

  // Un contrat gratuit est un choix comme un autre : la tarification est
  // franchie dès qu'un montant existe OU que l'utilisateur a confirmé.
  const pricingDone = priced || confirmed.PRICING === true;

  /**
   * L'ORDRE DU PARCOURS — celui qu'on ouvre automatiquement, étape après étape.
   *
   * `blocking` conditionne la navigation ; `blocksValidation` dit lesquelles
   * empêchent RÉELLEMENT de valider. Les deux ne se confondent pas : la
   * tarification s'inscrit dans l'ordre — on ne saute pas de la signature à la
   * validation — sans pour autant interdire un contrat gratuit.
   */
  const blocking: {
    key: SetupStepKey; title: string; done: boolean; hint: string; blocksValidation: boolean;
  }[] = [
    {
      key: 'NAME',
      title: 'Nommer le contrat',
      done: named,
      hint: named ? contract.name : 'À nommer',
      blocksValidation: true,
    },
    {
      key: 'DOCUMENT',
      title: 'Importer le PDF',
      done: hasPdf,
      hint: hasPdf ? `${contract.document.pageCount} page(s)` : 'Aucun document',
      blocksValidation: true,
    },
    {
      key: 'SIGNATURE',
      title: 'Signature requise',
      done: signatureDecided,
      hint: !signatureDecided
        ? 'À décider'
        : signatureApplicable
          ? 'Oui — signataires et zones à configurer'
          : 'Non — le contrat sera généré sans procédure de signature',
      // Le serveur accepte de valider avec la valeur par défaut : ce choix
      // guide le parcours, il ne bloque pas la validation.
      blocksValidation: false,
    },
    // Sans signature requise, les zones n'ont AUCUN sens : l'étape n'existe pas.
    // Tant que le choix n'est pas CONFIRMÉ, elles restent visibles mais
    // verrouillées : l'étape de signature les précède dans l'ordre, elle est
    // donc courante, et les zones ne s'ouvrent pas d'elles-mêmes. Les masquer
    // effacerait la feuille de route au lieu de la présenter.
    ...(signatureApplicable
      ? [
          {
            key: 'ZONES' as const,
            title: 'Zones de signature',
            done: zonesReady,
            hint: zonesReady
              ? `${zones.length} zone(s)`
              : zones.length === 0
                ? 'Aucune zone'
                : 'Zone manquante pour un signataire',
            blocksValidation: true,
          },
        ]
      : []),
    {
      key: 'PRICING',
      title: 'Tarification',
      done: pricingDone,
      hint: priced ? pricingSummary(contract) : pricingDone ? 'Contrat gratuit' : 'À définir',
      blocksValidation: false,
    },
  ];

  const currentBlocking = blocking.findIndex((s) => !s.done);

  const steps: SetupStep[] = blocking.map((s, i) => ({
    key: s.key,
    title: s.title,
    hint: s.hint,
    // Franchie : « faite ». Sinon « courante » à son tour, « verrouillée »
    // avant — l'ordre reste lisible sans jamais paraître en retard.
    status: s.done ? 'done' : i === currentBlocking ? 'current' : 'locked',
  }));

  // La validation ne dépend QUE des étapes qui l'empêchent réellement.
  const readyToValidate = blocking.filter((s) => s.blocksValidation).every((s) => s.done);
  // …mais elle ne s'ouvre pas d'elle-même tant que le parcours n'est pas au bout.
  const parcoursTermine = currentBlocking === -1;
  steps.push({
    key: 'VALIDATE',
    title: 'Valider le contrat',
    hint: readyToValidate ? 'Verrouille le contrat et fige les signataires' : 'Terminez les étapes ci-dessus',
    status: readyToValidate && parcoursTermine ? 'current' : readyToValidate ? 'optional' : 'locked',
  });

  // L'étape à traiter : la 1ʳᵉ non franchie dans l'ordre, sinon la validation.
  const currentIndex = parcoursTermine
    ? steps.length - 1
    : Math.max(0, steps.findIndex((s) => s.key === blocking[currentBlocking].key));

  return { steps, currentIndex, readyToValidate };
}

function pricingSummary(contract: Contract): string {
  const parts: string[] = [];
  if (contract.pricing?.launchFee?.enabled) parts.push('frais de lancement');
  if (contract.pricing?.subscription?.enabled) parts.push('abonnement');
  return parts.join(' + ');
}
