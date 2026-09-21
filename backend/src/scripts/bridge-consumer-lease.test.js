/**
 * ══ UN SEUL CONSOMMATEUR À LA FOIS, ET CE N'EST PLUS UNE HYPOTHÈSE ══════════
 *
 * ── CE QUI TENAIT LIEU DE GARANTIE ─────────────────────────────────────────
 *
 * « Le tirage est mono-consommateur par construction : un projet est une
 * instance, son curseur est un singleton persisté. » C'était vrai de la
 * configuration, jamais du code. Rien n'empêchait deux runtimes du même projet
 * de partager la même base — et le magasin de consommation est un cache
 * MÉMOIRE par processus, sauvegardé en écrasant le document ENTIER.
 *
 * Deux runtimes, donc deux caches, et le dernier qui écrit gagne :
 *
 *     A tire 1..50, applique, sauvegarde curseur=50
 *     B (cache à 0) sauvegarde curseur=0     →  RÉGRESSION
 *     ou B à 100 écrase le curseur RETENU de A  →  écritures SAUTÉES
 *
 * La seconde est exactement le mensonge que le lot précédent a fermé, revenu
 * par une autre porte.
 *
 * ── CE QU'ON PROUVE ICI, ET SUR QUOI ───────────────────────────────────────
 *
 * Sur une VRAIE base, avec DEUX magasins réellement indépendants — deux
 * instances de module, obtenues par une URL d'import distincte. C'est la seule
 * façon d'avoir deux caches mémoire séparés au-dessus d'une seule base, donc
 * de reproduire fidèlement deux processus.
 *
 *   A  deux runtimes simultanés     → 1 gagnant, 1 perdant, effet = 1
 *   B  le gagnant meurt             → le bail expire → reprise → convergence
 *   C  le propriétaire périmé rentre tard → il n'avance RIEN
 *   D  changement de génération     → l'ancien bail ne bloque pas
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'consumer_lease_test';
process.env.DB_PROD = 'consumer_lease_prod';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
/** Bail très court : la recette doit pouvoir le laisser EXPIRER pour de vrai. */
process.env.BRIDGE_CONSUMER_LEASE_TTL_MS = '600';
process.env.BRIDGE_MAX_APPLY_ATTEMPTS = '3';

