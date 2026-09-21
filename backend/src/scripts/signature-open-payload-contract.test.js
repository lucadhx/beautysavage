/**
 * LE PAYLOAD DE SIGNATURE, VALIDÉ CONTRE LE VRAI CONTRAT DU PANEL.
 *
 * ══ L'INCIDENT QUI A RENDU CETTE SUITE NÉCESSAIRE ═══════════════════════════
 *
 * Un clic sur « Signer » rendait :
 *
 *     « Entrée refusée par « signature.request.open ». »
 *
 * Ce message envoyait chercher un champ fautif. Il n'y en avait aucun : le
 * payload était valide de bout en bout, et le refus venait d'une règle du
 * COMPTE de signature. Mais personne ne pouvait le savoir, parce que rien ne
 * vérifiait le payload avant de partir, et que le refus ne disait rien.
 *
 * Deux manques distincts, deux réponses distinctes :
 *
 *   · le payload n'était éprouvable qu'en appelant réellement le Panel — il est
 *     désormais construit par `buildSignatureOpenPayload()`, pure et testable ;
 *   · le contrat de capacité vit dans l'AUTRE dépôt et peut bouger sans que
 *     celui-ci le sache — on charge donc le VRAI schéma, jamais une copie.
 *
 * ══ POURQUOI PAS DEUX SCHÉMAS ══════════════════════════════════════════════
 *
 * Recopier le schéma ici donnerait une suite verte le jour où le Panel ajoute
 * un champ requis : les deux copies divergeraient en silence, et c'est
 * exactement le défaut qu'on prétend surveiller. On importe l'original.
 *
 * Aucun réseau, aucune base, aucun fournisseur.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument } from 'pdf-lib';

import { buildSignatureOpenPayload } from '../services/signature/signature.service.js';

let pass = 0;
let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');

/* ══════════════════════════════════════════════════════════════════════════
   LA FIXTURE — un contrat complet, tel qu'il est au moment du clic.
   ══════════════════════════════════════════════════════════════════════════ */

const doc = await PDFDocument.create();
doc.addPage([595.92, 842.88]);
const PDF = Buffer.from(await doc.save());

/** Les mesures de page viennent du document RÉEL, comme en production. */
const PAGE = { page: 1, width: 595.92, height: 842.88 };

function contratFixture(surcharge = {}) {
  return {
    _id: '6a85d910d44c228e2c68a5d2',
    reference: 'CTR-2026-0002',
    document: { pageSizes: [PAGE], pageCount: 1 },
    signersSnapshot: {
      developer: {
        firstName: 'Prénom', lastName: 'Nom',
        email: 'representant@entreprise.test', companyName: 'Entreprise développeur',
      },
      client: {
        firstName: 'Prénom', lastName: 'Nom',
        email: 'client@entreprise-cliente.test', companyName: 'Entreprise cliente',
      },
    },
    signatureConfiguration: {
      locked: true,
      zones: [
        {
          id: 'z-dev', name: 'Signature Développeur', signerRole: 'DEVELOPER', page: 1,
          xRatio: 0.1985, yRatio: 0.7134, widthRatio: 0.22, heightRatio: 0.07, type: 'SIGNATURE',
        },
        {
          id: 'z-cli', name: 'Signature Client', signerRole: 'CLIENT', page: 1,
          xRatio: 0.6521, yRatio: 0.7163, widthRatio: 0.22, heightRatio: 0.07, type: 'SIGNATURE',
        },
      ],
    },
    ...surcharge,
  };
}

const FICHIER = { buffer: PDF, filename: 'contrat.pdf' };

/**
 * UNE SEULE ADRESSE DE RETOUR — pour tout le document, pour les deux parties.
 *
 * La fixture portait neuf adresses : trois issues (succès, erreur, refus) pour
 * chacun des deux signataires. Le fournisseur n'en accepte qu'UNE, et n'y
 * ajoute aucun paramètre : rien ne distingue, à l'arrivée, qui revient ni
 * pourquoi.
 *
 * Garder les neuf ici aurait validé un payload que le Panel refuse —
 * c'est-à-dire le contraire de ce que cette suite existe pour attraper. C'est
 * la page de retour qui tranche désormais, en lisant la session.
 */
