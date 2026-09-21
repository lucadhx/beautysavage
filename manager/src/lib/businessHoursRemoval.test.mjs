/* LES HORAIRES D'OUVERTURE ONT QUITTÉ CE PROJET — verrou au niveau des sources.
 *
 * ══ CE QUE CE FICHIER GARDAIT AVANT, ET POURQUOI IL A CHANGÉ DE SUJET ═══════
 *
 * Il verrouillait un PLACEMENT : l'éditeur d'horaires devait vivre dans
 * « Coordonnées & horaires » et nulle part ailleurs. C'était juste tant que le
 * projet avait des horaires.
 *
 * L.Y Solution n'a pas de guichet : elle n'ouvre pas à 9 h et ne ferme pas le
 * dimanche. Le modèle a perdu `businessHours` et `timezone`, la vitrine a perdu
 * son badge « ouvert / fermé », et l'éditeur a été supprimé.
 *
 * ══ POURQUOI UN VERROU SUR UNE ABSENCE ══════════════════════════════════════
 *
 * Parce qu'un bloc d'horaires est exactement le genre de chose qu'on
 * réintroduit « pour faire complet », sans se demander ce qu'il annonce. Sur ce
 * site, il annoncerait une disponibilité qu'on ne tient pas — et son « fermé »
 * du samedi suggérerait, à tort, qu'on ne répond pas.
 *
 * Le champ ayant disparu du schéma, un écran qui le rebrancherait écrirait dans
 * le vide : l'enregistrement réussirait, et la valeur ne reviendrait jamais.
 * C'est le pire des cas — une panne silencieuse — et c'est ce que ce test rend
 * impossible.
 *
 * Runner autonome. Lancement : npm run test */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const racine = fileURLToPath(new URL('../', import.meta.url));
const read = (rel) => readFile(path.join(racine, rel), 'utf8');

/** Tous les `.ts`/`.tsx` du Manager, hors suites de tests. */
async function sources(dossier = racine) {
  const entrees = await readdir(dossier, { withFileTypes: true });
  const out = [];
  for (const e of entrees) {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...await sources(complet));
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(complet);
  }
  return out;
}

const fichiers = await sources();
check('le périmètre n’est pas vide', fichiers.length > 20);

const avecHoraires = [];
for (const f of fichiers) {
  const src = await readFile(f, 'utf8');
  /* Le code RENDU : les commentaires EXPLIQUENT la suppression et citent donc
     les noms supprimés — c'est leur rôle, et les lire ferait échouer un
     contrôle d'absence sur un fichier parfaitement correct. */
  const nu = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  if (/BusinessHoursEditor|businessHours|onTimezoneChange/.test(nu)) {
    avecHoraires.push(path.relative(racine, f).replace(/\\/g, '/'));
  }
}

check(`aucun écran ne rebranche les horaires — trouvés : ${avecHoraires.join(', ') || 'aucun'}`,
  avecHoraires.length === 0);

/* Le composant lui-même n'existe plus : le vérifier séparément distingue
   « personne ne l'importe » de « il n'est plus là ». */
let composantPresent = true;
try { await read('components/BusinessHoursEditor.tsx'); } catch { composantPresent = false; }
check('le composant BusinessHoursEditor a été SUPPRIMÉ, pas seulement délaissé',
  composantPresent === false);

/* Et le type ne subsiste pas non plus dans la fiche entreprise : un champ resté
   dans le contrat inviterait à croire que le serveur le sert encore. */
const types = await read('types/index.ts');
check('`Company` ne déclare plus businessHours', !/businessHours/.test(types));
check('`Company` ne déclare plus timezone', !/^\s*timezone:/m.test(types));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
