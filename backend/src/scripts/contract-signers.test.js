/* Signataires contractuels : configuration métier, gating de la validation,
 * snapshot figé et immuable, consommation par Yousign, migration.
 * Providers simulés (stub). Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PDFDocument } from 'pdf-lib';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4137';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

/**
 * UN PANEL STUB APPAIRÉ — la signature ne part plus d’ici (R10.5C).
 *
 * Ce fichier éprouve QUELLE IDENTITÉ est envoyée au fournisseur de
 * signature. Elle transite désormais par une capacité du Panel : sans Panel
 * en face, l’ouverture échoue et il n’y a plus rien à inspecter.
 */
const { applyClientCompanyProfile } = await import('../services/panelConfiguration/clientCompany.service.js');
const { PanelClientCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const { createPanelStub } = await import('../services/panelBridge/panelStub.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');
const panelStub = createPanelStub();
bridgeRuntime.configureBridgeRuntime({ clientFactory: () => panelStub });
await bridgeRuntime.pairWithPanel({
  panelUrl: 'https://panel-stub.test',
  pairingCode: 'PAIR-OK',
  publicBackendUrl: 'https://projet-stub.test',
});

const app = createApp();
const server = app.listen(4137);
const base = 'http://localhost:4137';

async function api(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json };
}
async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  return r.json?.data?.token;
}

const { Contract } = await import('../models/Contract.model.js');
const { Company } = await import('../models/Company.model.js');
const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { getSignerGaps, isSignerComplete } = await import('../utils/signer.js');

const devToken = await login('dev@mail.com', '123dev');
const adminToken = await login('admin@mail.com', '123admin');

const DEV_SIGNER = { firstName: 'Luca', lastName: 'Duhoux', jobTitle: 'Gérant', email: 'luca@studio.fr' };
const CLIENT_SIGNER = { firstName: 'Marc', lastName: 'Sbaï', jobTitle: 'Directeur', email: 'marc@sbauto.fr' };

/** Contrat prêt à valider : PDF 2 pages + une zone par rôle. */
async function createReadyContract() {
  const id = (await api('POST', '/api/contracts', { token: devToken })).json.data._id;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  pdf.addPage([595, 842]);
  const pdfBytes = Buffer.from(await pdf.save());
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'contrat.pdf');
  await api('POST', `/api/contracts/${id}/document`, { token: devToken, form });
  await api('PUT', `/api/contracts/${id}/signature-configuration`, {
    token: devToken,
    body: {
      zones: [
        { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
        { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 2, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05, type: 'SIGNATURE' },
      ],
    },
  });
  return id;
}
/**
 * Publie une configuration d'entreprise développeur, comme le ferait le Panel.
 *
 * ── POURQUOI CE HELPER A CHANGÉ DE CIBLE ────────────────────────────────────
 * Il écrivait dans `DevCompany`, la fiche éditée localement. Le signataire
 * développeur est désormais PUBLIÉ par le Panel : écrire ailleurs que là où le
 * code lit ne prouverait plus rien.
 */
const NOM_DEV = 'Studio';
async function setDevSigner(signer) {
  await PanelCompanyConfiguration.updateOne(
    { key: 'SINGLETON' },
    {
      $set: {
        // Une publication réelle porte toujours ces trois clés : sans elles,
        // la configuration est ignorée — et le test ne prouverait rien.
        companyId: '11111111-1111-4111-8111-111111111111',
        slug: 'studio',
        environment: 'TEST',
        version: 1,
        identity: { name: NOM_DEV },
        signer,
        branding: { logoUrl: null },
        appliedAt: new Date(),
        source: 'SYNC',
      },
    },
    { upsert: true },
  );
}

