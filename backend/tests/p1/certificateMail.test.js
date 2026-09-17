// FORMATION-EVALUATION — Intégration Communication Center : e-mail « diplôme » avec PJ + notif.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ dispatched: [], notifs: [], events: [] }));
vi.mock('../../services/mail/mailEventDispatchService.js', () => ({
  dispatchTemplateByRoles: vi.fn(async (a) => { h.dispatched.push(a); return { status: 'sent' }; })
}));
vi.mock('../../services/notificationService.js', () => ({
  triggerNotification: vi.fn(async (t, v) => { h.notifs.push({ t, v }); })
}));
vi.mock('../../services/eventBusService.js', () => ({
  emitEvent: vi.fn(async (name) => { h.events.push(name); })
}));

const { onEvaluationAccepted, onEvaluationRefused } = await import('../../services/evaluation/evaluationEventsService.js');

const user = { _id: 'u1', firstName: 'Alice', email: 'alice@bs.test' };
const formation = { _id: 'f1', name: 'Formation X' };
const attempt = { _id: 'a1', attemptNumber: 1 };

beforeEach(() => { h.dispatched.length = 0; h.notifs.length = 0; h.events.length = 0; });

describe('e-mail diplôme (accepté)', () => {
  it('envoie evaluation_accepted au client avec le PDF en pièce jointe + notif admin', async () => {
    await onEvaluationAccepted(user, formation, attempt, { certificate: { certificateNumber: 'BS-DIP-Z' }, pdfBase64: 'QUFB' });
    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0].templateKey).toBe('evaluation_accepted');
    expect(h.dispatched[0].toRole).toBe('client');
    expect(h.dispatched[0].attachments[0].content).toBe('QUFB');
    expect(h.dispatched[0].variables.formationtitle).toBe('Formation X');
    expect(h.notifs.some((n) => n.t === 'evaluation_accepted')).toBe(true);
    // events audit : accepted + certificate.generated + certificate.sent
    expect(h.events).toContain('training.evaluation.accepted');
    expect(h.events).toContain('training.certificate.generated');
    expect(h.events).toContain('training.certificate.sent');
  });
});

describe('e-mail refus', () => {
  it('envoie evaluation_refused avec le motif', async () => {
    await onEvaluationRefused(user, formation, attempt, { comment: 'À retravailler' });
    expect(h.dispatched[0].templateKey).toBe('evaluation_refused');
    expect(h.dispatched[0].variables.reason).toBe('À retravailler');
    expect(h.notifs.some((n) => n.t === 'evaluation_refused')).toBe(true);
    expect(h.events).toContain('training.evaluation.refused');
  });
});
