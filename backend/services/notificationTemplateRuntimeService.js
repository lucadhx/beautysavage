// services/notificationTemplateRuntimeService.js
// M8 — Runtime des templates de notification : fait le pont entre le moteur d'envoi
// (`triggerNotification`) et les NotificationTemplate publiés (M7) + NotificationCategory.
//
// INVARIANTS (hérités de M7/M3A) :
//   - Le template = CONTENU PUR. Il ne porte JAMAIS de scope/targetRole/email.
//     => Ce service ne résout AUCUNE cible. Le moteur (M3A) choisit admin/dev.
//   - La couleur/icône viennent de la NotificationCategory référencée, jamais du template.
//   - Best-effort : aucune fonction ne throw vers l'appelant ; en cas d'absence/erreur,
//     on retourne null et le moteur retombe sur le legacy (NotificationConfig).
//
// Réutilise `getPublishedTemplate` (versioning M7) pour ne pas dupliquer la logique de
// résolution du publié.
import { getPublishedTemplate } from './notificationTemplateVersioningService.js';
import NotificationCategory from '../models/NotificationCategory.js';
import { NOTIFICATION_PRIORITIES } from '../models/NotificationTemplate.js';

// Interpolation {{variable}} — même grammaire que le studio (lettres/chiffres, casse libre).
const VAR_RE = /\{\{\s*([a-zA-Z0-9]+)\s*}}/g;

// Clés de variables considérées sensibles : jamais copiées dans variablesSnapshot.
const SENSITIVE_KEY_RE = /(email|mail|secret|token|password|motdepasse|apikey|api_key|authorization|cookie|card|iban|phone|tel|ssn)/i;
// Valeur ressemblant à un e-mail : neutralisée même si la clé paraît neutre.
const EMAIL_VALUE_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function normKey(value) {
  return String(value || '').trim().toLowerCase() || null;
}

function normPriority(value) {
  const v = String(value || '').trim().toLowerCase();
  return NOTIFICATION_PRIORITIES.includes(v) ? v : 'normal';
}

/**
 * Récupère le template publié pour une clé (ou null). Best-effort (jamais de throw).
 * @param {string} templateKey
 * @returns {Promise<object|null>}
 */
export async function getPublishedNotificationTemplate(templateKey) {
  const key = normKey(templateKey);
  if (!key) return null;
  try {
    return await getPublishedTemplate(key);
  } catch (err) {
    console.error('[notifTemplateRuntime] getPublished error:', key, err?.message || err);
    return null;
  }
}

/**
 * Résout le template applicable pour un type d'événement.
 * Par défaut `templateKey === eventType` (1 clé par type) ; un `templateKey` explicite
 * (options du moteur) a priorité.
 * @param {string} eventType
 * @param {string|null} [templateKey]
 * @returns {Promise<object|null>}
 */
export async function resolveNotificationTemplateForType(eventType, templateKey = null) {
  return getPublishedNotificationTemplate(templateKey || eventType);
}

/**
 * Interpole title/body d'un template avec les variables fournies.
 * - clé connue (présente dans `variables`) → valeur (String) ;
 * - clé absente → chaîne vide (rendu propre, jamais de "{{x}}" résiduel à l'écran).
 * Notification = TEXTE : on neutralise tout balisage HTML résiduel.
 * @param {object} template
 * @param {object} [variables]
 * @returns {{ title: string, body: string, usedVariables: string[], missingVariables: string[] }}
 */
export function renderNotificationTemplate(template, variables = {}) {
  const vars = variables && typeof variables === 'object' ? variables : {};
  const used = new Set();
  const missing = new Set();

  const render = (input) =>
    String(input || '').replace(VAR_RE, (match, rawKey) => {
      const key = rawKey;
      used.add(key.toLowerCase());
      // résolution tolérante à la casse
      let value;
      if (vars[key] !== undefined) value = vars[key];
      else {
        const lower = key.toLowerCase();
        const hit = Object.keys(vars).find((k) => k.toLowerCase() === lower);
        value = hit !== undefined ? vars[hit] : undefined;
      }
      if (value === undefined || value === null) {
        missing.add(key.toLowerCase());
        return '';
      }
      return String(value);
    });

  const stripHtml = (s) => s.replace(/<[^>]*>/g, '').trim();

  return {
    title: stripHtml(render(template?.title)),
    body: stripHtml(render(template?.body)),
    usedVariables: Array.from(used),
    missingVariables: Array.from(missing)
  };
}

