// M9 — Logique pure du centre : déclenchement pulse/shake + texte du bandeau.
import { describe, it, expect } from 'vitest';
import { shouldPulse, pulseBannerText } from './useNotifications';

describe('notification center — logique pure (M9)', () => {
  it('shouldPulse vrai uniquement si les non-lus augmentent', () => {
    expect(shouldPulse(1, 3)).toBe(true);
    expect(shouldPulse(3, 3)).toBe(false);
    expect(shouldPulse(5, 2)).toBe(false);
    expect(shouldPulse(Number.NaN, 2)).toBe(false);
  });

  it('pulseBannerText formate "+X notification(s)" ou null', () => {
    expect(pulseBannerText(1)).toBe('+1 notification');
    expect(pulseBannerText(3)).toBe('+3 notifications');
    expect(pulseBannerText(0)).toBeNull();
    expect(pulseBannerText(-2)).toBeNull();
  });
});
