import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import {
  ThemeProvider,
  themeToCssVars,
  mergeTheme,
  normalizeHex,
  defaultVitrineTheme,
  defaultPanelTheme,
} from './index';

beforeEach(() => {
  document.documentElement.removeAttribute('style');
});

describe('themeToCssVars', () => {
  it('expose toutes les CSS variables de couleur attendues', () => {
    const vars = themeToCssVars(defaultVitrineTheme);
    for (const key of [
      '--bs-color-background',
      '--bs-color-surface',
      '--bs-color-surface-elevated',
      '--bs-color-text',
      '--bs-color-muted',
      '--bs-color-primary',
      '--bs-color-primary-hover',
      '--bs-color-secondary',
      '--bs-color-accent',
      '--bs-color-border',
      '--bs-color-success',
      '--bs-color-warning',
      '--bs-color-danger',
      '--bs-radius',
      '--bs-shadow',
      '--bs-font-sans',
      '--bs-space-1',
    ]) {
      expect(vars[key], `manque ${key}`).toBeTruthy();
    }
  });
});

describe('mergeTheme', () => {
  it('fusionne une surcharge partielle sur le défaut', () => {
    const merged = mergeTheme(defaultVitrineTheme, { colors: { primary: '#123456' } });
    expect(merged.colors.primary).toBe('#123456');
    expect(merged.colors.surface).toBe(defaultVitrineTheme.colors.surface);
  });
  it('renvoie le défaut si pas de surcharge', () => {
    expect(mergeTheme(defaultVitrineTheme, null)).toEqual(defaultVitrineTheme);
  });
});

describe('normalizeHex', () => {
  it('accepte #abc / #aabbcc et rejette le reste', () => {
    expect(normalizeHex('#abc')).toBe('#abc');
    expect(normalizeHex('#A1B2C3')).toBe('#A1B2C3');
    expect(normalizeHex('red')).toBeUndefined();
    expect(normalizeHex(123)).toBeUndefined();
  });
});

describe('ThemeProvider', () => {
  it('applique les CSS variables du scope vitrine (défaut)', () => {
    render(
      <ThemeProvider scope="vitrine">
        <div>contenu</div>
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
      defaultVitrineTheme.colors.primary,
    );
  });

  it('applique le thème panel (distinct de la vitrine)', () => {
    render(
      <ThemeProvider scope="panel">
        <div>contenu</div>
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
      defaultPanelTheme.colors.primary,
    );
    expect(defaultPanelTheme.colors.primary).not.toBe(defaultVitrineTheme.colors.primary);
  });

  it('applique une surcharge partielle (thème backend)', () => {
    render(
      <ThemeProvider scope="vitrine" theme={{ colors: { primary: '#abcdef' } }}>
        <div>contenu</div>
      </ThemeProvider>,
    );
    expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe('#abcdef');
  });
});
