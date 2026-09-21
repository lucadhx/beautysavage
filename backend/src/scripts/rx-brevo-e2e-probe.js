/**
 * SONDE E2E BREVO — LECTURE SEULE, AUCUN ENVOI.
 *
 * Répond à des questions factuelles qu'aucune lecture de code ne peut trancher :
 * quel compte est réellement utilisé, quels expéditeurs sont réellement validés,
 * quels domaines sont réellement authentifiés, et surtout quelle est la RAISON
 * exacte des événements d'un message donné.
 *
 * Usage :
 *   node src/scripts/rx-brevo-e2e-probe.js
 *   node src/scripts/rx-brevo-e2e-probe.js --message-id=<id> --message-id=<id>
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { getCredential, getProviderBaseUrl, getActiveMode } from '../services/integratedApi.service.js';
import { EmailConfiguration } from '../models/EmailConfiguration.model.js';

const args = (name) =>
  process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.split('=').slice(1).join('='));

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m' };
const title = (t) => console.log(`\n${C.b}${C.cyn}${t}${C.r}\n${'─'.repeat(t.length)}`);
const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);

async function get(mode, path) {
  const apiKey = await getCredential('BREVO', 'apiKey', { mode });
  const base = (await getProviderBaseUrl('BREVO', { mode })).replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, { headers: { 'api-key': apiKey, accept: 'application/json' } });
  const text = await res.text().catch(() => '');
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

async function main() {
  await connectDatabase();
  const mode = await getActiveMode('BREVO');
  title(`MODE FOURNISSEUR ACTIF : ${mode}`);

  const cfg = await EmailConfiguration.findOne().lean();
  const sender = cfg?.modes?.[mode]?.sender || {};
  line('sender.email (config)', sender.email || '(vide)');
  line('sender.name  (config)', sender.name || '(vide)');

  title('COMPTE BREVO RÉELLEMENT UTILISÉ');
  const acc = await get(mode, '/account');
  if (acc.status !== 200) {
    line('HTTP', `${C.red}${acc.status}${C.r} ${JSON.stringify(acc.json).slice(0, 300)}`);
  } else {
    line('email du compte', acc.json.email);
    line('société', acc.json.companyName);
    line('plan', JSON.stringify(acc.json.plan));
    if (acc.json.relay) line('relay SMTP', JSON.stringify(acc.json.relay?.data || acc.json.relay));
  }

  title('EXPÉDITEURS DÉCLARÉS (/senders)');
  const senders = await get(mode, '/senders');
  if (senders.status !== 200) {
    line('HTTP', `${C.red}${senders.status}${C.r} ${JSON.stringify(senders.json).slice(0, 300)}`);
  } else {
    for (const s of senders.json.senders || []) {
      const ok = s.active ? `${C.grn}ACTIF/VALIDÉ${C.r}` : `${C.red}NON VALIDÉ${C.r}`;
      line(s.email, `${ok}  id=${s.id}  name=${JSON.stringify(s.name)}`);
    }
    if (!(senders.json.senders || []).length) line('(aucun)', '');
  }

  title('AUTHENTIFICATION DES DOMAINES (/senders/domains)');
  const domains = await get(mode, '/senders/domains');
  if (domains.status !== 200) {
    line('HTTP', `${C.red}${domains.status}${C.r} ${JSON.stringify(domains.json).slice(0, 300)}`);
  } else {
    for (const d of domains.json.domains || []) {
      console.log(`\n  ${C.b}${d.domain}${C.r}`);
      line('  authenticated', d.authenticated ? `${C.grn}OUI${C.r}` : `${C.red}NON${C.r}`);
      line('  verified', d.verified ? `${C.grn}OUI${C.r}` : `${C.red}NON${C.r}`);
      console.log(`  ${C.dim}enregistrements attendus (valeurs Brevo, à publier tels quels) :${C.r}`);
      console.log(JSON.stringify(d.dns_records ?? d.dnsRecords ?? d, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    }
    if (!(domains.json.domains || []).length) line('(aucun domaine déclaré)', '');
  }

  const ids = args('message-id');
  for (const id of ids) {
    title(`ÉVÉNEMENTS FOURNISSEUR — ${id}`);
    const ev = await get(mode, `/smtp/statistics/events?limit=100&messageId=${encodeURIComponent(id)}`);
    if (ev.status !== 200) {
      line('HTTP', `${C.red}${ev.status}${C.r} ${JSON.stringify(ev.json).slice(0, 300)}`);
      continue;
    }
    const events = ev.json.events || [];
    if (!events.length) line('(aucun événement)', '');
    for (const e of events) {
      console.log(
        `  ${String(e.date).padEnd(28)} ${C.b}${String(e.event).padEnd(16)}${C.r} ${e.reason ? `${C.ylw}reason=${e.reason}${C.r}` : ''}`,
      );
    }
  }

  await disconnectDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
