// Word (.docx) sem biblioteca: lê o texto da petição e devolve a mesma petição com as citações e as referências.
// O .docx é um ZIP; o texto fica em word/document.xml. A formatação original é mantida: só entram parágrafos novos.

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------- ZIP ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function inflar(dados) {
  const s = new Blob([dados]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function lerZip(buf) {
  const u = new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = u.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error("O arquivo não é um .docx válido (ZIP não encontrado).");
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
  const arquivos = new Map();
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP corrompido.");
    const metodo = v.getUint16(p + 10, true), comp = v.getUint32(p + 20, true), ln = v.getUint16(p + 28, true), lx = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const nome = dec.decode(u.subarray(p + 46, p + 46 + ln));
    const ini = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), bruto = u.subarray(ini, ini + comp);
    const dados = metodo === 0 ? bruto.slice() : metodo === 8 ? await inflar(bruto) : null;
    if (!dados) throw new Error(`Compressão ${metodo} não suportada em ${nome}.`);
    if (!nome.endsWith("/")) arquivos.set(nome, dados);
    p += 46 + ln + lx + lc;
  }
  return arquivos;
}
export function escreverZip(arquivos) {   // sem compressão (método 0): o Word aceita
  const partes = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [nome, d0] of arquivos) {
    const nm = enc.encode(nome), d = typeof d0 === "string" ? enc.encode(d0) : d0, c = crc32(d);
    const loc = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(nm.length), ...u16(0)]);
    partes.push(loc, nm, d);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += loc.length + nm.length + d.length;
  }
  const tc = central.reduce((s, x) => s + x.length, 0);
  const fim = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(arquivos.size), ...u16(arquivos.size), ...u32(tc), ...u32(off), ...u16(0)]);
  const out = new Uint8Array(off + tc + fim.length); let p = 0;
  for (const x of [...partes, ...central, fim]) { out.set(x, p); p += x.length; }
  return out;
}

// ---------- texto ----------
const parse = xml => new DOMParser().parseFromString(xml, "application/xml");
const filhosW = (el, nome) => [...el.childNodes].filter(n => n.nodeType === 1 && n.localName === nome);
function corpo(doc) { return doc.getElementsByTagNameNS(W, "body")[0]; }
function textoDoParagrafo(p) {
  let t = "";
  for (const n of p.getElementsByTagNameNS(W, "*")) {
    if (n.localName === "t") t += n.textContent;
    else if (n.localName === "tab") t += "\t";
    else if (n.localName === "br") t += "\n";
  }
  return t;
}
// parágrafos do corpo (fora de tabelas), na ordem: é o que a análise usa e o que recebe as citações
export function paragrafosDocx(arquivos) {
  const xml = arquivos.get("word/document.xml");
  if (!xml) throw new Error("O .docx não tem word/document.xml.");
  const doc = parse(dec.decode(xml));
  return filhosW(corpo(doc), "p").map(textoDoParagrafo);
}

// ---------- parágrafos novos ----------
const xesc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
// estilos: "texto" (corpo, recuo de 1ª linha), "longa" (recuo de 4 cm, 10 pt, simples), "titulo" (negrito, centralizado), "ref"
function pXml(estilo, runs) {
  const pPr = {
    texto: '<w:pPr><w:spacing w:before="0" w:after="200" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="1418"/><w:jc w:val="both"/></w:pPr>',
    longa: '<w:pPr><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto"/><w:ind w:left="2268"/><w:jc w:val="both"/></w:pPr>',
    titulo: '<w:pPr><w:keepNext/><w:spacing w:before="480" w:after="240"/><w:jc w:val="center"/></w:pPr>',
    ref: '<w:pPr><w:spacing w:before="0" w:after="240" w:line="240" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>',
  }[estilo];
  const rPr = estilo === "longa" ? '<w:sz w:val="20"/><w:szCs w:val="20"/>' : "";
  return `<w:p xmlns:w="${W}">${pPr}${runs.map(r => `<w:r><w:rPr>${rPr}${r.b ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${xesc(r.t)}</w:t></w:r>`).join("")}</w:p>`;
}
// referência com o título em negrito (destaque da NBR 6023)
function runsReferencia(ref) {
  const m = ref.texto.indexOf(ref.titulo);
  return m < 0 ? [{ t: ref.texto }] : [{ t: ref.texto.slice(0, m) }, { t: ref.titulo, b: true }, { t: ref.texto.slice(m + ref.titulo.length) }];
}
// blocos de uma citação pronta (de abnt.citar): curta = 1 parágrafo; longa = introdução + bloco recuado
export function blocosCitacao(c) {
  return c.longa ? [pXml("texto", [{ t: c.intro }]), pXml("longa", [{ t: c.bloco }])] : [pXml("texto", [{ t: "Nesse sentido: " + c.texto }])];
}
function blocosReferencias(refs) {
  return refs.length ? [pXml("titulo", [{ t: "REFERÊNCIAS", b: true }]), ...refs.map(r => pXml("ref", runsReferencia(r)))] : [];
}

// insere as citações depois dos parágrafos indicados e as referências no fim, mantendo o resto do arquivo
// insercoes: Map(índice do parágrafo -> [citação de abnt.citar]); refs: [{texto, titulo}]
export function inserirNoDocx(arquivos, insercoes, refs) {
  const doc = parse(dec.decode(arquivos.get("word/document.xml"))), body = corpo(doc), ps = filhosW(body, "p");
  const nos = xml => [...parse(`<x xmlns:w="${W}">${xml}</x>`).documentElement.childNodes].map(n => doc.importNode(n, true));
  for (const [i, cits] of [...insercoes].sort((a, b) => b[0] - a[0])) {
    const alvo = ps[i]; if (!alvo) continue;
    let depois = alvo;
    for (const c of cits) for (const x of blocosCitacao(c)) for (const n of nos(x)) { depois.after(n); depois = n; }
  }
  const sect = filhosW(body, "sectPr")[0];
  for (const x of blocosReferencias(refs)) for (const n of nos(x)) body.insertBefore(n, sect || null);
  const novo = new Map(arquivos);
  novo.set("word/document.xml", enc.encode(new XMLSerializer().serializeToString(doc)));
  return escreverZip(novo);
}

// petição colada como texto: monta um .docx novo (A4, Times New Roman 12, margens ABNT 3/2 cm)
export function novoDocx(paragrafos, insercoes, refs) {
  const corpoXml = [];
  paragrafos.forEach((t, i) => {
    corpoXml.push(pXml("texto", [{ t }]));
    for (const c of insercoes.get(i) || []) corpoXml.push(...blocosCitacao(c));
  });
  corpoXml.push(...blocosReferencias(refs));
  const limpa = s => s.replace(/ xmlns:w="[^"]+"/g, "");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${corpoXml.map(limpa).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return escreverZip(new Map([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["word/document.xml", document],
    ["word/styles.xml", styles],
  ]));
}
