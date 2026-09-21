# 06 — Webhooks : centralisation progressive, autonomie préservée

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md),
> [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md).
> État actuel détaillé : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §5.4.

---

## 1. Objectif

> **Centraliser progressivement les webhooks dans le Panel.** Le Panel recevra
> les événements des fournisseurs (Stripe, Brevo, Yousign…) et les
> **redistribuera** ensuite vers les projets concernés.

Motivation : avec des dizaines de projets, chaque fournisseur devrait sinon
gérer N endpoints ; chaque tunnel de dev, chaque changement de domaine, chaque
rotation de secret se multiplierait par N. Un point d'entrée unique côté Panel
simplifie l'enregistrement, la supervision et le diagnostic.

---

## 2. Architecture cible (MODE CONNECTED)

```
  Stripe ──────┐
  Brevo ───────┤  1 endpoint par fournisseur/mode        ┌────────────────────┐
  Yousign ─────┴────────────────────────────────────────▶│       PANEL        │
                                                         │ vérif. signature   │
                                                         │ idempotence        │
                                                         │ journal central    │
                                                         │ routage ─────────┐ │
                                                         └──────────────────┼─┘
                              redistribution (ProjectBridge, idempotente)│
                        ┌───────────────────────┬────────────────────────┐  │
                        ▼                       ▼                        ▼  │
                  ┌──────────┐            ┌──────────┐            ┌──────────┐
                  │ Projet A │            │ Projet B │            │ Projet N │
                  │ handlers │            │ handlers │            │ handlers │
                  │ ACTUELS  │            │ ACTUELS  │            │ ACTUELS  │
                  └──────────┘            └──────────┘            └──────────┘
```

### Répartition des responsabilités

| Étape | Responsable | Détail |
|---|---|---|
| Enregistrement des endpoints chez le fournisseur | Panel | il possède les clés ([05](05_INTEGRATED_API_STANDARD.md)) et réutilise le moteur de sync distant existant (registre code-first, description canonique, dédoublonnage sûr) |
| Réception + vérification de signature | Panel | mêmes exigences que l'actuel : HMAC Stripe/Yousign, Bearer Brevo, corps brut, 400 si invalide |
| Idempotence de réception | Panel | journal central (équivalent central du `WebhookEvent` actuel) |
| **Routage vers le(s) projet(s) concerné(s)** | Panel | **cible : par contenu** (métadonnées — le projet pose déjà `metadata.contractId` sur les objets Stripe), pour tenir la promesse « un endpoint par fournisseur/mode ». Le repli « un endpoint par projet » n'est admis, fournisseur par fournisseur, que si celui-ci ne transporte pas de métadonnées fiables — auquel cas le bénéfice de l'endpoint unique est sciemment abandonné pour CE fournisseur |
| Redistribution | Panel → ProjectBridge | livraison **signée, idempotente, avec retries** ; le projet accuse réception |
| **Traitement métier** | Projet | les handlers actuels (`webhook.controller.js`, `contractWebhook.service.js`, ingestion Brevo) restent au projet (donnée locale) — le Panel ne comprend PAS le métier |
| Rattrapage | Projet (PanelBridge) | un projet resté éteint tire les événements manqués au réveil ([02_PROJECT_CONNECTOR.md](02_PROJECT_CONNECTOR.md) §3) |

**Le Panel transporte, le projet interprète.** La classification du
[00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5 s'applique : le moteur métier (que faire
d'un `invoice.paid`) est une donnée locale — il reste au projet.

### Double idempotence

L'événement est dédupliqué deux fois : à la réception Panel (relivraisons du
fournisseur) et au traitement projet (relivraisons du Panel). Le projet garde
donc son verrou local actuel (`WebhookEvent`, index unique) — il devient le
garde-fou contre les redistributions doublées.

---

## 3. Pourquoi « progressivement »

La centralisation se fait **fournisseur par fournisseur, projet par projet**,
jamais en bascule globale :

