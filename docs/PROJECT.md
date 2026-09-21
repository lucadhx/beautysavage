# L.Y Solution — fiche du projet

> Le site **officiel de L.Y Solution**, produit par le moteur certifié de la
> fabrique. C'est le seul projet du parc où l'éditeur, le concepteur et
> l'exploitant sont la même entreprise — et c'est aussi le premier où le moteur
> a été **réduit** plutôt qu'habillé.

---

## 1. Identité

| | |
|---|---|
| Nom du projet | **L.Y Solution** |
| Identité technique (`PROJECT_SLUG` / `PROJECT_ID`) | `ly-solution` |
| Clé côté Panel (dérivée de `PROJECT_NAME`) | `ly-solution` |
| `PROJECT_NAME` (identité technique, `.env`) | `LY Solution` |
| Fiche Panel | `fbe5bb36-41db-447d-a444-4e1f48c3e868` |
| Enseigne affichée sur le site | **L.Y Solution** |
| Accroche | « Une présence digitale qui n'appartient qu'à vous. » |
| Métier | Maison de conception digitale — identité, direction artistique, architecture publique et espace privé |
| Positionnement | Capacité de conception volontairement limitée ; aucune section « nos réalisations » |

### `PROJECT_NAME` vaut « LY Solution », sans point — et c'est voulu

La clé du registre Panel est DÉRIVÉE de `PROJECT_NAME` par slugification, des
deux côtés du pont. « L.Y Solution » aurait donné `l-y-solution`, alors que tout
le reste de ce projet — slug de déploiement, dossier, dépôt, bases, domaine —
s'appelle `ly-solution`. Deux orthographes pour une même chose finissent
toujours par se croiser : la migration légale du Panel cherche `ly-solution`, et
ne l'aurait pas trouvé.

C'est la convention du parc : `Karting Gravona` pour la clé, « Karting di a
Gravona » pour l'enseigne. **L'ENSEIGNE affichée sur le site vient de la fiche
Entreprise**, jamais du `.env`.

### Le slug n'est pas « panel », et ce n'est pas un détail

Le Panel de la plateforme porte déjà le slug `panel` et l'identifiant de build
`panel-lysolution`. Ce projet-ci s'appelle `ly-solution`. Les deux vivent sur le
même VPS, sous la même base wildcard `ly-solution.com`, et le slug commande les
préfixes de processus PM2, les dossiers de staging et la racine de sauvegarde
(`/var/backups/ly-solution`). Deux projets qui partageraient un slug
mélangeraient leurs sauvegardes sans que rien ne casse — le pire des cas.

---

## 2. Origine

| | |
|---|---|
| Projet source | **Karting di a Gravona** (`karting-gravona`) |
| Méthode | archive `git` du HEAD source, puis réécriture d'identité |
| Date | 2026-08-26 |

La source a été choisie pour ce qu'elle portait : le correctif du **câblage
tardif du pont Panel** (`bridge-late-wiring.test.js`), celui du **texte posé sur
un aplat**, et celui de la **ligne de grille qui nomme sa machine**. C'est-à-dire
l'état le plus avancé du moteur au moment de la copie.

Ce qu'une copie n'hérite jamais — secrets régénérés, bases propres, dépôt
propre, `uploads` vide, identité technique dérivée du nom — est décrit dans
[DUPLICATION.md](DUPLICATION.md) et a été appliqué ici intégralement.

---

## 3. Ce que ce projet RETIRE au moteur

C'est la particularité de cette duplication, et elle mérite sa propre page :
[SIMPLIFICATION.md](SIMPLIFICATION.md).

En résumé, neuf référentiels de contenu deviennent **un** :

| moteur karting | ici |
|---|---|
| `Service` · `PricingRange` · `Kart` · `Circuit` · `Review` · `Faq` · `BeforeAfter` · `PromotionBanner` · `LiveTiming` | `Chapter` |
| `SitePage` | `SitePage` |

Et trois traitements disparaissent avec eux : les **horaires d'ouverture** (une
maison de conception n'a pas de guichet), la **carte Google Maps** de la page de
contact, et le **bandeau promotionnel**.

---

## 4. Bases de données

Cluster partagé du parc ; seul le nom de la base change.

| Environnement | Base | État |
|---|---|---|
| TEST | `ly_solution_test` | en service — contenu initial posé le 2026-08-26 |
| PROD | `ly_solution_prod` | créée par le moteur, **vierge** |

Une troisième base, `ly_solution_control`, porte le plan de contrôle du
déploiement. `ly_solution_prod` reste vide jusqu'à la mise en ligne : la
promotion contrôlée TEST → PROD est le geste qui la remplit (voir
[TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md)).

