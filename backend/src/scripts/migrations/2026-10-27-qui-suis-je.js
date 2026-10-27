#!/usr/bin/env node
// MIGRATION — un premier « Qui suis-je » pour l'accueil (texte provisoire, à réécrire au Manager).
//
//   node src/scripts/migrations/2026-10-27-qui-suis-je.js --db beauty_savage_prod           # diagnostic seul
//   node src/scripts/migrations/2026-10-27-qui-suis-je.js --db beauty_savage_prod --apply   # écrit
//
// Pose le texte de présentation de Romane sur la fiche de l'institut SI la
// section est encore vide. Un texte déjà saisi au Manager n'est jamais
// réécrit. Idempotente : relancée, elle ne change rien. Affiche aussi l'état
// de l'adresse (contact « address »), dont dépendent le pied de page, la
// fenêtre de réservation et les e-mails.
import mongoose from 'mongoose';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou la base de TEST).');
  process.exit(2);
}

const ABOUT = {
  eyebrow: 'Qui suis-je',
  title: 'Romane, fondatrice de BeautySavage',
  text: [
    'Je m’appelle Romane. Depuis toujours, je suis fascinée par ce que quelques gestes précis peuvent changer dans un regard ou sur des mains — et dans la confiance que l’on a en soi.',
    'Après mon diplôme d’esthéticienne, j’ai fait mes armes en institut à Nice, puis je me suis spécialisée dans le regard : rehaussement de cils, brow lift, restructuration des sourcils. J’ai multiplié les formations auprès de professionnelles reconnues, jusqu’à trouver ma propre façon de travailler : naturelle, sur mesure, et toujours respectueuse de vos cils, de vos sourcils et de vos ongles.',
    'BeautySavage est né de cette envie : un lieu où l’on prend le temps, où chaque prestation commence par un vrai échange, et d’où l’on repart en se sentant soi-même, en mieux.',
    'Aujourd’hui, je transmets aussi ce savoir-faire. Mes formations, en présentiel comme en ligne, sont celles que j’aurais aimé suivre à mes débuts : concrètes, exigeantes et bienveillantes, pour que chaque stagiaire reparte prête à exercer avec confiance.',
  ].join('\n\n'),
  signature: 'Romane',
};

await mongoose.connect(process.env.MONGODB_URI, { dbName: DB });
const companies = mongoose.connection.db.collection('companies');
const company = await companies.findOne({}, { projection: { name: 1, about: 1, media: 1, googleMapsUrl: 1 } });
if (!company) {
  console.error(`${DB} : aucune fiche entreprise.`);
  process.exit(1);
}
const address = (company.media || []).find((m) => m.key === 'address');
console.log(`${DB} · ${company.name}`);
console.log(`  Adresse : ${address?.value ? `${address.enabled ? 'publiée' : 'MASQUÉE'} — ${address.value.replace(/\n/g, ' / ')}` : 'NON RENSEIGNÉE'}`);
console.log(`  Lien Google Maps : ${company.googleMapsUrl || '(recherche sur l’adresse)'}`);
const hasAbout = Boolean(company.about?.text?.trim());
console.log(`  Qui suis-je : ${hasAbout ? `déjà rédigé (${company.about.text.length} caractères) — inchangé` : 'vide → texte provisoire à poser'}`);

if (APPLY && !hasAbout) {
  // Une section absente (ou nulle) se pose d'un bloc ; une section existante garde son image.
  const set = company.about && typeof company.about === 'object'
    ? { 'about.eyebrow': ABOUT.eyebrow, 'about.title': ABOUT.title, 'about.text': ABOUT.text, 'about.signature': ABOUT.signature }
    : { about: { ...ABOUT, image: '', imageMedia: null } };
  const r = await companies.updateOne(
    { _id: company._id, $or: [{ 'about.text': { $exists: false } }, { 'about.text': '' }, { about: null }] },
    { $set: { ...set, updatedAt: new Date() } },
  );
  console.log(`Écrit : ${r.modifiedCount} fiche.`);
} else if (!APPLY) {
  console.log('Diagnostic seul : ajoutez --apply pour écrire.');
}
await mongoose.disconnect();
