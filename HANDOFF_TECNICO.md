# Handoff técnico — Portal Forest Paper

Atualizado em: 12/08/2026  
Worker: `producao-forest-paper`  
URL de produção: `https://producao-forest-paper.tiforest.workers.dev`  
Última versão publicada antes deste documento: `01d29241-9902-40b0-9d33-c67312510502`

Este arquivo é o ponto de partida obrigatório para Claude, Codex ou qualquer pessoa que vá alterar o portal. Antes de editar, leia também `SECURITY.md`, `wrangler.jsonc`, todas as migrations e os testes existentes.

## 1. Situação atual

O sistema deixou de ser apenas um HTML local. Atualmente é uma aplicação corporativa completa publicada em Cloudflare Workers, com:

- frontend estático em HTML, CSS e JavaScript;
- API no mesmo Cloudflare Worker;
- banco Cloudflare D1 compartilhado entre SP, PR e demais localidades;
- proteção externa pelo Cloudflare Access;
- autenticação própria por tablet e PIN para operadores;
- integração oficial com TOTVS Protheus por REST/GenericQuery;
- sincronização automática por Cron a cada 30 minutos;
- módulos de Produção, Qualidade, Diretoria, Operadores, Turnos e Gestão Comercial;
- exportações para Excel feitas no navegador;
- trilha de auditoria e persistência dos estados do fluxo.

O portal não deve voltar a usar `localStorage` como banco principal. O armazenamento local é apenas cache e preferência visual. Estado corporativo deve ficar no D1.

## 2. Arquivos principais

| Arquivo/pasta | Função |
|---|---|
| `index.html` | Interface completa, estilos, painéis, formulários, gráficos, filtros e exportação Excel. É um arquivo grande e monolítico. |
| `src/worker.js` | API, autenticação, regras de perfil, D1, produção, qualidade, operadores, comercial, sincronizações e Cron. |
| `src/protheus.js` | Construção e execução das consultas GenericQuery, paginação e enriquecimento SA1/SB1/SA3/SE4. |
| `migrations/` | Histórico do schema D1. Nunca altere migration já aplicada; crie a próxima migration numerada. |
| `scripts/build.mjs` | Valida dados sensíveis e gera `dist/`. |
| ~~`scripts/test-production-flow.mjs`~~ | **Removido em 02/09/2026** — importava funcoes inexistentes no codigo. Divida registrada em `docs/divida-teste-fluxo-producao.md`. |
| `scripts/test-protheus-query.mjs` | Testes das URLs, filtros, paginação e enriquecimento TOTVS. |
| `scripts/provision-user.mjs` | Gera SQL com hash do e-mail, sem armazenar o e-mail puro. |
| `wrangler.jsonc` | Configuração do Worker, D1, assets, variáveis e Cron. |
| `assets/` | Ícones usados na navegação. |
| `dist/` | Saída gerada. Não editar manualmente. |

## 3. Cloudflare atual

- Worker: `producao-forest-paper`
- D1 binding: `DB`
- Banco: `forest-paper-producao`
- Database ID: `6a60f78d-05d1-4a00-a26f-c860da0fe473`
- Assets binding: `ASSETS`
- Cron: `*/30 * * * *`
- Cloudflare Access team domain: `ancient-star-2672.cloudflareaccess.com`
- A URL `workers.dev` está protegida por Cloudflare Access.

Segredos obrigatórios, já cadastrados no Worker e que nunca devem ir para código, chat, Git ou documentação:

- `TOTVS_USER`
- `TOTVS_PASSWORD`
- `OPERATOR_PIN_PEPPER`

Variáveis não secretas relevantes:

- `TOTVS_BASE_URL=https://forestpaper145392.protheus.cloudtotvs.com.br:1857/rest`
- `TOTVS_PAGE_SIZE=200`
- `SYNC_MAX_ROWS=5000`
- `SYNC_LOOKBACK_DAYS=120`
- `COMMERCIAL_SYNC_MAX_ROWS=10000`
- `COMMERCIAL_LOOKBACK_DAYS=400`
- `QUALITY_GROUP_IDS` contém os dois IDs de grupo de Qualidade do Entra.

