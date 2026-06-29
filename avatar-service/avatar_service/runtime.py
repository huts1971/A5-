from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class RuntimeStatus:
    ready: bool
    detail: str


class AvatarRuntime(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def status(self) -> RuntimeStatus: ...
