// FAQ éditable (prestations / formations / accueil). Source unique de sanitation :
// questions/réponses saisies côté manager, jamais de HTML brut, bornées en taille et en nombre.

const MAX_ITEMS = 20;
const MAX_QUESTION = 200;
const MAX_ANSWER = 2000;

export function sanitizeFaqInput(value, { maxItems = MAX_ITEMS, maxQuestion = MAX_QUESTION, maxAnswer = MAX_ANSWER } = {}) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const question = String(raw.question ?? '').trim().slice(0, maxQuestion);
    const answer = String(raw.answer ?? '').trim().slice(0, maxAnswer);
    if (!question || !answer) continue;
    out.push({ question, answer });
    if (out.length >= maxItems) break;
  }
  return out;
}

export function serializeFaq(faq) {
  return (Array.isArray(faq) ? faq : [])
    .map(item => ({ question: String(item?.question ?? ''), answer: String(item?.answer ?? '') }))
    .filter(item => item.question && item.answer);
}
