# Rapport 1 — Audit de l'existant

> **Périmètre.** Beauty Savage : backend Node.js/Express + MongoDB (Mongoose) +
> Stripe, frontend Vanilla JS ES6 (migration React **non démarrée**, planifiée).
> Application **mono-tenant** (un seul institut). 45 modèles, 41 routers, 38
> contrôleurs, 23 services, jobs planifiés sous `automatisme/`.
>
> **Méthode.** Constats vérifiés par lecture du code. Chaque affirmation renvoie
> à un fichier. Ce rapport ne juge pas les RFC — il décrit l'état réel.
>
> **Avertissement de cadrage.** Les 4 documents fournis décrivent un SaaS CRM
> automobile **multi-tenant** (LYCARZ). Beauty Savage est **mono-tenant**. Toute
> la partie « multi-tenant » des architectures cibles (clés par locataire,
> isolation de réputation, sous-comptes) est **sans objet ici** et n'est pas
> comptée comme dette.

---

## PARTIE 1.A — Intégrations API

### 1.A.1 Comment les intégrations sont réalisées aujourd'hui

Trois intégrations externes, toutes en **appel direct du SDK / de l'API**, sans
couche d'abstraction :

| Intégration | Rôle | Fichiers clés | Mode d'init |
|---|---|---|---|
| **Stripe Institut** | Paiements formations/produits | `controllers/stripeController.js`, `routers/stripeRouter.js`, `controllers/invoiceController.js`, `services/refundExecutionService.js`, `services/stripeInvoiceService.js` | À la demande via `getStripe()` |
| **Stripe Developer** | Frais de lancement + abonnement mensuel du contrat | `utils/stripeDevClient.js`, `controllers/devWebhookController.js`, `controllers/contractController.js` | Singleton au chargement du module |
| **Brevo** | Emails transactionnels | `services/mailService.js` (~3800 lignes) | Par requête via `postToBrevo()` (fetch natif, pas de SDK) |

### 1.A.2 Sélection du fournisseur

Le fournisseur est **codé en dur dans l'appelant**. Il n'existe ni registre, ni
slug logique, ni résolution dynamique. `getStripe()` lit toujours
`process.env.STRIPE_SECRET_KEY` ; `postToBrevo()` appelle toujours
`https://api.brevo.com/v3/smtp/email`. Changer de fournisseur email impliquerait
de réécrire `mailService.js`.

### 1.A.3 Stockage des secrets

**Tous les secrets sont en clair dans `backend/.env`** (variables
d'environnement). Aucun chiffrement, aucun coffre, aucun secret en base.

```
STRIPE_SECRET_KEY=sk_test_…           STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_DEV_SECRET_KEY=sk_test_…       STRIPE_DEV_WEBHOOK_SECRET=whsec_…
BREVO_API_KEY=xkeysib-…               MAIL_FROM / MAIL_FROM_NAME
WEBHOOK_API_KEY=sk_live_…             ← clé d'allure « live », NON utilisée dans le code
```

Lecture en code : `process.env.STRIPE_SECRET_KEY` (stripeController.js:30-35),
`process.env.STRIPE_DEV_SECRET_KEY` (stripeDevClient.js), `process.env.BREVO_API_KEY`
(mailService.js:1717-1727).

> **🔴 Constat de sécurité immédiat.** `WEBHOOK_API_KEY` contient une valeur
> d'allure **`sk_live_…`** présente dans le `.env` du dépôt et **n'est référencée
> nulle part** dans le code (seulement dans `tests/setup/testEnv.js`). À traiter
> indépendamment de toute RFC : vérifier s'il s'agit d'une vraie clé live, la
> **révoquer** le cas échéant, et confirmer que `.env` est bien dans `.gitignore`.

### 1.A.4 Gestion des environnements (test/prod)

- Architecture **« double compte » Stripe** : un jeu de clés Institut + un jeu
  Developer (contrat). Ce n'est **pas** un mécanisme test/prod, mais deux comptes
  Stripe distincts.
- Les deux comptes pointent actuellement sur des **clés de test** (`sk_test_…`).
- **Aucune bascule test↔prod gouvernée** : passer en production = éditer `.env` +
  redémarrer. Pas de garde-fou, pas de vérification que les clés prod sont
  présentes avant de basculer.

### 1.A.5 Changement de clés

Aucun mécanisme : édition manuelle de `.env` + redémarrage. Pas de période de
grâce, pas de double-clé, pas de rotation outillée, pas d'alerte d'expiration.

### 1.A.6 Permissions liées aux intégrations

Les credentials ne sont **pas** soumis à un contrôle d'accès : tout le code
backend y a accès via `process.env`. Aucune UI d'administration des clés ⇒ une
session `admin` compromise ne peut pas exfiltrer une clé via l'interface (il n'y
en a pas), mais aucune traçabilité d'usage non plus. Rôles existants :
`client / admin / dev` (cf. 1.B / Partie 2).

