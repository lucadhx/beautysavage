/* Tests de la logique de la carte « Configuration des emails » côté Manager :
 * projection du statut, isolation TEST/PROD, formulaire, conditions du test.
 * Module PUR — aucun DOM, aucun réseau. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  selectActiveMode,
  TEST_ERROR_META, testErrorMeta, shouldOfferBrevoLink, BREVO_DASHBOARD_URL,
  lastTestView, cardState,
  trackingStalled, DELIVERY_CONFIRMATION_TIMEOUT_MS,
  isTestStatusTransitory, shouldPollTestStatus, TEST_POLL_INTERVAL_MS, TEST_POLL_MAX_MS,
  testFailureView, operationalView, serviceView, restoreOutcome,
  pollBudgetMs, nextPollDelayMs,
} = await import('./emailConfiguration.ts');
const { EMAIL_STATE, configState } = await import('./emailStates.ts');

const testState = (over = {}) => ({
  status: 'DELIVERED',
  testExecutionId: 'exec-1',
  providerMessageIdSafe: '<m@brevo>',
  recipientMasked: 'c***@moncommerce.fr',
  lastRecipient: 'dev@moncommerce.fr',
  acceptedAt: '2026-07-18T01:30:00.000Z',
  deliveredAt: '2026-07-18T01:30:05.000Z',
  rejectedAt: null,
  lastTestedAt: '2026-07-18T01:30:00.000Z',
  lastErrorSafe: { code: '', message: '' },
  ...over,
});

const modeState = (over = {}) => ({
  sender: { email: 'contact@moncommerce.fr', name: 'Mon Commerce' },
  apiKeyConfigured: true,
  test: testState(),
  status: 'FUNCTIONAL',
  operational: { ready: true, state: 'READY', blockers: [] },
  ...over,
});

/** Mode dont le SUIVI n'est pas opérationnel : les envois sont bloqués. */
const blocked = (state, blockers) => modeState({
  operational: { ready: false, state, blockers },
});

/** Mode dont le dernier test a été REJETÉ (async) avec le code voulu. */
const failedWith = (code) => modeState({
  status: 'ERROR',
  test: testState({
    status: 'REJECTED',
    providerMessageIdSafe: '<m@brevo>',
    deliveredAt: null,
    rejectedAt: '2026-07-18T01:42:00.000Z',
    lastTestedAt: '2026-07-18T01:42:00.000Z',
    lastErrorSafe: { code, message: 'trace persistée' },
  }),
});

/** Mode ACCEPTÉ, livraison non encore confirmée. */
const acceptedMode = () => modeState({
  status: 'ACCEPTED',
  test: testState({ status: 'ACCEPTED', deliveredAt: null }),
});
const cfg = (over = {}) => ({
  /**
   * `environment`, et non `activeMode` (L12.1).
   *
   * Ce fixture portait l'ancien nom, celui que le serveur n'envoie plus. Il
   * décrivait donc une réponse qui n'existait pas, et c'est pour cela qu'aucun
   * test n'a vu la régression : la section affichait « La configuration des
   * emails n'a pas pu être chargée » sur une réponse 200 parfaitement valide.
   *
   * Un fixture doit ressembler à ce que le serveur envoie VRAIMENT.
   */
  environment: 'TEST',
  modes: { TEST: modeState(), PROD: modeState({ status: 'NOT_CONFIGURED' }) },
  updatedAt: '2026-07-18T01:30:00.000Z',
  ...over,
});

