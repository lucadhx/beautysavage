# RX-UX-POLISH-MANAGER-02 — rapport

Polish UI/UX du manager : configurateur de signature, pattern d'édition, services,
durées, toggles. **Aucune règle métier modifiée** — un seul champ ajouté
(`duration`), facultatif et sans effet tant qu'il est vide.

---

## 0. Deux constats qui contredisent l'énoncé

Avant d'écrire une ligne, deux hypothèses du cahier des charges se sont révélées
fausses. Elles ont changé le travail.

### « Créer un Toggle partagé. Tous les écrans doivent utiliser le même composant »

**C'était déjà le cas.** `Switch` existait dans `primitives.tsx` et **les 10
points d'appel l'utilisaient** — zéro implémentation dupliquée. Recherche
exhaustive : `type="checkbox"` → 0 occurrence, `peer-checked` → 0,
`appearance-none` → 0.

Le vrai défaut était ailleurs, et le symptôme décrit était juste : l'état OFF
utilisait `bg-muted-foreground/30`, qui se confondait avec le fond des cartes. Le
travail n'a donc pas été de *consolider*, mais de **corriger le contraste**.

### « Retirer les boutons Zone développeur / Zone client »

Aucun bouton ne portait ce libellé. Il existait :

1. un bouton **par page** dont le libellé suivait le rôle actif (« Zone
   Développeur » / « Zone Client ») — manifestement la cible ;
2. un **sélecteur permanent** « Signataire à placer » en barre latérale, qui
   pilotait le libellé du premier.

Les deux ont été retirés (décision validée en amont) : le rôle se choisit
désormais dans une popover, **au moment de créer la zone**.

---

## 1. Le pattern d'édition — `FloatingSaveWidget`

### Pourquoi aucune page ne savait dire « modifié »

Le manager n'utilise **pas** react-hook-form pour ses pages d'édition (seuls
`LoginPage` et `ProfilePage` l'emploient). Le modèle est partout le même :

```jsx
const { data, setData } = useResource(() => api.getCompany());
const update = (patch) => setData({ ...data, ...patch });   // `data` EST le brouillon
```

La ressource chargée **est** le brouillon. Il n'existe aucune copie de référence,
donc **aucune page ne pouvait calculer un état « modifié »** — ce n'était pas un
oubli, c'était structurel.

`useFloatingSave` tient cette référence.

### Les quatre états

| État     | Affichage         | Aspect                                 |
| -------- | ----------------- | -------------------------------------- |
| `idle`   | ✓ Enregistré      | vert, désactivé                        |
| `dirty`  | Enregistrer       | couleur principale, pulsation discrète |
| `saving` | Enregistrement…   | spinner, désactivé                     |
| `saved`  | ✓ Enregistré      | vert + animation de validation         |

`idle` et `saved` affichent la même chose : le repos et le succès sont le **même
fait** (« ton travail est en sécurité »), pas deux informations distinctes. Seule
l'animation les sépare.

### L'invariant, et pourquoi il est testé

Un seul mensonge est possible ici : **afficher « ✓ Enregistré » sur un formulaire
modifié**. D'où la règle de priorité, dans `lib/saveState.ts` (module pur, testé
sous Node comme `signatureZones.ts`) :

```ts
if (phase === 'saving') return 'saving';
if (dirty) return 'dirty';              // ← `dirty` PRIME sur `saved`
if (phase === 'saved') return 'saved';
return 'idle';
```

Les 6 combinaisons (3 phases × modifié/propre) sont vérifiées exhaustivement :
aucune n'affiche « enregistré » quand c'est modifié. Concrètement, éditer pendant
la fenêtre de validation redemande immédiatement l'enregistrement.

### La référence est ce qui est PARTI, pas ce qui est revenu

```ts
const saved = await onSave();
setBaseline(saved ?? value);   // pas l'état de l'écran à l'arrivée de la réponse
```

Si l'utilisateur continue d'éditer **pendant** la requête, ces modifications-là
restent à enregistrer. Se caler sur l'écran au retour les effacerait
silencieusement.

