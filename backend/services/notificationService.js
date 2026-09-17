import Notification from '../models/Notification.js';
import NotificationConfig from '../models/NotificationConfig.js';
import PractitionerProfile from '../models/PractitionerProfile.js';
import {
  resolveNotificationTargetRole,
  normalizeNotificationTargetRole
} from './notificationTargetService.js';
import { buildNotificationPayloadFromTemplate } from './notificationTemplateRuntimeService.js';

function interpolateTemplate(template, variables) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}

// M8 — Le runtime « template » est ACTIF par défaut (fallback robuste : sans template
// publié, le comportement est strictement identique au legacy). Mettre la variable
// d'environnement à false/0/off/no pour revenir au legacy pur (rollback instantané).
function isTemplateRuntimeEnabled() {
  const v = String(process.env.NOTIFICATION_TEMPLATE_RUNTIME_ENABLED ?? '').trim().toLowerCase();
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return true;
}

/**
 * Déclenche une notification à partir d'un eventType et de variables.
 * Non bloquant — toujours appelé avec void, erreurs silencieuses.
 *
 * M3A — `targetRole` (audience admin|dev) est TOUJOURS persisté. Résolution
 * (priorité décroissante) : options.targetRole → variables.(__)targetRole →
 * eventConfig.targetRole → mapping par type. **Le moteur choisit le scope, jamais
 * le template.**
 *
 * M3B — `options.event` (corrélation event→notification) persisté (champs SAFE).
 *
 * M8 — Le moteur consomme désormais les NotificationTemplate PUBLIÉS (M7) :
 *   1. si `NOTIFICATION_TEMPLATE_RUNTIME_ENABLED` (défaut ON) et qu'un template publié
 *      existe pour la clé (`options.templateKey` ou `eventType`) → title/body rendus
 *      depuis le template, + categoryId/categorySnapshot/priority/persistent/action.
 *      `templateRuntimeStatus = 'template'`.
 *   2. sinon → fallback legacy (NotificationConfig.events) — comportement historique.
 *      `templateRuntimeStatus = 'fallback_template_missing'` (runtime ON) ou
 *      `'legacy_runtime_disabled'` (flag OFF).
 * La livraison (targetType/targetUserId/expiresAt) + le champ enum legacy `category`
 * restent pilotés par l'eventConfig (le slug M7 va dans categoryId/categorySnapshot,
 * jamais dans l'enum `category`). Aucun comportement supprimé, aucun throw.
 *
 * @param {string} eventType
 * @param {object} [variables]
 * @param {{targetRole?: 'admin'|'dev', templateKey?: string, event?: {eventId?: any, eventName?: string, contextType?: string, contextId?: any}}} [options]
 */
export async function triggerNotification(eventType, variables = {}, options = {}) {
  try {
    const config = await NotificationConfig.findOne().lean();
    const eventConfig = config?.events?.find(e => e.eventType === eventType && e.isActive) || null;

    // M8 — tentative de rendu depuis un template publié (best-effort, null si absent).
    const runtimeEnabled = isTemplateRuntimeEnabled();
    const templatePayload = runtimeEnabled
      ? await buildNotificationPayloadFromTemplate(eventType, variables, { templateKey: options?.templateKey })
      : null;

    // Sans template ET sans eventConfig → rien à créer (comportement historique préservé).
    if (!templatePayload && !eventConfig) return;

    // M3A — audience (panel) : admin | dev. Jamais null. JAMAIS issue du template.
    const targetRole =
      normalizeNotificationTargetRole(
        options?.targetRole ?? variables?.targetRole ?? variables?.__targetRole ?? eventConfig?.targetRole
      ) || resolveNotificationTargetRole(eventType, variables);

    // Livraison : pilotée par l'eventConfig si présent, sinon défaut 'all'.
    let targetType = eventConfig?.targetType || 'all';
    let targetUserId = null;
    if (targetType === 'user_concerned') {
      const practitionerProfileId = variables.userId;
      if (practitionerProfileId) {
        const profile = await PractitionerProfile.findById(practitionerProfileId)
          .select('userId').lean();
        targetUserId = profile?.userId || null;
      }
      targetType = targetUserId ? 'user' : 'all';
    }

    const lifetimeDays = config?.notificationLifetimeDays;
    const expiresAt =
      lifetimeDays > 0
        ? new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1000)
        : null;

    // M3B — corrélation event→notification (champs SAFE uniquement).
    const ev = options?.event || {};
    const eventId = ev.eventId ?? null;
    const eventName = ev.eventName != null ? String(ev.eventName) : null;
    const contextType = ev.contextType != null ? String(ev.contextType) : null;
    const contextId = ev.contextId != null ? String(ev.contextId) : null;

    // Contenu : template publié prioritaire, sinon legacy eventConfig.
    let title;
    let message;
    let templateRuntimeStatus;
    let templateKey = null;
    let templateVersion = null;
    let categoryId = null;
    let categorySnapshot = null;
    let priority = 'normal';
    let persistent = false;
    let action = null;
    let link = variables.link || null;
    let linkLabel = variables.linkLabel || null;
    let variablesSnapshot = null;

    if (templatePayload) {
      title = templatePayload.title;
      message = templatePayload.message;
      templateRuntimeStatus = templatePayload.templateRuntimeStatus; // 'template'
      templateKey = templatePayload.templateKey;
      templateVersion = templatePayload.templateVersion;
      categoryId = templatePayload.categoryId;
      categorySnapshot = templatePayload.categorySnapshot;
      priority = templatePayload.priority;
      persistent = templatePayload.persistent;
      action = templatePayload.action;
      link = templatePayload.link;
      linkLabel = templatePayload.linkLabel;
      variablesSnapshot = templatePayload.variablesSnapshot;
    } else {
      title = interpolateTemplate(eventConfig.titleTemplate, variables);
      message = interpolateTemplate(eventConfig.messageTemplate, variables);
      templateRuntimeStatus = runtimeEnabled ? 'fallback_template_missing' : 'legacy_runtime_disabled';
    }

    // Enum legacy `category` : jamais le slug M7 (validation). On garde l'eventConfig
    // si présent, sinon le défaut du modèle ('système').
    const legacyCategory = eventConfig?.category || undefined;

    await Notification.create({
      title,
      message,
      ...(legacyCategory ? { category: legacyCategory } : {}),
      targetType,
      targetRole,
      targetUserId: targetUserId || null,
      link,
      linkLabel,
      eventType,
      variables,
      eventId,
      eventName,
      contextType,
      contextId,
      expiresAt,
      // M8 — provenance template runtime
      templateKey,
      templateVersion,
      categoryId,
      categorySnapshot,
      priority,
      persistent,
      action,
      templateRuntimeStatus,
      variablesSnapshot
    });
  } catch (err) {
    console.error('[notificationService] triggerNotification error:', eventType, err?.message || err);
  }
}