// ---------------------------------------------------------------------------
section('Statut global — projection, jamais déduction');
{
  // Le vocabulaire est DÉRIVÉ de `emailStates` : ce bloc vérifie la traduction,
  // pas une table locale (elle n'existe plus — c'était la source des divergences
  // entre la carte et la liste des envois).
  check('non configuré', configState('NOT_CONFIGURED').label === 'Configuration requise');
  check('à tester', configState('NOT_TESTED').label === 'À tester');
  check('livré', configState('FUNCTIONAL').label === 'Livré');
  check('échec', configState('ERROR').label === 'Échec de livraison');

  // ACCEPTÉ ne doit JAMAIS prétendre que les emails sont arrivés : cœur du fix.
  const accepte = configState('ACCEPTED');
  check('« accepté » devient « en attente de confirmation »',
    accepte.label === 'En attente de confirmation');
  check('« en attente » n’affirme pas la livraison',
    /attente|confirm/i.test(accepte.help) && !/est arrivé|bien remis/i.test(accepte.help));
  check('« livré » = remis au destinataire', /remis/i.test(configState('FUNCTIONAL').help));
  check('« à tester » invite à tester', /test/i.test(configState('NOT_TESTED').help));

  // La couleur ne doit jamais être le seul véhicule de l'information.
  check('chaque état porte un libellé, une tonalité ET une icône',
    Object.values(EMAIL_STATE).every((m) => m.label.length > 0 && m.tone.length > 0 && m.icon.length > 0));

  // Un statut inconnu ne doit JAMAIS afficher la constante backend.
  check('statut inconnu -> état neutre, pas le code',
    configState('N_IMPORTE_QUOI').label === 'État inconnu');
  check('statut absent -> état neutre', configState(undefined).label === 'État inconnu');

  // Aucun jargon technique ni nom de fournisseur dans le vocabulaire produit.
  const texte = JSON.stringify(EMAIL_STATE).toLowerCase();
  check('aucun jargon technique exposé',
    !/otp|dkim|dmarc|dns|smtp|webhook|bounce|rebond|payload|api/.test(texte));
  check('aucun nom de fournisseur dans les états', !/brevo/.test(texte));
}

// ---------------------------------------------------------------------------
section('Isolation TEST / PROD');
{
  const c = cfg();
  check('mode actif sélectionné', selectActiveMode(c).sender.email === 'contact@moncommerce.fr');
  check('statut du mode actif', selectActiveMode(c).status === 'FUNCTIONAL');
  // Le cœur de l'isolation : un test réussi en TEST ne colore pas PROD.
  const enProd = cfg({ environment: 'PROD' });
  check('un test réussi en TEST ne rend PAS PROD fonctionnel',
    selectActiveMode(enProd).status === 'NOT_CONFIGURED');
  check('bascule de monde -> statut du NOUVEAU monde',
    selectActiveMode(enProd).status !== selectActiveMode(c).status);

  check('configuration absente -> aucune sélection', selectActiveMode(null) === null);
  check('monde absent -> aucune sélection', selectActiveMode(cfg({ environment: null })) === null);

  /*
   * LA RÉGRESSION ELLE-MÊME, SOUS TEST (L12.1).
   *
   * Une réponse qui porterait encore l'ancien nom ne doit PAS être acceptée en
   * silence : la sélection rend `null`, l'écran affiche son message d'échec, et
   * c'est exactement ce qui s'est produit en production pendant des semaines.
   * Ce test fige le contrat — un seul nom, pas de synonyme toléré.
   */
  const ancienContrat = { ...cfg(), environment: undefined, activeMode: 'TEST' };
  check('l’ancien nom `activeMode` n’est PAS accepté comme synonyme',
    selectActiveMode(ancienContrat) === null);
}

// ---------------------------------------------------------------------------
section('Expéditeur et envoi de test — les aides ont été RETIRÉES');
{
  /**
   * ══ TROIS SECTIONS ONT DISPARU ICI (R10.5B) ═════════════════════════════
   *
   * « Formulaire », « Payload » et « Conditions de l'envoi de test »
   * éprouvaient la validation d'un expéditeur saisi dans le Manager et le
   * contrat du corps envoyé à `PUT /email-configuration/sender`.
   *
   * Ni le formulaire ni la route n'existent : le From du parc est administré
   * dans le Panel, et l'envoi de test y vit aussi.
   *
   * Ce qui reste à garder, c'est que l'outillage ne revienne pas — un jeu
   * d'aides encore exporté est un formulaire à un import près.
   */
  const mod = await import('./emailConfiguration.ts');
  for (const parti of [
    'senderFormErrors', 'isSenderFormDirty', 'canSubmitSenderForm', 'buildSenderPayload',
    'canSendTest', 'testBlockedReason', 'defaultTestRecipient', 'isTestRecipientValid',
    'TEST_RECIPIENT_HINT', 'SENDER_NAME_MAX', 'SENDER_EMAIL_MAX',
  ]) {
    check(`NO_LOCAL_FROM — « ${parti} » n’est plus exporté`, mod[parti] === undefined);
  }
}

