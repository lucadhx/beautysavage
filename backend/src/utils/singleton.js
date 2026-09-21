/**
 * Fetch a singleton document, creating it with defaults if missing.
 * Used for Company, Theme, ManagerTheme, SiteStatus, DevCompany, etc.
 *
 * La fenêtre de concurrence théorique (deux requêtes créant chacune un
 * document sur une base vierge) est fermée par `bootstrap()`, qui pré-crée
 * TOUS les singletons au démarrage — avant que le serveur n'accepte des
 * requêtes. À l'exécution, le document existe donc toujours.
 */
export async function getSingleton(Model) {
  const existing = await Model.findOne();
  if (existing) return existing;
  return Model.create({});
}
