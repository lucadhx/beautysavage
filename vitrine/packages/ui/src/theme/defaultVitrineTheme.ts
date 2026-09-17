import type { ThemeTokens } from './themeTypes';

// Thème vitrine par défaut (fallback si /api/vitrine/theme indisponible).
// Couleurs alignées sur THEME_DEFAULTS du Vanilla (violet/rose).
export const defaultVitrineTheme: ThemeTokens = {
  colors: {
    background: '#f5f4ef',
    surface: '#ffffff',
    surfaceElevated: '#ffffff',
    text: '#0f172a',
    textMuted: 'rgba(15, 23, 42, 0.6)',
    primary: '#5f4ff7',
    primaryHover: '#4c3ee0',
    secondary: '#f24692',
    accent: 'color-mix(in oklab, #5f4ff7 70%, #f24692 30%)',
    border: 'rgba(15, 23, 42, 0.12)',
    success: '#1f7a3a',
    warning: '#b45309',
    danger: '#dc2626',
  },
  radius: '6px',
  shadow: '0 1px 3px rgba(15, 23, 42, 0.12)',
  font: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  spacing: { x1: '4px', x2: '8px', x3: '16px', x4: '24px' },
};
