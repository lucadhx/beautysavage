// M8 — Type runtime notification : helpers d'affichage (couleur/icône depuis le snapshot
// de catégorie). Le snapshot est la SOURCE unique ; défaut bi-bell si absent.
import { describe, it, expect } from 'vitest';
import {
  notificationDisplayColor,
  notificationDisplayIcon,
  type RuntimeNotification,
} from './notifications';

const base: Pick<RuntimeNotification, 'categorySnapshot'> = {
  categorySnapshot: { name: 'Ventes', slug: 'ventes', icon: 'bi-cash', color: '#abc' },
};

describe('notifications runtime helpers (M8)', () => {
  it('couleur = couleur du snapshot de catégorie', () => {
    expect(notificationDisplayColor(base)).toBe('#abc');
    expect(notificationDisplayColor({ categorySnapshot: null })).toBeNull();
    expect(notificationDisplayColor({ categorySnapshot: { name: null, slug: null, icon: null, color: '' } })).toBeNull();
  });

  it('icône = icône du snapshot, défaut bi-bell', () => {
    expect(notificationDisplayIcon(base)).toBe('bi-cash');
    expect(notificationDisplayIcon({ categorySnapshot: null })).toBe('bi-bell');
    expect(notificationDisplayIcon({ categorySnapshot: { name: null, slug: null, icon: '', color: null } })).toBe('bi-bell');
  });
});
