"""Serve the app using the Python standard library."""

import argparse
import os
from functools import partial
from http.server import ThreadingHTTPServer
from food_api import FoodHandler
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Run the Hankki web app.")
    parser.add_argument("--port", type=int, default=os.environ.get("PORT", "8000"))
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    web_root = Path(__file__).resolve().parent
    if not (web_root / "index.html").is_file():
        web_root = web_root / "dist"
    if not (web_root / "index.html").is_file():
        parser.exit(1, "index.html could not be found. Extract the entire app folder.\n")

    handler = partial(FoodHandler, directory=str(web_root))
    try:
        with ThreadingHTTPServer((args.host, args.port), handler) as server:
            display_host = "localhost" if args.host == "0.0.0.0" else args.host
            print(f"Hankki is running at http://{display_host}:{server.server_port}/", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    except OSError as error:
        parser.exit(1, f"Unable to start the server. {error}\n")


if __name__ == "__main__":
    main()
