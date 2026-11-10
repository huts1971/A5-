import asyncio
import json
from types import SimpleNamespace

import pytest

from scenic_guide_core.agent import GuideAgent
from scenic_guide_core.config import Settings
from scenic_guide_core.contracts import Hit, RetrievalResult, Scope, TrainingExample
from scenic_guide_core.ingestion import Block, Corpus, chunk_blocks, flatten_tables, parse_document, write_jsonl
from scenic_guide_core.sft import Candidate, document_split, export_approved, teaching_messages


def corpus_for(text):
    return Corpus(chunk_blocks([Block("section", text)], document_id="guide", title="Guide",
                               map_id="ling-shan", approved=True))


def test_release_keeps_published_snapshot_during_another_build(tmp_path):
    base = tmp_path / "corpus.jsonl"
    first, second = corpus_for("first revision"), corpus_for("second revision")
    first_path = tmp_path / f"corpus.{first.id}.jsonl"
    first.save(first_path)
    write_jsonl(base.with_suffix(".release.jsonl"), [{"corpus_file": first_path.name, "corpus_id": first.id}])
    second.save(tmp_path / f"corpus.{second.id}.jsonl")

    assert Corpus.load(base).id == first.id


def test_release_rejects_path_escape_and_wrong_fingerprint(tmp_path):
    base = tmp_path / "corpus.jsonl"
    release = base.with_suffix(".release.jsonl")
    write_jsonl(release, [{"corpus_file": "../outside.jsonl", "corpus_id": "wrong"}])
    with pytest.raises(ValueError, match="filename"):
        Corpus.load(base)
    corpus_for("data").save(tmp_path / "snapshot.jsonl")
    write_jsonl(release, [{"corpus_file": "snapshot.jsonl", "corpus_id": "wrong"}])
    with pytest.raises(ValueError, match="fingerprint"):
        Corpus.load(base)


def test_markdown_table_preserves_column_names(tmp_path):
    source = tmp_path / "guide.md"
    source.write_text("# Services\n\n| Item | Place |\n| --- | --- |\n| Water | Gate |\n", encoding="utf-8")
    blocks = flatten_tables(parse_document(source))
    assert any(block.kind == "table_row" and "Item: Water" in block.text
               and "Place: Gate" in block.text for block in blocks)


def test_flatten_tables_leaves_source_blocks_unchanged():
    blocks = [Block("Tickets", "", [1], "table", "tickets", ["Type"], [["Adult"]]),
              Block("Tickets", "", [2], "table", "tickets", ["Type"], [["Child"]])]
    first = flatten_tables(blocks)
    second = flatten_tables(blocks)
    assert first == second
    assert blocks[0].pages == [1]
    assert blocks[0].rows == [["Adult"]]
    assert first[0].pages == [1, 2]


def test_tool_budget_preserves_completed_observation():
    corpus = corpus_for("scenic evidence")
    result = RetrievalResult(hits=[Hit(chunk=corpus.chunks[0])], timings_ms={"total": 5.0},
                             corpus_id=corpus.id, mode="hybrid_rerank")
    agent = GuideAgent.__new__(GuideAgent)
    agent.settings = Settings(max_tool_calls=1)
    agent.retriever = SimpleNamespace(search=lambda question, scope: result)
    calls = [{"id": f"call_{index}", "function": {"name": "search_knowledge",
              "arguments": json.dumps({"question": "scenic question"})}} for index in range(2)]
    state = {"messages": [{"role": "assistant", "tool_calls": calls}],
             "scope": {"map_id": "ling-shan"}, "evidence": {}, "rounds": 1, "tool_calls": 0,
             "answer": None, "trace": [], "timings_ms": {"llm": 1.0, "retrieval": 0.0}, "stopped": False}
    updated = asyncio.run(agent._execute(state))
    assert updated["tool_calls"] == 1
    assert corpus.chunks[0].id in updated["evidence"]
    assert updated["timings_ms"]["retrieval"] == 5.0
    assert updated["answer"]["status"] == "budget_exhausted"
    assert updated["messages"][-1]["tool_call_id"] == "call_0"


def test_teaching_messages_use_per_query_observations():
    candidate = Candidate(category="multi_hop", question="Which place and when?", answer="A in year B",
                          supporting_chunk_ids=["a", "b"], subqueries=["Which place?", "When?"], rationale="sources")
    observations = [{"evidence": [{"id": "a"}], "corpus_id": "v1"},
                    {"evidence": [{"id": "b"}], "corpus_id": "v1"}]
    messages = teaching_messages(candidate, Scope(map_id="ling-shan"), observations)
    actual = [json.loads(message["content"]) for message in messages if message["role"] == "tool"]
    assert actual == observations


def test_training_export_deduplicates_questions_not_server_context(tmp_path):
    examples = []
    for index in range(2):
        candidate = Candidate(category="chat", question=f"Greeting {index}", answer="Welcome",
                              supporting_chunk_ids=[], rationale="conversation")
        examples.append(TrainingExample(
            id=str(index), category="chat", document_ids=["guide"], chunk_ids=[],
            messages=teaching_messages(candidate, Scope(map_id="ling-shan"), []),
            split=document_split("guide"), approved=True, reviewer="fixture",
        ).model_dump())
    source = tmp_path / "training.jsonl"
    write_jsonl(source, examples)
    result = export_approved(source, tmp_path / "split")
    assert sum(result["approved"].values()) == 2
