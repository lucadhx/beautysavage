> **RAPPORT HISTORIQUE — le problème a disparu avec le prestataire.**
>
> Ce document traite d'un abonnement d'essai qui refusait les redirections de
> retour, et du repli inventé pour cela. Le prestataire concerné est retiré.
>
> La contrainte actuelle est différente et plus simple : **une seule** adresse
> de retour pour tout le document, sans paramètre ajouté. Le repli, lui, a
> survécu et s'est généralisé — `autoReturn` reste un FAIT constaté à
> l'ouverture, jamais une promesse. Voir **[SIGNATURE.md](SIGNATURE.md)**.

# Yousign — repli quand l'abonnement Trial refuse les redirections

## Le problème

Le backend pose des `redirect_urls` sur chaque signataire pour ramener chaque
partie chez elle à la fin du flux Yousign (cf.
[RX_CONTRACT_UX_POLISH_03.md](./RX_CONTRACT_UX_POLISH_03.md)).

Un abonnement Yousign **en Trial** les refuse :

```
HTTP 400 /signature_requests/{id}/signers
{
  "type": "parameters_not_valid",
  "detail": "You have some invalid params in your payload.",
  "invalid_params": [{
    "name": "redirect_urls",
    "reason": "The redirect urls cannot be defined when the subscription is in trial."
  }]
}
```

Et la création **entière** de la demande échouait. Donc : pas de signature, pas
de contrat, pas d'activation — parce que le plan ne sait pas rediriger.

## Pourquoi ce repli existe

**Le retour automatique est un confort de navigation. La signature est le
métier.** Les deux ne pèsent pas le même poids : bloquer un contrat pour une
commodité de trajet est un mauvais arbitrage. Le repli rétablit la hiérarchie —
on perd le retour automatique, on garde le contrat.

Rien n'est perdu au passage : **la signature est confirmée par le webhook**, pas
par le retour. Sans redirection, le signataire revient de lui-même ; le webhook,
lui, arrive de toute façon. C'est la seule différence.

## Le comportement

```
createContractSignatureRequest(contract, file, provider, redirectUrls)
        │
        ├─ tentative 1 : AVEC redirect_urls
        │     ├─ OK ────────────────────────────▶ autoReturn = true   ✅
        │     └─ refus
        │           ├─ « redirect … trial » ? ── non ──▶ l'erreur REMONTE  ❌
        │           └─ oui
        │                 │ (la demande brouillon a déjà été supprimée)
        │                 ▼
        └─ tentative 2 : SANS redirect_urls ────▶ autoReturn = false  ✅
              (payload par ailleurs STRICTEMENT identique)
```

Une seule reprise. Aucune boucle.

## Pourquoi il est volontairement limité à cette erreur

Un repli qui avale les erreurs est pire que le bug qu'il corrige : il transforme
une panne visible en comportement silencieusement dégradé. La reconnaissance est
donc étroite **par construction** :

```js
export function isTrialRedirectRefusal(err) {
  return errorTexts(err).some((t) => /redirect/i.test(t) && /\btrial\b/i.test(t));
}
```

Les **deux** notions doivent apparaître dans le **même** texte. Ce qui est
explicitement rejeté et **testé comme tel** :

| Refus | Reconnu ? | Pourquoi |
| --- | --- | --- |
| `redirect_urls` + `… in trial` | ✅ | le cas visé |
| `nature: Value must be in [...]` | ❌ | rien à voir |
| `redirect_urls: Invalid URL format` | ❌ | redirection, mais pas Trial : c'est **notre** bug, il doit se voir |
| `This feature is unavailable while the subscription is in trial` | ❌ | Trial, mais pas les redirections : une autre limite ne se contourne pas en retirant les redirections |
| panne réseau, `null` | ❌ | aucun texte à reconnaître |

Deux garde-fous supplémentaires :

