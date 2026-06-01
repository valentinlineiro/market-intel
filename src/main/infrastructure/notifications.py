import os
import logging
import requests
from application.ports import Notifier

log = logging.getLogger(__name__)


class TelegramNotifier(Notifier):
    def __init__(self):
        self._token = os.getenv("TELEGRAM_BOT_TOKEN")
        self._chat_id = os.getenv("TELEGRAM_CHAT_ID")

    def send(self, message: str) -> bool:
        if not self._token or not self._chat_id:
            log.debug("Telegram not configured — skipping")
            return False
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{self._token}/sendMessage",
                json={"chat_id": self._chat_id, "text": message, "parse_mode": "Markdown"},
                timeout=10,
            )
            return resp.ok
        except Exception as e:
            log.error(f"Telegram failed: {e}")
            return False


class NoopNotifier(Notifier):
    def send(self, message: str) -> bool:
        log.info(f"[NOOP NOTIFIER] {message[:80]}")
        return True
