/* Tests de la résolution CANONIQUE des médias (module pur).
 *
 * LOT logos : le logo (login, header, sidebar, loader) disparaissait selon le
 * domaine backend parce que certains composants préfixaient les chemins
 * `/uploads/…` avec la backendUrl PUBLIQUE de la Configuration réseau (ngrok
 * périmé, domaine pas encore déployé). La résolution est désormais UNIQUE :
 * même origine (proxy Vite en dev, Nginx déployé) ou VITE_API_URL — la
 * configuration réseau n'y participe JAMAIS.
 *
 * ══ CE FICHIER ÉTAIT MORT, ET IL NE LE DISAIT PAS ═════════════════════════
 *
 * Il importait `resolveMediaUrl` / `resolveMediaUrlWith`. Ces fonctions ont été
 * renommées `resolvePreviewMediaUrl` / `resolvePreviewMediaUrlWith` sans que
 * l'import suive : depuis, la première ligne levait
 * `TypeError: resolveMediaUrl is not a function`, et la suite du Manager
 * s'arrêtait là — les tests SUIVANTS de la chaîne `&&` ne tournaient plus
 * du tout.
 *
 * Un garde qui échoue au chargement ne garde rien, et son échec ressemble à
 * une panne d'outillage plutôt qu'à une régression : c'est la façon la plus
 * discrète de perdre une protection.
 *
 * AUCUNE ASSERTION N'A ÉTÉ TOUCHÉE — seuls les deux noms importés ont suivi le
 * renommage. Les 21 contrôles passent tels qu'ils avaient été écrits.
 *
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const { resolvePreviewMediaUrl, resolvePreviewMediaUrlWith } = await import('./media.ts');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// Vides / absents
check('undefined -> ""', resolvePreviewMediaUrl(undefined) === '');
check('null -> ""', resolvePreviewMediaUrl(null) === '');
check('"" -> ""', resolvePreviewMediaUrl('') === '');

/* --- LOGIN & HEADER : même origine (régime canonique, VITE_API_URL absent) --- */
check('login : /uploads/logo.webp relatif conservé (même origine)', resolvePreviewMediaUrl('/uploads/logo.webp') === '/uploads/logo.webp');
check('header : sans slash initial -> slash ajouté', resolvePreviewMediaUrl('uploads/logo.webp') === '/uploads/logo.webp');
check('la signature ne prend PLUS de backendUrl (résolution unique)', resolvePreviewMediaUrl.length <= 1);

/* --- CHANGEMENT DE backendUrl / DOMAINE : sans AUCUN effet sur la résolution --- */
// La config réseau n'est plus un paramètre : quel que soit le domaine public
// (localhost, ngrok, domaine client, VPS), le média reste résolu à l'identique.
for (const scenario of [
  ['localhost', 'http://localhost:6070'],
  ['ngrok', 'https://abc123.ngrok-free.app'],
  ['domaine client', 'https://api.garage-dupont.fr'],
  ['VPS', 'https://vps-843.hostinger.com'],
]) {
  const [label] = scenario;
  check(`backendUrl ${label} : résolution INCHANGÉE (même origine)`, resolvePreviewMediaUrl('/uploads/logo.webp') === '/uploads/logo.webp');
}

/* --- VITE_API_URL défini (cross-origin volontaire) : seul préfixe légitime --- */
check('API_ROOT défini : préfixe propre', resolvePreviewMediaUrlWith('/uploads/x.webp', 'http://localhost:6070', false) === 'http://localhost:6070/uploads/x.webp');
check('API_ROOT avec slash final : normalisé', resolvePreviewMediaUrlWith('/uploads/x.webp', 'http://localhost:6070/', false) === 'http://localhost:6070/uploads/x.webp');
check('API_ROOT ngrok https : préfixe conservé', resolvePreviewMediaUrlWith('/uploads/x.webp', 'https://abc.ngrok-free.app', false) === 'https://abc.ngrok-free.app/uploads/x.webp');
check('API_ROOT vide : même origine', resolvePreviewMediaUrlWith('/uploads/x.webp', '', false) === '/uploads/x.webp');

/* --- Page HTTPS : jamais de préfixe http (mixed content) --- */
check('page HTTPS + API_ROOT http : repli même origine', resolvePreviewMediaUrlWith('/uploads/x.webp', 'http://localhost:6070', true) === '/uploads/x.webp');
check('page HTTPS + API_ROOT https : préfixe conservé', resolvePreviewMediaUrlWith('/uploads/x.webp', 'https://api.garage.fr', true) === 'https://api.garage.fr/uploads/x.webp');

/* --- Valeurs absolues héritées en base --- */
check('data: conservé', resolvePreviewMediaUrl('data:image/png;base64,AAA') === 'data:image/png;base64,AAA');
check('https absolu conservé', resolvePreviewMediaUrl('https://cdn.example.com/x.png') === 'https://cdn.example.com/x.png');
check('page HTTPS : ancien http://localhost ramené au chemin relatif', resolvePreviewMediaUrlWith('http://localhost:6060/uploads/x.webp', '', true) === '/uploads/x.webp');
check('page HTTPS : ancien http:// (host public) ramené au chemin relatif', resolvePreviewMediaUrlWith('http://api.vieux-domaine.fr/uploads/x.webp', '', true) === '/uploads/x.webp');
check('page HTTP locale : absolu conservé tel quel', resolvePreviewMediaUrlWith('http://localhost:6070/uploads/x.webp', '', false) === 'http://localhost:6070/uploads/x.webp');

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
