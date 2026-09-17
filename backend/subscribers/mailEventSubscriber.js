// subscribers/mailEventSubscriber.js
// M2 — Écoute les events listés dans mailDispatchRules et délègue au moteur de dispatch par rôles.
// flag MAIL_ROLE_RESOLVER_ENABLED=false → no-op. Best-effort : ne casse JAMAIS l'action métier.
import { subscribe } from '../services/eventBusService.js';
import { listDispatchableEventNames, isMailRoleResolverEnabled, getMailDispatchRule } from '../constants/mailDispatchRules.js';
import { dispatchMailForEvent } from '../services/mail/mailEventDispatchService.js';
import { buildMailVariablesForRule } from '../services/mail/mailEventVariableBuilder.js';

export async function handleMailEvent(eventLog) {
  try {
    if (!isMailRoleResolverEnabled()) return; // flag off → no-op (envois directs legacy inchangés)

    const rule = getMailDispatchRule(eventLog?.eventName);
    if (!rule) return;

    let context = {};
    let templateKeyOverride = null;

    // M3C — Règle ACTIVE (migrée) : on résout client + variables (parité avec le direct)
    // et on construit le contexte d'envoi. Les règles SHADOW gardent le comportement M2
    // (contexte vide → dispatchMailForEvent enregistre skipped_duplicate_direct_sender).
    const isActive = rule.enabled && !rule.directSenderExists;
    if (isActive) {
      const built = await buildMailVariablesForRule(rule, eventLog);
      if (built) {
        context = {
          contextType: rule.contextType,
          contextId: eventLog?.contextId,
          client: built.client || null,
          variables: built.variables || {}
        };
        templateKeyOverride = built.templateKey || null;
      }
    }

    await dispatchMailForEvent({
      eventName: eventLog?.eventName,
      contextType: eventLog?.contextType,
      contextId: eventLog?.contextId,
      payloadSafe: eventLog?.payloadSafe
    }, { context, templateKeyOverride });
  } catch (err) {
    // Best-effort : on n'interrompt jamais l'émetteur d'event.
    console.error('[mailEventSubscriber] handler error:', err?.message || err);
  }
}

// Register (Set dedup côté bus ⇒ idempotent à l'appel).
export function registerMailEventSubscribers() {
  for (const eventName of listDispatchableEventNames()) {
    subscribe(eventName, handleMailEvent);
  }
}

export default registerMailEventSubscribers;
