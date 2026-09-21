/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Driven by CSS variables set from the vitrine theme (ADMIN-editable).
        primary: { DEFAULT: 'var(--v-primary)', foreground: 'var(--v-primary-foreground)' },
        secondary: { DEFAULT: 'var(--v-secondary)', foreground: 'var(--v-secondary-foreground)' },
        accent: { DEFAULT: 'var(--v-accent)', foreground: 'var(--v-accent-foreground)' },
        background: 'var(--v-background)',
        foreground: 'var(--v-foreground)',
        muted: { DEFAULT: 'var(--v-muted)', foreground: 'var(--v-muted-foreground)' },
        border: 'var(--v-border)',
      },
      borderRadius: {
        lg: 'var(--v-radius)',
        md: 'calc(var(--v-radius) - 2px)',
        sm: 'calc(var(--v-radius) - 4px)',
      },
      fontFamily: {
        sans: ["var(--font-body, 'Inter', system-ui, sans-serif)"],
        heading: ["var(--font-heading, 'Poppins', 'Inter', system-ui, sans-serif)"],
      },
      keyframes: {
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        marquee: 'marquee 40s linear infinite',
      },
    },
  },
  plugins: [],
};
