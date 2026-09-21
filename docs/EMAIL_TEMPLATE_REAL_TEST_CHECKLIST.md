# Checklist de vérification manuelle — templates e-mail

> **⚠️ RAPPORT HISTORIQUE — NE PAS SUIVRE COMME PROCÉDURE.**
> Ce document décrit un état du système à la date de sa rédaction. Plusieurs
> architectures qu'il mentionne ont été supprimées depuis — notamment la page
> IntegratedAPI du Manager, les credentials Brevo locaux et le webhook Brevo
> local. Autorités actuelles : [ARCHITECTURE.md](ARCHITECTURE.md) ·
> [PROTOCOL.md](PROTOCOL.md) · [INTEGRATED_API.md](INTEGRATED_API.md) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md).


Ce que les tests automatiques **ne peuvent pas** prouver. À exécuter localement,
avec une vraie clé Brevo pour la partie envoi.

Voir aussi : [EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md)
(expéditeur, domaine).

---

## Ce qui est DÉJÀ prouvé automatiquement

**Ne pas re-tester ceci à la main** — c'est couvert, et en régression permanente.

| Domaine | Couverture | Où |
|---|---|---|
| Registre (IDs, variables, types, données d'exemple, cohérence) | 221 assertions | `npm run test:email-templates` |
| Rendu (échappement, types, dates, monnaie, passe unique) | idem | idem |
| Sécurité (XSS, prototype, `javascript:` obfusqué, balises, absence d'`eval`) | idem | idem |
| Bootstrap (idempotence, non-destruction, concurrence, orphelins) | idem | idem |
| Versions (incrément, historique, restauration, conflit) | idem | idem |
| Readiness (tous les blocages, domaine = avertissement) | 206 assertions | `npm run test:email-delivery` |
| Provider (endpoint, payload, classification retryable) | idem | idem |
| Livraison (journal, minimisation, idempotence, crash) | idem | idem |
| Handler `SEND_EMAIL` (succès, skip, dead letter, retry) | idem | idem |
| Permissions (DEV 200 / ADMIN 403 / anonyme 401) | idem | idem |
| Logique Manager (onglets, dirty, curseur, libellés) | 103 assertions | `manager/ npm test` |

> **Le fournisseur est SIMULÉ dans tous ces tests. Aucun e-mail réel n'y est
> envoyé.**

---

## À vérifier à la main

### 1. Prérequis

- [ ] Backend démarré, Mongo accessible.
- [ ] Au démarrage, les logs indiquent `Module e-mail prêt — 4 template(s) créé(s)`
      (au premier lancement) puis `0 template(s) créé(s)` ensuite.
- [ ] Manager démarré, connecté en **DEV**.

### 2. Liste

- [ ] `/dev/templates-email` affiche **4 templates**.
- [ ] Chaque ligne montre : nom, description, **ID technique en lecture seule**,
      nombre de variables, version, date.
- [ ] **Aucun bouton « Créer un template »**.
- [ ] Tous marqués valides (aucun badge d'erreur).
- [ ] En **ADMIN**, l'entrée de menu est absente et `/dev/templates-email` est refusée.

### 3. Édition HTML

- [ ] Les 5 onglets sont présents : Éditeur, Aperçu, Variables, Versions, Guide.
- [ ] Le contenu HTML est éditable **en entier** dans un champ monospace.
- [ ] Le sujet, le nom, la description et l'état actif sont éditables.
- [ ] Taper du texte marque « Enregistrer » (widget flottant, pulsation).
- [ ] **Ctrl/⌘ + S** enregistre.
- [ ] Après enregistrement : « ✓ Enregistré » (vert) et la version s'incrémente.

### 4. Aperçu live

- [ ] L'aperçu se met à jour **tout seul** pendant la saisie (~0,4 s).
- [ ] **Aucun bouton « Générer l'aperçu » n'existe.**
- [ ] Taper vite ne fait pas « revenir en arrière » l'aperçu.
- [ ] Le sujet rendu s'affiche au-dessus.
- [ ] Les données affichées sont **fictives** (« Jean Dupont (exemple) »,
      « exemple.fr »).
- [ ] Bascule **Bureau (600 px) / Mobile (375 px)** : la largeur change réellement.
- [ ] Sur le template de test, l'aperçu montre le **vrai** expéditeur et le **vrai**
      mode Brevo (c'est voulu — voir EMAIL_TEMPLATES.md §3).

### 5. Isolation de l'aperçu

- [ ] Inspecter l'aperçu : c'est bien une `<iframe sandbox="" srcdoc="…">`.
- [ ] `sandbox` est **vide** (ni `allow-scripts`, ni `allow-same-origin`).
- [ ] Le HTML de l'e-mail **n'apparaît pas** dans le DOM principal.

### 6. Insertion de variable

- [ ] Onglet Variables : la liste correspond aux variables du template.
- [ ] Type et « obligatoire » sont visibles.
- [ ] Une variable requise absente du contenu est marquée **« absente du contenu »**.
- [ ] Placer le curseur au milieu du HTML → « Insérer » → la variable arrive **à cet
      endroit précis**, pas à la fin.
- [ ] Le curseur reste **après** le jeton inséré : on peut enchaîner deux insertions
      sans re-cliquer.
- [ ] Sélectionner du texte → « Insérer » → la sélection est **remplacée**.

### 7. Validation

- [ ] Coller `<script>alert(1)</script>` → erreur **« Balise interdite »** avec le
      **numéro de ligne**.
- [ ] L'aperçu affiche « Aucun aperçu » plutôt que de clignoter en rouge.
- [ ] Tenter d'enregistrer → **refusé**, et **les modifications restent à l'écran**.
- [ ] Écrire `{{variable.inventee}}` → « Variable inconnue ».
- [ ] Écrire `{{a["b"]}}` → « Syntaxe de variable invalide ».
- [ ] Vider le sujet → « Sujet vide ».
- [ ] Retirer une variable obligatoire → « Variable obligatoire absente ».
- [ ] Corriger → l'erreur disparaît **sans recharger**.

### 8. Versions

- [ ] Chaque enregistrement ajoute une ligne dans Versions.
- [ ] L'origine est lisible (Création / Modification / Restauration).
- [ ] « Aperçu » d'une ancienne version l'affiche.
- [ ] « Restaurer » une ancienne version → le contenu revient **et la version
      augmente** (ex. v7 → v8, pas v7 → v3).
- [ ] Les versions intermédiaires **existent toujours**.
- [ ] La ligne de restauration indique « Restauration de vN ».

### 9. Conflit d'édition

- [ ] Ouvrir le **même template dans deux onglets**.
- [ ] Enregistrer dans l'onglet A.
- [ ] Enregistrer dans l'onglet B → **erreur de conflit**, l'écriture n'a pas lieu.
- [ ] Vérifier que le travail de l'onglet A **n'a pas été écrasé**.
- [ ] Les modifications de B **restent à l'écran**.

### 10. Readiness

- [ ] Sans expéditeur vérifié : **bandeau rouge** en tête de l'éditeur.
- [ ] « Envoyer un test » : le bouton d'envoi est **désactivé**.
- [ ] Avec un domaine non authentifié : bandeau **ambre**, et l'envoi **reste
      possible**.
- [ ] Le mode Brevo actif (TEST/PROD) et l'expéditeur sont affichés.

---

## 11. Envoi réel — nécessite une VRAIE clé Brevo

> ⚠️ Consomme un crédit Brevo. Vérifier le **mode actif** avant : un envoi en PROD
> part du compte de production.

### Préparation

- [ ] Clé API Brevo configurée dans Intégrations API, pour le mode voulu.
- [ ] Test de connexion **réussi** (sans quoi : `PROVIDER_NOT_VERIFIED`).
- [ ] Expéditeur **vérifié** pour ce mode (voir
      [EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md)).

### Envoi

- [ ] Template `EMAIL_SENDER_VERIFICATION_TEST` → « Envoyer un test ».
- [ ] Saisir une adresse **que vous relevez réellement**.
- [ ] Message de succès **exactement** :
      « **L'email a été accepté par Brevo pour envoi.** »
- [ ] Il n'est **jamais** écrit « délivré » ni « reçu ».
- [ ] La clé API n'apparaît **nulle part**.

### Réception

- [ ] L'e-mail **arrive** (vérifier aussi les spams).
- [ ] L'expéditeur affiché est bien celui configuré.
- [ ] Le sujet porte le **vrai** mode Brevo.
- [ ] Le corps affiche le **vrai** expéditeur, le **vrai** mode, l'heure réelle.
- [ ] Le rendu est correct dans **Gmail**.
- [ ] Le rendu est correct dans **Outlook** (le plus cassant : tables et styles
      inline).
- [ ] Le rendu est correct sur **mobile**.
- [ ] Si le domaine n'est pas authentifié : Brevo a **réécrit l'expéditeur**
      (`via brevo.com`) — c'est **normal**, pas un bug.

### Journal

- [ ] `GET /api/dev/email-templates/EMAIL_SENDER_VERIFICATION_TEST/deliveries`
      montre la livraison.
- [ ] Statut **`SENT`** — et **pas** `DELIVERED`.
- [ ] `providerMessageId` présent.
- [ ] `recipientEmailMasked` est **masqué** (`j***@exemple.fr`).
- [ ] `subjectSnapshot` contient encore **`{{email.providerMode}}`** (non rendu).
- [ ] **Aucun HTML** dans le document.
- [ ] Le `messageId` se retrouve dans le tableau de bord Brevo.

### Cas d'échec

- [ ] Clé volontairement invalide → message clair, **aucun** `SUCCEEDED`.
- [ ] Adresse destinataire invalide → refus **avant** l'appel Brevo.
- [ ] Template désactivé → « Envoyer un test » refusé.

---

## 12. Ce que ce lot NE fait PAS — à ne pas tester

- ❌ **Aucun e-mail de contact** n'est envoyé (formulaire public : lot ultérieur).
- ❌ **Aucun e-mail de résiliation** n'est envoyé (actions `enabled: false`).
- ❌ **Aucune boîte de réception** des demandes de contact.
- ❌ **Aucun webhook** Brevo : `DELIVERED` / `BOUNCED` n'apparaîtront jamais.

Les trois templates métier sont **éditables et testables** via « Envoyer un test »,
mais **rien ne les déclenche automatiquement**.
