/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

// M7 — Aucun hex couleur en dur dans les .tsx du Notification Studio (tokens --bs-* ; les couleurs
// de catégorie sont des DONNÉES appliquées en inline style, pas des littéraux).
const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

describe('Notification Studio — pas de hex en dur dans les .tsx', () => {
  it('aucun fichier .tsx (hors tests) ne contient de couleur hexadécimale', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.tsx'))
      .filter(([, src]) => HEX_COLOR.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
