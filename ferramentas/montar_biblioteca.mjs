// Publicação: abre os livros selados (livros/*.bin) com a senha e grava a biblioteca cifrada que o app lê.
// Uso (GitHub Actions): BIBLIOTECA_SENHA=... node ferramentas/montar_biblioteca.mjs _site/dados/biblioteca.enc
// Teste local, sem selar:  BIBLIOTECA_SENHA=... node ferramentas/montar_biblioteca.mjs saida.enc --json livro1.json livro2.json
// O sal fica em livros/sal.txt (não é segredo): com o mesmo sal, quem marcou "lembrar neste aparelho" continua entrando.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parDaSenha, ehSelado, abrir } from "./selo.mjs";
import { cifrar } from "../app/cofre.js";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const [saida, ...resto] = process.argv.slice(2), senha = process.env.BIBLIOTECA_SENHA;
if (!saida) { console.error("Uso: node montar_biblioteca.mjs saida.enc [--json livro.json ...]"); process.exit(1); }
if (!senha) { console.log("::warning::Segredo BIBLIOTECA_SENHA não configurado: a biblioteca não foi montada."); process.exit(0); }
const par = parDaSenha(senha);
console.log(`chave pública da biblioteca (vai em livros/chave-publica.txt): ${par.publica.toString("base64")}`);
let livros = [];
if (resto[0] === "--json") livros = resto.slice(1).map(f => JSON.parse(readFileSync(f, "utf8")));
else {
  const pasta = join(raiz, "livros");
  for (const f of (existsSync(pasta) ? readdirSync(pasta) : []).filter(f => f.endsWith(".bin")).sort()) {
    const buf = readFileSync(join(pasta, f));
    if (!ehSelado(buf)) { console.log(`::warning::${f} não está selado: ficou de fora.`); continue; }
    try { livros.push(JSON.parse(gunzipSync(abrir(par, buf)).toString("utf8"))); }
    catch { console.log(`::warning::${f} não abre com a senha atual: sele de novo com a chave pública acima. Ficou de fora.`); }
  }
}
const salArq = join(raiz, "livros", "sal.txt");
const sal = existsSync(salArq) ? Uint8Array.from(Buffer.from(readFileSync(salArq, "utf8").trim(), "base64")) : null;
const arq = await cifrar(senha, { gerado: new Date().toISOString().slice(0, 10), livros }, { sal });
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, JSON.stringify(arq));
console.log(`ok: ${livros.length} livro(s), ${livros.reduce((s, l) => s + l.paginas.length, 0)} páginas em ${saida}`);
