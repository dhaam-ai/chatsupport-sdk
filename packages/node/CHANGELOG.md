# @dhaam-ccrm/node

## 0.1.0

### Minor Changes

- 0b24fa2: Add `@dhaam-ccrm/node`, the backend SDK for the customer's own server.

  Without it a customer cannot mint a token, and so cannot authenticate a single
  end user. This is the opposite side of the wire from `@dhaam-ccrm/core`: it
  holds the `dhsk_…` secret key, is Node-only, and has no dependency edge to core
  in either direction.

  - **Token minting** — `POST /chat-services/api/v1/tokens`, secret key as a
    bearer credential and nowhere else.
  - **Webhook verification** — the `X-ChatSDK-Signature` contract, with
    constant-time comparison (both operands digested before `timingSafeEqual`,
    which throws on a length mismatch) and a 300-second replay window applied in
    both directions.
  - **Pagination iterators** — `for await` over the cursor shapes, terminating on
    three independent conditions rather than trusting `hasMore` alone.
  - **Zero runtime dependencies.** Node 18+ supplies `fetch` and
    `crypto.timingSafeEqual`.