/**
 * Charge le snapshot SAFE d'une catégorie (name/slug/icon/color) depuis son id.
 * @param {*} categoryId
 * @returns {Promise<{name:string|null,slug:string|null,icon:string|null,color:string|null}|null>}
 */
export async function getCategorySnapshot(categoryId) {
  if (!categoryId) return null;
  try {
    const cat = await NotificationCategory.findById(categoryId)
      .select('name slug icon color')
      .lean();
    if (!cat) return null;
    return {
      name: cat.name ?? null,
      slug: cat.slug ?? null,
      icon: cat.icon ?? null,
      color: cat.color ?? null
    };
  } catch (err) {
    console.error('[notifTemplateRuntime] category snapshot error:', err?.message || err);
    return null;
  }
}

/**
 * Copie SANITIZÉE des variables pour persistance (variablesSnapshot).
 * Supprime les clés sensibles (email/secret/token…) et toute valeur ressemblant à un e-mail.
 * Ne conserve que des scalaires (string/number/boolean) — pas d'objets imbriqués.
 * @param {object} variables
 * @returns {object}
 */
export function sanitizeVariablesSnapshot(variables = {}) {
  const out = {};
  if (!variables || typeof variables !== 'object') return out;
  for (const [key, value] of Object.entries(variables)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (value === null || value === undefined) continue;
    const t = typeof value;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') continue;
    if (t === 'string' && EMAIL_VALUE_RE.test(value)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Construit la charge de contenu d'une notification À PARTIR d'un template publié.
 * Retourne `null` si aucun template publié (le moteur fera le fallback legacy).
 * NE résout PAS la cible (targetRole/targetType) : c'est le rôle du moteur (M3A).
 *
 * @param {string} eventType
 * @param {object} [variables]
 * @param {{ templateKey?: string|null }} [options]
 * @returns {Promise<null | {
 *   templateKey: string, templateVersion: number|null,
 *   title: string, message: string,
 *   categoryId: any, categorySnapshot: object|null,
 *   priority: string, persistent: boolean, action: string|null,
 *   link: string|null, linkLabel: string|null,
 *   variablesSnapshot: object, templateRuntimeStatus: 'template'
 * }>}
 */
export async function buildNotificationPayloadFromTemplate(eventType, variables = {}, options = {}) {
  try {
    const template = await resolveNotificationTemplateForType(eventType, options?.templateKey || null);
    if (!template) return null;

    const { title, body } = renderNotificationTemplate(template, variables);
    const categorySnapshot = await getCategorySnapshot(template.categoryId);

    return {
      templateKey: normKey(template.templateKey),
      templateVersion: typeof template.version === 'number' ? template.version : null,
      title,
      message: body,
      categoryId: template.categoryId || null,
      categorySnapshot,
      priority: normPriority(template.priority),
      persistent: Boolean(template.persistent),
      action: template.action ? String(template.action) : null,
      // Le lien cliquable reste piloté par les variables (le template ne porte pas d'URL).
      link: variables?.link || null,
      linkLabel: variables?.linkLabel || null,
      variablesSnapshot: sanitizeVariablesSnapshot(variables),
      templateRuntimeStatus: 'template'
    };
  } catch (err) {
    console.error('[notifTemplateRuntime] buildPayload error:', eventType, err?.message || err);
    return null;
  }
}

export default {
  getPublishedNotificationTemplate,
  resolveNotificationTemplateForType,
  renderNotificationTemplate,
  getCategorySnapshot,
  sanitizeVariablesSnapshot,
  buildNotificationPayloadFromTemplate
};
