// « LA SIGNATURE EST-ELLE DISPONIBLE ? » — LA RÉPONSE APPARTIENT AU PANEL.
//
// ══ CE MODULE NE NOMME AUCUN FOURNISSEUR, ET C'EST NOUVEAU ══════════════════
//
// Il s'appelait `yousignControlPlaneDiagnostic`. Le nom était devenu faux : la
// bascule confie les nouvelles demandes à OpenSign, et la question « la plateforme de signature
// est-il prêt ? » portait donc sur un fournisseur qui n'allait pas servir.
//
// Ce qu'on veut savoir n'a jamais été celui-là. C'est : LA CAPACITÉ DE
// SIGNATURE RÉPOND-ELLE ? La sonde est restée la même — elle l'était déjà —
// mais elle dit désormais ce qu'elle mesure, et elle ne changera plus à la
// prochaine bascule.
//
// ══ POURQUOI CE MODULE EXISTE (R10.5C) ══════════════════════════════════════
//
// Depuis le cutover, ce projet ne détient aucune clé de signature. L'ancien
// verdict de préparation — « une clé est enregistrée ici, et quelqu'un a
// cliqué Tester » — n'a donc plus aucune autorité, et produisait la pire des
// réponses possibles :
//
//     aucune clé locale + plateforme parfaite  →  « pas prêt »  (faux)
//
// Ce faux négatif envoie un opérateur coller une clé dans le projet, c'est-à-
// dire refaire exactement ce que la centralisation vient de défaire — sauf que
// le champ n'existe plus, et qu'il n'a donc aucun moyen d'avancer.
//
// ══ COMMENT ON RÉPOND ═══════════════════════════════════════════════════════
//
// On DEMANDE. Une lecture inoffensive sur une demande de signature qui ne peut
// appartenir à personne : si le Panel sait répondre « pas à vous », c'est que
// toute la chaîne — authentification du projet, résolution de son monde, octroi
// de la capacité, chargement du credential, consultation du registre de liens —
// a déjà été franchie. Le refus EST la preuve.
//
// C'est le même raisonnement que le diagnostic Stripe de L9.4, et le même
// vocabulaire d'états : un opérateur qui a appris à lire l'un lit l'autre.
//
// ══ CE QU'IL NE FAIT JAMAIS ═════════════════════════════════════════════════
//
// Aucune écriture. La sonde est une LECTURE : diagnostiquer la signature en
// ouvrant une demande ferait de chaque vérification une sollicitation adressée
// à de vraies personnes.

/** Les états possibles — vocabulaire commun du parc. */
export const SIGNATURE_DIAGNOSTIC = Object.freeze({
  OK: 'OK',
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
  PANEL_UNREACHABLE: 'PANEL_UNREACHABLE',
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',
  CAPABILITY_NOT_GRANTED: 'CAPABILITY_NOT_GRANTED',
  PANEL_CREDENTIAL_MISSING: 'PANEL_CREDENTIAL_MISSING',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
});

/** Refus de la passerelle → état de diagnostic. Une TABLE, jamais une devinette. */
const PAR_CODE = Object.freeze({
  BRIDGE_NOT_PAIRED: SIGNATURE_DIAGNOSTIC.PANEL_NOT_PAIRED,
  PANEL_UNREACHABLE: SIGNATURE_DIAGNOSTIC.PANEL_UNREACHABLE,
  CAPABILITY_UNKNOWN: SIGNATURE_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_NOT_AVAILABLE: SIGNATURE_DIAGNOSTIC.CAPABILITY_MISSING,
  CAPABILITY_NOT_GRANTED: SIGNATURE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  /**
   * `CAPABILITY_BLOCKED_PREOPENING` A ÉTÉ RETIRÉ DE CETTE TABLE.
   *
   * Il traduisait le refus d'une écriture réelle tant que le Panel n'avait
   * pas été « ouvert commercialement ». Ce mécanisme a été supprimé côté
   * Panel : aucun Panel du parc ne peut plus émettre ce code, et le laisser
   * ici laisserait croire qu'un tel refus reste possible.
   */
  CAPABILITY_PROJECT_SCOPE_MISMATCH: SIGNATURE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED,
  CAPABILITY_CREDENTIALS_MISSING: SIGNATURE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING,
  CAPABILITY_ENVIRONMENT_MISMATCH: SIGNATURE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING,
  CAPABILITY_TIMEOUT: SIGNATURE_DIAGNOSTIC.PROVIDER_TIMEOUT,
  CAPABILITY_PROVIDER_UNAVAILABLE: SIGNATURE_DIAGNOSTIC.PROVIDER_UNAVAILABLE,
});

/**
 * LES REFUS QUI PROUVENT QUE LA CHAÎNE EST SAINE.
 *
 * La sonde demande une demande de signature qui n'existe pas. Un refus
 * d'appartenance est donc la réponse ATTENDUE, et la plus informative : le
 * Panel a dû tout franchir pour pouvoir la formuler.
 *
 * Noter que ce refus est volontairement INDISTINGUABLE d'un « ça n'existe
 * pas » : dire « existe, mais pas à vous » confirmerait l'existence du contrat
 * d'un autre projet.
 */
const REFUS_QUI_VALIDENT = Object.freeze(new Set([
  'CAPABILITY_RESOURCE_NOT_OWNED',
]));

