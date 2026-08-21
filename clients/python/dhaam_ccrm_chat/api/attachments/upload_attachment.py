from http import HTTPStatus
from typing import Any, Optional, Union

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.upload_attachment_body import UploadAttachmentBody
from ...models.upload_attachment_response_200 import UploadAttachmentResponse200
from ...models.upload_error import UploadError
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    body: UploadAttachmentBody,
    tenant_id: Union[Unset, str] = UNSET,
    chat_session_id: Union[Unset, str] = UNSET,
    x_tenant_id: Union[Unset, str] = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_tenant_id, Unset):
        headers["X-Tenant-ID"] = x_tenant_id

    params: dict[str, Any] = {}

    params["tenantId"] = tenant_id

    params["chatSessionId"] = chat_session_id

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/upload",
        "params": params,
    }

    _kwargs["files"] = body.to_multipart()

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Optional[Union[UploadAttachmentResponse200, UploadError]]:
    if response.status_code == 200:
        response_200 = UploadAttachmentResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = UploadError.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = UploadError.from_dict(response.json())

        return response_401

    if response.status_code == 500:
        response_500 = UploadError.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: Union[AuthenticatedClient, Client], response: httpx.Response
) -> Response[Union[UploadAttachmentResponse200, UploadError]]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: UploadAttachmentBody,
    tenant_id: Union[Unset, str] = UNSET,
    chat_session_id: Union[Unset, str] = UNSET,
    x_tenant_id: Union[Unset, str] = UNSET,
) -> Response[Union[UploadAttachmentResponse200, UploadError]]:
    r"""Upload a file (step 1 of the upload-then-announce flow).

     **This operation replaces `POST /sessions/{sessionId}/attachments`**,
    which this document previously modeled and which does not exist on
    the real backend. The actual route is `POST /upload`
    (`upload.routes.ts:82`), mounted directly at the service prefix with
    **no session id in the path at all**.

    Step 1 of the two-step flow: this endpoint uploads and stores the
    file and returns its metadata only. It does **not** create a chat
    message. The caller (core's `client.sendAttachment()`) must follow
    up by sending a WS `message.send` frame whose attachment data
    carries this response's `data`.

    **Session identification, and why it's a query parameter, not a
    path segment or a relied-upon form field.** `chatSessionId` is
    accepted from either the multipart field `chatSessionId` or the
    `?chatSessionId=` query parameter (`upload.routes.ts:144-147`,
    field checked first). Only the query form is safe to rely on: the
    handler reads it via Fastify-multipart's `request.file()` streaming
    API (`upload.routes.ts:124`), which per the plugin's own contract
    only resolves form fields that appear **before** the file part in
    the multipart body (`upload.routes.ts:33-38`). A client whose form
    writer places `file` before `chatSessionId` silently loses the
    field. The query parameter has no such ordering hazard, which is
    why `@dhaam-ccrm/rest`'s `createAttachmentUploader` sends it as a
    query parameter.

    **Tenant is a hint, never authority.** `X-Tenant-ID` header first,
    then `?tenantId=` query, used only to help verify the presented
    access token (`upload.routes.ts:94-98`). The tenant actually
    written to storage is always `verified.tenantId` off the token
    itself (`upload.routes.ts:142,158-163`) — neither header nor query
    can steer an upload into a different tenant's storage prefix.

    **Auth is `accessToken` only** — see the top-level Auth model
    section's documented exception; this route does not check
    `X-Publishable-Key`.

    **Limits, confirmed from source.** Max file size 50 MB
    (`VALIDATION.MAX_FILE_SIZE_MB = 50`,
    `shared/constants/index.ts:129`, enforced by the multipart plugin
    registration at `server.ts:181-186`); the plugin additionally caps
    at 5 files per request (`server.ts:184`), though this endpoint only
    ever reads the first file via `request.file()` — the 5-file
    ceiling is a plugin-wide setting this single-file endpoint does not
    exercise. Allowed MIME types, confirmed from
    `infrastructure/storage/s3-client.ts:13-32` (codec parameters such
    as `;codecs=opus` are stripped before matching, lines 39, 107):

    - **images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
    - **videos**: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`
    - **audio**: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`
    - **documents**: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-
    officedocument.wordprocessingml.document`, `application/vnd.ms-excel`,
    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `text/csv`

    **`mediaType` in the response is lowercase-plural** — `images` /
    `videos` / `audio` / `documents` (`s3-client.ts:38-44`'s
    `getMediaFolder`, echoed straight through as `result.mediaFolder`
    at `upload.routes.ts:172`). This is **not** the upper-snake-case
    `MediaType` enum (`IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT`) that
    `Attachment.mediaType` documents and that `@dhaam-ccrm/core`'s
    `messageTypeFor` switches on
    (`packages/core/src/messages/controller.ts:87-97`). See
    `UploadResponse.mediaType` below for the exact wire values and the
    adapter mapping — implemented in `packages/rest/src/media-type.ts`.

    **This endpoint models the proxied-upload flow v1 actually uses
    today (multipart straight to chat-service).** PRD §18 Open Question
    7 — whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace
    this single multipart `POST` with a pair of calls (e.g. `POST
    /upload/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    `Idempotency-Key` is not implemented — see \"Idempotency\" above.

    Args:
        tenant_id (Union[Unset, str]):
        chat_session_id (Union[Unset, str]):
        x_tenant_id (Union[Unset, str]):
        body (UploadAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[UploadAttachmentResponse200, UploadError]]
    """

    kwargs = _get_kwargs(
        body=body,
        tenant_id=tenant_id,
        chat_session_id=chat_session_id,
        x_tenant_id=x_tenant_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: UploadAttachmentBody,
    tenant_id: Union[Unset, str] = UNSET,
    chat_session_id: Union[Unset, str] = UNSET,
    x_tenant_id: Union[Unset, str] = UNSET,
) -> Optional[Union[UploadAttachmentResponse200, UploadError]]:
    r"""Upload a file (step 1 of the upload-then-announce flow).

     **This operation replaces `POST /sessions/{sessionId}/attachments`**,
    which this document previously modeled and which does not exist on
    the real backend. The actual route is `POST /upload`
    (`upload.routes.ts:82`), mounted directly at the service prefix with
    **no session id in the path at all**.

    Step 1 of the two-step flow: this endpoint uploads and stores the
    file and returns its metadata only. It does **not** create a chat
    message. The caller (core's `client.sendAttachment()`) must follow
    up by sending a WS `message.send` frame whose attachment data
    carries this response's `data`.

    **Session identification, and why it's a query parameter, not a
    path segment or a relied-upon form field.** `chatSessionId` is
    accepted from either the multipart field `chatSessionId` or the
    `?chatSessionId=` query parameter (`upload.routes.ts:144-147`,
    field checked first). Only the query form is safe to rely on: the
    handler reads it via Fastify-multipart's `request.file()` streaming
    API (`upload.routes.ts:124`), which per the plugin's own contract
    only resolves form fields that appear **before** the file part in
    the multipart body (`upload.routes.ts:33-38`). A client whose form
    writer places `file` before `chatSessionId` silently loses the
    field. The query parameter has no such ordering hazard, which is
    why `@dhaam-ccrm/rest`'s `createAttachmentUploader` sends it as a
    query parameter.

    **Tenant is a hint, never authority.** `X-Tenant-ID` header first,
    then `?tenantId=` query, used only to help verify the presented
    access token (`upload.routes.ts:94-98`). The tenant actually
    written to storage is always `verified.tenantId` off the token
    itself (`upload.routes.ts:142,158-163`) — neither header nor query
    can steer an upload into a different tenant's storage prefix.

    **Auth is `accessToken` only** — see the top-level Auth model
    section's documented exception; this route does not check
    `X-Publishable-Key`.

    **Limits, confirmed from source.** Max file size 50 MB
    (`VALIDATION.MAX_FILE_SIZE_MB = 50`,
    `shared/constants/index.ts:129`, enforced by the multipart plugin
    registration at `server.ts:181-186`); the plugin additionally caps
    at 5 files per request (`server.ts:184`), though this endpoint only
    ever reads the first file via `request.file()` — the 5-file
    ceiling is a plugin-wide setting this single-file endpoint does not
    exercise. Allowed MIME types, confirmed from
    `infrastructure/storage/s3-client.ts:13-32` (codec parameters such
    as `;codecs=opus` are stripped before matching, lines 39, 107):

    - **images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
    - **videos**: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`
    - **audio**: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`
    - **documents**: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-
    officedocument.wordprocessingml.document`, `application/vnd.ms-excel`,
    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `text/csv`

    **`mediaType` in the response is lowercase-plural** — `images` /
    `videos` / `audio` / `documents` (`s3-client.ts:38-44`'s
    `getMediaFolder`, echoed straight through as `result.mediaFolder`
    at `upload.routes.ts:172`). This is **not** the upper-snake-case
    `MediaType` enum (`IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT`) that
    `Attachment.mediaType` documents and that `@dhaam-ccrm/core`'s
    `messageTypeFor` switches on
    (`packages/core/src/messages/controller.ts:87-97`). See
    `UploadResponse.mediaType` below for the exact wire values and the
    adapter mapping — implemented in `packages/rest/src/media-type.ts`.

    **This endpoint models the proxied-upload flow v1 actually uses
    today (multipart straight to chat-service).** PRD §18 Open Question
    7 — whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace
    this single multipart `POST` with a pair of calls (e.g. `POST
    /upload/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    `Idempotency-Key` is not implemented — see \"Idempotency\" above.

    Args:
        tenant_id (Union[Unset, str]):
        chat_session_id (Union[Unset, str]):
        x_tenant_id (Union[Unset, str]):
        body (UploadAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[UploadAttachmentResponse200, UploadError]
    """

    return sync_detailed(
        client=client,
        body=body,
        tenant_id=tenant_id,
        chat_session_id=chat_session_id,
        x_tenant_id=x_tenant_id,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: UploadAttachmentBody,
    tenant_id: Union[Unset, str] = UNSET,
    chat_session_id: Union[Unset, str] = UNSET,
    x_tenant_id: Union[Unset, str] = UNSET,
) -> Response[Union[UploadAttachmentResponse200, UploadError]]:
    r"""Upload a file (step 1 of the upload-then-announce flow).

     **This operation replaces `POST /sessions/{sessionId}/attachments`**,
    which this document previously modeled and which does not exist on
    the real backend. The actual route is `POST /upload`
    (`upload.routes.ts:82`), mounted directly at the service prefix with
    **no session id in the path at all**.

    Step 1 of the two-step flow: this endpoint uploads and stores the
    file and returns its metadata only. It does **not** create a chat
    message. The caller (core's `client.sendAttachment()`) must follow
    up by sending a WS `message.send` frame whose attachment data
    carries this response's `data`.

    **Session identification, and why it's a query parameter, not a
    path segment or a relied-upon form field.** `chatSessionId` is
    accepted from either the multipart field `chatSessionId` or the
    `?chatSessionId=` query parameter (`upload.routes.ts:144-147`,
    field checked first). Only the query form is safe to rely on: the
    handler reads it via Fastify-multipart's `request.file()` streaming
    API (`upload.routes.ts:124`), which per the plugin's own contract
    only resolves form fields that appear **before** the file part in
    the multipart body (`upload.routes.ts:33-38`). A client whose form
    writer places `file` before `chatSessionId` silently loses the
    field. The query parameter has no such ordering hazard, which is
    why `@dhaam-ccrm/rest`'s `createAttachmentUploader` sends it as a
    query parameter.

    **Tenant is a hint, never authority.** `X-Tenant-ID` header first,
    then `?tenantId=` query, used only to help verify the presented
    access token (`upload.routes.ts:94-98`). The tenant actually
    written to storage is always `verified.tenantId` off the token
    itself (`upload.routes.ts:142,158-163`) — neither header nor query
    can steer an upload into a different tenant's storage prefix.

    **Auth is `accessToken` only** — see the top-level Auth model
    section's documented exception; this route does not check
    `X-Publishable-Key`.

    **Limits, confirmed from source.** Max file size 50 MB
    (`VALIDATION.MAX_FILE_SIZE_MB = 50`,
    `shared/constants/index.ts:129`, enforced by the multipart plugin
    registration at `server.ts:181-186`); the plugin additionally caps
    at 5 files per request (`server.ts:184`), though this endpoint only
    ever reads the first file via `request.file()` — the 5-file
    ceiling is a plugin-wide setting this single-file endpoint does not
    exercise. Allowed MIME types, confirmed from
    `infrastructure/storage/s3-client.ts:13-32` (codec parameters such
    as `;codecs=opus` are stripped before matching, lines 39, 107):

    - **images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
    - **videos**: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`
    - **audio**: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`
    - **documents**: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-
    officedocument.wordprocessingml.document`, `application/vnd.ms-excel`,
    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `text/csv`

    **`mediaType` in the response is lowercase-plural** — `images` /
    `videos` / `audio` / `documents` (`s3-client.ts:38-44`'s
    `getMediaFolder`, echoed straight through as `result.mediaFolder`
    at `upload.routes.ts:172`). This is **not** the upper-snake-case
    `MediaType` enum (`IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT`) that
    `Attachment.mediaType` documents and that `@dhaam-ccrm/core`'s
    `messageTypeFor` switches on
    (`packages/core/src/messages/controller.ts:87-97`). See
    `UploadResponse.mediaType` below for the exact wire values and the
    adapter mapping — implemented in `packages/rest/src/media-type.ts`.

    **This endpoint models the proxied-upload flow v1 actually uses
    today (multipart straight to chat-service).** PRD §18 Open Question
    7 — whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace
    this single multipart `POST` with a pair of calls (e.g. `POST
    /upload/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    `Idempotency-Key` is not implemented — see \"Idempotency\" above.

    Args:
        tenant_id (Union[Unset, str]):
        chat_session_id (Union[Unset, str]):
        x_tenant_id (Union[Unset, str]):
        body (UploadAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Union[UploadAttachmentResponse200, UploadError]]
    """

    kwargs = _get_kwargs(
        body=body,
        tenant_id=tenant_id,
        chat_session_id=chat_session_id,
        x_tenant_id=x_tenant_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: UploadAttachmentBody,
    tenant_id: Union[Unset, str] = UNSET,
    chat_session_id: Union[Unset, str] = UNSET,
    x_tenant_id: Union[Unset, str] = UNSET,
) -> Optional[Union[UploadAttachmentResponse200, UploadError]]:
    r"""Upload a file (step 1 of the upload-then-announce flow).

     **This operation replaces `POST /sessions/{sessionId}/attachments`**,
    which this document previously modeled and which does not exist on
    the real backend. The actual route is `POST /upload`
    (`upload.routes.ts:82`), mounted directly at the service prefix with
    **no session id in the path at all**.

    Step 1 of the two-step flow: this endpoint uploads and stores the
    file and returns its metadata only. It does **not** create a chat
    message. The caller (core's `client.sendAttachment()`) must follow
    up by sending a WS `message.send` frame whose attachment data
    carries this response's `data`.

    **Session identification, and why it's a query parameter, not a
    path segment or a relied-upon form field.** `chatSessionId` is
    accepted from either the multipart field `chatSessionId` or the
    `?chatSessionId=` query parameter (`upload.routes.ts:144-147`,
    field checked first). Only the query form is safe to rely on: the
    handler reads it via Fastify-multipart's `request.file()` streaming
    API (`upload.routes.ts:124`), which per the plugin's own contract
    only resolves form fields that appear **before** the file part in
    the multipart body (`upload.routes.ts:33-38`). A client whose form
    writer places `file` before `chatSessionId` silently loses the
    field. The query parameter has no such ordering hazard, which is
    why `@dhaam-ccrm/rest`'s `createAttachmentUploader` sends it as a
    query parameter.

    **Tenant is a hint, never authority.** `X-Tenant-ID` header first,
    then `?tenantId=` query, used only to help verify the presented
    access token (`upload.routes.ts:94-98`). The tenant actually
    written to storage is always `verified.tenantId` off the token
    itself (`upload.routes.ts:142,158-163`) — neither header nor query
    can steer an upload into a different tenant's storage prefix.

    **Auth is `accessToken` only** — see the top-level Auth model
    section's documented exception; this route does not check
    `X-Publishable-Key`.

    **Limits, confirmed from source.** Max file size 50 MB
    (`VALIDATION.MAX_FILE_SIZE_MB = 50`,
    `shared/constants/index.ts:129`, enforced by the multipart plugin
    registration at `server.ts:181-186`); the plugin additionally caps
    at 5 files per request (`server.ts:184`), though this endpoint only
    ever reads the first file via `request.file()` — the 5-file
    ceiling is a plugin-wide setting this single-file endpoint does not
    exercise. Allowed MIME types, confirmed from
    `infrastructure/storage/s3-client.ts:13-32` (codec parameters such
    as `;codecs=opus` are stripped before matching, lines 39, 107):

    - **images**: `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`
    - **videos**: `video/mp4`, `video/webm`, `video/quicktime`, `video/x-msvideo`
    - **audio**: `audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/mp4`
    - **documents**: `application/pdf`, `application/msword`, `application/vnd.openxmlformats-
    officedocument.wordprocessingml.document`, `application/vnd.ms-excel`,
    `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/plain`, `text/csv`

    **`mediaType` in the response is lowercase-plural** — `images` /
    `videos` / `audio` / `documents` (`s3-client.ts:38-44`'s
    `getMediaFolder`, echoed straight through as `result.mediaFolder`
    at `upload.routes.ts:172`). This is **not** the upper-snake-case
    `MediaType` enum (`IMAGE`/`VIDEO`/`AUDIO`/`DOCUMENT`) that
    `Attachment.mediaType` documents and that `@dhaam-ccrm/core`'s
    `messageTypeFor` switches on
    (`packages/core/src/messages/controller.ts:87-97`). See
    `UploadResponse.mediaType` below for the exact wire values and the
    adapter mapping — implemented in `packages/rest/src/media-type.ts`.

    **This endpoint models the proxied-upload flow v1 actually uses
    today (multipart straight to chat-service).** PRD §18 Open Question
    7 — whether v2 keeps this proxied shape or moves to direct-to-S3
    presigned URLs minted via REST — is explicitly **unresolved** and
    owned by the backend team. A presigned-URL design would replace
    this single multipart `POST` with a pair of calls (e.g. `POST
    /upload/upload-url` returning a presigned PUT target, then a
    client-side `PUT` straight to storage) and would change this
    response shape to include upload-target fields instead of a final
    `url`. **Do not implement against a presigned flow from this spec —
    it is not modeled here, only flagged.**

    `Idempotency-Key` is not implemented — see \"Idempotency\" above.

    Args:
        tenant_id (Union[Unset, str]):
        chat_session_id (Union[Unset, str]):
        x_tenant_id (Union[Unset, str]):
        body (UploadAttachmentBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Union[UploadAttachmentResponse200, UploadError]
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
            tenant_id=tenant_id,
            chat_session_id=chat_session_id,
            x_tenant_id=x_tenant_id,
        )
    ).parsed