const RETOUR = 'https://manager.exemple.test/retour-signature';

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Le payload se construit sans réseau ni base');
let payload = null;
{
  payload = buildSignatureOpenPayload(contratFixture(), FICHIER, RETOUR);
  check('la construction aboutit', Boolean(payload));
  check('les clés sont exactement celles du contrat',
    JSON.stringify(Object.keys(payload).sort())
    === JSON.stringify(['contractRef', 'documentBase64', 'documentFilename', 'fields', 'name', 'operationId', 'returnUrl', 'signers']));

  console.log('\n  ── forme envoyée (aucune valeur sensible) ──');
  console.log(`     contractRef       : ${payload.contractRef.slice(0, 4)}…${payload.contractRef.slice(-4)}`);
  console.log(`     name              : ${payload.name}`);
  console.log(`     documentBase64    : <${payload.documentBase64.length} caractères>`);
  console.log(`     documentFilename  : ${payload.documentFilename}`);
  console.log(`     operationId       : ${payload.operationId.replace(/[0-9a-f]{8,}/, '…')}`);
  console.log(`     returnUrl         : ${payload.returnUrl}`);
  for (const s of payload.signers) {
    console.log(`     signer            : role=${s.role} prénom=${Boolean(s.firstName)} nom=${Boolean(s.lastName)}`
      + ` email=${Boolean(s.email)}`);
  }
  for (const f of payload.fields) {
    console.log(`     field             : ${f.signerRole} p${f.page} ${f.width}×${f.height} @(${f.x},${f.y})`);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · PARITÉ — validé contre le VRAI schéma du Panel');
const cheminRegistre = path.resolve(
  SRC, '../../../Panel/backend/src/services/capabilities/capabilityRegistry.js',
);
let schema = null;
{
  if (!fs.existsSync(cheminRegistre)) {
    /**
     * Le Panel vit dans un AUTRE dépôt. On DÉCLARE le contrôle non exécuté
     * plutôt que de le déclarer vert : le seul résultat inacceptable serait de
     * croire la parité vérifiée alors que personne ne l'a regardée.
     */
    check('⚠ registre Panel absent — parité NON VÉRIFIÉE (et non « verte »)', false);
  } else {
    const panel = await import(`file://${cheminRegistre.replace(/\\/g, '/')}`);
    const def = panel.getCapabilityDefinition('signature.request.open');
    check('la capacité existe au registre du Panel', Boolean(def));
    /**
     * LA CAPACITÉ EST SERVIE PAR OPENSIGN — et le contrôle le DIT.
     *
     * Ce qui compte n'est pas le nom : c'est que les deux dépôts désignent le
     * MÊME exécutant. Si le Panel rebasculait sans que ce projet le sache, le
     * schéma validé ici ne serait pas celui qui juge en production.
     */
    check('elle est servie par OPENSIGN', def?.provider === 'OPENSIGN');
    schema = def?.inputSchema ?? null;
    check('elle porte un schéma d’entrée', Boolean(schema));

    if (schema) {
      const verdict = schema.safeParse(payload);
      if (!verdict.success) {
        for (const issue of verdict.error.issues) {
          console.error(`      ✗ ${issue.path.join('.')} : ${issue.message}`);
        }
      }
      check('LE PAYLOAD RÉEL EST VALIDE POUR LE PANEL', verdict.success);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · TESTS NÉGATIFS — le schéma refuse ce qui doit l’être');
{
  if (!schema) {
    check('schéma indisponible — tests négatifs NON EXÉCUTÉS', false);
  } else {
    /**
     * Un test qui ne rougit jamais ne prouve rien. Chaque mutation vise UN fait
     * du contrat : si l'une d'elles passait, le contrôle du dessus serait une
     * formalité.
     */
    const refuse = (nom, muter) => {
      const p = JSON.parse(JSON.stringify(payload));
      muter(p);
      const v = schema.safeParse(p);
      check(`${nom} → REFUSÉ${v.success ? ' (or il est ACCEPTÉ)' : ` (${v.error.issues[0].path.join('.')})`}`,
        !v.success);
    };

    refuse('nom de famille du développeur retiré', (p) => { delete p.signers[0].lastName; });
    refuse('prénom du développeur vide', (p) => { p.signers[0].firstName = ''; });
    refuse('adresse du développeur non conforme', (p) => { p.signers[0].email = 'pas-une-adresse'; });
    refuse('rôle de signataire inconnu', (p) => { p.signers[0].role = 'developer'; });
    refuse('rôle de zone inconnu', (p) => { p.fields[0].signerRole = 'DEV_COMPANY'; });
    refuse('page 0 (indexation à zéro)', (p) => { p.fields[0].page = 0; });
    refuse('page non entière', (p) => { p.fields[0].page = 1.5; });
    refuse('coordonnée négative', (p) => { p.fields[0].x = -1; });
    refuse('largeur nulle', (p) => { p.fields[0].width = 0; });
    refuse('référence de document absente', (p) => { delete p.documentBase64; });
    refuse('nom de fichier absent', (p) => { delete p.documentFilename; });
    refuse('aucune zone', (p) => { p.fields = []; });
    refuse('aucun signataire', (p) => { p.signers = []; });
    refuse('clé d’idempotence trop courte', (p) => { p.operationId = 'court'; });
    refuse('champ inconnu ajouté (schéma strict)', (p) => { p.extra = 'x'; });
    /**
     * Les trois retours PAR SIGNATAIRE ont disparu : il n'en reste qu'un, pour
     * tout le document. Ce qu'on garde, c'est l'exigence qui compte — une
     * adresse ABSOLUE : une adresse relative renverrait le signataire chez le
     * fournisseur, sur un chemin qui n'existe pas là-bas.
     */
    refuse('adresse de retour non absolue', (p) => { p.returnUrl = '/retour'; });
    refuse('adresse de retour portée par un signataire', (p) => {
      p.signers[0].redirectUrls = { success: 'https://x.test/ok' };
    });
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · Le PRODUCTEUR refuse avant même d’atteindre le Panel');
{
  /** Ces refus sont LOCAUX : ils rendent un message métier, pas un refus de schéma. */
  const leve = (nom, contrat, motif) => {
    try {
      buildSignatureOpenPayload(contrat, FICHIER, RETOUR);
      check(`${nom} → LEVÉ (or rien n’a été levé)`, false);
    } catch (err) {
      check(`${nom} → LEVÉ : « ${String(err.message).slice(0, 64)}… »`, motif.test(err.message));
    }
  };

  leve('signataire développeur incomplet',
    contratFixture({
      signersSnapshot: {
        developer: { firstName: 'Prénom', email: 'x@y.test' },
        client: contratFixture().signersSnapshot.client,
      },
    }),
    /entreprise développeur/i);

  leve('signataire client incomplet',
    contratFixture({
      signersSnapshot: {
        developer: contratFixture().signersSnapshot.developer,
        client: { firstName: 'Prénom', lastName: 'Nom' },
      },
    }),
    /entreprise cliente/i);

  leve('aucune zone configurée',
    contratFixture({ signatureConfiguration: { locked: true, zones: [] } }),
    /zone de signature/i);

  leve('dimensions de page inconnues',
    contratFixture({ document: { pageSizes: [], pageCount: 1 } }),
    /[Dd]imensions de page/);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · Les rôles sont les MÊMES des deux côtés du pont');
{
  const constantes = await import('../utils/contractConstants.js');
  check('SB Auto n’expose que DEVELOPER et CLIENT',
    JSON.stringify([...constantes.SIGNER_ROLE_VALUES].sort()) === JSON.stringify(['CLIENT', 'DEVELOPER']));

  if (schema) {
    /** On lit les valeurs acceptées DANS le schéma, plutôt que de les redire. */
    const v = schema.safeParse({ ...payload, signers: [{ ...payload.signers[0], role: 'AUTRE' }] });
    check('le Panel refuse un rôle hors énumération', !v.success);
    for (const role of constantes.SIGNER_ROLE_VALUES) {
      const p = JSON.parse(JSON.stringify(payload));
      p.signers = [{ ...p.signers[0], role }];
      p.fields = [{ ...p.fields[0], signerRole: role }];
      const ok = schema.safeParse(p);
      check(`le rôle « ${role} » de SB Auto est accepté par le Panel`, ok.success);
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · Les zones viennent de l’ÉDITEUR, en ratios — jamais en pixels');
{
  const zones = contratFixture().signatureConfiguration.zones;
  check('l’éditeur stocke des ratios',
    zones.every((z) => ['xRatio', 'yRatio', 'widthRatio', 'heightRatio'].every((k) => typeof z[k] === 'number')));
  check('…et aucun pixel absolu',
    zones.every((z) => ['x', 'y', 'width', 'height'].every((k) => z[k] === undefined)));

  /** La conversion doit dépendre de la TAILLE RÉELLE de la page. */
  const large = buildSignatureOpenPayload(
    contratFixture({ document: { pageSizes: [{ page: 1, width: 1191.84, height: 1685.76 }], pageCount: 1 } }),
    FICHIER, RETOUR,
  );
  const normal = payload.fields.find((f) => f.signerRole === 'DEVELOPER');
  const double = large.fields.find((f) => f.signerRole === 'DEVELOPER');
  check('une page deux fois plus grande double les coordonnées',
    Math.abs(double.x - normal.x * 2) <= 2 && Math.abs(double.y - normal.y * 2) <= 2);
  check('…et la page reste 1-indexée', double.page === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7 · LE REFUS EST LISIBLE — un message d’action, pas un code de schéma');
{
  const { explainSignatureRefusal } = await import('../services/signature/signature.service.js');

  /**
   * LE REFUS QUE LE FOURNISSEUR ACTUEL PRODUIT RÉELLEMENT.
   *
   * Ce bloc éprouvait `SIGNER_EMAIL_NOT_IN_ORGANISATION` — le bac à sable de
   * l'ancien fournisseur n'acceptait comme destinataire qu'une adresse de
   * l'organisation du compte. Le nouveau n'a PAS cette limitation : mesuré, en
   * bac à sable, avec des adresses externes.
   *
   * Continuer à l'éprouver aurait garanti la survie d'un message périmé, qui
   * enverrait un développeur vérifier des adresses parfaitement valables. Les
   * deux refus ci-dessous sont ceux dont on a la preuve.
   */
  const sansCredits = explainSignatureRefusal({
    code: 'CAPABILITY_INPUT_INVALID',
    message: 'Entrée refusée par « signature.request.open ».',
    details: { panelDetails: { reason: 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED' } },
  });
  const m = String(sansCredits.message);
  check('le message ne se contente plus de citer la capacité',
    !/^Entrée refusée par/.test(m));
  check('…il nomme la cause : le compte de signature n’a plus de crédits',
    /crédits/i.test(m) && /rechargé/i.test(m));
  check('…il RASSURE : rien n’est parti',
    /rien n’a été envoyé/i.test(m) && /contrat est intact/i.test(m));
  check('…et porte un code métier stable',
    sansCredits.details?.code === 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED'
    || sansCredits.code === 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED');

  const tropGros = explainSignatureRefusal({
    code: 'CAPABILITY_INPUT_INVALID',
    message: 'Entrée refusée par « signature.request.open ».',
    details: { panelDetails: { reason: 'SIGNATURE_DOCUMENT_TOO_LARGE_FOR_PROVIDER' } },
  });
  check('un document trop lourd dit QUOI FAIRE, pas seulement qu’il est refusé',
    /Allégez le PDF/i.test(tropGros.message));
  check('…et porte son propre code',
    (tropGros.details?.code ?? tropGros.code) === 'SIGNATURE_DOCUMENT_TOO_LARGE');

  /** Un refus d'entrée NON reconnu reste actionnable, sans inventer de cause. */
  const generique = explainSignatureRefusal({
    code: 'CAPABILITY_INPUT_INVALID',
    message: 'Entrée refusée par « signature.request.open » : signers.0.email.',
    details: { panelDetails: { invalidParams: ['signers.0.email'] } },
  });
  const g = String(generique.message);
  check('un refus non reconnu nomme les champs refusés', g.includes('signers.0.email'));
  check('…et dit quoi vérifier', /document/i.test(g) && /zones/i.test(g) && /signataires/i.test(g));

  /** Les autres refus gardent leur traduction — on n'a rien cassé au passage. */
  const indetermine = explainSignatureRefusal({ code: 'CAPABILITY_TIMEOUT', message: '' });
  check('une issue indéterminée reste distincte d’un échec',
    /indéterminée/i.test(indetermine.message) && /[Nn]e relancez pas/.test(indetermine.message));
  const sansIdentifiants = explainSignatureRefusal({ code: 'CAPABILITY_CREDENTIALS_MISSING', message: '' });
  check('un défaut de configuration renvoie vers l’équipe technique',
    /pas configurée pour signer/i.test(sansIdentifiants.message));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('8 · PARITÉ du MOTIF — le Panel sait reconnaître ces refus');
{
  const cheminAdaptateurs = path.resolve(
    SRC, '../../../Panel/backend/src/services/integratedApi/opensign/openSignAdapters.js',
  );
  if (!fs.existsSync(cheminAdaptateurs)) {
    check('⚠ adaptateurs Panel absents — parité du motif NON VÉRIFIÉE', false);
  } else {
    const panel = await import(`file://${cheminAdaptateurs.replace(/\\/g, '/')}`);
    /**
     * LES DEUX CÔTÉS DOIVENT NOMMER LE MÊME MOTIF.
     *
     * Le Panel ÉMET la chaîne, ce projet la TRADUIT en message. Si l'un des
     * deux la renomme, le message redevient générique — sans erreur, sans
     * journal, et personne ne le remarquerait avant le prochain incident.
     */
    check('le Panel expose ses motifs de refus reconnus',
      Boolean(panel.OPENSIGN_INPUT_REFUSAL?.CREDITS_EXHAUSTED)
      && Boolean(panel.OPENSIGN_INPUT_REFUSAL?.DOCUMENT_TOO_LARGE));
    check('le motif « plus de crédits » est le même des deux côtés',
      panel.OPENSIGN_INPUT_REFUSAL.CREDITS_EXHAUSTED === 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED');
    check('le motif « document trop lourd » aussi',
      panel.OPENSIGN_INPUT_REFUSAL.DOCUMENT_TOO_LARGE === 'SIGNATURE_DOCUMENT_TOO_LARGE_FOR_PROVIDER');

    /**
     * LA PHRASE RÉELLEMENT REÇUE, mot pour mot — relevée en bac à sable.
     *
     * Elle compte plus que la table : c'est elle qui déclenche la
     * reconnaissance, et c'est elle qui changera un jour sans prévenir.
     */
    check('la phrase de crédits épuisés est reconnue',
      panel.recogniseInputRefusal('Insufficient credits! Please purchase credits to continue.')
      === 'SIGNATURE_PROVIDER_CREDITS_EXHAUSTED');
    check('celle du fichier trop lourd aussi',
      panel.recogniseInputRefusal('File too large') === 'SIGNATURE_DOCUMENT_TOO_LARGE_FOR_PROVIDER');

    /**
     * ET SURTOUT : la phrase FOURRE-TOUT ne doit PAS être happée.
     *
     * OpenSign rend « Something went wrong » pour presque toutes les causes
     * d'entrée. La rattacher à l'un des deux motifs donnerait une explication
     * précise et fausse — le défaut exact que ce lot a corrigé ailleurs.
     */
    check('la phrase fourre-tout n’est PAS reconnue',
      panel.recogniseInputRefusal('Something went wrong, please try again later!') === null);
    check('un refus sans rapport non plus',
      panel.recogniseInputRefusal('Invalid session token') === null);
    check('un message vide non plus', panel.recogniseInputRefusal('') === null);
    check('une valeur absente non plus', panel.recogniseInputRefusal(undefined) === null);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('9 · ANNULATION — le motif est un TEXTE LIBRE, et ça change tout');
{
  /**
   * ══ CE QUE L'INCIDENT PRÉCÉDENT AVAIT RÉVÉLÉ, ET CE QUI L'A CLOS ══════════
   *
   * Le Panel envoyait `reason: 'cancelled'` à l'ancien fournisseur, qui le
   * refusait par « You have some invalid params in your payload », sans nommer
   * le champ. L'ANNULATION d'une demande ne fonctionnait pas, et le seul moyen
   * de retirer une demande activée échouait sans dire pourquoi. Il avait fallu
   * découvrir, sur le compte réel, que seul `other` était accepté.
   *
   * Chez OpenSign, le motif est un TEXTE LIBRE — mesuré. La classe d'incident
   * disparaît donc : il n'y a plus d'énumération non documentée à deviner.
   *
   * Ce que ce contrôle défend désormais, c'est l'AUTRE moitié de la leçon :
   * qu'un motif soit TOUJOURS transmis. Une annulation sans motif laisse, chez
   * le signataire, un document retiré sans explication — et ce sont de vraies
   * personnes qui l'avaient reçu.
   */
  const cheminAdapt = path.resolve(
    SRC, '../../../Panel/backend/src/services/integratedApi/opensign/openSignAdapters.js',
  );
  const cheminTransport = path.resolve(
    SRC, '../../../Panel/backend/src/services/integratedApi/opensign/openSignTransport.js',
  );
  if (!fs.existsSync(cheminAdapt) || !fs.existsSync(cheminTransport)) {
    check('⚠ Panel absent — motif d’annulation NON VÉRIFIÉ', false);
  } else {
    /** On juge le CODE : les commentaires citent l'ancienne valeur pour l'expliquer. */
    const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const codeAdapt = sansCommentaires(fs.readFileSync(cheminAdapt, 'utf8'));

    check('l’annulation transmet toujours un motif, même par défaut',
      /reason:\s*input\.reason\s*\?\?\s*'[^']+'/.test(codeAdapt));
    check('…et plus aucun « cancelled » en dur — l’énumération a disparu avec le fournisseur',
      !/['\"`]cancelled['\"`]/.test(codeAdapt));

    const codeTransport = sansCommentaires(fs.readFileSync(cheminTransport, 'utf8'));
    check('ni dans le transport', !/['\"`]cancelled['\"`]/.test(codeTransport));

    /**
     * L'ÉTAT REND « ANNULÉ », PAS « REFUSÉ ».
     *
     * Mesuré : après révocation, OpenSign place le document en `declined`. Le
     * Panel rend l'état neutre CANCELED, parce que c'est LUI qui sait que
     * l'acte était une annulation. Confondre les deux ferait croire au projet
     * qu'un signataire a refusé — et sa règle de relance n'est pas la même.
     */
    const panel = await import(`file://${cheminAdapt.replace(/\\/g, '/')}`);
    check('l’adaptateur d’annulation existe au registre du Panel',
      typeof panel.OPENSIGN_ADAPTERS?.['signature.request.cancel'] === 'function');
    check('…et l’annulation ne se lit pas comme un refus',
      /SIGNATURE_REQUEST_STATE\.CANCELED/.test(codeAdapt));
  }
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