### 1.A.7 Gestion des erreurs

| Provider | Clé absente | Appel en échec |
|---|---|---|
| Stripe Institut | `throw` → **échec dur** | 500 / exception |
| Stripe Dev | `console.warn` + client `null` → échec runtime au 1er usage | exception |
| Stripe webhook | 500 si `STRIPE_WEBHOOK_SECRET` absent | — |
| Brevo | `console.error` + `return false` → **email silencieusement perdu** | log + `false` |

Pas de retry, pas de backoff, pas d'alerte. Hétérogénéité forte : Stripe échoue
bruyamment, Brevo échoue **silencieusement**.

### 1.A.8 Dépendances externes & coûts

- Dépendances : `stripe` v20.4.0 (npm), Brevo via `fetch` (aucune dépendance).
- **Aucun suivi de coût / usage** : pas de compteur d'appels, pas de quota, pas
  de ledger. Visibilité coût réel = tableaux de bord Stripe/Brevo externes.

### 1.A.9 Points forts / faibles / dettes / risques — Intégrations

**Points forts**
- Surface très réduite (3 intégrations) → simple à comprendre.
- Init Stripe centralisée par compte (`getStripe()`, `stripeDevClient`).
- Idempotence webhook Stripe via index unique partiel sur `stripePaymentIntentId`.

**Points faibles / dettes**
- D-I1 — Secrets en clair, dont une clé d'allure `sk_live_` orpheline. *(Sécurité)*
- D-I2 — Aucune bascule test/prod gouvernée → risque au passage en production. *(Maintenabilité/Sécurité)*
- D-I3 — Pas de rotation outillée → toute rotation = redémarrage manuel. *(Sécurité)*
- D-I4 — Échec Brevo silencieux → emails perdus sans alerte. *(Produit/Exploitation)*
- D-I5 — Pas d'abstraction provider → changement de fournisseur coûteux. *(Maintenabilité)*
- D-I6 — Pas de traçabilité ni de coût d'usage. *(Exploitation)*

