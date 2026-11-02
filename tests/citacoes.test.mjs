import test from "node:test";
import assert from "node:assert/strict";
import { citar, referencia, chamada, paginas, listaReferencias, limparTrecho } from "../app/abnt.js";
import { criarIndice, sugerir, unidades, frases, melhorTrecho, marcas, naoCitavel, paragrafosDeArgumento, duvidasNoTrecho } from "../app/busca.js";

const ref = { autores: [{ sobrenome: "Didier Jr.", prenome: "Fredie" }, { sobrenome: "Zaneti Jr.", prenome: "Hermes" }], titulo: "Curso de direito processual civil",
  subtitulo: "processo coletivo", edicao: "11. ed. rev., ampl. e atual.", local: "Salvador", editora: "JusPodivm", ano: "2017", volume: "4" };

test("ABNT: chamada autor-data, páginas e caixa alta opcional", () => {
  assert.equal(paginas(["32"]), "p. 32"); assert.equal(paginas(["32", "33"]), "p. 32-33"); assert.equal(paginas([]), "");
  assert.equal(chamada(ref, ["32"]), "(Didier Jr.; Zaneti Jr., 2017, p. 32)");
  assert.equal(chamada(ref, ["32"], { caixaAlta: true }), "(DIDIER JR.; ZANETI JR., 2017, p. 32)");
  const quatro = { ...ref, autores: [1, 2, 3, 4].map(i => ({ sobrenome: "Autor" + i, prenome: "X" })) };
  assert.equal(chamada(quatro, ["1"]), "(Autor1 et al., 2017, p. 1)");
});

test("ABNT: citação curta entre aspas; longa em bloco com recuo e introdução", () => {
  const curta = citar("O processo é coletivo se a relação jurídica litigiosa é coletiva.", ref, ["31"]);
  assert.equal(curta.longa, false);
  assert.equal(curta.texto, "“O processo é coletivo se a relação jurídica litigiosa é coletiva.” (Didier Jr.; Zaneti Jr., 2017, p. 31).");
  const longa = citar("a".repeat(300), ref, ["32", "33"]);
  assert.equal(longa.longa, true);
  assert.equal(longa.intro, "Nesse sentido, lecionam Didier Jr. e Zaneti Jr. (2017, p. 32-33):");
  assert.match(longa.html, /margin-left:4cm;font-size:10pt/);
  assert.equal(limparTrecho("diz “ação coletiva” aqui"), "diz ‘ação coletiva’ aqui", "aspas internas viram simples");
});

test("ABNT: referência NBR 6023 com título em destaque e lista sem repetição", () => {
  const r = referencia(ref);
  assert.equal(r.texto, "DIDIER JR., Fredie; ZANETI JR., Hermes. Curso de direito processual civil: processo coletivo. 11. ed. rev., ampl. e atual. Salvador: JusPodivm, 2017. v. 4.");
  assert.match(r.html, /<b>Curso de direito processual civil<\/b>/);
  assert.equal(referencia({ ...ref, edicao: "3", volume: "" }).texto, "DIDIER JR., Fredie; ZANETI JR., Hermes. Curso de direito processual civil: processo coletivo. 3. ed. Salvador: JusPodivm, 2017.");
  assert.equal(referencia({ ...ref, edicao: "1" }).texto.includes("ed."), false, "1ª edição não se indica");
  assert.equal(listaReferencias([ref, ref]).length, 1);
});

const livro = { id: "l1", ref, paginas: [
  { p: "31", t: "Sumário • 1. Conceito de processo coletivo; 2.1. Generalidades; 2.2. Modelo; 2.3. Interesse; 2.4. Controle\n\nO processo é coletivo se a relação jurídica litigiosa é coletiva. Uma relação jurídica é coletiva se em um de seus termos houver um grupo como sujeito.", d: [] },
  { p: "32", t: "Em primeiro lugar, a legitimidade extraordinária não é uma exclusividade dos processos coletivos, pois há casos de legitimação extraordinária individual em todos os ordenamentos, como a do art. 18 do CPC.\n\nObserve-se que o núcleo do conceito de processo coletivo está em seu objeto litigioso e na tutela do grupo de pessoas que", d: ["exclusividade"] },
  { p: "33", t: "tem a titularidade da situação jurídica coletiva, ativa ou passiva.\n\nO regime da coisa julgada secundum eventum litis do art. 103 do CDC beneficia os titulares dos direitos individuais homogêneos.", d: [] },
] };

