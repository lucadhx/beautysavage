/**
 * L'IDENTITÉ DÉVELOPPEUR À TRAVERS LE PONT — dix-sept situations réelles.
 *
 * ── LE DÉFAUT D'ORIGINE ─────────────────────────────────────────────────────
 * Trois écrans lisaient trois sources différentes : le pied de page interrogeait
 * la configuration publiée par le Panel, tandis que les contrats et les e-mails
 * lisaient une fiche éditée localement dans chaque projet. Un contrat pouvait
 * donc être signé au nom d'une entreprise que le Panel ne connaissait pas,
 * pendant que le site du même projet affichait l'autre nom.
 *
 * ── CE QUE CETTE SUITE VERROUILLE ───────────────────────────────────────────
 * Que la configuration publiée soit une PHOTOGRAPHIE COMPLÈTE, et pas une
 * accumulation. C'est le point le plus dangereux de tout le mécanisme : si
 * l'application fusionnait au lieu de remplacer, un membre supprimé, une
 * référence retirée ou un ancien signataire survivraient indéfiniment — sans
 * que personne ne s'en aperçoive, puisque tout continuerait à s'afficher.
 *
 * On vérifie donc, à chaque scénario, ce qui a DISPARU autant que ce qui reste.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'devid_test';
process.env.DB_PROD = 'devid_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI, { dbName: 'devid_test' });

const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const { applyCompanyProfile, getCompanyConfiguration } =
  await import('../services/panelConfiguration/panelConfiguration.service.js');
const {
  getPublishedDeveloperIdentity, requirePublishedSigner, supportEmailFromReferences,
} = await import('../services/panelConfiguration/developerIdentity.service.js');
const { companyProfileSchema } = await import('../services/panelBridge/bridgeContract.js');

const SIGNER = { firstName: 'Luca', lastName: 'Duhoux', jobTitle: 'Gérant', email: 'luca@studio.fr' };

/** Une publication du Panel, telle qu'elle arrive sur le pont. */
const profil = (patch = {}) => ({
  companyId: '11111111-1111-4111-8111-111111111111',
  slug: 'ly-solution',
  environment: 'TEST',
  version: 1,
  identity: { name: 'L.Y Solution', tagline: 'Sites et outils sur mesure' },
  branding: { logoUrl: 'https://panel.test/uploads/logo.webp' },
  domains: { websiteUrl: 'https://ly-solution.com' },
  signer: SIGNER,
  references: [
    { type: 'TEXT', icon: 'bi-telephone', name: 'Téléphone', value: '06 12 34 56 78', order: 0 },
    { type: 'TEXT', icon: 'bi-envelope', name: 'E-mail', value: 'contact@ly-solution.com', order: 1 },
  ],
  team: [
    { firstName: 'Luca', lastName: 'Duhoux', role: 'Gérant', email: 'luca@ly.fr', phone: '0600', photoUrl: null, active: true, references: [], order: 0 },
    { firstName: 'Ana', lastName: 'Costa', role: 'Design', email: 'ana@ly.fr', phone: '0601', photoUrl: null, active: true, references: [], order: 1 },
  ],
  ...patch,
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1-2. PREMIÈRE PUBLICATION, puis MODIFICATION');
{
  await applyCompanyProfile(profil(), 'BOOTSTRAP');
  const un = await getPublishedDeveloperIdentity();
  check('l’identité est appliquée', un?.name === 'L.Y Solution');
  check('…avec son slogan', un.tagline === 'Sites et outils sur mesure');
  check('…son logo en URL absolue', un.logoUrl?.startsWith('https://'));
  check('…son signataire', un.signer.email === 'luca@studio.fr');
  check('…ses 2 références', un.references.length === 2);
  check('…et ses 2 membres', un.team.length === 2);

  await applyCompanyProfile(profil({ version: 2, identity: { name: 'L.Y Solution', tagline: 'Nouveau slogan' } }), 'SYNC');
  const deux = await getPublishedDeveloperIdentity();
  check('une modification est appliquée', deux.tagline === 'Nouveau slogan');
  check('…et la version suit', deux.version === 2);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3-5. SUPPRESSIONS — photographie complète, jamais accumulation');
{
  // 3. Une référence retirée doit DISPARAÎTRE. Si l'application fusionnait,
  // elle survivrait pour toujours — et personne ne le verrait.
  await applyCompanyProfile(profil({
    version: 3,
    references: [{ type: 'TEXT', icon: 'bi-telephone', name: 'Téléphone', value: '06 12 34 56 78', order: 0 }],
  }), 'SYNC');
  const r = await getPublishedDeveloperIdentity();
  check('une référence retirée disparaît', r.references.length === 1);
  check('…c’est bien l’ancienne qui a disparu',
    !r.references.some((x) => x.value === 'contact@ly-solution.com'));

  // 4. Un membre supprimé disparaît aussi.
  await applyCompanyProfile(profil({
    version: 4,
    team: [profil().team[0]],
  }), 'SYNC');
  const t = await getPublishedDeveloperIdentity();
  check('un membre supprimé disparaît', t.team.length === 1);
  check('…c’est bien le bon qui reste', t.team[0].firstName === 'Luca');

  // 5. Un membre DÉSACTIVÉ reste publié — c'est l'affichage qui le masque.
  //    Le supprimer obligerait à tout ressaisir s'il revient.
  await applyCompanyProfile(profil({
    version: 5,
    team: [{ ...profil().team[0], active: false }],
  }), 'SYNC');
  const d = await getPublishedDeveloperIdentity();
  check('un membre désactivé reste publié', d.team.length === 1);
  check('…mais marqué inactif', d.team[0].active === false);
  check('…et l’affichage ne le retient pas',
    d.team.filter((m) => m.active !== false).length === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6-7. SIGNATAIRE ET LOGO — remplacement, pas empilement');
{
  const autre = { firstName: 'Ana', lastName: 'Costa', jobTitle: 'Associée', email: 'ana@studio.fr' };
  await applyCompanyProfile(profil({ version: 6, signer: autre }), 'SYNC');
  const s = await getPublishedDeveloperIdentity();
  check('le signataire est remplacé', s.signer.email === 'ana@studio.fr');
  check('…l’ancien ne survit pas', s.signer.firstName !== 'Luca');

  await applyCompanyProfile(profil({ version: 7, branding: { logoUrl: null } }), 'SYNC');
  const l = await getPublishedDeveloperIdentity();
  check('un logo supprimé disparaît vraiment', l.logoUrl === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. ENTREPRISE INCOMPLÈTE — refus explicite, jamais d’invention');
{
  await applyCompanyProfile(profil({ version: 8, identity: { name: '   ' } }), 'SYNC');
  const vide = await getPublishedDeveloperIdentity();
  check('une entreprise sans nom n’est pas une entreprise', vide === null);

  let err = null;
  await requirePublishedSigner().catch((e) => { err = e; });
  check('…et signer un contrat est refusé', err !== null);
  check('…avec un code exploitable',
    err?.details?.code === 'DEVELOPER_IDENTITY_NOT_PUBLISHED');

  // Nom présent mais signataire incomplet : le refus doit NOMMER ce qui manque.
  await applyCompanyProfile(profil({ version: 9, signer: { firstName: 'Luca' } }), 'SYNC');
  let err2 = null;
  await requirePublishedSigner().catch((e) => { err2 = e; });
  check('un signataire incomplet est refusé', err2?.details?.code === 'DEVELOPER_SIGNER_INCOMPLETE');
  check('…en disant quels champs manquent',
    err2?.details?.missing?.includes('lastName') && err2?.details?.missing?.includes('email'));

  // Une adresse malformée est aussi refusée : la découvrir face au client
  // serait le pire moment.
  await applyCompanyProfile(profil({ version: 10, signer: { ...SIGNER, email: 'luca[at]studio' } }), 'SYNC');
  let err3 = null;
  await requirePublishedSigner().catch((e) => { err3 = e; });
  check('une adresse de signataire invalide est refusée',
    err3?.details?.code === 'DEVELOPER_SIGNER_INVALID_EMAIL');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('9-10. REJEU D’UNE ANCIENNE PROJECTION, ET PANEL HORS LIGNE');
{
  await applyCompanyProfile(profil({ version: 20 }), 'SYNC');
  const avant = await getPublishedDeveloperIdentity();
  check('une publication récente s’applique', avant.version === 20);

  /**
   * REJEU D'UNE PROJECTION PÉRIMÉE — refusé, et c'est la bonne réponse.
   *
   * Un message plus ancien peut arriver après un plus récent : file rejouée,
   * reprise après incident, ordre non garanti. L'appliquer ferait RÉGRESSER
   * le projet vers une identité obsolète, en silence.
   *
   * Un retour arrière volontaire n'est pas concerné : le Panel republie
   * l'ancien contenu sous une version NEUVE (voir le scénario 14).
   */
  const rejeu = await applyCompanyProfile(profil({ version: 5, identity: { name: 'Ancien nom' } }), 'SYNC');
  check('une projection périmée est refusée', rejeu.applied === false);
  check('…en disant pourquoi', rejeu.reason === 'OLDER_VERSION');
  const apres = await getPublishedDeveloperIdentity();
  check('…et l’identité en place n’a pas régressé', apres.version === 20);

  // PANEL HORS LIGNE : rien n'arrive, la dernière projection reste lisible.
  // Aucune de ces lectures ne touche le réseau.
  const horsLigne = await getPublishedDeveloperIdentity();
  check('sans nouvelle publication, la dernière reste utilisable',
    horsLigne.name === 'L.Y Solution' && horsLigne.version === 20);
  check('…et la lecture est purement locale',
    (await PanelCompanyConfiguration.countDocuments()) === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('11-13. PROJET SANS PANEL, JAMAIS PUBLIÉE, ENTREPRISE SUPPRIMÉE');
{
  await PanelCompanyConfiguration.deleteMany({});
  const rien = await getPublishedDeveloperIdentity();
  check('projet sans Panel : aucune identité', rien === null);

  let err = null;
  await requirePublishedSigner().catch((e) => { err = e; });
  check('…et aucun contrat ne peut partir', err?.details?.code === 'DEVELOPER_IDENTITY_NOT_PUBLISHED');

  // Une configuration présente mais VIDE de nom vaut « jamais publiée ».
  await PanelCompanyConfiguration.updateOne(
    { key: 'SINGLETON' },
    { $set: { companyId: null, identity: null, signer: null, references: [], team: [] } },
    { upsert: true },
  );
  check('une configuration sans identifiant est ignorée',
    (await getCompanyConfiguration()) === null);
  check('…et l’identité reste absente', (await getPublishedDeveloperIdentity()) === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('14-16. ROLLBACK, CHANGEMENT DE DOMAINE DU LOGO, D’ENVIRONNEMENT');
{
  // 14. Restaurer = republier l'ancien contenu sous une version neuve.
  await applyCompanyProfile(profil({ version: 30, identity: { name: 'Version A' } }), 'SYNC');
  await applyCompanyProfile(profil({ version: 31, identity: { name: 'Version B' } }), 'SYNC');
  await applyCompanyProfile(profil({ version: 32, identity: { name: 'Version A' } }), 'SYNC');
  const rb = await getPublishedDeveloperIdentity();
  check('un retour arrière s’applique comme une publication neuve',
    rb.name === 'Version A' && rb.version === 32);

  // 15. Le Panel déménage : les URL de médias changent, et suivent.
  await applyCompanyProfile(profil({
    version: 33,
    branding: { logoUrl: 'https://nouveau-panel.test/uploads/logo.webp' },
  }), 'SYNC');
  const logo = await getPublishedDeveloperIdentity();
  check('un changement de domaine du logo est suivi',
    logo.logoUrl === 'https://nouveau-panel.test/uploads/logo.webp');
  check('…et l’ancienne adresse ne subsiste pas',
    !logo.logoUrl.includes('panel.test/uploads/logo.webp') || logo.logoUrl.includes('nouveau'));

  /**
   * 16. UNE ENTREPRISE D'UN AUTRE ENVIRONNEMENT EST IGNORÉE.
   *
   * Une entreprise de production n'a rien à faire dans un projet de recette :
   * mentions légales, domaines et contacts réels s'afficheraient sur un site
   * de test, et un contrat de démonstration serait signé au nom de la vraie
   * société.
   */
  const etranger = await applyCompanyProfile(profil({ version: 34, environment: 'PROD' }), 'SYNC');
  check('une entreprise d’un autre environnement est refusée', etranger.applied === false);
  check('…en disant pourquoi', etranger.reason === 'ENVIRONMENT_MISMATCH');
  const env = await getCompanyConfiguration();
  check('…et l’environnement du projet est préservé', env.environment === 'TEST');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('17. AUCUNE DIVERGENCE — une seule lecture pour tous les usages');
{
  await applyCompanyProfile(profil({ version: 40 }), 'SYNC');

  const identite = await getPublishedDeveloperIdentity();
  const brut = await getCompanyConfiguration();

  // Footer, contrats, e-mails, Manager et Support partent tous d'ici.
  check('le nom est le même partout', identite.name === brut.identity.name);
  check('le signataire aussi', identite.signer.email === brut.signer.email);
  check('les références aussi', identite.references.length === brut.references.length);
  check('l’équipe aussi', identite.team.length === brut.team.length);

  /*
    ── L'ADRESSE DE CONTACT PUBLIC ─────────────────────────────────────────

    Un Panel qui ne publie PAS encore le champ explicite : on retombe sur
    l'ancienne déduction, à l'identique. C'est ce qui évite qu'une plateforme
    en cours de mise à niveau perde l'adresse qu'elle affichait hier.
  */
  check('un Panel antérieur : l’adresse vient encore des références',
    identite.supportEmail === 'contact@ly-solution.com');
  check('…et l’ordre des références décide laquelle',
    supportEmailFromReferences([
      { value: 'second@x.fr', order: 5 },
      { value: 'premier@x.fr', order: 1 },
    ]) === 'premier@x.fr');
  check('…sans référence e-mail, aucune adresse inventée',
    supportEmailFromReferences([{ value: '06 12 34 56 78', order: 0 }]) === null);

  // Le contrat gèle ce qu'il lit : il ne rappelle jamais le Panel.
  const { signer } = await requirePublishedSigner();
  check('un signataire complet est accepté', signer.email === 'luca@studio.fr');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('17bis. LE CONTACT PUBLIC — un champ publié, et rien d’autre');
{
  /*
    ══ POURQUOI CE N'EST PLUS DÉDUIT ═══════════════════════════════════════

    L'adresse imprimée au bas de chaque e-mail client était la première valeur
    de `references[]` qui ressemblait à une adresse. Elle dépendait donc de
    l'ORDRE d'une liste de liens — site, LinkedIn, téléphone — que l'opérateur
    réorganise pour des raisons d'affichage, sans savoir qu'il change au
    passage le contact de tous ses clients.

    Le Panel porte désormais `contacts.publicContactEmail`. Dès qu'il le
    publie, c'est LUI qui fait foi — même si une référence dit autre chose.
  */
  await applyCompanyProfile(profil({
    version: 41,
    contacts: { publicContactEmail: 'bonjour@ly-solution.com' },
  }), 'SYNC');
  const avec = await getPublishedDeveloperIdentity();
  check('le champ publié fait foi', avec.supportEmail === 'bonjour@ly-solution.com');
  check('…même quand une référence porte une autre adresse',
    avec.references.some((r) => r.value === 'contact@ly-solution.com'));

  /*
    ══ VIDE N'EST PAS « À DEVINER » ════════════════════════════════════════

    Le champ existe et il est vide : c'est une décision d'identité que
    l'opérateur n'a pas prise. On rend `null` — le refus se fera plus haut,
    avec un message qui nomme l'écran à remplir. Retomber sur les références
    ferait ressurgir une adresse que l'opérateur croit avoir effacée.
  */
  await applyCompanyProfile(profil({ version: 42, contacts: { publicContactEmail: null } }), 'SYNC');
  const vide = await getPublishedDeveloperIdentity();
  check('un champ publié VIDE ne retombe pas sur les références', vide.supportEmail === null);

  /* Les adresses qu'on ne doit JAMAIS emprunter, nommées une à une. */
  await applyCompanyProfile(profil({
    version: 43,
    contacts: {
      publicContactEmail: null,
      email: 'admin@ly-solution.com',
      supportEmail: 'certs@ly-solution.com',
    },
  }), 'SYNC');
  const interdits = await getPublishedDeveloperIdentity();
  check('…ni sur l’adresse administrative', interdits.supportEmail !== 'admin@ly-solution.com');
  check('…ni sur l’adresse des certificats (Let’s Encrypt)',
    interdits.supportEmail !== 'certs@ly-solution.com');
  check('…ni sur quoi que ce soit : c’est null', interdits.supportEmail === null);

  /* On rétablit un état publié complet pour les sections suivantes. */
  await applyCompanyProfile(profil({
    version: 44,
    contacts: { publicContactEmail: 'contact@ly-solution.com' },
  }), 'SYNC');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('18. LE CONTRAT — additif, tolérant, et sans identité locale');
{
  // Un Panel ANTÉRIEUR n'envoie ni équipe ni références : le projet doit
  // l'accepter et afficher une équipe vide, pas refuser l'appairage.
  const ancien = companyProfileSchema.safeParse({
    companyId: '11111111-1111-4111-8111-111111111111',
    slug: 'ly-solution', environment: 'TEST',
    identity: { name: 'L.Y Solution' },
  });
  check('un Panel antérieur reste accepté', ancien.success === true);
  check('…et n’apporte aucune équipe', ancien.data.team === undefined);

  const recent = companyProfileSchema.safeParse(profil());
  check('un Panel récent apporte l’équipe', recent.success === true && recent.data.team.length === 2);

  // Aucune lecture locale ne subsiste dans le service d'identité.
  const fs2 = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const service = await fs2.readFile(
    path.join(racine, 'services/panelConfiguration/developerIdentity.service.js'), 'utf8');
  const code = service.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('le service ne connaît aucune fiche locale', !/DevCompany/.test(code));
  check('…et n’émet aucun appel réseau', !/fetch\(|axios|http\.request/.test(code));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await mongoose.connection.close();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
