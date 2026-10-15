// Standalone entry (`@dhaam-ccrm/react/commerce`): imports only React, so it works without the widget or core installed.
export { CommerceEventError, InvalidCommerceEventError, useCommerceEvents } from './use-commerce-events.js';
export type {
  CartAbandonedFields,
  CartConvertedFields,
  CartUpdatedFields,
  CommerceCartItem,
  CommerceEventResult,
  OrderPlacedFields,
  UseCommerceEventsOptions,
  UseCommerceEventsResult,
} from './use-commerce-events.js';
