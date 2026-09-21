/**
 * MÉDIAS MÉTIER DU PROJET — import, description, suppression, inventaire.
 *
 * ══ LA CAUSE TRAITÉE ═══════════════════════════════════════════════════════
 *
 * Chaque instance du backend écrivait dans son propre `/uploads`. Un média
 * importé depuis un poste de développement n'existait que sur ce poste ; le
 * site déployé ne l'avait jamais vu, et inversement. Les médias n'étaient
 * rapprochés que par NOM DE FICHIER — c'est-à-dire, entre deux projets voisins,
 * la façon la plus sûre de mélanger leurs images.
 *
 * L'autorité est désormais UNIQUE (voir `projectMediaAuthority.js`) et chaque
 * fichier porte un DESCRIPTEUR scopé : projet, identité de projet, type
 * métier, propriétaire, empreinte, type réel, taille, dimensions, version,
 * auteur.
 *
 * ══ CE QUE CE MODULE NE FAIT JAMAIS ════════════════════════════════════════
 *
 *   · supprimer physiquement un fichier encore RÉFÉRENCÉ quelque part ;
 *   · rapprocher deux médias par leur nom de fichier ;
 *   · dédupliquer hors de la portée d'un projet et d'un type ;
 *   · écrire sur le disque quand cette instance n'est pas l'autorité.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { config } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { ProjectMedia } from '../../models/ProjectMedia.model.js';
import { UPLOADS_PUBLIC_PREFIX } from '../upload.service.js';
import { isValidMediaName } from './mediaNaming.js';

const nowIso = () => new Date().toISOString();

/** Empreinte du CONTENU — la seule chose qui distingue « même image » d'« autre ». */
export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * NOM DE L'OBJET — `<mediaId>-<empreinte courte>.<ext>`.
 *
 * L'adresse dépend du CONTENU : un contenu différent a forcément une autre
 * adresse, et une adresse donnée ne peut plus jamais désigner autre chose. Le
 * fichier devient légitimement immuable, et aucune ancienne image ne peut
 * réapparaître après remplacement — sans le moindre paramètre anti-cache.
 */
export function objectKeyFor({ mediaId, sha256, extension = 'webp' }) {
  return `${mediaId}-${String(sha256).slice(0, 12)}.${extension}`;
}

/** Le dossier des médias — créé à la demande, jamais supposé présent. */
export function uploadsDir() {
  return config.paths.uploads;
}

/**
 * IDENTITÉ DE PROJET COURANTE — ce qui SURVIT à un changement de domaine.
 *
 * C'est elle, et elle seule, qui autorise un rapprochement entre deux
 * emplacements. Ni le domaine, ni la base, ni le serveur ne créent cette
 * parenté : deux projets distincts peuvent partager les trois.
 */
export async function currentProjectScope() {
  const scope = { projectId: null, projectIdentityId: null };
  try {
    const { ProjectIdentity } = await import('../../models/ProjectIdentity.model.js');
    const identite = await ProjectIdentity.findOne().lean();
    scope.projectIdentityId = identite?.identityId ?? identite?.projectIdentityId ?? null;
  } catch { /* identité absente : le média reste sans parenté déclarée */ }
  try {
    const { BridgePairing } = await import('../../models/BridgePairing.model.js');
    const appairage = await BridgePairing.findOne().lean();
    scope.projectId = appairage?.projectId ?? null;
  } catch { /* projet non appairé : la portée reste locale */ }
  return scope;
}

/* -------------------------------------------------------------------------- */
/*  LE RÉSOLVEUR CENTRAL D'ADRESSE                                            */
/* -------------------------------------------------------------------------- */

/** Hôtes qui ne désignent que la machine courante — jamais publiables. */
const HOTES_LOCAUX = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '[::1]']);

/**
 * Une adresse est-elle CANONIQUE, c'est-à-dire publiable hors de cette machine ?
 */
export function isCanonicalMediaUrl(url) {
  const brut = String(url ?? '').trim();
  if (!brut) return { ok: false, reason: 'adresse vide' };
  if (/^blob:/i.test(brut)) return { ok: false, reason: 'URL blob — locale au navigateur' };
  if (/^data:/i.test(brut)) return { ok: false, reason: 'URL data — le contenu voyagerait dans la projection' };
  if (/^file:/i.test(brut)) return { ok: false, reason: 'chemin disque' };
  if (/^[a-zA-Z]:[\\/]/.test(brut) || brut.startsWith('\\\\')) return { ok: false, reason: 'chemin disque' };
  if (!/^https?:\/\//i.test(brut)) return { ok: false, reason: 'adresse relative' };
  let hote;
  try {
    hote = new URL(brut).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'adresse illisible' };
  }
  if (HOTES_LOCAUX.has(hote)) return { ok: false, reason: `hôte local (${hote})` };
  return { ok: true };
}

