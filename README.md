# BANCOBU AI Assistant 🏦⚡ (Architecture 100% Locale / Edge AI)

Assistant bancaire conversationnel intelligent et vocal conçu pour la banque **BANCOBU** (Burundi).  
Cette branche **`offline`** intègre une architecture **100 % souveraine, locale et autonome**, optimisée pour tourner sur **NVIDIA Jetson Orin Nano** (ou tout système Linux avec accélération CUDA) **sans aucune connexion Internet** ni API cloud payante.

---

## 🏛️ Architecture Technique Locale

```
                    ┌──────────────────────────────────────────────┐
                    │     Frontend React / Vite (HTTPS + VAD)     │
                    │   - Chat documentaire                       │
                    │   - Appel vocal en direct ("Agents Call")   │
                    └──────────────────────┬───────────────────────┘
                                           │
                                ┌──────────┴──────────┐
                                │   FastAPI Backend   │
                                └──────────┬──────────┘
               ┌───────────────────────────┼───────────────────────────┐
               ▼                           ▼                           ▼
      ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
      │   STT (Micro)   │         │    RAG & LLM    │         │   TTS (Voix)    │
      │   Whisper.cpp   │         │  Qdrant Vector  │         │    Piper TTS    │
      │ (ggml-small.bin)│         │       +         │         │ (siwis-medium)  │
      │  + FFmpeg 16kHz │         │ Ollama (Qwen /  │         │  ONNX Runtime   │
      │   CUDA natif    │         │ EmbeddingGemma) │         │   WAV 22kHz     │
      └─────────────────┘         └─────────────────┘         └─────────────────┘
```

### Composants logiciels :
1. **LLM (Génération de réponses)** : **Qwen 2.5 3B Instruct** via le moteur local **Ollama** (accélération GPU/CUDA).
2. **Embeddings textuels** : **EmbeddingGemma** (768 dimensions) via **Ollama**.
3. **Moteur Vectoriel (RAG)** : **Qdrant Local** (stockage persistant dans `./qdrant_data`, collection `bancobu_documents_ollama`).
4. **Transcription Vocale (Speech-to-Text)** : **Whisper.cpp CLI** avec modèle `ggml-small.bin` (conversion préalable standardisée via FFmpeg en WAV PCM 16-bit mono 16 kHz).
5. **Synthèse Vocale (Text-to-Speech)** : **Piper TTS** avec voix française haute fidélité (`fr_FR-siwis-medium.onnx`).
6. **Interface Utilisateur** : **React (Vite)** avec détection d'activité vocale (VAD), seuil RMS d'énergie sonore et gestion automatique des tours de parole lors de l'appel.

---

## 📋 Prérequis Matériels & Logiciels

- **Matériel cible** : NVIDIA Jetson Orin Nano (ou machine Linux x86_64 avec GPU NVIDIA).
- **Stockage externe / Clé USB** (montée sur `/mnt/usb`) contenant :
  - Whisper.cpp compilé : `/mnt/usb/whisper/whisper.cpp/build/bin/whisper-cli`
  - Modèle Whisper : `/mnt/usb/whisper-models/ggml-small.bin`
  - Environnement Piper : `/mnt/usb/piper/venv/bin/piper`
  - Modèle vocal Piper : `/mnt/usb/piper/models/fr_FR-siwis-medium.onnx`
- **Ollama** installé localement avec les modèles :
  ```bash
  ollama pull embeddinggemma
  ollama pull qwen2.5:3b
  ```
- **FFmpeg** installé sur le système (`sudo apt install ffmpeg`).
- **Python 3.10+** & **Node.js 18+**.

---

## ⚙️ Configuration de l'environnement (`.env`)

Créez ou adaptez votre fichier `.env` :

