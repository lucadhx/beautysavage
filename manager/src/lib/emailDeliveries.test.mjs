/* Tests du suivi des livraisons e-mail (Manager) : libellés, tons, engagement
 * (formulations neutres), filtres/requête, timeline, abrégé messageId.
 * Module PUR — aucun DOM, aucun réseau. Runner autonome. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const {
  DELIVERY_STATUS_META, deliveryStatusMeta, isDelivered,
  PROCESSING_STATUS_META, processingStatusMeta,
  EVENT_TYPE_LABEL, eventTypeLabel,
  engagementSummary, ENGAGEMENT_DISCLAIMER,
  EMPTY_DELIVERY_FILTERS, hasActiveDeliveryFilters, buildDeliveryQuery,
  orderTimeline, isEngagementEventType, shortMessageId, modeLabel,
} = await import('./emailDeliveries.ts');

const ALL_STATUSES = [
  'PENDING', 'SENDING', 'SENT', 'FAILED', 'BLOCKED', 'DELIVERED', 'BOUNCED',
  'DEFERRED', 'SOFT_BOUNCED', 'HARD_BOUNCED', 'INVALID', 'SPAM', 'ERROR', 'UNSUBSCRIBED',
];
const ALL_EVENTS = [
  'ACCEPTED', 'SENT', 'DELIVERED', 'DEFERRED', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'BLOCKED',
  'SPAM', 'INVALID', 'ERROR', 'UNSUBSCRIBED', 'OPENED', 'UNIQUE_OPENED', 'PROXY_OPEN',
  'UNIQUE_PROXY_OPEN', 'CLICKED',
];

section('1. Statuts de livraison — libellés exhaustifs');
check('tous les statuts ont un libellé + classe', ALL_STATUSES.every((s) => DELIVERY_STATUS_META[s]?.label && DELIVERY_STATUS_META[s]?.cls));
// L'intention d'origine — « accepté ≠ reçu » — tient toujours ; seul le mot a
// changé : il vient désormais du vocabulaire commun (`emailStates`).
check('SENT = « En attente de confirmation » (jamais « livré »)', DELIVERY_STATUS_META.SENT.label === 'En attente de confirmation');
check('SENT n\'est pas vert (neutre)', !DELIVERY_STATUS_META.SENT.cls.includes('emerald'));
check('DELIVERED = « Livré » + vert', DELIVERY_STATUS_META.DELIVERED.label === 'Livré' && DELIVERY_STATUS_META.DELIVERED.cls.includes('emerald'));
check('HARD_BOUNCED en rouge', DELIVERY_STATUS_META.HARD_BOUNCED.cls.includes('red'));
check('DEFERRED en ambre (ni succès ni échec)', DELIVERY_STATUS_META.DEFERRED.cls.includes('amber'));
// Un statut inconnu ne doit JAMAIS ressortir sous sa forme technique.
check('deliveryStatusMeta inconnu → libellé neutre, pas le code', (() => { const m = deliveryStatusMeta('WAT'); return m.label === 'État inconnu' && !m.label.includes('WAT'); })());
check('aucun libellé de statut ne nomme le fournisseur ni le jargon', ALL_STATUSES.every((s) => !/brevo|rebond|bounce|webhook|relais|proxy/i.test(DELIVERY_STATUS_META[s].label)));
// Le filtre DEV doit rester utilisable : huit statuts partagent « Échec de
// livraison », leurs entrées de menu doivent malgré tout se distinguer.
check('les libellés de filtre sont tous distincts', (() => { const l = ALL_STATUSES.map((s) => DELIVERY_STATUS_META[s].filterLabel); return new Set(l).size === l.length; })());
check('isDelivered seulement DELIVERED', isDelivered('DELIVERED') && !isDelivered('SENT') && !isDelivered('SPAM'));

section('2. Statuts de traitement webhook');
check('tous ont label+cls', ['RECEIVED', 'PROCESSED', 'UNMATCHED', 'IGNORED', 'FAILED'].every((s) => PROCESSING_STATUS_META[s]?.label));
check('UNMATCHED = « Aucune livraison correspondante »', processingStatusMeta('UNMATCHED').label === 'Aucune livraison correspondante');
check('processingStatusMeta inconnu → libellé neutre', processingStatusMeta('WAT').label === 'État inconnu');

section('3. Types d\'événement — formulations neutres');
check('tous les événements ont un libellé', ALL_EVENTS.every((e) => EVENT_TYPE_LABEL[e]));
check('OPENED = « Ouverture détectée »', eventTypeLabel('OPENED') === 'Ouverture détectée');
check('CLICKED = « Clic détecté »', eventTypeLabel('CLICKED') === 'Clic détecté');
check('aucun libellé ne prétend « lu » / « volontaire »', ALL_EVENTS.every((e) => !/\bl[uû]\b|volontaire/i.test(EVENT_TYPE_LABEL[e])));
check('aucun libellé n\'emprunte le jargon fournisseur', ALL_EVENTS.every((e) => !/brevo|rebond|bounce|webhook|relais|proxy|spam/i.test(EVENT_TYPE_LABEL[e])));
check('eventTypeLabel(null) → tiret', eventTypeLabel(null) === '—');
check('eventTypeLabel inconnu → libellé neutre, pas le code', eventTypeLabel('WAT') === 'Événement non reconnu');

section('4. Engagement — comptage + langage prudent');
check('0/0 → aucun texte', (() => { const r = engagementSummary({ openCount: 0, clickCount: 0 }); return r.opens === null && r.clicks === null && r.hasAny === false; })());
check('1 ouverture (singulier)', engagementSummary({ openCount: 1, clickCount: 0 }).opens === '1 ouverture détectée');
check('2 ouvertures (pluriel)', engagementSummary({ openCount: 2, clickCount: 0 }).opens === '2 ouvertures détectées');
check('1 clic (singulier)', engagementSummary({ openCount: 0, clickCount: 1 }).clicks === '1 clic détecté');
check('3 clics (pluriel)', engagementSummary({ openCount: 0, clickCount: 3 }).clicks === '3 clics détectés');
check('hasAny vrai si engagement', engagementSummary({ openCount: 1, clickCount: 0 }).hasAny === true);
check('disclaimer mentionne la fiabilité limitée', /pas une preuve de lecture/i.test(ENGAGEMENT_DISCLAIMER));
check('engagementSummary(undefined) sûr', engagementSummary(undefined).hasAny === false);

section('5. Filtres & requête');
check('EMPTY_DELIVERY_FILTERS vide', Object.keys(EMPTY_DELIVERY_FILTERS).length === 0);
check('hasActiveDeliveryFilters : vide → false', hasActiveDeliveryFilters({}) === false);
check('hasActiveDeliveryFilters : status → true', hasActiveDeliveryFilters({ status: 'DELIVERED' }) === true);
check('hasActiveDeliveryFilters : recherche vide ignorée', hasActiveDeliveryFilters({ search: '   ' }) === false);
check('buildDeliveryQuery omet le vide, garde limit', buildDeliveryQuery({}, null, 25) === '?limit=25');
check('buildDeliveryQuery inclut providerMode+status', (() => { const q = buildDeliveryQuery({ providerMode: 'PROD', status: 'DELIVERED' }, null, 25); return q.includes('providerMode=PROD') && q.includes('status=DELIVERED'); })());
check('buildDeliveryQuery inclut le curseur', buildDeliveryQuery({}, '2024-01-01T00:00:00Z', 25).includes('cursor='));
check('buildDeliveryQuery trim la recherche', buildDeliveryQuery({ search: '  abc  ' }, null, 25).includes('search=abc'));

section('6. Timeline & divers');
const evs = [
  { webhookEventId: 'c', type: 'OPENED', occurredAt: '2024-01-03T00:00:00Z', receivedAt: null },
  { webhookEventId: 'a', type: 'DELIVERED', occurredAt: '2024-01-01T00:00:00Z', receivedAt: null },
  { webhookEventId: 'b', type: 'CLICKED', occurredAt: null, receivedAt: '2024-01-02T00:00:00Z' },
];
const ordered = orderTimeline(evs);
check('orderTimeline : ancien → récent', ordered.map((e) => e.webhookEventId).join('') === 'abc');
check('orderTimeline ne mute pas l\'entrée', evs[0].webhookEventId === 'c');
check('isEngagementEventType : OPENED/CLICKED', isEngagementEventType('OPENED') && isEngagementEventType('CLICKED'));
check('isEngagementEventType : DELIVERED non', isEngagementEventType('DELIVERED') === false);
check('shortMessageId retire les chevrons + abrège', shortMessageId('<0123456789abcdef0123456789@smtp-relay.mailin.fr>').includes('…'));
check('shortMessageId(null) → tiret', shortMessageId(null) === '—');
check('modeLabel se lit en clair', modeLabel('PROD') === 'Production' && modeLabel('TEST') === 'Test');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
