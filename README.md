# NWC RAG Website

A bilingual Arabic/English retrieval-augmented assistant website. It retrieves answers from the JSON documents in `jsonchunks/`, uses a local Milvus Lite database, and calls Groq for text answers and optional speech transcription.

## Features

- Arabic and English question answering with source snippets.
- Browser-based voice input with transcription review before submitting.
- Local web interface and API served together on port `8000`.
- The generated vector index stays local; the API key is read from `.env`.

## Requirements

- Python 3.10 or later.
- A Groq API key for answering and voice transcription.
- Internet access on first run to download the embedding model and call Groq.

## Setup (Windows PowerShell)

From the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` and replace the placeholder with your own Groq API key:

```text
GROQ_API_KEY=replace-with-your-groq-api-key
# Optional; defaults to whisper-large-v3
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3
```

Build the local vector index from the included source documents, then start the server:

```powershell
.\.venv\Scripts\python.exe .\rag-website\create_embeddings.py
.\.venv\Scripts\python.exe .\rag-website\api.py
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in a browser. The first index build downloads the embedding model and may take some time. The generated Milvus database and embedding output are local files and are intentionally excluded from Git.

## API

- `GET /health` checks server status.
- `POST /ask` accepts JSON such as `{"question":"..."}`.
- `POST /transcribe?language=ar` accepts an audio recording. Use `language=en` for English.
- `POST /clear` clears in-memory conversation history.

By default, the API listens only on `127.0.0.1`. Do not expose it directly to the public internet: it has no authentication or rate limiting. Add appropriate access controls before deploying it for public use.

## Privacy and data

The source JSON documents under `jsonchunks/` are included in this repository. Questions and audio recordings are sent to Groq for processing. Audio is not saved by this application. Do not put personal, confidential, or otherwise restricted information in the documents or requests.

## Repository contents

- `rag-website/` — Python API, retrieval logic, and web application.
- `jsonchunks/` — source documents used to build the search index.
- `assets/` — website logo.

Generated files, virtual environments, local databases, conversation history, and API secrets should not be committed. See `.gitignore`.
