/* LE CÂBLAGE TARDIF — reproduction exacte de l'incident « documents légaux ».
 *
 * ══ L'INCIDENT, TEL QU'IL S'EST PRODUIT ═════════════════════════════════════
 *
 *   1. le bootstrap importe `bridgeRuntime`, puis avance ;
 *   2. AVANT d'atteindre `configureBridgeRuntime`, un consommateur appelle
 *      `getPanelBridge()` — le rafraîchissement du contrat de variables e-mail
 *      est le premier de tous, et c'est la première ligne du journal de
 *      démarrage de ce projet ;
 *   3. l'instance est construite et MÉMORISÉE, avec une table d'applicateurs
 *      VIDE — `wireHandlers` n'a rien à poser, la configuration n'est pas
 *      encore venue ;
 *   4. `configureBridgeRuntime` arrive ensuite et remplit la variable de
 *      MODULE. L'instance vivante, elle, ne la relit jamais ;
 *   5. la livraison IMMÉDIATE continue de fonctionner (`changeAppliers`, une
 *      autre table) : aucun symptôme à l'appairage ;
 *   6. seul le RATTRAPAGE au tirage est mort — et en silence, jusqu'à la
 *      première écriture d'un type « déclaré mais non branché ». Celle-ci
 *      RETIENT le curseur sans jamais s'épuiser (`tentative 0/5`, par
 *      construction : le compteur n'existe que pour les échecs d'applicateur,
 *      pas pour son absence), et TOUT ce qui la suit cesse d'arriver.
 *
 * Sur le projet où il a été trouvé, c'est un `EMAIL_DELIVERY_EVENT` qui a
 * bloqué — et derrière lui les DOCUMENTS LÉGAUX, qui ne sont jamais arrivés sur
 * le site alors que le Panel les déclarait « publiés ».
 *
 * ══ CE QUE CETTE SUITE PROUVE ═══════════════════════════════════════════════
 *
 *   · une instance construite AVANT la configuration est recâblée par elle ;
 *   · une instance construite APRÈS l'est à sa naissance (non-régression) ;
 *   · une configuration qui ne parle PAS d'applicateurs ne débranche rien ;
 *   · le recâblage est idempotent — deux configurations successives ne posent
 *     pas deux fois le même handler.
 *
 * ══ POURQUOI ON N'ÉPROUVE PAS `pullUpdates` ICI ═════════════════════════════
 *
 * Parce que `bridge-cursor-safety` le fait déjà, et mieux : elle prouve qu'un
 * type sans applicateur retient le curseur. C'est précisément ce comportement
 * — correct — qui a transformé un défaut de câblage en panne totale. Ce qu'il
 * restait à prouver n'est pas la rétention, c'est que le câblage ARRIVE.
 *
 * Runner autonome, sans base : `bridgeRuntime` est piloté avec une fabrique de
 * client simulée et un appairage en mémoire.
 */

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

process.env.ENV = 'TEST';

const runtime = await import('../services/panelBridge/bridgeRuntime.js');
const { setPairing, clearPairing } = await import('../services/panelBridge/pairingStore.js');
const { PANEL_CLIENT_METHODS } = await import('../services/panelBridge/PanelClient.js');

/**
 * UN CLIENT DE PANEL INERTE, MAIS COMPLET.
 *
 * `PanelBridge` refuse un client qui n'honore pas l'interface — c'est une garde
 * du pont, pas une contrainte de test, et on la respecte plutôt que de la
 * contourner. Aucune de ces méthodes n'est appelée ici : cette suite éprouve le
 * CÂBLAGE, pas le trafic.
 */
const clientFactory = () => Object.fromEntries(
  PANEL_CLIENT_METHODS.map((m) => [m, async () => ({})]),
);

/** Les deux applicateurs dont on suit la trace. */
const applicateurA = async () => {};
const applicateurB = async () => {};

/** Repose un appairage propre et oublie l'instance mémorisée. */
function reinitialiser() {
  clearPairing();
  runtime.resetBridgeRuntimeForTests();
  setPairing({
    panelUrl: 'https://panel.exemple.test',
    bridgeToken: 'jeton-de-test',
    projectId: 'projet-de-test',
    panelName: 'Panel de test',
  });
  runtime.configureBridgeRuntime({
    identityProvider: async () => ({ projectKey: 'projet-de-test' }),
    clientFactory,
    applyHandlers: {},
  });
}

