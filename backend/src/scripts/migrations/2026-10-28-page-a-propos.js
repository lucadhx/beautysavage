#!/usr/bin/env node
// MIGRATION — la page « À propos » structurée, tirée du texte « Qui suis-je » de Romane.
//
//   node src/scripts/migrations/2026-10-28-page-a-propos.js --db beauty_savage_prod           # diagnostic seul
//   node src/scripts/migrations/2026-10-28-page-a-propos.js --db beauty_savage_prod --apply   # écrit
//
// Pose une page en sections (chapô, cinq sections, trois valeurs, une
// citation) SI la page n'a encore aucune section, et le résumé court de
// l'accueil SI il est vide. Le portrait du « Qui suis-je » devient celui de
// la page. Rien de ce qui a déjà été saisi au Manager n'est réécrit ;
// relancée, elle ne change rien.
import mongoose from 'mongoose';
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');
const dbIndex = process.argv.indexOf('--db');
const DB = dbIndex === -1 ? '' : process.argv[dbIndex + 1];
if (!DB) {
  console.error('Précisez la base : --db beauty_savage_prod (ou la base de TEST).');
  process.exit(2);
}

const id = () => new mongoose.Types.ObjectId();
const PAGE = {
  enabled: true,
  eyebrow: 'À propos',
  title: 'Moi, c’est Romane',
  intro: 'Professionnelle de la beauté et formatrice spécialisée dans le regard, basée à Nice.',
  sections: [
    {
      eyebrow: 'Mon expertise',
      title: 'Le regard, sublimé avec précision',
      text: 'Formée depuis 2021, j’ai développé une véritable expertise dans les extensions de cils aux rendus naturels et le Korean Lash Lift — une technique qui me passionne particulièrement pour sa précision et sa capacité à sublimer le regard tout en respectant le cil naturel.',
    },
    {
      eyebrow: 'Mon approche',
      title: 'Révéler, sans en faire trop',
      text: 'Au fil des années, j’ai construit mon approche autour d’une conviction simple : la beauté n’a pas besoin d’en faire trop pour révéler tout son potentiel. J’aime les résultats soignés, les détails qui font la différence et le travail réalisé avec exigence, sans jamais perdre de vue l’essentiel : la personne qui se trouve derrière chaque regard.',
    },
    {
      eyebrow: 'La transmission',
      title: 'Bien plus qu’un protocole',
      text: 'Aujourd’hui, je mets cette expertise au service de mes clientes, mais aussi des professionnelles qui souhaitent se perfectionner ou découvrir de nouvelles techniques. À travers mes formations, j’ai à cœur de transmettre une compréhension du geste, le sens du détail et les connaissances nécessaires pour évoluer avec confiance dans son métier.',
    },
    {
      eyebrow: 'L’accompagnement',
      title: 'Prendre le temps, toujours',
      text: 'J’accorde une grande importance à l’échange, au partage et à une approche humaine du métier. Que ce soit lors d’une prestation ou d’une formation, j’aime prendre le temps d’expliquer, de conseiller et d’accompagner chacun avec sérieux, simplicité et bienveillance.',
    },
    {
      eyebrow: 'Aussi à l’institut',
      title: 'Le soin des pieds',
      text: 'Parce que mon métier s’étend aussi au soin des pieds, je propose également des prestations de pédicure, avec la même exigence et le même souci du détail.',
    },
  ],
  values: [
    { title: 'Naturel', text: 'Des résultats qui subliment le regard en respectant le cil naturel.' },
    { title: 'Exigence', text: 'Le sens du détail et un travail soigné, à chaque geste.' },
    { title: 'Humain', text: 'Écouter, expliquer, conseiller : la personne avant tout.' },
  ],
  quote: 'La beauté n’a pas besoin d’en faire trop pour révéler tout son potentiel.',
};
const TEASER = 'Formatrice spécialisée dans le regard, basée à Nice : extensions de cils au rendu naturel, Korean Lash Lift, et une conviction — la beauté n’a pas besoin d’en faire trop.';

await mongoose.connect(process.env.MONGODB_URI, { dbName: DB });
const companies = mongoose.connection.db.collection('companies');
const company = await companies.findOne({}, { projection: { name: 1, about: 1, aboutPage: 1 } });
if (!company) {
  console.error(`${DB} : aucune fiche entreprise.`);
  process.exit(1);
}
const hasPage = (company.aboutPage?.sections || []).length > 0;
const hasTeaser = Boolean(company.about?.teaser?.trim());
console.log(`${DB} · ${company.name}`);
console.log(`  Page À propos : ${hasPage ? `déjà rédigée (${company.aboutPage.sections.length} sections) — inchangée` : 'vide → page structurée à poser'}`);
console.log(`  Résumé de l’accueil : ${hasTeaser ? 'déjà rédigé — inchangé' : 'vide → résumé à poser'}`);
console.log(`  Portrait repris du « Qui suis-je » : ${company.about?.image ? 'oui' : 'aucun'}`);

if (APPLY && (!hasPage || !hasTeaser)) {
  const set = { updatedAt: new Date() };
  if (!hasPage) {
    set.aboutPage = {
      ...PAGE,
      image: company.about?.image || '',
      imageMedia: company.about?.imageMedia || null,
      sections: PAGE.sections.map((s) => ({ _id: id(), ...s, image: '', imageMedia: null })),
      values: PAGE.values.map((v) => ({ _id: id(), ...v })),
    };
  }
  if (!hasTeaser) {
    if (company.about && typeof company.about === 'object') set['about.teaser'] = TEASER;
    else set.about = { eyebrow: 'Qui suis-je', title: PAGE.title, text: '', teaser: TEASER, signature: 'Romane', image: '', imageMedia: null };
  }
  const r = await companies.updateOne({ _id: company._id }, { $set: set });
  console.log(`Écrit : ${r.modifiedCount} fiche.`);
} else if (!APPLY) {
  console.log('Diagnostic seul : ajoutez --apply pour écrire.');
}
await mongoose.disconnect();
