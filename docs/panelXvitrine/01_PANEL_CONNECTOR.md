# 01 — PanelBridge : la seule porte de sortie vers le Panel

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md).
> Composant **futur** — ce document en fige le contrat et la philosophie avant
> toute implémentation.

---

## 1. Définition

Le **PanelBridge** est un composant du backend de chaque projet. C'est le
**SEUL** endroit du projet qui connaît :

- l'**URL du Panel** ;
- l'**authentification** auprès du Panel (identité du projet, credentials) ;
- la **synchronisation** (données synchronisées, dans les deux sens) ;
- le **heartbeat** (signal de vie périodique) ;
- le **bootstrap** (appairage initial projet ↔ Panel) ;
- les **échanges** (formats, retries, timeouts, files d'attente).

Tous les autres services du projet passent **exclusivement** par lui. Aucun
composant métier ne doit jamais appeler directement le Panel.

```
                       PROJET
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  contract.service   emailModule   integratedApi.service  │
│        │                 │                  │            │
│        └────────┬────────┴──────────┬───────┘            │
│                 ▼                   ▼                    │
│        ╔═══════════════════════════════════╗             │
│        ║          PanelBridge           ║             │
│        ║                                   ║             │
│        ║  état: CONNECTED | STANDALONE     ║             │
│        ║  config: panelUrl, projectKey,    ║             │
│        ║          credentials              ║             │
│        ║  moteurs: bootstrap · heartbeat · ║             │
│        ║           sync · outbox           ║             │
│        ╚═══════════════╤═══════════════════╝             │
│                        │ HTTPS sortant uniquement        │
└────────────────────────┼─────────────────────────────────┘
                         ▼
                  API du PANEL
```

### Pourquoi cette règle est absolue

- **Revente** : débrancher le Panel = neutraliser UN composant. Le repreneur
  remplace le PanelBridge (ou le laisse en Standalone) sans toucher au métier.
- **Évolution** : si le protocole Panel change (v1 → v2), un seul fichier de
  frontière change.
- **Testabilité** : un `FakePanelBridge` suffit à tester tout le métier sans
  Panel — exactement comme le projet le fait déjà avec `stripe.stub.js`,
  `yousign.stub.js` et `FakeTransport` (voir
  [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §6).

Ce patron existe déjà dans le projet : le PanelBridge est au Panel ce que
`backend/src/services/stripe/stripe.provider.js` est à Stripe — un driver unique,
remplaçable, derrière lequel le métier ignore tout du monde extérieur.

---

## 2. États du connecteur

```
                    ┌──────────────────┐
        activation  │   UNCONFIGURED   │  (aucune URL de Panel enregistrée)
        par le DEV  │  = STANDALONE    │
                    └────────┬─────────┘
                             │ bootstrap réussi
                             ▼
      heartbeat OK  ┌──────────────────┐   échecs répétés  ┌──────────────────┐
      ◀────────────▶│    CONNECTED     │──────────────────▶│    DEGRADED      │
                    └────────┬─────────┘◀──────────────────└────────┬─────────┘
                             │ débranchement                heartbeat rétabli  │
                             │ volontaire                                      │ délai/décision
                             ▼                                                 ▼
                    ┌──────────────────┐                            ┌──────────────────┐
                    │   DISCONNECTED   │                            │   STANDALONE     │
                    │  = STANDALONE    │                            │   (assumé)       │
                    └──────────────────┘                            └──────────────────┘
```

- **UNCONFIGURED** : le projet n'a jamais été appairé (ou a été revendu). C'est
  un état de première classe, pas une erreur.
- **CONNECTED** : heartbeat régulier, synchronisation à jour.
- **DEGRADED** : le Panel ne répond plus ; le projet continue sur ses copies
  locales (toute donnée synchronisée existe pleinement dans le projet) —
  **aucune fonctionnalité métier ne s'arrête**.
- **DISCONNECTED / STANDALONE** : décision explicite (revente, remplacement).
  Voir [04_STANDALONE.md](04_STANDALONE.md) pour les conséquences détaillées.

Dans TOUS les états, le métier lit et écrit **les données locales du projet**,
de la même façon ; c'est le connecteur qui synchronise avec le Panel quand il le
peut. Le métier n'a jamais de `if (panel)` dans son code.

---

## 3. Responsabilités

### 3.1 Bootstrap (appairage)

Premier échange entre un projet et le Panel :

1. Le DEV saisit l'URL du Panel dans le Manager (page technique « Connexion
   Panel », voir [03_MANAGER_STANDARD.md](03_MANAGER_STANDARD.md)) — ou elle est
   pré-remplie par la duplication
   ([07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md)).
2. Le PanelBridge se présente : identité du projet (`projectKey`), URL
   publique du backend, version (`/api/version` existe déjà), empreinte.
3. Le Panel enregistre le projet dans son registre et délivre les credentials du
   projet (secret d'appairage propre à CE projet).
4. Le PanelBridge stocke ces credentials chiffrés localement — avec le même
   mécanisme que les credentials d'IntegratedAPI (AES-256-GCM,
   `INTEGRATED_API_ENCRYPTION_KEY`).

L'appairage est **réversible et re-jouable** : révoquer côté Panel + oublier côté
projet ramène proprement à UNCONFIGURED.

### 3.2 Authentification

- Chaque projet possède ses **propres credentials**, révocables individuellement
  côté Panel (un projet compromis ne compromet pas les autres).
- Les credentials ne transitent jamais dans les logs ni les rapports (réutiliser
  la discipline de masquage existante : `maskSensitiveText`, `createRedactor`).
- Le sens de l'initiative : **le projet appelle le Panel** (HTTPS sortant). Pour
  les besoins inverses, voir [02_PROJECT_CONNECTOR.md](02_PROJECT_CONNECTOR.md).

### 3.3 Heartbeat

- Signal périodique léger : `projectKey`, version déployée, `ENV` applicatif,
  état de santé résumé (le backend expose déjà `/health` et `/api/version`).
- Le Panel en déduit la **supervision** (projet vivant, version, dérive).
- Un heartbeat manqué ne déclenche RIEN côté projet (pas de dégradation locale) ;
  il fait uniquement passer le connecteur CONNECTED → DEGRADED après un seuil.

### 3.4 Synchronisation des données synchronisées (bidirectionnelle)

Le PanelBridge porte le sens **projet → Panel** de la synchronisation des
données de catégorie 2 ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5.2) — le sens
Panel → projet arrive par le ProjectBridge, et le PanelBridge **tire**
en complément ce qui aurait été manqué (rattrapage au réveil, re-sync
périodique) :