Não substitua `wrangler.jsonc` por configuração criada no painel. O arquivo local é a fonte de verdade da implantação.

## 4. Autenticação e perfis

### Cloudflare Access

Usuários corporativos e pessoais autorizados entram primeiro pelo Cloudflare Access. O Access confirma a identidade, mas não define sozinho o perfil interno.

O Worker lê `Cf-Access-Authenticated-User-Email`, normaliza o e-mail, calcula SHA-256 e procura o hash em `user_roles`. E-mails puros não devem ser gravados no D1 nem incorporados ao HTML.

Perfis existentes:

- `admin`: administra usuários, máquinas e tablets; pode atuar na Qualidade e consultar todos os módulos; não deve operar uma máquina como operador comum.
- `producao`: vê somente pedidos destinados à sua máquina, inicia e conclui produção.
- `qualidade`: inicia inspeção, libera ou devolve material e registra apontamentos.
- `comercial`: acesso de leitura à Gestão Comercial e exportação Excel.
- `diretoria`: visão executiva/comercial e auditoria, sem alterar o fluxo.

Não existe fallback automático para Diretoria. Usuário não cadastrado deve receber HTTP 403. Usuário presente nos grupos configurados em `QUALITY_GROUP_IDS` pode receber Qualidade via confirmação do `get-identity` do Access.

Administradores e demais usuários já cadastrados devem ser preservados no D1. Não coloque a lista de e-mails no frontend. Para conferir perfis, consulte o D1 por nome, função e hash.

### Operadores em tablets

Operadores não precisam usar Microsoft 365 no tablet. O fluxo separado utiliza:

- tablet autorizado previamente por um administrador;
- cookie de dispositivo `fp_operator_device`, validade de 180 dias;
- operador cadastrado com PIN numérico de seis dígitos;
- cookie de sessão `fp_operator_session`, validade de seis horas;
- PBKDF2 SHA-256, 120.000 iterações, salt individual e pepper secreto;
- bloqueio progressivo após falhas de PIN;
- cookies `HttpOnly`, `Secure` e `SameSite=Strict`.

Nunca diminua a proteção do PIN nem grave PIN em texto puro.

## 5. Máquinas e roteamento

Máquinas padrão atuais:

- Cortadeira 01 - C1
- Cortadeira 02 - C2
- Cortadeira 03 - C3
- Rebobinadeira 01 - R1
- Rebobinadeira 02 - R2
- Rebobinadeira 03 - R3
- Rebobinadeira 04 - R4
- Rebobinadeira 05 - R5
- Guilhotina
- Embaladora
- Embalagem
- Slip Sheet

A lista pode ser mantida pelo administrador e fica em `app_state`, chave `forestpaper:maquinas`. Cada operador de Produção tem `machine_name`, e cada pedido tem `target_machine`. O backend filtra pedidos de Produção pela máquina; não dependa apenas de ocultação visual.

Ao concluir um pedido, o sistema pergunta se o turno foi encerrado ou continuará. Métricas usam máquina, operador, turno e timestamps persistidos no D1.

## 6. Fluxo de produção e qualidade

Status principais:

- Aguardando
- Em produção
- Aguardando qualidade
- Em inspeção
- Liberado ao cliente
- Correção na produção

As transições autorizadas estão em `ROLE_TRANSITIONS` no Worker. Toda mudança relevante deve ser validada no backend, atualizada no D1 e registrada em `audit_log`.

Na Qualidade existem layouts específicos para Tubeteira e Cantoneira. O formulário contempla turno, máquina, quantidade de amostras, identificação alfanumérica de bobina/palete, gramatura, espessura, brilho, COBB, umidade, colagem e demais medições condicionais. Não trate testes de Tubeteira/Cantoneira como equivalentes aos das demais máquinas.

## 7. Integração TOTVS Protheus

Fonte oficial atual:

`https://forestpaper145392.protheus.cloudtotvs.com.br:1857/rest/api/framework/v1/genericQuery`

