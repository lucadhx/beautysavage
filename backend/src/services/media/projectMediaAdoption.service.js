/**
 * ADOPTION DES MÉDIAS MÉTIER ANTÉRIEURS — le parc existant rejoint le modèle.
 *
 * ══ CE QUE CE MODULE FERME ══════════════════════════════════════════════════
 *
 * Un projet en service depuis des mois n'a AUCUN descripteur. Ses fiches ne
 * portent qu'un chemin :
 *
 *     company.logos.header   = '/uploads/img-1784735408962-149225253.webp'
 *     beforeAfter.imageAfter = '/uploads/img-1783981616391-171701318.webp'
 *
 * … et les octets correspondants ne vivent nulle part ailleurs que dans le
 * `shared/uploads` de la destination. Le poste qui déploie, lui, n'a qu'un
 * `.gitkeep` — le relevé réel l'a montré : 0 fichier en local, 14 à distance.
 *
 * Conséquences, toutes constatées :
 *   · `media_publish` ne voyait RIEN à publier (il ne lit que des descripteurs) ;
 *   · toute reprise conduite depuis le poste de déploiement inventoriait du
 *     vide et concluait qu'il n'y avait rien à reprendre ;
 *   · un changement de domaine cassait toutes les images, puisque l'adresse
 *     n'était dérivée de rien.
 *
 * ══ OÙ CE MODULE S'EXÉCUTE ══════════════════════════════════════════════════
 *
 * LÀ OÙ SONT LES FICHIERS. `uploadsDir()` désigne, sur la destination, le
 * `shared/uploads` monté par le déploiement. Rien n'est rapatrié, rien n'est
 * réuploadé, et le filesystem du poste qui déploie n'est jamais lu.
 *
 * ══ CE QU'IL NE FAIT JAMAIS ═════════════════════════════════════════════════
 *
 *   · supprimer un fichier ;
 *   · renommer un fichier — un nom historique est une identité valide, voir
 *     plus bas ;
 *   · écraser un descripteur déjà attaché à une fiche : c'est un CONFLIT, et
 *     un conflit arrête le déploiement plutôt que d'être arbitré tout seul ;
 *   · toucher aux médias du DÉVELOPPEUR. Le branding du Panel, ses logos, les
 *     portraits de son équipe ne sont pas des médias de ce projet, et le
 *     registre ci-dessous ne peut structurellement pas les atteindre.
 *
 * ══ POURQUOI AUCUNE CANONICALISATION PHYSIQUE ═══════════════════════════════
 *
 * Un média adopté garde `img-1783953966067-898120780.webp`. Le renommer en
 * `<uuid>-<empreinte>.webp` supposerait de réécrire chaque fiche qui le cite,
 * pour un gain nul : l'identité d'un média est son DESCRIPTEUR et son
 * EMPREINTE, jamais son nom de fichier. Renommer, c'est prendre le risque de
 * casser ce qui marche pour satisfaire une convention.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { config } from '../../config/env.js';
import logger from '../../utils/logger.js';
import { ProjectMedia } from '../../models/ProjectMedia.model.js';
import { UPLOADS_PUBLIC_PREFIX } from '../upload.service.js';
import { sha256Of, uploadsDir, currentProjectScope } from './projectMedia.service.js';

const nowIso = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/*  LE REGISTRE — ce que l'adoption a le droit de toucher, et rien d'autre     */
/* -------------------------------------------------------------------------- */

/**
 * LES CHAMPS MÉTIER, NOMMÉS UN PAR UN.
 *
 * ── POURQUOI PAS UN BALAYAGE GÉNÉRIQUE ──────────────────────────────────────
 * Chercher « toute chaîne ressemblant à `/uploads/…` » dans toutes les
 * collections trouverait aussi `panelcompanyconfigurations.branding.logo` —
 * c'est-à-dire le logo du DÉVELOPPEUR, publié par le Panel. L'adopter en
 * ProjectMedia le ferait basculer sous l'autorité du projet, qui le
 * recomposerait ensuite contre son propre domaine. C'est exactement le défaut
 * que toute cette architecture supprime.
 *
 * Le registre est donc EXPLICITE. Ajouter un média métier demande d'ajouter
 * une ligne ici — et cette ligne est relue.
 */
