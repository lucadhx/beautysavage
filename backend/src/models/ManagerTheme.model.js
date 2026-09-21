import mongoose from 'mongoose';

/**
 * Manager back-office theme, editable by DEV only.
 * Default: minimalist black & white, professional.
 */
const managerThemeSchema = new mongoose.Schema(
  {
    colors: {
      primary: { type: String, default: '#111111' },
      primaryForeground: { type: String, default: '#ffffff' },
      accent: { type: String, default: '#111111' },
      accentForeground: { type: String, default: '#ffffff' },
      background: { type: String, default: '#ffffff' },
      foreground: { type: String, default: '#0a0a0a' },
      muted: { type: String, default: '#f4f4f5' },
      mutedForeground: { type: String, default: '#71717a' },
      border: { type: String, default: '#e4e4e7' },
      sidebar: { type: String, default: '#0a0a0a' },
      sidebarForeground: { type: String, default: '#fafafa' },
    },
    radius: { type: String, default: '0.5rem' },
  },
  { timestamps: true }
);

export const ManagerTheme = mongoose.model('ManagerTheme', managerThemeSchema);
export default ManagerTheme;
