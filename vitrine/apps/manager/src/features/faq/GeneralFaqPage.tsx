// Page manager : gestion de la FAQ générale affichée sur l'accueil (HomePageSettings.faq).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getHomeFaq, saveHomeFaq, type HomeFaqItem } from '@bs/api-client';
import { FaqEditor } from './FaqEditor';
import './faq.css';

export function GeneralFaqPage() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['home-faq'], queryFn: ({ signal }) => getHomeFaq(signal), staleTime: 30_000 });
  const [faq, setFaq] = useState<HomeFaqItem[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (query.data && !dirty) setFaq(query.data);
  }, [query.data, dirty]);

  const mutation = useMutation({
    mutationFn: (items: HomeFaqItem[]) => saveHomeFaq(items),
    onSuccess: (saved) => {
      setFaq(saved);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['home-faq'] });
    },
  });

  const onChange = (next: HomeFaqItem[]) => {
    setFaq(next);
    setDirty(true);
  };

  const submit = () =>
    mutation.mutate(faq.filter((f) => f.question.trim() && f.answer.trim()));

  return (
    <section className="faq-page">
      <header className="faq-page__head">
        <div className="faq-page__titles">
          <h1 className="faq-page__title">FAQ de l’accueil</h1>
          <p className="faq-page__subtitle">Questions fréquentes affichées sur la page d’accueil de la vitrine.</p>
        </div>
        <button type="button" className="faq-page__save" disabled={mutation.isPending || !dirty} onClick={submit}>
          {mutation.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </header>

      {mutation.isSuccess && !dirty ? <span className="faq-page__status">Modifications enregistrées.</span> : null}
      {mutation.isError ? <span className="faq-page__error">Échec de l’enregistrement — réessayez.</span> : null}

      {query.isPending ? (
        <p className="faq-page__subtitle">Chargement…</p>
      ) : (
        <FaqEditor
          value={faq}
          onChange={onChange}
          hint="Ces questions apparaissent dans la section « Questions fréquentes » de l’accueil."
        />
      )}
    </section>
  );
}
