# Protocole d'exploitation — SB Auto

> **Statut : ACTIF.** Autorité pour l'exploitation et le diagnostic. L'autorité
> d'architecture est [ARCHITECTURE.md](ARCHITECTURE.md) ; celle du pont est
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).

Ce document est fait pour être ouvert **pendant** un incident. Chaque procédure
part d'un symptôme observable, pas d'un composant.

---

## Règle de maintenance du pont

> **Toute modification du Panel Bridge — contrat, cycles, types appliqués,
> capacités, appairage — met [PANEL_BRIDGE.md](PANEL_BRIDGE.md) à jour DANS LE
> MÊME LOT.**

Le pont est la seule frontière entre deux systèmes qui se déploient séparément.
Une divergence entre le contrat réel et sa description ne se voit pas en local :
elle se voit en production, chez un projet appairé qui ne parle plus la même
langue que le Panel — et le diagnostic commence alors par une documentation qui
ment.

La même règle vaut pour les capacités : en ajouter une sans l'inscrire dans
`PANEL_BRIDGE.md §8` rend la liste inutilisable, donc non consultée, donc fausse.

---

## Legal documents compliance

> **Toute modification fonctionnelle de cette vitrine doit inclure une
> vérification de compatibilité avec les Mentions légales et la Politique de
> confidentialité actuellement attribuées au projet depuis le Panel.**

Le juridique fait partie du **contrat fonctionnel** du site, au même titre que
son API ou son schéma de base. Une fonctionnalité qui change les traitements de
données, les tiers sollicités, les traceurs ou les responsabilités du site
change le document qui les décrit — et un document qui ne décrit plus le site
est **faux**, pas « à mettre à jour un jour ».

### Ce qui déclenche la vérification

Toute modification touchant, de près ou de loin :

```text
nouveau formulaire            captcha / reCAPTCHA / hCaptcha / Turnstile
analytics / mesure d'audience chatbot ou chat en ligne
tracker / pixel               paiement
newsletter                    réservation (interne ou plateforme externe)
iframe                        carte (Google Maps ou autre)
vidéo externe                 police de caractères distante
nouveau stockage navigateur   cookie
service tiers                 collecte d'une nouvelle donnée
nouvelle finalité             transmission à un nouveau destinataire
modification d'une durée de conservation
```

La liste n'est pas fermée. Le critère réel est : **est-ce que le navigateur du
visiteur, ou notre serveur, échange désormais quelque chose de nouveau, avec
quelqu'un de nouveau, ou pour une raison nouvelle ?**

### La procédure, dans cet ordre

1. **Identifier** les templates actuellement attribués au projet dans le Panel
   (fiche projet → « Documents légaux »).
2. **Vérifier** si leur contenu décrit encore correctement le comportement réel
   du site après la modification.
3. **Ne jamais** livrer la modification en laissant une politique devenue
   fausse. Un site dont la politique ment est un défaut plus grave que la
   fonctionnalité qu'on ajoutait.
4. **Chercher** dans le catalogue du Panel un template existant plus adapté.
5. **S'il existe** : l'assigner au projet, vérifier l'aperçu avec les données
   réelles du projet, publier/synchroniser.
6. **Si aucun ne correspond** : créer et rédiger dans le Panel un template
   dédié — ou corriger le template partagé lorsque le changement vaut pour
   toutes les vitrines —, le publier, l'assigner, synchroniser.
7. **Vérifier les pages publiques** après modification :
   `/mentions-legales` et `/politique-de-confidentialite`.

### Trois interdits

> **Les textes juridiques propres au client ne doivent jamais être hardcodés
> directement dans la vitrine pour contourner le système du Panel.**

Aucune phrase de mentions légales, aucun SIRET, aucune raison sociale dans le
code du frontend. Le site affiche ce que le Panel a résolu ; il ne le rédige
pas. Une copie locale diverge, et c'est toujours celle qu'on ne relit pas qui
reste en ligne.

> **Une modification du code ne doit pas supprimer une fonctionnalité métier
> uniquement pour rester compatible avec une ancienne politique de
> confidentialité ; le document juridique doit évoluer avec le produit.**

L'inversion est tentante parce qu'elle est plus rapide. Elle est fausse : le
document décrit le produit, jamais l'inverse.

> **Si les données nécessaires au nouveau template sont manquantes, ne jamais
> les inventer** : les signaler dans le système de complétude du Panel et
> n'utiliser que des informations vérifiées.

Un SIRET plausible sur une page opposable est pire qu'un bloc absent — et le
résolveur retire proprement les blocs dont une donnée manque.

### Ce que le site ne fait jamais

- il n'appelle **pas** le Panel pour afficher une page légale : il sert sa
  réplique locale (`LegalDocument`), ce qui garantit la page même Panel
  injoignable ;
- il ne **rédige** ni ne **modifie** aucun document : seul l'applicateur du pont
  écrit dans cette collection ;
- il ne sert **jamais** le document d'un autre projet : la charge utile nomme le
  projet destinataire, et un document qui ne nous nomme pas est refusé.

---

## Seeds et résidus de seed

> **L'amorçage ne crée que ce qui MANQUE. Il ne réécrit jamais un contenu que
> quelqu'un a saisi.**

### Le défaut que cette règle ferme

Des valeurs revenaient « toutes seules » : une description d'entreprise
retombant sur le texte du projet d'origine, une palette de thème et sa police
réinitialisées après un redémarrage. Deux causes, et aucune n'était un bug
visible :

1. **des défauts de schéma porteurs de CONTENU** — `name: 'Mon entreprise'`,
   un paragraphe d'introduction hérité du projet source. Mongoose réapplique un
   défaut à chaque `save()` dont le champ est `undefined` : il suffisait qu'un
   opérateur vide son texte, ou qu'un import n'envoie pas la clé ;

