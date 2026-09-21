import * as React from 'react';
import { Label } from '@/components/ui/primitives';

/**
 * UN SÉLECTEUR DE COULEUR — et son libellé lui est RELIÉ.
 *
 * ══ CE QUI MANQUAIT ═════════════════════════════════════════════════════════
 *
 * Le `<Label>` était posé À CÔTÉ du champ, sans `htmlFor`, et le champ n'avait
 * pas d'identifiant. Visuellement, tout allait bien : le mot « Fond » est juste
 * à gauche du carré de couleur. Au clavier et au lecteur d'écran, non — la
 * tabulation atteignait quatre champs annoncés « sélecteur de couleur », sans
 * jamais dire lequel. Sur l'écran « Thème du site », qui n'est QUE des
 * sélecteurs de couleur, cela rend l'écran inutilisable autrement qu'à la
 * souris.
 *
 * Le lien est donc explicite (`useId` + `htmlFor`), et la VALEUR est reliée par
 * `aria-describedby` : le code hexadécimal est une information, pas une
 * décoration — c'est lui qu'on relit pour vérifier qu'on a bien saisi.
 *
 * Cliquer le libellé ouvre désormais le nuancier, ce qui n'était pas le cas :
 * une cible de plus, et gratuite.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = React.useId();
  const champId = `${id}-couleur`;
  const valeurId = `${id}-valeur`;

  /**
   * UNE COULEUR ABSENTE N'EST PAS UNE COULEUR VIDE.
   *
   * `<input type="color">` n'accepte QUE `#rrggbb`. Une valeur absente — un
   * thème antérieur à l'ajout d'une teinte, un document partiellement migré —
   * lui était passée telle quelle, et le navigateur répondait par un
   * avertissement de console à chaque rendu, puis affichait du noir sans le
   * dire. On rend donc le noir EXPLICITEMENT, et le code affiché à côté
   * annonce « à définir » plutôt que de mentir sur une valeur enregistrée.
   */
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const definie = HEX.test(value ?? '');
  const pourLeChamp = definie ? value : '#000000';

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <div className="min-w-0">
        <Label htmlFor={champId} className="block truncate">{label}</Label>
        <span id={valeurId} className="font-mono text-xs uppercase text-muted-foreground">
          {definie ? value : 'à définir'}
        </span>
      </div>
      <div className="relative h-9 w-14 shrink-0 overflow-hidden rounded-md border border-border">
        <input
          id={champId}
          type="color"
          value={pourLeChamp}
          aria-describedby={valeurId}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer border-0 p-0"
          style={{ transform: 'scale(1.5)' }}
        />
      </div>
    </div>
  );
}
