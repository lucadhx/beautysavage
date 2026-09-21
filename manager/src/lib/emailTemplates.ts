import type {
  EmailReadiness,
  EmailTemplateSummary,
  EmailVariable,
  EmailVariableType,
} from '@/types';

/**
 * Logique des templates e-mail côté Manager — module PUR (aucun React, aucun
 * DOM), donc testable directement sous Node.
 *
 * ─── CE QUE CE MODULE N'EST PLUS (L12.1) ─────────────────────────────────────
 *
 * Il outillait un ÉDITEUR : état « modifié », brouillon dérivé d'un template,
 * champs changés, insertion de variable au curseur, groupement d'erreurs de
 * validation, libellés d'origine de version. Toutes ces fonctions servaient une
 * base de modèles locale que ce projet ne possède plus.
 *
 * Le contenu des e-mails appartient au Panel — il en est la seule autorité. Ce
 * Manager consulte, prévisualise, diagnostique et teste. Il n'écrit rien.
 *
 * Ce qui reste traduit : des codes stables en étiquettes lisibles, et l'ordre
 * d'affichage. Ce module ne juge toujours rien, et il ne décide toujours pas de
 * la sécurité — un contrôle côté client ne protège de rien, il se contourne
 * avec un curl.
 */

// --- Onglets -----------------------------------------------------------------

/**
 * Trois onglets, contre cinq auparavant.
 *
 * `editor` a disparu avec l'édition. `versions` aussi : l'historique est celui
 * du Panel, et le consulter ici aurait donné à croire qu'on peut y revenir —
 * la restauration est un acte d'autorité, elle se fait là où l'autorité est.
 */
export const VIEW_TABS = ['preview', 'variables', 'guide'] as const;
export type ViewTab = (typeof VIEW_TABS)[number];

export const TAB_LABEL: Record<ViewTab, string> = {
  preview: 'Aperçu',
  variables: 'Variables',
  guide: 'Guide',
};

export function isViewTab(value: string): value is ViewTab {
  return (VIEW_TABS as readonly string[]).includes(value);
}

// --- Variables ---------------------------------------------------------------

export const VARIABLE_TYPE_LABEL: Record<EmailVariableType, string> = {
  TEXT: 'Texte',
  EMAIL: 'Adresse e-mail',
  PHONE: 'Téléphone',
  DATE: 'Date',
  DATETIME: 'Date et heure',
  MONEY: 'Montant',
  URL: 'Lien',
  BOOLEAN: 'Oui / non',
  SAFE_HTML: 'Texte enrichi',
};

const UNKNOWN_VARIABLE_TYPE_LABEL = 'Valeur';

export function variableTypeLabel(type: EmailVariableType): string {
  return VARIABLE_TYPE_LABEL[type] ?? UNKNOWN_VARIABLE_TYPE_LABEL;
}

/**
 * Les obligatoires d'abord, puis l'ordre du contrat.
 *
 * C'est l'ordre de lecture utile : ce qui DOIT être fourni se lit avant ce qui
 * peut l'être. Trier alphabétiquement mélangerait les deux.
 */
export function orderedVariables(variables: EmailVariable[]): EmailVariable[] {
  return [...variables].sort((a, b) => Number(b.required) - Number(a.required));
}

// --- Utilisabilité -----------------------------------------------------------

/**
 * POURQUOI CE MODÈLE NE PARTIRAIT PAS — en une étiquette.
 *
 * Ces codes viennent du Panel, qui les produit sur le MÊME chemin que l'envoi.
 * Ils ne décrivent donc pas un défaut de cet écran : ils décrivent ce qui
 * arriverait à un vrai e-mail. Chaque libellé nomme l'objet ET l'endroit où
 * corriger — un exploitant du Manager ne peut RIEN corriger ici, et le lui
 * laisser croire est la pire réponse possible.
 */
