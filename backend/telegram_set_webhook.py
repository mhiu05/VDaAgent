"""One-off: register `<APP_URL>/telegram/webhook` with Telegram (`setWebhook`).

Run by hand after `make up`, whenever `APP_URL` or `TELEGRAM_BOT_TOKEN` changes:

    python -m backend.telegram_set_webhook
"""

from __future__ import annotations

import asyncio

from backend.settings import Settings
from backend.telegram_client import TelegramClient


async def main() -> None:
    settings = Settings()
    token = settings.TELEGRAM_BOT_TOKEN.get_secret_value()
    secret = settings.TELEGRAM_WEBHOOK_SECRET.get_secret_value()
    if not token or not secret:
        raise SystemExit("TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must both be set")
    url = f"{settings.APP_URL.rstrip('/')}/telegram/webhook"
    client = TelegramClient(token)
    try:
        await client.set_webhook(url, secret)
    finally:
        await client.aclose()
    print(f"webhook set: {url}")


if __name__ == "__main__":
    asyncio.run(main())