2. **des « migrations » sans condition de sortie** — « si le fond du thème vaut
   `#ffffff`, basculer sur le défaut sombre », « retirer le média site
   internet », rejouées à CHAQUE démarrage. Un opérateur qui choisissait
   délibérément un thème clair voyait sa palette entière réécrite au
   redémarrage suivant.

Une reprise de données ne se distingue d'une réinitialisation périodique que par
sa **condition de sortie**. Sans elle, ce n'est pas une migration.

### Les règles

```text
défaut de schéma      = FORME seulement (chaîne vide, null, tableau vide,
                        catalogue d'entrées désactivées). JAMAIS un texte,
                        un nom, une couleur de marque, un contenu client.

migration au boot     = doit CONVERGER. Sa condition porte sur une forme
                        ANCIENNE qui disparaît une fois migrée — jamais sur
                        un état courant qu'un humain a le droit de reproduire.

seed de contenu       = INTERDIT au démarrage. Un jeu de données de
                        démonstration se pose par un script explicite, jamais
                        par `bootstrap()`.
```

### Après toute intervention

Un lot qui a semé des données de recette **nettoie derrière lui**. On ne laisse
jamais un projet avec :

- des services, FAQ, avis ou réalisations de démonstration ;
- une entreprise nommée « Mon entreprise » ;
- un texte d'accueil venu d'un autre client ;
- une bannière promotionnelle de test.

Le contrôle est simple et se fait avant de clore : ouvrir le Manager, et
vérifier que **tout ce qui s'affiche a été écrit pour CE client**.

`catalog-no-seed.test.js` verrouille l'invariant : il compte les documents
métier AVANT et APRÈS un `bootstrap()` complet sur une base déjà remplie, et
échoue si l'amorçage en a créé ou modifié un seul.

---

## Démarrage normal

Le journal doit dérouler ces sections, **dans cet ordre** :

```
CORE
PANEL
INTEGRATED APIs
REPRISES
STRUCTURAL INVARIANTS
BACKGROUND SERVICES
SERVICE INVARIANTS
INVARIANTS
API PRÊTE
```

Verdicts possibles par contrôle : `OK` · `NOT_REQUIRED` · `DEGRADED` · `FAILED`.

Le port HTTP est ouvert **avant** tout cela : `/healthz` et `/readyz` répondent
pendant `STARTING`, tandis que les routes métier rendent `503 SERVICE_STARTING`.
On peut donc observer un backend qui démarre — sans qu'il serve du métier sur un
état à moitié réparé.

**« API PRÊTE » ne signifie pas « le port est ouvert ».** Cela signifie :
bootstrap structurel terminé, reprises structurelles terminées, invariants
structurels passés, services de fond démarrés, invariants de service passés,
`blockingErrors = 0`.

### États de disponibilité

```
STARTING → READY → DRAINING
```

`/readyz` rend `READY` uniquement quand la phase est `READY` **et** que la base
répond.

---

## Backend ne démarre pas

1. Lire la **dernière section atteinte** dans le journal : elle nomme l'étage.
2. Chercher les `FAILED` — seuls les blocages empêchent `API PRÊTE`.
3. `DEGRADED` n'empêche pas le démarrage : le service tourne en mode réduit.
4. `/readyz` reste sur `STARTING` → une étape ne rend pas la main ; regarder
   `REPRISES` (une reprise structurelle bloquante en échec).

Un `[ ok ]` sans preuve est refusé par les invariants : un contrôle qui ne prouve
rien est traité comme dégradé, pas comme réussi.

---

## Incident — Panel

Distinguer quatre situations qui se ressemblent à l'écran :

| Situation | Signe | Action |
|---|---|---|
| Non appairé | aucun appairage persisté | appairer depuis le Manager (DEV) |
| Appairé, injoignable | appairage présent, cycles en échec | réseau / Panel en panne — **ne pas désappairer** |
| Capacité absente | erreur de capacité nommée | ajouter/activer la capacité côté Panel |
| Projet non autorisé | refus d'appartenance | droits du projet côté Panel |

**Ne jamais désappairer pour « réparer » une indisponibilité.** L'appairage est
persistant et chiffré ; il survit aux redémarrages. Le supprimer transforme une
panne passagère en perte de relation.

Après retour du Panel, les travaux différés se réarment seuls (voir
« Reprises différées »).

---

## Incident — IntegratedAPI

**Le chemin de résolution ne passe plus par SB Auto.** Il n'y a plus de page
`Intégrations API`, plus de champ de saisie, plus de route d'écriture.

```
1. diagnostic SB Auto        → que dit le projet ?
2. appairage / capacité      → le Panel est-il joignable, la capacité servie ?
3. administration fournisseur → depuis le Panel L.Y Solution, si nécessaire
```

Les quatre fournisseurs (Stripe, Brevo, Yousign, Hostinger) sont sous autorité
Panel. Aucune procédure ne doit demander de saisir une clé dans SB Auto : il n'y
a aucun endroit où la mettre, et la valeur ne serait lue par aucun chemin
d'exécution.

---

## Modèles d'e-mail — qui décide de quoi

```text
Panel   → quels codes existent, leurs variables, leur contenu, leurs versions
projet  → quels codes il UTILISE (dérivé du code, déclaré au pont)
```

Adopter un modèle EXISTANT : brancher le consommateur, déployer **ce projet**.
Aucun redéploiement du Panel. Un `templateCode` NOUVEAU, lui, exige un
déploiement du Panel d'abord — procédure complète dans
`Panel/docs/PROTOCOL.md` § « NOUVEAU MODÈLE D'E-MAIL ».

Deux refus à ne pas confondre :

| Code | Correction |
|---|---|
| `EMAIL_TEMPLATE_NOT_CONFIGURED` | côté Panel — aucune instance posée |
| `EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT` | côté projet — un chemin appelle un modèle non déclaré |

Vérifier ce que ce projet déclare : `npm run test:template-usage`.

### `developer.supportEmail` — l'adresse de contact PUBLIÉE, jamais devinée

