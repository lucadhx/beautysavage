/* Tests SIGNATURE — ce qui reste au projet après le cutover control plane.
 *
 * Ce fichier s'appelait `yousign.test.js`. Il n'éprouve aucun fournisseur — il
 * n'y en a plus ici — mais les règles de signature du projet, et l'ABSENCE de
 * toute surface fournisseur locale. Le nom désignait la seule chose qui n'y
 * était pas.
 *
 * Les coordonnées et la validation de zones sont des règles MÉTIER de ce projet :
 * elles décrivent où signer sur un contrat, pas comment parler à un fournisseur.
 * Elles restent donc ici, et restent éprouvées à l identique.
 *
 * Tout le reste — multipart, orchestration, nettoyage, erreurs fournisseur,
 * HMAC de webhook — a migré vers le Panel. Ce fichier en garde l ABSENCE.
 * Runner autonome. */

process.env.ENV = 'TEST';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}
function section(n) {
  console.log(`\n${n}`);
}

// --- Coordonnées ------------------------------------------------------------
section('Conversion des coordonnées de zone');
const coords = await import('../services/signature/signatureCoordinates.js');
{
  const zone = { page: 1, xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1, type: 'SIGNATURE' };
  const page = { width: 1000, height: 1000 };

  const tl = coords.mapZoneToField(zone, page, { origin: 'top-left', pageIndexBase: 1 });
  check('x = xRatio*width', tl.x === 100);
  check('width = widthRatio*width', tl.width === 300);
  check('height = heightRatio*height', tl.height === 100);
  check('y (top-left) = yRatio*height', tl.y === 200);
  check('page 1-indexée conservée', tl.page === 1);

  const bl = coords.mapZoneToField(zone, page, { origin: 'bottom-left', pageIndexBase: 1 });
  check('y (bottom-left) = (1-yRatio)*h - height', bl.y === 700);

  const base0 = coords.mapZoneToField(zone, page, { origin: 'top-left', pageIndexBase: 0 });
  check('pageIndexBase=0 -> page 0', base0.page === 0);

  // Clamping taille mini signature (37 px de haut)
  const tiny = coords.mapZoneToField({ ...zone, heightRatio: 0.01 }, page);
  check('hauteur < 37 clampée à 37', tiny.height === 37);

  let threwNoPage = false;
  try {
    coords.mapZoneToField(zone, null);
  } catch {
    threwNoPage = true;
  }
  check('lève si dimensions de page manquantes', threwNoPage);
}

// --- Validation de zones ----------------------------------------------------
section('Validation de zones');
{
  const good = [
    { id: 'z1', name: 'DEV', signerRole: 'DEVELOPER', page: 1, xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05 },
    { id: 'z2', name: 'CLIENT', signerRole: 'CLIENT', page: 1, xRatio: 0.5, yRatio: 0.8, widthRatio: 0.2, heightRatio: 0.05 },
  ];
  check('zones valides -> 0 erreur', coords.validateZones(good, { pageCount: 1, signerRolesPresent: ['DEVELOPER', 'CLIENT'] }).length === 0);

  check('aucune zone -> erreur', coords.validateZones([], { pageCount: 1 }).length > 0);

  const missingRole = coords.validateZones([good[0]], { pageCount: 1, signerRolesPresent: ['DEVELOPER', 'CLIENT'] });
  check('rôle CLIENT manquant détecté', missingRole.some((e) => /CLIENT/.test(e)));

  const offPage = coords.validateZones([{ ...good[0], page: 3 }], { pageCount: 1 });
  check('page inexistante détectée', offPage.some((e) => /inexistante/.test(e)));

  const zeroSize = coords.validateZones([{ ...good[0], widthRatio: 0 }], { pageCount: 1 });
  check('taille nulle détectée', zeroSize.some((e) => /nulle/.test(e)));

  const overflow = coords.validateZones([{ ...good[0], xRatio: 0.95, widthRatio: 0.2 }], { pageCount: 1 });
  check('dépassement de bord détecté', overflow.some((e) => /dépasse/.test(e)));
}

