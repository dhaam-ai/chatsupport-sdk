package commerce_test

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/dhaamai/chat-sdk/clients/go/commerce"
)

var occurredAt = time.Date(2026, 8, 21, 10, 15, 0, 0, time.UTC)

// canonical reparses JSON and re-marshals it, so two bodies that differ only
// in key order or whitespace compare equal and a mismatch prints readably.
func canonical(t *testing.T, raw string) string {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		t.Fatalf("parsing JSON %q: %v", raw, err)
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("re-marshalling %q: %v", raw, err)
	}
	return string(out)
}

// TestEventWireBodies is the table this package exists to make unnecessary to
// write by hand. Assembling chatapi's oneOf union means setting a discriminator
// and one of six sibling fields, and nothing in the generated types stops the
// two from disagreeing -- so what actually has to be pinned is the JSON that
// leaves the process for each variant, not the Go value in between.
//
// The want column is the literal request body.
func TestEventWireBodies(t *testing.T) {
	for _, tc := range []struct {
		name  string
		event commerce.Event
		want  string
	}{
		{
			name: "order.placed with every optional field",
			event: commerce.OrderPlaced{
				EventID:    "evt_order_9f2a1e",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				OrderID:    "ord_5591",
				Merchant:   "Acme Outfitters",
				Category:   "apparel",
				CartID:     "cart_77",
				Value:      commerce.Float64(159.99),
			},
			want: `{
				"eventId":    "evt_order_9f2a1e",
				"type":       "order.placed",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"orderId":    "ord_5591",
				"merchant":   "Acme Outfitters",
				"category":   "apparel",
				"cartId":     "cart_77",
				"value":      159.99
			}`,
		},
		{
			// Every optional field must be ABSENT, not null and not "". The
			// request schema is .strict() and a null where a string belongs is
			// a 400, so an empty Go string has to mean "omit the key".
			name: "order.placed with no optional field set",
			event: commerce.OrderPlaced{
				EventID:    "evt_order_9f2a1e",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				OrderID:    "ord_5591",
			},
			want: `{
				"eventId":    "evt_order_9f2a1e",
				"type":       "order.placed",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"orderId":    "ord_5591"
			}`,
		},
		{
			name: "order.completed",
			event: commerce.OrderCompleted{
				EventID:    "evt_order_completed",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				OrderID:    "ord_5591",
				Value:      84.5,
				Merchant:   "Acme Outfitters",
				Category:   "apparel",
			},
			want: `{
				"eventId":    "evt_order_completed",
				"type":       "order.completed",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"orderId":    "ord_5591",
				"value":      84.5,
				"merchant":   "Acme Outfitters",
				"category":   "apparel"
			}`,
		},
		{
			// Value is required here and 0 is legal, so it must go on the wire
			// rather than being mistaken for an unset field.
			name: "order.completed with a zero value",
			event: commerce.OrderCompleted{
				EventID:    "evt_free_order",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				OrderID:    "ord_5592",
			},
			want: `{
				"eventId":    "evt_free_order",
				"type":       "order.completed",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"orderId":    "ord_5592",
				"value":      0
			}`,
		},
		{
			name: "order.cancelled",
			event: commerce.OrderCancelled{
				EventID:    "evt_cancel",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				OrderID:    "ord_5591",
			},
			want: `{
				"eventId":    "evt_cancel",
				"type":       "order.cancelled",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"orderId":    "ord_5591"
			}`,
		},
		{
			name: "cart.updated",
			event: commerce.CartUpdated{
				EventID:    "evt_cart_1a2b3c",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
				Items: []commerce.Item{
					{Name: "Air Jordan 1 Retro", Quantity: 1, UnitPrice: 150, SKU: "AJ1-BLK-11"},
					{Name: "Crew Socks", Quantity: 3, UnitPrice: 15.99},
				},
			},
			want: `{
				"eventId":    "evt_cart_1a2b3c",
				"type":       "cart.updated",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77",
				"items": [
					{"name": "Air Jordan 1 Retro", "quantity": 1, "unitPrice": 150, "sku": "AJ1-BLK-11"},
					{"name": "Crew Socks", "quantity": 3, "unitPrice": 15.99}
				]
			}`,
		},
		{
			// A nil slice is an emptied-but-still-open cart, and must serialise
			// as [] rather than null -- items is required.
			name: "cart.updated with a nil items slice",
			event: commerce.CartUpdated{
				EventID:    "evt_cart_emptied",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
			},
			want: `{
				"eventId":    "evt_cart_emptied",
				"type":       "cart.updated",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77",
				"items":      []
			}`,
		},
		{
			name: "cart.abandoned",
			event: commerce.CartAbandoned{
				EventID:    "evt_cart_002",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
			},
			want: `{
				"eventId":    "evt_cart_002",
				"type":       "cart.abandoned",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77"
			}`,
		},
		{
			name: "cart.converted with the order it became",
			event: commerce.CartConverted{
				EventID:    "evt_cart_003",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
				OrderID:    "ord_5591",
			},
			want: `{
				"eventId":    "evt_cart_003",
				"type":       "cart.converted",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77",
				"orderId":    "ord_5591"
			}`,
		},
		{
			name: "cart.converted without an order",
			event: commerce.CartConverted{
				EventID:    "evt_cart_004",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
			},
			want: `{
				"eventId":    "evt_cart_004",
				"type":       "cart.converted",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77"
			}`,
		},
		{
			// OccurredAt is documented as UTC. A caller in another zone must
			// not have to convert it themselves.
			name: "occurredAt is normalised to UTC",
			event: commerce.CartAbandoned{
				EventID:    "evt_ist",
				OccurredAt: occurredAt.In(time.FixedZone("IST", 5*3600+1800)),
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
			},
			want: `{
				"eventId":    "evt_ist",
				"type":       "cart.abandoned",
				"occurredAt": "2026-08-21T10:15:00Z",
				"customerId": "cust_8f2a1e",
				"cartId":     "cart_77"
			}`,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, got := newServer(t, okHandler(true))

			if _, err := client.RecordCommerceEvent(context.Background(), tc.event); err != nil {
				t.Fatalf("RecordCommerceEvent(%T) = error %v, want success", tc.event, err)
			}
			if want, sent := canonical(t, tc.want), canonical(t, string(got.body)); sent != want {
				t.Errorf("request body for %T:\n got: %s\nwant: %s", tc.event, sent, want)
			}
		})
	}
}

