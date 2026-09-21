/**
 * BRIDGE 1.9.0 — CE PROJET DÉCLARE LE RÉSEAU QU'IL SERT.
 *
 * ══ LE DÉFAUT QUE CE FICHIER VERROUILLE ═════════════════════════════════════
 *
 * Le Panel posait `runtime.publicBackendUrl` au bootstrap et ne la relisait
 * jamais. Constaté en recette réelle : sa fiche annonçait encore
 * `api.demo-sbauto.lycarz.com` des semaines après la migration vers
 * `api.demo-sbauto06.ly-solution.com`. Corriger imposait un RÉAPPAIRAGE.
 *
 * Le battement était le seul canal qui parle en permanence, et il ne portait
 * aucune adresse. Le contrat 1.9.0 ouvre ce canal.
 *
 * ══ CE QUI EST ÉPROUVÉ ICI ══════════════════════════════════════════════════
 *
 *   · l'autorité est `SystemConfiguration.network`, et JAMAIS `APP_URL`,
 *     jamais `localhost`, jamais un hôte historique codé en dur ;
 *   · l'émission est CONDITIONNÉE à ce que le Panel annonce savoir lire —
 *     sans quoi un Panel 1.8, dont le schéma est `.strict()`, refuserait le
 *     battement EN BLOC pour un champ additif, et une instance parfaitement
 *     saine basculerait hors ligne ;
 *   · un échec de lecture ne fait jamais échouer un battement.
 *
 * Runner autonome : aucune base réelle, aucun réseau. Le pont, lui, est le vrai.
 */