/** Aucune entreprise publiée du tout — le cas « projet sans Panel ». */
async function effacerEntreprisePubliee() {
  await PanelCompanyConfiguration.deleteMany({});
}
/**
 * LE SIGNATAIRE CLIENT NE S’ÉCRIT PLUS ICI — il est PUBLIÉ par le Panel.
 *
 * ══ CE QUE CETTE FONCTION FAISAIT, ET POURQUOI ELLE NE PEUT PLUS ═════════
 *
 * Elle écrivait `Company.signer` — une fiche éditée dans ce Manager. C’était
 * exactement l’autorité que le chantier « entreprise cliente » retire : un
 * client ne choisit pas la personne qui l’engage vis-à-vis de son prestataire,
 * et deux sites d’un même client pouvaient déclarer deux signataires.
 *
 * Elle applique donc désormais un profil d’entreprise cliente REÇU du pont,
 * exactement comme le ferait une publication réelle. Le test éprouve ainsi le
 * chemin de production, pas un raccourci.
 */
const CLIENT_COMPANY_ID = "cc-test-signataires";
async function setClientSigner(signer) {
  const complet = Boolean(signer?.firstName && signer?.lastName && signer?.email);
  await applyClientCompanyProfile({
    clientCompanyId: CLIENT_COMPANY_ID,
    version: (compteurVersionClient += 1),
    environment: 'TEST',
    status: 'ACTIVE',
    legalName: 'SARL CLIENTE DE RECETTE',
    siren: '732829320',
    billingEmail: 'facturation@cliente.test',
    registeredOffice: { line1: '1 rue du Test', postalCode: '06000', city: 'Nice', country: 'FR' },
    billingAddress: { line1: '1 rue du Test', postalCode: '06000', city: 'Nice', country: 'FR' },
    contractualSigner: signer ?? null,
    readiness: {
      state: complet ? 'READY' : 'MISSING_SIGNER',
      ready: complet,
      billing: { ready: true, missing: [] },
      signing: { ready: complet, missing: complet ? [] : ["Signataire — prénom"] },
    },
  }, 'SYNC');
}

/** Aucune entreprise cliente rattachée — le cas « dossier incomplet ». */
async function effacerEntrepriseCliente() {
  await PanelClientCompanyConfiguration.deleteMany({});
}

/** Les versions doivent MONTER : une version antérieure est ignorée. */
let compteurVersionClient = 0;

// --- Migration --------------------------------------------------------------
section('Migration');
{
  // Après bootstrap, les fiches doivent avoir le champ POSÉ à null (pas absent) :
  // « non configuré » doit être un état lisible en base.
  const rawCompany = await Company.collection.findOne({});
  check('Company.signer initialisé à null par la migration', 'signer' in rawCompany && rawCompany.signer === null);

  // Le signataire DÉVELOPPEUR n'est plus une donnée locale : il est publié par
  // le Panel. Ce qui doit être idempotent, c'est donc que le bootstrap ne
  // touche PAS à la configuration reçue.
  await setDevSigner(DEV_SIGNER);
  await bootstrap();
  const apresReboot = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  check('le bootstrap ne réécrit pas la configuration publiée',
    apresReboot?.signer?.email === DEV_SIGNER.email);
  await setDevSigner(null);
}

// --- Règles de complétude ---------------------------------------------------
section('Complétude du signataire');
{
  check('signataire null -> incomplet', !isSignerComplete(null));
  check('null -> les 3 champs requis manquent', getSignerGaps(null).join(',') === 'firstName,lastName,email');
  check('sans email -> incomplet', !isSignerComplete({ firstName: 'A', lastName: 'B', email: '' }));
  check('email invalide -> incomplet', !isSignerComplete({ firstName: 'A', lastName: 'B', email: 'pas-un-email' }));
  check('email invalide -> signalé sur le champ email', getSignerGaps({ firstName: 'A', lastName: 'B', email: 'x@y' }).join(',') === 'email');
  check('fonction facultative -> complet sans jobTitle', isSignerComplete({ firstName: 'A', lastName: 'B', email: 'a@b.fr' }));
  check('espaces seuls -> incomplet', !isSignerComplete({ firstName: '  ', lastName: 'B', email: 'a@b.fr' }));
}

