// LE BAIL DE TRAITEMENT — ce qui transforme un registre de réception en unité
// de travail.
//
// docs/STRIPE_SUBSCRIPTION_FLOW.md §« Reprise après incident ».
//
// ── LE DÉFAUT QUE CE MODULE FERME ───────────────────────────────────────────
//
// `WebhookEvent` servait de verrou par son index unique, et le refus E11000
// valait « doublon ». La protection contre le rejeu était parfaite ; le
// rattrapage après incident était nul :
//
//     webhook  →  ligne PENDING  →  CRASH  →  Stripe rejoue  →  « doublon »
//                                                            →  effet PERDU
//
// Un `customer.subscription.deleted` perdu de cette façon laisse un contrat
// ACTIVE sur un abonnement qui n'existe plus, et un site servi qui ne devrait
// plus l'être. Rien ne le signale, et aucun rejeu ne le réparera.
//
// ── CE QUE LE BAIL AJOUTE ───────────────────────────────────────────────────
//
// Une ligne ne dit plus « vu », elle dit « vu, et voilà où j'en suis ». Un
// rejeu consulte l'ÉTAT :
//
//     PROCESSED / IGNORED / DEAD_LETTER  →  doublon terminal, aucun effet
//     PROCESSING, bail VALIDE            →  quelqu'un travaille, on n'entre pas
//     PROCESSING, bail EXPIRÉ            →  travail abandonné, on REPREND
//     PENDING ancien                     →  jamais réclamé, on REPREND
//     FAILED reprenable                  →  on REPREND
//
// ── AUCUN VERROU MÉMOIRE ────────────────────────────────────────────────────
//
// Un `Set` de clés en cours n'aurait protégé qu'à l'intérieur d'un processus,
// tout en donnant l'illusion d'une garantie. La réclamation est une écriture
// conditionnelle en base, et rien d'autre.
import crypto from 'node:crypto';
import os from 'node:os';

import { WebhookEvent } from '../../models/WebhookEvent.model.js';
import {
  WEBHOOK_PROCESSING_STATUS as ST,
  WEBHOOK_TERMINAL_STATUSES,
} from '../../utils/contractConstants.js';

function positiveEnv(nom, defaut) {
  const brut = Number.parseInt(process.env[nom] ?? '', 10);
  return Number.isFinite(brut) && brut > 0 ? brut : defaut;
}

/**
 * ══ LA DURÉE DU BAIL — 120 s, ET VOICI POURQUOI ═════════════════════════════
 *
 * Mesure des traitements légitimes : un `invoice.paid` enchaîne la résolution
 * du contrat, la projection de l'abonnement, l'archivage de la facture et la
 * réconciliation du statut du site — quelques écritures Mongo et, au plus, un
 * aller-retour de capacité vers le Panel. Les invocations de capacité mesurées
 * en base tiennent entre 150 et 250 ms ; le pire cas plausible reste sous la
 * seconde.
 *
 * 120 s est donc environ deux ordres de grandeur au-dessus du pire cas observé,
 * et bien en dessous du premier rejeu utile de Stripe. Les deux bornes comptent :
 *
 *   trop COURT  →  on reprend un travail qui tourne encore, et deux processus
 *                  appliquent le même événement. L'idempotence métier tiendrait,
 *                  mais on l'aurait sollicitée pour rien.
 *   trop LONG   →  un `subscription.deleted` abandonné reste invisible des
 *                  minutes durant : un site servi alors que le contrat est fini.
 *
 * Réglable par `WEBHOOK_LEASE_TTL_MS` — un runtime plus lent que celui-ci
 * n'aurait pas à changer de code pour se donner de l'air.
 */
export const LEASE_TTL_MS = positiveEnv('WEBHOOK_LEASE_TTL_MS', 120_000);

/**
 * Un `PENDING` récent n'est pas « abandonné » : ce peut être une livraison en
 * cours dont le bail n'est pas encore écrit. Même délai que le bail — la
 * question posée est la même : « assez de temps a-t-il passé pour que le silence
 * signifie mort ? ».
 */
export const STALE_PENDING_MS = positiveEnv('WEBHOOK_STALE_PENDING_MS', LEASE_TTL_MS);

