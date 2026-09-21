# Recette réelle — webhooks transactionnels Brevo

> **⚠️ ARCHITECTURE SUPPRIMÉE — document conservé pour l'histoire.**
>
> Le webhook Brevo **local** décrit ici n'existe plus. Les e-mails de ce projet
> partent du compte Brevo **du Panel**, et les événements de livraison suivent le
> COMPTE : ils arrivent au Panel, qui les reprojette par le pont
> (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`). Il n'y a plus de route
> `/webhooks/brevo/transactional/:mode`, plus de clé Brevo locale, plus de secret
> de webhook Brevo.
>
> Chemin actuel : [INTEGRATED_API.md](INTEGRATED_API.md#brevo--e-mail) ·
> [PANEL_BRIDGE.md](PANEL_BRIDGE.md) · [PROTOCOL.md](PROTOCOL.md#incident--e-mail).


> **Aucune de ces étapes n'a été exécutée pendant le Lot 7.** Les tests automatisés
> (`npm run test:brevo-webhook`, 67 assertions) prouvent la logique **sans réseau**.
> Ils ne prouvent **rien** sur le vrai Brevo.

## Prouvé automatiquement (sans Brevo réel)

- [x] Normalisation des deux espaces de noms (config-time / payload-time).
- [x] Machine d'état déterministe : transitions, ordre inversé, régressions,
      négatifs terminaux protégés, engagement indépendant du statut.
- [x] Authentification Bearer : valide / invalide / absent / non configuré.
- [x] Idempotence : rejeu → une ligne, une transition.
- [x] Rapprochement par `messageId` + mode (chevrons tolérés), isolation TEST/PROD.
- [x] Réconciliation des non-rapprochés.
- [x] Confidentialité : pas d'e-mail en clair, pas de token d'URL, payload curé.
- [x] Sync distante : création, adoption, divergence, suppression externe, limite.
- [x] Rotation du secret : double clé, ancien accepté en fenêtre puis rejeté.

## À vérifier localement (Manager)

- [ ] Carte Brevo → section « Webhook transactionnel » : URL, statut, actions.
- [ ] Page `/dev/livraisons-email` : liste, filtres, détail, timeline.
- [ ] Responsive, badges (SENT ≠ « Remis »), avertissement d'engagement.

## À vérifier avec Brevo réel

1. [ ] Exposer une **URL HTTPS publique** (`PUBLIC_URL`, ngrok en dev).
2. [ ] Carte Brevo (mode TEST) → **Configurer** : le webhook est créé chez Brevo
       (`auth:{type:"bearer"}`, events souscrits), le secret est généré.
3. [ ] Vérifier sa présence dans le dashboard Brevo (et via **Vérifier la configuration**).
5. [ ] Envoyer un e-mail de test → observer `request`, puis `delivered`.
6. [ ] Ouvrir l'e-mail → observer `opened` (compteur, statut inchangé).
7. [ ] Cliquer un lien → observer `click` (domaine seul persisté).
8. [ ] Adresse invalide contrôlée → observer `hard_bounce`/`invalid_email`.
9. [ ] Envoyer un POST avec **token incorrect** → attendre `401` neutre.
10. [ ] **Rejouer** un payload → vérifier l'absence de doublon (une seule ligne).
11. [ ] Vérifier l'**isolation TEST/PROD** (un event TEST ne touche pas PROD).

## Rappel

`SENT` signifie **« Brevo a accepté l'envoi »**. Seul un webhook `delivered`
autorise `DELIVERED`. Aucun écran ne doit traduire `SENT` par « délivré ».
