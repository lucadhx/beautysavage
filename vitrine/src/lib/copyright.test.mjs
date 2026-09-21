/* Mention de copyright : l'année suit le calendrier, et on le prouve sans
 * attendre le 1er janvier. Module PUR — aucun DOM, aucun réseau. */

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

const { copyrightYear, copyrightNotice } = await import('./copyright.ts');

section("1 · L'année suit la date, pas la compilation");
{
  /**
   * LE CŒUR DU CONTRÔLE.
   *
   * Un test qui comparerait l'affichage à `new Date().getFullYear()` serait
   * vert aujourd'hui, vert en 2027, et vert même si quelqu'un remplaçait le
   * calcul par la constante 2026 — puisqu'en 2026 les deux coïncident. La seule
   * assertion qui distingue ces deux produits est celle qui DONNE une autre
   * année.
   */
  check('2026 → 2026', copyrightYear(new Date('2026-06-15T12:00:00Z')) === 2026);
  check('2027 → 2027', copyrightYear(new Date('2027-06-15T12:00:00Z')) === 2027);
  check('2030 → 2030', copyrightYear(new Date('2030-01-01T09:00:00Z')) === 2030);

  const annees = [2026, 2027, 2028].map((a) => copyrightYear(new Date(`${a}-06-15T12:00:00Z`)));
  check('trois années consécutives donnent trois valeurs distinctes',
    new Set(annees).size === 3, annees.join(', '));
}

section('2 · Le passage à la nouvelle année ne demande aucun déploiement');
{
  const dernierInstant2026 = new Date('2026-12-31T22:59:59Z');   // 23:59:59 à Paris
  const premierInstant2027 = new Date('2027-01-01T00:00:01Z');   // 01:00:01 à Paris
  check('31 décembre 2026 → 2026', copyrightYear(dernierInstant2026) === 2026,
    String(copyrightYear(dernierInstant2026)));
  check('1er janvier 2027 → 2027', copyrightYear(premierInstant2027) === 2027,
    String(copyrightYear(premierInstant2027)));
  check("la bascule n'exige qu'un rendu, pas un build",
    copyrightYear(premierInstant2027) - copyrightYear(dernierInstant2026) === 1);
}

section("3 · La mention complète nomme l'entreprise reçue du Panel");
{
  check('mention 2026 pour R.L.V Detail',
    copyrightNotice('R.L.V Detail', new Date('2026-03-01T12:00:00Z'))
      === '© 2026 R.L.V Detail. Tous droits réservés.',
    copyrightNotice('R.L.V Detail', new Date('2026-03-01T12:00:00Z')));
  check('mention 2027 pour R.L.V Detail',
    copyrightNotice('R.L.V Detail', new Date('2027-03-01T12:00:00Z'))
      === '© 2027 R.L.V Detail. Tous droits réservés.');
  check("le même produit sert n'importe quel client",
    copyrightNotice('SB Auto', new Date('2027-03-01T12:00:00Z'))
      === '© 2027 SB Auto. Tous droits réservés.');
  check('aucune année ni aucun nom en dur dans le module',
    !/20\d\d/.test(await (await import('node:fs/promises')).readFile(
      new URL('./copyright.ts', import.meta.url), 'utf8').then((s) => s.replace(/\/\*[\s\S]*?\*\//g, ''))));
}

section("4 · Sans nom d'entreprise, le pied de page se tait");
{
  const dates = new Date('2026-03-01T12:00:00Z');
  check('nom absent → chaîne vide', copyrightNotice(undefined, dates) === '');
  check('nom nul → chaîne vide', copyrightNotice(null, dates) === '');
  check('nom vide → chaîne vide', copyrightNotice('', dates) === '');
  check('nom en espaces → chaîne vide', copyrightNotice('   ', dates) === '');
  check("aucun « © 2026 . » orphelin", !copyrightNotice('', dates).includes('©'));
}

console.log(`\n${pass} réussi(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
