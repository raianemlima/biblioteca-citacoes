"""Junta o texto das páginas (saída do ocr_livro.py) com a referência do livro, no formato que o app lê.

    python3 -I montar_livro.py PAGINAS.json REFERENCIA.json SAIDA.json [--de N]

REFERENCIA.json: {"id": "didier-zaneti-v4-2017", "autores": [{"sobrenome": "Didier Jr.", "prenome": "Fredie"}, ...],
                  "titulo": "Curso de direito processual civil", "subtitulo": "processo coletivo",
                  "edicao": "11. ed. rev., ampl. e atual.", "local": "Salvador", "editora": "JusPodivm", "ano": "2017", "volume": "4"}
Saída: {"id", "ref": {...}, "paginas": [{"p": "32", "t": texto, "n": notas, "d": [dúvidas], "c": confiança}]}
--de N: começa na página N da digitalização (deixa de fora capa, folha de rosto e sumário, que podem ter anotações pessoais).
O texto do livro é material de uso pessoal: este JSON NÃO vai para o Git; só o .bin selado (ferramentas/selar_livro.mjs).
"""
import sys, json
a = sys.argv[1:]
pags, ref, saida = json.load(open(a[0], encoding="utf-8")), json.load(open(a[1], encoding="utf-8")), a[2]
de = int(a[a.index("--de") + 1]) if "--de" in a else 1
eid = ref.pop("id")
out = {"id": eid, "ref": ref, "paginas": []}
for p in pags["paginas"]:
    if p["n"] < de or not p["texto"].strip(): continue
    out["paginas"].append({"p": p["impressa"] or f"[{p['n']}]", "t": p["texto"], "n": p.get("notas", ""), "d": p.get("duvidas", []), "c": p.get("confianca", 100),
                           **({"deduzida": True} if p.get("deduzida") else {})})
json.dump(out, open(saida, "w", encoding="utf-8"), ensure_ascii=False)
sem = sum(1 for p in out["paginas"] if p["p"].startswith("["))
print(f"{saida}: {len(out['paginas'])} páginas{'; ' + str(sem) + ' sem número impresso (aparecem como [n] da digitalização)' if sem else ''}")
