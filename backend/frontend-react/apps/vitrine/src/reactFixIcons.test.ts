// RX-FIX — Garde anti-régression : les DEUX apps doivent importer la police Bootstrap Icons, sinon toutes les
// icônes `bi bi-*` s'affichent en carrés vides (bug démo bloquant).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('RX-FIX — Bootstrap Icons chargées', () => {
  it('vitrine + manager importent bootstrap-icons dans main.tsx', () => {
    for (const app of ['vitrine', 'manager']) {
      const main = fs.readFileSync(path.join(FRONTEND, 'apps', app, 'src', 'main.tsx'), 'utf8');
      expect(main, `${app}/main.tsx doit importer bootstrap-icons`).toContain('bootstrap-icons/font/bootstrap-icons.css');
    }
  });

  it('bootstrap-icons est une dépendance déclarée', () => {
    const root = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'package.json'), 'utf8'));
    expect(root.dependencies?.['bootstrap-icons']).toBeTruthy();
  });
});
