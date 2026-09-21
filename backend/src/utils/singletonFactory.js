import { asyncHandler } from './asyncHandler.js';
import { ok } from './apiResponse.js';
import { getSingleton } from './singleton.js';

/**
 * Generate get/update controllers for a singleton model.
 *
 * @param {object} [opts]
 * @param {(body: object, req: object) => object} [opts.transform] — normalise le
 *   corps avant application.
 * @param {(doc: object) => Promise<object>} [opts.decorate] — enrichit la
 *   LECTURE seulement.
 */
export function singletonFactory(Model, { transform, decorate } = {}) {
  const get = asyncHandler(async (req, res) => {
    const doc = await getSingleton(Model);
    /**
     * LA DÉCORATION N'A LIEU QU'EN LECTURE, et n'écrase aucun champ stocké.
     *
     * Cette surface est un ÉDITEUR : ce qu'elle rend, elle le reçoit en
     * retour au prochain enregistrement. Y réécrire une adresse calculée la
     * ferait persister en base — exactement le défaut que le descripteur
     * supprime. Les adresses d'affichage voyagent donc dans un bloc PARALLÈLE,
     * consultable en lecture et ignoré à l'écriture.
     */
    return ok(res, decorate ? await decorate(doc) : doc);
  });

  const update = asyncHandler(async (req, res) => {
    const payload = transform ? await transform(req.body, req) : req.body;
    // Ne jamais réappliquer les champs techniques renvoyés par le client :
    // un __v périmé provoquerait une VersionError au save().
    const { _id, __v, createdAt, updatedAt, ...clean } = payload || {};
    void _id;
    void __v;
    void createdAt;
    void updatedAt;

    const doc = await saveWithRetry(Model, clean);
    return ok(res, doc);
  });

  return { get, update };
}

/**
 * Applique puis enregistre, avec UNE nouvelle tentative sur écriture concurrente.
 *
 * Mongoose active le verrouillage optimiste dès qu'on remplace un tableau
 * (`Company.media`, `businessHours`…) : il ajoute `__v` à la clause WHERE. Si le
 * document a bougé entre la lecture et le save — un webhook qui réconcilie le
 * statut du site, un second onglet, deux admins — le save ne matche rien et
 * lève `VersionError`, que l'utilisateur voyait en « Erreur serveur »
 * intermittent, sans rien avoir fait de mal.
 *
 * Rejouer une fois est ici LE comportement correct : `doc.set(clean)` est déjà
 * un « dernier écrivain gagne » (le manager renvoie tout le document), donc la
 * reprise sur une version fraîche produit exactement le résultat attendu. Une
 * seule tentative : si la collision se reproduit, c'est une vraie contention et
 * le 409 explicite doit remonter (cf. error.middleware.js).
 */
async function saveWithRetry(Model, clean) {
  try {
    const doc = await getSingleton(Model);
    doc.set(clean);
    await doc.save();
    return doc;
  } catch (err) {
    if (err?.name !== 'VersionError' && err?.name !== 'ParallelSaveError') throw err;
    const fresh = await getSingleton(Model); // relecture : version à jour
    fresh.set(clean);
    await fresh.save();
    return fresh;
  }
}

export default singletonFactory;
