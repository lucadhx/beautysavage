/**
 * Validation & dérivation des domaines d'une destination (P2.2 / P2.5).
 * Fonctions PURES, testables sans base. Aucun secret manipulé.
 */
import { cpError } from './errors.js';
import { PROJECT_ID } from '../../deployment-engine/config/project.profile.js';

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

/** Un hostname public valide : pas de protocole, pas de chemin, pas de port, pas local. */
export function isValidPublicHostname(h) {
  if (typeof h !== 'string' || !h) return false;
  if (/[/:\s]/.test(h)) return false; // ni protocole, ni port, ni chemin, ni espace
  if (LOCAL_HOSTS.has(h.toLowerCase())) return false;
  return HOSTNAME_RE.test(h);
}

/** Une URL publique valide : https:// + hostname public (pas de localhost). */
export function isValidPublicHttpsUrl(u) {
  if (typeof u !== 'string' || !u) return false;
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  return isValidPublicHostname(parsed.hostname);
}

/**
 * Dérive les domaines par convention à partir de l'hôte de la vitrine.
 * Ne dérive PAS deux fois : les hostnames explicitement fournis priment.
 */
export function deriveHostnames({ siteHostname, managerHostname, apiHostname }) {
  const site = String(siteHostname || '').trim().toLowerCase();
  return {
    siteHostname: site,
    managerHostname: (managerHostname || `manager.${site}`).trim().toLowerCase(),
    apiHostname: (apiHostname || `api.${site}`).trim().toLowerCase(),
  };
}

/** URLs canoniques HTTPS à partir des hostnames. */
export function urlsFromHostnames({ siteHostname, managerHostname, apiHostname }) {
  return {
    siteUrl: `https://${siteHostname}`,
    managerUrl: `https://${managerHostname}`,
    apiUrl: `https://${apiHostname}`,
  };
}

/**
 * Valide et NORMALISE l'entrée d'une destination. Lève ControlPlaneError sur
 * violation d'invariant. Retourne l'objet complet (hostnames + urls) prêt à persister.
 * @returns {{projectKey,name,targetEnvironment,siteHostname,managerHostname,apiHostname,siteUrl,managerUrl,apiUrl,backendPort,...}}
 */
export function validateTargetInput(input = {}) {
  const { projectKey = PROJECT_ID, name, targetEnvironment, backendPort } = input;

  if (!name || typeof name !== 'string') throw cpError('DEPLOYMENT_TARGET_INVALID', 'Nom de destination requis.');
  if (!['TEST', 'PROD'].includes(targetEnvironment)) throw cpError('DEPLOYMENT_TARGET_INVALID', 'targetEnvironment doit valoir TEST ou PROD.');

  const hostnames = deriveHostnames(input);
  for (const [k, h] of Object.entries(hostnames)) {
    if (!isValidPublicHostname(h)) throw cpError('DEPLOYMENT_TARGET_INVALID', `Hostname invalide (${k}) : "${h}" (ni protocole, ni chemin, ni local).`, { field: k });
  }
  const distinct = new Set(Object.values(hostnames));
  if (distinct.size !== 3) throw cpError('DEPLOYMENT_TARGET_INVALID', 'Les trois hostnames (site, manager, api) doivent être DISTINCTS.');

  const urls = urlsFromHostnames(hostnames);
  for (const [k, u] of Object.entries(urls)) {
    if (!isValidPublicHttpsUrl(u)) throw cpError('DEPLOYMENT_TARGET_INVALID', `URL publique invalide (${k}) : "${u}" (https + hôte public requis).`, { field: k });
  }

  const port = Number(backendPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw cpError('DEPLOYMENT_TARGET_INVALID', `backendPort invalide : ${backendPort}.`);

  return {
    projectKey: String(projectKey),
    name: name.trim(),
    targetEnvironment,
    ...hostnames,
    ...urls,
    backendPort: port,
    server: input.server || undefined,
    dnsProvider: input.dnsProvider ?? null,
    dnsZone: input.dnsZone ?? null,
    remoteRoot: input.remoteRoot || '/var/www',
    dbName: input.dbName ?? null,
  };
}

/** Vérifie qu'un remotePath reste SOUS remoteRoot (pas de traversée de chemin). */
export function assertReleasePathUnder(remotePath, remoteRoot) {
  const norm = String(remotePath || '').replace(/\\/g, '/');
  const root = String(remoteRoot || '/var/www').replace(/\/+$/, '');
  if (norm.includes('..') || !norm.startsWith(`${root}/`)) {
    throw cpError('DEPLOYMENT_RELEASE_PATH_INVALID', `Chemin de release hors du répertoire autorisé : "${remotePath}" (attendu sous ${root}/).`);
  }
  return norm;
}

export default { isValidPublicHostname, isValidPublicHttpsUrl, deriveHostnames, urlsFromHostnames, validateTargetInput, assertReleasePathUnder };
