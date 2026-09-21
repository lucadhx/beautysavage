import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream, readdirSync, realpathSync, statSync } from 'node:fs';
import crypto from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { resolveProjectMediaAuthority } from './media/projectMediaAuthority.js';

/**
 * Pipeline documentaire des contrats (DÉDIÉ aux PDF — jamais Sharp).
 *
 * Sécurité :
 *  - validation stricte (magic bytes %PDF, chargement pdf-lib, refus des PDF
 *    chiffrés, bornes de taille et de pages) ;
 *  - stockage PRIVÉ hors du dossier servi statiquement, sous storage/contracts/
 *    <contractId>/, noms de fichiers UUID non devinables ;
 *  - original et signé conservés séparément — le signé n'écrase JAMAIS l'original ;
 *  - lecture uniquement par streaming via chemin validé (anti path-traversal).
 */

export const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 Mo
export const MAX_PDF_PAGES = 40;

const PDF_MAGIC = Buffer.from('%PDF-');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Valide un buffer PDF. Renvoie { pageCount, pageSizes, checksum }.
 * Lève ApiError.badRequest en cas de PDF invalide/chiffré/hors bornes.
 */
export async function validatePdfBuffer(buffer, { filename = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('Fichier vide.');
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw ApiError.badRequest(`PDF trop volumineux (max ${MAX_PDF_BYTES / (1024 * 1024)} Mo).`);
  }
  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    throw ApiError.badRequest('Signature de fichier invalide (attendu %PDF).');
  }
  if (filename && !/\.pdf$/i.test(filename)) {
    throw ApiError.badRequest('Extension attendue : .pdf');
  }

  let doc;
  try {
    // ignoreEncryption:false -> un PDF chiffré lève (rejeté explicitement).
    doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(err.message || '')) {
      throw ApiError.badRequest('PDF protégé/chiffré non supporté. Fournissez un PDF non protégé.');
    }
    throw ApiError.badRequest('PDF illisible ou corrompu.');
  }

  const pageCount = doc.getPageCount();
  if (pageCount < 1) throw ApiError.badRequest('PDF sans page.');
  if (pageCount > MAX_PDF_PAGES) {
    throw ApiError.badRequest(`Trop de pages (max ${MAX_PDF_PAGES}).`);
  }

  const pageSizes = doc.getPages().map((p, i) => {
    const { width, height } = p.getSize();
    return { page: i + 1, width, height };
  });

  return { pageCount, pageSizes, checksum: sha256(buffer) };
}

function contractDir(contractId) {
  return path.join(config.paths.contractStorage, String(contractId));
}

async function writeFile(contractId, prefix, buffer) {
  const dir = contractDir(contractId);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${prefix}-${crypto.randomUUID()}.pdf`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return filename;
}

/** Valide + stocke le PDF ORIGINAL. Renvoie les métadonnées à persister. */
export async function storeOriginalPdf(contractId, buffer, { filename = '' } = {}) {
  const meta = await validatePdfBuffer(buffer, { filename });
  const storedName = await writeFile(contractId, 'original', buffer);
  return {
    originalFilename: storedName,
    originalChecksum: meta.checksum,
    pageCount: meta.pageCount,
    pageSizes: meta.pageSizes,
  };
}

/** Stocke le PDF SIGNÉ (immuable, n'écrase jamais l'original). */
export async function storeSignedPdf(contractId, buffer, { filename = '' } = {}) {
  const meta = await validatePdfBuffer(buffer, { filename });
  const storedName = await writeFile(contractId, 'signed', buffer);
  return {
    signedFilename: storedName,
    signedChecksum: meta.checksum,
    signedFetchedAt: new Date(),
  };
}

/**
 * Stocke la PREUVE D'AUDIT d'une signature achévée.
 *
 * ── POURQUOI ELLE NE PASSE PAS PAR `validatePdfBuffer` ─────────────────
 *
 * Cette validation compte les pages et relève les dimensions : elle existe
 * pour un CONTRAT, sur lequel on posera des zones de signature. Le certificat
 * n'en recevra jamais. Lui imposer le même contrôle ferait échouer l'archivage
 * le jour où le fournisseur rend autre chose qu'un PDF — et le certificat
 * serait perdu pour une exigence qui ne le concerne pas.
 *
 * Ce qu'on vérifie, en revanche, c'est qu'il n'est pas VIDE : archiver zéro
 * octet sous le nom « certificat » est pire que ne rien archiver, parce que
 * l'écran annoncerait une preuve qui n'existe pas.
 *
 * @param {string} contractId
 * @param {Buffer} buffer
 * @param {{contentType?: string}} [options]
 */
export async function storeSignatureCertificate(contractId, buffer, { contentType = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.badRequest('Certificat d’audit vide : rien à archiver.');
  }
  const dir = contractDir(contractId);
  await fs.mkdir(dir, { recursive: true });
  /**
   * L'EXTENSION SUIT LE TYPE DÉCLARÉ, pas une habitude. Un fichier archivé pour
   * dix ans sous une extension fausse se relit mal, et personne ne saura d'où
   * elle venait.
   */
  const extension = /pdf/i.test(contentType) ? 'pdf' : 'bin';
  const filename = `certificate-${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(dir, filename), buffer);
  return {
    certificateFilename: filename,
    certificateChecksum: sha256(buffer),
    certificateContentType: contentType || 'application/octet-stream',
    certificateFetchedAt: new Date(),
  };
}