export const UNUSABLE_CODE_LABEL: Record<string, string> = {
  EMAIL_TEMPLATE_NOT_CONFIGURED: 'Aucun contenu configuré pour ce projet',
  EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT: 'Ce projet ne déclare pas utiliser ce modèle',
  PANEL_EMAIL_TEMPLATE_DISABLED: 'Modèle désactivé',
  PANEL_EMAIL_TEMPLATE_UNKNOWN: 'Modèle inconnu de la plateforme',
  PANEL_EMAIL_TEMPLATE_SCOPE_FORBIDDEN_FOR_CODE: 'Ce modèle n’appartient pas à ce projet',
  RENDER_FAILED: 'Contenu non rendable en l’état',
};

const UNKNOWN_UNUSABLE_LABEL = 'Envoi impossible en l’état';

export function unusableCodeLabel(code: string | null): string {
  if (!code) return UNKNOWN_UNUSABLE_LABEL;
  return UNUSABLE_CODE_LABEL[code] ?? UNKNOWN_UNUSABLE_LABEL;
}

/**
 * Les modèles inutilisables d'abord.
 *
 * Une liste où le seul modèle cassé se trouve en douzième position se lit comme
 * une liste saine. Ce qui demande une action se voit en premier.
 */
export function orderedTemplates(templates: EmailTemplateSummary[]): EmailTemplateSummary[] {
  return [...templates].sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? 1 : -1;
    return a.name.localeCompare(b.name, 'fr');
  });
}

// --- Prérequis d'envoi -------------------------------------------------------

export const READINESS_CODE_LABEL: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'Envoi non configuré',
  PROVIDER_KEY_MISSING: "Accès au service d'envoi manquant",
  PROVIDER_NOT_VERIFIED: 'Accès jamais vérifié',
  PROVIDER_NOT_VALIDATED: 'Accès jamais vérifié',
  PROVIDER_UNREACHABLE: "Service d'envoi injoignable",
  PROVIDER_UNAVAILABLE: "Service d'envoi indisponible",
  SENDER_NOT_CONFIGURED: 'Aucun expéditeur',
  TEMPLATE_NOT_CONFIGURED: 'Aucun contenu configuré pour ce projet',
  TEMPLATE_DISABLED: 'Modèle désactivé',
  TEMPLATE_INVALID: 'Contenu invalide',
  EMAIL_TEMPLATE_NOT_CONFIGURED: 'Aucun contenu configuré pour ce projet',
  EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT: 'Ce projet ne déclare pas utiliser ce modèle',
  PANEL_EMAIL_TEMPLATE_DISABLED: 'Modèle désactivé',
  RECIPIENT_INVALID: 'Destinataire invalide',
  NO_RECIPIENT: 'Aucun destinataire',
  UNKNOWN_TEMPLATE: 'Modèle inconnu',
  TEMPLATE_AUTHORITY_UNREACHABLE: 'Plateforme injoignable',
};

const UNKNOWN_READINESS_LABEL = "Condition d'envoi non remplie";

export function readinessCodeLabel(code: string): string {
  return READINESS_CODE_LABEL[code] ?? UNKNOWN_READINESS_LABEL;
}

/**
 * L'expéditeur manquant est-il la cause du blocage ?
 *
 * Ce cas mérite un traitement à part : c'est le seul dont la résolution ne se
 * trouve ni dans cet écran ni dans le Panel des modèles — il faut renseigner
 * l'expéditeur global. Le code vient du contrat backend.
 */
export function isSenderMissing(readiness: EmailReadiness | null): boolean {
  return Boolean(readiness?.blockers.some((b) => b.code === 'SENDER_NOT_CONFIGURED'));
}

// --- Aperçu ------------------------------------------------------------------

/**
 * Largeurs d'aperçu. 375 px = iPhone SE/12 mini, la largeur la plus contraignante
 * encore courante ; 600 px est la largeur canonique d'un e-mail (au-delà, Outlook
 * coupe).
 */
export const PREVIEW_WIDTHS = { desktop: 600, mobile: 375 } as const;
export type PreviewDevice = keyof typeof PREVIEW_WIDTHS;

export function previewWidth(device: PreviewDevice): number {
  return PREVIEW_WIDTHS[device];
}
