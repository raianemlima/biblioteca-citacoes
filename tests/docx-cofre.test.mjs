import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { lerZip, escreverZip, paragrafosDocx, inserirNoDocx, novoDocx, crc32 } from "../app/docx.js";
import { cifrar, abrir } from "../app/cofre.js";
import { citar, listaReferencias } from "../app/abnt.js";
import { deflateRawSync } from "node:zlib";

const { window } = new JSDOM("");
globalThis.DOMParser = window.DOMParser; globalThis.XMLSerializer = window.XMLSerializer;
const ref = { autores: [{ sobrenome: "Didier Jr.", prenome: "Fredie" }], titulo: "Curso de direito processual civil", ano: "2017", local: "Salvador", editora: "JusPodivm", volume: "4" };
const dec = new TextDecoder();

test("ZIP: escreve e lê de volta (inclusive entradas comprimidas, como as do Word)", async () => {
  const z = escreverZip(new Map([["a.txt", "olá"], ["b/c.xml", "<x/>"]]));
  const lido = await lerZip(z);
  assert.equal(dec.decode(lido.get("a.txt")), "olá"); assert.equal(dec.decode(lido.get("b/c.xml")), "<x/>");
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xCBF43926);
  // entrada com deflate (método 8), montada à mão
  const d = new TextEncoder().encode("texto comprimido ".repeat(20)), c = deflateRawSync(d), nome = new TextEncoder().encode("w.xml");
  const u16 = n => [n & 255, n >> 8 & 255], u32 = n => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24 & 255], crc = crc32(d);
  const loc = [...u32(0x04034b50), ...u16(20), 0, 0, ...u16(8), 0, 0, 0, 0, ...u32(crc), ...u32(c.length), ...u32(d.length), ...u16(nome.length), 0, 0];
  const cen = [...u32(0x02014b50), ...u16(20), ...u16(20), 0, 0, ...u16(8), 0, 0, 0, 0, ...u32(crc), ...u32(c.length), ...u32(d.length), ...u16(nome.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(0)];
  const off = loc.length + nome.length + c.length, fim = [...u32(0x06054b50), 0, 0, 0, 0, ...u16(1), ...u16(1), ...u32(cen.length + nome.length), ...u32(off), 0, 0];
  const zip = new Uint8Array([...loc, ...nome, ...c, ...cen, ...nome, ...fim]);
  assert.equal(dec.decode((await lerZip(zip)).get("w.xml")), "texto comprimido ".repeat(20));
});

test("Word: lê os parágrafos e devolve a petição com as citações depois do parágrafo certo e as referências no fim", async () => {
  const pars = ["Endereçamento", "Primeiro argumento sobre processo coletivo.", "Pedido final."];
  const base = await lerZip(novoDocx(pars, new Map(), []));
  assert.deepEqual(paragrafosDocx(base), pars);
  const ins = new Map([[1, [citar("Trecho curto do livro.", ref, ["32"]), citar("b".repeat(300), ref, ["33"])]]]);
  const saida = await lerZip(inserirNoDocx(base, ins, listaReferencias([ref])));
  const ps = paragrafosDocx(saida);
  assert.deepEqual(ps.slice(0, 2), pars.slice(0, 2));
  assert.equal(ps[2], "Nesse sentido: “Trecho curto do livro.” (Didier Jr., 2017, p. 32).");
  assert.equal(ps[3], "Nesse sentido, leciona Didier Jr. (2017, p. 33):");
  assert.match(ps[4], /^b{300}\.$/);
  assert.equal(ps[5], "Pedido final.");
  assert.equal(ps[6], "REFERÊNCIAS");
  assert.equal(ps[7], "DIDIER JR., Fredie. Curso de direito processual civil. Salvador: JusPodivm, 2017. v. 4.");
  const xml = dec.decode(saida.get("word/document.xml"));
  assert.match(xml, /w:left="2268"/, "citação longa com recuo de 4 cm");
  assert.match(xml, /<w:b\/><\/w:rPr><w:t xml:space="preserve">Curso de direito processual civil</, "título em negrito na referência");
  assert.ok(xml.indexOf("REFERÊNCIAS") < xml.indexOf("<w:sectPr"), "referências antes das configurações da seção");
});

test("cofre: só abre com a senha certa", async () => {
  const arq = await cifrar("senha-certa", { livros: [{ id: "x" }] }, { it: 1000 });
  assert.deepEqual((await abrir("senha-certa", arq)).dados, { livros: [{ id: "x" }] });
  await assert.rejects(abrir("errada", arq));
  assert.ok(!JSON.stringify(arq).includes("livros"));
});

test("cofre: livro grande (vários MB) cifra e abre", async () => {
  const grande = { livros: [{ id: "g", paginas: Array.from({ length: 600 }, (_, i) => ({ p: String(i), t: ("palavra" + i + " ").repeat(400) })) }] };
  const arq = await cifrar("s", grande, { it: 1000 });
  assert.equal((await abrir("s", arq)).dados.livros[0].paginas.length, 600);
});
