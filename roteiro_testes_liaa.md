# Roteiro de Testes e Validação - TCC (LIAA / RTX 4090)

> [!NOTE]
> **Data:** ___/___/2026
> **Local:** Laboratório de Inteligência Artificial Aplicada (LIAA) - Bloco Alan Turing
> **Hardware Alvo:** GPU NVIDIA RTX 4090 (24GB VRAM)

Este roteiro é projetado para extrair métricas empíricas e qualitativas rigorosas do software desenvolvido, rodando no hardware de alto desempenho do laboratório. Os dados coletados aqui comporão as Tabelas e as Imagens de evidência no **Capítulo 5 (Resultados e Discussão)** do seu TCC.

---

## 0. Instalação e Preparação (Laboratório)

**Passo 0.1: Instalação do Motor de IA (Ollama)**
Antes de clonar o sistema, certifique-se de que o motor de Inteligência Artificial está instalado e rodando.
1. Baixe o executável oficial em: [https://ollama.com/download](https://ollama.com/download)
2. Realize a instalação padrão (Avançar > Avançar > Concluir).
3. Verifique se o ícone da Lhama está na bandeja do sistema do Windows (perto do relógio) ou abra o navegador em `http://localhost:11434/` (deve mostrar a mensagem *"Ollama is running"*). Se não estiver rodando, pesquise "Ollama" no Menu Iniciar e abra o programa.

**Passo 0.2: Baixando o Sistema do GitHub**
Com o Ollama no ar, abra um terminal (PowerShell ou CMD) e baixe o seu código-fonte:
```bash
git clone https://github.com/n3lloc/tradutor-offline-ifgoiano.git
cd tradutor-offline-ifgoiano
```

**Passo 0.3: Iniciando o Ambiente Python**
Crie o ambiente virtual e inicie o servidor Flask:
```bash
python -m venv venv
# Ativar no Windows:
.\venv\Scripts\activate
# Instalar bibliotecas e rodar:
pip install -r requirements.txt
python app.py
```
Acesse `http://127.0.0.1:5000/` no navegador. Na aba **Gerenciador de Modelos**, instale os modelos `translategemma:4b`, `12b` e `27b` se ainda não estiverem na máquina.

Para executar o avaliador de métricas (BLEU, METEOR, ROUGE-L) em um terminal separado:
```bash
python avaliador.py
```

---

## 1. Monitoramento do Ambiente de Hardware

Antes de iniciar qualquer teste, mantenha estas janelas abertas em monitores paralelos (se possível) ou consulte-as a cada etapa:

1. **Monitor de GPU (Nvidia):**
   ```bash
   nvidia-smi
   ```
   > [!TIP]
   > Observe o consumo de VRAM e os picos de voltagem (Watts). Qual a diferença do pico de memória entre carregar o `translategemma:4b` e o gigante `translategemma:27b`?

2. **Monitor de IA (Ollama):**
   ```bash
   ollama ps
   ```
   *Serve para auditar qual modelo está carregado na VRAM no momento da execução.*

---

## 2. Fase Qualitativa: Leitura Assistida (PDF)

Conforme alinhado, a aba de "Tradução de Documentos" (via GLM-OCR) possui uma carga subjetiva elevada na fluidez de leitura. Portanto, o objetivo desta fase é focar puramente em **Comprovação Visual (Screenshots)** para ilustrar o TCC.

- **Ação:** Faça o upload de um Artigo Científico Complexo (com 2 colunas e matrizes matemáticas visíveis).
- **Validação de Interface (Screenshots):**
  - [ ] Tire um print da aba de **Gerenciamento de Modelos** mostrando a interface onde você baixa/desinstala os pesos do GLM-OCR e do Gemma sem usar o terminal.
  - [ ] Tire um print do sistema fazendo o OCR: mostre a divisão da tela (PDF original de um lado, Markdown extraído do outro).
  - [ ] Mostre a "Leitura Assistida" funcionando na prática: A capacidade do sistema de formatar uma equação matemática densa (ex: Teorema de Bayes ou Integrais Duplas) que estava no PDF.

> [!IMPORTANT]
> A leitura do PDF serve para validar que a arquitetura *VLM $\rightarrow$ Markdown* proposta na Metodologia realmente funcionou visualmente. Não focaremos em tempo aqui.

---

## 3. Fase Empírica: A "Batalha" da Tradução (Texto Livre)

Esta é a fase quantitativa de Ouro do seu TCC. Aqui, usaremos a aba **Tradução de Texto Livre** para testarmos diferentes capacidades de parâmetros e gerarmos as métricas que serão tabeladas no documento.

### Preparação do Dataset (Amostras)
No seu computador, tenha um bloco de notas com 3 recortes de texto retirados de um artigo científico em Inglês:
- **Amostra 1 (Texto Simples):** Um parágrafo de Introdução genérico (aprox. 50-70 palavras).
- **Amostra 2 (Jargão Técnico):** Um parágrafo denso de Materiais e Métodos (repleto de biotecnologia, computação ou termos de nicho).
- **Amostra 3 (Equações Inline):** Um parágrafo que misture texto com variáveis soltas, ex: `Therefore, where $x \to 0$ and the matrix $W^Q$ is calculated...`

### A Dinâmica de Teste
Para **cada amostra**, você colará o texto na interface e clicará em "Traduzir Texto" usando os seguintes modelos sequencialmente:
1. `translategemma:4b` (3.3GB)
2. `translategemma:12b` (8.1GB)
3. `translategemma:27b` (17GB - Exige a RTX 4090)

### O Que Coletar: Absolutamente NADA Manualmente!
Como implementamos o **Salvamento Automático**, você não precisa anotar nada na mão! Apenas garanta que executou a tradução de cada texto nos 3 modelos. O sistema cuidará do resto.

---

## 4. Tratamento de Dados (Pós-Laboratório)

Ao final dos testes, navegue até a pasta `Resultados/` dentro do diretório do software e copie o arquivo **`historico_texto_livre.md`** para o seu pen-drive. Este arquivo conterá todo o ouro dos testes, perfeitamente detalhado: modelo utilizado, texto original, texto traduzido, Tempo (s) e a Taxa de Processamento (Tokens/s - T/s).

Quando estiver redigindo o Capítulo de Resultados no LaTeX:
1. **Comparativo Manual:** Usaremos os textos desse histórico para colocar lado a lado a diferença bruta de interpretação semântica de um modelo 4B contra o 27B.
2. **Métricas Oficiais (BLEU/METEOR/ROUGE-L):** Usaremos o script `avaliador.py` para dar uma "nota" matemática à precisão de cada versão traduzida presente no seu histórico.
