# Mon entreprise — l'identité juridique du client

> Contrat de pont **1.10.0**, projection `CLIENT_COMPANY`.
> Code : `services/panelConfiguration/clientCompany.service.js`,
> `controllers/clientCompany.controller.js`, `manager/src/pages/MyCompanyPage.tsx`.

Ce projet **reçoit** l'identité juridique de son client. Il ne la saisit pas,
ne la corrige pas, ne la déduit pas. L'autorité est le Panel.

---

## 1. Le manque que cela comble

Une facture réellement émise par ce projet portait :

```text
Facturer à : CTR-2026-0002
```

Un **numéro de contrat** en guise de raison sociale. Ni adresse, ni SIREN, ni
ventilation de TVA. La cause n'était pas un bug d'affichage : le système ne
connaissait aucune personne morale à qui adresser une facture.

Il connaissait :

| Notion | Ce que c'est | Ce que ce n'est pas |
|---|---|---|
| le **projet** | une instance technique livrée | un acheteur |
| le **contrat** | un engagement commercial | un acheteur |
| `Company` | la fiche d'affichage de la vitrine | un acheteur |

`Company` en particulier est un piège de nom : elle porte le logo, les horaires,
les réseaux sociaux, les médias publics. C'est une **fiche de site**. La
facturer reviendrait à adresser une facture à une page d'accueil.

L'acheteur est désormais une entité à part entière, tenue dans le Panel, et
publiée ici en lecture seule.

## 2. Ce que ce projet reçoit

```text
CLIENT_COMPANY          une seule, nominative (audience = ce projet)
  clientCompanyId       l'identité opaque, stable
  legalName             la raison sociale — ce que porte « Facturer à »
  tradingName           l'enseigne, si elle diffère
  legalForm             SARL, SAS, EI…
  siren / siret         identification de la personne morale
  vatNumber             TVA intracommunautaire
  registeredOffice      siège social, décomposé
  billingAddress        adresse de facturation EFFECTIVE (le siège à défaut)
  billingEmail, phone, website
  contractualSigner     la personne physique qui engage l'entreprise
  readiness             le VERDICT du Panel : peut-on facturer ? signer ?
```

Le schéma d'application est `.passthrough()` : un Panel plus récent peut
enrichir le profil sans qu'une version antérieure de ce projet refuse le
message. Le contraire — `.strict()` — transformerait chaque enrichissement du
Panel en panne de synchronisation du parc.

### Ce qui n'arrive JAMAIS ici

- les **notes internes** de L.Y Solution sur ce client ;
- les **documents juridiques** (Kbis, mandat, RIB) — ils vivent dans le Panel,
  en médias privés ;
- l'identité de l'agent Panel qui a créé ou modifié la fiche ;
- **les autres clients du parc.** L'écriture est adressée nominativement : un
  projet ne peut pas tirer l'entreprise cliente d'un autre projet.

### Ne jamais confondre avec `DEV_COMPANY`

Deux personnes morales, et elles se font face sur une facture :

| | `DEV_COMPANY` | `CLIENT_COMPANY` |
|---|---|---|
| Qui | L.Y Solution — le **prestataire** | le **client** de ce projet |
| Diffusion | tout le parc | ce projet SEUL |
| Sur une facture | émetteur | « Facturer à » |
| Ce qu'elle décide | pied de page, signataire développeur | identité de facturation, signataire client |

Les fondre aurait obligé ce projet à deviner, à la lecture, laquelle des deux
il reçoit — et la page « Mon entreprise » aurait fini par afficher les mentions
légales du prestataire au client.

## 3. Lecture seule, sans exception

Aucune route d'écriture. Une seule route :

```text
GET /api/my-company     →  { linked, company, readiness, appliedAt, support }
```

Ce n'est pas un manque à combler. Pouvoir écrire ici reviendrait à laisser un
client choisir la raison sociale sur laquelle il est facturé et la personne qui
l'engage — c'est-à-dire exactement la faille que ce chantier ferme.

Il n'existe donc :

- **aucune projection sortante** `CLIENT_COMPANY` ;
- **aucun déclencheur** local qui la modifierait ;
- **aucun formulaire** dans le manager.

### `support` — pourquoi l'adresse de contact voyage avec la vue

L'écran doit dire **quoi faire** quand l'information est incorrecte ou absente,
et la réponse n'est jamais « modifiez-la ici ».

```text
support.providerName   le nom du prestataire — « nous contacter » sans dire QUI
                       est « nous » oblige le lecteur à deviner
support.contactEmail   contacts.publicContactEmail, publié par le Panel
```

