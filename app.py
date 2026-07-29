from flask import Flask, render_template, request, jsonify, send_from_directory, Response
import os
import platform
import psutil
import subprocess
import json
import fitz  # PyMuPDF
import base64
import requests
import time
import threading
import queue
import re
import sqlite3
import uuid
import datetime

app = Flask(__name__)

# Configuração de pastas
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# SQLite setup
DB_PATH = os.path.join(os.path.dirname(__file__), 'library.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            filepath TEXT NOT NULL,
            current_page INTEGER DEFAULT 1,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT,
            page_index INTEGER,
            original_text TEXT,
            translated_text TEXT,
            FOREIGN KEY(doc_id) REFERENCES documents(id)
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS vocabulary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT,
            context_sentence TEXT,
            translation TEXT,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT NOT NULL,
            page_index INTEGER NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            content TEXT,
            color TEXT DEFAULT '#fbbf24',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(doc_id) REFERENCES documents(id)
        )
    ''')
    conn.commit()
    conn.close()

init_db()


def clean_math_spaces(t):
    def repl(m):
        return f"${m.group(0)[1:-1].strip()}$"
    return re.sub(r'\$[^$\n]+?\$', repl, t)


def auto_wrap_math(t):
    blocks = []
    def protect_m(m):
        blocks.append(m.group(0))
        return f'@@M{len(blocks)-1}@@'
    
    # Protect existing math blocks so we don't wrap them twice
    t = re.sub(r'\$\$[\s\S]+?\$\$', protect_m, t)
    t = re.sub(r'\\\[[\s\S]+?\\\]', protect_m, t)
    t = re.sub(r'\$[^$\n]+?\$', protect_m, t)
    t = re.sub(r'\\\([\s\S]+?\\\)', protect_m, t)
    
    # 1. Auto-wrap Subscripts/Superscripts (BUT only if base is a letter for subscripts, to avoid technical jargon like Q4_0)
    t = re.sub(r'(?<![\$\\a-zA-Z_])\b([a-zA-Z])_\{([^}]+)\}', r'$\1_{\2}$', t)
    t = re.sub(r'(?<![\$\\])\b([a-zA-Z])_([a-zA-Z0-9]+)\b', lambda m: f"${m.group(1)}_{{{m.group(2)}}}$" if len(m.group(2)) > 1 else f"${m.group(1)}_{m.group(2)}$", t)
    t = re.sub(r'(?<![\$\\])\b([a-zA-Z0-9])\^\{([^}]+)\}', r'$\1^{\2}$', t)
    t = re.sub(r'(?<![\$\\])\b([a-zA-Z0-9])\^([a-zA-Z0-9]+)\b', lambda m: f"${m.group(1)}^{{{m.group(2)}}}$" if len(m.group(2)) > 1 else f"${m.group(1)}^{m.group(2)}$", t)
    
    # 2. Auto-wrap intervals like [q_min, q_max]
    t = re.sub(r'\[([a-zA-Z]+[_^][a-zA-Z0-9{}_^,\s]+)\]', lambda m: f'$[{m.group(1)}]$' if '_' in m.group(1) or '^' in m.group(1) else m.group(0), t)
    
    # 3. Auto-wrap simple equations/inequalities: " s > 0 ", " K = 32 ", " v \in R^K "
    t = re.sub(r'\b([a-zA-Z])\s*([=><]|\\in)\s*([a-zA-Z0-9_^{}\\]+)\b', r'$\1 \2 \3$', t)
    
    # Restore
    for i, b in enumerate(blocks):
        t = t.replace(f'@@M{i}@@', b)
        
    # Clean spaces inside inline math delimiters (both old and new)
    t = clean_math_spaces(t)
    return t


def promote_math_lines(text_input):
    lines = text_input.split('\n')
    for i, line in enumerate(lines):
        stripped = line.strip()
        dollar_count = stripped.count('$')
        if dollar_count == 2 and not stripped.startswith('$$'):
            # Allow prefix: optional bullets, numbers, spaces
            # Allow math block: $...$
            # Allow suffix: optional punctuation, spaces, tag
            match = re.match(r'^(?:[-*•\s]|\d+\.)*(\$[^$]+\$)(?:[\s,.;]|\(\s*\d+\s*\)|\\tag\{\s*\d+\s*\})*$', stripped)
            if match:
                inner_math = match.group(1)[1:-1].strip()
                tag_match = re.search(r'\(\s*(\d+)\s*\)|\\tag\{\s*(\d+)\s*\}', stripped)
                tag_str = ""
                if tag_match and "\\tag" not in inner_math:
                    tag_num = tag_match.group(1) or tag_match.group(2)
                    tag_str = f" \\tag{{{tag_num}}}"
                
                # Remove manual tags or parenthesized numbers from inner_math if we are adding a tag
                if tag_str:
                    inner_math = re.sub(r'\\tag\{\s*\d+\s*\}', '', inner_math).strip()
                    inner_math = re.sub(r'\(\s*\d+\s*\)$', '', inner_math).strip()
                
                # Clean trailing commas/punctuation from display math
                inner_math = inner_math.rstrip(',.;')
                
                lines[i] = f"$${inner_math}{tag_str}$$"
    return '\n'.join(lines)
# ==============================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/favicon.ico')
def favicon():
    return send_from_directory(os.path.join(app.root_path, 'static'),
                               'favicon.ico', mimetype='image/vnd.microsoft.icon')

def pdf_page_to_base64_image(pdf_path, page_num):
    doc = fitz.open(pdf_path)
    page = doc[page_num]
    # Zoom 2.0 melhora o DPI e auxilia na detecção correta dos textos pelo OCR.
    zoom_x = 2.0
    zoom_y = 2.0
    mat = fitz.Matrix(zoom_x, zoom_y)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    base64_img = base64.b64encode(img_bytes).decode('utf-8')
    doc.close()
    return base64_img

@app.route('/extract_stream')
def extract_stream():
    filename = request.args.get('filename')
    model_ocr = request.args.get('model', 'qwen2.5vl')
    model_translate = request.args.get('t_model', 'translategemma')
    context_ocr = int(request.args.get('context_ocr', 4096))
    context_translate = int(request.args.get('context_translate', 4096))
    parallel_mode = request.args.get('parallel', 'false').lower() == 'true'
    
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    def generate():
        try:
            doc = fitz.open(filepath)
            total_pages = len(doc)
            doc.close()
            
            # Prompt em Inglês para evitar que o modelo traduza o texto por conta própria
            # Regra ajustada: Proibido usar '#' para títulos, mas permitido usar negrito (**texto**) para manter a hierarquia visual.
            if "glm-ocr" in model_ocr:
                prompt_ocr_base = "Text Recognition:"
            else:
                prompt_ocr_base = "You are a specialized academic parser. Transcribe the image of this scientific paper page. Strict rules: 1) Preserve tables exactly using Markdown syntax (| Col |). 2) Preserve ALL mathematical equations, variables, and symbols (even single letters) using LaTeX format wrapped in $...$ or $$...$$. DO NOT put spaces immediately inside the $ delimiters. 3) DO NOT use any Markdown headers (#). Instead, use bold text (**text**) for section titles and any text that appears bold in the image. 4) Output ONLY the exact transcribed text in English, without any translation, summaries, or extra comments."
            prompt_translate_prefix = (
                "You are a professional English (en) to Portuguese (pt-BR) translator. Your goal is to accurately convey the meaning and nuances of the original English text while adhering to Portuguese grammar, vocabulary, and cultural sensitivities.\n"
                "CRITICAL INSTRUCTION: Keep all original Markdown formatting (tables, headers, lists) strictly intact. DO NOT translate any LaTeX mathematical formulas or code blocks.\n"
                "Do NOT add arbitrary line breaks or paragraphs in the middle of sentences. Only create new paragraphs where the original text has them.\n"
                "Produce only the Portuguese translation, without any additional explanations or commentary. Please translate the following English text into Portuguese:\n\n\n"
            )

            global_start_time = time.time()
            total_ocr_time = 0.0
            total_trans_time = 0.0

            # Criação do diretório Resultados para o Modo de Aprendizado
            base_filename = os.path.splitext(filename)[0]
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_model_ocr = model_ocr.replace(':', '-')
            safe_model_trans = model_translate.replace(':', '-')
            folder_name = f"{base_filename}_{timestamp}_OCR-{safe_model_ocr}_TRANS-{safe_model_trans}"
            results_dir = os.path.join(os.path.dirname(app.config['UPLOAD_FOLDER']), 'Resultados', folder_name)
            os.makedirs(results_dir, exist_ok=True)
            
            # Subpastas
            img_dir = os.path.join(results_dir, "imagens")
            ocr_dir = os.path.join(results_dir, "texto_extraido")
            trans_dir = os.path.join(results_dir, "texto_traduzido")
            os.makedirs(img_dir, exist_ok=True)
            os.makedirs(ocr_dir, exist_ok=True)
            os.makedirs(trans_dir, exist_ok=True)
            
            page_ocr_texts = {}
            page_trans_texts = {}
            page_ocr_times = {}
            page_trans_times = {}
            page_trans_tps = {}

            # Filas e Controle de Threads
            sse_queue = queue.Queue()
            translation_queue = queue.Queue()
            cancel_flag = threading.Event()
            
            def ocr_worker():
                # Armazena resultados para tradução em lote (modo sequencial)
                ocr_results = []
                
                for page_num in range(total_pages):
                    if cancel_flag.is_set():
                        break
                    
                    sse_queue.put({'status': 'processing_ocr', 'page': page_num+1, 'total': total_pages})
                    start_time = time.time()
                    base64_img = pdf_page_to_base64_image(filepath, page_num)
                    
                    # Salva a imagem PNG para o modo de aprendizado
                    img_path = os.path.join(img_dir, f'page_{page_num+1}.png')
                    with open(img_path, 'wb') as f:
                        f.write(base64.b64decode(base64_img))
                    
                    payload = {
                        "model": model_ocr,
                        "messages": [
                            {"role": "user", "content": prompt_ocr_base, "images": [base64_img]}
                        ],
                        "stream": False,
                        "options": {
                            "num_predict": 4096,  # Evita o truncamento de tabelas longas (pág 13)
                            "num_ctx": context_ocr
                        }
                    }
                    
                    try:
                        response = requests.post("http://localhost:11434/api/chat", json=payload)
                        response.raise_for_status()
                        markdown_text = response.json().get('message', {}).get('content', '')
                        
                        # Salva o Markdown bruto antes dos filtros Regex para referência
                        raw_md_path = os.path.join(ocr_dir, f'page_{page_num+1}_RAW_NATIVE.md')
                        with open(raw_md_path, 'w', encoding='utf-8') as f:
                            f.write(markdown_text)
                        
                        markdown_text = markdown_text.replace("```markdown", "").replace("```", "").strip()
                        
                        # Remove resíduos de OCR (linhas com 1 a 3 caracteres isolados)
                        lines = markdown_text.split('\n')
                        cleaned_lines = []
                        for line in lines:
                            stripped = line.strip()
                            # Se a linha inteira tem só 1 a 3 letras, é lixo visual
                            if len(stripped) > 0 and len(stripped) <= 3 and stripped.isalpha():
                                continue
                            cleaned_lines.append(line)
                        markdown_text = '\n'.join(cleaned_lines)
                        
                        # Normalização de equações LaTeX: converte \( \) para $ $ e \[ \] para $$ $$
                        # Isso garante compatibilidade com qualquer visualizador Markdown padrão
                        markdown_text = markdown_text.replace(r'\(', '$').replace(r'\)', '$')
                        markdown_text = markdown_text.replace(r'\[', '$$').replace(r'\]', '$$')
                        
                        # Limpeza simples de artefatos visuais (apenas legendas)
                        markdown_text = re.sub(r'^(#+)\s*(Fig\.|Figure|Table)', r'\2', markdown_text, flags=re.MULTILINE|re.IGNORECASE)
                        
                    except Exception as e:
                        markdown_text = f"**[Erro no OCR da Página {page_num+1} - Modelo {model_ocr}: {str(e)}]**\n\n"
                    
                    time_taken = round(time.time() - start_time, 1)
                    nonlocal total_ocr_time
                    total_ocr_time += time_taken
                    page_ocr_times[page_num] = time_taken
                    page_ocr_texts[page_num] = markdown_text
                    
                    # Salva o Markdown OCR original para aprendizado
                    md_ocr_path = os.path.join(ocr_dir, f'page_{page_num+1}_ocr.md')
                    with open(md_ocr_path, 'w', encoding='utf-8') as f:
                        f.write(markdown_text)
                    
                    # Envia o Markdown original pro Front
                    sse_queue.put({'status': 'ocr_done', 'page': page_num+1, 'total': total_pages, 'markdown': markdown_text, 'time': time_taken})
                    
                    if parallel_mode:
                        # Modo paralelo: envia pra fila de tradução imediatamente
                        translation_queue.put((page_num, markdown_text))
                    else:
                        # Modo sequencial: armazena para traduzir em lote depois
                        ocr_results.append((page_num, markdown_text))
                
                if parallel_mode and not cancel_flag.is_set():
                    translation_queue.put(None)  # Sentinel signal
                
                # === FASE 2 (Modo Sequencial): Traduz TUDO de uma vez ===
                if not parallel_mode and not cancel_flag.is_set():
                    for page_num, markdown_text in ocr_results:
                        if cancel_flag.is_set():
                            break
                        do_translation(page_num, markdown_text)
            
            def do_translation(page_num, markdown_text):
                if cancel_flag.is_set(): return
                
                sse_queue.put({'status': 'processing_translation', 'page': page_num+1})
                start_time = time.time()
                
                payload = {
                    "model": model_translate,
                    "messages": [
                        {"role": "user", "content": prompt_translate_prefix + markdown_text}
                    ],
                    "stream": False,
                    "options": {
                        "num_ctx": context_translate
                    }
                }
                
                tps = 0.0
                try:
                    response = requests.post("http://localhost:11434/api/chat", json=payload)
                    response.raise_for_status()
                    res_json = response.json()
                    translated_text = res_json.get('message', {}).get('content', '')
                    
                    eval_count = res_json.get('eval_count', 0)
                    eval_duration = res_json.get('eval_duration', 0)
                    
                    if eval_duration > 0:
                        tps = round(eval_count / (eval_duration / 1e9), 2)
                        
                    translated_text = translated_text.replace("```markdown", "").replace("```", "").strip()
                    
                    translated_text = promote_math_lines(translated_text)
                    
                    # Ensure display math ($$) has blank lines around it so marked.js treats it as a block
                    translated_text = re.sub(r'\$\$([\s\S]+?)\$\$', r'\n\n$$\1$$\n\n', translated_text)
                    translated_text = re.sub(r'\n{3,}', '\n\n', translated_text)
                    
                    # Fix spaces inside inline math delimiters which break KaTeX rendering
                    translated_text = clean_math_spaces(translated_text)
                except Exception as e:
                    translated_text = f"**[Erro na Tradução da Página {page_num+1} - Modelo {model_translate}: {str(e)}]**\n\n"
                
                time_taken = round(time.time() - start_time, 1)
                nonlocal total_trans_time
                total_trans_time += time_taken
                page_trans_times[page_num] = time_taken
                page_trans_texts[page_num] = translated_text
                page_trans_tps[page_num] = tps
                
                # Salva o Markdown Traduzido para aprendizado
                md_trans_path = os.path.join(trans_dir, f'page_{page_num+1}_translated.md')
                with open(md_trans_path, 'w', encoding='utf-8') as f:
                    f.write(translated_text)
                
                sse_queue.put({'status': 'translation_done', 'page': page_num+1, 'markdown': translated_text, 'time': time_taken})

            def translation_worker():
                while not cancel_flag.is_set():
                    task = translation_queue.get()
                    if task is None or cancel_flag.is_set():
                        break
                    page_num, markdown_text = task
                    do_translation(page_num, markdown_text)

            # Inicia as threads
            ocr_thread = threading.Thread(target=ocr_worker)
            ocr_thread.start()
            
            if parallel_mode:
                trans_thread = threading.Thread(target=translation_worker)
                trans_thread.start()

            # Gerenciador do Stream (Main Thread)
            pages_fully_processed = 0
            while pages_fully_processed < total_pages:
                msg = sse_queue.get()
                yield f"data: {json.dumps(msg)}\n\n"
                
                if msg['status'] == 'translation_done':
                    pages_fully_processed += 1
            
            # Limpeza final
            ocr_thread.join()
            if parallel_mode:
                trans_thread.join()
                
            # Geracao dos arquivos unificados e relatorio
            try:
                with open(os.path.join(results_dir, "completo_original.md"), "w", encoding="utf-8") as f:
                    for i in range(total_pages):
                        f.write(page_ocr_texts.get(i, f"Pagina {i+1} nao processada.\n"))
                        f.write("\n\n---\n\n")

                with open(os.path.join(results_dir, "completo_traduzido.md"), "w", encoding="utf-8") as f:
                    for i in range(total_pages):
                        f.write(page_trans_texts.get(i, f"Pagina {i+1} nao traduzida.\n"))
                        f.write("\n\n---\n\n")
                        
                with open(os.path.join(results_dir, "relatorio_execucao.md"), "w", encoding="utf-8") as f:
                    f.write("# Relatorio de Execucao\n\n")
                    f.write(f"- Arquivo: {filename}\n")
                    f.write(f"- Timestamp: {timestamp}\n")
                    f.write(f"- Modelo OCR: {model_ocr}\n")
                    f.write(f"- Modelo Traducao: {model_translate}\n")
                    f.write(f"- Modo Paralelo: {parallel_mode}\n")
                    f.write(f"- Zoom (DPI): 2.0 (calculado como 144 DPI)\n")
                    f.write(f"- Contexto (num_ctx): 4096 (Padrao base do Ollama p/ este modelo)\n\n")
                    f.write("## Métricas por Página\n\n")
                    f.write("| Página | OCR (Tempo) | OCR (Palavras/Chars) | Tradução (Tempo) | Tradução (Palavras/Chars) | T/s (Tokens/s) | Total Tempo |\n")
                    f.write("|---|---|---|---|---|---|---|\n")
                    
                    total_ocr_words = 0
                    total_ocr_chars = 0
                    total_trans_words = 0
                    total_trans_chars = 0
                    
                    for i in range(total_pages):
                        o_time = page_ocr_times.get(i, 0.0)
                        t_time = page_trans_times.get(i, 0.0)
                        tot_time = round(o_time + t_time, 1)
                        
                        o_text = page_ocr_texts.get(i, "")
                        t_text = page_trans_texts.get(i, "")
                        
                        o_words, o_chars = len(o_text.split()), len(o_text)
                        t_words, t_chars = len(t_text.split()), len(t_text)
                        
                        total_ocr_words += o_words
                        total_ocr_chars += o_chars
                        total_trans_words += t_words
                        total_trans_chars += t_chars
                        
                        tps_val = page_trans_tps.get(i, 0.0)
                        
                        f.write(f"| {i+1} | {o_time}s | {o_words} / {o_chars} | {t_time}s | {t_words} / {t_chars} | {tps_val} | {tot_time}s |\n")
                    
                    global_wall_time = round(time.time() - global_start_time, 1)
                    f.write("\n## Totais\n\n")
                    f.write(f"- Tempo Total OCR: {round(total_ocr_time, 1)}s\n")
                    f.write(f"- Tempo Total Tradução: {round(total_trans_time, 1)}s\n")
                    f.write(f"- Tempo Total Real (Wall Time): {global_wall_time}s\n\n")
                    f.write(f"- Total Palavras OCR: {total_ocr_words} | Caracteres OCR: {total_ocr_chars}\n")
                    f.write(f"- Total Palavras Tradução: {total_trans_words} | Caracteres Tradução: {total_trans_chars}\n")
            except Exception as e:
                print(f"Erro ao salvar relatorios: {e}")
            
            global_wall_time = round(time.time() - global_start_time, 1)
            total_ocr_time = round(total_ocr_time, 1)
            total_trans_time = round(total_trans_time, 1)
            
            yield f"data: {json.dumps({'status': 'complete', 'wall_time': global_wall_time, 'ocr_time': total_ocr_time, 'trans_time': total_trans_time})}\n\n"

        except GeneratorExit:
            # Capturado quando o usuário dá F5, fecha a aba ou o EventSource é encerrado prematuramente
            cancel_flag.set()
            print("Cliente desconectou. Cancelando processamento em background...")
            # Envia um dummy para as filas destravarem (se estiverem bloqueadas)
            translation_queue.put(None)
            
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
            
    return Response(generate(), mimetype='text/event-stream')

@app.route('/uploads/<filename>')
def serve_pdf(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'Nenhum arquivo enviado.'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nenhum arquivo selecionado.'}), 400
    
    if file and file.filename.endswith('.pdf'):
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
        file.save(filepath)
        
        try:
            return jsonify({
                'message': 'Arquivo processado com sucesso!',
                'filename': file.filename,
                'status': 'processed'
            })
        except Exception as e:
            return jsonify({'error': f"Falha ao ler PDF: {str(e)}"}), 500
    
    return jsonify({'error': 'Formato inválido. Apenas PDF é aceito.'}), 400

@app.route('/translate_text', methods=['POST'])
def translate_text():
    data = request.get_json()
    if not data or not data.get('text'):
        return jsonify({'error': 'Texto não fornecido'}), 400
        
    text = data.get('text')
    source_lang = data.get('source', 'Auto')
    target_lang = data.get('target', 'Portuguese (Brazil)')
    model = data.get('model', 'translategemma:4b')
    context_translate = int(data.get('context_translate', 4096))
    
    # === LIMPEZA DE TEXTO DE PDF (MODO 1) ===
    # Remove carriage returns para lidar com colagem no Windows
    text = text.replace('\r', '')
    # Junta palavras hifenizadas que foram separadas pela quebra de linha: "infor-\nmação" -> "informação"
    text = re.sub(r'([a-zA-Záéíóúãõç]+)-\n([a-zA-Záéíóúãõç]+)', r'\1\2', text)
    # Transforma quebras de linha únicas (não seguidas por outra) em espaço
    # Evita mesclar se a próxima linha parece um item de lista (-, *, •, ou número.)
    text = re.sub(r'(?<!\n)\n(?!\n|[\s]*[-*•|]|[\s]*\d+\.)', ' ', text)
    # ========================================
    
    # Monta o prompt
    prompt_pdf_warning = "NOTE: The text provided was likely copied from a PDF and may contain arbitrary line breaks in the middle of sentences. Please analyze the context and seamlessly join fragmented sentences back together in your translation, maintaining the exact original meaning and avoiding any unnecessary paragraph breaks.\n\n"
    if source_lang.lower() in ['auto', 'detecção automática']:
        prompt = f"You are a professional translator. Translate the following text to {target_lang}. {prompt_pdf_warning}Output ONLY the translated text, without any additional comments or notes:\n\n{text}"
    else:
        prompt = f"You are a professional translator. Translate the following text from {source_lang} to {target_lang}. {prompt_pdf_warning}Output ONLY the translated text, without any additional comments or notes:\n\n{text}"
        
    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "options": {
            "num_ctx": context_translate
        }
    }
    
    start_time = time.time()
    tps = 0.0
    try:
        response = requests.post("http://localhost:11434/api/chat", json=payload)
        response.raise_for_status()
        res_json = response.json()
        translated_text = res_json.get('message', {}).get('content', '')
        
        eval_count = res_json.get('eval_count', 0)
        eval_duration = res_json.get('eval_duration', 0)
        if eval_duration > 0:
            tps = round(eval_count / (eval_duration / 1e9), 2)
            
        translated_text = translated_text.replace("```markdown", "").replace("```", "").strip()
        
        # Remove single newlines added by the translation model itself (Mode 1 fix)
        translated_text = re.sub(r'(?<!\n)\n(?!\n|[\s]*[-*•|]|[\s]*\d+\.)', ' ', translated_text)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        
    time_taken = round(time.time() - start_time, 1)
    
    # === SALVAMENTO AUTOMATICO DO HISTORICO DE TESTES (TCC) ===
    try:
        results_dir = os.path.join(os.path.dirname(app.config['UPLOAD_FOLDER']), 'Resultados')
        os.makedirs(results_dir, exist_ok=True)
        historico_path = os.path.join(results_dir, "historico_texto_livre.md")
        with open(historico_path, "a", encoding="utf-8") as f:
            f.write(f"## Data/Hora: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
            f.write(f"- **Modelo:** {model}\n")
            f.write(f"- **Tempo Total:** {time_taken}s\n")
            f.write(f"- **Tokens por Segundo (T/s):** {tps}\n\n")
            f.write(f"### Texto Original ({source_lang})\n{text}\n\n")
            f.write(f"### Texto Traduzido ({target_lang})\n{translated_text}\n\n")
            f.write("---\n\n")
    except Exception as e:
        print(f"Erro ao salvar historico de texto livre: {e}")
        
    return jsonify({
        'translated_text': translated_text,
        'time_taken': time_taken,
        'tps': tps
    })

def get_cpu_name():
    if platform.system() == "Windows":
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            cpu_name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
            return cpu_name.strip()
        except Exception:
            return platform.processor()
    elif platform.system() == "Linux":
        try:
            with open('/proc/cpuinfo', 'r') as f:
                for line in f:
                    if 'model name' in line:
                        return line.split(':')[1].strip()
        except Exception:
            return platform.processor()
    return platform.processor()

def get_ram_specs():
    specs = ""
    if platform.system() == "Windows":
        try:
            output = subprocess.check_output(
                ["powershell", "-Command", "Get-CimInstance Win32_PhysicalMemory | Select-Object Speed, SMBIOSMemoryType | ConvertTo-Json"],
                text=True, creationflags=subprocess.CREATE_NO_WINDOW
            )
            data = json.loads(output)
            item = data[0] if isinstance(data, list) and len(data) > 0 else data
                
            speed = item.get("Speed", "")
            type_code = item.get("SMBIOSMemoryType", 0)
            
            ddr_type = ""
            if type_code == 34: ddr_type = "DDR5"
            elif type_code == 26: ddr_type = "DDR4"
            elif type_code == 24: ddr_type = "DDR3"
            
            if ddr_type or speed:
                specs = f"({ddr_type} {speed}MHz)".strip()
        except Exception:
            pass
    elif platform.system() == "Linux":
        try:
            output = subprocess.check_output(["sudo", "-n", "dmidecode", "-t", "memory"], text=True, stderr=subprocess.DEVNULL)
            speed, ddr = "", ""
            for line in output.split('\n'):
                if "Speed:" in line and "Unknown" not in line and not speed:
                    speed = line.split(":")[1].strip()
                if "Type:" in line and "DDR" in line and not ddr:
                    ddr = line.split(":")[1].strip()
            if ddr or speed:
                specs = f"({ddr} {speed})".strip()
        except Exception:
            pass
    return specs

def estimate_vram_from_name(gpu_name):
    name_upper = gpu_name.upper()
    if any(k in name_upper for k in ['4090', '3090', '6000', 'A100', '24GB']):
        return '24.0 GB'
    elif any(k in name_upper for k in ['4080', '16GB']):
        return '16.0 GB'
    elif any(k in name_upper for k in ['4070 TI', '4070TI', '3080 TI', '3080TI', '12GB']):
        return '12.0 GB'
    elif any(k in name_upper for k in ['4070', '3080', '3060 12GB']):
        return '12.0 GB'
    elif any(k in name_upper for k in ['3070', '4060', '3060 TI', '3060TI', '2080', '2070', '8GB']):
        return '8.0 GB'
    elif '3060' in name_upper:
        return '12.0 GB'
    return 'N/A'

def get_gpu_info():
    gpu_name = 'Nenhum'
    vram_display = 'N/A'
    
    # 1. Tentar nvidia-smi (NVIDIA em Windows e Linux)
    try:
        kwargs = {}
        if platform.system() == "Windows":
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
            
        output = subprocess.check_output(
            ['nvidia-smi', '--query-gpu=name,memory.total,memory.used', '--format=csv,noheader,nounits'],
            encoding='utf-8', errors='ignore', **kwargs
        )
        lines = [line.strip() for line in output.strip().split('\n') if line.strip()]
        best_name = None
        max_v_tot = -1
        best_v_str = 'N/A'
        for line in lines:
            parts = line.split(', ')
            if len(parts) >= 3:
                g_name = parts[0]
                try:
                    v_tot = float(parts[1])
                    v_usd = float(parts[2])
                    if v_tot > max_v_tot:
                        max_v_tot = v_tot
                        best_name = g_name
                        best_v_str = f"{round(v_usd / 1024, 1)} GB / {round(v_tot / 1024, 1)} GB"
                except ValueError:
                    pass
        if best_name:
            return best_name, best_v_str
    except Exception:
        pass

    # 2. Fallback para Linux se nvidia-smi falhar
    if platform.system() == "Linux":
        try:
            import glob
            for fpath in glob.glob('/proc/driver/nvidia/gpus/*/information'):
                with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                    for line in f:
                        if line.startswith('Model:'):
                            gpu_name = line.split(':', 1)[1].strip()
                            break
                if gpu_name != 'Nenhum':
                    break
        except Exception:
            pass

        try:
            import glob
            best_vram = 0
            best_used = 0
            for tf in glob.glob('/sys/class/drm/card*/device/mem_info_vram_total'):
                with open(tf, 'r') as fp:
                    tot_bytes = int(fp.read().strip())
                uf = tf.replace('total', 'used')
                used_bytes = 0
                if os.path.exists(uf):
                    with open(uf, 'r') as fp:
                        used_bytes = int(fp.read().strip())
                if tot_bytes > best_vram and tot_bytes >= (1024**3):
                    best_vram = tot_bytes
                    best_used = used_bytes
            
            if best_vram > 0:
                v_tot = round(best_vram / (1024**3), 1)
                v_usd = round(best_used / (1024**3), 1)
                vram_display = f"{v_usd} GB / {v_tot} GB"
            elif gpu_name != 'Nenhum':
                vram_display = estimate_vram_from_name(gpu_name)
        except Exception:
            pass

    return gpu_name, vram_display

@app.route('/system_info', methods=['GET'])
def system_info():
    ram_specs = get_ram_specs()
    ram_display = f"{round(psutil.virtual_memory().used / (1024**3), 1)} GB / {round(psutil.virtual_memory().total / (1024**3), 1)} GB {ram_specs}".strip()
    gpu_name, vram_display = get_gpu_info()

    info = {
        'os': platform.system() + " " + platform.release(),
        'cpu': get_cpu_name(),
        'ram_display': ram_display,
        'gpu_name': gpu_name,
        'vram_display': vram_display
    }
    return jsonify(info)

@app.route('/api/models/installed', methods=['GET'])
def get_installed_models():
    try:
        response = requests.get("http://localhost:11434/api/tags")
        response.raise_for_status()
        data = response.json()
        models = [model['name'] for model in data.get('models', [])]
        return jsonify({'success': True, 'models': models})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

pull_progress = {}

def pull_model_thread(model_name):
    try:
        pull_progress[model_name] = {'status': 'Iniciando...', 'percent': 0}
        response = requests.post("http://localhost:11434/api/pull", json={"name": model_name, "stream": True}, stream=True)
        for line in response.iter_lines():
            if line:
                data = json.loads(line)
                status_text = data.get('status', 'Baixando...')
                completed = data.get('completed', 0)
                total = data.get('total', 1)
                
                if "pulling" in status_text:
                    completed = data.get('completed', 0)
                    total = data.get('total', 1)
                    if total > 0:
                        percent = int((completed / total) * 100)
                    # Translate status keeping progress
                    pull_progress[model_name] = {'status': 'Baixando...', 'percent': percent}
                elif status_text == "success":
                    pull_progress[model_name] = {'status': 'Concluído', 'percent': 100}
                    break
                else:
                    # Non-download phase (verifying, writing, etc.)
                    # Keep previous percent, just update status
                    prev_percent = pull_progress[model_name]['percent']
                    pull_progress[model_name] = {'status': 'Finalizando...', 'percent': max(prev_percent, 99)}
                    
    except Exception as e:
        pull_progress[model_name] = {'status': 'Erro', 'percent': 0, 'error': str(e)}

@app.route('/api/models/install', methods=['POST'])
def install_model():
    data = request.get_json()
    model_name = data.get('model')
    if not model_name:
        return jsonify({'success': False, 'error': 'Nome do modelo não fornecido'}), 400
    
    threading.Thread(target=pull_model_thread, args=(model_name,)).start()
    return jsonify({'success': True, 'message': 'Instalação iniciada.'})

@app.route('/api/models/progress', methods=['GET'])
def models_progress():
    return jsonify(pull_progress)

@app.route('/api/models/uninstall', methods=['POST'])
def uninstall_model():
    data = request.get_json()
    model_name = data.get('model')
    if not model_name:
        return jsonify({'success': False, 'error': 'Nome do modelo não fornecido'}), 400
    
    try:
        # Desinstalação silenciosa em background
        kwargs = {}
        if platform.system() == "Windows":
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        subprocess.check_call(['ollama', 'rm', model_name], **kwargs)
        return jsonify({'success': True, 'message': f'Modelo {model_name} desinstalado.'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ==========================================
# ROTAS DA BIBLIOTECA (LEITURA ASSISTIDA)
# ==========================================


@app.route('/api/library/upload', methods=['POST'])
def library_upload():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'Nenhum arquivo enviado.'})
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'Nome do arquivo vazio.'})
        
    doc_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    safe_name = doc_id + ext
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], safe_name)
    file.save(filepath)
    
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO documents (id, filename, filepath) VALUES (?, ?, ?)", (doc_id, file.filename, safe_name))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'id': doc_id, 'filename': file.filename, 'filepath': safe_name})

@app.route('/api/library/list', methods=['GET'])
def library_list():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM documents ORDER BY added_at DESC")
    docs = [dict(row) for row in c.fetchall()]
    # Add annotation count for each doc
    for doc in docs:
        c.execute("SELECT COUNT(*) FROM annotations WHERE doc_id = ?", (doc['id'],))
        doc['annotation_count'] = c.fetchone()[0]
    conn.close()
    return jsonify({'success': True, 'documents': docs})

@app.route('/api/library/delete', methods=['POST'])
def library_delete():
    data = request.json
    doc_id = data.get('id')
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT filepath FROM documents WHERE id = ?", (doc_id,))
    row = c.fetchone()
    if row:
        try:
            os.remove(os.path.join(app.config['UPLOAD_FOLDER'], row[0]))
        except Exception:
            pass
        c.execute("DELETE FROM translations WHERE doc_id = ?", (doc_id,))
        c.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/library/save_progress', methods=['POST'])
def library_save_progress():
    data = request.json
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("UPDATE documents SET current_page = ? WHERE id = ?", (data.get('page'), data.get('id')))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/library/save_translation', methods=['POST'])
def library_save_translation():
    data = request.json
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("INSERT INTO translations (doc_id, page_index, original_text, translated_text) VALUES (?, ?, ?, ?)",
              (data['doc_id'], data['page_index'], data['original_text'], data['translated_text']))
    conn.commit()
    # Get the inserted id
    c.execute("SELECT last_insert_rowid()")
    tid = c.fetchone()[0]
    conn.close()
    return jsonify({'success': True, 'id': tid})

@app.route('/api/library/get_translations', methods=['GET'])
def library_get_translations():
    doc_id = request.args.get('doc_id')
    page_index = request.args.get('page_index')
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM translations WHERE doc_id = ? AND page_index = ?", (doc_id, page_index))
    trans = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'translations': trans})


@app.route('/api/library/delete_translation', methods=['POST'])
def library_delete_translation():
    data = request.json
    translation_id = data.get('id')
    if not translation_id:
        return jsonify({'success': False, 'error': 'ID não fornecido'}), 400
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM translations WHERE id = ?", (translation_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/api/ocr_chunk_image', methods=['POST'])
def ocr_chunk_image():
    """Step 1: OCR Extraction"""
    data = request.json
    image_base64 = data.get('image_base64', '')
    ocr_model = data.get('ocr_model', 'qwen2.5vl:7b')

    try:
        if "glm-ocr" in ocr_model:
            prompt_ocr = "Text Recognition:"
        else:
            prompt_ocr = (
                "You are a specialized parser. Extract the text visible in this image. "
                "Strict rules: 1) Preserve tables using Markdown format. "
                "2) CRITICAL: You MUST wrap ALL mathematical expressions, variables, and symbols in LaTeX inline delimiters ($...$) or block delimiters ($$...$$). This includes single letters (e.g., $w$, $s$, $z$, $K$), numbers with exponents ($2^b$), subscripts ($q_i$), and small relations ($s > 0$, $K = 32$). If it is math or a variable, it MUST be wrapped. "
                "3) ALWAYS maintain proper spaces between words, mathematical variables, and numbers (e.g., 'real $w$ e', not 'real$w$e'). "
                "4) Output ONLY the exact transcribed text, without any explanations or summaries."
            )
        ocr_resp = requests.post(
            "http://localhost:11434/api/chat",
            json={
                "model": ocr_model,
                "messages": [
                    {"role": "user", "content": prompt_ocr, "images": [image_base64]}
                ],
                "stream": False,
                "options": {"num_ctx": 4096}
            },
            timeout=120
        )
        ocr_result = ocr_resp.json()
        extracted_text = ocr_result.get('message', {}).get('content', '').strip()
        
        # Salva o resultado bruto do OCR de captura para referência
        try:
            results_dir = os.path.join(os.path.dirname(app.config['UPLOAD_FOLDER']), 'Resultados')
            os.makedirs(results_dir, exist_ok=True)
            crop_debug_path = os.path.join(results_dir, "debug_crop_raw.md")
            with open(crop_debug_path, "w", encoding="utf-8") as f:
                f.write(f"## Data/Hora: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
                f.write(f"**Modelo:** {ocr_model}\n")
                f.write("---\n")
                f.write(extracted_text)
                f.write("\n---\n")
        except Exception as e:
            print(f"Erro ao salvar log do crop: {e}")

        # Normalização de equações LaTeX: converte \( \) para $ $ e \[ \] para $$ $$
        extracted_text = extracted_text.replace(r'\(', '$').replace(r'\)', '$')
        extracted_text = extracted_text.replace(r'\[', '$$').replace(r'\]', '$$')

        # Converter ambientes problemáticos para delimitadores compatíveis com KaTeX
        extracted_text = re.sub(r'\\begin\{equation\*?\}', '$$', extracted_text)
        extracted_text = re.sub(r'\\end\{equation\*?\}', '$$', extracted_text)
        extracted_text = re.sub(r'\\begin\{align\*?\}', r'$$ \\begin{aligned}', extracted_text)
        extracted_text = re.sub(r'\\end\{align\*?\}', r'\\end{aligned} $$', extracted_text)

        if not extracted_text:
            return jsonify({'success': False, 'error': 'Nenhum texto extraído da imagem.'})

        return jsonify({'success': True, 'extracted_text': extracted_text})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/translate_chunk_markdown', methods=['POST'])
def translate_chunk_markdown():
    """Step 2: Translate preserving Markdown"""
    data = request.json
    text = data.get('text', '')
    translate_model = data.get('translate_model', 'translategemma:4b')
    context_tokens = int(data.get('context_translate', 8192))

    try:
        import re

        text = auto_wrap_math(text)
        text = promote_math_lines(text)
        
        # === MATH PROTECTION: replace all math with opaque tokens before translation ===
        math_blocks = []

        def protect(m):
            token = f'XMATHBLOCKX{len(math_blocks)}XENDX'
            math_blocks.append(m.group(0))
            return token

        protected = text
        # Order: $$ first (greedy), then $, then \[...\], then \(...\), then environments
        protected = re.sub(r'\$\$[\s\S]+?\$\$', protect, protected)
        protected = re.sub(r'\\\[[\s\S]+?\\\]', protect, protected)
        protected = re.sub(r'\\begin\{equation\*?\}[\s\S]+?\\end\{equation\*?\}', protect, protected)
        protected = re.sub(r'\\begin\{align\*?\}[\s\S]+?\\end\{align\*?\}', protect, protected)
        protected = re.sub(r'\$[^$\n]+?\$', protect, protected)
        protected = re.sub(r'\\\([\s\S]+?\\\)', protect, protected)
        # ============================================================================

        prompt_trans = (
            f"Translate the following text from English to Portuguese (Brasil). "
            f"Preserve all original formatting. "
            f"Do NOT add arbitrary line breaks or paragraphs in the middle of sentences. Only create new paragraphs where the original text has them. "
            f"Do NOT modify tokens that look like XMATHBLOCKX...XENDX - keep them exactly as-is.\n\n"
            f"{protected}"
        )
        trans_resp = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": translate_model,
                "prompt": prompt_trans,
                "stream": False,
                "options": {"num_ctx": context_tokens, "num_predict": 4096}
            },
            timeout=120
        )
        trans_result = trans_resp.json()
        translated = trans_result.get('response', '').strip()

        # === MATH RESTORATION: put the original math blocks back ===
        # Simple and robust: replace each token directly by index.
        # The LLM may alter casing or spacing inside the token string, so we use
        # a case-insensitive regex per token to find and replace reliably.
        for i, block in enumerate(math_blocks):
            token_pattern = rf'XMATHBLOCKX\s*{i}\s*XENDX'
            translated = re.sub(token_pattern, lambda m, b=block: b, translated, flags=re.IGNORECASE)
        # ============================================================

        # Normalize \( \) -> $ $  and  \[ \] -> $$ $$
        translated = translated.replace(r'\(', '$').replace(r'\)', '$')
        translated = translated.replace(r'\[', '$$').replace(r'\]', '$$')

        # Convert display environments the OCR might have produced
        translated = re.sub(r'\\begin\{equation\*?\}', '$$', translated)
        translated = re.sub(r'\\end\{equation\*?\}', '$$', translated)
        translated = re.sub(r'\\begin\{align\*?\}', r'$$\\begin{aligned}', translated)
        translated = re.sub(r'\\end\{align\*?\}', r'\\end{aligned}$$', translated)

        # Convert inline math that ended up alone on a line to display math
        translated = promote_math_lines(translated)

        # Ensure display math ($$) has blank lines around it so marked.js treats it as a block
        translated = re.sub(r'\$\$([\s\S]+?)\$\$', r'\n\n$$\1$$\n\n', translated)
        translated = re.sub(r'\n{3,}', '\n\n', translated)

        # Fix spaces inside inline math delimiters which break KaTeX rendering
        translated = clean_math_spaces(translated)

        if not translated:
            return jsonify({'success': False, 'error': 'Nenhuma tradução retornada.'})

        return jsonify({'success': True, 'translation': translated})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})


@app.route('/api/annotations/save', methods=['POST'])
def annotations_save():
    data = request.json
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "INSERT INTO annotations (doc_id, page_index, x, y, content, color) VALUES (?, ?, ?, ?, ?, ?)",
        (data['doc_id'], data['page_index'], data['x'], data['y'], data.get('content', ''), data.get('color', '#fbbf24'))
    )
    conn.commit()
    c.execute("SELECT last_insert_rowid()")
    aid = c.fetchone()[0]
    conn.close()
    return jsonify({'success': True, 'id': aid})


@app.route('/api/annotations/update', methods=['POST'])
def annotations_update():
    data = request.json
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    if 'x' in data and 'y' in data:
        c.execute("UPDATE annotations SET content = ?, x = ?, y = ? WHERE id = ?", (data.get('content', ''), data['x'], data['y'], data['id']))
    else:
        c.execute("UPDATE annotations SET content = ? WHERE id = ?", (data.get('content', ''), data['id']))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/annotations/delete', methods=['POST'])
def annotations_delete():
    data = request.json
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM annotations WHERE id = ?", (data['id'],))
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/annotations/list', methods=['GET'])
def annotations_list():
    doc_id = request.args.get('doc_id')
    page_index = request.args.get('page_index')
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM annotations WHERE doc_id = ? AND page_index = ?", (doc_id, page_index))
    anns = [dict(row) for row in c.fetchall()]
    conn.close()
    return jsonify({'success': True, 'annotations': anns})


@app.route('/api/translate_chunk', methods=['POST'])
def translate_chunk():
    data = request.json
    text = data.get('text', '')
    model = data.get('model', 'translategemma:4b')
    context_tokens = int(data.get('context_translate', 8192))
    
    # === LIMPEZA DE TEXTO DE PDF (MODO 1) ===
    # Remove carriage returns para lidar com colagem no Windows
    text = text.replace('\r', '')
    # Junta palavras hifenizadas que foram separadas pela quebra de linha
    text = re.sub(r'([a-zA-Záéíóúãõç]+)-\n([a-zA-Záéíóúãõç]+)', r'\1\2', text)
    # Transforma quebras de linha únicas em espaço (mantém se parecer lista)
    text = re.sub(r'(?<!\n)\n(?!\n|[\s]*[-*•|]|[\s]*\d+\.)', ' ', text)
    # ========================================

    prompt_pdf_warning = "NOTE: The text provided was likely copied from a PDF and may contain arbitrary line breaks in the middle of sentences. Please analyze the context and seamlessly join fragmented sentences back together in your translation, maintaining the exact original meaning and avoiding any unnecessary paragraph breaks.\n\n"
    
    prompt = (
        "Translate the following English text to Portuguese (Brasil). "
        f"{prompt_pdf_warning}"
        "Output ONLY the translated text, without any explanations, quotes, or original text.\n\n"
        f"Text to translate:\n{text}"
    )
    
    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "num_ctx": context_tokens
                }
            }
        )
        result = response.json()
        translated = result.get('response', '').strip()

        # Remove single newlines added by the translation model itself (Mode 1 fix)
        translated = re.sub(r'(?<!\n)\n(?!\n|[\s]*[-*•|]|[\s]*\d+\.)', ' ', translated)

        return jsonify({'success': True, 'translation': translated})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    # Roda a aplicação localmente na porta 5000
    app.run(debug=True, port=5000, use_reloader=False)
