# COMMUNICATION — Matrice des événements métier

> Couverture des communications (e-mail **E** / notification interne **N**) par événement métier.
> État au 2026-07-22. Rappel : les subscribers du bus (`MAIL_ROLE_RESOLVER_ENABLED`,
> `EVENT_NOTIFICATION_SUBSCRIBER_MODE`) sont **OFF par défaut** → seuls les envois **directs** et les
> appels **impératifs** au moteur (cartes cadeaux, learning) déclenchent réellement une communication.
> « event-only » = `emit*Event` d'audit sans envoi.

Légende : ✅ envoyé · ❌ absent · ⚠️ partiel / à corriger.

## Auth client
| Événement | E | N | Où / notes |
|---|---|---|---|
| Compte créé | ❌ | ✅ | `authRouter` `new_client` (admin) — pas d'e-mail de bienvenue |
| Vérification e-mail (code) | ✅ | ❌ | template `email_confirmation_code` |
| E-mail vérifié | ❌ | ❌ | — |
| Mot de passe oublié | ✅ | ❌ | `sendClientPasswordResetEmail` (commerciale) |
| Mot de passe modifié | ❌ | ❌ | — |
| Compte désactivé / réactivé | ❌ | ❌ | — |

## Auth manager
| Événement | E | N | Où / notes |
|---|---|---|---|
| Invitation créée / renvoyée | ✅ | ❌ | `sendManagerInvitationEmail` (support, tokenisé 7j) |
| Invitation expirée / acceptée | ❌ | ❌ | — |
| Reset manager | ✅ | ❌ | support |
| Mot de passe modifié / rôle modifié | ❌ | ❌ | — |

## Réservations (prestations)
| Événement | E | N | Où / notes |
|---|---|---|---|
| Réservation confirmée | ✅ | ✅ | `sendSaleEmail`+`booking_confirmed` / `booking_created` |
| Paiement sur place attendu | ❌ | ❌ | — |
| Réservation déplacée | ✅ | ✅ | `sendSessionRescheduledEmail` / `booking_rescheduled_client` |
| Annulée (client / institut) | ✅ | ✅ | `sendBookingCancelled*` |
| Rappel avant RDV | ✅ | ❌ | `bookingRemindersJob` (horaire) |
| No-show | ❌ | ✅ | `no_show_recorded` |
| Solde encaissé sur place | ❌ | ❌ | event-only `booking.balance_paid_on_site` |
| RDV terminé | ❌ | ❌ | — |

## Remboursements / paiements / finance
| Événement | E | N | Où / notes |
|---|---|---|---|
| Paiement réussi (vente) | ✅ | ✅ | `sendSaleEmail` / `new_sale` |
| Paiement échoué | ❌ | ❌ | **manquant (P1-12, différé)** |
| Remboursement demandé (flow institut) | ✅ | ❌ | `sendRefundRequestedEmail` |
| Remboursement auto-initié | ✅ | ❌ | `sendRefundAutoInitiatedEmail` |
| Remboursement réussi | ✅ | ✅ | `sendRefundConfirmedEmail` / **`refund_completed`** (corrigé P1-8) |
| Remboursement refusé / échoué | ❌ | ❌ | **manquant (P1-12, différé)** |
| Facture disponible | ✅ | — | lien dans l'e-mail de vente (pas d'e-mail dédié) |
| Avoir (credit note) | ❌ | ❌ | PDF Stripe créé, non envoyé |
| Commission dispo / rappel / dernier jour | ✅ | — | `commissionReminderJob` → admins (**support** depuis P1-1) |
| Commission payée | ❌ | ❌ | event-only |

## Formations
| Événement | E | N | Où / notes |
|---|---|---|---|
| Achat confirmé | ✅ | ✅ | e-mail générique « vente » + `formation_*_purchased` |
| Session créée | ❌ | ❌ | CRUD |
| Session modifiée | ✅ | ❌ | `sendSessionUpdatedChoiceEmail` (pas de notif admin) |
| Session annulée | ✅ | ✅ | `sendSessionCancelledChoiceEmail` / `formation_session_cancelled` |
| Rappel avant session | ❌ | ❌ | **aucun job de rappel session (P1-12, différé)** |
| Présence validée | ✅ | ✅ | `presence.confirmed` (chemin D) |
| Progression démarrée / terminée | ✅ | ✅ | `formation.started` / `formation.completed` (chemin D) |
| Certificat disponible | ❌ | ❌ | ligne dans l'e-mail de complétion ; **pas d'e-mail dédié (P1-12, différé)** |
| Demande d'avis | ❌ | ❌ | inexistant |
| Participation annulée / remboursement | ✅ | ✅ | client + admins |

## Cartes cadeaux
| Événement | E | N | Où / notes |
|---|---|---|---|
| Créée manuellement | ✅ | ❌ | `gift_card.manual_created` → owner (+PDF) |
| Achetée en ligne / paiement confirmé | ✅ | ❌ | `gift_card.online_created` → owner (+PDF) |
| Envoyée au bénéficiaire distinct | ❌ | ❌ | owner-only (décision produit 2026-07-22 ; P2) |
| Utilisation partielle / totale | ❌ | ❌ | — |
| Débit manuel | ✅ | ❌ | **les 2 routes** envoient désormais (P1-10) |
| Remboursement partiel / total | ❌ | ❌ | event-only `gift_card.recredited` |
| Erreur PDF / envoi | — | ✅ | **alerte Dev (P1-6)** |
| Renvoi manuel | ❌ | ❌ | différé (PIN hashé non récupérable — P1-7) |

## Avis
| Événement | E | N |
|---|---|---|
| Demande / reçu / publié / refusé / masqué / manuel | ❌ | ❌ (tous — 0 comm) |

## Système / alertes dev
| Événement | E | N | Où / notes |
|---|---|---|---|
| Webhook définitivement échoué | ❌ | ✅ | **`webhook_failure` (P1-6)** |
| Erreur rendu/envoi carte cadeau | ❌ | ✅ | **`system_error` (P1-6)** |
| Erreur Brevo / Stripe / PDF facture / config manquante | ❌ | ❌ | différé (P1-12) |

## Mises à jour LOT 2 (2026-07-22)

Désormais **couverts** (envois directs best-effort, cf. `COMMUNICATION_CENTER_LOT2_REPORT.md`) :
- **Paiement échoué** → e-mail `payment_failed` (client).
- **Remboursement refusé** (admin failed/canceled) → `refund_refused` (client).
- **Remboursement échoué (Stripe)** → `refund_failed` (client).
- **Certificat disponible** → e-mail dédié `training_certificate_available` (à la complétion).
- **Rappel session formation** → scheduler dédié `formationSessionRemindersJob`.
- **Avis** : `review_received` / `review_published` / `review_rejected` / `review_manual` → ✅N (admin).
- **Carte cadeau** : reset PIN + renvoi → `gift_card.pin_reset_and_resent` (nouveau code, ancien invalidé).

## Événements corrigés dans le lot 1
- **P1-8** : notif de remboursement réussi utilisait `refund_requested` (« a demandé ») → **`refund_completed`**.
- **P1-9** : 7 codes hors catalogue ajoutés à `eventCatalog` (`booking.balance_paid_on_site`,
  `booking.rescheduled`, `commission.adjusted/reversal_required/cancelled`,
  `gift_card.recredit_failed/recovered`) → plus de warning « UNKNOWN event ».
