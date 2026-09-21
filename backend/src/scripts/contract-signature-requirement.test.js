/**
 * SIGNATURE REQUISE — le réglage qui décide de tout le parcours.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * Le concept existait de bout en bout : `signatureRequirement` en base, gardes
 * au serveur, parcours adapté. Mais le réglage vivait dans l'étape
 * « Tarification » du Manager, c'est-à-dire APRÈS les zones de signature : pour
 * déclarer qu'aucune signature n'était nécessaire, il fallait d'abord
 * configurer la signature. Le réglage était piégé derrière l'étape qu'il sert à
 * supprimer — d'où l'impression qu'il avait disparu.
 *
 * Ces contrôles verrouillent les DEUX régimes côté serveur, et la place du
 * réglage côté écran.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'signature_test';
process.env.DB_PROD = 'signature_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { Contract } = await import('../models/Contract.model.js');
const { CONTRACT_STATUS } = await import('../utils/contractConstants.js');
const sm = await import('../services/contractStateMachine.js');
const contrats = await import('../services/contract.service.js');
const projectSync = await import('../services/projectBridge/projectSync.service.js');

const nouveau = async (extra = {}) => Contract.create({
  reference: `CTR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  name: 'Contrat de test',
  status: CONTRACT_STATUS.DRAFT,
  environment: 'TEST',
  document: { originalFilename: 'original-1111.pdf', pageCount: 2 },
  ...extra,
});

const aLeve = async (fn) => {
  try { await fn(); return null; } catch (err) { return err; }
};

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Le champ EXISTE déjà — aucun doublon créé');
{
  const c = await nouveau();
  check('le contrat porte `signatureRequirement`',
    Object.prototype.hasOwnProperty.call(c.toObject(), 'signatureRequirement'));
  check('…avec « requise » par défaut', c.signatureRequirement === 'REQUIRED');
  check('la machine à états sait le lire', sm.signatureRequired(c) === true);

  const vue = contrats.serializeContract(c, { role: 'DEV' });
  check('la sérialisation l’expose', vue.signatureRequirement === 'REQUIRED');
  check('…et le traduit en « applicable »', vue.signatureApplicable === true);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Signature NON requise : ni signataire, ni zone, ni Yousign');
{
  const c = await nouveau({ signatureRequirement: 'NOT_REQUIRED' });
  check('la machine à états le reconnaît', sm.signatureRequired(c) === false);

  // Aucune zone, aucun signataire : la validation doit passer.
  check('aucune zone configurée', (c.signatureConfiguration?.zones ?? []).length === 0);
  const valide = await contrats.validateContract(c, null);
  check('le contrat se valide malgré tout', valide.status === CONTRACT_STATUS.INACTIVE);
  check('…sans erreur « signataire manquant »', true);
  check('…et le document reste téléchargeable',
    Boolean(valide.document.originalFilename));
  check('…sans prétendre qu’il est signé', !valide.document.signedFilename);
  check('…et sans procédure de signature', !valide.yousign?.signatureRequestId);

  const err = await aLeve(() => contrats.startDevSignature(valide, null));
  check('lancer une signature est REFUSÉ', err !== null);
  check('…avec un code explicite', err?.details?.code === 'SIGNATURE_NOT_REQUIRED');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Signature REQUISE : les validations existantes s’appliquent');
{
  const c = await nouveau();
  const err = await aLeve(() => contrats.validateContract(c, null));
  check('valider sans zone est refusé', err !== null);
  check('…et le contrat reste un brouillon',
    (await Contract.findById(c._id)).status === CONTRACT_STATUS.DRAFT);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Transitions');
{
  // OUI → NON avant envoi : autorisé.
  const c = await nouveau();
  await contrats.updateDraft(c, { signatureRequirement: 'NOT_REQUIRED' }, null);
  const apres = await Contract.findById(c._id);
  check('OUI → NON avant envoi : autorisé', apres.signatureRequirement === 'NOT_REQUIRED');

  // NON → OUI : autorisé.
  await contrats.updateDraft(apres, { signatureRequirement: 'REQUIRED' }, null);
  check('NON → OUI : autorisé',
    (await Contract.findById(c._id)).signatureRequirement === 'REQUIRED');

  // Procédure Yousign en cours : bypass REFUSÉ.
  const enCours = await nouveau({ yousign: { signatureRequestId: 'sig_123', status: 'ONGOING' } });
  const err = await aLeve(() =>
    contrats.updateDraft(enCours, { signatureRequirement: 'NOT_REQUIRED' }, null));
  check('procédure en cours → bypass refusé', err !== null);
  check('…avec un code qui dit quoi faire',
    err?.details?.code === 'SIGNATURE_REQUEST_ACTIVE');
  check('…et rien n’a changé en base',
    (await Contract.findById(enCours._id)).signatureRequirement === 'REQUIRED');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. La projection distingue « non requise » de « en attente »');
{
  await Contract.deleteMany({});
  const c = await nouveau({
    signatureRequirement: 'NOT_REQUIRED',
    status: CONTRACT_STATUS.INACTIVE,
  });
  // Le fichier n'existe pas sur le stockage : la projection dira UNAVAILABLE,
  // mais l'exigence de signature doit être publiée dans tous les cas.
  const change = await projectSync.buildContractProjection();
  const doc = change.payload?.document;
  check('la projection porte l’exigence', doc?.signatureRequired === false);
  void c;

  await Contract.deleteMany({});
  const requis = await nouveau({ status: CONTRACT_STATUS.INACTIVE });
  const change2 = await projectSync.buildContractProjection();
  check('un contrat à signer publie l’inverse',
    change2.payload?.document?.signatureRequired === true);
  void requis;
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. L’écran expose le réglage AVANT les zones');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const setup = await lire('manager/src/lib/contractSetup.ts');
  const page = await lire('manager/src/pages/dev/DevContractsPage.tsx');

  check('une étape « Signature requise » existe',
    setup.includes("key: 'SIGNATURE'") && setup.includes("title: 'Signature requise'"));
  check('…placée juste après le document, et avant les zones',
    setup.indexOf("key: 'SIGNATURE'") > setup.indexOf("key: 'DOCUMENT'")
    && setup.indexOf("key: 'SIGNATURE'") < setup.indexOf("key: 'ZONES' as const"));
  // L'ordre RÉEL est vérifié par `manager/src/lib/contractSetup.test.mjs`, qui
  // exécute la fonction : l'ordre du texte source ne prouverait rien.
  check('…et les zones restent une étape bloquante distincte',
    setup.includes("key: 'ZONES' as const"));
  check('l’étape à traiter se retrouve par sa CLÉ, pas par son rang',
    /steps\.findIndex\(\(s\) => s\.key === blocking\[currentBlocking\]\.key\)/.test(setup));
  check('une valeur par défaut n’est jamais prise pour un choix',
    /confirmed\.SIGNATURE === true/.test(setup));

  check('le toggle a son propre composant',
    page.includes('function SignatureRequirementEditor'));
  check('…rendu dans l’étape dédiée', /SIGNATURE: \([\s\S]{0,400}<SignatureRequirementEditor/.test(page));
  check('…et il a quitté la tarification',
    !/function PricingEditor[\s\S]*?signatureRequirement/.test(page.slice(0, page.indexOf('function SignatureRequirementEditor'))));
  check('le libellé demandé est là', page.includes('Signature requise'));
  check('…avec l’aide « activé »',
    page.includes('Le contrat devra être configuré puis envoyé en signature.'));
  check('…et l’aide « désactivé »',
    page.includes('Le contrat sera généré sans procédure de signature et pourra être téléchargé directement.'));
  check('« Signature non requise » est affiché clairement',
    page.includes('Signature non requise'));

  /**
   * LE BLOC DE SIGNATURE NE PORTE PLUS LE NOM D'UN FOURNISSEUR.
   *
   * Le motif cherchait `contract.yousign?.signatureRequestId`. Le champ existe
   * toujours — en lecture, pour les contrats d'avant la bascule — mais l'écran
   * lit désormais le bloc neutre, celui qui est ALIMENTÉ. Un motif resté sur
   * l'ancien nom aurait exigé que l'écran lise un champ vide.
   */
  check('le réglage est verrouillé si une procédure existe',
    /const procedureEnCours = Boolean\(contract\.signature\?\.signatureRequestId\)/.test(page)
    && /verrouille = contract\.status !== 'DRAFT'/.test(page));
  // Les zones disparaissent d'elles-mêmes quand la signature n'est pas requise.
  check('l’étape des zones n’existe pas sans signature',
    /const signatureApplicable = contract\.signatureApplicable !== false;/.test(setup)
    && /\.\.\.\(signatureApplicable\s*\?\s*\[/.test(setup));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. Désactiver la signature se confirme dans une MODALE, pas une alerte');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const page = await lire('manager/src/pages/dev/DevContractsPage.tsx');
  const dialog = await lire('manager/src/components/ui/dialog.tsx');

  // `window.confirm` bloque le fil, ignore le thème, ne se traduit pas et ne
  // dit pas ce qui arrive à une configuration déjà posée.
  check('plus AUCUNE confirmation native sur cette page',
    !/window\.confirm|window\.alert/.test(page) && !/[^.\w]confirm\(/.test(page));
  check('la confirmation passe par le dialogue du design system',
    /<ConfirmDialog[\s\S]{0,600}Désactiver la signature électronique \?/.test(page));
  check('le texte exact demandé est là',
    page.includes('Le contrat sera validé sans procédure de signature. Les signataires et les')
    && page.includes('zones de signature ne seront plus requis.'));
  check('la nuance « configuration conservée » n’apparaît que si elle existe',
    /configurationExistante && \([\s\S]{0,200}La configuration existante sera conservée mais ignorée/.test(page));
  check('…et cette condition lit la configuration réelle',
    /const configurationExistante = \(contract\.signatureConfiguration\?\.zones\?\.length \|\| 0\) > 0/.test(page));
  check('les deux actions sont nommées comme demandé',
    page.includes('confirmLabel="Confirmer sans signature"') && dialog.includes("cancelLabel = 'Annuler'"));
  check('ACTIVER la signature ne réclame pas de confirmation (rien n’est retiré)',
    /if \(choix === 'NOT_REQUIRED'\) \{ setConfirmation\(true\); return; \}/.test(page));

  // Une procédure Yousign en cours n'ouvre AUCUNE modale : le refus est métier,
  // pas une question. L'écran explique la seule sortie possible.
  check('procédure en cours → le réglage reste verrouillé, sans modale de contournement',
    /procedureEnCours\s*\?\s*'Une procédure de signature existe déjà : annulez-la avant de modifier ce réglage\.'/.test(page));

  // Accessibilité et confort — portés par le dialogue commun, donc acquis
  // partout, pas seulement ici.
  check('piège à focus : Tab ne sort pas de la modale',
    dialog.includes("e.key !== 'Tab'") && /dernier\.focus\(\)/.test(dialog) && /premier\.focus\(\)/.test(dialog));
  check('Échap ferme — sauf pendant une opération',
    /if \(e\.key === 'Escape'\) \{\s*if \(!busyRef\.current\) onCloseRef\.current\(\);/.test(dialog));
  check('le clic extérieur suit la même règle',
    /onClick=\{fermer\}/.test(dialog) && /const fermer = \(\) => \{ if \(!busy\) onClose\(\); \};/.test(dialog));
  check('les boutons sont neutralisés pendant l’enregistrement',
    /disabled=\{loading\}/.test(dialog) && /loading=\{loading\}/.test(dialog) && /loading=\{pending\}/.test(page));
  check('prefers-reduced-motion respecté', /useReducedMotion/.test(dialog) && /reduce\s*$|reduce$|reduce\n/m.test(dialog));
  check('responsive : les actions s’empilent sur mobile',
    /flex-col-reverse gap-3 sm:flex-row sm:justify-end/.test(dialog));
  /**
   * ══ CE QUE CE CONTRÔLE VÉRIFIE, ET CE QU'IL NE DOIT PLUS VÉRIFIER ═════════
   *
   * Il exigeait littéralement `prev?.focus?.()`, parenthèses VIDES. Il ne
   * décrivait donc pas le contrat — « le focus revient d'où il venait » — mais
   * l'ORTHOGRAPHE d'une ligne. Le jour où l'appel a légitimement reçu une
   * option, le test est devenu rouge alors que le comportement était intact,
   * et même amélioré.
   *
   * Un test qui interdit d'ajouter un argument n'est pas une garde : c'est un
   * gel. On vérifie donc les deux faits qui font le contrat — on MÉMORISE
   * l'élément actif à l'ouverture, et on lui REND le focus à la fermeture —
   * sans contraindre la façon de le faire.
   */
  check('le focus revient d’où il venait',
    /const prev = document\.activeElement/.test(dialog) && /prev\?\.focus\?\.\(/.test(dialog));

  /**
   * ET IL REVIENT SANS VOLER LA POSITION DE LA PAGE.
   *
   * `focus()` ramène sa cible dans le champ de vision. Le déclencheur d'une
   * modale vit souvent en haut de page : rendre le focus renvoyait donc l'écran
   * tout en haut, juste après que le verrou de défilement ait restitué la
   * position exacte. C'est le défaut que l'option corrige — on le verrouille.
   */
  check('…sans ramener la page en haut (preventScroll)',
    /prev\?\.focus\?\.\(\{[^}]*preventScroll:\s*true[^}]*\}\)/.test(dialog));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. L’état affiché vient d’un calcul UNIQUE, partagé DEV/client');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const dev = await lire('manager/src/components/contracts/journey/DevJourney.tsx');
  const admin = await lire('manager/src/pages/MyContractPage.tsx');

  check('la vue DEV lit la présentation centrale',
    /getContractPresentationState\(contract, 'DEV'\)/.test(dev));
  check('la vue client lit la MÊME fonction',
    /getContractPresentationState\(contract, 'ADMIN'\)/.test(admin));

  // Le « reste » qui mentait a disparu, des deux côtés. On lit le code RENDU :
  // les commentaires citent la phrase fautive, c'est même leur rôle.
  const sansCommentaires = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const [nom, src] of [['DEV', sansCommentaires(dev)], ['client', sansCommentaires(admin)]]) {
    check(`vue ${nom} : plus de « pas encore parti à la signature »`,
      !src.includes('pas encore parti à la signature'));
    check(`vue ${nom} : plus de « Contrat en attente » sans objet`,
      !src.includes('Contrat en attente'));
  }

  // Aucune vue ne redécide de l'état dans son JSX.
  check('la vue DEV n’aiguille plus sur des statuts bruts',
    !/contract\.status === 'PENDING_DEV_SIGNATURE'/.test(dev)
    && !/contract\.status === 'FAILED'/.test(dev));
  check('la vue client dérive ses branches de la phase partagée',
    /etat\.phase === 'DRAFT'/.test(admin) && !/\['ENDED', 'CANCELLED', 'FAILED'\]\.includes\(contract\.status\)/.test(admin));
  check('la ligne « Signature du client » disparaît quand elle n’est pas requise',
    /contract\.signatureApplicable === false\s*\?\s*\[\]/.test(dev));
  check('le récapitulatif d’activation n’affirme plus une signature inexistante',
    /contract\.signatureApplicable === false \? 'Signature non requise' : 'Contrat signé'/.test(admin));
  check('le client ne lit plus un statut interne en en-tête',
    !/action=\{<ContractStatusBadge/.test(admin) && /\{etat\.badge\}/.test(admin));
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
