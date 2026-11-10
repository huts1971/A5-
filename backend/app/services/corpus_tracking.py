from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.models import KnowledgeChunk, KnowledgeDoc, MapPoint, ScenicSpot, SpotFact
from app.models.agentic import CoreDocumentScope
from app.services.agentic_runtime import mark_corpus_dirty


FIELDS = {
    KnowledgeDoc: {"title", "content_hash", "path", "source_type"},
    KnowledgeChunk: {"chunk_text", "spot_id", "doc_id", "chunk_index"},
    ScenicSpot: {"name", "summary", "story"},
    SpotFact: {"spot_id", "fact_key", "fact_label", "fact_value", "fact_unit", "source_type", "source_url"},
    MapPoint: {"spot_id", "map_id"},
    CoreDocumentScope: {"document_id", "map_id"},
}


@event.listens_for(Session, "before_flush")
def track_corpus_changes(db, _flush_context, _instances):
    for row in list(db.new) + list(db.dirty) + list(db.deleted):
        fields = FIELDS.get(type(row))
        if not fields:
            continue
        changed = row in db.new or row in db.deleted or any(inspect(row).attrs[name].history.has_changes() for name in fields)
        if changed:
            mark_corpus_dirty(db)
            break
