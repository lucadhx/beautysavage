/* LA SIGNATURE VUE PAR LES ÉCRANS — ce qu'ils nomment, et ce qu'ils offrent.
 *
 * ══ POURQUOI CETTE SUITE EXISTE ═════════════════════════════════════════════
 *
 * Le prestataire de signature a changé. Aucun écran ne devrait s'en apercevoir
 * — c'est tout l'intérêt d'être passé par des capacités génériques — mais la
 * discipline ne tient que si quelque chose la surveille : un nom de
 * fournisseur se réintroduit en une ligne, dans une phrase qu'on trouve plus
 * « concrète », et il y reste des années après son départ.
 *
 * Elle défend deux choses distinctes :
 *
 *   1. AUCUN nom de prestataire dans ce que lit un humain. Ni l'ancien, ni le
 *      nouveau — la bascule ne doit pas servir de prétexte pour faire entrer un
 *      nom là où aucun n'était admis.
 *
 *   2. La PREUVE D'AUDIT est offerte partout où le contrat signé l'est, et
 *      JAMAIS confondue avec lui. Ce sont deux pièces : l'une est l'engagement,
 *      l'autre atteste qu'il a été signé, par qui et quand. Un écran qui les
 *      mélange fera produire l'une pour l'autre le jour où ça compte.
 *
 * Aucun réseau, aucun rendu : on lit les sources. Runner autonome. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}`); }
};
const section = (title) => console.log(`\n${title}`);

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (rel) => fs.readFileSync(path.join(racine, rel), 'utf8');

/**
 * Le TEXTE que lit un humain — pas le code qui l'entoure.
 *
 * On retire les commentaires avant de chercher un nom de fournisseur. Ils sont
 * précisément l'endroit où il DOIT rester : expliquer « ce champ s'appelait
 * yousign » est ce qui empêche quelqu'un de le renommer à l'aveugle dans dix
 * mois. Les confondre rendrait le contrôle impossible à satisfaire autrement
 * qu'en effaçant l'histoire.
 */
const sansCommentaires = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const ECRANS = [
  'pages/MyContractPage.tsx',
  'pages/dev/DevContractsPage.tsx',
  'pages/ContractReturnPage.tsx',
  'pages/SignatureReturnPage.tsx',
  'components/contracts/journey/DevJourney.tsx',
  'components/contracts/ContractTimeline.tsx',
  'components/contracts/TechnicalTools.tsx',
];