Le pied de chaque e-mail client porte une adresse de contact. Elle vient d'un
CHAMP publié par le Panel — `contacts.publicContactEmail` — et de rien d'autre.

Jusqu'à ce lot, elle était DÉDUITE : ce projet balayait `references[]` et
retenait la première valeur qui ressemblait à une adresse. Réordonner les liens
de l'agence dans le Panel changeait donc, en silence, le contact de tous les
clients.

**Ce qui n'est jamais emprunté comme repli** : l'expéditeur du parc (`From`,
souvent une boîte technique), `contacts.email` (administratif),
`contacts.supportEmail` (adresse Let's Encrypt), l'adresse d'un compte
SUPER_ADMIN, une variable d'environnement de ce projet, un réglage local.

**Absente, on refuse.** `billingVariableResolver` lève plutôt que d'envoyer un
message invitant le client à répondre à une adresse vide. Le message nomme
l'écran à remplir : Panel → « Expéditeur e-mail » → « E-mail de contact
public ».

**Repli transitoire.** Un Panel qui ne publie PAS encore le champ (le champ est
`undefined`, pas vide) fait retomber ce projet sur l'ancienne déduction, à
l'identique : une plateforme en cours de mise à niveau ne perd pas l'adresse
qu'elle affichait hier. Un champ publié VIDE, lui, vaut `null` — c'est une
décision non prise, pas une donnée manquante.

Vérifier : `node src/scripts/developer-identity-bridge.test.js` § 17bis.

## IMPAYÉ — ce que le client reçoit, et ce qui ferme le site

Ce projet **applique**, il ne décide pas. L'incident, sa politique de grâce et
son échéance viennent du Panel ; ce projet en tire des messages et, quand la
CAUSE arrive, l'accessibilité du site.

### Les messages, dans l'ordre

```text
1er refus              → contract.payment.overdue            → CONTRACT_PAYMENT_OVERDUE_ADMIN
tentative refusée      → contract.payment.retry_failed       → CONTRACT_PAYMENT_RETRY_FAILED_ADMIN   ← à CHAQUE fois
échéance atteinte      → contract.payment.overdue_critical   → CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN
régularisation         → contract.payment.recovered          → CONTRACT_PAYMENT_RECOVERED_ADMIN
encaissement           → launch_fee.paid / subscription.paid → PAYMENT_CONFIRMED_ADMIN
```

Tous vers `ADMIN_EMAILS`. La fermeture confirmée est annoncée par le **Panel**,
pas ici : il est l'autorité de cette décision et parle à ses propres comptes.

### Pourquoi la relance ne double jamais

`attemptCount` — le compteur du prestataire, recopié, jamais calculé. Le
compteur figure dans la clé d'idempotence, donc :

- 8 relivraisons du même webhook → **1** message ;
- un compteur qui recule (rattrapage de journal) → **0** message ;
- une tentative après l'expiration → **0** (l'alerte critique a parlé) ;
- une tentative tardive sur un impayé réglé → **0** (on ne réclame pas de
  l'argent reçu).

### Ce que l'applicateur d'incident ne fait JAMAIS

Il ne touche pas `SiteStatus`, n'importe pas `reconcileSiteStatus`, ne ferme
aucun site — quel que soit le contenu de la charge. Un test statique interdit
ces imports. Fermer un site est le rôle de `paymentDefaultCause.applier.js`, et
la cause n'arrive qu'à l'expiration de la grâce.

Pendant toute la grâce : **l'incident existe, la cause n'est pas active, le site
répond**.

### Vérifier

```bash
node src/scripts/payment-grace-retry-relance.test.js   # la relance et ses refus
node src/scripts/payment-default-incident.test.js      # l'incident ne ferme rien
```

---

## Incident — e-mail

```
1. configuration métier SB Auto   Manager → Templates e-mail
2. appairage Panel                c'est la plateforme qui envoie
3. expéditeur / capacité          email.send_template, email.sender.verify
4. dispatch Panel                 webhook central du Panel
5. événements de livraison        EMAIL_DELIVERED / EMAIL_BOUNCED par le pont
```

**Ne jamais chercher une clé Brevo locale : il n'y en a plus.** Le blocage local
possible est `PANEL_NOT_PAIRED`, et lui seul.

Une livraison qui reste « Accepté » sans confirmation indique un problème de
**retour** (étapes 4–5), pas d'envoi.

---

## Incident — paiement Stripe

```
capacités billing.*        exécutées par le Panel
webhook                    provisionné par le Panel, reçu par le projet
webhookSecret              livré par le Panel, vérifie les événements entrants
```

Ce secret **ne permet aucun appel** : il sert uniquement à constater qu'un
événement reçu vient bien de Stripe. Ce n'est pas une autorité locale.

Si la réconciliation du webhook n'a pas eu lieu au démarrage parce que le Panel
n'était pas encore appairé, l'état est `DEFERRED` — **pas** abandonné.

### La redirection n'est jamais une preuve

> La procédure complète — schéma de convergence, ordre des webhooks, doctrine de
> la facture, les deux messages d'encaissement — vit dans
> **`Panel/docs/PROTOCOL.md` § « CONVERGENCE D'UN PAIEMENT »**. Elle traverse les
> deux systèmes, elle est donc écrite une seule fois. Ce qui suit est ce que le
> projet en applique.

Fermer l'onglet du prestataire de paiement avant la redirection ne change
**rien** : l'état vient des webhooks signés et de la réconciliation, jamais d'un
paramètre d'URL. Une garde de recette (`stripe-payment-convergence.test.js`)
vérifie qu'aucun applicateur de paiement ne lit `req.query`, `searchParams` ni
`session_id`.

### Un instantané tardif ne défait pas un encaissement

Le fournisseur ne garantit aucun ordre de livraison, et chaque événement
transporte l'objet **tel qu'il était** quand l'événement a été produit. Le
21 août 2026 :

```text
10:32:03.370  invoice.paid                   → ACTIF
10:32:03.563  customer.subscription.created  → « incomplete »   ← plus ANCIEN
```

Le contrat porte donc `stripe.subscription.statusObservedAt` : une observation
strictement plus ancienne n'écrit **ni** statut, **ni** période, **ni**
résiliation. Les identités (`subscriptionId`, `latestInvoiceId`, `customerId`),
elles, s'écrivent toujours — elles nomment des objets, elles ne décrivent pas un
état.

`evt.created` étant à la seconde, une seconde garde tranche les annonces
simultanées : **« incomplete » ne défait jamais une facture déjà encaissée**.
Une lecture directe de l'abonnement est horodatée « maintenant » et prime donc
sur tout — c'est ce qui rend la réparation possible.

### « Vérifier le paiement »

Idempotent : il relit l'autorité, applique ce qui est déjà prouvé, et rend
l'état. Il ne repaie rien, ne recrée aucune session, ne crée aucune transaction.

Quand l'autorité ne répond pas, il rend `authorityReached: false` et l'écran dit
« nous n'avons pas pu joindre le service de paiement » — jamais « état vérifié ».
Annoncer une vérification qui n'a pas eu lieu, puis réclamer à nouveau un
paiement déjà fait, est le plus sûr moyen de faire croire à un échec.

### Le message d'encaissement attend sa facture

`launch_fee.paid` et `subscription.paid` déclenchent tous deux
`PAYMENT_CONFIRMED_ADMIN` — un seul modèle, `payment.kind` et `payment.period`
portent la différence. Les deux faits sont émis depuis le point que traversent
**et** le webhook **et** la réconciliation : jamais depuis un retour de
navigateur.

`payment.invoiceUrl` est **obligatoire**. Le fournisseur annonce l'encaissement
avant d'avoir fini d'émettre la facture — environ quatre secondes sur les frais
de lancement — et le résolveur lève alors un refus **rejouable** : 30 s, 2 min,
10 min, puis `DEAD_LETTER`. Un trou qu'on voit vaut mieux qu'un bouton
« Voir ma facture » qui mène à une liste vide.

```text
Incident : le message est en DEAD_LETTER avec « la facture n'est pas encore parvenue »
  1. la facture est-elle arrivée ?   /dev/factures — le webhook invoice.finalized
  2. si NON  → le webhook du fournisseur n'atteint pas le projet
  3. si OUI  → relancer l'exécution depuis /dev/evenements
```

---

## Reprises différées

Vocabulaire de la section `INTEGRATED APIs` :

```
DISABLED · NOT_REQUIRED · DEFERRED · READY · RECONCILING
READY_RECONCILED · DEGRADED_RETRYING · FAILED_BLOCKING
```

`DEFERRED` = le travail est **dû** mais attend une dépendance explicite. Il reste
**armé** : l'arrivée de la dépendance (appairage rétabli, tunnel public
disponible) le réveille. Le défaut historique — webhook sauté parce que le Panel
n'était pas encore là, puis jamais repris — n'existe plus.

