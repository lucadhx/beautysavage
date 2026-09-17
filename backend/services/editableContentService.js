import mongoose from 'mongoose';
import EditableContent from '../models/EditableContent.js';

const { Types } = mongoose;

const TARGET_VALUES = ['page', 'product', 'formation', 'legal-page'];

const PAGE_ZONE_DEFINITIONS = {
  home: [
    {
      key: 'heroTitle',
      label: 'Titre principal',
      description: "Titre du hero affiché en haut de la page d'accueil.",
      defaultContent: '<h1>Beauty Savage</h1>'
    },
    {
      key: 'heroSubtitle',
      label: 'Sous-titre hero',
      description: 'Accroche situÃ©e sous le titre principal.',
      defaultContent: '<p>Gardez le contrÃ´le sur votre vitrine et vos modules.</p>'
    },
    {
      key: 'heroBody',
      label: "Texte d'introduction",
      description: "Paragraphe de présentation avec un message d'accueil.",
      defaultContent:
        '<p>Construisez un parcours Ã©ditorial fixe, simple et sÃ©curisÃ© pour vos visiteurs.</p>'
    },
    {
      key: 'featureList',
      label: 'Liste de points forts',
      description: 'Liste des bÃ©nÃ©fices prÃ©sentÃ©s sous forme de listes Ã  puces.',
      defaultContent: '<ul><li>Modules modulaires</li><li>Mobile-first</li><li>Gestion sÃ©curisÃ©e</li></ul>'
    }
  ],
  about: [
    {
      key: 'mainText',
      label: 'Ã€ propos de nous',
      description: 'Texte principal de la page "Ã€ propos de nous".',
      defaultContent:
        '<p>Beauty Savage est un prototype pensÃ© pour aligner vitrine et gestion sans compromis.</p>'
    }
  ]
};

const LEGAL_PAGE_ZONE_DEFINITIONS = {
  'mentions-legales': [
    {
      key: 'mainText',
      label: 'Mentions lÃ©gales',
      description: 'Texte principal de la page Mentions lÃ©gales.',
      defaultContent:
        "<p>Les mentions lÃ©gales de Beauty Savage identifient l'institut, son activitÃ© et les responsables Ã©ditoriaux.</p><p>Le directeur de publication est le responsable technique en charge de la plateforme.</p>"
    }
  ],
  'politique-confidentialite': [
    {
      key: 'mainText',
      label: 'Politique de confidentialitÃ©',
      description: 'Texte principal de la page Politique de confidentialitÃ©.',
      defaultContent:
        '<p>Beauty Savage collecte uniquement les donnÃ©es nÃ©cessaires Ã  la gestion des comptes et des formations, dans le respect du RGPD.</p><p>Les informations restent confidentielles et ne sont jamais cÃ©dÃ©es Ã  des tiers sans consentement explicite.</p>'
    }
  ],
  cgv: [
    {
      key: 'mainText',
      label: 'Conditions gÃ©nÃ©rales de vente',
      description: 'Texte principal de la page Conditions gÃ©nÃ©rales de vente (CGV).',
      defaultContent:
        '<p>Les prÃ©sentes conditions rÃ©gissent lâ€™achat de prestations proposÃ©es par Beauty Savage.</p><p>Le paiement valide la commande, les dÃ©lais et les modalitÃ©s de rÃ©tractation y sont dÃ©taillÃ©s.</p>'
    }
  ]
};

const PRODUCT_ZONE_DEFINITIONS = [
  {
    key: 'description',
    label: 'Description Ã©ditoriale',
    description: 'Texte affichÃ© sur la fiche produit sous le titre.',
    defaultContent: ''
  }
];

const FORMATION_ZONE_DEFINITIONS = [
  {
    key: 'description',
    label: 'Description Ã©ditoriale',
    description: 'Texte visible sur la fiche formation au-dessus des dÃ©tails.',
    defaultContent: ''
  }
];

const ALLOWED_TAGS = new Set(['p', 'strong', 'em', 'u', 'br', 'div', 'span', 'a']);
const ALIGNABLE_TAGS = new Set(['p', 'div']);
const TAG_ALIASES = {
  b: 'strong',
  i: 'em'
};

const FONT_SIZE_CLASS_NAMES = [
  'text-small',
  'text-base',
  'text-large',
  'text-xlarge'
];
const VARIABLE_CLASS_NAMES = [
  'mail-variable',
  'mail-variable--bold',
  'mail-variable--italic',
  'mail-variable--underline'
];
const CLASSABLE_TAGS = new Set(['p', 'div', 'span', 'a']);
const ALLOWED_CLASS_NAMES = new Set([...FONT_SIZE_CLASS_NAMES, ...VARIABLE_CLASS_NAMES]);
const HREF_BLACKLIST_PREFIXES = ['javascript:', 'data:', 'vbscript:'];
const ALLOWED_LINK_TARGETS = new Set(['_blank', '_self', '_parent', '_top']);

