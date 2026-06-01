import os

from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier
from application.discover import DiscoverUseCase

uc = DiscoverUseCase(LLMChain(), TelegramNotifier())
uc.run(
    limit=int(os.environ.get("DISCOVER_LIMIT", "100")),
    min_score=float(os.environ.get("DISCOVER_MIN_SCORE", "3.0")),
)