export const CHAMPS_METIER = [
  {
    collection: 'companies',
    model: '../../models/Company.model.js',
    exportName: 'Company',
    fields: [
      { legacy: 'logos.header', descriptor: 'logosMedia.header', mediaType: 'logo' },
      { legacy: 'logos.favicon', descriptor: 'logosMedia.favicon', mediaType: 'favicon' },
      { legacy: 'heroImage', descriptor: 'heroImageMedia', mediaType: 'hero' },
    ],
  },
  {
    collection: 'chapters',
    model: '../../models/Chapter.model.js',
    exportName: 'Chapter',
    fields: [{ legacy: 'heroImage', descriptor: 'heroImageMedia', mediaType: 'chapter' }],
  },
];

/**
 * CE QUE L'ADOPTION NE DOIT JAMAIS ATTEINDRE — contrôlé, pas seulement promis.
 *
 * Ces collections portent des médias dont le PANEL est l'autorité, ou des
 * descripteurs déjà constitués. Une ligne ajoutée par distraction au registre
 * ci-dessus lèverait ici, au premier appel, plutôt que de publier le logo de
 * l'agence sous le domaine d'un client.
 */
export const COLLECTIONS_INTERDITES = new Set([
  'panelcompanyconfigurations',
  'panelprovidedapis',
  'panelmedias',
  'devcompanies',
  'projectmedias',
]);

/** Un chemin de champ qui trahirait une confusion d'autorité. */
const PREFIXES_INTERDITS = ['branding', 'developer', 'devCompany', 'team', 'panel'];

/**
 * L'ASSERTION STRUCTURELLE — exécutée à chaque adoption, jamais désactivable.
 *
 * Un test peut oublier un cas ; une assertion qui tourne dans le chemin réel,
 * non. Elle ne corrige rien : elle refuse.
 */
