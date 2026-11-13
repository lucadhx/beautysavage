/**
 * FICHES STRUCTURÉES (2026-11-13) — programme, contenu inclus, chiffres clés,
 * tenue et « Bon à savoir » : normalisés à l'enregistrement, exposés à la
 * vitrine ; le seed ne retire des prestations QUE les paragraphes déplacés.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'fiches_structurees_test';
process.env.DB_PROD = 'fiches_structurees_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const extras = await import('../services/productExtras.js');
const commerce = await import('../services/commerce.service.js');
const seed = await import('./seed-fiches-structurees-2026-11-13.js');

section('1. Normalisation');
const t = extras.normalizeTraining({
  location: 'Nice', durationDays: 2, format: '  Coaching   individuel ', level: 'Débutant',
  program: [{ title: 'Cil à cil', items: ['A', '', '  B '] }, { title: 'Vide', items: [] }, 'nimporte'],
  includes: [{ icon: 'certificat', label: 'Certificat' }, { icon: 'inconnu', label: 'Kit' }, { icon: 'livret', label: '' }, 'Livret'],
});
check('champs existants conservés', t.location === 'Nice' && t.durationDays === 2);
check('textes nettoyés', t.format === 'Coaching individuel');
check('programme : parties vides et points vides retirés', t.program.length === 1 && t.program[0].items.join('|') === 'A|B', JSON.stringify(t.program));
check('inclus : pictogramme inconnu → « etoile », libellé vide retiré, chaîne acceptée', t.includes.length === 3 && t.includes[1].icon === 'etoile' && t.includes[2].label === 'Livret', JSON.stringify(t.includes));
check('tenue d’une prestation', extras.normalizeService({ capacity: 1, longevity: ' 6 à 8 semaines ' }).longevity === '6 à 8 semaines');
check('bon à savoir : 12 au plus, lignes vides retirées', extras.normalizeAdditionalInfo([...Array(15).fill('x'), '', null]).length === 12);

section('2. Enregistrement et vitrine');
const formation = await commerce.upsertProduct({
  title: 'Formation test', slug: 'formation-test', kind: 'IN_PERSON_TRAINING', status: 'PUBLISHED', price: { amountCents: 50000, currency: 'EUR' },
  training: { location: 'Nice', durationDays: 1, formalities: 'Une tenue confortable', cancellationPolicy: 'Par écrit', format: 'Coaching individuel', durationLabel: '1 journée', level: 'Débutant', prerequisites: 'Aucun', program: [{ title: '', items: ['Théorie', 'Pratique'] }], includes: [{ icon: 'certificat', label: 'Certificat' }] },
  additionalInfo: ['Paiement en 3 fois sans frais.'],
});
const view = await commerce.getProductBySlug('formation-test');
check('programme, inclus, chiffres clés exposés', view.training.program[0].items.length === 2 && view.training.includes[0].icon === 'certificat' && view.training.level === 'Débutant' && view.training.durationLabel === '1 journée');
check('infos pratiques exposées (lieu, à prévoir, annulation)', view.training.formalities === 'Une tenue confortable' && view.training.cancellationPolicy === 'Par écrit' && view.training.location === 'Nice');
check('bon à savoir exposé', view.additionalInfo.length === 1);
await commerce.upsertProduct({ id: String(formation._id), title: 'Formation test', slug: 'formation-test', kind: 'IN_PERSON_TRAINING', status: 'PUBLISHED', price: { amountCents: 50000, currency: 'EUR' }, training: { location: 'Nice' } });
const after = await commerce.getProductBySlug('formation-test');
check('bon à savoir absent de la demande : gardé', after.additionalInfo.length === 1);
const service = await commerce.upsertProduct({ title: 'Soin', slug: 'soin', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 5000, currency: 'EUR' }, durationMinutes: 60, service: { capacity: 1, longevity: '3 à 4 semaines' } });
check('tenue exposée', (await commerce.getProductBySlug('soin')).service.longevity === '3 à 4 semaines' && Boolean(service));

section('3. Seed : seuls les paragraphes déplacés partent');
const html = '<p style="x">✨ <b>Titre</b></p><p>Texte vendeur.</p><p>⏳ <b>Tenue : 6 à 8 semaines</b></p><p>⚠️ À noter :<br>Pas de callosités.</p><p>Si vous souhaitez ensuite réaliser autre chose.</p><div><br></div>';
const { html: kept, removed } = seed.withoutMovedParagraphs(html);
check('3 paragraphes déplacés', removed.length === 3, removed.join(' | '));
check('le reste est intact, style compris', kept === '<p style="x">✨ <b>Titre</b></p><p>Texte vendeur.</p>', kept);
check('idempotent : rien à déplacer la seconde fois', seed.withoutMovedParagraphs(kept).removed.length === 0);
check('toutes les formations du seed ont programme ou inclus', Object.values(seed.TRAININGS).every((f) => (f.training.program?.length || f.training.includes?.length)));
check('le seed ne réécrit pas le prix : aucune ligne « Tarif » dans les descriptions', Object.values(seed.TRAININGS).every((f) => !/Tarif\s*:/.test(f.description)));

console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await mongod.stop();
process.exit(fail ? 1 : 0);
