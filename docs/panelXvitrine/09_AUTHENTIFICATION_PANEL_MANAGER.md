# 09 — Authentification : Panel, Manager, et le contrat qui ne changera jamais

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md).
> État actuel détaillé : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §3.

---

## 1. Aujourd'hui

Chaque projet possède ses comptes **locaux**, dans SA base :

- **Admin local** (rôle `ADMIN`) : le client — espace Manager.
- **DEV local** (rôle `DEV`) : nous — superset : un DEV passe toutes les
  autorisations (`authorize()` du middleware actuel).

JWT local signé par le `JWT_SECRET` du projet, gardes `RequireAuth`/`RequireDev`
côté front. Deux rôles, pas de permission fine — simple et suffisant pour UN
projet.

## 2. Demain

Le **Panel dispose de ses propres utilisateurs** (nos collaborateurs) et de ses
**propres rôles**, qui n'appartiennent qu'à lui :

- aujourd'hui : `ADMIN` et `DEV` (côté Panel) ;
- demain : un **RBAC complet** (rôles multiples, permissions par projet, par
  module, etc.) — le Panel évoluera librement sur ce terrain.

Les comptes locaux des projets, eux, **subsistent** : le client se connecte à
son Manager avec son compte local, exactement comme aujourd'hui. Le Panel ajoute
un chemin d'accès pour NOUS, il ne remplace pas l'authentification du client.

---

## 3. LA règle : le Manager ne connaît jamais les rôles du Panel

> **Le Manager ne reçoit JAMAIS un rôle. Le Panel envoie uniquement deux
> autorisations booléennes indépendantes : `admin` et `dev`.**

```
   PANEL (côté riche, évolutif)                MANAGER (côté simple, figé)
┌────────────────────────────────┐         ┌────────────────────────────────┐
│  Utilisateur : Luca            │         │                                │
│  Rôles internes :              │         │   Reçoit SEULEMENT :           │
│   « Direction technique »      │         │                                │
│   « Support niveau 2 »         │ ──────▶ │   { admin: true|false,         │
│   « Facturation »              │ calcul  │     dev:   true|false }        │
│   (RBAC futur, arbitraire)     │         │                                │
│                                │         │   et ouvre les pages           │
│  ➜ moteur d'autorisations      │         │   correspondantes              │
│    réduit tout cela à          │         │                                │
│    DEUX booléens par projet    │         │   ❌ jamais de rôle, jamais    │
│                                │         │      de liste de permissions   │
└────────────────────────────────┘         └────────────────────────────────┘
```

### Les trois combinaisons utiles

| `admin` | `dev` | Ce que le Manager ouvre |
|---|---|---|
| `true` | `false` | l'espace Manager (pages client) |
| `false` | `true` | l'espace Développeur (pages techniques) |
| `true` | `true` | les deux espaces |

(`false`/`false` = pas d'accès du tout — équivalent à « Manager Access refusé ».)

### Pourquoi cette réduction est précieuse

1. **Le contrat Panel ↔ Manager ne changera JAMAIS.** Le futur RBAC du Panel,
   quelle que soit sa sophistication, se contentera de **calculer ces deux
   booléens** pour un utilisateur et un projet donnés. Les dizaines de Managers
   déployés n'auront jamais besoin d'être mis à jour quand le RBAC évoluera.
2. **Compatibilité parfaite avec l'existant** : le Manager a déjà exactement ces
   deux niveaux (`ADMIN`, `DEV` superset). Les booléens se projettent
   naturellement sur les gardes actuelles (`RequireAuth`/`RequireDev`,
   `authorize()`), qui restent inchangées.
3. **Revendable** : un repreneur voit un mécanisme trivial (« deux booléens
   ouvrent deux espaces ») au lieu d'un RBAC propriétaire à comprendre.

### Interdits associés

- ❌ transmettre un nom de rôle, une liste de permissions, un objet « profil
  Panel » au Manager ;
- ❌ faire dépendre une page du Manager d'une valeur qui n'est pas l'un de ces
  deux booléens (ou un rôle local) ;
- ❌ stocker côté projet une copie de la hiérarchie de rôles du Panel.

---

## 4. Vue d'ensemble des identités

```
                                       ┌───────────────────────────────┐
                                       │            PANEL              │
                                       │  users internes + rôles/RBAC  │
                                       └──────────────┬────────────────┘
                                                      │ émet une autorisation
                                                      │ { admin, dev } pour
                                                      │ (utilisateur, projet)
                                                      ▼
┌────────────┐  compte local ADMIN   ┌────────────────────────────────┐
│  CLIENT    │──────────────────────▶│        MANAGER du projet       │
└────────────┘  (inchangé)           │  gardes locales :              │
                                     │   admin → espace Manager       │
┌────────────┐  compte local DEV     │   dev   → espace Développeur   │
│  NOUS      │──────────────────────▶│                                │
│ (secours / │  (conservé)           └────────────────────────────────┘
│ standalone)│
└────────────┘
```

Trois chemins d'accès au Manager coexistent :

1. **Compte local ADMIN** — le client. Inchangé, pour toujours.
2. **Compte local DEV** — nous, en secours et en Standalone. Conservé.
3. **Accès émis par le Panel** — nous, au quotidien en mode CONNECTED : le Panel
   authentifie l'utilisateur, calcule `{admin, dev}` et le projet honore cette
   autorisation. Principe figé dès maintenant : le jeton émis par le Panel est
   **vérifié par le backend du projet avec le secret d'appairage qu'il détient
   déjà** ([01_PANEL_CONNECTOR.md](01_PANEL_CONNECTOR.md) §3.1) — aucun nouveau
   canal, aucune clé supplémentaire du Panel à connaître, et **révoquer
   l'appairage invalide immédiatement tous les jetons**. Les détails (format,
   durée) seront spécifiés en Phase 1 ; la FORME du contrat (`{admin, dev}`)
   est figée ici.

---

## 5. MODE STANDALONE

Sans Panel, le chemin 3 disparaît, les chemins 1 et 2 suffisent : c'est
exactement l'authentification actuelle de SB Auto 06. Aucun compte local n'est
donc jamais supprimé au profit du Panel — voir
[04_STANDALONE.md](04_STANDALONE.md).

---

## 6. Résumé

| Question | Réponse |
|---|---|
| Qui gère les rôles riches ? | Le Panel, seul, librement (RBAC futur). |
| Que reçoit le Manager ? | `{ admin: bool, dev: bool }`. Rien d'autre, jamais. |
| Ce contrat évoluera-t-il ? | Non. C'est son intérêt : le RBAC calcule, le Manager applique. |
| Le client change-t-il d'authentification ? | Non : compte local ADMIN, comme aujourd'hui. |
| Et sans Panel ? | Comptes locaux ADMIN/DEV — l'existant, conservé intégralement. |
