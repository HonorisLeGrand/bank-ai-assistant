import os
import sys
import re
import tempfile
import asyncio
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
from qdrant_client import QdrantClient
import edge_tts

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "gemini-embedding-001")
VOICE_NAME = "fr-FR-HenriNeural" # Voix masculine française chaleureuse et professionnelle

# Modèles Gemini officiels avec repli automatique en cas de 503 UNAVAILABLE ou 429
AVAILABLE_MODELS = [
    os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.0-flash-lite",
]

def generate_with_fallback(gemini, contents, config=None):
    """Génère du contenu avec repli automatique si un modèle subit une surcharge 503."""
    last_error = None
    seen_models = set()
    for model_name in AVAILABLE_MODELS:
        if not model_name or model_name in seen_models:
            continue
        seen_models.add(model_name)
        try:
            kwargs = {"model": model_name, "contents": contents}
            if config:
                kwargs["config"] = config
            res = gemini.models.generate_content(**kwargs)
            if res and res.text:
                return res.text.strip()
        except Exception as e:
            err_str = str(e)
            print(f"⚠️ Modèle {model_name} indisponible ({err_str[:60]}), tentative avec modèle de repli...")
            last_error = e
            continue
    raise last_error or Exception("Tous les modèles Gemini sont temporairement indisponibles.")

COLLECTION_NAME = "bancobu_documents"
QDRANT_PATH = "./qdrant_data"
TOP_K = 3

GREETINGS = {"bonjour", "salut", "hello", "bonsoir", "coucou", "yo", "aide", "aidez moi", "bonjour bancobu"}

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
        gemini_client = genai.Client(api_key=GEMINI_API_KEY, http_options={"timeout": 60000})
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

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "fr-FR-DeniseNeural"

class CallHistoryItem(BaseModel):
    role: str # "user" ou "agent"
    text: str

class CallRequest(BaseModel):
    question: str
    history: Optional[List[CallHistoryItem]] = []
    voice: Optional[str] = "fr-FR-DeniseNeural"

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "gemini_model": GEMINI_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "collection": COLLECTION_NAME,
        "tts_voice": VOICE_NAME
    }