// TestEventTypeReportsTheWireTag covers the accessor a retry queue uses to log
// or route an Event it holds behind the interface.
func TestEventTypeReportsTheWireTag(t *testing.T) {
	for _, tc := range []struct {
		event commerce.Event
		want  commerce.EventType
	}{
		{commerce.OrderPlaced{}, commerce.EventTypeOrderPlaced},
		{commerce.OrderCompleted{}, commerce.EventTypeOrderCompleted},
		{commerce.OrderCancelled{}, commerce.EventTypeOrderCancelled},
		{commerce.CartUpdated{}, commerce.EventTypeCartUpdated},
		{commerce.CartAbandoned{}, commerce.EventTypeCartAbandoned},
		{commerce.CartConverted{}, commerce.EventTypeCartConverted},
	} {
		t.Run(string(tc.want), func(t *testing.T) {
			if got := tc.event.Type(); got != tc.want {
				t.Errorf("(%T).Type() = %q, want %q", tc.event, got, tc.want)
			}
		})
	}
}

// TestValidateRejectsMalformedEvents covers what this package refuses locally.
// Each row names the field the caller has to fix, because the server's own 400
// says only that the request was invalid -- it does not echo which key was
// wrong, which is the whole reason these checks are duplicated here.
func TestValidateRejectsMalformedEvents(t *testing.T) {
	base := func() commerce.CartUpdated {
		return commerce.CartUpdated{
			EventID:    "evt_1",
			OccurredAt: occurredAt,
			CustomerID: "cust_8f2a1e",
			CartID:     "cart_77",
		}
	}

	for _, tc := range []struct {
		name      string
		event     commerce.Event
		wantField string
	}{
		// The four base fields, on one variant each, so a regression in the
		// shared check surfaces wherever it happens.
		{"missing eventId", commerce.OrderPlaced{OccurredAt: occurredAt, CustomerID: "c", OrderID: "o"}, "eventId"},
		{"missing occurredAt", commerce.OrderCompleted{EventID: "e", CustomerID: "c", OrderID: "o"}, "occurredAt"},
		{"missing customerId", commerce.OrderCancelled{EventID: "e", OccurredAt: occurredAt, OrderID: "o"}, "customerId"},
		{"missing eventId on a cart event", commerce.CartAbandoned{OccurredAt: occurredAt, CustomerID: "c", CartID: "k"}, "eventId"},

		// Per-variant required fields.
		{"order.placed without orderId", commerce.OrderPlaced{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "orderId"},
		{"order.completed without orderId", commerce.OrderCompleted{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "orderId"},
		{"order.cancelled without orderId", commerce.OrderCancelled{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "orderId"},
		{"cart.updated without cartId", commerce.CartUpdated{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "cartId"},
		{"cart.abandoned without cartId", commerce.CartAbandoned{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "cartId"},
		{"cart.converted without cartId", commerce.CartConverted{EventID: "e", OccurredAt: occurredAt, CustomerID: "c"}, "cartId"},

		// Numbers that cannot be encoded as JSON at all.
		{
			name:      "order.completed with a NaN value",
			event:     commerce.OrderCompleted{EventID: "e", OccurredAt: occurredAt, CustomerID: "c", OrderID: "o", Value: math.NaN()},
			wantField: "value",
		},
		{
			name:      "order.placed with an infinite value",
			event:     commerce.OrderPlaced{EventID: "e", OccurredAt: occurredAt, CustomerID: "c", OrderID: "o", Value: commerce.Float64(math.Inf(1))},
			wantField: "value",
		},

		// The three commissioned caps, each at the first refused size.
		{
			name:      "more than MaxItems entries",
			event:     withItems(base(), makeItems(commerce.MaxItems+1)),
			wantField: "items",
		},
		{
			name: "an item name one character too long",
			event: withItems(base(), []commerce.Item{
				{Name: "ok", Quantity: 1, UnitPrice: 1},
				{Name: strings.Repeat("n", commerce.MaxItemNameLength+1), Quantity: 1, UnitPrice: 1},
			}),
			wantField: "items[1].name",
		},
		{
			name: "an item sku one character too long",
			event: withItems(base(), []commerce.Item{
				{Name: "ok", Quantity: 1, UnitPrice: 1, SKU: strings.Repeat("s", commerce.MaxItemSKULength+1)},
			}),
			wantField: "items[0].sku",
		},
		{
			name:      "an item with no name",
			event:     withItems(base(), []commerce.Item{{Quantity: 1, UnitPrice: 1}}),
			wantField: "items[0].name",
		},
		{
			name:      "an item with a NaN unit price",
			event:     withItems(base(), []commerce.Item{{Name: "ok", Quantity: 1, UnitPrice: math.NaN()}}),
			wantField: "items[0].unitPrice",
		},

		{"a nil event", nil, "event"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := commerce.Validate(tc.event)
			if err == nil {
				t.Fatalf("Validate(%+v) = nil, want an error naming %q", tc.event, tc.wantField)
			}

			var invalid *commerce.InvalidEventError
			if !errors.As(err, &invalid) {
				t.Fatalf("Validate(...) error is %T (%v), want *commerce.InvalidEventError", err, err)
			}
			if invalid.Field != tc.wantField {
				t.Errorf("Validate(...) named field %q, want %q (message: %v)", invalid.Field, tc.wantField, err)
			}
			if commerce.IsRetryableContactsError(err) {
				t.Error("IsRetryableContactsError(local validation failure) = true, want false; " +
					"it will fail identically on every retry until the caller's code changes")
			}
		})
	}
}

// TestValidateAcceptsTheBoundaries pins that the caps reject only what exceeds
// them. Off-by-one in the other direction would refuse a legal maximal cart.
func TestValidateAcceptsTheBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name  string
		items []commerce.Item
	}{
		{"exactly MaxItems entries", makeItems(commerce.MaxItems)},
		{"a name of exactly MaxItemNameLength", []commerce.Item{
			{Name: strings.Repeat("n", commerce.MaxItemNameLength), Quantity: 1, UnitPrice: 1},
		}},
		{"a sku of exactly MaxItemSKULength", []commerce.Item{
			{Name: "ok", Quantity: 1, UnitPrice: 1, SKU: strings.Repeat("s", commerce.MaxItemSKULength)},
		}},
		{"no items at all", nil},
		{"an explicitly empty cart", []commerce.Item{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			event := commerce.CartUpdated{
				EventID:    "evt_1",
				OccurredAt: occurredAt,
				CustomerID: "cust_8f2a1e",
				CartID:     "cart_77",
				Items:      tc.items,
			}
			if err := commerce.Validate(event); err != nil {
				t.Errorf("Validate(cart with %s) = %v, want nil", tc.name, err)
			}
		})
	}
}

// TestValidationHappensBeforeTheWire is the promise the doc makes: a malformed
// event costs no round trip.
func TestValidationHappensBeforeTheWire(t *testing.T) {
	client, got := newServer(t, okHandler(true))

	_, err := client.RecordCommerceEvent(context.Background(), commerce.CartUpdated{
		EventID:    "evt_1",
		OccurredAt: occurredAt,
		CustomerID: "cust_8f2a1e",
		// no CartID
	})
	var invalid *commerce.InvalidEventError
	if !errors.As(err, &invalid) {
		t.Fatalf("RecordCommerceEvent(malformed) error = %T (%v), want *commerce.InvalidEventError", err, err)
	}
	if got.body != nil {
		t.Errorf("a malformed event still reached the wire: %s", got.body)
	}
}

// TestInvalidEventErrorCarriesNoValues covers the rule that error messages name
// fields, never their contents. A cart's line-item names and a shopper's id are
// not this package's to put in something an error tracker will index.
func TestInvalidEventErrorCarriesNoValues(t *testing.T) {
	const secretName = "Confidential Prototype Sneaker"
	const shopper = "cust_privacy_sensitive"

	err := commerce.Validate(commerce.CartUpdated{
		EventID:    "evt_1",
		OccurredAt: occurredAt,
		CustomerID: shopper,
		CartID:     "cart_77",
		Items: []commerce.Item{
			{Name: secretName + strings.Repeat("!", commerce.MaxItemNameLength), Quantity: 1, UnitPrice: 1},
		},
	})
	if err == nil {
		t.Fatal("Validate(over-long item name) = nil, want an error")
	}
	for _, leak := range []string{secretName, shopper} {
		if strings.Contains(err.Error(), leak) {
			t.Errorf("Validate(...) error = %q, which echoes a caller-supplied value (%q)", err, leak)
		}
	}
	// The length is fine to report -- it is what makes the error actionable.
	if !strings.Contains(err.Error(), "items[0].name") {
		t.Errorf("Validate(...) error = %q, want it to name items[0].name", err)
	}
}

func withItems(event commerce.CartUpdated, items []commerce.Item) commerce.CartUpdated {
	event.Items = items
	return event
}

func makeItems(n int) []commerce.Item {
	items := make([]commerce.Item, n)
	for i := range items {
		items[i] = commerce.Item{Name: "item", Quantity: 1, UnitPrice: 1}
	}
	return items
}
