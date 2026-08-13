# Forest Paper — Produção, Qualidade e Diretoria

Aplicação corporativa preparada para Cloudflare Workers, banco D1, Cloudflare
Access e sincronização agendada de um Excel armazenado no SharePoint.

## Arquitetura

1. O site e a API são publicados juntos em um Cloudflare Worker.
2. O Cloudflare Access autentica a conta corporativa antes do acesso.
3. A API transforma o e-mail autenticado em SHA-256 e consulta somente o hash
   no D1. Nenhum e-mail é colocado no HTML ou salvo no banco.
4. Um Cron Trigger executa a sincronização do Excel a cada três horas.
5. O Worker baixa o arquivo pelo Microsoft Graph, lê a planilha e atualiza o D1.
6. Campos do ERP e campos do fluxo de produção/qualidade ficam separados.

## Pré-requisitos

- Node.js 20 ou superior.
- Conta Cloudflare com Workers e D1.
- Aplicação registrada no Microsoft Entra com permissão de leitura no local do
  Excel e consentimento do administrador.
- `PedidodeVenda.xlsx` em uma biblioteca corporativa do SharePoint. Evite
  depender do OneDrive pessoal de um funcionário.

## 1. Instalar e validar

```powershell
npm install
npm run check
npm run build
```

## 2. Criar o banco D1

```powershell
npx wrangler login
npm run db:create
```

Copie o `database_id` retornado para `wrangler.jsonc`, substituindo o identificador
provisório `00000000-0000-0000-0000-000000000000`. Depois aplique a estrutura:

```powershell
npm run db:migrate:remote
```

## 3. Configurar o caminho do Excel

Em `wrangler.jsonc`, substitua `GRAPH_FILE_PATH` pelo caminho Microsoft Graph
do arquivo. Exemplo para uma biblioteca do SharePoint:

```text
/sites/{site-id}/drives/{drive-id}/root:/Integracoes/PedidodeVenda.xlsx:/content
```

O Worker procura primeiro uma aba chamada `Consulta1`. Se esse for apenas o
nome da tabela e a aba possuir outro nome, altere `SYNC_SHEET` para o nome real
da aba.

## 4. Cadastrar os segredos

Nunca coloque os valores em `wrangler.jsonc`, no GitHub ou no HTML.

```powershell
npx wrangler secret put MS_TENANT_ID
npx wrangler secret put MS_CLIENT_ID
npx wrangler secret put MS_CLIENT_SECRET
```

## 5. Cadastrar usuários sem armazenar e-mails

Gere o SQL contendo somente o hash da identidade:

```powershell
npm run user:sql -- "usuario@empresa.com" producao "Nome da pessoa"
```

Papéis aceitos:

- `producao`: inicia e conclui produção, mantém máquinas e força sincronização.
- `qualidade`: inicia inspeção, libera ou devolve pedidos e mantém apontamentos.
- `diretoria`: acesso somente para leitura e consulta da auditoria.

Copie o SQL gerado e execute no D1:

```powershell
npx wrangler d1 execute forest-paper-producao --remote --command "SQL_GERADO"
```

## 6. Publicar

```powershell
npm run deploy
```

O Cron Trigger `0 */3 * * *` usa UTC e executa a cada três horas.

## 7. Proteger com Cloudflare Access

No Cloudflare Zero Trust:

1. Adicione o Microsoft Entra como provedor de identidade.
2. Crie uma aplicação Access do tipo Self-hosted para o domínio do portal.
3. Crie uma política `Allow` apenas para o domínio ou grupo corporativo.
4. Proteja o domínio principal, o endereço `workers.dev` e eventuais previews.
5. Teste com um usuário cadastrado e outro não cadastrado.

Mesmo que uma política Access seja ampla, a API exige que o hash do usuário
exista em `user_roles` e esteja ativo.

## Desenvolvimento local

Copie `.dev.vars.example` para `.dev.vars`, preencha apenas no computador local
e nunca envie esse arquivo ao Git:

```powershell
npm run db:migrate:local
npm run dev
```

## Segurança operacional

- Não envie planilhas, CSVs, credenciais ou `.dev.vars` ao GitHub.
- Revogue e substitua imediatamente qualquer segredo exposto.
- Use permissões Microsoft Graph limitadas ao site/biblioteca necessária.
- Renove o segredo do Entra antes do vencimento.
- Revise `audit_log` e `sync_runs` em caso de comportamento inesperado.
- Configure alertas de uso no Cloudflare.