/**
 * ══ CINQ TENTATIVES, PUIS ON RENONCE — ET ON LE DIT ═════════════════════════
 *
 * Un événement toxique — schéma illisible, ressource disparue — échouerait
 * indéfiniment. Cinq laisse largement place aux pannes réelles sans transformer
 * un défaut en boucle perpétuelle. Le renoncement écrit `DEAD_LETTER` et
 * remonte à la supervision : jamais un silence.
 */
export const MAX_PROCESSING_ATTEMPTS = positiveEnv('WEBHOOK_MAX_ATTEMPTS', 5);

const NONCE_DEMARRAGE = crypto.randomBytes(6).toString('hex');
export const PROCESS_IDENTITY = `${os.hostname()}:${process.pid}:${NONCE_DEMARRAGE}`;

/** Issue d'une tentative de réclamation. Fermé. */
export const CLAIM_OUTCOME = Object.freeze({
  CLAIMED: 'CLAIMED',
  RECLAIMED: 'RECLAIMED',
  IN_FLIGHT: 'IN_FLIGHT',
  TERMINAL: 'TERMINAL',
});

/**
 * LE FILTRE DE REPRISE — écrit une seule fois, utilisé partout.
 *
 * Le réutiliser pour la réclamation ET pour le balayage garantit que les deux
 * parlent du même « abandonné ». Deux définitions auraient divergé, et le
 * balayage aurait fini par signaler ce que la réclamation refusait de reprendre.
 */
export function abandonedFilter(now = Date.now()) {
  return {
    $or: [
      { processingStatus: ST.PENDING, receivedAt: { $lte: new Date(now - STALE_PENDING_MS) } },
      { processingStatus: ST.FAILED, 'lastError.retryable': { $ne: false } },
      { processingStatus: ST.PROCESSING, leaseExpiresAt: { $lte: new Date(now) } },
    ],
  };
}

/**
 * RÉCLAMER UN ÉVÉNEMENT — insertion, ou reprise. Atomique dans les deux cas.
 *
 * ── POURQUOI DEUX ÉCRITURES ET PAS UN `upsert` ──────────────────────────────
 *
 * Un `findOneAndUpdate(..., {upsert: true})` ne peut pas porter un filtre
 * d'état : le filtre doit aussi décrire le document à créer. On aurait donc
 * upserté sur la seule clé — et écrasé le bail d'un processus qui travaille.
 *
 * L'insertion d'abord, la reprise conditionnelle ensuite, ne coûte une seconde
 * écriture QUE sur le chemin du rejeu, et laisse l'index unique arbitrer le cas
 * concurrent : deux premières livraisons simultanées, une seule insertion.
 */
export async function claimWebhookEvent({ provider, externalEventId, eventType, environment }) {
  const maintenant = Date.now();
  const cle = { provider, externalEventId };
  const bail = {
    processingStatus: ST.PROCESSING,
    leaseOwner: PROCESS_IDENTITY,
    processingStartedAt: new Date(maintenant),
    leaseExpiresAt: new Date(maintenant + LEASE_TTL_MS),
  };

  try {
    const cree = await WebhookEvent.create({
      ...cle, eventType, environment, ...bail, processingAttempts: 1,
    });
    return { outcome: CLAIM_OUTCOME.CLAIMED, event: cree, attempts: 1 };
  } catch (e) {
    if (e.code !== 11000) throw e;
  }

  /**
   * LA REPRISE — conditionnelle, donc sûre entre processus.
   *
   * Si le filtre ne matche pas, c'est que l'événement est conclu ou qu'un bail
   * valide court : dans les deux cas nous ne devons pas travailler, et Mongo
   * nous le dit en ne rendant rien. Aucune lecture-puis-décision.
   */
  const repris = await WebhookEvent.findOneAndUpdate(
    { ...cle, ...abandonedFilter(maintenant) },
    { $set: bail, $inc: { processingAttempts: 1 } },
    { new: true },
  );
  if (repris) {
    return { outcome: CLAIM_OUTCOME.RECLAIMED, event: repris, attempts: repris.processingAttempts ?? 1 };
  }

  /** Reste à dire POURQUOI. Lecture de DIAGNOSTIC : la décision est déjà prise. */
  const actuel = await WebhookEvent.findOne(cle).lean();
  const conclu = !actuel || WEBHOOK_TERMINAL_STATUSES.includes(actuel.processingStatus);
  return {
    outcome: conclu ? CLAIM_OUTCOME.TERMINAL : CLAIM_OUTCOME.IN_FLIGHT,
    event: actuel ?? null,
    attempts: actuel?.processingAttempts ?? 0,
  };
}