États d'un travail : `PENDING` · `ARMED` · `RUNNING` · `RETRYING` · `SUCCEEDED` ·
`EXHAUSTED`. `EXHAUSTED` est un état terminal qui se **dit** : on ne réessaie pas
indéfiniment en silence.

---

## Incident — déploiement

**Le déploiement appartient au backend, jamais à la page ni à la connexion HTTP.**

| Symptôme | Lecture | Action |
|---|---|---|
| `DEPLOYMENT_ALREADY_RUNNING` | un run est actif sur cette cible | suivre le `runId` rendu, ne pas relancer |
| L'écran a perdu le suivi | l'observateur s'est détaché | `GET /deployment/runs/active` puis `/runs/:id/observe` |
| Backend redémarré pendant un run | le run ne **reprend pas** son exécution | `recoverOrphanRuns()` le finalise ; l'UI retrouve le résultat persisté |
| Backend momentanément indisponible | le flux d'observation meurt | l'observateur affiche « Redémarrage du serveur… », recule de façon bornée, refait `activeRun()` et reprend |
| Conflit de destination / de port | verrou de cible | inspecter `DeploymentTarget` et le registre de ports |

Points de diagnostic : `runId`, étape courante, journal du run, finalisation,
verrou de la cible.

**Une déconnexion d'observateur n'est jamais une annulation.** La route
d'observation est un `GET` qui ne pilote pas le moteur : quitter la page, fermer
l'onglet, rafraîchir ou perdre le réseau ne demandent rien au déploiement.

**Reprise d'observation ≠ reprise d'exécution.** Après un redémarrage backend, un
run interrompu est *finalisé*, pas relancé.

---

## Extinction

```
SIGTERM
  ↓ readiness → DRAINING
  ↓ on cesse d'accepter du travail métier
  ↓ services de fond arrêtés dans l'ORDRE INVERSE du démarrage
  ↓ drain des cycles en vol
  ↓ arrêt des reprises différées
  ↓ fermeture du serveur HTTP
  ↓ déconnexion Mongo
```

Signes d'une extinction anormale : un cycle qui écrit après la fermeture Mongo,
un ordonnanceur encore actif, un `CYCLE_FAILED` lors d'un arrêt normal. L'ordre
inverse n'est pas une élégance : c'est ce qui garantit qu'aucun service n'écrit
dans une base qu'on vient de fermer.

---

## Diagnostic e-mail — ce que l'outil regarde

`runEmailDiagnostics()` vérifie, dans cet ordre : lien à la plateforme,
fournisseur activé, expéditeur (détenu par le Panel), et **retours de livraison
réellement appliqués**. Ce dernier point est le plus utile : il ne demande à
personne si le suivi est branché, il regarde si des livraisons ont été
confirmées.

Aucun retour n'est un **avertissement**, jamais un échec : un projet neuf n'a
encore rien envoyé.

---

## Familles de tests

