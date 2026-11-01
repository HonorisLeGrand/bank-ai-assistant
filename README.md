# BANCOBU AI Assistant 🏦✨

Assistant bancaire conversationnel intelligent basé sur une architecture **RAG (Retrieval-Augmented Generation)** pour la banque **BANCOBU** (Burundi).

Ce projet offre :
- Une **API FastAPI** haute performance connectée à Qdrant, Ollama (`embeddinggemma`) et Google Gemini (`gemini-2.5-flash`).
- Une **Interface Utilisateur Moderne (React + Vite)** avec un design sombre soigné, deux modes intégrés :
  1. **Vitrine d'innovation** : Page de présentation expliquant la technologie, l'architecture RAG et la valeur ajoutée pour la BANCOBU.
  2. **Assistant Interactif (Chat UI)** : Interface de messagerie temps réel avec bulles de dialogue, questions suggérées en 1 clic et citation précise des pages des documents sources.

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- Python 3.10+
- Node.js (inclus dans le path ou localement)
- Ollama avec le modèle `embeddinggemma`
- Fichier `.env` contenant votre clé Gemini :
  ```env
  GEMINI_API_KEY=votre_cle_gemini
  GEMINI_MODEL=gemini-2.5-flash
  OLLAMA_MODEL=embeddinggemma
  ```

### 2. Lancement en un clic
Exécutez simplement le script unifié :
```bash
./start.sh
```

Cela démarrera automatiquement :
- Le **Backend API** sur [http://localhost:8000](http://localhost:8000) (documentation OpenAPI sur `/docs`)
- Le **Frontend React Vite** sur [http://localhost:5173](http://localhost:5173)

---

## 🛠️ Structure du Projet

```
bank-ai-assistant/
├── ask.py             # Script terminal interactif (CLI)
├── ingest.py          # Script d'ingestion et d'indexation du PDF dans Qdrant
├── server.py          # API Backend FastAPI (endpoints /api/ask et /api/health)
├── start.sh           # Script de lancement unifié (API + React)
├── documents/
│   └── bancobu_donnees.pdf  # Base documentaire officielle BANCOBU
├── qdrant_data/       # Base de données vectorielle locale
└── frontend/          # Application React (Vite)
    └── src/
        ├── App.jsx    # Interface interactive + Page d'innovation
        ├── Icons.jsx  # Icônes SVG haute fidélité
        └── index.css  # Styles & glassmorphism
```
