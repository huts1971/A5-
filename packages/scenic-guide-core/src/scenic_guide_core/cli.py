from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from .config import Settings
from .contracts import Scope
from .ingestion import Corpus, chunk_blocks, parse_document, write_jsonl


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="LingShiYin retrieval, training and memory commands")
    root.add_argument("--config", default="configs/core.example.toml")
    root.add_argument("--execute", action="store_true", help="Authorize the selected network/compute operation")
    commands = root.add_subparsers(dest="command", required=True)
    commands.add_parser("inspect")
    ingest = commands.add_parser("ingest")
    ingest.add_argument("input", type=Path)
    ingest.add_argument("output", type=Path)
    ingest.add_argument("--document-id", required=True)
    ingest.add_argument("--title", required=True)
    ingest.add_argument("--map-id", required=True)
    ingest.add_argument("--spot-id", default="")
    ingest.add_argument("--source-url", default="")
    ingest.add_argument("--table-anchors", type=Path)
    ingest.add_argument("--approved", action="store_true")
    importing = commands.add_parser("import-zip")
    importing.add_argument("input", type=Path)
    importing.add_argument("output", type=Path)
    importing.add_argument("--area-map", type=Path, required=True)
    importing.add_argument("--approved", action="store_true")
    merge = commands.add_parser("merge")
    merge.add_argument("output", type=Path)
    merge.add_argument("inputs", type=Path, nargs="+")
    crawl = commands.add_parser("crawl")
    crawl.add_argument("url")
    crawl.add_argument("output", type=Path)
    crawl.add_argument("--host", action="append", required=True)
    commands.add_parser("index")
    ask = commands.add_parser("ask")
    ask.add_argument("question")
    ask.add_argument("--map-id", required=True)
    ask.add_argument("--spot-id")
    ask.add_argument("--output", type=Path)
    seeds = commands.add_parser("sft-seeds")
    seeds.add_argument("output", type=Path)
    seeds.add_argument("--limit", type=int, default=200)
    expand = commands.add_parser("sft-expand")
    expand.add_argument("seeds", type=Path)
    expand.add_argument("output", type=Path)
    expand.add_argument("--max-calls", type=int, default=10)
    export = commands.add_parser("sft-export")
    export.add_argument("input", type=Path)
    export.add_argument("output_dir", type=Path)
    train = commands.add_parser("train")
    train.add_argument("recipe", type=Path)
    commands.add_parser("memory-init")
    commands.add_parser("memory-worker-once")
    for name in ["eval-retrieval", "eval-ragas", "generate-predictions"]:
        evaluate = commands.add_parser(name)
        evaluate.add_argument("input", type=Path)
        evaluate.add_argument("output", type=Path)
        if name != "eval-retrieval":
            evaluate.add_argument("--max-samples", type=int, default=20 if name == "generate-predictions" else 100)
    run = commands.add_parser("locomo-run")
    run.add_argument("input", type=Path)
    run.add_argument("output", type=Path)
    run.add_argument("--run-id", required=True)
    run.add_argument("--max-samples", type=int, default=1)
    run.add_argument("--max-questions", type=int, default=20)
    run.add_argument("--max-calls", type=int, default=200)
    score = commands.add_parser("locomo-score")
    score.add_argument("input", type=Path)
    score.add_argument("predictions", type=Path)
    score.add_argument("output", type=Path)
    return root


