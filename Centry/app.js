/* =============================================================
   app.js — Application shell: bootstrap, routing, login
   =============================================================
   Owns: login/role-gate wiring, the Settings ("Edit text") modal,
   view switching (setView) between Dashboard/Equipment/Parts/PM,
   the top-level render() dispatcher, the clock, the single
   delegated click handler that drives most of the UI (status
   buttons, chip filters, inline edit, compact/team-data toggles,
   section collapse, export menu, settings), the shared search-input
   listener (routes to Equipment or Parts search depending on the
   active view), switchDataMode (personal vs shared, reloads every
   feature's data), and app init.

   This file is loaded LAST (see index.html) so every function it
   calls from the other modules already exists in the shared global
   scope by the time its top-level login-button listeners attach.
   ============================================================= */

/* ---------- login / role-based access ---------- */
function selectLoginRole(role){
  selectedLoginRole = role;
  document.querySelectorAll('.role-opt').forEach(o => o.classList.toggle('active', o.dataset.role === role));
  document.getElementById('loginError').classList.remove('show');
}
function attemptLogin(){
  const pass = document.getElementById('loginPassword').value;
  if(pass !== ROLE_CREDENTIALS[selectedLoginRole]){
    document.getElementById('loginError').classList.add('show');
    return;
  }
  currentRole = selectedLoginRole;
  document.getElementById('loginError').classList.remove('show');
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'block';
  document.body.classList.remove('role-admin', 'role-technician', 'role-viewer');
  document.body.classList.add('role-' + currentRole);
  document.getElementById('roleBadgeLabel').textContent = ROLE_LABELS[currentRole];
}
function logout(){
  currentRole = null;
  document.body.classList.remove('role-admin', 'role-technician', 'role-viewer');
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginPassword').focus();
}
document.getElementById('roleSelect').addEventListener('click', (e) => {
  const opt = e.target.closest('.role-opt');
  if(opt) selectLoginRole(opt.dataset.role);
});
document.getElementById('loginSubmit').addEventListener('click', attemptLogin);
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if(e.key === 'Enter') attemptLogin();
});
document.addEventListener('click', (e) => {
  if(e.target.closest('#roleBadge')){ logout(); }
});

/* ---------- settings modal ---------- */
function renderSettingsForm(){
  const body = document.getElementById('settingsBody');
  const groups = [];
  TEXT_FIELDS.forEach(f => {
    let g = groups.find(x => x.name === f.group);
    if(!g){ g = { name: f.group, fields: [] }; groups.push(g); }
    g.fields.push(f);
  });
  body.innerHTML = groups.map(g => `
    <div>
      <h3 class="settings-group-title">${escapeHtml(g.name)}</h3>
      ${g.fields.map(f => `
        <div class="settings-field">
          <label for="set-${f.key}">${escapeHtml(f.label)}</label>
          <input id="set-${f.key}" data-settings-field="${f.key}" value="${escapeHtml(textSettings[f.key])}">
        </div>
      `).join('')}
    </div>
  `).join('');
}
let settingsSnapshot = null;
function openSettingsModal(){
  settingsSnapshot = { ...textSettings };
  renderSettingsForm();
  document.getElementById('settingsOverlay').style.display = 'flex';
}
function closeSettingsModal(){
  if(settingsSnapshot) textSettings = settingsSnapshot;
  settingsSnapshot = null;
  document.getElementById('settingsOverlay').style.display = 'none';
}
async function saveSettingsForm(){
  if(!isAdmin()) return;
  document.querySelectorAll('[data-settings-field]').forEach(inputEl => {
    textSettings[inputEl.dataset.settingsField] = inputEl.value;
  });
  applyTextSettings();
  settingsSnapshot = null;
  document.getElementById('settingsOverlay').style.display = 'none';
  await saveTextSettings();
}
function resetSettingsForm(){
  textSettings = { ...TEXT_DEFAULTS };
  renderSettingsForm();
}
function setView(view, opts){
  opts = opts || {};
  currentView = view;
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

  const isDash = view === 'dashboard';
  const isEquip = view === 'equipment';
  const isParts = view === 'parts';
  const isPm = view === 'pm';

  document.getElementById('dashboardPage').classList.toggle('showing', isDash);
  document.getElementById('pmPage').classList.toggle('showing', isPm);
  document.getElementById('appBody').style.display = (isDash || isPm) ? 'none' : '';
  document.getElementById('statsRow').style.display = isEquip ? '' : 'none';
  document.getElementById('partsStatsRow').style.display = isParts ? '' : 'none';
  document.getElementById('uptimeBlock').style.display = isEquip ? '' : 'none';
  document.getElementById('sidebarPanel').style.display = isEquip ? '' : 'none';
  document.getElementById('partsSidebarPanel').style.display = isParts ? '' : 'none';
  document.getElementById('sections').style.display = isEquip ? '' : 'none';
  document.getElementById('partsSections').style.display = isParts ? '' : 'none';
  document.getElementById('compactToggleWrap').style.display = isEquip ? '' : 'none';

  if(!opts.keepPmFilter) activePmFilter = false;

  const search = document.getElementById('searchInput');
  if(!opts.keepSearch){
    search.value = '';
    searchTerm = '';
    partsSearchTerm = '';
  }
  search.placeholder = isParts
    ? 'Search by equipment, part, or specification…'
    : 'Search by name, code, brand, model, serial…';

  updateFooterText();

  if(isDash) renderDashboard();
  else if(isEquip) render();
  else if(isPm){ if(opts.pmSubview) pmActiveSubview = opts.pmSubview; renderPmPage(); }
  else renderParts();

  updatePmFilterBanner();
  updatePmBadges();
}

