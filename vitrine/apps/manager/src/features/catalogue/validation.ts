// C1 — Validation/blocages catalogue (pur, testable). Chaque item de catalogue dérive :
//   - un statut par module (complete | incomplete | error | optional)
//   - une liste d'issues (error = bloque la publication, warning = informatif)
//   - un statut global de publication (publishable ou non)
// Aucune dépendance React : ces fonctions alimentent le ModuleStepper et le ValidationDrawer.
import type {
  CatalogueService,
  CatalogueTraining,
  CatalogueTrainingSession,
  CatalogueGiftCardConfig,
  CatalogueValidationIssue,
  CatalogueModuleStatus,
} from '@bs/api-client';

export interface ModuleValidation {
  status: CatalogueModuleStatus;
  issues: CatalogueValidationIssue[];
}

export interface CatalogueValidationResult {
  issues: CatalogueValidationIssue[];
  modules: Record<string, ModuleValidation>;
  /** Aucun bloquant (level=error) → l'item peut être publié/activé. */
  publishable: boolean;
  errorCount: number;
  warningCount: number;
}

function err(module: string, message: string): CatalogueValidationIssue {
  return { module, level: 'error', message };
}
function warn(module: string, message: string): CatalogueValidationIssue {
  return { module, level: 'warning', message };
}

/**
 * Agrège une liste d'issues + la liste des modules attendus en un résultat complet.
 * `requiredModules` = modules qui doivent être complets (sinon `incomplete` si pas d'erreur) ;
 * `optionalModules` = toujours `optional` quand sans erreur.
 */
function aggregate(
  issues: CatalogueValidationIssue[],
  requiredModules: string[],
  optionalModules: string[] = [],
): CatalogueValidationResult {
  const modules: Record<string, ModuleValidation> = {};
  const all = [...requiredModules, ...optionalModules];
  for (const key of all) {
    const own = issues.filter((i) => i.module === key);
    const hasError = own.some((i) => i.level === 'error');
    const hasWarning = own.some((i) => i.level === 'warning');
    let status: CatalogueModuleStatus;
    if (hasError) status = 'error';
    else if (hasWarning) status = 'incomplete';
    else if (optionalModules.includes(key)) status = 'optional';
    else status = 'complete';
    modules[key] = { status, issues: own };
  }
  const errorCount = issues.filter((i) => i.level === 'error').length;
  const warningCount = issues.filter((i) => i.level === 'warning').length;
  return { issues, modules, publishable: errorCount === 0, errorCount, warningCount };
}

// ── Prestation ────────────────────────────────────────────────────────────────
export function validateService(d: Partial<CatalogueService>): CatalogueValidationResult {
  const issues: CatalogueValidationIssue[] = [];

  if (!d.name || !d.name.trim()) issues.push(err('identite', 'Le nom est obligatoire.'));
  if (!d.shortDescription || !d.shortDescription.trim()) {
    issues.push(warn('identite', 'Une description courte améliore la fiche vitrine.'));
  }
  if (!d.duration || Number(d.duration) < 1) issues.push(err('identite', 'La durée est obligatoire.'));

  const price = Number(d.price);
  if (d.paymentType !== 'free') {
    if (!Number.isFinite(price) || price <= 0) issues.push(err('prix', 'Le prix est obligatoire.'));
  }
  if (d.paymentType === 'deposit') {
    const dv = Number(d.depositValue);
    if (!Number.isFinite(dv) || dv <= 0) issues.push(err('prix', "La valeur de l'acompte est requise."));
    if (d.depositType === 'percentage' && dv > 100) {
      issues.push(err('prix', "L'acompte en pourcentage ne peut pas dépasser 100 %."));
    }
    if (d.depositType === 'fixed' && Number.isFinite(price) && dv > price) {
      issues.push(err('prix', "L'acompte fixe ne peut pas dépasser le prix."));
    }
  }

  if (d.isBookable && (d.bookingLeadDays ?? 0) < 0) {
    issues.push(err('reservation', 'Le délai de réservation doit être positif.'));
  }
  if (!d.photos || d.photos.length === 0) {
    issues.push(warn('medias', 'Ajoutez au moins une photo pour la vitrine.'));
  }

  return aggregate(issues, ['identite', 'prix', 'reservation'], ['options', 'medias', 'vitrine']);
}

// ── Formation ─────────────────────────────────────────────────────────────────
export function validateTraining(
  d: Partial<CatalogueTraining>,
  sessions: CatalogueTrainingSession[] = [],
): CatalogueValidationResult {
  const issues: CatalogueValidationIssue[] = [];

  if (!d.name || !d.name.trim()) issues.push(err('identite', 'Le nom est obligatoire.'));
  if (!d.editorialHtml?.trim() && !d.description?.trim()) {
    issues.push(warn('identite', 'Ajoutez une description pour la vitrine.'));
  }

  const price = Number(d.price);
  if (!Number.isFinite(price) || price <= 0) issues.push(err('prix', 'Le prix est obligatoire.'));

  if (!d.coverImage?.trim()) issues.push(warn('medias', 'Une image de couverture est recommandée.'));

  if (d.type === 'presentiel') {
    const active = sessions.filter((s) => !s.isCanceled);
    if (active.length === 0) issues.push(err('sessions', 'Au moins une session est requise.'));
    if (active.some((s) => s.maxClients < 1)) issues.push(err('sessions', 'Chaque session doit avoir des places.'));
    return aggregate(issues, ['identite', 'prix', 'sessions'], ['medias', 'vitrine']);
  }

  // distanciel
  if (!d.accessLifetime && !d.accessUrl?.trim()) {
    issues.push(warn('acces', "Renseignez le lien d'accès ou activez l'accès à vie."));
  }
  if (d.accessDeliveryMode === 'immediate' && !d.isRefundableAfterAccess) {
    // Accès immédiat sans remboursement → la renonciation légale est requise côté checkout.
    issues.push(warn('acces', 'Accès immédiat : la renonciation légale au délai de rétractation sera demandée au client.'));
  }
  // 'contenu' (chapitres/leçons) = optionnel pour la publication (une formation peut être livrée via accessUrl).
  return aggregate(issues, ['identite', 'prix', 'acces'], ['contenu', 'medias', 'vitrine']);
}

// ── Cartes cadeaux ─────────────────────────────────────────────────────────────
export function validateGiftCardConfig(
  d: Partial<CatalogueGiftCardConfig>,
  hasActiveTemplate: boolean,
): CatalogueValidationResult {
  const issues: CatalogueValidationIssue[] = [];

  const min = Number(d.minAmount);
  const max = Number(d.maxAmount);
  if (!Number.isFinite(min) || min <= 0) issues.push(err('montants', 'Le montant minimum doit être positif.'));
  if (Number.isFinite(max) && max > 0 && Number.isFinite(min) && min > max) {
    issues.push(err('montants', 'Le minimum dépasse le maximum.'));
  }
  if ((d.presetAmounts ?? []).some((a) => !Number.isFinite(a) || a <= 0)) {
    issues.push(err('montants', 'Les montants suggérés doivent être positifs.'));
  }

  if (!hasActiveTemplate) issues.push(err('template', 'Aucun template de carte cadeau actif.'));

  return aggregate(issues, ['montants', 'template'], ['vitrine']);
}