| Donnée synchronisée | Document de référence |
|---|---|
| Contrats, factures, paiements, documents contractuels | [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §2 |
| Société développeur, collaborateurs, support | [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §3 |
| Templates emails | [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §4 |
| Configurations d'IntegratedAPI + mode actif | [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md) |
| Événements, réunions | [12_EVENEMENTS_REUNIONS.md](12_EVENEMENTS_REUNIONS.md) |
| Événements webhook redistribués (cas particulier, sens Panel → projet uniquement) | [06_WEBHOOK_STANDARD.md](06_WEBHOOK_STANDARD.md) |

Chaque échange porte : la donnée, un horodatage de modification, la version du
contrat d'échange. La mécanique complète tient en cinq règles (dernier écrit
gagne, identités UUID, tombstones, anti-écho, idempotence), définies UNE fois
dans [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §1.1 — rien
au-delà ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5.2).

### 3.5 Remontée montante (projet → Panel)

Le projet remonte : **les modifications locales des données synchronisées**
(un contrat modifié dans le Manager part vers le Panel), le heartbeat, des
compteurs statistiques agrégés, les accusés de réception des webhooks
redistribués, les événements notables (déploiement effectué, bascule de mode
d'API — voir [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md) §5).

Les remontées passent par une **outbox locale persistée** : si le Panel est
injoignable, elles s'accumulent et repartent au rétablissement. Rien ne bloque,
rien ne se perd, tout est idempotent (clé d'idempotence par événement — le
projet utilise déjà ce patron : `idempotencyKey` des événements de domaine).

---

## 4. Ce que le PanelBridge n'est PAS

1. ❌ **Pas un proxy générique** : il n'expose pas « le Panel » au reste du code.
   Il expose des méthodes métier finies (`pushLocalChange()`,
   `pullUpdates()`, `reportHeartbeat()`…). Si un besoin n'a pas de
   méthode, on AJOUTE une méthode — on ne contourne pas.
2. ❌ **Pas un composant vital** : aucune requête HTTP entrante d'un utilisateur
   ne doit attendre une réponse du Panel de façon synchrone et bloquante.
3. ❌ **Pas un tunnel d'administration** : le Panel n'exécute pas de code
   arbitraire dans le projet à travers lui. Les actions Panel → projet passent
   par le ProjectBridge et son catalogue fermé d'opérations.
4. ❌ **Pas une couche de gouvernance** : il transporte les modifications dans
   les deux sens, il ne tranche pas qui « a raison » — il n'y a ni propriétaire
   ni source of truth ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5.2).

---

## 5. Règles d'implémentation (pour la phase de développement)

1. **Un module unique** : `backend/src/services/PanelBridge/` (nom définitif à
   confirmer en Phase 1), avec un vrai driver + un stub, sur le modèle existant
   `stripe.provider.js` / `stripe.stub.js`.
2. **Interdiction lintable** : à terme, aucun autre fichier du backend ne doit
   contenir l'URL du Panel ni de `fetch` vers celle-ci. (Vérifiable par un test
   de conformité, comme le fait déjà `webhook-providers-uniformity.test.js` pour
   les providers de webhooks.)
3. **Timeouts courts, retries bornés, jamais bloquant au boot** : même
   discipline que `ensureAllWebhooks` au bootstrap (timeout 20 s, best-effort,
   le serveur démarre quoi qu'il arrive).
4. **Versionnement du protocole** : chaque échange porte une version de contrat.
   Le PanelBridge refuse proprement (et journalise) un contrat majeur inconnu
   au lieu de deviner.
5. **Tout est observable** : dernier sync, dernier heartbeat, dernier échec,
   taille de l'outbox — exposés au Manager (page « Connexion Panel ») et au
   Panel (supervision).

---

## 6. Résumé

| Question | Réponse |
|---|---|
| Qui connaît l'URL du Panel ? | Le PanelBridge, personne d'autre. |
| Qui appelle le Panel ? | Le PanelBridge, personne d'autre. |
| Que fait le métier si le Panel est mort ? | Rien de spécial : il lit et écrit ses données locales, la synchro reprendra. |
| Comment on revend un projet ? | On révoque l'appairage → UNCONFIGURED → Standalone complet. |
| Comment le repreneur met SA solution ? | Il implémente le côté Panel des deux contrats, ou remplace le connecteur. |
