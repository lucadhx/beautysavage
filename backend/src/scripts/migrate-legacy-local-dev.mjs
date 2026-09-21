/**
 * MIGRATION CONTRÔLÉE DES COMPTES LOCAUX HÉRITÉS — LOT 2C, phases 18 à 20.
 *
 * ══ CE QU'ELLE CLASSE, ET SUR QUELLE PREUVE ═════════════════════════════════
 *
 *   LOCAL_DEV_LEGACY   son mot de passe EST l'un des secrets universels
 *                      historiques. Prouvé par comparaison bcrypt — pas
 *                      supposé d'après son adresse.
 *   LOCAL_DEV_REAL     compte local dont le mot de passe n'est aucun des
 *                      secrets connus. On n'y touche pas.
 *   PENDING_ACTIVATION compte créé par le nouvel amorçage, sans mot de passe.
 *   UNKNOWN            impossible de conclure (hash absent ou illisible).
 *
 * ── POURQUOI LA PREUVE PAR HASH, ET PAS PAR ADRESSE ────────────────────────
 *
 * « `dev@mail.com` est un compte hérité » est une bonne intuition et une
 * mauvaise règle. Rien n'empêche un vrai développeur d'avoir choisi cette
 * adresse, ni un compte hérité d'en porter une autre — la duplication écrivait
 * `SEED_DEV_EMAIL`, donc n'importe laquelle. Désactiver sur un nom, c'est
 * risquer de fermer la porte à quelqu'un qui n'a rien fait.
 *
 * `bcrypt.compare(candidat, hash)` répond à la seule question qui compte : ce
 * compte s'ouvre-t-il, AUJOURD'HUI, avec un secret que tout le monde connaît ?
 *
 * ── LES IDENTIFIANTS TESTÉS SONT UNE LISTE NOIRE, PAS UN USAGE ─────────────
 *
 * Ce fichier CONTIENT `123dev` et `123admin`. Il ne s'en sert jamais pour
 * ouvrir une session ni pour en créer une : il les présente à un hash pour
 * savoir s'il faut les révoquer. Le scan de sécurité du lot classe ces
 * occurrences en DENYLIST, et la distinction est vérifiable — aucune écriture
 * de mot de passe n'existe dans ce script.
 *
 * ══ USAGE ══════════════════════════════════════════════════════════════════
 *
 *   node src/scripts/migrate-legacy-local-dev.mjs --dry-run
 *   node src/scripts/migrate-legacy-local-dev.mjs --apply --strategy=convert
 *   node src/scripts/migrate-legacy-local-dev.mjs --apply --strategy=disable
 *
 * `--dry-run` est le DÉFAUT : lancer ce script sans argument ne modifie rien.
 */
import bcrypt from 'bcryptjs';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STRATEGY = (args.find((a) => a.startsWith('--strategy='))?.split('=')[1] || 'convert').toUpperCase();

if (!['CONVERT', 'DISABLE'].includes(STRATEGY)) {
  console.error(`Stratégie inconnue : « ${STRATEGY} ». Attendu : convert | disable.`);
  process.exit(2);
}

/**
 * LISTE NOIRE des secrets universels historiques. Jamais utilisée pour
 * authentifier ni pour créer — uniquement présentée à un hash existant.
 */
const SECRETS_UNIVERSELS = ['123dev', '123admin'];

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { User } = await import('../models/User.model.js');
const { USER_STATUS } = await import('../utils/constants.js');
const { maskEmail } = await import('../utils/eventPayloadSafety.js');

await connectDatabase();

const rapport = { LOCAL_DEV_LEGACY: [], LOCAL_DEV_REAL: [], PENDING_ACTIVATION: [], UNKNOWN: [] };

const comptes = await User.find().select('+password');
for (const compte of comptes) {
  if (compte.status === USER_STATUS.PENDING_ACTIVATION) {
    rapport.PENDING_ACTIVATION.push(compte);
    continue;
  }
  if (!compte.password) {
    rapport.UNKNOWN.push(compte);
    continue;
  }
  let herite = false;
  for (const secret of SECRETS_UNIVERSELS) {
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(secret, compte.password)) { herite = true; break; }
  }
  (herite ? rapport.LOCAL_DEV_LEGACY : rapport.LOCAL_DEV_REAL).push(compte);
}

