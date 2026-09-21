/* LE CURSEUR NE MENT PLUS — reproduction exacte de l'incident LEGAL_DOCUMENT.
 *
 * ══ L'INCIDENT, TEL QU'IL S'EST PRODUIT ═════════════════════════════════════
 *
 *   1. le Panel monte en 1.14.0 et publie un nouvel entityType ;
 *   2. ce projet tourne encore en 1.13.0 et ne le connaît pas ;
 *   3. il « saute » l'écriture — `skipped++ ; continue` ;
 *   4. SON CURSEUR AVANCE QUAND MÊME ;
 *   5. après redéploiement, l'écriture est réputée consommée : elle n'existe
 *      nulle part, et le Panel voit un retard nul ;
 *   6. il a fallu un `/resync` MANUEL pour republier les documents.
 *
 * Le curseur avait menti. C'est le seul mensonge que ce pont ne peut pas se
 * permettre : le Panel le LIT pour savoir ce que le projet a consommé.
 *
 * ══ CE QUE CETTE SUITE PROUVE ═══════════════════════════════════════════════
 *
 *   · un type INCONNU retient le curseur au lieu de le laisser passer ;
 *   · l'écriture reste donc dans le journal, et RIEN n'est perdu ;
 *   · après « mise à niveau » du consommateur, elle s'applique TOUTE SEULE, au
 *     cycle suivant, SANS republication et SANS `/resync` ;
 *   · un type déclaré NON APPLIQUÉ par le contrat est ignoré légitimement, et
 *     le curseur avance — sinon tout le parc se bloquerait sur `INVOICE` ;
 *   · une écriture incompatible placée AVANT une compatible retient les deux,
 *     et les deux passent après la mise à niveau — l'ordre est préservé ;
 *   · le blocage est DÉCLARÉ (type, motif, ancienneté) pour que le Panel cesse
 *     d'afficher « synchronisé ».
 *
 * Runner autonome, sans base : le pont est piloté avec un client de Panel
 * simulé et des adaptateurs en mémoire. C'est le CŒUR du pont qu'on éprouve,
 * pas Mongo. */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

process.env.ENV = 'TEST';

const { PanelBridge } = await import('../services/panelBridge/PanelBridge.js');
const { CONTRACT_VERSION } = await import('../services/panelBridge/bridgeContract.js');
const { setPairing, clearPairing } = await import('../services/panelBridge/pairingStore.js');
const store = await import('../services/panelBridge/consumptionStore.js');
const { PANEL_CLIENT_METHODS } = await import('../services/panelBridge/PanelClient.js');

/* -------------------------------------------------------------------------- */
/*  UN MAGASIN DE CONSOMMATION EN MÉMOIRE                                     */
/* -------------------------------------------------------------------------- */

/**
 * L'adaptateur de persistance est INJECTÉ — c'est la discipline du pont, et
 * elle rend cette suite possible sans base de données. On ne simule pas le
 * magasin : on lui donne un support mémoire, et tout son code s'exécute.
 */
function memoryAdapter() {
  let doc = null;
  return {
    load: async () => doc,
    save: async (etat) => { doc = JSON.parse(JSON.stringify(etat)); return { written: true }; },
    reset: () => { doc = null; },
  };
}

/* -------------------------------------------------------------------------- */
/*  UN PANEL SIMULÉ QUI SERT UN JOURNAL                                        */
/* -------------------------------------------------------------------------- */

const iso = () => new Date().toISOString();
let seqCounter = 0;

function ecriture(entityType, entityId, payload = { marqueur: entityType }) {
  seqCounter += 1;
  return {
    writeId: `00000000-0000-4000-8000-${String(seqCounter).padStart(12, '0')}`,
    entityType,
    entityId: `11111111-1111-4111-8111-${String(seqCounter).padStart(12, '0')}`,
    deleted: false,
    payload,
    modifiedAt: iso(),
    emitter: 'PANEL',
  };
}