| Famille | Ce qu'elle prouve | Suites structurantes |
|---|---|---|
| Gardes d'architecture | des invariants ne peuvent pas revenir en silence | `integrated-api-panel-authority`, `engine-governance`, `bridge-conformity` |
| Démarrage | ordre, preuves, invariants, vocabulaire | `bootstrap-startup-invariants` |
| Reprises avant workers | aucun worker sur un état non réparé | `bootstrap-recovery-before-workers` |
| Pont | contrat, appairage, persistance, sync | `panel-bridge`, `bridge-persistence`, `project-sync` |
| Déploiement | run persistant, reprise, finalisation | `deployment-live-resume`, `deployment-engine` |
| Navigateur réel | navigation, reload, multi-onglets | `manager/scripts/recette-deploiement-live.mjs` |
| Manager | logique métier, architecture front | `manager/src/lib/*.test.mjs` |

Une garde d'architecture verrouille surtout des **absences** : une route
supprimée, un champ retiré, un repli interdit. C'est ce qui peut revenir sans
que rien n'échoue.

## `npm test` — limites actuelles

> **La chaîne `npm test` du backend n'est pas intégralement verte, et elle
> s'arrête au premier échec.**

Il faut distinguer deux choses que le même rouge recouvre :

- **Tests structurants** — démarrage, reprises, pont, déploiement, gardes
  d'architecture, e-mail, webhooks, IntegratedAPI : **verts**.
- **Échecs historiques préexistants**, sans lien avec l'architecture décrite
  ici : `panel-pairing-session`, `project-identity`, `vitrine-responsive`,
  `contract-signature-requirement`, `subscription-reconcile`,
  `legacy-credential-scan`. Côté Manager : `subscriptionPricing`.

Conséquence pratique : lancer les suites concernées **individuellement** pour
valider un lot, plutôt que de conclure depuis un `npm test` qui s'interrompt
avant de les atteindre.

---

## Réseau public déclaré (contrat de pont 1.9.0)

```text
autorité        SystemConfiguration.network.{backendUrl, websiteUrl, managerUrl}
canaux          Heartbeat.runtime.network      OPÉRATIONNEL — « je réponds ICI »
                                               (à chaque battement, liveness)
                PROJECT_PRESENTATION.network   DÉCLARATIF — « je vise CE domaine »
                                               (au changement ; alimente la
                                                DESTINATION, jamais l'adresse
                                                opérationnelle du Panel)
garde           n'émettre le champ additif QU'À un Panel >= 1.9.0
                (x-bridge-contract-version lu sur chaque réponse, fail closed)
interdits       APP_URL · localhost · boucle locale · domaine historique
                · recomposition « base + chemin »
suite           npm run test:runtime-network
```

**L'invariant à ne jamais perdre de vue :**

```text
appairage    = relation d'IDENTITÉ et de CONFIANCE
URL publique = ÉTAT COURANT
```

Une adresse périmée côté Panel ne se corrige **jamais** par un réappairage ni
par une édition manuelle de la fiche : ce projet la déclare, le Panel la
reflète. Voir `docs/PANEL_BRIDGE.md` §7 ter et `Panel/docs/PROTOCOL.md`
§ *Project runtime URL synchronization*.

---

## PDF de contrat : worker, MIME et autorité média

### Le worker PDF est un module — et nginx l'ignorait

L'éditeur de zones de signature s'appuie sur PDF.js, dont le worker est émis par
Vite sous `/assets/pdf.worker.min-<hash>.mjs`. La table `mime.types` livrée avec
nginx ne connaît pas l'extension `.mjs` sur les versions encore couramment
déployées : le fichier repartait en `application/octet-stream`.

Le navigateur applique aux scripts de **module** un contrôle de type **strict**
(spécification HTML). Constaté en recette réelle :

```text
Failed to load module script: The server responded with a non-JavaScript
MIME type of "application/octet-stream".
Warning: Setting up fake worker.
Uncaught (in promise) Error: Setting up fake worker failed
```

PDF.js basculait alors sur un worker de secours, qui échouait à son tour, et
l'écran restait en chargement **sans fin**.

**Le correctif est dans le générateur** (`deployment-engine/nginx.js`), jamais à
la main sur le VPS — sinon le déploiement suivant réintroduit le défaut :

```nginx
location ~* \.mjs$ {
    types { }
    default_type application/javascript;
    expires 1y;
    add_header Cache-Control "public, immutable";
    try_files $uri =404;
}
```

**Pourquoi un `location` dédié et pas un `types` dans `/assets/`.** Un bloc
`types { … }` ne complète pas la table héritée : il la **remplace** pour sa
portée. Le poser dans `/assets/` pour y ajouter une extension ferait perdre
toutes les autres — CSS, polices, images repartiraient en type par défaut. On
isole donc l'extension avec une table vide + `default_type` explicite.

La règle porte sur l'**extension**, jamais sur un nom ni un hash : tout module
d'un build futur en bénéficie. Garde : `npm run test:pdf-mime`, qui prend un
module **réellement produit** par le build et exécute contre lui l'expression
régulière générée — un `grep` ne prouverait rien.

### Le PDF d'un contrat n'a qu'un seul domicile

Les documents de contrat s'écrivaient sur le **disque de l'instance qui recevait
l'import**. Un PDF déposé depuis un poste de développement n'existait que sur ce
poste ; le Manager déployé ne l'avait jamais vu. Inversement, un PDF déposé sur
le déployé restait invisible en local. Deux disques, deux vérités.

Les médias **image** avaient déjà tranché, et c'est cette règle qu'on applique —
sans en inventer une seconde :

```text
backend DÉPLOYÉ du projet  = AUTORITÉ (il stocke)
toute autre instance       = CLIENT   (elle relaie, elle ne stocke rien)
```

Il n'y a **qu'un seul dossier** : rien n'est copié dans les deux sens, rien n'est
à synchroniser, et aucune fenêtre ne laisse deux copies diverger. Le relais
reporte le jeton de l'appelant — les instances partagent la clé de signature —
donc aucun secret n'est provisionné et le navigateur ne parle qu'à son propre
backend.

