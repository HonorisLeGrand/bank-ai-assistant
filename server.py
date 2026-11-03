import os
import sys
import re
import tempfile
import asyncio
from pathlib import Path
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import ollama
from qdrant_client import QdrantClient

# ==============================================================================
# CONFIGURATION 100% LOCALE (NVIDIA JETSON ORIN NANO)
# ==============================================================================

load_dotenv()

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "embeddinggemma")

COLLECTION_NAME = os.getenv("COLLECTION_NAME", "bancobu_documents_ollama")
QDRANT_PATH = os.getenv("QDRANT_PATH", "./qdrant_data")
TOP_K = int(os.getenv("TOP_K", "4"))
SCORE_THRESHOLD = float(os.getenv("SCORE_THRESHOLD", "0.35"))

WHISPER_CLI_PATH = os.getenv("WHISPER_CLI_PATH", "/mnt/usb/whisper/whisper.cpp/build/bin/whisper-cli")
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "/mnt/usb/whisper-models/ggml-small.bin")

PIPER_BIN_PATH = os.getenv("PIPER_BIN_PATH", "/mnt/usb/piper/venv/bin/piper")
PIPER_MODEL_PATH = os.getenv("PIPER_MODEL_PATH", "/mnt/usb/piper/models/fr_FR-siwis-medium.onnx")
PIPER_CONFIG_PATH = os.getenv("PIPER_CONFIG_PATH", "/mnt/usb/piper/models/fr_FR-siwis-medium.onnx.json")

GREETINGS = {"bonjour", "salut", "hello", "bonsoir", "coucou", "yo", "aide", "aidez moi", "bonjour bancobu"}

STRICT_FALLBACK_TEXT = "Cette information n'est pas précisée dans nos documents bancaires officiels. Je vous invite à contacter votre agence BANCOBU."

# ==============================================================================
# APPLICATION FASTAPI
# ==============================================================================

