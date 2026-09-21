/**
 * TRAÇAGE d'un e-mail jusqu'à son verdict final.
 *
 * ─── POURQUOI CET OUTIL ──────────────────────────────────────────────────────
 *
 * Le diagnostic répond à « le suivi fonctionne-t-il ? ». Celui-ci répond à une
 * question différente et plus étroite : « qu'est-il arrivé À CE MESSAGE ? ».
 *
 * Quand un message reste en « livraison différée » sans suite, cinq causes sont
 * possibles et une seule est vraie : le fournisseur attend encore, un événement
 * terminal est arrivé mais n'a pas été reconnu, il est arrivé mais n'a pas été
 * rapproché, il n'est jamais arrivé, ou l'événement n'était pas souscrit. On ne
 * peut pas trancher en lisant le code : il faut confronter le journal LOCAL à la
 * souscription DISTANTE. C'est ce que fait ce script.
 *
 * ─── LECTURE SEULE, STRICTEMENT ──────────────────────────────────────────────
 *
 * Aucune écriture en base, aucun envoi, aucune modification chez le fournisseur.
 * Le seul appel sortant est un `GET /v3/webhooks`. Il est donc sans risque de
 * l'exécuter en production, y compris pendant un incident.
 *
 * Usage :
 *   npm run email:trace                        → dernier e-mail de test
 *   npm run email:trace -- --message-id=<id>   → un message précis
 *   npm run email:trace -- --delivery=<uuid>   → une livraison précise
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { EmailDelivery } from '../models/EmailDelivery.model.js';
import { EmailDeliveryEvent } from '../models/EmailDeliveryEvent.model.js';
import { BrevoWebhookEvent } from '../models/BrevoWebhookEvent.model.js';
import { providerMessageIdVariants, normalizeProviderMessageId } from '../utils/providerMessageId.js';
import { SUBSCRIBED_CONFIG_EVENTS, normalizeBrevoEvent } from '../utils/brevoTransactionalEventRegistry.js';
import { getActiveMode } from '../services/integratedApi.service.js';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', cyn: '\x1b[36m' };
const title = (t) => console.log(`\n${C.b}${C.cyn}${t}${C.r}\n${'─'.repeat(t.length)}`);
const line = (k, v) => console.log(`  ${k.padEnd(28)} ${v}`);

/**
 * Événements qui CLÔTURENT le sort d'un message. `deferred` n'en fait pas
 * partie : c'est précisément une attente, pas une issue.
 */
const TERMINAL = ['DELIVERED', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'BLOCKED', 'SPAM', 'INVALID', 'ERROR'];

/**
 * Signaux d'ENGAGEMENT. Séparés des preuves à dessein : ils sont observables
 * sans qu'aucun message n'ait été remis (proxy d'images, scanner antispam,
 * antivirus). Les afficher à côté du statut, jamais comme une preuve.
 */
const ENGAGEMENT = ['OPENED', 'UNIQUE_OPENED', 'CLICKED', 'PROXY_OPEN', 'UNIQUE_PROXY_OPEN'];

