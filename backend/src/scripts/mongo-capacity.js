/**
 * PRÉFLIGHT DE CAPACITÉ MONGO — ce qu'on peut mesurer, et ce qu'il faut déclarer.
 *
 * ══ L'INCIDENT ═════════════════════════════════════════════════════════════
 *
 * Un cluster partagé a atteint 501 collections. La 501ᵉ création a été refusée,
 * et un projet RÉEL n'a pas démarré — pas à cause de son code, mais parce que
 * des fixtures de certification avaient consommé la place. Rien n'avait prévenu,
 * parce que rien ne regardait.
 *
 * ══ CE QUI EST MESURABLE, ET CE QUI NE L'EST PAS ═══════════════════════════
 *
 * L'OCCUPATION se lit : on énumère les bases, on compte leurs collections. Le
 * chiffre est exact, immédiat, et ne coûte rien.
 *
 * LA LIMITE ne se lit pas. Un cluster Atlas de palier partagé la refuse à
 * `hostInfo` comme à `getParameter` — les deux commandes rendent `AtlasError` —
 * et `buildInfo` ne parle que de la taille d'un document. Il n'existe donc AUCUN
 * moyen fiable, depuis le driver, de savoir combien de collections cette offre
 * autorise.
 *
 * ══ POURQUOI 500 N'EST PAS ÉCRIT EN DUR ════════════════════════════════════
 *
 * Parce que ce serait une loi universelle inventée à partir d'un incident. La
 * valeur dépend de l'offre, et une offre change — plus souvent que ce fichier.
 * Un `500` en dur serait juste aujourd'hui, faux au premier changement de
 * palier, et personne ne saurait qu'il faut le corriger.
 *
 * L'allocation est donc DÉCLARÉE par l'opérateur (`MONGO_COLLECTION_ALLOWANCE`),
 * et son absence n'est pas une panne : on rend l'occupation, on dit qu'on ne
 * connaît pas le plafond, et on renvoie l'opérateur à sa console Atlas. Un
 * préflight qui refuserait de parler faute de plafond ne servirait personne.
 *
 * ══ L'ESTIMATION EST NOMMÉE COMME TELLE ════════════════════════════════════
 *
 * Le coût d'un projet est une OBSERVATION du parc, pas une garantie : un projet
 * jeune n'a pas encore créé toutes ses collections, un projet ancien en a plus
 * que la moyenne. On le mesure sur les bases existantes plutôt que de le
 * postuler, et on l'annonce comme une estimation.
 *
 *   node src/scripts/mongo-capacity.js
 *   npm run mongo:capacity
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const SYSTEME = ['admin', 'local', 'config'];

/** Ce que l'opérateur déclare savoir de son offre. `null` = inconnu, et c'est dit. */
export function declaredAllowance(env = process.env) {
  const brut = String(env.MONGO_COLLECTION_ALLOWANCE ?? '').trim();
  if (!brut) return null;
  const n = Number.parseInt(brut, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * L'OCCUPATION DU CLUSTER — la seule chose qu'on sache vraiment.
 *
 * @param {import('mongodb').MongoClient} client
 */
export async function measureOccupancy(client) {
  const { databases } = await client.db().admin().listDatabases();
  const bases = [];
  for (const d of databases) {
    if (SYSTEME.includes(d.name)) continue;
    const collections = await client.db(d.name).listCollections().toArray();
    bases.push({ nom: d.name, collections: collections.length, mo: +(d.sizeOnDisk / 1048576).toFixed(1) });
  }
  bases.sort((a, b) => b.collections - a.collections);
  return { bases, total: bases.reduce((s, b) => s + b.collections, 0) };
}

/**
 * LE COÛT D'UN PROJET, MESURÉ SUR LE PARC — et jamais postulé.
 *
 * Un projet occupe DEUX bases (recette et production). On prend la plus fournie
 * de chaque paire de bases nommées `<projet>_test` / `<projet>_prod` : c'est ce
 * vers quoi l'autre tendra quand elle sera exercée.
 */
export function estimateProjectCost(bases) {
  const paires = new Map();
  for (const b of bases) {
    const m = /^(.+)_(test|prod)$/.exec(b.nom);
    if (!m) continue;
    paires.set(m[1], Math.max(paires.get(m[1]) ?? 0, b.collections));
  }
  const mures = [...paires.values()].filter((n) => n > 5).sort((a, b) => a - b);
  if (!mures.length) return null;

  /**
   * ── DEUX CHIFFRES, PARCE QU'UN SEUL MENTIRAIT ────────────────────────────
   *
   * Prendre le MAXIMUM revient à supposer que chaque nouveau projet naîtra
   * aussi fourni que le plus ancien du parc — celui qui a accumulé des mois
   * d'historique. C'est le pire cas, et l'annoncer seul fait renoncer à des
   * projets qui tenaient largement.
   *
   * Prendre la MÉDIANE seule ferait l'inverse : promettre une place qu'un
   * projet vieillissant finira par manger.
   *
   * On rend donc une FOURCHETTE, et l'on nomme les deux bouts. La décision
   * appartient à qui la lit ; ce préflight lui donne de quoi la prendre.
   *
   * Deux bases par projet : une recette exercée, une production qui la rejoindra.
   */
  const typique = mures[Math.floor(mures.length / 2)];
  const pire = mures[mures.length - 1];
  return {
    typique,
    pire,
    parProjetTypique: typique * 2,
    parProjetPire: pire * 2,
    echantillon: mures.length,
  };
}

export async function capacityReport({ client, env = process.env }) {
  const { bases, total } = await measureOccupancy(client);
  const allowance = declaredAllowance(env);
  const cout = estimateProjectCost(bases);
  const libres = allowance === null ? null : Math.max(0, allowance - total);
  const projets = libres === null || !cout ? null : {
    optimiste: Math.floor(libres / cout.parProjetTypique),
    prudent: Math.floor(libres / cout.parProjetPire),
  };
  return { bases, total, allowance, libres, cout, projets };
}

/* ── EXÉCUTION DIRECTE ────────────────────────────────────────────────────── */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI absente : impossible de mesurer quoi que ce soit.');
    process.exit(2);
  }
  await mongoose.connect(uri);
  const client = mongoose.connection.getClient();
  const r = await capacityReport({ client });

  console.log('\nBASE'.padEnd(35), 'COLL'.padStart(5), 'Mo'.padStart(10));
  for (const b of r.bases) {
    console.log(b.nom.padEnd(34), String(b.collections).padStart(5), String(b.mo).padStart(10));
  }
  console.log(''.padEnd(34, '─'), '─────', '──────────');
  console.log('CURRENT_COLLECTIONS'.padEnd(34), String(r.total).padStart(5));

  if (r.allowance === null) {
    console.log('\nALLOCATION           NON DÉCLARÉE');
    console.log('  La limite de collections n’est PAS lisible depuis le cluster : Atlas refuse');
    console.log('  `hostInfo` et `getParameter` sur les paliers partagés. Déclarez ce que votre');
    console.log('  offre autorise — console Atlas, onglet du cluster — dans :');
    console.log('      MONGO_COLLECTION_ALLOWANCE=<n>');
    console.log('  Sans elle, ce préflight rend l’occupation et rien de plus.');
    process.exit(0);
  }

  console.log('ALLOWANCE (déclarée)'.padEnd(34), String(r.allowance).padStart(5));
  console.log('FREE_COLLECTION_SLOTS'.padEnd(34), String(r.libres).padStart(5));
  if (r.cout) {
    console.log(`\nESTIMATION (observée sur ${r.cout.echantillon} projet(s) — ce n’est PAS une garantie)`);
    console.log(`  projet typique : ~${r.cout.typique} collections/base → ~${r.cout.parProjetTypique} par projet`);
    console.log(`  projet mûr     : ~${r.cout.pire} collections/base → ~${r.cout.parProjetPire} par projet`);
    console.log(`  ESTIMATED_NEW_PROJECT_CAPACITY : ${r.projets.prudent} à ${r.projets.optimiste} projet(s)`);
    console.log('  (recette + production comptées ; un projet exercé sur un seul monde coûte la moitié)');
  } else {
    console.log('\nAucun projet assez mûr pour estimer un coût : on ne devine pas.');
  }

  const seuil = r.cout ? r.cout.parProjetTypique : 60;
  if (r.libres < seuil) {
    console.log(`\n⚠ MARGE INSUFFISANTE pour un projet de plus (${r.libres} < ~${seuil}).`);
    console.log('  Libérez des bases de fixture avant de dupliquer, ou changez de palier.');
    process.exit(1);
  }
  console.log('\n✓ Marge suffisante pour au moins un nouveau projet.');
  await mongoose.disconnect();
  process.exit(0);
}