/**
 * LA DESTINATION OÙ CE PROJET EST EN LIGNE, pour un environnement donné.
 *
 * Ni une destination retirée, ni une destination vidée, ni une destination en
 * cours de retrait : une adresse tirée de l'une d'elles mènerait à une
 * quarantaine 410 ou à un domaine rendu.
 *
 * `null` quand le projet n'est pas encore déployé dans cet environnement —
 * c'est le cas NORMAL d'une recette qu'on configure avant sa mise en ligne.
 */
export async function activeProjectDestination(environment) {
  if (!environment) return null;
  const { DeploymentTarget } = await import('../../models/DeploymentTarget.model.js');
  return DeploymentTarget.findOne({
    environment,
    lifecycleStatus: 'ACTIVE',
    state: 'DEPLOYED',
  }).sort({ lastDeployedAt: -1 }).lean();
}

/** L'adresse publique déclarée par la configuration réseau — repli seulement. */
async function adressePubliqueDeclaree() {
  try {
    const { getPublicBackendUrl } = await import('../networkConfig.service.js');
    return (await getPublicBackendUrl()) || null;
  } catch {
    return null;
  }
}

/**
 * ADRESSE D'UN MÉDIA MÉTIER — la SEULE fonction autorisée à en produire une.
 *
 * ══ POURQUOI L'URL N'EST PLUS UNE IDENTITÉ ══════════════════════════════════
 *
 * Les fiches stockaient l'adresse. Deux conséquences, et les deux se sont
 * produites : un projet non encore déployé n'avait aucune adresse publique,
 * donc aucun média enregistrable ; et le jour d'un changement de domaine,
 * toutes les fiches pointaient encore sur l'ancien.
 *
 * L'identité d'un média est son DESCRIPTEUR — clé d'objet, empreinte,
 * environnement. L'adresse en est DÉRIVÉE, à la lecture, contre la destination
 * ACTIVE du moment. Une fiche n'a donc plus jamais à être réécrite.
 *
 * Le nom est explicite (`ProjectMedia`) : le Panel a son propre résolveur, et
 * deux fonctions homonymes finissaient par être confondues.
 *
 * @param {object} media        descripteur (`ProjectMedia` ou sa projection)
 * @param {string} environment  environnement du LECTEUR — jamais celui deviné
 * @returns {Promise<{url:string|null, absolute:boolean, reason:string}>}
 */
export async function resolveProjectMediaUrl(media, environment) {
  if (!media?.objectKey) return { url: null, absolute: false, reason: 'AUCUN_MEDIA' };

  /**
   * AUCUN MÉLANGE D'ENVIRONNEMENTS. Un média de recette n'a rien à faire en
   * production, et réciproquement. Le résoudre « quand même » ferait afficher
   * l'image d'un monde dans l'autre — sans que rien ne le signale.
   */
  if (media.environment && environment && media.environment !== environment) {
    return { url: null, absolute: false, reason: 'ENVIRONNEMENT_DIFFERENT' };
  }
  if (media.deletedAt) return { url: null, absolute: false, reason: 'MEDIA_SUPPRIME' };

  const chemin = media.path ?? `${UPLOADS_PUBLIC_PREFIX}/${media.objectKey}`;
  const env = media.environment ?? environment;
  const destination = await activeProjectDestination(env);

  /**
   * DEUX SOURCES D'ADRESSE, DANS CET ORDRE, ET AUCUNE AUTRE.
   *
   *   1. la destination ACTIVE de cet environnement — l'autorité. Elle cesse
   *      d'exister dès qu'elle est retirée, ce qui interdit par construction
   *      d'annoncer l'adresse d'un site rendu ou en quarantaine ;
   *   2. à défaut, l'adresse publique de la configuration réseau — mais
   *      UNIQUEMENT si aucune destination n'est enregistrée pour cet
   *      environnement. Un projet mis en ligne avant l'existence du registre
   *      n'a pas de fiche ; sans ce repli, ses images cesseraient d'être
   *      publiées du jour au lendemain alors qu'elles sont bien servies.
   *
   * Dès qu'une destination existe, son cycle de vie fait autorité : un projet
   * dont la destination a été RETIRÉE redevient local.
   */
  const { DeploymentTarget } = await import('../../models/DeploymentTarget.model.js');
  const aucuneDestination = !destination
    && (await DeploymentTarget.countDocuments({ environment: env })) === 0;

  const candidats = [
    [destination?.url, 'DESTINATION_ACTIVE'],
    [aucuneDestination ? await adressePubliqueDeclaree() : null, 'CONFIGURATION_RESEAU'],
  ];

  for (const [brut, raison] of candidats) {
    if (!brut) continue;
    const base = String(brut).trim().replace(/\/+$/, '');
    const absolue = `${base}${chemin}`;
    if (isCanonicalMediaUrl(absolue).ok) return { url: absolue, absolute: true, reason: raison };
  }

  // Aucune adresse publiable : l'adresse LOCALE est la bonne réponse. Le
  // backend sert lui-même ses médias, et l'aperçu fonctionne.
  return { url: chemin, absolute: false, reason: 'LOCAL_SANS_DESTINATION' };
}

