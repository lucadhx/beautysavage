import { getCachedSystemConfiguration } from './systemConfigurationService.js';
import { stripTrailingSlash } from './systemUrlValidation.js';

// S1C — DomainResolver : SOURCE UNIQUE des URLs publiques. Résolution minimale :
//   1. SystemConfiguration.domains (vitrineUrl / panelUrl) — administrable au panel Dev.
//   2. localhost — UNIQUEMENT au premier boot, tant qu'aucun domaine n'est configuré.
// Aucune autre source : ni tunnel de dev, ni variable d'environnement de domaine.

const DEFAULT_BASE_URL = 'http://localhost:3000';

function configuredDomains() {
  return getCachedSystemConfiguration()?.domains || {};
}

/** Base de la vitrine (site public). */
export function resolveVitrineBaseUrl() {
  return stripTrailingSlash(configuredDomains().vitrineUrl || '') || DEFAULT_BASE_URL;
}

/** Base du panel (manager). À défaut de panelUrl, retombe sur la vitrine. */
export function resolvePanelBaseUrl() {
  return stripTrailingSlash(configuredDomains().panelUrl || '') || resolveVitrineBaseUrl();
}

/** Base publique « par défaut » (= vitrine) : l'hôte qui sert le backend et les pages publiques. */
export function resolvePublicBaseUrl() {
  return resolveVitrineBaseUrl();
}

function joinPath(base, path) {
  const cleanBase = stripTrailingSlash(base);
  const p = String(path || '').trim();
  return p ? `${cleanBase}/${p.replace(/^\/+/, '')}` : cleanBase;
}

/** URL absolue sur la vitrine (ex. resolveVitrineUrl('vitrine.html?page=x')). */
export function resolveVitrineUrl(path = '') {
  return joinPath(resolveVitrineBaseUrl(), path);
}

/** URL absolue sur le panel (ex. resolvePanelUrl('gestion.html?module=x')). */
export function resolvePanelUrl(path = '') {
  return joinPath(resolvePanelBaseUrl(), path);
}

/** URL absolue sur la base publique (alias vitrine). */
export function resolvePublicUrl(path = '') {
  return joinPath(resolvePublicBaseUrl(), path);
}
