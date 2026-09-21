// LE `state` DU PARCOURS SSO — anti-CSRF (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« SSO STATE ».
//
// ── `state` ET `jti` NE PROTÈGENT PAS DE LA MÊME CHOSE ──────────────────────
//
// Les confondre est l'erreur classique, et elle laisse un trou :
//
//   `jti`    appartient à l'ASSERTION, émis par le Panel. Il empêche qu'une
//            assertion serve DEUX FOIS.
//
//   `state`  appartient au PARCOURS, émis par CE projet avant même que le
//            Panel soit sollicité. Il prouve que le callback qui arrive
//            répond à un départ que NOUS avons initié.
//
// Sans `state`, un attaquant peut provoquer un callback avec une assertion
// parfaitement valide — la sienne — dans le navigateur de sa victime, et
// ouvrir chez elle une session à SON nom. L'assertion est authentique, le
// `jti` est neuf : rien dans l'assertion ne dit qui a demandé le voyage.
// C'est le `state` qui le dit.
//
// ── USAGE UNIQUE, ET COURT ──────────────────────────────────────────────────
//
// Un `state` consommé ne peut pas resservir : l'index unique sur `state` plus
// le passage à `consumedAt` en font un jeton à une seule vie. Sa durée — dix
// minutes — couvre le temps qu'un développeur mette son mot de passe Panel,
// éventuellement avec un second facteur, sans laisser traîner une porte
// entrouverte toute la journée.
import mongoose from 'mongoose';

const federatedLoginStateSchema = new mongoose.Schema(
  {
    /**
     * La valeur ALÉATOIRE renvoyée au navigateur, puis attendue au retour.
     *
     * Stockée en clair, contrairement au `jti` : elle n'ouvre rien seule — sans
     * assertion valide, la connaître ne sert à rien — et le diagnostic d'un
     * parcours interrompu exige de pouvoir la retrouver telle qu'elle a
     * voyagé.
     */
    state: { type: String, required: true },

    /** Où renvoyer l'utilisateur après coup. Validé à l'émission, pas au retour. */
    redirectPath: { type: String, default: '/' },

    createdAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    /** Non nul ⇒ déjà utilisé. Un second retour est refusé. */
    consumedAt: { type: Date, default: null },
  },
  { versionKey: false },
);

/** Usage unique : c'est l'index, pas une lecture préalable, qui l'assure. */
federatedLoginStateSchema.index({ state: 1 }, { unique: true, name: 'uniq_login_state' });

/** Purge automatique — un parcours abandonné ne doit pas s'accumuler. */
federatedLoginStateSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 3600, name: 'ttl_login_state' },
);

export const FederatedLoginState = mongoose.model('FederatedLoginState', federatedLoginStateSchema);
export default FederatedLoginState;