/**
 * LE DESCRIPTEUR STABLE — ce qu'une FICHE conserve d'un média.
 *
 * Aucune adresse : l'identité d'un média ne dépend pas du domaine courant.
 * Tous ces champs sont IMMUABLES pour une clé d'objet donnée — le nom porte
 * l'empreinte du contenu — ce qui rend leur recopie en fiche sans dérive.
 */
export function stableDescriptorOf(media) {
  if (!media?.objectKey) return null;
  return {
    /**
     * L'AUTORITÉ, ÉCRITE — jamais laissée à deviner.
     *
     * Sans elle, la lecture concluait « média du projet » sur la présence
     * d'une clé d'objet. Le Panel en publie aussi : son logo était alors
     * recomposé contre le domaine du client, et répondait 404. Ce champ est le
     * seul énoncé qui distingue les deux, et c'est l'ÉMETTEUR qui l'écrit.
     */
    authority: 'PROJECT',
    mediaId: media.mediaId,
    objectKey: media.objectKey,
    environment: media.environment ?? null,
    mediaType: media.mediaType ?? null,
    sha256: media.sha256,
    mime: media.mime,
    size: media.size,
    width: media.width ?? null,
    height: media.height ?? null,
    version: media.version ?? 1,
  };
}

/**
 * LE DESCRIPTEUR TEL QU'IL PART VERS LE PANEL — adresse absolue comprise.
 *
 * Il n'est produit QUE si l'on peut le rendre entièrement vrai. Tant qu'aucune
 * destination active ne sert cet environnement, on rend `null` : `/uploads/…`
 * ou `http://localhost` n'existent pas depuis un autre serveur, et le Panel
 * garde alors sa projection précédente plutôt qu'une image cassée.
 */
