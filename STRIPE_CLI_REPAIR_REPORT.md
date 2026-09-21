# Rapport — Réparation Stripe CLI & authentification

## Cause réelle

**Stripe CLI n'était PAS cassée : elle était bien installée.** Le message
« Le terme 'stripe' n'est pas reconnu » venait d'un **problème de propagation du
PATH**, pas d'une installation manquante.

Diagnostic vérifié (aucune hypothèse) :

| Vérification | Résultat réel |
|---|---|
| `winget list Stripe.StripeCli` | **Installée**, version **1.43.8** |
| Présence de `stripe.exe` | **Oui** : `C:\Users\Luca\AppData\Local\Microsoft\WinGet\Packages\Stripe.StripeCli_Microsoft.Winget.Source_8wekyb3d8bbwe\stripe.exe` |
| PATH **utilisateur persistant** | **Contient déjà** ce dossier (winget l'y a ajouté) |
| WinGet `Links` (shim) | Aucun shim `stripe` (winget a ajouté le dossier du paquet directement) |
| PATH du **processus/terminal courant** | **Périmé** — capturé AVANT l'installation |
| Windows | 11 Entreprise, build 10.0.26200 |
| Terminal | Le terminal ouvert (et ses enfants Git Bash) avaient hérité de l'ancien PATH |

**Explication technique :** sous Windows, une modification du PATH n'est lue que
par les **nouveaux** processus. Tout terminal déjà ouvert (et les shells enfants
qu'il lance) conserve le PATH figé à son démarrage. L'installation winget a bien
mis à jour le PATH **persistant** (utilisateur), mais le terminal de l'utilisateur,
ouvert avant l'installation, ne le voyait pas → « stripe n'est pas reconnu ».

**Aucune réinstallation ni édition du PATH n'était nécessaire** : le PATH
persistant est déjà correct. Un simple **terminal rouvert** suffit désormais.

## Différence avec le rapport précédent

Le rapport précédent (`STRIPE_CLI_DEV_SETUP_REPORT.md`) indiquait « installée avec
succès » — ce qui était **exact** : l'installation winget a réellement réussi et
la vérification `stripe --version` renvoyait bien `1.43.8`. **MAIS** cette
vérification n'a fonctionné que parce que le PATH y était **rechargé manuellement
en mémoire** (`$env:Path = [Environment]::GetEnvironmentVariable(...Machine)+...User`).

Le rapport mentionnait d'ailleurs la limite « Git Bash n'hérite pas du PATH
winget ; lancer `npm run dev` depuis un terminal rouvert ». L'incohérence
ressentie venait donc de là : le rapport décrivait l'état **persistant** (correct),
tandis que l'utilisateur testait dans un **terminal non rouvert** (PATH périmé).
Le point sous-estimé : **il fallait explicitement fermer/rouvrir le terminal**
avant que `stripe` soit disponible. C'était une nuance de propagation PATH, pas
une erreur d'installation.

## Corrections effectuées

1. **Diagnostic complet** du PATH (utilisateur/système), de l'emplacement réel de
   `stripe.exe` et de l'état winget — confirmant qu'aucune réparation
   d'installation n'était requise.
2. **Authentification** via le flux non-interactif prévu pour les agents :
   `stripe login --non-interactive` (renvoie `browser_url` + `verification_code`),
   ouverture de la page d'autorisation, puis `stripe login --complete <poll-url>`
   en attente de l'approbation navigateur de l'utilisateur.
3. **Validation** de l'authentification, du démarrage du listener et du transfert
   d'un événement de test.
4. Aucune modification du code métier (uniquement l'ajout de ce rapport).

> Note : pour un usage durable, `stripe` est déjà sur le PATH utilisateur
> persistant ; il suffit d'**ouvrir un nouveau terminal**. Aucune copie manuelle
> d'exécutable n'a été faite.

## Vérifications

### `stripe --version`
```
stripe version 1.43.8
```

### `stripe login`
Authentification réussie après approbation navigateur. Confirmée par :
```
[default]
account_id       = 'acct_1Tt9CyKDTCCXnROC'
display_name     = 'environnement de test L.Y Solution'
device_name      = 'Legion-5-Pro'
test_mode_api_key = 'sk_test_[REDACTED]'   (expire 2026-10-13)
test_mode_pub_key = 'pk_test_[REDACTED]'
```
Appel API réel de contrôle : `stripe customers list --limit 1` → **HTTP 200**
(authentification pleinement effective).

### `npm run dev` (moitié Stripe : `stripe listen`)
Listener démarré après attente de `/health`, filtrant les 6 événements traités.
Sortie Stripe CLI :
```
Ready! You are using Stripe API Version [2026-06-24.dahlia].
Your webhook signing secret is whsec_[REDACTED] (^C to quit)
```
Le **bloc visuel s'affiche bien** :
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRIPE WEBHOOK LOCAL PRÊT
Endpoint : http://localhost:6060/api/webhooks/stripe
Secret de signature TEST : whsec_[REDACTED]
Copiez cette valeur dans : Manager DEV → Intégrations API → Stripe → TEST → webhook_secret
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### `stripe trigger checkout.session.completed`
```
Trigger succeeded! Check dashboard for event details.
```
Réception côté backend (log Stripe CLI) :
```
--> checkout.session.completed [evt_1TtNhvKDTCCXnROCrChsBNDI]
<--  [500] POST http://localhost:6060/api/webhooks/stripe
```
**Le webhook est bien reçu par le backend** (chaîne CLI → backend fonctionnelle).
La réponse **500** est **attendue** : le Manager ne contient pas encore le
`webhook_secret` Stripe TEST, donc le backend refuse la vérification de signature
(`getCredential('STRIPE','webhook_secret')` absent). Après collage du secret, la
réponse deviendra **2xx** (et un rejeu du même `event_id` sera ignoré —
idempotence).

### Confirmation du `whsec_` et de sa destination
Le `whsec_...` est **affiché en clair dans la console** (pour copie) et peut être
collé dans :

**Manager DEV → Intégrations API → Stripe → TEST → webhook_secret**

Il n'est écrit dans **aucun fichier versionné**, aucune base, et n'est jamais
envoyé au frontend. Ce rapport le masque en `whsec_[REDACTED]`.

## Procédure utilisateur définitive

```bash
# 1) Ouvrir un NOUVEAU terminal (PowerShell/CMD) — indispensable pour charger le
#    PATH mis à jour (stripe est déjà sur le PATH utilisateur persistant).
stripe --version        # doit afficher 1.43.8

# 2) (déjà fait) authentification :
stripe login            # approbation dans le navigateur

# 3) Développement :
cd backend
npm run dev             # backend + stripe listen ; copier le whsec_ affiché
#    → Manager DEV → Intégrations API → Stripe → TEST → webhook_secret

# 4) Test :
stripe trigger checkout.session.completed   # doit passer en 2xx une fois le secret collé
```

## État final
- Stripe CLI **1.43.8** : installée, sur le PATH persistant, **authentifiée**
  (compte `acct_1Tt9CyKDTCCXnROC`, mode test).
- Listener `stripe listen` : **opérationnel**, `whsec_` affiché, événement de test
  **reçu par le backend**.
- Seule action restante côté utilisateur : **coller le `whsec_`** dans le Manager
  (Stripe TEST → webhook_secret) pour obtenir des réponses 2xx, et lancer
  `npm run dev` depuis un terminal **rouvert**.
