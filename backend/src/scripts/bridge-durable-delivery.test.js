/**
 * ══ UN CURSEUR QUI AVANCE EST UN ACCUSÉ — ET UN ACCUSÉ NE MENT PAS ══════════
 *
 * ── LE DÉFAUT QUE CETTE RECETTE VERROUILLE ─────────────────────────────────
 *
 * Le tirage appliquait une page, et écrivait le curseur À LA FIN, quoi qu'il
 * arrive. Une écriture dont l'applicateur échouait était comptée `skipped`, un
 * incident était journalisé — et le curseur passait par-dessus :
 *
 *     Panel émet W  →  projet tire W  →  applicateur ÉCHOUE
 *                   →  curseur avance  →  W ne sera JAMAIS relivrée
 *
 * Le commentaire d'origine le disait sans détour : « cette écriture ne sera PAS
 * relivrée par le Panel ». Or le Panel LIT ce curseur au battement et en déduit
 * le retard du projet. Un curseur qui saute une écriture non appliquée n'est
 * donc pas seulement une perte : c'est un **accusé mensonger**. Le Panel voyait
 * un retard nul, sa fiche restait verte, et le fait n'existait nulle part.
 *
 * ── CE QU'ON PROUVE ICI, ET SUR QUOI ───────────────────────────────────────
 *
 * Sur une VRAIE base (Mongo en mémoire), avec la VRAIE persistance : ce qui
 * doit survivre à un redémarrage est éprouvé en le faisant survivre, pas en le
 * supposant.
 *
 *   A  crash du Panel avant livraison     → le journal tient, le tirage rattrape
 *   B  crash du projet AVANT l'effet      → curseur retenu → retiré → appliqué
 *   C  crash du projet APRÈS l'effet      → effet = 1, accusé rendu
 *   D  réponse réseau perdue              → relivraison → effet = 1
 *   E  projet hors ligne                  → rien ne se perd, convergence au retour
 *   F  écriture toxique                   → garée après N, le flux repart
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'durable_delivery_test';
process.env.DB_PROD = 'durable_delivery_prod';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
/** Plafond court : la recette doit pouvoir l'ATTEINDRE sans dérouler dix cycles. */
process.env.BRIDGE_MAX_APPLY_ATTEMPTS = '3';

