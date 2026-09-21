# 05 — IntegratedAPI : configuration synchronisée, mode actif par projet

> Prérequis de lecture : [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §5 (classification).
> État actuel détaillé : [13_ETAT_DES_LIEUX.md](13_ETAT_DES_LIEUX.md) §5.

---

## 1. Vocabulaire (rappel critique)

Deux notions TEST/PROD coexistent et sont **strictement indépendantes** — c'est
déjà vrai aujourd'hui et cela reste vrai avec le Panel :

| Notion | Qui la porte | Ce qu'elle pilote |
|---|---|---|
| **`ENV` applicatif** | variable d'env du backend d'un projet | base Mongo (`DB_TEST`/`DB_PROD`), outils de recette, seeds |
| **Mode actif d'une IntegratedAPI** | réglage par fournisseur et par projet (aujourd'hui `IntegratedApi.activeMode` en base) | quelles clés API sont utilisées (Stripe TEST vs PROD, etc.) |

`ENV` ne choisit JAMAIS le mode des API externes (garde-fou existant :
`env-mode-independence.test.js`).

---

## 2. Aujourd'hui / Demain

### Aujourd'hui (état SB Auto 06)

Chaque projet possède ses intégrations — Stripe, Brevo, Yousign (+ Hostinger) —
avec pour chacune une configuration TEST et une configuration PROD, saisies dans
le Manager (page DEV « Intégrations API »), chiffrées AES-256-GCM dans la base
Mongo **du projet**, testées (`POST .../test`) et vérifiées (empreinte
`verifiedFingerprint`).

Avec des dizaines de projets, cela signifierait ressaisir et faire tourner les
mêmes clés partout : ingérable.

### Demain (cible)

La **configuration des IntegratedAPI devient une donnée synchronisée**
(catégorie 2) : elle existe dans le Panel ET dans chaque projet, elle est
modifiable depuis les deux interfaces, et la synchronisation la propage
automatiquement. En pratique, la saisie se fait **une seule fois, dans le
Panel** — c'est tout l'intérêt — mais le Manager n'est pas bridé pour autant.

```
                              PANEL
        ┌───────────────────────────────────────────────┐
        │  IntegratedAPI « STRIPE »                     │
        │  ┌──────────────────┐  ┌──────────────────┐   │
        │  │ config TEST      │  │ config PROD      │   │
        │  │ clés, baseUrl    │  │ clés, baseUrl    │   │
        │  │ testée ✔ validée │  │ testée ✔ validée │   │
        │  │ complète ✔       │  │ complète ✔       │   │
        │  └──────────────────┘  └──────────────────┘   │
        │        (idem BREVO, YOUSIGN, HOSTINGER…)      │
        └───────────────┬───────────────────────────────┘
                        │ synchronisation bidirectionnelle
          ┌─────────────┼──────────────┐
          ▼             ▼              ▼
     ┌─────────┐   ┌─────────┐    ┌─────────┐
     │Projet A │   │Projet B │    │Projet N │
     │ config  │   │ config  │    │ config  │   ← copie locale chiffrée
     │ + mode  │   │ + mode  │    │ + mode  │     (stockage actuel conservé)
     │ PROD    │   │ TEST    │    │ PROD    │   ← mode actif PAR PROJET
     └─────────┘   └─────────┘    └─────────┘
```

### Les deux composantes de la donnée

| Composante | Portée | Nature |
|---|---|---|
| **Les configurations** (credentials TEST/PROD, baseUrl, état de validation) | **communes** à tous les projets — comme la société développeur ([11](11_DONNEES_CENTRALISEES.md) §3), une modification n'importe où se propage partout | synchronisée |
| **Le mode actif** (TEST ou PROD, par fournisseur) | **propre à chaque projet** (le projet A peut être en PROD pendant que le B est en TEST) | synchronisée (entre CE projet et le Panel) |

---

## 3. Disponibilité d'une configuration

Chaque IntegratedAPI possède une configuration TEST et une configuration PROD,
configurables **indépendamment**. Pour être utilisable, une configuration doit
être :