/** Le code métier d'un document absent — le même partout, jamais un 200 vide. */
export const CONTRACT_DOCUMENT_NOT_FOUND = 'CONTRACT_DOCUMENT_NOT_FOUND';

/**
 * Les variantes d'un dossier contractuel, écrites comme le Panel les nomme.
 *
 * `CERTIFICATE` est arrivé avec le fournisseur actuel : c'est la PREUVE que la
 * signature a eu lieu, distincte de l'engagement lui-même. Elle est listée
 * ici, et pas ailleurs, pour qu'aucun appelant n'ait à connaître le nom du
 * champ qui la porte.
 */
export const DOCUMENT_VARIANTS = Object.freeze(['ORIGINAL', 'SIGNED', 'CERTIFICATE']);

const normaliserVariante = (variante) => {
  const v = String(variante ?? 'ORIGINAL').toUpperCase();
  return DOCUMENT_VARIANTS.includes(v) ? v : 'ORIGINAL';
};

/** Le champ qui porte le nom de fichier d'une variante — un seul endroit. */
const CHAMP_FICHIER = Object.freeze({
  ORIGINAL: 'originalFilename',
  SIGNED: 'signedFilename',
  CERTIFICATE: 'certificateFilename',
});

/**
 * LE résolveur de chemin d'un document contractuel — il n'y en a pas d'autre.
 *
 * ── UN SEUL CHEMIN, LOCAL COMME EN PRODUCTION ───────────────────────────────
 * La racine vient de `config.paths.contractStorage`, et rien d'autre ne la
 * calcule. En local elle pointe sur `backend/storage/contracts` ; en production
 * ce même dossier est un LIEN vers le stockage partagé, posé par le
 * déploiement. Le code ne connaît donc qu'une seule adresse : il ne peut pas
 * marcher d'un côté et pas de l'autre pour une question de chemin.
 *
 * Le nom de fichier stocké est un UUID opaque, mais on vérifie tout de même
 * que le chemin résolu reste DANS le dossier du contrat : une valeur venue de
 * la base ne se laisse pas suivre les yeux fermés.
 *
 * @param {object} contract
 * @param {'ORIGINAL'|'SIGNED'|'original'|'signed'} variante
 */
export function resolveContractDocumentPath(contract, variante = 'ORIGINAL') {
  const kind = normaliserVariante(variante);
  const filename = contract.document?.[CHAMP_FICHIER[kind]];
  if (!filename) {
    throw ApiError.notFound(
      'Le document contractuel n’est pas disponible.',
      { code: CONTRACT_DOCUMENT_NOT_FOUND },
    );
  }
  const dir = contractDir(contract._id);
  const full = path.resolve(dir, filename);
  if (!full.startsWith(path.resolve(dir) + path.sep)) {
    throw ApiError.badRequest('Chemin de document invalide.');
  }
  return full;
}

/** Ancien nom, conservé le temps que les appelants historiques migrent. */
export const resolveDocumentPath = resolveContractDocumentPath;

/**
 * LE FICHIER EST-IL RÉELLEMENT LISIBLE ? — version synchrone.
 *
 * ── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 * La sérialisation d'un contrat annonçait « document présent » sur la seule
 * foi d'un nom de fichier en base. Un document référencé mais absent du
 * stockage — restauration partielle, fichier resté dans une release
 * précédente, dossier non partagé — donnait donc un bouton « Télécharger le
 * contrat » parfaitement visible, qui répondait 404 au clic. L'écran affirmait
 * ce que seul le disque peut confirmer.
 *
 * ── POURQUOI SYNCHRONE ──────────────────────────────────────────────────────
 * La sérialisation est appelée depuis une vingtaine d'endroits, tous
 * synchrones. La rendre asynchrone pour un `stat` local aurait propagé un
 * `await` dans tous les contrôleurs du domaine, pour une lecture de métadonnée
 * qui coûte quelques microsecondes sur un disque local et ne concerne qu'un ou
 * deux fichiers par contrat. Le coût réel est ici du bon côté.
 *
 * Ne lève jamais : un stockage illisible rend « absent ».
 */
