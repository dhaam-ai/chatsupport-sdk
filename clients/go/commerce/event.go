package commerce

import (
	"fmt"
	"math"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/chatapi"
)

// Client-side caps, published in openapi/chat-api.yaml's CommerceCartItem
// and CartUpdatedEvent schemas and enforced there as "reject, not clamp":
// a 501st entry is refused outright, never silently truncated to 500.
//
// They are mirrored here so a caller hits the same refusal locally, before
// a non-ASCII product catalog worth of JSON makes the round trip only to be
// turned away. They are exported so a caller with a larger catalog can chunk
// it against the real number instead of a copy of it.
//
// Every OTHER per-field bound the schema states — the EventID, CustomerID,
// OrderID, Merchant, Category and CartID maximum lengths, OccurredAt's
// five-minute future clock-skew tolerance, Quantity's 1..100000 range,
// Value and UnitPrice's >= 0 minimum — is deliberately NOT duplicated here.
// This package checks that required fields are present and that numbers are
// finite, plus the three caps below; the server stays the authority on the
// rest.
const (
	// MaxItems is the most line items one cart.updated snapshot may carry.
	MaxItems = 500
	// MaxItemNameLength is the longest [Item] Name the server accepts.
	MaxItemNameLength = 300
	// MaxItemSKULength is the longest [Item] SKU the server accepts.
	MaxItemSKULength = 64
)

// EventType is the wire tag of a commerce event: the value that lands in the
// request body's "type" field and comes back on [Result].
type EventType string

// The six event types, in the two lifecycles they belong to.
const (
	EventTypeOrderPlaced    EventType = "order.placed"
	EventTypeOrderCompleted EventType = "order.completed"
	EventTypeOrderCancelled EventType = "order.cancelled"
	EventTypeCartUpdated    EventType = "cart.updated"
	EventTypeCartAbandoned  EventType = "cart.abandoned"
	EventTypeCartConverted  EventType = "cart.converted"
)

// An Event is one of the six order or cart events this package can record:
// [OrderPlaced], [OrderCompleted], [OrderCancelled], [CartUpdated],
// [CartAbandoned] or [CartConverted].
//
// The interface is sealed — its second method is unexported, so those six
// types are the only implementations that can ever exist. That is what makes
// a type switch over an Event exhaustive, and it is why
// [Client.RecordCommerceEvent] can promise that anything reaching the wire
// was assembled by this package rather than hand-built from chatapi's
// all-variants-at-once union.
type Event interface {
	// Type reports the event's wire tag, without a type switch — the field a
	// retry queue or a dead-letter log wants.
	Type() EventType

	// commerceEvent validates the event and converts it to the generated
	// union. Unexported to seal the interface.
	commerceEvent() (chatapi.CommerceEvent, error)
}

// Float64 returns a pointer to v, for the optional Value field on
// [OrderPlaced] — Go cannot take the address of a literal, and 0 is a legal
// order value, so absence there cannot be spelled as the zero value.
//
//	commerce.OrderPlaced{Value: commerce.Float64(159.99), ...}
func Float64(v float64) *float64 { return &v }

// An Item is one line in a [CartUpdated] snapshot.
//
// Quantity and UnitPrice are bounded server-side (1..100000 and >= 0
// respectively) and not checked here beyond being finite — note that Go's
// zero value for Quantity is 0, which the server refuses with
// 400 VALIDATION_ERROR.
type Item struct {
	// Name is the line item's display name. Required, at most
	// [MaxItemNameLength] characters.
	Name string
	// Quantity is how many of this item the cart holds.
	Quantity int
	// UnitPrice is the price of one of this item.
	UnitPrice float64
	// SKU is the merchant's own stock identifier. Optional, at most
	// [MaxItemSKULength] characters; the empty string means absent.
	SKU string
}

