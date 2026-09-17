// services/eventBusService.js
// Minimal in-process event bus (Phase 3).
//
// - emitEvent ALWAYS persists an EventLog (best-effort, never throws).
// - subscribers are in-process only; a failing subscriber NEVER breaks the
//   business action (errors are caught + logged safely).
// - no retry, no cross-process delivery, no automation triggers (V1).
//
// PRIVACY: payloads are redacted before persistence (no email/secret/token).

import EventLog from '../models/EventLog.js';
import { getEventDefinition, isKnownEvent } from '../constants/eventCatalog.js';

// eventName -> Set<handler>. '*' receives every event.
const subscribers = new Map();

const SENSITIVE_KEY = /(e?mail|secret|token|password|api[_-]?key|authorization|cookie|recipient|client_secret)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function redactValue(v) {
  if (typeof v === 'string') {
    if (EMAIL_RE.test(v)) return '[redacted-email]';
    return v.length > 500 ? `${v.slice(0, 500)}…` : v;
  }
  return v;
}

function redactSafe(obj, depth = 0) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) {
    if (depth > 4) return '[deep]';
    return obj.slice(0, 50).map(x => redactSafe(x, depth + 1));
  }
  if (typeof obj === 'object') {
    if (depth > 4) return '[deep]';
    const out = {};
    for (const [k, val] of Object.entries(obj)) {
      if (SENSITIVE_KEY.test(k)) { out[k] = '[redacted]'; continue; }
      out[k] = redactSafe(val, depth + 1);
    }
    return out;
  }
  return redactValue(obj);
}

/**
 * Subscribe an in-process handler to an event (or '*' for all).
 * @param {string} eventName
 * @param {(eventLog: object) => any} handler
 * @returns {() => void} unsubscribe
 */
export function subscribe(eventName, handler) {
  if (typeof handler !== 'function') throw new Error('[eventBus] handler must be a function');
  if (!subscribers.has(eventName)) subscribers.set(eventName, new Set());
  subscribers.get(eventName).add(handler);
  return () => subscribers.get(eventName)?.delete(handler);
}

/** Test/maintenance helper: remove all subscribers. */
export function clearSubscribers() {
  subscribers.clear();
}

/**
 * Deliver a persisted event to in-process subscribers. Never throws.
 * @param {object} eventLog
 */
export async function publishToSubscribers(eventLog) {
  const handlers = [
    ...(subscribers.get(eventLog.eventName) || []),
    ...(subscribers.get('*') || [])
  ];
  for (const handler of handlers) {
    try {
      await handler(eventLog);
    } catch (err) {
      console.error(`[eventBus] subscriber error for ${eventLog.eventName}:`, err?.message || err);
    }
  }
}

/**
 * Emit a domain event: persist an EventLog (best-effort) and notify subscribers.
 * Never throws — a logging/subscriber failure must not break the caller.
 * @param {string} eventName
 * @param {object} [payload] safe payload (no email/secret/token)
 * @param {object} [options] { actorType, actorId, source, contextType, contextId, traceId }
 * @returns {Promise<object|null>} the persisted EventLog (plain object) or null
 */
export async function emitEvent(eventName, payload = {}, options = {}) {
  const def = getEventDefinition(eventName);
  if (!isKnownEvent(eventName)) {
    console.warn(`[eventBus] emitting UNKNOWN event "${eventName}" (not in catalog).`);
  }

  const safePayload = redactSafe(payload || {});
  const record = {
    eventName,
    domain: def?.domain || 'unknown',
    version: def?.version || 1,
    actorType: options.actorType || 'system',
    actorId: options.actorId != null ? String(options.actorId) : null,
    source: options.source || null,
    contextType: options.contextType || payload?.contextType || null,
    contextId: options.contextId != null ? String(options.contextId) : (payload?.contextId != null ? String(payload.contextId) : null),
    payloadSafe: safePayload,
    traceId: options.traceId || null,
    emittedAt: new Date()
  };

  let saved = null;
  try {
    saved = await EventLog.create(record);
  } catch (err) {
    console.error(`[eventBus] could not persist EventLog for ${eventName}:`, err?.message || err);
    // Still notify subscribers with the in-memory record (best-effort).
    saved = null;
  }

  await publishToSubscribers(saved ? saved.toObject() : record);
  return saved ? saved.toObject() : null;
}

export default emitEvent;
