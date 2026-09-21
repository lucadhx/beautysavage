# Template juridique BeautySavage

Ce fichier de travail sert a creer le template Panel du projet BeautySavage. Le site ne doit pas ecrire directement ses documents legaux en base: la vitrine sert uniquement les documents publies par le Panel via le pont `LEGAL_DOCUMENT`.

## Mentions legales

- Editeur: BeautySavage, donnees juridiques a completer depuis la fiche cliente Panel.
- Site: https://beautysavage.ly-solution.com
- Manager: https://manager.beautysavage.ly-solution.com
- Prestataire technique: L.Y Solution, selon la fiche developpeur Panel.
- Hebergement: selon la destination de deploiement Panel.
- Activites: vente de prestations esthetiques, formations a distance, formations en presentiel, cartes cadeaux et produits associes.
- Paiements: paiements clients encaisses via les cles Stripe Institut configurees dans le manager BeautySavage, distinctes des cles Stripe plateforme L.Y Solution.

## Politique de confidentialite

Inclure les traitements suivants:

- Comptes clients: identite, email, telephone, adresse de facturation, historique d'achat.
- Paniers: produits, options, quantites, sessions de formation et horodatages.
- Commandes et factures: lignes achetees, statuts de paiement, numeros de vente, factures et justificatifs.
- Formations: inscriptions, acces a distance, sessions en presentiel, progression et elements de suivi si actives.
- Paiement: identifiants techniques Stripe Institut, statuts et webhooks; aucune donnee de carte bancaire n'est stockee par le projet.
- Emailing: notifications transactionnelles et marketing, via Brevo Institut quand l'institut configure ses cles propres.
- Support et contact: messages envoyes par formulaire, suivi de traitement et reponses.
- Donnees techniques: journaux applicatifs, mesures de securite, evenements de synchronisation Panel.

Preciser les bases legales: execution du contrat pour commandes/formations/factures, obligation legale pour comptabilite, interet legitime pour securite et support, consentement pour marketing.

Preciser les droits utilisateurs: acces, rectification, effacement, opposition, limitation, portabilite et retrait du consentement marketing.

Preciser les destinataires: BeautySavage, L.Y Solution en qualite de prestataire technique, Stripe pour le paiement, Brevo pour l'email si active, hebergeur de la destination publiee.
