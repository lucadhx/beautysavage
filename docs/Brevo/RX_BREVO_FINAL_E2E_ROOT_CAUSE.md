# RX-BREVO-FINAL-E2E — Cause racine de la non-délivrabilité

**Date d'investigation :** 2026-07-20
**Verdict à ce stade :** `NON CERTIFIÉ — RÉCEPTION RÉELLE NON PROUVÉE`
**Statut :** bloqué sur une action DNS externe (voir §5).

---

## 1. Cause racine (prouvée, pas déduite)

**Brevo réécrit l'expéditeur, et le domaine de remplacement est rate-limité par Gmail.**

L'application envoie bien `luca.duhoux@lycarz.com`. Mais le domaine `lycarz.com`
n'est **pas authentifié** chez Brevo. Brevo refuse alors d'utiliser ce domaine en
enveloppe et lui substitue son sous-domaine partagé de compte gratuit :

```
payload applicatif   sender.email = luca.duhoux@lycarz.com
expéditeur réel      luca.duhoux@11690999.brevosend.com     ← réécrit par Brevo
```

Gmail rejette temporairement ce domaine. Réponse SMTP réelle, relevée sur
`GET /v3/smtp/statistics/events` pour **chacun** des messages non reçus :

```
421-4.7.28 Gmail has detected an unusual rate of mail originating from your SPF
421-4.7.28 domain [11690999.brevosend.com      35]. To protect our users from
421-4.7.28 spam, mail sent from your domain has been temporarily rate limited.
421-4.7.28 For more information, go to
421-4.7.28 https://support.google.com/mail/?p=UnsolicitedRateLimitError
```

Ce n'est **ni** un problème de contenu, **ni** de HTML, **ni** de Reply-To, **ni**
de tags, **ni** de code applicatif. C'est la réputation d'un domaine d'envoi
mutualisé entre comptes gratuits Brevo, saturé côté Gmail.

Chaîne complète observée :

```
App → Brevo (HTTP 201, messageId)   OK
Brevo → réécriture From             lycarz.com → 11690999.brevosend.com
Brevo → Gmail                       421-4.7.28 rate limited
Gmail                               DEFERRED, retries, souvent expiration
Boîte destinataire                  VIDE
```

---

## 2. Configuration expéditeur — valeurs réellement observées

| Élément | Valeur constatée | Source |
|---|---|---|
| `sender.email` (config app) | `luca.duhoux@lycarz.com` | Mongo `EmailConfiguration.modes.TEST.sender` |
| `sender.name` (config app) | `Votre Site Web` | idem |
| **From réel** | `luca.duhoux@11690999.brevosend.com` | événements Brevo |
| Compte Brevo | `luca.duhoux@lycarz.com` — LY Solution | `GET /v3/account` |
| Plan | **`free`**, 296 crédits `sendLimit` | `GET /v3/account` |
| Relay SMTP | `smtp-relay.brevo.com:587` | `GET /v3/account` |
| SPF `lycarz.com` | `v=spf1 include:_spf.mail.hostinger.com ~all` — **aucun include Brevo** | DNS public 8.8.8.8 |
| DKIM `lycarz.com` | **aucun sélecteur** (`brevo`, `mail`, `brevo1/2`, `sib`, `k1`, `default`, `s1/s2` testés — tous absents) | DNS public |
| DMARC `lycarz.com` | `v=DMARC1; p=none` | DNS public |
| `brevo-code.lycarz.com` | **absent** | DNS public |
| MX `lycarz.com` | `mx1/mx2.hostinger.com` | DNS public |
| Alignement SPF | **échec** pour `lycarz.com` (jamais évalué : From réécrit) | déduit du From réel |
| Alignement DKIM | **échec** pour `lycarz.com` | idem |
| Statut domaine chez Brevo | **non authentifié** — non lisible par API (voir §4) | `GET /v3/senders/domains` → 400 |

Le domaine réellement utilisé, lui, est parfaitement authentifié — mais par Brevo,
pour Brevo :

```
11690999.brevosend.com  TXT  "v=spf1 include:spf.brevo.com -all"
11690999.brevosend.com  TXT  "k=rsa;p=MIGfMA0GCSqGSIb3DQEB…"
```

---

## 3. « Ancien test reçu » vs « nouveaux tests non reçus »

Le ticket supposait une différence de payload. **Les données la réfutent.**

| | Ancien test « reçu » | Nouveaux tests non reçus |
|---|---|---|
| messageId | `202607192200.73456504486` | `202607201922.36460918129`, `202607201955.17638102283` |
| Sujet | `… — test` | `… — Votre Site Web` |
| **From réel** | `luca.duhoux@11690999.brevosend.com` | `luca.duhoux@11690999.brevosend.com` — **identique** |
| Compte / clé API | même | même |
| Mode | TEST | TEST |
| **DEFERRED 4.7.28** | **OUI**, à 00:00:58 | OUI |
| `delivered` | **oui — le 2026-07-20 à 15:01**, soit **~15 h après** | jamais |