let pass = 0;
let fail = 0;
const check = (nom, condition, extra = '') => {
  if (condition) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (titre) => console.log(`\n${titre}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { createMongoSyncStateAdapter } = await import(
  '../services/panelBridge/persistence/mongoSyncStateAdapter.js'
);
const { BridgeSyncState } = await import('../models/BridgeSyncState.model.js');

/**
 * ══ DEUX RUNTIMES, POUR DE VRAI ═════════════════════════════════════════════
 *
 * Une URL d'import distincte donne une INSTANCE DE MODULE distincte : deux
 * `let etat` séparés, deux identités de processus, une seule base. C'est
 * exactement la topologie qu'on veut éprouver, et elle ne se simule pas avec
 * un objet factice — le cache mémoire du magasin EST le sujet.
 */
const runtimeA = await import('../services/panelBridge/consumptionStore.js?runtime=A');
const runtimeB = await import('../services/panelBridge/consumptionStore.js?runtime=B');

runtimeA.configureConsumptionPersistence(createMongoSyncStateAdapter());
runtimeB.configureConsumptionPersistence(createMongoSyncStateAdapter());

/**
 * L'INDEX D'UNICITÉ EST LA GARANTIE, ET ON LE POSE AVANT DE L'ÉPROUVER.
 *
 * Mesuré sur une base neuve : sans lui, deux réclamations concurrentes créent
 * DEUX documents `SINGLETON` et les deux runtimes se croient propriétaires.
 * L'exclusion serait alors purement décorative — c'est pour cela que le
 * magasin le pose lui-même à l'hydratation, et qu'on le relit ici.
 */
await BridgeSyncState.createIndexes();

const PROJET = 'projet-deux-runtimes';
const GEN = 'g1';

const versCurseur = (n) => Buffer.from(String(n), 'utf8').toString('base64url');
const lireBase = () => BridgeSyncState.findOne({ key: 'SINGLETON' }).lean();

/* ══════════════════════════════════════════════════════════════════════════ */
section('0. DEUX RUNTIMES, DEUX IDENTITÉS, UNE SEULE BASE');
{
  check('les deux magasins sont des instances DISTINCTES',
    runtimeA !== runtimeB);
  check('…avec deux identités de processus différentes',
    runtimeA.PROCESS_IDENTITY !== runtimeB.PROCESS_IDENTITY,
    `${runtimeA.PROCESS_IDENTITY} vs ${runtimeB.PROCESS_IDENTITY}`);
  check('…et l’identité porte hôte, pid ET nonce de démarrage',
    /^[^:]+:\d+:[0-9a-f]{12}$/.test(runtimeA.PROCESS_IDENTITY));
  check(`le bail est configurable (ici ${runtimeA.CONSUMER_LEASE_TTL_MS} ms)`,
    runtimeA.CONSUMER_LEASE_TTL_MS === 600);
  const index = await BridgeSyncState.collection.indexes();
  check('l’index d’unicité EXISTE en base — sans lui, le bail n’exclut rien',
    index.some((i) => i.unique === true && i.key?.key === 1),
    index.map((i) => i.name).join(', '));
  check('le renouvellement est plus court que le bail — sinon il arrive après sa mort',
    runtimeA.LEASE_RENEW_INTERVAL_MS < runtimeA.CONSUMER_LEASE_TTL_MS,
    `${runtimeA.LEASE_RENEW_INTERVAL_MS} / ${runtimeA.CONSUMER_LEASE_TTL_MS}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('A. DEUX RUNTIMES SIMULTANÉS — un gagne, un perd');
{
  await runtimeA.hydrateConsumption({ projectId: PROJET, generation: GEN });
  await runtimeB.hydrateConsumption({ projectId: PROJET, generation: GEN });

  /** Les deux réclament ENSEMBLE. C'est Mongo qui arbitre, pas nous. */
  const [a, b] = await Promise.all([
    runtimeA.claimConsumerLease({ projectId: PROJET, generation: GEN }),
    runtimeB.claimConsumerLease({ projectId: PROJET, generation: GEN }),
  ]);

  const gagnants = [a, b].filter((r) => r.granted);
  check('exactement UN bail accordé', gagnants.length === 1,
    `A=${a.granted} B=${b.granted}`);
  check('…et le perdant sait qu’il a perdu',
    [a, b].filter((r) => !r.granted).length === 1);

  const doc = await lireBase();
  const proprietaire = doc.leaseOwner;
  check('la base ne porte QU’UN propriétaire',
    proprietaire === runtimeA.PROCESS_IDENTITY || proprietaire === runtimeB.PROCESS_IDENTITY);
  check('…avec un début et une échéance', Boolean(doc.leaseStartedAt) && Boolean(doc.leaseExpiresAt));
  check('…et une échéance dans le futur', new Date(doc.leaseExpiresAt).getTime() > Date.now());

  const gagnant = proprietaire === runtimeA.PROCESS_IDENTITY ? runtimeA : runtimeB;
  const perdant = gagnant === runtimeA ? runtimeB : runtimeA;

  check('le gagnant se reconnaît propriétaire', gagnant.holdsConsumerLease() === true);
  check('le perdant NE se croit PAS propriétaire', perdant.holdsConsumerLease() === false);

  /** LE PERDANT NE TOUCHE À RIEN — c'est tout l'objet du bail. */
  const avant = await lireBase();
  const refuse = await perdant.recordCursor(versCurseur(999));
  check('le perdant ne peut PAS avancer le curseur', refuse.written === false,
    JSON.stringify(refuse));
  const apres = await lireBase();
  check('…et la base n’a pas bougé', (apres.pullCursor ?? null) === (avant.pullCursor ?? null));

  const echec = await perdant.recordApplyFailure('w-perdant');
  check('le perdant ne peut PAS écrire de compteur d’échec', echec.written === false);
  check('…rien en base', Object.keys((await lireBase()).applyFailures ?? {}).length === 0);

  const garee = await perdant.deadLetterChange({
    writeId: 'w-perdant', entityType: 'DIAGNOSTIC', entityId: 'x', reason: 'test',
  });
  check('le perdant ne peut PAS garer une écriture', garee.written === false);
  check('…aucune lettre morte en base', ((await lireBase()).deadLetters ?? []).length === 0);

  /** LE GAGNANT, LUI, TRAVAILLE NORMALEMENT. */
  const ok = await gagnant.recordCursor(versCurseur(10));
  check('le gagnant avance le curseur', ok.written === true);
  check('…et la base le reflète', (await lireBase()).pullCursor === versCurseur(10));

  globalThis.__gagnant = gagnant === runtimeA ? 'A' : 'B';
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('B. LE GAGNANT MEURT — le bail expire, l’autre reprend');
{
  const gagnant = globalThis.__gagnant === 'A' ? runtimeA : runtimeB;
  const autre = gagnant === runtimeA ? runtimeB : runtimeA;

  /** On ne libère RIEN : c'est un `kill -9`, pas un arrêt propre. */
  const refuseAvant = await autre.claimConsumerLease({ projectId: PROJET, generation: GEN });
  check('tant que le bail court, l’autre est refusé', refuseAvant.granted === false);

  await dormir(runtimeA.CONSUMER_LEASE_TTL_MS + 150);

  const repris = await autre.claimConsumerLease({ projectId: PROJET, generation: GEN });
  check('bail expiré : l’autre runtime REPREND', repris.granted === true, JSON.stringify(repris));
  check('…et la base porte son identité',
    (await lireBase()).leaseOwner === autre.PROCESS_IDENTITY);
  check('le nouveau propriétaire peut avancer le curseur',
    (await autre.recordCursor(versCurseur(20))).written === true);
  check('…la reprise part du curseur RÉEL, pas de zéro',
    (await lireBase()).pullCursor === versCurseur(20));

  globalThis.__gagnant = autre === runtimeA ? 'A' : 'B';
  globalThis.__perime = gagnant === runtimeA ? 'A' : 'B';
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C. LE PROPRIÉTAIRE PÉRIMÉ RENTRE TARD — il n’acquitte RIEN');
{
  const perime = globalThis.__perime === 'A' ? runtimeA : runtimeB;
  const actuel = globalThis.__gagnant === 'A' ? runtimeA : runtimeB;

  /**
   * C'est le cas qui rend le bail obligatoire : A ralentit, son bail expire, B
   * reprend, et A finit son travail SANS SAVOIR qu'il n'est plus propriétaire.
   * S'il pouvait écrire, il effacerait le travail de B et acquitterait des
   * écritures que personne n'a appliquées.
   */
  check('le périmé se croit-il encore propriétaire ? NON',
    perime.holdsConsumerLease() === false);

  const avant = await lireBase();
  const tentative = await perime.recordCursor(versCurseur(5));
  check('un propriétaire périmé ne peut PAS avancer le curseur',
    tentative.written === false, JSON.stringify(tentative));
  check('…ni le faire RECULER', (await lireBase()).pullCursor === avant.pullCursor);

  check('…ni effacer un compteur d’échec',
    (await perime.clearApplyFailure('w1')).written === false);
  check('…ni marquer une écriture appliquée',
    (await perime.recordApplied('w-perime')).written === false);

  check('le propriétaire courant, lui, écrit toujours',
    (await actuel.recordCursor(versCurseur(30))).written === true);
  check('…et c’est bien sa valeur qui est en base',
    (await lireBase()).pullCursor === versCurseur(30));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('D. RENOUVELLEMENT — le propriétaire actif garde la main');
{
  const actuel = globalThis.__gagnant === 'A' ? runtimeA : runtimeB;
  const autre = actuel === runtimeA ? runtimeB : runtimeA;

  const avant = await lireBase();
  await dormir(200);
  const renouvele = await actuel.renewConsumerLease();
  check('le propriétaire renouvelle son bail', renouvele.renewed === true);
  const apres = await lireBase();
  check('…l’échéance est repoussée',
    new Date(apres.leaseExpiresAt).getTime() > new Date(avant.leaseExpiresAt).getTime());
  check('…le propriétaire est inchangé', apres.leaseOwner === avant.leaseOwner);

  const vol = await autre.renewConsumerLease();
  check('un NON-propriétaire ne peut pas renouveler', vol.renewed === false);
  check('…et n’a pas volé le bail', (await lireBase()).leaseOwner === avant.leaseOwner);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E. ARRÊT PROPRE — la lease est rendue, mais la sécurité n’en dépend pas');
{
  const actuel = globalThis.__gagnant === 'A' ? runtimeA : runtimeB;
  const autre = actuel === runtimeA ? runtimeB : runtimeA;

  const rendu = await actuel.releaseConsumerLease();
  check('le propriétaire rend son bail', rendu.released === true);
  check('…la base n’a plus de propriétaire', (await lireBase()).leaseOwner === null);

  const immediat = await autre.claimConsumerLease({ projectId: PROJET, generation: GEN });
  check('l’autre runtime peut reprendre IMMÉDIATEMENT — sans attendre le TTL',
    immediat.granted === true);

  /**
   * LA SÉCURITÉ NE DÉPEND PAS DE L'ARRÊT PROPRE. Un `kill -9` ne rend rien, et
   * c'est l'EXPIRATION qui débloque — éprouvée en §B. L'arrêt propre ne fait
   * qu'éviter d'attendre.
   */
  check('un non-propriétaire ne peut pas RENDRE le bail d’un autre',
    (await actuel.releaseConsumerLease()).released === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('F. CHANGEMENT DE GÉNÉRATION — l’ancien bail ne bloque pas');
{
  /** Le bail courant appartient à un runtime, sur la génération g1. */
  const doc = await lireBase();
  check('un bail est bien en cours', Boolean(doc.leaseOwner));

  /** Le projet est réappairé : nouvelle génération. */
  const r = await runtimeA.hydrateConsumption({ projectId: PROJET, generation: 'g2' });
  check('la génération a changé → le curseur repart de zéro',
    r.restored === false && r.reason === 'GENERATION_CHANGED');

  const neuf = await runtimeA.claimConsumerLease({ projectId: PROJET, generation: 'g2' });
  check('le bail de l’ANCIENNE génération ne bloque pas la nouvelle',
    neuf.granted === true, JSON.stringify(neuf));
  check('…et le nouveau bail porte la nouvelle génération',
    (await lireBase()).generation === 'g2');

  /** Un runtime resté sur l'ancienne génération ne peut plus rien. */
  const perime = await runtimeB.claimConsumerLease({ projectId: PROJET, generation: 'g1' });
  check('un runtime resté sur l’ancienne génération est REFUSÉ',
    perime.granted === false, JSON.stringify(perime));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('G. LE BAIL N’EST PAS LE CURSEUR — deux concepts, deux rôles');
{
  const doc = await lireBase();
  check('le document porte les DEUX, séparément',
    'leaseOwner' in doc && 'pullCursor' in doc);
  check('rendre le bail n’efface PAS le curseur — l’accusé survit au consommateur',
    doc.pullCursor !== undefined);

  const avant = (await lireBase()).pullCursor;
  await runtimeA.releaseConsumerLease();
  check('après libération, le curseur est intact', (await lireBase()).pullCursor === avant);
  check('…et plus personne ne peut avancer sans réclamer',
    (await runtimeB.recordCursor(versCurseur(77))).written === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('H. SEUL LE TITULAIRE DÉCRIT SA CONSOMMATION AU PANEL');
{
  /**
   * ══ L'INCIDENT QUE CETTE SECTION VERROUILLE ═══════════════════════════════
   *
   * Le Panel a expédié UN COURRIEL PAR MINUTE, pendant une demi-heure, pour
   * annoncer qu'un projet « consomme à nouveau les écritures ». Il n'était ni
   * tombé ni réparé trente fois.
   *
   * Deux runtimes du même projet battaient : le déployé, titulaire du bail, et
   * un poste de développement branché sur la même base, qui l'avait perdu. Le
   * second publiait pourtant son `consumption` — un curseur hydraté au
   * démarrage puis FIGÉ, puisqu'il n'a plus le droit de tirer. Le Panel y
   * lisait un retard de plusieurs heures un battement sur deux, et un retard
   * nul l'autre : DEGRADED, HEALTHY, DEGRADED, HEALTHY.
   *
   * La règle est donc : QUI NE CONSOMME PAS NE DÉCRIT PAS LA CONSOMMATION. Son
   * silence est lu `UNKNOWN` par le Panel, un verdict qui n'ouvre aucune alerte
   * et n'en referme aucune.
   */
  /* Les sections précédentes ont fait tourner la génération : on repart d'une
     génération neuve, hydratée des deux côtés, sinon les deux réclamations
     seraient refusées pour la bonne raison — et on n'éprouverait plus rien. */
  const GEN_H = 'g3';
  await runtimeA.releaseConsumerLease().catch(() => {});
  await runtimeB.releaseConsumerLease().catch(() => {});
  await runtimeA.hydrateConsumption({ projectId: PROJET, generation: GEN_H });
  await runtimeB.hydrateConsumption({ projectId: PROJET, generation: GEN_H });

  const a = await runtimeA.claimConsumerLease({ projectId: PROJET, generation: GEN_H });
  const b = await runtimeB.claimConsumerLease({ projectId: PROJET, generation: GEN_H });
  check('un seul des deux obtient le bail', a.granted !== b.granted,
    `A=${a.granted} B=${b.granted}`);

  const gagnant = a.granted ? runtimeA : runtimeB;
  const perdant = a.granted ? runtimeB : runtimeA;

  check('le TITULAIRE fait autorité sur la consommation',
    gagnant.consumptionIsAuthoritative() === true);
  check('…et le PERDANT ne fait PAS autorité — il se taira au battement',
    perdant.consumptionIsAuthoritative() === false);

  /**
   * LE BAIL EXPIRE, ET PERSONNE NE LE REPREND : le titulaire cesse lui aussi de
   * faire autorité. Un curseur qu'on n'a plus le droit d'avancer ne décrit plus
   * la consommation du projet, même quand c'est le nôtre qui l'a écrit.
   */
  await dormir(Number(process.env.BRIDGE_CONSUMER_LEASE_TTL_MS) + 150);
  check('un bail EXPIRÉ retire l’autorité à son ancien titulaire',
    gagnant.consumptionIsAuthoritative() === false);

  /**
   * UN RUNTIME QUI N'A JAMAIS RÉCLAMÉ FAIT AUTORITÉ — c'est le cas
   * mono-processus, celui de la quasi-totalité du parc, et le seul
   * comportement qu'on ne veut surtout pas changer.
   */
  const seul = await import('../services/panelBridge/consumptionStore.js?runtime=SEUL');
  check('un runtime qui n’a JAMAIS réclamé fait autorité (mono-processus)',
    seul.consumptionIsAuthoritative() === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