app = FastAPI(
    title="BANCOBU AI Assistant API (100% Local Jetson Orin Nano)",
    version="2.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Clients locaux (initialisation paresseuse)
ollama_client = None
qdrant_client = None

def get_ollama() -> ollama.Client:
    global ollama_client
    if ollama_client is None:
        ollama_client = ollama.Client(host=OLLAMA_HOST)
    return ollama_client

def get_qdrant() -> QdrantClient:
    global qdrant_client
    if qdrant_client is None:
        qdrant_client = QdrantClient(path=QDRANT_PATH)
    return qdrant_client

# ==============================================================================
# SCHÉMAS PYDANTIC (RÉTROCOMPATIBLES AVEC SUPPORT D'HISTORIQUE OPTIONNEL)
# ==============================================================================

class MessageTurn(BaseModel):
    role: str
    content: str

class QuestionRequest(BaseModel):
    question: str
    history: Optional[List[Dict[str, Any]]] = None

class SourceItem(BaseModel):
    source: str
    page: int
    text: str
    score: Optional[float] = None

class AnswerResponse(BaseModel):
    answer: str
    sources: List[SourceItem]

class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "siwis"

class CallRequest(BaseModel):
    question: str
    voice: Optional[str] = "siwis"
    history: Optional[List[Dict[str, Any]]] = None

# ==============================================================================
# FONCTIONS UTILITAIRES RAG (EMBEDDINGS & GÉNÉRATION OLLAMA)
# ==============================================================================

def get_embedding(text: str) -> List[float]:
    """Calcule l'embedding local via Ollama (modèle EmbeddingGemma)."""
    client = get_ollama()
    response = client.embed(
        model=EMBEDDING_MODEL,
        input=text
    )
    return response["embeddings"][0]

def normalize_banking_query(query: str) -> str:
    """Harmonise le langage familier vers la terminologie bancaire officielle BANCOBU."""
    q = query
    # "créer un compte" / "faire un compte" -> "ouvrir un compte"
    q = re.sub(r'\b(cr[ée]{1,2}r|faire|avoir)\s+un\s+compte\b', 'ouvrir un compte', q, flags=re.IGNORECASE)
    q = re.sub(r'\bcr[ée]{1,2}ation\s+d[e\']\s*un?\s*compte\b', 'ouverture de compte', q, flags=re.IGNORECASE)
    # "prendre une carte" / "commander une carte" -> "obtenir une carte bancaire"
    q = re.sub(r'\b(prendre|commander|avoir)\s+une\s+carte\b', 'obtenir une carte bancaire', q, flags=re.IGNORECASE)
    return q

def search_documents(query_vector: List[float], limit: int = TOP_K):
    """Recherche les passages pertinents dans Qdrant en éliminant les micro-fragments non informatifs."""
    client = get_qdrant()
    results = client.query_points(
        collection_name=COLLECTION_NAME,
        query=query_vector,
        limit=limit + 3,
        with_payload=True
    )
    # Filtrer les fragments vides ou résiduels (< 20 caractères comme 'End')
    valid_points = [
        p for p in results.points 
        if len(str((p.payload or {}).get("text", "")).strip()) >= 20
    ]
    return valid_points[:limit]

def generate_answer_ollama(prompt: str) -> str:
    """Génère la réponse avec Qwen 2.5 3B local via Ollama."""
    client = get_ollama()
    response = client.generate(
        model=LLM_MODEL,
        prompt=prompt,
        options={
            "temperature": 0.1,
            "top_p": 0.85,
        }
    )
    return response.get("response", "").strip()

# ==============================================================================
# ENDPOINTS API
# ==============================================================================

@app.get("/api/health")
def health():
    """Diagnostic complet de l'état des composants locaux."""
    ollama_ok = False
    available_models = []
    try:
        client = get_ollama()
        tags = client.list()
        available_models = [m.model for m in tags.models] if hasattr(tags, 'models') else []
        ollama_ok = True
    except Exception as e:
        available_models = [f"Erreur connexion Ollama: {str(e)}"]

    qdrant_ok = False
    points_count = 0
    try:
        q = get_qdrant()
        info = q.get_collection(COLLECTION_NAME)
        points_count = info.points_count
        qdrant_ok = True
    except Exception:
        pass

    whisper_present = Path(WHISPER_CLI_PATH).exists() and Path(WHISPER_MODEL_PATH).exists()
    piper_present = Path(PIPER_BIN_PATH).exists() and Path(PIPER_MODEL_PATH).exists()

    return {
        "status": "ok" if (ollama_ok and qdrant_ok) else "degraded",
        "architecture": "100% Local (NVIDIA Jetson Orin Nano)",
        "ollama_host": OLLAMA_HOST,
        "ollama_connected": ollama_ok,
        "llm_model": LLM_MODEL,
        "embedding_model": EMBEDDING_MODEL,
        "collection": COLLECTION_NAME,
        "collection_points": points_count,
        "models_in_ollama": available_models,
        "score_threshold": SCORE_THRESHOLD,
        "whisper_cli_ready": whisper_present,
        "piper_tts_ready": piper_present
    }

@app.post("/api/ask", response_model=AnswerResponse)
def ask_question(payload: QuestionRequest):
    """Point d'entrée RAG complet avec vérification stricte de pertinence et anti-hallucination."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="La question ne peut pas être vide.")

    # 0. Réponse instantanée pour les salutations courantes (< 5ms)
    clean_q = re.sub(r'[^\w\s]', '', question.lower()).strip()
    if clean_q in GREETINGS:
        return AnswerResponse(
            answer="Bonjour et bienvenue à la **BANCOBU** ! Je suis votre conseiller bancaire intelligent.\n\nComment puis-je vous aider aujourd'hui ? Vous pouvez me poser toutes vos questions sur :\n* Nos **Comptes** (Courant, Épargne, Devise, Diaspora, KIRA MAMA...)\n* Nos **Cartes Bancaires** (Visa, eNoti...)\n* Nos offres de **Crédits et Facilités**\n\nPosez votre question à l'écrit ou directement à la voix !",
            sources=[]
        )

    try:
        # 1. Normalisation et calcul de l'embedding de la question via EmbeddingGemma
        search_query = normalize_banking_query(question)
        query_vector = get_embedding(search_query)

        # 2. Recherche vectorielle dans Qdrant
        passages = search_documents(query_vector, limit=TOP_K)

        # 3. CONTRÔLE DE PERTINENCE DOCUMENTAIRE :
        # Si aucun passage n'est trouvé ou si le score du meilleur passage est inférieur au seuil
        if not passages or passages[0].score < SCORE_THRESHOLD:
            return AnswerResponse(
                answer=STRICT_FALLBACK_TEXT,
                sources=[]
            )

        # Filtrer pour ne conserver que les extraits au-dessus du seuil
        relevant_passages = [p for p in passages if p.score >= SCORE_THRESHOLD]
        if not relevant_passages:
            return AnswerResponse(
                answer=STRICT_FALLBACK_TEXT,
                sources=[]
            )

        sources_list = []
        context = ""

        for index, point in enumerate(relevant_passages, start=1):
            data = point.payload or {}
            source_file = str(data.get("source", "bancobu_donnees.pdf"))
            page_num = int(data.get("page", 1))
            chunk_text = str(data.get("text", ""))

            sources_list.append(SourceItem(
                source=source_file,
                page=page_num,
                text=chunk_text,
                score=round(float(point.score), 4)
            ))

            context += f"""
EXTRAIT {index} (Document: {source_file}, Page: {page_num}) :
{chunk_text}
"""

        # 4. Prompt système strict avec consignes anti-hallucination formelles
        prompt = f"""Tu es un assistant bancaire officiel de la BANCOBU.
Tu dois répondre exclusivement à partir des extraits des documents bancaires officiels fournis dans le contexte ci-dessous.
N'utilise aucune connaissance extérieure pour compléter une réponse.
Si les extraits ne contiennent pas explicitement l'information demandée, réponds exactement :
« {STRICT_FALLBACK_TEXT} »
N'invente aucun tarif, aucune condition, aucun délai, aucun document requis et aucune caractéristique de produit bancaire.
À la fin de ta réponse, mentionne obligatoirement la référence sous la forme : "Source : Page X".

INFORMATIONS DOCUMENTAIRES OFFICIELLES BANCOBU :
{context}

QUESTION DU CLIENT :
{question}

RÉPONSE DU CONSEILLER BANCAIRE :"""

        answer_text = generate_answer_ollama(prompt)

        return AnswerResponse(
            answer=answer_text,
            sources=sources_list
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur interne RAG : {str(e)}")

@app.post("/api/call/answer")
def call_answer(payload: CallRequest):
    """Réponse orale synthétique, naturelle et vérifiée pour le mode appel direct."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="La question ne peut pas être vide.")

    # Salutation orale immédiate
    clean_q = re.sub(r'[^\w\s]', '', question.lower()).strip()
    if clean_q in GREETINGS:
        return {
            "answer": "Bonjour et bienvenue au service client de la BANCOBU ! Je suis votre conseiller bancaire virtuel. Comment puis-je vous renseigner aujourd'hui ?",
            "question": question
        }

    try:
        search_query = normalize_banking_query(question)
        query_vector = get_embedding(search_query)
        passages = search_documents(query_vector, limit=TOP_K)

        # Contrôle de pertinence documentaire
        if not passages or passages[0].score < SCORE_THRESHOLD:
            return {
                "answer": "Cette information n'est pas précisée dans nos documents bancaires officiels actuels. Je vous invite à contacter votre agence BANCOBU la plus proche.",
                "question": question
            }

        relevant_passages = [p for p in passages if p.score >= SCORE_THRESHOLD]
        if not relevant_passages:
            return {
                "answer": "Cette information n'est pas précisée dans nos documents bancaires officiels actuels. Je vous invite à contacter votre agence BANCOBU la plus proche.",
                "question": question
            }

        context = ""
        for index, point in enumerate(relevant_passages, start=1):
            data = point.payload or {}
            chunk_text = str(data.get("text", ""))
            context += f"EXTRAIT {index} :\n{chunk_text}\n\n"

        prompt = f"""Tu es un conseiller clientèle téléphonique professionnel de la banque BANCOBU au Burundi.
Un client est en ligne au téléphone avec toi et te pose une question.

CONSIGNES STRICTES POUR L'APPEL TÉLÉPHONIQUE :
1. Réponds exclusivement à partir des extraits des documents officiels fournis ci-dessous. N'utilise aucune connaissance extérieure.
2. Si les extraits ne contiennent pas l'information demandée, dis aimablement au client que cette information n'est pas précisée dans nos documents officiels et invite-le à contacter son agence. N'invente rien.
3. Adopte un ton oral naturel, fluide, chaleureux et courtois.
4. Fais des phrases claires et agréables à écouter. Évite impérativement tout formatage écrit : PAS de listes à puces avec astérisques (*), PAS de titres (#), PAS de tableaux.
5. Reste concis (2 à 4 phrases maximum) : le client au téléphone attend une réponse directe.

INFORMATIONS DOCUMENTAIRES BANCOBU DISPONIBLES :
{context}

QUESTION DU CLIENT AU TÉLÉPHONE :
{question}

RÉPONSE ORALE DU CONSEILLER :"""

        answer_text = generate_answer_ollama(prompt)
        clean_answer = re.sub(r'[*#_`]', '', answer_text).strip()

        return {
            "answer": clean_answer,
            "question": question
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur appel vocal: {str(e)}")

# ==============================================================================
# ENDPOINTS AUDIO LOCAUX (PIPER TTS & WHISPER.CPP)
# ==============================================================================

@app.post("/api/tts")
async def generate_speech(payload: TTSRequest):
    """Synthèse vocale locale via Piper TTS (produit un flux audio WAV)."""
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texte manquant pour la synthèse vocale.")

    # Nettoyage du markdown pour une diction fluide
    clean_text = re.sub(r'[*#_`>~]', '', text)
    clean_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean_text)
    clean_text = re.sub(r'http\S+', '', clean_text)
    clean_text = re.sub(r'\n+', '. ', clean_text).strip()

    if len(clean_text) > 800:
        clean_text = clean_text[:800] + "..."

    # Vérification de la présence de Piper TTS local
    if not Path(PIPER_BIN_PATH).exists() or not Path(PIPER_MODEL_PATH).exists():
        raise HTTPException(
            status_code=503,
            detail=f"Piper TTS n'est pas encore accessible sur ce système ({PIPER_BIN_PATH}). Disponible sur le Jetson."
        )

    temp_wav = None
    try:
        temp_wav = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        temp_wav.close()

        cmd = [
            PIPER_BIN_PATH,
            "--model", PIPER_MODEL_PATH,
            "--output_file", temp_wav.name
        ]
        if Path(PIPER_CONFIG_PATH).exists():
            cmd.extend(["--config", PIPER_CONFIG_PATH])

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(
            process.communicate(input=clean_text.encode("utf-8")),
            timeout=25.0
        )

        if process.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"Erreur Piper CLI (code {process.returncode}): {err_msg}")

        return FileResponse(
            temp_wav.name,
            media_type="audio/wav",
            filename="response.wav"
        )

    except asyncio.TimeoutError:
        if temp_wav and os.path.exists(temp_wav.name):
            try: os.unlink(temp_wav.name)
            except OSError: pass
        raise HTTPException(status_code=504, detail="Délai dépassé lors de la synthèse vocale Piper (timeout 25s).")
    except Exception as e:
        if temp_wav and os.path.exists(temp_wav.name):
            try: os.unlink(temp_wav.name)
            except OSError: pass
        raise HTTPException(status_code=500, detail=f"Erreur synthèse Piper: {str(e)}")

