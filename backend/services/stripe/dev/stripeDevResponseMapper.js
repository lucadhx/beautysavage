// services/stripe/dev/stripeDevResponseMapper.js
// Sprint F2B — Mapping résultat service → réponse HTTP du webhook Stripe Dev. Pur mapping :
// `{ status, json }` → `res.status(status).json(json)`. Garantit des statuts/payloads
// identiques à l'ancien handler (200 received, 400 signature, 500 config/erreur).

export function send(res, result) {
  const status = Number(result?.status) || 200;
  return res.status(status).json(result?.json);
}

export default { send };
