import mongoose from 'mongoose';

/**
 * L'ACTIVATION D'UN COMPTE LOCAL — la primitive qui remplace `123dev` (LOT 2C).
 *
 * ══ POURQUOI UN DOCUMENT À PART, ET NON UN CHAMP DE PLUS SUR `User` ═══════════
 *
 * `User.passwordReset` existe déjà et lui ressemble beaucoup : même empreinte
 * SHA-256, même usage unique, même durée limitée. On aurait pu le réemployer.
 *
 * Trois choses l'en empêchent, et aucune n'est cosmétique :
 *
 *   · une réinitialisation SUPPOSE un mot de passe existant ; une activation
 *     affirme qu'il n'y en a jamais eu. Confondre les deux ferait dire à un
 *     e-mail « réinitialisez votre mot de passe » à quelqu'un qui n'en a pas ;
 *   · l'activation porte un ÉTAT D'ENVOI (`emailStatus`). Le lot exige qu'un
 *     projet créé pendant que la plateforme d'e-mail est indisponible reste
 *     administrable plus tard — donc que « le compte existe » et « le message
 *     est parti » soient deux faits distincts, et non un seul champ optimiste ;
 *   · une activation consommée se CONSERVE (`consumedAt`). C'est la trace qui
 *     permet de dire, six mois après, que ce compte a bien été activé par son
 *     titulaire et non posé par un script.
 *
 * ══ CE QUI N'EST JAMAIS ÉCRIT ICI ════════════════════════════════════════════
 *
 * Le token BRUT. Il n'existe qu'en mémoire, le temps de construire l'URL, puis
 * dans la boîte de réception de son destinataire. La base n'en détient que
 * l'empreinte : une fuite de sauvegarde ne donne aucun accès.
 */
const localDevActivationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /**
     * SHA-256 du token brut. UNIQUE : deux activations ne peuvent pas partager
     * une empreinte, et la recherche par token est donc exacte ou vide.
     */
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: { type: Date, required: true },
    /** Renseigné à l'usage — c'est ce qui rend le lien à usage UNIQUE. */
    consumedAt: { type: Date, default: null },
    /**
     * POURQUOI CETTE ACTIVATION EXISTE. `BOOTSTRAP` (premier compte du projet),
     * `RESEND` (redemandée à la main), `RECOVERY` (reprise automatique d'un
     * envoi qui n'avait pas pu partir), `LEGACY_MIGRATION` (compte hérité
     * converti). Sert au rapport et aux journaux — jamais à une décision.
     *
     * `RECOVERY` distingue les deux façons dont un lien repart, et la
     * distinction se lit dans un incident : « quelqu'un a cliqué sur renvoyer »
     * n'a pas le même sens que « le projet a soldé sa dette en s'appairant ».
     */
    reason: {
      type: String,
      enum: ['BOOTSTRAP', 'RESEND', 'RECOVERY', 'LEGACY_MIGRATION'],
      default: 'BOOTSTRAP',
    },
    /**
     * L'ÉTAT DE L'ENVOI, séparé de l'état du compte.
     *
     * `PENDING` : le message n'est pas encore parti (plateforme indisponible,
     * URL du manager non configurée). `ERROR` : la tentative a échoué et la
     * raison est conservée, sans secret. Dans les deux cas le compte reste
     * créé et le lien reste valide : on réessaie, on n'invente pas un mot de
     * passe de repli.
     */
    emailStatus: {
      type: String,
      enum: ['PENDING', 'SENT', 'ERROR'],
      default: 'PENDING',
    },
    emailErrorSafe: { type: String, default: '' },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/** Les activations d'un compte, la plus récente d'abord. */
localDevActivationSchema.index({ userId: 1, createdAt: -1 });

export const LocalDevActivation = mongoose.model('LocalDevActivation', localDevActivationSchema);
export default LocalDevActivation;
