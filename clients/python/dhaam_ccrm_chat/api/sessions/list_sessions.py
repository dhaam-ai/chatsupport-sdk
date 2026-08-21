from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.list_sessions_response_200 import ListSessionsResponse200
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: Union[Unset, int] = 5,
) -> dict[str, Any]:
    params: dict[str, Any] = {}

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/chat/sessions/customer",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, ListSessionsResponse200]]:
    if response.status_code == 200:
        response_200 = ListSessionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 500:
        response_500 = Error.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[Error, ListSessionsResponse200]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 5,
) -> Response[Union[Error, ListSessionsResponse200]]:
    r"""List the authenticated customer's recent sessions.

     **Path corrected**: the real route is `GET /chat/sessions/customer`,
    registered ahead of `/chat/sessions/:sessionId` so Fastify's static
    route wins (`chat.routes.ts:229`, comment: \"registered before
    /:sessionId (static wins in Fastify)\"). An earlier revision of this
    document modeled this as `GET /sessions`, which does not exist —
    `chat.routes.ts` has no bare `GET /chat/sessions` handler at all.

    Hydrates `ChatState.pastSessions` (PRD §6.4) — the SDK's \"your last
    N conversations\" picker. **`@dhaam-ccrm/core` does not call this
    operation as of this revision** — `ChatState.pastSessions` is
    declared and initialized empty but nothing in `packages/core`
    populates it (confirmed gap, contract audit finding; unchanged by
    this revision, which corrects the backend response shape this
    operation will be consumed against, not the SDK wiring).

    Ordered most-recent-first (by last activity, not `createdAt`).
    Includes closed sessions — a customer reopening an earlier
    conversation (PRD §12.5) needs to see them.

    **Guests get `[]`, not an error.** A session is returned only for a
    caller the backend has identified — see `handledBy`'s sibling note
    on `ChatSessionSummaryWire` for what \"identified\" means here and its
    documented failure mode. This is a 200 in every case; there is no
    403/404 branch on this operation for an anonymous caller.

    **Response shape corrected as of this revision** — see
    `ChatSessionSummaryWire` / `SessionSummaryPageWire` below. The
    `sessions[]` item shape is now field-for-field the SDK's
    `ChatSessionSummary` (`packages/core/src/state/types.ts:223-240`),
    plus `handledBy`.

    Args:
        limit (Union[Unset, int]):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ListSessionsResponse200]]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 5,
) -> Optional[Union[Error, ListSessionsResponse200]]:
    r"""List the authenticated customer's recent sessions.

     **Path corrected**: the real route is `GET /chat/sessions/customer`,
    registered ahead of `/chat/sessions/:sessionId` so Fastify's static
    route wins (`chat.routes.ts:229`, comment: \"registered before
    /:sessionId (static wins in Fastify)\"). An earlier revision of this
    document modeled this as `GET /sessions`, which does not exist —
    `chat.routes.ts` has no bare `GET /chat/sessions` handler at all.

    Hydrates `ChatState.pastSessions` (PRD §6.4) — the SDK's \"your last
    N conversations\" picker. **`@dhaam-ccrm/core` does not call this
    operation as of this revision** — `ChatState.pastSessions` is
    declared and initialized empty but nothing in `packages/core`
    populates it (confirmed gap, contract audit finding; unchanged by
    this revision, which corrects the backend response shape this
    operation will be consumed against, not the SDK wiring).

    Ordered most-recent-first (by last activity, not `createdAt`).
    Includes closed sessions — a customer reopening an earlier
    conversation (PRD §12.5) needs to see them.

    **Guests get `[]`, not an error.** A session is returned only for a
    caller the backend has identified — see `handledBy`'s sibling note
    on `ChatSessionSummaryWire` for what \"identified\" means here and its
    documented failure mode. This is a 200 in every case; there is no
    403/404 branch on this operation for an anonymous caller.

    **Response shape corrected as of this revision** — see
    `ChatSessionSummaryWire` / `SessionSummaryPageWire` below. The
    `sessions[]` item shape is now field-for-field the SDK's
    `ChatSessionSummary` (`packages/core/src/state/types.ts:223-240`),
    plus `handledBy`.

    Args:
        limit (Union[Unset, int]):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ListSessionsResponse200]
    """

    return sync_detailed(
        client=client,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 5,
) -> Response[Union[Error, ListSessionsResponse200]]:
    r"""List the authenticated customer's recent sessions.

     **Path corrected**: the real route is `GET /chat/sessions/customer`,
    registered ahead of `/chat/sessions/:sessionId` so Fastify's static
    route wins (`chat.routes.ts:229`, comment: \"registered before
    /:sessionId (static wins in Fastify)\"). An earlier revision of this
    document modeled this as `GET /sessions`, which does not exist —
    `chat.routes.ts` has no bare `GET /chat/sessions` handler at all.

    Hydrates `ChatState.pastSessions` (PRD §6.4) — the SDK's \"your last
    N conversations\" picker. **`@dhaam-ccrm/core` does not call this
    operation as of this revision** — `ChatState.pastSessions` is
    declared and initialized empty but nothing in `packages/core`
    populates it (confirmed gap, contract audit finding; unchanged by
    this revision, which corrects the backend response shape this
    operation will be consumed against, not the SDK wiring).

    Ordered most-recent-first (by last activity, not `createdAt`).
    Includes closed sessions — a customer reopening an earlier
    conversation (PRD §12.5) needs to see them.

    **Guests get `[]`, not an error.** A session is returned only for a
    caller the backend has identified — see `handledBy`'s sibling note
    on `ChatSessionSummaryWire` for what \"identified\" means here and its
    documented failure mode. This is a 200 in every case; there is no
    403/404 branch on this operation for an anonymous caller.

    **Response shape corrected as of this revision** — see
    `ChatSessionSummaryWire` / `SessionSummaryPageWire` below. The
    `sessions[]` item shape is now field-for-field the SDK's
    `ChatSessionSummary` (`packages/core/src/state/types.ts:223-240`),
    plus `handledBy`.

    Args:
        limit (Union[Unset, int]):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, ListSessionsResponse200]]
    """

    kwargs = _get_kwargs(
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: Union[Unset, int] = 5,
) -> Optional[Union[Error, ListSessionsResponse200]]:
    r"""List the authenticated customer's recent sessions.

     **Path corrected**: the real route is `GET /chat/sessions/customer`,
    registered ahead of `/chat/sessions/:sessionId` so Fastify's static
    route wins (`chat.routes.ts:229`, comment: \"registered before
    /:sessionId (static wins in Fastify)\"). An earlier revision of this
    document modeled this as `GET /sessions`, which does not exist —
    `chat.routes.ts` has no bare `GET /chat/sessions` handler at all.

    Hydrates `ChatState.pastSessions` (PRD §6.4) — the SDK's \"your last
    N conversations\" picker. **`@dhaam-ccrm/core` does not call this
    operation as of this revision** — `ChatState.pastSessions` is
    declared and initialized empty but nothing in `packages/core`
    populates it (confirmed gap, contract audit finding; unchanged by
    this revision, which corrects the backend response shape this
    operation will be consumed against, not the SDK wiring).

    Ordered most-recent-first (by last activity, not `createdAt`).
    Includes closed sessions — a customer reopening an earlier
    conversation (PRD §12.5) needs to see them.

    **Guests get `[]`, not an error.** A session is returned only for a
    caller the backend has identified — see `handledBy`'s sibling note
    on `ChatSessionSummaryWire` for what \"identified\" means here and its
    documented failure mode. This is a 200 in every case; there is no
    403/404 branch on this operation for an anonymous caller.

    **Response shape corrected as of this revision** — see
    `ChatSessionSummaryWire` / `SessionSummaryPageWire` below. The
    `sessions[]` item shape is now field-for-field the SDK's
    `ChatSessionSummary` (`packages/core/src/state/types.ts:223-240`),
    plus `handledBy`.

    Args:
        limit (Union[Unset, int]):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, ListSessionsResponse200]
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
        )
    ).parsed
