/* Tests de l'écran « Événements système » (module pur).
 * Runner autonome — Node strippe les types TS. Lancement : npm run test */
const {
  dispatchStatusMeta, DISPATCH_STATUS_META,
  executionStatusMeta, EXECUTION_STATUS_META,
  eventTypeLabel, EVENT_TYPE_LABELS, actorLabel,
  actionsSummary,
  canRetryEvent, canRetryExecution,
  nextAttemptAt, attemptsLabel,
  payloadRows,
  buildEventQuery, hasActiveFilters,
} = await import('./domainEvents.ts');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

function execution(o = {}) {
  return {
    id: 'x1', eventId: 'e1', actionId: 'a1', actionType: 'SEND_EMAIL',
    templateId: null, recipientResolver: null, recipientKey: '_single',
    status: 'PENDING', attempts: 0, maxAttempts: 4,
    availableAt: '2026-07-17T10:00:00.000Z', processedAt: null, providerMessageId: null,
    lastErrorSafe: { code: '', message: '', retryable: false },
    ...o,
  };
}
function event(o = {}) {
  return {
    eventId: 'e1', type: 'email.sender.verified', entityType: 'EmailConfiguration', entityId: 'x',
    actor: { type: 'user', id: '1', role: 'DEV' },
    payloadSafe: {}, occurredAt: '2026-07-17T10:00:00.000Z', retentionClass: 'AUDIT',
    dispatchStatus: 'DISPATCHED', dispatchAttempts: 1, lastDispatchAt: null,
    lastErrorSafe: { code: '', message: '' },
    ...o,
  };
}

// --- Statuts ----------------------------------------------------------------
section('Statuts');
{
  check('DISPATCHED -> « Traité »', dispatchStatusMeta('DISPATCHED').label === 'Traité');
  check('PARTIAL_FAILURE -> « Succès partiel »', dispatchStatusMeta('PARTIAL_FAILURE').label === 'Succès partiel');
  check('FAILED -> « Échec »', dispatchStatusMeta('FAILED').label === 'Échec');
  check('les 5 statuts de dispatch couverts', Object.keys(DISPATCH_STATUS_META).length === 5);
  check('statut inconnu -> repli neutre, jamais « Traité »',
    dispatchStatusMeta('N_IMPORTE_QUOI').label === 'En attente');
  check('chaque statut porte un libellé (jamais la couleur seule)',
    Object.values(DISPATCH_STATUS_META).every((m) => m.label.trim().length > 0));
  check('« Traité » est le seul état positif',
    Object.entries(DISPATCH_STATUS_META).filter(([, m]) => m.cls.includes('emerald')).length === 1);

  check('les 6 statuts d’exécution couverts', Object.keys(EXECUTION_STATUS_META).length === 6);
  check('SUCCEEDED -> « Réussie »', executionStatusMeta('SUCCEEDED').label === 'Réussie');
  check('DEAD_LETTER -> « Abandonnée »', executionStatusMeta('DEAD_LETTER').label === 'Abandonnée');
  // FAILED ≠ abandonné : une tentative est encore prévue, le libellé doit le dire.
  check('FAILED annonce une nouvelle tentative', /nouvelle tentative/i.test(executionStatusMeta('FAILED').label));
  check('SKIPPED -> « Ignorée » (état normal, pas une erreur)',
    executionStatusMeta('SKIPPED').label === 'Ignorée' && !EXECUTION_STATUS_META.SKIPPED.cls.includes('red'));
  check('statut d’exécution inconnu -> repli neutre',
    executionStatusMeta('ZZZ').label === 'En attente');
}

