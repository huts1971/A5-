from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ChatSessionAccess(Base):
    __tablename__ = "chat_session_access"
    session_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class CoreCorpusRevision(Base):
    __tablename__ = "guide_core_corpus_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class CoreDocumentScope(Base):
    __tablename__ = "guide_core_document_scope"
    document_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    map_id: Mapped[str] = mapped_column(String(100), primary_key=True)
