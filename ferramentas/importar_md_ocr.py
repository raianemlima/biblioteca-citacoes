"""Aproveita um OCR já feito fora (Markdown com "<!-- Página PDF N -->" antes de cada página) no formato do ocr_livro.py.

    python3 -I importar_md_ocr.py LIVRO.md SAIDA.json --de 13 --ate 42 --soma 18

--de/--ate: faixa de páginas do PDF que entra; --soma: página do livro = página do PDF + soma (vale numa faixa
de páginas simples; o script confere com os cabeçalhos legíveis e para se algum discordar).

Entram só as páginas que dão para citar com segurança:
- página com texto (as marcadas "OCR pendente"/"não reconhecido" ficam de fora);
- página simples: digitalização com duas páginas do livro lado a lado, lida linha a linha, mistura as duas colunas
  ("...ou, | com os §§ 2º...") e daria citação errada, então fica de fora (linhas longas demais ou com " | ");
- número impresso pelo cabeçalho ("32 CURSO DE DIREITO..." ou "Cap. 1 • ... 33"); sem cabeçalho, pela vizinha.
O cabeçalho sai do texto; as notas de rodapé (linhas "1. GIDI, Antonio...", no pé) vão para "notas".
"""
import sys, re, json, statistics

a = sys.argv[1:]
src, saida = a[0], a[1]
opt = dict(zip(a[2::2], a[3::2]))
de, ate, soma = int(opt.get("--de", 1)), int(opt.get("--ate", 99999)), (int(opt["--soma"]) if "--soma" in opt else None)
s = open(src, encoding="utf-8").read()
partes = re.split(r"<!-- Página (?:do )?PDF:? (\d+) -->", s)
PEND = re.compile(r"não reconhecido pelo OCR|OCR pendente|não processada")
CAB = [re.compile(r"^\W{0,3}(\d{1,3})\s+CURSO\b", re.I), re.compile(r"^\W{0,3}Cap\b.*?\b(\d{1,3})\s*$", re.I), re.compile(r"\bCOLETIV[OA]S?\b.*?\b(\d{1,3})\s*$")]
NOTA = re.compile(r"^\W{0,3}\d{1,3}\.?\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}[,.]|Sobre\b|Ver\b|Nesse\b|Neste\b|Cf\.|Para\b|No mesmo\b|Assim\b|Como\b|É o\b|Em\b)")

PALAVRA = re.compile(r"[(“\"‘]?(?:[a-zà-ú]+|[A-ZÀ-Ú][a-zà-ú]+|[A-ZÀ-Ú]{2,})(?:-[A-Za-zÀ-ú]+)?[)”\"’]?[.,;:!?]?\)?")
def boa(w):
    return bool(PALAVRA.fullmatch(w)) and bool(re.search(r"[aeiouáéíóúâêôãõàyAEIOUÁÉÍÓÚÂÊÔÃÕ]", w)) and len(w) <= 24
def qualidade(texto):
    pal = [w for w in re.findall(r"\S+", texto) if re.search(r"[A-Za-zÀ-ú]", w)]
    return sum(map(boa, pal)) / len(pal) if pal else 0
def lixo(l):
    """linha embaralhada (cabeçalho mal lido, anotação à mão, ruído da digitalização)"""
    pal = [w for w in l.split() if re.search(r"[A-Za-zÀ-ú]", w)]
    return len(pal) >= 2 and qualidade(l) < 0.6 or (0 < len(pal) < 2 and len(l.strip()) < 8)

