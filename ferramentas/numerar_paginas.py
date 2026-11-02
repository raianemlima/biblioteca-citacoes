"""Numeração final das páginas de um livro digitalizado (saída do ocr_livro.py), à prova de digitalização fora de ordem.

    python3 -I numerar_paginas.py LIVRO.ocr.json SAIDA.ocr.json [--pdf LIVRO.pdf] [--min 31 --max 520]

Só fica com número a página em que ele é confirmado pelo contexto:
1. número lido no cabeçalho e confirmado por uma vizinha (n-1/n+1 ou n-2/n+2 nas imagens ao lado);
2. sem número confirmado: com --pdf, relê só o cabeçalho em resolução maior;
3. entre duas páginas confirmadas, a lacuna é preenchida em sequência quando o tamanho bate; se falta exatamente
   uma página, ela é o verso em branco antes de uma abertura de capítulo (página simples, que fica no número ímpar);
4. depois da última confirmada, segue a sequência;
5. folha aberta: a página da direita é a da esquerda + 1 (vale também na emenda de trechos fora de ordem);
6. abertura de capítulo (página simples, "CAPÍTULO N") logo antes de página par: o número ímpar anterior.
Página que continua sem número seguro fica de fora (citação com página errada é pior que nenhuma).
"""
import sys, re, json, os, subprocess, tempfile
from collections import Counter

a = sys.argv[1:]
ent, sai = a[0], a[1]
opt = dict(zip(a[2::2], a[3::2]))
MIN, MAX = int(opt.get("--min", 1)), int(opt.get("--max", 2000))
d = json.load(open(ent, encoding="utf-8")); P = d["paginas"]; N = len(P)
lido = lambda p: int(p["impressa"]) if (p.get("impressa") and str(p["impressa"]).isdigit() and not p.get("deduzida")) else None
r = [lido(p) for p in P]
plaus = lambda x: x is not None and MIN <= x <= MAX

def confirmar():
    c = [False] * N
    for i, x in enumerate(r):
        if not plaus(x): continue
        for k in (1, 2):
            if (i - k >= 0 and r[i - k] == x - k) or (i + k < N and r[i + k] == x + k): c[i] = True
    return c

conf = confirmar()
if "--pdf" in opt:   # releitura do cabeçalho das páginas sem número confirmado
    import pymupdf, numpy as np
    doc = pymupdf.open(opt["--pdf"])
    def vinco(pg):
        pix = pg.get_pixmap(matrix=pymupdf.Matrix(0.2, 0.2), colorspace=pymupdf.csGRAY)
        m = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.stride)[:, :pix.width].astype(float)
        m = m[int(.08 * pix.height):int(.92 * pix.height)]; t = (m < 128).mean(axis=0); w = pix.width; i0, i1 = int(.4 * w), int(.6 * w)
        s = np.convolve(t, np.ones(5) / 5, mode="same"); return (i0 + int(np.argmin(s[i0:i1]))) / w * pg.rect.width
    for i in range(N):
        if conf[i]: continue
        p = P[i]; pg = doc[p["n"] - 1]; R = pg.rect
        x0, x1 = (0, R.width) if not p.get("lado") else ((0, vinco(pg)) if p["lado"] == "e" else (vinco(pg), R.width))
        f = tempfile.mktemp(suffix=".png")
        pg.get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=pymupdf.Rect(x0, 0, x1, R.height * .16), colorspace=pymupdf.csGRAY).save(f)
        txt = subprocess.run(["tesseract", f, "-", "-l", "por", "--psm", "6"], capture_output=True, text=True).stdout; os.remove(f)
        for l in txt.splitlines():
            if re.search(r"CURSO|PROCESSUAL|Cap|COLETIV|Vol|Didier|Zaneti|INTRODU|PROCESSO", l, re.I):
                m = re.match(r"^\W{0,3}(\d{2,3})\b", l) or re.search(r"\b(\d{2,3})\W{0,3}$", l)
                if m: r[i] = int(m.group(1)); break
    conf = confirmar()

