import { z } from 'zod';
// `SENDER_NAME_MAX` n'est plus importé : aucun nom d'expéditeur ne traverse plus
// cette frontière. Seule la longueur d'une ADRESSE sert encore, pour borner le
// destinataire d'un envoi de test de modèle.
import { SENDER_EMAIL_MAX } from '../utils/emailConstants.js';

// Schémas STRICTS (aucun passthrough) : c'est la seule barrière contre l'injection
// d'un opérateur Mongo via le body.
//
// AUCUN `mode` n'est accepté, ni en paramètre ni dans le corps : le mode visé est
// TOUJOURS le mode Brevo actif, lu côté serveur. Laisser le client le choisir
// ouvrirait la porte à un enregistrement en PROD depuis un écran affichant TEST.

/*
 *  a été RETIRÉ en R10.5B.
 *
 * Il validait un couple (adresse, nom) qu'aucune route n'accepte plus : le From
 * du parc est unique et détenu par le Panel. Le laisser aurait fait croire, à
 * qui relit ce fichier, qu'un écran peut encore l'envoyer — et le premier
 * refactor pressé lui aurait rebranché une route.
 */

/**
 * Envoi de test. `recipient` est OPTIONNEL : sans lui, le service retombe sur
 * l'adresse support configurée — le commerçant n'a donc rien à saisir.
 */
export const testSendSchema = {
  body: z
    .object({
      recipient: z
        .string()
        .trim()
        .toLowerCase()
        .email('Adresse de test invalide')
        .max(SENDER_EMAIL_MAX, 'Adresse trop longue')
        .optional(),
    })
    .strict(),
};