export async function publishableProjectDescriptor(valeur, { role = null } = {}) {
  const media = await findProjectMedia(valeur);
  if (!media || media.deletedAt) {
    // Valeur qui n'est pas un média connu : une URL externe absolue reste
    // acceptée, sans métadonnée inventée.
    const brut = String(valeur ?? '').trim();
    if (!brut || !/^https?:\/\//i.test(brut)) return null;
    if (!isCanonicalMediaUrl(brut).ok) return null;
    return {
      // Une URL externe RÉFÉRENCÉE par ce projet reste sous son autorité : c'est
      // lui qui décide de la publier, et lui seul qui la retire.
      authority: 'PROJECT',
      mediaId: null, url: brut, mime: null, size: null, width: null, height: null,
      sha256: null, version: null, updatedAt: null, role, external: true,
    };
  }

  const { url, absolute } = await resolveProjectMediaUrl(media, media.environment ?? config.env);
  if (!absolute) return null;
  return {
    authority: 'PROJECT',
    mediaId: media.mediaId,
    url,
    mime: media.mime,
    size: media.size,
    width: media.width,
    height: media.height,
    sha256: media.sha256,
    version: media.version,
    updatedAt: media.updatedAt,
    role: role ?? media.mediaType ?? null,
    publicationState: media.publicationState ?? 'LOCAL_ONLY',
    external: false,
  };
}

/* -------------------------------------------------------------------------- */
/*  IMPORT                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * IMPORTE un média métier et rend son descripteur complet.
 *
 * @param {Buffer} buffer
 * @param {object} args
 * @param {string} args.mediaType   type métier (logo, hero, gallery…)
 * @param {object} [args.owner]     { collection, documentId, field }
 * @param {string} [args.createdBy]
 * @param {number} [args.maxWidth]
 * @param {'webp'|'png'} [args.format]
 */
export async function importProjectMedia(buffer, {
  mediaType = 'other', owner = null, createdBy = null, maxWidth = 1920, format = 'webp',
  square = false,
} = {}) {
  const dossier = uploadsDir();
  await fs.mkdir(dossier, { recursive: true });

  // On mesure la SORTIE, pas l'entrée : l'image est pivotée, redimensionnée et
  // convertie. Décrire l'entrée décrirait un fichier qui n'est pas servi.
  let pipeline = sharp(buffer).rotate();
  pipeline = square
    ? pipeline.resize(256, 256, { fit: 'cover' })
    : pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  const encode = await (format === 'png' ? pipeline.png() : pipeline.webp({ quality: 82 }))
    .toBuffer({ resolveWithObject: true });

  const empreinte = sha256Of(encode.data);
  const scope = await currentProjectScope();

  /**
   * RÉIMPORT DU MÊME FICHIER — dédupliqué, dans la portée du projet ET du
   * type. Hors de cette portée, on créerait un objet partagé dont la
   * suppression ferait disparaître une image qu'on ne visait pas.
   */
  const deja = await ProjectMedia.findOne({
    projectId: scope.projectId,
    // …et dans l'ENVIRONNEMENT courant. Rendre un média de production à un
    // import de recette ferait référencer, depuis une fiche TEST, un objet
    // appartenant à l'autre monde.
    environment: config.env,
    mediaType,
    sha256: empreinte,
    deletedAt: null,
  }).lean();
  if (deja) {
    const present = await fs.access(path.join(dossier, deja.objectKey)).then(() => true).catch(() => false);
    if (present) {
      return {
        url: deja.path,
        publicUrl: (await resolveProjectMediaUrl(deja, deja.environment)).url,
        descriptor: stableDescriptorOf(deja),
        filename: deja.objectKey,
        media: deja,
        deduplicated: true,
      };
    }
  }

  const mediaId = randomUUID();
  const objectKey = objectKeyFor({ mediaId, sha256: empreinte, extension: format });
  await fs.writeFile(path.join(dossier, objectKey), encode.data);

  const at = nowIso();
  const doc = await ProjectMedia.create({
    mediaId,
    projectId: scope.projectId,
    projectIdentityId: scope.projectIdentityId,
    mediaType,
    /**
     * L'ENVIRONNEMENT est celui de l'instance qui ÉCRIT le fichier — c'est-à-
     * dire l'autorité. Une instance cliente ne passe jamais ici : elle relaie.
     */
    environment: config.env,
    /**
     * Un média neuf n'existe que sur la machine qui vient de l'écrire. Ce
     * n'est pas un défaut : c'est l'état normal d'un projet qu'on configure
     * avant de le déployer.
     */
    publicationState: 'LOCAL_ONLY',
    owner: owner ?? { collection: null, documentId: null, field: null },
    objectKey,
    path: `${UPLOADS_PUBLIC_PREFIX}/${objectKey}`,
    mime: `image/${encode.info.format}`,
    size: encode.info.size ?? encode.data.length,
    width: encode.info.width ?? null,
    height: encode.info.height ?? null,
    sha256: empreinte,
    version: 1,
    createdBy,
    createdAt: at,
    updatedAt: at,
  });

  const media = doc.toObject();
  return {
    /** Le CHEMIN DE STOCKAGE — ce que la fiche conserve à côté du descripteur. */
    url: media.path,
    /**
     * L'adresse utilisable MAINTENANT — absolue si une destination sert déjà
     * ce média, locale sinon. Elle sert l'aperçu, jamais l'identité, et n'est
     * jamais enregistrée.
     */
    publicUrl: (await resolveProjectMediaUrl(media, media.environment)).url,
    /** Le descripteur STABLE, celui que la fiche conserve. */
    descriptor: stableDescriptorOf(media),
    filename: objectKey,
    media,
  };
}

/* -------------------------------------------------------------------------- */
/*  RÉFÉRENCES                                                                */
/* -------------------------------------------------------------------------- */

/**
 * QUI RÉFÉRENCE ENCORE CE MÉDIA ?
 *
 * ── POURQUOI UN BALAYAGE GÉNÉRIQUE ──────────────────────────────────────────
 * Les chemins de médias vivent dans des champs très divers : `logos.main`,
 * `heroImage`, `imageBefore`, `images[]`, et demain ailleurs. Tenir une liste
 * de champs la ferait dériver au premier ajout, et une suppression détruirait
 * alors une image encore affichée. On cherche donc la CHAÎNE dans toutes les
 * collections métier — c'est plus lent, et c'est la seule façon d'être sûr.
 *
 * `projectmedias` est exclue : le descripteur d'un média n'est pas un usage.
 */
export async function findReferences(chemin) {
  const mongoose = (await import('mongoose')).default;
  const db = mongoose.connection?.db;
  if (!db) return [];

  const cible = String(chemin ?? '').trim();
  if (!cible) return [];
  const nom = cible.split('/').pop();

  const references = [];
  const collections = await db.listCollections().toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.') || name === 'projectmedias') continue;

    // On cherche le NOM du fichier, pas le chemin : une fiche ancienne peut
    // porter une URL absolue et une fiche récente un chemin relatif — les deux
    // désignent le même objet, et ne pas les reconnaître toutes deux ferait
    // supprimer une image encore affichée.
    const curseur = db.collection(name).find({});
    for await (const doc of curseur) {
      if (JSON.stringify(doc).includes(nom)) {
        references.push({ collection: name, documentId: String(doc._id) });
      }
    }
  }
  return references;
}

/* -------------------------------------------------------------------------- */
/*  SUPPRESSION                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Les formes de nom acceptées vivent désormais dans `mediaNaming.js`.
 *
 * Le balayage anti-orphelins a besoin de la MÊME définition pour reconnaître,
 * dans une fiche, une clé d'objet nue — celle que porte un descripteur, qui n'a
 * délibérément pas de chemin. Deux copies auraient garanti qu'une correction
 * n'atteigne qu'un des deux endroits.
 *
 * Réexporté : les appelants historiques importent ce nom depuis ce module.
 */
export { isValidMediaName };

