import { useQuery } from '@tanstack/react-query';
import { Accordion, SectionHeader } from '@bs/ui';
import { getHomeSettings } from '@bs/api-client';

// FAQ d'accueil : UNIQUEMENT les questions gérées depuis le manager (HomePageSettings.faq).
// Aucune question en dur : si l'institut n'a rien saisi, la section n'apparaît pas.
export function HomeFaq() {
  const { data } = useQuery({
    queryKey: ['home', 'settings'],
    queryFn: ({ signal }) => getHomeSettings(signal),
    staleTime: 300_000,
  });

  const items = (data?.faq ?? [])
    .filter((f) => f.question && f.answer)
    .map((f, i) => ({ id: `faq-${i}`, title: f.question, content: f.answer }));

  if (!items.length) return null;

  return (
    <section className="home-section" aria-label="Questions fréquentes">
      <SectionHeader title="Questions fréquentes" />
      <Accordion items={items} defaultOpen={[items[0].id]} />
    </section>
  );
}