/* -------------------------------------------------------------------------- */

section('1. L\'instance construite AVANT la configuration est recâblée');
{
  reinitialiser();

  // (2) un consommateur réclame le pont AVANT que ses applicateurs ne soient
  // connus — exactement ce que fait le module e-mail au démarrage.
  const premiere = runtime.getPanelBridge();
  check('le pont est bien construit malgré l\'absence d\'applicateurs',
    Boolean(premiere));
  check('sa table d\'applicateurs est vide, comme au démarrage réel',
    premiere.applyHandlers.size === 0);

  // (4) la configuration arrive ensuite.
  runtime.configureBridgeRuntime({
    applyHandlers: { DEV_COMPANY: applicateurA, EMAIL_DELIVERY_EVENT: applicateurB },
  });

  const apres = runtime.getPanelBridge();
  check('c\'est TOUJOURS la même instance — rien n\'est reconstruit',
    apres === premiere);
  check('DEV_COMPANY est désormais branché',
    apres.applyHandlers.get('DEV_COMPANY') === applicateurA);
  check('EMAIL_DELIVERY_EVENT — celui qui bloquait — est branché',
    apres.applyHandlers.get('EMAIL_DELIVERY_EVENT') === applicateurB);
}

section('2. L\'instance construite APRÈS l\'est à sa naissance (non-régression)');
{
  reinitialiser();

  runtime.configureBridgeRuntime({
    applyHandlers: { DEV_COMPANY: applicateurA, EMAIL_DELIVERY_EVENT: applicateurB },
  });
  const pont = runtime.getPanelBridge();

  check('les deux applicateurs sont là dès la construction',
    pont.applyHandlers.get('DEV_COMPANY') === applicateurA
    && pont.applyHandlers.get('EMAIL_DELIVERY_EVENT') === applicateurB);
}

section('3. Une configuration sans applicateurs ne débranche RIEN');
{
  reinitialiser();
  runtime.configureBridgeRuntime({ applyHandlers: { DEV_COMPANY: applicateurA } });
  const pont = runtime.getPanelBridge();

  /**
   * Le bootstrap appelle `configureBridgeRuntime` plusieurs fois, et toutes ne
   * portent pas d'applicateurs. Une passe qui les effacerait recréerait
   * exactement la panne qu'on vient de fermer, par l'autre bout.
   */
  runtime.configureBridgeRuntime({ networkProvider: () => ({}) });

  check('l\'applicateur posé plus tôt est toujours branché',
    pont.applyHandlers.get('DEV_COMPANY') === applicateurA);
}

section('4. Le recâblage est idempotent');
{
  reinitialiser();
  const pont = runtime.getPanelBridge();

  runtime.configureBridgeRuntime({ applyHandlers: { DEV_COMPANY: applicateurA } });
  const apresUne = pont.applyHandlers.size;
  runtime.configureBridgeRuntime({ applyHandlers: { DEV_COMPANY: applicateurA } });

  check('deux configurations identiques ne posent qu\'un seul handler',
    pont.applyHandlers.size === apresUne && apresUne === 1);
}

section('5. Un type inconnu du contrat est refusé, sans faire tomber le câblage');
{
  reinitialiser();
  const pont = runtime.getPanelBridge();

  /**
   * `registerApplyHandler` lève sur un type hors contrat ; `wireHandlers`
   * l'attrape et journalise. Ce qui compte est que les types VALIDES de la
   * même table soient tout de même posés — sans quoi une faute de frappe dans
   * le bootstrap débrancherait tout ce qui la suit.
   */
  runtime.configureBridgeRuntime({
    applyHandlers: { TYPE_QUI_NEXISTE_PAS: applicateurA, DEV_COMPANY: applicateurB },
  });

  check('le type inconnu n\'est pas posé',
    !pont.applyHandlers.has('TYPE_QUI_NEXISTE_PAS'));
  check('le type valide de la même table l\'est',
    pont.applyHandlers.get('DEV_COMPANY') === applicateurB);
}

clearPairing();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
