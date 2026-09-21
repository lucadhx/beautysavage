import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { ROLE_VALUES, ROLES, USER_STATUS, USER_STATUS_VALUES } from '../utils/constants.js';
import { notifyEntitySaved } from '../utils/syncNotifier.js';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true, // crée déjà l'index ; pas de `index: true` redondant
      lowercase: true,
      trim: true,
    },
    /**
     * ══ LE MOT DE PASSE EST FACULTATIF, ET C'EST LE CŒUR DU LOT 2C ═════════════
     *
     * Un compte peut exister AVANT d'avoir un mot de passe. C'est l'état d'un
     * premier développeur local créé par la duplication : le projet sait QUI
     * doit l'administrer, et ignore encore avec quel secret.
     *
     * L'alternative — poser un mot de passe et l'envoyer — a une histoire ici :
     * elle a produit `123dev`, identique sur tous les projets dupliqués, écrit
     * en clair dans chaque `.env`. Le rendre aléatoire n'aurait rien réglé : il
     * aurait fallu le transmettre, donc l'écrire quelque part.
     *
     * Le champ est donc ABSENT tant que le compte est `PENDING_ACTIVATION`. Pas
     * un faux hash inatteignable — une absence, que `comparePassword` traite
     * comme un refus et que la validation Mongoose autorise explicitement.
     */
    password: {
      type: String,
      required: [
        function passwordRequisSaufEnAttenteDActivation() {
          return this.status !== USER_STATUS.PENDING_ACTIVATION;
        },
        'Le mot de passe est requis pour un compte actif.',
      ],
      select: false, // never returned by default
    },
    /**
     * ACTIF ou EN ATTENTE D'ACTIVATION. Un compte en attente ne peut pas se
     * connecter — ni par mot de passe (il n'en a pas), ni par la connexion
     * rapide de TEST, qui l'ignore.
     */
    status: {
      type: String,
      enum: USER_STATUS_VALUES,
      default: USER_STATUS.ACTIVE,
      required: true,
    },
    /**
     * MARQUAGE DE ROTATION (LOT 2C, phase 20).
     *
     * Posé par la migration `migrate-legacy-local-dev` sur un compte dont le
     * mot de passe s'est révélé être l'un des secrets universels historiques.
     * Il ne bloque pas la connexion — bloquer un compte réel sur un soupçon
     * ferait plus de dégâts que le soupçon — mais il le SIGNALE : à l'écran,
     * dans les journaux, et dans le rapport de migration.
     */
    mustResetPassword: {
      type: Boolean,
      default: false,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ROLE_VALUES,
      default: ROLES.ADMIN,
      required: true,
    },
    /**
     * Réinitialisation de mot de passe — le token BRUT n'est JAMAIS stocké :
     * uniquement son empreinte SHA-256. Usage unique (effacé après succès),
     * une nouvelle demande écrase la précédente (invalidation).
     */
    passwordReset: {
      type: new mongoose.Schema(
        {
          tokenHash: { type: String, default: null },
          expiresAt: { type: Date, default: null },
          requestedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
      select: false,
    },
  },
  { timestamps: true }
);

// Hash password whenever it is set/changed.
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * ── ANNONCE DES CHANGEMENTS D'ÉQUIPE AU PANEL ───────────────────────────────
 * Le modèle ne connaît pas le pont : il ANNONCE, quelqu'un écoute peut-être.
 *
 * Les hooks couvrent les chemins RÉELLEMENT empruntés, pas ceux qu'on imagine.
 * L'audit du code le dit : la seule suppression de compte passe par
 * `findByIdAndDelete`, un middleware de REQUÊTE. Un `post('deleteOne')` de
 * document — le réflexe — n'aurait jamais été rejoué.
 *
 * `deleteMany` est couvert autrement : son hook ne reçoit pas les documents
 * supprimés, seulement un compte. On demande donc une RÉCONCILIATION complète,
 * qui compare l'équipe réelle à la dernière photographie envoyée.
 */
userSchema.post('save', function announceSaved() {
  notifyEntitySaved('TEAM_MEMBER', ['*'], { userId: String(this._id) });
});

for (const evenement of ['findOneAndDelete', 'deleteOne']) {
  userSchema.post(evenement, { document: false, query: true }, function announceDeleted(doc) {
    if (doc?._id) notifyEntitySaved('TEAM_MEMBER_REMOVED', ['*'], { userId: String(doc._id) });
    else notifyEntitySaved('TEAM_ROSTER', ['*'], {});
  });
}

// Suppression en lot : impossible de nommer les partants, on reprend la photo.
userSchema.post('deleteMany', function announceBulkDelete() {
  notifyEntitySaved('TEAM_ROSTER', ['*'], {});
});

// Suppression par document, au cas où un futur appelant l'emprunte.
userSchema.post('deleteOne', { document: true, query: false }, function announceDocDeleted() {
  notifyEntitySaved('TEAM_MEMBER_REMOVED', ['*'], { userId: String(this._id) });
});

/**
 * UN COMPTE SANS MOT DE PASSE NE PEUT PAS EN VALIDER UN.
 *
 * Sans cette garde, `bcrypt.compare(x, undefined)` lève — et une exception au
 * milieu du login se lit comme une panne du serveur, alors que la réponse
 * juste est « ces identifiants ne conviennent pas ». On refuse, proprement.
 */
userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

/** Un compte en attente d'activation n'a aucun moyen d'authentification local. */
userSchema.methods.isPendingActivation = function isPendingActivation() {
  return this.status === USER_STATUS.PENDING_ACTIVATION;
};

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.password;
    delete ret.passwordReset;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
export default User;
