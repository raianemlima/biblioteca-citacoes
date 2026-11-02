// Biblioteca de citações: busca nos livros, leitura por página e citações ABNT prontas para a petição.
import { citar, referencia, listaReferencias, chamada, paginas as fmtPaginas } from "./abnt.js";
import { criarIndice, sugerir, melhorTrecho, termos, duvidasNoTrecho } from "./busca.js";
import { lerZip, paragrafosDocx, inserirNoDocx, novoDocx } from "./docx.js";
import { abrir, abrirComChave, chaveLembrada, lembrarChave, esquecerChave } from "./cofre.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const PREF = (() => { try { return JSON.parse(localStorage.getItem("bc-pref") || "{}"); } catch { return {}; } })();
const salvarPref = () => { try { localStorage.setItem("bc-pref", JSON.stringify(PREF)); } catch { /* sem armazenamento */ } };
const E = { livros: [], porId: new Map(), indice: null, aba: "peticao", pet: null, leitor: null };
const opcoes = () => ({ caixaAlta: !!PREF.caixaAlta });

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2200);
}
async function copiar(c) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([c.html], { type: "text/html" }), "text/plain": new Blob([c.texto], { type: "text/plain" }) })]);
  } catch {
    try { await navigator.clipboard.writeText(c.texto); } catch { prompt("Copie o texto:", c.texto); return; }
  }
  toast("Copiado. Cole na petição.");
}
const nomeCurto = l => `${(l.ref.autores || []).map(a => a.sobrenome).join("; ") || l.ref.titulo} (${l.ref.ano})${l.ref.volume ? " · v. " + l.ref.volume : ""}`;
const citacaoDe = (s, trecho) => citar(trecho, E.porId.get(s.livro).ref, s.ps, opcoes());

