# Rapport 3 — Projection cible

> Couvre la **Partie 4 (projection AVANT→APRÈS)** et la **Partie 5 (parcours
> utilisateurs)**. La cible décrite est le **sous-ensemble disciplinaire**
> recommandé (Rapport 2), pas l'adoption intégrale des RFC. Périmètre **mono-
> tenant** assumé.

---

## PARTIE 4 — Projection AVANT → APRÈS

### 4.1 Intégrations

#### Gestion des fournisseurs
**AVANT** — Slug codé en dur dans l'appelant (`getStripe()`, URL Brevo en dur).
Aucun inventaire. Changer de fournisseur = réécrire le service.
**↓**
**APRÈS** — Un petit **registre** (modèle `IntegratedApi` allégé, sans
`scope/garageId`) liste Stripe Institut, Stripe Dev, Brevo. Chaque appelant passe
par `getCredentials(slug, {role, runtime})`. Ajouter un provider (ex. OpenAI) =
1 entrée + 1 driver fin.

#### Gestion des clés
**AVANT** — Clés en clair dans `.env`, dont une `sk_live_` orpheline. Pas de
masquage, pas de chiffrement.
**↓**
**APRÈS** — Clés **chiffrées AES-256-GCM** en base, jamais renvoyées en clair
(4 derniers caractères affichés). Clé de chiffrement en env, **validée au boot
(bloquant en prod)**. Sentinelle `__UNFILLED__` interdit tout appel avec un
placeholder. La clé `sk_live_` orpheline est révoquée et supprimée.

#### Gestion des permissions
**AVANT** — Aucun contrôle (tout le backend lit `process.env`).
**↓**
**APRÈS** — Lecture des credentials confinée au helper serveur. Mutations
(ajout/rotation/bascule) réservées au rôle **`dev`** (`requireStrictDev`). Pas de
permissions granulaires (inutile à cette échelle).

#### Gestion des environnements
**AVANT** — Deux jeux de clés Stripe pour deux comptes ; aucune bascule test/prod
gouvernée ; passage prod = éditer `.env` + redémarrer.
**↓**
**APRÈS** — `runtimeModel` (`single` Brevo / `dual_environment` Stripe) + `mode`
(test/prod). **Bascule prod refusée** tant que les rôles requis ne sont pas
remplis (non vides, non-sentinelle, runtime prod). Invariant : un token `prod`
n'est jamais retourné pour une demande `test`.

### 4.2 Communication

