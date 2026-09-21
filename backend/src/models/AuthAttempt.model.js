import mongoose from 'mongoose';

/**
 * LES TENTATIVES D'AUTHENTIFICATION — un compteur, pas un journal.
 *
 * ══ POURQUOI EN BASE, ET NON DANS UNE `Map` ═════════════════════════════════
 *
 * Le limiteur historique de ce projet gardait ses compteurs en mémoire. Trois
 * défauts, et les trois se paient :
 *
 *   · il MEURT au redémarrage — donc à chaque déploiement, et à chaque fois
 *     qu'un attaquant obtient un redémarrage ;
 *   · il est LOCAL au processus — le jour où deux instances servent le même
 *     domaine, la limite réelle double ;
 *   · il est INVISIBLE — personne ne peut constater qu'un compte est martelé.
 *
 * La base est déjà là, elle est partagée, une fenêtre de quinze minutes ne pèse
 * rien, et la purge est faite par un index TTL. Ajouter Redis pour ce seul
 * besoin coûterait une dépendance d'infrastructure que rien d'autre ne réclame.
 *
 * ══ CE QUE CE DOCUMENT NE PORTE PAS ═════════════════════════════════════════
 *
 * Ni mot de passe, ni e-mail en clair, ni jeton. L'identité est HACHÉE : ce
 * compteur doit dire « cette identité a trop essayé » sans constituer, au
 * passage, la liste des adresses que l'on tente de forcer.
 */
const authAttemptSchema = new mongoose.Schema(
  {
    /** `<portée>:<dimension>:<empreinte>` — voir le middleware. */
    key: { type: String, required: true, unique: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
    lastAttemptAt: { type: Date, default: null },
  },
  { collection: 'authattempts', versionKey: false },
);

/** La base fait le ménage. `expireAfterSeconds: 0` = « à la date portée ». */
authAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthAttempt = mongoose.model('AuthAttempt', authAttemptSchema);

export default AuthAttempt;
