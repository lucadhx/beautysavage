// AUTORITÉ CENTRALE DES PORTS APPLICATIFS — identique au Panel.
//
// ══ LA CAUSE TRAITÉE ════════════════════════════════════════════════════════
//
// L'attribution était « le plus haut port déjà attribué en base, plus un ».
// Elle ne consultait qu'une seule source : les fiches en base. Elle ignorait
// donc les process encore en ligne dont la fiche a disparu, les sockets
// réellement ouvertes, et les services système.
//
// Après la suppression d'une fiche encore en ligne, son port est
// redescendu dans la plage libre et a été réattribué à la destination
// suivante — alors que l'ancien backend, toujours en ligne, le DÉTENAIT. Le
// nouveau service a bouclé sur EADDRINUSE plus de 7 000 fois, pendant que
// Nginx envoyait le trafic du nouveau domaine vers l'ancien code.
//
// ══ LA RÈGLE ═══════════════════════════════════════════════════════════════
//
// Un port n'est libre que si les TROIS sources le disent : la base, PM2, les
// sockets. Et il n'est ACTIF que lorsqu'on a prouvé que le bon PID le détient.
//
// L'allocation suit donc sept temps :
//   1. charger les ports réservés en base ;
//   2. lire les process PM2 du serveur ;
//   3. lire les sockets réelles ;
//   4. exclure tout ce qui est occupé, réservé ou interdit ;
//   5. réserver transactionnellement (index unique partiel) ;
//   6. vérifier de nouveau juste avant le démarrage ;
//   7. n'activer qu'après preuve que le bon PID détient le port.
//
// Sans transport (écran de création : aucun mot de passe SSH), seules les
// étapes 1, 4 et 5 sont possibles. La réservation est alors marquée non
// vérifiée, et les étapes 2, 3, 6 et 7 ont lieu au déploiement — moment où
// une connexion existe. Prétendre avoir vérifié un serveur qu'on n'a pas
// contacté serait pire que de l'annoncer.
import PortReservation from '../../models/PortReservation.model.js';
import { ApiError } from '../../utils/ApiError.js';
import logger from '../../utils/logger.js';
import {
  NEVER_ALLOCATE, PORT_ERRORS, PORT_RANGE, findFreePort, readPortLandscape,
} from '../../deployment-engine/ports.js';

/** Horodatage ISO — le registre n'écrit que des chaînes comparables. */
const nowIso = () => new Date().toISOString();

export const RESERVATION_STATUS = Object.freeze({
  RESERVED: 'RESERVED',
  ACTIVE: 'ACTIVE',
  RELEASING: 'RELEASING',
  RELEASED: 'RELEASED',
});

/** Réservations qui RETIENNENT encore le port. */
const VIVANTES = [RESERVATION_STATUS.RESERVED, RESERVATION_STATUS.ACTIVE, RESERVATION_STATUS.RELEASING];

/** Nombre de collisions tolérées avant d'abandonner l'allocation. */
const MAX_TENTATIVES = 25;

/**
 * L'INDEX UNIQUE DOIT EXISTER AVANT LA PREMIÈRE RÉSERVATION.
 *
 * C'est lui, et lui seul, qui rend la réservation transactionnelle : sans lui,
 * deux allocations simultanées lisent les mêmes ports libres et écrivent
 * toutes les deux. Mongoose construit ses index en tâche de fond ; attendre
 * cette construction est donc un PRÉALABLE, pas une optimisation.
 *
 * `Model.init()` est idempotent et mémorise sa promesse : l'appeler à chaque
 * réservation ne coûte rien après la première.
 */
async function ensureIndexes() {
  await PortReservation.init();
}

/**
 * L'IDENTIFIANT d'une destination, en chaîne.
 *
 * Le registre indexe par chaîne : un `ObjectId` et sa représentation textuelle
 * ne sont pas égaux pour Mongo, et mélanger les deux ferait silencieusement
 * échouer chaque recherche de réservation.
 */
export function targetKeyOf(target) {
  return String(target?.id ?? target?._id ?? target?.targetId ?? '');
}

