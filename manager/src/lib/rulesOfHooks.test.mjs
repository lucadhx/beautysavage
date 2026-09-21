/* RÈGLES DES HOOKS — vérifiées sur l'ARBRE SYNTAXIQUE, pas à la lecture.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * `ContractDetail` a planté sur « Rendered more hooks than during the previous
 * render » : deux hooks avaient été ajoutés APRÈS le garde
 * `if (loading || !contract) return <BrandLoader />`. Tant que le contrat
 * chargeait, React voyait N hooks ; une fois chargé, N+2. React apparie les
 * hooks par leur ORDRE d'appel : un nombre variable rend l'appariement
 * impossible, et il s'arrête.
 *
 * Le bug est STRUCTUREL, pas conditionnel aux données : aucune valeur métier ne
 * le déclenche ni ne l'évite. Un test qui rendrait le composant avec un jeu de
 * données ne l'attraperait que si ce jeu traversait précisément la frontière du
 * garde. On vérifie donc la seule chose qui compte : que la position des hooks
 * dans le code rende un ordre variable IMPOSSIBLE — quelles que soient les
 * données, pour tous les composants du Manager, pas seulement celui-ci.
 *
 * C'est ce que fait `eslint-plugin-react-hooks`. Le Manager n'a pas ESLint, et
 * on n'ajoute pas une dépendance pour une règle : TypeScript est déjà là et
 * expose son parseur.
 */
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Un hook, c'est `useChose(...)` ou `React.useChose(...)`. */
function nomDuHook(node) {
  if (!ts.isCallExpression(node)) return null;
  const cible = node.expression;
  if (ts.isIdentifier(cible)) return /^use[A-Z]/.test(cible.text) ? cible.text : null;
  if (ts.isPropertyAccessExpression(cible) && ts.isIdentifier(cible.name)) {
    return /^use[A-Z]/.test(cible.name.text) ? `${cible.expression.getText()}.${cible.name.text}` : null;
  }
  return null;
}

const EST_FONCTION = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
  || ts.isMethodDeclaration(n);

/**
 * Parcourt le corps d'UNE fonction sans jamais entrer dans les fonctions
 * imbriquées : elles ont leur propre ordre de hooks, analysé séparément.
 */
function parcourirScope(node, visiter) {
  node.forEachChild(function boucle(enfant) {
    if (EST_FONCTION(enfant)) return; // autre scope
    visiter(enfant);
    enfant.forEachChild(boucle);
  });
}

/** Le statement peut-il interrompre le rendu avant la suite ? */
function peutSortir(statement) {
  let sortie = false;
  const boucle = (n) => {
    if (EST_FONCTION(n)) return; // un `return` dans un callback ne sort pas du rendu
    if (ts.isReturnStatement(n) || ts.isThrowStatement(n)) { sortie = true; return; }
    n.forEachChild(boucle);
  };
  boucle(statement);
  return sortie;
}

/** Contextes où un hook ne serait pas appelé à tous les rendus. */
function contexteConditionnel(node, jusqua) {
  for (let p = node.parent; p && p !== jusqua; p = p.parent) {
    if (EST_FONCTION(p)) return null; // borne : autre scope
    if (ts.isIfStatement(p) || ts.isSwitchStatement(p)) return 'une condition';
    if (ts.isConditionalExpression(p)) return 'un ternaire';
    if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p)
      || ts.isWhileStatement(p) || ts.isDoStatement(p)) return 'une boucle';
    if (ts.isBinaryExpression(p)
      && (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        || p.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) return 'un court-circuit';
    if (ts.isCatchClause(p) || ts.isTryStatement(p)) return 'un try/catch';
  }
  return null;
}

/** Analyse une fonction et rend la liste de ses violations. */
function violations(fn, fichier, source) {
  const corps = fn.body;
  if (!corps || !ts.isBlock(corps)) return [];
  const ligne = (n) => source.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const trouvees = [];
  let sortiePossible = null; // statement qui peut interrompre le rendu

  for (const statement of corps.statements) {
    // 1. Un hook APRÈS un point de sortie : il ne sera pas appelé à tous les rendus.
    if (sortiePossible) {
      parcourirScope(statement, (n) => {
        const hook = nomDuHook(n);
        if (hook) {
          trouvees.push({
            fichier, ligne: ligne(n), hook,
            raison: `appelé après une sortie anticipée ligne ${ligne(sortiePossible)}`,
          });
        }
      });
    }

    // 2. Un hook dans une condition, un ternaire, une boucle…
    parcourirScope(statement, (n) => {
      const hook = nomDuHook(n);
      if (!hook) return;
      const ctx = contexteConditionnel(n, corps);
      if (ctx) trouvees.push({ fichier, ligne: ligne(n), hook, raison: `appelé dans ${ctx}` });
    });

    if (!sortiePossible && peutSortir(statement)) sortiePossible = statement;
  }
  return trouvees;
}