@app.post("/api/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """Transcription vocale locale via Whisper.cpp (accélération CUDA)."""
    temp_in_path = None
    temp_wav_path = None
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Fichier audio vide.")

        if not Path(WHISPER_CLI_PATH).exists() or not Path(WHISPER_MODEL_PATH).exists():
            raise HTTPException(
                status_code=503,
                detail=f"Whisper.cpp n'est pas encore accessible sur ce système ({WHISPER_CLI_PATH}). Disponible sur le Jetson."
            )

        # 1. Sauvegarde sécurisée du fichier audio brut entrant
        suffix = Path(file.filename or "audio.webm").suffix or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_in:
            temp_in.write(audio_bytes)
            temp_in_path = temp_in.name

        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_wav:
            temp_wav_path = temp_wav.name

        # 2. Conversion FFmpeg standardisée : WAV PCM 16-bit mono 16 kHz
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", temp_in_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            temp_wav_path
        ]

        conv_proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        conv_out, conv_err = await asyncio.wait_for(conv_proc.communicate(), timeout=15.0)

        if conv_proc.returncode != 0:
            err_details = conv_err.decode(errors="ignore").strip()
            raise RuntimeError(f"Erreur de conversion audio FFmpeg (code {conv_proc.returncode}): {err_details}")

        # 3. Exécution Whisper.cpp CLI avec séparation stricte des sorties et flag -np
        whisper_cmd = [
            WHISPER_CLI_PATH,
            "-m", WHISPER_MODEL_PATH,
            "-f", temp_wav_path,
            "-l", "fr",
            "-nt",  # Pas de timestamps
            "-np"   # Pas de prints techniques/statistiques
        ]

        wh_proc = await asyncio.create_subprocess_exec(
            *whisper_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        wh_out, wh_err = await asyncio.wait_for(wh_proc.communicate(), timeout=25.0)

        if wh_proc.returncode != 0:
            err_wh = wh_err.decode(errors="ignore").strip()
            raise RuntimeError(f"Erreur Whisper-cli (code {wh_proc.returncode}): {err_wh}")

        # 4. Nettoyage strict de la transcription
        raw_output = wh_out.decode("utf-8", errors="ignore")
        lines = [
            line.strip() for line in raw_output.split("\n")
            if line.strip() and not line.strip().startswith("read_audio_data:") and not line.strip().startswith("whisper_")
        ]
        clean_transcript = " ".join(lines).strip()

        return {"transcript": clean_transcript}

    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Délai d'attente dépassé lors du traitement audio (timeout).")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur transcription Whisper: {str(e)}")
    finally:
        # Nettoyage systématique garanti de tous les fichiers temporaires
        if temp_in_path and os.path.exists(temp_in_path):
            try: os.unlink(temp_in_path)
            except OSError: pass
        if temp_wav_path and os.path.exists(temp_wav_path):
            try: os.unlink(temp_wav_path)
            except OSError: pass