export function assertPerimetreMetier(registre = CHAMPS_METIER) {
  for (const entree of registre) {
    if (COLLECTIONS_INTERDITES.has(entree.collection)) {
      throw new Error(
        `Adoption refusée : « ${entree.collection} » ne porte pas de média métier de ce projet. `
        + 'Les médias du développeur restent sous l’autorité du Panel.',
      );
    }
    for (const champ of entree.fields) {
      const tete = String(champ.legacy).split('.')[0];
      if (PREFIXES_INTERDITS.some((p) => tete.toLowerCase() === p.toLowerCase())) {
        throw new Error(
          `Adoption refusée : le champ « ${entree.collection}.${champ.legacy} » relève de l’identité développeur.`,
        );
      }
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  OUTILS DE LECTURE                                                         */
/* -------------------------------------------------------------------------- */

/** Lit `a.b.c` sur un objet nu, sans lever si un maillon manque. */
function lire(objet, chemin) {
  return String(chemin).split('.').reduce((o, k) => (o == null ? undefined : o[k]), objet);
}

/**
 * LA CLÉ D'OBJET d'une référence historique — ou `null` si ce n'en est pas une.
 *
 * On accepte le chemin relatif (`/uploads/x.webp`) et le nom nu. Une URL
 * ABSOLUE est écartée : elle désigne un média servi par quelqu'un d'autre, et
 * l'adopter reviendrait à s'approprier un fichier dont on n'a pas les octets.
 */
export function objectKeyDeReference(valeur) {
  const brut = String(valeur ?? '').trim();
  if (!brut) return null;
  if (/^https?:\/\//i.test(brut) || /^data:/i.test(brut) || /^blob:/i.test(brut)) return null;

  const sansQuery = brut.split('?')[0].split('#')[0];
  const chemin = sansQuery.startsWith(`${UPLOADS_PUBLIC_PREFIX}/`)
    ? sansQuery.slice(UPLOADS_PUBLIC_PREFIX.length + 1)
    : sansQuery;

  // Un nom d'objet ne contient aucun séparateur : sinon ce n'est pas une clé,
  // c'est un chemin qu'on n'a pas su lire — et deviner serait pire.
  if (!chemin || chemin.includes('/') || chemin.includes('\\')) return null;
  return chemin;
}

/* -------------------------------------------------------------------------- */
/*  L'ADOPTION                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ADOPTE les médias métier existants — DRY-RUN par défaut.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.apply]        faux = simulation stricte, aucune écriture
 * @param {string}  [opts.createdBy]
 * @param {string}  [opts.environment]  environnement de CETTE instance
 * @returns {Promise<object>} rapport complet, lisible tel quel
 */
export async function adoptLegacyProjectMedia({
  apply = false, createdBy = null, environment = config.env,
} = {}) {
  assertPerimetreMetier();

  const dossier = uploadsDir();
  const scope = await currentProjectScope();

  const rapport = {
    mode: apply ? 'APPLY' : 'DRY-RUN',
    environment,
    uploadsDir: dossier,
    projectId: scope.projectId,
    projectIdentityId: scope.projectIdentityId,
    /** Fichiers RÉELLEMENT présents là où cette instance regarde. */
    remoteFiles: [],
    /** Références historiques trouvées dans les fiches métier. */
    legacyRefs: [],
    /** Médias à décrire — aucun descripteur n'existe encore. */
    toCreate: [],
    /** Fiches à raccrocher à un descripteur. */
    toAttach: [],
    /** Déjà adoptés ET déjà attachés : rien à faire. */
    already: [],
    /** Référencés par une fiche, mais absents du dossier des médias. */
    missing: [],
    /** Deux clés distinctes, même contenu — signalé, jamais fusionné. */
    duplicates: [],
    /** Une fiche porte DÉJÀ un autre descripteur : seul un humain tranche. */
    conflicts: [],
    errors: [],
    created: 0,
    attached: 0,
  };

  /**
   * CE QUI EST RÉELLEMENT UN MÉDIA.
   *
   * `.gitkeep` maintient le dossier dans le dépôt ; le compter ferait dire au
   * rapport « 1 fichier présent » là où il n'y en a aucun — précisément
   * l'ambiguïté qu'on essaie de lever. Les sous-dossiers ne sont pas des médias
   * non plus : un descripteur ne décrit qu'un objet, jamais une arborescence.
   */
  const entrees = await fs.readdir(dossier, { withFileTypes: true }).catch(() => []);
  const fichiers = new Set(
    entrees.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name),
  );
  rapport.remoteFiles = [...fichiers].sort();

  /** Descripteurs produits pendant CETTE passe, pour ne pas décrire deux fois. */
  const decrits = new Map();

  for (const entree of CHAMPS_METIER) {
    const module = await import(entree.model).catch(() => null);
    const Model = module?.[entree.exportName] ?? module?.default;
    if (!Model) {
      rapport.errors.push({ collection: entree.collection, reason: 'modèle introuvable' });
      continue;
    }

    const docs = await Model.find({}).lean();
    for (const doc of docs) {
      for (const champ of entree.fields) {
        const brut = lire(doc, champ.legacy);
        const objectKey = objectKeyDeReference(brut);
        if (!objectKey) continue;

        const reference = {
          collection: entree.collection,
          documentId: String(doc._id),
          field: champ.legacy,
          descriptorField: champ.descriptor,
          mediaType: champ.mediaType,
          value: String(brut),
          objectKey,
        };
        rapport.legacyRefs.push(reference);

        /**
         * LA FICHE PORTE-T-ELLE DÉJÀ UN DESCRIPTEUR ?
         *
         * S'il désigne le même objet, tout est fait. S'il en désigne un autre,
         * la fiche affirme deux choses contradictoires : on ne choisit pas à sa
         * place, on ARRÊTE. Écraser détruirait une donnée qu'on n'a pas écrite.
         */
        const existantSurFiche = lire(doc, champ.descriptor);
        if (existantSurFiche?.objectKey) {
          if (existantSurFiche.objectKey === objectKey) {
            rapport.already.push({ ...reference, reason: 'DESCRIPTEUR_DEJA_ATTACHE' });
          } else {
            rapport.conflicts.push({
              ...reference,
              attachedObjectKey: existantSurFiche.objectKey,
              reason: 'LA_FICHE_PORTE_UN_AUTRE_DESCRIPTEUR',
            });
          }
          continue;
        }

        if (!fichiers.has(objectKey)) {
          // Aucun octet ici. On le DIT : inventer un descripteur pour un
          // fichier absent produirait une adresse qui ne sert rien.
          rapport.missing.push(reference);
          continue;
        }

        /* ---- LE DESCRIPTEUR : retrouvé, ou constitué depuis les octets ---- */
        let media = decrits.get(objectKey) ?? null;
        if (!media) media = await ProjectMedia.findOne({ objectKey }).lean();

        if (media) {
          decrits.set(objectKey, media);
          rapport.already.push({ ...reference, reason: 'MEDIA_DEJA_DECRIT' });
        } else {
          let contenu;
          let meta;
          try {
            contenu = await fs.readFile(path.join(dossier, objectKey));
            meta = await sharp(contenu).metadata();
          } catch (err) {
            rapport.errors.push({ ...reference, reason: err.message });
            continue;
          }

          const empreinte = sha256Of(contenu);

          /**
           * MÊME CONTENU, AUTRE NOM — signalé, jamais fusionné.
           *
           * Deux fichiers distincts existent sur le disque et deux fiches les
           * citent. Les rabattre sur un seul descripteur ferait qu'une
           * suppression future emporterait les deux. On décrit chaque objet, et
           * on NOMME la coïncidence pour qu'elle soit relue.
           */
          const jumeau = await ProjectMedia.findOne({
            projectId: scope.projectId, environment, sha256: empreinte, deletedAt: null,
          }).lean();
          if (jumeau && jumeau.objectKey !== objectKey) {
            rapport.duplicates.push({ objectKey, sameContentAs: jumeau.objectKey, sha256: empreinte });
          }

          media = {
            mediaId: randomUUID(),
            projectId: scope.projectId,
            projectIdentityId: scope.projectIdentityId,
            mediaType: champ.mediaType,
            environment,
            /**
             * `LOCAL_ONLY` : la présence du fichier ne PROUVE pas qu'un serveur
             * le sert. `media_publish` le constatera juste après — il verra le
             * fichier déjà en place sous sa clé, vérifiera son empreinte, et le
             * publiera SANS aucun transfert. C'est tout l'intérêt d'adopter
             * avant de publier.
             */
            publicationState: 'LOCAL_ONLY',
            owner: { collection: entree.collection, documentId: String(doc._id), field: champ.legacy },
            /** Le nom HISTORIQUE est conservé : c'est une identité valide. */
            objectKey,
            path: `${UPLOADS_PUBLIC_PREFIX}/${objectKey}`,
            mime: meta.format ? `image/${meta.format}` : 'application/octet-stream',
            size: contenu.length,
            width: meta.width ?? null,
            height: meta.height ?? null,
            sha256: empreinte,
            version: 1,
            createdBy,
          };
          decrits.set(objectKey, media);
          rapport.toCreate.push({
            objectKey, mediaType: champ.mediaType, sha256: empreinte,
            size: media.size, mime: media.mime, width: media.width, height: media.height,
          });
        }

        rapport.toAttach.push({ ...reference, mediaId: media.mediaId, sha256: media.sha256 });
      }
    }
  }

  /**
   * UN CONFLIT ARRÊTE TOUT — avant la moindre écriture.
   *
   * Appliquer « le reste » laisserait la base à moitié reprise, et la prochaine
   * exécution partirait d'un état que personne n'a décidé.
   */
  if (rapport.conflicts.length) {
    logger.error(`[media] Adoption interrompue : ${rapport.conflicts.length} conflit(s) de descripteur. `
      + 'Aucune écriture n’a eu lieu.');
    return rapport;
  }

  if (!apply) return rapport;

  /* ------------------------------ ÉCRITURE ------------------------------ */

  const at = nowIso();
  for (const [objectKey, media] of decrits) {
    // `upsert` sur la clé d'objet : deux passes concurrentes ne créent qu'un
    // seul descripteur, et une reprise après coupure ne duplique rien.
    const res = await ProjectMedia.updateOne(
      { objectKey },
      { $setOnInsert: { ...media, createdAt: at, updatedAt: at } },
      { upsert: true },
    );
    if (res.upsertedCount) rapport.created += 1;
  }

  for (const cible of rapport.toAttach) {
    const entree = CHAMPS_METIER.find((e) => e.collection === cible.collection);
    const module = await import(entree.model);
    const Model = module[entree.exportName] ?? module.default;

    const media = await ProjectMedia.findOne({ objectKey: cible.objectKey }).lean();
    if (!media) {
      rapport.errors.push({ ...cible, reason: 'descripteur introuvable après écriture' });
      continue;
    }

    const descripteur = {
      /** Média MÉTIER : son adresse suivra la destination active du projet. */
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

    /**
     * L'ÉCRITURE EST CONDITIONNÉE À L'ABSENCE DE DESCRIPTEUR.
     *
     * Entre la lecture et ici, un opérateur a pu en attacher un depuis le
     * Manager. Le filtre garantit qu'on ne remplace jamais ce qu'on n'a pas lu.
     */
    const res = await Model.updateOne(
      { _id: cible.documentId, [cible.descriptorField]: null },
      { $set: { [cible.descriptorField]: descripteur } },
    );
    if (res.modifiedCount) rapport.attached += 1;
  }

  logger.info(`[media] Adoption ${environment} : ${rapport.created} descripteur(s) créé(s), `
    + `${rapport.attached} fiche(s) raccrochée(s), ${rapport.missing.length} référence(s) sans fichier.`);
  return rapport;
}

/* -------------------------------------------------------------------------- */
/*  L'EXÉCUTION À DISTANCE — au déploiement                                   */
/* -------------------------------------------------------------------------- */

/**
 * MARQUEURS DE RAPPORT — le flux distant n'est pas propre.
 *
 * `npm`, PM2 et le shell distant écrivent sur la même sortie. Encadrer le JSON
 * permet de l'extraire sans supposer que rien d'autre n'a parlé — supposition
 * qui, tôt ou tard, est fausse.
 */
export const RAPPORT_DEBUT = '__ADOPT_JSON_BEGIN__';
export const RAPPORT_FIN = '__ADOPT_JSON_END__';

/** Le rapport contenu dans une sortie distante, ou `null` s'il n'y en a pas. */
export function parseAdoptionReport(sortie) {
  const extrait = new RegExp(`${RAPPORT_DEBUT}([\\s\\S]*?)${RAPPORT_FIN}`).exec(String(sortie ?? ''));
  if (!extrait) return null;
  try {
    return JSON.parse(extrait[1]);
  } catch {
    return null;
  }
}

/**
 * LANCE LA REPRISE SUR LA DESTINATION, et rend son rapport.
 *
 * ── POURQUOI À DISTANCE ─────────────────────────────────────────────────────
 * Les octets du parc historique n'existent que dans le `shared/uploads` de la
 * destination. Le poste qui déploie n'a qu'un `.gitkeep` : une reprise conduite
 * depuis lui inventorierait du vide. On exécute donc le script du backend
 * FRAÎCHEMENT DÉPLOYÉ, qui lit son propre `.env`, sa base et ses fichiers.
 *
 * ── DEUX ÉCHECS DISTINCTS, ET ILS NE SE CONFONDENT PAS ──────────────────────
 *   · aucun rapport lisible → on ne sait rien, donc on ne déclare rien ;
 *   · des conflits → on sait exactement ce qui bloque, et on le NOMME.
 *
 * Dans les deux cas l'étape échoue : une étape média muette a déjà coûté un
 * déploiement.
 *
 * @returns {Promise<{report:object, ok:boolean, code:string|null, message:string|null, tail:string}>}
 */
export async function runRemoteProjectMediaAdoption({ transport, backendDir, timeoutMs = 180_000 }) {
  const res = await transport.exec(
    `cd ${backendDir} && node src/scripts/adopt-project-media.js --apply --json`,
    { timeoutMs },
  );
  const sortie = `${res?.stdout ?? ''}\n${res?.stderr ?? ''}`;
  const report = parseAdoptionReport(sortie);
  const tail = sortie.trim().slice(-400);

  if (!report || report.failed) {
    return {
      report,
      ok: false,
      code: 'PROJECT_MEDIA_ADOPT_UNREADABLE',
      message: report?.message
        ? `La reprise des médias a échoué sur la destination : ${report.message}`
        : 'La reprise des médias n’a produit aucun rapport lisible sur la destination.',
      tail,
    };
  }

  if (report.conflicts?.length) {
    return {
      report,
      ok: false,
      code: 'PROJECT_MEDIA_ADOPT_CONFLICT',
      message: `${report.conflicts.length} fiche(s) portent déjà un descripteur différent de la référence `
        + 'qu’elles citent. Aucune écriture n’a eu lieu : la reprise ne remplace pas une donnée '
        + 'qu’elle n’a pas écrite.',
      tail,
    };
  }

  return { report, ok: true, code: null, message: null, tail };
}

export default {
  CHAMPS_METIER,
  COLLECTIONS_INTERDITES,
  RAPPORT_DEBUT,
  RAPPORT_FIN,
  assertPerimetreMetier,
  objectKeyDeReference,
  adoptLegacyProjectMedia,
  parseAdoptionReport,
  runRemoteProjectMediaAdoption,
};