Jamais une constante de ce projet, jamais une variable d'environnement, jamais
l'adresse d'un compte administrateur. C'est précisément le champ que le Panel a
centralisé pour que le parc entier n'ait qu'une adresse à changer.

`contactEmail: null` quand le Panel ne l'a pas renseignée : l'écran affiche
alors le message **sans lien**, plutôt qu'un `mailto:` vide. Un lien mort
apprend à ne plus cliquer.

## 4. Le verdict est REÇU, jamais recalculé

`readiness` est produit par le Panel et repris tel quel.

| État | Signification | Paiement | Signature |
|---|---|---|---|
| `READY` | tout est en place | ✅ | ✅ |
| `MISSING_COMPANY` | aucun client légal rattaché | ❌ | ❌ |
| `MISSING_BILLING_IDENTITY` | raison sociale / SIREN / adresse / e-mail incomplets | ❌ | ✅ |
| `MISSING_SIGNER` | pas de signataire contractuel exploitable | ✅ | ❌ |

**Les deux verdicts ne sont jamais fondus.** Une entreprise dont l'adresse de
facturation est complète mais dont le gérant vient de partir peut encore être
facturée ; elle ne peut pas signer. L'inverse existe aussi. Un verdict unique
bloquerait l'un des deux métiers sans raison.

Recalculer la règle ici la ferait diverger : les champs requis, les seuils, la
définition d'une adresse « complète » sont des décisions de facturation, et
elles appartiennent à celui qui émet la facture. Ce projet n'en connaît que la
conclusion.

## 5. AUCUNE ENTREPRISE → AUCUN PAIEMENT, AUCUNE SIGNATURE

C'est une règle absolue, et elle vit **côté serveur**.

```text
aucune entreprise rattachée    → aucun paiement, aucune signature
identité de facturation
  incomplète                   → aucun paiement
signataire absent              → aucune signature
```

### Deux gardes, deux rôles — les deux sont nécessaires

| Où | Quoi | Pourquoi |
|---|---|---|
| **Panel**, au point d'usage de la capacité | refuse d'ouvrir une session Stripe ou une demande de signature | c'est l'AUTORITÉ ; le refus tombe avant tout contact fournisseur |
| **ici**, `billingReadiness()` / `signingReadiness()` | refuse l'appel HTTP en amont | EXPLIQUER avant de faire cliquer |

Sans la seconde, un client sans entreprise verrait un bouton « Payer »,
cliquerait, attendrait, et recevrait une erreur venue du plan de contrôle. Avec
elle, il lit ce qui manque et qui doit agir. La garde locale **explique** ; elle
ne protège pas seule, et ne prétend pas le faire.

### L'écran ne dit jamais « configurez-le ici »

La personne qui lit « Mon contrat » n'a pas le pouvoir de rattacher une
entreprise cliente ni de désigner un signataire. Un message qui l'invite à le
faire l'envoie chercher un écran qui n'existe pas. Le blocage nomme ce qui
manque, puis renvoie vers `support.contactEmail`.

Le bouton n'ouvre **pas** Stripe pour afficher une erreur ensuite : il ne part
pas.

## 5 bis. La prestation ponctuelle suit la MÊME autorité

Une prestation ponctuelle — un travail hors abonnement — n’a pas de contrat.
Elle était pour cette raison le dernier chemin de paiement à ne pas porter
d’identité juridique : le client Stripe étant dérivé du contrat, une
prestation partait sans client, et sa facture sans destinataire.

```text
AVANT   prestation → paiement → facture SANS « Facturer à »
APRÈS   prestation → entreprise cliente → client Stripe → facture nommée
```

**Ce qu’elle exige, et ce qu’elle n’exige pas :**

| | Requis |
|---|---|
| un contrat | **non** |
| une entreprise cliente facturable | **oui** |

Le blocage est dit **avant le clic** : sans identité de facturation,
l’écran « Factures » remplace le bouton « Payer » par la raison et par
« Nous contacter ». Un bouton qui mène à une erreur apprend au client que le
système est cassé, alors que c’est un dossier qui est incomplet.

L’identité juridique est **figée à l’ouverture du paiement**, sur la
prestation elle-même. Une facture est un document daté : ce qu’elle affirme
doit rester lisible même si la fiche change ensuite. Une seconde tentative de
paiement ne réécrit pas cet instantané — deux essais portent la même
identité, sinon le mot ne veut plus rien dire.

