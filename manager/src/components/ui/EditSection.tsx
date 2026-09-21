import * as React from 'react';
import { Field, Input } from '@/components/ui/primitives';

/**
 * LES DEUX BRIQUES PARTAGÉES PAR LES TROIS FICHES D'ÉDITION.
 *
 * ══ POURQUOI ELLES VIVENT ICI ET NON DANS L'UNE DES PAGES ═══════════════════
 *
 * Elles ont d'abord été écrites dans `RaceEventEditPage`, et les fiches tracé
 * et kart les y importaient. Ça compile — et c'est un piège : importer un
 * composant depuis une PAGE fait entrer cette page entière dans le paquet de
 * l'autre. Ouvrir la fiche d'un kart téléchargeait alors l'éditeur d'épreuve,
 * ses tableaux, son sélecteur de dates et son champ PDF, pour deux titres de
 * section.
 *
 * Un module partagé ne coûte rien à personne et se laisse importer sans
 * traîner de dépendance derrière lui.
 */

/** L'en-tête d'une section de formulaire — un titre, parfois une explication. */
export function SectionTitre({
  titre, aide, icone: Icone,
}: {
  titre: string;
  aide?: string;
  icone?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {Icone && <Icone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        {titre}
      </h2>
      {aide && <p className="mt-0.5 text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}

/**
 * UN NOMBRE FACULTATIF — le vide reste vide, et ne devient JAMAIS zéro.
 *
 * `0 équipe max.` ou `0 virage` s'afficheraient sur la fiche publique comme des
 * données, et elles seraient fausses. Tous les modèles karting distinguent donc
 * `null` (non renseigné, ligne masquée) de `0` (une vraie valeur) — encore
 * faut-il que le formulaire ne les confonde pas, ce que fait `Number('')`, qui
 * vaut `0`.
 */
export function NombreField({
  label, value, onChange, className, placeholder = '—', step,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  className?: string;
  placeholder?: string;
  step?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Field>
  );
}