/**
 * LE JOURNAL DU PANEL — servi À PARTIR du curseur, exactement comme le vrai.
 *
 * C'est le point crucial de cette suite : une écriture non acquittée reste
 * disponible. Un faux Panel qui « consommerait » ce qu'il sert ne pourrait rien
 * prouver, puisque c'est précisément la relivraison qu'on éprouve.
 */
function fakePanel(journal) {
  /**
   * L'INTERFACE EST HONORÉE EN ENTIER, pas approximée.
   *
   * Le pont refuse un client incomplet (« n'honore pas l'interface ») — et il a
   * raison : un double partiel laisserait passer un appel qui n'existe pas.
   * On pose donc TOUTES les méthodes du contrat, et on ne redéfinit que celles
   * que cette suite exerce réellement.
   */
  const inerte = Object.fromEntries(PANEL_CLIENT_METHODS.map((m) => [m, async () => ({})]));
  return {
    ...inerte,
    isPanelClient: true,
    pullCount: 0,
    async ping() { return { ok: true }; },
    async pair() { return {}; },
    async heartbeat() { return { ok: true }; },
    async pushChanges() { return { acks: [] }; },
    async pullChanges({ cursor, limit }) {
      this.pullCount += 1;
      const depuis = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0;
      const page = journal.slice(depuis, depuis + (limit ?? 50));
      const fin = depuis + page.length;
      return {
        changes: page,
        cursor: Buffer.from(String(fin), 'utf8').toString('base64url'),
        hasMore: fin < journal.length,
      };
    },
  };
}

async function nouveauPont({ journal, handlers }) {
  const adapter = memoryAdapter();
  store.configureConsumptionPersistence(adapter);
  await store.hydrateConsumption();
  await clearPairing();
  await setPairing({
    panelUrl: 'https://panel.test',
    projectId: '22222222-2222-4222-8222-222222222222',
    panelName: 'Panel de recette',
    bridgeToken: 'jeton-de-recette-suffisamment-long-0123456789',
  });
  const client = fakePanel(journal);
  const pont = new PanelBridge({ client, log: { info() {}, warn() {}, error() {} } });
  for (const [type, fn] of Object.entries(handlers)) pont.registerApplyHandler(type, fn);
  return { pont, client, adapter };
}

/* -------------------------------------------------------------------------- */

section('0. Le contrat est bien celui du durcissement');
check('contrat 1.15.0', CONTRACT_VERSION === '1.15.0');

section('1. INCONNU — le curseur est RETENU, rien n’est perdu');
let etat1;
{
  /**
   * LE CONSOMMATEUR « ANCIEN » : il ne connaît pas `LEGAL_DOCUMENT`, exactement
   * comme un projet resté en 1.13.0. On le simule en ne branchant AUCUN
   * applicateur pour ce type — ce qui est, à l'exécution, rigoureusement l'état
   * d'un runtime qui l'ignore.
   */
  const applique = [];
  const journal = [ecriture('LEGAL_DOCUMENT', 'doc-1')];
  etat1 = await nouveauPont({
    journal,
    handlers: { DIAGNOSTIC: async ({ change }) => { applique.push(change.entityType); } },
  });

  const r = await etat1.pont.pullUpdates();
  check('aucune écriture appliquée', applique.length === 0);
  check('le cycle signale une retenue', r.held === true);
  check('LE CURSEUR N’A PAS AVANCÉ', store.currentCursor() === null || store.currentCursor() === undefined);

  const bloc = store.blockingChange();
  check('le blocage est DÉCLARÉ', Boolean(bloc));
  check('… il nomme le type', bloc?.entityType === 'LEGAL_DOCUMENT');
  /**
   * DEUX MOTIFS BLOQUANTS, ET LE BON EST CELUI-CI.
   *
   *  EST désormais déclaré appliqué par ce contrat : un
   * runtime sans applicateur branché n'est donc pas « incompatible » mais MAL
   * CÂBLÉ. La nuance compte pour l'exploitant — l'un se répare en déployant la
   * bonne version, l'autre en corrigeant le bootstrap — et les deux retiennent
   * le curseur, ce qui est la propriété qu'on éprouve ici.
   */
  check('… il nomme un motif bloquant', ['INCOMPATIBLE', 'WIRING_MISSING'].includes(bloc?.reason));
  check('… et c’est WIRING_MISSING (le type est au contrat, l’applicateur manque)',
    bloc?.reason === 'WIRING_MISSING');
  check('… il porte le contrat local', bloc?.contractVersion === CONTRACT_VERSION);
  check('… il est daté', Boolean(bloc?.since) && Boolean(bloc?.lastSeenAt));

  const conso = store.describeConsumption();
  check('le battement transporte le blocage', conso.blocked?.entityType === 'LEGAL_DOCUMENT');

  /** Un second cycle ne perd rien non plus, et compte la tentative. */
  await etat1.pont.pullUpdates();
  check('un second cycle laisse toujours le curseur en place',
    store.currentCursor() === null || store.currentCursor() === undefined);
  check('… et l’ancienneté du blocage ne se réinitialise pas',
    store.blockingChange()?.since === bloc.since);
  check('… tandis que le nombre de tentatives monte',
    (store.blockingChange()?.attempts ?? 0) > (bloc.attempts ?? 0));
}

