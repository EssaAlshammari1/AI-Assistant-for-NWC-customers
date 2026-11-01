import argparse
import json
from glob import glob
from pathlib import Path

from sentence_transformers import SentenceTransformer
from pymilvus import MilvusClient
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parents[1]
JSON_FOLDER = PROJECT_ROOT / "jsonchunks"
MILVUS_URI = PROJECT_ROOT / "milvus_demo.db"
COLLECTION_NAME = "my_rag_collection"
MODEL_NAME = "Qwen/Qwen3-Embedding-0.6B"


def extract_text(value):
    if isinstance(value, list):
        for item in value:
            yield from extract_text(item)
    elif isinstance(value, dict):
        if isinstance(value.get("text"), str):
            yield value["text"]
        else:
            for key in ("DESC_EN", "DESC_AR"):
                if isinstance(value.get(key), str):
                    yield value[key]
            if "DESC_EN" not in value and "DESC_AR" not in value:
                for item in value.values():
                    yield from extract_text(item)
            else:
                yield from extract_text(value.get("Children"))


def load_documents():
    documents = []
    for file_path in glob(str(JSON_FOLDER / "*.json")):
        with open(file_path, "r", encoding="utf-8") as file:
            documents.extend(extract_text(json.load(file)))
    return [text.strip() for text in documents if text.strip()]


def main(rebuild=False):
    milvus_client = MilvusClient(uri=str(MILVUS_URI))

    if milvus_client.has_collection(COLLECTION_NAME) and not rebuild:
        print(f"Collection already exists: {COLLECTION_NAME}")
        print("Use --rebuild only after changing the source documents.")
        return

    if milvus_client.has_collection(COLLECTION_NAME):
        milvus_client.drop_collection(COLLECTION_NAME)

    documents = load_documents()
    if not documents:
        raise ValueError(f"No text found in {JSON_FOLDER}")

    model = SentenceTransformer(MODEL_NAME, trust_remote_code=True)
    embeddings = model.encode(
        documents,
        normalize_embeddings=True,
        convert_to_numpy=True,
        show_progress_bar=True,
    )
    dimension = embeddings.shape[1]

    milvus_client.create_collection(
        collection_name=COLLECTION_NAME,
        dimension=dimension,
        metric_type="IP",
        consistency_level="Strong",
    )

    data = [
        {"id": index, "vector": vector.tolist(), "text": text}
        for index, (vector, text) in enumerate(zip(embeddings, documents))
    ]
    milvus_client.insert(collection_name=COLLECTION_NAME, data=data)
    milvus_client.load_collection(COLLECTION_NAME)

    output_path = Path(__file__).resolve().parent / "embeddings.json"
    output_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Indexed {len(data)} documents.")
    print(f"Saved embeddings to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Drop and recreate the collection from current JSON files.",
    )
    args = parser.parse_args()
    main(rebuild=args.rebuild)
