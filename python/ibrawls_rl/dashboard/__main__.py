"""``python -m ibrawls_rl.dashboard`` — launch the local control board."""
from __future__ import annotations

import argparse

from .server import serve


def main() -> None:
    ap = argparse.ArgumentParser(description="iBrawls RL control board (local web UI).")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--no-browser", action="store_true", help="don't auto-open the browser")
    args = ap.parse_args()
    serve(host=args.host, port=args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
