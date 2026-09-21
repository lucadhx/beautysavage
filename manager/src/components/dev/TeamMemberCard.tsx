import { Mail, Phone } from 'lucide-react';
import type { TeamMember } from '@/types';
import { Card, CardContent } from '@/components/ui/primitives';

/**
 * UNE PERSONNE DE L'ÉQUIPE — telle que le Panel la publie.
 *
 * ── POURQUOI CE COMPOSANT EXISTE ────────────────────────────────────────────
 * Deux écrans montrent les mêmes personnes : la page Support, que le client
 * consulte, et la page Équipe, réservée au développeur. Les écrire deux fois
 * garantissait qu'un correctif appliqué à l'un manque à l'autre — un numéro
 * affiché ici et pas là, un portrait rond d'un côté et carré de l'autre.
 *
 * ── CE QU'IL N'INVENTE PAS ──────────────────────────────────────────────────
 * Aucune valeur de repli. Un champ absent ne s'affiche pas : mieux vaut une
 * carte sans téléphone qu'un téléphone qui n'est pas le bon.
 */
export function TeamMemberCard({ member }: { member: TeamMember }) {
  const prenom = (member.firstName ?? '').trim();
  const nom = (member.lastName ?? '').trim();
  const nomComplet = [prenom, nom].filter(Boolean).join(' ');
  const initiale = (prenom || nom || '?').charAt(0).toUpperCase();
  const references = [...(member.references ?? [])].sort((a, b) => a.order - b.order);

  /**
   * Le descripteur canonique d'abord, l'URL historique ensuite. On ne
   * fabrique jamais un descripteur depuis une URL : annoncer des dimensions
   * qu'on n'a pas ferait réserver la mauvaise place.
   */
  const photo = member.photo?.url
    ? member.photo
    : (member.photoUrl ? { url: member.photoUrl, width: null, height: null } : null);

  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3">
          {photo ? (
            /* L'URL est ABSOLUE : le Panel l'a résolue en publiant, parce que
               c'est un autre serveur qui sert l'image.

               Le descripteur canonique est préféré à l'URL seule : il porte
               les DIMENSIONS, ce qui évite le saut de mise en page au
               chargement, et l'empreinte, qui change quand la photo change —
               une nouvelle adresse plutôt qu'une image ressuscitée du cache.
               Sans descripteur (Panel antérieur), on retombe sur l'URL. */
            <img
              src={photo.url}
              alt=""
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
              className="h-12 w-12 rounded-full object-cover"
              /* Un média absent ne laisse pas une icône cassée : la carte
                 retombe sur l'initiale, comme si aucune photo n'existait. */
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted font-semibold">
              {initiale}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{nomComplet || '—'}</p>
            {member.role ? (
              <p className="truncate text-sm text-muted-foreground">{member.role}</p>
            ) : null}
          </div>
        </div>

        {member.email || member.phone ? (
          <div className="mt-3 space-y-1.5 text-sm">
            {member.email ? (
              <a
                href={`mailto:${member.email}`}
                className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{member.email}</span>
              </a>
            ) : null}
            {member.phone ? (
              <a
                href={`tel:${member.phone.replace(/\s/g, '')}`}
                className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground"
              >
                <Phone className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{member.phone}</span>
              </a>
            ) : null}
          </div>
        ) : null}

        {/* Les canaux propres à la personne : ligne directe, profil, agenda. */}
        {references.length > 0 ? (
          <ul className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
            {references.map((r, i) => (
              <li key={i}>
                <MemberReference reference={r} />
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Une référence : cliquable si c'est un lien absolu, simple texte sinon. */
function MemberReference({ reference }: { reference: TeamMember['references'][number] }) {
  const valeur = (reference.value ?? '').trim();
  const contenu = (
    <span className="flex items-center gap-2 text-muted-foreground">
      <i className={`bi ${reference.icon}`} aria-hidden />
      <span className="truncate">{valeur || reference.name || '—'}</span>
    </span>
  );

  // Un lien relatif pointerait sur le site du client : on ne le rend cliquable
  // que s'il désigne vraiment une adresse externe.
  if (reference.type === 'LINK' && /^https?:\/\//i.test(valeur)) {
    return (
      <a href={valeur} target="_blank" rel="noreferrer" className="transition hover:text-foreground">
        {contenu}
      </a>
    );
  }
  return contenu;
}
