# ==============================================================================
# Étape 1 : Construction du Frontend React (Vite)
# ==============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ ./
RUN npm run build

# ==============================================================================
# Étape 2 : Image de Production (Python FastAPI + Nginx)
# ==============================================================================
FROM python:3.12-slim

WORKDIR /app

# Installation de Nginx et des outils de diagnostic réseau et système
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    curl \
    wget \
    iputils-ping \
    telnet \
    netcat-openbsd \
    dnsutils \
    iproute2 \
    net-tools \
    procps \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Installation des dépendances Python requises pour la version Online
COPY requirements.txt ./
RUN pip install --no-cache-dir \
    fastapi \
    uvicorn \
    python-dotenv \
    google-genai \
    qdrant-client \
    edge-tts \
    python-multipart \
    pypdf \
    tiktoken

# Copie des fichiers d'application
COPY server.py ./
COPY ask.py ./
COPY documents/ ./documents/
COPY qdrant_data/ ./qdrant_data/

# Déploiement du build Frontend dans Nginx
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html

# Configuration Nginx (Reverse Proxy Frontend + API Backend)
RUN rm -f /etc/nginx/sites-enabled/default
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
\n\
    # Fichiers statiques du Frontend React\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    # Relais API vers le Backend FastAPI (Uvicorn sur 127.0.0.1:8000)\n\
    location /api/ {\n\
        proxy_pass http://127.0.0.1:8000;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n\
        proxy_set_header X-Forwarded-Proto $scheme;\n\
        proxy_read_timeout 120s;\n\
        proxy_connect_timeout 120s;\n\
        client_max_body_size 50M;\n\
    }\n\
\n\
    # Documentation Swagger FastAPI\n\
    location /docs {\n\
        proxy_pass http://127.0.0.1:8000/docs;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
    }\n\
\n\
    location /openapi.json {\n\
        proxy_pass http://127.0.0.1:8000/openapi.json;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

# Script de démarrage unifié
RUN printf '#!/bin/sh\n\
echo "=== Démarrage de BANCOBU AI Assistant (Container Docker) ==="\n\
echo "1. Démarrage de Nginx sur le port 80..."\n\
nginx\n\
echo "2. Démarrage du Backend FastAPI Uvicorn sur le port interne 8000..."\n\
exec uvicorn server:app --host 127.0.0.1 --port 8000\n' > /entrypoint.sh && chmod +x /entrypoint.sh

# Port web exposé (Frontend + Backend unifiés sur le même port)
EXPOSE 80

# Healthcheck Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/api/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