/* ---------- render all ---------- */
function render(){
  renderStats();
  renderTowerUptime();
  renderStatusFilter();
  renderTowerTabs();
  renderCategoryTabs();
  renderSections();
  updatePmFilterBanner();
}

function tickClock(){
  const el = document.getElementById('clockLine');
  const now = new Date();
  el.textContent = now.toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric', year:'numeric' }) +
    ' · ' + now.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

document.addEventListener('click', (e) => {
  const viewTab = e.target.closest('.view-tab');
  if(viewTab){
    setView(viewTab.dataset.view);
    return;
  }

  const chip = e.target.closest('[data-role]');
  if(chip){
    const role = chip.dataset.role;
    if(role === 'status') activeStatusFilter = chip.dataset.status;
    if(role === 'tower') activeTower = chip.dataset.tower;
    if(role === 'cat') activeCategory = chip.dataset.cat;
    if(role === 'parttype'){ activePartType = chip.dataset.parttype; renderParts(); return; }
    render();
    return;
  }
  const btn = e.target.closest('[data-action="status"]');
  if(btn){
    setStatus(btn.dataset.id, { status: btn.dataset.value });
    return;
  }

  const pill = e.target.closest('[data-action="cycle-status"]');
  if(pill){
    const cur = getStatus(pill.dataset.id).status;
    const order = STATUS_DEFS.map(s => s.key);
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setStatus(pill.dataset.id, { status: next });
    return;
  }

  const toggleWrap = e.target.closest('#compactToggleWrap');
  if(toggleWrap){
    toggleCompactView();
    return;
  }

  const teamToggle = e.target.closest('#teamToggleWrap');
  if(teamToggle){
    switchDataMode();
    return;
  }

  const editStart = e.target.closest('[data-action="edit-start"]');
  if(editStart){
    if(!isAdmin()) return;
    editingIds.add(editStart.dataset.id);
    renderSections();
    return;
  }

  const editCancel = e.target.closest('[data-action="edit-cancel"]');
  if(editCancel){
    editingIds.delete(editCancel.dataset.id);
    renderSections();
    return;
  }

  const editSave = e.target.closest('[data-action="edit-save"]');
  if(editSave){
    saveEdit(editSave.dataset.id);
    return;
  }

  const panelTitle = e.target.closest('#sidebarPanelTitle');
  if(panelTitle){
    toggleSidebarPanel();
    return;
  }

  const partsPanelTitle = e.target.closest('#partsPanelTitle');
  if(partsPanelTitle){
    const panel = document.getElementById('partsSidebarPanel');
    const collapsed = panel.classList.toggle('collapsed');
    partsPanelTitle.setAttribute('aria-expanded', String(!collapsed));
    return;
  }

  const sectionHead = e.target.closest('[data-action="toggle-section"]');
  if(sectionHead){
    const sec = sectionHead.dataset.section;
    if(collapsedSections.has(sec)) collapsedSections.delete(sec);
    else collapsedSections.add(sec);
    renderSections();
    return;
  }

  const partSectionHead = e.target.closest('[data-action="toggle-part-section"]');
  if(partSectionHead){
    const sec = partSectionHead.dataset.section;
    if(collapsedPartSections.has(sec)) collapsedPartSections.delete(sec);
    else collapsedPartSections.add(sec);
    renderPartsSections();
    return;
  }

  if(e.target.closest('#settingsBtn')){
    openSettingsModal();
    return;
  }
  if(e.target.closest('#settingsClose')){
    closeSettingsModal();
    return;
  }
  if(e.target.id === 'settingsOverlay'){
    closeSettingsModal();
    return;
  }
  if(e.target.closest('#settingsSave')){
    saveSettingsForm();
    return;
  }
  if(e.target.closest('#settingsReset')){
    resetSettingsForm();
    return;
  }

  const uptimeCard = e.target.closest('[data-action="filter-tower"]');
  if(uptimeCard){
    activeTower = activeTower === uptimeCard.dataset.tower ? 'all' : uptimeCard.dataset.tower;
    render();
    return;
  }

  const logBtn = e.target.closest('[data-action="log-entry"]');
  if(logBtn){
    logHistoryEntry(logBtn.dataset.id);
    return;
  }

  const histToggle = e.target.closest('[data-action="toggle-history"]');
  if(histToggle){
    const plate = histToggle.closest('.plate');
    const list = plate.querySelector('.history-list');
    const open = list.style.display !== 'none';
    list.style.display = open ? 'none' : 'block';
    histToggle.classList.toggle('open', !open);
    return;
  }

  if(e.target.closest('#exportBtn')){
    toggleExportMenu();
    return;
  }
  const exportItem = e.target.closest('[data-action="export-excel"], [data-action="export-print"]');
  if(exportItem){
    toggleExportMenu(false);
    if(exportItem.dataset.action === 'export-excel') exportExcel();
    else exportPrint();
    return;
  }
  if(!e.target.closest('.export-wrap')){
    toggleExportMenu(false);
  }
});

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && document.getElementById('settingsOverlay').style.display !== 'none'){
    closeSettingsModal();
  }
});