#### Gestion des templates
**AVANT** — Templates en DB + défauts en dur, éditables en admin, **écrasés en
place** (pas d'historique).
**↓**
**APRÈS** — Mêmes templates, mais cycle **draft → publish** : publier crée une
version (v+1), l'ancienne est archivée (jamais écrasée). 1 seul publié par
`functionName`. Validation au save (variable inconnue/interdite, script refusé) +
aperçu avec **placeholders explicites** pour variables manquantes.

#### Gestion des expéditeurs
**AVANT** — Un sender global (`MAIL_FROM`/`MAIL_FROM_NAME`).
**↓**
**APRÈS** — **Inchangé** (mono-tenant : un sender suffit). Optionnel : un 2e
sender « support » distinct du « transactionnel ». Pas d'identités multiples ni
de vérification OTP.

#### Gestion des événements
**AVANT** — Aucun bus ; déclencheurs email en ligne dans contrôleurs/jobs ;
suivi par drapeaux sur modèles métier.
**↓**
**APRÈS** — **Bus d'événements in-process** + **catalogue figé**
(`sale.created`, `booking.confirmed`, `refund.confirmed`, `email.sent`,
`email.delivered`, `email.opened`, `email.bounced`…). Chaque fait métier est
publié et journalisé → **timeline unifiée** (et base d'un futur audit log).

#### Gestion des campagnes
**AVANT** — Inexistant (transactionnel uniquement).
**↓**
**APRÈS** — **Toujours hors périmètre.** Beauty Savage est transactionnel ; pas
de marketing de masse prévu. (Si un jour : Brevo gère déjà les campagnes côté
provider.)

### 4.3 Automatisations

| | AVANT | ↓ APRÈS |
|---|---|---|
| **Déclencheurs** | Appels directs + `setInterval`/cron | Événements du bus ; un email = réaction à un événement (découplé) |
| **Workflows** | Jobs figés (`automatisme/*`) | Jobs conservés, mais **abonnés au bus** ; ajout d'une réaction = abonné, pas un recâblage de contrôleur |
| **Règles métier** | En dur dans contrôleurs/services | En dur **mais isolées** derrière des handlers d'événements ; règles « verrouillées plateforme », pas de no-code |

> Discipline : **aucun envoi automatique non gouverné**. En V1 cible, le bus reste
> majoritairement **audit/observabilité** ; on n'active que les automatisations
> déjà couvertes aujourd'hui (relances commission/booking).

### 4.4 IA

| | AVANT | ↓ APRÈS (si IA priorisée) |
|---|---|---|
| **Consommation des APIs** | — | Clé IA dans le coffre, lue via `getCredentials("openai")` ; l'agent ne voit jamais le secret |
| **Accès sécurisé** | — | L'agent appelle des **façades d'action** (jamais le SDK), hérite des permissions de l'acteur |
| **Génération de communications** | — | `prepareDraft` produit un email `status: draft` relu par un humain avant envoi |
| **Exécution d'actions** | — | Envoi = action à fort impact → **autorisation humaine** ; tout tracé (`actorType=ai_agent`, `traceId`) |

> **Si l'IA n'est pas un objectif à court terme, cette colonne reste vide** — ne
> rien construire « au cas où ». Seule la *forme* (façades, coffre) est prête.

### 4.5 Administration

| | AVANT | ↓ APRÈS |
|---|---|---|
| **Gestion opérationnelle** | Édition `.env` + redémarrage | Rotation/bascule via helper (UI plus tard, en React) |
| **Visibilité** | Logs console | **SendLog** consultable + statut d'envoi par email ; statut des intégrations |
| **Audit** | Aucun | Timeline d'événements + `*By/*At` sur mutations sensibles |
| **Gouvernance** | Édition template en place | Versioning draft→publish + validation |

---

## PARTIE 5 — Parcours utilisateurs (scénarios cibles)

### 5.1 Administrateur / Développeur (rôle `dev`)

**Ajout d'un fournisseur (ex. OpenAI)**
1. `dev` crée une entrée `IntegratedApi` (slug `openai`, `runtimeModel: single`,
   baseUrl) — seed ou, à terme, via UI React.
2. Ajoute un token `role: api_key` (chiffré au submit, jamais réaffiché).
3. Écrit un driver fin qui appelle `getCredentials("openai",{role:"api_key"})`.

**Rotation d'une clé (ex. Brevo)**
1. `dev` ajoute un nouveau token même `role`, l'active → l'ancien passe inactif.
2. Délai de grâce, puis suppression. Rollback = réactiver l'ancien.
3. Aucun redéploiement.

**Ajout d'un environnement / passage test→prod (Stripe)**
1. `dev` saisit les clés **prod** (`secret_key`, `webhook_secret`,
   `publishable_key`, runtime=prod).
2. Demande la bascule `mode: prod`. Si une clé prod manque → **refus** avec la
   liste des rôles manquants. Une fois complet → bascule + horodatage + auteur.

**Révocation d'un accès**
1. `dev` désactive/supprime le token compromis ; révoque côté provider.
2. La sentinelle/`NoActiveToken` fait échouer **bruyamment** tout appel ⇒ pas
   d'appel dégradé silencieux.

### 5.2 Utilisateur métier (rôle `admin`)

> En mono-tenant, l'« utilisateur métier » est l'admin de l'institut. Le concept
> RFC « composer depuis un dossier CRM » se traduit par « communication depuis une
> **Sale** ou un **ServiceBooking** ».

**Sélection d'un expéditeur** — Sender unique pré-rempli (`MAIL_FROM`). Pas de
choix à faire (mono-tenant) ; au mieux choix « transactionnel / support ».

**Sélection d'un template** — Depuis l'admin, l'admin choisit un template
**publié** (version courante) ; aperçu rendu avec valeurs réelles, placeholders
explicites pour les manquants.

**Envoi contextualisé** — Depuis une vente/réservation, l'admin déclenche un email
(ex. relance, message manuel) ; le message est journalisé (**SendLog**) et son
statut suivi (delivered/opened via webhook Brevo).

**Déclenchement d'une communication** — Une action métier (confirmer un
remboursement) **publie un événement** ; l'email correspondant part automatiquement
si l'automatisation est activée pour cet événement, et apparaît dans la timeline.

### 5.3 Agent IA (seulement si priorisé)

**Génération d'un brouillon** — `prepareDraft(sale)` → email `status: draft`
rédigé par l'IA, visible en admin, **non envoyé**.

**Sélection automatique d'un template** — L'IA propose le template publié adapté
(ex. relance) ; l'humain valide.

**Consommation sécurisée d'une API** — L'IA appelle la façade `callLLM` ; le
coffre fournit la clé ; l'agent ne lit jamais le secret ; `UsageEvent` + audit.

**Exécution d'un workflow** — L'IA peut suggérer une transition (ex. marquer un
no-show) ; toute action à fort impact (envoi externe, remboursement) exige une
**autorisation humaine** en mode contrôlé. Jamais au-delà des permissions de
l'acteur.

---

## Résumé visuel de la cible

```
                ┌──────────── COFFRE (AES-256-GCM) ────────────┐
                │  getCredentials(slug,{role,runtime}) fail-loud │
                └───────┬───────────────┬───────────────┬───────┘
                        ▼               ▼               ▼
                  Stripe Institut   Stripe Dev        Brevo
                   (dual+mode)      (dual+mode)      (single)
                                                        │ envoie
   ACTION MÉTIER ──publie──▶ BUS D'ÉVÉNEMENTS ──audit──▶ Timeline
   (Sale, Booking,            sale.created / email.sent / opened / bounced
    Refund…)                        │                         ▲
                                    │ (réaction gouvernée)    │ webhooks Brevo
                                    ▼                         │
                            Service Email ──▶ Template PUBLIÉ ─┘ + SendLog
                            (draft→publish, variables validées)
```

Cette cible **n'ajoute pas** de multi-tenant, d'omnicanal, d'inbound, ni de
campagnes : elle comble les dettes réelles (sécurité des secrets, bascule prod,
traçabilité d'envoi, versioning, découplage par événements) en restant à
l'échelle d'un institut mono-tenant.
