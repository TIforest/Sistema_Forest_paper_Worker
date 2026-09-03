# Contexto do projeto — Portal Forest Paper

Atualizado em: 21/08/2026  
Aplicação: Portal Operacional e Gerencial Forest Paper  
Worker de produção: `producao-forest-paper`  
URL: `https://producao-forest-paper.tiforest.workers.dev`  
Última versão conhecida ao gerar este arquivo: `06088d70-e0e6-43d8-adad-b62b73a02012`

## Como usar este arquivo

Este documento deve ser colocado na aba **Projetos** do assistente que dará manutenção ao sistema. Ele é contexto, não substitui a inspeção dos arquivos atuais.

Antes de alterar qualquer coisa:

1. leia `README.md`, `SECURITY.md`, `wrangler.jsonc` e as migrations;
2. inspecione o código atual — o projeto pode ter mudanças posteriores a este documento;
3. preserve modificações existentes e não use comandos destrutivos de Git;
4. nunca revele, copie ou grave senhas, tokens, PINs, cookies ou e-mails no frontend;
5. execute as verificações antes de publicar;
6. informe o Version ID após cada deploy.

## Objetivo

O portal unifica informações e rotinas de:

- Produção;
- Qualidade;
- operadores e tablets;
- turnos e desempenho de máquinas;
- Diretoria;
- Gestão Comercial;
- Contas a Pagar/Financeiro.

O sistema é usado por unidades e pessoas em redes e estados diferentes. Dados compartilhados e estados operacionais devem ficar no Cloudflare D1. `localStorage` serve somente para preferências e rascunhos de interface.

## Arquitetura

- Frontend: HTML, CSS e JavaScript sem framework, principalmente em `app.html`.
- Build: `scripts/build.mjs` valida segurança e copia `app.html` para `dist/index.html`.
- Backend: Cloudflare Worker em `src/worker.js` e módulos auxiliares.
- Banco: Cloudflare D1, binding `DB`, database `forest-paper-producao`.
- Proteção externa: Cloudflare Access.
- Integração ERP: REST GenericQuery do TOTVS Protheus, sempre pelo Worker.
- Relatórios: exportação XLSX no navegador.
- Assets: ícones e fonte Mabry Pro em `assets/`.

Arquivos principais:

| Arquivo | Responsabilidade |
|---|---|
| `app.html` | Interface, estilos, filtros, dashboards e exportações |
| `src/worker.js` | Entrada da API, autenticação, Produção/Qualidade e crons |
| `src/protheus.js` | GenericQuery de SC5/SC6, SF2/SD2 e enriquecimentos |
| `src/commercial.js` | Cache, regras e API da Gestão Comercial |
| `src/protheus-finance.js` | GenericQuery de SE2/SC7 para Financeiro |
| `src/finance.js` | Cache, cálculos e endpoints financeiros |
| `src/admin.js` | Usuários, operadores, tablets e administração |
| `src/operator.js` | Portal dedicado de operadores e PIN |
| `migrations/` | Evolução imutável do schema D1 |
| `wrangler.jsonc` | Configuração oficial do Worker de produção |
| `wrangler.staging.jsonc` | Ambiente de homologação financeira |

Não edite `dist/` manualmente.

## Cloudflare

Configuração atual de produção:

- Worker: `producao-forest-paper`;
- D1: `forest-paper-producao`;
- assets estáticos em `dist/`;
- Worker executado primeiro em `/api/*` e `/operador/api/*`;
- observabilidade, logs e traces ativados;
- sincronização financeira: `*/15 * * * *`;
- sincronização comercial: `7,37 * * * *`.

Os crons são desencontrados para evitar pico simultâneo de CPU.

Segredos necessários e já cadastrados no Worker:

- `TOTVS_USER`;
- `TOTVS_PASSWORD`;
- `OPERATOR_PIN_PEPPER`.

Nunca tente ler ou incluir esses valores em arquivos. Cada ambiente Cloudflare tem seu próprio conjunto de secrets.

## Autenticação e perfis

O Cloudflare Access autentica a identidade. O Worker calcula SHA-256 do e-mail normalizado e procura o hash em `user_roles`. Não armazenar e-mail puro no D1 nem no HTML.

Perfis:

- `admin`: administração completa;
- `producao`: pedidos da máquina vinculada e operação produtiva;
- `qualidade`: inspeção e liberação;
- `comercial`: Gestão Comercial e Excel;
- `financeiro`: Contas a Pagar;
- `diretoria`: Comercial, Financeiro, Diretoria e Turnos.

