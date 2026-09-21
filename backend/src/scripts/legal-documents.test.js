/* LES DOCUMENTS LÉGAUX, CÔTÉ PROJET — reçus, appliqués, servis. Jamais rédigés.
 *
 * ══ CE QUE CETTE SUITE VERROUILLE ═══════════════════════════════════════════
 *
 *   1. L'APPLICATION    ce que le pont livre est persisté, avec ses gardes :
 *                       monde, VERSION, et surtout le PROJET DESTINATAIRE.
 *   2. L'ISOLATION      un document qui nomme un autre projet est REFUSÉ. C'est
 *                       la seconde barrière multi-tenant, celle que ce côté-ci
 *                       tient — l'audience de l'écriture étant la première.
 *   3. LE SERVICE       la route publique rend le document, ou 404. Aucun repli
 *                       sur un texte générique : des mentions légales
 *                       approximatives sont pires qu'absentes.
 *   4. LE FALLBACK      une fois reçu, le document reste servi. Le Panel peut
 *                       disparaître : la page ne se vide pas.
 *   5. LE PIED DE PAGE  le bootstrap n'annonce que les documents RÉELLEMENT
 *                       servis — un lien codé en dur serait un lien mort.
 *
 * Runner autonome sur mongodb-memory-server. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.PORT = '4179';
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

const legal = await import('../services/panelConfiguration/legalDocument.service.js');
const { LegalDocument } = await import('../models/LegalDocument.model.js');
const { setPairing, clearPairing } = await import('../services/panelBridge/pairingStore.js');
const contract = await import('../services/panelBridge/bridgeContract.js');

const app = createApp();
const server = app.listen(4179);
const base = 'http://localhost:4179';

const get = async (path) => {
  const res = await fetch(`${base}${path}`);
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

/* -------------------------------------------------------------------------- */
/*  FIXTURES                                                                  */
/* -------------------------------------------------------------------------- */

const MOI = '11111111-1111-4111-8111-111111111111';
const AUTRE = '22222222-2222-4222-8222-222222222222';

/**
 * L'APPAIRAGE EST LA SOURCE DE NOTRE IDENTITÉ.
 *
 * C'est lui que l'applicateur compare au `projectId` du document. Sans
 * appairage, le projet n'a AUCUN moyen de vérifier à qui s'adresse ce qu'il
 * reçoit — et il doit refuser plutôt que d'accepter à l'aveugle.
 */
await setPairing({
  panelUrl: 'https://panel.test',
  projectId: MOI,
  panelName: 'Panel de recette',
  bridgeToken: 'jeton-de-recette-suffisamment-long-0123456789',
});

/** Un document conforme, paramétrable pour éprouver chaque garde. */
function document({
  type = 'LEGAL_NOTICE',
  projectId = MOI,
  documentVersion = 1,
  templateVersion = 1,
  templateId = 'lt-a',
  environment = 'TEST',
  marqueur = 'CONTENU-A',
} = {}) {
  return {
    type,
    projectId,
    templateId,
    templateName: 'Template de recette',
    templateVersion,
    documentVersion,
    environment,
    title: type === 'LEGAL_NOTICE' ? 'Mentions légales' : 'Politique de confidentialité',
    sections: [
      {
        heading: 'Éditeur du site',
        blocks: [
          { type: 'PARAGRAPH', text: `${marqueur} — édité par une entreprise de recette.` },
          { type: 'FIELDS', items: [{ label: 'SIRET', value: '11111111100011' }] },
          { type: 'LIST', items: ['Première puce', 'Seconde puce'] },
        ],
      },
    ],
    updatedAt: '2026-08-25T10:00:00.000Z',
  };
}

/* -------------------------------------------------------------------------- */

section('1. Le contrat — LEGAL_DOCUMENT est déclaré ET appliqué');
{
  check('déclaré aux entityType', contract.SYNC_ENTITY_TYPES.includes('LEGAL_DOCUMENT'));
  check('APPLIQUÉ (pas seulement déclaré)', contract.APPLIED_ENTITY_TYPES.includes('LEGAL_DOCUMENT'));
  check('version du contrat à 1.15.0', contract.CONTRACT_VERSION === '1.15.0');

  check('un document conforme passe le schéma',
    contract.legalDocumentPayloadSchema.safeParse(document()).success);
  check('un champ inconnu est REFUSÉ (schéma fermé)',
    !contract.legalDocumentPayloadSchema.safeParse({ ...document(), intrus: true }).success);
  check('un bloc de type inconnu est REFUSÉ',
    !contract.legalDocumentPayloadSchema.safeParse({
      ...document(),
      sections: [{ heading: '', blocks: [{ type: 'TABLE', rows: [] }] }],
    }).success);
  check('un document SANS section est REFUSÉ',
    !contract.legalDocumentPayloadSchema.safeParse({ ...document(), sections: [] }).success);
}

