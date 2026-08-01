/* =============================================================
   maintenance.js — Preventive Maintenance module
   =============================================================
   Owns: the PM Schedule page — Calendar (month/week), Today's PM,
   Upcoming PM, Overdue PM, the PM detail modal (checklist, engineer
   assignment, estimated time, Mark Complete), the PM compliance
   KPIs, and the automatic due/overdue reminder banner + nav badge.

   NOTE: PM checklists, engineer assignments, and the completion log
   persist to the browser's localStorage (see storage.js's
   lsGet/lsSet/loadPmDetails/savePmDetails/logPmCompletion) rather
   than the shared window.storage backend the rest of the app uses —
   this was an explicit requirement, so this data is per-device.
   Reminders are in-app only: a static page has no backend to send
   email/push/SMS, so the banner and badge simply appear whenever
   someone has the app open.

   Depends on: storage.js (state, persistence, EQUIPMENT_DATA,
   getData, getMaintenanceInfo, pmIntervalDays, canEdit/isAdmin,
   overrides + saveOverrides, timelines + saveTimelines — completing
   a PM logs an entry straight into the equipment's Profile
   Maintenance History via equipment.js's shared `timelines` state).
   ============================================================= */

/* ---------- PM domain helpers ---------- */
function getPmDetail(id){
  return { engineer: '', estimatedTime: '', checklist: [], ...(pmDetails[id] || {}) };
}
function ensurePmDetail(id){
  if(!pmDetails[id]) pmDetails[id] = { engineer: '', estimatedTime: '', checklist: [] };
  return pmDetails[id];
}
function ymd(date){
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

/* ---------- PM data (single source of truth: getMaintenanceInfo) ---------- */
function getPmScheduledEquipment(){
  return EQUIPMENT_DATA.filter(it => getMaintenanceInfo(it).state !== 'unknown');
}
function computePmStats(){
  const scheduled = getPmScheduledEquipment();
  const overdue = scheduled.filter(it => getMaintenanceInfo(it).state === 'overdue');
  const dueToday = scheduled.filter(it => getMaintenanceInfo(it).daysLeft === 0);
  const upcoming = scheduled.filter(it => { const dl = getMaintenanceInfo(it).daysLeft; return dl > 0 && dl <= 14; });
  const compliant = scheduled.length - overdue.length;
  const compliancePct = scheduled.length ? Math.round((compliant / scheduled.length) * 1000) / 10 : 100;
  return { scheduled, overdue, dueToday, upcoming, compliancePct };
}
function pmBucket(item){
  const info = getMaintenanceInfo(item);
  if(info.state === 'unknown') return null;
  if(info.daysLeft < 0) return 'overdue';
  if(info.daysLeft === 0) return 'due-today';
  return 'upcoming';
}
function getPmOccurrencesInRange(item, rangeStart, rangeEnd){
  const d = getData(item);
  const interval = pmIntervalDays(d.pm_schedule);
  if(!interval || !d.last_serviced) return [];
  const anchor = new Date(d.last_serviced + 'T00:00:00');
  if(isNaN(anchor.getTime())) return [];
  const occurrences = [];
  let occ = new Date(anchor.getTime() + interval * 86400000);
  let guard = 0;
  while(occ < rangeStart && guard < 5000){ occ = new Date(occ.getTime() + interval * 86400000); guard++; }
  while(occ <= rangeEnd && guard < 10000){
    occurrences.push(new Date(occ));
    occ = new Date(occ.getTime() + interval * 86400000);
    guard++;
  }
  return occurrences;
}
function getPmOccurrencesByDay(rangeStart, rangeEnd){
  const map = {};
  const today = new Date(); today.setHours(0, 0, 0, 0);
  EQUIPMENT_DATA.forEach(item => {
    getPmOccurrencesInRange(item, rangeStart, rangeEnd).forEach(date => {
      const key = ymd(date);
      let bucket = 'upcoming';
      if(date < today) bucket = 'overdue';
      else if(date.getTime() === today.getTime()) bucket = 'due-today';
      (map[key] = map[key] || []).push({ item, date, bucket });
    });
  });
  return map;
}

/* ---------- PM rendering ---------- */
function updatePmBadges(){
  const s = computePmStats();
  const total = s.overdue.length + s.dueToday.length;
  const badge = document.getElementById('pmTabBadge');
  if(badge){
    if(total > 0){ badge.textContent = total > 99 ? '99+' : String(total); badge.style.display = 'flex'; }
    else{ badge.style.display = 'none'; }
  }
  const scT = document.getElementById('scToday'); if(scT) scT.textContent = '(' + s.dueToday.length + ')';
  const scU = document.getElementById('scUpcoming'); if(scU) scU.textContent = '(' + s.upcoming.length + ')';
  const scO = document.getElementById('scOverdue'); if(scO) scO.textContent = '(' + s.overdue.length + ')';
}
function renderPmReminder(){
  const slot = document.getElementById('pmReminderSlot');
  if(!slot) return;
  const s = computePmStats();
  const total = s.overdue.length + s.dueToday.length;
  const dismissedDate = lsGet(LS_PM_REMINDER_DISMISS_KEY, null);
  if(total === 0 || dismissedDate === ymd(new Date())){ slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="pm-reminder">
      <div class="pr-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div class="pr-text">${s.overdue.length ? `<b>${s.overdue.length}</b> PM${s.overdue.length === 1 ? '' : 's'} overdue` : ''}${s.overdue.length && s.dueToday.length ? ' &amp; ' : ''}${s.dueToday.length ? `<b>${s.dueToday.length}</b> due today` : ''} — review the list below.</div>
      <div class="pr-dismiss" data-action="pm-dismiss-reminder">Dismiss for today</div>
    </div>`;
}
function renderPmKpis(){
  const s = computePmStats();
  const cards = [
    { num: s.compliancePct + '%', lbl: 'PM Compliance', cls: s.compliancePct >= 90 ? 'c-teal' : s.compliancePct >= 70 ? 'c-amber' : 'c-red' },
    { num: s.dueToday.length, lbl: 'PM Due Today', cls: 'c-amber' + (s.dueToday.length > 0 ? ' alert' : '') },
    { num: s.overdue.length, lbl: 'PM Overdue', cls: 'c-red' + (s.overdue.length > 0 ? ' alert' : '') },
    { num: s.upcoming.length, lbl: 'Upcoming (14 days)', cls: 'c-blue' },
  ];
  document.getElementById('pmKpiGrid').innerHTML = cards.map(c => `<div class="kpi-card ${c.cls}"><div class="kpi-num">${c.num}</div><div class="kpi-lbl">${c.lbl}</div></div>`).join('');
}
function renderPmSubtabs(){
  document.querySelectorAll('.pm-subtab').forEach(t => t.classList.toggle('active', t.dataset.pmview === pmActiveSubview));
}
function renderPmItemRow(item, bucket){
  const d = getData(item);
  const info = getMaintenanceInfo(item);
  const pd = getPmDetail(item.id);
  const badgeLabel = bucket === 'overdue' ? 'Overdue' : bucket === 'due-today' ? 'Due Today' : 'Upcoming';
  const dueStr = info.nextDue ? fmtShortDate(info.nextDue) : '—';
  const doneCount = pd.checklist.filter(c => c.done).length;
  const checklistNote = pd.checklist.length ? ` · Checklist ${doneCount}/${pd.checklist.length}` : '';
  return `
  <div class="pm-item ${bucket}" data-action="open-pm-detail" data-id="${escapeHtml(item.id)}">
    <div class="pi-main">
      <div class="pi-name">${escapeHtml(d.name)}</div>
      <div class="pi-meta">${escapeHtml(d.pm_schedule || '—')} · ${escapeHtml(d.provider || 'Unassigned')}${pd.engineer ? ' · Eng: ' + escapeHtml(pd.engineer) : ''} · Due ${escapeHtml(dueStr)}${checklistNote}</div>
    </div>
    <div class="pi-badge ${bucket}">${badgeLabel}</div>
  </div>`;
}
function renderPmListView(kind){
  const s = computePmStats();
  let items, bucket, emptyMsg;
  if(kind === 'today'){ items = s.dueToday; bucket = 'due-today'; emptyMsg = 'No PM due today.'; }
  else if(kind === 'upcoming'){ items = s.upcoming.slice().sort((a, b) => getMaintenanceInfo(a).daysLeft - getMaintenanceInfo(b).daysLeft); bucket = 'upcoming'; emptyMsg = 'No PM due in the next 14 days.'; }
  else { items = s.overdue.slice().sort((a, b) => getMaintenanceInfo(a).daysLeft - getMaintenanceInfo(b).daysLeft); bucket = 'overdue'; emptyMsg = 'No overdue PM — nice work.'; }
  if(!items.length) return `<div class="pm-empty">${emptyMsg}</div>`;
  return `<div class="pm-list">${items.map(it => renderPmItemRow(it, bucket)).join('')}</div>`;
}
function pmMonthLabel(date){ return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }
function pmWeekLabel(start, end){
  return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function getMonthRange(date){
  return { start: new Date(date.getFullYear(), date.getMonth(), 1), end: new Date(date.getFullYear(), date.getMonth() + 1, 0) };
}
function getWeekRange(date){
  const d = new Date(date); const day = d.getDay();
  const start = new Date(d); start.setDate(d.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start, end };
}
function renderPmCalendarShell(){
  return `
    <div class="pm-toolbar">
      <div class="pm-cal-nav">
        <button data-action="pm-cal-prev" type="button">‹</button>
        <div class="pm-cal-label" id="pmCalLabel"></div>
        <button data-action="pm-cal-next" type="button">›</button>
        <button data-action="pm-cal-today" type="button" style="width:auto; padding:0 10px; font-family:var(--mono); font-size:10px; text-transform:uppercase;">Today</button>
      </div>
      <div class="pm-cal-mode-toggle">
        <div class="pm-cal-mode-btn ${pmCalMode === 'month' ? 'active' : ''}" data-action="pm-cal-mode" data-mode="month">Month</div>
        <div class="pm-cal-mode-btn ${pmCalMode === 'week' ? 'active' : ''}" data-action="pm-cal-mode" data-mode="week">Week</div>
      </div>
    </div>
    <div id="pmCalBody"></div>
    <div id="pmDayPanel"></div>`;
}
function renderPmCalendarBody(){
  const labelEl = document.getElementById('pmCalLabel');
  const bodyEl = document.getElementById('pmCalBody');
  if(!bodyEl) return;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if(pmCalMode === 'month'){
    const { start, end } = getMonthRange(pmCalCursor);
    if(labelEl) labelEl.textContent = pmMonthLabel(pmCalCursor);
    const gridStart = new Date(start); gridStart.setDate(start.getDate() - start.getDay());
    const gridEnd = new Date(end); gridEnd.setDate(end.getDate() + (6 - end.getDay()));
    const occByDay = getPmOccurrencesByDay(gridStart, gridEnd);
    let html = '<div class="pm-cal-grid">';
    DOW.forEach(d => html += `<div class="pm-cal-dow">${d}</div>`);
    const cur = new Date(gridStart);
    while(cur <= gridEnd){
      const key = ymd(cur);
      const inMonth = cur.getMonth() === pmCalCursor.getMonth();
      const isToday = cur.getTime() === today.getTime();
      const isSel = pmSelectedDay === key;
      const occs = occByDay[key] || [];
      const buckets = new Set(occs.map(o => o.bucket));
      html += `<div class="pm-cal-day ${inMonth ? '' : 'outside'} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}" data-action="pm-cal-day-click" data-date="${key}">
        <div class="pm-cal-daynum">${cur.getDate()}</div>
        <div class="pm-cal-badges">${['overdue', 'due-today', 'upcoming'].filter(b => buckets.has(b)).map(b => `<span class="pm-cal-badge ${b}"></span>`).join('')}</div>
        ${occs.length ? `<div class="pm-cal-count">${occs.length} PM${occs.length === 1 ? '' : 's'}</div>` : ''}
      </div>`;
      cur.setDate(cur.getDate() + 1);
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  } else {
    const { start, end } = getWeekRange(pmCalCursor);
    if(labelEl) labelEl.textContent = pmWeekLabel(start, end);
    const occByDay = getPmOccurrencesByDay(start, end);
    let html = '<div class="pm-week-grid">';
    const cur = new Date(start);
    for(let i = 0; i < 7; i++){
      const key = ymd(cur);
      const isToday = cur.getTime() === today.getTime();
      const occs = (occByDay[key] || []).slice().sort((a, b) => getData(a.item).name < getData(b.item).name ? -1 : 1);
      html += `<div class="pm-week-day ${isToday ? 'today' : ''}">
        <div class="pm-week-day-head"><span>${DOW[cur.getDay()]}</span><span class="wd-date">${cur.getDate()}</span></div>
        ${occs.length ? occs.map(o => `<div class="pm-chip ${o.bucket}" data-action="open-pm-detail" data-id="${escapeHtml(o.item.id)}">${escapeHtml(getData(o.item).name)}</div>`).join('') : '<div style="font-size:10.5px;color:var(--text-faint);">—</div>'}
      </div>`;
      cur.setDate(cur.getDate() + 1);
    }
    html += '</div>';
    bodyEl.innerHTML = html;
  }
  renderPmDayPanel();
}
function renderPmDayPanel(){
  const panel = document.getElementById('pmDayPanel');
  if(!panel) return;
  if(!pmSelectedDay || pmCalMode !== 'month'){ panel.innerHTML = ''; return; }
  const sel = new Date(pmSelectedDay + 'T00:00:00');
  const occByDay = getPmOccurrencesByDay(sel, sel);
  const occs = (occByDay[pmSelectedDay] || []).slice().sort((a, b) => getData(a.item).name < getData(b.item).name ? -1 : 1);
  panel.innerHTML = `
    <div class="pm-daypanel">
      <div class="pm-daypanel-head">${sel.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
      ${occs.length ? `<div class="pm-list">${occs.map(o => renderPmItemRow(o.item, o.bucket)).join('')}</div>` : `<div class="pm-empty">No PM scheduled on this day.</div>`}
    </div>`;
}
function renderPmContent(){
  const el = document.getElementById('pmContent');
  if(pmActiveSubview === 'calendar'){
    el.innerHTML = renderPmCalendarShell();
    renderPmCalendarBody();
  } else {
    el.innerHTML = renderPmListView(pmActiveSubview);
  }
}
function renderPmPage(){
  renderPmReminder();
  renderPmKpis();
  renderPmSubtabs();
  renderPmContent();
  updatePmBadges();
}

/* ---------- PM calendar actions ---------- */
function pmCalPrev(){
  pmCalCursor = pmCalMode === 'month' ? new Date(pmCalCursor.getFullYear(), pmCalCursor.getMonth() - 1, 1) : new Date(pmCalCursor.getTime() - 7 * 86400000);
  renderPmCalendarBody();
}
function pmCalNext(){
  pmCalCursor = pmCalMode === 'month' ? new Date(pmCalCursor.getFullYear(), pmCalCursor.getMonth() + 1, 1) : new Date(pmCalCursor.getTime() + 7 * 86400000);
  renderPmCalendarBody();
}
function pmCalToday(){
  pmCalCursor = new Date();
  pmSelectedDay = ymd(new Date());
  renderPmCalendarBody();
}
function pmCalSetMode(mode){ pmCalMode = mode; renderPmContent(); }
function pmCalDayClick(dateStr){ pmSelectedDay = pmSelectedDay === dateStr ? null : dateStr; renderPmCalendarBody(); }

/* ---------- PM detail modal ---------- */
function openPmDetailModal(id){
  const item = EQUIPMENT_DATA.find(it => it.id === id);
  if(!item) return;
  pmDetailEquipId = id;
  pmDetailEditing = false;
  document.getElementById('pmDetailTitle').textContent = getData(item).name;
  renderPmDetailContent();
  document.getElementById('pmDetailOverlay').style.display = 'flex';
}
function closePmDetailModal(){
  document.getElementById('pmDetailOverlay').style.display = 'none';
  pmDetailEquipId = null;
  pmDetailEditing = false;
}
function renderPmDetailContent(){
  const item = EQUIPMENT_DATA.find(it => it.id === pmDetailEquipId);
  if(!item) return;
  const d = getData(item);
  const info = getMaintenanceInfo(item);
  const pd = getPmDetail(item.id);
  const bucket = pmBucket(item);
  const badgeLabel = bucket === 'overdue' ? 'Overdue' : bucket === 'due-today' ? 'Due Today' : bucket === 'upcoming' ? 'Upcoming' : 'Not Scheduled';
  const critClass = bucket === 'overdue' ? 'Critical' : bucket === 'due-today' ? 'High' : 'Low';
  const el = document.getElementById('pmDetailContent');

  const engineerRow = pmDetailEditing
    ? `<div class="pm-inline-edit"><input type="text" id="pmf-engineer" value="${escapeHtml(pd.engineer)}" placeholder="Assigned engineer"></div>`
    : `<span class="v">${escapeHtml(pd.engineer || '—')}</span><span class="pm-edit-toggle-inline" data-action="pm-edit-toggle">Edit</span>`;
  const estRow = pmDetailEditing
    ? `<div class="pm-inline-edit"><input type="text" id="pmf-estimated" value="${escapeHtml(pd.estimatedTime)}" placeholder="e.g. 2 hours"></div>`
    : `<span class="v">${escapeHtml(pd.estimatedTime || '—')}</span>`;

  el.innerHTML = `
    <div class="profile-section-title">PM Details</div>
    <div class="pm-detail-grid">
      <div class="pi-item"><span class="k">Equipment</span><span class="v">${escapeHtml(d.name)}</span></div>
      <div class="pi-item"><span class="k">Status</span><span class="crit-badge crit-${critClass}">${badgeLabel}</span></div>
      <div class="pi-item"><span class="k">Frequency</span><span class="v">${escapeHtml(d.pm_schedule || '—')}</span></div>
      <div class="pi-item"><span class="k">Contractor</span><span class="v">${escapeHtml(d.provider || '—')}</span></div>
      <div class="pi-item"><span class="k">Last Serviced</span><span class="v">${escapeHtml(d.last_serviced || '—')}</span></div>
      <div class="pi-item"><span class="k">Next Due</span><span class="v">${info.nextDue ? escapeHtml(fmtShortDate(info.nextDue)) : '—'}</span></div>
      <div class="pi-item"><span class="k">Engineer</span>${engineerRow}</div>
      <div class="pi-item"><span class="k">Estimated Time</span>${estRow}</div>
    </div>
    ${pmDetailEditing ? `<div class="profile-edit-actions"><button class="reset-btn" type="button" data-action="pm-edit-cancel">Cancel</button><button class="save-btn-lg" type="button" data-action="pm-edit-save">Save</button></div>` : ''}

    <div class="profile-section-title">Checklist</div>
    ${pd.checklist.length ? `
    <div class="pm-checklist">
      ${pd.checklist.map(c => `
        <div class="pm-check-row ${c.done ? 'done' : ''}">
          <input type="checkbox" data-action="pm-toggle-check" data-cid="${escapeHtml(c.id)}" ${c.done ? 'checked' : ''}>
          <span class="pm-check-text">${escapeHtml(c.text)}</span>
          <span class="pm-check-del" data-action="pm-del-check" data-cid="${escapeHtml(c.id)}" title="Remove">✕</span>
        </div>`).join('')}
    </div>` : `<div class="pm-checklist-empty">No checklist items yet.</div>`}
    <div class="pm-check-add">
      <input type="text" id="pmf-newcheck" placeholder="Add a checklist item…">
      <button type="button" data-action="pm-add-check">Add</button>
    </div>

    <button class="pm-complete-btn" type="button" data-action="pm-complete" data-id="${escapeHtml(item.id)}">Mark PM Complete</button>
    <div class="pm-complete-note">Sets Last Serviced to today, resets the checklist, and logs this PM to the equipment's Maintenance History.</div>
  `;
}
function startPmEdit(){ if(!isAdmin()) return; pmDetailEditing = true; renderPmDetailContent(); }
function cancelPmEdit(){ pmDetailEditing = false; renderPmDetailContent(); }
function savePmEdit(){
  if(!isAdmin()) return;
  const id = pmDetailEquipId;
  const detail = ensurePmDetail(id);
  const engEl = document.getElementById('pmf-engineer');
  const estEl = document.getElementById('pmf-estimated');
  detail.engineer = engEl ? engEl.value.trim() : detail.engineer;
  detail.estimatedTime = estEl ? estEl.value.trim() : detail.estimatedTime;
  savePmDetails();
  pmDetailEditing = false;
  renderPmDetailContent();
}
function togglePmCheck(cid){
  if(!canEdit()) return;
  const detail = ensurePmDetail(pmDetailEquipId);
  const c = detail.checklist.find(x => x.id === cid);
  if(!c) return;
  c.done = !c.done;
  savePmDetails();
  renderPmDetailContent();
}
function addPmCheckItem(){
  if(!isAdmin()) return;
  const input = document.getElementById('pmf-newcheck');
  const text = input ? input.value.trim() : '';
  if(!text) return;
  const detail = ensurePmDetail(pmDetailEquipId);
  detail.checklist.push({ id: 'CK-' + Date.now().toString(36).toUpperCase(), text, done: false });
  savePmDetails();
  renderPmDetailContent();
}
function delPmCheckItem(cid){
  if(!isAdmin()) return;
  const detail = ensurePmDetail(pmDetailEquipId);
  detail.checklist = detail.checklist.filter(c => c.id !== cid);
  savePmDetails();
  renderPmDetailContent();
}
async function completePm(id){
  if(!canEdit()) return;
  const item = EQUIPMENT_DATA.find(it => it.id === id);
  if(!item) return;
  const today = ymd(new Date());
  overrides[id] = { ...(overrides[id] || {}), last_serviced: today };
  await saveOverrides();
  const detail = ensurePmDetail(id);
  detail.checklist = detail.checklist.map(c => ({ ...c, done: false }));
  savePmDetails();
  logPmCompletion(id, { date: today, engineer: detail.engineer || '', at: new Date().toISOString() });
  timelines[id] = [...(timelines[id] || []), {
    id: 'TL-' + Date.now().toString(36).toUpperCase(),
    type: 'maintenance',
    date: today,
    title: 'Preventive maintenance completed',
    description: detail.checklist.length ? `Checklist: ${detail.checklist.length} item(s) verified.` : '',
    technician: detail.engineer || '',
    at: new Date().toISOString(),
  }];
  await saveTimelines();
  closePmDetailModal();
  if(currentView === 'pm') renderPmPage();
  if(currentView === 'dashboard') renderDashboard();
  if(currentView === 'equipment') render();
  updatePmBadges();
}
function dismissPmReminder(){
  lsSet(LS_PM_REMINDER_DISMISS_KEY, ymd(new Date()));
  renderPmReminder();
}

/* ---------- PM events ---------- */
document.addEventListener('click', (e) => {
  const pmTab = e.target.closest('[data-pmview]');
  if(pmTab){ pmActiveSubview = pmTab.dataset.pmview; pmSelectedDay = null; renderPmSubtabs(); renderPmContent(); return; }

  if(e.target.closest('[data-action="pm-dismiss-reminder"]')){ dismissPmReminder(); return; }

  const openPm = e.target.closest('[data-action="open-pm-detail"]');
  if(openPm){ openPmDetailModal(openPm.dataset.id); return; }
  if(e.target.closest('#pmDetailClose')){ closePmDetailModal(); return; }
  if(e.target.id === 'pmDetailOverlay'){ closePmDetailModal(); return; }

  if(e.target.closest('[data-action="pm-cal-prev"]')){ pmCalPrev(); return; }
  if(e.target.closest('[data-action="pm-cal-next"]')){ pmCalNext(); return; }
  if(e.target.closest('[data-action="pm-cal-today"]')){ pmCalToday(); return; }
  const modeBtn = e.target.closest('[data-action="pm-cal-mode"]');
  if(modeBtn){ pmCalSetMode(modeBtn.dataset.mode); return; }
  const dayCell = e.target.closest('[data-action="pm-cal-day-click"]');
  if(dayCell){ pmCalDayClick(dayCell.dataset.date); return; }

  if(e.target.closest('[data-action="pm-edit-toggle"]')){ startPmEdit(); return; }
  if(e.target.closest('[data-action="pm-edit-cancel"]')){ cancelPmEdit(); return; }
  if(e.target.closest('[data-action="pm-edit-save"]')){ savePmEdit(); return; }

  const checkToggle = e.target.closest('[data-action="pm-toggle-check"]');
  if(checkToggle){ togglePmCheck(checkToggle.dataset.cid); return; }
  if(e.target.closest('[data-action="pm-add-check"]')){ addPmCheckItem(); return; }
  const delCheck = e.target.closest('[data-action="pm-del-check"]');
  if(delCheck){ delPmCheckItem(delCheck.dataset.cid); return; }

  const completeBtn = e.target.closest('[data-action="pm-complete"]');
  if(completeBtn){ completePm(completeBtn.dataset.id); return; }
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && document.getElementById('pmDetailOverlay').style.display !== 'none'){
    closePmDetailModal();
  }
});