// destaca no trecho as palavras que casaram com a busca
function destacar(texto, achados) {
  const alvo = new Set(achados);
  return esc(texto).replace(/[A-Za-zÀ-ú0-9]{3,}/g, w => (termos(w).some(t => alvo.has(t)) ? `<mark>${w}</mark>` : w));
}
// capítulo da página (livro.capitulos = [[n, título, página inicial]]) e novidades de edição posterior para ele
function capituloDe(l, p) {
  const n = parseInt(p, 10); if (!l.capitulos || !Number.isFinite(n)) return null;
  let c = null; for (const x of l.capitulos) if (x[2] <= n) c = x; return c;
}
const novidades = (l, cap) => (l.atualizacoes?.itens || []).filter(x => cap && x.caps.includes(cap[0]));
function avisoNovidades(l, cap, aberto = false) {
  const its = novidades(l, cap); if (!its.length) return "";
  return `<details class="novidade"${aberto ? " open" : ""}><summary>↻ Capítulo ${cap[0]} atualizado em edição posterior: confira antes de citar</summary>${its.map(x => `<p>${esc(x.texto)}</p>`).join("")}<p class="sub">${esc(l.atualizacoes.fonte)}</p></details>`;
}
function cartaoTrecho(s, i, extra = "") {
  const l = E.porId.get(s.livro), duv = duvidasNoTrecho(s.trecho, l, range(s.pi, s.fim)), cap = capituloDe(l, s.ps[0]);
  return `<div class="sug" data-sug="${i}">
    <div class="sug-cab"><b>${esc(nomeCurto(l))}</b><span>${esc(fmtPaginas(s.ps))}</span></div>
    ${cap ? `<p class="cap">Cap. ${cap[0]} · ${esc(cap[1])}</p>` : ""}
    <p class="trecho">${destacar(s.trecho, s.achados || [])}</p>
    ${duv.length ? `<p class="aviso">⚠ Conferir no livro antes de citar (leitura incerta): ${duv.slice(0, 6).map(esc).join(", ")}</p>` : ""}
    ${avisoNovidades(l, cap)}
    <div class="acoes">${extra}<button class="btn" data-copiar="${i}">Copiar citação</button><button class="btn leve" data-ver="${i}">Ver página</button></div>
  </div>`;
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

// ---------------- abas ----------------
function render() {
  document.querySelectorAll("[data-aba]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.aba === E.aba)));
  ({ peticao: telaPeticao, buscar: telaBuscar, livros: telaLivros })[E.aba]();
}

// ---------------- Petição ----------------
function telaPeticao() {
  const P = E.pet;
  $("#main").innerHTML = `
    <section class="cartao">
      <h2>Citações para a petição</h2>
      <p class="sub">Cole o texto ou envie o Word (.docx). Para cada parágrafo de argumento, o app procura nos livros trechos sobre o mesmo assunto e monta a citação ABNT com a página. Tudo é feito no seu aparelho.</p>
      <textarea id="petTexto" rows="7" placeholder="Cole aqui o texto da petição…">${esc(P?.origem === "texto" ? P.paragrafos.join("\n\n") : "")}</textarea>
      <div class="linha">
        <label class="btn arquivo"><input type="file" id="petArq" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">📄 Enviar Word (.docx)</label>
        <span class="nome-arq" id="petNome">${P?.origem === "docx" ? "📄 " + esc(P.nome) : ""}</span>
        <button class="btn primario" id="petBuscar">Encontrar citações</button>
      </div>
    </section>
    <div id="petRes">${P ? resultadosPeticao() : ""}</div>`;
  $("#petArq").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const zip = await lerZip(await f.arrayBuffer());
      E.pet = { origem: "docx", nome: f.name, zip, paragrafos: paragrafosDocx(zip), sugs: null, usar: new Set() };
      $("#petNome").textContent = "📄 " + f.name; $("#petTexto").value = ""; analisar();
    } catch (e) { toast(e.message || "Não consegui ler o arquivo."); }
  };
  $("#petBuscar").onclick = () => {
    const t = $("#petTexto").value.trim();
    if (t) E.pet = { origem: "texto", nome: "peticao", paragrafos: t.split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean), sugs: null, usar: new Set() };
    if (!E.pet) return toast("Cole o texto ou envie o arquivo .docx.");
    analisar();
  };
  ligarResultados();
}
function analisar() {
  const P = E.pet;
  P.sugs = sugerir(E.indice, P.paragrafos, { porParagrafo: 3 });
  P.lista = P.sugs.flatMap(g => g.sugestoes.map(s => ({ ...s, paragrafo: g.paragrafo })));
  P.usar = new Set(P.sugs.map(g => P.lista.findIndex(s => s.paragrafo === g.paragrafo)));   // a melhor de cada parágrafo já vem marcada
  telaPeticao();
  $("#petRes")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
function resultadosPeticao() {
  const P = E.pet;
  if (!P.sugs) return "";
  if (!P.sugs.length) return `<section class="cartao vazio"><b>Nenhum trecho dos livros trata dos assuntos desta petição.</b><p class="sub">A busca compara as palavras de cada parágrafo de argumento com o texto dos livros. Tente a aba Buscar com os termos principais.</p></section>`;
  let k = 0;
  const grupos = P.sugs.map(g => `<article class="arg">
      <header><span class="chip">Parágrafo ${g.paragrafo + 1}</span><small>${g.sugestoes.length} ${g.sugestoes.length === 1 ? "trecho" : "trechos"}</small></header>
      <blockquote class="pet">${esc(g.texto.length > 320 ? g.texto.slice(0, 320) + "…" : g.texto)}</blockquote>
      ${g.sugestoes.map(() => { const i = k++, s = P.lista[i]; return cartaoTrecho(s, i, `<label class="usar"><input type="checkbox" data-usar="${i}" ${P.usar.has(i) ? "checked" : ""}> Inserir</label>`); }).join("")}
    </article>`).join("");
  return `<p class="resumo">${P.sugs.length} ${P.sugs.length === 1 ? "parágrafo com citação sugerida" : "parágrafos com citação sugerida"} de ${P.paragrafos.length}. Revise cada trecho: a sugestão é por assunto, a escolha é sua.</p>${grupos}
    <div class="barra" id="petBarra"><span id="petConta"></span><button class="btn" id="petRefs">Copiar referências</button><button class="btn primario" id="petBaixar">Baixar petição com citações (.docx)</button></div>`;
}
function ligarResultados() {
  const P = E.pet; if (!P?.sugs) return;
  const conta = () => { const n = P.usar.size; $("#petConta").textContent = `${n} ${n === 1 ? "citação marcada" : "citações marcadas"}`; $("#petBaixar").disabled = !n; };
  conta();
  document.querySelectorAll("[data-usar]").forEach(c => c.onchange = () => { const i = +c.dataset.usar; c.checked ? P.usar.add(i) : P.usar.delete(i); conta(); });
  ligarTrechos(P.lista);
  $("#petRefs").onclick = () => {
    const refs = listaReferencias([...P.usar].map(i => E.porId.get(P.lista[i].livro).ref));
    if (!refs.length) return toast("Marque ao menos uma citação.");
    copiar({ texto: "REFERÊNCIAS\n\n" + refs.map(r => r.texto).join("\n\n"), html: `<p style="text-align:center"><b>REFERÊNCIAS</b></p>${refs.map(r => `<p>${r.html}</p>`).join("")}` });
  };
  $("#petBaixar").onclick = () => {
    const ins = new Map();
    for (const i of [...P.usar].sort((a, b) => a - b)) { const s = P.lista[i]; if (!ins.has(s.paragrafo)) ins.set(s.paragrafo, []); ins.get(s.paragrafo).push(citacaoDe(s, s.trecho)); }
    const refs = listaReferencias([...P.usar].map(i => E.porId.get(P.lista[i].livro).ref));
    const bytes = P.origem === "docx" ? inserirNoDocx(P.zip, ins, refs) : novoDocx(P.paragrafos, ins, refs);
    // nome sem acento: alguns navegadores trocam por "download" o nome com caracteres especiais
    const nome = P.nome.replace(/\.docx$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w .-]+/g, "_") + " - com citacoes.docx";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    a.download = nome; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Petição com citações baixada.");
  };
}
function ligarTrechos(lista) {
  document.querySelectorAll("[data-copiar]").forEach(b => b.onclick = () => { const s = lista[+b.dataset.copiar]; copiar(citacaoDe(s, s.trecho)); });
  document.querySelectorAll("[data-ver]").forEach(b => b.onclick = () => { const s = lista[+b.dataset.ver]; abrirLeitor(s.livro, s.pi, s.t.slice(0, 60)); });
}

