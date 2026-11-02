// Citação e referência no padrão ABNT (NBR 10520:2023 para citações, NBR 6023:2018 para referências).
// ref = { autores: [{ sobrenome: "Didier Jr.", prenome: "Fredie" }], titulo, subtitulo, edicao, local, editora, ano, volume }
// paginas = ["45"] ou ["45", "46"] (números impressos no livro)

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const LIMITE_CURTA = 270;   // ~3 linhas de texto em A4, fonte 12

// "45" | "45-46" | "45-47" (páginas em sequência viram intervalo)
export function paginas(ps) {
  const l = [...new Set((ps || []).filter(Boolean).map(String))];
  if (!l.length) return "";
  return l.length === 1 ? `p. ${l[0]}` : `p. ${l[0]}-${l[l.length - 1]}`;
}

// sobrenome na chamada: NBR 10520:2023 usa maiúsculas e minúsculas; a prática forense ainda usa CAIXA ALTA
const formaSobrenome = (s, o = {}) => o.caixaAlta ? String(s).toLocaleUpperCase("pt-BR") : String(s);

export function autoresChamada(ref, o = {}) {
  const a = ref.autores || [];
  if (!a.length) return formaSobrenome(primeiraPalavra(ref.titulo), o) + "…";
  if (a.length > 3) return `${formaSobrenome(a[0].sobrenome, o)} et al.`;
  return a.map(x => formaSobrenome(x.sobrenome, o)).join("; ");
}
function autoresNoTexto(ref, o = {}) {
  const a = ref.autores || [];
  if (a.length > 3) return `${formaSobrenome(a[0].sobrenome, o)} et al.`;
  const n = a.map(x => formaSobrenome(x.sobrenome, o));
  return n.length > 1 ? n.slice(0, -1).join(", ") + " e " + n[n.length - 1] : n[0] || "";
}
const primeiraPalavra = t => String(t || "").split(/\s+/)[0].toLocaleUpperCase("pt-BR");

// (Sobrenome, 2020, p. 45)
export function chamada(ref, ps, o = {}) {
  const p = paginas(ps);
  return `(${autoresChamada(ref, o)}, ${ref.ano}${p ? ", " + p : ""})`;
}

// texto citado: espaços normalizados e aspas internas viram aspas simples (citação dentro de citação)
export function limparTrecho(t) {
  return String(t || "").replace(/\s+/g, " ").trim().replace(/[“”"]/g, m => (m === "”" ? "’" : "‘")).replace(/‘([^‘’]*)‘/g, "‘$1’");
}

// verbo de introdução no singular ou plural, conforme o número de autores
const leciona = ref => ((ref.autores || []).length > 1 ? "lecionam" : "leciona");

// citação direta: até ~3 linhas no corpo do texto, entre aspas; acima disso, em bloco com recuo de 4 cm, letra menor, sem aspas
export function citar(trecho, ref, ps, o = {}) {
  const t = limparTrecho(trecho), limite = o.limite || LIMITE_CURTA;
  const longa = t.length > limite;
  const ch = chamada(ref, ps, o), p = paginas(ps);
  if (!longa) {
    const texto = `“${t}” ${ch}.`;
    return { longa, texto, html: `<p>“${esc(t)}” ${esc(ch)}.</p>`, intro: "", bloco: texto };
  }
  const intro = `Nesse sentido, ${leciona(ref)} ${autoresNoTexto(ref, o)} (${ref.ano}${p ? ", " + p : ""}):`;
  const final = /[.!?…]$/.test(t) ? t : t + ".";
  return {
    longa, intro, bloco: final,
    texto: `${intro}\n\n${final}`,
    html: `<p>${esc(intro)}</p><p style="margin-left:4cm;font-size:10pt;line-height:1.0;text-align:justify">${esc(final)}</p>`,
  };
}

// referência (NBR 6023): SOBRENOME, Prenome. Título: subtítulo. 2. ed. Local: Editora, ano. v. 4.
export function referencia(ref) {
  const a = ref.autores || [];
  const nomes = (a.length > 3 ? a.slice(0, 1) : a).map(x => `${String(x.sobrenome).toLocaleUpperCase("pt-BR")}${x.prenome ? ", " + x.prenome : ""}`).join("; ") + (a.length > 3 ? " et al." : "");
  // edição: "11" -> "11. ed."; texto completo ("11. ed. rev., ampl. e atual.") vai como está; 1ª edição não se indica
  const ed = !ref.edicao || String(ref.edicao) === "1" ? "" : /ed\./.test(ref.edicao) ? `${ref.edicao} ` : `${ref.edicao}. ed. `;
  const sub = ref.subtitulo ? `: ${ref.subtitulo}` : "";
  const imp = [ref.local || "[S. l.]", ref.editora || "[s. n.]"].join(": ");
  const vol = ref.volume ? ` v. ${ref.volume}.` : "";
  const inicio = nomes ? `${nomes}. ` : "";
  const texto = `${inicio}${ref.titulo}${sub}. ${ed}${imp}, ${ref.ano}.${vol}`.replace(/\.\./g, ".");
  const html = `${esc(inicio)}<b>${esc(ref.titulo)}</b>${esc(sub)}. ${esc(ed)}${esc(imp)}, ${esc(ref.ano)}.${esc(vol)}`.replace(/\.\./g, ".");
  return { texto, html, titulo: ref.titulo };
}

// lista de referências em ordem alfabética, sem repetir
export function listaReferencias(refs) {
  const vistos = new Map();
  for (const r of refs) { const x = referencia(r); vistos.set(x.texto, x); }
  return [...vistos.values()].sort((a, b) => a.texto.localeCompare(b.texto, "pt"));
}