section('2. MISE À NIVEAU — l’écriture s’applique SEULE, sans /resync');
{
  /**
   * ══ LE CŒUR DE LA PREUVE ═════════════════════════════════════════════════
   *
   * On ne republie RIEN. On ne touche ni au journal, ni au curseur, ni à la
   * lettre morte. On branche simplement l'applicateur qui manquait — ce que
   * fait un redéploiement — et on relance un cycle ordinaire.
   */
  const applique = [];
  etat1.pont.registerApplyHandler('LEGAL_DOCUMENT', async ({ change }) => {
    applique.push(change.entityType);
  });

  await etat1.pont.pullUpdates();

  check('LE DOCUMENT EST APPLIQUÉ APRÈS MISE À NIVEAU', applique.length === 1);
  check('… c’est bien le document légal', applique[0] === 'LEGAL_DOCUMENT');
  check('… le curseur a enfin avancé', Boolean(store.currentCursor()));
  check('… le blocage est LEVÉ', store.blockingChange() === null);
  check('… AUCUNE republication n’a été nécessaire (journal inchangé)', seqCounter === 1);
  check('… et rien n’a été garé en lettre morte', store.deadLetters().length === 0);
}

section('2 bis. TYPE INCONNU DU CONTRAT — motif INCOMPATIBLE');
{
  /**
   * Le cas EXACT de l'incident : le Panel publie un type qu'aucune version de
   * ce contrat ne connaît. C'est ce que voyait un projet 1.13.0 recevant
   *  — et ce que verra le prochain projet en retard, quel que
   * soit le type que le Panel inventera ensuite.
   */
  const journal = [ecriture('UN_TYPE_QUE_PERSONNE_NE_CONNAIT', 'x-1')];
  const { pont } = await nouveauPont({ journal, handlers: { DIAGNOSTIC: async () => {} } });

  await pont.pullUpdates();
  check('le curseur est retenu',
    store.currentCursor() === null || store.currentCursor() === undefined);
  check('… le motif est INCOMPATIBLE', store.blockingChange()?.reason === 'INCOMPATIBLE');
  check('… et le type fautif est nommé',
    store.blockingChange()?.entityType === 'UN_TYPE_QUE_PERSONNE_NE_CONNAIT');
}