**Aucun repli local si l'autorité est injoignable.** L'import échoue, la lecture
échoue, et l'écran le dit. Se rabattre sur le disque recréerait exactement les
deux vérités qu'on vient de supprimer — et celle-ci porterait un contrat.

Le contrôle d'accès reste appliqué **avant** toute décision de relais, puis de
nouveau chez l'autorité : la garde n'est pas déplacée, elle est appliquée deux
fois.

### Accès et en-têtes

Un PDF de contrat est **sensible** : il n'est jamais publiquement devinable. Il
passe par un endpoint **authentifié** (`GET /api/contracts/:id/documents/:kind`)
qui contrôle le rôle — un ADMIN ne lit que SON contrat.

```text
Content-Type        application/pdf
Content-Disposition attachment    (voir ci-dessous)
Cache-Control       private, no-store
```

`attachment` est **conservé volontairement**. Le visionneur ne navigue jamais
vers l'URL : le Manager récupère le document en `Blob` puis en `arrayBuffer()`,
et la disposition n'atteint donc aucune navigation. La passer à `inline` ne
changerait rien au rendu et modifierait le comportement du téléchargement.

Pour la même raison, **PDF.js n'émet aucune requête `Range`** sur ce chemin :
`getDocument({ data })` reçoit le tampon complet. `Accept-Ranges` n'est donc pas
requis sur l'endpoint relayé.

### Chargement borné, échec terminal

Le chargement du document a un **délai maximal**. `getDocument().promise` ne
rejette pas toujours : quand le worker ne se charge pas, la promesse peut rester
**pendante**, et un écran qui l'attend reste en « Chargement… » indéfiniment.
Une attente sans fin n'est pas un état, c'est l'absence d'état.

Trois états, et aucun n'est une attente sans fin :

```text
chargement → document rendu
           → « Impossible de charger le document PDF. » + Réessayer
```

Le détail technique va à la **console**, pas à l'écran : « Setting up fake worker
failed… » ne dit rien à qui veut placer une zone de signature.

---

## Cache `immutable` : l'URL doit porter l'identité de la release

### L'invariant

> Un asset HTTP déclaré `immutable` doit avoir une identité d'URL qui change
> lorsque sa **représentation de release** change. Une correction portant
> uniquement sur un en-tête ne peut pas réhabiliter une URL déjà mise en cache
> comme immuable.

### Ce que cet invariant a coûté

Le worker de PDF.js a été servi un temps en `application/octet-stream`
(extension `.mjs` absente de la table MIME de nginx). Le serveur a été corrigé.
Mais les **octets** du worker n'avaient pas changé — donc son empreinte Vite non
plus, donc son URL non plus :

```text
mauvaise réponse   /assets/pdf.worker.min-yatZIOMy.mjs
bonne réponse      /assets/pdf.worker.min-yatZIOMy.mjs      ← MÊME URL
+ Cache-Control: public, immutable, max-age=31536000
```

`immutable` (RFC 8246) demande au navigateur de **ne jamais revalider** pendant
la durée de fraîcheur. Tout navigateur ayant chargé le worker avant le
correctif conservait donc la réponse fautive — **avec son type MIME** — pendant
un an, et rejouait indéfiniment :

```text
Failed to load module script … "application/octet-stream"
Setting up fake worker failed
```

sur une adresse que le serveur servait pourtant correctement. **Aucun en-tête ne
répare cela ; seule une URL différente le peut.**

Demander à l'utilisateur de vider son cache n'est **pas** une correction : la
démonstration est entre les mains d'un client, qui n'a pas à connaître
l'existence du cache navigateur.

### La correction

L'URL du worker porte l'identité de la **release**, pas seulement celle de son
contenu :

```text
release A   /assets/pdf.worker.min-<hash>.mjs?build=A
release B   /assets/pdf.worker.min-<hash>.mjs?build=B
```

Une entrée empoisonnée sur A ne peut pas contaminer B : ce sont deux clés de
cache distinctes pour le navigateur.

```text
moteur    build.js injecte VITE_BUILD_REVISION (dérivée de `builtAt`)
Manager   workerSrc = `${workerUrl}?build=${VITE_BUILD_REVISION}`
```

**Pourquoi `builtAt` et pas le commit.** Ce projet se déploie couramment avec
des modifications non commitées (`isDirty: true` au manifeste) : deux artefacts
différents partageraient alors le même hachage de commit, et l'URL ne changerait
pas. `builtAt` identifie l'**artefact réellement construit**.

**Pourquoi pas `Date.now()`.** Une révision recalculée à chaque chargement
détruirait tout cache utile — 1,3 Mo retéléchargés à chaque ouverture de
l'éditeur. La révision est **figée pendant toute une release** et ne change
qu'à la suivante. Une garde de test le vérifie.

### Politique de cache retenue

```text
.mjs   Cache-Control: public, immutable, max-age=31536000   ← CONSERVÉ
```

`immutable` reste **correct et souhaitable**, parce que l'URL est désormais
versionnée par release (doctrine A du choix documenté). Passer les `.mjs` en
revalidation permanente ferait payer un aller-retour réseau à chaque
chargement pour se prémunir d'un défaut que le versionnement d'URL supprime à
la racine.

`index.html`, `version.json` et `build-manifest.json` restent en `no-cache` :
c'est ce qui permet au navigateur de **découvrir** le nouveau bundle, donc la
nouvelle URL du worker. Sans cela, le versionnement serait inopérant.

### Ce que le déploiement vérifie désormais

`checkModuleMimeType` (étape `validate`) interroge, sur chaque hôte statique,
un module **réellement présent**, sous ses **deux formes** — URL nue et
`?build=…`. Un type MIME non-JavaScript lève `MODULE_MIME_INVALID` et **bloque**
`deployment.succeeded`.

