# 03 — Le Manager standard : ce qui reste local, ce qui devient synchronisé

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md).
> État actuel détaillé du Manager : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §4.

---

## 1. Rôle du Manager dans l'écosystème cible

Le Manager reste le back-office d'UN projet, avec deux espaces :

- **Espace Manager (ADMIN)** — utilisé par le client : contenu de la vitrine,
  entreprise, thème, demandes de contact, son contrat, ses factures. **Cet espace
  ne bouge pas** : c'est le produit vendu au client.
- **Espace Développeur (DEV)** — utilisé par nous. Il **conserve toutes ses
  capacités**. Ce qui change avec le Panel : pour les domaines synchronisés
  (catégorie 2), le Panel devient un **second point d'administration** offrant
  exactement les mêmes actions — et c'est là que se fera le travail quotidien,
  puisqu'on y administre N projets d'un coup.

```
                       domaine synchronisé (ex. contrats)
        ┌──────────────────────────┬──────────────────────────┐
        ▼                          │                          ▼
┌─────────────────┐          synchronisation         ┌─────────────────┐
│ MANAGER (DEV)   │◀────────  bidirectionnelle  ────▶│      PANEL      │
│ mêmes actions   │                                  │ mêmes actions,  │
│ sur CE projet   │                                  │ sur TOUS les    │
└─────────────────┘                                  │ projets         │
                                                     └─────────────────┘
```

Le Manager n'est donc jamais amputé : **aucune page n'est supprimée** au profit
du Panel. Un projet revendu emporte un Manager complet
([04_STANDALONE.md](04_STANDALONE.md)).

---

## 2. Les pages techniques propres au projet (toujours locales)

Certaines pages n'ont de sens que localement, machine par machine, instance par
instance. Elles restent exclusivement dans le Manager :

| Page | Contenu | Existant correspondant |
|---|---|---|
| **Connexion Panel** | état du PanelBridge (CONNECTED/DEGRADED/STANDALONE), appairage, dernier sync, outbox, bouton « Débrancher » | à créer — [01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §5 |
| **Déploiement** | assistant de déploiement, destinations, historique, backups | `manager/src/pages/dev/DeploymentPage.tsx` + `DeploymentsControlPage.tsx` |
| **Duplication** (onglet de la page Déploiement, pas d'entrée de navigation propre) | assistant de duplication | `DuplicateAssistant.tsx` — [07_DUPLICATION_STANDARD.md](07_DUPLICATION_STANDARD.md) |
| **Domaines** | hostnames, wildcard, DNS, certificats | aujourd'hui inclus dans le déploiement |
| **Diagnostics techniques** | webhooks (rapports de diagnostic), livraisons e-mail, santé, événements de domaine | `ProviderWebhooksCard.tsx`, `DevEmailDeliveriesPage.tsx`, `DevEventsPage.tsx` |
| **État local** | version déployée, `ENV` applicatif, configuration réseau, bases | `SystemConfigPage.tsx`, `/api/version`, `/api/meta` |
| **Comptes / Thème manager / Couleurs des rôles** | paramètres de CETTE instance | `DevAccountsPage.tsx`, `DevManagerThemePage.tsx`, `DevRolesPage.tsx` |

---

## 3. Les pages dont le domaine devient synchronisé

Pour ces domaines (catégorie 2, [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5.2), la
page du Manager **reste en place avec toutes ses actions** ; le Panel en devient
le second point d'administration, et la donnée se synchronise :

| Page DEV actuelle | Donnée concernée | Document |
|---|---|---|
| Intégrations API | configurations TEST/PROD + mode actif | [05_INTEGRATED_API_STANDARD.md](05_INTEGRATED_API_STANDARD.md) |
| Templates e-mail | contenu des templates | [11_DONNEES_CENTRALISEES.md](11_DONNEES_CENTRALISEES.md) §4 |
| Entreprise développeur | société développeur | [11](11_DONNEES_CENTRALISEES.md) §3 |
| Équipe développeur | collaborateurs, support | [11](11_DONNEES_CENTRALISEES.md) §3 |
| Contrats (`DevContractsPage`) + vues ADMIN (Mon contrat, Factures) | contrats, factures, paiements, documents | [11](11_DONNEES_CENTRALISEES.md) §2 |
| *(nouveau, espace DEV)* Événements & réunions du projet | événements, réunions | [12_EVENEMENTS_REUNIONS.md](12_EVENEMENTS_REUNIONS.md) |

En pratique, le quotidien glissera naturellement vers le Panel (une saisie pour
N projets) — mais c'est un usage, pas une règle : les deux interfaces restent
équivalentes en capacités.

La mise sous synchronisation se fait **domaine par domaine**, chaque lot étant
indépendant ([10_PANEL_ROADMAP.md](10_PANEL_ROADMAP.md)) et livré avec son
comportement Standalone vérifié ([04_STANDALONE.md](04_STANDALONE.md) §3).

---

## 4. Ce que le Manager ne saura JAMAIS

Répété ici car c'est une frontière du Manager :

1. **Les rôles internes du Panel.** Le Manager reçoit deux booléens `admin`/`dev`
   et rien d'autre — voir
   [09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md).
2. **Les données exclusivement Panel** (catégorie 3) : registre des projets,
   vues multi-projets, CRM, planning, statistiques globales — rien de tout cela
   ne transite vers un projet.
3. **L'intérieur du Panel.** Le Manager ne fait pas d'appel au Panel ; s'il a
   besoin d'une donnée synchronisée, elle est déjà dans la base de SON projet
   (c'est le principe de la catégorie 2), entretenue par le PanelBridge —
   jamais un appel direct depuis le navigateur.

---

## 5. Invariants d'interface à préserver

- La **structure à deux espaces** (`section: 'manager' | 'dev'` dans
  `manager/src/config/nav.ts`, gardes `RequireAuth`/`RequireDev`) est conservée :
  c'est déjà la bonne découpe.
- Le principe **« DEV = superset d'ADMIN »** côté projet est conservé tel quel
  (voir [09_AUTHENTIFICATION_PANEL_MANAGER.md](09_AUTHENTIFICATION_PANEL_MANAGER.md) §1 et §3).
- **Aucune page n'est retirée ni réduite en lecture seule** au motif que le
  Panel existe : une donnée synchronisée reste pleinement éditable des deux
  côtés ([00_ECOSYSTEME.md](00_ECOSYSTEME.md) §8, interdit n°6).
