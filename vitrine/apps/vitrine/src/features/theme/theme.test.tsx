import { describe, it, expect, afterEach, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { defaultVitrineTheme } from '@bs/ui';
import { renderWithProviders, stubFetch, jsonResponse } from '../../test/utils';
import { VitrineThemeProvider } from './VitrineThemeProvider';
import { mapVitrineThemeToTokens } from './vitrineThemeAdapter';

afterEach(() => vi.unstubAllGlobals());

describe('vitrineThemeAdapter', () => {
  it('renvoie {} sans thème (→ defaultVitrineTheme utilisé)', () => {
    expect(mapVitrineThemeToTokens(null)).toEqual({});
  });
  it('mappe et normalise les couleurs hex backend', () => {
    const tokens = mapVitrineThemeToTokens({
      colors: { primary: '#abcdef', secondary: 'pas-hex' },
      derivedTokens: {},
    });
    expect(tokens.colors?.primary).toBe('#abcdef');
    expect(tokens.colors?.secondary).toBeUndefined(); // hex invalide ignoré
  });
});

describe('VitrineThemeProvider', () => {
  it('utilise defaultVitrineTheme si /api/vitrine/theme échoue', async () => {
    document.documentElement.removeAttribute('style');
    stubFetch(() => jsonResponse({ ok: false, error: 'boom' }, 500));
    renderWithProviders(
      <VitrineThemeProvider>
        <div>contenu</div>
      </VitrineThemeProvider>,
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe(
        defaultVitrineTheme.colors.primary,
      ),
    );
  });

  it('applique la couleur primaire du backend si fournie', async () => {
    document.documentElement.removeAttribute('style');
    stubFetch((url) =>
      url.includes('/api/vitrine/theme')
        ? jsonResponse({ ok: true, theme: { colors: { primary: '#0a0b0c' } } })
        : jsonResponse({ ok: true }, 404),
    );
    renderWithProviders(
      <VitrineThemeProvider>
        <div>contenu</div>
      </VitrineThemeProvider>,
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue('--bs-color-primary')).toBe('#0a0b0c'),
    );
  });
});