export function sanitizeEditorialHtml(value) {
  if (!value) {
    return '';
  }
  let sanitized = String(value);
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, '');
  sanitized = sanitized.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replace(
    /<\s*\/?\s*([a-zA-Z0-9]+)([^>]*)>/g,
    (match, rawTag, attrString = '') => {
      const tag = String(rawTag || '').toLowerCase();
      const canonicalTag = TAG_ALIASES[tag] || tag;
      if (!ALLOWED_TAGS.has(canonicalTag)) {
        return '';
      }
      const closing = /^\s*<\s*\//.test(match);
      let alignAttr = '';
      if (!closing && ALIGNABLE_TAGS.has(canonicalTag)) {
        const alignMatch = attrString.match(/align\s*=\s*["']?(left|center|right|justify)["']?/i);
        const styleMatch = attrString.match(/text-align\s*:\s*(left|center|right)/i);
        if (alignMatch) {
          const value = alignMatch[1].toLowerCase();
          alignAttr = ` align="${value}"`;
        } else if (styleMatch) {
          const value = styleMatch[1].toLowerCase();
          alignAttr = ` align="${value}"`;
        }
      }
      if (closing) {
        return `</${canonicalTag}>`;
      }
      if (canonicalTag === 'br') {
        return '<br>';
      }
      const classAttrs = [];
      const dataAttrs = [];
      if (CLASSABLE_TAGS.has(canonicalTag)) {
        const classMatch = attrString.match(/class\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))/i);
        const rawClassValue = classMatch?.[1] || classMatch?.[2] || classMatch?.[3] || '';
        const allowedClasses = Array.from(
          new Set(
            rawClassValue
              .split(/\s+/)
              .map(name => name.trim())
              .filter(name => name && ALLOWED_CLASS_NAMES.has(name))
          )
        );
        if (allowedClasses.length) {
          classAttrs.push(` class="${allowedClasses.join(' ')}"`);
        }
      }
      if (canonicalTag === 'span') {
        const dataMatch = attrString.match(/data-variable\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))/i);
        const rawValue = dataMatch?.[1] || dataMatch?.[2] || dataMatch?.[3] || '';
        if (rawValue) {
          const escapedValue = rawValue.replace(/"/g, '&quot;');
          dataAttrs.push(` data-variable="${escapedValue}"`);
        }
      } else if (canonicalTag === 'a') {
        const hrefMatch = attrString.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))/i);
        const rawHref = hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || '';
        const normalizedHref = String(rawHref || '').trim();
        if (normalizedHref) {
          const lowerHref = normalizedHref.toLowerCase();
          const isBlacklisted = HREF_BLACKLIST_PREFIXES.some(prefix => lowerHref.startsWith(prefix));
          if (!isBlacklisted) {
            const escapedHref = normalizedHref.replace(/"/g, '&quot;');
            dataAttrs.push(` href="${escapedHref}"`);
          }
        }
        const targetMatch = attrString.match(/target\s*=\s*(?:"([^"]+)"|'([^']+)'|([^>\s]+))/i);
        const rawTarget = targetMatch?.[1] || targetMatch?.[2] || targetMatch?.[3] || '';
        const normalizedTarget = String(rawTarget || '').trim().toLowerCase();
        if (normalizedTarget && ALLOWED_LINK_TARGETS.has(normalizedTarget)) {
          dataAttrs.push(` target="${normalizedTarget}"`);
          if (normalizedTarget === '_blank') {
            dataAttrs.push(' rel="noreferrer noopener"');
          }
        }
      }
      return `<${canonicalTag}${alignAttr}${classAttrs.join('')}${dataAttrs.join('')}>`;
    }
  );
  return sanitized.trim();
}

function cloneDefinition(def) {
  return def ? { ...def } : null;
}

export function getZoneDefinitions(targetType, targetId) {
  if (targetType === 'page') {
    const pageZones = PAGE_ZONE_DEFINITIONS[String(targetId)] || [];
    return pageZones.map(zone => cloneDefinition(zone));
  }
  if (targetType === 'legal-page') {
    const legalZones = LEGAL_PAGE_ZONE_DEFINITIONS[String(targetId)] || [];
    return legalZones.map(zone => cloneDefinition(zone));
  }
  if (targetType === 'product') {
    return PRODUCT_ZONE_DEFINITIONS.map(zone => cloneDefinition(zone));
  }
  if (targetType === 'formation') {
    return FORMATION_ZONE_DEFINITIONS.map(zone => cloneDefinition(zone));
  }
  return [];
}

export function isValidTargetType(targetType) {
  return TARGET_VALUES.includes(targetType);
}

export function validateTargetIdentifier(targetType, targetId) {
  const normalized = String(targetId || '').trim();
  if (!normalized) {
    return false;
  }
  if (targetType === 'page') {
    return Object.prototype.hasOwnProperty.call(PAGE_ZONE_DEFINITIONS, normalized);
  }
  if (targetType === 'legal-page') {
    return Object.prototype.hasOwnProperty.call(LEGAL_PAGE_ZONE_DEFINITIONS, normalized);
  }
  if (targetType === 'product' || targetType === 'formation') {
    return Types.ObjectId.isValid(normalized);
  }
  return false;
}

export function getZoneDefinition(targetType, targetId, zoneKey) {
  const zones = getZoneDefinitions(targetType, targetId);
  if (!zoneKey) return null;
  return zones.find(zone => zone.key === zoneKey) || null;
}

export function buildContentMap(zones, entries = []) {
  const map = {};
  zones.forEach(zone => {
    map[zone.key] = zone.defaultContent || '';
  });
  for (const entry of entries) {
    if (entry?.zoneKey && Object.prototype.hasOwnProperty.call(map, entry.zoneKey)) {
      map[entry.zoneKey] = entry.contentHtml || '';
    }
  }
  return map;
}

export { TARGET_VALUES as ALLOWED_TARGET_TYPES };

export async function getEditableContent(targetType, targetId) {
  const zones = getZoneDefinitions(targetType, targetId);
  if (!zones.length) {
    return {};
  }
  const entries = await EditableContent.find({ targetType, targetId }).lean();
  return buildContentMap(zones, entries);
}



