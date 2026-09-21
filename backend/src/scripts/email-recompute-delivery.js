/**
 * RECALCUL du statut canonique d'une livraison depuis son journal d'événements.
 *
 * ─── POURQUOI CET OUTIL ──────────────────────────────────────────────────────
 *
 * Une règle fautive a fait passer des livraisons à « Livré » sur la foi d'une
 * simple ouverture — un signal qu'un scanner antispam suffit à produire. La
 * règle est corrigée, mais les statuts déjà écrits, eux, restent faux.
 *
 * Plutôt que de deviner lesquels, on REJOUE le journal des événements à travers
 * la machine d'état corrigée. Le résultat est le statut que ces livraisons
 * auraient eu si la règle avait toujours été juste.
 *
 * ─── DÉTECTION FIABLE ────────────────────────────────────────────────────────
 *
 * ⚠️ Ne PAS chercher la promotion dans la chronologie : elle n'y a laissé aucune
 * trace (`statusBefore`/`statusAfter` restaient nuls pour un engagement). Le
 * signal qui ne ment pas est plus simple : une livraison marquée LIVRÉ dont le
 * journal ne contient AUCUN événement `delivered` n'a pas pu l'être légitimement.
 *
 * ─── SÛRETÉ ──────────────────────────────────────────────────────────────────
 *
 * Dry-run par DÉFAUT : rien n'est écrit sans `--apply`. Idempotent : rejouer le
 * même journal donne le même résultat. Ne touche qu'aux livraisons dont le
 * recalcul DIFFÈRE du statut stocké, et jamais à `deliveredAt` sans raison.
 *
 * Usage :
 *   npm run email:recompute            → dry-run (n'écrit rien)
 *   npm run email:recompute -- --apply → applique
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { EmailDelivery } from '../models/EmailDelivery.model.js';
import { EmailDeliveryEvent } from '../models/EmailDeliveryEvent.model.js';
import { applyBrevoEventToDelivery } from '../services/email/brevoDeliveryTransitions.js';
import { DELIVERY_STATUS as DS } from '../utils/emailTemplateConstants.js';

const APPLY = process.argv.includes('--apply');
const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m' };

/**
 * Rejoue le journal depuis l'acceptation. On repart de SENT — l'état qui suit
 * immédiatement un envoi accepté — plutôt que de PENDING : le journal ne contient
 * pas les transitions locales antérieures au premier webhook.
 */
function recompute(events) {
  let status = DS.SENT;
  let engagement;
  let deliveredAt = null;
  for (const e of events) {
    const r = applyBrevoEventToDelivery({
      currentStatus: status,
      engagement,
      normalizedEvent: e.type,
      occurredAt: e.occurredAt || e.receivedAt || null,
    });
    status = r.statusAfter;
    engagement = r.engagement;
    if (r.setDeliveredAt) deliveredAt = e.occurredAt || e.receivedAt || null;
  }
  return { status, deliveredAt };
}

async function main() {
  await connectDatabase();
  console.log(APPLY ? `${C.ylw}MODE APPLICATION — les statuts seront corrigés.${C.r}`
                    : `${C.dim}Dry-run : aucune écriture. Ajouter --apply pour corriger.${C.r}`);

  // Le signal fiable : LIVRÉ sans aucun `delivered` au journal.
  const candidates = await EmailDelivery.find({ status: DS.DELIVERED }).lean();
  const anomalies = [];

  for (const d of candidates) {
    const events = await EmailDeliveryEvent.find({ deliveryId: d.deliveryId })
      .sort({ occurredAt: 1, receivedAt: 1 }).lean();
    if (events.some((e) => e.type === 'DELIVERED')) continue; // preuve canonique présente

    const { status, deliveredAt } = recompute(events);
    if (status === d.status) continue; // rien à corriger

    anomalies.push({ d, events, status, deliveredAt });
  }

  console.log(`\nLivraisons « Livré » examinées : ${candidates.length}`);
  console.log(`${C.b}Sans preuve canonique de remise : ${anomalies.length}${C.r}\n`);

  for (const a of anomalies) {
    console.log(`  deliveryId   ${a.d.deliveryId}`);
    console.log(`  messageId    ${a.d.providerMessageId}`);
    console.log(`  destinataire ${a.d.recipientEmailMasked}`);
    console.log(`  journal      ${a.events.map((e) => e.type).join(' → ')}`);
    console.log(`  statut       ${C.red}${a.d.status}${C.r} → ${C.grn}${a.status}${C.r}`);
    console.log(`  deliveredAt  ${a.d.deliveredAt?.toISOString() || '—'} → ${a.deliveredAt?.toISOString() || '—'}\n`);

    if (APPLY) {
      await EmailDelivery.updateOne(
        { deliveryId: a.d.deliveryId },
        { $set: { status: a.status, deliveredAt: a.deliveredAt } }
      );
    }
  }

  if (!anomalies.length) console.log(`  ${C.grn}Aucune correction nécessaire.${C.r}`);
  else if (APPLY) console.log(`${C.grn}${anomalies.length} livraison(s) corrigée(s).${C.r}`);
  else console.log(`${C.ylw}Relancer avec --apply pour corriger.${C.r}`);
  console.log('');
}

main()
  .catch((err) => { console.error(`${C.red}Échec :${C.r}`, err.message); process.exitCode = 1; })
  .finally(async () => { await disconnectDatabase().catch(() => {}); });
