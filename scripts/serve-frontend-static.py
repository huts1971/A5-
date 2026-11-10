from __future__ import annotations

import argparse
import os
import posixpath
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIST_ROOT = PROJECT_ROOT / "frontend" / "dist"


class SpaStaticHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        candidate = self._candidate_path()
        if not candidate.is_file() and not candidate.is_dir():
            self.path = "/index.html"
        return super().send_head()

    def _candidate_path(self) -> Path:
        request_path = unquote(urlsplit(self.path).path)
        normalized = posixpath.normpath(request_path.lstrip("/"))
        parts = [
            part
            for part in normalized.split("/")
            if part and part not in (".", "..")
        ]
        return DIST_ROOT.joinpath(*parts) if parts else DIST_ROOT


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("FRONTEND_PORT", "5173")),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    index_file = DIST_ROOT / "index.html"
    if not index_file.is_file():
        print(f"Missing {index_file}. Run BUILD-FRONTEND.bat first.", file=sys.stderr)
        return 1

    handler = partial(SpaStaticHandler, directory=str(DIST_ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"Static frontend ready at http://127.0.0.1:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
