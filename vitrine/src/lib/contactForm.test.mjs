/* Tests du formulaire de contact (vitrine) : validation, motifs, payload,
 * idempotence, honeypot, messages.
 * Module PUR — aucun DOM, aucun réseau. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  CONTACT_REASONS, EMPTY_FORM, MAX_NAME_LENGTH, MAX_MESSAGE_LENGTH,
  MAX_COMPANY_LENGTH, MAX_ACTIVITY_LENGTH,
  validateContactForm, isContactFormValid, errorMessage, ERROR_MESSAGE,
  remainingChars, shouldShowCounter,
  buildContactPayload, newClientSubmissionId,
  SUCCESS_MESSAGE, NETWORK_ERROR_MESSAGE,
} = await import('./contactForm.ts');

const filled = (over = {}) => ({
  ...EMPTY_FORM,
  name: 'Jean Dupont',
  companyName: 'Atelier Dupont',
  activity: 'Ébénisterie',
  email: 'jean@exemple.fr',
  phone: '06 12 34 56 78',
  reason: 'NEW_PRESENCE',
  message: 'Nous voulons une présence à la hauteur de notre atelier.',
  ...over,
});

// ---------------------------------------------------------------------------
section('Motifs');
{
  check('quatre motifs', CONTACT_REASONS.length === 4);
  check('tous ont un code et un libellé', CONTACT_REASONS.every((r) => r.value && r.label));
  // Le frontend envoie un CODE : un libellé se retraduit, un code non.
  check('les codes sont en MAJUSCULES stables',
    CONTACT_REASONS.every((r) => /^[A-Z_]+$/.test(r.value)));
  check('codes attendus',
    CONTACT_REASONS.map((r) => r.value).join(',') === 'NEW_PRESENCE,REDESIGN,EVOLUTION,OTHER');
  check('libellés en français',
    CONTACT_REASONS.find((r) => r.value === 'NEW_PRESENCE').label === 'Prendre rendez-vous pour une prestation');
  check('codes uniques', new Set(CONTACT_REASONS.map((r) => r.value)).size === 4);
  /* Le vocabulaire du moteur d'origine ne doit pas survivre à la duplication :
     un motif « Demande de devis » sur ce site contredirait la page qui le
     porte, laquelle refuse explicitement ce mot. */
  check('aucun motif hérité du moteur d’origine',
    !CONTACT_REASONS.some((r) => ['QUOTE', 'INFORMATION', 'WEBSITE_ISSUE', 'SERVICE_QUESTION'].includes(r.value)));
}