### Absence de service worker

Aucun service worker ni PWA dans le Manager (vérifié : ni `navigator.serviceWorker`,
ni `workbox`, ni `vite-plugin-pwa`). Aucune couche de cache applicative ne
s'ajoute donc à celle du navigateur.

---

## Signataire de l'entreprise développeur — autorité et frontière

### Qui détient cette identité

```text
PanelCompany.signer  (Panel, une fois, pour TOUT le parc)
        ↓  publication DEV_COMPANY
projet : copie de lecture, jamais autorité
        ↓  gel au moment de la validation
Contract.signersSnapshot  (immuable)
```

Ce projet **ne détient pas** cette identité, ne la devine pas, et n'en garde
aucune copie faisant autorité. Aucun écran du Manager ne la porte — c'est
délibéré, et c'est ce que le message d'erreur doit refléter.

### Pourquoi elle n'est PAS dérivée d'un compte Panel

La tentation est réelle : le Panel a des comptes, dont un souverain, et l'on
voudrait que « ça marche tout seul » sans rien configurer. C'est impossible
**et** indésirable :

| | |
|---|---|
| ce qu'un `PanelUser` porte | `email`, `role`, `enabled`, `displayName` |
| ce qu'une demande Yousign exige | `firstName`, `lastName`, `email` — les trois |

Un compte ne porte **ni prénom, ni nom, ni fonction**. Le dériver imposerait de
fabriquer une identité civile à partir d'un libellé de connexion — sur un
document qui **engage juridiquement** une entreprise. Un `displayName` valant
« Développeur » produirait une demande de signature au nom d'une personne
appelée « Développeur ».

C'est la raison pour laquelle le modèle du Panel l'écrit :

> *« Jamais déduit d'un compte utilisateur : un compte sert à se connecter, pas
> à signer. »*

La suite `platform-signer-authority` verrouille cet invariant.

### Ce qui se passe quand elle manque

Refus **fail closed**, avant tout appel fournisseur :

```text
code    PLATFORM_SIGNER_NOT_CONFIGURED
statut  400
effet   aucune demande Yousign, aucun contrat marqué envoyé
```

Le message **désigne la plateforme** et non ce Manager :

> « Le représentant de <entreprise> utilisé pour la signature n'est pas
> configuré sur la plateforme (Panel L.Y Solution). »

Le signataire **client**, lui, se configure bien dans ce projet : les deux
messages restent distincts, sinon l'utilisateur est envoyé au mauvais endroit
une fois sur deux.

### Historique immuable

Pour toute nouvelle demande de signature nécessitant le représentant de
L.Y Solution, l'identité est **résolue au moment de la validation** depuis
l'autorité plateforme. Le contrat conserve ensuite le **snapshot du signataire
réellement utilisé** (`signersSnapshot`).

Un changement ultérieur de représentant ne réécrit donc jamais l'identité d'une
demande déjà créée, ni l'historique d'un contrat signé.

---

## Le bouton « Signer » — ce qu'il fait, et ce qui peut le refuser

### Ce que le bouton fait réellement

Le libellé dit « Signer ». Le code fait deux choses en un acte :

```text
DevJourney « Signer »
  → api.startDevSignature(id)          POST /api/contracts/:id/start-dev-signature
  → contract.service.startDevSignature()
       préconditions : signature requise · statut PENDING_DEV_SIGNATURE
                       fournisseur prêt · AUCUNE demande existante
  → yousign.service.createContractSignatureRequest()
       lit le PDF chez l'AUTORITÉ MÉDIA (jamais sur disque local)
  → buildSignatureOpenPayload()        ← pure, testable, validée contre le Panel
  → capacité « signature.request.open »
       Panel : réservation · brouillon · document · signataires · champs · activation
  → renvoie le LIEN de signature du DEV
  → le Manager NAVIGUE vers Yousign dans le même onglet
```

C'est donc **A + C** : ouvrir la demande *et* emmener le développeur signer. Le
libellé ne trompe pas — l'utilisateur clique « Signer » et se retrouve en train
de signer. La création de la demande est un moyen, pas la finalité affichée.

⚠️ Le retour dans le **même onglet** est délibéré : Yousign ramène l'utilisateur
via `redirect_urls`. Ouvert dans un onglet séparé, ce retour atterrirait dans un
onglet orphelin pendant que l'original afficherait encore « à signer ».

### Idempotence

Trois verrous indépendants, du plus proche au plus lointain :

```text
1. SB Auto     `yousign.signatureRequestId` non nul → refus immédiat
2. operationId `sig-open-<contractId>` — DÉRIVÉ, jamais tiré au hasard :
               deux clics = même clé = même acte au registre du Panel
3. Panel       index partiel « une demande VIVANTE par contrat »
```

Une clé aléatoire aurait laissé le second clic passer pour une intention
distincte. Seul le troisième verrou l'aurait rattrapé — plus tard, et moins
clairement.

### Le refus qui ne disait rien

Un clic rendait :

> « Entrée refusée par « signature.request.open ». »

Ce message envoyait chercher un champ fautif. **Il n'y en avait aucun.** Le
payload était valide de bout en bout ; le refus venait d'une règle du COMPTE de
signature — en bac à sable, Yousign n'accepte comme destinataire qu'une adresse
appartenant à l'organisation du compte.

La cause a été établie par expérience contrôlée : le **même** payload, rejoué en
ne changeant que l'adresse du signataire développeur, échoue avec une adresse
hors organisation et **réussit** avec une adresse membre.

Deux manques distincts, deux réponses distinctes :

```text
· le payload n'était éprouvable qu'en appelant vraiment le Panel
    → extrait dans `buildSignatureOpenPayload()`, pure et testable ;
· Yousign refuse parfois SANS `invalid_params` — la cause est une règle de
  compte, pas un champ ; le Panel rendait alors un message vide de sens
    → le Panel RECONNAÎT le refus et rend un MOTIF stable.
```

