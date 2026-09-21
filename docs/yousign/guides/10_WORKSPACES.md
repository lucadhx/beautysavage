# Yousign — Workspaces (guide LYCARZ, pivot multi-tenant)

> READ-ONLY. Source : `developers.yousign.com/docs/workspaces`, `api-keys`. ✅ = confirmé.

## Description

✅ Un **Workspace** assure « la confidentialité des documents entre vos utilisateurs, reflète l'organisation de l'entreprise (départements, filiales, agences…), ou **partitionne les clients finaux si vous êtes un ISV** ».

## Concepts & Capacités (✅)

- ✅ **Isolation** : seuls les users ajoutés à un workspace accèdent à ses Signature Requests.
- ✅ **Multi-tenant ISV** : isoler chaque client final dans un workspace séparé = partitionnement complet des données.
- ✅ **Workspace par défaut** : créé à l'inscription ; reçoit les requests sans workspace désigné.
- ✅ Users ajoutables/retirables par API ; un user garde ≥1 workspace ; owners non retirables.
- ✅ **Clés API scopables au workspace** (guide 09).

## Cas d'usage LYCARZ — pivot multi-tenant

- ✅ **LYCARZ est un ISV/SaaS multi-tenant** → le workspace est **exactement** le mécanisme d'isolation par **Organisation**.
- **Modèle recommandé** : **1 Workspace Yousign par `Organization` LYCARZ**, sous **un compte Yousign LYCARZ unique**. Les signature requests d'un garage restent confinées à son workspace.
- Analogue au choix Brevo « compte partagé + senders par org » : ici « compte partagé + **workspace par org** ».

## Impact CRM / Multi-tenant

- ✅ Mappe la hiérarchie `Organization → Garage` (CRM doc §30.1). Le `workspaceId` Yousign devient un attribut de l'`Organization` LYCARZ (stocké côté LYCARZ).
- Isolation forte : pas de fuite cross-tenant de documents signés.

## Impact IntegratedApi

- 🟡 Deux variantes :
  - **A.** Clé API **org-level** LYCARZ + `workspace` précisé à chaque appel (1 `IntegratedApi` `scope: platform`).
  - **B.** Clé API **workspace-scoped** par organisation (1 `IntegratedApi` `scope: garage`/org). Plus isolé mais multiplie les clés (max 200/org Yousign).
- **Recommandation V1** : variante **A** (1 clé plateforme, workspace par appel) — plus simple, cohérent avec `IntegratedApi scope: platform`.

## Impact IA

- L'agent opère toujours dans le workspace de l'organisation courante (scope multi-tenant respecté, §30.4 Permissions).

## Questions ouvertes

- ❓ Création de workspace **par API** (provisioning auto à la création d'une Organization) ou via app ? → API Reference (critique pour onboarding self-service).
- ❓ Limite du nombre de workspaces par compte Yousign → à confirmer (impact scalabilité multi-tenant).
