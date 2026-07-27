import nltk
import sys
from nltk.translate.bleu_score import sentence_bleu, SmoothingFunction
from nltk.translate.meteor_score import meteor_score
from rouge_score import rouge_scorer

# Baixar recursos necessarios do NLTK (executa apenas na primeira vez)
try:
    nltk.data.find('tokenizers/punkt_tab')
    nltk.data.find('corpora/wordnet')
except LookupError:
    print("Baixando dicionarios do NLTK pela primeira vez...")
    nltk.download('punkt', quiet=True)
    nltk.download('punkt_tab', quiet=True)
    nltk.download('wordnet', quiet=True)
    nltk.download('omw-1.4', quiet=True)
    print("Download concluido.\n")

def calcular_metricas():
    print("="*60)
    print("      AVALIADOR DE TRADUCAO - METRICAS OFICIAIS")
    print("="*60)
    
    print("\n[1] Digite a TRADUCAO DE REFERENCIA (Gabarito / Humano / 27B):")
    referencia = input(">> ").strip()
    
    if not referencia:
        print("A referencia nao pode estar vazia.")
        return
        
    print("\n[2] Digite a TRADUCAO CANDIDATA (Testada / Maquina 4B):")
    candidata = input(">> ").strip()
    
    if not candidata:
        print("A candidata nao pode estar vazia.")
        return

    # Preparacao para BLEU e METEOR (Tokenizacao)
    ref_tokens = nltk.word_tokenize(referencia.lower())
    cand_tokens = nltk.word_tokenize(candidata.lower())
    
    # 1. BLEU Score
    cc = SmoothingFunction()
    bleu = sentence_bleu([ref_tokens], cand_tokens, smoothing_function=cc.method1)
    
    # 2. METEOR Score
    meteor = meteor_score([ref_tokens], cand_tokens)
    
    # 3. ROUGE-L Score (Longest Common Subsequence)
    scorer = rouge_scorer.RougeScorer(['rougeL'], use_stemmer=True)
    rouge_l = scorer.score(referencia, candidata)['rougeL'].fmeasure
    
    print("\n" + "="*60)
    print("                    RESULTADOS")
    print("="*60)
    print(f"BLEU Score:    {bleu:.4f}  (Sobreposicao de n-gramas)")
    print(f"METEOR Score:  {meteor:.4f}  (Alinhamento lexico e sinonimia)")
    print(f"ROUGE-L Score: {rouge_l:.4f}  (Maior subsequencia comum de palavras)")
    print("="*60 + "\n")

if __name__ == "__main__":
    while True:
        calcular_metricas()
        opcao = input("Deseja testar outra frase? (S/N): ").strip().lower()
        if opcao != 's':
            print("Encerrando...")
            break