export function documentExistsSync(contract, variante) {
  const kind = normaliserVariante(variante);
  const filename = contract?.document?.[CHAMP_FICHIER[kind]];
  if (!filename) return false;
  try {
    const stat = statSync(resolveContractDocumentPath(contract, kind));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * INSPECTE le stockage RÉEL d'un contrat.
 *
 * ── POURQUOI REGARDER LE DISQUE ─────────────────────────────────────────────
 * La base dit ce qu'on a écrit ; le stockage dit ce qui EXISTE. Les deux
 * peuvent diverger : un document déposé avant que la projection ne sache le
 * décrire, une restauration partielle, un fichier effacé à la main. Se fier à
 * la seule base, c'est annoncer « document disponible » sur un fichier absent
 * — ou l'inverse, ce qui est arrivé.
 *
 * Ne lève JAMAIS : un stockage illisible rend « absent », pas une erreur. Un
 * descripteur ne doit pas tomber parce qu'un disque tousse.
 *
 * @returns {Promise<{original: {exists, size, modifiedAt}, signed: {…}}>}
 */
export async function inspectContractStorage(contract) {
  const regarder = async (kind) => {
    const nom = kind === 'signed'
      ? contract.document?.signedFilename
      : contract.document?.originalFilename;
    if (!nom) return { exists: false, size: 0, modifiedAt: null };
    try {
      const stat = await fs.stat(resolveDocumentPath(contract, kind));
      return {
        exists: stat.isFile() && stat.size > 0,
        size: stat.size,
        modifiedAt: stat.mtime,
      };
    } catch {
      // Référencé en base, introuvable sur le stockage : c'est une information,
      // pas une panne. L'écran dira « momentanément indisponible ».
      return { exists: false, size: 0, modifiedAt: null, missing: true };
    }
  };
  const [original, signed] = await Promise.all([regarder('original'), regarder('signed')]);
  return { original, signed };
}

/** Lit le buffer d'un document ('original' | 'signed') d'un contrat. */
export async function readDocumentBuffer(contract, kind) {
  const full = resolveDocumentPath(contract, kind);
  return fs.readFile(full);
}

/**
 * Résout un document de contrat en vue d'un envoi à un prestataire externe.
 *
 * Le fichier est lu depuis le STOCKAGE LOCAL du contrat — jamais re-téléchargé
 * depuis une URL (localhost/ngrok/publique) : le binaire est déjà là, un aller
 * HTTP n'ajouterait qu'un point de panne et une dépendance à l'exposition
 * réseau du serveur.
 *
 * Vérifie tout ce qui, sinon, échouerait chez le prestataire avec un message
 * opaque : fichier présent, non vide, réellement un PDF. Mieux vaut un refus
 * local explicite qu'un 400 distant.
 *
 * @returns {Promise<{buffer: Buffer, filename: string, size: number, contentType: string}>}
 */
export async function resolveContractDocumentFile(contract, kind = 'original') {
  const full = resolveDocumentPath(contract, kind); // lève si absent + anti path-traversal

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    /**
     * ══ « INTROUVABLE » NE VEUT PAS DIRE « PERDU » ════════════════════════════
     *
     * Les documents de contrat n'ont qu'un seul domicile : l'instance AUTORITÉ.
     * Depuis un poste de développement, le PDF déposé vit chez le déployé — la
     * lecture HTTP le relaie correctement, mais CE chemin-ci lit le disque.
     *
     * Le message d'origine disait « Ré-importez le document ». C'était le pire
     * conseil possible : le document existe, il n'est simplement pas ici, et
     * le ré-importer ne ferait qu'ajouter une copie au même endroit distant.
     *
     * On distingue donc les deux situations. Le comportement ne change pas —
     * l'instance autorité lit toujours son disque, et rien ne se rabat sur une
     * copie locale — mais le diagnostic cesse d'envoyer au mauvais endroit.
     */
    const { isAuthority, authority } = await resolveProjectMediaAuthority().catch(
      () => ({ isAuthority: true, authority: null }),
    );
    if (!isAuthority && authority) {
      throw ApiError.badRequest(
        `Le PDF ${kind} de ce contrat est hébergé par l’instance déployée, pas par celle-ci. `
        + 'Les documents de contrat n’ont qu’un seul domicile : cette opération doit être '
        + 'lancée depuis le Manager déployé. Ne ré-importez pas le document — il existe.',
        { code: 'PROJECT_DOCUMENT_NOT_LOCAL_AUTHORITY' }
      );
    }
    throw ApiError.badRequest(
      `Le PDF ${kind} du contrat est introuvable sur le stockage. Ré-importez le document.`
    );
  }
  if (!stat.isFile()) throw ApiError.badRequest('Le document du contrat n’est pas un fichier.');
  if (stat.size === 0) {
    throw ApiError.badRequest('Le PDF du contrat est vide (0 octet). Ré-importez le document.');
  }
  if (stat.size > MAX_PDF_BYTES) {
    throw ApiError.badRequest(`PDF trop volumineux (max ${MAX_PDF_BYTES / (1024 * 1024)} Mo).`);
  }

  const buffer = await fs.readFile(full);
  if (!buffer.subarray(0, 5).equals(PDF_MAGIC)) {
    throw ApiError.badRequest('Le fichier stocké n’est pas un PDF valide (signature %PDF absente).');
  }

  return {
    buffer,
    // Nom lisible côté prestataire (le nom stocké est un UUID opaque).
    filename: `contrat-${contract.reference || contract._id}.pdf`,
    size: buffer.length,
    contentType: 'application/pdf',
  };
}

/**
 * STREAME un document PDF vers la réponse (contrôle d'accès fait en amont).
 *
 * ── POURQUOI `attachment` ET NON `inline` ───────────────────────────────────
 * `inline` demandait au navigateur d'AFFICHER le PDF. Un clic sur « Télécharger
 * le contrat » ouvrait donc, au mieux, une visionneuse — jamais un fichier sur
 * le disque. C'est la moitié serveur du même défaut : le bouton disait
 * télécharger, la réponse disait afficher.
 *
 * ── L'EXISTENCE EST REVÉRIFIÉE ICI ──────────────────────────────────────────
 * La base dit ce qu'on a écrit ; le disque dit ce qui EXISTE. La projection
 * peut être en retard d'une restauration ou d'un fichier effacé à la main :
 * l'écran a pu afficher un bouton légitime pour un fichier qui n'est plus là.
 * On refuse alors avec un 404 nommé — jamais un 200 au corps vide, qui se
 * télécharge en un PDF illisible de zéro octet.
 *
 * `Content-Length` est posé : sans lui, le navigateur ne peut afficher aucune
 * progression, et une coupure au milieu passe pour un fichier complet.
 */
export async function streamDocument(res, contract, variante) {
  const kind = normaliserVariante(variante);
  const full = resolveContractDocumentPath(contract, kind);

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    throw ApiError.notFound(
      'Le document contractuel n’est pas disponible.',
      { code: CONTRACT_DOCUMENT_NOT_FOUND },
    );
  }
  if (!stat.isFile() || stat.size === 0) {
    throw ApiError.notFound(
      'Le document contractuel n’est pas disponible.',
      { code: CONTRACT_DOCUMENT_NOT_FOUND },
    );
  }

  /**
   * LE NOM ET LE TYPE SUIVENT LA PIÈCE, pas une habitude.
   *
   * « contrat-…-certificate.pdf » dirait à celui qui l'ouvre qu'il tient le
   * contrat. Il tient sa PREUVE : ce sont deux documents différents, et les
   * nommer pareil garantit qu'un jour l'un sera produit pour l'autre.
   *
   * Le type déclaré est celui qu'on a ARCHIVÉ : rien ne garantit un PDF à
   * perpétuité, et affirmer « PDF » sur un autre format ferait échouer
   * l'ouverture sans dire pourquoi.
   */
  const estCertificat = kind === 'CERTIFICATE';
  const type = estCertificat
    ? (contract.document?.certificateContentType || 'application/octet-stream')
    : 'application/pdf';
  const extension = /pdf/i.test(type) ? 'pdf' : 'bin';
  const safeName = estCertificat
    ? `certificat-signature-${contract.reference || contract._id}.${extension}`
    : `contrat-${contract.reference || contract._id}-${kind.toLowerCase()}.pdf`;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Cache-Control', 'private, no-store');
  createReadStream(full).pipe(res);
}