/* ────────────────────────────────────────────────────────────────────────── */
section('1 · Aucun écran ne nomme le prestataire de signature');
{
  const fautifs = [];
  for (const rel of ECRANS) {
    const texte = sansCommentaires(lire(rel));
    if (/yousign|opensign/i.test(texte)) fautifs.push(rel);
  }
  if (fautifs.length) console.error(`      → ${fautifs.join(', ')}`);
  check('ni l’ancien nom, ni le nouveau, dans le code rendu', fautifs.length === 0);

  /**
   * LE CONTRE-CONTRÔLE : les commentaires, eux, ont le droit — et l'histoire
   * doit survivre. Un contrôle qui ne distinguerait pas les deux serait
   * satisfait en effaçant les explications, c'est-à-dire au pire prix.
   */
  const timeline = lire('components/contracts/ContractTimeline.tsx');
  check('…mais l’histoire du renommage reste écrite quelque part',
    /Yousign/.test(timeline) && !/Yousign/.test(sansCommentaires(timeline)));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2 · Le bloc de signature est lu par son nom NEUTRE');
{
  for (const rel of ['pages/MyContractPage.tsx', 'pages/dev/DevContractsPage.tsx',
    'components/contracts/journey/DevJourney.tsx', 'lib/contractProgress.ts']) {
    const source = sansCommentaires(lire(rel));
    check(`${rel.split('/').pop()} lit « contract.signature »`,
      !/contract\.yousign/.test(source));
  }

  /**
   * L'ANCIEN BLOC RESTE SERVI PAR L'API, et le type le dit — en `@deprecated`.
   * Le retirer du type pendant que le backend le rend encore ferait croire
   * qu'il a disparu, et personne ne saurait quand le retirer pour de bon.
   */
  const types = lire('types/index.ts');
  check('le type porte encore l’ancien bloc, marqué obsolète',
    /@deprecated[\s\S]{0,80}signature/.test(types) && /yousign: ContractSignatureView/.test(types));
  check('…et les deux ont la MÊME forme (aucune divergence possible)',
    /signature: ContractSignatureView/.test(types));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3 · La preuve d’audit est offerte, et jamais confondue');
{
  const api = lire('lib/api.ts');
  check('le client API connaît la troisième pièce',
    /ContractDocumentKind = 'original' \| 'signed' \| 'certificate'/.test(api));
  /**
   * LE NOM DE FICHIER PROPOSÉ EST LE POINT SENSIBLE.
   *
   * « contrat-…-certificate.pdf » ferait croire à celui qui l'ouvre qu'il tient
   * l'engagement. C'est exactement comme ça qu'une pièce est produite pour
   * l'autre devant un tiers.
   */
  check('…et lui donne un nom de fichier qui ne ment pas',
    /certificat-signature-\$\{contractId\}\.pdf/.test(api));

  const dev = lire('pages/dev/DevContractsPage.tsx');
  check('l’écran DEV offre la preuve d’audit',
    /hasCertificate && \([\s\S]{0,400}download\('certificate'\)/.test(dev));
  check('…par un bouton DISTINCT de celui du PDF signé',
    /download\('signed'\)/.test(dev) && /download\('certificate'\)/.test(dev));

  const client = lire('pages/MyContractPage.tsx');
  check('le client aussi, sur son étape terminale',
    /downloadCertificate = \(\) => downloadDoc\('certificate'\)/.test(client)
    && /hasCertificate && \([\s\S]{0,300}onDownloadCertificate/.test(client));

  /**
   * ELLE N'EST PROPOSÉE QUE SI ELLE EXISTE.
   *
   * Un contrat signé avant la bascule n'en a pas : sa preuve vit dans l'espace
   * du compte du fournisseur historique. Un bouton affiché sans condition
   * répondrait 404 au clic, et ferait croire à une panne là où il n'y a qu'un
   * fait historique.
   */
  const sansGarde = [dev, client].filter((source) => {
    const occurrences = (source.match(/download(Doc)?\('certificate'\)|onDownloadCertificate/g) ?? []).length;
    const gardes = (source.match(/hasCertificate/g) ?? []).length;
    return occurrences > 0 && gardes === 0;
  });
  check('aucun bouton de preuve sans garde « hasCertificate »', sansGarde.length === 0);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4 · Le retour de signature ne conclut rien');
{
  const retour = lire('pages/SignatureReturnPage.tsx');
  const app = lire('App.tsx');

  check('la page de retour est routée',
    /path="retour-signature" element=\{<SignatureReturnPage \/>\}/.test(app));
  /**
   * LE PRESTATAIRE N'ACCEPTE QU'UNE ADRESSE DE RETOUR, sans paramètre ajouté :
   * les deux signataires atterrissent au même endroit. La page lit donc la
   * SESSION pour renvoyer chacun chez soi.
   */
  check('elle lit la session plutôt qu’un paramètre d’URL',
    /useAuth\(\)/.test(retour) && !/searchParams|useSearchParams|\?status=/.test(retour));
  check('…et renvoie le DEV et le client à des endroits différents',
    /isDev \? '\/dev\/contrats' : '\/contrat\/retour-signature'/.test(retour));
  /**
   * REVENIR N'EST PAS AVOIR SIGNÉ — on peut avoir fermé l'onglet ou refusé.
   * Seul le webhook fait foi, et l'écran de destination l'attend déjà.
   */
  check('elle n’annonce ni succès ni échec',
    !/signé\b|succès|échec|félicitation/i.test(sansCommentaires(retour)));
  check('…et ne reste pas dans l’historique', /replace/.test(retour));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
