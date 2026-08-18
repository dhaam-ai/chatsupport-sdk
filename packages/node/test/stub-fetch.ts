// A stubbed `fetch` that records what the SDK actually sent.
//
// Recording the REQUEST is the point. Half of what this package must get right
// is invisible in a response assertion: which header the credential went into,
// which path was called, whether a claim was flattened. A stub that only
// returns canned bodies cannot catch a token sent in a query string.

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

export interface StubResponse {
  readonly status?: number;
  readonly body?: unknown;
  /** Send this exact string instead of JSON-encoding `body`. */
  readonly rawBody?: string;
  readonly headers?: Record<string, string>;
}

export interface FetchStub {
  readonly fetch: typeof globalThis.fetch;
  readonly requests: RecordedRequest[];
  /** The single most recent request. Throws if none was made — a silent undefined here hides the bug. */
  lastRequest(): RecordedRequest;
}

/**
 * Build a `fetch` stub that replies with `responses` in order.
 *
 * Running out of responses THROWS rather than repeating the last one: a
 * pagination loop that requests one page too many is precisely the defect
 * these tests exist to catch, and a stub that keeps answering would let it
 * pass as an infinite loop that happens to terminate.
 */
export function stubFetch(responses: readonly StubResponse[]): FetchStub {
  const requests: RecordedRequest[] = [];
  let index = 0;

  const fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = v;
    }
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });

    const spec = responses[index];
    if (spec === undefined) {
      throw new Error(
        `fetch stub exhausted: request #${index + 1} to ${url} had no configured response ` +
          `(only ${responses.length} were provided). If this came from a pagination test, ` +
          `the iterator requested more pages than it should have.`,
      );
    }
    index += 1;

    const status = spec.status ?? 200;
    const payload = spec.rawBody ?? (spec.body === undefined ? '' : JSON.stringify(spec.body));
    return new Response(payload, {
      status,
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
    });
  }) as unknown as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    lastRequest(): RecordedRequest {
      const last = requests[requests.length - 1];
      if (last === undefined) throw new Error('no request was made');
      return last;
    },
  };
}

/** A `fetch` that always fails to reach the server — DNS failure, connection refused. */
export function unreachableFetch(cause = new Error('ECONNREFUSED')): typeof globalThis.fetch {
  return (async () => {
    throw cause;
  }) as unknown as typeof globalThis.fetch;
}
