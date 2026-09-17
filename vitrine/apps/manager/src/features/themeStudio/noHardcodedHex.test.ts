/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

// M5 — Aucun hex couleur en dur dans les .tsx du Theme Studio (les valeurs couleur sont des
// DONNÉES de state, pas des littéraux de style ; tout repli hex vit dans themeDraft.ts).
const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

describe('Theme Studio — pas de hex en dur dans les .tsx', () => {
  it('aucun fichier .tsx (hors tests) ne contient de couleur hexadécimale', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.tsx'))
      .filter(([, src]) => HEX_COLOR.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