final = [r[i] if conf[i] else None for i in range(N)]
como = ["lido" if conf[i] else "" for i in range(N)]
casa = lambda ri, c: ri is not None and (ri == c or (ri < 100 and c % 100 == ri) or (ri >= 100 and ri % 100 == c % 100 and abs(ri - c) <= 60))
i = 0
while i < N:
    if final[i] is not None: i += 1; continue
    j = i
    while j < N and final[j] is None: j += 1
    idx, ant, pos = list(range(i, j)), i - 1, (j if j < N else None)
    if ant < 0 and pos is not None:                                   # antes da 1ª confirmada
        for t, x in enumerate(reversed(idx)): final[x] = final[pos] - 1 - t; como[x] = "sequência"
    elif pos is None:                                                 # depois da última
        for t, x in enumerate(idx): final[x] = final[ant] + 1 + t; como[x] = "sequência"
    else:
        m, k = final[pos] - final[ant] - 1, len(idx)
        if m == k:
            for t, x in enumerate(idx): final[x] = final[ant] + 1 + t; como[x] = "lacuna"
        elif m == k + 1:   # falta uma: verso em branco antes da abertura de capítulo (página simples em número ímpar)
            opc = []
            for s in range(m):
                ns = [final[ant] + 1 + t for t in range(m) if t != s]
                sc = 2 * sum(casa(r[x], n) for x, n in zip(idx, ns)) + sum(1 for x, n in zip(idx, ns) if not P[x].get("lado") and n % 2 == 1)
                opc.append((sc, ns))
            opc.sort(key=lambda t: -t[0])
            if len(opc) == 1 or opc[0][0] > opc[1][0]:
                for x, n in zip(idx, opc[0][1]): final[x] = n; como[x] = "lacuna com verso em branco"
    i = j

# 5. folha aberta: a página da direita é a da esquerda + 1 (e vice-versa), mesmo na emenda de trechos fora de ordem
# 6. abertura de capítulo (página simples) logo antes de página par confirmada da esquerda: número ímpar anterior
for _ in range(2):
    for i in range(N):
        if final[i] is not None: continue
        p = P[i]
        if p.get("lado") == "d" and i > 0 and P[i - 1]["n"] == p["n"] and final[i - 1]: final[i] = final[i - 1] + 1; como[i] = "folha aberta"
        elif p.get("lado") == "e" and i + 1 < N and P[i + 1]["n"] == p["n"] and final[i + 1]: final[i] = final[i + 1] - 1; como[i] = "folha aberta"
        elif not p.get("lado") and i + 1 < N and final[i + 1] and final[i + 1] % 2 == 0 and P[i + 1].get("lado") == "e" and re.search(r"CAP[IÍ]TULO", p["texto"][:200], re.I):
            final[i] = final[i + 1] - 1; como[i] = "abertura de capítulo"
rep = {k for k, v in Counter(x for x in final if x).items() if v > 1}
fora = [i for i in range(N) if final[i] is None or final[i] in rep]
for i, p in enumerate(P):
    p["impressa"] = str(final[i]) if final[i] and final[i] not in rep else None
    p["numeracao"] = como[i]; p.pop("deduzida", None)
d["paginas"] = [p for i, p in enumerate(P) if i not in set(fora)]
json.dump(d, open(sai, "w", encoding="utf-8"), ensure_ascii=False)
tem = sorted(int(p["impressa"]) for p in d["paginas"])
faltam = [x for x in range(tem[0], tem[-1] + 1) if x not in set(tem)]
print(f"{sai}: {len(d['paginas'])} páginas numeradas (p. {tem[0]} a {tem[-1]}); {len(fora)} sem número seguro (fora); "
      f"sem imagem na digitalização: {faltam}; {dict(Counter(como))}")