1. **complète** — tous les champs requis du catalogue sont remplis
   (l'équivalent du `configured` actuel) ;
2. **testée** — un test de connexion réel a été exécuté
   (l'équivalent des tests actuels : `GET /v1/account` Stripe,
   `GET /users?limit=1` Yousign, envoi test Brevo) ;
3. **validée** — la preuve de test correspond toujours aux clés courantes
   (l'équivalent du couple `verified` + `verifiedFingerprint` actuel : toute
   modification d'un champ invalide la preuve).

### Règle d'indisponibilité

> **Si une configuration est incomplète ou invalide, elle devient
> INDISPONIBLE : aucun projet ne peut sélectionner ce mode.**

```
   config PROD de STRIPE          projets
   ┌────────────────────┐
   │ complète ?   NON ──┼──▶  PROD grisé / non sélectionnable
   │ testée ?     —     │      dans le Manager ET dans le Panel
   │ validée ?    —     │
   └────────────────────┘
   ┌────────────────────┐
   │ complète ?   OUI   │
   │ testée ?     OUI ──┼──▶  PROD sélectionnable
   │ validée ?    OUI   │
   └────────────────────┘
```

Un projet dont le mode actif devient indisponible (clé révoquée, validation
perdue) n'est pas cassé silencieusement : il continue avec sa copie locale des
credentials, et l'anomalie remonte en supervision.

---

## 4. Ce que voit un projet au quotidien

Au quotidien, le Manager d'un projet n'a **plus besoin** de manipuler des clés.
Sa vue courante :

```
┌─ Manager · page « Intégrations » (cible) ─────────────────────┐
│                                                               │
│   STRIPE        API utilisée : Stripe                         │
│                 Mode actif   : ( ) TEST   (•) PROD            │
│                                                               │
│   BREVO         API utilisée : Brevo                          │
│                 Mode actif   : (•) TEST   ( ) PROD ⊘ indispo  │
│                                                               │
│   YOUSIGN       Mode actif   : (•) TEST   ( ) PROD            │
│                                                               │
│   Clés : saisies une fois, synchronisées partout.             │
│   (édition avancée possible — mêmes actions que le Panel —    │
│    les secrets restent masqués, jamais affichés en clair)     │
└───────────────────────────────────────────────────────────────┘
```

- « API utilisée » : quelle intégration remplit ce rôle.
- « Mode actif » : TEST ou PROD, choisis parmi les configurations
  **disponibles** (§3).
- L'édition des configurations reste possible depuis le Manager (donnée
  synchronisée = mêmes actions des deux côtés,
  [00_ECOSYSTEME.md](00_ECOSYSTEME.md) §8, interdit n°6) — c'est d'ailleurs la page DEV
  actuelle qui joue ce rôle. Une modification faite ici se synchronise au Panel
  puis aux autres projets. En pratique, on éditera dans le Panel : une fois
  pour tout le parc.
- **Les secrets ne s'affichent jamais en clair, nulle part** (discipline
  actuelle conservée : valeurs masquées + 4 derniers caractères, chiffrement
  AES-256-GCM au repos).

---

## 5. Le choix du mode actif — deux chemins, un seul résultat

> Le changement de mode peut être réalisé **depuis le Manager** OU **depuis le
> Panel**. Les deux doivent produire **exactement le même résultat.**

```
   DEV dans le MANAGER                      DEV dans le PANEL
   « Passer Stripe en PROD »                « Passer le projet A en PROD »
            │                                        │
            ▼                                        ▼
   backend du projet                       ProjectBridge du projet A
   (mêmes gardes que le Panel)             (action du catalogue)
            └────────────────┬───────────────────────┘
                             ▼
              UN SEUL chemin d'application :
              vérification de disponibilité (§3)
              confirmation explicite pour un mode PROD
              journalisation (qui, quand)
              bascule + webhooks alignés sur le mode
                             │
                             ▼
              état synchronisé Manager ↔ Panel
```

Règles :

1. Deux portes d'entrée, **un seul chemin d'application** : mêmes
   vérifications, mêmes confirmations, même journal, quel que soit le côté où
   l'action est déclenchée.
2. Les garde-fous actuels sont conservés : confirmation explicite pour activer
   un mode PROD (aujourd'hui : texte exact « ACTIVER STRIPE PROD »), validation
   de préfixe de clé par mode (`sk_live_` refusée en TEST), journal
   `modeUpdatedAt/modeUpdatedBy`.
3. Les webhooks associés au mode suivent la bascule automatiquement
   ([06_WEBHOOK_STANDARD.md](06_WEBHOOK_STANDARD.md)).

### Copie locale des credentials

Le projet stocke sa copie des credentials **chiffrée localement** (mécanisme
actuel AES-256-GCM, `IntegratedApi.model.js`) : c'est ce qui lui permet
d'appeler Stripe/Brevo/Yousign à l'exécution ET de fonctionner Panel éteint
([04_STANDALONE.md](04_STANDALONE.md)). La mécanique fine de synchronisation
(poussée à la modification + rattrapage tiré) sera spécifiée en Phase 1 ;
l'invariant — copie locale chiffrée, opérationnelle hors ligne — est figé ici.

---

## 6. Chaîne de responsabilité (résumé)

| Question | Réponse |
|---|---|
| Où saisit-on les clés ? | Une seule fois, en pratique dans le Panel — mais le Manager offre les mêmes actions (donnée synchronisée). |
| Qui teste/valide une configuration ? | L'interface où l'on se trouve ; mêmes exigences partout : complète, testée, validée. |
| Qui choisit le mode d'un projet ? | Le DEV — depuis le Manager ou le Panel, résultat identique. |
| Qui utilise les clés à l'exécution ? | Le backend du projet (drivers actuels inchangés : `stripe.provider`, `brevoEmail.service`, `yousign.provider`), sur sa copie locale chiffrée. |
| Qui voit les clés en clair ? | Personne. Masquées partout, chiffrées au repos, des deux côtés. |
| Que se passe-t-il si une config devient invalide ? | Mode indisponible à la sélection ; projets déjà dessus signalés en supervision. |

---

## 7. MODE STANDALONE

Sans Panel ([04_STANDALONE.md](04_STANDALONE.md)), le projet est exactement ce
qu'est SB Auto 06 aujourd'hui : la page « Intégrations API » du Manager est
l'unique interface, les clés sont saisies et testées localement, chiffrées dans
SA base. Rien à réactiver, rien à perdre : le socle local
(`IntegratedApi.model.js`, `integratedApiCrypto.js`, catalogue, tests de
connexion) est le même dans les deux modes — la synchronisation s'ajoute
par-dessus, elle ne remplace rien.
