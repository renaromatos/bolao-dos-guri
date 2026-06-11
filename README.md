# Bolão dos Guri

Site para bolão da Copa do Mundo entre amigos, pronto para hospedar na Vercel com dados persistidos em Postgres.

## Funcionalidades

- Cadastro e login com nome e senha.
- Sessão por token armazenada no navegador.
- Jogos do dia e seleção por data.
- Calendário carregado de uma fonte pública da Copa 2026.
- Palpite de placar por jogo.
- Bloqueio de palpites quando o jogo começa.
- Empate em eliminatórias com escolha do vencedor nos penais.
- Empate na fase de grupos sem penais.
- Lançamento de resultados com PIN de admin.
- Ranking compartilhado entre todos os usuários.

## Pontuação

- Acerto do vencedor/resultado: 1 ponto.
- Acerto do placar exato: 3 pontos.

Quando o placar exato é acertado, ele vale 3 pontos no total.

## Banco de dados

Use um Postgres. No Vercel, a opção mais simples é criar um banco Neon pelo Marketplace e copiar a variável `DATABASE_URL`.

As tabelas são criadas automaticamente na primeira chamada da API. O SQL também está em `db/schema.sql` para inspeção ou execução manual.

Variáveis de ambiente necessárias:

```text
DATABASE_URL=postgres://...
ADMIN_PIN=um-pin-para-lancar-resultados
```

Para Postgres local sem SSL, adicione:

```text
POSTGRES_DISABLE_SSL=true
```

## Como rodar local

Instale as dependências:

```powershell
npm install
```

Crie `.env.local` com `DATABASE_URL` e `ADMIN_PIN`.

Rode com Vercel Dev, para que as funções `/api/*` funcionem:

```powershell
npm run dev
```

Depois acesse `http://localhost:5173`.

## Deploy na Vercel

1. Suba o projeto para o GitHub.
2. Importe o repositório na Vercel.
3. Adicione um banco Postgres e configure `DATABASE_URL`.
4. Configure `ADMIN_PIN`.
5. Faça o deploy.

Os jogos ficam em `data/matches.json`.

## Fonte dos jogos

Por padrão, o site busca o calendário em:

```text
https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
```

A fonte é o projeto público `openfootball/worldcup.json`, sem API key. O app converte os horários para BRT e usa `data/matches.json` como fallback se a fonte externa falhar.

Variáveis opcionais:

```text
MATCHES_API_URL=https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
MATCHES_CACHE_MS=3600000
```