// ---------------------------------------------------------------------------
section('Validation');
{
  check('formulaire complet -> valide', isContactFormValid(filled()));
  check('formulaire complet -> aucune erreur', Object.keys(validateContactForm(filled())).length === 0);
  check('formulaire vide -> invalide', !isContactFormValid(EMPTY_FORM));

  check('nom vide -> CONTACT_NAME_REQUIRED', validateContactForm(filled({ name: '' })).name === 'CONTACT_NAME_REQUIRED');
  check('nom d’espaces -> requis', validateContactForm(filled({ name: '   ' })).name === 'CONTACT_NAME_REQUIRED');
  check('nom trop long -> CONTACT_NAME_TOO_LONG',
    validateContactForm(filled({ name: 'x'.repeat(MAX_NAME_LENGTH + 1) })).name === 'CONTACT_NAME_TOO_LONG');
  check('nom à la limite -> valide', !validateContactForm(filled({ name: 'x'.repeat(MAX_NAME_LENGTH) })).name);

  check('entreprise vide -> CONTACT_COMPANY_REQUIRED',
    validateContactForm(filled({ companyName: '' })).companyName === 'CONTACT_COMPANY_REQUIRED');
  check('entreprise d’espaces -> requise',
    validateContactForm(filled({ companyName: '   ' })).companyName === 'CONTACT_COMPANY_REQUIRED');
  check('entreprise trop longue -> CONTACT_COMPANY_TOO_LONG',
    validateContactForm(filled({ companyName: 'x'.repeat(MAX_COMPANY_LENGTH + 1) })).companyName === 'CONTACT_COMPANY_TOO_LONG');
  /* L'activité est le SEUL champ facultatif borné : vide elle passe, trop
     longue elle est refusée. Les deux cas comptent. */
  check('activité vide -> valide', !validateContactForm(filled({ activity: '' })).activity);
  check('activité trop longue -> CONTACT_ACTIVITY_TOO_LONG',
    validateContactForm(filled({ activity: 'x'.repeat(MAX_ACTIVITY_LENGTH + 1) })).activity === 'CONTACT_ACTIVITY_TOO_LONG');

  check('email vide -> CONTACT_EMAIL_INVALID', validateContactForm(filled({ email: '' })).email === 'CONTACT_EMAIL_INVALID');
  check('email sans @ -> invalide', validateContactForm(filled({ email: 'nope' })).email === 'CONTACT_EMAIL_INVALID');
  check('email sans domaine -> invalide', validateContactForm(filled({ email: 'a@' })).email === 'CONTACT_EMAIL_INVALID');
  check('email sans TLD -> invalide', validateContactForm(filled({ email: 'a@b' })).email === 'CONTACT_EMAIL_INVALID');
  // Permissive exprès : rejeter une adresse valide coûte un client.
  check('email avec + accepté', !validateContactForm(filled({ email: 'jean+devis@exemple.fr' })).email);
  check('email avec sous-domaine accepté', !validateContactForm(filled({ email: 'a@mail.exemple.fr' })).email);
  check('email avec TLD long accepté', !validateContactForm(filled({ email: 'a@exemple.boutique' })).email);

  check('motif vide -> CONTACT_REASON_INVALID', validateContactForm(filled({ reason: '' })).reason === 'CONTACT_REASON_INVALID');
  check('motif inventé -> invalide', validateContactForm(filled({ reason: 'INVENTED' })).reason === 'CONTACT_REASON_INVALID');
  check('chaque motif du registre est accepté',
    CONTACT_REASONS.every((r) => !validateContactForm(filled({ reason: r.value })).reason));

  check('message vide -> CONTACT_MESSAGE_REQUIRED',
    validateContactForm(filled({ message: '' })).message === 'CONTACT_MESSAGE_REQUIRED');
  check('message d’espaces -> requis', validateContactForm(filled({ message: '   ' })).message === 'CONTACT_MESSAGE_REQUIRED');
  check('message trop long -> CONTACT_MESSAGE_TOO_LONG',
    validateContactForm(filled({ message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })).message === 'CONTACT_MESSAGE_TOO_LONG');

  // Le téléphone est FACULTATIF : l'exiger perdrait les visiteurs qui ne veulent
  // pas être appelés.
  check('téléphone vide -> valide', isContactFormValid(filled({ phone: '' })));
  check('téléphone quelconque -> valide (le serveur normalise)', isContactFormValid(filled({ phone: 'aa' })));

  // Le honeypot ne produit JAMAIS d'erreur visible : un humain piégé verrait un
  // message incompréhensible sur un champ qu'il ne voit pas.
  check('honeypot rempli -> AUCUNE erreur de formulaire',
    Object.keys(validateContactForm(filled({ hpCheck: 'http://spam.ru' }))).length === 0);
  check('honeypot rempli -> le formulaire reste « valide » côté client',
    isContactFormValid(filled({ hpCheck: 'spam' })));
}

// ---------------------------------------------------------------------------
section('Messages d’erreur');
{
  check('code connu -> message français', errorMessage('CONTACT_NAME_REQUIRED') === 'Indiquez votre nom.');
  check('code de rate limit traduit', errorMessage('CONTACT_RATE_LIMITED').includes('Trop de demandes'));
  // Une règle serveur plus récente que la vitrine ne doit pas produire un blanc.
  check('code inconnu -> message générique', errorMessage('CODE_DU_FUTUR') === 'Ce champ est invalide.');
  check('code absent -> chaîne vide', errorMessage(undefined) === '');
  check('tous les codes de validation ont un message',
    ['CONTACT_NAME_REQUIRED', 'CONTACT_EMAIL_INVALID', 'CONTACT_REASON_INVALID', 'CONTACT_MESSAGE_REQUIRED',
      'CONTACT_NAME_TOO_LONG', 'CONTACT_MESSAGE_TOO_LONG',
      'CONTACT_COMPANY_REQUIRED', 'CONTACT_COMPANY_TOO_LONG',
      'CONTACT_ACTIVITY_TOO_LONG'].every((c) => Boolean(ERROR_MESSAGE[c])));
}

// ---------------------------------------------------------------------------
section('Compteur de caractères');
{
  check('message vide -> tout le quota', remainingChars('') === MAX_MESSAGE_LENGTH);
  check('décompte correct', remainingChars('abc') === MAX_MESSAGE_LENGTH - 3);
  check('dépassement -> négatif', remainingChars('x'.repeat(MAX_MESSAGE_LENGTH + 5)) === -5);
  check('compteur masqué sur un message court', !shouldShowCounter('bonjour'));
  check('compteur affiché près de la limite', shouldShowCounter('x'.repeat(MAX_MESSAGE_LENGTH * 0.8)));
}

