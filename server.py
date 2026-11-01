import os
import sys
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from qdrant_client import QdrantClient

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")

COLLECTION_NAME = "bancobu_documents"
QDRANT_PATH = "./qdrant_data"
TOP_K = 5

app = FastAPI(title="BANCOBU AI Assistant API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

gemini_client = None
qdrant_client = None

def get_gemini():
    global gemini_client
    if gemini_client is None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY absente du fichier .env")
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    return gemini_client

def get_qdrant():
    global qdrant_client
    if qdrant_client is None:
        qdrant_client = QdrantClient(path=QDRANT_PATH)
    return qdrant_client

class QuestionRequest(BaseModel):
    question: str

class SourceItem(BaseModel):
    source: str
    page: int
    text: str

class AnswerResponse(BaseModel):
    answer: str
    sources: List[SourceItem]

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "gemini_model": GEMINI_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "collection": COLLECTION_NAME
    }

@app.post("/api/ask", response_model=AnswerResponse)
def ask_question(payload: QuestionRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="La question ne peut pas être vide.")

    try:
        gemini = get_gemini()
        # 1. Embedding direct via Google Gemini (768 dimensions pour correspondre à Qdrant)
        embed_resp = gemini.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=question,
            config={"output_dimensionality": 768}
        )
        query_vector = embed_resp.embeddings[0].values

        # 2. Recherche vectorielle dans Qdrant
        client_qdrant = get_qdrant()
        results = client_qdrant.query_points(
            collection_name=COLLECTION_NAME,
            query=query_vector,
            limit=TOP_K,
            with_payload=True
        )

        passages = results.points
        sources_list = []
        context = ""

        for index, point in enumerate(passages, start=1):
            data = point.payload or {}
            source_file = str(data.get("source", "bancobu_donnees.pdf"))
            page_num = int(data.get("page", 1))
            chunk_text = str(data.get("text", ""))

            sources_list.append(SourceItem(
                source=source_file,
                page=page_num,
                text=chunk_text
            ))

            context += f"""
EXTRAIT {index}
Document : {source_file}
Page : {page_num}

Contenu :
{chunk_text}

"""

        if not passages:
            return AnswerResponse(
                answer="Je n'ai trouvé aucune information pertinente dans les documents disponibles pour répondre à votre question.",
                sources=[]
            )

        # 3. Synthèse de la réponse par Gemini
        prompt = f"""
Tu es un assistant bancaire intelligent et bienveillant spécialisé dans les informations documentaires de BANCOBU.

Tu aides les clients et prospects à comprendre les services, les produits, les conditions et les procédures bancaires.

TON COMPORTEMENT :
Tu dois répondre comme un conseiller bancaire de haut niveau : chaleureusement, intelligemment, clairement et de manière structurée.

RÈGLES FONDAMENTALES :
1. Réponds directement avec style et clarté (utilise du markdown soigné avec des listes à puces, du gras, etc.).
2. Utilise fidèlement les informations des extraits fournis. N'invente rien.
3. Sois précis sur les types de comptes (Courant, Épargne, Devise, Diaspora, etc.).
4. Si une information n'est pas documentée, précise-le avec courtoisie.
5. À la fin de ta réponse, rappelle brièvement les références de pages du document officiel consultées.

QUESTION DE L'UTILISATEUR :
{question}

INFORMATIONS DOCUMENTAIRES DISPONIBLES :
{context}

Rédige maintenant ta réponse :
"""

        gen_response = gemini.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )

        answer_text = gen_response.text.strip() if gen_response.text else "Désolé, aucune réponse n'a pu être formulée."

        return AnswerResponse(
            answer=answer_text,
            sources=sources_list
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