// --- Validation impossible sans signataire ----------------------------------
section('Validation : gating des deux parties');
{
  await setDevSigner(null);
  await setClientSigner(CLIENT_SIGNER);
  const id = await createReadyContract();

  const noDev = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation refusée sans signataire DEV (400)', noDev.status === 400);
  /**
   * LE MESSAGE DIT OÙ LA DONNÉE MANQUE — pas seulement qu'elle manque.
   *
   * Cette identité est publiée par la PLATEFORME, une fois, pour tout le parc.
   * Aucun écran de ce Manager ne la porte. L'ancien libellé laissait chercher
   * ici un réglage qui n'y existe pas.
   */
  check('message : le refus DÉSIGNE la plateforme, pas ce Manager',
    /plateforme/i.test(noDev.json.message) && /Panel/i.test(noDev.json.message));
  check('message : il n’invite PAS à configurer dans ce projet',
    !/dans ce projet|dans SB Auto|ici/i.test(noDev.json.message));
  check('code métier stable PLATFORM_SIGNER_NOT_CONFIGURED',
    noDev.json.details?.code === 'PLATFORM_SIGNER_NOT_CONFIGURED');
  check('details.party = developer', noDev.json.details?.party === 'developer');
  check('contrat resté en DRAFT', (await Contract.findById(id)).status === 'DRAFT');

  // Signataire DEV présent mais incomplet -> message DISTINCT de « non configuré ».
  await setDevSigner({ firstName: 'Luca', lastName: '', jobTitle: '', email: '' });
  const partialDev = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation refusée avec signataire DEV incomplet (400)', partialDev.status === 400);
  check('message : incomplet DEV — nomme les champs manquants',
    /incomplet\s*:\s*nom et email/.test(partialDev.json.message));
  check('message : incomplet DEV — désigne toujours la plateforme',
    /plateforme|Panel/i.test(partialDev.json.message));
  check('details.missing = lastName,email', (partialDev.json.details?.missing || []).join(',') === 'lastName,email');

  // Email syntaxiquement invalide -> incomplet également.
  await setDevSigner({ ...DEV_SIGNER, email: 'luca[at]studio.fr' });
  const badEmail = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation refusée avec email DEV invalide', badEmail.status === 400);
  check('message : incomplet (email)', /incomplet\s*:\s*email/.test(badEmail.json.message));

  // Côté CLIENT.
  await setDevSigner(DEV_SIGNER);
  await setClientSigner(null);
  const noClient = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation refusée sans signataire CLIENT (400)', noClient.status === 400);
  /**
   * ── LE MESSAGE DÉSIGNE LA PLATEFORME, POUR LES DEUX PARTIES ────────────
   *
   * Il disait « Le signataire de l’entreprise cliente n’est pas configuré. »
   * — une phrase qui envoyait l’utilisateur chercher un réglage dans ce
   * Manager. C’était vrai à l’époque ; ça ne l’est plus, et laisser la phrase
   * telle quelle ferait perdre du temps à quelqu’un devant un écran qui ne
   * porte plus ce champ.
   */
  check('message : signataire CLIENT non configuré',
    /signataire contractuel/i.test(noClient.json.message)
    && /pas configuré/i.test(noClient.json.message));
  check('message : il désigne L.Y Solution, pas ce Manager',
    /L\.Y Solution/.test(noClient.json.message)
    && !/dans ce projet/i.test(noClient.json.message));
  check('code : CLIENT_SIGNER_NOT_CONFIGURED',
    noClient.json.details?.code === 'CLIENT_SIGNER_NOT_CONFIGURED');
  check('details.party = client', noClient.json.details?.party === 'client');

  // L'ancien message générique ne doit plus jamais apparaître.
  check('plus de message « Email manquant pour les signataires »', ![noDev, partialDev, noClient].some((r) => /Email manquant pour les signataires/.test(r.json.message || '')));

  // Le signataire ne dépend PLUS du média public `email` de l'entreprise :
  // media désactivé + signataire configuré => validation possible.
  const company = await getSingleton(Company);
  company.media = (company.media || []).map((m) => (m.key === 'email' ? { ...m.toObject(), value: '', enabled: false } : m));
  await company.save();
  await setClientSigner(CLIENT_SIGNER);
  const ok = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation OK malgré le média email public vide/désactivé', ok.status === 200);
  check('contrat -> PENDING_DEV_SIGNATURE', ok.json.data.status === 'PENDING_DEV_SIGNATURE');
}

