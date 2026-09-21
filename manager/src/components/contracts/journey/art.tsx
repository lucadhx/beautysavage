import { motion, useReducedMotion } from 'framer-motion';

/**
 * Illustrations du parcours d'activation — une par étape.
 *
 * SVG inline, jamais d'image distante : elles se colorent au thème du manager
 * (`--m-primary`) et ne coûtent aucune requête. Chacune anime UN détail (le
 * trait qui se dessine, la carte qui glisse, la fusée qui décolle) — jamais la
 * scène entière, qui deviendrait un dessin animé au lieu d'un repère.
 *
 * Toutes respectent `prefers-reduced-motion` : sans mouvement, la scène reste
 * dans son état final, lisible et complète.
 */

const P = 'var(--m-primary)';

function useAnim() {
  return !useReducedMotion();
}

/** Cadre commun : ratio stable, la scène ne saute pas d'une étape à l'autre. */
function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg
      viewBox="0 0 240 180"
      role="img"
      aria-label={label}
      className="h-full w-full"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

/** Halo de fond, commun à toutes les scènes. */
function Halo() {
  return (
    <>
      <circle cx="120" cy="90" r="72" fill={P} opacity="0.06" />
      <circle cx="120" cy="90" r="52" fill={P} opacity="0.05" />
    </>
  );
}

/* -------------------------------- Signature -------------------------------- */
/** Un document et un paraphe qui se trace. */
export function SignatureArt() {
  const animate = useAnim();
  return (
    <Frame label="Un contrat en attente de signature">
      <Halo />
      <rect x="76" y="34" width="88" height="112" rx="8" fill="var(--m-card)" stroke={P} strokeWidth="2" />
      <path d="M92 58h56M92 72h56M92 86h34" stroke={P} strokeWidth="2.5" strokeLinecap="round" opacity="0.35" />
      {/* Le paraphe se dessine : c'est l'action attendue. */}
      <motion.path
        d="M92 118c8-10 14 8 22-2s12-14 20-4 14 2 18-4"
        stroke={P}
        strokeWidth="3"
        strokeLinecap="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: 'easeInOut', delay: 0.2 }}
      />
      <path d="M92 130h56" stroke={P} strokeWidth="2" strokeLinecap="round" opacity="0.25" />
    </Frame>
  );
}

/* ------------------------------- Frais / carte ------------------------------ */
/** Une carte bancaire qui se présente. */
export function LaunchFeeArt() {
  const animate = useAnim();
  return (
    <Frame label="Règlement des frais de lancement">
      <Halo />
      <rect x="60" y="66" width="120" height="76" rx="10" fill={P} opacity="0.12" />
      <motion.g
        initial={animate ? { y: 10, opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut', delay: 0.1 }}
      >
        <rect x="52" y="48" width="120" height="76" rx="10" fill="var(--m-card)" stroke={P} strokeWidth="2" />
        <rect x="52" y="64" width="120" height="12" fill={P} opacity="0.75" />
        <rect x="64" y="92" width="30" height="8" rx="2" fill={P} opacity="0.3" />
        <rect x="64" y="106" width="52" height="6" rx="2" fill={P} opacity="0.2" />
        <circle cx="150" cy="104" r="9" fill={P} opacity="0.35" />
        <circle cx="160" cy="104" r="9" fill={P} opacity="0.55" />
      </motion.g>
    </Frame>
  );
}

/* -------------------------------- Abonnement -------------------------------- */
/** Un cycle qui tourne : le renouvellement mensuel. */
export function SubscriptionArt() {
  const animate = useAnim();
  return (
    <Frame label="Abonnement mensuel">
      <Halo />
      <rect x="84" y="52" width="72" height="76" rx="8" fill="var(--m-card)" stroke={P} strokeWidth="2" />
      <path d="M84 70h72" stroke={P} strokeWidth="2" />
      <rect x="98" y="44" width="6" height="16" rx="3" fill={P} />
      <rect x="136" y="44" width="6" height="16" rx="3" fill={P} />
      <path d="M96 84h12M116 84h12M136 84h8M96 100h12M116 100h12" stroke={P} strokeWidth="3" strokeLinecap="round" opacity="0.3" />
      {/* La flèche de renouvellement tourne lentement, une seule fois. */}
      <motion.g
        style={{ originX: '120px', originY: '90px' }}
        initial={animate ? { rotate: -120, opacity: 0 } : false}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 1, ease: 'easeOut', delay: 0.15 }}
      >
        <path
          d="M120 26a64 64 0 1 1-45 109"
          stroke={P}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="6 8"
          opacity="0.5"
        />
        <path d="M120 18l10 8-10 8" stroke={P} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </Frame>
  );
}

