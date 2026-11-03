import os
import sys

from dotenv import load_dotenv
import ollama
from qdrant_client import QdrantClient

# ==========================================
# CONFIGURATION 100% LOCALE
# ==========================================

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "embeddinggemma")

COLLECTION_NAME = os.getenv("COLLECTION_NAME", "bancobu_documents_ollama")
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_data")
TOP_K = int(os.getenv("TOP_K", "3"))

# ==========================================
# INITIALISATION DES CLIENTS
# ==========================================

client_ollama = ollama.Client(host=OLLAMA_HOST)
client_qdrant = QdrantClient(path=QDRANT_PATH)

# ==========================================
# RECHERCHE DOCUMENTAIRE (EMBEDDINGGEMMA + QDRANT)
# ==========================================

def retrieve(question: str):
    """Recherche les passages pertinents dans Qdrant avec EmbeddingGemma."""
    response = client_ollama.embed(
        model=EMBEDDING_MODEL,
        input=question
    )

    query_vector = response["embeddings"][0]

    results = client_qdrant.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=TOP_K,
        with_payload=True
    )

    return results.points

# ==========================================
# GÉNÉRATION DE LA RÉPONSE (QWEN 2.5 3B)
# ==========================================

def generate_answer(question: str, passages):
    """Génère une réponse claire et sourcée avec Qwen 2.5 3B."""
    if not passages:
        return "Je n'ai trouvé aucune information pertinente dans les documents disponibles pour répondre à votre question."

    context = ""
    for index, point in enumerate(passages, start=1):
        data = point.payload or {}
        context += f"""
EXTRAIT {index}
Document : {data.get('source', 'Inconnu')}
Page : {data.get('page', 'Inconnue')}

Contenu :
{data.get('text', '')}
"""

    prompt = f"""Tu es un conseiller bancaire intelligent spécialisé dans les produits et services de la banque BANCOBU au Burundi.
Tu aides les clients à comprendre les offres, conditions et procédures.

RÈGLES STRICTES :
1. Réponds de manière concise, polie et directe (2 à 3 paragraphes courts ou puces).
2. Utilise fidèlement et EXCLUSIVEMENT les extraits documentaires fournis ci-dessous. N'invente aucune information.
3. Si une information n'est pas précisée dans les extraits, dis-le poliment.
4. À la fin de ta réponse, cite précisément les numéros de page consultés (ex: Source : Page 2).

INFORMATIONS DOCUMENTAIRES BANCOBU :
{context}

QUESTION DU CLIENT :
{question}

RÉPONSE DU CONSEILLER :"""

    response = client_ollama.generate(
        model=LLM_MODEL,
        prompt=prompt,
        options={
            "temperature": 0.2,
            "top_p": 0.9,
        }
    )

    return response.get("response", "").strip()

# ==========================================
# INTERFACE CLI TERMINAL
# ==========================================

def ask(question: str):
    if not question.strip():
        print("Veuillez saisir une question.")
        return

    print("\n[RAG Local] Recherche documentaire avec EmbeddingGemma...")
    passages = retrieve(question)
    print(f"[RAG Local] {len(passages)} extraits pertinents trouvés dans Qdrant.")

    print(f"[RAG Local] Synthèse de la réponse avec {LLM_MODEL}...")
    answer = generate_answer(question, passages)

    print("\n" + "=" * 60)
    print("CONSEILLER BANCAIRE BANCOBU (100% LOCAL)")
    print("=" * 60)
    print(answer)
    print("=" * 60 + "\n")

if __name__ == "__main__":
    try:
        if len(sys.argv) > 1:
            q = " ".join(sys.argv[1:])
        else:
            q = input("Posez votre question à BANCOBU AI : ")
        ask(q)
    except KeyboardInterrupt:
        print("\nInterrompu.")
    except Exception as e:
        print(f"\nErreur : {e}")
    finally:
        client_qdrant.close()