Corollaire à connaître : `onSave` doit renvoyer **ce qu'affiche l'écran après
coup**. Sur `DevManagerThemePage`, qui n'appelle pas `setData(saved)`, la
référence est `data` (ce qu'on a envoyé) — se caler sur la réponse du serveur
bloquerait le widget sur « Enregistrer » à la moindre normalisation côté API.

### `onSave` doit propager ses erreurs

`saveZones` faisait `try { … } catch { /* */ }`. Avalée, l'erreur laissait le
widget afficher un succès **mensonger**. `useAction` émet déjà le toast : le
widget s'appuie sur le **rejet** pour repasser en « Enregistrer ».

### Où il est appliqué

Pages pleine page : **Entreprise, Contacts, Thème du site, Entreprise
développeur, Thème manager**, plus le **configurateur de signature**. Le bouton
d'en-tête disparaît de ces pages — il fallait remonter tout le formulaire pour
l'atteindre.

Les actions qui **n'enregistrent pas** restent en en-tête (« Thème sombre par
défaut », « Réinitialiser ») : elles modifient le brouillon, le widget bascule
alors en « Enregistrer ».

**Les 6 écrans à modale** (Services, Avant/Après, Promotions, FAQ, Avis,
Intégrations) gardent leur pied de modale — décision validée. Un bouton flottant
dans une boîte de dialogue courte ferait doublon avec son pied de page.

### API

```jsx
const { state, save } = useFloatingSave(data, async () => {
  if (!data) return;
  const updated = await run(() => api.updateCompany(data), { success: '…' });
  setData(updated);
  return updated;                       // ← devient la référence
});

<FloatingSaveWidget state={state} onSave={save} />
```

Appelé **avant** le garde-fou de chargement (`if (loading) return <BrandLoader/>`) :
un hook ne peut pas être conditionnel. D'où l'acceptation de `null`.

Ctrl/⌘+S enregistre. Le widget est `fixed bottom-4 right-4` (`md:bottom-6`), en
`z-20` — **sous** le tiroir mobile (z-40) et les modales (z-50) : un bouton
d'enregistrement ne doit jamais passer par-dessus une boîte de dialogue.

---

## 2. Le configurateur de signature

### Le FAB

`Ajouter` et `Enregistrer` quittent la barre latérale et flottent au-dessus du
document.

```
┌──────────────────────────────┐
│  PDF (défile)                │
│                              │
│              ┌────────────┐  │
│              │ 👤 Zone Client      │   ← popover
│              │ 💼 Zone Développeur │
│              └────────────┘  │
│                  ⊕  💾 Enregistrer  │  ← ancrés, ne défilent pas
└──────────────────────────────┘
```

**Le point technique** : le viewer est le conteneur défilant. Un FAB placé dedans
défilerait avec le document. Il est donc ancré à une **enveloppe non défilante**
ajoutée autour :

```jsx
<div className="relative">                       {/* ancre — ne défile pas */}
  <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">…</div>
  <FloatingSaveWidget anchor="absolute" … />     {/* absolute bottom-4 right-4 */}
</div>
```

### Le rôle se choisit à la création

Plus de mode « signataire actif » persistant : un état invisible depuis le
document produisait des zones du mauvais rôle **sans prévenir**. Le rôle reste
modifiable après coup sur la zone (`ZoneActionBar`, inchangée).

### La zone naît là où on regarde

`createZone` place la zone en haut à gauche de la page. Avec un FAB unique
flottant au-dessus d'un document défilé, elle serait née **hors du champ de
vision** — et le clic aurait semblé sans effet.

Un `IntersectionObserver` suit la page la plus visible ; la zone est créée au
**centre de la bande réellement à l'écran** de cette page. À ratio égal, c'est le
**plus petit numéro de page** qui l'emporte — sinon le choix vacillerait à
mi-défilement entre deux pages également visibles.

### L'éditeur reste ouvert après enregistrement

C'est l'intérêt d'un bouton toujours visible : on enregistre et on continue. Le
`saveZones` d'avant fermait la modale, ce qui rendait l'état « ✓ Enregistré »
invisible.

Effet de bord bénéfique : le widget ne dépend plus du `pending` de la page, qui
était **partagé par toutes ses actions** (le bouton s'animait pendant des appels
sans rapport).

`zonesEqual` est passé comme comparateur à `useFloatingSave` : l'ordre du tableau
de zones n'est pas signifiant, la comparaison par sérialisation ne convient pas.

