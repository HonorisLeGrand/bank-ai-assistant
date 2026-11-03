
import os
import hashlib
import re
from pathlib import Path

from dotenv import load_dotenv
import pymupdf
import ollama

from qdrant_client import QdrantClient, models

load_dotenv()

# CONFIGURATION
PDF_PATH = Path("documents/bancobu_donnees.pdf")
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_data")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "bancobu_documents_ollama")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("EMBEDDING_MODEL", "embeddinggemma")

CHUNK_SIZE = 1800
CHUNK_OVERLAP = 250
BATCH_SIZE = 16


def extract_pages(pdf_path):
    """Extrait le texte de chaque page du PDF."""

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF introuvable : {pdf_path}")

    document = pymupdf.open(pdf_path)
    pages = []

    for page_number, page in enumerate(document, start=1):
        text = page.get_text("text")
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = text.strip()

        if text:
            pages.append({
                "page": page_number,
                "text": text
            })

        else:
            print(f"Attention : page {page_number} sans texte extractible.")

    document.close()
    return pages


def split_text(text):
    """Découpe le texte en chunks en préservant les paragraphes."""

    paragraphs = [
        p.strip()
        for p in text.split("\n")
        if p.strip()
    ]

    chunks = []
    current = ""

    for paragraph in paragraphs:

        if len(paragraph) > CHUNK_SIZE:
            if current:
                chunks.append(current)
                current = ""

            start = 0

            while start < len(paragraph):
                end = start + CHUNK_SIZE
                chunks.append(paragraph[start:end])

                if end >= len(paragraph):
                    break

                start = end - CHUNK_OVERLAP

            continue

        candidate = f"{current}\n{paragraph}" if current else paragraph

        if len(candidate) <= CHUNK_SIZE:
            current = candidate

        else:
            if current:
                chunks.append(current)

            overlap = current[-CHUNK_OVERLAP:] if current else ""
            current = f"{overlap}\n{paragraph}".strip()

    if current:
        chunks.append(current)

    return chunks


def main():

    print("\n=== INDEXATION BANCOBU ===\n")

    # 1. Extraction
    print("[1/4] Extraction du PDF...")

    pages = extract_pages(PDF_PATH)

    if not pages:
        raise RuntimeError("Aucun texte extractible dans le PDF.")

    print(f"{len(pages)} pages contenant du texte.")

    # 2. Découpage
    print("\n[2/4] Découpage en chunks...")

    documents = []

    for page in pages:
        chunks = split_text(page["text"])

        for index, chunk in enumerate(chunks):
            documents.append({
                "text": chunk,
                "page": page["page"],
                "chunk": index,
                "source": PDF_PATH.name
            })

    print(f"{len(documents)} chunks générés.")

    # 3. Connexion à Qdrant
    print("\n[3/4] Préparation de Qdrant...")

    client = QdrantClient(path=QDRANT_PATH)
    client_ollama = ollama.Client(host=OLLAMA_HOST)

    # SÉCURITÉ ABSOLUE : interdiction d'écraser la collection d'origine bancobu_documents
    if COLLECTION_NAME == "bancobu_documents":
        raise PermissionError(
            "RÈGLE DE SÉCURITÉ : La collection d'origine 'bancobu_documents' ne doit jamais être supprimée ou écrasée. "
            "Utilisez une collection distincte comme 'bancobu_documents_ollama'."
        )

    # On recrée uniquement la collection dédiée pour éviter
    # de conserver d'anciens chunks lors d'une réindexation.
    if client.collection_exists(COLLECTION_NAME):
        client.delete_collection(COLLECTION_NAME)

    # 4. Génération des embeddings et stockage
    print("\n[4/4] Génération des embeddings...")

    first_batch = documents[:BATCH_SIZE]
    first_response = client_ollama.embed(
        model=OLLAMA_MODEL,
        input=[doc["text"] for doc in first_batch]
    )

    first_embeddings = first_response["embeddings"]
    vector_size = len(first_embeddings[0])

    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=models.VectorParams(
            size=vector_size,
            distance=models.Distance.COSINE
        )
    )

    for start in range(0, len(documents), BATCH_SIZE):

        batch = documents[start:start + BATCH_SIZE]

        if start == 0:
            embeddings = first_embeddings
        else:
            response = client_ollama.embed(
                model=OLLAMA_MODEL,
                input=[doc["text"] for doc in batch]
            )
            embeddings = response["embeddings"]

        points = []

        for doc, vector in zip(batch, embeddings):

            identity = (
                f"{doc['source']}:{doc['page']}:"
                f"{doc['chunk']}:{doc['text']}"
            )

            point_id = hashlib.md5(
                identity.encode("utf-8")
            ).hexdigest()

            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=doc
                )
            )

        client.upsert(
            collection_name=COLLECTION_NAME,
            points=points
        )

        print(
            f"Indexation : "
            f"{min(start + len(batch), len(documents))}"
            f"/{len(documents)} chunks"
        )

    print("\n=== INDEXATION TERMINÉE ===")
    print(f"Collection : {COLLECTION_NAME}")
    print(f"Chunks enregistrés : {len(documents)}")
    print(f"Dimension des vecteurs : {vector_size}")

    client.close()


if __name__ == "__main__":
    main()