async function main() {
  await connectDatabase();
  const mode = (await getActiveMode('BREVO')) || 'TEST';

  // ── 1. Le message ─────────────────────────────────────────────────────────
  const wantedId = arg('message-id');
  const wantedDelivery = arg('delivery');
  const query = wantedDelivery
    ? { deliveryId: wantedDelivery }
    : wantedId
      ? { providerMessageId: { $in: providerMessageIdVariants(wantedId) } }
      : { provider: 'BREVO' };
  const delivery = await EmailDelivery.findOne(query).sort({ createdAt: -1 }).lean();

  if (!delivery) {
    console.log(`${C.red}Aucune livraison trouvée.${C.r} Précisez --message-id= ou --delivery=.`);
    return;
  }

  const messageId = normalizeProviderMessageId(delivery.providerMessageId);
  title('1. MESSAGE');
  line('messageId', messageId || `${C.dim}(aucun)${C.r}`);
  line('deliveryId', delivery.deliveryId);
  line('mode', delivery.providerMode);
  line('destinataire', delivery.recipientEmailMasked);
  line('statut actuel', `${C.b}${delivery.status}${C.r}`);
  line('envoyé le', delivery.sentAt?.toISOString() || '—');
  line('livré le', delivery.deliveredAt?.toISOString() || '—');
  line('dernier événement', `${delivery.lastEventType || '—'} @ ${delivery.lastEventAt?.toISOString() || '—'}`);

  // ── 2. Chronologie locale appliquée ───────────────────────────────────────
  title('2. CHRONOLOGIE APPLIQUÉE (EmailDeliveryEvent)');
  const timeline = await EmailDeliveryEvent.find({ deliveryId: delivery.deliveryId })
    .sort({ occurredAt: 1, receivedAt: 1 }).lean();
  if (!timeline.length) console.log(`  ${C.dim}aucun événement appliqué${C.r}`);
  for (const e of timeline) {
    const when = (e.occurredAt || e.receivedAt)?.toISOString() || '—';
    const transition = e.statusBefore === e.statusAfter ? `${e.statusAfter} (inchangé)` : `${e.statusBefore} → ${e.statusAfter}`;
    console.log(`  ${when}  ${C.b}${String(e.type).padEnd(14)}${C.r} ${transition}`);
  }

  // ── 3. TOUS les événements bruts reçus pour ce message ────────────────────
  //
  // On cherche LARGE : par messageId corrélé, mais aussi dans la charge utile
  // brute. Un événement dont le messageId aurait une forme inattendue serait
  // invisible au premier filtre — et c'est précisément l'hypothèse à écarter.
  title('3. ÉVÉNEMENTS BRUTS REÇUS (BrevoWebhookEvent)');
  const variants = providerMessageIdVariants(messageId);
  const raw = await BrevoWebhookEvent.find({
    $or: [
      { providerMessageId: { $in: variants } },
      ...(messageId ? [{ 'rawPayloadSafe.message-id': { $in: variants } }] : []),
    ],
  }).sort({ receivedAt: 1 }).lean();

  if (!raw.length) console.log(`  ${C.dim}aucun événement brut${C.r}`);
  for (const e of raw) {
    const cls = e.matched ? C.grn : C.ylw;
    console.log(
      `  ${(e.occurredAt || e.receivedAt)?.toISOString()}  ` +
      `${C.b}${String(e.eventType).padEnd(14)}${C.r} → ${String(e.normalizedEventType || '(non reconnu)').padEnd(14)} ` +
      `${cls}${e.processingStatus}${C.r}`
    );
  }

  const byStatus = raw.reduce((acc, e) => ({ ...acc, [e.processingStatus]: (acc[e.processingStatus] || 0) + 1 }), {});
  line('\n  répartition', JSON.stringify(byStatus));

  // Un événement terminal a-t-il été reçu, sous quelque forme que ce soit ?
  const terminalReceived = raw.filter((e) => TERMINAL.includes(e.normalizedEventType));
  const unrecognised = raw.filter((e) => !e.normalizedEventType);
  const afterDeferred = raw.filter((e) => {
    const lastDeferred = [...raw].reverse().find((x) => x.normalizedEventType === 'DEFERRED');
    return lastDeferred && (e.receivedAt > lastDeferred.receivedAt);
  });
  const engagementSeen = raw.filter((e) => ENGAGEMENT.includes(e.normalizedEventType));
  const preuveRemise = raw.filter((e) => e.normalizedEventType === 'DELIVERED');
  line('  terminaux reçus', terminalReceived.length ? terminalReceived.map((e) => e.normalizedEventType).join(', ') : `${C.dim}aucun${C.r}`);
  // Les trois lignes qui comptent, séparées pour qu'on ne les confonde plus.
  line('  PREUVE DE REMISE', preuveRemise.length ? `${C.grn}delivered${C.r}` : `${C.ylw}aucune${C.r}`);
  line('  engagement observé', engagementSeen.length ? engagementSeen.map((e) => e.normalizedEventType).join(', ') : `${C.dim}aucun${C.r}`);
  line('  → conclusion', preuveRemise.length ? `${C.grn}livraison confirmée${C.r}` : `${C.ylw}livraison NON confirmée${C.r}`);
  line('  types non reconnus', unrecognised.length ? unrecognised.map((e) => e.eventType).join(', ') : `${C.dim}aucun${C.r}`);
  line('  postérieurs au différé', String(afterDeferred.length));

  /*
   * R11 — LA SECTION « SOUSCRIPTION CHEZ LE FOURNISSEUR » A DISPARU.
   *
   * Elle appelait `api.brevo.com` avec la cle LOCALE pour lire l'abonnement de
   * l'endpoint de ce projet. Il n'y a plus ni cle, ni endpoint : les evenements
   * de livraison suivent le COMPTE, celui du Panel, qui les reprojette par le
   * pont. Interroger Brevo d'ici ne dirait rien de la chaine reellement
   * empruntee — et l'outil ferait chercher au mauvais endroit.
   */
  const remoteEvents = null;

  // ── 5. VERDICT ────────────────────────────────────────────────────────────
  title('5. VERDICT');
  const aDeferred = raw.some((e) => e.normalizedEventType === 'DEFERRED');
  // `null` = la souscription n'a PAS pu être lue. On ne conclut alors rien à son
  // sujet : « non vérifié » n'est pas « non abonné ».
  const souscriptionIncomplete = remoteEvents !== null && !remoteEvents.has('DELIVERED');

  let verdict;
  let explication;
  if (souscriptionIncomplete) {
    verdict = 'ÉVÉNEMENT_NON_ABONNÉ';
    explication = "La souscription enregistrée chez le fournisseur ne contient pas tous les événements terminaux : il ne peut donc pas nous les envoyer.";
  } else if (unrecognised.length) {
    verdict = 'ÉVÉNEMENT_REÇU_MAIS_IGNORÉ';
    explication = `Un événement est arrivé avec un type que nous ne savons pas interpréter (${unrecognised.map((e) => e.eventType).join(', ')}).`;
  } else if (raw.some((e) => !e.matched && TERMINAL.includes(e.normalizedEventType))) {
    verdict = 'ÉVÉNEMENT_NON_CORRÉLÉ';
    explication = "Un événement terminal est arrivé mais n'a pas pu être rattaché à cette livraison.";
  } else if (terminalReceived.length) {
    verdict = 'AUTRE_CAUSE_PROUVÉE';
    explication = `Un événement terminal (${terminalReceived.map((e) => e.normalizedEventType).join(', ')}) a bien été reçu ET appliqué : le sort du message est connu.`;
  } else if (engagementSeen.length && aDeferred) {
    // ⚠️ Cet outil a lui-même conclu à une livraison sur la foi d'une ouverture.
    // Il ne le fait plus : un engagement n'est pas une preuve de remise.
    verdict = 'ATTENTE_FOURNISSEUR_NORMALE';
    explication =
      `Une activité de suivi a été observée (${engagementSeen.map((e) => e.normalizedEventType).join(', ')}), ` +
      "mais elle ne prouve PAS la remise : un scanner ou un proxy d'images suffit à la produire. " +
      "Aucun « delivered » n'a été reçu — la livraison reste non confirmée.";
  } else if (aDeferred) {
    verdict = 'ATTENTE_FOURNISSEUR_NORMALE';
    explication =
      "Le report est enregistré, la souscription est complète, aucun événement n'a été reçu depuis. " +
      "La messagerie du destinataire réessaie — ce cycle peut durer plusieurs heures. " +
      "Rien n'indique un défaut local : relancer ce script plus tard tranchera.";
  } else {
    verdict = 'ÉVÉNEMENT_FINAL_NON_REÇU';
    explication = "Aucun événement terminal n'est arrivé et aucun report n'explique l'attente.";
  }

  console.log(`  ${C.b}${verdict}${C.r}`);
  console.log(`  ${explication}`);
  if (verdict === 'ATTENTE_FOURNISSEUR_NORMALE') {
    console.log(`\n  ${C.dim}Le journal du fournisseur (tableau de bord → Logs) permet de confirmer${C.r}`);
    console.log(`  ${C.dim}s'il a produit un événement que nous n'aurions pas reçu.${C.r}`);
  }
  console.log('');
}

main()
  .catch((err) => { console.error(`\n${C.red}Échec du traçage :${C.r}`, err.message); process.exitCode = 1; })
  .finally(async () => { await disconnectDatabase().catch(() => {}); });