---

## 5. Destinations

| | |
|---|---|
| Site | <https://ly-solution.com> |
| Manager | <https://manager.ly-solution.com> |
| API | <https://api.ly-solution.com> |

### La vitrine est sur le DOMAINE NU, et c'est une exception dans le parc

Tous les autres projets du parc vivent sur un sous-domaine
(`karting-gravona.ly-solution.com`). Celui-ci occupe l'apex. Le profil de
déploiement le gère sans modification : `APPS` déclare la vitrine en rôle `web`
— servie sur l'hôte principal — le Manager en `web-sub` avec le sous-domaine
`manager`, et `API_SUBDOMAIN` vaut `api`. Ce sont les mêmes rôles que partout ;
c'est l'HÔTE déclaré à la destination qui change.

### Le conflit avec `panel.ly-solution.com` — vérifié, il n'y en a pas

| nom | à qui |
|---|---|
| `ly-solution.com` | **ce projet** (vitrine) |
| `manager.ly-solution.com` | **ce projet** (Manager) |
| `api.ly-solution.com` | **ce projet** (API) |
| `panel.ly-solution.com` | le Panel |
| `api.panel.ly-solution.com` | l'API du Panel |
| `demo-*.ly-solution.com`, `karting-gravona.ly-solution.com`, … | les projets clients |

Aucun recouvrement : les noms du Panel sont sous `panel.`, un label de plus.
Le certificat wildcard `*.ly-solution.com` couvre `manager.` et `api.` de ce
projet ; il ne couvre PAS `api.panel.` (deux niveaux) — mais ce nom appartient au
Panel, qui gère déjà son propre certificat. L'apex, lui, demande un certificat
nommé : c'est le cas standard d'un domaine racine, pas une particularité.

---

## 6. Dépôt

<https://github.com/lucadhx/ly-solution> — branche `main`.

Le dépôt de la source n'est jamais poussé depuis ici :
`PROJECT_GITHUB_REPOSITORY_URL` a été réécrite dans le `.env` avant le premier
démarrage.

---

## 7. Rattachement au Panel

```
PANEL_URL=https://api.panel.ly-solution.com
PANEL_PAIRING_CODE=…            ← à coller, puis à retirer
PUBLIC_BACKEND_URL=https://api.ly-solution.com
```

**Fait le 2026-08-26.** Projet déclaré (`POST /api/projects`), code d'appairage
consommé au premier démarrage, ligne retirée du `.env`. Le Panel voit
`pairing: PAIRED`, `liveness: ONLINE`, `conformity: declared · hasManifest ·
identityConsistent · paired · seenAlive`.

**L'ordre compte**, et il est décrit dans
`Panel/docs/architecture/40_PROJECT_FACTORY.md` :

1. **déclarer** le projet au Panel, AVEC son domaine `ly-solution.com` ;
2. **coller** le code d'appairage à usage unique dans `backend/.env` ;
3. **démarrer** — le projet s'appaire seul au premier boot ;
4. **déployer** — DNS, TLS, Nginx et PM2 sont automatiques.

Déclarer avant de déployer n'est pas une préférence : la capacité `dns.*` du
Panel n'écrit un enregistrement que pour un nom **qui appartient au projet**, et
cette appartenance se lit sur la destination active, créée à la déclaration.
Et c'est le jeton de pont obtenu à l'appairage qui autorise à demander la
capacité.

Le compte DEV — seul habilité à appairer — naît sans mot de passe et s'active
par un courriel qui passe par le Panel. Un projet neuf ne peut donc PAS être
appairé par un humain ; il n'a pas à l'être, `PANEL_PAIRING_CODE` suffit.

---

## 8. Fournisseurs — aucun secret ici

Aucune clé Stripe, Brevo ou Yousign ne descend jusqu'à ce projet. Il consomme
des **capacités** : il demande, le Panel exécute avec sa propre clé, et rend un
résultat. Le `.env` ne contient que ce qui lui est propre — bases, `JWT_SECRET`,
clé de chiffrement local.

---

## 9. Entreprise cliente — c'est L.Y Solution elle-même

Sur tout autre projet, la fiche « Clients » du Panel porte une société
différente de l'éditrice. Ici, les deux sont la même — ce qui a une conséquence
visible : le pied de page affichera « Réalisé par L.Y Solution » sous
« © L.Y Solution ».

C'est redondant, et c'est juste. La mention n'est pas une signature d'auteur :
elle dit qui OPÈRE le site, et la supprimer demanderait un cas particulier dans
un composant partagé par tout le parc. Le Panel reste libre de ne rien publier —
le bloc disparaît alors de lui-même.