// ---------------- Buscar ----------------
function telaBuscar() {
  $("#main").innerHTML = `<section class="cartao"><h2>Buscar nos livros</h2>
      <form id="bForm" class="linha"><input type="search" id="bQ" placeholder="Ex.: legitimidade extraordinária no processo coletivo" value="${esc(E.q || "")}" aria-label="Buscar nos livros"><button class="btn primario">Buscar</button></form></section>
    <div id="bRes"></div>`;
  const vai = () => {
    E.q = $("#bQ").value.trim(); if (!E.q) return;
    const consulta = [...new Set(termos(E.q))].map(w => [w, 1]);
    const res = E.indice.buscar(consulta, { max: 25 });
    E.blista = res.map(r => ({ ...r.doc, trecho: melhorTrecho(r.doc.t, consulta, 650).trecho, achados: [...r.achados] }));
    $("#bRes").innerHTML = E.blista.length ? `<p class="resumo">${E.blista.length} trechos</p>` + E.blista.map((s, i) => cartaoTrecho(s, i)).join("") : `<p class="sub">Nada encontrado com essas palavras.</p>`;
    ligarTrechos(E.blista);
  };
  $("#bForm").onsubmit = ev => { ev.preventDefault(); vai(); };
  if (E.q) vai();
}

// ---------------- Livros (leitura por página) ----------------
function telaLivros() {
  if (E.leitor) return telaLeitor();
  $("#main").innerHTML = `<section class="cartao"><h2>Livros</h2><p class="sub">Leia por página. Selecione um trecho e toque em “Copiar citação”: a página vai certa na citação.</p></section>
    ${E.livros.map(l => { const r = referencia(l.ref); return `<article class="livro"><p class="ref">${r.html}</p><p class="sub">${l.paginas.length} páginas convertidas · p. ${esc(l.paginas[0]?.p)} a ${esc(l.paginas.at(-1)?.p)}</p>
      ${l.capitulos ? `<details class="caps"><summary>Capítulos</summary><ol>${l.capitulos.map(c => `<li value="${c[0]}"><button class="lnk" data-cap="${esc(l.id)}:${c[2]}">${esc(c[1])}</button> <small>p. ${c[2]}</small>${novidades(l, c).length ? ' <small class="nov">↻ atualizado</small>' : ""}</li>`).join("")}</ol></details>` : ""}
      ${l.atualizacoes ? `<details class="novidade"><summary>↻ Novidades da edição posterior</summary>${l.atualizacoes.itens.map(x => `<p>${x.caps.length ? `<b>Cap. ${x.caps.join(", ")}:</b> ` : ""}${esc(x.texto)}</p>`).join("")}<p class="sub">${esc(l.atualizacoes.fonte)}</p></details>` : ""}
      <div class="acoes"><button class="btn primario" data-abrir="${esc(l.id)}">Ler</button><button class="btn" data-ref="${esc(l.id)}">Copiar referência</button></div></article>`; }).join("")}`;
  document.querySelectorAll("[data-abrir]").forEach(b => b.onclick = () => abrirLeitor(b.dataset.abrir, 0));
  document.querySelectorAll("[data-cap]").forEach(b => b.onclick = () => { const [id, p] = b.dataset.cap.split(":"), l = E.porId.get(id); abrirLeitor(id, Math.max(0, l.paginas.findIndex(x => parseInt(x.p, 10) >= +p))); });
  document.querySelectorAll("[data-ref]").forEach(b => b.onclick = () => copiar(referencia(E.porId.get(b.dataset.ref).ref)));
}
function abrirLeitor(id, pi, foco) { E.leitor = { id, pi, foco }; E.aba = "livros"; render(); }
function telaLeitor() {
  const { id, pi } = E.leitor, l = E.porId.get(id), pg = l.paginas[pi], cap = capituloDe(l, pg.p);
  $("#main").innerHTML = `<button class="btn leve" id="lVolta">← Livros</button>
    <section class="cartao leitor">
      <p class="ref">${referencia(l.ref).html}</p>
      <div class="linha nav-pag"><button class="btn" id="lAnt" ${pi ? "" : "disabled"}>‹</button>
        <label>Página <select id="lPag">${l.paginas.map((p, i) => `<option value="${i}" ${i === pi ? "selected" : ""}>${esc(p.p)}</option>`).join("")}</select></label>
        <button class="btn" id="lProx" ${pi < l.paginas.length - 1 ? "" : "disabled"}>›</button></div>
      ${cap ? `<p class="cap">Cap. ${cap[0]} · ${esc(cap[1])}</p>` : ""}
      ${avisoNovidades(l, cap)}
      ${pg.c < 85 ? `<p class="aviso">⚠ Página com leitura menos precisa (${pg.c}%): confira no livro antes de citar.</p>` : ""}
      <div class="texto" id="lTexto">${pg.t.split(/\n{2,}/).map(t => `<p>${esc(t)}</p>`).join("")}</div>
      ${pg.n ? `<details class="notas"><summary>Notas de rodapé</summary><p>${esc(pg.n).replace(/\n/g, "<br>")}</p></details>` : ""}
      <p class="sub">${pg.deduzida ? "Número da página deduzido pela vizinha (abertura de capítulo sem número impresso)." : ""}</p>
    </section>
    <button class="btn primario flutua" id="lCitar" hidden>Copiar citação</button>`;
  const vai = i => { E.leitor = { id, pi: i }; telaLeitor(); window.scrollTo(0, 0); };
  $("#lVolta").onclick = () => { E.leitor = null; render(); };
  $("#lAnt").onclick = () => vai(pi - 1); $("#lProx").onclick = () => vai(pi + 1);
  $("#lPag").onchange = ev => vai(+ev.target.value);
  if (E.leitor.foco) { const alvo = [...$("#lTexto").children].find(p => p.textContent.includes(E.leitor.foco.slice(0, 40))); if (alvo) { alvo.classList.add("alvo"); alvo.scrollIntoView({ block: "center" }); } E.leitor.foco = null; }
  const btn = $("#lCitar");
  document.onselectionchange = () => {
    const sel = document.getSelection(), t = sel ? sel.toString().trim() : "";
    btn.hidden = !(t.length > 15 && $("#lTexto")?.contains(sel.anchorNode));
  };
  btn.onclick = () => {
    const t = document.getSelection().toString().trim();
    copiar(citar(t, l.ref, [pg.p], opcoes()));
  };
}

