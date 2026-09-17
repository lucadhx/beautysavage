// tests/p1/notificationTargetService.test.js
// M3A — Service de ciblage : resolve/normalize/canRead + triggerNotification (DB).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { startMemoryDb, stopMemoryDb, clearDatabase } from '../setup/testDb.js';
import Notification from '../../models/Notification.js';
import NotificationConfig from '../../models/NotificationConfig.js';
import {
  resolveNotificationTargetRole,
  normalizeNotificationTargetRole,
  canReadNotification,
  assertCanReadNotification,
  DEFAULT_NOTIFICATION_TARGET_ROLE
} from '../../services/notificationTargetService.js';
import { triggerNotification } from '../../services/notificationService.js';

describe('notificationTargetService — fonctions pures', () => {
  it('default = admin', () => {
    expect(DEFAULT_NOTIFICATION_TARGET_ROLE).toBe('admin');
  });

  it('mapping admin (événements métier institut)', () => {
    for (const t of [
      'new_sale', 'booking_created', 'booking_cancelled_client', 'no_show_recorded',
      'refund_requested', 'new_client', 'formation_session_cancelled',
      'formation_distancielle_purchased', 'formation_presentielle_purchased'
    ]) {
      expect(resolveNotificationTargetRole(t, {})).toBe('admin');
    }
  });

  it('mapping dev (événements techniques/plateforme)', () => {
    for (const t of [
      'contract_payment_failed', 'webhook_failure', 'integrated_api_error',
      'commission_paid_to_platform', 'job_failed', 'system_error',
      'email_identity_verification_failed'
    ]) {
      expect(resolveNotificationTargetRole(t, {})).toBe('dev');
    }
  });

  it('type inconnu → admin par défaut', () => {
    expect(resolveNotificationTargetRole('totally_unknown_type', {})).toBe('admin');
  });

  it('type inconnu + createdFromDevContext → dev', () => {
    expect(resolveNotificationTargetRole('whatever', { createdFromDevContext: true })).toBe('dev');
  });

  it('payload.targetRole explicite gagne sur le mapping', () => {
    // new_sale mappe admin, mais override explicite dev.
    expect(resolveNotificationTargetRole('new_sale', { targetRole: 'dev' })).toBe('dev');
  });

  it('normalize : alias et casse', () => {
    expect(normalizeNotificationTargetRole('Admin')).toBe('admin');
    expect(normalizeNotificationTargetRole('manager')).toBe('admin');
    expect(normalizeNotificationTargetRole('DEV')).toBe('dev');
    expect(normalizeNotificationTargetRole('developer')).toBe('dev');
    expect(normalizeNotificationTargetRole('client')).toBeNull();
    expect(normalizeNotificationTargetRole('')).toBeNull();
    expect(normalizeNotificationTargetRole(null)).toBeNull();
  });

  it('canReadNotification : client jamais', () => {
    expect(canReadNotification({ role: 'client' }, { targetRole: 'admin' })).toBe(false);
    expect(canReadNotification(null, { targetRole: 'admin' })).toBe(false);
  });

  it('canReadNotification : dev seul lit dev ; admin+dev lisent admin', () => {
    expect(canReadNotification({ role: 'dev' }, { targetRole: 'dev' })).toBe(true);
    expect(canReadNotification({ role: 'admin' }, { targetRole: 'dev' })).toBe(false);
    expect(canReadNotification({ role: 'admin' }, { targetRole: 'admin' })).toBe(true);
    expect(canReadNotification({ role: 'dev' }, { targetRole: 'admin' })).toBe(true);
    // legacy (targetRole absent) traité comme admin
    expect(canReadNotification({ role: 'admin' }, {})).toBe(true);
  });

  it('assertCanReadNotification lève FORBIDDEN_NOTIFICATION_AUDIENCE', () => {
    expect(() => assertCanReadNotification({ role: 'admin' }, { targetRole: 'dev' }))
      .toThrowError(/Accès refusé/);
    try {
      assertCanReadNotification({ role: 'admin' }, { targetRole: 'dev' });
    } catch (e) {
      expect(e.code).toBe('FORBIDDEN_NOTIFICATION_AUDIENCE');
      expect(e.status).toBe(403);
    }
    expect(assertCanReadNotification({ role: 'dev' }, { targetRole: 'dev' })).toBe(true);
  });
});

describe('triggerNotification — persiste targetRole', () => {
  beforeAll(async () => {
    const uri = await startMemoryDb();
    await mongoose.connect(uri, { dbName: 'beautysavage-database' });
  });
  afterAll(async () => { await stopMemoryDb(); });
  beforeEach(async () => {
    await clearDatabase();
    await NotificationConfig.create({
      events: [
        { eventType: 'new_sale', label: 'Vente', isActive: true, category: 'ventes', targetType: 'all', titleTemplate: 'Vente {{saleId}}', messageTemplate: 'Montant {{amount}}' },
        { eventType: 'job_failed', label: 'Job', isActive: true, category: 'système', targetType: 'all', titleTemplate: 'Job échoué', messageTemplate: 'Job {{jobName}}' }
      ]
    });
  });

  it('ancien appelant (type métier) → targetRole résolu admin', async () => {
    await triggerNotification('new_sale', { saleId: 'S-1', amount: '120.00' });
    const n = await Notification.findOne({ eventType: 'new_sale' }).lean();
    expect(n).toBeTruthy();
    expect(n.targetRole).toBe('admin');
  });

  it('type technique → targetRole dev', async () => {
    await triggerNotification('job_failed', { jobName: 'reminderJob' });
    const n = await Notification.findOne({ eventType: 'job_failed' }).lean();
    expect(n.targetRole).toBe('dev');
  });

  it('targetRole explicite via options gagne', async () => {
    await triggerNotification('new_sale', { saleId: 'S-2', amount: '10.00' }, { targetRole: 'dev' });
    const n = await Notification.findOne({ eventType: 'new_sale', 'variables.saleId': 'S-2' }).lean();
    expect(n.targetRole).toBe('dev');
  });
});
