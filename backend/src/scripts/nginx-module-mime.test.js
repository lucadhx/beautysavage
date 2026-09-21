/**
 * LES MODULES `.mjs` SONT SERVIS COMME DU JAVASCRIPT — garde de déploiement.
 *
 * ══ LE DÉFAUT QUE CETTE SUITE VERROUILLE ════════════════════════════════════
 *
 * Le worker de PDF.js est un module `.mjs` émis par Vite dans `/assets/`. La
 * table `mime.types` de nginx ne connaît pas cette extension sur les versions
 * encore couramment déployées : le fichier repartait en
 * `application/octet-stream`.
 *
 * Le navigateur applique aux scripts de MODULE un contrôle de type STRICT
 * (spécification HTML). Constaté en recette réelle sur le Manager déployé, au
 * clic « Configurer les zones » :
 *
 *     Failed to load module script: The server responded with a
 *     non-JavaScript MIME type of "application/octet-stream".
 *     Warning: Setting up fake worker.
 *     Uncaught (in promise) Error: Setting up fake worker failed
 *
 * L'éditeur de zones de signature restait alors en chargement, sans fin.
 *
 * ══ POURQUOI CETTE SUITE N'EST PAS UN `grep` ═══════════════════════════════
 *
 * Vérifier que la chaîne « mjs » figure dans la configuration ne prouve rien :
 * une règle peut être présente et ne rien matcher. On prend donc le NOM RÉEL
 * d'un module produit par le build du Manager, on extrait l'expression
 * régulière que le générateur a écrite, et on l'EXÉCUTE contre ce nom.
 *
 * Si le build n'a pas été fait, la suite le DIT et échoue — elle ne se déclare
 * pas verte sur une absence de preuve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderNginxConfig } from '../deployment-engine/nginx.js';
import { parseTargetUrl } from '../deployment-engine/url.js';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n${t}`); }

const ici = path.dirname(fileURLToPath(import.meta.url));
const racineManager = path.resolve(ici, '../../../manager');

const cible = parseTargetUrl('https://demo.exemple.test');
const config = renderNginxConfig(cible, {
  webRoot: '/var/www/demo/vitrine',
  managerRoot: '/var/www/demo/manager',
  backendPort: 6070,
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Le générateur écrit une règle pour les modules');
{
  const ligne = config.split('\n').find((l) => l.includes('location') && l.includes('mjs'));
  check('une directive `location` vise les modules', Boolean(ligne));
  check('…et c’est une expression régulière insensible à la casse',
    Boolean(ligne) && ligne.includes('~*'));

  /**
   * L'IDIOME QUI NE CASSE PAS LE RESTE. Un bloc `types { … }` REMPLACE la table
   * héritée pour sa portée. Vide + `default_type`, il ne force qu'une seule
   * extension ; posé dans `/assets/`, il ferait perdre CSS, polices et images.
   */
  check('la table de types locale est VIDE (elle ne remplace rien d’utile)',
    /location[^\n]*mjs[^{]*\{[\s\S]{0,400}?types\s*\{\s*\}/.test(config));
  check('…et le type par défaut est du JavaScript',
    /location[^\n]*mjs[^{]*\{[\s\S]{0,400}?default_type\s+(application|text)\/javascript\s*;/.test(config));

  /** Les noms sont empreintés par le contenu : la politique de cache doit suivre. */
  check('le bloc conserve le cache long des assets empreintés',
    /location[^\n]*mjs[^{]*\{[\s\S]{0,400}?immutable/.test(config));

  /** `/assets/` doit toujours exister à côté — on n'a pas remplacé, on a ajouté. */
  check('le bloc `/assets/` générique est intact', config.includes('location /assets/'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · La règle matche un module RÉELLEMENT produit par le build');
{
  const dossierAssets = path.join(racineManager, 'dist', 'assets');
  const construit = fs.existsSync(dossierAssets);

  check('le Manager a été construit (dist/assets présent)', construit);

  if (!construit) {
    console.error('    → lancer `npm run build` dans manager/ : sans artefact, rien n’est prouvé.');
  } else {
    const modules = fs.readdirSync(dossierAssets).filter((f) => f.endsWith('.mjs'));
    check(`le build émet au moins un module .mjs (${modules.length})`, modules.length > 0);

    /** L'expression régulière du générateur, extraite puis EXÉCUTÉE. */
    const brut = (config.match(/location\s+~\*\s+(\S+)\s*\{/) ?? [])[1] ?? '';
    check('l’expression régulière est extractible de la configuration', brut.length > 0);

    const regex = new RegExp(brut, 'i');
    for (const nom of modules) {
      check(`« ${nom} » est matché par la règle`, regex.test(`/assets/${nom}`));
    }

    /**
     * ELLE NE DOIT PAS ÊTRE TROP LARGE. Un point non échappé matcherait
     * n'importe quel caractère — « bundlemjs » passerait pour un module.
     */
    check('la règle n’attrape PAS un nom sans point (point bien échappé)',
      !regex.test('/assets/bundlemjs'));
    check('la règle n’attrape pas un .js ordinaire', !regex.test('/assets/index-abc123.js'));
    check('la règle exige la FIN du nom', !regex.test('/assets/x.mjs.map'));

    /** Le worker de PDF.js, nommément : c'est lui qui a produit l'incident. */
    const worker = modules.find((f) => f.startsWith('pdf.worker'));
    check('le worker PDF.js figure parmi les modules émis', Boolean(worker));
    if (worker) {
      check(`« ${worker} » serait servi en JavaScript`, regex.test(`/assets/${worker}`));
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 bis · PRIORITÉ DES `location` — la regex doit pouvoir être évaluée');
{
  /**
   * ══ LE PIÈGE NGINX QUI ANNULERAIT SILENCIEUSEMENT LE CORRECTIF ═══════════
   *
   * nginx évalue les `location` dans un ordre qui n'est pas celui du fichier :
   *
   *   1. `=` exact
   *   2. `^~` préfixe PRIORITAIRE — s'il gagne, les regex ne sont JAMAIS testées
   *   3. `~` / `~*` regex, dans l'ordre du fichier
   *   4. préfixe le plus long
   *
   * Le point 2 est mortel ici : si `/assets/` passait un jour en `^~`, la règle
   * `~* \.mjs$` cesserait d'être évaluée — sans erreur, sans avertissement, et
   * le worker repartirait en `application/octet-stream`. Le correctif serait
   * toujours dans le fichier, et le défaut de retour en production.
   *
   * Ce n'est pas une hypothèse d'école : un autre site du même serveur sert
   * ses assets avec `location ^~ /assets/`. La confusion est à une ligne près.
   */
  const blocsAssets = [...config.matchAll(/location\s+(\S*)\s*\/assets\//g)].map((m) => m[1]);
  check(`les blocs /assets/ sont des préfixes SIMPLES (${JSON.stringify(blocsAssets)})`,
    blocsAssets.length > 0 && blocsAssets.every((mod) => mod === ''));
  check('AUCUN /assets/ en `^~` — sinon la regex .mjs ne serait jamais évaluée',
    !/location\s+\^~\s*\/assets\//.test(config));

  /**
   * La regex doit aussi précéder tout `location /` fourre-tout dans le fichier :
   * l'ordre entre regex compte, même si le préfixe `/` ne les concurrence pas.
   */
  /**
   * L’ORDRE NE COMPTE QU’ENTRE REGEX. Une regex l’emporte toujours sur le
   * préfixe `location /`, quel que soit l’ordre du fichier : comparer les deux
   * ne prouverait rien. Ce qui compte, c’est qu’AUCUNE AUTRE regex ne puisse
   * capter un `.mjs` avant la nôtre — la première qui matche gagne.
   */
  const regexLocations = [...config.matchAll(/location\s+~\*\s+(\S+)\s*\{/g)].map((m) => m[1]);
  const capteraientUnModule = regexLocations
    .filter((motif) => {
      try { return new RegExp(motif, 'i').test('/assets/pdf.worker.min-abc123.mjs'); }
      catch { return false; }
    });
  check(`une SEULE regex capte les modules (${JSON.stringify(capteraientUnModule)})`,
    new Set(capteraientUnModule).size === 1);

  /**
   * ET LE RESTE NE DOIT PAS TOMBER. La table vide ne vaut QUE dans ce bloc :
   * aucun autre `location` ne doit hériter d'un `types { }`.
   */
  const blocsTypesVides = (config.match(/types\s*\{\s*\}/g) || []).length;
  const blocsMjs = (config.match(/location[^\n]*\.mjs\$/g) || []).length;
  check(`la table vide n'existe QUE dans les blocs .mjs (${blocsTypesVides} pour ${blocsMjs})`,
    blocsTypesVides === blocsMjs);
  check('aucun `default_type` JavaScript hors des blocs de modules',
    (config.match(/default_type\s+(application|text)\/javascript/g) || []).length === blocsMjs);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · La règle vaut pour TOUS les hôtes statiques du déploiement');
{
  /**
   * Le Manager et la vitrine sont deux serveurs statiques. Corriger l'un et pas
   * l'autre laisserait le défaut se rejouer sur le premier module que la
   * vitrine embarquera.
   */
  const blocs = config.split('server {').filter((b) => b.includes('location /assets/'));
  check(`plusieurs serveurs statiques sont générés (${blocs.length})`, blocs.length >= 2);
  const couverts = blocs.filter((b) => b.includes('mjs')).length;
  check('chaque serveur statique porte la règle des modules', couverts === blocs.length);
}

/* ════════════════════════════════════════════════════════════════════════════ */
section('4 · L’URL DU WORKER PORTE UNE IDENTITÉ DE RELEASE');
{
  /**
   * Vite empreinte sur le CONTENU. Un asset servi `immutable` dont seule la
   * REPRÉSENTATION HTTP change — un type MIME corrigé — garde donc la même URL,
   * et les navigateurs qui ont mémorisé la mauvaise réponse ne la redemandent
   * jamais. C'est ce qui s'est produit sur le worker de PDF.js.
   *
   * On vérifie donc que le bundle référence le worker avec une identité de
   * RELEASE, et pas seulement par son hachage de contenu.
   */
  const dossier = path.join(racineManager, 'dist', 'assets');
  if (!fs.existsSync(dossier)) {
    check('le Manager a été construit — identité de release non vérifiable', false);
  } else {
    const chunks = fs.readdirSync(dossier).filter((f) => f.endsWith('.js'));
    const porteurs = chunks.filter((f) => fs.readFileSync(path.join(dossier, f), 'utf8').includes('pdf.worker'));
    check(`un chunk référence le worker (${porteurs.join(', ') || 'aucun'})`, porteurs.length > 0);

    const source = porteurs.map((f) => fs.readFileSync(path.join(dossier, f), 'utf8')).join('');
    check('l’URL du worker est composée avec un paramètre `build`', source.includes('build='));

    /** Pas de cache-bust par horodatage : 1,3 Mo reteléchargés à chaque ouverture. */
    check('la révision n’est PAS recalculée à chaque chargement',
      !source.includes('build=' + '${Date.now()}') && !/Date\.now\(\)[^;]{0,40}build=/.test(source));
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
