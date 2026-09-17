# COMMUNICATION — Variables de template e-mail

> Source d'autorité **backend** : `services/mail/mailTemplateVariableCatalog.js`
> (exposée par `GET /api/gestion/mails/variables`). Ce document est un instantané lisible ;
> le code fait foi. L'allowlist de rendu est `VARIABLE_KEYS` (`services/mail/mailRenderer.js`).

## Syntaxe

Les variables s'écrivent `{{nomVariable}}` (insensible à la casse). Une variable **inconnue** (hors
allowlist) est laissée **littérale** au rendu (jamais exécutée). Une variable connue mais absente du
contexte est rendue vide.

## Échappement (P0-1)

Au rendu **HTML**, les valeurs sont **échappées** (anti-injection), SAUF les variables marquées
`raw` ci-dessous (URLs, couleurs de thème, fragments HTML pré-construits). Au rendu **texte**
(objet, corps texte), aucune valeur n'est échappée.

## Catalogue

`raw` = valeur non échappée en HTML · `oblig.` = attendue sur les templates du domaine.

### Client
| Variable | Description | Exemple | raw |
|---|---|---|---|
| `firstName` | Prénom du client | Camille | |
| `lastName` | Nom du client | Durand | |
| `customerName` / `clientName` | Nom complet | Camille Durand | |
| `email` / `clientEmail` | E-mail du client | client@example.com | |

### URLs / liens (raw)
| Variable | Description | raw |
|---|---|---|
| `link` | Lien principal (bouton) | ✅ |
| `actionUrl` | Lien d'action (réservation, décision) | ✅ |
| `invoiceDownloadUrl` / `invoicePageUrl` | Facture | ✅ |
| `trackingUrl` | Suivi de remboursement | ✅ |
| `platformUrl` | Espace plateforme (commissions) | ✅ |

### Vente / facture
| Variable | Description | Exemple |
|---|---|---|
| `saleId` | Identifiant de vente | VTE-2026-000123 |
| `amount` | Montant (formaté auto) | 49,90 € |
| `amountPaid` | Montant payé | 49,90 |

### Réservation
| Variable | Description |
|---|---|
| `serviceName` | Nom de la prestation |
| `bookingId` / `bookingDate` / `bookingTime` / `bookingDateTime` | Réservation |
| `oldBookingDate` / `oldBookingTime` / `newBookingDate` / `newBookingTime` | Report |
| `depositAmount` / `remainingAmount` / `paymentType` | Paiement |
| `cancellationDays` / `noShowCount` / `suspensionThreshold` | Politique |

### Formation
| Variable | Description |
|---|---|
| `formationTitle` / `formationName` | Formation |
| `sessionDate` / `sessionTime` / `sessionDateTime` / `sessionDateLabel` / `sessionTimeLabel` | Session |

### Remboursement
| Variable | Description | raw |
|---|---|---|
| `refundAmount` / `refundStatus` / `refundDateTime` / `refundId` | Remboursement | |
| `refundReason` / `reason` | Motif | |
| `autoRefundDays` / `eligibleRefund` | Éligibilité | |
| `refundSection` | Bloc HTML de remboursement (pré-construit) | ✅ |

### Carte cadeau
| Variable | Description |
|---|---|
| `giftCardCode` | Code |
| `giftCardPassword` | Mot de passe (masqué à l'aperçu/test) |
| `giftCardBalance` | Solde |

### Commission / institut / système
| Variable | Description |
|---|---|
| `period` / `daysLeft` / `daysTotal` | Commission |
| `siteName` / `instituteName` | Institut |
| `code` / `expiresMinutes` | Code de vérification |
| `year` | Année en cours |

### Thème (raw, injectées au rendu)
`themePrimary`, `themeSecondary`, `themeAccent`, `themeAccentStrong`, `themeBackground`,
`themeSurface`, `themeSurfaceHeader`, `themeText`, `colorText`, `colorSurface` — valeurs CSS de la
charte, injectées par `withMailThemeVars`. Toujours `raw`.

## Aperçu & envoi de test

`buildSampleTemplateData()` fournit une valeur d'exemple pour **toutes** les variables (aperçu réel
et envoi de test). Les exemples n'utilisent **jamais** de vraie donnée client ni de vrai token
(placeholders `EX_TOKEN`).

## Ajouts LOT 2

Variables ajoutées à l'allowlist (`VARIABLE_KEYS`) + catalogue — auparavant **absentes**, donc
rendues littérales dans les corps mail carte cadeau / leçon : `recipientName`, `purchaserName`,
`pin`, `message`, `balance`, `paymentLabel`, `transactionReason`, `cardLink` (raw/URL), `lessonName`,
`location`, `linkLabel`. Correctif de rendu, pas seulement d'outillage.

## Validation

`validateTemplateContent(content)` retourne `{ unknownVariables, malformed }` — variables inconnues
(bien formées mais hors catalogue) et accolades non appariées. Branché en **avertissement non
bloquant** à la sauvegarde d'un template.
