/**
 * LE SCAN DE SÉCURITÉ DES CREDENTIALS HÉRITÉS — LOT 2C, phase 35.
 *
 * ══ CE QU'IL VÉRIFIE, ET POURQUOI IL NE SUFFIT PAS DE CHERCHER `123dev` ═════
 *
 * Une recherche brute trouve la chaîne dans un test, dans une liste noire,
 * dans une documentation, et dans un mot de passe réellement posé. Ces quatre
 * occurrences n'ont RIEN à voir : la dernière est une faille, les trois autres
 * sont des outils pour l'éviter.
 *
 * Ce contrôle classe donc chaque occurrence par son EMPLACEMENT et son USAGE,
 * et n'interdit qu'une chose — qu'un secret universel soit atteignable depuis
 * le code de PRODUCTION. Le décor de recette (`scripts/`) est autorisé et
 * délimité ; la liste noire de la migration est autorisée et nommée.
 *
 * ══ POURQUOI CE CONTRÔLE EXISTE PLUTÔT QU'UNE RELECTURE ═════════════════════
 *
 * Le défaut d'origine n'est pas né d'une négligence : il est né d'un besoin
 * réel — livrer un projet administrable — résolu de la façon la plus simple.
 * Rien n'empêche que ce besoin revienne. Ce test transforme « on a nettoyé »
 * en « on ne peut plus salir sans que quelqu'un le voie ».
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const ici = path.dirname(fileURLToPath(import.meta.url));
const RACINE_BACKEND = path.resolve(ici, '..');       // backend/src
const RACINE_PROJET = path.resolve(ici, '..', '..', '..');
const SECRETS = ['123dev', '123admin'];

/** Fichiers source du projet, hors dépendances et artefacts. */
function fichiers(racine, extensions = ['.js', '.mjs', '.ts', '.tsx']) {
  const out = [];
  const ignores = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.vite', 'uploads', 'migration-reports']);
  const parcourir = (dir) => {
    for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignores.has(entree.name)) continue;
      const complet = path.join(dir, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else if (extensions.includes(path.extname(entree.name))) out.push(complet);
    }
  };
  parcourir(racine);
  return out;
}

const relatif = (f) => path.relative(RACINE_PROJET, f).split(path.sep).join('/');

/**
 * ══ « MENTIONNÉ » N'EST PAS « UTILISÉ » — et c'est tout l'enjeu du scan ══════
 *
 * Le code de ce lot PARLE beaucoup de `123dev` : il explique, en commentaire,
 * quel défaut il supprime et pourquoi. Un scan qui compterait ces phrases comme
 * des failles aurait un effet pervers immédiat — on effacerait les explications
 * pour faire passer le contrôle, et la prochaine personne rétablirait le défaut
 * faute de savoir qu'il en était un.
 *
 * On retire donc les commentaires avant de chercher. Ce qui reste est du code
 * exécutable : là, un secret universel n'a aucune excuse.
 */