/** Clé de serveur normalisée. Un port appartient à un serveur, pas à l'application. */
export function serverKeyOf(target) {
  const brut = target?.sshHost ?? target?.serverKey ?? null;
  if (!brut) {
    throw ApiError.badRequest('Port impossible à réserver : la destination ne déclare aucun serveur.');
  }
  return String(brut).trim().toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*  LECTURE                                                                   */
/* -------------------------------------------------------------------------- */

/** Réservations vivantes d'un serveur. */
export async function liveReservations(serverKey) {
  return PortReservation.find({ serverKey, status: { $in: VIVANTES } })
    .sort({ port: 1 }).lean();
}

/** Ports retenus par la base sur un serveur. */
export async function reservedPorts(serverKey) {
  return (await liveReservations(serverKey)).map((r) => r.port);
}

/** La réservation vivante d'une destination, s'il y en a une. */
export async function reservationFor(targetId) {
  return PortReservation.findOne({
    deploymentTargetId: targetId, status: { $in: VIVANTES },
  }).lean();
}

/** Projection lisible — ce que l'interface et les rapports affichent. */
export function describeReservation(doc) {
  if (!doc) return null;
  return {
    port: doc.port,
    serverKey: doc.serverKey,
    host: doc.host ?? null,
    deploymentTargetId: doc.deploymentTargetId ?? null,
    projectIdentityId: doc.projectIdentityId ?? null,
    environment: doc.environment,
    serviceType: doc.serviceType ?? 'backend',
    status: doc.status,
    reservedAt: doc.reservedAt,
    activatedAt: doc.activatedAt ?? null,
    releasedAt: doc.releasedAt ?? null,
    processName: doc.processName ?? null,
    pid: doc.pid ?? null,
    lastVerifiedAt: doc.lastVerifiedAt ?? null,
    lastConflict: doc.lastConflict ?? null,
  };
}

/** Vue complète du registre d'un serveur — pour l'écran et le diagnostic. */
export async function describeServerRegistry(serverKey) {
  const docs = await PortReservation.find({ serverKey }).sort({ port: 1 }).lean();
  return {
    serverKey,
    range: PORT_RANGE,
    neverAllocate: NEVER_ALLOCATE,
    reservations: docs.map(describeReservation),
    live: docs.filter((d) => VIVANTES.includes(d.status)).length,
  };
}

/* -------------------------------------------------------------------------- */
/*  RÉSERVATION                                                               */
/* -------------------------------------------------------------------------- */

/**
 * RÉSERVE un port pour une destination — ou rend celui qu'elle a déjà.
 *
 * ── LA MÊME DESTINATION GARDE SON PORT ──────────────────────────────────────
 * Un redéploiement ne change JAMAIS de port : le service PM2 et la
 * configuration Nginx en place le référencent. En changer casserait le proxy
 * pendant que le service, lui, écoute ailleurs.
 *
 * @param {object} args
 * @param {object} args.target     destination (targetId, sshHost, environment, host…)
 * @param {object} [args.transport] transport ouvert — permet les étapes 2, 3
 *        (lecture PM2 et sockets). Absent : réservation depuis la base seule,
 *        marquée non vérifiée.
 * @returns {Promise<{port:number, reservation:object, verified:boolean, landscape:object|null}>}
 */
export async function reservePort({ target, transport = null, landscape: paysageFourni = null }) {
  await ensureIndexes();
  const serverKey = serverKeyOf(target);
  const at = nowIso();

  // La destination a-t-elle déjà un port ? Alors c'est le sien, point.
  const existante = await reservationFor(targetKeyOf(target));
  if (existante) {
    return {
      port: existante.port,
      reservation: describeReservation(existante),
      verified: Boolean(existante.lastVerifiedAt),
      landscape: null,
      reused: true,
    };
  }

  // 2 & 3. Ce que le SERVEUR dit — quand on peut le lui demander.
  /**
   * UN PAYSAGE DÉJÀ LU EST RÉUTILISÉ, JAMAIS RELU.
   *
   * `ensureUsablePort` vient de lire la machine pour constater le conflit. Le
   * relire ici coûterait un aller-retour de plus — et surtout, ce serait une
   * SECONDE lecture, donc deux vérités possibles sur la même question. C'est
   * exactement ainsi que le port avait été réattribué à lui-même : la relecture
   * échouait, le paysage repartait vide, et le port qu'on venait de libérer
   * redevenait le premier libre.
   */
  let landscape = paysageFourni;
  if (!landscape && transport) {
    landscape = await readPortLandscape(transport);
    if (!landscape.socketsReadable) {
      // Une lecture ratée n'est PAS « aucun port occupé ». On le dit, et on
      // continue sur les seules sources sûres — la vérification d'avant
      // démarrage repassera dessus.
      logger.warn(`Registre des ports : sockets illisibles sur ${serverKey}. `
        + 'L’allocation s’appuie sur la base et PM2 ; la vérification avant démarrage reste bloquante.');
    }
  }

  // 4 & 5. Exclure, puis réserver TRANSACTIONNELLEMENT. L'index unique partiel
  // du modèle tranche : deux créations simultanées ne peuvent pas obtenir le
  // même port, la perdante recommence sur le suivant.
  const dejaEssayes = [];
  for (let tentative = 0; tentative < MAX_TENTATIVES; tentative += 1) {
    const reserves = await reservedPorts(serverKey);
    const port = findFreePort({
      reserved: reserves,
      occupied: landscape?.occupied ?? [],
      excluded: dejaEssayes,
    });

    try {
      const doc = await PortReservation.create({
        serverKey,
        port,
        deploymentTargetId: targetKeyOf(target),
        projectIdentityId: target.projectIdentityId ?? null,
        host: target.host ?? null,
        environment: target.environment,
        serviceType: 'backend',
        status: RESERVATION_STATUS.RESERVED,
        reservedAt: at,
        lastVerifiedAt: landscape ? at : null,
        createdAt: at,
        updatedAt: at,
      });
      return {
        port,
        reservation: describeReservation(doc.toObject()),
        verified: Boolean(landscape),
        landscape,
        reused: false,
      };
    } catch (err) {
      // Doublon : une autre opération a pris ce port entre notre lecture et
      // notre écriture. C'est le cas NORMAL de la concurrence — on recommence
      // sur le suivant plutôt que d'écraser.
      if (err?.code === 11000) { dejaEssayes.push(port); continue; }
      throw err;
    }
  }

  throw ApiError.conflict(
    `Aucun port n’a pu être réservé sur ${serverKey} après ${MAX_TENTATIVES} tentatives : `
    + 'des réservations concurrentes se disputent la plage applicative.',
    { code: PORT_ERRORS.PORT_RESERVATION_CONFLICT },
  );
}

/**
 * VÉRIFICATION D'AVANT DÉMARRAGE — étape 6.
 *
 * Entre la réservation et le démarrage, le serveur a pu changer : un process
 * oublié peut avoir été relancé, un service système installé. On regarde donc
 * de nouveau, et on refuse plutôt que de laisser PM2 découvrir la collision en
 * bouclant.
 *
 * Trois issues seulement :
 *   · libre                                → on démarre ;
 *   · détenu par NOTRE service PM2         → on démarre (redéploiement) ;
 *   · détenu par autre chose               → on S'ARRÊTE, en nommant le détenteur.
 */
/**
 * ══ LE PORT RÉSERVÉ EST-IL ENCORE TENABLE ? — ET SINON, ON EN PREND UN AUTRE ══
 *
 * ── LE DÉFAUT OBSERVÉ À LA CERTIFICATION FACTORY ──────────────────────────
 *
 * Une destination créée depuis un écran n'a pas de session SSH : sa réservation
 * est faite sur la seule base, et marquée NON VÉRIFIÉE. C'est documenté, et
 * c'est honnête.
 *
 * Mais le registre d'un projet NEUF est vide. Il ignore donc tout ce qui tourne
 * déjà sur le serveur PARTAGÉ — le Panel, les autres clients — et attribue un
 * port qu'un autre détient. Le deuxième projet déployé sur une machine échouait
 * ainsi en `PM2_PORT_COLLISION`, après avoir écrit son Nginx et obtenu son
 * certificat. Le moteur refusait de démarrer, ce qui est le bon comportement ;
 * il ne restait plus qu'un geste manuel pour choisir un autre port.
 *
 * ── POURQUOI ICI, ET PAS DANS UNE CAPACITÉ DU PANEL ───────────────────────
 *
 * On a cherché l'autorité centrale du parc. Elle n'est pas nécessaire : LA
 * VÉRITÉ EST SUR LA MACHINE. Les sockets ouvertes et les process PM2 disent
 * exactement ce qui est pris, quel que soit le projet à qui cela appartient —
 * y compris les services dont plus aucune fiche ne parle. Un registre central
 * aurait ajouté une deuxième source, donc une divergence possible.
 *
 * ── CE QUE CETTE FONCTION NE FAIT PAS ─────────────────────────────────────
 *
 * Elle ne déplace JAMAIS un port que NOUS détenons déjà : un service en ligne
 * garde le sien, sinon un simple redéploiement ferait valser l'adresse du
 * backend derrière un Nginx qui, lui, n'aurait pas bougé.
 *
 * @returns {Promise<{port:number, moved:boolean, from:number|null, reason:string|null}>}
 */
export async function ensureUsablePort({
  target, transport, expectedPm2Name = null,
  /** Injectable pour les tests : le paysage réel du serveur, lu une fois. */
  readLandscape = readPortLandscape,
}) {
  const courante = await reservationFor(targetKeyOf(target));
  const portActuel = courante?.port ?? target?.backendPort ?? null;
  if (!transport || !portActuel) {
    return { port: portActuel, moved: false, from: null, reason: 'SANS_TRANSPORT' };
  }

  const lu = await readLandscape(transport);
  /**
   * ON DÉRIVE `occupied` PLUTÔT QUE DE LE CROIRE SUR PAROLE.
   *
   * Un paysage partiel — une lecture de sockets ratée, une façade de test — ne
   * doit jamais valoir « aucun port occupé ». C'est ce silence-là qui avait
   * réattribué le port à lui-même : on venait de le libérer, et plus rien ne
   * disait qu'il était pris.
   */
  const sockets = lu?.sockets ?? [];
  const process = lu?.processes ?? [];
  const paysage = {
    ...lu,
    sockets,
    processes: process,
    occupied: lu?.occupied?.length
      ? lu.occupied
      : [...new Set([
        ...sockets.map((x) => x.port),
        ...process.map((x) => x.port),
      ].filter(Number.isInteger))],
  };
  const socket = sockets.find((x) => x.port === portActuel) ?? null;
  const processus = process.find((x) => x.port === portActuel) ?? null;

  /** Personne dessus : rien à faire. */
  if (!socket && !processus) {
    return { port: portActuel, moved: false, from: null, reason: null };
  }

  /**
   * C'EST NOTRE PROPRE SERVICE — on ne bouge pas. Un redéploiement retrouve son
   * port ; le déplacer casserait le Nginx qui pointe déjà dessus.
   */
  const aNous = expectedPm2Name
    && (processus?.name === expectedPm2Name || socket?.processName === expectedPm2Name);
  if (aNous) {
    return { port: portActuel, moved: false, from: null, reason: 'DETENU_PAR_NOUS' };
  }

  /**
   * UN AUTRE LE DÉTIENT. On libère la réservation — en nommant le conflit — et
   * l'on en prend une neuve, cette fois AVEC le paysage réel sous les yeux.
   */
  const occupantNom = processus?.name ?? socket?.processName ?? 'service inconnu';
  logger.warn(
    `Registre des ports : le port ${portActuel} réservé pour « ${target.name ?? targetKeyOf(target)} » `
    + `est détenu par « ${occupantNom} ». Réattribution avant configuration du serveur web.`,
  );
  if (courante) {
    await beginRelease(targetKeyOf(target)).catch(() => null);
    await releasePort(targetKeyOf(target), {
      verifiedFree: true,
      reason: `port détenu par « ${occupantNom} » — réattribution`,
    });
  }
  const neuve = await reservePort({ target, transport, landscape: paysage });
  return {
    port: neuve.port,
    moved: neuve.port !== portActuel,
    from: portActuel,
    reason: `DETENU_PAR_AUTRUI:${occupantNom}`,
  };
}

export async function verifyBeforeStart({ target, transport, expectedPm2Name }) {
  const serverKey = serverKeyOf(target);
  const reservation = await reservationFor(targetKeyOf(target));
  if (!reservation) {
    throw ApiError.conflict(
      `Aucune réservation de port vivante pour « ${target.name ?? target.host} » : `
      + 'le déploiement ne peut pas démarrer un service sans port attribué.',
      { code: PORT_ERRORS.PORT_RESERVATION_CONFLICT },
    );
  }
  const port = reservation.port;
  const landscape = await readPortLandscape(transport);
  const at = nowIso();

  // Une AUTRE destination réserve-t-elle ce port sur ce serveur ?
  const concurrente = await PortReservation.findOne({
    serverKey,
    port,
    status: { $in: VIVANTES },
    deploymentTargetId: { $ne: targetKeyOf(target) },
  }).lean();
  if (concurrente) {
    await noteConflict(reservation, { at, kind: 'RESERVATION', other: concurrente.deploymentTargetId });
    throw ApiError.conflict(`Le port ${port} est réservé par une autre destination sur ${serverKey}.`,
      { code: PORT_ERRORS.PORT_RESERVATION_CONFLICT, port, otherTargetId: concurrente.deploymentTargetId });
  }

  const pm2Concurrent = landscape.processes.find((p) => p.port === port && p.name !== expectedPm2Name);
  if (pm2Concurrent) {
    await noteConflict(reservation, { at, kind: 'PM2', holder: pm2Concurrent.name, pid: pm2Concurrent.pid });
    throw ApiError.conflict(
      `Le port ${port} est déjà utilisé par le service PM2 « ${pm2Concurrent.name} » sur ${serverKey}. `
      + 'Ce service appartient probablement à une destination retirée sans avoir été vidée.',
      { code: PORT_ERRORS.PM2_PORT_COLLISION, port, holder: pm2Concurrent.name, pid: pm2Concurrent.pid },
    );
  }

  const socket = landscape.sockets.find((s) => s.port === port);
  if (socket) {
    const notre = landscape.processes.find((p) => p.name === expectedPm2Name);
    const aNous = notre && notre.pid !== null && socket.pid === notre.pid;
    if (!aNous) {
      await noteConflict(reservation, { at, kind: 'UNKNOWN', holder: socket.process, pid: socket.pid });
      throw ApiError.conflict(`Le port ${port} est détenu sur ${serverKey} par un programme inconnu du registre `
        + `(${socket.process ?? 'processus inconnu'}${socket.pid ? `, pid ${socket.pid}` : ''}). `
        + 'Le déploiement s’arrête : disputer un port à un service légitime est pire que de ne pas déployer.',
        { code: PORT_ERRORS.PORT_IN_USE_UNKNOWN_PROCESS, port, holder: socket.process, pid: socket.pid });
    }
  }

  await PortReservation.updateOne(
    { _id: reservation._id },
    { $set: { lastVerifiedAt: at, lastConflict: null, updatedAt: at } },
  );
  return { port, free: !socket, heldByUs: Boolean(socket), landscape };
}

/** Enregistre le constat contradictoire, sans changer l'état de la réservation. */
async function noteConflict(reservation, conflict) {
  await PortReservation.updateOne(
    { _id: reservation._id },
    { $set: { lastConflict: conflict, lastVerifiedAt: conflict.at, updatedAt: conflict.at } },
  );
}

/**
 * ACTIVATION — étape 7. Uniquement après PREUVE que le bon PID détient le port.
 *
 * `RESERVED → ACTIVE` n'est pas une formalité : c'est la seule transition qui
 * affirme qu'un service tourne réellement derrière ce port. Un déploiement qui
 * échoue laisse la réservation en `RESERVED` — le port reste retenu, ce qui
 * est correct : la destination existe toujours.
 */
export async function activateReservation(targetId, { pid = null, processName = null } = {}) {
  const at = nowIso();
  const doc = await PortReservation.findOneAndUpdate(
    { deploymentTargetId: targetId, status: { $in: [RESERVATION_STATUS.RESERVED, RESERVATION_STATUS.ACTIVE] } },
    {
      $set: {
        status: RESERVATION_STATUS.ACTIVE,
        activatedAt: at,
        pid,
        processName,
        lastVerifiedAt: at,
        lastConflict: null,
        updatedAt: at,
      },
    },
    { new: true },
  );
  return describeReservation(doc ? doc.toObject() : null);
}

/* -------------------------------------------------------------------------- */
/*  LIBÉRATION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ENGAGE la libération — `RELEASING`. Le port reste RETENU.
 *
 * Entre l'arrêt d'un service et la constatation que le port est libre, il
 * existe un intervalle où le déclarer libre serait un mensonge. L'attribuer à
 * une autre destination pendant cet intervalle reproduirait exactement
 * l'incident d'origine.
 */
export async function beginRelease(targetId) {
  const at = nowIso();
  const doc = await PortReservation.findOneAndUpdate(
    { deploymentTargetId: targetId, status: { $in: VIVANTES } },
    { $set: { status: RESERVATION_STATUS.RELEASING, updatedAt: at } },
    { new: true },
  );
  return describeReservation(doc ? doc.toObject() : null);
}

/**
 * LIBÈRE le port — uniquement sur PREUVE qu'il n'est plus détenu.
 *
 * Sans preuve, la réservation reste `RELEASING` : le port n'est pas rendu à la
 * plage libre. C'est la règle « aucun recyclage tant que le serveur n'est pas
 * réellement vide », et c'est elle qui empêche la répétition de l'incident.
 *
 * @param {string} targetId
 * @param {object} args
 * @param {boolean} args.verifiedFree  le port a été constaté LIBRE sur le serveur
 * @returns {Promise<{released:boolean, reservation:object|null, reason?:string}>}
 */
export async function releasePort(targetId, { verifiedFree = false, reason = null } = {}) {
  const at = nowIso();
  const courante = await reservationFor(targetId);
  if (!courante) return { released: false, reservation: null, reason: 'aucune réservation vivante' };

  if (verifiedFree !== true) {
    const doc = await PortReservation.findOneAndUpdate(
      { _id: courante._id },
      {
        $set: {
          status: RESERVATION_STATUS.RELEASING,
          lastConflict: { at, kind: 'UNVERIFIED', reason: reason ?? 'libération non prouvée' },
          updatedAt: at,
        },
      },
      { new: true },
    );
    return {
      released: false,
      reservation: describeReservation(doc.toObject()),
      reason: 'le port n’a pas été constaté libre sur le serveur : il reste retenu.',
    };
  }

  const doc = await PortReservation.findOneAndUpdate(
    { _id: courante._id },
    {
      $set: {
        status: RESERVATION_STATUS.RELEASED,
        releasedAt: at,
        lastVerifiedAt: at,
        lastConflict: null,
        pid: null,
        updatedAt: at,
      },
    },
    { new: true },
  );
  return { released: true, reservation: describeReservation(doc.toObject()) };
}

/**
 * ANNULE une réservation qui n'aurait jamais dû exister — rollback.
 *
 * Utilisé quand la création d'une destination échoue APRÈS la réservation :
 * sans cela, un port resterait retenu par une fiche qui n'existe pas, et la
 * plage se viderait à chaque tentative ratée.
 */
export async function rollbackReservation(targetId, { reason = 'création annulée' } = {}) {
  const at = nowIso();
  const res = await PortReservation.findOneAndUpdate(
    { deploymentTargetId: targetId, status: RESERVATION_STATUS.RESERVED },
    {
      $set: {
        status: RESERVATION_STATUS.RELEASED,
        releasedAt: at,
        lastConflict: { at, kind: 'ROLLBACK', reason },
        updatedAt: at,
      },
    },
    { new: true },
  );
  return describeReservation(res ? res.toObject() : null);
}

/**
 * DÉPLACE une réservation vers un autre serveur — quand la destination change
 * de machine.
 *
 * Le port reste le même : le changer casserait la configuration Nginx et le
 * service PM2 s'ils avaient déjà été posés. En revanche la réservation cesse
 * d'être vérifiée : le nouveau serveur n'a jamais été consulté, et c'est la
 * vérification d'avant démarrage qui tranchera. Annoncer une vérification
 * qu'on n'a pas faite serait précisément la faute d'origine.
 */
export async function moveReservationToServer(targetId, serverKey) {
  const at = nowIso();
  const cle = String(serverKey).trim().toLowerCase();
  const courante = await reservationFor(targetId);
  if (!courante || courante.serverKey === cle) return describeReservation(courante);

  try {
    const doc = await PortReservation.findOneAndUpdate(
      { _id: courante._id },
      {
        $set: {
          serverKey: cle,
          lastVerifiedAt: null,
          lastConflict: { at, kind: 'SERVER_CHANGED', from: courante.serverKey, to: cle },
          updatedAt: at,
        },
      },
      { new: true },
    );
    return describeReservation(doc.toObject());
  } catch (err) {
    if (err?.code !== 11000) throw err;
    // Le port est déjà pris sur le nouveau serveur : on rend l'ancien et on
    // en réserve un neuf, plutôt que de laisser deux fiches se le disputer.
    await PortReservation.updateOne({ _id: courante._id }, {
      $set: {
        status: RESERVATION_STATUS.RELEASED, releasedAt: at,
        lastConflict: { at, kind: 'SERVER_CHANGED_CONFLICT', from: courante.serverKey, to: cle },
        updatedAt: at,
      },
    });
    const neuve = await reservePort({
      target: {
        targetId,
        sshHost: cle,
        environment: courante.environment,
        host: courante.host,
        projectIdentityId: courante.projectIdentityId,
      },
    });
    return neuve.reservation;
  }
}

/* -------------------------------------------------------------------------- */
/*  MIGRATION                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * REPRISE DES PORTS EXISTANTS — appelée au démarrage du backend.
 *
 * Chaque destination vivante qui porte déjà un `backendPort` reçoit une
 * réservation correspondante. On ne RÉATTRIBUE rien : le port en place est le
 * bon, puisqu'un service tourne peut-être derrière. Le registre se contente
 * d'enregistrer ce qui est.
 *
 * Une destination VIDÉE reçoit une réservation `RELEASING` et non `RELEASED` :
 * on n'a pas vérifié son serveur au démarrage, et déclarer un port libre sans
 * l'avoir constaté est exactement la faute d'origine.
 */
export async function migratePortRegistry() {
  await ensureIndexes();
  const DeploymentTarget = (await import('../../models/DeploymentTarget.model.js')).default;
  const cibles = await DeploymentTarget.find({
    lifecycleStatus: { $ne: 'DELETED' },
    backendPort: { $ne: null },
    sshHost: { $ne: null },
  }).lean();

  let crees = 0;
  let conflits = 0;
  const at = nowIso();

  for (const cible of cibles) {
    const existante = await PortReservation.findOne({
      deploymentTargetId: String(cible._id), status: { $in: VIVANTES },
    }).lean();
    if (existante) continue;

    const serverKey = String(cible.sshHost).trim().toLowerCase();
    const vide = cible.lifecycleStatus === 'EMPTY';
    try {
      await PortReservation.create({
        serverKey,
        port: cible.backendPort,
        deploymentTargetId: String(cible._id),
        projectIdentityId: cible.projectIdentityId ?? null,
        host: cible.host ?? null,
        environment: cible.environment,
        serviceType: 'backend',
        // Reprise : on n'a rien vérifié, donc rien n'est déclaré ACTIF.
        status: vide ? RESERVATION_STATUS.RELEASING : RESERVATION_STATUS.RESERVED,
        reservedAt: cible.createdAt?.toISOString?.() ?? at,
        lastVerifiedAt: null,
        createdAt: at,
        updatedAt: at,
      });
      crees += 1;
    } catch (err) {
      if (err?.code === 11000) {
        // Deux destinations portent le même port sur le même serveur : c'est
        // EXACTEMENT l'incident. On ne tranche pas à leur place — on le
        // signale, bruyamment, et la vérification d'avant démarrage bloquera.
        conflits += 1;
        logger.warn(`Registre des ports : le port ${cible.backendPort} de « ${cible.host} » `
          + `est déjà réservé sur ${serverKey} par une autre destination. `
          + 'Le prochain déploiement de l’une des deux sera REFUSÉ tant que le conflit dure.');
        continue;
      }
      throw err;
    }
  }

  return { reservationsCreated: crees, conflicts: conflits, targetsScanned: cibles.length };
}

export { ensureIndexes };

export default {
  RESERVATION_STATUS,
  ensureIndexes,
  serverKeyOf,
  liveReservations,
  reservedPorts,
  reservationFor,
  describeReservation,
  describeServerRegistry,
  moveReservationToServer,
  reservePort,
  verifyBeforeStart,
  activateReservation,
  beginRelease,
  releasePort,
  rollbackReservation,
  migratePortRegistry,
};
