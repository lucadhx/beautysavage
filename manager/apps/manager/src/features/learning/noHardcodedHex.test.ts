/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
// C2 — Aucun hex couleur en dur dans les .tsx (tokens --bs-* uniquement).
const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
describe('Learning — pas de hex en dur', () => {
  it('aucun .tsx (hors tests) ne contient de couleur hexadécimale', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.tsx'))
      .filter(([, src]) => HEX_COLOR.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
