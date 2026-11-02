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
  const curta = citar("Texto de teste curto para a citação.", ref, ["31"]);
  assert.equal(curta.longa, false);
  assert.equal(curta.texto, "“Texto de teste curto para a citação.” (Didier Jr.; Zaneti Jr., 2017, p. 31).");
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
  // texto fictício, escrito para o teste (nada de livro no repositório)
  { p: "31", t: "Sumário • 1. Noções; 2.1. Origem; 2.2. Modelo; 2.3. Âmbito; 2.4. Controle\n\nTexto de teste: a demanda coletiva protege o grupo quando o direito discutido no processo pertence à coletividade inteira.", d: [] },
  { p: "32", t: "Texto de teste: a legitimação extraordinária também aparece em demandas individuais, como a do art. 18 do CPC, e por isso não basta para qualificar uma demanda como coletiva.\n\nTexto de teste: o elemento que define a demanda é o direito discutido e a proteção do grupo de pessoas que", d: ["qualificar"] },
  { p: "33", t: "detém a titularidade do direito discutido, em posição ativa ou passiva.\n\nTexto de teste: a coisa julgada secundum eventum litis do art. 103 do CDC só beneficia os titulares dos direitos individuais homogêneos.", d: [] },
] };

test("busca: parágrafo que continua na página seguinte vira um trecho só (p. 32-33); sumário e títulos ficam de fora", () => {
  const us = unidades(livro);
  const cont = us.find(u => u.t.includes("o elemento que define"));
  assert.deepEqual(cont.ps, ["32", "33"]); assert.match(cont.t, /grupo de pessoas que detém a titularidade/);
  assert.ok(!us.some(u => /^Sumário/.test(u.t)));
  assert.ok(naoCitavel("1. CONCEITO DE PROCESSO COLETIVO, AÇÃO COLETIVA E TUTELA JURISDICIONAL COLETIVA"));
  assert.ok(naoCitavel("de Fulano - 7. Consequência da falta de legitimação - 8. Legitimidade ativa das Defensorias - 9. Legitimação passiva"));
  assert.ok(!naoCitavel("Texto de teste: a demanda coletiva protege o grupo quando o direito pertence à coletividade."));
});

test("busca: marcas jurídicas e frases sem quebrar abreviaturas e números", () => {
  assert.deepEqual(marcas("art. 103 do CDC, Lei nº 7.347/1985, Súmula 7 e Súmula Vinculante 13, Tema 1.234"), ["§art103", "§lei7347", "§sum7", "§sv13", "§tema1234"]);
  assert.deepEqual(frases("Ver o art. 5º da Lei 7.347/1985. Depois, o item 2.5 trata disso. Fim."), ["Ver o art. 5º da Lei 7.347/1985.", "Depois, o item 2.5 trata disso.", "Fim."]);
  const t = "Primeira frase sem relação nenhuma com o tema. A coisa julgada coletiva segue o regime secundum eventum litis. Terceira frase solta e longa " + "x ".repeat(200);
  assert.equal(melhorTrecho(t, [["julgada", 1], ["coletiv", 1]], 120).trecho, "A coisa julgada coletiva segue o regime secundum eventum litis.");
});

test("petição: só parágrafos de argumento; sugestão pertinente com página; dúvidas do OCR aparecem", () => {
  const pars = ["EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO", "A DEFENSORIA PÚBLICA vem, com fundamento na Lei 7.347/1985, propor a presente AÇÃO CIVIL PÚBLICA contra o Município pelos fatos e fundamentos a seguir expostos nesta petição inicial coletiva.",
    "A legitimação extraordinária da Defensoria Pública não basta para qualificar a demanda como coletiva, porque a legitimação extraordinária aparece também em demandas individuais, como a prevista no art. 18 do CPC.",
    "Termos em que pede deferimento."];
  assert.deepEqual(paragrafosDeArgumento(pars).map(p => p.i), [2]);
  const ix = criarIndice([livro]), s = sugerir(ix, pars);
  assert.equal(s.length, 1); assert.equal(s[0].paragrafo, 2);
  assert.deepEqual(s[0].sugestoes[0].ps, ["32"]); assert.match(s[0].sugestoes[0].trecho, /legitimação extraordinária também aparece em demandas individuais/);
  assert.deepEqual(duvidasNoTrecho(s[0].sugestoes[0].trecho, livro, [1]), ["qualificar"]);
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
