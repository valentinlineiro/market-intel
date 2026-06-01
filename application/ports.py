from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Callable
from domain.models import Signal, Opportunity


class SignalRepository(ABC):
    @abstractmethod
    def save(self, signal: Signal) -> bool: ...        # False = duplicate
    @abstractmethod
    def get(self, segment: str | None = None, limit: int = 100) -> list[Signal]: ...
    @abstractmethod
    def count(self, segment: str | None = None) -> int: ...
    @abstractmethod
    def exists(self, url: str, segment: str) -> bool: ...


class OpportunityRepository(ABC):
    @abstractmethod
    def upsert(self, opp: Opportunity) -> None: ...
    @abstractmethod
    def get_all(self) -> list[Opportunity]: ...
    @abstractmethod
    def get_by_segment(self, segment: str) -> Opportunity | None: ...


class LLMProvider(ABC):
    @abstractmethod
    def complete(self, prompt: str, max_tokens: int = 1024) -> str: ...


class Notifier(ABC):
    @abstractmethod
    def send(self, message: str) -> bool: ...


class PageDeployer(ABC):
    @abstractmethod
    def deploy(self, segment: str, copy: dict) -> str: ...  # returns published URL


# Type alias for collector callables
Collector = Callable[[str], list[Signal]]
