from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.mint_token_request import MintTokenRequest
from ...models.mint_token_response import MintTokenResponse
from ...types import Response


def _get_kwargs(
    *,
    body: MintTokenRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/tokens",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Error, MintTokenResponse]]:
    if response.status_code == 201:
        response_201 = MintTokenResponse.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

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
) -> Response[Union[Error, MintTokenResponse]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: MintTokenRequest,
) -> Response[Union[Error, MintTokenResponse]]:
    """Mint a short-lived, scoped user access token.

     Called by the **customer's own backend** using their `dhsk_live_...` /
    `dhsk_test_...` secret key — never by a browser (PRD §10.3). The
    customer's frontend calls *their own* backend endpoint (commonly
    one they name `/token` or similar), which in turn calls this
    endpoint and relays only the resulting `accessToken` to the
    frontend, which supplies it to the SDK via `getToken()` (PRD §6.1,
    §10.4).

    Idempotency: N/A — minting has no persisted side effect to
    de-duplicate. Each call mints a fresh, independent token; retrying
    after a timeout is always safe.

    **Open Question (PRD §18 Q6, unresolved):** whether this endpoint
    should also absorb v1's separate, hardcoded external identity-mapping
    call (`mapCustomer()` → `https://docs-dev.dhaamai.com/customers/map`,
    PRD §12.6) so that v2 clients make one identity-related network call
    instead of two. This spec models the contract as it stands today
    (claims in, token out) and does **not** invent an absorbed
    identity-mapping shape pending that decision.

    Args:
        body (MintTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, MintTokenResponse]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: MintTokenRequest,
) -> Optional[Union[Error, MintTokenResponse]]:
    """Mint a short-lived, scoped user access token.

     Called by the **customer's own backend** using their `dhsk_live_...` /
    `dhsk_test_...` secret key — never by a browser (PRD §10.3). The
    customer's frontend calls *their own* backend endpoint (commonly
    one they name `/token` or similar), which in turn calls this
    endpoint and relays only the resulting `accessToken` to the
    frontend, which supplies it to the SDK via `getToken()` (PRD §6.1,
    §10.4).

    Idempotency: N/A — minting has no persisted side effect to
    de-duplicate. Each call mints a fresh, independent token; retrying
    after a timeout is always safe.

    **Open Question (PRD §18 Q6, unresolved):** whether this endpoint
    should also absorb v1's separate, hardcoded external identity-mapping
    call (`mapCustomer()` → `https://docs-dev.dhaamai.com/customers/map`,
    PRD §12.6) so that v2 clients make one identity-related network call
    instead of two. This spec models the contract as it stands today
    (claims in, token out) and does **not** invent an absorbed
    identity-mapping shape pending that decision.

    Args:
        body (MintTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, MintTokenResponse]
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: MintTokenRequest,
) -> Response[Union[Error, MintTokenResponse]]:
    """Mint a short-lived, scoped user access token.

     Called by the **customer's own backend** using their `dhsk_live_...` /
    `dhsk_test_...` secret key — never by a browser (PRD §10.3). The
    customer's frontend calls *their own* backend endpoint (commonly
    one they name `/token` or similar), which in turn calls this
    endpoint and relays only the resulting `accessToken` to the
    frontend, which supplies it to the SDK via `getToken()` (PRD §6.1,
    §10.4).

    Idempotency: N/A — minting has no persisted side effect to
    de-duplicate. Each call mints a fresh, independent token; retrying
    after a timeout is always safe.

    **Open Question (PRD §18 Q6, unresolved):** whether this endpoint
    should also absorb v1's separate, hardcoded external identity-mapping
    call (`mapCustomer()` → `https://docs-dev.dhaamai.com/customers/map`,
    PRD §12.6) so that v2 clients make one identity-related network call
    instead of two. This spec models the contract as it stands today
    (claims in, token out) and does **not** invent an absorbed
    identity-mapping shape pending that decision.

    Args:
        body (MintTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Error, MintTokenResponse]]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: MintTokenRequest,
) -> Optional[Union[Error, MintTokenResponse]]:
    """Mint a short-lived, scoped user access token.

     Called by the **customer's own backend** using their `dhsk_live_...` /
    `dhsk_test_...` secret key — never by a browser (PRD §10.3). The
    customer's frontend calls *their own* backend endpoint (commonly
    one they name `/token` or similar), which in turn calls this
    endpoint and relays only the resulting `accessToken` to the
    frontend, which supplies it to the SDK via `getToken()` (PRD §6.1,
    §10.4).

    Idempotency: N/A — minting has no persisted side effect to
    de-duplicate. Each call mints a fresh, independent token; retrying
    after a timeout is always safe.

    **Open Question (PRD §18 Q6, unresolved):** whether this endpoint
    should also absorb v1's separate, hardcoded external identity-mapping
    call (`mapCustomer()` → `https://docs-dev.dhaamai.com/customers/map`,
    PRD §12.6) so that v2 clients make one identity-related network call
    instead of two. This spec models the contract as it stands today
    (claims in, token out) and does **not** invent an absorbed
    identity-mapping shape pending that decision.

    Args:
        body (MintTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Error, MintTokenResponse]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
