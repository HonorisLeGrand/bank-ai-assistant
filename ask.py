
import os
import sys

import ollama
from dotenv import load_dotenv
from google import genai
from qdrant_client import QdrantClient


# ==========================================
# CONFIGURATION
# ==========================================

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "embeddinggemma")

COLLECTION_NAME = "bancobu_documents"
QDRANT_PATH = "./qdrant_data"
TOP_K = 5

if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY absent du fichier .env")


# ==========================================
# INITIALISATION DES CLIENTS
# ==========================================

gemini = genai.Client(api_key=GEMINI_API_KEY)
qdrant = QdrantClient(path=QDRANT_PATH)


# ==========================================
# RECHERCHE DOCUMENTAIRE
# ==========================================

def retrieve(question):
    """Recherche les passages pertinents dans Qdrant."""

    response = ollama.embed(
        model=OLLAMA_MODEL,
        input=question
    )

    query_vector = response["embeddings"][0]

    results = qdrant.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=TOP_K,
        with_payload=True
    )

    return results.points


# ==========================================
# GENERATION DE LA REPONSE
# ==========================================

def generate_answer(question, passages):
    """Génère une réponse naturelle et précise avec Gemini."""

    if not passages:
        return (
            "Je n'ai trouvé aucune information pertinente "
            "dans les documents disponibles pour répondre "
            "à votre question."
        )

    context = ""

    for index, point in enumerate(passages, start=1):

        data = point.payload

        context += f"""
EXTRAIT {index}
Document : {data.get('source', 'Inconnu')}
Page : {data.get('page', 'Inconnue')}

Contenu :
{data.get('text', '')}

"""

    prompt = f"""
Tu es un assistant bancaire intelligent spécialisé
dans les informations documentaires de BANCOBU.

Tu aides les utilisateurs à comprendre les services,
les produits, les conditions et les procédures bancaires.

TON COMPORTEMENT :

Tu dois répondre comme un conseiller bancaire compétent :
naturellement, intelligemment, clairement et directement.

L'utilisateur ne doit pas avoir l'impression de lire
une extraction de document ou un rapport technique.

RÈGLES FONDAMENTALES :

1. RÉPONSE DIRECTE
Commence directement par répondre à la question.
Évite les introductions inutiles.

2. FIDÉLITÉ AUX SOURCES
Utilise exclusivement les informations présentes
dans les extraits fournis.
N'invente aucune information.

3. COMPRÉHENSION DU CONTEXTE
Identifie précisément le produit ou le service concerné.
Ne confonds jamais les conditions d'un compte courant
avec celles d'un compte devise, Diaspora ou épargne.

4. CLARTÉ
Présente les informations de manière organisée.
Utilise des listes lorsque cela facilite la compréhension.
Explique les termes techniques si nécessaire.

5. INFORMATIONS MANQUANTES
Si les documents ne contiennent pas la réponse,
dis-le clairement.
Si une partie seulement de la réponse est disponible,
présente les informations confirmées et précise
ce qui n'est pas documenté.

6. SOURCES
À la fin de la réponse, indique les documents et pages
qui justifient réellement tes affirmations.
Ne cite pas les passages non pertinents.

7. CONCISION
Évite les répétitions et les conclusions inutiles.
Ne présente pas les extraits retrouvés.
Ne parle jamais de chunks, d'embeddings, de vecteurs,
de scores de similarité ou de Qdrant.

QUESTION DE L'UTILISATEUR :
{question}

INFORMATIONS DOCUMENTAIRES DISPONIBLES :
{context}

Rédige maintenant ta réponse.
"""

    response = gemini.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt
    )

    if not response.text:
        return "Je n'ai pas pu générer une réponse à cette question."

    return response.text.strip()


# ==========================================
# INTERFACE UTILISATEUR
# ==========================================

def ask(question):

    if not question.strip():
        print("Veuillez saisir une question.")
        return

    print("\nRecherche en cours...\n")

    passages = retrieve(question)

    answer = generate_answer(question, passages)

    print("=" * 60)
    print("ASSISTANT BANCAIRE BANCOBU")
    print("=" * 60)

    print(answer)

    print("=" * 60)


# ==========================================
# EXECUTION
# ==========================================

if __name__ == "__main__":

    try:

        if len(sys.argv) > 1:
            question = " ".join(sys.argv[1:])
        else:
            question = input("Posez votre question : ")

        ask(question)

    except KeyboardInterrupt:
        print("\nInterruption.")

    except Exception as error:
        print(f"\nUne erreur est survenue : {error}")

    finally:
        qdrant.close()
