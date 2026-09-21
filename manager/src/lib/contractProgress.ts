import type { Contract } from '@/types';

/**
 * Avancement d'un contrat — calcul PARTAGÉ par le DEV et l'ADMIN.
 *
 * Aucun numéro d'étape n'est stocké : tout est DÉRIVÉ des états réels
 * (signature, frais, abonnement, activation), exactement comme
 * `deriveActivationStep` côté backend. Un webhook manqué ou un rechargement ne
 * peut donc pas désynchroniser l'affichage.
 *
 * Les deux rôles appellent cette même fonction sur le même contrat sérialisé :
 * le rendu est identique par construction, pas par convention.
 *
 * Module PUR (aucun import runtime) : testable directement sous Node.
 */

export type ProgressStatus = 'done' | 'current' | 'upcoming' | 'not-required' | 'error';

export type ProgressStepKey =
  | 'PREPARATION'
  | 'DEV_SIGNATURE'
  | 'CLIENT_SIGNATURE'
  | 'LAUNCH_FEE'
  | 'SUBSCRIPTION'
  | 'ACTIVATION';

export interface ProgressStep {
  key: ProgressStepKey;
  label: string;
  status: ProgressStatus;
  /** Précision affichée sous le libellé (« Non requise », « Refusée »…). */
  hint?: string;
}

/** État terminal/exceptionnel du contrat, à afficher à part du chemin nominal. */
export type ProgressOutcome =
  | { kind: 'NONE' }
  | { kind: 'CANCELLED'; label: string }
  | { kind: 'FAILED'; label: string }
  | { kind: 'CANCEL_AT_PERIOD_END'; label: string }
  | { kind: 'ENDED'; label: string };

export interface ContractProgress {
  steps: ProgressStep[];
  /** Index de l'étape en cours, -1 si le parcours est terminé. */
  currentIndex: number;
  /** Étapes réellement requises et franchies / total requis (les « non requises » sont exclues). */
  completed: number;
  total: number;
  outcome: ProgressOutcome;
}

const LABEL: Record<ProgressStepKey, string> = {
  PREPARATION: 'Préparation',
  DEV_SIGNATURE: 'Signature DEV',
  CLIENT_SIGNATURE: 'Signature client',
  LAUNCH_FEE: 'Frais de lancement',
  SUBSCRIPTION: 'Abonnement',
  ACTIVATION: 'Activation',
};

/**
 * Libellés des deux étapes de signature — nommés d'après les ENTREPRISES.
 *
 * « Signature DEV » / « Signature client » sont du jargon interne : sur le
 * contrat, ce sont deux sociétés qui signent. Les noms viennent du snapshot figé
 * à la validation (`signersSnapshot`, source de vérité — cf. CONTRACT_SIGNERS.md),
 * avec repli sur la vue éditeur puis sur les libellés génériques tant que le
 * contrat n'est pas validé et qu'aucun nom n'est encore figé.
 */
function signatureLabels(contract: Contract): { developer: string; client: string } {
  const snap = contract.signersSnapshot;
  const signers = contract.signatureConfiguration?.signers || [];
  const fromSigners = (role: 'DEVELOPER' | 'CLIENT') =>
    signers.find((s) => s.role === role)?.companyName?.trim() || '';

  const developer = snap?.developer?.companyName?.trim() || fromSigners('DEVELOPER');
  const client = snap?.client?.companyName?.trim() || fromSigners('CLIENT');

  return {
    developer: developer ? `Signature ${developer}` : LABEL.DEV_SIGNATURE,
    client: client ? `Signature ${client}` : LABEL.CLIENT_SIGNATURE,
  };
}

const SIGNATURE_FAILED_STATES = ['DECLINED', 'EXPIRED', 'CANCELED'];
const LAUNCH_FEE_FAILED = ['FAILED', 'EXPIRED', 'CANCELLED'];
const SUBSCRIPTION_FAILED = ['FAILED', 'INCOMPLETE_EXPIRED', 'UNPAID'];

function signatureHint(state: string): string {
  if (state === 'DECLINED') return 'Refusée';
  if (state === 'EXPIRED') return 'Expirée';
  if (state === 'CANCELED') return 'Annulée';
  return 'Échec';
}

