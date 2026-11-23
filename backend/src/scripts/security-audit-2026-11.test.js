/**
 * NON-RÉGRESSION — audit de sécurité du 23/11/2026 (repris de MELINAILS).
 *
 * Chaque bloc rejoue une faille trouvée en ligne et vérifie qu'elle reste
 * fermée. Fonctions pures uniquement : aucun serveur, aucune base.
 */
import { sanitizeRichText } from '../utils/richText.js';
import { sniffDeliverable } from '../services/commerce.service.js';
import { normalizeGiftCode } from '../models/GiftCard.model.js';
import { renderNginxConfig, SECURITY_HEADERS } from '../deployment-engine/nginx.js';
import { buildRemoteEnv } from '../deployment-engine/deployEnv.js';
import { parseTargetUrl } from '../deployment-engine/url.js';
import { shareImageFor, isShareImagePath } from '../services/seo/shareImage.service.js';

let pass = 0;
let fail = 0;
const check = (nom, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ''}`); }
};

console.log('1. Texte riche : aucune balise ne renaît d’un effacement');
const PIEGES = [
  '<im<x>g src=x onerror=alert(1)>',
  '<im<!-- -->g src=x onerror=alert(1)>',
  '<scr<script></script>ipt>alert(1)</script>',
  '<<script>script>alert(1)<</script>/script>',
  '<img/src=x onerror=1>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" JaVaScRiPt:alert(1)">x</a>',
  '<p onclick="x">ok</p>',
  '<svg><script>1</script></svg>',
  '<sp<b>an onmouseover=x>t</span>',
];
for (const piege of PIEGES) {
  const sortie = sanitizeRichText(piege);
  const danger = /<(?!\/?(p|br|strong|b|em|i|u|s|mark|ul|ol|li|h2|h3|h4|blockquote|a|span)[\s/>])[a-z]/i.test(sortie)
    // Un attribut d'évènement n'est dangereux qu'à l'INTÉRIEUR d'une balise.
    || (sortie.match(/<[a-z][^>]*>/gi) || []).some((balise) => /\son[a-z]+\s*=/i.test(balise))
    || /javascript:/i.test(sortie);
  check(`neutralisé : ${piege}`, !danger, sortie);
}
check('le texte « a < b » reste du texte', sanitizeRichText('<p>a < b et c > d</p>') === '<p>a &lt; b et c > d</p>', sanitizeRichText('<p>a < b et c > d</p>'));
check('la mise en forme permise survit', sanitizeRichText('<h2>T</h2><p><strong>g</strong> <a href="https://x.fr">l</a></p>').includes('<a href="https://x.fr" target="_blank" rel="noopener noreferrer">l</a>'));

console.log('2. Livrables : le type vient des octets, pas du nom');
const octets = (...b) => Buffer.from(b);
check('PDF reconnu', sniffDeliverable(Buffer.from('%PDF-1.7 ....'))?.ext === '.pdf');
check('PNG reconnu', sniffDeliverable(octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.ext === '.png');
check('JPEG reconnu', sniffDeliverable(octets(0xff, 0xd8, 0xff, 0xe0))?.ext === '.jpg');
check('MP4 reconnu', sniffDeliverable(Buffer.from('\0\0\0\x18ftypmp42', 'latin1'))?.ext === '.mp4');
check('MOV reconnu', sniffDeliverable(Buffer.from('\0\0\0\x14ftypqt  ', 'latin1'))?.ext === '.mov');
check('HTML refusé', sniffDeliverable(Buffer.from('<!doctype html><script>')) === null);
check('SVG refusé', sniffDeliverable(Buffer.from('<svg onload=alert(1)>')) === null);
check('JS refusé', sniffDeliverable(Buffer.from('alert(document.cookie)')) === null);

console.log('3. Cartes cadeaux : saisie tolérante');
check('BS normalisé', normalizeGiftCode('bs 12ab34 56cd78') === 'BS-12AB34-56CD78');

console.log('4. Déploiement : la production a ses propres secrets');
const SRC = {
  MONGODB_URI: 'mongodb+srv://u:p@c.x.mongodb.net', DB_TEST: 't', DB_PROD: 'p',
  JWT_SECRET: 'secret-recette-'.repeat(5), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64), TEST_SHORTCUTS: '1',
};
const cible = { host: 'beautyconceptbyromane.fr', backendPort: 5111 };
let refus = null;
try { buildRemoteEnv(cible, { env: 'PROD', source: { ...SRC } }); } catch (e) { refus = e; }
check('PROD refusée avec le secret de la recette', refus?.code === 'DEPLOY_ENV_SHARED_SECRET');
const prod = buildRemoteEnv(cible, { env: 'PROD', source: { ...SRC, PROD__JWT_SECRET: 'p'.repeat(80), PROD__INTEGRATED_API_ENCRYPTION_KEY: 'b'.repeat(64) } }).remoteEnv;
check('PROD reçoit ses secrets', prod.JWT_SECRET === 'p'.repeat(80) && prod.INTEGRATED_API_ENCRYPTION_KEY === 'b'.repeat(64));
check('raccourcis de recette jamais sur un serveur', !('TEST_SHORTCUTS' in prod) && !('TEST_SHORTCUTS' in buildRemoteEnv(cible, { env: 'TEST', source: { ...SRC } }).remoteEnv));

console.log('5. nginx : en-têtes de sécurité et compression partout');
const conf = renderNginxConfig(parseTargetUrl('https://beautyconceptbyromane.fr'), { backendPort: 5111 });
const blocs = conf.split('# --- ').slice(1).filter((b) => !b.includes('reverse proxy pur'));
check('vitrine et Manager présents', blocs.length >= 2, String(blocs.length));
for (const b of blocs) {
  const nom = (b.match(/server_name ([^;]+);/) || [])[1];
  check(`${nom} : server_tokens off + gzip`, /server_tokens off;/.test(b) && /gzip_types [^;]*application\/javascript/.test(b));
  for (const loc of b.match(/location[^{]*\{[^{}]*add_header[^{}]*\}/g) || []) {
    const tous = SECURITY_HEADERS.every((h) => loc.includes(h));
    check(`${nom} ${loc.split('{')[0].trim()} garde les en-têtes de sécurité`, tous);
  }
}
check('/index.html de la vitrine : noindex, jamais redirigé (contrôle de déploiement)', /server_name beautyconceptbyromane\.fr;[\s\S]*?location = \/index\.html \{ add_header Cache-Control "no-cache";\s+add_header X-Robots-Tag "noindex, follow" always;/.test(conf));

console.log('6. Image de partage : JPEG dérivé des seuls médias du site');
const og = shareImageFor('https://beautyconceptbyromane.fr', 'https://api.beautyconceptbyromane.fr/uploads/abc-123.webp');
check('média du site → /og/<empreinte>.jpg sur le domaine public', /^https:\/\/beautyconceptbyromane\.fr\/og\/[0-9a-f]{16}\.jpg$/.test(og || ''), og);
check('image externe laissée telle quelle', shareImageFor('https://beautyconceptbyromane.fr', 'https://images.pexels.com/x.jpg') === null);
check('chemin piégé refusé', shareImageFor('https://beautyconceptbyromane.fr', '/uploads/../../.env') === null);
check('motif d’adresse strict', isShareImagePath('/og/0123456789abcdef.jpg') && !isShareImagePath('/og/../x.jpg'));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