/**
 * SUPPRIME un média métier — une opération UNIQUE sur l'autorité.
 *
 * ── PAS DE SUPPRESSION PHYSIQUE SI ENCORE UTILISÉ ───────────────────────────
 * Un média encore référencé par une fiche est conservé, et on le DIT. Le
 * supprimer laisserait une image cassée dans la vitrine du client, sans que
 * rien n'indique pourquoi.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * Un double clic, deux onglets, une reprise après coupure : le média peut
 * avoir déjà disparu. On le dit (`alreadyGone`) plutôt que de lever — le
 * résultat voulu est atteint dans les deux cas.
 */
export async function deleteProjectMedia(filename, { force = false } = {}) {
  const nom = String(filename ?? '').trim();
  if (!isValidMediaName(nom)) {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw ApiError.badRequest(
      'Nom de média invalide : la forme attendue est celle produite à l’import.',
      { code: 'PROJECT_MEDIA_INVALID_NAME' },
    );
  }

  const dossier = uploadsDir();
  const cible = path.join(dossier, nom);
  // Ceinture et bretelles : après résolution, le chemin doit rester DANS le
  // dossier des médias. Une expression régulière peut être contournée un jour ;
  // la comparaison de chemins résolus, non.
  if (path.dirname(path.resolve(cible)) !== path.resolve(dossier)) {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw ApiError.badRequest('Chemin de média hors du dossier autorisé.',
      { code: 'PROJECT_MEDIA_PATH_ESCAPE' });
  }

  const chemin = `${UPLOADS_PUBLIC_PREFIX}/${nom}`;
  if (!force) {
    const references = await findReferences(chemin);
    if (references.length > 0) {
      const { ApiError } = await import('../../utils/ApiError.js');
      throw ApiError.badRequest(
        `Ce média est encore utilisé par ${references.length} fiche(s) : le supprimer laisserait une image cassée. `
        + 'Retirez-le d’abord de ces fiches.',
        { code: 'PROJECT_MEDIA_STILL_REFERENCED', references },
      );
    }
  }

  // Le DESCRIPTEUR survit — c'est lui qui permet de répondre 410 plutôt qu'un
  // 404 muet, et de savoir que la disparition est volontaire.
  const at = nowIso();
  await ProjectMedia.updateOne({ objectKey: nom }, { $set: { deletedAt: at, updatedAt: at } });

  try {
    await fs.unlink(cible);
    return { deleted: true, filename: nom, alreadyGone: false };
  } catch (err) {
    if (err?.code === 'ENOENT') return { deleted: true, filename: nom, alreadyGone: true };
    throw err;
  }
}

/** Le descripteur d'un média, par nom d'objet ou par chemin. */
export async function findProjectMedia(valeur) {
  const brut = String(valeur ?? '').trim();
  if (!brut) return null;
  const objectKey = brut.startsWith(`${UPLOADS_PUBLIC_PREFIX}/`)
    ? brut.slice(UPLOADS_PUBLIC_PREFIX.length + 1)
    : brut;
  return ProjectMedia.findOne({ objectKey }).lean();
}

/** Liste la bibliotheque media du projet courant pour le Manager. */
export async function listProjectMedia({
  mediaType = '',
  q = '',
  limit = 80,
  includeDeleted = false,
} = {}) {
  const scope = await currentProjectScope();
  const filtre = { environment: config.env };
  if (!includeDeleted) filtre.deletedAt = null;
  if (mediaType) filtre.mediaType = String(mediaType).trim();

  const portee = [];
  if (scope.projectId) portee.push({ projectId: scope.projectId });
  if (scope.projectIdentityId) portee.push({ projectIdentityId: scope.projectIdentityId });
  if (portee.length) filtre.$or = portee;

  const recherche = String(q || '').trim();
  if (recherche) {
    filtre.$and = [
      ...(filtre.$and || []),
      {
        $or: [
          { objectKey: { $regex: recherche, $options: 'i' } },
          { mediaType: { $regex: recherche, $options: 'i' } },
          { createdBy: { $regex: recherche, $options: 'i' } },
        ],
      },
    ];
  }

  const taille = Math.min(200, Math.max(1, Number(limit) || 80));
  const docs = await ProjectMedia.find(filtre).sort({ createdAt: -1 }).limit(taille).lean();
  return Promise.all(docs.map(async (media) => {
    const resolved = await resolveProjectMediaUrl(media, media.environment ?? config.env);
    return {
      id: String(media._id),
      mediaId: media.mediaId,
      mediaType: media.mediaType,
      path: media.path,
      objectKey: media.objectKey,
      publicUrl: resolved.url,
      mime: media.mime,
      size: media.size,
      width: media.width,
      height: media.height,
      sha256: media.sha256,
      createdBy: media.createdBy,
      createdAt: media.createdAt,
      publicationState: media.publicationState,
      descriptor: stableDescriptorOf(media),
    };
  }));
}

/* -------------------------------------------------------------------------- */
/*  PUBLICATION VERS UNE DESTINATION — au déploiement                         */
/* -------------------------------------------------------------------------- */