export function deriveContractProgress(contract: Contract): ContractProgress {
  const status = contract.status;
  const signatureState = contract.signature?.signatureState || 'NONE';
  const signatureBroken = SIGNATURE_FAILED_STATES.includes(signatureState);

  const activated = Boolean(contract.activation?.activatedAt) ||
    ['ACTIVE', 'CANCEL_AT_PERIOD_END', 'ENDED'].includes(status);

  // 1. Préparation — franchie dès que le contrat est validé/verrouillé.
  const prepared = status !== 'DRAFT';

  // 2/3. Signatures — l'ordre DEV puis client est imposé à la plateforme.
  const devSigned = Boolean(contract.devSigned);
  const clientSigned = Boolean(contract.adminSigned);

  // 4/5. Paiements — « non requis » vaut satisfait (ne bloque jamais la suite),
  // mais reste affiché comme tel : « payé » et « pas dû » ne sont pas la même chose.
  const feeRequired = Boolean(contract.launchFeeRequired);
  const feeDone = Boolean(contract.launchFeeSatisfied);
  const feeBroken = feeRequired && LAUNCH_FEE_FAILED.includes(contract.stripe?.launchFee?.status || '');

  const subRequired = Boolean(contract.subscriptionRequired);
  const subDone = Boolean(contract.subscriptionSatisfied);
  const subBroken = subRequired && SUBSCRIPTION_FAILED.includes(contract.stripe?.subscription?.status || '');

  // Signature NON requise dans ce projet : les étapes de signature ne sont
  // pas « ignorées », elles N'EXISTENT PAS dans ce parcours (timeline :
  // préparation -> paiement -> activation, sans anomalie apparente).
  const signatureApplicable = contract.signatureApplicable !== false;
  const signatureSteps: { key: ProgressStepKey; done: boolean; required: boolean; error?: string }[] =
    signatureApplicable
      ? [
          {
            key: 'DEV_SIGNATURE',
            done: devSigned,
            required: true,
            error: signatureBroken && !devSigned ? signatureHint(signatureState) : undefined,
          },
          {
            key: 'CLIENT_SIGNATURE',
            done: clientSigned,
            required: true,
            error: signatureBroken && devSigned && !clientSigned ? signatureHint(signatureState) : undefined,
          },
        ]
      : [];

  const raw: { key: ProgressStepKey; done: boolean; required: boolean; error?: string }[] = [
    { key: 'PREPARATION', done: prepared, required: true },
    ...signatureSteps,
    {
      key: 'LAUNCH_FEE',
      done: feeDone,
      required: feeRequired,
      error: feeBroken && !feeDone ? 'Paiement échoué' : undefined,
    },
    {
      key: 'SUBSCRIPTION',
      done: subDone,
      required: subRequired,
      error: subBroken && !subDone ? 'Abonnement en échec' : undefined,
    },
    { key: 'ACTIVATION', done: activated, required: true },
  ];

  // L'étape courante = la première requise non franchie. Une étape non requise
  // n'est jamais « courante » : elle n'attend rien de personne.
  const currentIndex = raw.findIndex((s) => s.required && !s.done);

  const names = signatureLabels(contract);
  const labelOf = (key: ProgressStepKey) =>
    key === 'DEV_SIGNATURE' ? names.developer : key === 'CLIENT_SIGNATURE' ? names.client : LABEL[key];

  const steps: ProgressStep[] = raw.map((s, i) => {
    const label = labelOf(s.key);
    if (!s.required) return { key: s.key, label, status: 'not-required', hint: 'Non requise' };
    if (s.error) return { key: s.key, label, status: 'error', hint: s.error };
    if (s.done) return { key: s.key, label, status: 'done' };
    if (i === currentIndex) return { key: s.key, label, status: 'current' };
    return { key: s.key, label, status: 'upcoming' };
  });

  const required = raw.filter((s) => s.required);

  return {
    steps,
    currentIndex,
    completed: required.filter((s) => s.done).length,
    total: required.length,
    outcome: deriveOutcome(contract),
  };
}

function deriveOutcome(contract: Contract): ProgressOutcome {
  switch (contract.status) {
    case 'CANCELLED':
      return { kind: 'CANCELLED', label: 'Contrat annulé' };
    case 'FAILED':
      return { kind: 'FAILED', label: 'Échec bloquant — reprise possible' };
    case 'CANCEL_AT_PERIOD_END':
      return { kind: 'CANCEL_AT_PERIOD_END', label: "Résilié — actif jusqu'à l'échéance" };
    case 'ENDED':
      return { kind: 'ENDED', label: 'Contrat terminé — site suspendu' };
    default:
      return { kind: 'NONE' };
  }
}