section('2. ISOLATION — un document qui nomme un autre projet est REFUSÉ');
{
  const etranger = await legal.applyLegalDocument(document({ projectId: AUTRE }), 'SYNC', 'e-1');
  check('refusé', etranger.applied === false);
  check('… avec la bonne raison', etranger.reason === 'PROJECT_MISMATCH');
  check('… et RIEN n’est persisté', (await LegalDocument.countDocuments()) === 0);

  /**
   * SANS APPAIRAGE, ON NE PEUT RIEN VÉRIFIER — donc on refuse.
   *
   * C'est le bon défaut : un document arrivé hors appairage n'a aucune raison
   * d'être appliqué, et l'accepter reviendrait à faire confiance à l'émetteur
   * sur parole.
   */
  await clearPairing();
  const sansAppairage = await legal.applyLegalDocument(document(), 'SYNC', 'e-2');
  check('un projet NON APPAIRÉ refuse tout document', sansAppairage.applied === false);
  check('… avec la même raison', sansAppairage.reason === 'PROJECT_MISMATCH');
  await setPairing({
    panelUrl: 'https://panel.test',
    projectId: MOI,
    panelName: 'Panel de recette',
    bridgeToken: 'jeton-de-recette-suffisamment-long-0123456789',
  });
}

section('3. Les gardes d’application');
{
  const autreMonde = await legal.applyLegalDocument(document({ environment: 'PROD' }), 'SYNC', 'e-3');
  check('un document de PROD est refusé sur un projet TEST',
    autreMonde.applied === false && autreMonde.reason === 'ENVIRONMENT_MISMATCH');

  const invalide = await legal.applyLegalDocument({ type: 'LEGAL_NOTICE' }, 'SYNC', 'e-4');
  check('une charge utile non conforme est refusée',
    invalide.applied === false && invalide.reason === 'INVALID_PAYLOAD');

  const premier = await legal.applyLegalDocument(document({ documentVersion: 5 }), 'SYNC', 'entity-notice');
  check('un document conforme est APPLIQUÉ', premier.applied === true);

  const vieux = await legal.applyLegalDocument(
    document({ documentVersion: 4, marqueur: 'CONTENU-PERIME' }), 'SYNC', 'entity-notice',
  );
  check('une version ANTÉRIEURE est ignorée',
    vieux.applied === false && vieux.reason === 'OLDER_VERSION');

  const servi = await legal.getLegalDocument('LEGAL_NOTICE');
  check('… et le contenu servi n’a pas bougé',
    JSON.stringify(servi).includes('CONTENU-A') && !JSON.stringify(servi).includes('CONTENU-PERIME'));

  /**
   * ══ LE PIÈGE DU CHANGEMENT D'AFFECTATION ═════════════════════════════════
   *
   * Le Panel bascule le projet vers un AUTRE template, publié en version 1
   * alors que le précédent servait en version 9. La garde d'obsolescence doit
   * regarder `documentVersion` — le compteur PAR PROJET — et non
   * `templateVersion`, sans quoi le nouveau document serait rejeté comme
   * périmé et le site afficherait l'ancien pour toujours.
   */
  const bascule = await legal.applyLegalDocument(
    document({
      documentVersion: 6, templateVersion: 1, templateId: 'lt-b', marqueur: 'CONTENU-B',
    }),
    'SYNC',
    'entity-notice',
  );
  check('un template DIFFÉRENT en version 1 est ACCEPTÉ (documentVersion croît)',
    bascule.applied === true);
  const apresBascule = await legal.getLegalDocument('LEGAL_NOTICE');
  check('… et c’est bien le nouveau contenu qui est servi',
    JSON.stringify(apresBascule).includes('CONTENU-B'));
  check('… avec le nouveau template annoncé', apresBascule.templateId === 'lt-b');
}

section('4. Le service public — 200 avec le contenu, 404 sans repli');
{
  const mentions = await get('/api/public/legal/LEGAL_NOTICE');
  check('GET /public/legal/LEGAL_NOTICE → 200', mentions.status === 200);
  check('… le titre est celui du document', mentions.json.data.title === 'Mentions légales');
  check('… les trois formes de bloc sont servies',
    mentions.json.data.sections[0].blocks.map((b) => b.type).join(',') === 'PARAGRAPH,FIELDS,LIST');
  check('… le bloc FIELDS porte libellé ET valeur',
    mentions.json.data.sections[0].blocks[1].items[0].label === 'SIRET'
    && mentions.json.data.sections[0].blocks[1].items[0].value === '11111111100011');
  check('… aucune variable non résolue ne traverse',
    !JSON.stringify(mentions.json.data).includes('{{'));
  check('… aucune balise non plus',
    !/[<>]/.test(JSON.stringify(mentions.json.data)));
  check('… la version du document est publiée (vérifiable de l’extérieur)',
    Number.isInteger(mentions.json.data.documentVersion));

  const absent = await get('/api/public/legal/PRIVACY_POLICY');
  check('un type NON REÇU répond 404 — aucun repli', absent.status === 404);

  const inconnu = await get('/api/public/legal/AUTRE_CHOSE');
  check('un type inconnu répond 404', inconnu.status === 404);
}