Autenticação: Basic Auth com usuário exclusivo do Protheus guardado nos secrets do Worker.

Aliases principais:

- pedidos: SC5 + SC6;
- faturamento: SF2 + SD2;
- clientes: SA1;
- produtos: SB1;
- vendedores: SA3;
- condições de pagamento: SE4.

Situação importante de agosto/2026: foi desfeita a exigência de que uma nota estivesse simultaneamente na SF1 e SF2. O faturamento atual consulta SF2 + SD2. Não reintroduza o join SF1/SF2 sem uma nova decisão formal do negócio.

Atualização de 27/08/2026 (decisão do negócio): a SF1/SD1 voltou ao sistema **apenas para devoluções de venda**, nunca para compor faturamento. Devolução de venda é nota de ENTRADA (`F1_TIPO = 'D'`), com o cliente em `F1_FORNECE`/`F1_LOJA` (cadastro SA1, não SA2) e vínculo obrigatório com a nota faturada em `D1_NFORI` / `D1_SERIORI` / `D1_ITEMORI`. A coluna `origem` (`SF2` ou `SF1`) separa a procedência de cada linha. `F2_TIPO = 'D'`/`'B'` na SF2 é devolução de **compra** (nós devolvendo ao fornecedor: CFOP de saída 5xxx e contraparte na SA2). Ela é classificada como `devolucao_compra`, fica **fora do faturamento** mas **não abate a receita de venda** — só `devolucao` (SF1) e `cancelada` entram na dedução. Isso corrigiu uma dedução indevida de R$ 21.060,81 em agosto/2026, quando duas notas de saída (CFOP 5556 e 5949) estavam abatendo a receita. Fora de escopo: devolução de remessa em poder de terceiros, que usa nota tipo `N` e se identifica pelo TES (`F4_PODER3 = 'D'`), não pelo tipo da nota.

Todas as consultas devem manter `D_E_L_E_T_ <> '*'` para cada alias consultado.

Regras de consulta:

- paginação padrão de 200 registros;
- limite comercial de 10.000 linhas por sincronização;
- consultas comerciais são recortadas por mês e, opcionalmente, por dia ou pelo intervalo `De:`/`Até:`;
- o intervalo `De:`/`Até:` tem precedência sobre mês + dia e, na sincronização, cobre até 12 meses;
- condição de pagamento 32 é excluída na origem;
- pedidos operacionais consideram janela padrão de 120 dias;
- notas canceladas e devoluções **não são mais descartadas**: `invoiceRecordKind` as classifica em
  `registro_tipo` (`faturamento` / `devolucao` / `cancelada`) e elas são gravadas em D1 para poderem
  ser deduzidas do faturamento gerencial (migração `0018_commercial_returns.sql`);
- falha de enriquecimento em SA1/SB1/SA3/SE4 não deve derrubar a consulta principal; o Worker registra aviso e mantém os dados disponíveis.

Não exponha credenciais TOTVS ao navegador. Toda chamada ao Protheus deve sair do Worker.

## 8. Regras da Gestão Comercial

O painel se chama **Gestão Comercial**. O conteúdo completo usa uma faixa fluida centralizada de até 1800 px. Cabeçalho, barra lateral, filtros e cartões obedecem ao mesmo contêiner e permanecem alinhados mesmo com zoom reduzido. O botão do menu segue o mesmo alinhamento dos demais botões.

Visão atual:

- filtros por mês, dia opcional, intervalo `De:`/`Até:`, filial, cliente, condição e busca;
- quadro **Unidade de Negócios** primeiro, com o valor faturado já líquido de devoluções e notas excluídas;
- quadro **Devoluções** logo abaixo, por filial e com um cartão de total do grupo — somente valores,
  sem toneladas: devoluções no mês, notas excluídas no mês, faturamento bruto e faturamento líquido;
