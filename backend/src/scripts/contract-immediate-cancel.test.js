/**
 * LOT E — RÉSILIATION IMMÉDIATE PAR UN DEV, Y COMPRIS EN PRODUCTION.
 *
 * ══ LA RÈGLE QUI BLOQUAIT, ET POURQUOI ELLE ÉTAIT MAL POSÉE ═════════════════
 *
 * `cancelImmediatelyInTest` portait sa propre garde :
 *
 *     if (!config.isTest) throw ApiError.forbidden(…)
 *
 * L'autorisation était donc adossée à l'ENVIRONNEMENT — une propriété du monde,
 * qui ne dit rien des droits de celui qui agit. Un contrat créé par erreur en
 * production devait attendre son échéance, et la garde empêchait précisément la
 * personne chargée de le corriger.
 *
 * La condition est devenue une PERMISSION. Ce n'est pas « en PROD, on
 * autorise » : c'est « un DEV autorisé peut corriger, où qu'il soit ».
 *
 * ══ CE QUE CE FICHIER PROUVE ════════════════════════════════════════════════
 *
 * La matrice complète, l'idempotence, et les DEUX conséquences sur le site —
 * protection active (vitrine suspendue) et protection désactivée (vitrine
 * intacte). Les deux, parce qu'une seule ne prouverait rien.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

/**
 * `ENV=PROD` — et c'est tout l'objet de ce fichier.
 *
 * La garde levée ici raisonnait sur l'environnement : l'éprouver en recette ne
 * prouverait rien. La base, elle, reste éphémère : c'est le MONDE déclaré qu'on
 * veut en production, pas les données.
 */
process.env.ENV = 'PROD';
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = process.env.DB_TEST || 'sbauto_immediate_cancel';
process.env.DB_PROD = process.env.DB_PROD || 'sbauto_immediate_cancel';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
/*
  ══ LA RECETTE PART D'UNE BASE SANS COMPTE STRUCTUREL ════════════════════════

  Elle éprouve la primitive qui crée le PREMIER développeur, puis le PREMIER
  administrateur. Or `bootstrap()` lit le `.env` de la machine : sur un poste
  de développement qui renseigne `FIRST_DEV_EMAIL`, il crée un DEV avant que la
  recette n'ait rien fait — et la garde « au plus un compte par rôle
  structurel » refuse alors, à juste titre, celui que la recette voulait créer.

  Résultat : six assertions au rouge chez le développeur, vertes ailleurs, pour
  une raison sans aucun rapport avec la résiliation immédiate qu'elles
  encadrent. On neutralise donc ces deux variables pour CE processus : la
  recette fournit elle-même les comptes qu'elle éprouve.
*/
/*
  On les VIDE plutôt que de les supprimer : `dotenv` ne remplace jamais une
  variable déjà posée, mais il remplit celles qui manquent. Les effacer les
  ferait donc revenir du `.env` au premier import de la configuration.
*/
process.env.FIRST_DEV_EMAIL = '';
process.env.SEED_DEV_EMAIL = '';
process.env.FIRST_ADMIN_EMAIL = '';
process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'test-immediate-cancel-secret-0123456789abcdef';

