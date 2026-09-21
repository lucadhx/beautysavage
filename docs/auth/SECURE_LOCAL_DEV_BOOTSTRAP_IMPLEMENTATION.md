# Amorçage sécurisé du premier développeur local — LOT 2C

> Ce document décrit ce qui remplace le mot de passe universel `123dev`, et
> pourquoi le remplaçant est structurellement différent — pas simplement « plus
> long ».

---

## CURRENT LEGACY STATE

Avant ce lot, chaque projet du parc naissait avec deux comptes d'administration
dont les mots de passe étaient écrits dans le code du produit :

```
backend/src/config/bootstrap.js
  { email: SEED_DEV_EMAIL ?? 'dev@mail.com', password: '123dev',   role: DEV   }
  { email: 'admin@mail.com',                 password: '123admin', role: ADMIN }
```

L'assistant de duplication permettait de les remplacer — mais le remplaçant
était alors écrit **en clair** dans le `.env` de la copie
(`SEED_DEV_PASSWORD=…`), où il restait ; et le défaut public revenait dès que la
variable manquait.

Le problème n'était pas la faiblesse de `123dev`. C'était son **universalité** :
un secret identique sur N projets ne vaut que le moins bien gardé des N. Trois
endroits détenaient le secret d'administration d'un projet neuf — le
formulaire, le fichier, la base — avant même que son titulaire l'ait vu.

Recensement à l'ouverture du lot (dépôt projet) :

| Emplacement | Nature |
| --- | --- |
| `config/bootstrap.js` | **usage actif** — écrivait les mots de passe |
| `duplication-engine/duplication.js` | **usage actif** — les propageait dans le `.env` |
| `manager/.../DuplicateAssistant.tsx` | **usage actif** — les collectait |
| `.env.example`, `README.md`, `docs/*` | documentation du défaut |
| 23 suites `backend/src/scripts/*.test.js` | décor de recette |
| `Panel/backend/src/config/env.js` | **liste noire** (LOT 2A) — à conserver |

---

## LOCAL VS FEDERATED DEV

Les deux familles coexistent, et aucune ne remplace l'autre.

```
LOCAL DEV                          PANEL DEV (fédéré)
─────────────────────────          ─────────────────────────
compte natif du projet             identité L.Y Solution
mot de passe local (choisi)        aucun mot de passe local
fonctionne SANS Panel              exige appairage + projectAccess
révoqué par le projet              révoqué par le Panel
collection `users`                 collection `externalprincipals`
```

Un projet **non appairé**, un Panel **éteint**, un appairage **révoqué** : le
développeur local entre toujours. C'est la propriété que ce lot devait
préserver en supprimant le mot de passe universel, et elle est éprouvée
explicitement (`federated-dev-identity.test.js`, section 11).

**Même adresse ≠ même identité.** Une adresse est une chaîne de caractères que
le Panel choisit d'un côté et que le projet choisit de l'autre ; fusionner
reviendrait à dire qu'obtenir un compte L.Y Solution portant l'adresse d'un
développeur local suffit à prendre sa place ici. Les deux identités restent
étrangères.

---

## PREMIER ADMINISTRATEUR (hotfix — doctrine finale)

Le lot 2C avait d'abord RETIRÉ l'amorçage automatique de l'ADMIN, au motif que
son mot de passe (`123admin`) était universel. C'était un mauvais arbitrage : il
supprimait le compte au lieu de supprimer l'universalité, et livrait au client
un projet dont il ne pouvait pas ouvrir le manager.

**Doctrine finale : le bootstrap ADMIN est conservé, avec un credential fourni
explicitement à chaque duplication et jamais universel.**

Les deux comptes suivent des chemins volontairement différents :

| | Premier DEV local | Premier ADMIN local |
| --- | --- | --- |
| saisi dans l'assistant | nom + e-mail | e-mail + mot de passe + confirmation |
| création | au premier démarrage | **pendant la duplication** |
| état initial | `PENDING_ACTIVATION` | `ACTIVE` |
| secret | choisi par lui via lien à usage unique | saisi par l'exploitant |

Pourquoi cette asymétrie : le développeur est une personne identifiée qui relève
sa boîte — un lien lui coûte trente secondes et ne laisse aucun secret nulle
part. L'administrateur est le compte remis au client à la livraison, souvent de
vive voix, parfois avant que sa boîte ne soit relevée ; un lien envoyé dans le
vide produirait un projet livré sans accès.

Le mot de passe ADMIN n'est **jamais** écrit dans un `.env` : le compte est créé
directement dans la base TEST de la copie, à l'instant où le secret est en
mémoire et nulle part ailleurs. Il est refusé s'il appartient à la liste noire
des secrets diffusés du parc (`utils/universalSecrets.js`) ou s'il se déduit de
l'adresse.

Blocages typés : `FIRST_ADMIN_REQUIRED`, `FIRST_ADMIN_PASSWORD_INVALID`,
`FIRST_ADMIN_ALREADY_PRESENT`, `FIRST_ADMIN_CREATION_FAILED`. L'étape
`first_admin` est **bloquante** et visible dans la checklist live : une
duplication qui ne crée pas l'administrateur échoue.