// ---------------------------------------------------------------------------
section('Construction du payload');
{
  const id = '11111111-2222-4333-8444-555555555555';
  const p = buildContactPayload(filled(), { clientSubmissionId: id });

  check('payload : nom nettoyé', buildContactPayload(filled({ name: '  Jean  ' }), { clientSubmissionId: id }).name === 'Jean');
  check('payload : email en minuscules',
    buildContactPayload(filled({ email: 'JEAN@EXEMPLE.FR' }), { clientSubmissionId: id }).email === 'jean@exemple.fr');
  check('payload : message nettoyé', p.message === 'Nous voulons une présence à la hauteur de notre atelier.');
  check('payload : motif transmis', p.reason === 'NEW_PRESENCE');
  /* Le payload TRIM, il ne normalise pas les espaces internes — c'est le
     serveur qui les réduit (`collapse`), et une seconde normalisation ici
     divergerait de la sienne au premier ajustement. Même règle que `name`. */
  check('payload : entreprise détourée',
    buildContactPayload(filled({ companyName: '  Atelier Dupont ' }), { clientSubmissionId: id }).companyName === 'Atelier Dupont');
  check('payload : clientSubmissionId transmis', p.clientSubmissionId === id);

  // Le backend est `.strict()` : un champ en trop fait échouer TOUTE la requête.
  const minimal = buildContactPayload(filled({ phone: '', activity: '', hpCheck: '' }), { clientSubmissionId: id });
  check('payload : téléphone vide OMIS (pas envoyé à "")', !('phone' in minimal));
  check('payload : activité vide OMISE', !('activity' in minimal));
  check('payload : honeypot vide OMIS', !('hpCheck' in minimal));
  check('payload : pageUrl absente OMISE', !('pageUrl' in minimal));
  check('payload : formStartedAt absent OMIS', !('formStartedAt' in minimal));
  check('payload : uniquement les champs attendus par le serveur',
    Object.keys(minimal).sort().join(',') === 'clientSubmissionId,companyName,email,message,name,reason');

  const full = buildContactPayload(filled({ hpCheck: 'spam' }), {
    clientSubmissionId: id, formStartedAt: 1_700_000_000_000, pageUrl: 'https://exemple.fr/contact',
  });
  check('payload : téléphone présent quand rempli', full.phone === '06 12 34 56 78');
  check('payload : activité présente quand remplie', full.activity === 'Ébénisterie');
  check('payload : honeypot transmis quand rempli (le serveur tranche)', full.hpCheck === 'spam');
  check('payload : formStartedAt en ISO', full.formStartedAt === new Date(1_700_000_000_000).toISOString());
  check('payload : pageUrl https transmise', full.pageUrl === 'https://exemple.fr/contact');

  // Le serveur refuse tout sauf http/https : autant ne pas l'envoyer.
  check('payload : pageUrl javascript: OMISE',
    !('pageUrl' in buildContactPayload(filled(), { clientSubmissionId: id, pageUrl: 'javascript:alert(1)' })));
  check('payload : pageUrl file: OMISE',
    !('pageUrl' in buildContactPayload(filled(), { clientSubmissionId: id, pageUrl: 'file:///etc/passwd' })));
  check('payload : pageUrl bornée à 500',
    buildContactPayload(filled(), { clientSubmissionId: id, pageUrl: `https://x.fr/${'a'.repeat(600)}` }).pageUrl.length === 500);
}

// ---------------------------------------------------------------------------
section('Identifiant de soumission');
{
  const a = newClientSubmissionId();
  const b = newClientSubmissionId();
  check('format UUID', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(a));
  check('deux appels -> deux identifiants', a !== b);

  // Le repli doit fonctionner sans crypto (HTTP simple : `randomUUID` n'existe
  // qu'en contexte sécurisé). `globalThis.crypto` n'a qu'un getter sous Node :
  // on le redéfinit le temps du test, puis on le restaure.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  const fallback = newClientSubmissionId();
  const fallback2 = newClientSubmissionId();
  Object.defineProperty(globalThis, 'crypto', descriptor);

  check('repli sans crypto : format UUID conservé',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(fallback));
  check('repli sans crypto : identifiants distincts', fallback !== fallback2);
  check('crypto restauré après le test', typeof globalThis.crypto?.randomUUID === 'function');
}

// ---------------------------------------------------------------------------
section('Messages du visiteur');
{
  check('succès : formulation attendue',
    SUCCESS_MESSAGE === 'Votre demande est bien envoyee. L institut revient vers vous rapidement.');
  // Le visiteur n'a pas à connaître notre infrastructure — et l'e-mail peut
  // parfaitement avoir échoué alors que sa demande est bien enregistrée.
  check('succès : ne mentionne AUCUN e-mail', !/e-?mail/i.test(SUCCESS_MESSAGE));
  check('succès : ne mentionne AUCUN administrateur', !/administrateur/i.test(SUCCESS_MESSAGE));
  check('succès : ne mentionne pas Brevo', !/brevo/i.test(SUCCESS_MESSAGE));

  check('erreur réseau : neutre', !/serveur|500|brevo|api/i.test(NETWORK_ERROR_MESSAGE));
  check('erreur réseau : rassure sur la saisie', /conservé/i.test(NETWORK_ERROR_MESSAGE));
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
