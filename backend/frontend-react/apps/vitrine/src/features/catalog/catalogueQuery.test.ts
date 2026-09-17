// RX3 — Tests de la logique catalogue partagée (recherche insensible accents/casse, filtre type, tris).
import { describe, it, expect } from 'vitest';
import { applyCatalogueQuery, DEFAULT_CATALOGUE_QUERY, type CatalogueAccessors } from './catalogueQuery';

interface Item {
  name: string;
  price: number;
  createdAt: number;
  type: string;
}

const ITEMS: Item[] = [
  { name: 'Épilation sourcils', price: 30, createdAt: 3, type: 'presentiel' },
  { name: 'Soin visage', price: 80, createdAt: 1, type: 'presentiel' },
  { name: 'Formation en ligne', price: 200, createdAt: 2, type: 'distanciel' },
];

const ACC: CatalogueAccessors<Item> = {
  text: (i) => i.name,
  price: (i) => i.price,
  date: (i) => i.createdAt,
  type: (i) => i.type,
};

describe('applyCatalogueQuery', () => {
  it('featured = ordre d’origine préservé', () => {
    const out = applyCatalogueQuery(ITEMS, DEFAULT_CATALOGUE_QUERY, ACC);
    expect(out.map((i) => i.name)).toEqual(ITEMS.map((i) => i.name));
  });

  it('recherche insensible à la casse et aux accents', () => {
    const out = applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, q: 'epilation' }, ACC);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Épilation sourcils');
  });

  it('filtre par type', () => {
    const out = applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, type: 'distanciel' }, ACC);
    expect(out.map((i) => i.name)).toEqual(['Formation en ligne']);
  });

  it('tri prix croissant / décroissant', () => {
    const asc = applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, sort: 'price-asc' }, ACC);
    expect(asc.map((i) => i.price)).toEqual([30, 80, 200]);
    const desc = applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, sort: 'price-desc' }, ACC);
    expect(desc.map((i) => i.price)).toEqual([200, 80, 30]);
  });

  it('tri nouveautés = date décroissante', () => {
    const out = applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, sort: 'recent' }, ACC);
    expect(out.map((i) => i.createdAt)).toEqual([3, 2, 1]);
  });

  it('n’altère pas le tableau source (immuable)', () => {
    const copy = [...ITEMS];
    applyCatalogueQuery(ITEMS, { ...DEFAULT_CATALOGUE_QUERY, sort: 'price-desc' }, ACC);
    expect(ITEMS).toEqual(copy);
  });
});