// --- Statuts ----------------------------------------------------------------
section('Traduction des statuts');
const ys = await import('../services/signature/signature.service.js');
{
  /**
   * LE VOCABULAIRE NEUTRE D'ABORD, LE VOCABULAIRE HÉRITÉ ENSUITE.
   *
   * Le Panel rend désormais un `state` NORMALISÉ — il connaît les deux
   * fournisseurs, ce projet n'en connaît aucun. La table reste ici parce que
   * c'est la SÉMANTIQUE CONTRACTUELLE qu'elle décrit (« la demande est-elle
   * close ? »), et cela ne regarde pas la plateforme.
   *
   * Elle continue d'accepter les mots d'hier : les contrats déjà ouverts chez
   * l'ancien fournisseur sont relus par cette même fonction, et les oublier
   * aurait fait basculer leur statut à NONE au premier passage de
   * réconciliation.
   */
  check('mapRequestStatus DONE -> DONE', ys.mapRequestStatus('DONE') === 'DONE');
  check('mapRequestStatus ONGOING -> ONGOING', ys.mapRequestStatus('ONGOING') === 'ONGOING');
  check('mapRequestStatus DECLINED -> DECLINED', ys.mapRequestStatus('DECLINED') === 'DECLINED');
  check('mapRequestStatus done (hérité) -> DONE', ys.mapRequestStatus('done') === 'DONE');
  check('mapRequestStatus ongoing (hérité) -> ONGOING', ys.mapRequestStatus('ongoing') === 'ONGOING');
  check('mapRequestStatus declined (hérité) -> DECLINED', ys.mapRequestStatus('declined') === 'DECLINED');
  check('mapRequestStatus inconnu -> NONE', ys.mapRequestStatus('???') === 'NONE');
}

