# Biblioteca de citações

Livros de doutrina para citar nas petições, com a página e a referência ABNT. Uso pessoal.

## O que o app faz

- **Petição:** você cola o texto ou envia o Word (.docx). Para cada parágrafo de argumento, o app procura nos livros trechos sobre o mesmo assunto e mostra até 3 sugestões, com a página. Você marca as que quer e baixa a mesma petição com as citações inseridas logo depois dos parágrafos e a lista de **REFERÊNCIAS** no fim. A formatação original do arquivo Word é mantida.
- **Buscar:** busca por palavras em todos os livros.
- **Livros:** leitura por página (a página impressa no livro). Selecione um trecho e toque em "Copiar citação".

A busca é por correspondência de termos (BM25), com peso extra para artigo, lei, súmula e tema citados. Ela roda toda no aparelho: o texto da petição não sai do navegador. Revise cada sugestão, porque a escolha é sua.

## Citação (ABNT)

- **NBR 10520:2023:** sistema autor-data.
  - Citação de até 3 linhas: entre aspas, com a chamada: "…" (Didier Jr.; Zaneti Jr., 2017, p. 32).
  - Citação mais longa: em bloco com recuo de 4 cm, letra menor, espaço simples e sem aspas, depois de "Nesse sentido, lecionam Didier Jr. e Zaneti Jr. (2017, p. 32):".
  - Supressão marcada com [...]; aspas dentro da citação viram aspas simples.
  - Em Ajustes, o sobrenome pode ir em CAIXA ALTA (prática forense) em vez de maiúsculas e minúsculas (NBR 10520:2023).
- **NBR 6023:2018:** DIDIER JR., Fredie; ZANETI JR., Hermes. **Curso de direito processual civil**: processo coletivo. 11. ed. rev., ampl. e atual. Salvador: JusPodivm, 2017. v. 4.

O texto vem da digitalização (OCR). As palavras lidas com baixa confiança e os símbolos estranhos aparecem em "Conferir no livro antes de citar". Confira sempre a passagem no original antes de protocolar.

## Como entra um livro

Tudo roda fora do Git, na pasta `trabalho/`, que é ignorada. Só o `.bin` selado vai para o repositório.

```bash
# 1. texto das páginas: PDF digitalizado ou pasta com as imagens das páginas
python3 -I ferramentas/ocr_livro.py trabalho/livro.pdf trabalho/livro.ocr.json --de 15

# 2. junta com a referência (autores, título, edição, local, editora, ano, volume)
python3 -I ferramentas/montar_livro.py trabalho/livro.ocr.json trabalho/ref.json trabalho/livro.livro.json

# 3. sela com a chave pública (não precisa da senha)
node ferramentas/selar_livro.mjs livros/<id>.bin trabalho/livro.livro.json
```

- **OCR:** Tesseract com o idioma português (`apt install tesseract-ocr tesseract-ocr-por`).
- **Página:** o número vem do cabeçalho ou do rodapé impresso. A abertura de capítulo, sem número, é deduzida pela página vizinha.
- **Limpeza do texto:** cabeçalho corrido, anotações à mão na margem e marcas soltas saem do texto. As notas de rodapé ficam à parte.
- **`--de N`:** deixa de fora capa, folha de rosto e sumário, que podem ter anotações pessoais.

## Segurança

- O repositório é privado, e o texto dos livros só existe cifrado:
  - `livros/*.bin` é selado com a chave pública (`livros/chave-publica.txt`);
  - na publicação, `ferramentas/montar_biblioteca.mjs` abre os selos com o segredo `BIBLIOTECA_SENHA` e grava `dados/biblioteca.enc`, cifrado em AES-GCM com chave PBKDF2 de 600 mil iterações.
- O navegador decifra com a sua senha. "Lembrar neste aparelho" guarda só a chave derivada, sem possibilidade de exportação, no IndexedDB. A senha nunca é gravada.
- A senha fica só no segredo do GitHub (Settings › Secrets and variables › Actions › `BIBLIOTECA_SENHA`).
- Na primeira publicação, o log mostra a chave pública que vai em `livros/chave-publica.txt`.

Citar trechos de obra com a indicação do autor e da fonte é permitido pela Lei 9.610/1998, art. 46, III. Os livros inteiros ficam só aqui, cifrados, para uso pessoal.

## Testes

```bash
npm install && npm test
```
