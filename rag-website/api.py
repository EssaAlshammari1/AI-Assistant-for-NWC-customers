import json
import mimetypes
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from rag import answer_question, clear_conversation_history, create_rag_components
from speech import create_transcriber, transcribe_audio


HOST = os.getenv("RAG_HOST", "127.0.0.1")
PORT =8000
MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024
AUDIO_FILE_EXTENSIONS = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/flac": ".flac",
    "audio/x-flac": ".flac",
}
WEBSITE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = WEBSITE_ROOT.parent
COMPONENTS = None
COMPONENTS_LOCK = threading.Lock()
TRANSCRIBER = None
TRANSCRIBER_LOCK = threading.Lock()


def get_components():
    global COMPONENTS
    if COMPONENTS is None:
        with COMPONENTS_LOCK:
            if COMPONENTS is None:
                COMPONENTS = create_rag_components()
    return COMPONENTS


def get_transcriber():
    global TRANSCRIBER
    if TRANSCRIBER is None:
        with TRANSCRIBER_LOCK:
            if TRANSCRIBER is None:
                TRANSCRIBER = create_transcriber()
    return TRANSCRIBER


def make_sources(sources):
    return [{"text": document, "score": score} for document, score in sources]


def website_file(request_path):
    path = unquote(urlsplit(request_path).path)
    if path in {"/", "/pro2/rag-website/"}:
        return WEBSITE_ROOT / "index.html"
    if path.startswith("/pro2/rag-website/"):
        path = path.removeprefix("/pro2/rag-website/")
    elif path.startswith("/"):
        path = path[1:]
    if path == "assets/nwc logo.png":
        return PROJECT_ROOT / path
    if path in {"app.js", "styles.css", "index.html"}:
        return WEBSITE_ROOT / path
    return None


class RAGRequestHandler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, ngrok-skip-browser-warning",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_json(204, {})

    def do_GET(self):
        if self.path == "/health":
            self.send_json(
                200,
                {
                    "status": "ok",
                    "model_loaded": COMPONENTS is not None,
                    "transcription_ready": TRANSCRIBER is not None,
                },
            )
            return
        file_path = website_file(self.path)
        if file_path and file_path.is_file():
            body = file_path.read_bytes()
            content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_json(404, {"error": "Route not found"})

    def do_POST(self):
        if self.path == "/clear":
            try:
                clear_conversation_history()
                self.send_json(200, {"status": "ok"})
            except Exception as error:
                self.send_json(500, {"error": str(error)})
            return

        request_url = urlsplit(self.path)
        if request_url.path == "/transcribe":
            self.do_transcribe(request_url.query)
            return

        if self.path != "/ask":
            self.send_json(404, {"error": "Route not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length))
            question = payload.get("question", "")
            if not isinstance(question, str) or not question.strip():
                self.send_json(400, {"error": "question must be a non-empty string"})
                return

            answer, sources = answer_question(question.strip(), get_components())
            self.send_json(200, {"answer": answer, "sources": make_sources(sources)})
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Request body must be valid JSON"})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

    def do_transcribe(self, query_string=""):
        language = parse_qs(query_string).get("language", ["ar"])[0].lower()
        if language not in {"ar", "en"}:
            self.send_json(400, {"error": "language must be 'ar' or 'en'."})
            return

        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        suffix = AUDIO_FILE_EXTENSIONS.get(content_type)
        if suffix is None:
            self.send_json(415, {"error": "Use a supported audio recording format."})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length header."})
            return

        if content_length <= 0:
            self.send_json(400, {"error": "The audio recording is empty."})
            return
        if content_length > MAX_AUDIO_UPLOAD_BYTES:
            self.send_json(413, {"error": "Audio recordings must be 25 MB or smaller."})
            return

        temporary_path = None
        try:
            audio_bytes = self.rfile.read(content_length)
            if len(audio_bytes) != content_length:
                self.send_json(400, {"error": "The audio upload was incomplete."})
                return

            if len(audio_bytes) != content_length:
                self.send_json(400, {"error": "The audio upload was incomplete."})
                return

            text = transcribe_audio(
                get_transcriber(),
                audio_bytes,
                f"voice-question{suffix}",
                content_type,
                language,
            )
            if not text:
                self.send_json(422, {"error": "No speech was recognized. Try recording again."})
                return
            self.send_json(200, {"text": text})
        except RuntimeError as error:
            self.send_json(503, {"error": str(error)})
        except Exception as error:
            print(f"Audio transcription failed: {error}")
            self.send_json(502, {"error": "Transcription failed. Check the Groq service and try again."})

    def log_message(self, format_string, *args):
        print(f"{self.address_string()} - {format_string % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), RAGRequestHandler)
    print(f"RAG API running at http://{HOST}:{PORT}")
    print("GET  /health")
    print("POST /ask  {\"question\": \"...\"}")
    print("POST /transcribe  raw audio bytes")
    print("POST /clear")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping RAG API...")
    finally:
        clear_conversation_history()
        server.server_close()


if __name__ == "__main__":
    main()
