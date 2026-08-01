/* =============================================================
   dashboard.js — Dashboard (landing page)
   =============================================================
   Owns: KPI cards, morning brief, critical alerts panel, critical
   systems overview, tower health, recent activity feed, and the
   dashboard's own click/keydown handling (including opening the
   Work Order modal, which is defined in workorders.js).

   Depends on: storage.js, equipment.js (getData/getStatus/towerOf/
   getMaintenanceInfo/jumpToEquipmentItem target elements),
   workorders.js (openWoModal/closeWoModal/submitWoModal/
   cycleWorkOrderStatus), maintenance.js (not directly called here,
   but PM-related dashboard KPIs route into it via app.js's setView).
   ============================================================= */

/* ---------- critical systems + KPI icon constants ---------- */
const CRITICAL_SYSTEMS = [
  { key:'fire',      label:'Fire Protection', mode:'derived', match: it => it.section === 'Fire Fighting Equipments' },
  { key:'elevators', label:'Elevators',       mode:'derived', match: it => it.section === 'Elevator System' },
  { key:'generator', label:'Generator',       mode:'derived', match: it => it.section === 'Generator Set Units' },
  { key:'water',     label:'Water Supply',    mode:'derived', match: it => it.section === 'Motors and Pumps' && !/^STP/i.test(it.name) },
  { key:'stp',       label:'STP',             mode:'derived', match: it => it.section === 'Motors and Pumps' && /^STP/i.test(it.name) },
  { key:'fdas',      label:'FDAS',            mode:'manual' },
  { key:'cctv',      label:'CCTV',            mode:'manual' },
  { key:'boom',      label:'Boom Barrier',    mode:'manual' },
];
const KPI_ICONS = {
  gauge: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><polyline points="12 12 16 8"/></svg>',
  check: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warn: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  clock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  clipboard: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>',
  tool: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
};
const DASH_TOWERS = ['Tower 1', 'Tower 2', 'Tower 3', 'Tower 4'];
function computeKPIs(){
  const counts = { operational: 0, attention: 0, down: 0 };
  EQUIPMENT_DATA.forEach(it => counts[getStatus(it.id).status]++);
  const total = EQUIPMENT_DATA.length;
  const availabilityPct = total ? Math.round((counts.operational / total) * 1000) / 10 : 0;
  const pmDueToday = EQUIPMENT_DATA.filter(it => {
    const m = getMaintenanceInfo(it);
    return m.state === 'due-soon' && m.daysLeft === 0;
  }).length;
  const pmOverdue = EQUIPMENT_DATA.filter(it => getMaintenanceInfo(it).state === 'overdue').length;
  const openWO = workOrders.filter(w => w.status === 'open').length;
  const waitingContractor = workOrders.filter(w => w.status === 'waiting_contractor').length;
  return { ...counts, total, availabilityPct, pmDueToday, pmOverdue, openWO, waitingContractor };
}
function deriveSystemStatus(sys){
  if(sys.mode === 'manual') return criticalSystemsStatus[sys.key] || 'operational';
  const items = EQUIPMENT_DATA.filter(sys.match);
  if(!items.length) return 'operational';
  let hasDown = false, hasAttention = false;
  items.forEach(it => {
    const s = getStatus(it.id).status;
    if(s === 'down') hasDown = true;
    else if(s === 'attention') hasAttention = true;
  });
  return hasDown ? 'down' : hasAttention ? 'attention' : 'operational';
}
function getActivityEntries(){
  const entries = [];
  Object.keys(statuses).forEach(id => {
    const s = statuses[id];
    const item = EQUIPMENT_DATA.find(it => it.id === id);
    const name = item ? getData(item).name : id;
    (s.history || []).forEach(h => {
      entries.push({ kind: 'status', status: h.status, name, note: h.note, at: h.at });
    });
  });
  workOrders.forEach(w => entries.push({ kind: 'wo', wo: w, at: w.createdAt }));
  entries.sort((a, b) => new Date(b.at) - new Date(a.at));
  return entries.slice(0, 25);
}