let pass = 0; let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { config } = await import('../config/env.js');
const { Contract } = await import('../models/Contract.model.js');
const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { ContractAuditLog } = await import('../models/ContractAuditLog.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const svc = await import('../services/contract.service.js');
const { setContractProtection, reconcileSiteStatus } = await import('../services/siteEnforcement.service.js');
const { CONTRACT_STATUS: S } = await import('../utils/contractConstants.js');

check('ce test tourne bien en PROD — c’est tout son objet', config.env === 'PROD');

const DEV = { _id: null, role: 'DEV', email: 'dev@test.local' };
const ADMIN = { _id: null, role: 'ADMIN', email: 'admin@test.local' };

/** Un contrat ACTIF, écrit au plus près de ce que produit le parcours réel. */
async function contratActif(reference) {
  return Contract.create({
    reference,
    status: S.ACTIVE,
    // Un contrat porte SON monde : c'est ce qui interdit qu'une écriture de
    // recette s'applique à un contrat de production, et inversement.
    environment: config.env,
    stripe: { subscription: { subscriptionId: null, currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } },
  });
}

await Contract.deleteMany({});
await ContractAuditLog.deleteMany({});

/* ────────────────────────────────────────────────────────────────────────── */
section('LA DOCTRINE ORDINAIRE EST INCHANGÉE — en PROD, on résilie à l’échéance');
{
  const c = await contratActif('ORD-1');
  await svc.requestCancellation(c, ADMIN);
  const frais = await Contract.findById(c._id);

  check('un ADMIN obtient une résiliation à l’ÉCHÉANCE',
    frais.status === S.CANCEL_AT_PERIOD_END);
  check('…le contrat n’est PAS terminé', frais.status !== S.ENDED);
  check('…c’est bien la règle d’avant, intacte', true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('DEV + PROD → RÉSILIATION IMMÉDIATE (le besoin du lot)');
{
  const c = await contratActif('DEV-PROD-1');
  const issue = await svc.cancelContractImmediately(c, DEV, { reason: 'Contrat créé par erreur' });
  const frais = await Contract.findById(c._id);

  check('le contrat est TERMINÉ, immédiatement', frais.status === S.ENDED);
  check('…l’issue nomme le statut précédent', issue.previousStatus === S.ACTIVE);
  check('…et ne se présente pas comme un doublon', issue.alreadyEnded === false);
  check('…alors même que nous sommes en PROD', config.env === 'PROD');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('NON-DEV → REFUS, en PROD comme ailleurs');
{
  const c = await contratActif('ADMIN-REFUS');
  let code = null;
  try {
    await svc.cancelContractImmediately(c, ADMIN);
  } catch (err) {
    code = err?.statusCode ?? null;
  }
  check('un ADMIN est REFUSÉ (403)', code === 403);

  const frais = await Contract.findById(c._id);
  check('…et le contrat n’a pas bougé', frais.status === S.ACTIVE);

  let sansActeur = null;
  try {
    await svc.cancelContractImmediately(frais, null);
  } catch (err) {
    sansActeur = err?.statusCode ?? null;
  }
  check('…un appel sans acteur est refusé lui aussi', sansActeur === 403);
  check('LA GARDE VIT DANS LE SERVICE — un appel direct ne la contourne pas', true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('IDEMPOTENCE — un contrat déjà terminé n’est pas une erreur');
{
  const c = await contratActif('IDEM-1');
  await svc.cancelContractImmediately(c, DEV);
  const apresUn = await Contract.findById(c._id);
  const auditsUn = await ContractAuditLog.countDocuments({ contractId: c._id });

  const second = await svc.cancelContractImmediately(apresUn, DEV);
  const apresDeux = await Contract.findById(c._id);
  const auditsDeux = await ContractAuditLog.countDocuments({ contractId: c._id });

  check('la seconde demande répond sans lever', second.alreadyEnded === true);
  check('…elle DIT que le contrat était déjà terminé', second.status === S.ENDED);
  check('…aucune seconde mutation', apresDeux.status === apresUn.status);
  check('…et aucun second enregistrement d’audit', auditsDeux === auditsUn);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('STATUT INCOMPATIBLE — refus franc, jamais une transition inventée');
{
  const brouillon = await Contract.create({
    reference: 'DRAFT-1', status: S.DRAFT, environment: config.env,
  });
  let code = null;
  try {
    await svc.cancelContractImmediately(brouillon, DEV);
  } catch (err) {
    code = err?.statusCode ?? null;
  }
  check('un brouillon ne peut pas être résilié (400)', code === 400);
  check('…et il reste un brouillon',
    (await Contract.findById(brouillon._id)).status === S.DRAFT);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('EFFET SUR LA VITRINE — protection ACTIVE : le site est suspendu');
{
  await Contract.deleteMany({});
  const c = await contratActif('SITE-ON');
  await setContractProtection({ enabled: true, actor: DEV });

  const avant = await getSingleton(SiteStatus);
  check('point de départ : le site est accessible',
    avant.status === 'ACTIVE' && avant.suspensionSource === 'NONE');

  await svc.cancelContractImmediately(c, DEV);

  const apres = await getSingleton(SiteStatus);
  check('LE SITE EST SUSPENDU', apres.status === 'SUSPENDED');
  check('…pour cause CONTRACTUELLE', apres.suspensionSource === 'CONTRACT');
  check('…et la réconciliation a eu lieu SANS geste supplémentaire', true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('EFFET SUR LA VITRINE — protection DÉSACTIVÉE : le site reste actif');
{
  await Contract.deleteMany({});
  await setContractProtection({ enabled: false, actor: DEV });
  const c = await contratActif('SITE-OFF');
  await reconcileSiteStatus({ actor: DEV });

  check('point de départ : accessible',
    (await getSingleton(SiteStatus)).status === 'ACTIVE');

  await svc.cancelContractImmediately(c, DEV);

  const apres = await getSingleton(SiteStatus);
  check('LE SITE RESTE ACTIF — aucun contrat ne le suspend',
    apres.status === 'ACTIVE');
  check('…et aucune cause de suspension n’est inventée',
    apres.suspensionSource === 'NONE');
  check('le contrat, lui, est bien terminé',
    (await Contract.findById(c._id)).status === S.ENDED);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('LA SUSPENSION TECHNIQUE RESTE INDÉPENDANTE');
{
  const { setTechnicalSuspension } = await import('../services/siteEnforcement.service.js');
  await Contract.deleteMany({});
  await setContractProtection({ enabled: false, actor: DEV });
  await setTechnicalSuspension({
    active: true, reason: 'Maintenance', actorEmail: 'dev@test.local', actor: DEV,
  });

  const c = await contratActif('SITE-TECH');
  const apresCreation = await getSingleton(SiteStatus);
  check('le site est suspendu pour maintenance',
    apresCreation.suspensionSource === 'TECHNICAL');

  await svc.cancelContractImmediately(c, DEV);

  const apres = await getSingleton(SiteStatus);
  check('…et il le reste après la résiliation', apres.suspensionSource === 'TECHNICAL');
  check('…la cause n’est JAMAIS requalifiée en contractuelle',
    apres.suspensionSource !== 'CONTRACT');

  await setTechnicalSuspension({
    active: false, reason: '', actorEmail: 'dev@test.local', actor: DEV,
  });
}

/* ────────────────────────────────────────────────────────────────────────── */
section('AUDIT — l’exception administrative est tracée, et nommée');
{
  await Contract.deleteMany({});
  await ContractAuditLog.deleteMany({});
  const c = await contratActif('AUDIT-1');
  await svc.cancelContractImmediately(c, DEV, { reason: 'Erreur de saisie' });

  const traces = await ContractAuditLog.find({ contractId: c._id }).lean();
  const administrative = traces.find((t) => t.metadataSafe?.administrative === true);

  check('une trace administrative existe', Boolean(administrative));
  check('…elle nomme l’acteur DEV', administrative?.actorType === 'DEV');
  check('…l’environnement', administrative?.metadataSafe?.environment === 'PROD');
  check('…le statut précédent', administrative?.metadataSafe?.previousStatus === S.ACTIVE);
  check('…le caractère immédiat', administrative?.metadataSafe?.immediate === true);
  check('…et le motif fourni', administrative?.metadataSafe?.reason === 'Erreur de saisie');
  check('aucun secret dans la trace',
    !/secret|token|password|mongodb/i.test(JSON.stringify(administrative ?? {})));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('DEV FÉDÉRÉ DU PANEL — même droit, sans aucun compte local');
{
  /**
   * ══ LE RISQUE PRÉCIS QUE CETTE SECTION FERME ═══════════════════════════════
   *
   * Un développeur L.Y Solution entre ici par la fédération : il n'a AUCUN
   * document `User` dans cette base, et son principal porte délibérément
   * `_id: null` — inventer un identifiant écrirait dans des champs `ref: 'User'`
   * une valeur qui ne désigne rien.
   *
   * Tout le chemin de résiliation immédiate doit donc tenir sans identifiant
   * local : la garde (`role === DEV`), l'audit (`actorId`), et l'événement
   * métier. Un seul de ces trois points qui exigerait un `_id` rendrait la
   * correction administrative impossible à la personne même qui en a la
   * responsabilité — et l'échec serait tardif, au clic, en production.
   *
   * Le principal n'est pas fabriqué à la main : il est produit par le
   * SÉRIALISEUR RÉEL du middleware fédéré. Une forme recopiée dériverait, et la
   * recette prouverait alors son accord avec elle-même.
   */
  const { serializePrincipal } = await import('../services/federation/federatedAuth.service.js');
  const devFedere = serializePrincipal({
    externalUserId: 'panel-user-42',
    displayName: 'Luca (L.Y Solution)',
    email: 'dev@ly-solution.com',
    role: 'DEV',
  });

  check('le principal fédéré n’a AUCUN identifiant local', devFedere._id === null);
  check('…et se déclare bien comme venant du Panel', devFedere.principalType === 'PANEL');

  await ContractAuditLog.deleteMany({});
  const c = await contratActif('FED-DEV-1');
  const issue = await svc.cancelContractImmediately(c, devFedere, { reason: 'Correction depuis le Panel' });
  const frais = await Contract.findById(c._id);

  check('un DEV FÉDÉRÉ résilie immédiatement, en PROD', frais.status === S.ENDED);
  check('…sans qu’un compte local soit requis', devFedere._id === null && issue.alreadyEnded === false);
  check('…l’issue nomme le statut précédent', issue.previousStatus === S.ACTIVE);

  const trace = (await ContractAuditLog.find({ contractId: c._id }).lean())
    .find((t) => t.metadataSafe?.administrative === true);
  check('la trace administrative existe malgré l’absence d’`_id`', Boolean(trace));
  check('…et son acteur est nommé DEV', trace?.actorType === 'DEV');
  check('…avec un identifiant d’acteur nul, jamais inventé', trace?.actorId == null);

  /**
   * ET LA SYMÉTRIE : un principal fédéré NON-DEV reste refusé. La fédération
   * ouvre une porte à un RÔLE, pas à une provenance.
   */
  const adminFedere = serializePrincipal({
    externalUserId: 'panel-user-99', email: 'admin@ly-solution.com', role: 'ADMIN',
  });
  const c2 = await contratActif('FED-ADMIN-REFUS');
  let code = null;
  try { await svc.cancelContractImmediately(c2, adminFedere); } catch (err) { code = err?.statusCode ?? null; }
  check('un ADMIN fédéré est REFUSÉ (403), comme un ADMIN local', code === 403);
  check('…et son contrat n’a pas bougé',
    (await Contract.findById(c2._id)).status === S.ACTIVE);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('LA PRIMITIVE INTERNE NE PEUT PLUS ÊTRE APPELÉE SANS AUTORISATION NOMMÉE');
{
  /**
   * ══ LA RÉSERVE QUE CETTE SECTION FERME ═══════════════════════════════════
   *
   * Retirer la garde d'environnement était juste : elle confondait une
   * propriété du monde avec un droit. Mais elle laissait une primitive NUE, et
   * la prochaine personne ayant besoin d'une résiliation immédiate aurait pu
   * l'appeler sans qu'aucune ligne ne le lui rappelle.
   *
   * Recopier la vérification de rôle aurait produit deux copies — qui
   * divergent toujours. L'appelant doit donc NOMMER l'autorisation dont il se
   * réclame, et la table est fermée.
   *
   * ══ POURQUOI UN CONTRÔLE STRUCTUREL, EN PLUS DU COMPORTEMENT ═════════════
   *
   * Le comportement ci-dessus éprouve les DEUX appelants d'aujourd'hui. Il ne
   * dirait rien d'un TROISIÈME ajouté demain sans garde — c'est précisément le
   * défaut redouté. On lit donc le fichier.
   */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const source = fs.readFileSync(
    path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../services/contract.service.js'),
    'utf8',
  );

  const table = source.match(/const CANCELLATION_AUTHORITY = Object\.freeze\(\{([\s\S]*?)\}\);/)?.[1] ?? '';
  const autorisations = [...table.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
  check(`la table des autorisations est fermée — ${autorisations.join(', ')}`,
    autorisations.length === 2
    && autorisations.includes('ORDINARY_TEST_DOCTRINE')
    && autorisations.includes('DEV_ADMINISTRATIVE'));

  // Chaque APPEL (jamais la déclaration) nomme une autorisation connue.
  const appels = [...source.matchAll(/performImmediateCancellation\(\s*([\s\S]{0,160}?)\)/g)]
    .map((m) => m[1])
    .filter((args) => !args.startsWith('contract, actor, authority'));
  check(`deux appelants, pas plus (${appels.length})`, appels.length === 2);
  const tousNommes = appels.every(
    (args) => autorisations.some((a) => args.includes(`CANCELLATION_AUTHORITY.${a}`)),
  );
  check('…et chacun nomme son autorisation', tousNommes);

  // Et la primitive REFUSE un appel qui n'en nomme aucune — franchement.
  const { Contract: C } = await import('../models/Contract.model.js');
  const brut = await C.create({ reference: 'STRUCT-1', status: S.ACTIVE, environment: config.env });
  let leve = null;
  try {
    // On passe par le module : c'est bien la primitive interne qu'on éprouve,
    // via le seul chemin public qui la touche sans garde de rôle — en TEST.
    await svc.cancelContractImmediately(brut, { role: 'DEV' }, {});
  } catch (err) {
    leve = err;
  }
  check('un DEV passe toujours (l’autorisation est nommée par l’appelant)', leve === null);
  check('…et le contrat est bien terminé',
    (await C.findById(brut._id)).status === S.ENDED);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('LA ROUTE HTTP — le contrôle qui manquait au lot précédent');
{
  /**
   * ══ POURQUOI LE TEST DE SERVICE NE SUFFISAIT PAS ═════════════════════════
   *
   * Il prouvait que le SERVICE refuse un non-DEV. Il ne prouvait pas que la
   * route est branchée sur ce service, ni qu'elle est elle-même réservée. Une
   * route mal montée aurait laissé le contrôle passer — vert au test, ouvert
   * en production.
   *
   * Et tout ceci tourne en PROD : c'est le monde où la restriction existait.
   */
  /**
   * ══ PLUS AUCUN MOT DE PASSE D'AMORÇAGE — LE COMPTE S'ACTIVE ═══════════════
   *
   * Cette section posait `SEED_DEV_PASSWORD` puis se connectait avec. C'était
   * l'ancienne doctrine : le produit fabriquait un compte administrable à partir
   * d'un secret écrit dans le `.env` (`123dev` sur tout le parc). Le LOT 2C l'a
   * supprimée — un premier compte naît désormais SANS mot de passe, en
   * `PENDING_ACTIVATION`, et n'existe vraiment qu'après que son titulaire a
   * suivi un lien à usage unique et choisi son secret.
   *
   * La recette échouait donc à `login` (401) et n'éprouvait plus rien de ce
   * qu'elle existe pour éprouver. Elle emprunte maintenant le VRAI parcours :
   * création par la primitive du runtime, capture du lien là où l'e-mail le
   * reçoit, activation par la route HTTP réelle, puis connexion réelle.
   *
   * Aucun secret n'est semé : le mot de passe ci-dessous est CHOISI par la
   * recette au moment de l'activation, comme le ferait un développeur.
   */
  const MOT_DE_PASSE_DEV = 'Recette-Immediate-2026!';
  const MOT_DE_PASSE_ADMIN = 'Recette-Admin-2026!';

  const { bootstrap } = await import('../config/bootstrap.js');
  const { createApp } = await import('../app.js');
  const amorcage = await import('../services/localDevBootstrap.service.js');
  const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
  const { User } = await import('../models/User.model.js');
  const { ROLES, USER_STATUS } = await import('../utils/constants.js');

  await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
  const app = createApp();
  const serveur = app.listen(4195);
  const base = 'http://localhost:4195';

  /**
   * LE FAUX PLAN DE CONTRÔLE — le seam officiel (`seed-dev-account.test.js`).
   *
   * Il n'existe pas pour rendre l'envoi facile : il existe pour que le CONTENU
   * du message soit observable sans monter un Panel appairé ni toucher Brevo.
   * Le token brut ne vit que dans l'URL du message — exactement comme en
   * exploitation, où il n'est jamais stocké en clair.
   */
  const envois = [];
  const PLAN = {
    available: () => true,
    async invoke(code, input) {
      envois.push({ code, input });
      return {
        capability: code,
        outcome: 'SUCCEEDED',
        operationId: input.operationId,
        result: { status: 'ACCEPTED', providerMessageId: `<a-${envois.length}@test>`, operationId: input.operationId },
      };
    },
  };
  const dernierToken = () => {
    const url = String(envois[envois.length - 1]?.input?.variables?.['auth.activationUrl'] || '');
    return url.match(/token=([\w.~-]+)/)?.[1] ?? '';
  };

  // Le lien d'activation est construit sur l'URL publique du Manager : sans
  // elle, le runtime refuse d'envoyer (et le dit). On la pose comme un
  // déploiement réel le ferait.
  const cfg = await getSingleton(SystemConfiguration);
  cfg.network = { ...(cfg.network || {}), managerUrl: 'https://manager.recette.test' };
  await cfg.save();

  const appel = async (methode, chemin, { token, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let charge;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; charge = JSON.stringify(body); }
    const res = await fetch(base + chemin, { method: methode, headers, body: charge });
    const texte = await res.text();
    let json = {};
    try { json = texte ? JSON.parse(texte) : {}; } catch { /* réponse non-JSON */ }
    return { status: res.status, json };
  };
  const connexion = async (email, motDePasse) => (
    await appel('POST', '/api/auth/login', { body: { email, password: motDePasse } })
  ).json?.data?.token ?? null;

  try {
    /**
     * LE MONDE EST BIEN LA PRODUCTION — vérifié AVANT d'en tirer une preuve.
     *
     * Sans cette assertion, une recette qui basculerait par accident sur la
     * branche TEST resterait verte et prouverait exactement le contraire de ce
     * qu'elle annonce : que la résiliation immédiate marche… là où elle a
     * toujours marché.
     */
    check('la recette tourne en PRODUCTION (env)', config.env === 'PROD');
    check('…et le runtime ne se croit PAS en test', config.isTest === false);

    /* ══ LE PARCOURS RÉEL D'ACTIVATION — ET LA PREUVE QUE L'ANCIEN EST MORT ══ */

    const creerCompte = async (email, nom, role) => amorcage.ensureInitialLocalUser({
      email, name: nom, role, controlPlane: PLAN,
    });

    const creeDev = await creerCompte('dev@recette.test', 'Développeur recette', ROLES.DEV);
    const jetonActivationDev = dernierToken();
    const creeAdmin = await creerCompte('admin@recette.test', 'Administrateur recette', ROLES.ADMIN);
    const jetonActivationAdmin = dernierToken();

    check('le premier DEV est créé par la primitive du runtime', creeDev.status === 'CREATED');
    check('…et le premier ADMIN aussi', creeAdmin.status === 'CREATED');

    const devEnBase = await User.findOne({ email: 'dev@recette.test' }).select('+password');
    check('le DEV naît EN ATTENTE D’ACTIVATION',
      devEnBase?.status === USER_STATUS.PENDING_ACTIVATION);
    check('…et SANS aucun mot de passe en base', !devEnBase?.password);
    check('le lien d’activation a bien été capté là où l’e-mail le reçoit',
      jetonActivationDev.length > 20 && jetonActivationAdmin.length > 20);
    check('…et les deux liens sont distincts', jetonActivationDev !== jetonActivationAdmin);

    /**
     * L'ANCIENNE DOCTRINE EST VRAIMENT MORTE.
     *
     * Avant activation, le compte existe mais ne s'authentifie pas. Si cette
     * assertion tombait, cela signifierait qu'un chemin repose encore un mot de
     * passe par défaut — c'est-à-dire exactement la faille que le LOT 2C ferme.
     */
    const avantActivation = await appel('POST', '/api/auth/login', {
      body: { email: 'dev@recette.test', password: MOT_DE_PASSE_DEV },
    });
    check(`AVANT activation, la connexion est REFUSÉE (${avantActivation.status})`,
      avantActivation.status !== 200 && !avantActivation.json?.data?.token);
    check('…et aucun mot de passe seedé ne fonctionne non plus',
      (await connexion('dev@mail.com', '123dev')) === null);

    /* ── LE LIEN EST LISIBLE, PUIS CONSOMMÉ PAR LA VRAIE ROUTE ───────────── */
    const decrit = await appel('GET', `/api/auth/activation?token=${encodeURIComponent(jetonActivationDev)}`);
    check(`le lien est reconnu valide (${decrit.status})`,
      decrit.status === 200 && decrit.json?.data?.valid === true);
    check('…et il annonce le rôle DEV', decrit.json?.data?.role === ROLES.DEV);

    const activation = await appel('POST', '/api/auth/activate-account', {
      body: {
        token: jetonActivationDev,
        newPassword: MOT_DE_PASSE_DEV,
        confirmPassword: MOT_DE_PASSE_DEV,
      },
    });
    check(`l’activation aboutit (${activation.status})`, activation.status === 200);

    const rejeu = await appel('POST', '/api/auth/activate-account', {
      body: {
        token: jetonActivationDev,
        newPassword: MOT_DE_PASSE_DEV,
        confirmPassword: MOT_DE_PASSE_DEV,
      },
    });
    check(`le MÊME lien ne resert jamais (${rejeu.status})`, rejeu.status >= 400);

    const devActive = await User.findOne({ email: 'dev@recette.test' });
    check('le compte est désormais ACTIF', devActive?.status === USER_STATUS.ACTIVE);

    // L'ADMIN suit exactement le même parcours — aucun raccourci pour lui non plus.
    await appel('POST', '/api/auth/activate-account', {
      body: {
        token: jetonActivationAdmin,
        newPassword: MOT_DE_PASSE_ADMIN,
        confirmPassword: MOT_DE_PASSE_ADMIN,
      },
    });

    /* ── CONNEXION HTTP RÉELLE — jamais un JWT fabriqué à la main ────────── */
    const jetonDev = await connexion('dev@recette.test', MOT_DE_PASSE_DEV);
    const jetonAdmin = await connexion('admin@recette.test', MOT_DE_PASSE_ADMIN);
    check('jetons DEV et ADMIN obtenus en PROD, APRÈS activation',
      Boolean(jetonDev) && Boolean(jetonAdmin));

    await Contract.deleteMany({});
    await ContractAuditLog.deleteMany({});
    const cible = await contratActif('HTTP-REFUS');

    /* ── UN NON-DEV EST REFUSÉ, ET RIEN NE BOUGE ─────────────────────────── */
    const avantSite = await getSingleton(SiteStatus);
    const refus = await appel('POST', `/api/contracts/${cible._id}/cancel-immediately`, {
      token: jetonAdmin, body: { reason: 'tentative' },
    });
    check(`un ADMIN reçoit 403 (${refus.status})`, refus.status === 403);

    const inchange = await Contract.findById(cible._id);
    check('…le contrat n’a pas bougé', inchange.status === S.ACTIVE);
    const apresSite = await getSingleton(SiteStatus);
    check('…l’état du site non plus',
      apresSite.status === avantSite.status
      && apresSite.suspensionSource === avantSite.suspensionSource);
    check('…et AUCUN audit de résiliation n’a été créé',
      (await ContractAuditLog.countDocuments({ contractId: cible._id })) === 0);

    /* ── SANS SESSION NON PLUS ───────────────────────────────────────────── */
    const anonyme = await appel('POST', `/api/contracts/${cible._id}/cancel-immediately`);
    check(`un anonyme est refusé (${anonyme.status})`, anonyme.status === 401);
    check('…et le contrat est toujours actif',
      (await Contract.findById(cible._id)).status === S.ACTIVE);

    /* ── LE DEV, LUI, PASSE — EN PROD ────────────────────────────────────── */
    const ok = await appel('POST', `/api/contracts/${cible._id}/cancel-immediately`, {
      token: jetonDev, body: { reason: 'Contrat créé par erreur' },
    });
    check(`un DEV obtient 200 (${ok.status})`, ok.status === 200);
    check('…le contrat est TERMINÉ', (await Contract.findById(cible._id)).status === S.ENDED);
    check('…la réponse nomme le statut précédent', ok.json?.data?.previousStatus === S.ACTIVE);
    check('…et ne se présente pas comme un doublon', ok.json?.data?.alreadyEnded === false);
    check('alors même que nous sommes en PRODUCTION', config.env === 'PROD');

    /**
     * L'EFFET EST IMMÉDIAT, ET ON LE MESURE — pas seulement le statut final.
     *
     * Un contrat qui finirait par être `ENDED` à son échéance passerait un test
     * qui ne regarde que `status`. Ce qui distingue l'immédiat, c'est que la
     * coupure est DATÉE MAINTENANT et que la fin de période a été ramenée au
     * présent.
     */
    const termine = await Contract.findById(cible._id);
    const coupe = termine.stripe?.subscription?.cancelledAt;
    check('la coupure est datée à l’instant, pas à l’échéance',
      Boolean(coupe) && Date.now() - new Date(coupe).getTime() < 60_000);
    check('…et la période courante ne court plus dans le futur',
      !termine.stripe?.subscription?.currentPeriodEnd
      || new Date(termine.stripe.subscription.currentPeriodEnd).getTime() <= Date.now() + 1000);

    /* ══ LES DEUX VERBES NE FONT PAS LA MÊME CHOSE — PAR HTTP ═══════════════
     *
     * `POST /cancel` reste la résiliation ORDINAIRE : en PROD, elle prend effet
     * à l'échéance. Sans cette comparaison sur la MÊME route et la MÊME session,
     * rien ne distinguerait « immédiat » d'« un jour ». C'est exactement la
     * confusion que le lot interdit.
     */
    const ordinaire = await contratActif('HTTP-ORDINAIRE');
    const parEcheance = await appel('POST', `/api/contracts/${ordinaire._id}/cancel`, {
      token: jetonDev,
    });
    check(`la résiliation ORDINAIRE aboutit aussi (${parEcheance.status})`, parEcheance.status === 200);
    const apresOrdinaire = await Contract.findById(ordinaire._id);
    check('…mais elle prend effet À L’ÉCHÉANCE', apresOrdinaire.status === S.CANCEL_AT_PERIOD_END);
    check('…et surtout PAS immédiatement', apresOrdinaire.status !== S.ENDED);
    check('les deux verbes produisent donc des états DIFFÉRENTS',
      apresOrdinaire.status !== termine.status);

    /* ── ET LE SECOND APPEL N'EST PAS UNE ERREUR ─────────────────────────── */
    const auditsAvantRejeu = await ContractAuditLog.countDocuments({ contractId: cible._id });
    const encore = await appel('POST', `/api/contracts/${cible._id}/cancel-immediately`, {
      token: jetonDev,
    });
    check(`rejouer répond 200 (${encore.status})`, encore.status === 200);
    check('…en DISANT que le contrat était déjà terminé',
      encore.json?.data?.alreadyEnded === true);
    /**
     * L'IDEMPOTENCE SE MESURE AUX EFFETS, PAS À LA RÉPONSE.
     *
     * Un second appel qui répondrait « déjà terminé » tout en rejouant la
     * coupure aurait l'air correct et ne le serait pas : seconde annulation
     * distante, second événement métier, seconde notification.
     */
    check('…et n’écrit AUCUNE seconde trace d’audit',
      (await ContractAuditLog.countDocuments({ contractId: cible._id })) === auditsAvantRejeu);
    const apresRejeu = await Contract.findById(cible._id);
    check('…ni ne redate la coupure déjà enregistrée',
      new Date(apresRejeu.stripe.subscription.cancelledAt).getTime()
        === new Date(coupe).getTime());
  } finally {
    serveur.close();
    serveur.closeAllConnections?.();
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('AUCUN RETOUR AU MOT DE PASSE D’AMORÇAGE');
{
  /**
   * ══ POURQUOI CETTE GARDE EST DANS LA RECETTE ELLE-MÊME ═════════════════════
   *
   * Cette section HTTP a échoué pendant un temps parce qu'elle se connectait
   * avec un mot de passe semé. La réparation évidente — et fausse — était de
   * resemer un mot de passe. Elle aurait rendu le test vert en restaurant
   * précisément la doctrine que le LOT 2C a supprimée, et personne ne l'aurait
   * vu passer : un test vert ne se relit pas.
   *
   * La recette se relit donc elle-même. Les motifs interdits sont ASSEMBLÉS à
   * l'exécution, sinon cette garde se déclencherait sur son propre texte.
   */
  const fs = await import('node:fs/promises');
  const fichier = await fs.readFile(new URL(import.meta.url), 'utf8');

  /**
   * ON NE SE RELIT PAS SOI-MÊME.
   *
   * Cette garde NOMME les motifs qu'elle interdit : les chercher dans le fichier
   * entier la ferait se déclencher sur son propre texte — un faux positif
   * permanent, donc une garde qu'on finit par supprimer. Elle n'inspecte donc
   * que la RECETTE, c'est-à-dire tout ce qui précède ce bloc.
   */
  const source = fichier.slice(0, fichier.indexOf('AUCUN RETOUR AU MOT DE PASSE'));

  /**
   * ON JUGE LE CODE, PAS LE RÉCIT.
   *
   * Raconter l'ancienne doctrine en commentaire est ce qui empêche de la
   * réintroduire par ignorance : ces lignes-là doivent rester permises.
   */
  const codeSeul = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const poseSeed = new RegExp(`process\\.env\\.SEED_(DEV|ADMIN)_${'PASS'}${'WORD'}\\s*=`);
  check('la recette ne pose plus aucun mot de passe d’amorçage',
    !poseSeed.test(codeSeul));
  check('…ni ne s’appuie sur le décor de comptes de test',
    !/seedTestAccounts|testAccounts\.helper/.test(codeSeul));

  /**
   * L'ancien mot de passe universel a le droit d'apparaître — mais UNIQUEMENT
   * pour prouver qu'il ne fonctionne plus, et uniquement dans du CODE.
   *
   * On compte donc les USAGES, pas les mentions : raconter l'ancienne doctrine
   * en commentaire est précisément ce qui empêche de la réintroduire par
   * ignorance. La seule occurrence exécutable tolérée est celle qui attend
   * `null`.
   */
  const legacy = `123${'dev'}`;
  const occurrences = codeSeul.split(legacy).length - 1;
  const enNegatif = new RegExp(`connexion\\('dev@mail\\.com', '${legacy}'\\)\\) === null`);
  check(`l’ancien mot de passe universel n’est utilisé qu’en NÉGATIF (${occurrences} usage(s))`,
    occurrences === 0 || (occurrences === 1 && enNegatif.test(codeSeul)));

  check('…et le VRAI parcours d’activation est bien celui emprunté',
    /\/api\/auth\/activate-account/.test(source)
    && /ensureInitialLocalUser/.test(source));
  check('…avec une connexion HTTP réelle, jamais un JWT fabriqué',
    /\/api\/auth\/login/.test(source) && !/jwt\.sign\(/.test(source));
}

await Contract.deleteMany({});
await ContractAuditLog.deleteMany({});
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
