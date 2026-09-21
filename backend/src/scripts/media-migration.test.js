/*
 * Non-régression : migration des URLs de médias (LOT 4).
 * Convertit les URLs ABSOLUES locales d'upload en chemins RELATIFS ; préserve les
 * URLs externes ; idempotent. Transformation PURE, aucune base requise.
 */
import { rewriteLocalUpload, collectMediaRewrites, rewriteDocMedia } from './migrate-media-urls.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

try {
  /* rewriteLocalUpload — cas unitaires */
  check('localhost:6060 /uploads -> relatif', rewriteLocalUpload('http://localhost:6060/uploads/x.webp') === '/uploads/x.webp');
  check('127.0.0.1 /uploads -> relatif', rewriteLocalUpload('http://127.0.0.1:6060/uploads/a-b.png') === '/uploads/a-b.png');
  check('ngrok /uploads -> relatif', rewriteLocalUpload('https://abcd.ngrok-free.app/uploads/y.webp') === '/uploads/y.webp');
  check('URL externe légitime PRÉSERVÉE', rewriteLocalUpload('https://cdn.exemple.com/uploads/z.webp') === null);
  check('chemin déjà relatif : inchangé (idempotent)', rewriteLocalUpload('/uploads/x.webp') === null);
  check('data: URI : inchangé', rewriteLocalUpload('data:image/png;base64,AAAA') === null);
  check('valeur non-upload locale (non /uploads) : inchangée', rewriteLocalUpload('http://localhost:6060/api/health') === null);
  check('valeur non-string : null', rewriteLocalUpload(42) === null);
  check('double slash normalisé', rewriteLocalUpload('http://localhost:6060//uploads//x.webp') === '/uploads/x.webp');
  check('query préservée', rewriteLocalUpload('http://localhost:6060/uploads/x.webp?v=2') === '/uploads/x.webp?v=2');

  /* collectMediaRewrites — chemins pointés (dont indices de tableau) */
  const doc = {
    _id: 'abc',
    logos: { header: 'http://localhost:6060/uploads/logo.png', footer: '/uploads/foot.png' },
    media: [
      { key: 'a', url: 'http://localhost:6060/uploads/a.webp' },
      { key: 'b', url: 'https://cdn.ext.com/img.webp' },
    ],
    name: 'SB Auto',
  };
  const sets = collectMediaRewrites(doc);
  check('collect : logo header réécrit (chemin pointé)', sets['logos.header'] === '/uploads/logo.png');
  check('collect : media[0].url réécrit (indice de tableau)', sets['media.0.url'] === '/uploads/a.webp');
  check('collect : footer relatif NON touché', !('logos.footer' in sets));
  check('collect : CDN externe NON touché', !('media.1.url' in sets));
  check('collect : champ texte NON touché', !('name' in sets));
  check('collect : exactement 2 réécritures', Object.keys(sets).length === 2);

  /* rewriteDocMedia — synthèse + idempotence */
  const r1 = rewriteDocMedia(doc);
  check('rewriteDoc : changed=true', r1.changed === true && Object.keys(r1.sets).length === 2);
  const cleaned = { logos: { header: '/uploads/logo.png', footer: '/uploads/foot.png' }, media: [{ url: '/uploads/a.webp' }] };
  const r2 = rewriteDocMedia(cleaned);
  check('rewriteDoc : idempotent (2e passage = aucun changement)', r2.changed === false);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('MEDIA MIGRATION TEST CRASHED:', err);
  fail++;
} finally {
  process.exit(fail === 0 ? 0 : 1);
}
