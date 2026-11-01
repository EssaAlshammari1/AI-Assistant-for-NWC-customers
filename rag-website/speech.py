import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = PROJECT_ROOT / ".env"
DEFAULT_TRANSCRIPTION_MODEL = "whisper-large-v3"


def create_transcriber():
	load_dotenv(ENV_FILE, override=True)
	api_key = (os.getenv("GROQ_API_KEY") or "").strip()
	if not api_key or api_key.lower() in {"your-groq-api-key", "changeme", "replace-me"}:
		raise RuntimeError("Set a valid GROQ_API_KEY in the project .env file.")
	return Groq(api_key=api_key)


def transcribe_audio(client, audio_bytes, filename, content_type, language="ar"):
	transcription = client.audio.transcriptions.create(
		model=os.getenv("GROQ_TRANSCRIPTION_MODEL", DEFAULT_TRANSCRIPTION_MODEL),
		file=(filename, audio_bytes, content_type),
		language=language,
		response_format="json",
		temperature=0.0,
	)
	return (transcription.text or "").strip()
