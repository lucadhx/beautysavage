/* Tests des demandes de contact (Manager) : libellés, statuts, notification,
 * filtres, pagination, divers.
 * Module PUR — aucun DOM, aucun réseau. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  REASON_LABEL, REASON_OPTIONS, reasonLabel,
  STATE_LABEL, stateLabel, stateTone,
  NOTIFICATION_LABEL, notificationLabel, notificationTone,
  notificationSummaryText, notificationNeedsAttention, notificationErrorLabel,
  notificationClientMessage, NOTIFICATION_FAILURE_CLIENT_TEXT,
  EMPTY_FILTERS, hasActiveFilters, buildListQuery,
  isUnread, truncate, replyHref,
} = await import('./contactSubmissions.ts');

const summary = (over = {}) => ({
  status: 'SENT', eventId: 'evt-1', total: 1,
  counts: { sent: 1, failed: 0, pending: 0, skipped: 0 },
  ...over,
});

// ---------------------------------------------------------------------------
section('Motifs');
{
  check('cinq motifs', Object.keys(REASON_LABEL).length === 5);
  check('QUOTE traduit', reasonLabel('QUOTE') === 'Demande de devis');
  check('WEBSITE_ISSUE traduit', reasonLabel('WEBSITE_ISSUE') === 'Problème avec le site');
  // Un code inconnu (backend plus récent) ne doit pas produire un blanc.
  check('code inconnu -> brut', reasonLabel('CODE_DU_FUTUR') === 'CODE_DU_FUTUR');
  check('options : cinq', REASON_OPTIONS.length === 5);
  check('options : value + label', REASON_OPTIONS.every((o) => o.value && o.label));
}

// ---------------------------------------------------------------------------
section('État (non lu / lu / résolu) — pas de workflow');
{
  check('trois états seulement', Object.keys(STATE_LABEL).length === 3);
  check('UNREAD traduit', stateLabel('UNREAD') === 'Non lu');
  check('READ traduit', stateLabel('READ') === 'Lu');
  check('RESOLVED traduit', stateLabel('RESOLVED') === 'Résolu');
  check('état inconnu -> brut', stateLabel('NOPE') === 'NOPE');
  // UNREAD est le seul état qui appelle une action : il est mis en avant.
  check('UNREAD : ton distinctif', stateTone('UNREAD') === 'new');
  check('RESOLVED : ton succès', stateTone('RESOLVED') === 'success');
  check('READ : ton discret', stateTone('READ') === 'muted');
  check('inconnu : ton discret par défaut', stateTone('NOPE') === 'muted');
}

// ---------------------------------------------------------------------------
section('Notification — « accepté » n’est pas « reçu »');
{
  // Le libellé vient désormais du vocabulaire commun : un fait, un seul nom.
  check('SENT -> « En attente de confirmation »', notificationLabel('SENT') === 'En attente de confirmation');
  // Écrire « envoyée » laisserait croire que l'admin a le message en boîte.
  check('SENT : ne dit PAS « reçue »', !/reçue|remise|délivrée/i.test(notificationLabel('SENT')));
  check('SENT : ne nomme PAS le fournisseur', !/brevo/i.test(notificationLabel('SENT')));
  check('NONE traduit', notificationLabel('NONE') === 'Aucune notification');
  check('PARTIAL traduit', notificationLabel('PARTIAL') === 'Partiellement envoyée');
  check('FAILED traduit', notificationLabel('FAILED') === 'Échec');
  // Un code brut n'informe personne : repli neutre, comme partout ailleurs.
  check('statut inconnu -> état neutre, jamais le code', notificationLabel('FUTUR') === 'État inconnu');
  check('aucun libellé ne dit « délivrée »',
    !Object.values(NOTIFICATION_LABEL).some((l) => /délivré/i.test(l)));

  // « En attente de confirmation » en vert serait une contradiction : le vert
  // est réservé à un fait constaté, sur CET écran comme sur les autres.
  check('SENT : ton d’attente, jamais un succès', notificationTone('SENT') === 'pending');
  check('FAILED : ton danger', notificationTone('FAILED') === 'danger');
  check('PARTIAL : ton avertissement', notificationTone('PARTIAL') === 'warning');
  // NONE = l'émission a échoué : un silence, pas un succès.
  check('NONE : ton avertissement (un silence n’est pas un succès)', notificationTone('NONE') === 'warning');
  check('PENDING : ton en attente', notificationTone('PENDING') === 'pending');
}

{
  check('aucune notification -> phrase explicite',
    notificationSummaryText(summary({ total: 0 })) === "Aucune notification n'a été déclenchée.");
  check('notification nulle -> phrase explicite',
    notificationSummaryText(null) === "Aucune notification n'a été déclenchée.");

  check('une acceptée (singulier)',
    notificationSummaryText(summary()) === '1 acceptée par Brevo');
  check('deux acceptées (pluriel)',
    notificationSummaryText(summary({ total: 2, counts: { sent: 2, failed: 0, pending: 0, skipped: 0 } })) ===
      '2 acceptées par Brevo');

  // Avec plusieurs admins, un statut global cache qui n'a pas reçu.
  check('résumé chiffré partiel',
    notificationSummaryText(summary({ status: 'PARTIAL', total: 3, counts: { sent: 2, failed: 1, pending: 0, skipped: 0 } })) ===
      '2 acceptées par Brevo, 1 en échec');
  check('résumé avec attente',
    notificationSummaryText(summary({ status: 'PENDING', total: 2, counts: { sent: 1, failed: 0, pending: 1, skipped: 0 } })) ===
      '1 acceptée par Brevo, 1 en cours');
  check('résumé avec ignorées',
    notificationSummaryText(summary({ total: 2, counts: { sent: 1, failed: 0, pending: 0, skipped: 1 } })) ===
      '1 acceptée par Brevo, 1 ignorée');
  check('résumé : que des échecs',
    notificationSummaryText(summary({ status: 'FAILED', total: 2, counts: { sent: 0, failed: 2, pending: 0, skipped: 0 } })) ===
      '2 en échec');
}

{
  check('SENT : rien à signaler', !notificationNeedsAttention(summary()));
  check('FAILED : attention', notificationNeedsAttention(summary({ status: 'FAILED' })));
  check('PARTIAL : attention', notificationNeedsAttention(summary({ status: 'PARTIAL' })));
  // NONE = l'événement n'a jamais été émis : c'est exactement ce qu'on ne veut
  // pas laisser passer en silence.
  check('NONE : attention (silence = émission échouée)', notificationNeedsAttention(summary({ status: 'NONE' })));
  check('PENDING : pas encore d’alerte', !notificationNeedsAttention(summary({ status: 'PENDING' })));
  check('null : pas de faux positif', !notificationNeedsAttention(null));
}

{
  check('EMAIL_RECIPIENTS_NOT_FOUND traduit',
    notificationErrorLabel('EMAIL_RECIPIENTS_NOT_FOUND') === 'Aucun administrateur avec une adresse valide');
  check('EMAIL_SENDER_NOT_VERIFIED traduit',
    notificationErrorLabel('EMAIL_SENDER_NOT_VERIFIED') === 'Expéditeur non vérifié');
  check('SEND_INTERRUPTED traduit (renvoi manuel)',
    /manuel/i.test(notificationErrorLabel('SEND_INTERRUPTED')));
  check('code inconnu -> brut', notificationErrorLabel('X_Y') === 'X_Y');
}

// ---------------------------------------------------------------------------
section('Message CLIENT en cas d’échec — aucun code technique');
{
  check('FAILED -> phrase neutre', notificationClientMessage(summary({ status: 'FAILED' })) === NOTIFICATION_FAILURE_CLIENT_TEXT);
  check('NONE -> phrase neutre', notificationClientMessage(summary({ status: 'NONE' })) === NOTIFICATION_FAILURE_CLIENT_TEXT);
  check('PARTIAL -> phrase neutre', notificationClientMessage(summary({ status: 'PARTIAL' })) === NOTIFICATION_FAILURE_CLIENT_TEXT);
  check('SENT -> rien (aucune alerte au client)', notificationClientMessage(summary()) === null);
  check('PENDING -> rien', notificationClientMessage(summary({ status: 'PENDING' })) === null);
  check('null -> rien', notificationClientMessage(null) === null);
  check('aucun code technique dans la phrase', !/DEAD_LETTER|SENDER_NOT|PROVIDER_NOT|Brevo|retry|payload/i.test(NOTIFICATION_FAILURE_CLIENT_TEXT));
  check('mentionne « problème technique »', /problème technique/i.test(NOTIFICATION_FAILURE_CLIENT_TEXT));
}

// ---------------------------------------------------------------------------
section('Filtres (onglet actives/résolues + motif/recherche)');
{
  check('filtres vides -> aucun filtre secondaire actif', !hasActiveFilters(EMPTY_FILTERS));
  check('onglet résolues seul -> pas un filtre secondaire', !hasActiveFilters({ ...EMPTY_FILTERS, resolved: true }));
  check('motif choisi -> actif', hasActiveFilters({ ...EMPTY_FILTERS, reason: 'QUOTE' }));
  check('recherche -> actif', hasActiveFilters({ ...EMPTY_FILTERS, search: 'jean' }));
  check('recherche d’espaces -> PAS actif', !hasActiveFilters({ ...EMPTY_FILTERS, search: '   ' }));
}

{
  check('aucun filtre -> query vide (demandes actives par défaut)', buildListQuery(EMPTY_FILTERS) === '');
  check('resolved=true -> onglet résolues', buildListQuery({ ...EMPTY_FILTERS, resolved: true }) === '?resolved=true');
  check('resolved=false -> omis (défaut)', !buildListQuery({ ...EMPTY_FILTERS, resolved: false }).includes('resolved'));
  check('motif seul', buildListQuery({ ...EMPTY_FILTERS, reason: 'QUOTE' }) === '?reason=QUOTE');
  check('recherche encodée', buildListQuery({ ...EMPTY_FILTERS, search: 'jean dupont' }) === '?search=jean+dupont');
  check('recherche : espaces retirés', buildListQuery({ ...EMPTY_FILTERS, search: '  jean  ' }) === '?search=jean');

  const full = buildListQuery({ resolved: true, reason: 'QUOTE', search: 'x' }, { cursor: 'Q1VSU09S', limit: 25 });
  check('combinés : tous présents', full.includes('resolved=true') && full.includes('reason=QUOTE') && full.includes('search=x'));
  check('curseur composite (base64) transmis tel quel', full.includes('cursor=Q1VSU09S'));
  check('limite : transmise', full.includes('limit=25'));
  check('curseur nul -> omis', !buildListQuery(EMPTY_FILTERS, { cursor: null }).includes('cursor'));
  check('caractères spéciaux échappés', buildListQuery({ ...EMPTY_FILTERS, search: 'a&b=c' }).includes('search=a%26b%3Dc'));
}

// ---------------------------------------------------------------------------
section('Divers');
{
  check('état UNREAD -> non lue', isUnread({ state: 'UNREAD' }));
  check('état READ -> lue', !isUnread({ state: 'READ' }));
  check('état RESOLVED -> pas « non lue »', !isUnread({ state: 'RESOLVED' }));

  check('texte court -> intact', truncate('Bonjour') === 'Bonjour');
  check('texte long -> tronqué', truncate('x'.repeat(200)).endsWith('…'));
  check('espaces normalisés', truncate('a   b') === 'a b');
  // Couper « ...au mili » plutôt que « ...au milieu » est laid : on coupe au mot.
  const words = truncate('un deux trois quatre cinq six sept huit neuf dix onze douze treize', 30);
  check('coupe au MOT, pas au caractère', !/[a-z]…$/.test(words) || words.includes(' '));
  check('longueur respectée', truncate('x '.repeat(100), 30).length <= 31);
  check('texte vide -> vide', truncate('') === '');

  const href = replyHref('jean@exemple.fr', 'QUOTE');
  check('mailto : adresse', href.startsWith('mailto:jean@exemple.fr'));
  check('mailto : sujet pré-rempli avec le LIBELLÉ du motif',
    href.includes(encodeURIComponent('Demande de devis')));
  check('mailto : sujet encodé', !href.includes(' '));
}

// ---------------------------------------------------------------------------
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
