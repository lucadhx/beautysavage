export const ACTIVE_REFUND_REQUEST_STATUSES = Object.freeze(['requested', 'pending', 'succeeded']);
export const INACTIVE_REFUND_REQUEST_STATUSES = Object.freeze(['failed', 'canceled']);
export const REFUND_REQUEST_STATUSES = Object.freeze([
  ...ACTIVE_REFUND_REQUEST_STATUSES,
  ...INACTIVE_REFUND_REQUEST_STATUSES
]);

export const REFUND_REQUEST_ACTIVE_UNIQUE_INDEX_NAME = 'uniq_active_refundrequest_sale_item';

export function isActiveRefundRequestStatus(value) {
  return ACTIVE_REFUND_REQUEST_STATUSES.includes(String(value || '').trim().toLowerCase());
}
