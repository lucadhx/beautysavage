# Éditeur de templates e-mail (Manager DEV)

Interface d'édition des templates. Route `/dev/templates-email`, **DEV uniquement**.

Composant : [`DevEmailTemplatesPage.tsx`](../manager/src/pages/dev/DevEmailTemplatesPage.tsx) ·
Guide : [`EmailTemplateGuide.tsx`](../manager/src/components/dev/EmailTemplateGuide.tsx) ·
Logique pure : [`emailTemplates.ts`](../manager/src/lib/emailTemplates.ts)

---

## ⚠️ Règle de développement — l'onglet Guide fait partie du contrat

> **Toute modification du système d'édition de templates e-mail DOIT maintenir
> l'onglet Guide à jour, dans le MÊME lot.**

Cela couvre : une variable ajoutée ou retirée, une balise nouvellement interdite,
un changement de comportement des versions, une règle de sécurité, un statut de
livraison, une formulation imposée.

**Pourquoi c'est une règle et pas une bonne intention.** Le Guide n'est pas de la
documentation « en plus » : c'est la **seule** que lira le DEV qui édite un
template à 23 h. Un guide périmé est **pire que pas de guide** — il fait perdre du
temps *et* donne une fausse assurance.

Cette règle est rappelée en tête de `EmailTemplateGuide.tsx` et dans
[ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Ce que l'interface ne fait pas

| Absent | Pourquoi |
|---|---|
| Bouton **« Créer un template »** | Les identifiants viennent du code. En créer un ici produirait un template que personne n'appelle. |
| Bouton **« Supprimer »** | Supprimerait un template qu'une action attend. |
| Champ **destinataire** | Un template ne porte jamais d'adresse ([EMAIL_TEMPLATES.md §4](EMAIL_TEMPLATES.md)). |
| Éditeur **par blocs** | §2 |
| Bouton **« Générer l'aperçu »** | L'aperçu est live (§3). |

L'identifiant technique est affiché **en lecture seule**, en monospace.

---

## 2. Un éditeur HTML complet, pas un constructeur par blocs

Le DEV édite **le document HTML entier**, dans un `<textarea>` monospace.

**Pourquoi pas de blocs (titre / paragraphe / bouton).** Un e-mail doit
fonctionner dans Outlook comme dans Gmail, ce qui impose des `<table>`, des styles
inline et des `@media`. Un éditeur par blocs cacherait ces contraintes derrière
une abstraction qui **finirait toujours par manquer le cas voulu** — et il
faudrait alors une trappe « HTML libre », donc **les deux à maintenir**. On
assume : le DEV écrit le document.

---

## 3. Les cinq onglets

### Éditeur

Sujet, contenu HTML, nom, description, actif/inactif, et le panneau de validation
en direct.

### Aperçu — live, isolé, fictif

**Live** : débattu à **400 ms**, sans aucun bouton. Un drapeau `cancelled`
empêche la réponse d'une frappe ancienne d'écraser l'aperçu d'une frappe récente —
sans lui, l'aperçu « reviendrait en arrière » de façon aléatoire.

Un brouillon invalide **n'échoue pas** : la route renvoie `200` avec
`validation.valid: false` et `html: null`. Un `400` ferait clignoter l'éditeur en
rouge à chaque frappe intermédiaire.

**Fictif** : les valeurs viennent des `sampleVariables` du registre — « Jean Dupont
(exemple) », « exemple.fr ». **Aucune donnée client réelle n'est lue** : un aperçu
ne doit pas devenir un moyen d'extraire le contenu d'un dossier.

**Isolé** :

```tsx
<iframe srcDoc={html} sandbox="" referrerPolicy="no-referrer" />
```

`sandbox=""` — **tout est refusé** :

| Non accordé | Conséquence si on l'accordait |
|---|---|
| `allow-scripts` | le point entier de la barrière |
| `allow-same-origin` | le contenu lirait le `localStorage` du Manager, **donc le jeton d'authentification** |
| `allow-popups`, `allow-top-navigation` | détournement de navigation |

`srcDoc` plutôt que `dangerouslySetInnerHTML` : le contenu **n'entre jamais dans le
DOM principal**.

> **Cette barrière n'est PAS redondante avec le backend.** Le validator analyse au
> **motif**, pas avec un parseur HTML complet (voir
> [EMAIL_RENDERING_SECURITY.md §4](EMAIL_RENDERING_SECURITY.md)). Si un
> contournement lui échappait un jour, le HTML atterrirait ici — et c'est `sandbox`
> qui déciderait alors s'il s'exécute. Deux barrières indépendantes, deux
> mécanismes différents.

**Largeurs** : bureau **600 px** (largeur canonique d'un e-mail ; au-delà, Outlook
coupe), mobile **375 px** (iPhone SE — la plus contraignante encore courante).

L'aperçu des **anciennes versions** passe par la même iframe : leur HTML n'est pas
validé au regard du code actuel.

### Variables

Liste issue du **registre**, avec type, caractère obligatoire, et l'état d'usage :
`utilisée` / `non utilisée` / **`absente du contenu`** pour une requise manquante.

**« Insérer »** place `{{cle}}` à la position du curseur, puis restaure cette
position via `requestAnimationFrame` — sans quoi React réécrit la valeur du
textarea et le navigateur remet le curseur en fin de champ : le DEV perdrait sa
place à chaque insertion. Une sélection est remplacée.

### Versions

Historique, aperçu d'une version, restauration.

Une version **irrestaurable** (variable retirée du code depuis) est signalée dans
son aperçu, et sa restauration est refusée par le serveur.

Après restauration, le brouillon est **réinitialisé** : sinon il resterait
« modifié » par rapport à une base qui a changé sous ses pieds.

### Guide

Voir la règle en tête de ce document.

---

## 4. Le Manager ne décide jamais de la sécurité

**Aucune fonction du Manager ne parse du HTML pour juger s'il est dangereux.** La
validation vient du serveur, déjà calculée (`template.validation`, `preview.validation`).

Deux raisons :

1. la même règle appliquée à deux endroits **finit par diverger** ;
2. un contrôle côté client **n'est pas une protection** — il se contourne avec un
   `curl`.

[`emailTemplates.ts`](../manager/src/lib/emailTemplates.ts) **traduit**, il ne juge
pas : il met des libellés lisibles sur des codes stables, calcule l'état
« modifié », et place un curseur.

Un code inconnu affiche le **code brut** plutôt qu'une chaîne vide : mieux vaut
`CODE_DU_FUTUR` que rien.

---

## 5. État de modification et conflits

`isTemplateDirty` compare **champ par champ**, pas par sérialisation : le serveur
renvoie `validation`, `variables`, `updatedAt`… qui changent sans que le DEV ait
touché à quoi que ce soit. Comparer l'objet entier afficherait « modifications non
enregistrées » **en permanence**.

Le `PUT` n'envoie que les champs réellement modifiés, plus `expectedVersion`.

**Conflit de version** → `409`. Les modifications **restent à l'écran** ; le DEV
recharge pour repartir de la dernière version. Le widget flottant repasse en
« Enregistrer » (il s'appuie sur le rejet — voir
[`lib/saveState.ts`](../manager/src/lib/saveState.ts)).

`beforeunload` prévient la perte de travail à la fermeture de l'onglet ; une
`ConfirmDialog` garde le retour à la liste.

---

## 6. Envoi de test

Bouton **« Envoyer un test »** → readiness affichée **avant** le clic (mode Brevo,
expéditeur, avertissements), puis saisie de l'adresse.

Un e-mail **réel** part, par le **même pipeline** que les envois automatiques.

**Affichage du succès — formulation imposée :**

> L'email a été accepté par Brevo pour envoi.

Jamais « délivré ». Voir [EMAIL_DELIVERY.md §2](EMAIL_DELIVERY.md).

- La clé API n'est **jamais** affichée.
- `providerMessageId` est **raccourci** (`shortMessageId`), jamais affiché en entier.
- **Expéditeur non vérifié** → bandeau rouge permanent en tête de l'éditeur : ce
  blocage se répare **ailleurs** (Configuration e-mail), et le DEV doit le savoir
  avant d'avoir saisi une adresse.
- **Domaine non authentifié** → bandeau **ambre**, et l'envoi reste possible.

> **Rouge = bloquant, ambre = avertissement. Jamais l'inverse.** Présenter un
> domaine non authentifié comme une panne pousserait à « réparer » ce qui, pour une
> adresse Gmail, est irréparable par construction.

---

## 7. Tests

[`emailTemplates.test.mjs`](../manager/src/lib/emailTemplates.test.mjs) — **103
assertions**, module pur, runner Node (`npm test` dans `manager/`).

Conformément à la convention du projet, **aucune stack DOM n'a été ajoutée**.

**Couvert** : onglets, état de modification, patch, insertion au curseur (y compris
bornes inversées et curseur périmé), usage des variables, traduction et groupement
des codes, readiness (bloquant vs avertissement), statuts de livraison
(`SENT` ≠ `DELIVERED`, ton neutre), raccourci de `messageId`, largeurs d'aperçu.

**Non couvert automatiquement** (checklist manuelle —
[EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md](EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md)) :
le rendu DOM réel, l'iframe, le comportement du textarea, le responsive, et
l'envoi réel avec une vraie clé.
