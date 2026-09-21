#!/usr/bin/env node
// PILOTE LES COMPTES LOCAUX DU PROJET, depuis une console.
//
// ── POURQUOI IL EXISTE ──────────────────────────────────────────────────────
//
// L'écran « Comptes » du Manager crée un compte local avec son mot de passe.
// Il est réservé aux comptes DEV — et c'est là que le serpent se mord la
// queue sur un projet NEUF :
//
//   · le premier compte DEV naît SANS mot de passe (c'est la doctrine du lot
//     2C, et elle est juste : aucun secret n'est écrit sur disque) ;
//   · il s'active par un lien envoyé par courriel ;
//   · ce courriel part par le Panel ;
//   · et l'écran qui permettrait de poser un mot de passe est derrière ce
//     même compte DEV.
//
// Tant que le courriel n'est pas arrivé — boîte non relevée, plateforme
// d'envoi en attente, appairage tout juste fait — PERSONNE ne peut entrer.
// Sur un projet de démonstration, où l'on veut montrer le Manager dans la
// minute, c'est une impasse complète.
//
// Ce pilote ouvre la même porte que l'écran, avec le même modèle et les mêmes
// règles. Il ne CONTOURNE rien : il n'invente aucun mot de passe, n'en écrit
// aucun sur disque, et refuse exactement ce que la fabrique refuse.
//
// ── LE MOT DE PASSE EST LU DANS L'ENVIRONNEMENT ─────────────────────────────
//
// Jamais passé en argument, pour la raison qui vaut déjà dans
// `duplicate-drive.js` : une ligne de commande finit dans l'historique du
// shell, dans les journaux du terminal, et dans la sortie de `ps` de tout
// utilisateur de la machine. Il n'est ni affiché, ni journalisé.
//
// Usage :
//   node src/scripts/account-drive.js --list
//   ACCOUNT_PASSWORD='…' node src/scripts/account-drive.js --create \
//     --email dev@exemple.fr --role DEV [--name "Prénom Nom"]
//   ACCOUNT_PASSWORD='…' node src/scripts/account-drive.js --set-password \
//     --email dev@exemple.fr
import process from 'node:process';

import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { User } from '../models/User.model.js';
import { ROLES, ROLE_VALUES, USER_STATUS } from '../utils/constants.js';
import { isUniversalSecret, isDerivedFromEmail } from '../utils/universalSecrets.js';

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (nom) => process.argv.includes(`--${nom}`);

/** La même longueur minimale que le premier administrateur d'une duplication. */
const LONGUEUR_MINIMALE = 6;

/**
 * LES MÊMES REFUS QUE LA FABRIQUE — et c'est le point de tout ce script.
 *
 * Une porte de service qui accepterait `123dev` rendrait inutile la garde qui
 * l'interdit ailleurs : le secret universel reviendrait par ici, posé « à la
 * main », donc invisible à toute recherche dans le code. Les règles sont
 * IMPORTÉES de `utils/universalSecrets.js`, jamais réécrites.
 */
function refuserMotDePasse(mdp, email) {
  if (!mdp) {
    return 'ACCOUNT_PASSWORD absent de l’environnement : le mot de passe ne se passe pas en argument.';
  }
  if (mdp.length < LONGUEUR_MINIMALE) {
    return `Mot de passe trop court (${LONGUEUR_MINIMALE} caractères minimum).`;
  }
  if (isUniversalSecret(mdp)) {
    return 'Ce mot de passe est un identifiant historique du parc : il est connu et refusé. '
      + 'Choisissez-en un propre à ce projet.';
  }
  if (isDerivedFromEmail(mdp, email)) {
    return 'Ce mot de passe se déduit de l’adresse du compte : choisissez-en un autre.';
  }
  return null;
}

const ligne = (u) => `${String(u.role).padEnd(5)} ${String(u.status).padEnd(19)} ${u.email}${u.name ? `  (${u.name})` : ''}`;

async function main() {
  await connectDatabase();

  if (has('list')) {
    const comptes = await User.find().sort({ createdAt: 1 }).lean();
    if (!comptes.length) console.log('\n  Aucun compte local.\n');
    else {
      console.log('\n  RÔLE  ÉTAT                ADRESSE');
      for (const u of comptes) console.log(`  ${ligne(u)}`);
      console.log('');
    }
    await disconnectDatabase();
    return;
  }

  const email = String(arg('email') ?? '').trim().toLowerCase();
  if (!email) throw new Error('--email requis');
  const mdp = process.env.ACCOUNT_PASSWORD;

  /* ── CRÉATION ──────────────────────────────────────────────────────────── */
  if (has('create')) {
    const role = String(arg('role') ?? ROLES.DEV).toUpperCase();
    if (!ROLE_VALUES.includes(role)) {
      throw new Error(`Rôle inconnu : « ${role} ». Attendu l’un de : ${ROLE_VALUES.join(', ')}.`);
    }
    const refus = refuserMotDePasse(mdp, email);
    if (refus) {
      console.error(`✗ Création refusée — ${refus}`);
      await disconnectDatabase();
      process.exitCode = 2;
      return;
    }
    /**
     * UN COMPTE EXISTANT N'EST PAS ÉCRASÉ EN SILENCE.
     *
     * Écraser reviendrait à révoquer un accès sans que personne ne l'ait
     * demandé — sur le compte d'un client, cela se découvrirait au pire
     * moment. On nomme le geste qui convient plutôt que de le faire.
     */
    const existant = await User.findOne({ email });
    if (existant) {
      console.error(
        `✗ Un compte existe déjà pour ${email} (${existant.role}, ${existant.status}).\n`
        + '  Pour lui poser un mot de passe : --set-password --email '
        + `${email}`,
      );
      await disconnectDatabase();
      process.exitCode = 2;
      return;
    }

    // Le hachage a lieu dans le `pre('save')` du modèle — jamais ici. Une
    // seconde implémentation du hachage serait une seconde façon de se tromper.
    const cree = await User.create({
      email,
      password: mdp,
      name: arg('name') || '',
      role,
      // Un compte QUI A un mot de passe est actif : `PENDING_ACTIVATION`
      // décrit un compte qui n'en a jamais eu, pas un compte désactivé.
      status: USER_STATUS.ACTIVE,
    });
    console.log(`\n✓ COMPTE CRÉÉ\n  ${ligne(cree)}\n`);
    console.log('  Le mot de passe n’est ni affiché ni journalisé : il est haché en base.\n');
    await disconnectDatabase();
    return;
  }

  /* ── MOT DE PASSE ──────────────────────────────────────────────────────── */
  if (has('set-password')) {
    const refus = refuserMotDePasse(mdp, email);
    if (refus) {
      console.error(`✗ Refusé — ${refus}`);
      await disconnectDatabase();
      process.exitCode = 2;
      return;
    }
    const compte = await User.findOne({ email });
    if (!compte) {
      console.error(`✗ Aucun compte pour ${email}. Créez-le : --create --email ${email} --role DEV`);
      await disconnectDatabase();
      process.exitCode = 2;
      return;
    }
    const avant = compte.status;
    compte.password = mdp;
    compte.status = USER_STATUS.ACTIVE;
    await compte.save();
    console.log(`\n✓ MOT DE PASSE POSÉ\n  ${ligne(compte)}`);
    if (avant === USER_STATUS.PENDING_ACTIVATION) {
      console.log('  Le compte était en attente d’activation : il est désormais actif.');
    }
    console.log('');
    await disconnectDatabase();
    return;
  }

  throw new Error('Aucune action : --list, --create ou --set-password.');
}

main().catch(async (err) => {
  console.error(`✗ ${err?.message ?? err}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
