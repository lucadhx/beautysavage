/* AUCUNE PHRASE TECHNIQUE N'ARRIVE À L'ÉCRAN — et aucune phrase métier n'est
 * avalée en chemin.
 *
 * Les deux moitiés comptent autant. Un normaliseur trop zélé serait pire que
 * le défaut qu'il corrige : il transformerait « Impossible de supprimer ce
 * modèle : il est utilisé par deux contrats » en « Une erreur est survenue »,
 * et l'utilisateur perdrait la seule information qui lui permettait d'agir.
 *
 * Runner autonome. Lancement : npm run test */
import { messageUtilisateur, estMessageTechnique } from '@/lib/erreurs';
import { ApiError } from '@/lib/api';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

/* La console est muette pendant la recette : le module journalise
   volontairement ce qu'il écarte, et ce bruit masquerait les assertions. */
const erreurConsole = console.error;
console.error = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('  ✗')) erreurConsole(...a); };

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. Les messages RÉDIGÉS passent intacts');

const METIER = [
  'Impossible de supprimer ce modèle : il est utilisé par deux contrats.',
  '4 chiffres clés au maximum — la page d’accueil n’en dessine pas davantage.',
  'Ce contrat est déjà signé : il ne peut plus être modifié.',
  'Le serveur a refusé ces identifiants.',
  'Aucun destinataire n’est configuré pour cette notification.',
];
for (const m of METIER) {
  check(`« ${m.slice(0, 46)}… » est conservé`, messageUtilisateur(new ApiError(400, m)) === m);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. Les phrases que personne n’a écrites sont remplacées');

const TECHNIQUES = [
  ['String must contain at most 40 character(s)', 400],
  ['Array must contain at most 3 element(s)', 400],
  ['Path `value` is required.', 400],
  ['Cannot read properties of undefined (reading \'showcase\')', 500],
  ['<html><head><title>502 Bad Gateway</title></head></html>', 502],
  ['{"error":"ECONNREFUSED"}', 500],
  ['TypeError: fetch failed', 500],
];
for (const [m, statut] of TECHNIQUES) {
  const rendu = messageUtilisateur(new ApiError(statut, m));
  check(
    `« ${m.slice(0, 42)}… » n’atteint pas l’écran`,
    rendu !== m && rendu.length > 0,
    `rendu = ${rendu}`,
  );
  check(
    '…et ce qui le remplace est en français',
    /[éèêàçûôîùâëï’]|\b(le|la|les|vous|votre|réessayez|serveur|demande)\b/i.test(rendu),
    `rendu = ${rendu}`,
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. Le statut HTTP décide quand la phrase ne dit rien');

check(
  'un 403 explique le droit manquant',
  /droits/.test(messageUtilisateur(new ApiError(403, 'Forbidden'))),
);
check(
  'un 404 explique l’absence',
  /introuvable/i.test(messageUtilisateur(new ApiError(404, 'Not Found'))),
);
check(
  'un 409 propose de recharger',
  /rechargez/i.test(messageUtilisateur(new ApiError(409, 'Conflict'))),
);
check(
  'un statut inconnu retombe sur le repli de l’appelant',
  messageUtilisateur(new ApiError(418, 'I am a teapot'), 'L’enregistrement a échoué.')
    === 'L’enregistrement a échoué.',
);

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. Les cas particuliers gardent leur phrase dédiée');

check(
  'un serveur injoignable garde son diagnostic',
  messageUtilisateur(new ApiError(0, 'Serveur injoignable. Vérifiez qu’il est démarré, puis réessayez.'))
    .startsWith('Serveur injoignable'),
);

const trop = new ApiError(429, 'Trop de tentatives de connexion. Réessayez dans quelques minutes.');
trop.retryAfterSeconds = 300;
check(
  'un 429 annonce le délai réellement communiqué par le serveur',
  /5 minutes/.test(messageUtilisateur(trop)),
  messageUtilisateur(trop),
);

check(
  'une exception JavaScript ne fuit pas son message',
  messageUtilisateur(new TypeError('x.y is not a function'), 'La suppression a échoué.')
    === 'La suppression a échoué.',
);
check(
  'une valeur jetée qui n’est pas une erreur retombe sur le repli',
  messageUtilisateur('boom', 'L’envoi a échoué.') === 'L’envoi a échoué.',
);

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. Le détecteur ne se trompe pas de côté');

check('une phrase vide est technique', estMessageTechnique(''));
check('une valeur non textuelle est technique', estMessageTechnique(undefined));
check(
  'une phrase française ordinaire ne l’est pas',
  !estMessageTechnique('Le contrat a bien été envoyé au signataire.'),
);
check(
  'une phrase française CITANT un terme anglais reste acceptable',
  !estMessageTechnique('Le webhook Stripe n’a pas répondu : réessayez dans un instant.'),
);

console.error = erreurConsole;
console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