// --- Snapshot ---------------------------------------------------------------
section('Snapshot contractuel');
let snapshotContractId;
{
  await setDevSigner(DEV_SIGNER);
  await setClientSigner(CLIENT_SIGNER);
  const id = await createReadyContract();
  snapshotContractId = id;
  const validated = await api('POST', `/api/contracts/${id}/validate`, { token: devToken });
  check('validation OK avec les deux signataires', validated.status === 200);

  const snap = (await Contract.findById(id)).signersSnapshot;
  check('snapshot DEV : prénom', snap.developer.firstName === 'Luca');
  check('snapshot DEV : nom', snap.developer.lastName === 'Duhoux');
  check('snapshot DEV : fonction', snap.developer.jobTitle === 'Gérant');
  check('snapshot DEV : email', snap.developer.email === 'luca@studio.fr');
  // Le nom figé vient de l'entreprise PUBLIÉE, pas d'une fiche locale.
  check('snapshot DEV : companyName figé', snap.developer.companyName === NOM_DEV);
  check('snapshot CLIENT : prénom', snap.client.firstName === 'Marc');
  check('snapshot CLIENT : nom', snap.client.lastName === 'Sbaï');
  check('snapshot CLIENT : fonction', snap.client.jobTitle === 'Directeur');
  check('snapshot CLIENT : email', snap.client.email === 'marc@sbauto.fr');
  /**
   * ── LE NOM FIGÉ EST LA RAISON SOCIALE, PLUS L'ENSEIGNE ────────────────────
   *
   * Il valait `Company.name` — le nom COMMERCIAL du site, « SB Auto 06 ». Un
   * contrat n'engage pas une enseigne : il engage la personne morale qui
   * l'exploite, « SARL CLIENTE DE RECETTE » ici. Signer au nom d'une enseigne
   * produit un document dont le signataire ne correspond à aucune entité du
   * registre du commerce.
   *
   * Les deux parties figent donc la même chose : une RAISON SOCIALE, publiée
   * par le Panel.
   */
  check('snapshot CLIENT : companyName figé = la RAISON SOCIALE',
    snap.client.companyName === 'SARL CLIENTE DE RECETTE');
  check('snapshot CLIENT : ce n’est PAS le nom d’enseigne du site',
    snap.client.companyName !== (await getSingleton(Company)).name);

  // Exposé au manager pour affichage. L'ADMIN passe par « mon contrat »
  // (/api/contracts/:id est réservé au DEV), d'où deux surfaces à vérifier.
  check('snapshot sérialisé pour le DEV', validated.json.data.signersSnapshot?.developer?.email === 'luca@studio.fr');
  const adminView = await api('GET', '/api/my-contract', { token: adminToken });
  check('snapshot sérialisé pour l’ADMIN (mon contrat)', adminView.json.data?.signersSnapshot?.client?.email === 'marc@sbauto.fr');

  // La vue éditeur dérive du snapshot : plus de nom d'entreprise en displayName.
  const signers = validated.json.data.signatureConfiguration.signers;
  check('displayName DEV = identité de la personne', signers.find((s) => s.role === 'DEVELOPER').displayName === 'Luca Duhoux');
  check('displayName CLIENT = identité de la personne', signers.find((s) => s.role === 'CLIENT').displayName === 'Marc Sbaï');
}