1. Le mécanisme local actuel est complet et éprouvé (enregistrement distant
   automatique, résolution d'URL publique, rapports de diagnostic persistés,
   44+54 checks de tests) — il n'y a aucune urgence à le remplacer.
2. Chaque fournisseur a ses particularités (Brevo : un webhook par mode dans la
   route ; Stripe/Yousign : un endpoint unique, aiguillage cryptographique) ;
   chacune mérite son lot.
3. Un projet donné peut rester en webhooks locaux même en mode CONNECTED tant
   que sa migration n'est pas faite : les deux régimes coexistent, par
   fournisseur et par projet. L'état « qui reçoit quoi » est une donnée de
   supervision du Panel.

---

## 4. Invariants conservés (quel que soit le régime)

Ces règles, déjà en vigueur, deviennent le standard de l'écosystème :

1. **Aucune URL de webhook saisie à la main, aucun secret saisi à la main** —
   tout est enregistré/synchronisé programmatiquement (moteur actuel :
   `remoteWebhookSyncEngine`, secret `whsec_` capturé à la création et chiffré).
2. **Identité distante canonique** : chaque webhook géré porte une description
   canonique identifiable (aujourd'hui
   `SB_AUTO_06_MANAGED_<PROVIDER>_<CATEGORY>_<MODE>`) ; un webhook inconnu n'est
   **jamais** supprimé chez le fournisseur.
3. **Signature vérifiée sur corps brut** ; signature invalide → 400 ; événement
   authentique non rattachable → 2xx ignoré ; erreur de traitement → 5xx (le
   fournisseur ou le Panel réessaie).
4. **Isolation TEST/PROD** : les webhooks suivent le mode de l'IntegratedAPI,
   jamais l'`ENV` applicatif.
5. **Diagnostic outillé** : chaque action (sync/répare/teste) produit un rapport
   persisté, copiable, secrets masqués (standard actuel
   `webhookRunReport.service.js` — à généraliser au Panel).

---

## 5. MODE STANDALONE : les webhooks locaux se réactivent

> **Un projet déconnecté du Panel pourra réactiver ses webhooks locaux. Le
> logiciel reste autonome.**

```
   CONNECTED                                  STANDALONE
   fournisseur → Panel → projet               fournisseur → projet (direct)

   au débranchement ([04_STANDALONE.md] §4.1) :
   1. le projet re-synchronise ses webhooks LOCAUX chez les fournisseurs
      (moteur actuel : ensureAllWebhooks — il recrée/répare les endpoints
      pointant sur l'URL publique du projet)
   2. le Panel retire ses routes de redistribution vers ce projet
   3. le journal local reprend son rôle de source unique d'idempotence
```

C'est le mécanisme d'aujourd'hui, conservé intact : réception directe
(`/api/webhooks/stripe`, `/yousign`, `/brevo/transactional/:mode`),
enregistrement distant automatique au bootstrap, résolution d'URL publique
(`resolvePublicBackendUrl` : Config Système en PROD, tunnel ngrok détecté en
TEST). La centralisation Panel n'a le droit de supprimer AUCUNE de ces briques —
elle ne fait que les mettre en veille en mode CONNECTED.

---

## 6. Résumé

| Question | Réponse |
|---|---|
| Qui est enregistré chez Stripe/Brevo/Yousign ? | CONNECTED : le Panel. STANDALONE : le projet (mécanisme actuel). |
| Qui vérifie les signatures fournisseur ? | Celui qui reçoit (Panel en CONNECTED, projet en STANDALONE). |
| Qui traite l'événement métier ? | TOUJOURS le projet. |
| Un projet peut-il rater un événement ? | Non : retries de redistribution + rattrapage tiré + double idempotence. |
| La bascule est-elle globale ? | Non : par fournisseur et par projet, progressivement. |
| Que perd un projet revendu ? | Rien : il réactive ses webhooks locaux et vit seul. |