// ---------------- entrada ----------------
async function carregar(dados) {
  E.livros = dados.livros || []; E.porId = new Map(E.livros.map(l => [l.id, l]));
  E.indice = criarIndice(E.livros);
  $("#trava").hidden = true; $("#app").hidden = false;
  $("#cont").textContent = `${E.livros.length} ${E.livros.length === 1 ? "livro" : "livros"} · ${E.livros.reduce((s, l) => s + l.paginas.length, 0)} páginas`;
  render();
}
async function iniciar() {
  document.querySelectorAll("[data-aba]").forEach(b => b.onclick = () => { E.aba = b.dataset.aba; if (E.aba !== "livros") E.leitor = null; render(); window.scrollTo(0, 0); });
  $("#caixaAlta").checked = !!PREF.caixaAlta;
  $("#caixaAlta").onchange = ev => { PREF.caixaAlta = ev.target.checked; salvarPref(); toast(PREF.caixaAlta ? "Sobrenome em CAIXA ALTA nas citações" : "Sobrenome em maiúsculas e minúsculas (NBR 10520:2023)"); };
  $("#sair").onclick = async () => { await esquecerChave(); location.reload(); };
  let arq;
  try { arq = await (await fetch("dados/biblioteca.enc", { cache: "no-cache" })).json(); }
  catch { $("#tMsg").textContent = "A biblioteca ainda não foi publicada ou não abriu. Tente de novo com internet."; return; }
  const lembrada = await chaveLembrada(arq.s);
  if (lembrada) { try { return carregar(await abrirComChave(lembrada, arq)); } catch { await esquecerChave(); } }
  $("#tForm").onsubmit = async ev => {
    ev.preventDefault(); $("#tMsg").textContent = "Abrindo…";
    try {
      const { dados, chave } = await abrir($("#tSenha").value, arq);
      if ($("#tLembrar").checked) await lembrarChave(chave, arq.s);
      carregar(dados);
    } catch { $("#tMsg").textContent = "Senha incorreta."; }
  };
}
iniciar();
