"""Transforma um livro digitalizado (PDF ou pasta de imagens das páginas) em páginas de texto para citação.

    python3 -I ocr_livro.py LIVRO.pdf SAIDA.json [--de N --ate M] [--dpi 300]
    python3 -I ocr_livro.py PASTA_DE_IMAGENS SAIDA.json          (img01.png, img02.png... em ordem)

Página do PDF em paisagem (duas páginas do livro lado a lado, digitalização de livro aberto) vira duas páginas:
o corte é no vinco, a coluna mais clara perto do meio.

Saída: {"arquivo", "paginas": [{"n": ordem, "impressa": "32" | null, "texto": "...", "notas": "...",
         "duvidas": [...], "confianca": 0-100, "fonte": "texto" | "ocr"}]}
- página com camada de texto boa usa o texto do PDF; senão, OCR (Tesseract, português);
- "impressa" é o número impresso no cabeçalho ou no rodapé (é o que vai na citação: p. 32);
- cabeçalho corrido, anotações à mão na margem e marcas soltas saem do texto;
- notas de rodapé (letra menor no pé da página) ficam em "notas", fora do corpo;
- "duvidas" são as palavras lidas com baixa confiança, para conferir no original antes de citar.
Nenhum dado pessoal: anotações manuscritas (nome de dono anterior, por exemplo) ficam de fora por estarem fora da
mancha de texto; mesmo assim, confira a folha de rosto e não a converta (comece pela 1ª página de conteúdo com --de).
"""
import sys, os, re, json, glob, subprocess, tempfile, statistics, concurrent.futures as cf

args = sys.argv[1:]
entrada, saida = args[0], args[1]
opt = dict(zip(args[2::2], args[3::2]))
DPI = int(opt.get("--dpi", 300))
if os.path.isdir(entrada):
    IMAGENS = sorted(glob.glob(os.path.join(entrada, "*.png")) + glob.glob(os.path.join(entrada, "*.jpg")))
    TOTAL, doc = len(IMAGENS), None
else:
    import pymupdf
    doc = pymupdf.open(entrada); TOTAL, IMAGENS = doc.page_count, None
de, ate = int(opt.get("--de", 1)), int(opt.get("--ate", TOTAL))
ESCALA = float(opt.get("--escala", 1.5))   # para digitalizações cuja imagem já está em pixels de página (72 dpi)

def dupla(n):
    r = doc[n - 1].rect
    return r.width > 1.15 * r.height

def vinco(pg):
    """x do vinco entre as duas páginas: coluna com menos tinta entre 40% e 60% da largura"""
    import numpy as np
    pix = pg.get_pixmap(matrix=pymupdf.Matrix(0.2, 0.2), colorspace=pymupdf.csGRAY)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width].astype(float)
    a = a[int(.08 * pix.height):int(.92 * pix.height)]
    tinta = (a < 128).mean(axis=0)
    w = pix.width; i0, i1 = int(.4 * w), int(.6 * w)
    suave = np.convolve(tinta, np.ones(5) / 5, mode="same")
    x = i0 + int(np.argmin(suave[i0:i1]))
    return x / w * pg.rect.width

TAREFAS = []
for n in range(de, ate + 1):
    TAREFAS += [(n, "e"), (n, "d")] if (doc is not None and dupla(n)) else [(n, "")]
NUM = re.compile(r"^\s*(\d{1,4})\b|\b(\d{1,4})\s*$")

def linhas_tsv(tsv):
    L = {}
    for row in tsv.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or c[0] != "5" or not c[11].strip(): continue
        k = (int(c[2]), int(c[3]), int(c[4]))
        x, y, w, h, conf = int(c[6]), int(c[7]), int(c[8]), int(c[9]), float(c[10])
        l = L.setdefault(k, {"k": k, "ws": [], "x0": x, "y0": y, "x1": x + w, "y1": y + h, "hs": []})
        l["ws"].append((c[11], conf)); l["x0"] = min(l["x0"], x); l["y0"] = min(l["y0"], y); l["x1"] = max(l["x1"], x + w); l["y1"] = max(l["y1"], y + h)
        if re.search(r"[a-zà-ú]", c[11]): l["hs"].append(h)
    return sorted(L.values(), key=lambda l: (l["y0"], l["x0"]))