function sansCommentaires(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(/\r?\n/)
    .map((ligne) => ligne.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/* ══════════════════════════════════════════════════════════════════════════
   1. CLASSIFICATION DE CHAQUE OCCURRENCE.
   ══════════════════════════════════════════════════════════════════════════ */
section('1 · Chaque occurrence d’un secret historique est classée');

const occurrences = [];
for (const fichier of fichiers(RACINE_BACKEND)) {
  const contenu = fs.readFileSync(fichier, 'utf8');
  const code = sansCommentaires(contenu);
  for (const secret of SECRETS) {
    if (!contenu.includes(secret)) continue;
    const rel = relatif(fichier);
    /**
     * QUATRE CLASSES, ÉTABLIES PAR L'EMPLACEMENT ET PAR L'USAGE — jamais par
     * l'intention supposée de l'auteur :
     *
     *   DOCUMENTATION  la chaîne n'apparaît QUE dans un commentaire. Le code
     *                  du lot explique le défaut qu'il supprime ; l'effacer
     *                  pour faire taire un scan ferait perdre la raison.
     *   DENYLIST       la migration présente ces valeurs à un hash pour savoir
     *                  s'il faut le révoquer. Elle ne s'en sert jamais pour
     *                  authentifier ni pour créer.
     *   TEST_FIXTURE   décor de recette, base éphémère, jamais livré.
     *   ACTIVE_...     tout le reste : un secret universel atteignable depuis
     *                  du code exécutable de production.
     */
    const dansLeCode = code.includes(secret);
    const classe = !dansLeCode
      ? 'DOCUMENTATION'
      : rel.includes('/scripts/migrate-legacy-local-dev')
        ? 'DENYLIST'
        : rel.includes('/scripts/')
          ? 'TEST_FIXTURE'
          : 'ACTIVE_SECURITY_RISK';
    occurrences.push({ fichier: rel, secret, classe });
  }
}

const risques = occurrences.filter((o) => o.classe === 'ACTIVE_SECURITY_RISK');
for (const r of risques) console.error(`      → RISQUE : ${r.fichier} contient « ${r.secret} »`);
check('AUCUN secret universel dans le code de production', risques.length === 0);
check('les occurrences restantes sont toutes classées',
  occurrences.every((o) => ['TEST_FIXTURE', 'DENYLIST', 'DOCUMENTATION'].includes(o.classe)));
check('la liste noire de migration est bien la seule DENYLIST',
  occurrences.filter((o) => o.classe === 'DENYLIST')
    .every((o) => o.fichier.endsWith('migrate-legacy-local-dev.mjs')));
check('aucun décor de recette hors de scripts/',
  occurrences.filter((o) => o.classe === 'TEST_FIXTURE').every((o) => o.fichier.includes('/scripts/')));

// La classification est IMPRIMÉE : un rapport de lot doit pouvoir la recopier.
for (const classe of ['ACTIVE_SECURITY_RISK', 'DENYLIST', 'TEST_FIXTURE', 'DOCUMENTATION']) {
  const n = occurrences.filter((o) => o.classe === classe).length;
  console.log(`      ${classe} : ${n} occurrence(s)`);
}

/* ══════════════════════════════════════════════════════════════════════════
   2. LE CODE DE PRODUCTION NE POSE AUCUN MOT DE PASSE.
   ══════════════════════════════════════════════════════════════════════════ */
section('2 · Le produit ne fabrique aucun mot de passe');
{
  const bootstrap = sansCommentaires(
    fs.readFileSync(path.join(RACINE_BACKEND, 'config', 'bootstrap.js'), 'utf8')
  );
  check('l’amorçage ne LIT plus SEED_DEV_PASSWORD', !bootstrap.includes('SEED_DEV_PASSWORD'));
  check('…ni SEED_ADMIN_PASSWORD', !bootstrap.includes('SEED_ADMIN_PASSWORD'));
  check('…et n’écrit aucun champ `password`', !/password\s*:/.test(bootstrap));
  check('l’amorçage exige une adresse EXPLICITE', bootstrap.includes('FIRST_DEV_EMAIL'));
  check('…et ne retombe sur AUCUNE adresse par défaut',
    !bootstrap.includes('dev@mail.com') && !bootstrap.includes('admin@mail.com'));

  const service = fs.readFileSync(path.join(RACINE_BACKEND, 'services', 'localDevBootstrap.service.js'), 'utf8');
  check('le service d’amorçage ne génère jamais de mot de passe',
    !/randomBytes[^;]*password/i.test(service));
  check('…et ne journalise jamais le token brut',
    !/logger\.[a-z]+\([^;]*\$\{\s*(rawToken|token|activationUrl)/.test(service));

  /**
   * LE MOTEUR DE DUPLICATION NE TRANSPORTE PLUS DE SECRET D'AMORÇAGE.
   * Il en écrivait un dans le `.env` de chaque copie ; il en efface désormais
   * les traces héritées.
   */
  const duplication = fs.readFileSync(
    path.join(RACINE_BACKEND, 'duplication-engine', 'duplication.js'), 'utf8'
  );
  check('la duplication n’écrit plus SEED_DEV_PASSWORD', !duplication.includes('seedDevPassword'));
  check('…et supprime activement les secrets hérités', duplication.includes('ENV_KEYS_TO_STRIP'));
  check('…elle refuse tout mot de passe reçu', duplication.includes('FIRST_DEV_PASSWORD_REFUSED'));
  check('…et bloque sans adresse de premier développeur', duplication.includes('FIRST_DEV_REQUIRED'));
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LE MODÈLE AUTORISE L'ABSENCE DE MOT DE PASSE — sans faux hash.
   ══════════════════════════════════════════════════════════════════════════ */
section('3 · L’absence de mot de passe est un état de première classe');
{
  const modele = fs.readFileSync(path.join(RACINE_BACKEND, 'models', 'User.model.js'), 'utf8');
  check('le mot de passe est conditionnellement requis', modele.includes('PENDING_ACTIVATION'));
  check('…et un compte sans mot de passe refuse toute comparaison',
    modele.includes('if (!this.password) return Promise.resolve(false);'));

  const activation = fs.readFileSync(path.join(RACINE_BACKEND, 'models', 'LocalDevActivation.model.js'), 'utf8');
  check('le token d’activation est stocké HACHÉ et UNIQUE',
    activation.includes('tokenHash') && activation.includes('unique: true'));
  check('…et l’état d’envoi est conservé, pas seulement journalisé',
    activation.includes('emailStatus'));
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LA DOCUMENTATION NE PROMET PLUS UN COMPTE UNIVERSEL.
   ══════════════════════════════════════════════════════════════════════════ */
section('4 · La documentation d’installation ne distribue plus de credential');
{
  const env = fs.readFileSync(path.join(RACINE_PROJET, 'backend', '.env.example'), 'utf8');
  /**
   * ON CHERCHE UNE VARIABLE PROPOSÉE, PAS UN NOM PRONONCÉ.
   *
   * Le fichier EXPLIQUE que `SEED_DEV_PASSWORD` n'existe plus — c'est utile à
   * qui migre une installation ancienne. Ce qui serait fautif, c'est une ligne
   * que l'on n'aurait qu'à décommenter pour ressusciter le défaut.
   */
  const proposees = env.split(/\r?\n/)
    .map((l) => l.replace(/^#\s*/, '').trim())
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => l.split('=')[0]);
  check('.env.example ne propose plus SEED_DEV_PASSWORD', !proposees.includes('SEED_DEV_PASSWORD'));
  check('…ni SEED_ADMIN_PASSWORD', !proposees.includes('SEED_ADMIN_PASSWORD'));
  check('…et propose FIRST_DEV_EMAIL', proposees.includes('FIRST_DEV_EMAIL'));
  check('…sans citer aucun mot de passe de démonstration',
    !SECRETS.some((s) => env.includes(s)));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
