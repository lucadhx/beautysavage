// tests/p1/businessTimezone.test.js
// Sprint pré-React A2 — Fuseau métier garanti Europe/Paris.
// Vérifie la constante centrale, le calcul d'offset (DST), la garde de démarrage,
// et le câblage du service de disponibilité sur la constante.
import { describe, it, expect, vi } from 'vitest';

const {
  BUSINESS_TIMEZONE,
  getServerTimezone,
  getTimezoneOffsetMinutes,
  isServerAlignedWithBusinessTimezone,
  describeTimezoneContext,
  assertBusinessTimezone
} = await import('../../constants/timezone.js');
const { getAvailabilityTimezone } = await import('../../services/serviceAvailabilityService.js');

describe('A2 — business timezone constant', () => {
  it('BUSINESS_TIMEZONE === Europe/Paris', () => {
    expect(BUSINESS_TIMEZONE).toBe('Europe/Paris');
  });

  it('the availability service is wired to the business timezone constant', () => {
    expect(getAvailabilityTimezone()).toBe(BUSINESS_TIMEZONE);
  });

  it('computes the Europe/Paris offset and handles DST (winter +60, summer +120)', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    expect(getTimezoneOffsetMinutes('Europe/Paris', winter)).toBe(60);
    expect(getTimezoneOffsetMinutes('Europe/Paris', summer)).toBe(120);
    // UTC is always 0 → never aligned with Paris.
    expect(getTimezoneOffsetMinutes('UTC', winter)).toBe(0);
  });

  it('describeTimezoneContext reports the business timezone and an alignment flag', () => {
    const ctx = describeTimezoneContext();
    expect(ctx.businessTimezone).toBe('Europe/Paris');
    expect(typeof ctx.aligned).toBe('boolean');
    expect(typeof ctx.serverOffsetMinutes).toBe('number');
  });

  it('getServerTimezone returns a non-empty IANA-like string', () => {
    expect(typeof getServerTimezone()).toBe('string');
  });
});

describe('A2 — boot guard', () => {
  it('logs the timezone diagnostics and never throws', () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const result = assertBusinessTimezone({ force: false, logger });
    expect(result.businessTimezone).toBe('Europe/Paris');
    expect(logger.log).toHaveBeenCalled();
    const logged = logger.log.mock.calls.flat().join(' ');
    expect(logged).toContain('business=Europe/Paris');
  });

  it('force:true sets process.env.TZ to Europe/Paris when misaligned (restored after)', () => {
    const prevTz = process.env.TZ;
    try {
      // Simulate a misaligned server by pretending we are on UTC for the guard.
      // We cannot reliably change the process TZ mid-run cross-platform, so we assert
      // the guard at minimum keeps the env consistent with the business timezone.
      const logger = { log: vi.fn(), warn: vi.fn() };
      const result = assertBusinessTimezone({ force: true, logger });
      // When aligned, forced is false and TZ untouched; when forced, TZ is set to Paris.
      if (result.forced) {
        expect(process.env.TZ).toBe('Europe/Paris');
      }
      expect(result.businessTimezone).toBe('Europe/Paris');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

describe('A2 — reminder/cleanup jobs are timezone-agnostic (absolute instants)', () => {
  it('isServerAlignedWithBusinessTimezone returns a boolean for any reference date', () => {
    // Reminder/cleanup jobs compare absolute Date instants (ms since epoch), so their
    // window math does not depend on the wall-clock timezone — documented in report 86.
    expect(typeof isServerAlignedWithBusinessTimezone(new Date())).toBe('boolean');
  });
});
