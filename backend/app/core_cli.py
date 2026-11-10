"""Administrative core tasks; importing this module does not initialize services."""
import argparse
import asyncio
import json
import time

from app.core.config import Settings
from app.db.session import create_database_engine, create_session_factory, initialize_database
from app.services.agentic_runtime import GuideCoreRuntime
from app.services.auth import ensure_default_admin
from app.services.bootstrap import bootstrap_ling_shan_data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["init-data", "rebuild", "status", "memory-worker"])
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--max-jobs", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.max_jobs <= 10000:
        parser.error("max-jobs must be between 1 and 10000")
    settings = Settings()
    engine = create_database_engine(settings.database_url)
    initialize_database(engine)
    sessions = create_session_factory(engine)
    runtime = GuideCoreRuntime(settings, sessions)
    try:
        if args.command == "memory-worker":
            from scenic_guide_core.memory import MemoryWorker
            from scenic_guide_core.models import ChatClient

            config = runtime.config()
            if not config.allow_network:
                raise PermissionError("Enable allow_network explicitly before extracting memories")
            worker = MemoryWorker(runtime.memory(), ChatClient(config))
            jobs = 0
            while jobs < args.max_jobs:
                result = asyncio.run(worker.run_once())
                if result:
                    print(json.dumps(result, ensure_ascii=False))
                    jobs += 1
                if args.once:
                    break
                if not result:
                    time.sleep(2)
        else:
            with sessions() as db:
                if args.command == "init-data":
                    if len(settings.auth_token_secret) < 32:
                        raise ValueError("Run scripts/configure-local.py first")
                    bootstrap_ling_shan_data(db, settings.source_package_path, settings.derived_knowledge_path, settings)
                    ensure_default_admin(db, settings)
                    result = {"status": "initialized"}
                elif args.command == "rebuild":
                    result = runtime.rebuild(db)
                else:
                    result = runtime.status(db)
                print(json.dumps(result, ensure_ascii=False, indent=2))
    finally:
        runtime.close()
        engine.dispose()


if __name__ == "__main__":
    main()