def main() -> None:
    args = parser().parse_args()
    if hasattr(args, "max_samples") and not 1 <= args.max_samples <= 10000:
        raise ValueError("max-samples must be between 1 and 10000")
    settings = Settings.load(args.config)
    output = getattr(args, "output", None)
    if output and output.exists():
        raise FileExistsError("Use a fresh output path; existing outputs are not overwritten by CLI")
    costly = {"crawl", "index", "ask", "sft-expand", "train", "memory-worker-once",
              "eval-retrieval", "eval-ragas", "locomo-run", "generate-predictions"}
    if args.command in costly and not args.execute:
        raise PermissionError("This command requires --execute")
    if args.command in costly - {"train"} and not settings.allow_network:
        raise PermissionError("Set allow_network=true in your own config before connecting to services")
    result: dict = {"command": args.command}
    if args.command == "inspect":
        result.update(allow_network=settings.allow_network, corpus=settings.corpus_path,
                      chat_model=settings.models.chat_model)
    elif args.command == "ingest":
        anchors = json.loads(args.table_anchors.read_text(encoding="utf-8")) if args.table_anchors else None
        chunks = chunk_blocks(parse_document(args.input, anchors), document_id=args.document_id,
                              title=args.title, map_id=args.map_id, spot_id=args.spot_id,
                              source_url=args.source_url, approved=args.approved)
        write_jsonl(output, (chunk.model_dump() for chunk in chunks))
        result["chunks"] = len(chunks)
    elif args.command == "import-zip":
        from .integration import import_competition_zip

        area_map = json.loads(args.area_map.read_text(encoding="utf-8"))
        chunks = import_competition_zip(args.input, area_map, approved=args.approved)
        write_jsonl(output, (chunk.model_dump() for chunk in chunks))
        result["chunks"] = len(chunks)
    elif args.command == "merge":
        from .contracts import Chunk
        from .evaluation import read_jsonl

        rows = [Chunk.model_validate(row) for path in args.inputs for row in read_jsonl(path)]
        corpus = Corpus(rows)
        corpus.save(output)
        result.update(corpus_id=corpus.id, approved_chunks=len(corpus.chunks), excluded_unapproved=len(rows)-len(corpus.chunks))
    elif args.command == "crawl":
        from .crawl import OfficialCrawler

        data = OfficialCrawler(set(args.host), settings.allow_network).fetch(args.url)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("xb") as stream:
            stream.write(data)
        result["status"] = "downloaded_unreviewed"
    elif args.command == "index":
        from .models import QwenEmbedder
        from .retrieval import MilvusIndex

        corpus = Corpus.load(settings.corpus_path)
        index = MilvusIndex(settings, corpus, QwenEmbedder(settings.models))
        try:
            index.build()
            result.update(collection=index.name, corpus_id=corpus.id)
        finally:
            index.client.close()
    elif args.command == "ask":
        from .agent import GuideAgent
        from .models import ChatClient
        from .retrieval import HybridRetriever

        client = ChatClient(settings)
        retriever = HybridRetriever.load(settings)
        try:
            agent = GuideAgent(settings, retriever, client)
            answer = asyncio.run(agent.answer(args.question, Scope(map_id=args.map_id, spot_id=args.spot_id)))
            result = answer.model_dump()
            if output:
                write_jsonl(output, [result])
        finally:
            retriever.vectors.client.close()
    elif args.command == "sft-seeds":
        from .sft import plan_seeds

        if not 1 <= args.limit <= 10000:
            raise ValueError("Seed limit must be between 1 and 10000")
        plan_seeds(Corpus.load(settings.corpus_path), output, args.limit)
    elif args.command == "sft-expand":
        from .evaluation import read_jsonl
        from .models import ChatClient
        from .sft import expand_seed
        from .retrieval import HybridRetriever

        if not 1 <= args.max_calls <= 200:
            raise ValueError("Choose a bounded teacher-call budget (1..200)")
        client = ChatClient(settings)
        seeds = read_jsonl(args.seeds)
        if not seeds:
            raise ValueError("Seed file must contain at least one record")
        retriever = HybridRetriever.load(settings)
        async def expand() -> None:
            generated = []
            for seed in seeds[:args.max_calls]:
                generated.extend(example.model_dump() for example in
                                 await expand_seed(client, retriever.corpus, seed, retriever))
                write_jsonl(output, generated)
            result["candidates"] = len(generated)
        try:
            asyncio.run(expand())
        finally:
            retriever.vectors.client.close()
        result["status"] = "candidates_require_human_review"
    elif args.command == "sft-export":
        from .sft import export_approved

        if args.output_dir.exists() and any(args.output_dir.iterdir()):
            raise FileExistsError("Training export requires an empty output directory")
        result = export_approved(args.input, args.output_dir)
    elif args.command == "train":
        from .sft import train_lora

        train_lora(args.recipe, execute=args.execute)
    elif args.command in {"memory-init", "memory-worker-once"}:
        from .memory import MemoryStore, MemoryWorker
        from .models import ChatClient

        if not settings.allow_network and not settings.memory.url.startswith("sqlite:///"):
            raise PermissionError("Non-SQLite memory initialization requires allow_network=true")
        store = MemoryStore(settings.memory)
        try:
            store.initialize()
            if args.command == "memory-worker-once":
                result["job"] = asyncio.run(MemoryWorker(store, ChatClient(settings)).run_once())
        finally:
            store.engine.dispose()
    elif args.command == "eval-retrieval":
        from .evaluation import retrieval_eval
        from .retrieval import HybridRetriever

        retriever = HybridRetriever.load(settings)
        try:
            result = retrieval_eval(retriever, args.input, output)
        finally:
            retriever.vectors.client.close()
    elif args.command == "generate-predictions":
        from .agent import GuideAgent
        from .evaluation import generate_predictions
        from .models import ChatClient
        from .retrieval import HybridRetriever

        client = ChatClient(settings)
        retriever = HybridRetriever.load(settings)
        try:
            agent = GuideAgent(settings, retriever, client)
            result = asyncio.run(generate_predictions(agent, args.input, output, max_samples=args.max_samples))
        finally:
            retriever.vectors.client.close()
    elif args.command == "eval-ragas":
        from .evaluation import ragas_eval

        result = ragas_eval(settings, args.input, output, max_samples=args.max_samples)
    elif args.command == "locomo-run":
        from .locomo import EpisodicMemoryPlugin, run_locomo
        from .memory import MemoryStore
        from .models import ChatClient, QwenEmbedder

        store = MemoryStore(settings.memory)
        try:
            plugin = EpisodicMemoryPlugin(store, ChatClient(settings), QwenEmbedder(settings.models), args.max_calls)
            store.initialize()
            asyncio.run(run_locomo(plugin, args.input, output, run_id=args.run_id,
                                   max_samples=args.max_samples, max_questions=args.max_questions))
        finally:
            store.engine.dispose()
    elif args.command == "locomo-score":
        from .locomo import locomo_score

        result = locomo_score(args.input, args.predictions)
        write_jsonl(output, [result])
    print(json.dumps(result, ensure_ascii=False, indent=2))