// --- Immuabilité ------------------------------------------------------------
section('Immuabilité du snapshot');
{
  // Une modification de la fiche Entreprise APRÈS validation ne doit jamais
  // rétro-modifier un contrat déjà figé.
  await setDevSigner({ firstName: 'Autre', lastName: 'Personne', jobTitle: 'Stagiaire', email: 'autre@studio.fr' });
  await setClientSigner({ firstName: 'Nouveau', lastName: 'Client', jobTitle: 'DG', email: 'nouveau@sbauto.fr' });

  const snap = (await Contract.findById(snapshotContractId)).signersSnapshot;
  check('snapshot DEV inchangé après modification de la fiche', snap.developer.email === 'luca@studio.fr');
  check('snapshot DEV : nom inchangé', snap.developer.lastName === 'Duhoux');
  check('snapshot CLIENT inchangé après modification de la fiche', snap.client.email === 'marc@sbauto.fr');
  check('snapshot CLIENT : nom inchangé', snap.client.lastName === 'Sbaï');

  // Un NOUVEAU contrat, lui, prend bien les nouvelles valeurs.
  const freshId = await createReadyContract();
  await api('POST', `/api/contracts/${freshId}/validate`, { token: devToken });
  const freshSnap = (await Contract.findById(freshId)).signersSnapshot;
  check('nouveau contrat : snapshot avec les valeurs à jour', freshSnap.developer.email === 'autre@studio.fr');
  check('les deux contrats coexistent avec des signataires différents', freshSnap.client.email === 'nouveau@sbauto.fr' && snap.client.email === 'marc@sbauto.fr');

  // Restauration pour la suite.
  await setDevSigner(DEV_SIGNER);
  await setClientSigner(CLIENT_SIGNER);
}