## 6. Le signataire contractuel

`getClientContractualSigner()` est l'unique source de l'identité qui signe pour
le client. Voir [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md).

Il rend `null` — jamais un objet à moitié rempli. Un signataire partiel
laisserait l'appelant décider si « pas de nom de famille » est acceptable, et le
premier appelant pressé déciderait que oui.

La **raison sociale accompagne le signataire** (`companyName`), pour que
l'instantané figé au contrat se lise seul : « Jean Dupont, SARL DUPONT
AUTOMOBILES ». Sans elle, on irait la rechercher dans une fiche qui aura changé
depuis.

`Company.signer` survit en base, **inerte** : le contrôleur retire
silencieusement le champ des requêtes d'écriture, et plus rien ne le lit.

## 7. Le tombstone est un état, pas une perte

Le Panel émet un tombstone au détachement ou au changement de client.
L'applicateur vérifie qu'il désigne bien l'entreprise **courante** :

```text
changement de rattachement :
  1. publication de la NOUVELLE identité
  2. retrait de l'ANCIENNE
```

Appliquer le retrait sans vérifier l'identité effacerait la publication qui
vient d'arriver, et le projet se retrouverait bloqué avec un client pourtant
correctement rattaché dans le Panel.

### Sur QUOI le rapprochement se fait

Pas sur `clientCompanyId`. Le contrat impose `entityId: uuid`, et
l'identifiant métier du Panel n'en est pas un : l'écriture porte donc un UUID
**dérivé**, la charge utile porte l'identifiant lisible. Les comparer
directement ne peut que se tromper — soit le retrait légitime est toujours
ignoré, soit un retrait tardif efface une entreprise valide.

Ce projet **mémorise** donc l'identifiant porté par l'écriture
(`bridgeEntityId`) au moment où il applique le profil, et rapproche
là-dessus. Il ne rederive rien : rederiver dupliquerait un algorithme du
Panel, qui finirait par diverger.

Les fiches appliquées avant ce champ n'en ont pas ; leur retrait retombe sur
l'ancienne comparaison, qui reste juste pour elles. Sans ce repli, une mise à
niveau rendrait leur retrait définitivement inapplicable.

Au **désappairage**, `clearClientCompany()` purge : ce qui venait du Panel
repart avec lui.

À l'**appairage**, le Panel republie l'entreprise cliente
(`buildDiscoveryPayload`). Un projet réappairé reçoit un nouvel identifiant, et
les écritures adressées à l'ancien ne lui seront jamais servies : sans cette
republication, il repartirait sans client légal — paiements et signatures
bloqués — jusqu'à ce que quelqu'un pense à rouvrir la fiche.

## 8. Ce que l'écran affiche

`manager/src/pages/MyCompanyPage.tsx`, réservé aux comptes ADMIN, rafraîchi par
la ressource live `client-company`.

| Cas | Affichage |
|---|---|
| rattachée | identité, immatriculation, adresses, signataire — **en lecture** |
| rattachée, incomplète | ce qui manque, nommé, avec la conséquence métier |
| non rattachée | un état vide explicite + « Nous contacter » |

Aucun champ de saisie, aucun bouton d'enregistrement. La mention « Une
information incorrecte ? » est présente dans les trois cas : une fiche complète
peut être fausse.

## 9. Tests

[client-company.test.js](../backend/src/scripts/client-company.test.js) —
`npm run test:client-company` :

- application d'un profil, d'un changement, d'un tombstone (y compris le
  tombstone d'une **autre** entreprise, qui ne doit rien effacer) ;
- `describeClientCompany()` rend un objet même sans rattachement ;
- les deux disponibilités ne sont jamais fondues ;
- le signataire partiel rend `null` ;
- `clearClientCompany()` au désappairage.

[contract-billing-signature.test.js](../backend/src/scripts/contract-billing-signature.test.js)
— les refus **HTTP** sur un contrat réellement payable : sans entreprise
cliente, ni paiement ni signature ne partent.

## 10. Documents liés

| Document | Sujet |
|---|---|
| [PANEL_BRIDGE.md](./PANEL_BRIDGE.md) | § 7 quinquies — la projection, § 7 sexies — le curseur durable |
| [CONTRACT_SIGNERS.md](./CONTRACT_SIGNERS.md) | l'autorité du signataire, l'instantané |
| [STRIPE_BILLING.md](./STRIPE_BILLING.md) | ce qui part chez Stripe |
| [CONTRACTS.md](./CONTRACTS.md) | la machine à états du contrat |
