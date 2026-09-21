/** Consistent success envelope for all endpoints. */
export function ok(res, data = null, meta = undefined) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export function created(res, data = null) {
  return res.status(201).json({ success: true, data });
}

export function noContent(res) {
  return res.status(204).send();
}
