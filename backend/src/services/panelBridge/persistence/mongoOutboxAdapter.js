/**
 * FILE DE LIVRAISON VERS LE PANEL — durable, idempotente, reprenable.
 *
 * ── CE QUE CE MODULE GARANTIT, ET CE QU'IL NE GARANTIT PAS ──────────────────
 * Garantie : AU MOINS UNE FOIS. Une écriture survit au redémarrage, se rejoue
 * après une panne du Panel, et n'est retirée de la file qu'une fois accusée.
 * Elle peut être livrée DEUX fois (accusé perdu en vol) — c'est le Panel qui
 * déduplique sur `writeId`. Promettre « exactement une fois » entre deux
 * systèmes distincts serait faux.
 *
 * ── POURQUOI LE writeId EST DÉTERMINISTE ────────────────────────────────────
 * Un UUID aléatoire par émission ferait de trois sauvegardes successives du
 * même formulaire trois écritures distinctes, toutes livrées, toutes appliquées
 * — un gaspillage, et un journal illisible. Le `writeId` est donc dérivé de
 * (entityType, entityId, modifiedAt) : réémettre un état déjà en file ne crée
 * rien, et une relivraison est reconnue comme doublon des deux côtés.
 */
import crypto from 'node:crypto';
import { PanelOutboxEntry, OUTBOX_STATUS } from '../../../models/PanelOutboxEntry.model.js';
import { recordSyncIncident, SYNC_INCIDENT } from '../syncIncidents.js';
import { classifyRejection, delaiDeReaffirmation, estResolu } from '../rejectionPolicy.js';
import logger from '../../../utils/logger.js';

/**
 * Backoff BORNÉ : 15 s, 1 min, 5 min, 15 min, puis 1 h.
 *
 * Le premier report est court volontairement — une coupure du Panel dure
 * souvent quelques secondes (redémarrage, déploiement), et faire attendre une
 * minute une modification déjà saisie donnerait l'impression que rien ne
 * remonte. Les paliers suivants s'écartent vite : un Panel durablement absent
 * ne doit pas être sollicité en boucle.
 */
const BACKOFF_SECONDS = [15, 60, 300, 900, 3600];

/** Une entrée SENDING plus vieille que ça est considérée orpheline. */
const SENDING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * UUID DÉTERMINISTE (forme v5) dérivé d'une clé stable. Le contrat exige un
 * UUID ; on en fabrique un reproductible plutôt qu'un aléatoire, pour que la
 * même version d'une même entité porte toujours le même identifiant.
 */
export function deterministicWriteId(entityType, entityId, modifiedAt, generation = sourceGeneration()) {
  const hex = crypto
    .createHash('sha256')
    .update(`${entityType}|${entityId}|${modifiedAt}|${generation}`)
    .digest('hex');
  const v = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  return v;
}

/**
 * LA GÉNÉRATION DE CETTE SOURCE — l'environnement, et rien d'autre.
 *
 * ── POURQUOI ELLE ENTRE DANS LE writeId ─────────────────────────────────────
 * Le `writeId` dérive de l'état : (entité, version). Deux photographies
 * identiques portaient donc le même identifiant — c'est la déduplication, et
 * elle est voulue.
 *
 * Elle devenait fausse après un redéploiement croisé. Une même destination
 * passée de PROD à TEST repart d'une AUTRE base : son contrat, son équipe, son
 * identité n'ont plus rien à voir, mais une photographie qui se trouvait porter
 * la même date produisait le même `writeId` — et le Panel, l'ayant déjà vue,
 * répondait « doublon » sans rien appliquer. L'ancien monde restait à l'écran.
 *
 * L'environnement entre donc dans la graine. Deux générations ne peuvent plus
 * se confondre, et la déduplication continue de jouer À L'INTÉRIEUR de chacune
 * — y compris après un redémarrage, puisque rien ici ne dépend du démarrage.
 */
/**
 * LA GÉNÉRATION EST INJECTÉE, JAMAIS LUE ICI.
 *
 * ── POURQUOI CE MODULE NE PEUT PAS INTERROGER LA CONFIGURATION ─────────────
 * Il appartient au PONT, dont la frontière est stricte : le pont ne connaît ni
 * le métier, ni la configuration de l'application. Il reçoit ce dont il a
 * besoin — l'appairage, l'outbox, les applicateurs — et cette règle vaut aussi
 * pour l'environnement. Un adaptateur qui lit `config/env.js` rouvre une
 * dépendance que tout le reste de ce répertoire a fermée, et rend le module
 * inutilisable hors d'une application complète.
 *
 * ── ET POURQUOI ELLE EST EXIGÉE, PAS SUPPOSÉE ─────────────────────────────
 * Le `writeId` est dérivé de l'état ; deux mondes qui partagent la même
 * graine produisent le même identifiant pour des données différentes, et le
 * Panel répond « doublon » sans rien appliquer. Un repli silencieux
 * (« INCONNU ») ferait exactement cela le jour où l'injection est oubliée.
 * On refuse donc d'écrire plutôt que d'écrire faux.
 */
