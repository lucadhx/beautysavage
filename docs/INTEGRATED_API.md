# IntegratedAPI — document d'autorité

> **Statut : ACTIF.** Doctrine finale, vérifiée dans le code.
> Voir aussi [PANEL_BRIDGE.md](PANEL_BRIDGE.md) et [PROTOCOL.md](PROTOCOL.md#incident--integratedapi).

---

## 1. Doctrine

> **SB Auto CONSOMME des capacités fournies par le Panel L.Y Solution. Il
> n'administre plus aucun fournisseur, secret, credential ou endpoint de
> plateforme.**

```
STRIPE     authority = PANEL
BREVO      authority = PANEL
YOUSIGN    authority = PANEL
HOSTINGER  authority = PANEL
```

Aucune exception. Côté SB Auto :

```
0 champ credential fournisseur saisissable
0 page IntegratedAPI dans le Manager
0 route d'administration locale
0 appel direct vers une API fournisseur sous autorité Panel
```

## 2. Ce que le projet garde, et pourquoi

Le catalogue local (`backend/src/utils/integratedApiCatalog.js`) **reste** : il
porte l'identité des fournisseurs, leur autorité et la classification au
démarrage. Supprimer la notion d'IntegratedAPI ferait disparaître Stripe et Brevo
de tout écran, et l'on chercherait longtemps qui encaisse et qui envoie.

Ce qui a disparu, c'est la **propriété** — pas la connaissance.

| Toujours dans le projet | Retiré du projet |
|---|---|
| catalogue, identité, autorité | champs de saisie |
| client de capacités | credentials fournisseur |
| classification au démarrage | routes d'administration |
| statut runtime | page Manager, webhooks locaux |

## 3. La seule exception, nommée

`STRIPE.webhookSecret` subsiste en base. Ce n'est **pas** une réintroduction
d'autorité locale :

- il est **livré par le Panel**, jamais saisi ;
- il ne permet **aucun appel** sortant ;
- il sert uniquement à **constater qu'un événement reçu vient bien de Stripe**.

Le supprimer rendrait le projet incapable de distinguer un vrai événement d'un
faux — l'inverse d'un durcissement. C'est la seule entrée de `CREDENTIAL_POLICY`
avec un `keep` non vide.

## 4. Politique de credentials

`backend/src/scripts/purge-dead-provider-credentials.js` :

| Fournisseur | `keep` | `dead` |
|---|---|---|
| STRIPE | `webhookSecret` | `secretKey`, `publishableKey` |
| BREVO | — | `apiKey`, `webhookSecret`, `webhookSecretPrevious` |
| YOUSIGN | — | `apiKey`, `webhookSecret` |
| HOSTINGER | — | `apiToken` |

La purge est **idempotente** et vérifie l'absence dans le **document réel**, pas
seulement au catalogue : un champ retiré du contrat mais laissé en base resterait
un secret au repos — lisible par toute sauvegarde, tout export, tout accès Mongo.

**Aucune procédure ne doit conseiller de restaurer une clé locale.**

## 5. Fail-closed

```
capacité Panel indisponible
  → erreur de capacité explicite
  → AUCUN repli vers un appel fournisseur direct
  → AUCUNE lecture de credential local
```

Un repli recréerait deux autorités — donc deux vérités, dont une périmée. C'est
un invariant d'architecture, verrouillé par test.

## 6. Chemins par fournisseur

### Brevo — e-mail

```
envoi    SB Auto → email.send_template → Panel → Brevo
retour   Brevo → webhook central Panel → emailDeliveryDispatch
                → Panel Bridge → SB Auto → EMAIL_DELIVERED / EMAIL_BOUNCED
```

Le projet ne possède plus : clé Brevo, secret de webhook Brevo, webhook local,
`brevoFetch`, appel direct à `api.brevo.com`.

Les événements de livraison **suivent le compte** : depuis que l'émission part du
compte Brevo du Panel, ils arrivent au Panel, pas au projet. C'est ce qui rendait
le webhook local inutile avant même qu'on le supprime.

> **Configuration fournisseur Brevo → Panel.
> Configuration métier e-mail → SB Auto** (Manager → *Templates e-mail*).
> Les deux ne sont pas la même chose et n'ont jamais eu à vivre au même endroit.

### Stripe — paiement

```
capacités billing.*   exécutées par le Panel
webhook               provisionné par le Panel, REÇU par le projet
secret de vérification livré par le Panel (§3)
```

Au démarrage, si le Panel n'est pas encore appairé, la réconciliation du webhook
est `DEFERRED` — armée, pas abandonnée.

### Yousign — signature

```
SB Auto → signature.request.open / .retrieve / .cancel
        → signature.signer.retrieve / signature.document.download
        → Panel → Yousign
```

Aucun credential local. Le webhook arrive au Panel, qui projette les faits par le
pont (`SIGNATURE_EVENT`).

### Hostinger — DNS

```
SB Auto → dns.zone.resolve / dns.records.read → Panel → Hostinger
```

Aucun jeton local. La plateforme prouve que le nom appartient au projet, puis
écrit avec **sa** clé.

## 7. Propriété des webhooks

| Webhook | Propriétaire | Récepteur | Provisionneur | Secret | Consommateur |
|---|---|---|---|---|---|
| Stripe | Panel | **projet** | Panel | projet (vérification) | projet |
| Brevo | Panel | Panel | Panel | Panel | projet, **via le pont** |
| Yousign | Panel | Panel | Panel | Panel | projet, **via le pont** |
| Hostinger | — | — | — | — | *(aucun webhook entrant)* |

Seul Stripe est encore *reçu* localement — d'où le seul secret conservé.

## 8. Gardes d'architecture

`backend/src/scripts/integrated-api-panel-authority.test.js` verrouille :
autorité des quatre fournisseurs, zéro champ saisissable, politique de
credentials, **absence** des fichiers et routes supprimés, absence d'appel direct
aux hôtes fournisseurs, registre de webhooks réduit à Stripe, applicateur du pont
intact, envoi par capacité, non-régression du readiness, surface Manager absente.

Elle verrouille surtout l'**absence** : rien n'échoue le jour où un champ
`apiKey` revient — un écran réapparaît, on y colle une clé, tout « fonctionne ».
Le défaut ne se voit qu'au repos, dans une base qui contient de nouveau un secret
que personne n'aurait dû pouvoir écrire.
