// RX-RUN — Smoke-test des parcours (serveur DÉJÀ lancé). Lecture seule : uniquement des GET publics qui
// reflètent le serving React/Vanilla, les flags et l'état des seeds. Ne crée/modifie AUCUNE donnée.
//
// Usage :
//   node scripts/verifyParcours.js                       # http://localhost:3000
//   node scripts/verifyParcours.js https://mon-domaine   # base URL custom
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || process.env.RXRUN_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** Un check = { name, run() -> { ok, detail } }. Tolérant réseau (timeout court). */
async function get(url, { redirect = 'follow' } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { redirect, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

const CHECKS = [
  { name: 'Santé site (/api/site-status)', async run() { const r = await get(`${BASE}/api/site-status`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
  { name: 'Racine / (mode de serving)', async run() {
      const r = await get(`${BASE}/`, { redirect: 'manual' });
      const loc = r.headers.get('location') || '';
      const mode = loc === '/app/' ? 'React (canary ON)' : loc === '/vitrine.html' ? 'Vanilla (OFF)' : loc || '—';
      return { ok: r.status === 302 && (loc === '/app/' || loc === '/vitrine.html'), detail: `HTTP ${r.status} → ${mode}` };
    } },
  { name: 'SPA vitrine (/app/)', async run() { const r = await get(`${BASE}/app/`, { redirect: 'manual' }); return { ok: r.status === 200 || r.status === 503, detail: r.status === 503 ? 'build absent (503)' : `HTTP ${r.status}` }; } },
  { name: 'SPA manager (/manager/)', async run() { const r = await get(`${BASE}/manager/`, { redirect: 'manual' }); return { ok: r.status === 200 || r.status === 503, detail: r.status === 503 ? 'build absent (503)' : `HTTP ${r.status}` }; } },
  { name: 'API non shadowée (/api/site-status)', async run() { const r = await get(`${BASE}/api/site-status`, { redirect: 'manual' }); return { ok: r.status !== 302, detail: r.status === 302 ? 'SHADOWÉ (302 !)' : `HTTP ${r.status}` }; } },
  { name: 'Thème vitrine (/api/theme/vitrine)', async run() { const r = await get(`${BASE}/api/theme/vitrine`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
  { name: 'Catalogue (/api/vitrine/shop)', async run() { const r = await get(`${BASE}/api/vitrine/shop`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
  { name: 'Cartes cadeaux config (/api/vitrine/gift-cards)', async run() { const r = await get(`${BASE}/api/vitrine/gift-cards`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
  { name: 'Stripe config (/api/stripe/config)', async run() { const r = await get(`${BASE}/api/stripe/config`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
  { name: 'Contrat (/api/contract/status)', async run() { const r = await get(`${BASE}/api/contract/status`); return { ok: r.status === 200, detail: `HTTP ${r.status}` }; } },
];

async function main() {
  console.log(`\nRX-RUN — Smoke parcours sur ${BASE}\n`);
  const pad = (s, n) => String(s).padEnd(n);
  let failed = 0;
  for (const c of CHECKS) {
    let ok = false; let detail = '';
    try { const r = await c.run(); ok = r.ok; detail = r.detail; }
    catch (err) { ok = false; detail = `échec réseau : ${err?.message || err}`; }
    if (!ok) failed += 1;
    console.log(`${pad(ok ? '✅' : '❌', 3)} ${pad(c.name, 44)} ${detail}`);
  }
  console.log('\n' + (failed === 0 ? '✅ Tous les parcours de base répondent.' : `❌ ${failed} check(s) en échec.`) + '\n');
  process.exit(failed === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
