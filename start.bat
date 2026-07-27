@echo off
echo Iniciando o Sistema de Traducao Offline...

REM Verifica se a pasta venv existe
IF NOT EXIST "venv\Scripts\activate.bat" (
    echo [!] Ambiente virtual nao encontrado. Criando e instalando dependencias...
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install -r requirements.txt
) ELSE (
    echo [OK] Ambiente virtual encontrado. Ativando...
    call venv\Scripts\activate.bat
)

echo [OK] Iniciando a aplicacao...
python app.py
pause