```env
# Ollama (runtime local)
OLLAMA_HOST=http://127.0.0.1:11434
LLM_MODEL=qwen2.5:3b
EMBEDDING_MODEL=embeddinggemma

# Qdrant (stockage vectoriel local)
QDRANT_PATH=./qdrant_data
COLLECTION_NAME=bancobu_documents_ollama
TOP_K=4
SCORE_THRESHOLD=0.35

# Whisper.cpp (transcription vocale locale CUDA)
WHISPER_CLI_PATH=/mnt/usb/whisper/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL_PATH=/mnt/usb/whisper-models/ggml-small.bin

# Piper TTS (synthèse vocale locale ONNX)
PIPER_BIN_PATH=/mnt/usb/piper/venv/bin/piper
PIPER_MODEL_PATH=/mnt/usb/piper/models/fr_FR-siwis-medium.onnx
PIPER_CONFIG_PATH=/mnt/usb/piper/models/fr_FR-siwis-medium.onnx.json
```

---

## 🚀 Guide d'Utilisation

### 1. Installation des dépendances Python & Node

```bash
# Dépendances Python
pip install -r requirements.txt

# Dépendances Frontend
cd frontend && npm install && cd ..
```

### 2. Ingestion de la base documentaire BANCOBU

Pour indexer le PDF officiel [`documents/bancobu_donnees.pdf`](documents/bancobu_donnees.pdf) dans la base vectorielle locale :

```bash
python ingest.py
```
*Le script découpe le document en chunks, calcule les vecteurs avec `embeddinggemma` et les enregistre dans Qdrant.*

### 3. Validation de la chaîne locale avec la suite de tests

Un script de test automatisé permet de vérifier le bon fonctionnement de chaque composant :

```bash
python test_local_backend.py
```
*Vérifie successivement : connexion Ollama, génération d'embedding 768d, recherche Qdrant, génération LLM Qwen, et endpoints FastAPI.*

### 4. Test rapide en ligne de commande (CLI)

```bash
python ask.py "Quelles sont les conditions pour ouvrir un compte courant ?"
```

### 5. Lancement de l'application complète (Backend + Web UI)

Exécutez le script de démarrage :

```bash
./start.sh
```

Cela démarre automatiquement :
- **Backend FastAPI** : `http://localhost:8000` (Documentation interactive sur `/docs`)
- **Frontend React (HTTPS)** : `https://localhost:5173` *(ou via l'adresse réseau Jetson : `https://192.168.55.1:5173`)*

> [!NOTE]
> Le HTTPS local est requis par les navigateurs modernes pour autoriser l'accès au microphone (`navigator.mediaDevices.getUserMedia`) lors du mode Appel en direct.

---

## 📡 Endpoints de l'API Backend (`server.py`)

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Diagnostic de l'état des services (Ollama, Qdrant, Whisper, Piper) |
| `POST` | `/api/ask` | Recherche RAG documentaire et réponse rédigée avec citations |
| `POST` | `/api/call/answer` | Réponse conversationnelle optimisée pour la voix en direct |
| `POST` | `/api/transcribe` | Transcription audio WebM/WAV vers texte via Whisper.cpp CUDA |
| `POST` | `/api/tts` | Synthèse vocale texte vers WAV via Piper TTS |
| `POST` | `/api/reset` | Réinitialisation de l'historique conversationnel |

---

## 📁 Structure du Répertoire

```
bank-ai-assistant/
├── ask.py                  # CLI terminal 100% local (Ollama + Qdrant)
├── ingest.py               # Indexation PDF locale avec EmbeddingGemma
├── server.py               # API FastAPI locale (RAG, Whisper.cpp, Piper TTS)
├── test_local_backend.py   # Suite de tests automatisée des composants locaux
├── start.sh                # Script de démarrage unifié (Backend + Frontend)
├── requirements.txt        # Dépendances Python allégées (sans SDK cloud)
├── .env                    # Configuration des chemins locaux (Ollama, Whisper, Piper)
├── documents/
│   └── bancobu_donnees.pdf # Base documentaire bancaire officielle BANCOBU
├── qdrant_data/            # Base de données vectorielle locale Qdrant
└── frontend/               # Application React Vite (Voix & Chat)
    └── src/
        ├── App.jsx         # UI complète avec VAD & Appel en direct ("Agents Call")
        ├── Icons.jsx       # Composants d'icônes SVG
        └── index.css       # Design bancaire & glassmorphism
```
