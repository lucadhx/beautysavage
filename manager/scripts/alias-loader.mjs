import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

/**
 * Résolveur d'alias `@/…` pour les tests de modules PURS lancés sous Node.
 *
 * Vite et TypeScript connaissent l'alias `@` (-> `src/`) ; Node non. Sans ce
 * hook, un module pur ne pourrait pas être testé dès qu'il importe une VALEUR
 * d'un autre module — ce qui obligerait à dupliquer la règle testée, exactement
 * ce qu'on veut éviter (les imports de TYPE, eux, sont effacés au stripping).
 *
 * Ajoute aussi l'extension : Node exige un chemin explicite en ESM.
 */
const SRC = path.resolve(process.cwd(), 'src');

function firstExisting(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

export async function resolve(specifier, context, next) {
  // Alias `@/…` -> `src/…`.
  if (specifier.startsWith('@/')) {
    const target = firstExisting(path.join(SRC, specifier.slice(2)));
    if (!target) return next(specifier, context); // laisse Node produire l'erreur habituelle
    return next(pathToFileURL(target).href, context);
  }
  // Import RELATIF sans extension (`./api`, `../lib/x`) : Vite/TS le résolvent,
  // Node l'exige explicite. On complète l'extension pour permettre de tester un
  // module pur qui importe la VALEUR d'un module frère (sans dupliquer la règle).
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !path.extname(specifier) && context.parentURL) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const target = firstExisting(base);
    if (target) return next(pathToFileURL(target).href, context);
  }
  return next(specifier, context);
}
