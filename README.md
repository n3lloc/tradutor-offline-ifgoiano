# Plataforma Aberta para Leitura e Tradução de Artigos Científicos

Este repositório contém o código-fonte do Sistema de Tradução Offline e Confidencial de Artigos Científicos, desenvolvido como parte fundamental do **Trabalho de Conclusão de Curso (Ciência da Computação)** no Instituto Federal Goiano - Campus Rio Verde.

---

## 📖 Visão Geral e Contexto Acadêmico
O objetivo central deste sistema é permitir que estudantes, pesquisadores e acadêmicos leiam e traduzam documentos científicos complexos (PDFs com duas colunas, equações, tabelas e jargões técnicos) rompendo a barreira linguística. 

O grande diferencial deste projeto, no contexto de pesquisa, é o foco em **Privacidade e Custo Zero**. Todo o processamento de Extração Ótica (OCR) e Tradução é feito por Modelos de Visão e Linguagem (VLM) executados **100% localmente** na máquina do usuário. Dessa forma, nenhum artigo inédito (pré-print ou sob revisão por pares) precisa ser enviado para APIs em nuvem (como OpenAI ou Google), garantindo total sigilo de dados sensíveis da pesquisa.

### Arquitetura
- **Backend:** Python + Flask.
- **Frontend:** HTML5, CSS e Vanilla JS.
- **Processamento Local de IA:** Motor Ollama (`localhost:11434`).
- **Manipulação de PDF:** PyMuPDF (`fitz`) combinada com HTML5 Canvas para renderização.
- **Banco de Dados:** SQLite embarcado (`library.db`).

---

## ✨ Funcionalidades

1. **Leitura Assistida**: Renderização de PDFs científicos lado-a-lado (Single ou Dual Page). O usuário desenha uma área de seleção sobre um parágrafo complexo, o sistema tira um snapshot silencioso e aciona a IA local para fazer o OCR e a Tradução In-Place, preservando até mesmo equações matemáticas (LaTeX).
2. **Gerenciador de Modelos Integrado**: Os usuários não precisam mais usar linha de comando. Através da interface do sistema, é possível gerenciar (baixar, atualizar, apagar) Modelos de Inteligência Artificial. O sistema calcula proativamente o uso estimado de VRAM da GPU para avisar se o hardware suportará a carga.
3. **Tradução de Texto Livre**: Um chat limpo para conversas textuais diretas com as IAs instaladas.

---

## 🧠 Modelos Disponíveis (Homologados)
O sistema reconhece e lista nativamente excelentes modelos locais com foco acadêmico. **Você pode instalá-los com um único clique direto pela aba de Gerenciador de Modelos do sistema.**

**Modelos Multimodais (Extração Visual e OCR - VLM):**
*   `qwen2.5vl:3b` (Modelo de 3 bilhões de parâmetros, tamanho/consumo de 3.2GB)
*   `qwen2.5vl:7b` (Modelo de 7 bilhões de parâmetros, tamanho/consumo de 6.0GB)
*   `qwen3-vl:8b-instruct` (Modelo de 8 bilhões de parâmetros, tamanho/consumo de 6.1GB)
*   `qwen2.5vl:32b` (Modelo de 32 bilhões de parâmetros, tamanho/consumo de 21GB)

**Modelos de Linguagem Puros (Tradução Estrita - LLM):**
*   `translategemma:4b` (Modelo de 4 bilhões de parâmetros, tamanho/consumo de 3.3GB)
*   `translategemma:12b` (Modelo de 12 bilhões de parâmetros, tamanho/consumo de 8.1GB)
*   `translategemma:27b` (Modelo de 27 bilhões de parâmetros, tamanho/consumo de 17GB)

---

## 🚀 Guia Direto de Instalação

### 1. Instalação do Motor de IA Local
Todo o peso cognitivo ocorre via **Ollama**.
1. Acesse o site oficial: [https://ollama.com/download](https://ollama.com/download)
2. Instale de forma padrão (Windows/Linux/macOS).
3. **Importante:** O Ollama normalmente inicializa sozinho com o sistema operacional. Para garantir que ele está pronto, verifique se o ícone da Lhama está na sua bandeja do sistema (perto do relógio) ou abra o navegador em `http://localhost:11434/` (deve exibir a mensagem *"Ollama is running"*).

### 2. Configurando as Bibliotecas Python (Backend)
Clone ou baixe este repositório. Abra o Terminal/PowerShell dentro da pasta `Software` e crie um ambiente virtual para isolar o sistema.

**No Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

**No Linux (bash):**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Rodando o Sistema
Com o ambiente ativado e as bibliotecas instaladas, dispare o sistema:
```bash
python app.py
```
O terminal exibirá: `* Running on http://127.0.0.1:5000/`.

### 4. Primeiros Passos no Navegador
1. Abra seu navegador web e acesse: `http://127.0.0.1:5000/`.
2. Acesse a aba **Gerenciador de Modelos**. O sistema listará os modelos homologados. Escolha pelo menos um modelo de extração visual e um de tradução para iniciar e clique em *Instalar*.
3. Pronto! Você já pode usar o sistema.
