import type { SignatureZone, SignerRole } from '@/types';

/**
 * Opérations sur les zones de signature — module PUR (aucun import runtime,
 * aucun DOM), donc testable directement sous Node.
 *
 * Les coordonnées sont des RATIOS normalisés (0–1) relatifs à la page : elles
 * ne dépendent ni du zoom ni de la taille d'écran. Toute opération doit donc
 * raisonner en ratios et garantir que la zone reste DANS la page.
 */

export const ROLE_COLOR: Record<SignerRole, string> = { DEVELOPER: '#7c3aed', CLIENT: '#2563eb' };
export const ROLE_LABEL: Record<SignerRole, string> = { DEVELOPER: 'Développeur', CLIENT: 'Client' };

/** Décalage appliqué à une copie pour qu'elle ne se superpose pas à l'original. */
export const DUPLICATE_OFFSET = 0.03;

export function uid(): string {
  return `z-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultZoneName(role: SignerRole): string {
  return `Signature ${ROLE_LABEL[role]}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Ramène une zone dans les limites de la page, sans jamais la déformer :
 * on déplace, on ne redimensionne pas (une zone de signature a une taille
 * choisie, la rogner silencieusement serait pire que la décaler).
 */
export function clampZone(zone: SignatureZone): SignatureZone {
  const widthRatio = Math.min(zone.widthRatio, 1);
  const heightRatio = Math.min(zone.heightRatio, 1);
  return {
    ...zone,
    widthRatio,
    heightRatio,
    xRatio: clamp01(Math.min(zone.xRatio, 1 - widthRatio)),
    yRatio: clamp01(Math.min(zone.yRatio, 1 - heightRatio)),
  };
}

/**
 * Duplique une zone : même page, mêmes dimensions, même signataire, nouvel
 * identifiant, léger décalage pour la distinguer.
 *
 * Si le décalage ferait sortir la copie de la page, on décale dans l'autre
 * sens plutôt que de la coller au bord — sinon dupliquer une zone en bas à
 * droite produirait deux rectangles superposés, donc un clic sans effet visible.
 */
export function duplicateZone(zone: SignatureZone): SignatureZone {
  const fitsRight = zone.xRatio + zone.widthRatio + DUPLICATE_OFFSET <= 1;
  const fitsBelow = zone.yRatio + zone.heightRatio + DUPLICATE_OFFSET <= 1;
  const dx = fitsRight ? DUPLICATE_OFFSET : -DUPLICATE_OFFSET;
  const dy = fitsBelow ? DUPLICATE_OFFSET : -DUPLICATE_OFFSET;
  return clampZone({
    ...zone,
    id: uid(),
    xRatio: zone.xRatio + dx,
    yRatio: zone.yRatio + dy,
  });
}

/**
 * Change le signataire d'une zone. Le nom suit le rôle s'il n'a pas été
 * personnalisé : sinon le libellé mentirait (« Signature Développeur » sur une
 * zone client). Un nom saisi à la main est respecté.
 */
export function changeZoneRole(zone: SignatureZone, role: SignerRole): SignatureZone {
  const wasDefault = zone.name === defaultZoneName(zone.signerRole) || !zone.name;
  return {
    ...zone,
    signerRole: role,
    name: wasDefault ? defaultZoneName(role) : zone.name,
  };
}

export function createZone(page: number, role: SignerRole): SignatureZone {
  return {
    id: uid(),
    name: defaultZoneName(role),
    signerRole: role,
    page,
    xRatio: 0.1,
    yRatio: 0.1,
    widthRatio: 0.22,
    heightRatio: 0.07,
    type: 'SIGNATURE',
  };
}

/** Les deux rôles doivent avoir au moins une zone (exigé à la validation). */
export function missingRoles(zones: SignatureZone[]): SignerRole[] {
  return (['DEVELOPER', 'CLIENT'] as SignerRole[]).filter((r) => !zones.some((z) => z.signerRole === r));
}

/** Comparaison structurelle pour l'état « modifications non enregistrées ». */
export function zonesEqual(a: SignatureZone[], b: SignatureZone[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (zs: SignatureZone[]) =>
    JSON.stringify(
      [...zs]
        .sort((x, y) => x.id.localeCompare(y.id))
        .map((z) => [z.id, z.name, z.signerRole, z.page, z.xRatio, z.yRatio, z.widthRatio, z.heightRatio, z.type])
    );
  return norm(a) === norm(b);
}