def pagina(n, t):
    t = re.sub(r"^\s*## Página PDF \d+\s*", "", t.strip())
    t = re.sub(r"\n-{3,}\s*$", "", t).strip()
    if not t or PEND.search(t): return None, "sem texto"
    ls = [l.rstrip() for l in t.splitlines()]
    cheias = [len(l) for l in ls if len(l.strip()) > 30]
    if not cheias: return None, "sem texto corrido"
    if statistics.median(cheias) > 100 or sum(" | " in l for l in ls) >= 4: return None, "duas páginas lado a lado"
    impressa, corpo = None, []
    for i, l in enumerate(ls):
        if i < 3 and not corpo:
            m = next((c.search(l) for c in CAB if c.search(l)), None)
            if m: impressa = m.group(1); continue
            # cabeçalho ilegível ou marca solta no alto da página
            if re.search(r"CURSO|PROCESSUAL|Cap\b|cap\.|INTRODU|COLETIV|Didier|Zaneti", l) or len(re.sub(r"[^A-Za-zÀ-ú]", "", l)) < 12: continue
            if re.match(r"^\W{0,3}\d{2,3}\s", l) or qualidade(l) < 0.85: continue   # nº da página + cabeçalho embaralhado
        corpo.append(l)
    # notas de rodapé: do primeiro "N. SOBRENOME..." da metade de baixo em diante
    ini = next((i for i, l in enumerate(corpo) if i > len(corpo) * .45 and NOTA.match(l.strip())), None)
    notas = corpo[ini:] if ini is not None else []
    corpo = corpo[:ini] if ini is not None else corpo
    pars, cur = [], ""
    for l in corpo + [""]:
        l = l.strip().strip("|").strip()
        if not l:
            if cur: pars.append(cur); cur = ""
            continue
        if len(re.sub(r"[^A-Za-zÀ-ú]", "", l)) < 3 or lixo(l): continue        # marca solta ou linha embaralhada
        l = re.sub(r"^[.,;:'’|]\s+(?=\w)", "", l)
        if re.search(r"[A-Za-zÀ-ú]-$", cur) and re.match(r"^[a-zà-ú]", l): cur = cur[:-1] + l
        else: cur = (cur + " " + l).strip()
    # o OCR externo às vezes põe linha em branco no meio do parágrafo: junta quando a frase continua
    juntos = []
    for p_ in pars:
        if juntos and not re.search(r"[.!?:;][”\"’)]*$", juntos[-1]) and re.match(r"^[a-zà-ú0-9(,;]", p_):
            juntos[-1] = (juntos[-1][:-1] + p_) if re.search(r"[A-Za-zÀ-ú]-$", juntos[-1]) else juntos[-1] + " " + p_
        else: juntos.append(p_)
    texto = "\n\n".join(juntos)
    # qualidade: parte das palavras que parecem palavras (letras com vogal); texto embaralhado derruba a nota
    # nota: cada 1% de palavras embaralhadas tira 6 pontos (o app avisa abaixo de 85; abaixo de 60 a página não entra)
    pal = [w for w in re.findall(r"\S+", texto) if re.search(r"[A-Za-zÀ-ú]", w)]
    ruins = sum(1 for w in pal if not boa(w))
    conf = round(max(0, 100 - 6 * 100 * ruins / len(pal))) if pal else 0
    duv = sorted({w.strip("()“”\"‘’.,;:!?") for w in re.findall(r"\S+", texto) if re.search(r"[A-Za-zÀ-ú]{2}", w) and not boa(w)} - {""})[:60]
    return {"n": n, "impressa": impressa, "texto": texto, "notas": "\n".join(x.strip() for x in notas if x.strip()),
            "duvidas": duv, "confianca": conf, "fonte": "ocr-externo"}, "ok"

pags, motivos = [], {}
for i in range(1, len(partes), 2):
    n = int(partes[i])
    if n < de or n > ate: continue
    p, m = pagina(n, partes[i + 1])
    if p and p["confianca"] < 60: p, m = None, "leitura ruim demais (nota < 60)"
    motivos[m] = motivos.get(m, 0) + 1
    if p: pags.append(p)
if soma is not None:
    erradas = [(p["n"], p["impressa"]) for p in pags if p["impressa"] and p["impressa"].isdigit() and int(p["impressa"]) != p["n"] + soma and len(p["impressa"]) >= 2]
    certas = [p["n"] for p in pags if p["impressa"] and p["impressa"].isdigit() and int(p["impressa"]) == p["n"] + soma]
    print(f"cabeçalhos que conferem com PDF+{soma}: {len(certas)}; que não conferem (lidos errado ou faixa errada): {erradas}")
    if len(certas) < 3 or len(erradas) > len(certas) // 2: sys.exit("a regra de numeração não confere: revise --soma e a faixa")
    for p in pags: p["impressa"], p["deduzida"] = str(p["n"] + soma), True
# número pela vizinha (página simples: +1 por página do PDF), só quando a sequência confere
for j, p in enumerate(pags):
    if p["impressa"]: continue
    viz = [q for q in pags if q["impressa"] and abs(q["n"] - p["n"]) <= 3]
    cand = {str(int(q["impressa"]) + p["n"] - q["n"]) for q in viz if q["impressa"].isdigit()}
    if len(cand) == 1: p["impressa"] = cand.pop(); p["deduzida"] = True
json.dump({"arquivo": src.rsplit("/", 1)[-1], "paginas": pags}, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{saida}: {len(pags)} páginas aproveitadas; " + ", ".join(f"{v} {k}" for k, v in motivos.items()))
