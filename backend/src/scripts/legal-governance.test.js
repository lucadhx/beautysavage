/* LA DOCTRINE JURIDIQUE EST-ELLE ENCORE DANS CE DÉPÔT ?
 *
 * ══ POURQUOI UNE GARDE, ET POURQUOI SI LÉGÈRE ═══════════════════════════════
 *
 * Ces projets naissent par DUPLICATION. Une règle qui ne vit que dans un
 * document se perd au premier lot qui réécrit ce document — et personne ne s'en
 * aperçoit, puisqu'il n'y a rien à casser : le code compile, les tests passent,
 * et le prochain projet recrée le défaut d'origine.
 *
 * Cette suite ne vérifie PAS un paragraphe mot pour mot : une doctrine se
 * reformule, et un test qui l'épinglerait à la virgule serait supprimé au
 * premier reformatage. Elle vérifie que les CONCEPTS NORMATIFS sont présents —
 * ce qu'on ne peut pas retirer sans retirer la règle elle-même.
 *
 * ══ ET LE SUPPORT TECHNIQUE ════════════════════════════════════════════════
 *
 * La doctrine sans la mécanique serait une intention. On vérifie donc aussi que
 * le read-model, l'applicateur et la route publique existent — c'est ce qui
 * rend la règle applicable dans un projet fraîchement dupliqué.
 *
 * Runner autonome, sans base : lecture de fichiers seulement. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RACINE = path.resolve(SRC, '../..');
const lire = (rel) => {
  const p = path.join(RACINE, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

/**
 * APLATIT UN MARKDOWN POUR Y CHERCHER UNE NOTION, PAS UNE MISE EN FORME.
 *
 * Deux artefacts de rédaction cassaient les comparaisons naïves :
 *
 *   · le RETOUR À LA LIGNE à 80 colonnes, qui coupe « politique de
 *     confidentialité » en deux ;
 *   · le MARQUEUR DE CITATION « > », qui se glisse alors ENTRE les deux
 *     moitiés — « politique de > confidentialité ».
 *
 * On retire donc les marqueurs de début de ligne avant d'aplatir les blancs.
 * Le test porte sur la doctrine, jamais sur la façon dont elle est présentée.
 */
