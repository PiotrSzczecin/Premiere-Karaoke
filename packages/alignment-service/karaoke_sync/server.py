from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import traceback
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from . import __version__
from .alignment import AlignmentCancelled, WhisperXAligner, align_entries


LOGGER = logging.getLogger("karaoke-sync")
MAX_BODY = 10 * 1024 * 1024


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()
        self._aligner = WhisperXAligner()

    def create(self, request: dict[str, Any]) -> str:
        job_id = uuid.uuid4().hex
        job = {
            "jobId": job_id,
            "status": "queued",
            "progress": 0.0,
            "message": "W kolejce",
            "cancel": threading.Event(),
            "result": None,
            "error": None,
        }
        with self._lock:
            self._jobs[job_id] = job
        threading.Thread(target=self._run, args=(job_id, request), daemon=True, name=f"karaoke-{job_id[:8]}").start()
        return job_id

    def _run(self, job_id: str, request: dict[str, Any]) -> None:
        job = self._jobs[job_id]
        job["status"] = "running"

        def update(progress: float, message: str) -> None:
            with self._lock:
                job["progress"] = max(0.0, min(1.0, progress))
                job["message"] = message

        try:
            job["result"] = align_entries(request, job["cancel"], update, self._aligner)
            job["status"] = "completed"
            job["progress"] = 1.0
        except AlignmentCancelled as error:
            job["status"] = "cancelled"
            job["message"] = str(error)
        except Exception as error:  # noqa: BLE001 - converted to a safe local API error
            LOGGER.error("Job %s failed: %s\n%s", job_id, error, traceback.format_exc())
            job["status"] = "failed"
            job["error"] = str(error)

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return None
            return {key: value for key, value in job.items() if key != "cancel"}

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return False
            job["cancel"].set()
            return True


JOBS = JobStore()


class Handler(BaseHTTPRequestHandler):
    server_version = "KaraokeSync"
    sys_version = ""

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, status: int, value: Any) -> None:
        payload = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Nieprawidłowy rozmiar żądania.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._json(HTTPStatus.NO_CONTENT, {})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in {"/", "/v1/health"}:
            self._json(HTTPStatus.OK, {
                "status": "ok",
                "version": __version__,
                "bind": "127.0.0.1",
                "exactAvailable": WhisperXAligner.available(),
                "offlineMode": os.environ.get("KARAOKE_OFFLINE") == "1",
            })
            return
        if path.startswith("/v1/jobs/"):
            job = JOBS.get(path.rsplit("/", 1)[-1])
            self._json(HTTPStatus.OK if job else HTTPStatus.NOT_FOUND, job or {"error": "Nie znaleziono zadania."})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Nieznany endpoint."})

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/v1/jobs":
            self._json(HTTPStatus.NOT_FOUND, {"error": "Nieznany endpoint."})
            return
        try:
            request = self._body()
            if request.get("mode") not in {"exact", "quick"}:
                raise ValueError("Tryb musi mieć wartość exact albo quick.")
            job_id = JOBS.create(request)
            self._json(HTTPStatus.ACCEPTED, {"jobId": job_id})
        except (ValueError, json.JSONDecodeError) as error:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def do_DELETE(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/v1/jobs/"):
            ok = JOBS.cancel(path.rsplit("/", 1)[-1])
            self._json(HTTPStatus.OK if ok else HTTPStatus.NOT_FOUND, {"cancelled": ok})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Nieznany endpoint."})

    def log_message(self, format_string: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.client_address[0], format_string % args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Local forced-alignment service for Premiere Karaoke UXP")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if os.environ.get("KARAOKE_OFFLINE") == "1":
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    LOGGER.info("Karaoke Sync %s listening only on http://127.0.0.1:%s", __version__, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
