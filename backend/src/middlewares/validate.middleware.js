/**
 * Validate `req` sections against a Zod schema map.
 * Usage: validate({ body: schema, params: schema, query: schema })
 * Parsed (and coerced) values replace the originals.
 */
export const validate = (schemas) => (req, res, next) => {
  try {
    for (const key of ['body', 'params', 'query']) {
      if (schemas[key]) {
        req[key] = schemas[key].parse(req[key]);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export default validate;