// OrderPlaced records that a customer checked out — order.placed.
//
// Increments totalOrders and updates lastOrderMerchant, lastOrderCategory
// and lastOrderAt. Value here is audit-only and never moves totalSpend; only
// [OrderCompleted] does that. If CartID names a LIVE cart, that cart is
// transitioned to CONVERTED as a side effect, exactly as an explicit
// [CartConverted] for it would; a CartID with no matching row is a silent
// no-op rather than a 404.
type OrderPlaced struct {
	// EventID is the caller's idempotency key. Required. After a rejection,
	// resend this same value — see the package doc on release-on-reject.
	EventID string
	// OccurredAt is when this happened, not when it is being sent. Required;
	// sent as UTC. More than five minutes in the future is a 400. There is no
	// lower bound: a backdated correction is legitimate.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper — the same
	// value passed as userId to POST /tokens. Required. It is the only field
	// that binds an event to a contact, and it resolves-or-creates one.
	CustomerID string
	// OrderID is the merchant's own order identifier. Required.
	OrderID string
	// Merchant is optional context for the agent; empty means absent.
	Merchant string
	// Category is optional context for the agent; empty means absent.
	Category string
	// CartID optionally ties this order back to the cart it came from, which
	// converts that cart. Empty means absent.
	CartID string
	// Value is the optional order total, audit-only on this event type. Use
	// [Float64]; nil means absent.
	Value *float64
}

// Type reports [EventTypeOrderPlaced].
func (e OrderPlaced) Type() EventType { return EventTypeOrderPlaced }

func (e OrderPlaced) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("orderId", e.OrderID); err != nil {
		return zero, err
	}
	if e.Value != nil {
		if err := requireFinite("value", *e.Value); err != nil {
			return zero, err
		}
	}
	return chatapi.NewOrderPlacedEventCommerceEvent(chatapi.OrderPlacedEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeOrderPlaced),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		OrderID:    e.OrderID,
		Merchant:   optString(e.Merchant),
		Category:   optString(e.Category),
		CartID:     optString(e.CartID),
		Value:      optFloat64(e.Value),
	}), nil
}

// OrderCompleted records that an order shipped and was confirmed —
// order.completed.
//
// The only event whose Value moves an aggregate: it is applied to totalSpend
// and folded into the server-derived averageOrderValue.
type OrderCompleted struct {
	// EventID is the caller's idempotency key. Required.
	EventID string
	// OccurredAt is when this happened. Required; sent as UTC.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper. Required.
	CustomerID string
	// OrderID is the merchant's own order identifier, the same one the
	// [OrderPlaced] event carried. Required.
	OrderID string
	// Value is the completed order's total. Required here, unlike on
	// [OrderPlaced]: this is the number that moves totalSpend. 0 is a legal
	// value, so this field is checked only for being finite.
	Value float64
	// Merchant is optional context for the agent; empty means absent.
	Merchant string
	// Category is optional context for the agent; empty means absent.
	Category string
}

// Type reports [EventTypeOrderCompleted].
func (e OrderCompleted) Type() EventType { return EventTypeOrderCompleted }

func (e OrderCompleted) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("orderId", e.OrderID); err != nil {
		return zero, err
	}
	if err := requireFinite("value", e.Value); err != nil {
		return zero, err
	}
	return chatapi.NewOrderCompletedEventCommerceEvent(chatapi.OrderCompletedEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeOrderCompleted),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		OrderID:    e.OrderID,
		Value:      e.Value,
		Merchant:   optString(e.Merchant),
		Category:   optString(e.Category),
	}), nil
}

// OrderCancelled records that an order was cancelled, refunded or never
// shipped — order.cancelled.
//
// Increments cancelledOrders only. It deliberately does not touch
// lastOrderMerchant, lastOrderCategory or lastOrderAt, so "last order" always
// names an order that actually happened.
type OrderCancelled struct {
	// EventID is the caller's idempotency key. Required.
	EventID string
	// OccurredAt is when this happened. Required; sent as UTC.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper. Required.
	CustomerID string
	// OrderID is the merchant's own order identifier. Required.
	OrderID string
}

// Type reports [EventTypeOrderCancelled].
func (e OrderCancelled) Type() EventType { return EventTypeOrderCancelled }

