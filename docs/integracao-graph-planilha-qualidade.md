# Planilha da Qualidade (FQ 018) via Microsoft Graph

## Por que mudou

A gravação antiga acontecia no navegador com SheetJS Community: o arquivo inteiro
era reconstruído a cada apontamento e a versão gratuita da biblioteca **não escreve
formatação**. Resultado — a FQ 018 voltava sem tabelas, cores, larguras, formatação
condicional, validação de dados, conexões de dados externas, gráficos e o quadro de
indicadores.

Agora quem insere a linha é o próprio Excel Online, pelo endpoint de workbook do
Microsoft Graph. O arquivo não é reescrito: só a linha nova é adicionada. Formatação,
fórmulas, histórico de versão do SharePoint e a coautoria (planilha aberta por outra
pessoa) continuam funcionando.

## O que precisa ser configurado

### 1. App Registration no Entra ID

1. Portal do Entra → **App registrations** → **New registration**
   - Nome: `Forest Paper — Planilha da Qualidade`
   - Sem redirect URI (é fluxo de aplicativo, sem usuário).
2. **Certificates & secrets** → **New client secret** → copie o *Value*.
3. **API permissions** → **Microsoft Graph** → **Application permissions**:
   - `Sites.Selected` (recomendado) **ou** `Files.ReadWrite.All`.
4. **Grant admin consent**.

`Sites.Selected` não dá acesso a nada sozinho: é preciso liberar o site específico
(uma vez, por um administrador do SharePoint), concedendo permissão `write` do app
sobre o site que hospeda a FQ 018.

> Se o arquivo estiver no **OneDrive pessoal** de alguém (`...-my.sharepoint.com/personal/...`),
> `Sites.Selected` não se aplica e seria preciso `Files.ReadWrite.All`, que dá acesso a
> todos os arquivos do tenant. O recomendado é mover a FQ 018 para uma biblioteca de
> documentos de um site do SharePoint/Teams da Qualidade antes de ligar a integração.

### 2. Segredos no Worker

```sh
wrangler secret put MS_TENANT_ID
wrangler secret put MS_CLIENT_ID
wrangler secret put MS_CLIENT_SECRET
```

### 3. Apontar para o arquivo

Em `wrangler.jsonc`, preencha `QUALITY_WORKBOOK_URL` com o link do arquivo copiado da
barra de endereços do SharePoint (ou de "Copiar link"). O Worker resolve esse link
para `driveId`/`itemId` via `/shares` e guarda em cache.

Alternativa (dispensa o link): definir `QUALITY_WORKBOOK_DRIVE_ID` e
`QUALITY_WORKBOOK_ITEM_ID`.

### 4. Deixar cada aba como Tabela do Excel

Nas abas `Diário`, `Klabin`, `Tubetes` e `Cantoneira`, selecione a área de dados e
use **Formatar como Tabela** (Ctrl+T, com cabeçalhos).

Isso importa: com tabela, a integração usa `tables/rows/add` e o Excel estende a
tabela sozinho — a linha nova herda formatação, fórmulas e validação da coluna. Sem
tabela, o Worker cai para um `PATCH` na primeira linha livre: a linha entra correta,
mas a formatação só acompanha se a faixa já estiver formatada.

## Como o Worker usa

| Rota | Método | Papel | O que faz |
|---|---|---|---|
| `/api/quality/workbook` | GET | qualidade, admin | Diagnóstico: arquivo, abas encontradas, abas faltantes |
| `/api/quality/workbook/rows` | POST | qualidade, admin | Insere `{ record }` na aba correspondente |

A aba é escolhida por `qualitySheetFor()`: `Tubetes`/`Tubeteira` → **Tubetes**,
`Cantoneira` → **Cantoneira**, `Klabin` (ou cliente contendo "klabin") → **Klabin**,
o resto → **Diário**. A ordem das colunas de cada aba está em `qualityRowFor()`,
em [`src/graph-excel.js`](../src/graph-excel.js) — é a única fonte da verdade do layout.

Datas vão como número serial do Excel calculado no fuso `America/Sao_Paulo`: o Worker
roda em UTC e converter o instante direto jogaria os apontamentos do fim do 3º turno
para o dia seguinte.

Toda inserção é registrada no `audit_log` com a ação `quality_workbook_row`.

## Enquanto não estiver configurado

O cartão "Planilha oficial da Qualidade" mostra o motivo e reexibe os botões antigos
(*Conectar planilha* / *Baixar planilha atualizada*) como plano B. **Esse caminho
continua destruindo a formatação** — use só se for inevitável, e nunca salvando por
cima da FQ 018 oficial.

## Se algo falhar

| Mensagem | Causa provável |
|---|---|
| `graph_auth_failed` | Segredo expirado ou `MS_*` errado |
| `graph_forbidden` | Falta o consentimento de admin, ou o site não foi liberado no `Sites.Selected` |
| `graph_not_found` | Link mudou, arquivo movido/renomeado, ou a aba não existe |
| `graph_locked` | Planilha travada para edição no momento — nova tentativa resolve |

O apontamento **nunca se perde** por causa disso: o registro é gravado no D1 primeiro
e a falha aparece como aviso na tela e nos logs (`quality_workbook_error`).