// --- Libellés ---------------------------------------------------------------
section('Libellés');
{
  check('type connu traduit', eventTypeLabel('email.sender.verified') === 'Adresse expéditrice vérifiée');
  check('résiliation traduite', eventTypeLabel('contract.cancel_requested') === 'Résiliation demandée');
  // Un type inconnu garde sa clé : « contract.foo » se cherche, « Événement » non.
  check('type inconnu -> clé technique conservée', eventTypeLabel('contract.foo') === 'contract.foo');
  check('les 11 types obligatoires ont un libellé', Object.keys(EVENT_TYPE_LABELS).length >= 11);
  check('aucun libellé vide', Object.values(EVENT_TYPE_LABELS).every((l) => l.trim().length > 0));

  check('acteur utilisateur avec rôle', actorLabel({ type: 'user', role: 'DEV' }) === 'Utilisateur (DEV)');
  check('acteur système', actorLabel({ type: 'system', role: null }) === 'Système');
  check('acteur webhook', actorLabel({ type: 'webhook', role: null }) === 'Webhook');
  check('acteur inconnu -> type brut', actorLabel({ type: 'martien', role: null }) === 'martien');
  check('acteur absent -> tiret', actorLabel(undefined) === '—');
}

// --- Résumé des actions -----------------------------------------------------
section('Résumé des actions');
{
  // « Aucune action » est NORMAL (audit) : ça doit se lire, pas alarmer.
  check('aucune action -> libellé explicite', actionsSummary({ total: 0, succeeded: 0, failed: 0, attempts: 0 }) === 'Aucune action');
  check('actions absentes -> même libellé', actionsSummary(undefined) === 'Aucune action');
  check('une action réussie', actionsSummary({ total: 1, succeeded: 1, failed: 0, attempts: 1 }) === '1 action · 1 ok');
  check('pluriel', actionsSummary({ total: 2, succeeded: 2, failed: 0, attempts: 2 }) === '2 actions · 2 ok');
  check('succès partiel lisible',
    actionsSummary({ total: 2, succeeded: 1, failed: 1, attempts: 3 }) === '2 actions · 1 ok · 1 en échec');
  check('que des échecs', actionsSummary({ total: 1, succeeded: 0, failed: 1, attempts: 4 }) === '1 action · 1 en échec');
}

// --- Retry ------------------------------------------------------------------
section('Retry');
{
  check('FAILED -> rejouable', canRetryEvent(event({ dispatchStatus: 'FAILED' })) === true);
  check('PARTIAL_FAILURE -> rejouable', canRetryEvent(event({ dispatchStatus: 'PARTIAL_FAILURE' })) === true);
  // Le point dur : ne JAMAIS proposer de rejouer un succès (double envoi).
  check('DISPATCHED -> NON rejouable', canRetryEvent(event({ dispatchStatus: 'DISPATCHED' })) === false);
  check('DISPATCHING -> non rejouable (une tentative est en cours)',
    canRetryEvent(event({ dispatchStatus: 'DISPATCHING' })) === false);
  check('PENDING -> non rejouable', canRetryEvent(event({ dispatchStatus: 'PENDING' })) === false);
  check('événement absent -> non rejouable', canRetryEvent(null) === false);

  check('exécution FAILED -> rejouable', canRetryExecution(execution({ status: 'FAILED' })) === true);
  check('exécution DEAD_LETTER -> rejouable', canRetryExecution(execution({ status: 'DEAD_LETTER' })) === true);
  check('exécution SUCCEEDED -> JAMAIS rejouable', canRetryExecution(execution({ status: 'SUCCEEDED' })) === false);
  check('exécution SKIPPED -> non rejouable', canRetryExecution(execution({ status: 'SKIPPED' })) === false);
  check('exécution PROCESSING -> non rejouable', canRetryExecution(execution({ status: 'PROCESSING' })) === false);
}

