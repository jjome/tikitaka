from dataclasses import dataclass, field, asdict
from typing import Literal
import time
import uuid

State = Literal['paused', 'generating', 'speaking', 'pacing', 'listening', 'ended']


@dataclass
class Message:
    speaker: str
    text: str
    revision: int
    seq: int
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    delivery: str = 'received'
    client_message_id: str | None = None
    created_at: float = field(default_factory=time.time)

    def public(self):
        return asdict(self)


@dataclass(frozen=True)
class Policy:
    pacing_seconds: float = 1.5
    generation_timeout: float = 20
    playback_timeout: float = 60
    speech_timeout: float = 6
    heartbeat_timeout: float = 35
    max_calls: int = 60
    max_session_seconds: float = 600


@dataclass(frozen=True)
class GenerationRequest:
    speaker: str
    language: str
    topic_id: str
    history: tuple[dict, ...]
    purpose: str
    revision: int


@dataclass(frozen=True)
class GenerationResult:
    text: str
    usage: dict = field(default_factory=dict)


class DomainError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

