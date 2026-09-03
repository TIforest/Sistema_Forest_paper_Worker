const api = "/api/finance";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
let currentView = "payables";
let currentPage = 1;
let rootElement;
let openPayablesAll = [];
const openFilters = {};
let settledMonth = "";
let settledDay = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function financeIcon(name) {
  const paths = {
    overdue: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v6M16 3v6M4 10h16"/>',
    week: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v6M16 3v6M4 10h16"/><path d="M10 14h4l-2 3"/>',
    balance: '<path d="M5 7h13a2 2 0 0 1 2 2v10H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12v4"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/>',
    current: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M8 13l4 4 4-4"/>',
    available: '<path d="M4 20V10M9 20V5M14 20v-8M19 20V3"/>',
    purchases: '<circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M3 4h2l2.5 11h10l2-7H7"/>',
    settled: '<path d="M6 2h9l4 4v16H6z"/><path d="M14 2v5h5M9 14l2 2 4-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.info}</svg>`;
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
    #tab-financeiro.active{width:auto;max-width:100%;margin-left:0;padding:0;overflow:visible}
    .fin{width:100%;max-width:100%;min-width:0;margin:0;display:grid;gap:22px;color:#0F291E}.fin>*{min-width:0}
    .fin-hero{position:relative;overflow:hidden;background:linear-gradient(120deg,#0d261c,#133a2a);color:#fff;border-radius:16px;padding:34px 38px;min-height:220px;display:flex;justify-content:space-between;align-items:center;gap:30px;box-shadow:0 18px 44px -12px rgba(11,30,22,.16)}
    .fin-hero::after{content:'';position:absolute;right:-20px;bottom:-115px;width:520px;height:280px;border:1px solid rgba(16,185,129,.09);border-radius:50%;transform:rotate(-17deg);box-shadow:0 0 0 24px rgba(16,185,129,.025),0 0 0 48px rgba(16,185,129,.018)}
    .fin-hero>div{position:relative;z-index:1}.fin-eyebrow{font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#34D399}.fin-hero h2{margin:12px 0 0;font-size:clamp(36px,4vw,58px);font-weight:800;letter-spacing:-.05em;line-height:1}.fin-hero p{max-width:600px;margin:20px 0 0;color:rgba(255,255,255,.72);font-size:16px;line-height:1.55}
    .fin-sync{min-width:245px;padding:18px 0 18px 24px;border-left:1px solid rgba(255,255,255,.14);font-size:12px;color:rgba(255,255,255,.72);text-align:center}.fin-sync strong{display:block;color:#fff;margin:6px 0 16px;font-size:13px}.fin-sync .fin-button{min-height:46px;background:#fff;color:#0F291E;border:0;padding-inline:18px}.fin-sync small{display:block;margin-top:8px}
    .fin-kpis{min-width:0;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:18px;align-items:stretch}.fin-card,.fin-panel{min-width:0;background:#FFFFFF;border:1px solid #E6ECE8;border-radius:12px;box-shadow:0 4px 20px -2px rgba(11,30,22,.04),0 2px 6px -1px rgba(11,30,22,.02)}
    .fin-card{--state:#475569;--state-bg:#F1F5F9;container-type:inline-size;position:relative;grid-column:span 2;padding:20px 22px 18px;border-bottom:3px solid var(--state);display:flex;flex-direction:column;gap:7px;min-height:218px;overflow:hidden}.fin-card:nth-child(n+6){grid-column:span 3;min-height:146px}.fin-card--alert{--state:#B91C1C;--state-bg:#FEF2F2}.fin-card--warning{--state:#B45309;--state-bg:#FFFBEB}.fin-card--positive{--state:#047857;--state-bg:#ECFDF5}.fin-card--neutral{--state:#475569;--state-bg:#F1F5F9}.fin-card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.fin-card-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:10px;background:var(--state-bg);color:var(--state)}.fin-card-icon svg{width:25px;height:25px}.fin-card-dot{width:9px;height:9px;border-radius:50%;background:var(--state);box-shadow:0 0 0 6px var(--state-bg)}.fin-card>span{display:block;color:#64748B;text-transform:uppercase;letter-spacing:.065em;font-size:11px;font-weight:700}.fin-card strong{display:block;color:#0F291E;font-size:clamp(16px,9cqi,30px);font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.03em;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;word-break:normal}.fin-card--alert strong,.fin-card--alert>span{color:#B91C1C}.fin-card--positive strong{color:#047857}.fin-card small{display:block;color:#64748B;font-size:12px;line-height:1.4;margin-top:auto}.fin-card:nth-child(n+6){display:grid;grid-template-columns:52px minmax(0,1fr);grid-template-rows:auto auto auto;column-gap:16px;align-content:center}.fin-card:nth-child(n+6) .fin-card-head{grid-column:1;grid-row:1/4;margin:0}.fin-card:nth-child(n+6) .fin-card-dot{display:none}.fin-card:nth-child(n+6)>span,.fin-card:nth-child(n+6)>strong,.fin-card:nth-child(n+6)>small{grid-column:2}.fin-card:nth-child(n+6)>strong{font-size:clamp(20px,8cqi,29px)}
    #tab-financeiro .fin-card{border-left-width:1px!important;border-bottom-width:3px!important;border-bottom-color:var(--state)!important}#tab-financeiro .fin-card .fin-card-icon{color:var(--state)!important}#tab-financeiro .fin-card>span{color:#64748B!important;font-size:11px!important}#tab-financeiro .fin-card>strong{font-size:clamp(16px,9cqi,30px)!important;color:#0F291E!important}#tab-financeiro .fin-card--alert>span,#tab-financeiro .fin-card--alert>strong{color:#B91C1C!important}#tab-financeiro .fin-card--positive>strong{color:#047857!important}#tab-financeiro .fin-card:nth-child(n+6)>strong{font-size:clamp(20px,8cqi,29px)!important}
    .fin-note{display:flex;align-items:center;gap:14px;padding:15px 20px;border:1px solid #E6ECE8;border-radius:10px;background:#fff;color:#64748B;font-size:12px;line-height:1.45}.fin-note-icon{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border-radius:9px;background:#ECFDF5;color:#047857}.fin-note-icon svg{width:21px;height:21px}
    .fin-alerts{display:grid;grid-template-columns:minmax(0,3fr) minmax(320px,2fr);gap:18px;align-items:stretch}.fin-alert{grid-column:auto!important;min-height:132px!important;padding:20px 22px;display:grid!important;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;overflow:visible}.fin-alert--primary{--state:#B45309;--state-bg:#FFFBEB}.fin-alert--secondary{--state:#475569;--state-bg:#F1F5F9}.fin-alert>div{min-width:0;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:3px 14px}.fin-alert>div>span{grid-column:1/-1}.fin-alert>div>strong{grid-row:2/span 2;margin:0;font-size:30px;line-height:1;font-variant-numeric:tabular-nums}.fin-alert>div>small{grid-column:2;line-height:1.45}.fin-alert button{min-height:42px;border:0;background:#0F4C35;color:#fff;border-radius:8px;padding:10px 14px;font-weight:700;white-space:nowrap;cursor:pointer;transition:background .18s ease,transform .18s ease}.fin-alert button:hover{background:#047857;transform:translateY(-1px)}.fin-alert button:focus-visible{outline:3px solid var(--state-bg);outline-offset:3px}
    .fin-tabs{display:flex;gap:8px;flex-wrap:wrap}.fin-tab{border:1px solid #D1D5DB;background:#FFFFFF;color:#374151;border-radius:999px;padding:10px 16px;font-weight:600;cursor:pointer}.fin-tab:hover{border-color:#D5DFDA;background:#F8FAF9}.fin-tab.active{background:#0F4C35;color:#fff;border-color:#0F4C35}.fin-tab.primary{padding-inline:22px}
    .fin-panel{padding:24px}.fin-panel-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px;padding-bottom:13px;border-bottom:1px solid #F1F5F2;flex-wrap:wrap}.fin-panel-head h3{font-size:21px}.fin-panel-head small{color:#64748B}.fin-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.fin-button{border:1px solid #D1D5DB;background:#fff;color:#374151;border-radius:8px;padding:10px 14px;font-weight:600;cursor:pointer}.fin-button.primary{background:#047857;color:#fff;border-color:#047857}.fin-button:disabled{opacity:.5;cursor:wait}
    .fin-date-filters{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:14px}.fin-filter-label,.fin-field{display:grid;gap:5px}.fin-filter-label span,.fin-field span{font-size:10px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em}.fin-date-filters input{border:1px solid #E2E8F0;border-radius:7px;padding:8px 10px;min-height:42px}
    .fin-table-wrap{overflow:auto;border:1px solid #E6ECE8;border-radius:12px;max-height:600px}.fin-table{border-collapse:collapse;min-width:1550px;width:100%}.fin-table th{position:sticky;top:0;background:#F8FAF9;z-index:1;color:#64748B;text-transform:uppercase;letter-spacing:.05em;font-size:10px}.fin-table td.money{text-align:right;font-weight:700}
    .fin-table th,.fin-table td{padding:10px 12px;border-bottom:1px solid #F1F5F2;text-align:left;white-space:nowrap;font-size:12px}
    .fin-filter-row th{position:sticky;top:29px;background:#fff;z-index:1;padding:4px 6px}.fin-filter-row input{width:100%;min-width:90px;box-sizing:border-box;border:1px solid #E2E8F0;border-radius:6px;padding:6px 7px;font-size:11px;font-weight:400;text-transform:none;letter-spacing:normal}
    .fin-row-pagar{background:#FFFBEB}
    .fin-status{border:1px solid #E2E8F0;border-radius:6px;padding:6px;background:#fff}
    .fin-pager{display:flex;justify-content:space-between;align-items:center;margin-top:14px;color:#64748B;font-size:12px}.fin-pager div{display:flex;gap:7px}
    .fin-balance-form{display:grid;grid-template-columns:150px 1fr 180px auto;gap:10px;align-items:end}.fin-balance-form input{width:100%;min-height:42px;border:1px solid #E2E8F0;border-radius:7px;padding:8px 10px}.fin-history{margin-top:16px;display:grid;gap:7px}.fin-history-row{background:#F8FAF9;border:1px solid #E6ECE8;border-radius:8px;padding:11px 13px;font-size:12px;display:flex;justify-content:space-between;gap:12px}.fin-empty{padding:32px;text-align:center;color:#475569}.fin-error{background:#FEF2F2;color:#B91C1C;border:1px solid #FECACA;border-radius:10px;padding:14px}.fin-disabled{text-align:center;padding:50px 20px}.fin-badge{display:inline-flex;padding:4px 10px;border-radius:999px;background:#ECFDF5;border:1px solid #A7F3D0;color:#047857;font-size:11px;font-weight:600;text-transform:none}
    @media(max-width:1200px){.fin-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.fin-card,.fin-card:nth-child(n+6){grid-column:span 2}}
    @media(max-width:900px){.fin-alerts{grid-template-columns:1fr}.fin-alert{min-height:0!important}}
    @media(max-width:760px){#tab-financeiro.active{padding:0}.fin-hero{min-height:0;padding:26px 22px;align-items:flex-start;flex-direction:column}.fin-hero h2{font-size:38px}.fin-sync{width:100%;min-width:0;padding:16px 0 0;border-left:0;border-top:1px solid rgba(255,255,255,.22);text-align:left}.fin-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.fin-card,.fin-card:nth-child(n+6){grid-column:span 1}.fin-card:nth-child(n+6){display:flex;min-height:190px}.fin-card:nth-child(n+6) .fin-card-head{margin-bottom:14px}.fin-card:nth-child(n+6) .fin-card-dot{display:block}.fin-alerts{grid-template-columns:1fr}.fin-balance-form{grid-template-columns:1fr}.fin-panel-head{align-items:flex-start;flex-direction:column}}
    @media(max-width:480px){.fin-kpis{grid-template-columns:1fr}.fin-card,.fin-card:nth-child(n+6){grid-column:1;min-height:180px}.fin-card strong{font-size:clamp(22px,10cqi,32px)}}
  `;
  document.head.appendChild(style);
}
function shell(user) {
  rootElement.innerHTML = `
    <div class="fin">
      <header class="fin-hero"><div><div class="fin-eyebrow">Financeiro · Protheus SE2 / SC7</div><h2>Contas a Pagar</h2><p>Títulos em aberto, disponibilidade financeira e compromissos dos próximos dias.</p></div><div class="fin-sync">Última atualização<strong id="finUpdated">Aguardando cache</strong>${user.role === "admin" ? '<button class="fin-button" id="finSyncNow" type="button">Sincronizar Protheus</button><small id="finSyncStatus" aria-live="polite"></small>' : ""}</div></header>
      <section class="fin-kpis" id="finKpis"></section>
      <div class="fin-note"><span class="fin-note-icon">${financeIcon("info")}</span><span>Os valores apresentados são referentes ao sistema Protheus.<br>As informações são atualizadas de acordo com a última sincronização realizada.</span></div>
      <section class="fin-alerts" id="finAlerts"></section>
      <nav class="fin-tabs" role="tablist" aria-label="Visões financeiras"><button class="fin-tab primary active" role="tab" aria-selected="true" data-fin-view="payables">Contas a Pagar</button><button class="fin-tab" role="tab" aria-selected="false" data-fin-view="settled">Títulos Baixados</button><button class="fin-tab" role="tab" aria-selected="false" data-fin-view="purchases">Pedidos de Compra</button><button class="fin-tab" role="tab" aria-selected="false" data-fin-view="balances">Saldo de Contas</button></nav>
      <section class="fin-panel" id="finContent"><div class="fin-empty">Carregando painel financeiro...</div></section>
    </div>`;
  rootElement.querySelectorAll("[data-fin-view]").forEach((button) => button.addEventListener("click", async () => {
    rootElement.querySelectorAll("[data-fin-view]").forEach((item) => { item.classList.remove("active"); item.setAttribute("aria-selected", "false"); });
    button.classList.add("active"); button.setAttribute("aria-selected", "true"); currentView = button.dataset.finView; currentPage = 1; await loadView();
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
    <article class="fin-card fin-card--alert"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("overdue")}</span><i class="fin-card-dot"></i></div><span>Vencidos</span><strong>${money.format(data.overdue)}</strong><small>Vencimento real anterior a hoje</small></article>
    <article class="fin-card fin-card--warning"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("week")}</span><i class="fin-card-dot"></i></div><span>Próximos 7 dias</span><strong>${money.format(data.dueSevenDays)}</strong><small>Saldo em aberto</small></article>
    <article class="fin-card fin-card--neutral"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("balance")}</span><i class="fin-card-dot"></i></div><span>Saldo em contas</span><strong>${money.format(data.accountBalance)}</strong><small>Informado hoje</small></article>
    <article class="fin-card ${data.currentAvailable < 0 ? "fin-card--alert" : "fin-card--positive"}"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("current")}</span><i class="fin-card-dot"></i></div><span>Saldo atual</span><strong>${money.format(data.currentAvailable)}</strong><small>Saldo informado menos títulos marcados "pagar" e baixados hoje</small></article>
    <article class="fin-card ${data.availabilityGap < 0 ? "fin-card--alert" : "fin-card--positive"}"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("available")}</span><i class="fin-card-dot"></i></div><span>Disponibilidade</span><strong>${money.format(data.availabilityGap)}</strong><small>Saldo menos vencidos e próximos 7 dias</small></article>
    <article class="fin-card fin-card--neutral"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("purchases")}</span><i class="fin-card-dot"></i></div><span>Compras em aberto (30d)</span><strong>${money.format(data.purchaseOpenTotal)}</strong><small>Pedidos emitidos nos últimos 30 dias</small></article>
    <article class="fin-card fin-card--positive"><div class="fin-card-head"><span class="fin-card-icon">${financeIcon("settled")}</span><i class="fin-card-dot"></i></div><span>Baixados hoje</span><strong>${money.format(data.settledToday?.total || 0)}</strong><small>${(data.settledToday?.count || 0).toLocaleString("pt-BR")} título(s) em tempo real</small></article>`;
  document.getElementById("finAlerts").innerHTML = `
    <article class="fin-card fin-alert fin-alert--primary"><div><span>Novo lançamento próximo</span><strong>${data.alerts.newNearDue}</strong><small>Incluído nas últimas 48h e vence antes de 7 dias</small></div><button type="button" data-alert="new">Ver lançamentos</button></article>
    <article class="fin-card fin-alert fin-alert--secondary"><div><span>Prazo curto na entrada</span><strong>${data.alerts.shortTerm}</strong><small>Menos de 7 dias entre emissão e vencimento real</small></div><button type="button" data-alert="short">Ver títulos</button></article>`;
  rootElement.querySelectorAll("[data-alert]").forEach((button) => button.addEventListener("click", () => loadAlerts(button.dataset.alert)));
}
const payableHeaders = ["Filial", "Número do título", "Tipo", "Parcela", "Natureza", "Nº fornecedor", "Nome do fornecedor", "Tipo de fornecedor", "Emissão", "Contabilização", "Vencimento", "Vencimento real", "Valor do título", "Saldo", "Status de baixa"];
function payableRow(item, settled = false) {
  return `<tr><td>${escapeHtml(item.branch)}</td><td>${escapeHtml(item.title_number)}</td><td>${escapeHtml(item.title_type)}</td><td>${escapeHtml(item.installment)}</td><td>${escapeHtml(item.nature)}</td><td>${escapeHtml(item.supplier_code)}</td><td>${escapeHtml(item.supplier_name)}</td><td>${escapeHtml(item.supplier_category)}</td><td>${escapeHtml(item.issue_date)}</td><td>${escapeHtml(item.accounting_date)}</td><td>${escapeHtml(item.due_date)}</td><td>${escapeHtml(item.actual_due_date)}</td><td class="money">${money.format(item.original_value)}</td><td class="money">${money.format(item.open_balance)}</td><td>${settled ? escapeHtml(item.status) : `<select class="fin-status" data-status-key="${escapeHtml(item.cache_key)}">${["a vencer","vencido","negociado","pago","pagar"].map(status => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select> <button class="fin-button" data-history-key="${escapeHtml(item.cache_key)}">Histórico</button>`}</td>${settled ? `<td>${escapeHtml(item.settlement_date)}</td>` : ""}</tr>`;
}
function pager(payload) {
  const pages = Math.max(1, Math.ceil(payload.total / payload.pageSize));
  return `<div class="fin-pager"><span>${payload.total.toLocaleString("pt-BR")} registro(s) · página ${payload.page} de ${pages}</span><div><button class="fin-button" data-page="${payload.page - 1}" ${payload.page <= 1 ? "disabled" : ""}>Anterior</button><button class="fin-button" data-page="${payload.page + 1}" ${payload.page >= pages ? "disabled" : ""}>Próxima</button></div></div>`;
}

// --- Contas a Pagar em Aberto: carregado por completo no cliente para permitir
// filtro por coluna, marcação "pagar" e reordenação instantâneas. ---
const openColumns = [
  { key: "branch", label: "Filial" },
  { key: "title_number", label: "Número do título" },
  { key: "title_type", label: "Tipo" },
  { key: "installment", label: "Parcela" },
  { key: "nature", label: "Natureza" },
  { key: "supplier_code", label: "Nº fornecedor" },
  { key: "supplier_name", label: "Nome do fornecedor" },
  { key: "supplier_category", label: "Tipo de fornecedor" },
  { key: "issue_date", label: "Emissão" },
  { key: "accounting_date", label: "Contabilização" },
  { key: "due_date", label: "Vencimento" },
  { key: "actual_due_date", label: "Vencimento real" },
  { key: "original_value", label: "Valor do título", money: true },
  { key: "open_balance", label: "Saldo", money: true },
  { key: "status", label: "Status de baixa" },
];
function sortOpenPayables(items) {
  return [...items].sort((a, b) => {
    const priority = (item) => (item.status === "pagar" ? 0 : 1);
    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    return String(a.actual_due_date || "").localeCompare(String(b.actual_due_date || ""));
  });
}
function applyOpenFilters(items) {
  const active = openColumns.filter((column) => (openFilters[column.key] || "").trim());
  if (!active.length) return items;
  return items.filter((item) => active.every((column) => {
    const needle = openFilters[column.key].trim().toLowerCase();
    const raw = column.money ? money.format(item[column.key]) : String(item[column.key] ?? "");
    return raw.toLowerCase().includes(needle);
  }));
}
function openRow(item) {
  const cells = openColumns.map((column) => {
    if (column.key === "status") {
      return `<td><select class="fin-status" data-status-key="${escapeHtml(item.cache_key)}">${["a vencer","vencido","negociado","pago","pagar"].map(status => `<option ${status === item.status ? "selected" : ""}>${status}</option>`).join("")}</select> <button class="fin-button" data-history-key="${escapeHtml(item.cache_key)}">Histórico</button></td>`;
    }
    const value = item[column.key];
    return `<td class="${column.money ? "money" : ""}">${column.money ? money.format(value) : escapeHtml(value)}</td>`;
  }).join("");
  return `<tr${item.status === "pagar" ? ' class="fin-row-pagar"' : ""}>${cells}</tr>`;
}
function renderOpenBody() {
  const tbody = document.getElementById("finOpenBody");
  const count = document.getElementById("finOpenCount");
  if (!tbody) return;
  const filtered = sortOpenPayables(applyOpenFilters(openPayablesAll));
  tbody.innerHTML = filtered.map(openRow).join("") || `<tr><td colspan="${openColumns.length}" class="fin-empty">Nenhum registro encontrado.</td></tr>`;
  if (count) count.textContent = `${filtered.length.toLocaleString("pt-BR")} de ${openPayablesAll.length.toLocaleString("pt-BR")} título(s) em aberto`;
  tbody.querySelectorAll("[data-status-key]").forEach((select) => select.addEventListener("change", async () => {
    const key = select.dataset.statusKey;
    const value = select.value;
    select.disabled = true;
    try {
      await request(`/status/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ status: value }) });
      const item = openPayablesAll.find((entry) => entry.cache_key === key);
      if (item) item.status = value;
      renderOpenBody();
      loadDashboard();
    } finally {
      select.disabled = false;
    }
  }));
  tbody.querySelectorAll("[data-history-key]").forEach((button) => button.addEventListener("click", () => loadHistory(button.dataset.historyKey)));
}
async function loadOpenPayables() {
  const payload = await request("/payables?all=true");
  openPayablesAll = payload.items;
  document.getElementById("finContent").innerHTML = `
    <div class="fin-panel-head"><div><span class="fin-badge">Visão principal</span><h3>Contas a Pagar em Aberto</h3><small id="finOpenCount"></small></div><div class="fin-actions"><button class="fin-button" data-export="payables">Exportar Excel completo</button><button class="fin-button primary" id="finRefresh">Atualizar tela</button></div></div>
    <div class="fin-table-wrap"><table class="fin-table"><thead>
      <tr>${openColumns.map((column) => `<th>${column.label}</th>`).join("")}</tr>
      <tr class="fin-filter-row">${openColumns.map((column) => `<th><input type="text" data-filter-col="${column.key}" placeholder="Filtrar" value="${escapeHtml(openFilters[column.key] || "")}"></th>`).join("")}</tr>
    </thead><tbody id="finOpenBody"></tbody></table></div>
    <div id="finHistory" class="fin-history"></div>`;
  bindCommon();
  rootElement.querySelectorAll("[data-filter-col]").forEach((input) => input.addEventListener("input", () => {
    openFilters[input.dataset.filterCol] = input.value;
    renderOpenBody();
  }));
  renderOpenBody();
}

async function loadSettled() {
  const params = new URLSearchParams({ page: String(currentPage), pageSize: "50" });
  if (settledDay) params.set("day", settledDay);
  else if (settledMonth) params.set("month", settledMonth);
  const payload = await request(`/settled?${params.toString()}`);
  const headers = [...payableHeaders, "Data de baixa"];
  document.getElementById("finContent").innerHTML = `
    <div class="fin-panel-head"><div><span class="fin-badge">Visão complementar</span><h3>Títulos Baixados</h3><small>${settledDay ? `Dia ${settledDay}` : settledMonth ? `Mês ${settledMonth}` : "Padrão: dia anterior"}</small></div><div class="fin-actions"><button class="fin-button" data-export="settled">Exportar Excel completo</button><button class="fin-button primary" id="finRefresh">Atualizar tela</button></div></div>
    <div class="fin-date-filters"><label class="fin-filter-label" for="finSettledMonth"><span>Mês</span><input type="month" id="finSettledMonth" value="${escapeHtml(settledMonth)}"></label><label class="fin-filter-label" for="finSettledDay"><span>Dia específico</span><input type="date" id="finSettledDay" value="${escapeHtml(settledDay)}"></label><button class="fin-button" id="finSettledClear" type="button">Limpar (usar ontem)</button></div>
    <div class="fin-table-wrap"><table class="fin-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${payload.items.map(item => payableRow(item, true)).join("") || `<tr><td colspan="${headers.length}" class="fin-empty">Nenhum título baixado neste período.</td></tr>`}</tbody></table></div>${pager(payload)}`;
  bindCommon();
  document.getElementById("finSettledMonth").addEventListener("change", (event) => { settledMonth = event.target.value; settledDay = ""; currentPage = 1; loadView(); });
  document.getElementById("finSettledDay").addEventListener("change", (event) => { settledDay = event.target.value; currentPage = 1; loadView(); });
  document.getElementById("finSettledClear").addEventListener("click", () => { settledMonth = ""; settledDay = ""; currentPage = 1; loadView(); });
}

async function loadPurchases() {
  const payload = await request(`/purchases?page=${currentPage}&pageSize=50`);
  const headers = ["Pedido", "Emissão", "Fornecedor / Loja", "Condição", "Moeda", "Produto", "Qtd. pedida", "Qtd. recebida", "Saldo", "Valor unitário", "Valor total", "Valor em aberto"];
  const rows = payload.items.map(item => `<tr><td>${escapeHtml(item.order_number)} / ${escapeHtml(item.item_number)}</td><td>${escapeHtml(item.issue_date)}</td><td>${escapeHtml(item.supplier_code)} / ${escapeHtml(item.supplier_store)} · ${escapeHtml(item.supplier_name)}</td><td>${escapeHtml(item.payment_condition)}</td><td>${escapeHtml(item.currency)}</td><td>${escapeHtml(item.product_code)} · ${escapeHtml(item.product_description)}</td><td class="money">${number.format(item.ordered_quantity)}</td><td class="money">${number.format(item.received_quantity)}</td><td class="money">${number.format(item.open_quantity)}</td><td class="money">${money.format(item.unit_value)}</td><td class="money">${money.format(item.total_value)}</td><td class="money">${money.format(item.open_value)}</td></tr>`).join("");
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Visão complementar</span><h3>Pedidos de Compra em Aberto</h3><small>Tela: emitidos nos últimos 30 dias · Excel: tudo em aberto</small></div><button class="fin-button" data-export="purchases">Exportar Excel completo</button></div><div class="fin-table-wrap"><table class="fin-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="12" class="fin-empty">Nenhum pedido em aberto nos últimos 30 dias.</td></tr>`}</tbody></table></div>${pager(payload)}`;
  bindCommon();
}
async function loadBalances(selectedDate = "") {
  const payload = await request(`/balances${selectedDate ? `?date=${encodeURIComponent(selectedDate)}` : ""}`);
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Fechamento diário</span><h3>Saldo de Contas</h3></div></div><form class="fin-balance-form" id="finBalanceForm"><label class="fin-field"><span>Data do saldo</span><input type="date" name="date" value="${payload.date}" required></label><label class="fin-field"><span>Nome da conta</span><input name="accountName" placeholder="Ex.: Conta operacional" autocomplete="off" required></label><label class="fin-field"><span>Saldo atual</span><input name="value" type="number" step="0.01" placeholder="R$ 0,00" required></label><button class="fin-button primary">Salvar saldo</button></form><div class="fin-history">${payload.items.map(item => `<div class="fin-history-row"><span><strong>${escapeHtml(item.account_name)}</strong><br>${escapeHtml(item.recorded_by_name)} · ${new Date(item.recorded_at).toLocaleString("pt-BR")}</span><strong>${money.format(item.balance_value)}</strong></div>`).join("") || `<div class="fin-empty">Nenhum saldo informado para hoje.</div>`}</div>`;
  const formElement = document.getElementById("finBalanceForm");
  formElement.elements.date.addEventListener("change", event => loadBalances(event.target.value));
  formElement.addEventListener("submit", async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const balanceDate = form.get("date"); const accountName = form.get("accountName").trim(); await request("/balances", { method: "PUT", body: JSON.stringify({ date: balanceDate, accountKey: accountName.toLowerCase().replace(/\s+/g, "-"), accountName, value: Number(form.get("value")) }) }); await Promise.all([loadBalances(balanceDate), loadDashboard()]); });
}
async function loadAlerts(type) {
  const payload = await request(`/alerts?type=${type}&page=1&pageSize=50`);
  const headers = payableHeaders.slice(0, 14);
  document.getElementById("finContent").innerHTML = `<div class="fin-panel-head"><div><span class="fin-badge">Alertas</span><h3>${type === "new" ? "Novos lançamentos com vencimento próximo" : "Prazo curto concedido na entrada"}</h3></div><button class="fin-button" id="finBack">Voltar às contas a pagar</button></div><div class="fin-table-wrap"><table class="fin-table"><thead><tr>${headers.map(header => `<th>${header}</th>`).join("")}</tr></thead><tbody>${payload.items.map(item => payableRow(item).replace(/<td><select[\s\S]*?<\/td><\/tr>$/, "</tr>")).join("") || `<tr><td colspan="${headers.length}" class="fin-empty">Nenhum alerta deste tipo.</td></tr>`}</tbody></table></div>`;
  document.getElementById("finBack").addEventListener("click", () => { currentView = "payables"; currentPage = 1; loadView(); });
}
async function loadHistory(key) {
  const payload = await request(`/status-history?key=${encodeURIComponent(key)}`);
  document.getElementById("finHistory").innerHTML = payload.items.map(item => `<div class="fin-history-row"><span>${escapeHtml(item.previous_status)} → <strong>${escapeHtml(item.new_status)}</strong></span><span>${escapeHtml(item.changed_by_name)} · ${new Date(item.changed_at).toLocaleString("pt-BR")}</span></div>`).join("") || `<div class="fin-empty">Nenhuma alteração manual registrada.</div>`;
}
function exportColumns(view, items) {
  if (view === "purchases") return items.map(item => ({ Filial:item.branch,"Pedido de compra":item.order_number,Item:item.item_number,"Data de emissão":item.issue_date,"Fornecedor código":item.supplier_code,Loja:item.supplier_store,"Nome do fornecedor":item.supplier_name,CNPJ:item.supplier_tax_id,"Condição de pagamento":item.payment_condition,Moeda:item.currency,"Código produto":item.product_code,Produto:item.product_description,"Quantidade pedida":item.ordered_quantity,"Quantidade recebida":item.received_quantity,"Saldo quantidade":item.open_quantity,"Valor unitário":item.unit_value,"Valor total":item.total_value,"Valor em aberto":item.open_value }));
  return items.map(item => ({ Filial:item.branch,"Número do título":item.title_number,Tipo:item.title_type,Parcela:item.installment,Natureza:item.nature,"Número do fornecedor":item.supplier_code,"Loja fornecedor":item.supplier_store,"Nome do fornecedor":item.supplier_name,"Tipo de fornecedor":item.supplier_category,CNPJ:item.supplier_tax_id,"Data de emissão":item.issue_date,"Data de contabilização":item.accounting_date,Vencimento:item.due_date,"Vencimento real":item.actual_due_date,"Valor do título":item.original_value,Saldo:item.open_balance,"Status de baixa":item.status,"Data de baixa":item.settlement_date }));
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
  try { if (currentView === "payables") await loadOpenPayables(); else if (currentView === "settled") await loadSettled(); else if (currentView === "purchases") await loadPurchases(); else await loadBalances(); }
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
