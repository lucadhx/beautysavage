import * as React from 'react';
import { Search, Tag, AlignLeft } from 'lucide-react';
import { api, type ProductSeoPreview } from '@/lib/api';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { GooglePreview } from '@/pages/SeoPage';
import { ToneSection } from './editorTones';

/**
 * RÉFÉRENCEMENT D'UNE FICHE — automatique, et remplaçable.
 *
 * Laissés vides, le titre et la description Google sont composés à partir de
 * la fiche (nom, type, durée, prix, lieu, prochaine session…) et suivent donc
 * chaque modification. Remplis, ils prennent la main. L'aperçu montre le
 * résultat tel qu'il apparaîtra dans les résultats de recherche.
 */
export function ProductSeoSection({
  productId,
  seo,
  onChange,
}: {
  productId?: string | null;
  seo?: { metaTitle?: string; metaDescription?: string } | null;
  onChange: (seo: { metaTitle: string; metaDescription: string }) => void;
}) {
  const [preview, setPreview] = React.useState<ProductSeoPreview | null>(null);
  const metaTitle = seo?.metaTitle || '';
  const metaDescription = seo?.metaDescription || '';

  React.useEffect(() => {
    if (!productId) return;
    api.productSeoPreview(productId).then(setPreview).catch(() => setPreview(null));
  }, [productId]);

  const count = (text: string, max: number) => (
    <span className={`text-[11px] tabular-nums ${text.length > max ? 'text-amber-600' : 'text-muted-foreground'}`}>
      {text.length ? `${text.length} / ${max}` : 'automatique'}
    </span>
  );

  return (
    <ToneSection
      tone="advanced"
      level="nested"
      icon={<Search className="h-4 w-4" />}
      title="Référencement (Google et assistants IA)"
      description="Automatique : titre et description sont composés à partir de la fiche. Ne remplissez ces champs que pour les remplacer."
    >
      <div data-testid="product-seo">
        <GooglePreview
          url={preview?.url || '…/catalogue/…'}
          title={metaTitle || preview?.autoTitle || 'Titre composé à l’enregistrement'}
          description={metaDescription || preview?.autoDescription || 'Description composée à partir de la fiche.'}
        />
        {preview && !preview.published && <p className="mt-2 text-xs text-amber-700">Fiche non publiée : elle n’apparaîtra dans Google qu’une fois publiée.</p>}
      </div>
      <div className="grid gap-3">
        <Field label="Titre Google" unit="facultatif" icon={<Tag />}>
          <Input value={metaTitle} maxLength={120} placeholder={preview?.autoTitle} onChange={(e) => onChange({ metaTitle: e.target.value, metaDescription })} />
        </Field>
        <div className="-mt-2 flex justify-end">{count(metaTitle, 65)}</div>
        <Field label="Description Google" unit="facultatif" icon={<AlignLeft />}>
          <Textarea value={metaDescription} maxLength={320} placeholder={preview?.autoDescription} onChange={(e) => onChange({ metaTitle, metaDescription: e.target.value })} />
        </Field>
        <div className="-mt-2 flex justify-end">{count(metaDescription, 160)}</div>
      </div>
    </ToneSection>
  );
}