Le Panel ne relaie toujours pas la phrase du fournisseur : elle n'est pas
contractuelle et pourrait porter une valeur. Il rend `reason`, que le projet
traduit en message d'action.

### Motifs de refus reconnus

| motif | ce que l'exploitant doit faire |
|---|---|
| `SIGNER_EMAIL_NOT_IN_ORGANISATION` | l'adresse d'un signataire n'appartient pas à l'organisation du compte de signature, qui est en bac à sable — l'ajouter à l'organisation, ou sortir du bac à sable |

Un refus **non reconnu** reste actionnable : il nomme les champs refusés quand
Yousign les fournit, et dit quoi vérifier — document, zones, signataires.

### La garde de parité

`src/scripts/signature-open-payload-contract.test.js` charge le **vrai** schéma
du Panel (`capabilityRegistry.js`) et y valide le payload réellement construit.

Recopier le schéma ici donnerait une suite verte le jour où le Panel ajoute un
champ requis : les deux copies divergeraient en silence, et c'est exactement le
défaut qu'on prétend surveiller.

Si le dépôt du Panel est absent, le contrôle est déclaré **NON VÉRIFIÉ** — jamais
« vert ». Le seul résultat inacceptable serait de croire la parité vérifiée
alors que personne ne l'a regardée.

### Annuler une demande — le motif est une énumération, pas un libellé

Le nettoyage de ce lot a révélé un troisième défaut, indépendant du précédent :
le Panel envoyait `reason: 'cancelled'`. Yousign le refuse.

```text
reason = 'contractualized'  → HTTP 400  « invalid params », champ non nommé
reason = 'mistake'          → HTTP 400  idem
reason = 'other'            → HTTP 201  status: canceled     ◄── la seule preuve
```

L'annulation d'une demande de signature ne fonctionnait donc **pas** — et c'est
le seul moyen de retirer une demande déjà activée. L'échec ne disait pas
pourquoi, parce que Yousign ne nomme pas le champ fautif ici non plus.

`'cancelled'` se lisait bien. Ce n'était pas une valeur d'énumération pour
autant. Un test verrouille désormais la constante et interdit le retour du
libellé en dur — la lisibilité ne doit pas reprendre le dessus sur la preuve.


## DÉPLOIEMENT DIRECT EN TEST — deux portes, un seul moteur

### Ce que la garde de la route protège, et ce qu'elle ne dit pas

`POST /deployment/deploy/stream` est gardée par `authenticate` puis
`authorize(ROLES.DEV)`. Cette garde protège une **interface** : elle répond à
*« qui a le droit de cliquer »*.

Elle ne dit **rien** de ce dont le déploiement a besoin pour s'exécuter. La
confusion entre les deux a coûté un blocage réel : faute du mot de passe d'un
compte métier, on ne pouvait plus déployer depuis un poste d'exploitation —
alors qu'aucune ligne du moteur ne demande ce compte.

### Ce que le moteur demande réellement

```
engine.deployWithReport({ url, sessionId, user, deploymentRunId, onEvent })
```

| Paramètre | Ce que c'est |
|---|---|
| `url` | la destination, lue en base |
| `sessionId` | une session VPS — **`VPS_PASS`** ouvre le serveur |
| `deploymentRunId` | le run durable, créé par les mêmes services |
| `user` | une **attribution** écrite au journal du run, et rien d'autre |

Autrement dit : **identifiants DÉVELOPPEUR = authentification d'une route
HTTP** ; **`VPS_PASS` = credential d'infrastructure du moteur**. Les deux ne
sont pas interchangeables, et seul le second est nécessaire pour déployer.

### Les deux portes

| | Déclencheur | Public | Authentification |
|---|---|---|---|
| Route Manager | `POST /deployment/deploy/stream` | interactif | compte DÉVELOPPEUR |
| `tools/deployDirect.js` | le **contrôleur**, appelé en processus | exploitation | aucune — accès local à la base et à `VPS_PASS` |

**Les deux exécutent exactement le même `DeploymentEngine`, par le même
contrôleur.** Aucune des deux ne possède de logique de déploiement.

### Ce que le runner ne fait pas

Pas un `ssh`, pas un `scp`, pas un `pm2 restart`, pas une ligne de nginx.
Reproduire les commandes du moteur donnerait un **second moteur**, qui
divergerait au premier correctif apporté au premier — et c'est sur une mise en
production qu'on s'en apercevrait.

Il appelle `deployStream(req, res)` avec une réponse simulée qui n'implémente
que les cinq gestes utilisés par le contrôleur. Tout le reste — prérequis
locaux, `.env` distant, run durable, verrou de destination, plan de contrôle,
DNS, pipeline, barrière de publication, contrôle de santé, finalisation,
rollback, forensique — est exécuté par le code officiel, puisque c'est lui
qu'on appelle.

### Pourquoi pas un jeton signé

On aurait pu signer un jeton avec `JWT_SECRET` et appeler la route par HTTP. Ça
marche, et ça donne le change : le runner **aurait l'air** d'un utilisateur
connecté. Il n'en est pas un, et prétendre le contraire brouille exactement la
distinction que cette section établit.

Il ne se fait donc passer pour personne : il s'attribue l'acteur
`exploitation@runner.local`, que le journal du run conserve tel quel. Un mois
plus tard, on saura que personne n'a cliqué.

**Aucun mot de passe n'a été réinitialisé, aucun compte créé.** Réinitialiser
le mot de passe du développeur aurait donné le même accès — en CHANGEANT un
état, et en enfermant dehors celui à qui il appartient.

### PROD reste derrière l'interface

Le runner **refuse** tout autre environnement que TEST. Un déclencheur sans
écran de confirmation n'a rien à faire en production : la route, elle, exige
une confirmation explicite, et c'est précisément le garde-fou qu'on ne veut pas
contourner par commodité.

```
node tools/deployDirect.js --environment TEST [--preflight-only] [--skip-build]
```