let generationInjectee = null;

/**
 * CADENCE DE RÉAFFIRMATION — injectée, et normalement ABSENTE.
 *
 * La politique (`rejectionPolicy.js`) fixe des paliers en minutes et en heures,
 * parce qu'un refus de contrat se répare par un déploiement. Une recette ne
 * peut pas attendre cinq minutes pour observer une réparation qui, elle, ne
 * dépend pas de la durée.
 *
 * C'est donc un paramètre d'INJECTION, au même titre que la génération : le
 * bootstrap ne le fournit pas et laisse la politique décider. Seul un harnais
 * le raccourcit, et il le dit.
 */
let cadenceInjectee = null;

export function configureRejectionCadence(seconds) {
  cadenceInjectee = Array.isArray(seconds) && seconds.length > 0 ? seconds : null;
  return cadenceInjectee;
}

export function configureOutboxGeneration(generation) {
  const valeur = String(generation ?? '').trim();
  generationInjectee = valeur.length > 0 ? valeur : null;
  return generationInjectee;
}

function sourceGeneration() {
  if (!generationInjectee) {
    throw new Error(
      'Outbox du pont : aucune génération déclarée. '
      + 'Appelez createMongoOutboxAdapter({ generation }) au démarrage — sans elle, '
      + 'deux environnements produiraient les mêmes writeId et le Panel les prendrait pour des doublons.',
    );
  }
  return generationInjectee;
}

/**
 * Met une projection en file. IDEMPOTENT : si la même version de la même
 * entité y est déjà, on ne crée pas de doublon.
 *
 * ── UNE ENTRÉE REFUSÉE N'EST PAS UNE ENTRÉE PERDUE ──────────────────────────
 * Le `writeId` étant dérivé de l'ÉTAT (entité + version), réémettre un état
 * déjà en file ne crée rien : c'est la déduplication, et elle est voulue. Mais
 * appliquée telle quelle à une entrée `REJECTED`, elle rendait le refus
 * DÉFINITIF — la réconciliation au démarrage reconstruisait le même état, donc
 * le même `writeId`, et ne faisait rien. La donnée était perdue jusqu'à la
 * prochaine modification du document source.
 *
 * Or un refus est souvent PASSAGER : un Panel pas encore à jour ne connaît pas
 * un type d'entité qu'il saura appliquer après son déploiement. Réaffirmer un
 * état refusé le remet donc en file. L'inverse — `ACKNOWLEDGED` — n'est jamais
 * réveillé : le Panel a répondu, insister tournerait en boucle.
 *
 * Ne lève JAMAIS : la sauvegarde métier a déjà réussi quand on arrive ici, et
 * une file indisponible ne doit pas la faire échouer rétroactivement.
 *
 * @returns {Promise<{queued: boolean, revived?: boolean, writeId: string|null}>}
 */
