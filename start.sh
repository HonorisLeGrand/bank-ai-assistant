#!/bin/bash
export PATH="/home/klauskira07/.local/bin:$PATH"

echo "=== Démarrage de BANCOBU AI Assistant ==="

# 1. Démarrage du Backend FastAPI (port 8000)
echo "Démarrage du Backend FastAPI (port 8000)..."
./venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# 2. Démarrage du Frontend React Vite (port 5173)
echo "Démarrage du Frontend React Vite (port 5173)..."
cd frontend && npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo ""
echo "✅ Système BANCOBU AI prêt !"
echo "🌐 Interface Web : http://localhost:5173"
echo "⚙️  API Backend  : http://localhost:8000/docs"
echo ""
echo "Appuyez sur Ctrl+C pour arrêter les serveurs."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
