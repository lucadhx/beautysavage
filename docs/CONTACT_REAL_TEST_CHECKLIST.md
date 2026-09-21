# Checklist de vérification manuelle — formulaire de contact

Ce que les tests automatiques **ne peuvent pas** prouver.

Voir aussi : [EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md](EMAIL_TEMPLATE_REAL_TEST_CHECKLIST.md) ·
[EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md).

---

## Prouvé automatiquement — NE PAS re-tester à la main

| Domaine | Couverture |
|---|---|
| Validation (nom, e-mail, téléphone, motif, message, URL, champs inconnus) | `npm run test:contact` — 229 |
| Anti-abus (honeypot, délai, URL, débit global, réponse neutre) | idem |
| Persistance (submissionId, dates, statuts, aucune IP/UA complet) | idem |
| Idempotence (rejeu, **concurrence**, index unique) | idem |
| Événement (payload masqué, message absent, clé sans PII, échec sans rollback) | idem |
| Notification (1 admin, 3 admins, aucun admin, readiness, 429, résolveur) | idem |
| XSS du visiteur échappé, injection de gabarit | idem |
| Manager (liste, filtres, recherche, pagination, transitions, permissions) | idem |
| Formulaire vitrine (validation, payload, idempotence, messages) | `vitrine/ npm test` — 68 |
| Logique Manager (libellés, notification, filtres) | `manager/ npm test` — 79 |

> **Le fournisseur Brevo est SIMULÉ dans tous ces tests. Aucun e-mail réel n'y est
> envoyé.**

### ⚠️ Non testable automatiquement : le rate limit par IP

`middlewares/rateLimit.js` **se désactive hors production** (`config.isTest`,
`!isProd`). La suite ne peut pas asserter un `429`, et le limiteur **ne protège
rien en développement**. Comportement hérité, commun à toutes les routes limitées
du dépôt. Seule une vérification en production le prouverait.

---

## À vérifier localement

### 1. Affichage du formulaire

- [ ] `/contact` affiche le formulaire **au-dessus** (mobile) ou **à gauche**
      (desktop) des coordonnées.
- [ ] La carte est en **pleine largeur** sous la grille.
- [ ] Champs : Nom, E-mail, Téléphone *(facultatif)*, Motif, Message.
- [ ] Les 5 motifs sont proposés, libellés en français.
- [ ] Les labels sont de **vrais labels** (cliquer le label place le curseur).
- [ ] Les champs obligatoires sont marqués `*`.

### 2. Responsive

- [ ] 1440 px : deux colonnes.
- [ ] 768 px : une colonne, formulaire en premier.
- [ ] 375 px : aucun débordement horizontal, textarea utilisable.
- [ ] Mobile : le champ téléphone ouvre un **pavé numérique**.
- [ ] Mobile : le champ e-mail ouvre un clavier avec **`@`**.

### 3. Navigation clavier

- [ ] `Tab` parcourt : Nom → E-mail → Téléphone → Motif → Message → Envoyer.
- [ ] **Le honeypot n'est JAMAIS atteint** par `Tab`.
- [ ] Le `<select>` motif se pilote aux flèches.
- [ ] `Entrée` sur le bouton soumet.
- [ ] Le focus est visible sur chaque champ.

### 4. Validation inline

- [ ] Taper une lettre dans « Nom » **n'affiche pas** d'erreur (trop tôt).
- [ ] Quitter « Nom » vide → « Indiquez votre nom. »
- [ ] E-mail invalide → « Indiquez une adresse e-mail valide. » **sous le champ**.
- [ ] Corriger → l'erreur disparaît sans recharger.
- [ ] Le compteur du message **n'apparaît qu'au-delà de ~3000 caractères**.
- [ ] Dépasser 4000 → compteur **rouge**, envoi refusé.

### 5. Envoi

- [ ] Bouton → « Envoi en cours… », champs désactivés.
- [ ] **Double clic rapide → une SEULE demande** (vérifier dans le Manager).
- [ ] Succès → écran dédié :
      « **Votre demande a bien été envoyée. Nous reviendrons vers vous
      rapidement.** »
- [ ] Le succès **ne mentionne ni e-mail, ni administrateur, ni Brevo**.
- [ ] « Envoyer une autre demande » → formulaire **vide**.

### 6. Erreur réseau

- [ ] Couper le backend, envoyer → message neutre.
- [ ] **Les saisies sont TOUJOURS là** — rien n'a été vidé.
- [ ] Relancer le backend, renvoyer → **une seule demande** (même
      `clientSubmissionId`).

### 7. Honeypot (inspecteur)

- [ ] Le champ `website` existe, hors écran, `tabIndex="-1"`, `aria-hidden="true"`,
      `autocomplete="off"`.