L'identité juridique (SIREN, forme, adresse de facturation, signataire) se
saisit **dans le Panel**, jamais ici : c'est elle qui alimente les mentions
légales et la facturation.

---

## 10. Documents légaux — un template DÉDIÉ

Le template « Site vitrine standard FR » du parc **ne convient pas** à ce site,
et pas pour une nuance de rédaction : trois de ses affirmations y sont fausses.

| ce que le standard affirme | sur ce site |
|---|---|
| « Google Maps — la carte n'est chargée que sur la page Contact » | il n'y a **aucune carte** |
| Google est destinataire « au titre des polices ET de la carte » | **des polices seulement** |
| « les photographies de réalisations illustrent des prestations réellement effectuées » | il n'y a **aucune photographie de réalisation** |

S'y ajoute un traitement que le standard ne décrit pas : le formulaire de ce
site collecte le **nom de l'entreprise** et son **activité**.

Deux templates propres au projet sont donc créés côté Panel :

```bash
cd Panel/backend
npm run migrate:ly-legal -- --dry-run   # simulation
npm run migrate:ly-legal                # écriture
```

Ils sont créés, publiés en v1, puis affectés au projet — **si celui-ci est déjà
déclaré**. Sinon la migration le dit et l'affectation est reportée : on la rejoue
après la déclaration. Le template standard du parc n'est pas touché : il reste
juste pour les autres projets.

---

## 11. Protection contractuelle — désactivée

`SiteStatus.contractProtectionEnabled` vaut `false`. L'invariant « aucun contrat
actif = site suspendu » a un sens pour un client facturé ; l'appliquer au site de
l'éditeur lui-même reviendrait à se suspendre soi-même pour défaut de paiement
envers soi-même.

---

## 12. Contenu

Le contenu initial vient du **plan de site**
(`projets/data/ly solution/LY_Solution_Plan_de_site.pdf`) et il est posé par une
migration explicite :

```bash
cd backend
npm run init:ly          # simulation
npm run init:ly:apply    # écriture
```

Elle écrit la fiche entreprise (nom, accroche, texte de positionnement, quatre
principes), le thème, les deux visuels, et les **trois chapitres** —
`conception` (PILLARS), `architecture` (SPLIT), `experience` (STEPS).

Elle est **idempotente et non destructive** : un chapitre déjà présent n'est
jamais réécrit. À partir du premier passage, c'est le Manager qui fait autorité.

### Ce que la migration n'écrit pas

**Aucune coordonnée.** Le plan de site n'en publie aucune, et inventer une
adresse ou un numéro mettrait une information fausse en ligne sur la page de
contact d'une entreprise réelle. Elles se saisissent dans le Manager,
« Coordonnées ».

**Aucune image d'accueil.** La bannière construit une scène en trois dimensions
— grille en perspective, monolithe en fil de fer ; une photographie posée
derrière donnerait deux images superposées et aucune des deux. Le champ reste
disponible : une image ajoutée s'affichera très en retrait, comme une matière.

---

## 13. Thème

| jeton | valeur | rôle |
|---|---|---|
| `background` | `#08080a` | noir profond |
| `foreground` | `#f4f4f5` | blanc cassé |
| `primary` | `#ededed` | aplats clairs — boutons |
| `accent` | `#7c5cff` | violet du logo — filets, sur-titres, détails |
| `radius` | `0.25rem` | angles presque droits |
| titres / texte | Manrope / Inter | |

### Pourquoi l'accent n'est pas gris

Le plan de site demande « noir et gris profond » : c'est la BASE, et elle est
tenue — fond, texte, surfaces et filets restent neutres. Mais le logo porte un
dégradé violet-bleu, et un site entièrement gris posé sous ce logo aurait donné
deux identités dans le même écran. Le violet ne sert donc **qu'aux détails** :
sur-titres, filets d'un pixel, lueur qui suit le pointeur, trait qui se trace le
long des étapes. Jamais un aplat, jamais un bouton.

### Le logo est détouré ET rendu transparent