test("busca: parágrafo que continua na página seguinte vira um trecho só (p. 32-33); sumário e títulos ficam de fora", () => {
  const us = unidades(livro);
  const cont = us.find(u => u.t.startsWith("Observe-se"));
  assert.deepEqual(cont.ps, ["32", "33"]); assert.match(cont.t, /grupo de pessoas que tem a titularidade/);
  assert.ok(!us.some(u => /^Sumário/.test(u.t)));
  assert.ok(naoCitavel("1. CONCEITO DE PROCESSO COLETIVO, AÇÃO COLETIVA E TUTELA JURISDICIONAL COLETIVA"));
  assert.ok(!naoCitavel("O processo é coletivo se a relação jurídica litigiosa é coletiva, segundo a doutrina majoritária."));
});

test("busca: marcas jurídicas e frases sem quebrar abreviaturas e números", () => {
  assert.deepEqual(marcas("art. 103 do CDC, Lei nº 7.347/1985, Súmula 7 e Súmula Vinculante 13, Tema 1.234"), ["§art103", "§lei7347", "§sum7", "§sv13", "§tema1234"]);
  assert.deepEqual(frases("Ver o art. 5º da Lei 7.347/1985. Depois, o item 2.5 trata disso. Fim."), ["Ver o art. 5º da Lei 7.347/1985.", "Depois, o item 2.5 trata disso.", "Fim."]);
  const t = "Primeira frase sem relação nenhuma com o tema. A coisa julgada coletiva segue o regime secundum eventum litis. Terceira frase solta e longa " + "x ".repeat(200);
  assert.equal(melhorTrecho(t, [["julgada", 1], ["coletiv", 1]], 120).trecho, "A coisa julgada coletiva segue o regime secundum eventum litis.");
});

test("petição: só parágrafos de argumento; sugestão pertinente com página; dúvidas do OCR aparecem", () => {
  const pars = ["EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO", "A DEFENSORIA PÚBLICA vem, com fundamento na Lei 7.347/1985, propor a presente AÇÃO CIVIL PÚBLICA contra o Município pelos fatos e fundamentos a seguir expostos nesta petição inicial coletiva.",
    "A legitimidade extraordinária da Defensoria Pública não transforma o processo em coletivo, porque a legitimação extraordinária não é exclusividade dos processos coletivos e existe também em casos individuais previstos no art. 18 do CPC.",
    "Termos em que pede deferimento."];
  assert.deepEqual(paragrafosDeArgumento(pars).map(p => p.i), [2]);
  const ix = criarIndice([livro]), s = sugerir(ix, pars);
  assert.equal(s.length, 1); assert.equal(s[0].paragrafo, 2);
  assert.deepEqual(s[0].sugestoes[0].ps, ["32"]); assert.match(s[0].sugestoes[0].trecho, /legitimidade extraordinária não é uma exclusividade/);
  assert.deepEqual(duvidasNoTrecho(s[0].sugestoes[0].trecho, livro, [1]), ["exclusividade"]);
  assert.deepEqual(duvidasNoTrecho("art 103 « da.", livro, []), ["«"]);
});

test("repositório: livros/ só tem selos e a chave pública; nada de texto em claro", async () => {
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const pasta = new URL("../livros/", import.meta.url);
  if (!existsSync(pasta)) return;
  for (const f of readdirSync(pasta)) {
    assert.ok(/\.bin$|^chave-publica\.txt$|^sal\.txt$/.test(f), `${f} não pode estar em livros/`);
    if (f.endsWith(".bin")) assert.equal(readFileSync(new URL(f, pasta)).subarray(0, 4).toString(), "BCX1", `${f} selado`);
  }
  const ign = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  for (const p of ["trabalho/", "*.pdf", "*.livro.json", "dados/"]) assert.ok(ign.includes(p), `.gitignore sem ${p}`);
});