// --- LE CUTOVER, PROUVÉ PAR L'ABSENCE ---------------------------------------
section('Cutover : plus aucune surface fournisseur locale');
{
  /**
   * ══ CE QUE CE FICHIER ÉPROUVAIT AVANT R10.5C ═══════════════════════════════
   *
   * Un client Yousign local : multipart d'upload, orchestration en cinq appels,
   * nettoyage du brouillon, extraction des erreurs, repli sans redirections
   * pour les abonnements Trial, et vérification HMAC des webhooks.
   *
   * Tout cela vit désormais dans le PANEL. Ce projet demande un verbe et reçoit
   * un fait. Le fichier garde donc l'ABSENCE — une absence d'export ne se
   * contourne pas : il n'y a aucun comportement à simuler.
   */
  for (const parti of [
    'verifyWebhookSignature', 'verifyYousignWebhookAnyMode',
    'getSignatureProvider', 'buildDocumentUploadForm', 'toSafePdfFilename',
  ]) {
    check(`NO_LOCAL_SURFACE — « ${parti} » n’est plus exporté`, ys[parti] === undefined);
  }

  const { readFileSync, existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');
  const srcRoot = fileURLToPath(new URL('../', import.meta.url));

  for (const mort of ['yousign.provider.js', 'yousign.stub.js', 'yousign.errors.js']) {
    check(`NO_LOCAL_CLIENT — ${mort} a disparu`,
      !existsSync(join(srcRoot, 'services', 'yousign', mort)));
  }

  const service = readFileSync(join(srcRoot, 'services', 'signature', 'signature.service.js'), 'utf8');
  check('NO_LOCAL_CALL — le service ne fait aucun fetch', !/\bfetch\(/.test(service));
  check('NO_LOCAL_SECRET — ni ne lit de credential Yousign',
    !/getCredential\(['"]YOUSIGN/.test(service) && !/tryGetCredential\(['"]YOUSIGN/.test(service));
  /**
   * On cherche un REPLI, pas le mot. Le commentaire du service explique
   * justement qu'il n'y a plus de stub — chercher la chaîne aurait fait
   * échouer le test sur sa propre documentation.
   *
   * Le motif vise désormais la LECTURE d'un aiguillage (`process.env.…`), pas
   * la sous-chaîne `SIGNATURE_PROVIDER` : depuis la bascule, le service porte
   * un code de refus nommé `SIGNATURE_PROVIDER_CREDITS_EXHAUSTED`, qui ne
   * choisit rien — il RAPPORTE ce que la plateforme a répondu. Le test
   * échouait donc sur un message d'erreur, c'est-à-dire sur rien.
   */
  check('NO_FALLBACK — aucun aiguillage de provider, aucun stub instancié',
    !/process\.env\.[A-Z0-9_]*SIGNATURE_PROVIDER/.test(service)
    && !/createYousignStub/.test(service)
    && !/getSignatureProvider/.test(service));
  check('CONTROL_PLANE — il demande des capacités au Panel',
    /invokeCapability/.test(service));

  // Le provisionnement du webhook a suivi : plus aucun manager local.
  const providers = readFileSync(join(srcRoot, 'services', 'webhooks', 'integrationWebhookProviders.js'), 'utf8');
  check('NO_LOCAL_WEBHOOK_PROVISIONING — Yousign a quitté la table',
    !/yousignProvider|yousignManager/.test(providers));

  const routes = readFileSync(join(srcRoot, 'routes', 'webhook.routes.js'), 'utf8');
  check('NO_LOCAL_WEBHOOK_ENDPOINT — aucune route /yousign', !/['"]\/yousign/.test(routes));

  /**
   * LE CATALOGUE NOMME UN DOMAINE, PLUS UN FOURNISSEUR.
   *
   * L'entrée s'appelait `YOUSIGN`. La chercher encore ici, après la bascule,
   * reviendrait à vérifier qu'un écran affiche le nom du fournisseur qui NE
   * SERT PLUS — et à rendre le prochain changement coûteux pour rien.
   */
  const catalogue = await import('../utils/integratedApiCatalog.js');
  const table = catalogue.INTEGRATED_API_CATALOG ?? catalogue.default.INTEGRATED_API_CATALOG;
  check('NO_PROVIDER_ENTRY — aucune entrée au nom d’un fournisseur',
    table.YOUSIGN === undefined && table.OPENSIGN === undefined);
  const y = table.SIGNATURE;
  check('DOMAIN_ENTRY — le domaine « signature » est au catalogue', Boolean(y));
  check('NO_CREDENTIAL_UI — le catalogue ne déclare aucun champ', y.fields.length === 0);
  check('AUTHORITY_PANEL — et annonce l’autorité de la plateforme', y.authority === 'PANEL');
}

// --- Le signataire, construit depuis le SNAPSHOT ----------------------------
section('Payload signataire — depuis le snapshot contractuel');
{
  const snap = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@exemple.fr' };

  const dev = ys.buildSignerPayload(snap, 'developer');
  check('rôle DEVELOPER attribué', dev.role === 'DEVELOPER');
  check('identité reprise du snapshot',
    dev.firstName === 'Ada' && dev.lastName === 'Lovelace' && dev.email === 'ada@exemple.fr');
  check('aucune adresse de retour portée par le signataire', dev.returnUrl === undefined);

  const client = ys.buildSignerPayload(snap, 'client');
  check('rôle CLIENT attribué', client.role === 'CLIENT');
  /**
   * IL N'Y A PLUS DE REDIRECTION PAR SIGNATAIRE.
   *
   * Le signataire en portait trois (succès, erreur, refus). La plateforme
   * n'accepte qu'UNE adresse de retour, pour tout le document, sans paramètre
   * ajouté — c'est une contrainte du fournisseur, mesurée, pas un choix.
   *
   * Ce que ce test garde, c'est l'INTERDICTION : si quelqu'un remet une
   * redirection ici, elle serait silencieusement ignorée à l'ouverture, et le
   * signataire atterrirait ailleurs que là où le code prétend l'envoyer.
   */
  check('aucun signataire ne porte d’adresse de retour',
    client.returnUrl === undefined && client.redirectUrls === undefined);

  /**
   * L'IDENTITÉ NE S'INVENTE PAS. Un snapshot incomplet ne peut venir que d'un
   * contrat corrompu : on échoue ICI plutôt que d'envoyer une identité vide que
   * le Panel rejetterait avec un message plus lointain.
   */
  for (const partiel of [
    { lastName: 'X', email: 'a@b.fr' },
    { firstName: 'X', email: 'a@b.fr' },
    { firstName: 'X', lastName: 'Y' },
    {},
    null,
  ]) {
    let leve = false;
    try { ys.buildSignerPayload(partiel, 'client'); } catch { leve = true; }
    check(`snapshot incomplet refusé (${JSON.stringify(partiel)})`, leve);
  }
}

// --- La limite de document, côté projet -------------------------------------
section('Document : la limite est refusée AVANT le pont');
{
  /**
   * 10 Mio — ET C'EST UNE BAISSE ASSUMÉE.
   *
   * La limite était de 12 Mio, taillée pour l'ancien fournisseur. Le nouveau
   * reçoit le document en base64 dans un corps JSON : le laisser à 12 Mio
   * aurait fait passer localement des documents refusés PLUS LOIN, au moment
   * le plus coûteux — après le transport, avec un message du fournisseur.
   */
  check('la limite est déclarée', ys.MAX_DOCUMENT_BYTES === 10 * 1024 * 1024);

  /**
   * Le Panel tranche en dernier ressort, mais transporter 20 Mio en base64 sur
   * le pont pour s'entendre dire non serait absurde. Le refus local est une
   * politesse pour l'appelant, pas une seconde autorité.
   */
  const contrat = {
    _id: 'c-trop-gros',
    reference: 'CTR-XL',
    signersSnapshot: {
      developer: { firstName: 'A', lastName: 'B', email: 'a@b.fr' },
      client: { firstName: 'C', lastName: 'D', email: 'c@d.fr' },
    },
    signatureConfiguration: { zones: [{ page: 1, signerRole: 'CLIENT', xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05 }] },
    document: { pageSizes: [{ page: 1, width: 595, height: 842 }] },
  };
  const enorme = { buffer: Buffer.alloc(ys.MAX_DOCUMENT_BYTES + 1), filename: 'gros.pdf' };

  let refus = null;
  try {
    await ys.createContractSignatureRequest(contrat, enorme);
  } catch (err) { refus = err; }
  check('un document > 12 Mio est refusé', refus !== null);
  check('…avec un code stable',
    refus?.details?.code === 'SIGNATURE_DOCUMENT_TOO_LARGE'
    || /trop volumineux/i.test(refus?.message ?? ''));
  check('…et un message qui dit quoi faire', /Allégez le PDF/.test(refus?.message ?? ''));

  let vide = null;
  try {
    await ys.createContractSignatureRequest(contrat, { buffer: Buffer.alloc(0), filename: 'v.pdf' });
  } catch (err) { vide = err; }
  check('un document vide est refusé', vide !== null);
}

// --- Sans Panel appairé, rien ne part ---------------------------------------
section('Sans plan de contrôle, la signature échoue franchement');
{
  /**
   * AUCUN REPLI. Le stub local a disparu : quand le Panel est injoignable, la
   * signature échoue, et c'est la bonne réponse. Un repli supposerait une clé
   * locale — exactement ce que le cutover supprime.
   */
  const contrat = {
    _id: 'c-sans-panel',
    reference: 'CTR-NP',
    signersSnapshot: {
      developer: { firstName: 'A', lastName: 'B', email: 'a@b.fr' },
      client: { firstName: 'C', lastName: 'D', email: 'c@d.fr' },
    },
    signatureConfiguration: { zones: [{ page: 1, signerRole: 'CLIENT', xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.05 }] },
    document: { pageSizes: [{ page: 1, width: 595, height: 842 }] },
  };

  let sansPanel = null;
  try {
    await ys.createContractSignatureRequest(contrat, { buffer: Buffer.from('%PDF-1.4'), filename: 'c.pdf' });
  } catch (err) { sansPanel = err; }
  check('NO_FALLBACK — sans Panel appairé, l’ouverture échoue', sansPanel !== null);
  check('…et le message nomme la plateforme',
    /plateforme|Panel/i.test(sansPanel?.message ?? ''));

  for (const lecture of [
    () => ys.getSignerLink('req-1', 'signer-1'),
    () => ys.getSignatureRequestStatus('req-1'),
    () => ys.downloadSignedDocument('req-1'),
    () => ys.cancelSignatureRequest('req-1'),
  ]) {
    let leve = false;
    try { await lecture(); } catch { leve = true; }
    check('…et toute lecture/écriture échoue aussi, sans repli', leve);
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