- [ ] Le remplir à la main (via l'inspecteur) puis envoyer → **réponse de succès**.
- [ ] **Aucune demande n'apparaît dans le Manager** (rejet silencieux).

### 8. Manager — liste

- [ ] `/demandes-contact` apparaît dans le menu **en ADMIN** et **en DEV**.
- [ ] La demande de test s'y trouve, avec une **pastille « non lue »**.
- [ ] Compteurs par statut corrects.
- [ ] Filtres statut / motif / recherche.
- [ ] Recherche par nom, par e-mail, par mot du message.
- [ ] Créer >25 demandes → « Charger plus » ; **aucun doublon** entre les pages.

### 9. Manager — détail

- [ ] Message complet, **retours à la ligne conservés**.
- [ ] Un message contenant `<script>alert(1)</script>` s'affiche **en texte**.
- [ ] Coordonnées cliquables (`mailto:`, `tel:`).
- [ ] « Répondre par e-mail » ouvre le client avec le **sujet pré-rempli**.
- [ ] Après ouverture : la pastille « non lue » disparaît.
- [ ] Rouvrir → **`firstViewedAt` inchangé**.

### 10. Manager — transitions

- [ ] Seules les transitions **autorisées** sont proposées.
- [ ] `NEW` → « En cours » → « Résolue » : `resolvedAt` apparaît.
- [ ] Rouvrir une résolue → **`resolvedAt` disparaît**.
- [ ] Archiver → seule « Remettre en nouveau » reste.
- [ ] « M'assigner » puis « Retirer ».

### 11. Manager — notification

- [ ] Panneau « Notification aux administrateurs » avec l'état.
- [ ] Adresses **masquées** (`a***@…`).
- [ ] **Aucun « Délivrée »** nulle part.
- [ ] En **DEV** : lien vers l'événement système.
- [ ] En **ADMIN** : **aucun bouton de renvoi**.

### 12. Cas dégradés (sans Brevo configuré)

- [ ] Envoyer une demande → **succès pour le visiteur**.
- [ ] La demande **apparaît dans le Manager**.
- [ ] Notification : « Échec » avec « Expéditeur non vérifié » (ou similaire).
- [ ] **Aucune demande perdue.**

- [ ] Supprimer tous les comptes ADMIN, envoyer → succès visiteur, demande
      présente, notification « Échec » / « Aucun administrateur avec une adresse
      valide ».

---

## À vérifier avec une VRAIE configuration Brevo

> ⚠️ Consomme des crédits Brevo. Vérifier le **mode actif** avant.

### Préparation

- [ ] Clé API Brevo configurée, **test de connexion réussi**.
- [ ] Expéditeur **vérifié pour le mode actif**
      ([EMAIL_CONFIGURATION.md](EMAIL_CONFIGURATION.md)).
- [ ] `managerUrl` renseignée dans Configuration système → réseau.
- [ ] Au moins un compte **ADMIN** avec une adresse **que vous relevez**.

### Soumission réelle

- [ ] Déposer une demande depuis `/contact`.
- [ ] Le visiteur voit le message de succès.
- [ ] La demande apparaît dans le Manager.

### Événement

- [ ] `/dev/evenements` : un `contact.submitted`, statut **DISPATCHED**.
- [ ] Payload : e-mail **masqué**, **aucun message**.
- [ ] Une **exécution par administrateur**, toutes `SUCCEEDED`.
- [ ] `providerMessageId` présent.

### Réception

- [ ] **L'e-mail arrive** (vérifier les spams).
- [ ] Sujet : « Nouvelle demande de contact — <nom> ».
- [ ] Nom, e-mail, téléphone (ou « Non renseigné »), motif **en libellé**
      (« Demande de devis », pas `QUOTE`).
- [ ] Message avec ses **retours à la ligne**.
- [ ] Date en **17/07/2026 à 14:32** (pas un ISO brut).
- [ ] Bouton « Ouvrir dans le Manager » → **URL réelle**, pas `localhost`.
- [ ] Le lien **fonctionne** et ouvre la bonne demande.
- [ ] Rendu correct dans **Gmail**, **Outlook**, **mobile**.

### Sécurité (envoi réel)

- [ ] Déposer une demande dont le message contient
      `<script>alert(1)</script>` et `{{contact.email}}`.
- [ ] Dans l'e-mail reçu : les deux s'affichent **en texte**, rien ne s'exécute,
      `{{contact.email}}` **n'est pas remplacé**.

### Plusieurs administrateurs

- [ ] Créer un second compte ADMIN, déposer une demande.
- [ ] **Les deux reçoivent** l'e-mail.
- [ ] Deux exécutions, deux livraisons, deux `messageId` distincts.

---

## Ce que ce lot NE fait PAS — à ne pas tester

- ❌ **Aucune réponse depuis le Manager** (ce n'est pas un CRM).
- ❌ **Aucun renvoi d'e-mail côté ADMIN** (le retry vit dans `/dev/evenements`).
- ❌ **Aucun e-mail de résiliation** (actions encore `enabled: false`).
- ❌ **Aucun webhook Brevo** : « Délivrée » n'apparaîtra jamais.
- ❌ **Aucune purge automatique** des demandes.
