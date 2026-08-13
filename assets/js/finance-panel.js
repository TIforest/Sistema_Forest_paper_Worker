const api = "/api/finance";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
let currentView = "payables";
let currentPage = 1;
let rootElement;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
async function request(path, options = {}) {
  const response = await fetch(`${api}${path}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `HTTP ${response.status}`), { status: response.status, payload });
  return payload;
}
function styles() {
  if (document.getElementById("financePanelStyles")) return;
  const style = document.createElement("style");
  style.id = "financePanelStyles";
  style.textContent = `
    #tab-financeiro.active{width:100vw;margin-left:calc(50% - 50vw);padding:0 30px}
    .fin{width:min(100%,1780px);min-width:0;margin:0 auto;display:grid;gap:18px;color:#0A252A}.fin>*{min-width:0}
    .fin-hero{background:#0A252A;color:#fff;border-radius:18px;padding:30px 34px;display:flex;justify-content:space-between;align-items:center;gap:24px;box-shadow:0 16px 36px rgba(10,37,42,.13)}
    .fin-eyebrow{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#C5F249}.fin-hero h2{font-size:clamp(28px,3vw,44px);font-weight:800;letter-spacing:-.04em}.fin-hero p{margin:8px 0 0;color:rgba(255,255,255,.68)}
    .fin-sync{font-size:12px;color:rgba(255,255,255,.72);text-align:right}.fin-sync strong{display:block;color:#fff;margin-top:4px}
    .fin-kpis{min-width:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}.fin-card,.fin-panel{min-width:0;background:#fff;border:1px solid rgba(10,37,42,.12);border-radius:14px;box-shadow:0 7px 24px rgba(10,37,42,.045)}
    .fin-card{padding:18px;border-left:5px solid var(--accent,#C5F249)}.fin-card span{display:block;color:#52676B;text-transform:uppercase;letter-spacing:.07em;font-size:10px;font-weight:700}.fin-card strong{display:block;font-size:clamp(22px,2vw,32px);margin-top:7px}.fin-card small{color:#6E7E80}
    .fin-alerts{display:grid;grid-template-columns:1fr 1fr;gap:12px}.fin-alert{padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:12px}.fin-alert button{border:0;background:#0A252A;color:#fff;border-radius:8px;padding:9px 12px;cursor:pointer}.fin-alert strong{font-size:22px}
    .fin-tabs{display:flex;gap:8px;flex-wrap:wrap}.fin-tab{border:1px solid rgba(10,37,42,.16);background:#fff;color:#0A252A;border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer}.fin-tab.active{background:#0A252A;color:#fff}.fin-tab.primary{padding-inline:22px}
    .fin-panel{padding:20px}.fin-panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:15px}.fin-panel-head h3{font-size:21px}.fin-actions{display:flex;gap:8px;flex-wrap:wrap}.fin-button{border:1px solid rgba(10,37,42,.18);background:#fff;color:#0A252A;border-radius:8px;padding:9px 13px;font-weight:700;cursor:pointer}.fin-button.primary{background:#0A252A;color:#fff}.fin-button:disabled{opacity:.5;cursor:wait}
    .fin-table-wrap{overflow:auto;border:1px solid rgba(10,37,42,.12);border-radius:10px;max-height:600px}.fin-table{border-collapse:collapse;min-width:1450px;width:100%}.fin-table th{position:sticky;top:0;background:#F1F4ED;z-index:1;color:#455A5E;text-transform:uppercase;letter-spacing:.05em;font-size:10px}.fin-table th,.fin-table td{padding:10px 11px;border-bottom:1px solid rgba(10,37,42,.08);text-align:left;white-space:nowrap;font-size:12px}.fin-table td.money{text-align:right;font-weight:700}.fin-status{border:1px solid rgba(10,37,42,.16);border-radius:6px;padding:6px;background:#fff}
    .fin-pager{display:flex;justify-content:space-between;align-items:center;margin-top:14px;color:#607276;font-size:12px}.fin-pager div{display:flex;gap:7px}
    .fin-balance-form{display:grid;grid-template-columns:150px 1fr 160px auto;gap:9px}.fin-balance-form input{min-height:42px;border:1px solid rgba(10,37,42,.18);border-radius:7px;padding:8px 10px}.fin-history{margin-top:12px;display:grid;gap:6px}.fin-history-row{background:#F7F7F3;border-radius:7px;padding:9px 11px;font-size:12px;display:flex;justify-content:space-between;gap:12px}.fin-empty{padding:32px;text-align:center;color:#65777A}.fin-error{background:#FFF3F0;color:#8A3028;border:1px solid #F1C3BC;border-radius:10px;padding:14px}.fin-disabled{text-align:center;padding:50px 20px}.fin-badge{display:inline-flex;padding:5px 9px;border-radius:999px;background:#E7F8AF;font-size:10px;font-weight:700;text-transform:uppercase}
    @media(max-width:1200px){.fin-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:760px){#tab-financeiro.active{padding:0 16px}.fin-hero{align-items:flex-start;flex-direction:column}.fin-sync{text-align:left}.fin-kpis,.fin-alerts{grid-template-columns:1fr}.fin-balance-form{grid-template-columns:1fr}.fin-panel-head{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);
}
function shell(user) {
  rootElement.innerHTML = `
    <div class="fin">
      <header class="fin-hero"><div><div class="fin-eyebrow">Financeiro · Protheus SE2 / SC7</div><h2>Contas a Pagar</h2><p>Títulos em aberto, disponibilidade financeira e compromissos dos próximos dias.</p></div><div class="fin-sync">Última atualização<strong id="finUpdated">Aguardando cache</strong>${user.role === "admin" ? '<button class="fin-button" id="finSyncNow" type="button">Sincronizar Protheus</button><small id="finSyncStatus" aria-live="polite"></small>' : ""}</div></header>
      <section class="fin-kpis" id="finKpis"></section>
      <section class="fin-alerts" id="finAlerts"></section>
      <nav class="fin-tabs" aria-label="Visões financeiras"><button class="fin-tab primary active" data-fin-view="payables">Contas a Pagar</button><button class="fin-tab" data-fin-view="settled">Títulos Baixados</button><button class="fin-tab" data-fin-view="purchases">Pedidos de Compra</button><button class="fin-tab" data-fin-view="balances">Saldo de Contas</button></nav>
      <section class="fin-panel" id="finContent"><div class="fin-empty">Carregando painel financeiro...</div></section>
    </div>`;
  rootElement.querySelectorAll("[data-fin-view]").forEach((button) => button.addEventListener("click", async () => {
    rootElement.querySelectorAll("[data-fin-view]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active"); currentView = button.dataset.finView; currentPage = 1; await loadView();
  }));
  document.getElementById("finSyncNow")?.addEventListener("click", syncNow);
}
async function syncNow() {
  const button = document.getElementById("finSyncNow");
  const status = document.getElementById("finSyncStatus");
  button.disabled = true;
  status.textContent = "Consultando SE2 e SC7...";
  try {
    const result = await request("/sync", { method: "POST" });
    status.textContent = `Concluído: ${result.payables || 0} título(s) e ${result.purchases || 0} pedido(s).`;
    await Promise.all([loadDashboard(), loadView()]);
  } catch (error) {
    status.textContent = `Falha: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}
function kpis(data) {
  document.getElementById("finUpdated").textContent = data.lastSync?.finished_at ? new Date(data.lastSync.finished_at).toLocaleString("pt-BR") : "Ainda não sincronizado";
  document.getElementById("finKpis").innerHTML = `
    <article class="fin-card" style="--accent:#B5473A"><span>Vencidos</span><strong>${money.format(data.overdue)}</strong><small>Vencimento real anterior a hoje</small></article>
    <article class="fin-card"><span>Próximos 7 dias</span><strong>${money.format(data.dueSevenDays)}</strong><small>Saldo em aberto</small></article>
    <article class="fin-card" style="--accent:#C1B4EE"><span>Saldo em contas</span><strong>${money.format(data.accountBalance)}</strong><small>Informado hoje</small></article>
    <article class="fin-card" style="--accent:${data.availabilityGap < 0 ? "#B5473A" : "#78B76A"}"><span>Disponibilidade</span><strong>${money.format(data.availabilityGap)}</strong><small>Saldo menos vencidos e próximos 7 dias</small></article>
    <article class="fin-card" style="--accent:#B19873"><span>Compras em aberto</span><strong>${money.format(data.purchaseOpenTotal)}</strong><small>Saldo de itens SC7</small></article>`;
  document.getElementById("finAlerts").innerHTML = `
    <article class="fin-card fin-alert"><div><span>Novo lançamento próximo</span><strong>${data.alerts.newNearDue}</strong><small>Incluído nas últimas 48h e vence antes de 7 dias</small></div><button data-alert="new">Ver</button></article>
    <article class="fin-card fin-alert"><div><span>Prazo curto na entrada</span><strong>${data.alerts.shortTerm}</strong><small>Menos de 7 dias entre emissão e vencimento real</small></div><button data-alert="short">Ver</button></article>`;
  rootElement.querySelectorAll("[data-alert]").forEach((button) => button.addEventListener("click", () => loadAlerts(button.dataset.alert)));
}
const payableHeaders = ["Filial", "Número do título", "Tipo", "Parcela", "Natureza", "Nº fornecedor", "Nome do fornecedor", "Emissão", "Contabilização", "Vencimento", "Vencimento real", "Valor do título", "Saldo", "Status de baixa"];
function payableRow(item, settled = false) {
  return `<tr><td>${escapeHtml(item.branch)}</td><td>${escapeHtml(item.title_number)}</td><td>${escapeHtml(item.title_type)}</td><td>${escapeHtml(item.installment)}</td><td>${escapeHtml(item.nature)}</td><td>${escapeHtml(item.supplier_code)}</td><td>${escapeHtml(item.supplier_name)}</td><td>${escapeHtml(item.issue_date)}</td><td>${escapeHtml(item.accounting_date)}</td><td>${escapeHtml(item.due_date)}</td><td>${escapeHtml(item.actual_due_date)}</td><td class="money">${money.format(item.original_value)}</td><td class="money">${money.format(item.open_balance)}</td><td>${settled ? escapeHtml(item.status) : `<select class="fin-status" data-status-key="${escapeHtml(item.cache_key)}">${["a vencer","vencido","negociado","pago","pagar"].map(status => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select> <button class="fin-button" data-history-key="${escapeHtml(item.cache_key)}">Histórico</button>`}</td>${settled ? `<td>${escapeHtml(item.settlement_date)}</td>` : ""}</tr>`;
}
function pager(payload) {
  const pages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
  return `<div class="fin-pager"><span>${payload.total.toLocaleString("pt-BR")} registro(s) · página ${payload.page} de ${pages}</span><div><button class="fin-button" data-page="${payload.page - 1}" ${payload.page <= 1 ? "disabled" : ""}>Anterior</button><button class="fin-button" data-page="${payload.page + 1}" ${payload.page >= pages ? "disabled" : ""}>Próxima</button></div></div>`;
}
async function loadPayables(settled = false) {
  const payload = await request(`/${settled ? "settled" : "payables"}?page=${currentPage}&pageSize=50`);
  const headers = [...payableHeaders, ...(settled ? ["Data de baixa"] : [])];
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">${settled ? "Visão complementar" : "Visão principal"}</span><h3>${settled ? "Títulos Baixados" : "Contas a Pagar em Aberto"}</h3></div><div class="fin-actions"><button class="fin-button" data-export="${settled ? "settled" : "payables"}">Exportar Excel completo</button><button class="fin-button primary" id="finRefresh">Atualizar tela</button></div></div><div class="fin-table-wrap"><table class="fin-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${payload.items.map(item => payableRow(item, settled)).join("") || `<tr><td colspan="${headers.length}" class="fin-empty">Nenhum registro encontrado.</td></tr>`}</tbody></table></div>${pager(payload)}<div id="finHistory" class="fin-history"></div>`;
  bindCommon();
  rootElement.querySelectorAll("[data-status-key]").forEach((select) => select.addEventListener("change", async () => { select.disabled = true; try { await request(`/status/${encodeURIComponent(select.dataset.statusKey)}`, { method: "PUT", body: JSON.stringify({ status: select.value }) }); } finally { select.disabled = false; } }));
  rootElement.querySelectorAll("[data-history-key]").forEach((button) => button.addEventListener("click", () => loadHistory(button.dataset.historyKey)));
}
async function loadPurchases() {
  const payload = await request(`/purchases?page=${currentPage}&pageSize=50`);
  const headers = ["Pedido", "Emissão", "Fornecedor / Loja", "Condição", "Moeda", "Produto", "Qtd. pedida", "Qtd. recebida", "Saldo", "Valor unitário", "Valor total", "Valor em aberto"];
  const rows = payload.items.map(item => `<tr><td>${escapeHtml(item.order_number)} / ${escapeHtml(item.item_number)}</td><td>${escapeHtml(item.issue_date)}</td><td>${escapeHtml(item.supplier_code)} / ${escapeHtml(item.supplier_store)} · ${escapeHtml(item.supplier_name)}</td><td>${escapeHtml(item.payment_condition)}</td><td>${escapeHtml(item.currency)}</td><td>${escapeHtml(item.product_code)} · ${escapeHtml(item.product_description)}</td><td class="money">${number.format(item.ordered_quantity)}</td><td class="money">${number.format(item.received_quantity)}</td><td class="money">${number.format(item.open_quantity)}</td><td class="money">${money.format(item.unit_value)}</td><td class="money">${money.format(item.total_value)}</td><td class="money">${money.format(item.open_value)}</td></tr>`).join("");
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Visão complementar</span><h3>Pedidos de Compra em Aberto</h3></div><button class="fin-button" data-export="purchases">Exportar Excel completo</button></div><div class="fin-table-wrap"><table class="fin-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="12" class="fin-empty">Nenhum pedido em aberto.</td></tr>`}</tbody></table></div>${pager(payload)}`;
  bindCommon();
}
async function loadBalances(selectedDate = "") {
  const payload = await request(`/balances${selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : ""}`);
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Fechamento diário</span><h3>Saldo de Contas</h3></div></div><form class="fin-balance-form" id="finBalanceForm"><input type="date" name="date" value="${payload.date}" required><input name="accountName" placeholder="Nome da conta" required><input name="value" type="number" step="0.01" placeholder="Saldo atual" required><button class="fin-button primary">Salvar saldo</button></form><div class="fin-history">${payload.items.map(item => `<div class="fin-history-row"><span><strong>${escapeHtml(item.account_name)}</strong><br>${escapeHtml(item.recorded_by_name)} · ${new Date(item.recorded_at).toLocaleString("pt-BR")}</span><strong>${money.format(item.balance_value)}</strong></div>`).join("") || `<div class="fin-empty">Nenhum saldo informado para hoje.</div>`}</div>`;
  const formElement = document.getElementById("finBalanceForm");
  formElement.elements.date.addEventListener("change", event => loadBalances(event.target.value));
  formElement.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const balanceDate = form.get("date"); const accountName = form.get("accountName").trim(); await request("/balances", { method: "PUT", body: JSON.stringify({ date: balanceDate, accountKey: accountName.toLowerCase().replace(/\s+/g, "-"), accountName, value: Number(form.get("value")) }) }); await Promise.all([loadBalances(balanceDate), loadDashboard()]); });
}
async function loadAlerts(type) {
  const payload = await request(`/alerts?type=${type}&page=1&pageSize=50`);
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Alertas</span><h3>${type === "new" ? "Novos lançamentos com vencimento próximo" : "Prazo curto concedido na entrada"}</h3></div><button class="fin-button" id="finBack">Voltar às contas a pagar</button></div><div class="fin-table-wrap"><table class="fin-table"><thead><tr>${payableHeaders.slice(0,13).map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${payload.items.map(item => payableRow(item).replace(/<td><select[\s\S]*?<\/td><\/tr>$/, "</tr>")).join("") || `<tr><td colspan="13" class="fin-empty">Nenhum alerta deste tipo.</td></tr>`}</tbody></table></div>`;
  document.getElementById("finBack").addEventListener("click", () => { currentView = "payables"; currentPage = 1; loadView(); });
}
async function loadHistory(key) {
  const payload = await request(`/status-history?key=${encodeURIComponent(key)}`);
  document.getElementById("finHistory").innerHTML = payload.items.map(item => `<div class="fin-history-row"><span>${escapeHtml(item.previous_status)} → <strong>${escapeHtml(item.new_status)}</strong></span><span>${escapeHtml(item.changed_by_name)} · ${new Date(item.changed_at).toLocaleString("pt-BR")}</span></div>`).join("") || `<div class="fin-empty">Nenhuma alteração manual registrada.</div>`;
}
function exportColumns(view, items) {
  if (view === "purchases") return items.map(item => ({ Filial:item.branch,"Pedido de compra":item.order_number,Item:item.item_number,"Data de emissão":item.issue_date,"Fornecedor código":item.supplier_code,Loja:item.supplier_store,"Nome do fornecedor":item.supplier_name,CNPJ:item.supplier_tax_id,"Condição de pagamento":item.payment_condition,Moeda:item.currency,"Código produto":item.product_code,Produto:item.product_description,"Quantidade pedida":item.ordered_quantity,"Quantidade recebida":item.received_quantity,"Saldo quantidade":item.open_quantity,"Valor unitário":item.unit_value,"Valor total":item.total_value,"Valor em aberto":item.open_value }));
  return items.map(item => ({ Filial:item.branch,"Número do título":item.title_number,Tipo:item.title_type,Parcela:item.installment,Natureza:item.nature,"Número do fornecedor":item.supplier_code,"Loja fornecedor":item.supplier_store,"Nome do fornecedor":item.supplier_name,CNPJ:item.supplier_tax_id,"Data de emissão":item.issue_date,"Data de contabilização":item.accounting_date,Vencimento:item.due_date,"Vencimento real":item.actual_due_date,"Valor do título":item.original_value,Saldo:item.open_balance,"Status de baixa":item.status,"Data de baixa":item.settlement_date }));
}
async function exportExcel(view) {
  const payload = await request(`/export?view=${view}`);
  if (!globalThis.XLSX) throw new Error("Biblioteca de Excel indisponível");
  const workbook = XLSX.utils.book_new();
  const rows = exportColumns(view, payload.items);
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), view === "purchases" ? "Pedidos Compra" : view === "settled" ? "Títulos Baixados" : "Contas a Pagar");
  XLSX.writeFile(workbook, `financeiro-${view}-${new Date().toISOString().slice(0,10)}.xlsx`);
}
function bindCommon() {
  document.getElementById("finRefresh")?.addEventListener("click", () => loadView());
  rootElement.querySelectorAll("[data-export]").forEach(button => button.addEventListener("click", async () => { button.disabled = true; try { await exportExcel(button.dataset.export); } catch(error) { alert(`Não foi possível exportar: ${error.message}`); } finally { button.disabled = false; } }));
  rootElement.querySelectorAll("[data-page]").forEach(button => button.addEventListener("click", () => { currentPage = Number(button.dataset.page); loadView(); }));
}
async function loadDashboard() { kpis(await request("/dashboard")); }
async function loadView() {
  document.getElementById("finContent").innerHTML = `<div class="fin-empty">Carregando...</div>`;
  try { if (currentView === "payables") await loadPayables(false); else if (currentView === "settled") await loadPayables(true); else if (currentView === "purchases") await loadPurchases(); else await loadBalances(); }
  catch(error) { document.getElementById("finContent").innerHTML = `<div class="fin-error">${escapeHtml(error.message)}</div>`; }
}
export async function mountFinancePanel(root) {
  if (root.dataset.mounted === "true") return;
  root.dataset.mounted = "true"; rootElement = root; styles();
  try {
    const [feature, userResponse] = await Promise.all([request("/feature"), fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })]);
    const user = await userResponse.json().catch(() => ({}));
    if (!userResponse.ok) throw new Error(user.message || user.error || `HTTP ${userResponse.status}`);
    if (!feature.enabled) { root.innerHTML = `<div class="fin fin-disabled"><section class="fin-panel"><span class="fin-badge">Feature flag desativada</span><h2>Painel Financeiro em homologação</h2><p>A estrutura está instalada, mas a sincronização SE2/SC7 permanece desligada até validar os campos da API TOTVS.</p><button class="fin-button primary" id="finEnable">Habilitar para homologação</button></section></div>`; document.getElementById("finEnable").addEventListener("click", async () => { await request("/feature", { method: "PUT", body: JSON.stringify({ enabled: true }) }); root.dataset.mounted = "false"; await mountFinancePanel(root); }); return; }
    shell(user); await Promise.all([loadDashboard(), loadView()]);
  } catch(error) { root.innerHTML = `<div class="fin"><div class="fin-error">Não foi possível abrir o painel financeiro: ${escapeHtml(error.message)}</div></div>`; }
}