func (e OrderCancelled) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("orderId", e.OrderID); err != nil {
		return zero, err
	}
	return chatapi.NewOrderCancelledEventCommerceEvent(chatapi.OrderCancelledEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeOrderCancelled),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		OrderID:    e.OrderID,
	}), nil
}

// CartUpdated records the current contents of a cart — cart.updated.
//
// Items is a FULL REPLACEMENT of the cart's line items, not a delta. A nil or
// empty slice is a legitimate emptied-but-still-open cart and is sent as [].
// The cart is created on first sight, so this is the event that must land
// before any [CartAbandoned] or [CartConverted] for the same CartID.
//
// Aimed at a cart that is already CONVERTED, this is refused with
// 422 INVALID_CART_TRANSITION — see the package doc.
type CartUpdated struct {
	// EventID is the caller's idempotency key. Required.
	EventID string
	// OccurredAt is when this happened. Required; sent as UTC. The server
	// uses it to discard a snapshot that arrives out of order.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper. Required.
	CustomerID string
	// CartID is the merchant's own cart identifier, unique per contact rather
	// than globally. Required.
	CartID string
	// Items fully replaces the cart's contents. At most [MaxItems] entries; a
	// 501st is refused here, before the request is built.
	Items []Item
}

// Type reports [EventTypeCartUpdated].
func (e CartUpdated) Type() EventType { return EventTypeCartUpdated }

func (e CartUpdated) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("cartId", e.CartID); err != nil {
		return zero, err
	}
	items, err := cartItems(e.Items)
	if err != nil {
		return zero, err
	}
	return chatapi.NewCartUpdatedEventCommerceEvent(chatapi.CartUpdatedEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeCartUpdated),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		CartID:     e.CartID,
		Items:      items,
	}), nil
}

// CartAbandoned records that a cart is no longer being actively shopped —
// cart.abandoned.
//
// The cart must already exist, which is what makes this the event most likely
// to race: sent before the [CartUpdated] that would have created its cart, it
// is refused with 404 CART_NOT_FOUND. Retry the same EventID once that
// update lands. Repeating it against an already-ABANDONED cart is an accepted
// no-op — 200 with Applied true and no state change — while an already
// CONVERTED cart is 422 INVALID_CART_TRANSITION, because CONVERTED is
// terminal.
type CartAbandoned struct {
	// EventID is the caller's idempotency key. Required.
	EventID string
	// OccurredAt is when this happened. Required; sent as UTC.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper. Required.
	CustomerID string
	// CartID is the merchant's own cart identifier. Required.
	CartID string
}

// Type reports [EventTypeCartAbandoned].
func (e CartAbandoned) Type() EventType { return EventTypeCartAbandoned }

func (e CartAbandoned) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("cartId", e.CartID); err != nil {
		return zero, err
	}
	return chatapi.NewCartAbandonedEventCommerceEvent(chatapi.CartAbandonedEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeCartAbandoned),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		CartID:     e.CartID,
	}), nil
}

// CartConverted records that a cart was checked out — cart.converted.
//
// CONVERTED is terminal: any later cart event for the same CartID is refused
// with 422 INVALID_CART_TRANSITION.
type CartConverted struct {
	// EventID is the caller's idempotency key. Required.
	EventID string
	// OccurredAt is when this happened. Required; sent as UTC.
	OccurredAt time.Time
	// CustomerID is the caller's own identifier for the shopper. Required.
	CustomerID string
	// CartID is the merchant's own cart identifier. Required.
	CartID string
	// OrderID optionally ties the cart to the order it became. Correlation
	// only — it is stored on the cart row and never applied to an aggregate.
	// Empty means absent.
	OrderID string
}

// Type reports [EventTypeCartConverted].
func (e CartConverted) Type() EventType { return EventTypeCartConverted }

