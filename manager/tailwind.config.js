/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    /*
      Les composants de la vitrine rendus dans les aperçus (voir l'alias
      `@vitrine`). Sans ce chemin, Tailwind ne voit pas leurs classes et n'en
      génère aucune : l'aperçu s'afficherait sans mise en forme, alors que le
      même fichier est correct dans la vitrine.
    */
    '../vitrine/src/components/HeroBanner.tsx',
  ],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables set from the manager theme (DEV-editable).
        background: 'var(--m-background)',
        foreground: 'var(--m-foreground)',
        primary: {
          DEFAULT: 'var(--m-primary)',
          foreground: 'var(--m-primary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--m-accent)',
          foreground: 'var(--m-accent-foreground)',
        },
        muted: {
          DEFAULT: 'var(--m-muted)',
          foreground: 'var(--m-muted-foreground)',
        },
        border: 'var(--m-border)',
        sidebar: {
          DEFAULT: 'var(--m-sidebar)',
          foreground: 'var(--m-sidebar-foreground)',
        },
        card: 'var(--m-card, #ffffff)',
      },
      borderRadius: {
        lg: 'var(--m-radius)',
        md: 'calc(var(--m-radius) - 2px)',
        sm: 'calc(var(--m-radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
