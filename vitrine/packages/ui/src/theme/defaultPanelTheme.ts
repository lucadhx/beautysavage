import type { ThemeTokens } from './themeTypes';

// Thème panel (Manager/Dev) par défaut — DISTINCT de la vitrine (palette bleu/ardoise, sobre, dense).
// Pas d'endpoint backend pour l'instant : ce défaut fait foi jusqu'au Theme Studio Dev (rapport 161).
export const defaultPanelTheme: ThemeTokens = {
  colors: {
    background: '#f1f5f9',
    surface: '#ffffff',
    surfaceElevated: '#f8fafc',
    text: '#0f172a',
    textMuted: 'rgba(15, 23, 42, 0.62)',
    primary: '#2563eb',
    primaryHover: '#1d4ed8',
    secondary: '#7c3aed',
    accent: '#0ea5e9',
    border: 'rgba(15, 23, 42, 0.14)',
    success: '#15803d',
    warning: '#b45309',
    danger: '#dc2626',
  },
  radius: '6px',
  shadow: '0 1px 2px rgba(15, 23, 42, 0.10)',
  font: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  spacing: { x1: '4px', x2: '8px', x3: '14px', x4: '20px' },
};