// --- Yousign consomme le snapshot -------------------------------------------
section('La signature part avec le snapshot — via la capacité du Panel');
{
  /**
   * ══ CE QUE CETTE SECTION ÉPROUVAIT, ET CE QU’ELLE ÉPROUVE MAINTENANT ═══
   *
   * Elle posait une clé Yousign, récupérait le stub LOCAL du fournisseur et
   * lisait ses appels `addSigner`. Les trois ont disparu : plus de clé
   * locale, plus de client local, plus d’orchestration en cinq appels.
   *
   * Ce qui compte n’a pas changé d’un pouce : l’identité envoyée doit venir
   * du SNAPSHOT CONTRACTUEL, figé à la validation, et non de la fiche
   * Entreprise — modifiée entre-temps quelques lignes plus haut. On inspecte
   * donc ce que le PANEL a réellement reçu, ce qui est la même preuve prise
   * un cran plus loin sur le même chemin.
   */
  const sign = await api(`POST`, `/api/contracts/${snapshotContractId}/start-dev-signature`, { token: devToken });
  check('signature lancée', Boolean(sign.json.data?.signatureLink));

  const ouverture = panelStub.calls.find((c) => c[0] === 'invokeCapability'
    && c[1]?.code === 'signature.request.open');
  check('le Panel a reçu la demande d’ouverture', Boolean(ouverture));

  const signataires = ouverture?.[1]?.input?.signers ?? [];
  check('2 signataires transmis au Panel', signataires.length === 2);

  const dev = signataires.find((x) => x.role === 'DEVELOPER');
  const client = signataires.find((x) => x.role === 'CLIENT');
  check('prénom DEV depuis le snapshot', dev?.firstName === 'Luca');
  check('nom DEV depuis le snapshot', dev?.lastName === 'Duhoux');
  check('email DEV depuis le snapshot', dev?.email === 'luca@studio.fr');
  check('prénom CLIENT depuis le snapshot', client?.firstName === 'Marc');
  check('nom CLIENT depuis le snapshot', client?.lastName === 'Sbaï');
  check('email CLIENT depuis le snapshot', client?.email === 'marc@sbauto.fr');
  check('ordre DEV puis CLIENT préservé', signataires[0]?.role === 'DEVELOPER');

  // Régression : le nom d’entreprise n’est plus découpé en prénom/nom.
  check('plus de nom d’entreprise découpé en prénom/nom',
    dev?.firstName !== 'Studio' && dev?.lastName !== 'Studio');

  /**
   * ET AUCUNE CLÉ N’A ÉTÉ POSÉE POUR EN ARRIVER LÀ. L’ancien préambule de
   * cette section commençait par en écrire une ; la porte est fermée, et
   * c’est ce qui rend la preuve ci-dessus concluante.
   */
  const pose = await api('PUT', '/api/integrated-apis/YOUSIGN/modes/TEST', {
    token: devToken, body: { credentials: { apiKey: 'ys_test_TENTATIVE' } },
  });
  check('aucune clé Yousign ne peut être posée localement', pose.status >= 400);
}
// --- Contrat antérieur (snapshot absent) ------------------------------------
section('Contrat antérieur sans snapshot');
{
  // Un contrat validé avant cette fonctionnalité n'a pas de snapshot : Yousign
  // doit échouer proprement plutôt qu'envoyer une identité vide.
  const { buildSignerPayload } = await import('../services/signature/signature.service.js');
  let msg = '';
  try { buildSignerPayload(null, 'developer'); } catch (e) { msg = e.message; }
  check('payload Yousign refusé si snapshot absent', /Signataire de l'entreprise développeur absent du contrat/.test(msg));
  let clientMsg = '';
  try { buildSignerPayload({ firstName: 'A', lastName: '', email: 'a@b.fr' }, 'client'); } catch (e) { clientMsg = e.message; }
  check('payload Yousign refusé si snapshot partiel', /Signataire de l'entreprise cliente absent du contrat/.test(clientMsg));
}

// --- Validateur HTTP --------------------------------------------------------
section('Validation HTTP des fiches Entreprise');
{
  /**
   * LA FICHE DÉVELOPPEUR LOCALE N'EXISTE PLUS.
   *
   * Elle offrait un second endroit où saisir un signataire, concurrent de
   * celui que le Panel publie. Retirer le formulaire n'aurait pas suffi : la
   * route restait ouverte, et deux vérités avec elle. La surface entière a
   * donc disparu — écriture ET lecture.
   */
  for (const methode of ['GET', 'PUT']) {
    const r = await api(methode, '/api/dev-company', methode === 'GET'
      ? { token: devToken }
      : { token: devToken, body: { name: 'Studio' } });
    check(`${methode} /dev-company n’existe plus (404)`, r.status === 404);
  }

  /**
   * ── LE SIGNATAIRE CLIENT N’EST PLUS ÉCRIT PAR CETTE ROUTE ───────────────
   *
   * ══ CE QUE CES DEUX CONTRÔLES ÉPROUVAIENT ═════════════════════════════
   *
   * Que `PUT /api/company` validait puis enregistrait `Company.signer`. Ce
   * comportement était le DÉFAUT : le client choisissait ainsi la personne
   * qui l’engage vis-à-vis de son prestataire, et deux sites d’un même client
   * pouvaient déclarer deux signataires pour une seule personne morale.
   *
   * ══ CE QU’ILS ÉPROUVENT MAINTENANT ════════════════════════════════════
   *
   * Que la route ÉCARTE le champ — sans refuser la requête. Un onglet resté
   * ouvert sur l’ancienne version de l’écran l’envoie encore : la refuser
   * l’empêcherait d’enregistrer ses HORAIRES D’OUVERTURE, une régression
   * franche pour un champ dont la valeur n’est plus lue par personne.
   */
  const avantEcriture = (await getSingleton(Company)).signer ?? null;
  const tentative = await api('PUT', '/api/company', {
    token: adminToken,
    body: { name: 'Auto Lilas', signer: { firstName: 'Intrus', lastName: 'Local', email: 'intrus@x.fr' } },
  });
  check('PUT company : la fiche s’enregistre malgré un `signer` envoyé', tentative.status === 200);
  check('PUT company : le nom, lui, est bien pris', tentative.json.data.name === 'Auto Lilas');
  const apresEcriture = (await getSingleton(Company)).signer ?? null;
  check('PUT company : le signataire local n’a PAS bougé',
    JSON.stringify(apresEcriture) === JSON.stringify(avantEcriture));

  // L'ÉQUIPE non plus ne s'édite plus ici : elle est publiée par le Panel.
  // Le refus porte un code, pour qu'un appel ancien sache POURQUOI il échoue
  // plutôt que de croire à une panne.
  const equipe = await api('POST', '/api/team', { token: devToken, body: { name: 'X' } });
  check('POST /team refusé (409)', equipe.status === 409);
  check('…avec un code explicite', equipe.json?.code === 'DEV_TEAM_MANAGED_BY_PANEL');
}

await new Promise((r) => server.close(r));
await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