/**
 * EMPREINTE DE LA PHOTOGRAPHIE — l'horodatage NE SUFFIT PAS.
 *
 * Le `writeId` dérivait de (entité, horodatage). Deux photographies de CONTENU
 * différent portant le même horodatage produisaient donc le même identifiant :
 * la seconde était vue comme un doublon, et n'était jamais livrée.
 *
 * Ce n'est pas un cas d'école. Quand la FORME d'une projection change — un
 * contrat résilié republié avec la distinction courant/historique — la donnée
 * métier, elle, n'a pas bougé : l'horodatage reste identique, et la nouvelle
 * information ne pouvait plus sortir de la file.
 *
 * L'empreinte du contenu entre donc dans la graine, EN PLUS de l'horodatage :
 * même état exactement → même identifiant, et la déduplication joue ; contenu
 * différent → identifiant neuf, et l'écriture part.
 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export async function enqueueProjection({ entityType, entityId, payload, modifiedAt, deleted = false }) {
  const at = modifiedAt ?? new Date().toISOString();
  const empreinte = `${at}|${deleted ? 'DELETED' : stableStringify(payload)}`;
  const writeId = deterministicWriteId(entityType, entityId, empreinte);
  try {
    /**
     * UN TOMBSTONE EN ATTENTE SUFFIT.
     *
     * « Plus aucun contrat » n'a pas de date propre : la chose qui datait
     * l'événement a disparu avec lui. Le tombstone porte donc l'heure de sa
     * construction — et deux réconciliations successives en fabriquaient deux,
     * puis trois, chacune avec un `writeId` neuf, pour dire exactement la même
     * chose. La file grossissait d'écritures rigoureusement identiques.
     *
     * Tant qu'un tombstone de cette entité attend d'être livré, un second
     * n'apprend rien à personne. Une fois livré, un nouveau pourra repartir —
     * appliquer deux fois une suppression est sans effet.
     */
    if (deleted) {
      const enAttente = await PanelOutboxEntry.exists({
        entityType,
        entityId,
        deleted: true,
        status: { $in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.SENDING] },
      });
      if (enAttente) return { queued: false, writeId: null, alreadyPending: true };
    }

    const res = await PanelOutboxEntry.updateOne(
      { writeId },
      {
        $setOnInsert: {
          writeId,
          entityType,
          entityId,
          payload: deleted ? null : payload,
          deleted,
          modifiedAt: at,
          emitter: 'PROJECT',
          status: OUTBOX_STATUS.PENDING,
          nextAttemptAt: new Date(),
        },
      },
      { upsert: true },
    );
    if ((res.upsertedCount ?? 0) > 0) return { queued: true, writeId };

    // Déjà connue. Si le Panel l'avait refusée, on la rend à la file — remise
    // à zéro des tentatives comprise, ce n'est pas la reprise d'un échec de
    // transport mais un nouvel essai après une cause probablement corrigée.
    const revived = await PanelOutboxEntry.updateOne(
      { writeId, status: OUTBOX_STATUS.REJECTED },
      {
        $set: {
          status: OUTBOX_STATUS.PENDING,
          attempts: 0,
          nextAttemptAt: new Date(),
          acknowledgedAt: null,
        },
      },
    );
    if ((revived.modifiedCount ?? 0) > 0) {
      logger.info(`[outbox] écriture précédemment refusée remise en file (${entityType}).`);
      return { queued: true, revived: true, writeId };
    }
    return { queued: true, writeId };
  } catch (err) {
    /**
     * UNE MISE EN FILE RATÉE EST LA PERTE LA PLUS GRAVE DE TOUTE LA CHAÎNE :
     * l'écriture métier a réussi, mais rien ne partira — et rien ne le
     * rattrapera avant la réconciliation du prochain démarrage.
     */
    recordSyncIncident(SYNC_INCIDENT.OUTBOX_ENQUEUE_FAILED, {
      step: 'enqueue', entityType, entityId, writeId, reason: err.code || err.message,
    }, 'error');
    return { queued: false, writeId: null };
  }
}

/**
 * Libère les entrées restées SENDING : le processus qui les tenait est mort
 * avant d'avoir reçu son accusé. Sans cela, elles ne repartiraient jamais.
 */
export async function releaseOrphans() {
  const limit = new Date(Date.now() - SENDING_TIMEOUT_MS);
  const res = await PanelOutboxEntry.updateMany(
    { status: OUTBOX_STATUS.SENDING, lastAttemptAt: { $lt: limit } },
    { $set: { status: OUTBOX_STATUS.PENDING } },
  );
  if (res.modifiedCount > 0) {
    logger.info(`[outbox] ${res.modifiedCount} écriture(s) orpheline(s) remise(s) en file.`);
  }
  return res.modifiedCount ?? 0;
}

