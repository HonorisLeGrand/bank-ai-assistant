#!/bin/bash
export PATH="/home/klauskira07/.local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Démarrage de BANCOBU AI Assistant (Voix & IA) ==="

# 0. Libération des ports pour garantir un démarrage propre sur 5173 et 8000
fuser -k 8000/tcp 2>/dev/null
fuser -k 5173/tcp 2>/dev/null
sleep 1

# 1. Démarrage du Backend FastAPI (port 8000)
echo "Démarrage du Backend FastAPI (port 8000)..."
cd "$ROOT_DIR" && ./venv/bin/uvicorn server:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# 2. Démarrage du Frontend React Vite en HTTPS (port 5173)
echo "Démarrage du Frontend React Vite (port 5173 HTTPS)..."
(cd "$ROOT_DIR/frontend" && npm run dev -- --host 0.0.0.0) &
FRONTEND_PID=$!

IP_LAN=$(hostname -I | awk '{print $1}')

echo ""
echo "✅ Système BANCOBU AI prêt !"
echo "🌐 PC Local       : https://localhost:5173"
echo "📱 Mobile (Réseau): https://${IP_LAN}:5173"
echo "⚙️  API Backend    : http://localhost:8000/docs"
echo ""
echo "🎙️ Micro en direct activé : acceptez le certificat SSL pour enregistrer directement sur l'écran."
echo "Appuyez sur Ctrl+C pour arrêter les serveurs."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