def texto_linha(l): return " ".join(w for w, _ in l["ws"])
def letras(s): return len(re.findall(r"[A-Za-zÀ-ú]", s))

def organizar(linhas, W, H):
    """separa cabeçalho (com o nº da página), corpo e notas; tira margens e marcas soltas"""
    boas = [l for l in linhas if len(l["ws"]) >= 5 and letras(texto_linha(l)) > 15]
    if not boas: return None, [], [], []
    esq = statistics.median(l["x0"] for l in boas); dir_ = statistics.median(l["x1"] for l in boas)
    alt = statistics.median(h for l in boas for h in l["hs"]) if any(l["hs"] for l in boas) else 30
    impressa, corpo, notas, duv = None, [], [], []
    for i, l in enumerate(linhas):
        t = texto_linha(l)
        # fora da mancha de texto (anotação na margem) ou marca solta
        if l["x1"] < esq - 0.02 * W or l["x0"] > dir_ + 0.01 * W or letras(t) < 3: continue
        if l["x0"] < esq - 0.06 * W and len(l["ws"]) < 4: continue
        # alto da página (antes da 1ª linha de texto): cabeçalho corrido com o número, ou sujeira da digitalização
        if l["y0"] < 0.2 * H and not corpo:
            m = NUM.search(t)
            if m and not re.fullmatch(r"\s*CAP[IÍ]TULO\s+\d+\s*", t, re.I) and (t.isupper() or re.search(r"CAP|CURSO|PROCESSUAL|COLETIV|Vol|Didier|Zaneti", t, re.I) or len(l["ws"]) <= 12):
                impressa = impressa or (m.group(1) or m.group(2)); continue
            if re.search(r"CURSO DE DIREITO|PROCESSUAL CIVIL|Didier|Zaneti|ESTUDO DO PROCESSO", t, re.I): continue   # cabeçalho sem número legível
            if letras(t) < 8 or not re.search(r"[A-Za-zÀ-ú]{4,}", t): continue
        # número sozinho no rodapé
        if l["y0"] > 0.92 * H and re.fullmatch(r"\s*\d{1,4}\s*", t): impressa = impressa or t.strip(); continue
        hs = l["hs"] or [alt]
        nota = l["y0"] > 0.6 * H and statistics.median(hs) < 0.82 * alt
        (notas if nota else corpo).append(l)
        duv += [w for w, c in l["ws"] if c < 60 and len(w) > 2 and re.search(r"[A-Za-zÀ-ú]", w)]
    return impressa, corpo, notas, duv

def paragrafos(ls, W):
    """parágrafo novo: recuo de 1ª linha ou espaço vertical maior que o normal (a numeração de parágrafos do OCR não é confiável)"""
    if not ls: return []
    esq = statistics.median(l["x0"] for l in ls)
    alt = statistics.median(l["y1"] - l["y0"] for l in ls)
    out, cur, ant = [], "", None
    for l in ls:
        t = re.sub(r"\s*[|¦]\s*$", "", texto_linha(l)).replace(" | ", " ").strip()
        recuo = l["x0"] - esq > 0.025 * W
        novo = ant is None or recuo or (l["y0"] - ant["y1"]) > 0.9 * alt
        if novo and cur: out.append(cur); cur = ""
        if re.search(r"[A-Za-zÀ-ú]-$", cur) and re.match(r"^[a-zà-ú]", t): cur = cur[:-1] + t   # hifenização de fim de linha
        else: cur = (cur + " " + t).strip()
        ant = l
    if cur: out.append(cur)
    return out

# erros típicos do OCR em texto jurídico: "§" lido como 8 ou S antes de "2º"; "º" lido como "°"/"o" depois de número
CORRIGE = [(r"(?<=\s)[8S]{1,2}\s?(?=\d{1,3}[º°])", "§ "), (r"(?<=\d)[°](?=[\s,.;:)])", "º"),
           # chamada de nota de rodapé lida como sinal (“primário!, do qual”, “sensu (...)? ou”, “ex.)º de”): sai do texto
           (r"(?<=[A-Za-zà-ú)])[!?º°¹²³⁴⁵⁶⁷⁸⁹](?=[,;:]?\s+[a-zà-ú])", "")]
