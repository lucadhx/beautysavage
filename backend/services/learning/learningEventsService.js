// C2 — Événements Learning : formation.started, lesson.completed, formation.completed,
// presence.confirmed. Mail (commerciale→client, via moteur M2/M3, idempotent par contextId) +
// notification interne (admin, via moteur M8). Best-effort : jamais bloquant (try/catch, void).
import { triggerNotification } from '../notificationService.js';
import { dispatchMailForEvent } from '../mail/mailEventDispatchService.js';
import { emitEvent } from '../eventBusService.js';

function clientContext(user) {
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return { email: user?.email, name: name || user?.email };
}

function fmtDate(date) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '—';
  }
}

// Envoi mail via le moteur événementiel (ledger MailEventDelivery → idempotent par contextId).
async function sendMail(eventName, contextId, user, variables) {
  try {
    await dispatchMailForEvent(
      { eventName, contextType: 'formation', contextId },
      { context: { client: clientContext(user), contextType: 'formation', contextId, variables } }
    );
  } catch (err) {
    console.error(`[learningEvents] mail ${eventName} échec`, err?.message || err);
  }
}

// Trace EventLog (corrélation Customer360 timeline) — best-effort.
async function audit(eventName, contextId, related) {
  try {
    await emitEvent(
      eventName,
      { contextType: 'formation', contextId, context: { related } },
      { contextType: 'formation', contextId }
    );
  } catch {
    /* best-effort */
  }
}

export async function onFormationStarted(user, formation) {
  const fid = String(formation._id);
  const uid = String(user._id);
  await audit('formation.started', fid, { clientId: uid, formationId: fid });
  void triggerNotification('formation_started', {
    clientName: clientContext(user).name,
    formationName: formation.name || '—',
    link: '/gestion.html?page=formations',
    linkLabel: 'Voir les formations'
  });
  await sendMail('formation.started', `started:${fid}:${uid}`, user, {
    firstName: user.firstName || '',
    formationName: formation.name || ''
  });
}

export async function onLessonCompleted(user, formation, lesson) {
  const fid = String(formation._id);
  const uid = String(user._id);
  void triggerNotification('lesson_completed', {
    clientName: clientContext(user).name,
    lessonName: lesson.title || '—',
    formationName: formation.name || '—',
    link: '/gestion.html?page=formations',
    linkLabel: 'Voir les formations'
  });
  await sendMail('lesson.completed', `lesson:${String(lesson._id)}:${uid}`, user, {
    firstName: user.firstName || '',
    lessonName: lesson.title || '',
    formationName: formation.name || ''
  });
}

export async function onFormationCompleted(user, formation, { attestationReady = false } = {}) {
  const fid = String(formation._id);
  const uid = String(user._id);
  await audit('formation.completed', fid, { clientId: uid, formationId: fid });
  void triggerNotification('formation_completed', {
    clientName: clientContext(user).name,
    formationName: formation.name || '—',
    link: '/gestion.html?page=formations',
    linkLabel: 'Voir les formations'
  });
  await sendMail('formation.completed', `completed:${fid}:${uid}`, user, {
    firstName: user.firstName || '',
    formationName: formation.name || '',
    // C3 — l'attestation est téléchargeable dans « Mes formations » (lien authentifié in-app).
    attestationLine: attestationReady ? 'Votre attestation de réussite est disponible dans « Mes formations ».' : ''
  });
}

export async function onPresenceConfirmed(user, formation, session) {
  const sid = String(session._id);
  const uid = String(user._id);
  await audit('formation.attendance_validated', sid, {
    clientId: uid,
    formationId: String(formation._id),
    sessionId: sid
  });
  void triggerNotification('presence_confirmed', {
    clientName: clientContext(user).name,
    formationName: formation.name || '—',
    sessionDate: fmtDate(session.startDate),
    link: '/gestion.html?page=planning',
    linkLabel: 'Voir le planning'
  });
  await sendMail('presence.confirmed', `presence:${sid}:${uid}`, user, {
    firstName: user.firstName || '',
    formationName: formation.name || '',
    sessionDate: fmtDate(session.startDate)
  });
}