`FIRST_ADMIN_EMAIL` reste accepté au démarrage pour les installations HORS
duplication : il amorce alors un ADMIN par lien d'activation, comme le
développeur. Aucun mot de passe n'est jamais lu depuis l'environnement.

## BOOTSTRAP CONTRACT

```
FIRST_DEV_EMAIL     destinataire du lien d'activation — OBLIGATOIRE
FIRST_DEV_NAME      nom affiché (facultatif)
FIRST_ADMIN_EMAIL   même mécanisme pour le compte ADMIN du client (facultatif)
FIRST_ADMIN_NAME    idem
LOCAL_DEV_ACTIVATION_TTL_MINUTES   durée du lien (défaut : 60)
```

`SEED_DEV_EMAIL` reste acceptée comme **alias déprécié** de `FIRST_DEV_EMAIL`
(les copies produites avant le lot la portent), avec un avertissement au
démarrage. `SEED_DEV_PASSWORD` et `SEED_ADMIN_PASSWORD` **ne sont plus lues du
tout**, et le moteur de duplication les efface du `.env` des copies.

Trois gardes, dans cet ordre (`localDevBootstrap.ensureInitialLocalUser`) :

1. **Au plus un compte par rôle structurel.** Un compte DEV existant — quelle
   que soit son adresse — empêche toute seconde création.
2. **Fail-closed sans adresse.** Sans destinataire explicite, **rien** n'est
   créé, et le démarrage journalise `FIRST_DEV_REQUIRED`.
3. **Aucun écrasement.** Un compte existant n'est jamais modifié.

Côté moteur de duplication, l'absence d'adresse est un **blocage typé** :
`ValidationError` portant `details.blocker = 'FIRST_DEV_REQUIRED'`. Un
`devPassword` envoyé par un client antérieur au lot est **refusé**
(`FIRST_DEV_PASSWORD_REFUSED`) plutôt qu'ignoré — sans quoi l'appelant croirait
son mot de passe posé pendant que le compte s'ouvre par un autre chemin.

---

## ACTIVATION MODEL

```js
// models/LocalDevActivation.model.js
{
  userId, tokenHash, expiresAt, consumedAt,
  reason: BOOTSTRAP | RESEND | LEGACY_MIGRATION,
  emailStatus: PENDING | SENT | ERROR, emailErrorSafe, sentAt,
}
```

- token brut : `crypto.randomBytes(32).toString('base64url')` — il n'existe
  qu'en mémoire le temps de construire l'URL, puis dans la boîte de son
  destinataire ;
- en base : **SHA-256** du token, index unique ;
- **usage unique** : la consommation est un `findOneAndUpdate` conditionnel
  (`consumedAt: null` → `consumedAt: now`), donc atomique. Une lecture suivie
  d'une écriture aurait laissé passer un double-clic ;
- **TTL** : 60 minutes par défaut, aligné sur les réinitialisations existantes ;
- **un nouveau lien tue l'ancien** : `issueActivation` consomme d'abord toutes
  les activations vivantes du compte ;
- **renvoi** : `resendActivation(email)` — réponse toujours générique, délai
  d'attente de 2 minutes par compte.

Le compte porte `status: PENDING_ACTIVATION` et **n'a pas de champ
`password`** — pas un hash aléatoire inatteignable, une absence.
`comparePassword` la traite comme un refus.

**Aucune porte ne s'ouvre avant l'activation** : le login répond le message
générique « Email ou mot de passe incorrect » (dire « compte non activé »
confirmerait l'existence d'un compte d'administration en cours d'ouverture) ; la
connexion rapide de TEST (`/dev-login`) refuse explicitement ; la liste
`/test-accounts` ne le propose pas ; `forgot-password` n'émet aucun lien — il
n'y a pas de mot de passe à réinitialiser.

---

## EMAIL FLOW

```
projet  →  sendTemplate('DEV_ACCOUNT_ACTIVATION')
        →  Panel (plan de contrôle, capacité email.send_template)
        →  Brevo
```

- template `DEV_ACCOUNT_ACTIVATION`, portée **PROJECT**,
  `provisionForProjects: true` — c'est le tout premier message qu'un projet neuf
  émet ; s'il n'était pas posé d'avance, la duplication échouerait en
  `EMAIL_TEMPLATE_NOT_CONFIGURED` et le projet naîtrait sans accès ;
- variables (contrat plateforme, LOT 1) : `company.name`, `user.name`,
  `auth.activationUrl`, `auth.expiresMinutes` ;
- expéditeur : celui du parc, détenu par le Panel — **aucune clé Brevo dans le
  projet** ;
- URL construite depuis `SystemConfiguration.network.managerUrl` — **aucun
  domaine codé en dur**.

Page publique : `/activer-mon-compte` (alias `/activate-account`, même
composant). Elle **valide le lien avant** d'afficher le formulaire : découvrir
qu'un lien a expiré au moment où l'on valide un mot de passe qu'on vient de
choisir est la façon la plus sûre de faire abandonner quelqu'un.

