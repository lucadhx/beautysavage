// services/stripe/stripeInvoiceFacade.js
// Pré-React E2 (refactor) — SEAM (couture) structurelle, sans aucune modification de
// comportement. Point d'entrée unifié pour la facturation Stripe côté vente : les
// orchestrateurs (controllers / services checkout) doivent désormais importer ICI plutôt
// que directement `stripeInvoiceService`. L'implémentation reste à sa place ; ce module
// matérialise la frontière `services/stripe/` ciblée par le rapport 120 et prépare une
// extraction réelle ultérieure sans casser les appelants.

export { createStripeInvoiceForSale } from '../stripeInvoiceService.js';