section('3. IGNORÉ PAR CONTRAT — le curseur avance légitimement');
{
  /**
   * `INVOICE` est DÉCLARÉ au contrat de ce projet et ABSENT de ses types
   * appliqués : son contrat l'autorise explicitement à l'ignorer. Le retenir
   * bloquerait tout le parc sur la première facture émise.
   */
  const applique = [];
  const journal = [ecriture('INVOICE', 'inv-1'), ecriture('DIAGNOSTIC', 'diag-1')];
  const { pont } = await nouveauPont({
    journal,
    handlers: { DIAGNOSTIC: async ({ change }) => { applique.push(change.entityType); } },
  });

  await pont.pullUpdates();
  check('l’écriture ignorée n’est pas appliquée', !applique.includes('INVOICE'));
  check('… mais celle qui suit l’est', applique.includes('DIAGNOSTIC'));
  check('LE CURSEUR A AVANCÉ', Boolean(store.currentCursor()));
  check('… et rien n’est déclaré bloqué', store.blockingChange() === null);
}

section('4. ORDRE — A incompatible AVANT B compatible : les deux attendent');
{
  /**
   * ══ LE COMPORTEMENT CHOISI, ET POURQUOI ══════════════════════════════════
   *
   * Le journal est un flux ORDONNÉ par projet. Laisser passer B en sautant A
   * appliquerait des faits dans le désordre — et sur des entités liées, le
   * désordre produit un état que personne n'a jamais décidé.
   *
   * On RETIENT donc les deux. Le coût est borné : la seule cause est un runtime
   * en retard, la seule issue est de le déployer, et le Panel l'affiche.
   */
  const applique = [];
  const journal = [ecriture('LEGAL_DOCUMENT', 'A'), ecriture('DIAGNOSTIC', 'B')];
  const { pont } = await nouveauPont({
    journal,
    handlers: { DIAGNOSTIC: async ({ change }) => { applique.push(change.entityId); } },
  });

  await pont.pullUpdates();
  check('B n’est PAS appliqué tant que A bloque (ordre préservé)', applique.length === 0);
  check('… le blocage nomme A', store.blockingChange()?.entityType === 'LEGAL_DOCUMENT');
  check('… le curseur reste à zéro',
    store.currentCursor() === null || store.currentCursor() === undefined);

  pont.registerApplyHandler('LEGAL_DOCUMENT', async () => {});
  await pont.pullUpdates();
  check('après mise à niveau, A ET B passent', applique.length === 1);
  check('… le curseur a avancé', Boolean(store.currentCursor()));
  check('… le blocage est levé', store.blockingChange() === null);
}

section('5. ÉCHEC TEMPORAIRE — l’écriture n’est pas perdue');
{
  /**
   * Une base momentanément indisponible n'est pas une incompatibilité : elle se
   * répare seule. Le curseur ne doit pas la dépasser, et le cycle suivant doit
   * réussir sans intervention.
   */
  let echouer = true;
  const applique = [];
  const journal = [ecriture('DIAGNOSTIC', 'flaky')];
  const { pont } = await nouveauPont({
    journal,
    handlers: {
      DIAGNOSTIC: async ({ change }) => {
        if (echouer) throw new Error('base momentanément indisponible');
        applique.push(change.entityId);
      },
    },
  });

  await pont.pullUpdates();
  check('l’échec retient le curseur',
    store.currentCursor() === null || store.currentCursor() === undefined);
  check('… rien n’est appliqué', applique.length === 0);

  echouer = false;
  await pont.pullUpdates();
  check('le cycle suivant applique l’écriture', applique.length === 1);
  check('… et le curseur avance enfin', Boolean(store.currentCursor()));
}

section('6. IDEMPOTENCE — une relivraison n’applique pas deux fois');
{
  const applique = [];
  const journal = [ecriture('DIAGNOSTIC', 'once')];
  const { pont } = await nouveauPont({
    journal,
    handlers: { DIAGNOSTIC: async ({ change }) => { applique.push(change.writeId); } },
  });

  await pont.pullUpdates();
  const curseurApres = store.currentCursor();
  await pont.pullUpdates();

  check('appliquée une seule fois', applique.length === 1);
  check('le curseur ne régresse pas', store.currentCursor() === curseurApres);
}

await clearPairing();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
