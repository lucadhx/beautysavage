# RX-CONTRACT-UX-POLISH-03 — rapport

Finalisation UX du système de contrats : parcours guidé, vue DEV, viewer
multipage, retour automatique. **Aucune règle métier modifiée** — l'étape
courante reste dérivée par le backend, les préconditions restent les siennes.

---

## 1. Le contrat naît sans nom

`createContract` posait `Contrat <référence>`. Deux conséquences, dont une
invisible :

1. le DEV devait **effacer un texte qu'il n'avait pas écrit** ;
2. le front devait **deviner** « pas encore nommé » en comparant le nom à cette
   même chaîne :

```ts
// AVANT — deux couches tenues de s'accorder sur un littéral
export function defaultContractName(reference: string) { return `Contrat ${reference}`; }
export function isNamed(c) { return c.name.trim() !== '' && c.name !== defaultContractName(c.reference); }
```

Backend et front devaient dire exactement la même chose. Si l'un des deux avait
changé, l'étape « Nommer le contrat » se serait déclarée franchie sur un contrat
sans nom — sans que rien n'échoue.

Le nom naît vide (`default: ''` au modèle, rien n'est requis côté Mongoose), et
`isNamed` se réduit à « le champ est rempli ». La chaîne magique disparaît des
deux côtés.

**Le nom reste obligatoire avant validation**, exactement comme avant : c'est le
parcours guidé qui l'exige (étape bloquante `NAME`). `validateContract` ne l'a
jamais réclamé côté backend, et on ne le lui fait pas dire maintenant — ce serait
une règle métier nouvelle.

**Rétro-compatibilité assumée** : les contrats créés avant portent encore
`Contrat <référence>` et comptent désormais comme nommés. Ils ont un nom, et il
reste corrigeable. Un test le pin.

Le champ de saisie garde un `placeholder` (« Ex. Contrat SB Auto 2026 ») : un
indice n'est pas un pré-remplissage — le champ est bien vide.

---

## 2. Le parcours d'activation devient une suite d'écrans

### Le défaut

Le parcours était un `<Card>` fixe : tracker, montants, puis **un** bloc
`{contract.step === '...' && ...}` contenant un `<p>` et un `<Button>`. Passer de
`SIGNATURE` à `LAUNCH_FEE` remplaçait un div par un autre. Même carte, même mise
en page, seul le libellé du bouton changeait — aucune sensation d'avancer.

### Ce qui change

Chaque étape est un **écran** : illustration, sur-titre (« Étape 2 sur 4 »),
titre, explication, récapitulatif, action.

```
┌──────────────────────────────────────────────┐
│  ●───●───○───○───○───○      (guide, fixe)    │
│                                              │
│  ÉTAPE 2 SUR 4                    ╱▔▔▔╲      │
│  Réglez les frais de lancement   │ ▭▭  │     │
│  Paiement unique, sécurisé…       ╲___╱      │
│  ┌──────────────┐                            │
│  │ Total TTC 540│                            │
│  └──────────────┘                            │
│  [ Payer les frais de lancement ]            │
└──────────────────────────────────────────────┘
```

Le guide reste en haut : c'est le **repère fixe**. Ce qui change, c'est la scène.

`AnimatePresence mode="wait"` : les deux écrans ne se croisent jamais — un fondu
enchaîné ferait clignoter deux CTA différents au même endroit.

### Trois écrans qui n'existaient pas

Le code disait « bouton désactivé » sans jamais expliquer pourquoi :

| Situation | Avant | Maintenant |
| --- | --- | --- |
| DEV pas encore signé | bouton grisé | « En attente de l'équipe technique » — l'ordre est imposé par Yousign, le client n'a rien à faire |
| Paiement `PROCESSING` | aucun bouton, une phrase | écran dédié, **aucune action** : proposer un second paiement pendant que la banque confirme, c'est encaisser deux fois |
| Contrat en préparation | encart bleu | écran « Votre contrat est en préparation » |

### Illustrations

SVG **inline**, teintées au thème (`--m-primary`), zéro requête. Chaque scène
n'anime qu'**une** chose (le paraphe qui se trace, la carte qui glisse, la fusée
qui pulse) — animer la scène entière en ferait un dessin animé, pas un repère.

`prefers-reduced-motion` : la scène reste dans son **état final**, complète et
lisible.

### Responsive

`JourneyStage` passe l'illustration **au-dessus** du texte sur mobile
(`order-1`), plafonnée à `15rem` : une illustration plein cadre repousserait le
CTA sous la ligne de flottaison, exactement ce que le cahier des charges
interdit.

---

## 3. La vue DEV après validation

Le DEV voyait un tableau de bord technique : Document, Zones, Tarification,
« Actions », Yousign, Stripe, Timeline. Or **une fois le contrat validé, il n'a
plus qu'une chose à faire : signer** — puis plus rien.

Il voit maintenant le **même parcours que le client** (même
`ContractProgressTracker`, même calcul : deux rôles, une seule vérité) :

| État | Écran |
| --- | --- |
| Son tour | un seul **gros CTA « Signer »** |
| Signature lancée | « Signature en cours », page auto-rafraîchie |
| **Signé** | le CTA **disparaît** → « Vous avez signé le contrat. Le client poursuit maintenant son activation… » + illustration + avancement du client en clair |
| Actif | « Le site du client est en ligne » |

**Jamais « Signer (DEV) »** : sur le contrat, le DEV n'est pas un rôle technique,
c'est une entreprise qui signe.

Le DEV ne voit aucun CTA Stripe — c'était **déjà le cas** avant ce lot, contrairement
à ce que laissait entendre l'énoncé. L'état Stripe reste consultable en lecture
seule.

### « Voir les détails »

Tout le technique y descend, replié : document, zones, tarification, Yousign,
Stripe, **et les actions de cycle de vie** (Résilier, Archiver, Relancer la
signature).

Ces trois-là n'existent **nulle part ailleurs** : les supprimer comme le
demandait la lettre de l'énoncé les aurait rendues inatteignables. Elles sont
donc conservées, mais hors du parcours — décision validée en amont.

`CollapsibleCard` est **extrait** de `TechnicalTools` plutôt que dupliqué.

---

## 4. Viewer multipage

Le document se lisait comme un rouleau : toutes les pages empilées dans un cadre
à défilement interne, plus un `IntersectionObserver` pour **deviner** laquelle on
regardait.

Une seule page est affichée à la fois, et c'est **elle** qui décide de tout :
zones rendues, page d'une nouvelle zone, coordonnées. Le devinage disparaît avec
l'observateur — moins de code, et plus de doute possible.

```
◀  Page 2 / 5  ▶     [1][2•][3][4][5•]
```

- **clic**, **flèches ←/→**, **balayage mobile** — aucune de ces trois façons ne
  convient partout ;
- les pastilles marquent d'un point les pages **qui portent des zones** : on
  repère le travail sans visiter. Au-delà de 12 pages, seul le compteur reste ;
- les zones des autres pages **ne sont pas masquées, elles ne sont pas rendues**
  — et reviennent intactes ;
- les duplications restent sur leur page (`duplicateZone` la conservait déjà) ;
- la liste latérale devient le **chemin** vers les autres pages : cliquer une
  zone y navigue, sinon on sélectionnerait un invisible.

### Les pièges du geste

- **Balayage ignoré** s'il démarre sur une zone, ou s'il n'est pas franchement
  horizontal (`|dx| > 60px` et `|dx| > 1.5·|dy|`) — sinon un simple défilement du
  document ferait sauter de page.
- **Zones en `touch-none`** : la frame est en `touch-pan-y` pour laisser le
  défilement vertical au navigateur. Sans cette exception, le navigateur aurait
  avalé le geste vertical et une zone n'aurait plus pu être déplacée qu'en
  largeur au doigt.
- **Flèches neutralisées** pendant un glisser et quand la frappe vise un champ.

---

## 5. Le dock collé au bas de la frame

Les boutons flottaient en permanence. Ils sont maintenant **dockés au bas de la
frame** :

```
   frame plus haute que l'écran        fin de la frame atteinte
   ┌───────────────┐                   ┌───────────────┐
   │  page PDF     │                   │  page PDF     │
   │               │                   │               │
   │               │                   │  ⊕  💾 Enreg. │ ← posé, il défile
   │  ⊕  💾 Enreg. │ ← collé en bas    └───────────────┘
   └───────────────┘    de l'écran        (suite de la page)
```

C'est `position: sticky; bottom: 1rem` — **sans un seul écouteur de
défilement**, donc sans saccade ni recalcul : le navigateur s'en charge. Le
comportement de Drive / Notion / Linear.

Le dock est le **dernier enfant** de la frame : sa position naturelle est ce
point d'arrêt. `w-fit ml-auto` : il n'occupe que sa propre boîte et ne vole aucun
clic au document.

La barre latérale devient `sticky` elle aussi : la frame fait désormais toute la
hauteur du document, et la liste des zones est le seul chemin vers les autres
pages — elle ne doit pas défiler hors de vue.

---

## 6. Retour automatique

### Stripe

Les pages de retour vérifiaient déjà auprès du backend (un paramètre d'URL ne
prouve rien — `session_id` ne vaut pas paiement), puis demandaient de **cliquer**
« Revenir à mon contrat ». Le clic n'apprenait rien à personne.

Elles rendent maintenant la main d'elles-mêmes :

```
Stripe → /contrat/retour-paiement → vérification serveur (polling, borné)
       → « Frais de lancement payés » → navigate('/contrat', {celebrate})
       → ✓ animation → écran suivant
```

Le bouton de repli **reste** sur les issues non conclues (échec, interruption,
confirmation trop lente) : là, l'utilisateur doit garder la main.

### Signature

`/contrat/retour-signature` **n'était atteignable par personne** : aucune URL de
retour n'était posée chez Yousign. La route et son composant existaient, mais
rien n'y menait.

`redirect_urls` est un champ **documenté du signataire** (Yousign API v3,
`success` / `error` / `decline`), ce qui permet de renvoyer **chaque partie chez
elle** :

| Partie | Retour |
| --- | --- |
| DEV | `/dev/contrats` — sa liste |
| Client | `/contrat/retour-signature?status=…` — son parcours |

**Facultatif par construction** : sans URL de manager configurée
(`SystemConfiguration.network.managerUrl`), le champ est **omis** et le
comportement reste celui d'avant. Une URL bancale (`https:///contrat/…`) ferait
échouer la création de la demande — donc **la signature entière** — pour un
simple confort de navigation. Ce compromis est délibéré : le projet a déjà été
brûlé par un champ Yousign erroné (`nature: 'signable'` → 400 bloquant, cf.
[YOUSIGN_REAL_SANDBOX_FIX_REPORT.md](YOUSIGN_REAL_SANDBOX_FIX_REPORT.md)).

La signature DEV navigue désormais **dans le même onglet** : ouverte dans un
onglet séparé, le retour Yousign atterrirait dans un onglet orphelin pendant que
l'onglet d'origine continuerait d'afficher « à signer ».

> ⚠️ **Confronté à l'API réelle depuis — et refusé.** L'avertissement ci-dessous
> était justifié : l'abonnement **Trial** rejette `redirect_urls` (« The redirect
> urls cannot be defined when the subscription is in trial. ») et faisait échouer
> la création entière de la demande. Le champ lui-même était bon (conforme à la
> documentation) ; c'est le PLAN qui l'interdit.
>
> Corrigé sans réglage ni bascule : ce refus précis déclenche une reprise sans
> redirections, et le contrat passe. Voir
> [YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](./YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).
> Le repli par `managerUrl` reste, mais n'est plus la porte de sortie.

