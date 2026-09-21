/**
 * NOTIFIEUR DE SYNCHRONISATION — le fil le plus fin possible entre un modèle
 * et le pont.
 *
 * ── POURQUOI IL EXISTE ──────────────────────────────────────────────────────
 * Les hooks Mongoose doivent être posés AVANT `mongoose.model()` : ajoutés
 * ensuite, ils sont enregistrés sur le schéma mais jamais rejoués par le modèle
 * déjà compilé. Les brancher depuis le bootstrap ne pouvait donc pas marcher —
 * ils doivent vivre dans les fichiers de modèle.
 *
 * Or un modèle n'a rien à savoir du Panel. Ce module est donc l'unique point
 * de contact : les modèles ANNONCENT qu'ils ont changé, sans savoir qui écoute
 * ni ce qu'il en fera ; le pont s'abonne au démarrage. Tant que personne n'est
 * abonné — seeds, migrations, scripts — l'annonce ne fait rien.
 */
let listener = null;

/** Le pont s'abonne au bootstrap. Un seul auditeur : ce n'est pas un bus. */
export function onEntitySaved(fn) {
  listener = typeof fn === 'function' ? fn : null;
}

/** Débranchement explicite — utilisé par les tests pour repartir propre. */
export function resetSyncNotifier() {
  listener = null;
}

export function hasSyncListener() {
  return typeof listener === 'function';
}

/**
 * Annonce qu'une entité vient d'être sauvegardée avec succès.
 *
 * Ne lève JAMAIS et ne rend jamais de promesse à attendre : la sauvegarde
 * métier est déjà acquise quand on arrive ici, et rien de ce qui suit ne doit
 * pouvoir la remettre en cause ni la ralentir.
 *
 * @param {'COMPANY'|'NETWORK'|'CONTRACT'|'TEAM_MEMBER'|'TEAM_ROSTER'} kind
 * @param {string[]} changedPaths  chemins modifiés, capturés AVANT le save
 * @param {object}  [meta]         contexte du fait (identifiant concerné…)
 */
export function notifyEntitySaved(kind, changedPaths, meta = {}) {
  if (!listener) return;
  try {
    listener(kind, changedPaths, meta);
  } catch {
    /* un auditeur fautif ne casse pas une écriture métier */
  }
}

/* -------------------------------------------------------------------------- */
/*  LES FAITS — un second canal, et la distinction n'est pas cosmétique        */
/* -------------------------------------------------------------------------- */

/**
 * `onEntitySaved` annonce qu'un ÉTAT a changé : le pont en tire une projection,
 * regroupée en rafales, remplacée par la suivante. Un incident technique n'est
 * pas un état — c'est un fait daté, qui n'a pas de « dernière valeur » et que
 * la rafale suivante ne doit pas écraser.
 *
 * D'où un second canal. Le passer par le premier aurait fait disparaître le
 * premier incident d'une série — précisément ceux qu'on veut voir.
 *
 * ── POURQUOI CE DÉTOUR PLUTÔT QU'UN APPEL DIRECT ────────────────────────────
 *
 * La règle d'exclusivité des ponts interdit au métier d'importer le module de
 * pont. Le handler d'incident annonce donc un fait ; `syncTriggers`, qui vit
 * DANS le pont, écoute et le rapporte. C'est le même découplage que pour les
 * entités, et il évite qu'un handler métier finisse par connaître la file.
 */
let factListener = null;

export function onFactReported(fn) {
  factListener = typeof fn === 'function' ? fn : null;
}

export function hasFactListener() {
  return typeof factListener === 'function';
}

/**
 * Rend `true` si un auditeur a pris le fait en charge, `false` sinon.
 *
 * L'appelant a besoin de le savoir : un fait que personne n'écoute n'est pas
 * rapporté, et son action doit pouvoir être REJOUÉE plus tard plutôt que
 * déclarée réussie. Un notifieur muet qui rend `undefined` ferait passer une
 * perte pour un succès.
 */
export function notifyFactReported(kind, payload = {}) {
  if (!factListener) return false;
  try {
    factListener(kind, payload);
    return true;
  } catch {
    return false;
  }
}

export function resetFactNotifier() {
  factListener = null;
}

export default {
  onEntitySaved,
  notifyEntitySaved,
  resetSyncNotifier,
  hasSyncListener,
  onFactReported,
  notifyFactReported,
  resetFactNotifier,
  hasFactListener,
};
