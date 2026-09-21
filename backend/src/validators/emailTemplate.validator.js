// ── CE QUI RESTE À VALIDER, ET CE QUI N'EST PLUS À VALIDER ICI (L12.1) ──────
//
// Ce fichier validait des corps d'ÉCRITURE : `updateTemplateBody` (sujet, HTML,
// interrupteur, version attendue) et un corps d'aperçu portant un brouillon.
// Ces routes n'existent plus — le Panel est la seule autorité d'édition, et le
// projet n'a plus de base de modèles à écrire.
//
// Il ne reste donc qu'une adresse de test, et un identifiant de modèle.
//
// ── POURQUOI L'IDENTIFIANT N'EST PLUS UN `z.enum` ───────────────────────────
//
// Il l'était, sur `EMAIL_TEMPLATE_IDS` du registre local — supprimé avec lui.
// Reconstruire cette énumération obligerait ce projet à savoir quels codes
// existent, c'est-à-dire à recopier le registre du Panel : la duplication même
// que le lot supprime, et celle qui avait laissé sept contenus diverger.
//
// La forme est donc contrôlée (elle borne l'URL), l'EXISTENCE est tranchée par
// le Panel — qui répond `PANEL_EMAIL_TEMPLATE_UNKNOWN` avec un message bien
// plus utile qu'un « valeur non autorisée » générique.

import { z } from 'zod';

const templateIdParam = z.object({
  templateId: z.string().trim().min(1).max(80).regex(
    /^[A-Z][A-Z0-9_]*$/,
    'Un code de modèle est en MAJUSCULES, chiffres et tirets bas.',
  ),
});

const testSendBody = z
  .object({
    recipientEmail: z.string().trim().email(),
  })
  .strict();

export const templateIdSchema = { params: templateIdParam };
export const testSendSchema = { params: templateIdParam, body: testSendBody };