L'ancien test n'était pas mieux formé : il a subi **exactement le même
rate-limit**, et n'est passé qu'après une longue série de retries Gmail. La seule
variable est la patience de Gmail, pas le contenu.

Contre-épreuve dans le même journal : les envois vers `luca.duhoux@lycarz.com`
(MX Hostinger) sont `delivered` en **1 à 2 secondes**. Le défaut est donc
spécifique au couple *domaine d'envoi mutualisé* × *Gmail*.

---

## 4. Les événements `OPENED` sont bien des faux positifs

Confirmation directe de la règle §6 du ticket :

```
21:55:33.925  requests
21:55:34.026  opened      ← 101 millisecondes plus tard
```

Et pour le message du 19/07 : `opened` à `00:04`, alors que le `delivered` n'est
arrivé que le lendemain **15:01**. Une ouverture 15 heures avant la remise n'est
pas une ouverture humaine — c'est un préchargement du pixel de suivi par un
scanner. `OPENED` ne prouve rien, et le code actuel a raison de ne jamais le
promouvoir en statut.

---

## 5. Limite d'API rencontrée — les valeurs DKIM doivent être lues au tableau de bord

```
GET /v3/senders          → 400 bad_request
GET /v3/senders/domains  → 400 bad_request
"This endpoint is currently not available for your account. We are working on it.
 Meanwhile, use your Brevo account to manage your senders, domains, and IPs."
```

Ces endpoints sont bridés sur ce compte (plan gratuit). **Les valeurs DKIM et
`brevo-code` sont donc illisibles par programme et ne seront pas inventées.**
Elles doivent être relevées ici :

> Brevo → **Senders, Domains & Dedicated IPs** → onglet **Domains** →
> `lycarz.com` → **Authenticate this domain**

### Enregistrements à publier chez Hostinger

| # | Nom | Type | Valeur | Source |
|---|---|---|---|---|
| 1 | `brevo-code` | TXT | *(code affiché par Brevo)* | **à relever** |
| 2 | `brevo._domainkey` | TXT | *(clé publique affichée par Brevo)* | **à relever** |
| 3 | `@` | TXT | `v=spf1 include:_spf.mail.hostinger.com include:spf.brevo.com ~all` | **valeur exacte ci-contre** |

**Point critique sur le n°3 :** il ne faut **pas** créer un second enregistrement
SPF. Deux TXT `v=spf1` sur le même nom = SPF `permerror` = pire que rien. Il faut
**modifier l'enregistrement existant** en y ajoutant `include:spf.brevo.com`
avant le `~all`. L'include `spf.brevo.com` a été vérifié en DNS public et ne
contient que des `ip4:` — aucun risque de dépasser la limite des 10 lookups
(total après ajout : 4).

Le DMARC existant (`p=none`) convient pour cette phase : il n'est la cause
d'aucun rejet et permettra d'observer l'alignement avant tout durcissement.

### Après publication

1. Attendre la propagation (Hostinger : ~15–30 min, jusqu'à 4 h).
2. Cliquer **Verify / Authenticate** dans Brevo — l'authentification n'est active
   qu'une fois validée côté Brevo, pas dès que le DNS répond.
3. Revérification publique + nouveau test réel.

Une fois `lycarz.com` authentifié, le From cesse d'être réécrit, Gmail évalue la
réputation de `lycarz.com` (vierge) et non celle du pool saturé, et le
`4.7.28` disparaît.

---

## 6. Ce qui reste à faire une fois le canal ouvert

Rien de la suite n'est testable tant que Gmail défère : tout envoi émis
maintenant repartirait dans le même mur.

- [ ] §7 — séparer « santé du service » et « résultat du dernier e-mail » dans le Manager
- [ ] §8 — 3/3 tests Manager reçus sur Gmail + 1/1 sur une seconde messagerie
- [ ] §9-10 — audit et certification du formulaire de contact (3/3)
- [ ] §11 — matrice d'échecs (expéditeur invalide, clé invalide, honeypot, double soumission…)
- [ ] §12 — `npm run email:e2e` (exit ≠ 0 tant que la présence en boîte n'est pas confirmée)
- [ ] §13 — tests automatisés (en rappelant qu'ils ne certifient rien)

## 7. Outil ajouté

`backend/src/scripts/rx-brevo-e2e-probe.js` — sonde **lecture seule** : mode actif,
compte réellement utilisé, expéditeurs, statut des domaines, et surtout
chronologie + `reason` SMTP d'un messageId. Aucun envoi, aucune écriture, la clé
API n'est jamais journalisée.

---

## Verdict

```
Cause racine identifiée   OUI — 421-4.7.28, domaine d'envoi mutualisé réécrit
Domaine authentifié       NON
Présence boîte Gmail      NON CONFIRMÉE
Verdict                   NON CERTIFIÉ — RÉCEPTION RÉELLE NON PROUVÉE
```

Aucun commit final n'est réalisé à ce stade, conformément au §15.