- pedidos a faturar: SC5/SC6;
- faturamento: SF2/SD2;
- Industrialização Klabin em bloco separado, logo após as devoluções;
- as antigas faixas de KPI **Pedidos a faturar** e **Faturamento** entre as filiais e o consolidado foram removidas;
- consolidado chamado **Total do Grupo**, cujo **Valor total faturado** é líquido de devoluções e notas excluídas;
- sem metas e sem painel por vendedor;
- vendedores continuam presentes na exportação Excel;
- tabela final por filial e linha com cliente, produto base, quantidade, valor, preço por tonelada, vendedor e prazos de pagamento;
- só itens em toneladas, quilos ou gramas somam tonelagem no painel; itens em qualquer outra unidade
  (UN, PC, CX, MIL, M2, sem unidade) entram apenas no valor em reais e a tabela de detalhamento mostra a
  quantidade e a unidade originais no lugar de toneladas; o Excel mantém quantidade e unidade originais;
- Excel preserva campos detalhados e filiais originais.

### Filiais

- `010101`: Forest Paper Matriz
- `020101`: Revita
- `040101`: Forest Espírito Santo

Na visão gerencial, `040101` é consolidada com `010101`. No Excel continuam separadas.

O IPI gerencial de 3,25% é aplicado somente aos pedidos das filiais `010101` e `040101`, multiplicando o valor por `1,0325`.

### Klabin

Qualquer cliente cujo nome contenha `KLABIN` é retirado do fluxo comercial comum e colocado em Industrialização. Klabin não soma nos pedidos, faturamento, toneladas ou carteira comuns. A condição 32 continua excluída. Os detalhes permanecem exportáveis.

### Empresas ocultas da visualização

Cadastros do próprio grupo Forest e cliente cujo nome contenha `ONZE` são ocultados da visualização gerencial, mas mantidos na exportação Excel. A lista de CNPJs normalizados está em `HIDDEN_FOREST_GROUP_CNPJS` no Worker. Não copie os CNPJs para múltiplos arquivos; altere a constante central e os testes.

### Valores

- Pedido gerencial: soma de `C6_VALOR`, com fator de IPI somente nas filiais indicadas.
- Faturamento: total único por filial/documento/série, usando valores da SF2 e acrescentando frete conforme a alocação implementada.
- Não somar `valor_total_nf` uma vez por item sem deduplicar a nota; use `commercialInvoiceTotal`/`commercialInvoices`.
- Notas canceladas (`F2_DTCANC`) e devoluções (`F2_TIPO` D/B) não entram no faturamento bruto: ficam em
  `registro_tipo` e são deduzidas para formar o faturamento líquido das unidades e do Total do Grupo.
- O Excel leva tudo: abas `Unidades de negócio`, `Devoluções` (item a item, inclusive clientes ocultos e
  Industrialização Klabin) e `Devoluções por filial`.

## 9. Excel e Microsoft Graph

O frontend ainda possui importação manual de Excel como contingência para pedidos. O parser lê XLSX diretamente e procura primeiro a aba `Consulta1`.

Há código legado de Microsoft Graph em `syncFromMicrosoft`, mas a configuração de produção atual usa TOTVS como fonte principal e não possui no `wrangler.jsonc` as variáveis Graph antigas. Não trate o README antigo como descrição fiel da fonte atual e não reative Graph sem autorização, secrets próprios e teste completo.

## 10. Banco D1

Tabelas principais:

- `user_roles`: hash da identidade, nome de exibição, perfil, máquina, PIN e bloqueio;
- `orders`: dados ERP do pedido e estado do fluxo Produção/Qualidade;
- `commercial_invoice_items`: itens e totais de faturamento;
- `operator_devices`: tablets autorizados;
- `operator_sessions`: sessões de operador;
- `app_state`: configurações e estados compartilhados;
- `audit_log`: auditoria;
- `sync_runs`: histórico de sincronizações;
- `commercial_targets`: estrutura existente, porém metas estão fora da interface atual.

Migrations aplicadas: `0001` até `0010`. Para qualquer alteração de schema:

1. criar `migrations/0011_nome_da_mudanca.sql` (ou próximo número);
2. testar localmente;
3. fazer backup/export do D1 quando a mudança for arriscada;
4. aplicar remotamente uma única vez;
5. atualizar testes e este documento.

