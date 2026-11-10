from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from time import perf_counter


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import Settings
from app.core.errors import ApiError
from app.models import TravelJournalImage
from app.services.travel_journals import (
    KimiJournalClient,
    count_body_words,
    process_image,
    validate_generated_result,
)


PHOTO_ROOT = PROJECT_ROOT / "frontend" / "public" / "scenic" / "spots" / "photos"
CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run three controlled real Kimi K3 travel-journal checks: "
            "text only, one image, and nine images. The key and generated text "
            "are never printed or written."
        )
    )
    parser.add_argument(
        "--allow-external",
        action="store_true",
        help="Required. Confirms that three billable external Kimi calls are allowed.",
    )
    parser.add_argument(
        "--scenario",
        action="append",
        choices=("text-only", "single-image", "nine-images"),
        help="Run only the selected scenario. May be provided more than once.",
    )
    args = parser.parse_args()

    if not args.allow_external:
        print(
            "Refusing to call Kimi without --allow-external.",
            file=sys.stderr,
        )
        return 2

    settings = Settings()
    if not settings.kimi_api_key:
        print(
            "MOONSHOT_API_KEY is not configured in backend/.env or the process environment.",
            file=sys.stderr,
        )
        return 2
    if settings.kimi_model != "kimi-k3":
        print(
            "KIMI_MODEL must be kimi-k3 for this acceptance check.",
            file=sys.stderr,
        )
        return 2

    candidates = sorted(
        path
        for path in PHOTO_ROOT.rglob("*")
        if path.is_file() and path.suffix.lower() in CONTENT_TYPES
    )
    if len(candidates) < 9:
        print(
            f"Need at least 9 scenic photos under {PHOTO_ROOT}.",
            file=sys.stderr,
        )
        return 2

    client = KimiJournalClient(
        base_url=settings.kimi_base_url,
        api_key=settings.kimi_api_key,
        model=settings.kimi_model,
        timeout_seconds=settings.kimi_timeout_seconds,
    )
    scenarios = [
        (
            "text-only",
            "今日沿着灵山景区缓步游览，夏日光影安静，想记录下放慢脚步后的轻松心情。",
            0,
        ),
        ("single-image", "", 1),
        ("nine-images", "", 9),
    ]
    if args.scenario:
        selected_names = set(args.scenario)
        scenarios = [
            scenario
            for scenario in scenarios
            if scenario[0] in selected_names
        ]

    with TemporaryDirectory(prefix="travel-journal-kimi-live-") as temp_dir:
        images = _prepare_images(candidates, Path(temp_dir), 9)
        summaries = []
        for name, description, image_count in scenarios:
            selected = images[:image_count]
            request_bytes = client.request_size_bytes(
                description=description,
                target_words=300,
                images=selected,
            )
            started_at = perf_counter()
            raw_result = None
            try:
                raw_result = client.generate(
                    description=description,
                    target_words=300,
                    images=selected,
                )
                result = validate_generated_result(
                    raw_result,
                    image_ids=[image.id for image in selected],
                    target_words=300,
                )
            except ApiError as exc:
                failure = {
                    "scenario": name,
                    "ok": False,
                    "error_code": exc.code,
                    "elapsed_seconds": round(perf_counter() - started_at, 2),
                    "request_bytes": request_bytes,
                }
                if isinstance(raw_result, dict):
                    failure.update(
                        {
                            "body_words": count_body_words(raw_result),
                            "text_sections": len(
                                raw_result.get("text_sections") or []
                            ),
                            "image_sections": len(
                                raw_result.get("image_sections") or []
                            ),
                        }
                    )
                summaries.append(failure)
                continue

            summaries.append(
                {
                    "scenario": name,
                    "ok": True,
                    "model": settings.kimi_model,
                    "reasoning_effort": "low",
                    "elapsed_seconds": round(perf_counter() - started_at, 2),
                    "request_bytes": request_bytes,
                    "body_words": count_body_words(result),
                    "text_sections": len(result["text_sections"]),
                    "image_sections": len(result["image_sections"]),
                }
            )

    print(json.dumps({"results": summaries}, ensure_ascii=False, indent=2))
    return 0 if all(item["ok"] for item in summaries) else 1


def _prepare_images(
    candidates: list[Path],
    asset_root: Path,
    required_count: int,
) -> list[TravelJournalImage]:
    images = []
    for candidate in candidates:
        try:
            display_path, model_path = process_image(
                candidate.read_bytes(),
                filename=candidate.name,
                content_type=CONTENT_TYPES[candidate.suffix.lower()],
                journal_id="live-check",
                asset_root=str(asset_root),
            )
        except ApiError:
            continue
        image_id = Path(display_path).stem
        images.append(
            TravelJournalImage(
                id=image_id,
                journal_id="live-check",
                display_path=display_path,
                model_path=model_path,
                content_type="image/jpeg",
                sort_order=len(images),
            )
        )
        if len(images) == required_count:
            return images
    raise RuntimeError(
        f"Only {len(images)} valid scenic photos were found; {required_count} required."
    )


if __name__ == "__main__":
    raise SystemExit(main())
