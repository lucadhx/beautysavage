## 12. Formations — structure
- **Modèle Formation** : collection ormations avec 
ame, description, price, coverImage, 	railerVideoUrl, 	ype (presentiel/distanciel), status (draft/published/disabled), ctive (compatibilité) et createdAt. Le nom reste unique côté Mongoose.
- **API gestion** (/api/gestion/formations) :
  - equireAuth(), equireMode('gestion'), equireDev forcent un accès exclusivement réservé aux comptes développement en mode gestion.
  - GET /api/gestion/formations retourne la liste complète triée par création via ormationGestionController.listFormations.
  - POST /api/gestion/formations crée un enregistrement (payload validé : nom obligatoire, type/statut limités, prix coercitif, URLs nettoyées).
  - PUT /api/gestion/formations/:id valide que l'identifiant ObjectId est conforme, met à jour les champs autorisés et renvoie l'état actualisé.
- **Module ormationManagerModule.js** : module chargé dynamiquement dans gestion.html, il expose une vue catalogue + un formulaire (sélecteurs de type/ statut) et utilise les classes existantes (module-panel, manager-section, orm-actions, module-placeholder, orm-message). Aucune couleur n'est hardcodée : la présentation repose sur ui.css et les variables thèmes.
- **Processus** : le module consomme /api/gestion/formations pour afficher les cartes, POST/PUT pour sauver les données, puis recharge la liste (lecture/écriture séparées, Mongo reste source de vérité). L'ensemble est prêt pour les étapes suivantes (affichage public, intégrations supplémentaires).
