// services/devAlertService.js
// P1-6 — Alertes techniques à destination de l'espace Dev (audience 'dev').
//
// Jusqu'ici, les pannes techniques (webhook définitivement en échec, erreur de rendu/envoi
// carte cadeau, erreur système) n'émettaient AUCUNE communication : seuls des WebhookFailureLog
// ou des console.error étaient écrits (le code `collectAdminAndDevEmails` était mort). Ce service
// branche `triggerNotification` sur ces points de panne, en ciblant explicitement l'audience 'dev'.
//
// Best-effort STRICT : ne throw jamais, toujours appelé avec `void`. Une alerte ratée ne doit
// jamais aggraver la panne qu'elle signale. Aucune donnée sensible (payload, secret, e-mail) —
// seuls des identifiants techniques et messages courts déjà « safe ».

import { triggerNotification } from './notificationService.js';

const MAX_MSG = 240;

function safeShort(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, MAX_MSG);
}

/**
 * Émet une alerte technique dans l'espace Dev. Non bloquant.
 * @param {string} eventType type de notification dev (ex. 'webhook_failure', 'system_error')
 * @param {object} [variables] variables SAFE du template (identifiants/messages courts)
 * @param {object} [options] options transmises à triggerNotification (event corrélé…)
 */
export function notifyDevAlert(eventType, variables = {}, options = {}) {
  try {
    const safeVars = {};
    for (const [k, v] of Object.entries(variables || {})) {
      safeVars[k] = typeof v === 'number' ? v : safeShort(v);
    }
    void triggerNotification(eventType, safeVars, { ...options, targetRole: 'dev' });
  } catch (err) {
    // Une alerte ratée ne doit jamais casser le flux appelant.
    console.error('[devAlert] notifyDevAlert error:', eventType, err?.message || err);
  }
}

export default notifyDevAlert;
