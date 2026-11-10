from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from scripts.evaluate_guide_rag_100 import run_guide_rag_evaluation


DEMO_CRITICAL_CASE_IDS = [
    "casual_001",
    "casual_003",
    "casual_005",
    "fact_011",
    "fact_014",
    "explain_021",
    "explain_022",
    "explain_027",
    "semantic_031",
    "semantic_033",
    "semantic_034",
    "semantic_036",
    "semantic_037",
    "semantic_040",
    "service_041",
    "service_044",
    "service_048",
    "list_051",
    "list_053",
    "bound_091",
    "bound_092",
    "bound_093",
    "bound_094",
    "bound_095",
    "bound_099",
    "route_061",
    "route_062",
    "route_063",
    "follow_071",
    "real_081",
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run a real MiMo + Bailian embedding quality check for the AI guide. "
            "This sends guide prompts and evidence snippets to configured external APIs."
        )
    )
    parser.add_argument(
        "--allow-external",
        action="store_true",
        help="Required. Confirms that real MiMo and Bailian API calls are allowed.",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help="Run all 100 cases instead of the 30 demo-critical cases.",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional JSON report path. Keep this local; do not commit live responses.",
    )
    args = parser.parse_args()

    if not args.allow_external:
        print(
            "Refusing to call external APIs. Re-run with --allow-external after confirming "
            "backend/.env contains local MiMo and Bailian keys.",
            file=sys.stderr,
        )
        return 2

    report = run_guide_rag_evaluation(
        real_llm=True,
        real_embedding=True,
        case_ids=[] if args.full else DEMO_CRITICAL_CASE_IDS,
    )
    summary = {
        "ok": report["ok"],
        "mode": report["mode"],
        "summary": report["summary"],
        "failure_count": len(report["failures"]),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
