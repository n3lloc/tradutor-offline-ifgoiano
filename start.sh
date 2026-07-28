#!/bin/bash
echo "Iniciando o Sistema de Tradução Offline (Linux)..."

# Verifica se o ambiente virtual existe
if [ ! -f "venv/bin/activate" ]; then
    echo "[!] Ambiente virtual não encontrado. Criando e instalando dependências..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install -r requirements.txt
else
    echo "[OK] Ambiente virtual encontrado."
fi

# Verifica se o Ollama está rodando
if ! curl -s http://localhost:11434/ > /dev/null; then
    echo "[!] ATENÇÃO: O Ollama não parece estar rodando em http://localhost:11434/"
    echo "    Certifique-se de que o Ollama esteja ativo (ex: rodando 'ollama serve')."
else
    echo "[OK] Ollama está em execução."
fi

# Executa a aplicação
echo "[OK] Iniciando a aplicação..."
./venv/bin/python app.py