document.addEventListener('keydown', (e) => {
  if(e.target.id === 'compactToggleWrap' && (e.key === 'Enter' || e.key === ' ')){
    e.preventDefault();
    toggleCompactView();
  }
  if(e.target.id === 'teamToggleWrap' && (e.key === 'Enter' || e.key === ' ')){
    e.preventDefault();
    switchDataMode();
  }
  if(e.target.id === 'sidebarPanelTitle' && (e.key === 'Enter' || e.key === ' ')){
    e.preventDefault();
    toggleSidebarPanel();
  }
});

async function switchDataMode(){
  if(!isAdmin()) return;
  dataMode = dataMode === 'personal' ? 'shared' : 'personal';
  const isShared = dataMode === 'shared';
  document.getElementById('teamToggleWrap').setAttribute('aria-checked', String(isShared));
  document.getElementById('teamToggle').classList.toggle('on', isShared);
  document.getElementById('teamBanner').style.display = isShared ? 'flex' : 'none';
  editingIds.clear();
  closeProfileModal();
  await Promise.all([loadStatuses(), loadOverrides(), loadCriticalSystems(), loadWorkOrders(), loadProfiles(), loadTimelines(), loadDocuments()]);
  if(currentView === 'dashboard') renderDashboard();
  else if(currentView === 'equipment') render();
  else renderParts();
}

let noteTimer = null;
document.addEventListener('input', (e) => {
  if(e.target.matches('[data-action="note"]')){
    const id = e.target.dataset.id;
    const val = e.target.value;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const current = getStatus(id);
      statuses[id] = { ...current, note: val, updatedAt: new Date().toISOString() };
      saveStatuses();
      // update only the timestamp label without full re-render, to avoid losing focus
      const plate = e.target.closest('.plate');
      const tag = plate.querySelector('.updated-tag');
      if(tag) tag.textContent = fmtDate(statuses[id].updatedAt);
    }, 600);
  }
  if(e.target.id === 'searchInput'){
    if(currentView === 'equipment'){
      searchTerm = e.target.value.trim().toLowerCase();
      renderSections();
    }else{
      partsSearchTerm = e.target.value.trim().toLowerCase();
      renderPartsSections();
    }
  }
});

(async function init(){
  tickClock();
  setInterval(tickClock, 30000);
  loadPmDetails();
  await loadCoreData();
  await Promise.all([
    loadStatuses(), loadOverrides(), loadTextSettings(),
    loadCriticalSystems(), loadWorkOrders(),
    loadProfiles(), loadTimelines(), loadDocuments(),
  ]);
  applyTextSettings();
  setView('dashboard');
})();