---

## 3. Les durées

### Modèle

`duration`, en **minutes** (entier), **facultative**.

```js
// backend/src/models/Service.model.js — packSchema ET pricedItemSchema
duration: { type: Number, default: null, min: 0 },
```

`default: null`, et non `0` comme tous les autres champs numériques du schéma :
c'est précisément ce qui fait exister « non renseignée ». `null` / `undefined` /
`0` ne s'affichent **jamais** — ni manager, ni vitrine. Les documents créés avant
l'ajout du champ n'ont pas la clé du tout : ils sont silencieux par défaut, aucune
migration n'est nécessaire.

### Mongoose est la seule validation

Le validateur Zod est `.passthrough()` (il ne vérifie que `title`) et le
contrôleur n'a **pas de liste blanche** : il fait un remplacement complet du
document. Ajouter le champ au schéma Mongoose suffit à le faire accepter et
persister — mais cela veut aussi dire qu'**aucune autre couche ne le protège**.
D'où les assertions de bout en bout (§5).

### Rendu

`lib/duration.ts` (module pur, 50 tests) :

| Minutes | Rendu    | Pourquoi                                       |
| ------- | -------- | ---------------------------------------------- |
| `null`  | `''`     | rien ne s'affiche                              |
| `0`     | `''`     | jamais « 0 min »                               |
| 45      | `45 min` |                                                |
| 60      | `1h`     | pas « 1h00 »                                   |
| 65      | `1h05`   | complété : « 1h5 » se lirait cinquante minutes |
| 150     | `2h30`   |                                                |

`formatDuration` est **dupliqué** dans `vitrine/src/lib/utils.ts`, exactement
comme `formatPrice` : les deux applications ne partagent pas de paquet. Toute
modification doit toucher les deux.

### Saisie — `DurationField`

Deux champs bornés heures + minutes, icône ⏱, aperçu du rendu, effacement.
« 2h30 » est la façon dont on pense une prestation ; « 150 » ne l'est pas.

Deux détails qui comptent :

- **`?? ''` et non `|| ''`** pour la valeur du champ : `0` doit rester saisissable
  (c'est ce qui permet d'écrire « 2h00 »).
- Le champ vit **hors** du garde `mode === 'FIXED'` : une durée reste pertinente
  « sur devis ».
- `0h 0min` → `null`. Remettre tout à zéro, c'est vouloir retirer la durée.

### Portée

Packs et **prestations complémentaires**, conformément au besoin. `PricedItem`
étant un type **commun aux prestations complémentaires et aux suppléments**, ces
derniers portent le champ mais **pas l'UI** (prop `withDuration`) : ils
s'affichent en pastilles compactes sur la vitrine, une durée y encombrerait.
L'activer pour eux se réduit à passer la prop.

### Vitrine

```
Pack Premium                          Traitement cuir
Avec durée                            ⏱ 45 min
dès 89 €        ⏱ 2h30                            À partir de 30 €
```

Sur les packs : à côté du prix (la carte est à hauteur fixe avec défilement
interne, une ligne de plus déséquilibrerait). Sur les prestations
complémentaires : sous le nom — la ligne est déjà étroite sur mobile, et la durée
qualifie la prestation.

---

## 4. Toggle, sections, animations

### Toggle

L'état OFF utilise des tokens **dédiés et indépendants du thème** :

```css
--m-toggle-off: #d4d4d8;
--m-toggle-off-hover: #a1a1aa;
--m-toggle-off-border: #9ca3af;
```

Volontairement **pas** dérivés de `--m-muted` : le thème du manager est éditable
par le DEV, et une palette claire rendait l'interrupteur invisible. Un toggle
éteint doit rester lisible **quelle que soit la palette**. S'ajoutent une bordure
permanente, un focus clavier visible (ring + offset) et un hover distinct sur les
deux états.

Le composant accepte désormais `id` / `label` / `describedBy` (les appelants ne
pouvaient associer aucun libellé accessible) et une variante `sm`.

### Deux primitives nées de la passe Services

- **`FieldGroup`** — icône + titre + sous-titre. L'action de section vit dans
  `aside`, donc dans le **titre** : l'interrupteur du badge disparaissait avec le
  contenu qu'il pilote.
