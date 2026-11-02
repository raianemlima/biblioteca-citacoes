// Biblioteca cifrada: o texto dos livros só abre com a senha (AES-GCM 256, chave por PBKDF2-SHA-256).
// Arquivo: {"v": 1, "it": 600000, "s": sal, "iv": iv, "ct": gzip(JSON) cifrado} — tudo em base64.
// "Lembrar neste aparelho" guarda só a chave derivada, não exportável, no IndexedDB (a senha nunca é gravada).

const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const sub = () => globalThis.crypto.subtle;

export async function derivar(senha, sal, it) {
  const base = await sub().importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveKey"]);
  return sub().deriveKey({ name: "PBKDF2", salt: sal, iterations: it, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function comprime(bytes, modo) {
  const s = new Blob([bytes]).stream().pipeThrough(modo === "c" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export async function cifrar(senha, dados, { it = 600000, sal = null } = {}) {
  const s = sal || globalThis.crypto.getRandomValues(new Uint8Array(16)), iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const chave = await derivar(senha, s, it);
  const ct = await sub().encrypt({ name: "AES-GCM", iv }, chave, await comprime(new TextEncoder().encode(JSON.stringify(dados)), "c"));
  return { v: 1, it, s: b64(s), iv: b64(iv), ct: b64(ct) };
}
export async function abrirComChave(chave, arq) {
  const pt = await sub().decrypt({ name: "AES-GCM", iv: unb64(arq.iv) }, chave, unb64(arq.ct));
  return JSON.parse(new TextDecoder().decode(await comprime(new Uint8Array(pt), "d")));
}
export async function abrir(senha, arq) {
  const chave = await derivar(senha, unb64(arq.s), arq.it);
  return { dados: await abrirComChave(chave, arq), chave };
}

// ---- chave lembrada (IndexedDB) ----
function banco() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open("biblioteca-citacoes", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("chaves");
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
}
export async function lembrarChave(chave, sal) {
  try { const db = await banco(); await new Promise((ok, e) => { const t = db.transaction("chaves", "readwrite"); t.objectStore("chaves").put({ chave, sal }, "atual"); t.oncomplete = ok; t.onerror = () => e(t.error); }); } catch { /* sem IndexedDB: só não lembra */ }
}
export async function chaveLembrada(sal) {
  try {
    const db = await banco();
    const v = await new Promise((ok, e) => { const r = db.transaction("chaves").objectStore("chaves").get("atual"); r.onsuccess = () => ok(r.result); r.onerror = () => e(r.error); });
    return v && v.sal === sal ? v.chave : null;
  } catch { return null; }
}
export async function esquecerChave() {
  try { const db = await banco(); db.transaction("chaves", "readwrite").objectStore("chaves").delete("atual"); } catch { /* nada */ }
}