Nunca edite uma migration que já foi aplicada em produção.

## 11. Endpoints

Público técnico:

- `GET /api/health`

API protegida pelo Access e perfil D1:

- `GET /api/me`
- `GET /api/orders`
- `PUT /api/orders` — importação manual, somente admin
- `PATCH /api/orders/:id`
- `GET /api/commercial`
- `POST /api/commercial/sync` — somente admin
- `GET|POST /api/operators`
- `DELETE /api/operators/:id`
- `GET|POST /api/operator-devices`
- `DELETE /api/operator-devices/:id`
- `GET|PUT /api/state/:key`
- `POST /api/sync` — somente admin
- `GET /api/audit` — Diretoria/Admin

API de tablet:

- `POST /operator-api/login`
- `POST /operator-api/logout`
- `GET /operator-api/me`
- `GET /operator-api/orders`
- `PATCH /operator-api/orders/:id`
- `GET /operator-api/state/:key`

## 12. Processo seguro para qualquer atualização

Dentro da pasta do projeto:

```powershell
npm install
npm run check
npm run test:protheus
npm run test:production
npx wrangler deploy --dry-run
npx wrangler deploy
```

Depois do deploy:

1. anotar o Version ID retornado;
2. abrir a URL protegida;
3. usar `Ctrl + F5`;
4. testar pelo menos Admin, Comercial, Qualidade e um tablet de Produção;
5. testar filtros comerciais, sincronização, início/fim de produção e inspeção;
6. confirmar que dados permanecem após F5 e em outro computador;
7. conferir `sync_runs` e `audit_log` se houver divergência.

Se o deploy piorar produção, use o rollback do Wrangler para a versão anterior e investigue localmente.

## 13. Regras de segurança obrigatórias

- Não colocar e-mails, senhas, tokens, links temporários ou dados pessoais no HTML.
- Não armazenar e-mails puros no D1; utilizar SHA-256 como já implementado.
- Não remover Cloudflare Access para facilitar testes.
- Não conceder Diretoria como perfil padrão.
- Não confiar apenas no frontend para autorização.
- Não expor TOTVS diretamente ao navegador.
- Não executar SQL destrutivo sem backup e validação do banco correto.
- Não apagar dados operacionais ao sincronizar dados ERP.
- Não editar `dist/` manualmente.
- Não substituir mudanças do usuário sem comparar os arquivos atuais.
- Não publicar antes de executar todos os testes.

## 14. Débitos técnicos e próximos upgrades recomendados

1. Dividir o `index.html` monolítico em módulos CSS/JS sem alterar o comportamento.
2. Atualizar o README antigo para refletir TOTVS como integração principal.
3. Adicionar ambiente de staging separado do Worker de produção.
4. Criar backup automatizado do D1 antes de migrations.
5. Adicionar monitoramento/alerta para falhas do Cron e TOTVS.
6. Criar testes visuais responsivos para desktop, notebook e tablet.
7. Formalizar em tabela de configuração as regras de tolerância de gramatura e espessura por produto.
8. Integrar custo do produto somente quando houver fonte oficial; então será possível calcular margem real.
9. Revisar periodicamente usuários, tablets ativos, grupos Entra e secrets.
10. Avaliar índices D1 e paginação se o volume comercial ultrapassar 10.000 linhas por mês.

## 15. Critério de aceite para futuras alterações

Uma atualização só está concluída quando:

- build e testes passam;
- autorização por perfil continua no backend;
- dados persistem no D1 após F5 e entre dispositivos;
- sincronização TOTVS funciona com paginação e sem credencial no frontend;
- totais comerciais não duplicam notas;
- Klabin, condição 32, CNPJs ocultos, Onze, IPI e filiais mantêm as regras atuais;
- Excel continua contendo os detalhes exigidos;
- layout funciona sem rolagem horizontal da página, exceto dentro de tabelas largas;
- versão do deploy e mudanças ficam documentadas.