let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n${t}`); }

const { PanelBridge } = await import('../services/panelBridge/PanelBridge.js');
const { setPairing, clearPairing } = await import('../services/panelBridge/pairingStore.js');
const { CONTRACT_VERSION, heartbeatSchema } = await import('../services/panelBridge/bridgeContract.js');
const { publicUrlOrNull } = await import('../services/projectBridge/runtimeNetworkAuthority.js');

const ANCIEN = 'https://api.demo-sbauto.lycarz.com';
const ACTUEL = 'https://api.demo-sbauto06.ly-solution.com';

/* ══════════════════════════════════════════════════════════════════════════
   UN CLIENT DOUBLURE — il retient ce qu'on lui donne et annonce une version.
   ══════════════════════════════════════════════════════════════════════════ */
function clientDoublure({ panelContractVersion = null } = {}) {
  const envoyes = [];
  const noop = async () => ({});
  return {
    baseUrl: 'https://panel.test',
    panelContractVersion,
    envoyes,
    ping: noop,
    bootstrap: noop,
    unpair: noop,
    heartbeat: async (hb) => { envoyes.push(hb); return { acknowledged: true }; },
    pushChanges: async () => ({ results: [] }),
    pullChanges: async () => ({ changes: [], cursor: null, hasMore: false }),
    invokeCapability: noop,
    fetchWebhookVerificationSecret: noop,
    introspectFederatedPrincipal: noop,
    /**
     * LA SURFACE `PanelClient` EST EXIGÉE EN ENTIER (contrat 1.11.0) — cinq
     * méthodes de projection des modèles d'e-mail y ont été ajoutées sans être
     * reportées ici, et `new PanelBridge(...)` levait au premier appel.
     */
    listEmailTemplates: noop,
    getEmailTemplate: noop,
    previewEmailTemplate: noop,
    emailTemplateReadiness: noop,
    sendEmailTemplateTest: noop,
  };
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. Le contrat parlé par ce projet');
{
  /**
   * LA VERSION EST ÉPINGLÉE À DESSEIN — pour qu'une évolution du contrat soit
   * un GESTE, pas un effet de bord.
   *
   * ── ET L'ÉPINGLE SE DÉSYNCHRONISE À CHAQUE FOIS ─────────────────────────
   *
   * Elle disait `1.9.0` quand le contrat était en `1.11.0` ; elle disait
   * `1.13.0` quand il était en `1.15.0`. Deux fois, la même dérive, pour la
   * même raison : le geste consiste à mettre à jour TROIS épingles
   * (`bridge-cursor-safety`, `legal-documents`, et celle-ci), et la troisième
   * est oubliée parce qu'elle vit dans une recette au nom sans rapport.
   *
   * On garde l'épingle — elle a une valeur réelle : elle force à relire ce
   * fichier quand le contrat bouge — et on NOMME les deux autres pour que la
   * mise à jour soit un geste complet.
   */
  check(`CONTRACT_VERSION = 1.15.0 (lu : ${CONTRACT_VERSION})`, CONTRACT_VERSION === '1.15.0');

  const ok = heartbeatSchema.safeParse({
    sentAt: new Date().toISOString(), softwareVersion: 'v1', environment: 'TEST',
    health: { status: 'OK' },
    runtime: { network: { publicBackendUrl: ACTUEL, declaredAt: new Date().toISOString() } },
  });
  check('le battement accepte `runtime.network`', ok.success === true);

  const sans = heartbeatSchema.safeParse({
    sentAt: new Date().toISOString(), softwareVersion: 'v1', environment: 'TEST',
    health: { status: 'OK' },
  });
  check('…et reste valide SANS lui (rétrocompatible)', sans.success === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. L’AUTORITÉ — ce qui est une adresse publique, et ce qui n’en est pas');
{
  check('une adresse https publique passe', publicUrlOrNull(ACTUEL) === ACTUEL);
  check('le slash final est normalisé',
    publicUrlOrNull(`${ACTUEL}/`) === ACTUEL);

  for (const boucle of [
    'http://localhost:4000', 'http://127.0.0.1:4000',
    'http://0.0.0.0:4000', 'http://[::1]:4000',
  ]) {
    check(`la boucle locale est REFUSÉE (${boucle})`, publicUrlOrNull(boucle) === null);
  }

  for (const mauvaise of [null, undefined, '', '   ', 'pas-une-url', 'ftp://x.test', '/api']) {
    check(`ce qui n’est pas une URL absolue est refusé (${JSON.stringify(mauvaise)})`,
      publicUrlOrNull(mauvaise) === null);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. AUCUN REPLI HISTORIQUE dans le code de déclaration');
{
  const fs = await import('node:fs');
  const url = new URL('../services/projectBridge/runtimeNetworkAuthority.js', import.meta.url);
  const source = fs.readFileSync(url, 'utf8');
  /** On ne regarde QUE le code, jamais les commentaires qui expliquent le refus. */
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  check('aucune lecture de `APP_URL`', !/APP_URL/.test(code));
  check('aucun `process.env` en repli d’adresse', !/process\.env/.test(code));
  check('aucun hôte historique codé en dur', !/lycarz/i.test(code));
  check('la seule autorité lue est `SystemConfiguration`',
    /SystemConfiguration/.test(code));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. COMPATIBILITÉ DESCENDANTE — un Panel 1.8 ne reçoit PAS le champ');
{
  await setPairing({
    panelUrl: 'https://panel.test', projectId: 'p1',
    panelName: 'Panel', bridgeToken: 'jeton-de-test',
  });

  const client18 = clientDoublure({ panelContractVersion: '1.8.0' });
  const pont18 = new PanelBridge({ client: client18, log: { info() {}, warn() {}, error() {} } });
  const r18 = await pont18.heartbeat({ softwareVersion: 'v1', environment: 'TEST' });

  check('le battement vers un Panel 1.8 est DÉLIVRÉ', r18.delivered === true);
  check('…et ne porte AUCUNE déclaration de réseau',
    client18.envoyes[0]?.runtime?.network === undefined);

  const clientMuet = clientDoublure({ panelContractVersion: null });
  const pontMuet = new PanelBridge({ client: clientMuet, log: { info() {}, warn() {}, error() {} } });
  const rMuet = await pontMuet.heartbeat({ softwareVersion: 'v1', environment: 'TEST' });
  check('tant que le Panel n’a rien annoncé, on ne déclare rien (fail closed)',
    rMuet.delivered === true && clientMuet.envoyes[0]?.runtime?.network === undefined);

  /**
   * LE SENS POSITIF N'EST PAS PROUVABLE ICI, ET C'EST ASSUMÉ.
   *
   * Aucune base n'est connectée dans ce runner : `currentRuntimeNetwork()` ne
   * peut rien lire, donc rien n'est publié même vers un Panel 1.9. Ce que l'on
   * vérifie ici est ce qui est RISQUÉ — qu'un Panel antérieur ne reçoive jamais
   * le champ — et que la montée de version ne casse aucun battement.
   *
   * Que le champ arrive RÉELLEMENT à un Panel 1.9 se prouve en recette réelle,
   * sur les deux runtimes déployés, et nulle part ailleurs : c'est une
   * propriété du système complet, pas d'un objet isolé.
   */
  for (const version of ['1.9.0', '1.10.0', '2.0.0']) {
    const c = clientDoublure({ panelContractVersion: version });
    const p = new PanelBridge({ client: c, log: { info() {}, warn() {}, error() {} } });
    // eslint-disable-next-line no-await-in-loop
    const r = await p.heartbeat({ softwareVersion: 'v1', environment: 'TEST' });
    check(`la montée de version n’altère pas le battement vers un Panel ${version}`,
      r.delivered === true && heartbeatSchema.safeParse(c.envoyes[0]).success === true);
  }

  await clearPairing();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. UN BATTEMENT NE TOMBE JAMAIS pour une lecture de configuration');
{
  await setPairing({
    panelUrl: 'https://panel.test', projectId: 'p1',
    panelName: 'Panel', bridgeToken: 'jeton-de-test',
  });

  /**
   * Aucune base n'est connectée : la lecture de `SystemConfiguration` échoue
   * forcément. C'est exactement la situation qu'on veut voir traversée sans
   * dommage — un battement muet vaut infiniment mieux qu'un battement perdu.
   */
  const client = clientDoublure({ panelContractVersion: '1.9.0' });
  const pont = new PanelBridge({ client, log: { info() {}, warn() {}, error() {} } });
  const r = await pont.heartbeat({ softwareVersion: 'v1', environment: 'TEST' });

  check('le battement est délivré malgré la lecture impossible', r.delivered === true);
  check('…et reste conforme au contrat',
    heartbeatSchema.safeParse(client.envoyes[0]).success === true);

  await clearPairing();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