Usuário sem perfil ativo não deve cair automaticamente como Diretoria.

### Tablets de Produção

O fluxo de operador é separado do login Microsoft:

- dispositivo autorizado;
- operador com máquina e PIN;
- PIN armazenado somente como hash forte;
- cookies seguros, HttpOnly e SameSite;
- sessão limitada;
- backend filtra pedidos pela máquina, não apenas o frontend.

## Integração TOTVS

Base REST configurada no Worker:

`https://forestpaper145392.protheus.cloudtotvs.com.br:1857/rest`

Endpoint utilizado:

`/api/framework/v1/genericQuery`

Aliases:

- pedidos: SC5 e SC6;
- faturamento: SF2 e SD2;
- clientes: SA1;
- produtos: SB1;
- vendedores: SA3;
- condições de pagamento: SE4;
- contas a pagar: SE2;
- pedidos de compra: SC7;
- fornecedores: SA2.

Regras obrigatórias:

- todas as consultas devem usar `D_E_L_E_T_ <> '*'` em cada alias;
- credenciais nunca chegam ao navegador;
- condição de pagamento 32 é excluída do fluxo comercial;
- consultas são paginadas;
- falha de enriquecimento não deve apagar a consulta principal;
- não somar total de nota uma vez por item; deduplicar por filial/documento/série;
- notas canceladas e devoluções são gravadas com `registro_tipo` e deduzidas do faturamento gerencial,
  aparecendo no quadro **Devoluções** e no Excel;
- não reintroduzir SF1 no faturamento sem decisão formal — a fonte atual é SF2/SD2.

## Unidades e toneladas

Campos oficiais:

- pedido: `C6_UM`, com fallback em `B1_UM`;
- faturamento: `D2_UM`, com fallback em `B1_UM`.

Conversão para exibição do painel:

- TON/T/TN: mantém o valor;
- KG/KGS/KILO/QUILOGRAMA: divide por 1.000;
- G/GR/GRAMA: divide por 1.000.000;
- qualquer outra unidade (UN, PC, CX, MIL, M2, em branco): não soma tonelagem, apenas valor em reais.

O Excel deve manter unidade e quantidade originais do Protheus e pode incluir uma coluna adicional com toneladas calculadas. Não substituir a quantidade original pela convertida.

## Gestão Comercial

Ao abrir o painel:

- mês e dia começam na data atual;
- relógio acompanha o horário atual;
- todas as filiais, clientes e condições começam selecionados;
- filtros antigos do navegador não devem limitar a abertura inicial;
- o horário da última sincronização deve continuar sendo o horário real, nunca um valor simulado.

Filtros disponíveis:

- mês;
- dia específico;
- intervalo `De:` / `Até:` (tem precedência sobre mês e dia);
- filiais em checklist;
- clientes em checklist;
- condições de pagamento em checklist;
- busca.

### Unidade de Negócios

É o primeiro quadro gerencial. Para cada unidade, exibir:

- toneladas pedidas;
- pedidos a faturar;
- toneladas faturadas;
- valor faturado;
- toneladas pedidas + toneladas faturadas;
- pedidos a faturar + valor faturado.

Quando mais de uma filial estiver selecionada, apresentar também o total das filiais.

Filiais:

- `010101`: Forest Paper Matriz;
- `020101`: Revita;
- `040101`: Forest Espírito Santo.

Na visão gerencial, `040101` é consolidada com `010101`. O Excel preserva a filial original.

### Total do Grupo

Exibir separadamente e também consolidado:

- toneladas pedidas;
- pedidos a faturar;
- toneladas faturadas;
- valor faturado;
- toneladas pedidas + faturadas;
- carteira/pedidos a faturar + valor faturado.

O total inclui o fluxo comercial comum e a Industrialização Klabin.

### IPI

Somente pedidos das filiais `010101` e `040101` recebem o fator gerencial de IPI:

`valor do pedido × 1,0325`

Não aplicar esse fator à filial `020101`.

### Klabin

Qualquer cadastro cujo nome contenha `KLABIN` pertence exclusivamente à Industrialização:

- não entra no fluxo comercial comum;
- não soma nos pedidos, faturamento, toneladas ou carteira comuns;
- continua excluindo condição 32;
- continua disponível nas abas próprias do Excel.

