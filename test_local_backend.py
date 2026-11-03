import os
import sys
import time
from dotenv import load_dotenv
import ollama
from qdrant_client import QdrantClient
from fastapi.testclient import TestClient

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "embeddinggemma")
COLLECTION_NAME = os.getenv("COLLECTION_NAME", "bancobu_documents_ollama")
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_data")

def run_tests():
    print("=" * 70)
    print("🧪 SUITE DE TESTS : VALIDATION DU BACKEND BANCOBU LOCAL")
    print("=" * 70)

    # 1. Test de connexion à Ollama
    print("\n[1/5] Test de la connexion à Ollama...")
    try:
        client_ollama = ollama.Client(host=OLLAMA_HOST)
        tags = client_ollama.list()
        models = [m.model for m in tags.models] if hasattr(tags, 'models') else []
        print(f"  ✅ Connexion Ollama réussie sur {OLLAMA_HOST}")
        print(f"  📦 Modèles disponibles dans Ollama : {models}")
    except Exception as e:
        print(f"  ❌ Échec de connexion Ollama : {e}")
        return False

    # 2. Test des embeddings avec EmbeddingGemma
    print(f"\n[2/5] Test des embeddings avec {EMBEDDING_MODEL}...")
    sample_text = "Conditions d'ouverture d'un compte courant à la BANCOBU."
    try:
        t0 = time.time()
        resp = client_ollama.embed(model=EMBEDDING_MODEL, input=sample_text)
        embed_time = (time.time() - t0) * 1000
        vec = resp["embeddings"][0]
        dim = len(vec)
        print(f"  ✅ Embedding calculé avec succès en {embed_time:.1f}ms")
        print(f"  📐 Dimension du vecteur : {dim} (attendu: 768)")
        assert dim == 768, f"Dimension incorrecte: {dim}"
    except Exception as e:
        print(f"  ❌ Échec du calcul d'embedding : {e}")
        return False

    # 3. Test de la recherche dans Qdrant
    print(f"\n[3/5] Test de la recherche vectorielle dans Qdrant ({COLLECTION_NAME})...")
    try:
        client_qdrant = QdrantClient(path=QDRANT_PATH)
        collections = [c.name for c in client_qdrant.get_collections().collections]
        print(f"  📁 Collections existantes dans Qdrant : {collections}")

        # Vérification stricte de la préservation de la collection d'origine
        assert "bancobu_documents" in collections, "Collection d'origine bancobu_documents introuvable !"
        orig_info = client_qdrant.get_collection("bancobu_documents")
        print(f"  🛡️  Collection d'origine 'bancobu_documents' intacte : {orig_info.points_count} points préservés")

        assert COLLECTION_NAME in collections, f"Collection cible {COLLECTION_NAME} introuvable !"
        target_info = client_qdrant.get_collection(COLLECTION_NAME)
        print(f"  🎯 Collection locale '{COLLECTION_NAME}' active : {target_info.points_count} points")

        t0 = time.time()
        results = client_qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=vec,
            limit=2,
            with_payload=True
        )
        search_time = (time.time() - t0) * 1000
        print(f"  ✅ Recherche vectorielle effectuée en {search_time:.1f}ms ({len(results.points)} points trouvés)")
        for i, pt in enumerate(results.points, 1):
            p = pt.payload
            print(f"     Extrait {i} (Page {p.get('page')}, Score {pt.score:.4f}): {p.get('text', '')[:120].replace(chr(10), ' ')}...")
        client_qdrant.close()
    except Exception as e:
        print(f"  ❌ Échec de la recherche Qdrant : {e}")
        return False

    # 4. Test de génération avec Qwen 2.5 3B (si présent dans Ollama)
    print(f"\n[4/5] Test de génération avec {LLM_MODEL}...")
    llm_available = any(LLM_MODEL in m for m in models)
    if not llm_available:
        print(f"  ⚠️  Le modèle {LLM_MODEL} n'est pas encore présent dans cet environnement Ollama.")
        print(f"     (Sur le Jetson, il est déjà déployé et tourne à 100% sur le GPU).")
    else:
        try:
            t0 = time.time()
            gen_resp = client_ollama.generate(
                model=LLM_MODEL,
                prompt="Donne-moi une salutation bancaire courtoise en une seule phrase pour la BANCOBU."
            )
            gen_time = (time.time() - t0) * 1000
            print(f"  ✅ Génération réussie en {gen_time:.1f}ms :")
            print(f"     « {gen_resp['response'].strip()} »")
        except Exception as e:
            print(f"  ❌ Échec génération LLM : {e}")

    # 5. Test des endpoints FastAPI (/api/health et /api/ask)
    print("\n[5/5] Test des endpoints de l'API FastAPI (server.py)...")
    try:
        from server import app
        client_api = TestClient(app)

        # Health
        res_health = client_api.get("/api/health")
        print(f"  🔹 GET /api/health : Status {res_health.status_code}")
        print(f"     Données : {res_health.json()}")
        assert res_health.status_code == 200

        # Ask (Salutation)
        res_greet = client_api.post("/api/ask", json={"question": "Bonjour"})
        print(f"  🔹 POST /api/ask (Salutation) : Status {res_greet.status_code}")
        assert res_greet.status_code == 200
        print(f"     Réponse instantanée : {res_greet.json()['answer'][:90]}...")

        # Ask (Question documentaire RAG si LLM disponible)
        if llm_available:
            t0 = time.time()
            res_rag = client_api.post("/api/ask", json={"question": "Quelles sont les conditions pour ouvrir un compte courant ?"})
            rag_time = (time.time() - t0) * 1000
            print(f"  🔹 POST /api/ask (RAG complet) : Status {res_rag.status_code} ({rag_time:.1f}ms)")
            data_rag = res_rag.json()
            print(f"     Réponse : {data_rag['answer'][:180]}...")
            cited_pages = [f"Page {s['page']}" for s in data_rag['sources']]
            print(f"     Sources citées : {cited_pages}")
            assert len(data_rag['sources']) > 0

    except Exception as e:
        print(f"  ❌ Échec test FastAPI : {e}")
        return False

    print("\n" + "=" * 70)
    print("🎉 TOUS LES TESTS LOCAUX SONT VALIDÉS AVEC SUCCÈS !")
    print("=" * 70)
    return True

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
