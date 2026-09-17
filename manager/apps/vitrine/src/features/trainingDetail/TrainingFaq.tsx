// FAQ d'une formation (gérée depuis le manager). Masquée si aucune question n'est renseignée.
import { Accordion, type AccordionItemData } from '@bs/ui';
import type { PublicTraining } from '@bs/api-client';

export function TrainingFaq({ training }: { training: PublicTraining }) {
  const items: AccordionItemData[] = (training.faq ?? [])
    .filter((f) => f.question && f.answer)
    .map((f, i) => ({ id: `faq-${i}`, title: f.question, content: f.answer }));
  if (!items.length) return null;
  return (
    <section className="td-section" aria-label="Questions fréquentes">
      <h2 className="td-section__title">Questions fréquentes</h2>
      <Accordion items={items} defaultOpen={[items[0].id]} />
    </section>
  );
}