let pass = 0;
let fail = 0;
const check = (nom, condition, extra = '') => {
  if (condition) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const consommation = await import('../services/panelBridge/consumptionStore.js');
const { createMongoSyncStateAdapter } = await import(
  '../services/panelBridge/persistence/mongoSyncStateAdapter.js'
);
const { PanelBridge } = await import('../services/panelBridge/PanelBridge.js');
const { setPairing, clearPairing, configurePairingPersistence } = await import(
  '../services/panelBridge/pairingStore.js'
);
const { createMongoPairingAdapter } = await import(
  '../services/panelBridge/persistence/mongoPairingAdapter.js'
);
const { BridgeSyncState } = await import('../models/BridgeSyncState.model.js');
const { ACK_STATUS } = await import('../services/panelBridge/bridgeContract.js');

configurePairingPersistence(createMongoPairingAdapter());
consommation.configureConsumptionPersistence(createMongoSyncStateAdapter());

const PROJET = 'projet-recette-livraison';
await setPairing({
  panelUrl: 'https://panel.test',
  projectId: PROJET,
  panelName: 'Panel de recette',
  bridgeToken: 'jeton-de-pont-de-recette-0123456789',
  generation: 'g1',
});

/* ══════════════════════════════════════════════════════════════════════════
   LE PANEL, EN DOUBLE — un journal ordonné, un curseur opaque, rien de plus.
   ══════════════════════════════════════════════════════════════════════════ */
const journal = [];
let seq = 0;
/**
 * LES IDENTIFIANTS SONT DE VRAIS UUID — le contrat de pont l'exige, et une
 * recette qui s'en dispenserait éprouverait le rejet de forme, pas la
 * durabilité. On garde donc un nom lisible en regard, pour les assertions.
 */
const uuidDe = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const nomVersId = new Map();
const emettre = (entityType, nom, payload = {}) => {
  seq += 1;
  const writeId = uuidDe(1000 + seq);
  const entityId = nomVersId.get(nom) ?? uuidDe(seq);
  nomVersId.set(nom, entityId);
  journal.push({
    seq,
    change: {
      writeId,
      entityType,
      entityId,
      deleted: false,
      payload,
      modifiedAt: new Date(Date.now() + seq).toISOString(),
      emitter: 'PANEL',
    },
  });
  return writeId;
};
/** L'effet est compté par NOM lisible — l'applicateur traduit. */
const idVersNom = () => new Map([...nomVersId].map(([k, v]) => [v, k]));
const versSeq = (curseur) => (curseur
  ? Number(Buffer.from(String(curseur), 'base64url').toString('utf8'))
  : 0);
const versCurseur = (n) => Buffer.from(String(n), 'utf8').toString('base64url');

/** Ce que le Panel considère encore DÛ à ce projet — sa mesure du retard. */
const enAttente = (curseur) => journal.filter((e) => e.seq > versSeq(curseur)).length;

let horsLigne = false;
let livraisonsRecues = 0;

const fauxPanel = {
  async ping() { return { status: 'ok', service: 'panel-bridge-api', time: new Date().toISOString() }; },
  async bootstrap() { throw new Error('cette recette appaire directement.'); },
  async unpair() { return { unpaired: true }; },
  async heartbeat() { return { acknowledged: true, panelTime: new Date().toISOString() }; },
  async pushChanges({ changes = [] }) { return { results: changes.map((c) => ({ writeId: c.writeId, status: 'APPLIED' })) }; },
  async pullChanges({ cursor, limit = 100 }) {
    if (horsLigne) {
      const err = new Error('Panel injoignable');
      err.code = 'BRIDGE_PANEL_UNREACHABLE';
      throw err;
    }
    livraisonsRecues += 1;
    const depuis = versSeq(cursor);
    const page = journal.filter((e) => e.seq > depuis).slice(0, limit);
    const dernier = page.length ? page[page.length - 1].seq : depuis;
    return {
      changes: page.map((e) => e.change),
      cursor: versCurseur(dernier),
      hasMore: journal.some((e) => e.seq > dernier),
    };
  },
  async invokeCapability(code) { return { capability: code, outcome: 'SUCCEEDED', result: {} }; },
  async fetchWebhookVerificationSecret() { return { webhookSecret: 'whsec_recette' }; },
  async introspectFederatedPrincipal() { return { active: true, principal: {} }; },
  async listEmailTemplates() { return { templates: [] }; },
  async getEmailTemplate() { return { template: null }; },
  async previewEmailTemplate() { return { subject: '', html: '' }; },
  async emailTemplateReadiness() { return { ready: true, missing: [] }; },
  async sendEmailTemplateTest() { return { sent: true }; },
};

/* ══════════════════════════════════════════════════════════════════════════
   L'EFFET MÉTIER — réduit à ce qu'il a de prouvable : un COMPTE par entité.
   ══════════════════════════════════════════════════════════════════════════ */
const effets = new Map();
/** L'ÉTAT métier, écrit par identité — le modèle des vrais applicateurs. */
const etatMetier = new Map();
/** Écritures que l'applicateur doit refuser, et combien de fois encore. */
const aFaireEchouer = new Map();

/**
 * ══ L'APPLICATEUR EST IDEMPOTENT — COMME LES VRAIS, ET C'EST LE SUJET ═════
 *
 * Les applicateurs du projet écrivent par IDENTITÉ (`upsert` sur l'entityId) et
 * arbitrent par `modifiedAt` — dernier écrit gagne. Un modèle de recette qui
 * incrémenterait bêtement un compteur prouverait une chose fausse : que la
 * relivraison est interdite. Elle ne l'est pas ; elle est SANS EFFET.
 *
 * On compte donc deux choses distinctes, et c'est la seconde qui compte :
 *
 *   invocations   combien de fois le handler a tourné   — peut valoir 2
 *   effets        combien de fois l'ÉTAT a changé        — doit valoir 1
 */
const invocations = new Map();

const appliquer = async ({ change }) => {
  const restant = aFaireEchouer.get(change.writeId) ?? 0;
  if (restant > 0) {
    aFaireEchouer.set(change.writeId, restant - 1);
    const err = new Error('dépendance indisponible');
    err.code = 'DEPENDENCY_UNAVAILABLE';
    throw err;
  }
  const nom = idVersNom().get(change.entityId) ?? change.entityId;
  invocations.set(nom, (invocations.get(nom) ?? 0) + 1);
  /** Écriture PAR IDENTITÉ : la seconde application ne change rien. */
  const dejaVu = etatMetier.get(change.entityId);
  if (dejaVu && dejaVu.modifiedAt >= change.modifiedAt) return;
  etatMetier.set(change.entityId, { modifiedAt: change.modifiedAt });
  effets.set(nom, (effets.get(nom) ?? 0) + 1);
};

/** Un pont NEUF — c'est ainsi qu'on simule un redémarrage du PROJET. */
const redemarrerProjet = async () => {
  await consommation.hydrateConsumption({ projectId: PROJET, generation: 'g1' });
  const pont = new PanelBridge({ client: fauxPanel });
  pont.registerApplyHandler('DEV_COMPANY', appliquer);
  return pont;
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('0. LE CONTRAT DE DURABILITÉ');
{
  check(`le plafond de tentatives est configurable (ici ${consommation.MAX_APPLY_ATTEMPTS})`,
    consommation.MAX_APPLY_ATTEMPTS === 3);
  check('la lettre morte est bornée', consommation.DEAD_LETTER_MAX > 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('A. CRASH DU PANEL AVANT LIVRAISON — le journal tient, le tirage rattrape');
{
  emettre('DEV_COMPANY', 'e1');
  emettre('DEV_COMPANY', 'e2');

  /**
   * Le Panel n'a POUSSÉ personne : c'est exactement ce que laisse un processus
   * tué entre l'écriture au journal et la livraison immédiate. Le projet tire.
   */
  const pont = await redemarrerProjet();
  const r = await pont.pullUpdates();

  check('les deux écritures sont appliquées', r.applied === 2, `${r.applied}`);
  check('…sans qu’aucune poussée n’ait eu lieu', effets.get('e1') === 1 && effets.get('e2') === 1);
  check('le Panel ne doit plus rien à ce projet', enAttente(consommation.currentCursor()) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('B. CRASH DU PROJET AVANT L’EFFET — le curseur est RETENU');
{
  const w = emettre('DEV_COMPANY', 'e3');
  /** Deux échecs : moins que le plafond, donc l'écriture reste due. */
  aFaireEchouer.set(w, 2);

  const pont = await redemarrerProjet();
  const curseurAvant = consommation.currentCursor();
  const r1 = await pont.pullUpdates();

  check('l’application échoue', (effets.get('e3') ?? 0) === 0);
  check('LE CURSEUR NE BOUGE PAS', consommation.currentCursor() === curseurAvant,
    `${consommation.currentCursor()} vs ${curseurAvant}`);
  check('…et le tirage le DIT', r1.held === true);
  check('le Panel voit donc toujours une écriture due',
    enAttente(consommation.currentCursor()) === 1);
  check('la tentative est comptée, et DURABLEMENT', consommation.applyAttempts(w) === 1);

  /** Le curseur a survécu au redémarrage — c'est la persistance qu'on éprouve. */
  const persiste = await BridgeSyncState.findOne({ key: 'SINGLETON' }).lean();
  check('…le compteur est en base, pas en mémoire',
    (persiste?.applyFailures?.[w] ?? 0) === 1);

  /* Cycle suivant : encore un échec, puis le succès. */
  const pont2 = await redemarrerProjet();
  await pont2.pullUpdates();
  check('deuxième tentative : toujours retenu', enAttente(consommation.currentCursor()) === 1);
  check('…et le compteur monte', consommation.applyAttempts(w) === 2);

  const pont3 = await redemarrerProjet();
  const r3 = await pont3.pullUpdates();
  check('troisième tentative : APPLIQUÉE', (effets.get('e3') ?? 0) === 1, `${effets.get('e3')}`);
  check('…exactement une fois', effets.get('e3') === 1);
  check('…le curseur repart', enAttente(consommation.currentCursor()) === 0);
  check('…et les échecs sont oubliés', consommation.applyAttempts(w) === 0);
  check('le tirage ne signale plus de rétention', r3.held !== true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C. CRASH DU PROJET APRÈS L’EFFET, AVANT LE CURSEUR — effet = 1');
{
  const w = emettre('DEV_COMPANY', 'e4');
  const pont = await redemarrerProjet();

  /**
   * On applique l'effet À LA MAIN, puis on remet le curseur EN ARRIÈRE : c'est
   * l'état durable exact d'un processus tué entre l'application et l'écriture
   * du curseur.
   */
  /** On rejoue l'ÉCRITURE RÉELLE du journal : même `modifiedAt`, donc même arbitrage. */
  const ecriture = journal.find((e) => e.change.writeId === w).change;
  await appliquer({ change: ecriture });
  check('l’effet a bien eu lieu', effets.get('e4') === 1);
  const enArriere = versCurseur(versSeq(consommation.currentCursor()));
  await consommation.recordCursor(enArriere);

  const pont2 = await redemarrerProjet();
  void pont;
  await pont2.pullUpdates();

  check('le handler REPASSE — c’est normal, la relivraison est due',
    (invocations.get('e4') ?? 0) >= 1);
  check('…mais l’ÉTAT n’est écrit qu’une fois : la barrière finale est métier',
    effets.get('e4') === 1, `${effets.get('e4')}`);
  check('…et le curseur passe', enAttente(consommation.currentCursor()) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('D. RÉPONSE RÉSEAU PERDUE APRÈS L’EFFET — la relivraison ne double rien');
{
  const { acknowledgePanelChanges } = await import(
    '../services/projectBridge/projectBridge.service.js'
  );
  const { configureProjectBridge } = await import(
    '../services/projectBridge/projectBridge.service.js'
  );
  configureProjectBridge({ changeAppliers: { DEV_COMPANY: appliquer } });

  nomVersId.set('e5', uuidDe(555));
  const change = {
    writeId: uuidDe(9999),
    entityType: 'DEV_COMPANY',
    entityId: uuidDe(555),
    deleted: false,
    payload: {},
    modifiedAt: new Date().toISOString(),
    emitter: 'PANEL',
  };

  /** 1re livraison : le projet applique et rend un accusé… que le Panel ne voit jamais. */
  const premier = await acknowledgePanelChanges([change]);
  check('le projet applique et accuse APPLIED',
    premier.results[0].status === ACK_STATUS.APPLIED);
  check('…l’effet a eu lieu', effets.get('e5') === 1, `${effets.get('e5')}`);

  /** Le Panel n'a rien reçu : il relivre la MÊME écriture. */
  const second = await acknowledgePanelChanges([change]);
  check('la relivraison est reconnue comme DOUBLON',
    second.results[0].status === ACK_STATUS.DUPLICATE, second.results[0].status);
  check('…et l’effet reste à 1', effets.get('e5') === 1, `${effets.get('e5')}`);

  /**
   * ET APRÈS UN REDÉMARRAGE — c'est là que la mémoire ne suffisait plus.
   * `deliveredAcks` était une `Map` : un arrêt l'effaçait, et la relivraison
   * suivante RÉAPPLIQUAIT.
   */
  const { resetProjectBridgeForTests } = await import(
    '../services/projectBridge/projectBridge.service.js'
  );
  if (typeof resetProjectBridgeForTests === 'function') resetProjectBridgeForTests();
  configureProjectBridge({ changeAppliers: { DEV_COMPANY: appliquer } });
  await consommation.hydrateConsumption({ projectId: PROJET, generation: 'g1' });

  const apresRedemarrage = await acknowledgePanelChanges([change]);
  check('APRÈS REDÉMARRAGE, la relivraison reste un doublon',
    apresRedemarrage.results[0].status === ACK_STATUS.DUPLICATE,
    apresRedemarrage.results[0].status);
  check('…et l’effet reste à 1', effets.get('e5') === 1, `${effets.get('e5')}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E. PROJET HORS LIGNE — rien ne se perd, tout converge au retour');
{
  horsLigne = true;
  const w1 = emettre('DEV_COMPANY', 'e6');
  const w2 = emettre('DEV_COMPANY', 'e7');
  void w1; void w2;

  const pont = await redemarrerProjet();
  const r = await pont.pullUpdates();
  check('hors ligne : aucune écriture appliquée', r.applied === 0);
  check('…et le Panel sait qu’il doit encore deux écritures',
    enAttente(consommation.currentCursor()) === 2, `${enAttente(consommation.currentCursor())}`);
  check('…rien n’a été appliqué localement',
    (effets.get('e6') ?? 0) === 0 && (effets.get('e7') ?? 0) === 0);

  horsLigne = false;
  const pont2 = await redemarrerProjet();
  const r2 = await pont2.pullUpdates();
  check('au retour : les deux écritures arrivent', r2.applied === 2, `${r2.applied}`);
  check('…chacune une seule fois', effets.get('e6') === 1 && effets.get('e7') === 1);
  check('…et le retard est résorbé', enAttente(consommation.currentCursor()) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('F. ÉCRITURE TOXIQUE — garée après le plafond, le flux repart');
{
  const poison = emettre('DEV_COMPANY', 'e8');
  const suivante = emettre('DEV_COMPANY', 'e9');
  void suivante;
  /** Elle échouera TOUJOURS : c'est ce qui bloquerait le flux à vie. */
  aFaireEchouer.set(poison, 999);

  for (let i = 0; i < consommation.MAX_APPLY_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pont = await redemarrerProjet();
    // eslint-disable-next-line no-await-in-loop
    await pont.pullUpdates();
  }

  const garees = consommation.deadLetters();
  check(`après ${consommation.MAX_APPLY_ATTEMPTS} tentatives, l’écriture est GARÉE`,
    garees.some((d) => d.writeId === poison), JSON.stringify(garees.map((d) => d.writeId)));
  const garee = garees.find((d) => d.writeId === poison);
  check('…et la lettre morte DIT quoi, où et pourquoi',
    garee?.entityType === 'DEV_COMPANY' && garee?.entityId === nomVersId.get('e8')
    && /DEPENDENCY_UNAVAILABLE|indisponible/.test(garee?.reason ?? ''),
    JSON.stringify(garee));
  check('…avec le compte de tentatives', garee?.attempts === consommation.MAX_APPLY_ATTEMPTS,
    `${garee?.attempts}`);
  check('…et une date', typeof garee?.parkedAt === 'string');

  /** Le flux REPART : ce qui suivait la toxique est enfin appliqué. */
  const pont = await redemarrerProjet();
  await pont.pullUpdates();
  check('l’écriture SUIVANTE est appliquée — le flux n’est plus bloqué',
    effets.get('e9') === 1, `${effets.get('e9')}`);
  check('…et le poison n’a produit AUCUN effet', (effets.get('e8') ?? 0) === 0);
  check('le Panel ne voit plus de retard', enAttente(consommation.currentCursor()) === 0);

  /** La lettre morte SURVIT au redémarrage : un incident se relit. */
  await consommation.hydrateConsumption({ projectId: PROJET, generation: 'g1' });
  check('la lettre morte est DURABLE',
    consommation.deadLetters().some((d) => d.writeId === poison));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('G. LE CURSEUR EST UN ACCUSÉ — et le Panel le lit comme tel');
{
  /**
   * C'est l'invariant du lot, énoncé du point de vue du PANEL : tant que le
   * curseur n'a pas dépassé une écriture, le Panel la considère DUE. Cette
   * mesure est exactement `bridgeConsumption.measureBacklog` côté Panel.
   */
  const w = emettre('DEV_COMPANY', 'e10');
  aFaireEchouer.set(w, 2);

  const pont = await redemarrerProjet();
  await pont.pullUpdates();
  check('écriture non appliquée → le Panel la compte comme DUE',
    enAttente(consommation.currentCursor()) === 1);

  const pont2 = await redemarrerProjet();
  await pont2.pullUpdates();
  check('toujours pas appliquée → toujours due',
    enAttente(consommation.currentCursor()) === 1);

  const pont3 = await redemarrerProjet();
  await pont3.pullUpdates();
  check('appliquée → le Panel ne la compte plus',
    enAttente(consommation.currentCursor()) === 0 && effets.get('e10') === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('H. REJEU D’UNE LETTRE MORTE — après correction, le blocage se lève');
{
  /**
   * ══ LE SCÉNARIO QUI JUSTIFIE TOUT LE MÉCANISME ═══════════════════════════
   *
   * Une écriture est garée parce que l'applicateur était CASSÉ. Le code est
   * corrigé — et sans rejeu, l'écriture reste perdue à jamais : « seule une
   * nouvelle publication la ramènera ». Un opérateur n'avait aucun geste.
   *
   * Le rejeu republie le MÊME fait sous une NOUVELLE identité technique. Le
   * projet le consomme par le pipeline NORMAL — même tirage, mêmes
   * applicateurs, même idempotence — et résout lui-même sa lettre morte.
   */
  /**
   * ON MESURE UN DELTA, PAS UN ABSOLU. La section F a déjà garé une écriture,
   * et elle DOIT y rester — une lettre morte ne s'efface pas entre deux
   * sections. Compter en absolu ferait échouer la recette sur sa propre
   * mémoire.
   */
  const actifsAvant = consommation.activeDeadLetters().length;
  const poison = emettre('DEV_COMPANY', 'e-rejeu');
  aFaireEchouer.set(poison, 999); // l'applicateur est CASSÉ

  for (let i = 0; i < consommation.MAX_APPLY_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pont = await redemarrerProjet();
    // eslint-disable-next-line no-await-in-loop
    await pont.pullUpdates();
  }

  const gareeAvant = consommation.deadLetters().find((d) => d.writeId === poison);
  check('l’écriture est GARÉE', Boolean(gareeAvant), JSON.stringify(consommation.deadLetters()));
  check('…et son état est PARKED', gareeAvant?.status === 'PARKED');
  check('…elle compte comme UN blocage actif de plus',
    consommation.activeDeadLetters().length === actifsAvant + 1,
    `${consommation.activeDeadLetters().length} vs ${actifsAvant}`);
  check('…et le battement la déclare',
    consommation.describeConsumption().parkedChanges === actifsAvant + 1);
  check('…aucun effet métier n’a eu lieu', (effets.get('e-rejeu') ?? 0) === 0);

  /* ── LE CODE EST CORRIGÉ ────────────────────────────────────────────────── */
  aFaireEchouer.delete(poison);

  /**
   * ── LE REJEU, CÔTÉ PANEL ────────────────────────────────────────────────
   *
   * On republie le MÊME fait canonique sous une NOUVELLE séquence et un NOUVEAU
   * `writeId`. C'est exactement ce que fait `deadLetterReplay.service.js` :
   * relire l'écriture au journal, la réémettre à l'identique.
   */
  const origine = journal.find((e) => e.change.writeId === poison).change;
  seq += 1;
  const nouveauWriteId = uuidDe(7000 + seq);
  journal.push({ seq, change: { ...origine, writeId: nouveauWriteId } });
  check('la republication porte une NOUVELLE identité technique',
    nouveauWriteId !== poison);
  check('…mais le MÊME fait métier',
    journal.at(-1).change.entityId === origine.entityId
    && journal.at(-1).change.entityType === origine.entityType
    && journal.at(-1).change.modifiedAt === origine.modifiedAt);

  const pont = await redemarrerProjet();
  const r = await pont.pullUpdates();

  check('le projet applique la republication par le pipeline NORMAL', r.applied === 1,
    `${r.applied}`);
  check('…l’effet métier a enfin lieu, UNE fois', effets.get('e-rejeu') === 1,
    `${effets.get('e-rejeu')}`);
  check('…le curseur passe', enAttente(consommation.currentCursor()) === 0);

  const gareeApres = consommation.deadLetters().find((d) => d.writeId === poison);
  check('LA LETTRE MORTE EST RÉSOLUE', gareeApres?.status === 'RESOLVED',
    JSON.stringify(gareeApres));
  check('…datée', typeof gareeApres?.resolvedAt === 'string');
  check('…et elle nomme la republication qui l’a débloquée',
    gareeApres?.resolvedByWriteId === nouveauWriteId);

  check('L’HISTORIQUE N’EST PAS EFFACÉ — la lettre morte reste visible',
    consommation.deadLetters().some((d) => d.writeId === poison));
  check('…mais elle ne compte PLUS comme blocage actif',
    consommation.activeDeadLetters().length === actifsAvant,
    `${consommation.activeDeadLetters().length} vs ${actifsAvant}`);
  check('…et le battement revient au compte d’avant',
    consommation.describeConsumption().parkedChanges === actifsAvant);
  check('…tandis que l’HISTORIQUE, lui, a grandi',
    consommation.deadLetters().length > consommation.activeDeadLetters().length);

  /** La résolution SURVIT au redémarrage : un incident se relit. */
  await consommation.hydrateConsumption({ projectId: PROJET, generation: 'g1' });
  const apresRedemarrage = consommation.deadLetters().find((d) => d.writeId === poison);
  check('la résolution est DURABLE', apresRedemarrage?.status === 'RESOLVED');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('I. REJEU QUI ÉCHOUE ENCORE — rien n’est faussement résolu');
{
  const poison = emettre('DEV_COMPANY', 'e-rejeu-rate');
  aFaireEchouer.set(poison, 999);

  for (let i = 0; i < consommation.MAX_APPLY_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pont = await redemarrerProjet();
    // eslint-disable-next-line no-await-in-loop
    await pont.pullUpdates();
  }
  check('garée une première fois',
    consommation.deadLetters().some((d) => d.writeId === poison && d.status === 'PARKED'));

  /** Le rejeu part, mais le défaut n'était pas corrigé. */
  const origine = journal.find((e) => e.change.writeId === poison).change;
  seq += 1;
  const rejeu = uuidDe(8000 + seq);
  journal.push({ seq, change: { ...origine, writeId: rejeu } });
  aFaireEchouer.set(rejeu, 999);

  for (let i = 0; i < consommation.MAX_APPLY_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const pont = await redemarrerProjet();
    // eslint-disable-next-line no-await-in-loop
    await pont.pullUpdates();
  }

  const originale = consommation.deadLetters().find((d) => d.writeId === poison);
  check('L’ANCIENNE LETTRE MORTE N’EST PAS FAUSSEMENT RÉSOLUE',
    originale?.status === 'PARKED', JSON.stringify(originale));
  check('…et le rejeu s’est garé à son tour',
    consommation.deadLetters().some((d) => d.writeId === rejeu && d.status === 'PARKED'));
  check('…la causalité est lisible : deux garées pour la même entité',
    consommation.deadLetters().filter((d) => d.entityId === origine.entityId).length === 2);
  check('…aucun effet métier', (effets.get('e-rejeu-rate') ?? 0) === 0);
  check('…et AUCUNE boucle : le flux a repris malgré les deux',
    enAttente(consommation.currentCursor()) === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${pass} réussis, ${fail} échoués`);
await clearPairing();
await disconnectDatabase();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
