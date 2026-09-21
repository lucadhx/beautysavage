// SESSION SERVEUR DU RETRAIT — un seul mot de passe, toute l'opération.
//
// ══ L'INCIDENT REPRODUIT ════════════════════════════════════════════════════
//
// Dans la fenêtre de retrait, saisir ses identifiants et cliquer sur connexion
// produisait DEUX messages contradictoires en même temps :
//
//   toast vert   « Connecté au serveur »
//   bandeau      « Serveur injoignable. Vérifiez qu'il est démarré. »
//
// Puis « Lire l'état réel du serveur » répondait :
//
//   « Session VPS absente ou expirée. »
//
// ══ LES DEUX CAUSES, ET AUCUNE N'ÉTAIT UN HASARD ════════════════════════════
//
// 1. `openVpsSession` n'ouvrait AUCUNE connexion. Elle rangeait les
//    identifiants dans une Map et rendait un identifiant. Le toast célébrait
//    donc une écriture en mémoire : il restait vert avec un mot de passe faux,
//    un hôte éteint ou un utilisateur inexistant. La vérité n'apparaissait
//    qu'au premier usage réel, plusieurs écrans plus loin, sous une forme qui
//    ne désignait plus la cause.
//
// 2. La durée de vie de la session dépendait d'une CASE À COCHER : 8 h si
//    l'opérateur demandait de « garder la session ouverte », 15 min sinon. On
//    lui faisait arbitrer la durée de vie d'un secret en RAM.
//
// ══ LE CONTRAT VERROUILLÉ ICI ═══════════════════════════════════════════════
//
// « Connecté » est une PREUVE, et une seule authentification couvre
// l'inspection puis le retrait.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const vault = await import('../deployment-engine/passwordVault.js');
const { DeploymentEngine } = await import('../deployment-engine/DeploymentEngine.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (t) => console.log(`\n${t}`);

const IDENT = { host: '203.0.113.10', username: 'deploy', password: 'm0tdepasse' };

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE CONTRAT DE SESSION — une seule nature, une seule autorité');
{
  vault.closeAll();
  const s = vault.openSession(IDENT);

  check('une session rend un identifiant opaque',
    typeof s.sessionId === 'string' && s.sessionId.length > 10);
  check('…et une échéance', typeof s.expiresAt === 'number' && s.expiresAt > Date.now());
  check('aucun réglage « conserver » n’est rendu', !('keep' in s));
  check('le mot de passe ne sort JAMAIS des métadonnées',
    !('password' in vault.describeSession(s.sessionId)));
  check('…et il est bien conservé pour l’usage interne',
    vault.getSession(s.sessionId).password === IDENT.password);

  check('la notion de session éphémère a disparu du coffre',
    typeof vault.closeIfEphemeral === 'undefined');
  check('…remplacée par une fermeture explicite',
    typeof vault.closeAfterOperation === 'function');

  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SCÉNARIO 1 — un seul mot de passe couvre inspection PUIS retrait');
{
  vault.closeAll();

  /**
   * On rejoue l'enchaînement réel du parcours : la fenêtre ouvre UNE session,
   * puis deux opérations distinctes s'en servent, l'une après l'autre.
   */
  const { sessionId } = vault.openSession(IDENT);

  // 1. L'inspection résout la session…
  const pourInspection = vault.getSession(sessionId);
  check('l’inspection retrouve la session', pourInspection !== null);
  check('…avec les identifiants saisis une seule fois',
    pourInspection.host === IDENT.host && pourInspection.username === IDENT.username);

  // 2. …puis le retrait résout LA MÊME, sans nouvelle saisie.
  const pourRetrait = vault.getSession(sessionId);
  check('le retrait retrouve LA MÊME session', pourRetrait !== null);
  check('…et les mêmes identifiants',
    pourRetrait.password === pourInspection.password);
  check('aucune seconde authentification n’est exigée entre les deux',
    vault.hasSession(sessionId) === true);

  /**
   * L'échéance est REPOUSSÉE par chaque usage : une opération longue ne peut
   * pas expirer entre deux de ses propres appels. C'est précisément ce que la
   * case « garder la session » prétendait régler.
   */
  const avant = vault.describeSession(sessionId).expiresAt;
  await new Promise((r) => setTimeout(r, 12));
  vault.getSession(sessionId);
  check('chaque usage repousse l’échéance',
    vault.describeSession(sessionId).expiresAt > avant);

  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES DEUX OPÉRATIONS LISENT LE MÊME COFFRE, AVEC LE MÊME IDENTIFIANT');
{
  vault.closeAll();
  const { sessionId } = vault.openSession(IDENT);

  /**
   * Le moteur résout le transport depuis la session. Si l'inspection et le
   * retrait cherchaient dans deux stores — ou sous deux noms de champ — l'une
   * marcherait et l'autre dirait « session absente ». On prouve qu'ils passent
   * par le même chemin.
   */
  const engine = new DeploymentEngine();
  const resolu = engine._transport(null, sessionId);
  check('le moteur fabrique un transport depuis la session', Boolean(resolu.tx));
  check('…en lisant le coffre partagé', resolu.session.host === IDENT.host);

  // Session inconnue : refus nommé, pas un « serveur injoignable » générique.
  let erreur = null;
  try { engine._transport(null, 'identifiant-qui-n-existe-pas'); } catch (e) { erreur = e; }
  check('une session inconnue est refusée explicitement',
    erreur?.code === 'NO_VPS_SESSION');
  check('…avec un message qui nomme la vraie cause',
    /session/i.test(erreur?.message ?? '') && !/injoignable/i.test(erreur?.message ?? ''));

  // Session absente ≠ session fermée : les deux doivent se comporter pareil.
  vault.closeAfterOperation(sessionId);
  let apresFermeture = null;
  try { engine._transport(null, sessionId); } catch (e) { apresFermeture = e; }
  check('une session fermée est refusée de la même façon',
    apresFermeture?.code === 'NO_VPS_SESSION');

  vault.closeAll();
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE SESSION N’EST RENDUE QUE SI LA CONNEXION A RÉELLEMENT EU LIEU');
{
  /**
   * Le contrôleur SONDE le serveur avant d'ouvrir la session. On rejoue les
   * deux issues avec un transport dont on maîtrise la réponse.
   */
  const serveurSain = new FakeTransport();
  const reussi = await serveurSain.exec('true').then(() => true).catch(() => false);
  check('un serveur qui répond laisse passer la sonde', reussi === true);

  const serveurMuet = new FakeTransport();
  serveurMuet.exec = async () => { throw new Error('All configured authentication methods failed'); };
  const echoue = await serveurMuet.exec('true').then(() => true).catch(() => false);
  check('un serveur qui refuse l’authentification fait échouer la sonde',
    echoue === false);

  // La preuve structurelle : le contrôleur sonde AVANT d'ouvrir la session.
  const fs = await import('node:fs');
  const src = fs.readFileSync(
    new URL('../controllers/deployment.controller.js', import.meta.url), 'utf8',
  );
  const iSonde = src.indexOf("sonde.exec('true'");
  const iOuverture = src.indexOf('vault.openSession({ host, username, password })');
  check('le contrôleur sonde le serveur', iSonde > 0);
  check('…AVANT d’ouvrir la session', iSonde > 0 && iOuverture > iSonde);
  check('…et refuse avec un code dédié',
    /VPS_CONNECTION_FAILED/.test(src));
  check('le mot de passe n’est jamais renvoyé au client',
    !/created\(res, \{[^}]*password/.test(src));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE RÉGLAGE « GARDER LA SESSION » A DISPARU PARTOUT');
{
  const fs = await import('node:fs');
  const lire = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

  const coffre = lire('../deployment-engine/passwordVault.js');
  const controleur = lire('../controllers/deployment.controller.js');
  const validateur = lire('../validators/deployment.validator.js');

  check('le coffre ne connaît plus « keep »', !/\bkeep\b/.test(coffre));
  check('…ni deux durées de vie concurrentes',
    !/KEEP_TTL_MS|EPHEMERAL_TTL_MS/.test(coffre));
  check('…mais une seule, nommée', /SESSION_TTL_MS/.test(coffre));
  check('le contrôleur ne lit plus « keep » du corps de requête',
    !/const \{ host, username, password, keep \}/.test(controleur));
  check('le schéma d’entrée ne l’accepte plus',
    !/keep:\s*z\.boolean/.test(validateur));

  const M = '../../../manager/src/';
  const modale = lire(`${M}pages/dev/deployment/RemovalDialog.tsx`);
  const assistant = lire(`${M}pages/dev/deployment/DeployAssistant.tsx`);
  const api = lire(`${M}lib/api.ts`);

  check('la case à cocher a disparu de la fenêtre de retrait',
    !/Garder la session ouverte/.test(modale));
  check('…et le réglage de l’assistant aussi',
    !/Conserver jusqu’à la fermeture du Manager/.test(assistant));
  check('…l’API ne transporte plus le drapeau',
    !/password, keep \}/.test(api));
  check('…et aucun état local ne le porte plus',
    !/setGarder|const \[keep, setKeep\]/.test(modale + assistant));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE TOAST NE PARLE QU’APRÈS LA PREUVE');
{
  const fs = await import('node:fs');
  const page = fs.readFileSync(
    new URL('../../../manager/src/pages/dev/DeploymentPage.tsx', import.meta.url), 'utf8',
  );
  /**
   * L'INVARIANT EST L'ORDRE, PAS LA FORME DE L'APPEL.
   *
   * Cette garde cherchait littéralement `await api.deployment.openVpsSession`.
   * L'appel est désormais enveloppé dans la reprise bornée qui absorbe un
   * redémarrage du backend (`malgreUnRedemarrage(() => …openVpsSession(…))`) :
   * la forme a changé, l'invariant non — le toast ne parle qu'une fois la
   * session RENDUE. On repère donc l'appel, quelle que soit sa forme, et l'on
   * exige qu'il soit ATTENDU avant l'annonce.
   */
  const iAppel = page.indexOf('api.deployment.openVpsSession');
  const iToast = page.indexOf("toast.success('Connecté au serveur.')");
  check('le toast suit l’appel, il ne le précède pas',
    iAppel > 0 && iToast > iAppel);
  check('…et la session est bien ATTENDUE avant l’annonce',
    /const s = await [\s\S]{0,400}openVpsSession\(/.test(page));
  check('…et l’échec passe par le chemin d’erreur',
    /catch \(e\)[\s\S]{0,200}toast\.error/.test(page));
  check('la session enregistrée ne porte plus de réglage',
    !/keep: s\.keep/.test(page));
}

console.log(`\n${ok} réussis, ${ko} échoués`);
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