/** L'empreinte du fichier telle que LE SERVEUR la calcule — ou `ABSENT`. */
async function empreinteDistante(transport, chemin) {
  const res = await transport
    .exec(`sha256sum ${chemin} 2>/dev/null | cut -d' ' -f1 || echo ABSENT`)
    .catch(() => ({ stdout: 'ABSENT' }));
  const valeur = String(res.stdout ?? '').trim();
  return valeur === '' ? 'ABSENT' : valeur;
}

/**
 * TRANSFÈRE les médias métier de cet environnement vers la destination, VÉRIFIE ce
 * qui est arrivé, et ne marque PUBLIÉ que ce qui est prouvé.
 *
 * ══ POURQUOI CETTE ÉTAPE TRANSFÈRE, ET NE SE CONTENTE PAS DE CONSTATER ══════
 *
 * Le pipeline synchronise déjà le dossier `uploads` vivant vers le
 * `shared/uploads` de la destination — mais c'est une copie de dossier, tentée
 * au mieux et dont l'échec est absorbé (`.catch`), qui ne connaît aucun média
 * en particulier. S'en remettre à elle, c'était faire dépendre la publication
 * d'un effet de bord : le jour où le dossier local n'existe pas, où la copie
 * échoue, ou où un média a été importé après elle, le fichier n'arrive jamais
 * et rien ne le dit. Le premier déploiement d'un projet configuré en local est
 * exactement ce jour-là.
 *
 * L'étape prend donc la responsabilité complète, média par média :
 *
 *   1. lire l'empreinte SUR LE SERVEUR ;
 *   2. si le fichier est ABSENT, l'ENVOYER depuis le stockage local ;
 *   3. relire l'empreinte sur le serveur — après transfert, jamais avant ;
 *   4. comparer taille et empreinte à ce qui a été mesuré à l'import ;
 *   5. seulement alors, marquer PUBLISHED.
 *
 * L'ordre compte : publier sur la foi de ce qu'on vient d'envoyer reviendrait
 * à prouver qu'on a appelé une fonction, pas qu'un fichier est arrivé intact.
 *
 * ── CE QU'ELLE NE FAIT JAMAIS ───────────────────────────────────────────────
 * Écraser un fichier distant. Un contenu déjà présent sous la même clé mais
 * d'empreinte différente signifie qu'une hypothèse est fausse quelque part :
 * on le SIGNALE et on laisse le média local. Le corriger d'office effacerait
 * la trace du problème.
 *
 * Idempotente : relancée, elle ne retouche que ce qui n'est pas déjà publié
 * sur cet hôte, et ne retransfère que ce qui manque réellement.
 *
 * @param {object} args
 * @param {object} args.transport      transport ouvert sur la destination
 * @param {string} args.sharedUploads  chemin distant du dossier partagé
 * @param {string} args.host           hôte de la destination
 * @param {string} [args.environment]  environnement déployé
 */
