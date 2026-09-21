import { asyncHandler } from './asyncHandler.js';
import { ok, created, noContent } from './apiResponse.js';
import { ApiError } from './ApiError.js';

/**
 * Generate standard CRUD controllers for a Mongoose model.
 * Options:
 *  - sort: default sort (e.g. { order: 1 })
 *  - beforeCreate/beforeUpdate: async (data, req) => data  (transform payload)
 *  - notFoundMsg
 */
export function crudFactory(Model, options = {}) {
  const {
    sort = { order: 1, createdAt: 1 },
    beforeCreate = (d) => d,
    beforeUpdate = (d) => d,
    notFoundMsg = 'Ressource introuvable',
  } = options;

  const list = asyncHandler(async (req, res) => {
    const items = await Model.find().sort(sort);
    return ok(res, items);
  });

  const getOne = asyncHandler(async (req, res) => {
    const item = await Model.findById(req.params.id);
    if (!item) throw ApiError.notFound(notFoundMsg);
    return ok(res, item);
  });

  const create = asyncHandler(async (req, res) => {
    const data = await beforeCreate(req.body, req);
    const item = await Model.create(data);
    return created(res, item);
  });

  const update = asyncHandler(async (req, res) => {
    const data = await beforeUpdate(req.body, req);
    const { _id, __v, ...clean } = data || {};
    void _id;
    void __v;
    const item = await Model.findByIdAndUpdate(req.params.id, clean, {
      new: true,
      runValidators: true,
    });
    if (!item) throw ApiError.notFound(notFoundMsg);
    return ok(res, item);
  });

  const remove = asyncHandler(async (req, res) => {
    const item = await Model.findByIdAndDelete(req.params.id);
    if (!item) throw ApiError.notFound(notFoundMsg);
    return noContent(res);
  });

  /** Reorder: body = [{ id, order }, ...] */
  const reorder = asyncHandler(async (req, res) => {
    const updates = req.body.items || [];
    await Promise.all(
      updates.map((u) => Model.findByIdAndUpdate(u.id, { order: u.order }))
    );
    const items = await Model.find().sort(sort);
    return ok(res, items);
  });

  return { list, getOne, create, update, remove, reorder };
}

export default crudFactory;
