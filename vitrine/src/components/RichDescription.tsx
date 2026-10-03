import * as React from 'react';
import { isHtml, sanitizeRichText } from '@/lib/richText';

/**
 * LA DESCRIPTION D'UNE OFFRE, avec la mise en forme saisie au Manager.
 * Voir `lib/richText.ts` : on garde gras, italique, listes et paragraphes,
 * pas les polices du logiciel d'où le texte a été collé.
 */
export function RichDescription({ value, className = '', style }: { value?: string; className?: string; style?: React.CSSProperties }) {
  const html = React.useMemo(() => (isHtml(value) ? sanitizeRichText(value || '') : ''), [value]);
  if (!value?.trim()) return null;
  if (!html) {
    return <div className={`whitespace-pre-line ${className}`} style={style} data-testid="product-description">{value}</div>;
  }
  // eslint-disable-next-line react/no-danger
  return <div className={`v-prose ${className}`} style={style} data-testid="product-description" dangerouslySetInnerHTML={{ __html: html }} />;
}