export async function publishProjectMediaOnDestination({
  transport, sharedUploads, host, environment = config.env,
}) {
  const rapport = {
    environment,
    host,
    scanned: 0,
    published: 0,
    /** Médias réellement ENVOYÉS pendant cette passe — le premier déploiement. */
    transferred: [],
    /** Introuvables des DEUX côtés : plus rien à transférer. */
    missing: [],
    mismatched: [],
    alreadyPublished: 0,
  };
  if (!transport || !sharedUploads || !host) return rapport;

  const fs = await import('node:fs/promises');
  const pathMod = await import('node:path');
  const { uploadsDir } = await import('./projectMedia.service.js');

  const medias = await ProjectMedia.find({ environment, deletedAt: null }).lean();
  rapport.scanned = medias.length;

  for (const media of medias) {
    if (media.publicationState === 'PUBLISHED' && media.publishedHost === host) {
      rapport.alreadyPublished += 1;
      continue;
    }

    const distant = `${sharedUploads}/${media.objectKey}`;
    let empreinte = await empreinteDistante(transport, distant);

    /**
     * LE FICHIER N'EST PAS LÀ — on l'ENVOIE.
     *
     * C'est le cas nominal du premier déploiement : le média n'a jamais existé
     * ailleurs que dans le stockage local du Panel. Sans cet envoi, il resterait
     * LOCAL_ONLY indéfiniment et l'opérateur devrait le réimporter depuis
     * l'interface déployée — précisément ce qu'on supprime.
     */
    if (empreinte === 'ABSENT') {
      const local = pathMod.join(uploadsDir(), media.objectKey);
      const presentEnLocal = await fs.access(local).then(() => true).catch(() => false);
      if (!presentEnLocal) {
        // Absent des deux côtés : il n'y a rien à transférer, et le dire vaut
        // mieux que de laisser croire à un transfert manqué.
        rapport.missing.push(media.objectKey);
        continue;
      }

      if (typeof transport.uploadFile !== 'function') {
        rapport.missing.push(media.objectKey);
        continue;
      }
      await transport.uploadFile(local, distant);
      rapport.transferred.push(media.objectKey);

      // On RELIT l'empreinte sur le serveur. Se fier au transfert lui-même
      // prouverait qu'on a appelé une fonction, pas qu'un fichier est arrivé.
      empreinte = await empreinteDistante(transport, distant);
      if (empreinte === 'ABSENT') {
        rapport.missing.push(media.objectKey);
        continue;
      }
    }

    if (empreinte !== media.sha256) {
      rapport.mismatched.push({ objectKey: media.objectKey, expected: media.sha256, found: empreinte });
      continue;
    }

    /**
     * LA TAILLE AUSSI — relevée sur le serveur.
     *
     * L'empreinte suffirait en théorie. En pratique, une taille distante qui
     * diverge alors que l'empreinte correspond signale un `sha256sum` qui n'a
     * pas mesuré ce qu'on croit (lien, montage, troncature silencieuse). Le
     * contrôle est gratuit ; l'illusion de preuve ne l'est pas.
     */
    const tailleRes = await transport
      .exec(`stat -c %s ${distant} 2>/dev/null || echo ABSENT`)
      .catch(() => ({ stdout: 'ABSENT' }));
    const taille = String(tailleRes.stdout ?? '').trim();
    if (taille !== 'ABSENT' && Number.isFinite(Number(taille)) && Number(taille) !== media.size) {
      rapport.mismatched.push({
        objectKey: media.objectKey,
        expected: `${media.size} octets`,
        found: `${taille} octets`,
      });
      continue;
    }

    const at = nowIso();
    await ProjectMedia.updateOne(
      { objectKey: media.objectKey },
      { $set: { publicationState: 'PUBLISHED', publishedHost: host, publishedAt: at, updatedAt: at } },
    );
    rapport.published += 1;
  }

  if (rapport.transferred.length) {
    logger.info(`[media] ${rapport.transferred.length} média(s) ${environment} transféré(s) vers ${host}.`);
  }
  if (rapport.published) {
    logger.info(`[media] ${rapport.published} média(s) ${environment} vérifié(s) sur ${host} et publiés.`);
  }
  if (rapport.missing.length) {
    logger.warn(`[media] ${rapport.missing.length} média(s) ${environment} introuvables pour ${host} : `
      + `${rapport.missing.slice(0, 5).join(', ')}. Ils restent locaux et ne seront pas publiés aux projets.`);
  }
  for (const m of rapport.mismatched) {
    logger.error(`[media] Divergence pour « ${m.objectKey} » sur ${host} : `
      + `attendu ${String(m.expected).slice(0, 20)}, trouvé ${String(m.found).slice(0, 20)}. Média NON publié.`);
  }
  return rapport;
}

/**
 * DÉPUBLICATION — la destination ne sert plus ces médias.
 *
 * ── POURQUOI CE N'EST PAS FACULTATIF ────────────────────────────────────────
 * Un média restait `PUBLISHED` avec, pour `publishedHost`, un hôte qui
 * n'existait plus. Le champ mentait : il affirmait une présence constatée sur
 * un serveur dont on venait d'effacer les fichiers. Toute décision prise
 * ensuite sur cet état — republier, ignorer, croire un cache — reposait sur
 * une affirmation fausse.
 *
 * Appelée à la fin d'un retrait. Le média n'est pas supprimé : il redevient
 * simplement ce qu'il était avant la mise en ligne — présent ici, nulle part
 * ailleurs.
 *
 * @returns {Promise<{environment:string, host:string|null, unpublished:number}>}
 */
export async function unpublishProjectMediaOfDestination({ host = null, environment }) {
  const filtre = { environment, publicationState: 'PUBLISHED' };
  // Un hôte donné ne dépublie que CE qu'il servait : deux destinations d'un
  // même environnement ne doivent pas se dépublier l'une l'autre.
  if (host) filtre.publishedHost = host;

  const at = nowIso();
  const res = await ProjectMedia.updateMany(filtre, {
    $set: { publicationState: 'LOCAL_ONLY', publishedHost: null, publishedAt: null, updatedAt: at },
  });
  const nombre = res.modifiedCount ?? 0;
  if (nombre) {
    logger.info(`[media] ${nombre} média(s) ${environment} redeviennent locaux : `
      + `${host ?? 'la destination'} ne les sert plus.`);
  }
  return { environment, host, unpublished: nombre };
}

/**
 * REPRISE DES MÉDIAS ANTÉRIEURS — appelée au démarrage.
 *
 * Les descripteurs existants n'ont ni environnement ni état de publication :
 * ces champs viennent d'apparaître. On leur attribue l'environnement de
 * l'INSTANCE qui les a écrits — c'est la seule information vraie dont on
 * dispose, et deviner autre chose reviendrait à réécrire le passé.
 *
 * `publicationState` reste à son défaut `LOCAL_ONLY` : rien n'a été constaté
 * sur un serveur, et déclarer publié ce qu'on n'a pas vérifié est exactement
 * la faute que cette architecture supprime. Le prochain déploiement le
 * prouvera, ou pas.
 *
 * Idempotente : elle ne touche que les documents auxquels le champ manque.
 */