/** Phrase affichable. Elle dit QUI doit agir — c'est toute son utilité. */
const MESSAGES = Object.freeze({
  [SIGNATURE_DIAGNOSTIC.OK]:
    'La signature électronique est disponible via la plateforme.',
  [SIGNATURE_DIAGNOSTIC.PANEL_NOT_PAIRED]:
    'Ce projet n’est relié à aucune plateforme : les signatures passent par elle, et ne peuvent pas être faites localement.',
  [SIGNATURE_DIAGNOSTIC.PANEL_UNREACHABLE]:
    'La plateforme ne répond pas. Aucune signature ne peut être ouverte — et aucune clé locale ne prend le relais.',
  [SIGNATURE_DIAGNOSTIC.CAPABILITY_MISSING]:
    'Cette plateforme ne sert pas encore la signature électronique. Mettez-la à jour.',
  [SIGNATURE_DIAGNOSTIC.CAPABILITY_NOT_GRANTED]:
    'La plateforme refuse : la signature n’est pas accordée à ce projet, ou son ouverture commerciale n’est pas faite.',
  [SIGNATURE_DIAGNOSTIC.PANEL_CREDENTIAL_MISSING]:
    'La plateforme ne détient aucune clé de signature exploitable pour ce monde.',
  [SIGNATURE_DIAGNOSTIC.PROVIDER_UNAVAILABLE]:
    'Le fournisseur de signature a refusé la demande ou n’est pas joignable depuis la plateforme.',
  [SIGNATURE_DIAGNOSTIC.PROVIDER_TIMEOUT]:
    'Le fournisseur de signature n’a pas répondu à temps : l’état est indéterminé, aucune reprise automatique.',
});

const resultat = (code, extra = {}) => ({
  /**
   * L'AUTORITÉ EST TOUJOURS LA PLATEFORME — même en échec. C'est ce champ qui
   * empêche l'appelant d'estampiller « vérifié » sur un credential LOCAL qui
   * n'existe plus.
   */
  authority: 'PANEL',
  code,
  available: code === SIGNATURE_DIAGNOSTIC.OK,
  message: MESSAGES[code],
  capabilityErrorCode: null,
  checkedAt: new Date().toISOString(),
  ...extra,
});

/**
 * La sonde. Un identifiant de demande qui ne peut appartenir à personne.
 *
 * Le préfixe est reconnaissable pour qu'un opérateur qui le croiserait dans un
 * journal comprenne immédiatement qu'il s'agit d'une sonde, et non d'une vraie
 * demande de signature perdue.
 */
const DEMANDE_SONDE = 'ys_diagnostic_control_plane_probe';

/**
 * La signature est-elle utilisable par ce projet, ici et maintenant ?
 *
 * @param {object} args
 * @param {Function|null} [args.invoke]  façade de capacités, `null` si non appairé
 * @returns {Promise<{authority:'PANEL', code:string, available:boolean, message:string}>}
 */
export async function diagnoseSignatureAvailability({ invoke = null } = {}) {
  if (typeof invoke !== 'function') return resultat(SIGNATURE_DIAGNOSTIC.PANEL_NOT_PAIRED);

  try {
    await invoke('signature.request.retrieve', {
      signatureRequestId: DEMANDE_SONDE,
    });
    /**
     * Une réponse POSITIVE serait surprenante — la demande n'existe pas — mais
     * elle prouverait la chaîne encore plus directement. On la traite comme un
     * succès plutôt que de s'en étonner.
     */
    return resultat(SIGNATURE_DIAGNOSTIC.OK);
  } catch (err) {
    const code = String(err?.code ?? '');

    if (REFUS_QUI_VALIDENT.has(code)) {
      return resultat(SIGNATURE_DIAGNOSTIC.OK, { capabilityErrorCode: code });
    }

    /**
     * Le fournisseur a répondu « cette demande n'existe pas ». Il a donc
     * RÉPONDU : la clé de la plateforme est bonne, le compte est joignable, et
     * seul l'objet demandé manque — ce qui était le but de la sonde.
     */
    if (code === 'CAPABILITY_PROVIDER_UNAVAILABLE' && ressourceIntrouvable(err)) {
      return resultat(SIGNATURE_DIAGNOSTIC.OK, { capabilityErrorCode: code });
    }

    /**
     * Un refus qu'on ne connaît pas : de qui vient-il ?
     *
     * Un code `CAPABILITY_*` vient de la PASSERELLE : elle a donc répondu, et
     * l'échec est du côté fournisseur. Tout autre code signifie qu'on n'a même
     * pas atteint le Panel. Le préfixe est recopié ici plutôt qu'importé du
     * transport de pont — un composant métier ne doit pas dépendre de la
     * mécanique du transport.
     */
    const etat = PAR_CODE[code]
      ?? (code.startsWith('CAPABILITY_')
        ? SIGNATURE_DIAGNOSTIC.PROVIDER_UNAVAILABLE
        : SIGNATURE_DIAGNOSTIC.PANEL_UNREACHABLE);

    return resultat(etat, { capabilityErrorCode: code || null });
  }
}

/**
 * Le refus vient-il d'un objet manquant plutôt que d'une panne ?
 *
 * On lit le CODE normalisé par le Panel, jamais le message : un message se
 * traduit, se reformule, et finirait par ne plus correspondre.
 */
function ressourceIntrouvable(err) {
  const details = err?.details?.panelDetails ?? err?.details ?? {};
  return details.reason === 'RESOURCE_MISSING' || details.httpStatus === 404;
}

export default { SIGNATURE_DIAGNOSTIC, diagnoseSignatureAvailability };