def corrige(t):
    for a, b in CORRIGE: t = re.sub(a, b, t)
    return t

def imagem(tarefa):
    n, lado = tarefa
    if IMAGENS: return IMAGENS[n - 1], None
    t = tempfile.mkdtemp(); arq = os.path.join(t, "p.png")
    pg = doc[n - 1]
    if pg.get_images() and len(pg.get_images()) == 1:   # digitalização: uma imagem por página
        r = pg.rect
        if lado:
            x = vinco(pg)
            clip = pymupdf.Rect(0, 0, x, r.height) if lado == "e" else pymupdf.Rect(x, 0, r.width, r.height)
        else: clip = r
        esc = ESCALA if max(r.width, r.height) > 1500 else DPI / 72
        pg.get_pixmap(matrix=pymupdf.Matrix(esc, esc), clip=clip, colorspace=pymupdf.csGRAY).save(arq)
    else:
        subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-f", str(n), "-l", str(n), "-png", "-singlefile", entrada, arq[:-4]], check=True)
    return arq, t

def pagina(tarefa):
    n, lado = tarefa
    if doc is not None and not lado:
        txt = doc[n - 1].get_text("text")
        if len(re.findall(r"[A-Za-zÀ-ú]{3,}", txt)) > 40:   # PDF com texto de verdade
            ls = [x for x in txt.splitlines()]
            m = [x for x in ls[:2] + ls[-2:] if re.fullmatch(r"\s*\d{1,4}\s*", x)]
            return {"n": n, "lado": lado, "impressa": m[0].strip() if m else None, "texto": corrige("\n\n".join(p.strip() for p in re.split(r"\n\s*\n", txt) if p.strip())), "notas": "", "duvidas": [], "confianca": 100, "fonte": "texto"}
    arq, tmp = imagem(tarefa)
    r = subprocess.run(["tesseract", arq, "-", "-l", "por", "--psm", "1", "tsv"], capture_output=True, text=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    import struct
    with open(arq, "rb") as f: cab = f.read(24)
    W, H = struct.unpack(">II", cab[16:24]) if cab[:8] == b"\x89PNG\r\n\x1a\n" else (2480, 3508)
    if tmp: subprocess.run(["rm", "-rf", tmp])
    linhas = linhas_tsv(r.stdout)
    impressa, corpo, notas, duv = organizar(linhas, W, H)
    confs = [c for l in corpo for _, c in l["ws"]]
    return {"n": n, "lado": lado, "impressa": impressa, "texto": corrige("\n\n".join(paragrafos(corpo, W))), "notas": corrige("\n".join(t for t in (texto_linha(l) for l in notas) if letras(t) > 6)),
            "duvidas": sorted(set(duv))[:40], "confianca": round(sum(confs) / len(confs)) if confs else 0, "fonte": "ocr"}

if IMAGENS: TAREFAS = [(n, "") for n in range(de, ate + 1)]
pags = []
with cf.ThreadPoolExecutor(max_workers=os.cpu_count() or 2) as ex:
    for i, p in enumerate(ex.map(pagina, TAREFAS), 1):
        pags.append(p)
        print(f"\rimagem {i}/{len(TAREFAS)} (PDF {p['n']}{p['lado']})", end="", file=sys.stderr, flush=True)
# página sem número impresso (abertura de capítulo): deduz pela vizinha, quando a sequência fecha
for i, p in enumerate(pags):
    if p["impressa"] is None:
        viz = [(j, q["impressa"]) for j, q in enumerate(pags) if q["impressa"] and q["impressa"].isdigit() and abs(j - i) <= 2]
        if viz: j, v = min(viz, key=lambda x: abs(x[0] - i)); p["impressa"] = str(int(v) + (i - j)); p["deduzida"] = True
json.dump({"arquivo": os.path.basename(entrada.rstrip("/")), "paginas": pags}, open(saida, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"\n{saida}: {len(pags)} páginas; OCR em {sum(1 for p in pags if p['fonte'] == 'ocr')}", file=sys.stderr)
