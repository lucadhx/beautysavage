// Éditeur de FAQ réutilisable (prestation / formation / accueil). Liste de questions-réponses
// éditables : ajout, suppression, réordonnancement. Présentation épurée, tokens --bs-* only.
import './faq.css';

export interface FaqEntry {
  question: string;
  answer: string;
}

export function FaqEditor({
  value,
  onChange,
  hint,
}: {
  value: FaqEntry[];
  onChange: (faq: FaqEntry[]) => void;
  hint?: string;
}) {
  const items = value ?? [];

  const update = (index: number, patch: Partial<FaqEntry>) =>
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const add = () => onChange([...items, { question: '', answer: '' }]);
  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));
  const move = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= items.length) return;
    const copy = items.slice();
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  };

  return (
    <div className="faq-editor" data-testid="faq-editor">
      {hint ? <p className="faq-editor__hint">{hint}</p> : null}

      {items.length === 0 ? (
        <p className="faq-editor__empty">Aucune question pour le moment.</p>
      ) : (
        <ol className="faq-editor__list">
          {items.map((item, index) => (
            <li className="faq-editor__row" key={index}>
              <span className="faq-editor__num" aria-hidden="true">{index + 1}</span>
              <div className="faq-editor__fields">
                <input
                  className="cat-input"
                  placeholder="Question"
                  aria-label={`Question ${index + 1}`}
                  value={item.question}
                  onChange={(e) => update(index, { question: e.target.value })}
                />
                <textarea
                  className="cat-textarea"
                  rows={2}
                  placeholder="Réponse"
                  aria-label={`Réponse ${index + 1}`}
                  value={item.answer}
                  onChange={(e) => update(index, { answer: e.target.value })}
                />
              </div>
              <div className="faq-editor__actions">
                <button type="button" className="faq-editor__icon" aria-label="Monter" disabled={index === 0} onClick={() => move(index, -1)}>
                  <i className="bi bi-arrow-up" aria-hidden="true" />
                </button>
                <button type="button" className="faq-editor__icon" aria-label="Descendre" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  <i className="bi bi-arrow-down" aria-hidden="true" />
                </button>
                <button type="button" className="faq-editor__icon faq-editor__icon--danger" aria-label="Supprimer" onClick={() => remove(index)}>
                  <i className="bi bi-trash" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <button type="button" className="faq-editor__add" onClick={add}>
        <i className="bi bi-plus-lg" aria-hidden="true" /> Ajouter une question
      </button>
    </div>
  );
}