func (e CartConverted) commerceEvent() (chatapi.CommerceEvent, error) {
	var zero chatapi.CommerceEvent
	if err := validateBase(e.EventID, e.OccurredAt, e.CustomerID); err != nil {
		return zero, err
	}
	if err := requireNonEmpty("cartId", e.CartID); err != nil {
		return zero, err
	}
	return chatapi.NewCartConvertedEventCommerceEvent(chatapi.CartConvertedEvent{
		EventID:    e.EventID,
		Type:       string(EventTypeCartConverted),
		OccurredAt: e.OccurredAt.UTC(),
		CustomerID: e.CustomerID,
		CartID:     e.CartID,
		OrderID:    optString(e.OrderID),
	}), nil
}

// Validate reports whether event would be accepted by this package's
// client-side checks, without sending anything.
//
// It is the same pass [Client.RecordCommerceEvent] runs first, exposed for a
// caller who wants to screen a batch — or a queue being drained — before
// spending a round trip on it. A nil error means only that the event is
// well-formed locally; the server remains the authority on every bound this
// package does not duplicate.
//
// It returns an [*InvalidEventError] naming the offending field.
func Validate(event Event) error {
	if event == nil {
		return &InvalidEventError{Field: "event", Reason: "is required"}
	}
	_, err := event.commerceEvent()
	return err
}

// validateBase checks the four fields every variant carries. The field names
// in its errors are the WIRE names, so they match what the server's own 400
// would have named.
func validateBase(eventID string, occurredAt time.Time, customerID string) error {
	if err := requireNonEmpty("eventId", eventID); err != nil {
		return err
	}
	if occurredAt.IsZero() {
		return &InvalidEventError{Field: "occurredAt", Reason: "is required"}
	}
	return requireNonEmpty("customerId", customerID)
}

func requireNonEmpty(field, value string) error {
	if value == "" {
		return &InvalidEventError{Field: field, Reason: "is required and must not be empty"}
	}
	return nil
}

func requireFinite(field string, value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return &InvalidEventError{Field: field, Reason: "must be a finite number"}
	}
	return nil
}

// cartItems validates and converts a cart snapshot.
//
// Unlike the event variants themselves it does NOT reject unknown fields —
// there are none to reject in Go — and it deliberately does not check
// anything CommerceCartItem's schema leaves unbounded. In particular SKU has
// no minLength there, so an empty SKU is legal (if useless) and is treated as
// absent rather than as an error.
func cartItems(items []Item) ([]chatapi.CommerceCartItem, error) {
	if len(items) > MaxItems {
		return nil, &InvalidEventError{
			Field:  "items",
			Reason: fmt.Sprintf("may contain at most %d entries, received %d", MaxItems, len(items)),
		}
	}
	out := make([]chatapi.CommerceCartItem, len(items))
	for i, item := range items {
		if err := requireNonEmpty(fmt.Sprintf("items[%d].name", i), item.Name); err != nil {
			return nil, err
		}
		if n := len(item.Name); n > MaxItemNameLength {
			return nil, &InvalidEventError{
				Field:  fmt.Sprintf("items[%d].name", i),
				Reason: fmt.Sprintf("must be at most %d characters, received %d", MaxItemNameLength, n),
			}
		}
		if n := len(item.SKU); n > MaxItemSKULength {
			return nil, &InvalidEventError{
				Field:  fmt.Sprintf("items[%d].sku", i),
				Reason: fmt.Sprintf("must be at most %d characters, received %d", MaxItemSKULength, n),
			}
		}
		if err := requireFinite(fmt.Sprintf("items[%d].unitPrice", i), item.UnitPrice); err != nil {
			return nil, err
		}
		out[i] = chatapi.CommerceCartItem{
			Name:      item.Name,
			Quantity:  item.Quantity,
			UnitPrice: item.UnitPrice,
			Sku:       optString(item.SKU),
		}
	}
	return out, nil
}

func optString(v string) chatapi.OptString {
	if v == "" {
		return chatapi.OptString{}
	}
	return chatapi.NewOptString(v)
}

func optFloat64(v *float64) chatapi.OptFloat64 {
	if v == nil {
		return chatapi.OptFloat64{}
	}
	return chatapi.NewOptFloat64(*v)
}
