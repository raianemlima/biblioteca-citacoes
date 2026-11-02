// Busca nos livros (BM25 sobre parágrafos, com a página impressa) e sugestão de citações para uma petição.
// Tudo roda no aparelho: nenhum texto sai do navegador.

const STOP = new Set(("a ao aos as ate com como da das de dela dele deles do dos e ela elas ele eles em entre era essa essas esse esses esta estas este estes eu foi foram ha isso isto ja la lhe lhes mais mas me mesmo meu minha muito na nas nao nem no nos nossa nosso num numa o os ou para pela pelas pelo pelos per por qual quando que quem se sem ser seu seus sua suas sao so tambem te tem ter toda todas todo todos tu tua um uma umas uns vos ainda apenas assim cada caso deve devem diz entao esta estao fazer feita feito forma havera pode podem pois porque sera seria sendo sobre sido tal tanto tem tendo ter tera tres dois duas outro outra outros outras qualquer quanto sempre seja sejam tais vez vezes onde qual quais cujo cuja aquele aquela aquilo ali aqui bem modo sentido termos parte partes art arts lei inciso alinea paragrafo caput fls autos excelencia vossa senhor").split(" "));
const tira = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// radical simples: tira plural e algumas terminações; corta em 8 letras (bom o bastante para o português jurídico)
function radical(w) {
  if (w.length > 5) w = w.replace(/(coes|soes)$/, "cao").replace(/(oes|aes|ais|eis|ois)$/, "a").replace(/(es|s)$/, "");
  if (w.length > 6) w = w.replace(/(mente|idade|ivel|avel)$/, "");
  return w.slice(0, 8);
}
// marcas jurídicas viram termos próprios: art. 300 -> §art300, Lei 13.105 -> §lei13105, Súmula 7 -> §sum7, Tema 1234 -> §tema1234
export function marcas(texto) {
  const t = tira(texto), out = [];
  for (const m of t.matchAll(/\bart(?:igo)?s?\.?\s*(\d{1,4})/g)) out.push("§art" + m[1]);
  for (const m of t.matchAll(/\blei(?:\s+complementar)?\s*(?:n[º°o.]*\s*)?(\d{1,2}\.?\d{3})(?:\/\d{2,4})?/g)) out.push("§lei" + m[1].replace(".", ""));
  for (const m of t.matchAll(/\bsumula\s+(vinculante\s+)?(?:n[º°o.]*\s*)?(\d{1,4})/g)) out.push((m[1] ? "§sv" : "§sum") + m[2]);
  for (const m of t.matchAll(/\btema\s+(?:n[º°o.]*\s*)?(\d{1,2}\.\d{3}|\d{1,4})/g)) out.push("§tema" + m[1].replace(".", ""));
  return out;
}
export function termos(texto) {
  const out = [];
  for (const w of tira(texto).split(/[^a-z0-9]+/)) if (w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)) out.push(radical(w));
  return out.concat(marcas(texto));
}