export async function migrateProjectMedia() {
  const res = await ProjectMedia.updateMany(
    { $or: [{ environment: { $exists: false } }, { environment: null }] },
    { $set: { environment: config.env } },
  );
  return { environmentBackfilled: res.modifiedCount ?? 0, environment: config.env };
}

/* -------------------------------------------------------------------------- */
/*  INVENTAIRE ET REPRISE DE L'EXISTANT                                       */
/* -------------------------------------------------------------------------- */

/**
 * INVENTAIRE des fichiers présents sous `/uploads` — sans rien modifier.
 *
 * Rend, pour chaque fichier : son descripteur s'il en a un, son empreinte, son
 * type réel, ses dimensions, et s'il est encore référencé. Les fichiers sans
 * descripteur ET sans référence sont des ORPHELINS ; ceux dont le descripteur
 * existe déjà sont ignorés.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.apply]  faux par défaut : le mode normal est le
 *        DRY-RUN. Une reprise qui écrit avant d'avoir été lue est une reprise
 *        qu'on n'a pas relue.
 */
export async function inventoryProjectMedia({ apply = false, createdBy = null } = {}) {
  const dossier = uploadsDir();
  const scope = await currentProjectScope();
  const fichiers = await fs.readdir(dossier).catch(() => []);

  const rapport = {
    mode: apply ? 'APPLY' : 'DRY-RUN',
    scanned: 0, described: 0, alreadyDescribed: 0, orphans: [], conflicts: [], errors: [],
  };

  for (const nom of fichiers) {
    const complet = path.join(dossier, nom);
    const stat = await fs.stat(complet).catch(() => null);
    if (!stat?.isFile()) continue;
    rapport.scanned += 1;

    const existant = await ProjectMedia.findOne({ objectKey: nom }).lean();
    if (existant) { rapport.alreadyDescribed += 1; continue; }

    let contenu;
    let meta;
    try {
      contenu = await fs.readFile(complet);
      meta = await sharp(contenu).metadata();
    } catch (err) {
      rapport.errors.push({ objectKey: nom, reason: err.message });
      continue;
    }

    const empreinte = sha256Of(contenu);
    const chemin = `${UPLOADS_PUBLIC_PREFIX}/${nom}`;
    const references = await findReferences(chemin);
    if (references.length === 0) {
      // ORPHELIN : aucun usage connu. On le SIGNALE, on ne le supprime pas —
      // une reprise n'est pas un ménage, et un fichier qu'on ne comprend pas
      // se garde.
      rapport.orphans.push({ objectKey: nom, size: stat.size, sha256: empreinte });
    }

    // Un même contenu déjà décrit ailleurs dans la même portée : on le
    // signale plutôt que de créer un second descripteur qui prétendrait
    // décrire un autre objet.
    const jumeau = await ProjectMedia.findOne({
      projectId: scope.projectId, sha256: empreinte, deletedAt: null,
    }).lean();
    if (jumeau) rapport.conflicts.push({ objectKey: nom, sameContentAs: jumeau.objectKey });

    if (!apply) continue;

    const at = nowIso();
    await ProjectMedia.create({
      mediaId: randomUUID(),
      projectId: scope.projectId,
      projectIdentityId: scope.projectIdentityId,
      // Le type n'est pas deviné depuis le nom : un nom ne dit pas ce qu'une
      // image représente. Il sera précisé par les fiches qui la référencent.
      mediaType: references[0]?.collection ?? 'other',
      /**
       * L'ENVIRONNEMENT est celui de l'INSTANCE qui reprend ces fichiers.
       *
       * C'est la seule information vraie dont on dispose : le fichier est sur
       * le disque de cette machine, donc il appartient à son monde. Le déduire
       * d'autre chose reviendrait à inventer.
       */
      environment: config.env,
      /**
       * `LOCAL_ONLY` : ces fichiers n'ont jamais été CONSTATÉS sur une
       * destination. Les déclarer publiés parce qu'ils sont là serait
       * exactement la faute que cette architecture supprime.
       */
      publicationState: 'LOCAL_ONLY',
      owner: references[0]
        ? { collection: references[0].collection, documentId: references[0].documentId, field: null }
        : { collection: null, documentId: null, field: null },
      objectKey: nom,
      path: chemin,
      mime: meta.format ? `image/${meta.format}` : 'application/octet-stream',
      size: stat.size,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sha256: empreinte,
      version: 1,
      createdBy,
      createdAt: at,
      updatedAt: at,
    });
    rapport.described += 1;
  }

  return rapport;
}

export default {
  sha256Of,
  objectKeyFor,
  uploadsDir,
  currentProjectScope,
  importProjectMedia,
  findReferences,
  isValidMediaName,
  deleteProjectMedia,
  findProjectMedia,
  listProjectMedia,
  inventoryProjectMedia,
};
