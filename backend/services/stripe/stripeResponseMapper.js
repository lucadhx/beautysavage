// services/stripe/stripeResponseMapper.js
// Sprint F2 — Mapping résultat service → réponse HTTP Stripe. Centralise la forme des
// réponses pour garantir des statuts/payloads IDENTIQUES après extraction. Pur mapping :
// `{ status, json }` → `res.status(status).json(json)` ; `{ status, send }` →
// `res.status(status).send(send)` (les réponses webhook utilisent `res.send(texte)`).

export function send(res, result) {
  const status = Number(result?.status) || 200;
  if (result && Object.prototype.hasOwnProperty.call(result, 'send')) {
    return res.status(status).send(result.send);
  }
  return res.status(status).json(result?.json);
}

export default { send };
