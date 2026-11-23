import bcrypt from 'bcryptjs';

/**
 * UNE ADRESSE INCONNUE COÛTE AUTANT QU'UN MAUVAIS MOT DE PASSE.
 *
 * Sans compte, la connexion répondait aussitôt ; avec un compte, après le
 * calcul bcrypt (≈ 100 ms). La durée de la réponse disait donc quelles adresses
 * ont un compte — le même annuaire que le message d'erreur refuse de livrer.
 * On compare le mot de passe reçu à une empreinte factice du même coût.
 */
const empreintes = new Map();
export async function burnPasswordCheck(password, cost = 10) {
  if (!empreintes.has(cost)) empreintes.set(cost, bcrypt.hash('mot-de-passe-factice-jamais-valide', cost));
  await bcrypt.compare(String(password || ''), await empreintes.get(cost)).catch(() => false);
}
