from dataclasses import dataclass
from uuid import uuid4


@dataclass(frozen=True)
class AvatarSession:
    session_id: str


class SessionRegistry:
    def __init__(self):
        self._sessions: dict[str, AvatarSession] = {}

    def create(self) -> AvatarSession:
        session = AvatarSession(session_id=f"a5-guide-{uuid4().hex}")
        self._sessions[session.session_id] = session
        return session

    def get(self, session_id: str) -> AvatarSession | None:
        return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)