**Risques**
- Fuite de `.env` ⇒ compromission totale (aucun chiffrement, rayon d'explosion maximal).
- Passage en prod : oubli d'une clé → indisponibilité paiement / emails.

---

## PARTIE 1.B — Communication / Emails

### 1.B.1 Architecture actuelle

`services/mailService.js` centralise **tout** : définition des templates, rendu,
envoi. Provider = **Brevo** via REST (`POST /v3/smtp/email`), `fetch` natif.
Émission **fire-and-forget** (`void sendSaleEmail(sale)` — clientController.js:566),
non bloquante pour le flux d'achat.

### 1.B.2 Gestion & stockage des templates

- **Modèle DB** `models/EmailTemplate.js` (collection `email_templates`) :
  `functionName` (unique), `subject`, `bodyHtml`, `fullHtml`, `mode`,
  `categoryId`, `recipient` (client/institute/both), timestamps.
- **Définitions par défaut** : objet `TEMPLATE_FUNCTIONS` codé en dur dans
  `mailService.js` (lignes ~260-1014), **32+ types** d'emails.
- **Rendu** : pas de moteur (ni Handlebars/EJS). Littéraux de gabarit +
  `replaceTemplateVariables()` (1444-1470) : substitution `{{variable}}` par
  **regex**, avec **liste blanche** `VARIABLE_KEYS` (~95 variables, 1018-1095) —
  une variable inconnue est laissée telle quelle (garde-fou). HTML assaini
  (`sanitizeEditorialHtml`, `sanitizeFullHtml`).
- **UI admin** : `controllers/mailTemplateController.js` +
  `routers/mailTemplateRouter.js` → `GET/POST /api/gestion/mail-templates`.
  Édition de `subject / bodyHtml / fullHtml / mode`. Défaut recréé via
  `ensureTemplate()` si absent.

> **Note importante.** Beauty Savage possède **déjà** un socle non négligeable du
> « moteur de templates » des RFC : templates en base, éditables en admin,
> variables à jetons `{{}}` validées par liste blanche, séparation
> contenu/rendu/envoi. Ce n'est **pas** un terrain vierge.

### 1.B.3 Catalogue d'emails (extraits) & déclencheurs

Vente (`payment_intent.succeeded`), reset password, code de confirmation email,
commission (available / reminder / last_day — via job), annulation/maj de session
et de formation (choix client : remboursement / avoir), remboursements (requested
/ auto_initiated / confirmed), carte cadeau de compensation, réservations de
prestation (confirmed / reminder / cancelled / no_show / suspended / admin),
maintenance/suspension du site. Déclenchés **directement** par contrôleurs/services
ou par jobs.

### 1.B.4 Gestion des expéditeurs

`buildSender()` (1674-1693) : un **unique** expéditeur global, lu de
`MAIL_FROM` / `MAIL_FROM_NAME`. Pas d'expéditeur par type, pas d'identités
multiples, pas de vérification. **Suffisant en mono-tenant.**

### 1.B.5 Événements / workflows / automatisations

- **Aucun bus d'événements / pub-sub.** Pas d'`EventEmitter`, pas de catalogue
  d'événements. Les emails sont appelés en ligne.
- Un système de **notifications in-app** existe (`models/Notification.js`,
  `triggerNotification()`), **distinct** des emails et **non corrélé**.
- **Jobs planifiés** (`automatisme/`) : `commissionReminderJob` (08:00),
  `bookingRemindersJob` (horaire), `sessionCancellationAutoRefundJob` (02:00),
  `refundRecoveryJob` (horaire), + cleanups. Suivi d'envoi **par drapeaux sur les
  modèles métier** (`CommissionPayment.availableMailSentAt`,
  `ServiceBooking.remindersSent[]`…), pas par un log central.

### 1.B.6 Personnalisation

Variables d'appel (`{{firstName}}`, `{{amount}}`, `{{formationTitle}}`…) +
couleurs du `Theme` actif (`{{themeAccent}}`…). **Français uniquement.** Pas de
multi-tenant (mono-institut), `{{siteName}}` paramétrable mais site = « Beauty
Savage ».

### 1.B.7 Points forts / faibles / dettes / risques — Communication

**Points forts**
- Service mail centralisé, source unique de templates.
- Templates éditables en admin **en direct**, theme-aware.
- Variables validées par liste blanche + HTML assaini (anti-XSS).
- Pattern fire-and-forget non bloquant + jobs de relance fonctionnels.

**Points faibles / dettes**
- D-C1 — **Aucun log d'envoi ni suivi de délivrabilité** : email perdu = invisible. *(Produit/Exploitation — voir D-I4)*
- D-C2 — **Pas de versioning ni gouvernance** des templates : édition écrase en place, pas de draft→publish, pas de rollback. *(Produit/Maintenabilité)*
- D-C3 — **Pas de bus d'événements** : déclencheurs d'email dispersés et couplés aux contrôleurs ; pas de timeline métier unifiée. *(Maintenabilité/Produit)*
- D-C4 — **Pas de webhooks Brevo** (delivered/opened/bounced) : zéro engagement, zéro gestion de bounce/désinscription. *(Produit/Conformité)*
- D-C5 — Notifications in-app et emails non unifiés (deux chemins). *(Maintenabilité)*
- D-C6 — `mailService.js` monolithique (~3800 lignes) : templates + rendu + envoi mêlés. *(Maintenabilité)*
- D-C7 — Pas de retry sur échec d'envoi. *(Exploitation)*

**Risques**
- Email critique (confirmation de vente, reset password) silencieusement perdu →
  litige client, aucune preuve d'envoi.
- Édition d'un template en prod sans filet → régression de contenu non
  réversible.

---

## Synthèse d'altitude

Beauty Savage est un monolithe **mono-tenant** sain et fonctionnel. Les deux
domaines audités présentent des dettes **réelles mais ciblées** :

- **Intégrations** : le problème n'est pas le nombre de providers (3, gérable),
  c'est la **posture de sécurité** (secrets en clair, pas de rotation, pas de
  bascule prod gouvernée) et l'**échec silencieux Brevo**.
- **Communication** : le socle « templates » existe déjà ; les manques sont la
  **traçabilité d'envoi**, la **gouvernance/versioning** et l'**absence de bus
  d'événements** pour découpler et historiser.

Aucune des deux dettes ne justifie, en l'état mono-tenant, l'adoption *intégrale*
des RFC. La suite (Rapports 2-4) évalue quelles **briques** valent leur coût et
**quand** les poser autour de la migration React.