---

## DUPLICATION FLOW

```
assistant (nom + adresse du premier dev, AUCUN mot de passe)
  → copie physique
  → .env réécrit : FIRST_DEV_EMAIL / FIRST_DEV_NAME écrites,
                   SEED_DEV_PASSWORD / SEED_ADMIN_PASSWORD SUPPRIMÉES
  → vérification post-écriture : adresse présente une fois, aucun secret hérité
  → premier démarrage : compte créé PENDING_ACTIVATION + lien envoyé
  → le développeur choisit son mot de passe
  → login local PASS, sans Panel
```

---

## PANEL UNAVAILABLE / EMAIL FAILURE

Le compte est **créé quand même**, et l'échec d'envoi est **enregistré sur
l'activation** (`emailStatus: ERROR`, `emailErrorSafe`) — pas seulement
journalisé. C'est ce qui permet de distinguer « le développeur n'a pas encore
cliqué » de « le message n'est jamais parti » : deux situations qui se
ressemblent beaucoup vues du dehors et ne se réparent pas pareil.

`describeBootstrapStatus()` expose l'état pour l'exploitant. **Aucun mot de
passe de repli n'est jamais inventé.**

---

## LEGACY MIGRATION

`backend/src/scripts/migrate-legacy-local-dev.mjs`

```bash
node src/scripts/migrate-legacy-local-dev.mjs --dry-run        # défaut
node src/scripts/migrate-legacy-local-dev.mjs --apply --strategy=convert
node src/scripts/migrate-legacy-local-dev.mjs --apply --strategy=disable
```

Classification **sur preuve**, jamais sur l'adresse : `bcrypt.compare` du hash
existant contre la liste noire des secrets universels. Un `dev@mail.com` dont le
mot de passe a été changé n'est **pas** un compte hérité ; un compte nommé
autrement qui porte encore `123admin` en est un.

| Classe | Traitement |
| --- | --- |
| `LOCAL_DEV_LEGACY` | credential retiré (`$unset password`), `status: PENDING_ACTIVATION`, `mustResetPassword: true` ; `convert` émet en plus un lien d'activation |
| `LOCAL_DEV_REAL` | intact |
| `PENDING_ACTIVATION` | déjà sans secret |
| `UNKNOWN` | signalé, non traité |

**Aucun compte n'est supprimé** : la migration retire un credential, jamais une
identité. Et `disable` **refuse** de fermer le dernier développeur sain — sans
retour possible sans accès direct à la base. `convert` reste ouverte : elle
remplace la serrure par une dont le titulaire reçoit la clé.

---

## SECURITY

- aucun mot de passe n'est lu depuis l'environnement (contrôle automatisé) ;
- aucune valeur `123dev` / `123admin` n'apparaît dans `src/` hors `scripts/`
  autrement qu'en commentaire (contrôle automatisé) ;
- le moteur de duplication n'écrit aucune variable de mot de passe (contrôle
  automatisé) ;
- token brut jamais stocké, jamais journalisé, jamais dans un événement ;
- adresses **masquées** dans les événements d'audit ;
- routes d'activation publiques mais limitées comme les réinitialisations, plus
  un délai d'attente **par compte** — la limite par IP seule ne protégerait pas
  la boîte visée ;
- `/api/auth/dev-login` reste **TEST-only** (`config.isTest`), et refuse
  désormais aussi les comptes en attente d'activation.

Observabilité (registre d'événements canonique, `RETENTION_CLASS.AUDIT`) :

| Événement | Type canonique |
| --- | --- |
| `LOCAL_DEV_CREATED` | `localdev.created` |
| `LOCAL_DEV_ACTIVATION_SENT` | `localdev.activation.sent` |
| `LOCAL_DEV_ACTIVATED` | `localdev.activated` |
| `LOCAL_DEV_ACTIVATION_FAILED` | `localdev.activation.failed` |
| `LOCAL_DEV_LEGACY_DETECTED` | `localdev.legacy.detected` |
| `LOCAL_DEV_LEGACY_DISABLED` | `localdev.legacy.disabled` |

---

## TESTS

| Suite | Portée |
| --- | --- |
| `seed-dev-account.test.js` | amorçage, activation, usage unique, expiration, fail-closed, panne d'envoi, renvoi, observabilité, scan de sécurité |
| `legacy-local-dev-migration.test.js` | classification sur preuve, dry-run, conversion, garde du dernier accès |
| `duplication.test.js` | blocages typés, `.env` sans secret, secrets hérités effacés |
| `federated-dev-identity.test.js` §11 | coexistence local/fédéré, même adresse non fusionnée, désappairage, projet non appairé |
| `email-templates.test.js` | cliquet du nombre de modèles |
| `Panel/tests/email-template-multi-project.test.js` | parité des registres, portée PROJECT |

Le décor de recette (`dev@mail.com` / `123dev`) vit désormais dans
`backend/src/scripts/helpers/testAccounts.helper.js` : une base éphémère montée
en mémoire pour la durée d'un test, jamais un produit livré.
