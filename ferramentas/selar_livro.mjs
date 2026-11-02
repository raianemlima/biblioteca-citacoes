// Sela um livro (JSON do montar_livro.py) com a chave pública da biblioteca, para ir ao repositório sem texto legível.
// Uso: node ferramentas/selar_livro.mjs livros/<id>.bin livro.json
// Não precisa de senha: usa livros/chave-publica.txt. Só a publicação (com BIBLIOTECA_SENHA) abre.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { selar } from "./selo.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const [saida, entrada] = process.argv.slice(2);
if (!saida || !entrada) { console.error("Uso: node selar_livro.mjs livros/<id>.bin livro.json"); process.exit(1); }
const publica = (process.env.CHAVE_PUBLICA || readFileSync(join(raiz, "livros", "chave-publica.txt"), "utf8")).trim();
const livro = JSON.parse(readFileSync(entrada, "utf8"));
if (!livro.id || !livro.ref?.titulo || !livro.ref?.ano || !Array.isArray(livro.paginas) || !livro.paginas.length) { console.error("Livro sem id, referência (título e ano) ou páginas."); process.exit(1); }
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, selar(publica, gzipSync(Buffer.from(JSON.stringify(livro)), { level: 9 })));
console.log(`${saida}: ${livro.id} (${livro.paginas.length} páginas) selado`);