### Empresas ocultas

Empresas do próprio grupo Forest e cliente com nome contendo `ONZE` são ocultados da visão gerencial, mas permanecem na exportação. A lista oficial está centralizada em `HIDDEN_FOREST_GROUP_CNPJS` em `src/commercial.js`.

### Atualização

- automática em `:07` e `:37` de cada hora;
- botão **Atualizar agora** disponível para Admin, Diretoria e Comercial;
- a API `POST /api/commercial/sync` deve continuar verificando o perfil no backend;
- o botão deve apresentar erro legível e nunca esconder falha de sincronização.

## Financeiro — Contas a Pagar

Fonte principal:

- SE2 para títulos;
- SC7 para pedidos de compra;
- SA2/SB1 para enriquecimento.

O painel possui cache D1, sincronização automática a cada 15 minutos, saldos informados, títulos, baixados, histórico e contas manuais. Perfis autorizados: Financeiro, Diretoria e Admin.

Consulte também `docs/painel-financeiro-contas-a-pagar.md` antes de alterar o módulo.

## Produção, Qualidade e Turnos

Fluxo principal:

`Aguardando → Em produção → Aguardando qualidade → Em inspeção → Liberado ao cliente`

Existe retorno para correção na Produção. Toda transição deve ser validada no backend, persistida no D1 e auditada.

Máquinas padrão incluem Cortadeiras C1/C2/C3, Rebobinadeiras R1–R5, Guilhotina, Embaladora, Embalagem e Slip Sheet. A lista pode ser administrada na plataforma.

Tubeteira e Cantoneira possuem critérios de inspeção próprios; não generalizar campos e tolerâncias entre máquinas sem confirmação da Qualidade.

## Banco D1

Migrations existentes no momento deste documento: `0001` até `0016`.

Regra obrigatória:

- nunca editar migration aplicada;
- criar a próxima migration numerada;
- validar banco e ambiente antes de aplicar;
- aplicar migrations remotas antes de publicar código que dependa de novas colunas;
- preservar dados operacionais em sincronizações.

Tabelas centrais:

- `user_roles`;
- `orders`;
- `commercial_invoice_items`;
- `finance_payables_cache`;
- `finance_purchase_orders_cache`;
- `finance_manual_payables`;
- `operator_devices`;
- `operator_sessions`;
- `app_state`;
- `audit_log`;
- `sync_runs`;
- `finance_sync_runs`.

## Processo de alteração

No PowerShell, dentro da pasta do projeto:

```powershell
npm install
npm run check
npm run build
npx wrangler deploy --dry-run
```

Se houver migration nova:

```powershell
npx wrangler d1 migrations list forest-paper-producao --remote
npx wrangler d1 migrations apply forest-paper-producao --remote
```

Publicação:

```powershell
npx wrangler deploy
```

Após o deploy:

1. guardar o Version ID;
2. abrir a URL protegida;
3. executar `Ctrl + F5`;
4. testar o perfil afetado;
5. verificar filtros, persistência, sincronização e responsividade;
6. consultar logs e tabelas de sync se houver divergência.

Não publique se `npm run check`, build ou dry-run falharem.

## Cuidados técnicos

- Preserve o design Forest e a fonte Mabry Pro.
- Não use `width: 100vw` em painéis internos; isso já causou corte e desalinhamento com a barra lateral.
- A página pode rolar horizontalmente somente dentro de tabelas largas, não no corpo inteiro.
- Mantenha layout responsivo para notebook, tablet e celular.
- Não altere `app.html` e esqueça de executar o build; produção recebe `dist/index.html`.
- Não confunda o Worker financeiro de staging com o Worker de produção.
- Não exponha endpoints de sincronização sem checagem de perfil no backend.
- Não use o timestamp atual para fingir que o ERP sincronizou; mostrar o timestamp efetivo do último job.

## Critério de aceite

Uma mudança está concluída somente quando:

- não introduz dados sensíveis no repositório;
- passa em `npm run check`, build e dry-run;
- mantém autorização no backend;
- persiste estado corporativo no D1;
- respeita as regras de Klabin, condição 32, filiais, IPI e empresas ocultas;
- converte unidades corretamente no painel sem modificar a quantidade original do Excel;
- não duplica notas nos totais;
- funciona em desktop e celular;
- é publicada no Worker correto;
- o Version ID é informado ao responsável.