/** Réclame un lot d'écritures dues, et les marque en vol. */
export async function claimBatch(limit) {
  const now = new Date();
  const due = await PanelOutboxEntry.find({
    status: OUTBOX_STATUS.PENDING,
    nextAttemptAt: { $lte: now },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  if (due.length === 0) return [];
  await PanelOutboxEntry.updateMany(
    { writeId: { $in: due.map((e) => e.writeId) } },
    { $set: { status: OUTBOX_STATUS.SENDING, lastAttemptAt: now }, $inc: { attempts: 1 } },
  );
  return due;
}

/** L'écriture au format du contrat, telle que le pont l'enverra. */
export function toSyncChange(entry) {
  return {
    writeId: entry.writeId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    deleted: entry.deleted,
    payload: entry.deleted ? null : entry.payload,
    modifiedAt: entry.modifiedAt,
    emitter: entry.emitter,
  };
}

/**
 * Accusé reçu.
 *
 * ── DEUX ISSUES, ET ELLES NE SE RESSEMBLENT PLUS ────────────────────────────
 *
 * RÉSOLUE (`APPLIED` / `DUPLICATE` / `IGNORED`) : le dossier se ferme,
 * `acknowledgedAt` est posé, l'index TTL fera le ménage dans sept jours.
 *
 * REFUSÉE : le dossier reste OUVERT. Pas d'`acknowledgedAt` — donc pas
 * d'effacement automatique —, la classe et le code sont conservés, la date du
 * PREMIER refus n'est jamais réécrite, et l'écriture est REPROGRAMMÉE selon la
 * cadence de sa classe. C'est ce qui la fera repartir toute seule le jour où le
 * destinataire saura l'accepter, sans qu'un utilisateur ait à réenregistrer
 * quoi que ce soit.
 *
 * Poser `acknowledgedAt` sur un refus — ce que faisait cette fonction — rendait
 * la perte définitive ET invisible : deux propriétés qu'on ne veut ni l'une ni
 * l'autre.
 */
export async function acknowledge(writeId, status, code = null) {
  if (estResolu(status)) {
    await PanelOutboxEntry.updateOne(
      { writeId },
      {
        $set: {
          status: OUTBOX_STATUS.ACKNOWLEDGED,
          acknowledgedAt: new Date(),
          // La résolution EFFACE l'incident : il ne doit pas survivre à sa cause.
          failureClass: null,
          lastErrorCode: null,
        },
      },
    );
    return { resolved: true };
  }

  const failureClass = classifyRejection(code);
  const courant = await PanelOutboxEntry.findOne({ writeId }).select('rejections firstRejectedAt').lean();
  const rejections = (courant?.rejections ?? 0) + 1;
  const delai = cadenceInjectee
    ? cadenceInjectee[Math.min(rejections - 1, cadenceInjectee.length - 1)]
    : delaiDeReaffirmation(failureClass, rejections);

  await PanelOutboxEntry.updateOne(
    { writeId },
    {
      $set: {
        status: OUTBOX_STATUS.REJECTED,
        failureClass,
        lastErrorCode: code ?? null,
        rejections,
        nextAttemptAt: new Date(Date.now() + delai * 1000),
        // Jamais réécrite : c'est elle qui dit depuis combien de temps une
        // donnée métier n'arrive pas.
        firstRejectedAt: courant?.firstRejectedAt ?? new Date(),
      },
    },
  );
  return { resolved: false, failureClass, nextAttemptInSeconds: delai };
}

/**
 * RÉAFFIRMATION DES REFUS DUS — le seul chemin de réparation automatique.
 *
 * ── POURQUOI CELA SUFFIT, ET POURQUOI C'EST SÛR ─────────────────────────────
 * Les entités concernées sont des PHOTOGRAPHIES (`PROJECT_PRESENTATION`,
 * `CONTRACT`) ou des lignes identifiées (`TEAM_MEMBER`). Renvoyer exactement
 * la même écriture est donc sans effet de bord : si le destinataire l'accepte
 * enfin, il applique un état ; s'il la refuse encore, on la reprogramme plus
 * loin. Le `writeId` étant déterministe, une acceptation tardive est reconnue
 * comme la même écriture — jamais comme une seconde.
 *
 * Appelée au début de chaque vidange, comme `releaseOrphans` : la réparation
 * est le rôle légitime du cycle périodique, et le seul.
 */
export async function reviveDueRejections() {
  const res = await PanelOutboxEntry.updateMany(
    { status: OUTBOX_STATUS.REJECTED, nextAttemptAt: { $lte: new Date() } },
    { $set: { status: OUTBOX_STATUS.PENDING } },
  );
  if ((res.modifiedCount ?? 0) > 0) {
    logger.info(`[outbox] ${res.modifiedCount} écriture(s) refusée(s) réaffirmée(s).`);
  }
  return res.modifiedCount ?? 0;
}

/**
 * L'ÉTAT DE SANTÉ DE LA FILE — ce qu'une instance peut DIRE d'elle-même.
 *
 * Sans cela, « appairé et vivant » restait compatible avec « aucune donnée
 * métier ne passe depuis trois semaines ». Publié dans le battement de cœur
 * (`bridgeStats`), il rend le blocage visible depuis le Panel, sans qu'aucun
 * écran n'ait à interroger quoi que ce soit.
 *
 * Aucune charge utile, aucun secret : des comptes, des codes et des dates.
 */
export async function describeOutboxHealth() {
  const [pending, rejected, plusAncien] = await Promise.all([
    PanelOutboxEntry.countDocuments({
      status: { $in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.SENDING] },
    }),
    PanelOutboxEntry.countDocuments({ status: OUTBOX_STATUS.REJECTED }),
    PanelOutboxEntry.findOne({ status: OUTBOX_STATUS.REJECTED })
      .sort({ firstRejectedAt: 1 })
      .select('entityType failureClass lastErrorCode firstRejectedAt rejections')
      .lean(),
  ]);

  return {
    pending,
    rejected,
    ...(plusAncien
      ? {
        oldestRejection: {
          entityType: plusAncien.entityType,
          failureClass: plusAncien.failureClass ?? null,
          code: plusAncien.lastErrorCode ?? null,
          since: plusAncien.firstRejectedAt
            ? new Date(plusAncien.firstRejectedAt).toISOString() : null,
          rejections: plusAncien.rejections ?? 0,
        },
      }
      : {}),
  };
}

/**
 * Échec de TRANSPORT : l'écriture repart en file, avec un délai croissant.
 * Un refus du Panel, lui, n'est pas rejouable — il passe par `acknowledge`.
 */
export async function deferAfterFailure(writeIds, reason) {
  if (writeIds.length === 0) return;
  const entries = await PanelOutboxEntry.find({ writeId: { $in: writeIds } }).select('writeId attempts').lean();
  await Promise.all(
    entries.map((e) => {
      const seconds = BACKOFF_SECONDS[Math.min(e.attempts - 1, BACKOFF_SECONDS.length - 1)] ?? 3600;
      return PanelOutboxEntry.updateOne(
        { writeId: e.writeId },
        {
          $set: {
            status: OUTBOX_STATUS.PENDING,
            nextAttemptAt: new Date(Date.now() + seconds * 1000),
            lastError: String(reason ?? '').slice(0, 300),
          },
        },
      );
    }),
  );
}

/**
 * Nombre d'écritures encore à livrer — exposé au heartbeat (`outboxSize`).
 *
 * Les REFUSÉES n'y figurent pas : elles ne sont pas « en attente de départ »,
 * elles sont en attente de RÉPARATION. Les additionner ferait passer un
 * blocage de contrat pour un simple retard de file, et la nuance est
 * exactement celle qu'on veut rendre lisible (`describeOutboxHealth`).
 */
export async function pendingCount() {
  return PanelOutboxEntry.countDocuments({
    status: { $in: [OUTBOX_STATUS.PENDING, OUTBOX_STATUS.SENDING] },
  });
}

/** Purge complète — désappairage : la file d'un Panel révoqué n'a plus de sens. */
export async function clearOutbox() {
  await PanelOutboxEntry.deleteMany({});
}

export default {
  enqueueProjection,
  releaseOrphans,
  reviveDueRejections,
  claimBatch,
  toSyncChange,
  acknowledge,
  deferAfterFailure,
  pendingCount,
  describeOutboxHealth,
  clearOutbox,
  deterministicWriteId,
};

/**
 * ADAPTATEUR consommé par le cœur du pont — surface étroite et stable.
 *
 * Le pont ne connaît que ces six verbes : il ignore Mongo, les statuts et le
 * backoff. C'est la même frontière que pour la persistance de l'appairage.
 */
export function createMongoOutboxAdapter({ generation, rejectionCadenceSeconds } = {}) {
  // L'environnement arrive du bootstrap — le seul endroit qui a le droit de
  // lire la configuration. Voir `sourceGeneration`.
  if (generation !== undefined) configureOutboxGeneration(generation);
  if (rejectionCadenceSeconds !== undefined) configureRejectionCadence(rejectionCadenceSeconds);
  return {
    enqueue: (change) => enqueueProjection(change),
    claim: (limit) => claimBatch(limit),
    toChange: (entry) => toSyncChange(entry),
    acknowledge: (writeId, status, code) => acknowledge(writeId, status, code),
    defer: (writeIds, reason) => deferAfterFailure(writeIds, reason),
    releaseOrphans: () => releaseOrphans(),
    /** Réparation : les refus dus repartent. Voir `reviveDueRejections`. */
    reviveRejected: () => reviveDueRejections(),
    pending: () => pendingCount(),
    health: () => describeOutboxHealth(),
    clear: () => clearOutbox(),
  };
}
