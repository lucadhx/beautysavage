/* Catalogue de polices (miroir Manager) : unicité, résolution, URL Google
 * Fonts jamais arbitraire. Module pur. */
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

const { FONT_CATALOG, DEFAULT_TYPOGRAPHY, fontById, googleFontsHref } = await import('./fontCatalog.ts');

check('ids uniques', new Set(FONT_CATALOG.map((f) => f.id)).size === FONT_CATALOG.length);
check('chaque entrée a label + cssFamily + preview + poids', FONT_CATALOG.every((f) => f.label && f.cssFamily && f.previewText && f.weights.length > 0));
check('défauts présents (poppins/inter = rendu historique)', Boolean(fontById(DEFAULT_TYPOGRAPHY.headingFont)) && Boolean(fontById(DEFAULT_TYPOGRAPHY.bodyFont)));
check('fontById inconnu -> null', fontById('comic-sans') === null);

const href = googleFontsHref(['poppins', 'inter']);
check('URL css2 construite depuis le catalogue', /^https:\/\/fonts\.googleapis\.com\/css2\?family=/.test(href));
check('familles encodées + poids', href.includes('Poppins') && href.includes('wght@'));
check('display=swap (pas de flash bloquant)', href.includes('display=swap'));
check('police système seule -> aucune URL', googleFontsHref(['system']) === null);
check('id inconnu ignoré (jamais une URL arbitraire)', googleFontsHref(['comic-sans']) === null);
check('doublons dédupliqués', (googleFontsHref(['inter', 'inter']).match(/family=/g) || []).length === 1);

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
