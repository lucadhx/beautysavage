/* L'ENTREPRISE CLIENTE, CÔTÉ PROJET — reçue, appliquée, jamais écrite.
 *
 * ══ CE QUE CETTE SUITE VERROUILLE ═══════════════════════════════════════════
 *
 * Trois choses, et elles sont indépendantes :
 *
 *   1. L'APPLICATION   ce que le pont livre est persisté, avec ses gardes :
 *                      monde, version, changement de rattachement, retrait.
 *   2. L'AUTORITÉ      ce projet ne peut PAS écrire cette identité, et il n'a
 *                      plus aucun écran pour le faire.
 *   3. LA CONSÉQUENCE  sans identité, ni paiement ni signature — refusé par le
 *                      backend, pas par une couleur de bouton.
 *
 * Plus le CURSEUR DURABLE : après un redémarrage, le rattrapage reprend où il
 * s'était arrêté — jamais à zéro.
 *
 * Runner autonome sur mongodb-memory-server. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.PORT = '4171';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();
await (await import('./helpers/testAccounts.helper.js')).seedTestAccounts();

const clientCompany = await import('../services/panelConfiguration/clientCompany.service.js');
const { PanelClientCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const { publishClientCompany, clearClientCompanyFixture, CLIENT_SIGNER } = await import(
  './helpers/clientCompany.helper.js'
);
const { Company } = await import('../models/Company.model.js');
const { getSingleton } = await import('../utils/singleton.js');

const app = createApp();
const server = app.listen(4171);
const base = 'http://localhost:4171';

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

const login = async (email, password) => {
  const res = await api('POST', '/api/auth/login', { body: { email, password } });
  return res.json?.data?.token ?? null;
};
const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

/* ══════════════════════════════════════════════════════════════════════════ */
section('1. L’application — ce que le pont livre, et ce qu’il refuse');
{
  await clearClientCompanyFixture();
  const vide = await clientCompany.describeClientCompany();
  check('aucune entreprise → un ÉTAT, pas une absence de réponse', vide.linked === false);
  check('…et le verdict est MISSING_COMPANY', vide.readiness.state === 'MISSING_COMPANY');

  const applique = await publishClientCompany();
  check('une entreprise publiée est APPLIQUÉE', applique.applied === true);

  const vue = await clientCompany.describeClientCompany();
  check('…et la fiche est rattachée', vue.linked === true);
  check('…avec sa raison sociale', vue.company.legalName === 'SARL CLIENTE DE RECETTE');
  check('…et le VERDICT du Panel, repris tel quel', vue.readiness.ready === true);

  /**
   * LE MONDE DOIT CONCORDER. Une entreprise de production dans un projet de
   * recette ferait afficher un SIREN réel sur un site d'essai — et partir une
   * facture d'essai à son nom.
   */
  const autreMonde = await clientCompany.applyClientCompanyProfile({
    clientCompanyId: 'cc-prod', version: 99, environment: 'PROD', legalName: 'SARL PROD',
  }, 'SYNC');
  check('une entreprise d’un AUTRE monde est ignorée', autreMonde.applied === false);
  check('…avec un motif nommé', autreMonde.reason === 'ENVIRONMENT_MISMATCH');
  const apres = await clientCompany.getClientCompany();
  check('…et la fiche courante n’a pas bougé', apres.legalName === 'SARL CLIENTE DE RECETTE');

  /**
   * UNE VERSION ANTÉRIEURE EST IGNORÉE. Après un rattrapage, le journal se
   * rejoue dans l'ordre du JOURNAL — sans cette garde, l'écran clignoterait
   * entre plusieurs identités avant de se stabiliser.
   */
  const courante = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  const vieille = await clientCompany.applyClientCompanyProfile({
    clientCompanyId: courante.clientCompanyId,
    version: courante.version - 1,
    environment: 'TEST',
    legalName: 'ANCIENNE RAISON SOCIALE',
  }, 'SYNC');
  check('une version ANTÉRIEURE est ignorée', vieille.applied === false);
  check('…et la raison sociale reste la bonne',
    (await clientCompany.getClientCompany()).legalName === 'SARL CLIENTE DE RECETTE');

  /** Une charge utile non conforme est ÉCARTÉE, jamais appliquée à moitié. */
  const invalide = await clientCompany.applyClientCompanyProfile({ legalName: 'X' }, 'SYNC');
  check('une charge utile sans identifiant est refusée', invalide.applied === false);
  check('…avec un motif nommé', invalide.reason === 'INVALID_PAYLOAD');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2. Le changement de rattachement — l’ordre des écritures ne casse rien');
{
  /**
   * UN CHANGEMENT DE CLIENT ÉMET DEUX ÉCRITURES : la nouvelle identité, PUIS le
   * retrait de l'ancienne. Appliquer le tombstone sans vérifier l'identité
   * effacerait la NOUVELLE entreprise qu'on vient d'appliquer — et le projet se
   * retrouverait sans client alors qu'il vient d'en recevoir un.
   */
  const ancienne = (await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean())
    .clientCompanyId;

  await publishClientCompany({ clientCompanyId: 'cc-nouvelle', legalName: 'SARL NOUVELLE' });
  check('la NOUVELLE entreprise est appliquée',
    (await clientCompany.getClientCompany()).legalName === 'SARL NOUVELLE');

  const tombstone = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: ancienne, payload: null },
  });
  check('le retrait de l’ANCIENNE est ignoré', tombstone.applied === false);
  check('…parce qu’il ne désigne pas l’entreprise courante', tombstone.reason === 'OTHER_COMPANY');
  check('…et la nouvelle est toujours là',
    (await clientCompany.getClientCompany()).legalName === 'SARL NOUVELLE');

  /* Le retrait de l'entreprise COURANTE, lui, s'applique. */
  const retrait = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: 'cc-nouvelle', payload: null },
  });
  check('le retrait de l’entreprise COURANTE s’applique', retrait.applied === true);
  const apres = await clientCompany.describeClientCompany();
  check('…le projet n’a plus de client légal', apres.linked === false);
  /**
   * LE DOCUMENT SURVIT. « Retirée » et « jamais configurée » sont deux états,
   * et l'écran doit pouvoir les distinguer.
   */
  const doc = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  check('…mais le document survit, pour dire « retirée »', doc !== null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 bis. Le retrait se rapproche sur l’IDENTIFIANT D’ENTITÉ');
{
  /**
   * ── LE DÉFAUT QUE CETTE SECTION FERME ─────────────────────────────────────
   *
   * Le contrat impose `entityId: uuid`. L'identifiant métier du Panel n'en est
   * pas un : l'écriture porte donc un UUID DÉRIVÉ, la charge utile porte
   * l'identifiant lisible. Les comparer directement — ce que faisait le
   * rapprochement du tombstone — ne peut QUE se tromper :
   *
   *   · un retrait légitime serait toujours ignoré (l'entreprise reste alors
   *     en place alors que le Panel la croit retirée : paiements ouverts sur
   *     un client détaché) ;
   *   · ou, si l'on renonçait à comparer, un retrait tardif effacerait la
   *     NOUVELLE entreprise qui vient d'arriver.
   *
   * Le projet mémorise donc l'identifiant PORTÉ PAR L'ÉCRITURE
   * (`bridgeEntityId`) et rapproche là-dessus. Il ne rederive rien : rederiver
   * dupliquerait un algorithme du Panel, qui finirait par diverger.
   */
  const UUID_A = '3f2b1c4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d';
  const UUID_B = '9a8b7c6d-5e4f-5a3b-9c2d-1e0f9a8b7c6d';

  await clientCompany.applyClientCompanyChange({
    change: {
      deleted: false,
      entityId: UUID_A,
      payload: {
        clientCompanyId: 'cc-lisible-a', version: 1, environment: 'TEST',
        legalName: 'SARL IDENTIFIÉE PAR SON ÉCRITURE',
      },
    },
  });
  const applique = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  check('l’identifiant d’entité est MÉMORISÉ', applique.bridgeEntityId === UUID_A);
  check('…et l’identifiant métier reste lisible', applique.clientCompanyId === 'cc-lisible-a');

  /**
   * Un retrait qui désigne une AUTRE entité ne touche à rien — c'est le cas
   * d'un changement de rattachement dont les écritures se croisent.
   */
  const autre = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: UUID_B, payload: null },
  });
  check('un retrait visant une AUTRE entité est ignoré', autre.applied === false);
  check('…avec le motif nommé', autre.reason === 'OTHER_COMPANY');
  check('…et l’entreprise courante est intacte',
    (await clientCompany.getClientCompany())?.legalName === 'SARL IDENTIFIÉE PAR SON ÉCRITURE');

  /**
   * L'IDENTIFIANT MÉTIER NE SUFFIT PLUS À RETIRER : un retrait forgé sur
   * `clientCompanyId` ne désigne pas l'écriture qu'on a appliquée. C'est le
   * contrôle qui échouait avant ce lot — et qui aurait dû exister d'emblée.
   */
  const parIdMetier = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: 'cc-lisible-a', payload: null },
  });
  check('un retrait forgé sur l’identifiant MÉTIER ne retire rien',
    parIdMetier.applied === false);

  /* Le retrait qui porte la BONNE identité, lui, s'applique. */
  const bon = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: UUID_A, payload: null },
  });
  check('le retrait qui porte l’identité de l’écriture s’applique', bon.applied === true);
  const vide = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  check('…et l’identifiant d’entité est libéré', vide.bridgeEntityId === null);
  check('…le projet n’a plus de client légal',
    (await clientCompany.describeClientCompany()).linked === false);

  /**
   * REPLI POUR LES FICHES ANTÉRIEURES À CE CHAMP.
   *
   * Une fiche appliquée avant ce lot n'a pas de `bridgeEntityId`. Le retrait
   * retombe alors sur l'ancienne comparaison — juste pour elles. Sans ce repli,
   * une mise à niveau rendrait leur retrait définitivement inapplicable.
   */
  await clientCompany.applyClientCompanyProfile({
    clientCompanyId: 'cc-heritee', version: 1, environment: 'TEST',
    legalName: 'SARL D’AVANT LE CHAMP',
  }, 'SYNC');
  const heritee = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  check('une fiche sans identité d’écriture est possible', heritee.bridgeEntityId === null);
  const repli = await clientCompany.applyClientCompanyChange({
    change: { deleted: true, entityId: 'cc-heritee', payload: null },
  });
  check('…son retrait retombe sur l’ancienne comparaison', repli.applied === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3. Les gardes — NO CLIENT COMPANY, NO PAYMENT, NO SIGNATURE');
{
  /**
   * ── LE REFUS HTTP SE PROUVE AILLEURS, ET C’EST DÉLIBÉRÉ ────────────────
   *
   * Cette suite ne monte aucun contrat. Or les routes de paiement et de
   * signature résolvent d’abord le contrat de l’ADMIN : sans contrat, elles
   * répondent 404 bien AVANT d’avoir regardé l’entreprise cliente. On
   * croirait éprouver une garde qu’on n’aurait jamais atteinte — le pire des
   * tests, celui qui passe pour la mauvaise raison.
   *
   * Le refus HTTP est donc éprouvé dans `contract-billing-signature`, sur un
   * contrat réel et payable. Ici, on éprouve la LECTURE qui le gouverne.
   */
  await clearClientCompanyFixture();
  const sansEntreprise = await clientCompany.billingReadiness();
  check('sans entreprise → facturation impossible', sansEntreprise.ready === false);
  check('…et l’état le dit franchement', sansEntreprise.state === 'MISSING_COMPANY');
  check('…rien n’est « rattaché »', sansEntreprise.linked === false);

  const signature = await clientCompany.signingReadiness();
  check('sans entreprise → signature impossible', signature.ready === false);

  /* Une entreprise sans identité de facturation : paiement refusé, signature ok. */
  await publishClientCompany({ billingReady: false });
  const facturation = await clientCompany.billingReadiness();
  check('facturation incomplète → paiement impossible', facturation.ready === false);
  const sign1 = await clientCompany.signingReadiness();
  check('…mais la signature reste possible', sign1.ready === true);

  /* L'inverse. */
  await publishClientCompany({ signerReady: false });
  const facturation2 = await clientCompany.billingReadiness();
  check('sans signataire → facturation possible', facturation2.ready === true);
  const sign2 = await clientCompany.signingReadiness();
  check('…et signature impossible', sign2.ready === false);

  await publishClientCompany();
  check('fiche complète → les deux redeviennent possibles',
    (await clientCompany.billingReadiness()).ready
    && (await clientCompany.signingReadiness()).ready);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4. Le signataire client — publié, jamais saisi ici');
{
  const signataire = await clientCompany.getClientContractualSigner();
  check('le signataire vient de l’entreprise PUBLIÉE', signataire.email === CLIENT_SIGNER.email);
  check('…et il porte la RAISON SOCIALE, pas l’enseigne',
    signataire.companyName === 'SARL CLIENTE DE RECETTE');

  /**
   * UN SIGNATAIRE INCOMPLET N'EST PAS UN SIGNATAIRE. Rendre un objet à moitié
   * rempli laisserait l'appelant décider si « pas de nom » est acceptable.
   */
  await publishClientCompany({
    signerReady: true,
    signer: { firstName: 'Sans', lastName: '', jobTitle: '', email: 'x@y.fr' },
  });
  check('un signataire sans NOM ne se rend pas',
    (await clientCompany.getClientContractualSigner()) === null);
  await publishClientCompany();

  /**
   * ── LE MANAGER NE PEUT PLUS ÉCRIRE `Company.signer` ───────────────────────
   *
   * Un onglet resté ouvert sur l'ancienne version de l'écran l'envoie encore.
   * La requête n'échoue PAS — elle enregistrerait sinon plus rien, horaires
   * compris — mais le champ est ÉCARTÉ.
   */
  const avant = await getSingleton(Company);
  const fiche = await api('GET', '/api/company', { token: adminToken });
  const corps = { ...fiche.json.data, signer: { firstName: 'Intrus', lastName: 'Local', email: 'intrus@x.fr' } };
  const enregistre = await api('PUT', '/api/company', { token: adminToken, body: corps });
  check('la fiche s’enregistre malgré un `signer` envoyé', enregistre.status === 200);
  const apres = await getSingleton(Company);
  check('…mais le signataire local n’a PAS bougé',
    JSON.stringify(apres.signer ?? null) === JSON.stringify(avant.signer ?? null));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5. « Mon entreprise » — lecture seule, et le contact vient du Panel');
{
  const vue = await api('GET', '/api/my-company', { token: adminToken });
  check('la page est lisible par un compte ADMIN', vue.status === 200);
  check('…elle porte l’identité juridique', vue.json.data.company.legalName === 'SARL CLIENTE DE RECETTE');
  check('…et le verdict de complétude', vue.json.data.readiness.ready === true);
  check('…avec le contact du prestataire', 'contactEmail' in (vue.json.data.support ?? {}));

  const sansJeton = await api('GET', '/api/my-company');
  check('sans jeton → refusé', sansJeton.status === 401);

  /**
   * AUCUN VERBE D'ÉCRITURE. Ce n'est pas une simplification à compléter plus
   * tard : laisser le client modifier son identité juridique reviendrait à lui
   * laisser choisir sur quelle entité il est facturé.
   */
  for (const methode of ['PUT', 'PATCH', 'POST', 'DELETE']) {
    // eslint-disable-next-line no-await-in-loop
    const refus = await api(methode, '/api/my-company', { token: devToken, body: { legalName: 'X' } });
    check(`${methode} /api/my-company → refusé`, refus.status === 404 || refus.status === 405);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6. Le curseur de consommation — il SURVIT au redémarrage');
{
  const {
    configureConsumptionPersistence, hydrateConsumption, recordCursor, currentCursor,
    recordApplied, alreadyApplied, recordPullFailure, resetCursor, describeConsumption,
    clearConsumption, resetConsumptionCacheForTests,
  } = await import('../services/panelBridge/consumptionStore.js');
  const { createMongoSyncStateAdapter } = await import(
    '../services/panelBridge/persistence/mongoSyncStateAdapter.js'
  );

  configureConsumptionPersistence(createMongoSyncStateAdapter());
  await clearConsumption();
  await hydrateConsumption({ projectId: 'p-1', generation: 'TEST' });

  check('à froid, aucun curseur', currentCursor() === null);

  /* Consommer cent écritures, puis « redémarrer ». */
  await recordCursor('MTAw');
  for (let i = 0; i < 3; i += 1) await recordApplied(`w-${i}`);
  check('le curseur est posé', currentCursor() === 'MTAw');
  check('…et les écritures appliquées sont retenues', alreadyApplied('w-1'));

  resetConsumptionCacheForTests();
  check('après « redémarrage », le cache est vide', currentCursor() === null);

  const reprise = await hydrateConsumption({ projectId: 'p-1', generation: 'TEST' });
  check('l’hydratation RESTAURE le curseur', reprise.restored === true);
  /**
   * L'ASSERTION DU LOT. Avant, cette valeur repartait à `null` — c'est-à-dire
   * que le projet rejouait tout le journal à chaque démarrage.
   */
  check('…et il vaut ce qu’il valait, JAMAIS zéro', currentCursor() === 'MTAw');
  check('…les compteurs aussi', describeConsumption().appliedTotal === 3);

  /**
   * LES DEUX SEULES REMISES À ZÉRO LÉGITIMES. Un curseur est une position dans
   * un journal FILTRÉ par destinataire : le conserver après un réappairage
   * ferait sauter, définitivement, tout ce qui précède.
   */
  resetConsumptionCacheForTests();
  const autreProjet = await hydrateConsumption({ projectId: 'p-2', generation: 'TEST' });
  check('un AUTRE projet → curseur remis à zéro', autreProjet.restored === false);
  check('…avec le motif nommé', autreProjet.reason === 'PROJECT_CHANGED');

  await recordCursor('MjAw');
  resetConsumptionCacheForTests();
  const autreMonde = await hydrateConsumption({ projectId: 'p-2', generation: 'PROD' });
  check('un AUTRE monde → curseur remis à zéro', autreMonde.reason === 'GENERATION_CHANGED');

  /* Un Panel redémarré, lui, n'est PAS une raison de repartir de zéro. */
  await hydrateConsumption({ projectId: 'p-2', generation: 'PROD' });
  await recordCursor('MzAw');
  resetConsumptionCacheForTests();
  const memeContexte = await hydrateConsumption({ projectId: 'p-2', generation: 'PROD' });
  check('MÊME projet, MÊME monde → curseur CONSERVÉ', memeContexte.restored === true);
  check('…et il vaut toujours la même chose', currentCursor() === 'MzAw');

  /* Le curseur refusé par le Panel : on repart de zéro, en le DISANT. */
  await resetCursor('CURSOR_REFUSED_BY_PANEL');
  check('un curseur refusé est remis à zéro', currentCursor() === null);

  /* Les compteurs de santé montent, et le succès les referme. */
  await recordPullFailure();
  await recordPullFailure();
  check('les échecs consécutifs sont comptés', describeConsumption().consecutivePullFailures === 2);
  await recordCursor('NDAw');
  check('…et une page tirée les referme', describeConsumption().consecutivePullFailures === 0);

  const declare = describeConsumption('CONNECTED');
  check('la déclaration ne porte AUCUNE charge utile',
    Object.keys(declare).every((k) => [
      'cursor', 'lastCursorAdvanceAt', 'lastSuccessfulApplyAt', 'consecutivePullFailures',
      'consecutiveUnreadableChanges', 'appliedTotal', 'state',
    ].includes(k)));
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