### Plus aucun rafraîchissement manuel

`/contrat` **sonde** tant qu'une confirmation est attendue (le webhook arrive
quand il arrive), **uniquement si l'onglet est visible** — un onglet en
arrière-plan n'a rien à afficher, autant ne pas marteler l'API — et rafraîchit
**immédiatement au retour sur l'onglet**, cas typique du retour de signature.

**Le piège du rechargement** (signalé à l'usage) : sonder avec `reload()`
rallume `loading`, et les deux pages retombent sur `<BrandLoader/>` dès qu'il
est vrai. La page **clignotait donc toutes les 5 secondes** — position de
défilement perdue, navigation coupée, et côté DEV la modale de zones qui
disparaît. D'où `useResource().refresh()` : même requête, mais sans toucher
`loading` ni les toasts. Les données précédentes restent à l'écran et sont
remplacées d'un coup, sans état intermédiaire. Un sondage qui échoue ne dit
rien : le suivant réessaiera — alerter toutes les 5 s serait pire que se taire.

La règle : **`reload()` pour un chargement voulu par l'utilisateur, `refresh()`
partout où l'écran a déjà de quoi s'afficher** (sondage, après-action).

**Le piège de l'arrêt** (relevé en relecture) : se fier à l'étape seule fait
sonder à vie. `deriveActivationStep` ne rend `DONE` que si le statut vaut
exactement `ACTIVE` — un contrat **résilié** (`CANCEL_AT_PERIOD_END`) rend donc
`ACTIVATION`, et aurait été sondé toutes les 5 s pendant des jours, jusqu'à
l'échéance. Idem pour `FAILED`, qui attend une action humaine et non une
notification. La décision vit donc dans `shouldPoll(status, step)` — pur, testé,
partagé par les deux pages.

La page DEV sonde de même : après validation, le DEV **observe** le client
avancer.

---

## 7. « Étape validée »

Le franchissement vit dans `lib/journey.ts` (module pur, 26 tests).

```ts
export function completedStep(prev, next) { … }   // -> l'étape terminée, ou null
```

**Trois refus explicites, tous testés** :

| Cas | Pourquoi |
| --- | --- |
| `prev === null` | Ouvrir la page ne franchit rien. Sinon toute visite de « Mon contrat » fêterait une étape déjà passée. |
| recul (`SUBSCRIPTION` → `SIGNATURE`) | Un webhook tardif ou une signature invalidée fait reculer l'étape. On ne fête pas une régression. |
| étape inconnue | On ne fête que ce qu'on sait nommer. |

Un saut d'étape (frais non requis : `SIGNATURE` → `SUBSCRIPTION`) fête bien
l'étape quittée.

### Le relais Stripe/Yousign

Le trajet vers Stripe est un **rechargement complet** de l'application : l'étape
précédente est perdue, `prev` vaut `null`, et rien ne serait fêté. La page de
retour, elle, **sait** ce qui vient d'aboutir : elle passe l'étape via l'état de
navigation (`navigate('/contrat', { state: { celebrate } })`), et
`useJourneyCelebration` la reprend comme graine.

Sans ce relais, le retour de paiement afficherait l'écran suivant sans jamais
confirmer que le paiement est passé.

---

## 8. Vérification

### Les deux parcours ont été VUS, pas déduits

Chrome piloté par CDP (Node 22 a un WebSocket natif : aucune dépendance ajoutée
au projet), contre le backend et le manager réellement en cours d'exécution.

**Client** (`/contrat`, 906 caractères rendus, **0 erreur console**) :

```
Préparation terminée · Signature L.Y Solution terminée · Signature SB Auto 06 en cours · …
ÉTAPE 1 SUR 4
Signez votre contrat
Le contrat est prêt et déjà signé par l'équipe technique…
Frais de lancement  Montant HT 450 €  TVA (20%) 90 €  Total TTC 540 €
Abonnement mensuel  Montant HT 75 €   TVA (20%) 15 €  Total TTC 90 € / mois
[Voir et signer]
```

**DEV** (`/dev/contrats`, contrat signé par le DEV, **0 erreur console**) :

```
EN ATTENTE DU CLIENT
Vous avez signé le contrat
Le client poursuit maintenant son activation : sa signature, puis les
règlements, puis la mise en ligne. Vous n'avez plus rien à faire…
  Signature du client   En attente
  Frais de lancement    En attente
  Abonnement            En attente
  Mise en ligne du site En attente
Cette page se met à jour toute seule.
▸ Voir les détails          ▸ Recette (TEST)     ▸ Diagnostic et synchronisation
```

Aucun CTA, aucun bouton Stripe, technique replié : conforme au §2 de l'énoncé.

### Résultats

| Suite | Résultat |
| --- | --- |
| Backend `npm test` | **778 assertions, 0 échec** (+20) |
| Manager `npm test` | **308 assertions, 0 échec** (+38) |
| Manager `tsc -b` / `build` | propre |

Nouveaux tests : `lib/journey.ts` (38 — franchissement, refus, totalité,
**arrêt du sondage**) ; création de contrat **via le service** (jamais couverte
jusqu'ici) ; payload `addSigner` avec et sans `redirect_urls`.

### Défauts trouvés en relecture, et corrigés

| Défaut | Correction |
| --- | --- |
| Sondage **sans fin** sur `CANCEL_AT_PERIOD_END` / `FAILED` (les deux pages) | `shouldPoll()`, pur et testé |
| Contrat **terminé** affichant « Activez votre abonnement » + son bouton | écran `OverStage` dédié (terminé / annulé / échec) |
| Vue DEV affirmant « pas encore parti à la signature » sur un contrat `FAILED` | écran « La signature a échoué » |
| L'accusé d'étape pouvait **rejouer** au remontage (état de navigation persistant) | l'état est consommé puis retiré de l'historique |
| Le docblock de `startDevSignature` documentait `signatureRedirectUrls` | fonctions réordonnées |

---

## 9. Composants

| Fichier | Rôle |
| --- | --- |
| `manager/src/lib/journey.ts` | franchissement d'étape (pur, testé) |
| `manager/src/hooks/useContractJourney.ts` | accusé animé + sondage |
| `manager/src/components/contracts/journey/JourneyStage.tsx` | l'écran type + `StepCelebration` |
| `manager/src/components/contracts/journey/art.tsx` | illustrations SVG |
| `manager/src/components/contracts/journey/PriceRecap.tsx` | récapitulatif HT/TVA/TTC |
| `manager/src/components/contracts/journey/DevJourney.tsx` | le parcours vu par le DEV |
| `manager/src/components/contracts/PageNav.tsx` | navigation de pages |
| `manager/src/components/contracts/CollapsibleCard.tsx` | section repliable (extraite) |
| `manager/src/components/contracts/DevStripeDetails.tsx` | état Stripe, lecture seule |
| `backend/src/services/yousign/yousign.service.js` | `redirect_urls` par signataire |

---

## 10. Points d'attention

1. **`redirect_urls` est refusé par un abonnement Yousign en Trial** — constaté
   depuis, et traité : reprise automatique sans redirections, sans réglage.
   Voir [YOUSIGN_TRIAL_REDIRECT_FALLBACK.md](./YOUSIGN_TRIAL_REDIRECT_FALLBACK.md).
2. **Le repli est le contrat** : `signatureRedirectUrls()` renvoie `null` sans
   URL de manager. Ne jamais construire une URL partielle ici — la création de la
   demande de signature en dépend.
3. **`completedStep` ne fête jamais un premier rendu.** Toute page qui affiche le
   parcours doit passer par `useJourneyCelebration`, pas réimplémenter la détection.
4. **Le sondage s'arrête via `shouldPoll(status, step)`, jamais sur l'étape
   seule.** `deriveActivationStep` ne rend `DONE` qu'en statut `ACTIVE` : un
   contrat résilié rend `ACTIVATION` et serait sondé à vie. Ce bug de
   consommation est invisible à l'écran — d'où le module pur et ses tests.
5. **Un sondage utilise `refresh()`, JAMAIS `reload()`.** `reload` rallume
   `loading`, donc l'écran de chargement : la page clignote et perd sa place.
   Même règle pour tout rafraîchissement d'après-action, où l'écran a déjà de
   quoi s'afficher.
5. **Le nom du contrat n'est obligatoire QUE côté front** (étape `NAME`). C'était
   déjà vrai avant ; l'API accepte toujours un contrat sans nom.
