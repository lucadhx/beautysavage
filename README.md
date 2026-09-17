# BeautySavage

Instance autonome de BeautySavage : vitrine e-commerce, espace client,
formations, réservations et manager d'institut. Le socle est isolé de
`ly-solution` et utilise la base MongoDB `beautysavage-database`.

## Démarrage

```powershell
cd beautysavage
npm run install
npm run build
npm run seed
npm run dev
```

La vitrine est servie sous `/app/` et le manager sous `/manager/`.
Le compte de test est `dev@beautysavage.ly-solution.com` avec le mot de
passe demandé `123pass!`. Il est exclusivement prévu pour l'environnement
TEST.

## Panel L.Y Solution

1. Déclarer BeautySavage dans le panel avec l'environnement **TEST** et générer
   un code d'appairage.
2. Renseigner `PANEL_BASE_URL` et `PANEL_PAIRING_CODE` dans
   `backend/.env`.
3. Exécuter `npm run pair:panel`.
4. Vérifier ensuite avec `npm run panel:heartbeat`.

Le connecteur répond sur `/api/project-bridge/v1`. Son jeton est chiffré au
repos avec `CREDENTIAL_VAULT_KEY`, et ne passe ni dans les logs ni dans les
réponses API. Les webhook URLs publiées sont distinctes :

- Stripe institut : `/api/stripe/webhook`
- Stripe plateforme : `/api/stripe/dev-webhook`
- Brevo : `/api/webhooks/brevo`

Le compte Stripe institut est configuré dans l'IntegratedAPI de l'instance.
Le compte Stripe plateforme reste un périmètre distinct ; il ne doit jamais
être remplacé par les identifiants de l'institut.

## Données et documents

Les seeds sont idempotents et chargent prestations, formations distancielles,
modules, évaluations et le compte de test. Le cahier des charges copié à la
création est disponible dans `docs/beautysavage-source/refonte/`.