section('5. Le pied de page n’annonce que ce qui est SERVI');
{
  const avant = await get('/api/public/bootstrap');
  check('le bootstrap porte la liste des documents', Array.isArray(avant.json.data.legalDocuments));
  check('… un seul est annoncé (seules les mentions ont été reçues)',
    avant.json.data.legalDocuments.length === 1
    && avant.json.data.legalDocuments[0].type === 'LEGAL_NOTICE');

  await legal.applyLegalDocument(
    document({ type: 'PRIVACY_POLICY', documentVersion: 1 }), 'SYNC', 'entity-privacy',
  );
  const apres = await get('/api/public/bootstrap');
  check('après réception du second, les DEUX sont annoncés',
    apres.json.data.legalDocuments.length === 2);
  check('… avec leur titre réel, pas un libellé codé en dur',
    apres.json.data.legalDocuments.some((d) => d.title === 'Politique de confidentialité'));
}

section('6. Le tombstone retire la page — et seulement la bonne');
{
  const inconnuEntity = await legal.applyLegalDocumentChange({
    change: { deleted: true, entityId: 'entity-jamais-vue' },
  });
  check('un retrait d’entité inconnue ne fait rien',
    inconnuEntity.applied === false && inconnuEntity.reason === 'UNKNOWN_ENTITY');
  check('… les deux documents sont toujours là', (await LegalDocument.countDocuments()) === 2);

  const retrait = await legal.applyLegalDocumentChange({
    change: { deleted: true, entityId: 'entity-privacy' },
  });
  check('le retrait de la politique est appliqué', retrait.applied === true && retrait.removed === true);
  check('… la politique répond de nouveau 404',
    (await get('/api/public/legal/PRIVACY_POLICY')).status === 404);
  check('… et les MENTIONS sont intactes',
    (await get('/api/public/legal/LEGAL_NOTICE')).status === 200);
}

section('7. FALLBACK — le Panel peut disparaître, la page reste');
{
  /**
   * Aucune route publique n'appelle le Panel : on le prouve en COUPANT
   * l'appairage, ce qui rend toute communication impossible, puis en relisant
   * la page. Un appel réseau caché échouerait ici.
   */
  await clearPairing();
  const pendantLaPanne = await get('/api/public/legal/LEGAL_NOTICE');
  check('la page est servie même sans appairage', pendantLaPanne.status === 200);
  check('… avec le dernier contenu valide',
    JSON.stringify(pendantLaPanne.json.data).includes('CONTENU-B'));
  check('… et le bootstrap l’annonce toujours',
    (await get('/api/public/bootstrap')).json.data.legalDocuments.length === 1);
}

section('8. Aucune écriture locale possible');
{
  /**
   * On cherche un chemin d'ÉCRITURE côté projet. Il ne doit y en avoir aucun :
   * ni route, ni service, ni écran. Le contrôle est textuel et volontairement
   * grossier — il attrape un ajout futur bien avant qu'un humain ne le
   * remarque.
   */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const fichiers = [];
  const parcourir = (dir) => {
    for (const entree of fs.readdirSync(dir, { withFileTypes: true })) {
      const complet = path.join(dir, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else if (entree.name.endsWith('.js') && !entree.name.endsWith('.test.js')) fichiers.push(complet);
    }
  };
  parcourir(path.join(racine, 'routes'));
  parcourir(path.join(racine, 'controllers'));

  const ecrivains = fichiers.filter((f) => {
    const source = fs.readFileSync(f, 'utf8');
    return /LegalDocument\.(create|updateOne|findOneAndUpdate|insertMany|deleteOne)/.test(source);
  });
  check('aucune route ni aucun contrôleur n’écrit dans LegalDocument',
    ecrivains.length === 0);

  const applicateurs = fs
    .readFileSync(path.join(racine, 'services/panelConfiguration/legalDocument.service.js'), 'utf8');
  check('le service ne modifie le document que par upsert d’application',
    (applicateurs.match(/LegalDocument\.findOneAndUpdate/g) ?? []).length === 1);
}

server.close();
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
