# Dívida técnica: teste de fluxo de produção removido

**Data:** 02/09/2026
**Arquivo removido:** `scripts/test-production-flow.mjs` (715 linhas)
**Status:** cobertura de teste ausente — precisa ser reescrita

## Por que foi removido, e não consertado

O teste importava quatro funções de `src/worker.js`:

| Função | Situação no código atual |
|---|---|
| `accessIdentityHasAnyGroup` | **não existe em lugar nenhum** de `src/` |
| `billingItemFromRow` | **não existe em lugar nenhum** de `src/` |
| `allocateInvoiceTotals` | existe em `src/commercial.js`, não em `worker.js` |
| `orderFromRow` | existe em `worker.js` e `commercial.js`, sem `export` nomeado |

`src/worker.js` só possui `export default`. Confirmado em `git show HEAD:src/worker.js` que
o teste já falhava antes das alterações de setembro/2026 — não foi quebrado por elas.

Duas das quatro funções foram removidas do código em algum refactor anterior. Consertar não
seria adicionar `export`: exigiria reescrever o teste contra uma arquitetura diferente,
sem saber o que `accessIdentityHasAnyGroup` deveria afirmar. O risco é escrever asserções
que apenas descrevem o que o código faz hoje, em vez do que ele deve fazer — o que dá
confiança falsa, o mesmo problema de deixar o teste quebrado.

## O que se perdeu

Eram ~150 asserções sobre um Worker de verdade, iniciado com `unstable_startWorker`. Os
grupos de maior valor:

**Controle de acesso** — `forbiddenOperatorStatus`, `forbiddenOtherMachineStatus`,
`adminCannotOperateStatus`, `adminInspectionStatus`, `externalOperator`,
`qualityGroupMatches`, `commercialRoleLoadsData`. É a área mais crítica e hoje está
descoberta.

**Autenticação de operador** — `loginStatus`, `hasDeviceCookie`, `hasSessionCookie`,
`hasOperatorPinForm`, `authorizeStatus`. Cobria PIN, dispositivo e sessão ponta a ponta.

**Fluxo de produção** — `startStatus`, `finishStatus`, `shiftFinished`, `targetMachine`,
`productionShift`, `assignments`.

**Regras comerciais** — `includesIpiInOrderValue`, `includesFreightInBilling`,
`deductsReturnsFromBilling`, `excludesCondition32`, `separatesKlabinAtSource`,
`merges040101IntoMatrizView`, `hidesForestGroupByCnpj`, `keepsTonnesOnlyForWeightUnits`.
São regras de negócio sutis, do tipo que quebra sem ninguém perceber.

**Exportações e UI** — `exportsCompleteCommercialData`, `keepsSellerInExcel`,
`hasCommercialExcelExport`, `servesFreshMainAsset`.

## Como reescrever

O arquivo original está no histórico do Git. Sugestão de ordem, por risco:

1. **Controle de acesso primeiro.** Exportar as funções necessárias de `worker.js` como
   exports nomeados (o `export default` continua) e testar `currentUser`, `userHasRole`,
   `projectOrdersForUser` e o guard de `stateRoute` em isolamento — sem subir Worker.
2. **Projeção de campos comerciais.** `projectOrdersForUser` já tem teste dirigido escrito
   em setembro/2026, mas foi executado de forma descartável e não ficou no repositório.
   Vale materializá-lo.
3. **Regras comerciais** com dados sintéticos, também em isolamento.
4. **Integração com `unstable_startWorker`** por último, que é a parte cara e frágil.

Não há `npm test` no `package.json`. Ao criar a suíte nova, registre o script ali para que
o comando de deploy possa depender dele.