/* -------------------------------- Activation -------------------------------- */
/** Une fusée : la mise en ligne. */
export function ActivationArt() {
  const animate = useAnim();
  return (
    <Frame label="Mise en ligne du site">
      <Halo />
      <motion.g
        initial={animate ? { y: 8 } : false}
        animate={animate ? { y: [-4, 4, -4] } : { y: 0 }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M120 40c16 14 24 32 24 52l-24 14-24-14c0-20 8-38 24-52z"
          fill="var(--m-card)"
          stroke={P}
          strokeWidth="2"
        />
        <circle cx="120" cy="78" r="9" fill={P} opacity="0.35" />
        <path d="M96 96l-14 14 18-2M144 96l14 14-18-2" stroke={P} strokeWidth="2" strokeLinejoin="round" fill="none" />
        <motion.path
          d="M112 106h16l-8 22z"
          fill={P}
          opacity="0.6"
          initial={animate ? { scaleY: 0.7, opacity: 0.35 } : false}
          animate={animate ? { scaleY: [0.7, 1.1, 0.7], opacity: [0.35, 0.75, 0.35] } : {}}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
          style={{ originX: '120px', originY: '106px' }}
        />
      </motion.g>
      <path d="M62 146h116" stroke={P} strokeWidth="2" strokeLinecap="round" opacity="0.25" />
    </Frame>
  );
}

/* --------------------------------- Attente ---------------------------------- */
/** Le relais : la balle est dans le camp d'en face. */
export function WaitingArt() {
  const animate = useAnim();
  return (
    <Frame label="En attente de l'autre partie">
      <Halo />
      <circle cx="80" cy="90" r="18" fill="var(--m-card)" stroke={P} strokeWidth="2" />
      <path d="M80 82a5 5 0 1 1 0 10 5 5 0 0 1 0-10M70 102c2-5 6-7 10-7s8 2 10 7" stroke={P} strokeWidth="2" strokeLinecap="round" />
      <circle cx="160" cy="90" r="18" fill="var(--m-card)" stroke={P} strokeWidth="2" opacity="0.5" />
      <path d="M160 82a5 5 0 1 1 0 10 5 5 0 0 1 0-10M150 102c2-5 6-7 10-7s8 2 10 7" stroke={P} strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      {/* Trois points qui progressent de gauche à droite : le relais est passé. */}
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={106 + i * 14}
          cy="90"
          r="3.5"
          fill={P}
          initial={animate ? { opacity: 0.2 } : false}
          animate={animate ? { opacity: [0.2, 1, 0.2] } : { opacity: 0.6 }}
          transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.25, ease: 'easeInOut' }}
        />
      ))}
    </Frame>
  );
}

/* ---------------------------------- Prêt ------------------------------------ */
/** Site en ligne — état terminal. */
export function LiveArt() {
  const animate = useAnim();
  return (
    <Frame label="Site en ligne">
      <circle cx="120" cy="90" r="72" fill="#10b981" opacity="0.08" />
      <circle cx="120" cy="90" r="52" fill="#10b981" opacity="0.07" />
      <rect x="62" y="48" width="116" height="84" rx="8" fill="var(--m-card)" stroke="#10b981" strokeWidth="2" />
      <path d="M62 66h116" stroke="#10b981" strokeWidth="2" />
      <circle cx="76" cy="57" r="3" fill="#10b981" opacity="0.5" />
      <circle cx="88" cy="57" r="3" fill="#10b981" opacity="0.35" />
      <motion.path
        d="M96 96l16 16 32-34"
        stroke="#10b981"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut', delay: 0.15 }}
      />
    </Frame>
  );
}

/* -------------------------------- Préparation ------------------------------- */
/** Le contrat est encore en cours de préparation côté équipe technique. */
export function PreparationArt() {
  const animate = useAnim();
  return (
    <Frame label="Contrat en préparation">
      <Halo />
      <rect x="76" y="34" width="88" height="112" rx="8" fill="var(--m-card)" stroke={P} strokeWidth="2" />
      {[0, 1, 2, 3].map((i) => (
        <motion.rect
          key={i}
          x="92"
          y={58 + i * 16}
          height="5"
          rx="2.5"
          fill={P}
          opacity="0.3"
          initial={animate ? { width: 0 } : false}
          animate={{ width: i % 2 === 0 ? 56 : 38 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.15 * i }}
        />
      ))}
      <circle cx="150" cy="128" r="14" fill="var(--m-card)" stroke={P} strokeWidth="2" />
      <motion.path
        d="M150 121v7l5 3"
        stroke={P}
        strokeWidth="2.5"
        strokeLinecap="round"
        style={{ originX: '150px', originY: '128px' }}
        initial={false}
        animate={animate ? { rotate: 360 } : { rotate: 0 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
    </Frame>
  );
}
