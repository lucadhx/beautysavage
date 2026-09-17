// Accès tolérant aux payloads bruts (sans `any`) : on coerce et on tolère les champs absents.
export type Raw = Record<string, unknown>;

export const asRaw = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});

export const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v);

export const optStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

export const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const optNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export const rawArr = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(asRaw) : []);

export const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** id robuste : `id` ou `_id`. */
export const id = (r: Raw): string => str(r.id ?? r._id);
