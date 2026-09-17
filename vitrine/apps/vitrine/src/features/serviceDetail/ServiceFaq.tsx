import { Accordion, type AccordionItemData } from '@bs/ui';
import type { PublicService } from '@bs/api-client';

// FAQ prestation : UNIQUEMENT les questions gérées depuis le manager. Aucune question en dur :
// si l'institut n'a rien saisi, la section n'apparaît pas.
export function ServiceFaq({ service }: { service: PublicService }) {
  const items: AccordionItemData[] = (service.faq ?? [])
    .filter((f) => f.question && f.answer)
    .map((f, i) => ({ id: `faq-${i}`, title: f.question, content: f.answer }));
  if (!items.length) return null;
  return (
    <section className="sd-section" aria-label="Questions fréquentes">
      <h2 className="sd-section__title">Questions fréquentes</h2>
      <Accordion items={items} defaultOpen={[items[0].id]} />
    </section>
  );
}