`Logo.png` est un carré de 2000 px dont le lettrage n'occupe qu'une bande
centrale : redimensionné à 32 px de haut, il tombait à cinq pixels — présent,
chargé, illisible. Il est donc rogné, puis son fond noir est rendu transparent
par une alpha dérivée du **maximum des canaux** (et non de la luminance, qui
aurait effacé l'anneau violet-bleu, presque dépourvu de vert).

Le prix est assumé : le lettrage étant blanc, il disparaîtrait sur un fond
clair. L'identité de ce site est sombre par définition ; le jour où un fond clair
est nécessaire, c'est une **seconde déclinaison du logo** qu'il faudra, pas un
traitement automatique de celle-ci.

---

## 14. Comptes

`FIRST_DEV_EMAIL=luca.duhoux@gmail.com` — le compte DEV naît **sans mot de
passe** et s'active par un lien à usage unique valable 60 minutes. Ce lien passe
par le Panel : tant que l'appairage n'a pas eu lieu, le compte reste en attente
et le lien est renvoyable. Il n'existe aucun mot de passe de repli.

Aucun `FIRST_ADMIN_EMAIL` : sur ce projet, l'administrateur et le développeur
sont la même personne.

---

## 15. Mise en ligne — ce qui a bloqué, et pourquoi

Déployé le **2026-08-26** par la factory (`deploy-drive.js`), pipeline complet
en vert : DNS, TLS, Nginx, PM2, contrôle de santé public, `deployment.finalize`.

| | |
|---|---|
| Destination | `6a8f0dc936d0ffb69b9e7edf` — `ly-solution.com` (TEST) |
| Serveur | `root@195.35.0.211`, racine `/var/www/ly-solution.com` |
| Port backend | **5107** (attribué par le registre de ports) |
| Processus PM2 | `ly-solution-ly-solution.com` |
| Certificats | trois certificats DÉDIÉS : apex, `manager.`, `api.` |

### Le port 5100 était pris par le Panel — et le registre l'a vu

La destination a réservé 5100 sur la seule base : le registre de ports d'un
projet NEUF est vide, il ignore tout de ce qui tourne déjà sur le serveur
PARTAGÉ. Le pilote pose donc la question à la MACHINE avant d'écrire quoi que
ce soit, et a réattribué :

```
PORT : 5100 occupé — réattribué à 5107 (DETENU_PAR_AUTRUI:panel-panel.ly-solution.com)
```

Sans ce contrôle, le déploiement aurait écrit son Nginx, obtenu ses certificats,
puis échoué en `PM2_PORT_COLLISION` — après coup.

### L'apex pointait vers le parking Hostinger — le vrai blocage

`dns.read` a refusé le premier préflight :

```
✗ HOSTINGER_RECORD_CONFLICT  —  ly-solution.com pointe vers 2.57.91.91 au lieu de 195.35.0.211
```

L'enregistrement `@ A` de la zone valait `2.57.91.91`, l'adresse de la page
« Parked Domain » de Hostinger. Le moteur ne l'a pas écrasé, et il a eu raison :
`ensureDnsRecord` exige `allowOverwrite` pour remplacer un A existant, et
personne ne le lui passe. **Écraser un enregistrement qu'on n'a pas créé, c'est
pouvoir couper un site en production sans l'avoir demandé.**

La correction a été faite délibérément, par la capacité `dns.record.ensure` du
Panel — jamais à la main dans une console d'hébergeur :

```
@ A 2.57.91.91  →  @ A 195.35.0.211   (TTL 300)
```

Rien d'autre n'a été touché : le wildcard `* A 195.35.0.211` (qui couvre
`manager.`, `api.`, et les autres projets), les MX Hostinger, le SPF, le DMARC
et les DKIM Brevo sont restés en place. La capacité ne rend d'ailleurs QUE les
enregistrements de ce projet et la wildcard — ceux du Panel lui sont invisibles.

### `server.preflight` reste en avertissement

Non bloquant, présent aussi sur les autres projets du parc. Le pipeline a
poursuivi et `deployment.finalize` est vert.

---

## 16. Exploitation

```bash
npm run dev              # backend 6100 + manager 6101 + vitrine 6102
npm run build            # vitrine puis manager
npm test                 # la chaîne complète du backend
```

Les ports canoniques de CE projet sont **6100 / 6101 / 6102**, choisis hors des
plages déjà tenues par les autres projets du poste (6070 pour la plupart, 6090
pour `karting-gravona`). Le régime DEV sert tous les managers du parc sur la
même origine : la clé de cloisonnement du stockage local est dérivée du nom de
`manager/package.json` (`ly-solution-manager`), ce qui interdit à ce Manager de
démarrer avec le jeton d'un autre projet.

---

## 17. Documentation de la fabrique qui vaut ici

- [SIMPLIFICATION.md](SIMPLIFICATION.md) — ce qui a été retiré, et pourquoi
- [DUPLICATION.md](DUPLICATION.md) — ce qu'une copie n'hérite jamais
- [PANEL_BRIDGE.md](PANEL_BRIDGE.md) — le pont, l'appairage, les capacités
- [DEPLOYMENT_ENGINE.md](DEPLOYMENT_ENGINE.md) — DNS, TLS, Nginx, PM2
- [TEST_TO_PROD_MIGRATION.md](TEST_TO_PROD_MIGRATION.md) — la promotion contrôlée
