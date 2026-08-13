# Forest Paper — Portal Operacional e Gerencial

Aplicação corporativa publicada em Cloudflare Workers, com Cloudflare Access,
banco D1 e integração REST direta com o TOTVS Protheus. A integração principal
não depende de Microsoft Graph, Excel ou SharePoint; arquivos Excel são apenas
saídas de relatório ou contingências explícitas.

## Arquitetura atual

1. O site e a API são publicados juntos em um Cloudflare Worker.
2. O Cloudflare Access autentica a identidade antes do acesso.
3. A API transforma o e-mail autenticado em SHA-256 e consulta somente o hash
   no D1. Nenhum e-mail é inserido no HTML ou salvo em texto puro no banco.
4. Jobs agendados consultam o REST GenericQuery do Protheus e atualizam caches D1.
5. As telas consultam o D1; não consultam o Protheus a cada carregamento.
6. Produção, Qualidade, Comercial, Diretoria e Financeiro possuem rotas e regras
   de acesso próprias.

## Pré-requisitos

- Node.js 20 ou superior.
- Conta Cloudflare com Workers, D1 e Access.
- Serviço REST do Protheus disponível por HTTPS.
- Usuário exclusivo de integração com permissão somente de leitura nos aliases
  necessários.

## Instalar e validar

```powershell
npm install
npm run check
npm run test:finance
npm run build
```

## Segredos do Protheus

Nunca coloque credenciais em `wrangler.jsonc`, GitHub, HTML ou documentação.

```powershell
npx wrangler secret put TOTVS_USER --name producao-forest-paper
npx wrangler secret put TOTVS_PASSWORD --name producao-forest-paper
```

Os mesmos secrets precisam ser cadastrados separadamente em cada Worker de
homologação. A Cloudflare não permite ler de volta um secret salvo.

## Banco D1

```powershell
npm run db:migrate:local
npm run db:migrate:remote
```

Antes de aplicar migrações remotas, confirme no arquivo Wrangler se o nome e o
`database_id` apontam para o ambiente correto.

## Cadastrar usuários sem armazenar e-mails

```powershell
npm run user:sql -- "usuario@empresa.com" producao "Nome da pessoa"
```

Papéis disponíveis: `producao`, `qualidade`, `comercial`, `financeiro`,
`diretoria` e `admin`.

Copie o SQL gerado e execute no D1 do ambiente correspondente:

```powershell
npx wrangler d1 execute forest-paper-producao --remote --command "SQL_GERADO"
```

## Publicação

Produção:

```powershell
npm run deploy
```

Painel Financeiro em homologação:

```powershell
npm run db:finance:staging
npm run deploy:finance:staging
```

Não use o comando de produção para homologar o módulo Financeiro. Consulte
[docs/painel-financeiro-contas-a-pagar.md](docs/painel-financeiro-contas-a-pagar.md)
para o checklist de liberação.

## Cloudflare Access

Cada hostname publicado deve ter uma aplicação Access própria ou estar coberto
por uma regra já validada. Uma política Access ampla não substitui o cadastro no
D1: a API também exige um perfil ativo em `user_roles`.

## Desenvolvimento local

Copie `.dev.vars.example` para `.dev.vars` e preencha apenas no computador local.
Esse arquivo nunca deve entrar no Git.

```powershell
npm run db:migrate:local
npm run dev
```

## Segurança operacional

- Não envie planilhas, CSVs, credenciais, tokens ou `.dev.vars` ao GitHub.
- Use apenas HTTPS no endpoint do Protheus.
- Mantenha os usuários de integração com leitura mínima por alias.
- Revise `audit_log`, `sync_runs` e `finance_sync_runs` diante de falhas.
- Valide primeiro em staging e promova para produção somente após aprovação.