- **`SegmentedControl`** — « Prix fixe / Sur devis » et « À partir de / Sur
  devis » étaient deux implémentations distinctes, aux états divergents. C'est
  maintenant un vrai `radiogroup` : l'option retenue est annoncée, les flèches
  naviguent.

### Animations

`m-pulse` (respiration de l'ombre — jamais de la géométrie : un bouton qui change
de taille est une cible mouvante), `m-pop` (validation), `m-rise` (entrée des
flottants).

**`prefers-reduced-motion` était un trou** : seuls 3 composants framer-motion
honoraient `useReducedMotion()` ; **toutes** les transitions CSS l'ignoraient, et
`index.css` n'avait aucune media query. Un garde-fou global les couvre désormais.
Les états restent tous atteints — un toggle ON reste coloré, le ✓ reste affiché —
mais l'interpolation est supprimée : on saute à l'état final au lieu d'y glisser.

---

## 5. Vérification

### Le rendu vitrine a été vu, pas déduit

Chrome headless, page réellement rendue (JS exécuté) sur un service jetable créé
via l'API puis supprimé :

```
Pack Premium     Avec durée   Ligne A   dès 89 €   2h30      ← durée affichée
Pack Sans Duree  Sans durée   Ligne B   dès 40 €             ← rien : facultatif
Traitement cuir  45 min   À partir de 30 €                   ← durée affichée
Sans duree       À partir de 10 €                            ← rien : facultatif
```

C'est exactement la spécification, y compris le silence quand la durée est
absente.

### Assertions permanentes

`smoke-test.js` (+6) couvre la chaîne complète, parce que Mongoose est la seule
validation :

```
✓ pack duration stored
✓ pack without duration -> null (not 0)
✓ complementary service duration stored
✓ supplement without duration -> null
✓ public exposes pack duration                    ← /api/public/bootstrap
✓ public exposes complementary service duration     que lit réellement la vitrine
```

### Résultats

| Suite                 | Résultat                        |
| --------------------- | ------------------------------- |
| Backend `npm test`    | **108 passed, 0 failed** (+6)   |
| Manager `npm test`    | **50 passed, 0 failed** (+35)   |
| Manager `tsc -b`      | clean                           |
| Manager `npm run build` | clean                         |
| Vitrine `tsc -b`      | clean                           |
| Vitrine `npm run build` | clean                         |

Nouveaux modules purs testés : `lib/saveState.ts` (machine à états, invariant
exhaustif), `lib/duration.ts` (rendu, découpage, aller-retour, saisie).

---

## 6. Composants

| Fichier                                     | Rôle                                   |
| ------------------------------------------- | -------------------------------------- |
| `manager/src/lib/saveState.ts`              | machine à états (pur, testé)           |
| `manager/src/lib/duration.ts`               | durées (pur, testé)                    |
| `manager/src/hooks/useFloatingSave.ts`      | référence + cycle d'enregistrement     |
| `manager/src/components/ui/FloatingSaveWidget.tsx` | widget, `FloatingDock`, `Fab`   |
| `manager/src/components/fields/DurationField.tsx`  | saisie h + min                  |
| `manager/src/components/ui/primitives.tsx`  | `Switch` corrigé, `FieldGroup`, `SegmentedControl` |
| `manager/src/index.css`                     | tokens toggle, keyframes, reduced-motion |
| `vitrine/src/lib/utils.ts`                  | `formatDuration` / `hasDuration` (dupliqués) |

---

## 7. Points d'attention

1. **`onSave` doit propager ses erreurs.** Un `catch` silencieux = succès
   mensonger.
2. **`onSave` renvoie ce qu'affiche l'écran**, pas systématiquement la réponse du
   serveur. Cf. `DevManagerThemePage`.
3. **`formatDuration` est dupliqué** manager/vitrine. Modifier les deux.
4. **Mongoose est la seule validation** des services (Zod `.passthrough()`, pas de
   liste blanche au contrôleur). Tout nouveau champ imbriqué s'ajoute là — et se
   teste dans `smoke-test.js`.
5. **Les suppléments portent `duration` sans UI.** Volontaire ; `withDuration`
   suffit à l'activer.