/**
 * CONCLURE — et n'écrire QUE si le bail est encore le nôtre.
 *
 * Le garde `leaseOwner` n'est pas une précaution de style. Un traitement qui
 * dépasse son bail voit son événement repris par un autre ; s'il écrivait
 * `PROCESSED` en rentrant, il effacerait le travail en cours de son successeur
 * et rendrait terminal un événement que personne n'a fini.
 */
export async function settleWebhookEvent({
  provider, externalEventId, status, contractId = null, error = null,
}) {
  const maintenant = new Date();
  const set = { processingStatus: status, processedAt: maintenant };
  if (contractId) set.relatedContractId = contractId;
  if (error) {
    set.errorMessage = String(error.message ?? '').slice(0, 500);
    set.lastError = { code: error.code ?? null, retryable: error.retryable ?? null, at: maintenant };
  }
  if (status !== ST.PROCESSING) {
    set.leaseOwner = null;
    set.leaseExpiresAt = null;
  }
  const r = await WebhookEvent.updateOne(
    { provider, externalEventId, leaseOwner: PROCESS_IDENTITY },
    { $set: set },
  );
  return { written: (r?.modifiedCount ?? 0) > 0 };
}

/**
 * ══ RETRYABLE OU TERMINAL — la classification, et elle tient en peu de lignes ═
 *
 * Une taxonomie ambitieuse aurait vieilli plus vite que le code qu'elle décrit.
 * La question posée est unique : **une nouvelle tentative a-t-elle une chance de
 * donner un résultat différent ?**
 *
 * OUI  — panne de base, Panel injoignable, délai dépassé, redémarrage, erreur
 *        de pont marquée reprenable par le module qui l'a levée.
 * NON  — le corps ne se lit pas, le schéma est incompatible, la ressource
 *        n'appartient définitivement pas à ce projet.
 *
 * ── LE DÉFAUT PAR DÉFAUT EST « REPRENABLE », ET C'EST DÉLIBÉRÉ ──────────────
 *
 * Une erreur inconnue est plus souvent une panne qu'un vice de forme. Se
 * tromper vers la reprise coûte quelques tentatives et finit en `DEAD_LETTER`
 * supervisé ; se tromper vers le terminal perd un fait contractuel en silence.
 * Les deux erreurs n'ont pas le même prix.
 */
const CODES_TERMINAUX = new Set([
  'WEBHOOK_PAYLOAD_INVALID',
  'WEBHOOK_SIGNATURE_REJECTED',
  'CONTRACT_NOT_FOUND',
  'RESOURCE_NOT_OWNED',
  'CAPABILITY_INPUT_INVALID',
]);

export function classifyWebhookError(err) {
  const code = err?.code ? String(err.code) : 'WEBHOOK_PROCESSING_FAILED';
  if (typeof err?.retryable === 'boolean') {
    return { code, retryable: err.retryable, message: err?.message ?? '' };
  }
  if (CODES_TERMINAUX.has(code) || err?.name === 'ValidationError' || err?.name === 'CastError') {
    return { code, retryable: false, message: err?.message ?? '' };
  }
  return { code, retryable: true, message: err?.message ?? '' };
}

/**
 * L'état à écrire après un échec — et le compteur y participe.
 *
 * Une erreur reprenable ne le reste que tant qu'il reste des tentatives. Passé
 * le plafond, elle devient un abandon assumé : `DEAD_LETTER`, supervisé, jamais
 * rejoué. C'est ce qui empêche la boucle infinie sans jamais jeter en silence.
 */
export function statusAfterFailure({ retryable, attempts }) {
  if (!retryable) return ST.DEAD_LETTER;
  return attempts >= MAX_PROCESSING_ATTEMPTS ? ST.DEAD_LETTER : ST.FAILED;
}

export default {
  LEASE_TTL_MS,
  STALE_PENDING_MS,
  MAX_PROCESSING_ATTEMPTS,
  PROCESS_IDENTITY,
  CLAIM_OUTCOME,
  abandonedFilter,
  claimWebhookEvent,
  settleWebhookEvent,
  classifyWebhookError,
  statusAfterFailure,
};