/**
 * OÙ UN DOCUMENT A PU RESTER — les racines plausibles, jamais une en dur.
 *
 * Un serveur déployé range ses fichiers sous `shared/storage`, et chaque
 * release reçoit un lien vers ce dossier. Un document déposé AVANT que ce lien
 * n'existe est resté dans la release de l'époque : il est toujours sur la
 * machine, mais plus sur le chemin canonique — et rien ne va l'y chercher.
 *
 * On dérive donc les racines candidates de la racine canonique elle-même, en
 * remontant l'arborescence : le chemin réel d'un lien symbolique, le
 * `shared/storage/contracts` du déploiement, et les autres releases voisines.
 * Aucune de ces adresses n'est écrite dans le code ni conservée en base : ce
 * sont des endroits où REGARDER, pas des chemins de travail.
 */
export function candidateStorageRoots(canonique = config.paths.contractStorage) {
  const racines = new Set();
  const ajouter = (p) => { if (p) racines.add(path.resolve(p)); };

  ajouter(canonique);
  // Un lien symbolique : sa cible réelle est une autre façon de nommer le même
  // dossier, mais elle peut aussi révéler un dossier physique distinct.
  try { ajouter(realpathSync(canonique)); } catch { /* le lien n'existe pas */ }

  // Remontée : .../<base>/backend/storage/contracts → <base>, puis les formes
  // que prend un déploiement autour de cette base.
  let courant = path.resolve(canonique);
  for (let i = 0; i < 6; i += 1) {
    const parent = path.dirname(courant);
    if (parent === courant) break;
    courant = parent;
    ajouter(path.join(courant, 'shared', 'storage', 'contracts'));
    ajouter(path.join(courant, 'storage', 'contracts'));

    // Les releases voisines : on ne cherche que dans les dossiers frères d'une
    // release, jamais dans tout le disque.
    const releases = path.join(courant, 'releases');
    try {
      for (const nom of readdirSync(releases)) {
        ajouter(path.join(releases, nom, 'backend', 'storage', 'contracts'));
      }
    } catch { /* pas de dossier de releases ici */ }
  }
  return [...racines];
}

