#!/bin/bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Démarrage de BANCOBU AI Assistant (Architecture Locale Jetson) ==="

# 0. Libération des ports pour garantir un démarrage propre sur 5173 et 8000
fuser -k 8000/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null
sleep 1

# Détection de l'interpréteur Python / Uvicorn
if [ -f "$ROOT_DIR/.venv/bin/uvicorn" ]; then
    UVICORN_BIN="$ROOT_DIR/.venv/bin/uvicorn"
elif [ -f "$ROOT_DIR/venv/bin/uvicorn" ]; then
    UVICORN_BIN="$ROOT_DIR/venv/bin/uvicorn"
else
    UVICORN_BIN="uvicorn"
fi

# 1. Démarrage du Backend FastAPI (port 8000)
echo "Démarrage du Backend FastAPI (port 8000)..."
cd "$ROOT_DIR" && "$UVICORN_BIN" server:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# 2. Démarrage du Frontend React Vite (port 5173)
if [ -d "$ROOT_DIR/frontend" ]; then
    echo "Démarrage du Frontend React Vite (port 5173)..."
    (cd "$ROOT_DIR/frontend" && npm run dev -- --host 0.0.0.0) &
    FRONTEND_PID=$!
fi

IP_LAN=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$IP_LAN" ] && IP_LAN="127.0.0.1"

echo ""
echo "✅ Système BANCOBU AI prêt !"
echo "🌐 Interface Web   : https://localhost:5173"
echo "📱 Accès Réseau    : https://${IP_LAN}:5173"
echo "⚙️  API Backend     : http://${IP_LAN}:8000/docs"
echo ""
echo "Appuyez sur Ctrl+C pour arrêter les serveurs."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