@app.post("/api/ask", response_model=AnswerResponse)
def ask_question(payload: QuestionRequest):
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="La question ne peut pas être vide.")

    # 0. Réponse immédiate pour les salutations courantes (< 10ms)
    clean_q = re.sub(r'[^\w\s]', '', question.lower()).strip()
    if clean_q in GREETINGS:
        return AnswerResponse(
            answer="Bonjour et bienvenue à la **BANCOBU** ! Je suis votre conseiller bancaire intelligent.\n\nComment puis-je vous aider aujourd'hui ? Vous pouvez me poser toutes vos questions sur :\n* Nos **Comptes** (Courant, Épargne, Devise, Diaspora, KIRA MAMA...)\n* Nos **Cartes Bancaires** (Visa, eNoti...)\n* Nos offres de **Crédits et Facilités**\n\nPosez votre question à l'écrit ou directement à la voix !",
            sources=[]
        )

    try:
        gemini = get_gemini()
        # 1. Embedding direct via Google Gemini
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

        # 3. Synthèse concise et rapide par Gemini
        prompt = f"""
Tu es un conseiller bancaire de haut niveau pour BANCOBU.
Réponds à la question de manière claire, concise et professionnelle (2 à 3 paragraphes courts ou puces).
Utilise fidèlement les extraits officiels ci-dessous. N'invente rien. Mentionne la page consultée à la fin.

QUESTION DE L'UTILISATEUR :
{question}

INFORMATIONS DOCUMENTAIRES BANCOBU :
{context}

RÉPONSE DU CONSEILLER :
"""

        answer_text = generate_with_fallback(gemini, prompt)

        return AnswerResponse(
            answer=answer_text,
            sources=sources_list
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/tts")
async def generate_speech(payload: TTSRequest):
    """Génère un flux audio MP3 naturel en français à partir du texte."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texte manquant pour la synthèse vocale.")

    # Nettoyage du markdown pour une diction fluide et naturelle
    clean_text = re.sub(r'[*#_`>~]', '', text)
    clean_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean_text)
    clean_text = re.sub(r'http\S+', '', clean_text)
    clean_text = re.sub(r'\n+', '. ', clean_text).strip()

    # Si le texte est très long, on synthétise les premiers paragraphes clés
    if len(clean_text) > 800:
        clean_text = clean_text[:800] + "..."

    try:
        temp_audio = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
        temp_audio.close()

        selected_voice = payload.voice if payload.voice else VOICE_NAME
        communicate = edge_tts.Communicate(clean_text, selected_voice)
        await communicate.save(temp_audio.name)

        return FileResponse(
            temp_audio.name, 
            media_type="audio/mpeg", 
            filename="response.mp3"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur TTS: {str(e)}")

@app.post("/api/call/answer")
def call_answer(payload: CallRequest):
    """Réponse orale optimisée pour un appel téléphonique en direct avec le conseiller BANCOBU."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="La question ne peut pas être vide.")

    # Vérification d'un historique d'appel existant
    has_history = bool(payload.history and len(payload.history) > 0)
    clean_q = re.sub(r'[^\w\s]', '', question.lower()).strip()

    # Si c'est une simple salutation isolée au TOUT DÉBUT de l'appel (sans aucun échange préalable)
    if not has_history and clean_q in GREETINGS:
        return {
            "answer": "Bonjour et bienvenue au service client de la BANCOBU ! Je suis votre conseiller bancaire virtuel. Comment puis-je vous renseigner aujourd'hui ?",
            "question": question
        }

    try:
        gemini = get_gemini()
        # 1. Embedding
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
        context = ""
        for index, point in enumerate(passages, start=1):
            data = point.payload or {}
            chunk_text = str(data.get("text", ""))
            context += f"EXTRAIT {index} :\n{chunk_text}\n\n"

        if not passages:
            return {
                "answer": "Je n'ai pas cette information précise dans ma documentation actuelle. Je vous invite à vous rapprocher d'une agence BANCOBU.",
                "question": question
            }

        # Formater l'historique récent de la conversation téléphonique (derniers 4 échanges)
        history_context = ""
        if payload.history:
            history_context = "HISTORIQUE RÉCENT DE CET APPEL :\n"
            for item in payload.history[-4:]:
                locuteur = "Client" if item.role == "user" else "Conseiller (Toi)"
                history_context += f"- {locuteur} : {item.text}\n"

        prompt = f"""Tu es un conseiller clientèle téléphonique officiel de la banque BANCOBU au Burundi.
Un client est en communication téléphonique en direct avec toi.

CONSIGNES STRICTES DE FLUIDITÉ ORALE :
1. L'appel est EN COURS et vous avez déjà salué le client. NE redis JAMAIS "Bonjour", "Bienvenue" ou toute formule d'accueil répétitive en cours d'appel. Va droit au but.
2. Réponds de manière ultra fluide, directe et concise (1 à 2 phrases courtes maximum, environ 20 à 35 mots). Le client est au téléphone et attend une réponse rapide et naturelle.
3. Prends impérativement en compte l'historique de la conversation ci-dessous pour assurer la continuité du dialogue (ex: si le client dit "Et combien ça coûte ?", réfère-toi au produit dont vous parliez juste avant).
4. AUCUN formatage écrit : JAMAIS d'astérisques (*), JAMAIS de listes à puces, JAMAIS de titres (#). Parle comme au téléphone.
5. Base-toi fidèlement sur les extraits documentaires BANCOBU ci-dessous. N'invente rien.

{history_context}
EXTRAITS DOCUMENTAIRES BANCOBU DISPONIBLES :
{context}

DERNIÈRE QUESTION DU CLIENT :
"{question}"

DONNE TA RÉPONSE ORALE DIRECTE, COURTE ET NATURELLE :"""

        # Limitation de tokens pour une génération ultra rapide (< 400ms)
        gen_config = types.GenerateContentConfig(
            max_output_tokens=120,
            temperature=0.3
        )

        answer_text = generate_with_fallback(gemini, prompt, config=gen_config)
        clean_answer = re.sub(r'[*#_`]', '', answer_text).strip()

        return {
            "answer": clean_answer,
            "question": question
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcrit fidèlement un fichier audio (micro voix) via Gemini Flash."""
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Fichier audio vide.")

        content_type = file.content_type or "audio/webm"
        mime = "audio/webm"
        if "mp4" in content_type or "m4a" in content_type:
            mime = "audio/mp4"
        elif "wav" in content_type:
            mime = "audio/wav"
        elif "ogg" in content_type:
            mime = "audio/ogg"
        elif "mp3" in content_type or "mpeg" in content_type:
            mime = "audio/mp3"

        gemini = get_gemini()
        audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=mime)
        text = generate_with_fallback(gemini, [
            audio_part,
            "Tu es un transcripteur professionnel. Transcris fidèlement la parole en français contenue dans cet enregistrement audio. Ne retourne STRICTEMENT QUE les mots dits, sans guillemets, sans politesse et sans commentaire. Si aucun mot n'est prononcé, ne réponds rien."
        ])
        return {"transcript": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur transcription: {str(e)}")