/**
 * REPREND les documents restés hors du stockage canonique.
 *
 * ── LE PROBLÈME QU'ELLE RÉSOUT ──────────────────────────────────────────────
 * La base référence un fichier, le stockage canonique ne l'a pas, et pourtant
 * il est là — une release plus bas. Sans reprise, il faudrait redéposer à la
 * main un document qui existe déjà sur la machine, et qui porte la signature
 * du client.
 *
 * ── CE QU'ELLE NE FAIT PAS ──────────────────────────────────────────────────
 * Elle n'invente rien : un document introuvable partout reste introuvable, et
 * la projection dira `UNAVAILABLE`. Elle ne déplace pas non plus l'original :
 * elle COPIE vers le chemin canonique, pour qu'un retour arrière reste
 * possible tant que l'ancienne release existe.
 *
 * IDEMPOTENTE : un document déjà en place n'est pas touché ; relancée, elle ne
 * trouve plus rien à reprendre.
 *
 * @returns {Promise<{examined, repaired, missing, details}>}
 */
export async function adoptOrphanContractDocuments(contracts) {
  const racines = candidateStorageRoots();
  const canonique = path.resolve(config.paths.contractStorage);
  let examined = 0;
  let repaired = 0;
  let missing = 0;
  const details = [];

  for (const contract of contracts) {
    for (const kind of DOCUMENT_VARIANTS) {
      const filename = kind === 'SIGNED'
        ? contract.document?.signedFilename
        : contract.document?.originalFilename;
      if (!filename) continue;
      examined += 1;

      if (documentExistsSync(contract, kind)) continue;

      // Le nom est un UUID opaque : le chercher dans les racines candidates ne
      // peut pas ramener le fichier d'un autre contrat.
      let source = null;
      for (const racine of racines) {
        if (racine === canonique) continue;
        const candidat = path.join(racine, String(contract._id), filename);
        try {
          const stat = await fs.stat(candidat);
          if (stat.isFile() && stat.size > 0) { source = candidat; break; }
        } catch { /* pas ici */ }
      }

      if (!source) {
        missing += 1;
        details.push({ contractId: String(contract._id), kind, repaired: false });
        continue;
      }

      const cible = path.join(canonique, String(contract._id), filename);
      // eslint-disable-next-line no-await-in-loop
      await fs.mkdir(path.dirname(cible), { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await fs.copyFile(source, cible);
      repaired += 1;
      // On consigne le dossier d'origine pour le rapport, jamais en base.
      details.push({ contractId: String(contract._id), kind, repaired: true, from: path.dirname(source) });
    }
  }

  return { examined, repaired, missing, details };
}

/** Supprime le dossier de stockage d'un contrat (suppression réelle en DRAFT). */
export async function deleteContractStorage(contractId) {
  await fs.rm(contractDir(contractId), { recursive: true, force: true }).catch(() => {});
}
