export const MAX_GALLERY = 50;

export const PRICING_MODES = {
  FIXED: 'FIXED',
  QUOTE: 'QUOTE',
} as const;

/**
 * Limites de caractères des bannières promotionnelles (miroir du backend).
 * Choisies pour que la bannière tienne sur une ligne dès ~375 px :
 *  - mainText 60  : ~1 ligne lisible sur mobile, 1 phrase percutante ;
 *  - secondaryText 90 : complément court, tronqué proprement au besoin ;
 *  - ctaLabel 24  : tient dans un bouton sans casser la mise en page.
 */
export const PROMO_LIMITS = { mainText: 60, secondaryText: 90, ctaLabel: 24 } as const;