// ---------------------------------------------------------------------------
section("Messages d'échec — une cause et un geste");
{
  check('SENDER_REFUSED : dit d’autoriser l’adresse dans Brevo',
    testErrorMeta({ code: 'SENDER_REFUSED' }).message.includes("n'a pas encore été autorisée"));
  check('SENDER_REFUSED : donne les gestes, dans l’ordre',
    /Expéditeurs/.test(TEST_ERROR_META.SENDER_REFUSED.message)
    && /relancez un email de test/.test(TEST_ERROR_META.SENDER_REFUSED.message));
  // Les causes que le commerçant ne peut PAS corriger seul nomment qui peut agir.
  // Lui dire « la clé API est invalide » ne l'avance en rien : c'est du jargon,
  // et le geste ne lui appartient pas.
  for (const code of ['API_KEY_INVALID', 'API_KEY_MISSING']) {
    const m = testErrorMeta({ code }).message;
    check(`${code} : désigne qui peut agir`, /prestataire technique/i.test(m));
    check(`${code} : sans jargon`, !/clé api|api key|token/i.test(m));
  }
  // Les causes que l'utilisateur PEUT corriger disent le geste.
  check('RECIPIENT_INVALID : dit de vérifier l’adresse',
    /vérifiez/i.test(testErrorMeta({ code: 'RECIPIENT_INVALID' }).message));
  check('NETWORK_ERROR : invite à réessayer',
    /réessayez/i.test(testErrorMeta({ code: 'NETWORK_ERROR' }).message));
  check('SERVICE_UNAVAILABLE : invite à réessayer',
    /réessayez/i.test(testErrorMeta({ code: 'SERVICE_UNAVAILABLE' }).message));
  // Un blocage interne rassure explicitement : rien n'est perdu.
  check('BREVO_NOT_OPERATIONAL : rassure sur la perte',
    /aucun email ne sera perdu/i.test(testErrorMeta({ code: 'BREVO_NOT_OPERATIONAL' }).message));

  // Chaque message doit dire QUOI FAIRE — un constat sans geste est un cul-de-sac.
  const sansGeste = Object.entries(TEST_ERROR_META).filter(
    ([, m]) => !/vérifiez|réessayez|renseignez|contactez|connectez|essayez|relancez|reprendront/i.test(m.message)
  );
  check('chaque message porte un geste', sansGeste.length === 0);

  // Un code inconnu retombe sur une phrase neutre. Afficher le code brut serait
  // l'aveu que le produit n'a pas su traduire ce qu'il a compris.
  const inconnu = testErrorMeta({ code: 'QUELQUE_CHOSE_DE_NOUVEAU' });
  check('code inconnu -> phrase neutre', inconnu.message === "L'envoi n'a pas abouti. Réessayez dans quelques instants.");
  check('code inconnu -> le code n’est PAS affiché', !inconnu.message.includes('QUELQUE_CHOSE'));
  check('erreur absente -> phrase neutre', testErrorMeta(null).message === inconnu.message);
  check('code vide -> phrase neutre', testErrorMeta({ code: '' }).message === inconnu.message);

  // Aucun message ne doit laisser filtrer de vocabulaire technique.
  const tous = Object.values(TEST_ERROR_META).map((m) => m.message).concat(inconnu.message);
  check('aucun code métier affiché',
    !tous.some((m) => /SENDER_REFUSED|API_KEY|RECIPIENT_INVALID|NETWORK_ERROR|SERVICE_UNAVAILABLE/.test(m)));
  check('aucun code fournisseur affiché', !tous.some((m) => /invalid_parameter|unauthorized|document_not_found/i.test(m)));
  check('aucun statut HTTP affiché', !tous.some((m) => /\b(400|401|402|403|429|50\d)\b|HTTP/.test(m)));
  check('aucun jargon DKIM/DMARC/OTP', !tous.some((m) => /DKIM|DMARC|OTP|DNS/i.test(m)));
  check('chaque message est une phrase', tous.every((m) => m.length > 15 && /[.!]$/.test(m)));
}