- le repli n'a lieu **que si on avait envoyé des redirections** (`if (!redirectUrls) throw err`) ;
- on ne se fie **pas au libellé exact** : Yousign peut le reformuler sans préavis,
  et une correspondance stricte transformerait un simple changement de wording en
  panne de production.

## Aucune ressource orpheline

`attemptSignatureRequest` était **déjà** tout-ou-rien : dès qu'une demande
brouillon existe chez Yousign, toute sortie en erreur la supprime avant de
remonter. Le repli hérite de cette garantie — quand il démarre, la demande de la
tentative refusée n'existe plus.

C'est pour ça que le correctif est court : il n'a rien eu à inventer côté
nettoyage. Un test le vérifie explicitement (`delete:sr_t1` appelé, `sr_t2`
conservé).

Si la suppression échoue elle-même, elle est journalisée en `warn` avec
l'identifiant à nettoyer à la main — et **n'écrase jamais l'erreur d'origine**.

## Aucune configuration

Il n'y a **rien à régler**. Pas de `TrialMode`, pas de `SandboxMode`, pas de
`allowRedirect`, pas de variable d'environnement, pas de champ dans le Manager.

Le comportement est **entièrement dicté par la réponse de Yousign**. C'est
délibéré : un drapeau à poser à la main serait un drapeau à oublier — resté à
« trial » après le passage en payant, il priverait tout le monde du retour
automatique sans que personne ne comprenne pourquoi.

### En production (ou dès que l'abonnement autorise les redirections)

**La première tentative passe, le retour automatique fonctionne, et il n'y a
aucun code à modifier.** Le repli ne se déclenche tout simplement plus. Aucun
déploiement, aucune bascule, aucune purge : le premier contrat créé après le
changement d'abonnement en profite.

## Ce que voit l'utilisateur

`yousign.autoReturn` enregistre ce que Yousign a **accepté** — un fait constaté à
la création de la demande, jamais un réglage — et remonte jusqu'à l'écran.

| `autoReturn` | Écran de signature |
| --- | --- |
| `true` | « …vous serez ramené ici automatiquement. » |
| `false` | « Après avoir signé le contrat dans Yousign, revenez sur cette page. La signature sera détectée automatiquement. » |

On ne promet le retour que s'il aura lieu. **Le reste est identique** : le
contrat passe en attente de signature, « Voir et signer » fonctionne, aucune
erreur n'est affichée, et `/contrat` sonde de toute façon — la signature est
détectée seule dans les deux cas.

`restartSignature` remet `autoReturn` à `false` avec le reste du bloc : une
relance ne doit pas promettre un retour sur une demande qui n'existe pas encore.

## Tests

`npm run test:yousign` (121) couvre :

- reconnaissance du refus dans `detail`, dans `invalid_params`, avec champ et
  raison séparés, et après emballage en `ApiError` ;
- les cinq refus qui **ne doivent pas** déclencher le repli ;
- création avec redirections acceptées → une seule demande, `autoReturn = true`,
  aucune suppression ;
- refus Trial → repli → succès, `autoReturn = false`, 2 demandes, la 1ʳᵉ
  supprimée, la 2ᵈᵉ conservée et activée, champs de signature posés ;
- autre 400 → **aucune reprise**, erreur remontée avec son code technique, et
  demande tout de même nettoyée.

## Points d'attention

1. **Ne jamais élargir `isTrialRedirectRefusal`.** Sa valeur tient à son
   étroitesse. Un repli qui attrape trop masque de vrais bugs.
2. **Une seule reprise, jamais de boucle.** La 2ᵈᵉ tentative part sans
   redirections : si elle échoue, c'est autre chose, et ça doit remonter.
3. **`autoReturn` est un constat, pas un réglage.** Ne jamais le poser à la main
   ni l'exposer en configuration.
4. Le repli **coûte une demande Yousign supplémentaire** par contrat tant que
   l'abonnement est en Trial (créée puis supprimée). C'est le prix d'un
   comportement piloté par l'API plutôt que par un drapeau.