function aplatir(markdown) {
  return String(markdown ?? '')
    .toLowerCase()
    .replace(/^[ \t]*>+[ \t]?/gm, '')
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ');
}
section('1. Le protocole porte la doctrine « legal compliance by change »');
{
  const protocole = lire('docs/PROTOCOL.md');
  check('docs/PROTOCOL.md existe', protocole !== null);

  if (protocole) {
    /**
     * LES BLANCS SONT APLATIS AVANT COMPARAISON.
     *
     * Un document Markdown est retourné à la ligne pour tenir dans 80 colonnes.
     * « la Politique de » suivi de « confidentialité » à la ligne est la MÊME
     * notion que « la politique de confidentialité » : un test qui les
     * distinguerait échouerait au premier reformatage, en signalant absente une
     * doctrine qui est là.
     */
    const doc = aplatir(protocole);

    /**
     * LES CONCEPTS, PAS LES PHRASES.
     *
     * Chaque entrée est une notion sans laquelle la règle ne veut plus rien
     * dire. Plusieurs formulations sont acceptées : c'est la notion qui est
     * verrouillée, pas sa rédaction.
     */
    const concepts = [
      ['un titre de section dédié', /##\s*legal documents compliance/i.test(protocole)],
      ['la vérification à chaque modification fonctionnelle',
        doc.includes('modification fonctionnelle') && doc.includes('compatibilité')],
      ['les deux documents nommés',
        doc.includes('mentions légales') && doc.includes('politique de confidentialité')],
      ['le Panel comme autorité des templates',
        doc.includes('panel') && doc.includes('template')],
      ['l’interdiction de coder le juridique en dur',
        doc.includes('hardcod') || doc.includes('en dur')],
      ['l’interdiction de mutiler le produit pour un vieux document',
        doc.includes('supprimer une fonctionnalité')],
      ['l’interdiction d’inventer une donnée manquante',
        doc.includes('inventer') && doc.includes('complétude')],
      ['les déclencheurs concrets (traceur, iframe, cookie…)',
        ['tracker', 'pixel', 'iframe', 'cookie', 'captcha'].filter((m) => doc.includes(m)).length >= 4],
      ['la vérification des pages publiques après coup',
        doc.includes('/mentions-legales') && doc.includes('/politique-de-confidentialite')],
    ];
    for (const [nom, present] of concepts) check(nom, present);
  }
}

section('2. Le protocole porte la doctrine « pas de résidu de seed »');
{
  const protocole = lire('docs/PROTOCOL.md') ?? '';
  const doc = aplatir(protocole);
  check('une section dédiée aux seeds', /##\s*seeds et résidus de seed/i.test(protocole));
  check('l’amorçage ne crée que ce qui manque',
    doc.includes('ne crée que ce qui manque') || doc.includes('crée que ce qui manque'));
  check('un défaut de schéma ne porte pas de contenu',
    doc.includes('défaut de schéma') && doc.includes('forme'));
  check('une migration doit converger', doc.includes('converger') || doc.includes('condition de sortie'));
  check('le nettoyage après intervention est exigé', doc.includes('nettoie derrière'));
}

section('3. Le support technique du système légal est présent');
{
  const fichiers = [
    ['read-model local', 'backend/src/models/LegalDocument.model.js'],
    ['applicateur du pont', 'backend/src/services/panelConfiguration/legalDocument.service.js'],
    ['page publique de la vitrine', 'vitrine/src/pages/LegalPage.tsx'],
  ];
  for (const [nom, rel] of fichiers) check(`${nom} (${rel})`, lire(rel) !== null);

  const routes = lire('backend/src/routes/public.routes.js') ?? '';
  check('la route publique /legal/:type est montée', routes.includes("/legal/:type"));

  const boot = lire('backend/src/config/bootstrap.js') ?? '';
  check('l’applicateur LEGAL_DOCUMENT est branché', boot.includes('LEGAL_DOCUMENT:'));
  check('l’identité du projet est injectée à l’applicateur',
    boot.includes('configureLegalDocumentIdentity'));

  const contrat = lire('backend/src/services/panelBridge/bridgeContract.js') ?? '';
  check('LEGAL_DOCUMENT est déclaré au contrat', contrat.includes("'LEGAL_DOCUMENT',"));
  check('… et son schéma de charge utile existe',
    contrat.includes('legalDocumentPayloadSchema'));
}

section('3 bis. Les DEUX chemins d’application lèvent la lettre morte');
{
  /**
   * ══ LE DÉFAUT QUE CETTE GARDE ATTRAPE ════════════════════════════════════
   *
   * Une écriture du Panel arrive par DEUX chemins : la poussée immédiate
   * () et le rattrapage au tirage ().
   * Le tirage levait la lettre morte après une application réussie ; la
   * poussée ne le faisait pas.
   *
   * Conséquence observée en production : après la mise à niveau qui a réparé
   * un type inconnu, les documents étaient appliqués — mais les écritures
   * garées pendant l’incident restaient PARKED pour toujours, et le Panel
   * affichait trois projets dégradés qui ne le sont plus. Une alerte
   * permanente est une alerte qu’on apprend à ignorer.
   *
   * Un seul des deux chemins suffit à recréer le défaut : on vérifie les deux.
   */
  const chemins = [
    ['tirage (PanelBridge)', 'backend/src/services/panelBridge/PanelBridge.js'],
    ['poussée immédiate (projectBridge)', 'backend/src/services/projectBridge/projectBridge.service.js'],
  ];
  for (const [nom, rel] of chemins) {
    const src = lire(rel) ?? '';
    check(`${nom} lève la lettre morte après application`,
      src.includes('resolveDeadLettersFor('));
  }
}
section('4. Aucun texte juridique n’est codé en dur dans la vitrine');
{
  /**
   * ══ CE QUE CE BALAYAGE ATTRAPE ═══════════════════════════════════════════
   *
   * La tentation la plus probable n'est pas malveillante : c'est « je mets juste
   * le SIRET en attendant ». Un identifiant légal dans le frontend est le
   * premier pas vers la copie divergente que tout ce chantier a supprimée.
   *
   * On cherche des MOTIFS d'identifiants français, pas des mots — « SIRET »
   * apparaît légitimement dans un libellé de formulaire.
   */
  const vitrine = path.join(RACINE, 'vitrine/src');
  const suspects = [];
  const parcourir = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const complet = path.join(dir, e.name);
      if (e.isDirectory()) { parcourir(complet); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(complet, 'utf8');
      // 14 chiffres consécutifs (SIRET) ou un n° de TVA FR complet.
      if (/\b\d{14}\b/.test(src) || /\bFR\d{2}\d{9}\b/.test(src)) {
        suspects.push(path.relative(RACINE, complet));
      }
    }
  };
  parcourir(vitrine);
  check('aucun SIRET ni numéro de TVA dans le frontend', suspects.length === 0, suspects.join(', '));

  const page = lire('vitrine/src/pages/LegalPage.tsx') ?? '';
  check('la page légale ne contient aucune phrase juridique en dur',
    !/RGPD|responsable du traitement|propriété intellectuelle/i.test(page));
  // Même aplatissement : l'appel est chaîné sur plusieurs lignes.
  check('… elle lit le document depuis l’API locale',
    page.replace(/\s+/g, '').includes('.legalDocument('));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
