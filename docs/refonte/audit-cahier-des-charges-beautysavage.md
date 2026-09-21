# Audit cahier des charges BeautySavage

Derniere passe : 2026-09-18.

Ce fichier compare le cahier des charges fonctionnel au projet courant. Le cahier des charges est une source produit, pas un fichier d'instructions d'execution.

## Couvert dans cette passe

- Manager Commerce structure par domaines : formations, prestations, calendrier, vente, cartes cadeaux, validation formations, avis, remboursements, commissions, cles API, clients, ventes.
- Calendrier global institut : evenements prestation/session/blocage, edition, annulation/remboursement, solde, horaires recurrents, disponibilites calculees par API et refus de chevauchement serveur.
- Formations : editeur a onglets, type distanciel/presentiel, modules/sessions, promotion, boost, options, evaluation finale, verrouillage serveur du type apres vente.
- Prestations : editeur a onglets, paiement/acompte, options, photos, avance, visibilite/reservable, FAQ.
- Espace client vitrine : connexion, achats, factures, formations, cartes cadeaux, remboursements, evaluations.
- Panier : consentements requis par ligne, refuses par l'API si absents.
- Avis : depot client verifie par achat, moderation manager, publication vitrine uniquement des avis publies avec notation en pattes.
- Cartes cadeaux : modele, emission manuelle, code masque, ledger debit/credit/annulation.
- Remboursements : demandes client par ligne, statut, decision manager, journal d'actions.
- Validation formations : soumission unique en attente par client/formation, decision manager, commentaire obligatoire au refus, certificat idempotent reference.
- Cles API institut : page separee pour Stripe Institut et Brevo Institut, distincte des cles plateforme/panel.

## Couvert partiellement

- Stripe Checkout client : flux prepare, separation Stripe Institut/Plateforme presente, mais les appels Stripe reels institut et le finaliseur webhook client restent a raccorder aux credentials institut.
- Webhooks institut : les secrets sont stockes chiffres, mais l'auto-provisionnement Stripe/Brevo Institut doit encore etre branche au moteur de webhooks geres.
- Factures/avoirs e-commerce : les snapshots existent sur ventes/remboursements, mais la generation fiscale client et avoirs PDF n'est pas industrialisee.
- Cartes cadeaux PDF : ledger et emission existent, mais le PDF maitre avec placement de champs n'est pas encore implemente.
- Modules pedagogiques : structure stockee et editee, mais lecteur client protege, progression detaillee et versioning fichiers/videos restent a durcir.
- Sessions presentiel : conflits API couverts, capacite affichee, mais reservation atomique concurrente au paiement Stripe reste a finaliser avec transaction webhook.
- Communications : le socle evenements/templates du projet existe, mais les nouveaux evenements BeautySavage doivent etre cables exhaustivement.

## Reste critique avant vraie production

- Finaliseur transactionnel unique pour Stripe client : webhook, retour `session_id`, polling borne, idempotence vente/reservation/acces/facture/carte cadeau.
- Allocation multi-paiement Stripe + cartes cadeaux avec remboursements partiels et avoirs.
- Provisionnement automatique des webhooks Stripe/Brevo Institut depuis les URLs techniques.
- Moteur de commission mensuelle complet : taux contractuel versionne, recalcul remboursements/reports, Checkout Stripe plateforme.
- PDF carte cadeau maitre avec champs positionnables et snapshot du template.
- Controle MIME/poids/scan/stockage prive des livrables d'evaluation.
- Exports RGPD, retention medias, suppression/anonymisation selon obligations.