// unidades de busca: parágrafos de cada página; o parágrafo que continua na página seguinte é juntado (p. 45-46)
export function unidades(livro) {
  const out = [], pgs = livro.paginas || [];
  let pend = null;
  pgs.forEach((pg, i) => {
    const pars = String(pg.t || "").split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
    pars.forEach((t, j) => {
      if (pend && j === 0 && /^[a-zà-ú(,;]/.test(t)) { pend.t += " " + t; pend.ps.push(pg.p); pend.fim = i; return; }
      if (pend) out.push(pend), pend = null;
      const u = { livro: livro.id, pi: i, fim: i, ps: [pg.p], t };
      if (j === pars.length - 1 && !/[.!?:;”"…)]$/.test(t)) pend = u; else out.push(u);
    });
  });
  if (pend) out.push(pend);
  return out.filter(u => u.t.length >= 60 && !naoCitavel(u.t));
}
// fora da busca: sumário de capítulo ("Sumário • 1. Conceito... 2.1. ..."), títulos em caixa alta e listas de itens numerados
export function naoCitavel(t) {
  if (/^sum[áa]rio\b/i.test(t)) return true;
  if ((t.match(/\b\d+\.\d+\.?\s/g) || []).length >= 4) return true;
  if ((t.match(/\s[-–•]\s\d{1,2}\.\s/g) || []).length >= 2) return true;   // sumário de capítulo sem o início ("... - 7. Consequência ... - 8. Legitimidade")
  const letras = t.replace(/[^A-Za-zÀ-ú]/g, "");
  return letras.length > 0 && letras === letras.toUpperCase() && t.length < 200;
}

export class Indice {
  constructor() { this.docs = []; this.post = new Map(); this.len = []; this.df = new Map(); }
  adicionar(u) {
    const id = this.docs.length, ts = termos(u.t), tf = new Map();
    for (const w of ts) tf.set(w, (tf.get(w) || 0) + 1);
    for (const [w, n] of tf) { if (!this.post.has(w)) this.post.set(w, []); this.post.get(w).push([id, n]); this.df.set(w, (this.df.get(w) || 0) + 1); }
    this.docs.push(u); this.len.push(ts.length || 1);
  }
  get media() { return this._m ??= this.len.reduce((a, b) => a + b, 0) / (this.len.length || 1); }
  idf(w) { const n = this.docs.length, d = this.df.get(w) || 0; return Math.log(1 + (n - d + .5) / (d + .5)); }
  // consulta = [[termo, peso], ...]; devolve [{doc, s, achados: Set}]
  buscar(consulta, { max = 20, livros = null } = {}) {
    const k1 = 1.2, b = .75, m = this.media, acc = new Map();
    for (const [w, peso] of consulta) {
      const lista = this.post.get(w); if (!lista) continue;
      const idf = this.idf(w) * (w.startsWith("§") ? 2.5 : 1) * (peso || 1);
      for (const [id, tf] of lista) {
        if (livros && !livros.has(this.docs[id].livro)) continue;
        const s = idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * this.len[id] / m));
        const r = acc.get(id) || { doc: this.docs[id], s: 0, achados: new Set() };
        r.s += s; r.achados.add(w); acc.set(id, r);
      }
    }
    return [...acc.values()].sort((a, b) => b.s - a.s).slice(0, max);
  }
  // termos mais característicos de um texto (TF-IDF contra os livros), para montar a consulta
  chave(texto, n = 14) {
    const tf = new Map();
    for (const w of termos(texto)) tf.set(w, (tf.get(w) || 0) + 1);
    return [...tf].filter(([w]) => this.df.has(w)).map(([w, f]) => [w, (1 + Math.log(f)) * this.idf(w) * (w.startsWith("§") ? 3 : 1)])
      .sort((a, b) => b[1] - a[1]).slice(0, n).map(([w, s], i, l) => [w, s / l[0][1]]);
  }
}

export function criarIndice(livros) {
  const ix = new Indice();
  for (const l of livros) for (const u of unidades(l)) ix.adicionar(u);
  return ix;
}

// frases do parágrafo (sem quebrar em "art.", "n.", "p.", "Min." etc.)
export function frases(t) {
  const prot = t.replace(/\b(arts?|n|nº|p|pp|inc|al|min|rel|res|des|dr|dra|sr|sra|v|vol|ed|ob|cit|cf|ex|etc|ss|fls|c\/c|art)\.(?=\s)/gi, m => m.replace(".", "․"));
  // só encerra frase o ponto seguido de espaço e maiúscula: "2.5" e "7.347/1985" ficam inteiros
  return prot.split(/(?<=[.!?…][”"’)]?)\s+(?=[A-ZÀ-Ú“"‘(])/).map(s => s.replace(/․/g, ".").trim()).filter(Boolean);
}
// melhor janela de frases inteiras com os termos da consulta (até ~max caracteres)
export function melhorTrecho(texto, consulta, max = 700) {
  const fs = frases(texto), alvo = new Map(consulta);
  if (texto.length <= max) return { trecho: texto.trim(), inteiro: true };
  const sc = fs.map(f => { const v = new Set(termos(f)); let s = 0; for (const [w, p] of alvo) if (v.has(w)) s += p; return s; });
  let best = { s: -1, i: 0, j: 0 };
  for (let i = 0; i < fs.length; i++) {
    let len = 0, s = 0;
    for (let j = i; j < fs.length; j++) {
      len += fs[j].length + 1; if (len > max && j > i) break;
      s += sc[j];
      if (s > best.s || (s === best.s && j - i < best.j - best.i)) best = { s, i, j };
    }
  }
  return { trecho: fs.slice(best.i, best.j + 1).join(" "), inteiro: best.i === 0 && best.j === fs.length - 1 };
}

// parágrafos da petição que trazem argumento (deixa de fora endereçamento, qualificação, pedidos curtos e fecho)
const FORMAL = /^(excelent[ií]ssim|ao\s+ju[ií]zo|a\s+vossa|termos\s+em\s+que|nestes\s+termos|pede\s+deferimento|local\s+e\s+data|[\w\s]*,\s*\d{1,2}\s+de\s+\w+\s+de\s+\d{4})/i;
// abertura da peça ("A Defensoria Pública ... vem propor a presente ação") também fica de fora
const ABERTURA = /\b(vem|v[eê]m)\b[^;]{0,240}\b(propor|ajuizar|interpor|oferecer|apresentar|impetrar|requerer)\b/i;
export function paragrafosDeArgumento(pars) {
  return pars.map((t, i) => ({ i, t: String(t || "").trim() }))
    .filter(p => p.t.split(/\s+/).length >= 25 && !FORMAL.test(p.t) && !(ABERTURA.test(p.t.slice(0, 400)) && p.t.split(/\s+/).length < 80));
}

// sugestões de citação por parágrafo: até `porParagrafo` trechos de páginas diferentes, com o mínimo de pertinência
export function sugerir(indice, pars, { porParagrafo = 3, livros = null, minTermos = 3 } = {}) {
  const out = [];
  for (const p of paragrafosDeArgumento(pars)) {
    const consulta = indice.chave(p.t);
    if (consulta.length < 3) continue;
    const res = indice.buscar(consulta, { max: 30, livros });
    const melhor = res[0]?.s || 0, sugs = [], paginasUsadas = new Set();
    for (const r of res) {
      const conteudo = [...r.achados].filter(w => !w.startsWith("§")).length, juridico = [...r.achados].some(w => w.startsWith("§"));
      if (r.s < melhor * .45 || (conteudo < minTermos && !(juridico && conteudo >= 2))) continue;
      const chaveP = r.doc.livro + ":" + r.doc.ps.join("-");
      if (paginasUsadas.has(chaveP)) continue;
      paginasUsadas.add(chaveP);
      const { trecho } = melhorTrecho(r.doc.t, consulta);
      sugs.push({ ...r.doc, trecho, s: r.s, achados: [...r.achados] });
      if (sugs.length >= porParagrafo) break;
    }
    if (sugs.length) out.push({ paragrafo: p.i, texto: p.t, consulta, sugestoes: sugs });
  }
  return out;
}

// palavras do trecho que o OCR leu com baixa confiança (para conferir no original antes de citar)
export function duvidasNoTrecho(trecho, livro, pis) {
  const d = new Set(), tt = " " + trecho + " ";
  for (const m of trecho.matchAll(/\S*[«»|¦~^]\S*/g)) d.add(m[0]);   // símbolo que não existe no texto impresso: leitura falhou ali
  for (const i of pis) for (const w of (livro.paginas[i]?.d || [])) if (tt.includes(w)) d.add(w);
  return [...d];
}