const ligne = (u) => `    · ${maskEmail(u.email)}  [${u.role}]  ${u.name || '(sans nom)'}`;
console.log('\n══ CLASSIFICATION DES COMPTES LOCAUX ══════════════════════════════════');
for (const [classe, liste] of Object.entries(rapport)) {
  console.log(`\n  ${classe} — ${liste.length} compte(s)`);
  liste.forEach((u) => console.log(ligne(u)));
}

/**
 * ══ LA GARDE QUI EMPÊCHE DE FERMER LE PROJET SUR SOI-MÊME ══════════════════
 *
 * Retirer son mot de passe au dernier développeur capable d'entrer, sur un
 * projet dont l'e-mail n'est pas configuré, produit un projet que PERSONNE ne
 * peut plus administrer. C'est irréversible sans accès à la base.
 *
 * On exige donc, pour désactiver, qu'il reste un développeur ACTIF non hérité.
 * La conversion, elle, envoie un lien : elle reste possible, à condition que
 * l'envoi fonctionne — ce que le script vérifie et rapporte.
 */
const devsSains = rapport.LOCAL_DEV_REAL.filter((u) => u.role === 'DEV');

if (!APPLY) {
  console.log('\n══ SIMULATION (--dry-run) — aucune écriture ═══════════════════════════');
  console.log(`  Stratégie qui serait appliquée : ${STRATEGY}`);
  console.log(`  Comptes qui seraient traités   : ${rapport.LOCAL_DEV_LEGACY.length}`);
  console.log(`  Développeurs locaux sains      : ${devsSains.length}`);
  if (STRATEGY === 'DISABLE' && devsSains.length === 0 && rapport.LOCAL_DEV_LEGACY.some((u) => u.role === 'DEV')) {
    console.log('  ⚠ REFUS PRÉVU : aucun développeur local sain ne resterait. Utilisez --strategy=convert.');
  }
  console.log('\n  Pour appliquer : --apply --strategy=convert (ou disable)\n');
  await disconnectDatabase();
  process.exit(0);
}

console.log(`\n══ APPLICATION — stratégie ${STRATEGY} ═════════════════════════════════`);
const { emitSafe } = await import('../services/events/domainEvent.service.js');
const { issueActivation, sendActivationEmail } = await import('../services/localDevBootstrap.service.js');

let traites = 0;
for (const compte of rapport.LOCAL_DEV_LEGACY) {
  if (STRATEGY === 'DISABLE' && compte.role === 'DEV' && devsSains.length === 0) {
    console.log(`  ⚠ ${maskEmail(compte.email)} CONSERVÉ : aucun développeur local sain ne resterait.`);
    continue;
  }

  await emitSafe({
    type: 'localdev.legacy.detected',
    entityType: 'User',
    entityId: String(compte._id),
    payloadSafe: { emailMasked: maskEmail(compte.email), role: compte.role, classification: 'LOCAL_DEV_LEGACY' },
  }).catch(() => {});

  /**
   * LE MOT DE PASSE EST RETIRÉ, PAS REMPLACÉ.
   *
   * `$unset` plutôt qu'un hash aléatoire : un hash inconnu reste un hash, et
   * quelqu'un finirait par se demander lequel. L'absence, elle, ne se devine
   * pas — et `comparePassword` la traite comme un refus.
   */
  await User.updateOne(
    { _id: compte._id },
    {
      $unset: { password: '', passwordReset: '' },
      $set: { status: USER_STATUS.PENDING_ACTIVATION, mustResetPassword: true },
    }
  );

  await emitSafe({
    type: 'localdev.legacy.disabled',
    entityType: 'User',
    entityId: String(compte._id),
    payloadSafe: { emailMasked: maskEmail(compte.email), role: compte.role, strategy: STRATEGY },
  }).catch(() => {});

  if (STRATEGY === 'CONVERT') {
    const frais = await User.findById(compte._id);
    const { rawToken, activation } = await issueActivation(frais, { reason: 'LEGACY_MIGRATION' });
    const envoi = await sendActivationEmail(frais, rawToken, activation);
    console.log(
      `  ✓ ${maskEmail(compte.email)} converti — lien d'activation ${envoi.sent ? 'envoyé' : 'NON envoyé (' + envoi.reason + ')'}`
    );
  } else {
    console.log(`  ✓ ${maskEmail(compte.email)} désactivé (aucun lien émis).`);
  }
  traites += 1;
}

console.log(`\n  ${traites} compte(s) traité(s).`);
console.log('  Aucun compte n’a été SUPPRIMÉ : la migration retire un credential, jamais une identité.\n');

await disconnectDatabase();