function renderBrief(){
  const k = computeKPIs();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pmPhrase = (k.pmDueToday + k.pmOverdue) > 0
    ? `<span class="brief-stat">${k.pmDueToday}</span> PM${k.pmDueToday === 1 ? '' : 's'} scheduled today${k.pmOverdue ? `, <span class="brief-stat">${k.pmOverdue}</span> overdue` : ''}.`
    : 'No PMs due today.';
  const criticalPhrase = k.down > 0
    ? `<span class="brief-stat">${k.down}</span> critical issue${k.down === 1 ? '' : 's'} require${k.down === 1 ? 's' : ''} immediate attention.`
    : 'No critical issues at this time.';
  document.getElementById('briefSection').innerHTML = `
    <div class="brief-card">
      <div class="brief-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></div>
      <div class="brief-text">
        <span class="brief-lead">${greeting}.</span>
        ${criticalPhrase} ${pmPhrase} Equipment availability is <span class="brief-stat">${k.availabilityPct}%</span>.
      </div>
      <div class="brief-time">${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    </div>`;
}
function renderKPIGrid(){
  const k = computeKPIs();
  const cards = [
    { kpi: 'availability', num: k.availabilityPct + '%', lbl: 'Equipment Availability', cls: 'c-teal', icon: 'gauge' },
    { kpi: 'operational', num: k.operational, lbl: 'Operational Equipment', cls: 'c-teal', icon: 'check' },
    { kpi: 'attention', num: k.attention, lbl: 'Needs Attention', cls: 'c-amber', icon: 'warn' },
    { kpi: 'down', num: k.down, lbl: 'Out of Service', cls: 'c-red' + (k.down > 0 ? ' alert' : ''), icon: 'x' },
    { kpi: 'pmToday', num: k.pmDueToday, lbl: 'PM Due Today', cls: 'c-blue', icon: 'clock' },
    { kpi: 'pmOverdue', num: k.pmOverdue, lbl: 'PM Overdue', cls: 'c-red' + (k.pmOverdue > 0 ? ' alert' : ''), icon: 'clock' },
    { kpi: 'openWO', num: k.openWO, lbl: 'Open Work Orders', cls: 'c-blue', icon: 'clipboard' },
    { kpi: 'waitingContractor', num: k.waitingContractor, lbl: 'Waiting Contractor', cls: 'c-amber', icon: 'tool' },
  ];
  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <div class="kpi-card ${c.cls}" data-action="kpi-click" data-kpi="${c.kpi}">
      <div class="kpi-icon">${KPI_ICONS[c.icon]}</div>
      <div class="kpi-num">${c.num}</div>
      <div class="kpi-lbl">${c.lbl}</div>
    </div>`).join('');
}
function renderAlerts(){
  const downItems = EQUIPMENT_DATA.filter(it => getStatus(it.id).status === 'down');
  const el = document.getElementById('alertsPanel');
  if(!downItems.length){
    el.innerHTML = '<div class="alerts-empty">No equipment currently out of service.</div>';
    return;
  }
  el.innerHTML = downItems.map(it => {
    const d = getData(it);
    const st = getStatus(it.id);
    return `
    <div class="alert-row" data-action="jump-equipment" data-id="${escapeHtml(it.id)}">
      <div class="dot"></div>
      <div class="alert-body">
        <div class="alert-name">${escapeHtml(d.name)}</div>
        <div class="alert-meta">${escapeHtml(d.code || it.id)} · ${escapeHtml(towerOf(d))}${st.note ? ' · ' + escapeHtml(st.note) : ''}</div>
      </div>
      <div class="alert-tag">Out of Service</div>
    </div>`;
  }).join('');
}
function renderSystemsGrid(){
  const el = document.getElementById('systemsGrid');
  el.innerHTML = CRITICAL_SYSTEMS.map(sys => {
    const status = deriveSystemStatus(sys);
    const cls = status === 'down' ? 'down' : status === 'attention' ? 'att' : 'op';
    const label = status === 'down' ? 'Down' : status === 'attention' ? 'Attention' : 'Operational';
    const action = sys.mode === 'manual'
      ? `data-action="cycle-system-status" data-system="${sys.key}" title="Click to update status"`
      : `data-action="dashboard-system-filter" data-system="${sys.key}" title="Click to view in Equipment Monitoring"`;
    return `
    <div class="system-card ${cls}" ${action}>
      <div class="sys-dot"></div>
      <div class="sys-name">${escapeHtml(sys.label)}</div>
      <div class="sys-status">${label}</div>
    </div>`;
  }).join('');
}
function renderTowerHealth(){
  const el = document.getElementById('towerHealthGrid');
  el.innerHTML = DASH_TOWERS.map(tw => {
    const units = EQUIPMENT_DATA.filter(it => towerOf(getData(it)) === tw);
    const total = units.length;
    const operational = units.filter(it => getStatus(it.id).status === 'operational').length;
    const pct = total ? Math.round((operational / total) * 100) : 0;
    const tier = pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad';
    return `
    <div class="th-card ${activeTower === tw ? 'active' : ''}" data-action="dashboard-tower-filter" data-tower="${escapeHtml(tw)}">
      <div class="th-top"><span class="th-name">${escapeHtml(tw)}</span><span class="th-pct ${tier}">${pct}%</span></div>
      <div class="bar-track"><div class="bar-fill ${tier}" style="width:${pct}%"></div></div>
      <div class="th-sub">${operational}/${total} operational</div>
    </div>`;
  }).join('');
}
function renderActivityFeed(){
  const entries = getActivityEntries();
  const el = document.getElementById('activityFeed');
  if(!entries.length){
    el.innerHTML = '<div class="activity-empty">No activity recorded yet.</div>';
    return;
  }
  el.innerHTML = entries.map(e => {
    if(e.kind === 'status'){
      const lbl = { operational: 'marked Operational', attention: 'flagged Needs Attention', down: 'marked Out of Service' }[e.status] || e.status;
      return `
      <div class="activity-row">
        <div class="a-dot ${e.status}"></div>
        <div class="a-body">
          <div class="a-text"><b>${escapeHtml(e.name)}</b> ${lbl}${e.note ? ' — ' + escapeHtml(e.note) : ''}</div>
          <div class="a-time">${fmtDate(e.at)}</div>
        </div>
      </div>`;
    }
    const w = e.wo;
    const typeLbl = w.type === 'breakdown' ? 'Breakdown reported' : 'Work order created';
    return `
    <div class="activity-row">
      <div class="a-dot wo"></div>
      <div class="a-body">
        <div class="a-text"><b>${escapeHtml(w.equipmentName)}</b> — ${typeLbl}${w.description ? ': ' + escapeHtml(w.description) : ''}</div>
        <div class="a-time">${fmtDate(e.at)} · <span class="wo-status-pill ${w.status}" data-action="cycle-wo-status" data-id="${escapeHtml(w.id)}">${w.status.replace('_', ' ')}</span></div>
      </div>
    </div>`;
  }).join('');
}
function renderDashboard(){
  renderBrief();
  renderKPIGrid();
  renderAlerts();
  renderSystemsGrid();
  renderTowerHealth();
  renderActivityFeed();
}
function updatePmFilterBanner(){
  const b = document.getElementById('pmFilterBanner');
  if(b) b.style.display = (currentView === 'equipment' && activePmFilter) ? 'flex' : 'none';
}

function jumpToEquipmentItem(id){
  const item = EQUIPMENT_DATA.find(it => it.id === id);
  if(!item) return;
  const d = getData(item);
  activeStatusFilter = 'all';
  activeTower = 'all';
  activeCategory = 'all';
  setView('equipment', { keepSearch: true });
  const term = (d.code || d.name).toLowerCase();
  const search = document.getElementById('searchInput');
  search.value = d.code || d.name;
  searchTerm = term;
  renderSections();
}
async function cycleSystemStatus(key){
  if(!canEdit()) return;
  const order = ['operational', 'attention', 'down'];
  const cur = criticalSystemsStatus[key] || 'operational';
  criticalSystemsStatus[key] = order[(order.indexOf(cur) + 1) % order.length];
  renderSystemsGrid();
  await saveCriticalSystems();
}
document.addEventListener('click', (e) => {
  const kpiCard = e.target.closest('[data-action="kpi-click"]');
  if(kpiCard){
    const kpi = kpiCard.dataset.kpi;
    if(kpi === 'operational' || kpi === 'availability'){ activeStatusFilter = 'operational'; setView('equipment'); }
    else if(kpi === 'attention'){ activeStatusFilter = 'attention'; setView('equipment'); }
    else if(kpi === 'down'){ activeStatusFilter = 'down'; setView('equipment'); }
    else if(kpi === 'pmToday'){ setView('pm', { pmSubview: 'today' }); }
    else if(kpi === 'pmOverdue'){ setView('pm', { pmSubview: 'overdue' }); }
    else if(kpi === 'openWO' || kpi === 'waitingContractor'){ document.getElementById('activityFeed').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const alertRow = e.target.closest('[data-action="jump-equipment"]');
  if(alertRow){ jumpToEquipmentItem(alertRow.dataset.id); return; }

  const sysFilter = e.target.closest('[data-action="dashboard-system-filter"]');
  if(sysFilter){
    const sys = CRITICAL_SYSTEMS.find(s => s.key === sysFilter.dataset.system);
    if(sys){
      activeStatusFilter = 'all'; activeTower = 'all';
      activeCategory = sys.key === 'water' || sys.key === 'stp'
        ? 'Motors and Pumps'
        : sys.key === 'fire' ? 'Fire Fighting Equipments'
        : sys.key === 'elevators' ? 'Elevator System'
        : sys.key === 'generator' ? 'Generator Set Units' : 'all';
      setView('equipment', { keepSearch: sys.key === 'water' || sys.key === 'stp' });
      if(sys.key === 'stp' || sys.key === 'water'){
        const search = document.getElementById('searchInput');
        const term = sys.key === 'stp' ? 'stp' : '';
        search.value = term;
        searchTerm = term;
        renderSections();
      }
    }
    return;
  }
  const sysCycle = e.target.closest('[data-action="cycle-system-status"]');
  if(sysCycle){ cycleSystemStatus(sysCycle.dataset.system); return; }

  const towerHealthCard = e.target.closest('[data-action="dashboard-tower-filter"]');
  if(towerHealthCard){
    activeTower = towerHealthCard.dataset.tower;
    activeStatusFilter = 'all'; activeCategory = 'all';
    setView('equipment');
    return;
  }

  const gotoView = e.target.closest('[data-action="goto-view"]');
  if(gotoView){ setView(gotoView.dataset.view); return; }

  const gotoPm = e.target.closest('[data-action="goto-pm"]');
  if(gotoPm){ setView('pm', { pmSubview: 'calendar' }); return; }

  const clearPm = e.target.closest('[data-action="clear-pm-filter"]');
  if(clearPm){ activePmFilter = false; render(); return; }

  const openWo = e.target.closest('[data-action="open-wo-modal"]');
  if(openWo){ openWoModal(openWo.dataset.type); return; }
  if(e.target.closest('#woClose') || e.target.closest('#woCancel')){ closeWoModal(); return; }
  if(e.target.id === 'woOverlay'){ closeWoModal(); return; }
  if(e.target.closest('#woSubmit')){ submitWoModal(); return; }

  const woCycle = e.target.closest('[data-action="cycle-wo-status"]');
  if(woCycle){ cycleWorkOrderStatus(woCycle.dataset.id); return; }
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && document.getElementById('woOverlay').style.display !== 'none'){
    closeWoModal();
  }
});

