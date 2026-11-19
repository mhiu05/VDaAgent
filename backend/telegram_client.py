"""api's client for the Telegram Bot API (doc 08-style outbound integration)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024  # matches backend.messaging.attachments.MAX_BYTES


class TelegramError(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code
        self.message = message


class TelegramClient:
    def __init__(self, token: str, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._token = token
        self._http = httpx.AsyncClient(
            base_url=f"https://api.telegram.org/bot{token}", transport=transport
        )
        self._file_http = httpx.AsyncClient(
            base_url=f"https://api.telegram.org/file/bot{token}", transport=transport
        )

    async def aclose(self) -> None:
        await self._http.aclose()
        await self._file_http.aclose()

    async def _call(self, method: str, **params: Any) -> dict:
        try:
            r = await self._http.post(f"/{method}", json=params, timeout=10)
        except httpx.HTTPError as e:
            raise TelegramError("unreachable", str(e) or type(e).__name__) from e
        data = r.json()
        if not data.get("ok"):
            raise TelegramError(f"http_{r.status_code}", str(data.get("description", "")))
        return data["result"]

    async def _upload(self, method: str, field: str, path: Path, **params: Any) -> dict:
        try:
            with open(path, "rb") as fh:
                r = await self._http.post(
                    f"/{method}",
                    data=params,
                    files={field: (path.name, fh)},
                    timeout=60,
                )
        except httpx.HTTPError as e:
            raise TelegramError("unreachable", str(e) or type(e).__name__) from e
        data = r.json()
        if not data.get("ok"):
            raise TelegramError(f"http_{r.status_code}", str(data.get("description", "")))
        return data["result"]

    async def send_message(
        self,
        chat_id: int,
        text: str,
        *,
        reply_markup: dict | None = None,
        parse_mode: str | None = None,
    ) -> dict:
        params: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            params["reply_markup"] = reply_markup
        if parse_mode is not None:
            params["parse_mode"] = parse_mode
        return await self._call("sendMessage", **params)

    async def answer_callback_query(self, callback_query_id: str, text: str | None = None) -> dict:
        params: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text is not None:
            params["text"] = text
        return await self._call("answerCallbackQuery", **params)

    async def send_photo(self, chat_id: int, path: Path, *, caption: str | None = None) -> dict:
        return await self._upload(
            "sendPhoto", "photo", path, chat_id=chat_id, **({"caption": caption} if caption else {})
        )

    async def send_document(self, chat_id: int, path: Path, *, caption: str | None = None) -> dict:
        return await self._upload(
            "sendDocument",
            "document",
            path,
            chat_id=chat_id,
            **({"caption": caption} if caption else {}),
        )

    async def get_file_path(self, file_id: str) -> str:
        result = await self._call("getFile", file_id=file_id)
        return str(result["file_path"])

    async def download_file(self, file_id: str) -> bytes:
        file_path = await self.get_file_path(file_id)
        try:
            async with self._file_http.stream("GET", f"/{file_path}", timeout=60) as r:
                if r.status_code != 200:
                    raise TelegramError(f"http_{r.status_code}", "file download failed")
                chunks = []
                size = 0
                async for chunk in r.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        raise TelegramError("file_too_large", "file exceeds the upload limit")
                    chunks.append(chunk)
        except httpx.HTTPError as e:
            raise TelegramError("unreachable", str(e) or type(e).__name__) from e
        return b"".join(chunks)

    async def set_webhook(self, url: str, secret_token: str) -> dict:
        return await self._call("setWebhook", url=url, secret_token=secret_token)
