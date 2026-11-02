// Livros "selados" com a senha da biblioteca: no repositório só há texto cifrado e uma chave pública.
//
// Da senha (segredo BIBLIOTECA_SENHA) sai, por PBKDF2, um par de chaves X25519. Só a chave PÚBLICA fica no
// repositório (livros/chave-publica.txt): com ela se sela um livro (selar_livro.mjs) sem saber a senha; só
// a publicação, que tem a senha, abre (montar_biblioteca.mjs). PBKDF2-SHA-256 com
// 600 mil iterações.
//
// Formato do .bin selado: "BCX1" | chave pública efêmera (32) | iv (12) | AES-256-GCM(gzip(JSON)).
// A chave do AES sai de HKDF-SHA-256(segredo X25519, sal = efêmera || pública, info = INFO).
//
// Uso direto (mostra a chave pública da senha): BIBLIOTECA_SENHA=... node ferramentas/selo.mjs
import { createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { fileURLToPath } from "node:url";

export const MAGICA = Buffer.from("BCX1");
const SAL = "biblioteca-citacoes/livros/x25519/v1", ITERACOES = 600000, INFO = "biblioteca-citacoes livros v1";
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex"), SPKI = Buffer.from("302a300506032b656e032100", "hex");

const publicaDe = raw => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: "der", type: "spki" });
const rawDe = chavePublica => Buffer.from(chavePublica.export({ format: "jwk" }).x, "base64url");
function chaveAes(segredo, efemera, publica) {
  return Buffer.from(hkdfSync("sha256", segredo, Buffer.concat([efemera, publica]), INFO, 32));
}

export function parDaSenha(senha) {
  const d = pbkdf2Sync(String(senha), SAL, ITERACOES, 32, "sha256");
  const privada = createPrivateKey({ key: Buffer.concat([PKCS8, d]), format: "der", type: "pkcs8" });
  return { privada, publica: rawDe(createPublicKey(privada)) };
}

export const ehSelado = buf => buf.length > 48 && buf.subarray(0, 4).equals(MAGICA);

export function selar(publicaB64, dados) {
  const publica = Buffer.from(String(publicaB64).trim(), "base64");
  if (publica.length !== 32) throw new Error("chave pública inválida (precisa ter 32 bytes em base64)");
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const efemera = rawDe(publicKey);
  const k = chaveAes(diffieHellman({ privateKey, publicKey: publicaDe(publica) }), efemera, publica), iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv), ct = Buffer.concat([c.update(dados), c.final(), c.getAuthTag()]);
  return Buffer.concat([MAGICA, efemera, iv, ct]);
}

export function abrir(par, buf) {
  const efemera = buf.subarray(4, 36), iv = buf.subarray(36, 48), ct = buf.subarray(48, buf.length - 16), tag = buf.subarray(buf.length - 16);
  const k = chaveAes(diffieHellman({ privateKey: par.privada, publicKey: publicaDe(efemera) }), efemera, par.publica);
  const d = createDecipheriv("aes-256-gcm", k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.BIBLIOTECA_SENHA) { console.error("Defina BIBLIOTECA_SENHA."); process.exit(1); }
  console.log(parDaSenha(process.env.BIBLIOTECA_SENHA).publica.toString("base64"));
}
