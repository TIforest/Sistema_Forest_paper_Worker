# Painel Financeiro - Contas a Pagar

Implementado na branch `codex/painel-financeiro-contas-a-pagar`, sem promover alterações no Worker de produção.

## Arquitetura

- Interface carregada sob demanda por `assets/js/finance-panel.js`.
- API isolada em `/api/finance/*`.
- Cache D1 separado para SE2 e SC7.
- Sincronização agendada a cada 15 minutos; a tela nunca consulta o Protheus diretamente.
- Feature flag `finance_payables`, desabilitada por padrão.
- Perfis autorizados: `financeiro`, `diretoria` e `admin`.
- Listagens paginadas; exportações usam o cache completo do ano corrente.
- Logs estruturados usam os eventos `finance_sync_*` e `finance_endpoint*`.

## Homologação

- Worker: `producao-forest-paper-finance-staging`.
- D1: `forest-paper-finance-staging`.
- O endereço `workers.dev` do staging permanece desabilitado até existir uma aplicação Cloudflare Access própria.
- A feature flag permanece desligada até a validação do contrato Protheus.
- As credenciais TOTVS precisam ser gravadas como secrets no Worker de staging; secrets de produção não podem ser lidos nem copiados automaticamente.

## Campos Protheus a confirmar

| Regra | Campo configurado para homologação | Ação |
|---|---|---|
| Vencimento real SE2 | `E2_VENCREA` | Conferir com relatório de Contas a Pagar |
| Saldo em aberto SE2 | `E2_SALDO` | Confirmar que já considera as baixas |
| Quantidade recebida SC7 | `C7_QUJE` | Conferir com uma amostra de pedidos de compra |

Os nomes são variáveis em `wrangler.staging.jsonc`, portanto podem ser corrigidos sem alterar a regra do painel.

## Liberação controlada

1. Criar uma aplicação Cloudflare Access para o hostname de staging.
2. Cadastrar ao menos um administrador no D1 de staging.
3. Gravar `TOTVS_USER` e `TOTVS_PASSWORD` como secrets do staging.
4. Validar SE2/SC7 com uma amostra contra o Protheus.
5. Habilitar `finance_payables` somente em staging.
6. Testar tela, alertas, Excel, status manual, histórico e saldos diários.
7. Fazer merge e migração em produção apenas depois da aprovação manual.

## Comandos

```powershell
npm run check
npm run test:finance
npm run test:finance:live
npm run db:finance:staging
npm run deploy:finance:staging
```

`test:finance:live` depende de `TOTVS_USER` e `TOTVS_PASSWORD` no arquivo local `.dev.vars` e não imprime as credenciais.