function analyser(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8');
  const source = ts.createSourceFile(fichier, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const trouvees = [];
  const rel = path.relative(SRC, fichier).replace(/\\/g, '/');
  const boucle = (n) => {
    if (EST_FONCTION(n)) trouvees.push(...violations(n, rel, source));
    n.forEachChild(boucle);
  };
  boucle(source);
  return trouvees;
}

function fichiers(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiers(p));
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────── */
section('1. L’analyseur détecte VRAIMENT les trois formes de violation');
{
  // Sans cette preuve, un analyseur muet passerait pour un code sain.
  const cas = (code) => {
    const s = ts.createSourceFile('cas.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const out = [];
    const boucle = (n) => { if (EST_FONCTION(n)) out.push(...violations(n, 'cas.tsx', s)); n.forEachChild(boucle); };
    boucle(s);
    return out;
  };

  // Exactement le bug de ContractDetail.
  const apresRetour = cas(`function C({ loading }) {
    const [a, setA] = React.useState(0);
    if (loading) return null;
    const [b, setB] = React.useState(1);
    return a + b;
  }`);
  check('hook après un `if (…) return` → détecté', apresRetour.length === 1);
  check('…désigné par son nom', apresRetour[0]?.hook === 'React.useState');
  check('…avec la ligne fautive', apresRetour[0]?.ligne === 4);
  check('…et la ligne du retour qui le rend conditionnel',
    /ligne 3/.test(apresRetour[0]?.raison || ''));

  check('hook dans un `if` → détecté',
    cas('function C({ x }) { if (x) { const [a] = React.useState(0); } return null; }').length === 1);
  check('hook dans un ternaire → détecté',
    cas('function C({ x }) { const a = x ? useMemo(() => 1, []) : 0; return a; }').length === 1);
  check('hook dans un court-circuit → détecté',
    cas('function C({ x }) { const a = x && useMemo(() => 1, []); return a; }').length === 1);
  check('hook dans une boucle → détecté',
    cas('function C({ xs }) { for (const x of xs) { useEffect(() => {}, []); } return null; }').length === 1);
  check('hook dans un switch → détecté',
    cas('function C({ x }) { switch (x) { case 1: useEffect(() => {}, []); } return null; }').length === 1);

  // …et ne crie pas sur du code sain.
  check('hooks en tête puis retour anticipé → OK',
    cas(`function C({ loading }) {
      const [a] = React.useState(0);
      const [b] = React.useState(1);
      React.useEffect(() => {}, [a]);
      if (loading) return null;
      return a + b;
    }`).length === 0);
  check('un `return` dans un callback ne compte pas comme sortie',
    cas(`function C() {
      const f = () => { if (!x) return; };
      const [a] = React.useState(0);
      return a;
    }`).length === 0);
  check('une condition DANS un callback de hook ne compte pas',
    cas(`function C() {
      React.useEffect(() => { if (x) doThing(); }, [x]);
      const [a] = React.useState(0);
      return a;
    }`).length === 0);
  check('un composant imbriqué a son propre ordre',
    cas(`function C({ loading }) {
      const [a] = React.useState(0);
      if (loading) return null;
      return <div>{items.map(() => { const [b] = React.useState(1); return b; })}</div>;
    }`).length === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Le scénario exact : ContractDetail, du chargement au brouillon');
{
  const page = path.join(SRC, 'pages/dev/DevContractsPage.tsx');
  const texte = fs.readFileSync(page, 'utf8');
  const trouvees = analyser(page);

  check('aucune violation dans DevContractsPage', trouvees.length === 0);
  if (trouvees.length) {
    for (const v of trouvees) console.error(`      → ${v.fichier}:${v.ligne} ${v.hook} ${v.raison}`);
  }

  // Le garde EXISTE toujours : la correction n'a pas consisté à le retirer.
  // Ouvrir un brouillon, en créer un, changer d'étape — tous ces rendus
  // traversent ce garde, dans les deux sens.
  check('le garde de chargement est conservé',
    /if \(loading \|\| !contract\) return <BrandLoader \/>;/.test(texte));

  // …et TOUS les hooks du composant le précèdent. Comparaison de positions sur
  // l'arbre : une tranche de texte déborderait sur les composants suivants.
  const source = ts.createSourceFile(page, texte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let detail = null;
  const chercher = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'ContractDetail') detail = n;
    n.forEachChild(chercher);
  };
  chercher(source);
  check('le composant fautif est bien retrouvé', detail !== null);

  const garde = detail.body.statements.find((st) =>
    ts.isIfStatement(st) && /loading \|\| !contract/.test(st.expression.getText()));
  check('le garde est bien une sortie anticipée du composant', garde !== undefined);

  const hooks = [];
  parcourirScope(detail.body, (n) => { if (nomDuHook(n)) hooks.push(n); });
  const tardifs = hooks.filter((h) => h.getStart() >= garde.getStart());
  for (const h of tardifs) {
    console.error(`      → ligne ${source.getLineAndCharacterOfPosition(h.getStart()).line + 1} ${nomDuHook(h)}`);
  }
  check(`les ${hooks.length} hooks du composant sont TOUS avant le garde`,
    hooks.length > 15 && tardifs.length === 0);

  // L'état ajouté par le lot « Signature » — celui qui a cassé l'ordre.
  check('l’état des étapes confirmées est déclaré avant le garde',
    texte.indexOf('const [confirmes', texte.indexOf('function ContractDetail')) < garde.getStart());
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Tout le Manager, pas seulement la page fautive');
{
  const tous = fichiers(SRC);
  check('des fichiers ont bien été analysés', tous.length > 50);
  const trouvees = tous.flatMap(analyser);
  for (const v of trouvees) console.error(`      → ${v.fichier}:${v.ligne} ${v.hook} ${v.raison}`);
  check(`aucun composant n’appelle ses hooks conditionnellement (${tous.length} fichiers)`,
    trouvees.length === 0);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
