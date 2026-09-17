// Les matchers jest-dom ne sont utiles qu'en environnement DOM (tests *.test.tsx → jsdom).
// En environnement `node` (tests de logique / clients API), on ne charge pas jest-dom.
if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest');
}