// ---------------------------------------------------------------------------
section('Bouton « Ouvrir Brevo » — DEV et SENDER_REFUSED seulement');
{
  const refused = failedWith('SENDER_REFUSED');
  check('DEV + SENDER_REFUSED -> proposé', shouldOfferBrevoLink(refused, true) === true);
  // Un commerçant serait envoyé dans une interface qu'il ne connaît pas, sur un
  // compte qui n'est pas le sien.
  check('non-DEV + SENDER_REFUSED -> jamais proposé', shouldOfferBrevoLink(refused, false) === false);

  // Les autres échecs ne se résolvent pas dans Brevo : le lien n'aiderait pas.
  for (const code of ['API_KEY_INVALID', 'API_KEY_MISSING', 'RECIPIENT_INVALID', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE']) {
    check(`DEV + ${code} -> pas de lien`, shouldOfferBrevoLink(failedWith(code), true) === false);
  }
  // Le refus expéditeur peut aussi arriver en ASYNCHRONE (REJECTED) : même lien.
  check('DEV + REJECTED sender -> proposé',
    shouldOfferBrevoLink(modeState({ status: 'ERROR', test: testState({ status: 'REJECTED', deliveredAt: null, lastErrorSafe: { code: 'SENDER_REFUSED', message: 'x' } }) }), true) === true);
  check('test livré -> pas de lien', shouldOfferBrevoLink(modeState(), true) === false);
  check('accepté (en attente) -> pas de lien', shouldOfferBrevoLink(acceptedMode(), true) === false);
  check('jamais testé -> pas de lien',
    shouldOfferBrevoLink(modeState({ status: 'NOT_TESTED', test: testState({ status: 'NOT_TESTED' }) }), true) === false);
  check('configuration absente -> pas de lien', shouldOfferBrevoLink(null, true) === false);

  // Accueil, jamais une page profonde : les URLs internes de Brevo bougent.
  check('URL = accueil Brevo', BREVO_DASHBOARD_URL === 'https://app.brevo.com');
  check('aucune page profonde', BREVO_DASHBOARD_URL.split('/').length === 3);
}

// ---------------------------------------------------------------------------
section('Bloc « Dernier test » — ACCEPTÉ ≠ LIVRÉ');
{
  const livre = lastTestView(modeState());
  check('livré : issue succès', livre.outcome === 'success');
  check('livré : libellé', livre.label === 'Livré');
  check('livré : date de livraison', livre.at === '2026-07-18T01:30:05.000Z');
  check('livré : aucun détail d’erreur', livre.detail === null);

  // ACCEPTÉ : ni succès ni échec — en attente, et l'écran le DIT.
  const acc = lastTestView(acceptedMode());
  check('accepté : issue « pending »', acc.outcome === 'pending');
  check('accepté : libellé issu du vocabulaire', acc.label === 'En attente de confirmation');
  check('accepté : date d’acceptation', acc.at === '2026-07-18T01:30:00.000Z');
  check('accepté : détail honnête sur la non-confirmation',
    /confirmation/i.test(acc.detail) && !/brevo/i.test(acc.detail));

  const ko = lastTestView(failedWith('RECIPIENT_REJECTED'));
  check('rejeté : issue failure', ko.outcome === 'failure');
  check('rejeté : libellé issu du vocabulaire', ko.label === 'Échec de livraison');
  check('rejeté : date de rejet', ko.at === '2026-07-18T01:42:00.000Z');
  check('rejeté : message métier, pas la trace persistée',
    /n'existe pas|n'accepte plus/i.test(ko.detail) && !ko.detail.includes('trace persistée'));

  const jamais = modeState({ status: 'NOT_TESTED', test: testState({ status: 'NOT_TESTED', lastTestedAt: null }) });
  check('jamais testé -> aucun bloc', lastTestView(jamais) === null);
  check('configuration absente -> aucun bloc', lastTestView(null) === null);
}

// ---------------------------------------------------------------------------
section('Historique borné');
{
  const m = failedWith('SENDER_REFUSED');
  check('un échec efface le messageId du test précédent', m.test.providerMessageIdSafe === '<m@brevo>');
  check('trois dates d’issue distinctes', 'acceptedAt' in m.test && 'deliveredAt' in m.test && 'rejectedAt' in m.test);
  check('aucun tableau d’historique',
    !Object.values(m.test).some((v) => Array.isArray(v)));
}

// ---------------------------------------------------------------------------
section('Suivi indisponible — un seul message, pas deux');
{
  // L'avertissement « les statuts ne remonteront pas » a été SUPPRIMÉ : depuis
  // que le suivi est obligatoire, la même situation produit un blocage, déjà
  // énoncé avec sa cause et son geste. Deux messages pour un fait, dont l'un
  // disait « vous ne saurez pas » et l'autre « vous ne pouvez pas », se
  // contredisaient à l'écran.
  const m = modeState();

  const ko = blocked('WEBHOOK_UNAVAILABLE', [{ code: 'X', message: 'Cause côté serveur.' }]);
  check('l’explication rassure sur la perte', /aucun email n.est perdu/i.test(operationalView(ko).explanation));
}


// ---------------------------------------------------------------------------
section('ACCEPTED ne reste jamais bloqué — timeout du suivi');
{
  const T0 = Date.parse('2026-07-18T01:30:00.000Z');
  const accepted = (over = {}) => modeState({
    status: 'ACCEPTED',
    test: testState({ status: 'ACCEPTED', deliveredAt: null, acceptedAt: new Date(T0).toISOString(), ...over }),
  });

  // Dans les temps : pas encore d'alerte, on affiche toujours « en attente ».
  check('ACCEPTED récent -> pas encore d’alerte',
    trackingStalled(accepted(), null, T0 + 60_000) === null);

  // Passé le délai, webhook ACTIF mais rien reçu -> « le suivi ne fonctionne pas ».
  const broken = trackingStalled(accepted(), null, T0 + DELIVERY_CONFIRMATION_TIMEOUT_MS + 1);
  check('ACCEPTED périmé + webhook actif -> suivi cassé', broken && broken.trackingBroken === true);
  check('suivi cassé : titre sans nom de fournisseur',
    broken.title === 'Suivi indisponible' && !/brevo/i.test(broken.title));
  check('suivi cassé : message honnête ET actionnable',
    /confirmation/i.test(broken.message) && /diagnostic/i.test(broken.message));

  // Passé le délai, webhook absent/incomplet -> « suivi indisponible ».
  const downMode = modeState({
    status: 'ACCEPTED',
    operational: { ready: false, state: 'WEBHOOK_UNAVAILABLE', blockers: [] },
    test: testState({ status: 'ACCEPTED', deliveredAt: null, acceptedAt: new Date(T0).toISOString() }),
  });
  const down = trackingStalled(downMode, null, T0 + DELIVERY_CONFIRMATION_TIMEOUT_MS + 1);
  check('ACCEPTED périmé + suivi hors service -> pas de renvoi au diagnostic', down && down.trackingBroken === false);
  check('suivi hors service : on dit qu’il faut le rétablir', /rétabli/i.test(down.message));

  // Une fois LIVRÉ (ou en échec), plus jamais d'alerte de timeout.
  check('DELIVERED -> aucune alerte', trackingStalled(modeState(), null, T0 + 10 * 60_000) === null);
  check('jamais testé -> aucune alerte',
    trackingStalled(modeState({ status: 'NOT_TESTED', test: testState({ status: 'NOT_TESTED', acceptedAt: null }) }), null, T0 + 10 * 60_000) === null);
  check('config nulle -> aucune alerte', trackingStalled(null, null, T0) === null);
  // Le délai est de quelques minutes, pas des heures.
  check('délai raisonnable (≤ 10 min)', DELIVERY_CONFIRMATION_TIMEOUT_MS <= 10 * 60_000);
}

// ---------------------------------------------------------------------------
section('Relecture du statut : transitoire vs terminal');
{
  // ACCEPTED est le SEUL état encore susceptible de changer (webhook en vol).
  check('ACCEPTED est transitoire', isTestStatusTransitory('ACCEPTED') === true);
  for (const terminal of ['DELIVERED', 'REJECTED', 'FAILED', 'NOT_TESTED']) {
    check(`${terminal} est terminal (aucune relecture)`, isTestStatusTransitory(terminal) === false);
  }

  const accepted = modeState({ status: 'ACCEPTED', test: testState({ status: 'ACCEPTED', deliveredAt: null }) });
  check('accepté + budget restant -> on relit', shouldPollTestStatus(accepted, 10_000) === true);
  // Borne : jamais de relecture infinie si le webhook n'arrive jamais.
  check('budget épuisé -> on arrête', shouldPollTestStatus(accepted, TEST_POLL_MAX_MS) === false);
  // Statut terminal : arrêt IMMÉDIAT, même avec du budget.
  check('livré -> arrêt immédiat', shouldPollTestStatus(modeState(), 0) === false);
  check('rejeté -> arrêt immédiat',
    shouldPollTestStatus(modeState({ status: 'ERROR', test: testState({ status: 'REJECTED', deliveredAt: null }) }), 0) === false);
  check('config absente -> aucune relecture', shouldPollTestStatus(null, 0) === false);
  check('cadence et borne raisonnables',
    TEST_POLL_INTERVAL_MS >= 2_000 && TEST_POLL_INTERVAL_MS <= 5_000 && TEST_POLL_MAX_MS <= 120_000);
}

// ---------------------------------------------------------------------------
section('Échec : cause, adresse testée, geste');
{
  const refused = modeState({
    status: 'ERROR',
    sender: { email: 'luca.duhoux@lycarz.co', name: 'test' },
    test: testState({ status: 'REJECTED', deliveredAt: null, rejectedAt: '2026-07-20T01:31:00.000Z',
      lastErrorSafe: { code: 'SENDER_REFUSED', message: 'trace' } }),
  });
  const v = testFailureView(refused);
  check('échec : vue produite', Boolean(v));
  check('échec : cause métier', /n'a pas encore été autorisée/.test(v.message));
  // Sans l'adresse, l'utilisateur ne sait pas LAQUELLE Brevo a refusée.
  check('échec : adresse testée exposée', v.testedSender === 'luca.duhoux@lycarz.co');
  check('échec : geste explicite', /Corrigez l’adresse d’expéditeur/.test(v.action));
  check('échec : identifié comme problème d’expéditeur', v.senderIssue === true);

  // Un rejet destinataire n'est PAS un problème d'expéditeur.
  const bounced = modeState({ status: 'ERROR', test: testState({ status: 'REJECTED', deliveredAt: null,
    lastErrorSafe: { code: 'RECIPIENT_REJECTED', message: 'x' } }) });
  check('rebond : pas un problème d’expéditeur', testFailureView(bounced).senderIssue === false);

  // Aucun échec → aucune vue (on n'invente pas un problème).
  check('livré -> aucune vue d’échec', testFailureView(modeState()) === null);
  check('accepté -> aucune vue d’échec',
    testFailureView(modeState({ status: 'ACCEPTED', test: testState({ status: 'ACCEPTED' }) })) === null);
  check('config absente -> aucune vue d’échec', testFailureView(null) === null);
}

// ---------------------------------------------------------------------------
section('Suivi non opérationnel — les envois sont bloqués');
{
  const clean = { email: 'contact@moncommerce.fr', name: 'Mon Commerce' };


  const noWebhook = blocked('CONFIGURATION_REQUIRED', [
    { code: 'WEBHOOK_NOT_REGISTERED', message: "Le suivi de livraison n'est pas encore activé." },
  ]);
  // ⚠️ RENVERSEMENT : la raison était AUSSI répétée sous le bouton. Deux
  // messages pour un seul fait, c'est ce qui produisait des écrans qui
  // semblaient se contredire. La carte d'état, en haut, porte désormais la
  // cause et l'action ; le bouton se contente d'être désactivé.

  const view = operationalView(noWebhook);
  check('suivi absent : l’état nomme son objet', view.label === 'Suivi à configurer');
  check('suivi absent : action de configuration proposée',
    view.action === 'Configurer le suivi');
  // Les causes ne sont plus collées dans la phrase : elles sortent en LISTE,
  // parce que deux blocages produisaient un paragraphe que personne ne lisait.
  check('suivi absent : la cause backend est reprise telle quelle',
    view.causes.length === 1 && view.causes[0].includes("n'est pas encore activé"));
  check('suivi absent : le POURQUOI est expliqué',
    /impossible de savoir si un email arrive/i.test(view.explanation));

  const unreachable = blocked('WEBHOOK_UNAVAILABLE', [
    { code: 'WEBHOOK_URL_UNREACHABLE', message: "L'adresse de réception du suivi ne répond pas." },
  ]);
  const uv = operationalView(unreachable);
  check('URL injoignable : état « suivi indisponible »', uv.label === 'Suivi indisponible');
  check('URL injoignable : action de RÉPARATION', uv.action === 'Réparer le suivi');
  check('URL injoignable : ton d’avertissement (rien n’est perdu)', uv.tone === 'warn');

  const broken = blocked('REPAIR_REQUIRED', [
    { code: 'WEBHOOK_DIVERGENT', message: 'Le suivi de livraison est désynchronisé et doit être réparé.' },
  ]);
  check('désynchronisé : réparation attendue',
    operationalView(broken).action === 'Réparer le suivi');

  // Rien d'interne ne doit fuir : ni code, ni URL, ni statut HTTP.
  const dumped = JSON.stringify([view, uv, operationalView(broken)]);
  check('aucun code technique affiché', !/WEBHOOK_[A-Z_]+/.test(dumped));
  check('aucune URL affichée', !/https?:\/\//.test(dumped));

  // Cas sain : aucune vue alarmante, aucun geste réclamé.
  const ok = operationalView(modeState());
  check('suivi sain : rien à faire', ok.ready === true && ok.action === null);
  check('suivi sain : aucune explication anxiogène', ok.explanation === '');
  check('config absente : traitée comme saine (rien à affirmer)', operationalView(null).ready === true);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