// --- Prochaine tentative ----------------------------------------------------
section('Prochaine tentative');
{
  const now = Date.parse('2026-07-17T10:00:00.000Z');
  const future = execution({ status: 'FAILED', availableAt: '2026-07-17T10:00:30.000Z' });
  check('échec avec échéance future -> date affichée', nextAttemptAt(future, now) === '2026-07-17T10:00:30.000Z');
  // Échéance passée = « au prochain passage », pas une date future trompeuse.
  check('échéance passée -> aucune date (traitée au prochain passage)',
    nextAttemptAt(execution({ status: 'FAILED', availableAt: '2026-07-17T09:00:00.000Z' }), now) === null);
  check('succès -> aucune prochaine tentative', nextAttemptAt(execution({ status: 'SUCCEEDED' }), now) === null);
  check('DEAD_LETTER -> aucune prochaine tentative (plus rien d’automatique)',
    nextAttemptAt(execution({ status: 'DEAD_LETTER', availableAt: '2026-07-17T10:00:30.000Z' }), now) === null);
  check('SKIPPED -> aucune', nextAttemptAt(execution({ status: 'SKIPPED' }), now) === null);
  check('date invalide -> aucune', nextAttemptAt(execution({ status: 'FAILED', availableAt: 'nope' }), now) === null);

  check('tentatives lisibles', attemptsLabel(execution({ attempts: 2, maxAttempts: 4 })) === '2/4');
  check('tentatives épuisées', attemptsLabel(execution({ attempts: 4, maxAttempts: 4 })) === '4/4');
}

// --- Payload ----------------------------------------------------------------
section('Payload');
{
  const rows = payloadRows({ mode: 'TEST', provider: 'BREVO', senderEmailMasked: 's***@x.fr' });
  check('aplatit les clés simples', rows.length === 3);
  check('valeurs converties en chaînes', rows.every(([, v]) => typeof v === 'string'));
  check('imbrication aplatie avec chemin',
    payloadRows({ error: { code: 'X', message: 'y' } }).some(([k]) => k === 'error.code'));
  check('tableau joint', payloadRows({ dnsRecordKeys: ['brevo_code', 'dkim_record'] })[0][1] === 'brevo_code, dkim_record');
  check('booléen affiché', payloadRows({ verified: false })[0][1] === 'false');
  check('null affiché', payloadRows({ x: null })[0][1] === 'null');
  check('payload vide -> aucune ligne', payloadRows({}).length === 0);
  check('payload absent -> aucune ligne', payloadRows(undefined).length === 0);

  // Seconde barrière : le backend refuse déjà ces clés, on ne les afficherait pas
  // pour autant si l'une passait.
  check('apiKey jamais affichée', payloadRows({ apiKey: 'xkeysib-x' }).length === 0);
  check('otp jamais affiché', payloadRows({ otp: '123456' }).length === 0);
  check('html jamais affiché', payloadRows({ html: '<b>' }).length === 0);
  check('secret jamais affiché', payloadRows({ webhookSecret: 'x' }).length === 0);
  check('token jamais affiché', payloadRows({ accessToken: 'x' }).length === 0);
  check('clé sensible imbriquée jamais affichée', payloadRows({ a: { apiKey: 'x' } }).length === 0);
  check('clés normales conservées à côté d’une clé filtrée',
    payloadRows({ apiKey: 'x', domain: 'x.fr' }).length === 1);
}

// --- Filtres ----------------------------------------------------------------
section('Filtres');
{
  check('aucun filtre -> query vide', buildEventQuery({}) === '');
  check('un filtre', buildEventQuery({ type: 'contact.submitted' }) === '?type=contact.submitted');
  check('deux filtres',
    buildEventQuery({ type: 'contact.submitted', dispatchStatus: 'FAILED' }).includes('dispatchStatus=FAILED'));
  // Les valeurs vides doivent être OMISES : `type=` ferait échouer la validation
  // stricte du backend.
  check('valeur vide omise', buildEventQuery({ type: '' }) === '');
  check('valeur undefined omise', buildEventQuery({ type: undefined }) === '');
  check('curseur ajouté', buildEventQuery({}, '2026-07-17T10:00:00.000Z').includes('cursor='));
  check('curseur null omis', buildEventQuery({}, null) === '');
  check('limite ajoutée', buildEventQuery({}, null, 25) === '?limit=25');
  check('valeurs encodées', buildEventQuery({ entityId: 'a b' }).includes('a+b'));

  check('filtres actifs détectés', hasActiveFilters({ type: 'x' }) === true);
  check('aucun filtre actif', hasActiveFilters({}) === false);
  check('filtre vide -> non actif', hasActiveFilters({ type: '' }) === false);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
if (fail > 0) process.exit(1);
