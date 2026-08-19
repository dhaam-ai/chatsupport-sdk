from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.attachment import Attachment
from ...models.error import Error
from ...models.upload_session_attachment_body import UploadSessionAttachmentBody
from ...types import UNSET, Response, Unset


def _get_kwargs(
    session_id: str,
    *,
    body: UploadSessionAttachmentBody,
    idempotency_key: Union[Unset, str] = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(idempotency_key, Unset):
        headers["Idempotency-Key"] = idempotency_key

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/sessions/{session_id}/attachments".format(
            session_id=session_id,
        ),
    }

    _kwargs["files"] = body.to_multipart()

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[Attachment, Error]]:
    if response.status_code == 201:
        response_201 = Attachment.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

    if response.status_code == 413:
        response_413 = Error.from_dict(response.json())

        return response_413

    if response.status_code == 415:
        response_415 = Error.from_dict(response.json())

        return response_415

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
) -> Response[Union[Attachment, Error]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: UploadSessionAttachmentBody,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[Attachment, Error]]:
    r"""Upload a file attachment for a session (step 1 of the upload-then-announce flow).

     Step 1 of the two-step flow PRD §6.3 and §12.10 generalize from v1:
    this endpoint uploads and stores the file and returns its metadata
    only. It does **not** create a chat message. The caller (core's
    `client.sendAttachment()`) must follow up by sending a WS
    `message.send` frame (T1) whose `d.metadata.attachment` carries this
    response verbatim — exactly as v1's client emits `chat.message.send`
    with `metadata.attachment` immediately after this REST call
    succeeds.

    `attachment` is the message model's **one** canonical location for
    attachment data (see `Message.attachment`) — v1 read it from either
    `message.attachment` or `message.metadata.attachment`
    interchangeably (`raw.attachment ?? raw.metadata?.attachment`),
    which D4's \"one canonical name per concept\" rule closes for v2.

    The session is identified by the URL path, not a form field — v1
    passed `chatSessionId` redundantly inside the multipart body even
    though the REST call already had nowhere else to route to; this is
    a deliberate cleanup, not a functional change.

    **This endpoint models the proxied-upload flow v1 actually uses today
    (multipart straight to chat-service).** PRD §18 Open Question 7 —
    whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace this
    single multipart `POST` with a pair of calls (e.g. `POST
    .../attachments/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    Idempotency: supports `Idempotency-Key`. Without it, retrying a
    timed-out upload may store the file twice.

    File size and MIME-type limits are enforced server-side; the exact
    ceiling is not fixed by the PRD (tracked as an open question in the
    T2 handoff, not invented here). Violating either returns
    `VALIDATION_FAILED` (`413` for size, `415` for an unsupported MIME
    type).

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):
        body (UploadSessionAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Attachment, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: UploadSessionAttachmentBody,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[Attachment, Error]]:
    r"""Upload a file attachment for a session (step 1 of the upload-then-announce flow).

     Step 1 of the two-step flow PRD §6.3 and §12.10 generalize from v1:
    this endpoint uploads and stores the file and returns its metadata
    only. It does **not** create a chat message. The caller (core's
    `client.sendAttachment()`) must follow up by sending a WS
    `message.send` frame (T1) whose `d.metadata.attachment` carries this
    response verbatim — exactly as v1's client emits `chat.message.send`
    with `metadata.attachment` immediately after this REST call
    succeeds.

    `attachment` is the message model's **one** canonical location for
    attachment data (see `Message.attachment`) — v1 read it from either
    `message.attachment` or `message.metadata.attachment`
    interchangeably (`raw.attachment ?? raw.metadata?.attachment`),
    which D4's \"one canonical name per concept\" rule closes for v2.

    The session is identified by the URL path, not a form field — v1
    passed `chatSessionId` redundantly inside the multipart body even
    though the REST call already had nowhere else to route to; this is
    a deliberate cleanup, not a functional change.

    **This endpoint models the proxied-upload flow v1 actually uses today
    (multipart straight to chat-service).** PRD §18 Open Question 7 —
    whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace this
    single multipart `POST` with a pair of calls (e.g. `POST
    .../attachments/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    Idempotency: supports `Idempotency-Key`. Without it, retrying a
    timed-out upload may store the file twice.

    File size and MIME-type limits are enforced server-side; the exact
    ceiling is not fixed by the PRD (tracked as an open question in the
    T2 handoff, not invented here). Violating either returns
    `VALIDATION_FAILED` (`413` for size, `415` for an unsupported MIME
    type).

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):
        body (UploadSessionAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Attachment, Error]
    """

    return sync_detailed(
        session_id=session_id,
        client=client,
        body=body,
        idempotency_key=idempotency_key,
    ).parsed


async def asyncio_detailed(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: UploadSessionAttachmentBody,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Response[Union[Attachment, Error]]:
    r"""Upload a file attachment for a session (step 1 of the upload-then-announce flow).

     Step 1 of the two-step flow PRD §6.3 and §12.10 generalize from v1:
    this endpoint uploads and stores the file and returns its metadata
    only. It does **not** create a chat message. The caller (core's
    `client.sendAttachment()`) must follow up by sending a WS
    `message.send` frame (T1) whose `d.metadata.attachment` carries this
    response verbatim — exactly as v1's client emits `chat.message.send`
    with `metadata.attachment` immediately after this REST call
    succeeds.

    `attachment` is the message model's **one** canonical location for
    attachment data (see `Message.attachment`) — v1 read it from either
    `message.attachment` or `message.metadata.attachment`
    interchangeably (`raw.attachment ?? raw.metadata?.attachment`),
    which D4's \"one canonical name per concept\" rule closes for v2.

    The session is identified by the URL path, not a form field — v1
    passed `chatSessionId` redundantly inside the multipart body even
    though the REST call already had nowhere else to route to; this is
    a deliberate cleanup, not a functional change.

    **This endpoint models the proxied-upload flow v1 actually uses today
    (multipart straight to chat-service).** PRD §18 Open Question 7 —
    whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace this
    single multipart `POST` with a pair of calls (e.g. `POST
    .../attachments/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    Idempotency: supports `Idempotency-Key`. Without it, retrying a
    timed-out upload may store the file twice.

    File size and MIME-type limits are enforced server-side; the exact
    ceiling is not fixed by the PRD (tracked as an open question in the
    T2 handoff, not invented here). Violating either returns
    `VALIDATION_FAILED` (`413` for size, `415` for an unsupported MIME
    type).

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):
        body (UploadSessionAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[Attachment, Error]]
    """

    kwargs = _get_kwargs(
        session_id=session_id,
        body=body,
        idempotency_key=idempotency_key,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    session_id: str,
    *,
    client: AuthenticatedClient,
    body: UploadSessionAttachmentBody,
    idempotency_key: Union[Unset, str] = UNSET,
) -> Optional[Union[Attachment, Error]]:
    r"""Upload a file attachment for a session (step 1 of the upload-then-announce flow).

     Step 1 of the two-step flow PRD §6.3 and §12.10 generalize from v1:
    this endpoint uploads and stores the file and returns its metadata
    only. It does **not** create a chat message. The caller (core's
    `client.sendAttachment()`) must follow up by sending a WS
    `message.send` frame (T1) whose `d.metadata.attachment` carries this
    response verbatim — exactly as v1's client emits `chat.message.send`
    with `metadata.attachment` immediately after this REST call
    succeeds.

    `attachment` is the message model's **one** canonical location for
    attachment data (see `Message.attachment`) — v1 read it from either
    `message.attachment` or `message.metadata.attachment`
    interchangeably (`raw.attachment ?? raw.metadata?.attachment`),
    which D4's \"one canonical name per concept\" rule closes for v2.

    The session is identified by the URL path, not a form field — v1
    passed `chatSessionId` redundantly inside the multipart body even
    though the REST call already had nowhere else to route to; this is
    a deliberate cleanup, not a functional change.

    **This endpoint models the proxied-upload flow v1 actually uses today
    (multipart straight to chat-service).** PRD §18 Open Question 7 —
    whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace this
    single multipart `POST` with a pair of calls (e.g. `POST
    .../attachments/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    Idempotency: supports `Idempotency-Key`. Without it, retrying a
    timed-out upload may store the file twice.

    File size and MIME-type limits are enforced server-side; the exact
    ceiling is not fixed by the PRD (tracked as an open question in the
    T2 handoff, not invented here). Violating either returns
    `VALIDATION_FAILED` (`413` for size, `415` for an unsupported MIME
    type).

    Args:
        session_id (str):
        idempotency_key (Union[Unset, str]):
        body (UploadSessionAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[Attachment, Error]
    """

    return (
        await asyncio_detailed(
            session_id=session_id,
            client=client,
            body=body,
            idempotency_key=idempotency_key,
        )
    ).parsed
