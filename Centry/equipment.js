/* =============================================================
   equipment.js — Equipment Monitoring + Equipment Profile
   =============================================================
   Owns: the Equipment Monitoring list (stats, filters, tower/
   category tabs, plate & compact-row rendering, inline edit,
   status cycling, note/log entries) and the Equipment Profile
   modal (Overview / Maintenance / Failure / Inspection / Parts
   Used / Documents tabs, criticality, QR code, related parts).

   Depends on: storage.js (state, persistence, EQUIPMENT_DATA,
   PARTS_DATA, canEdit/isAdmin, core helpers). Loaded via a plain
   <script> tag (not an ES module) so it shares storage.js's global
   scope directly — see index.html for load order.
   ============================================================= */

/* ---------- status mutation ---------- */
async function setStatus(id, patch){
  if(!canEdit()) return;
  const current = getStatus(id);
  const now = new Date().toISOString();
  const nextStatus = patch.status || current.status;
  const history = [...(current.history || [])];
  if(patch.status && patch.status !== current.status){
    history.push({ status: nextStatus, note: current.note || '', at: now });
  }
  statuses[id] = { ...current, ...patch, history, updatedAt: now };
  render();
  await saveStatuses();
}
async function logHistoryEntry(id){
  if(!canEdit()) return;
  const current = getStatus(id);
  const history = [...(current.history || []), { status: current.status, note: current.note || '', at: new Date().toISOString() }];
  statuses[id] = { ...current, history };
  renderSections();
  await saveStatuses();
}

/* ---------- filtering ---------- */
// scopeFilter = everything except the status chip (tower / category / search).
// Used for the stats strip, so it reflects "what am I looking at" without
// the status breakdown collapsing to a single bucket.
function scopeFilter(item){
  const d = getData(item);
  if(activeTower !== 'all' && towerOf(d) !== activeTower) return false;
  if(activeCategory !== 'all' && item.section !== activeCategory) return false;
  if(searchTerm){
    const hay = [d.name, d.code, d.brand, d.model, d.type, d.serial]
      .join(' ').toLowerCase();
    if(!hay.includes(searchTerm)) return false;
  }
  return true;
}
function matches(item){
  if(activeStatusFilter !== 'all' && getStatus(item.id).status !== activeStatusFilter) return false;
  if(activePmFilter){
    const st = getMaintenanceInfo(item).state;
    if(st !== 'overdue' && st !== 'due-soon') return false;
  }
  return scopeFilter(item);
}

/* ---------- render: stats ---------- */
function renderStats(){
  const scoped = EQUIPMENT_DATA.filter(scopeFilter);
  const counts = { operational: 0, attention: 0, down: 0 };
  scoped.forEach(it => { counts[getStatus(it.id).status]++; });
  const totalHp = scoped.reduce((s,it) => {
    const hp = getData(it).capacity_hp;
    return s + (typeof hp === 'number' ? hp : 0);
  }, 0);
  const overdueCount = scoped.filter(it => getMaintenanceInfo(it).state === 'overdue').length;

  const isFiltered = activeTower !== 'all' || activeCategory !== 'all' || !!searchTerm;
  const scopeNote = isFiltered ? `<span class="scope-note">of ${EQUIPMENT_DATA.length}</span>` : '';

  const cards = [
    { cls:'', num: scoped.length, lbl: 'Total units', extra: scopeNote },
    { cls:'op', num: counts.operational, lbl: 'Operational' },
    { cls:'att', num: counts.attention, lbl: 'Needs attention' },
    { cls:'down', num: counts.down, lbl: 'Down' },
    { cls: overdueCount ? 'down' : '', num: overdueCount, lbl: 'PM overdue' },
    { cls:'', num: Math.round(totalHp).toLocaleString(), lbl: 'Total capacity (HP)' },
  ];
  document.getElementById('statsRow').innerHTML = cards.map(c => `
    <div class="stat-card ${c.cls}">
      <div class="num">${c.num} ${c.extra || ''}</div>
      <div class="lbl">${c.lbl}</div>
    </div>`).join('');
}

/* ---------- render: tower uptime dashboard ---------- */
const UPTIME_TOWERS = ['Tower 1', 'Tower 2', 'Tower 3', 'Tower 4', 'Common'];
function renderTowerUptime(){
  const el = document.getElementById('uptimeGrid');
  el.innerHTML = UPTIME_TOWERS.map(tw => {
    const units = EQUIPMENT_DATA.filter(it => {
      if(activeCategory !== 'all' && it.section !== activeCategory) return false;
      return towerOf(getData(it)) === tw;
    });
    const total = units.length;
    const operational = units.filter(it => getStatus(it.id).status === 'operational').length;
    const pct = total ? Math.round((operational / total) * 100) : null;
    const tier = pct === null ? '' : pct >= 90 ? 'good' : pct >= 70 ? 'warn' : 'bad';
    return `
      <div class="tower-card ${activeTower === tw ? 'active' : ''}" data-action="filter-tower" data-tower="${escapeHtml(tw)}">
        <div class="t-name">${escapeHtml(tw)}</div>
        <div class="pct ${tier}">${pct === null ? '—' : pct + '%'}</div>
        <div class="bar-track"><div class="bar-fill ${tier}" style="width:${pct === null ? 0 : pct}%"></div></div>
        <div class="sub-count">${total ? `${operational}/${total} operational` : 'No units'}</div>
      </div>`;
  }).join('');
}

/* ---------- render: filter controls ---------- */
function renderStatusFilter(){
  const el = document.getElementById('statusFilter');
  const all = [{key:'all', label:'All statuses'}, ...STATUS_DEFS];
  el.innerHTML = all.map(s => `
    <div class="chip ${activeStatusFilter === s.key ? 'active' : ''}" data-status="${s.key}" data-role="status">${s.label}</div>
  `).join('');
}
function renderTowerTabs(){
  const towers = ['all', 'Tower 1', 'Tower 2', 'Tower 3', 'Tower 4', 'Common'];
  document.getElementById('towerTabs').innerHTML = towers.map(t => `
    <div class="chip ${activeTower === t ? 'active' : ''}" data-tower="${t}" data-role="tower">${t === 'all' ? 'All towers' : t}</div>
  `).join('');
}
function renderCategoryTabs(){
  const cats = ['all', ...SECTION_ORDER];
  document.getElementById('categoryTabs').innerHTML = cats.map(c => `
    <div class="chip ${activeCategory === c ? 'active' : ''}" data-cat="${c}" data-role="cat">${c === 'all' ? 'All categories' : SECTION_LABEL[c]}</div>
  `).join('');
}

function renderPlate(item){
  const d = getData(item);
  const st = getStatus(item.id);
  const isEditing = editingIds.has(item.id);

  if(isEditing){
    return `
    <div class="plate" data-id="${escapeHtml(item.id)}">
      <span class="bolt-tl"></span><span class="bolt-tr"></span><span class="bolt-bl"></span><span class="bolt-br"></span>
      <div class="plate-head">
        <div class="plate-code">${escapeHtml(item.id)}</div>
        <div class="edit-btn is-editing" data-action="edit-cancel" data-id="${escapeHtml(item.id)}" title="Cancel edit">✕</div>
      </div>
      <input class="edit-field name-field" data-field="name" value="${escapeHtml(d.name)}" placeholder="Equipment name">
      <div class="edit-grid">
        ${EDITABLE_FIELDS.filter(f => f.key !== 'name').map(f => `
          <label>
            <span class="k">${f.label}</span>
            <input class="edit-field" type="${f.type === 'date' ? 'date' : 'text'}" data-field="${f.key}" value="${escapeHtml(d[f.key])}">
          </label>
        `).join('')}
      </div>
      <div class="edit-actions">
        <button class="cancel-btn" data-action="edit-cancel" data-id="${escapeHtml(item.id)}">Cancel</button>
        <button class="save-btn" data-action="edit-save" data-id="${escapeHtml(item.id)}">Save changes</button>
      </div>
    </div>`;
  }

  const maint = getMaintenanceInfo(item);
  const maintLabel = {
    overdue: 'PM overdue', 'due-soon': 'PM due soon', ok: 'PM on track', unknown: 'No PM date logged'
  }[maint.state];
  const maintSub = maint.nextDue ? `Next due ${fmtShortDate(maint.nextDue)}` : 'Set a last-serviced date to track this';
  const history = getStatus(item.id).history || [];

  return `
  <div class="plate" data-id="${escapeHtml(item.id)}">
    <span class="bolt-tl"></span><span class="bolt-tr"></span><span class="bolt-bl"></span><span class="bolt-br"></span>
    <div class="plate-head">
      <div class="plate-code">${escapeHtml(d.code || item.id)}</div>
      <div class="plate-head-actions">
        <div class="profile-btn" data-action="open-profile" data-id="${escapeHtml(item.id)}" title="Open equipment profile">Profile</div>
        <div class="edit-btn" data-action="edit-start" data-id="${escapeHtml(item.id)}" title="Edit details">✎</div>
      </div>
    </div>
    <div class="plate-name">${escapeHtml(d.name)}</div>
    <div class="meta-grid">
      <div><span class="k">Brand</span><span class="v">${escapeHtml(d.brand || '—')}</span></div>
      <div><span class="k">Capacity</span><span class="v">${d.capacity_hp !== '' && d.capacity_hp !== null ? d.capacity_hp + ' HP' : '—'}</span></div>
      <div><span class="k">Model</span><span class="v">${escapeHtml(d.model || '—')}</span></div>
      <div><span class="k">Serial</span><span class="v">${escapeHtml(d.serial || '—')}</span></div>
      <div><span class="k">Provider</span><span class="v">${escapeHtml(d.provider || '—')}</span></div>
      <div><span class="k">Type</span><span class="v">${escapeHtml(d.type || '—')}</span></div>
    </div>
    <div class="maint-badge maint-${maint.state}">
      <span class="maint-dot"></span>
      <span class="maint-txt">${maintLabel} <span class="maint-sub">· ${maintSub}</span></span>
    </div>
    <div class="status-row">
      ${STATUS_DEFS.map(s => `<div class="status-btn ${st.status === s.key ? 'sel-' + s.key : ''}" data-action="status" data-id="${escapeHtml(item.id)}" data-value="${s.key}">${s.label}</div>`).join('')}
    </div>
    <div class="note-row">
      <textarea class="note-area" placeholder="Add a note (e.g. part replaced, technician, findings)…" data-action="note" data-id="${escapeHtml(item.id)}">${escapeHtml(st.note)}</textarea>
      <div class="log-btn" data-action="log-entry" data-id="${escapeHtml(item.id)}" title="Save this note as a dated history entry">Log entry</div>
    </div>
    <div class="plate-foot">
      <span class="updated-tag">${fmtDate(st.updatedAt)}</span>
      <span class="pm-tag">PM: ${escapeHtml(d.pm_schedule || '—')}</span>
    </div>
    ${history.length ? `
      <div class="history-toggle" data-action="toggle-history" data-id="${escapeHtml(item.id)}">History (${history.length}) <svg class="hist-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg></div>
      <div class="history-list" style="display:none">
        ${history.slice().reverse().map(h => `
          <div class="history-item">
            <span class="hist-dot st-${h.status}"></span>
            <span class="hist-date">${fmtDate(h.at)}</span>
            <span class="hist-note">${escapeHtml(h.note || '—')}</span>
          </div>
        `).join('')}
      </div>` : ''}
  </div>`;
}

function renderCompactRow(item){
  const d = getData(item);
  const st = getStatus(item.id);
  const label = STATUS_DEFS.find(s => s.key === st.status)?.label || st.status;
  return `
  <div class="compact-row st-${st.status}">
    <div class="names">
      <div class="nm">${escapeHtml(d.name)}</div>
      <div class="cd">${escapeHtml(d.code || item.id)}</div>
    </div>
    <div class="status-pill pill-${st.status}" data-action="cycle-status" data-id="${escapeHtml(item.id)}">${label}</div>
    <div class="profile-btn" data-action="open-profile" data-id="${escapeHtml(item.id)}" title="Open equipment profile">Profile</div>
  </div>`;
}

function renderSections(){
  const container = document.getElementById('sections');
  const filtered = EQUIPMENT_DATA.filter(matches);

  if(filtered.length === 0){
    container.innerHTML = `<div class="empty-state">No equipment matches the current filters.</div>`;
    return;
  }

  const order = activeCategory === 'all' ? SECTION_ORDER : [activeCategory];
  let html = '';
  order.forEach(sec => {
    const items = filtered.filter(it => it.section === sec);
    if(items.length === 0) return;
    const isCollapsed = collapsedSections.has(sec);
    html += `
      <div class="section-block ${isCollapsed ? 'collapsed' : ''}" data-section="${sec}">
        <div class="section-head" data-action="toggle-section" data-section="${sec}">
          <span class="section-numeral">${SECTION_NUMERAL[sec]}</span>
          <h2>${SECTION_LABEL[sec]}</h2>
          <span class="section-count">${items.length} unit${items.length === 1 ? '' : 's'}</span>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-body">
          ${compactView
            ? `<div class="compact-list">${items.map(renderCompactRow).join('')}</div>`
            : `<div class="grid">${items.map(renderPlate).join('')}</div>`}
        </div>
      </div>`;
  });
  container.innerHTML = html || `<div class="empty-state">No equipment matches the current filters.</div>`;
}

function toggleSidebarPanel(){
  const panel = document.getElementById('sidebarPanel');
  const collapsed = panel.classList.toggle('collapsed');
  document.getElementById('sidebarPanelTitle').setAttribute('aria-expanded', String(!collapsed));
}

async function saveEdit(id){
  if(!isAdmin()) return;
  const plate = document.querySelector(`.plate[data-id="${CSS.escape(id)}"]`);
  if(!plate) return;
  const patch = {};
  plate.querySelectorAll('[data-field]').forEach(inputEl => {
    const field = inputEl.dataset.field;
    let val = inputEl.value.trim();
    if(field === 'capacity_hp' && val !== ''){
      const num = parseFloat(val);
      val = isNaN(num) ? val : num;
    }
    patch[field] = val;
  });
  overrides[id] = { ...(overrides[id] || {}), ...patch };
  editingIds.delete(id);
  renderSections();
  await saveOverrides();
}

function toggleCompactView(){
  compactView = !compactView;
  const wrap = document.getElementById('compactToggleWrap');
  const toggle = document.getElementById('compactToggle');
  wrap.setAttribute('aria-checked', String(compactView));
  toggle.classList.toggle('on', compactView);
  renderSections();
}

const PROFILE_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'maintenance', label: 'Maintenance History' },
  { key: 'failure', label: 'Failure History' },
  { key: 'inspection', label: 'Inspection History' },
  { key: 'parts', label: 'Parts Used' },
  { key: 'documents', label: 'Documents' },
];
const TIMELINE_TYPE_LABEL = { maintenance: 'Maintenance', failure: 'Failure', inspection: 'Inspection', parts: 'Part Used', note: 'Note' };
function getProfile(id){
  return { criticality: 'Medium', location: '', dateInstalled: '', warranty: '', supplier: '', photo: '', ...(profiles[id] || {}) };
}
function getTimeline(id){
  return (timelines[id] || []).slice().sort((a, b) => new Date(b.date || b.at) - new Date(a.date || a.at));
}
function getDocuments(id){
  return (documents[id] || []).slice().sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}
function findRelatedParts(item){
  const d = getData(item);
  const skip = ['pump', 'tower', 'unit', 'fan', 'the', 'and'];
  const nameWords = d.name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !skip.includes(w));
  if(!nameWords.length) return [];
  const scored = PARTS_DATA.map(p => {
    const eq = (p.equipment || '').toLowerCase();
    const score = nameWords.reduce((s, w) => s + (eq.includes(w) ? 1 : 0), 0);
    return { p, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map(x => x.p);
}

function renderProfileHeader(item){
  const d = getData(item);
  const st = getStatus(item.id);
  const p = getProfile(item.id);
  const statusLabel = STATUS_DEFS.find(s => s.key === st.status)?.label || st.status;
  document.getElementById('profileHeader').innerHTML = `
    <div class="profile-photo" data-action="profile-set-photo" data-id="${escapeHtml(item.id)}" title="Click to set a photo URL">
      ${p.photo ? `<img src="${escapeHtml(p.photo)}" alt="">` : `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`}
    </div>
    <div class="profile-heading">
      <div class="p-name">${escapeHtml(d.name)}</div>
      <div class="p-id">${escapeHtml(d.code || item.id)} · ${escapeHtml(item.section)}</div>
      <div class="profile-badges">
        <div class="status-pill pill-${st.status}" data-action="cycle-status" data-id="${escapeHtml(item.id)}" style="cursor:pointer;">${statusLabel}</div>
        <div class="crit-badge crit-${escapeHtml(p.criticality)}" data-action="cycle-criticality" data-id="${escapeHtml(item.id)}" title="Click to change criticality">${escapeHtml(p.criticality)}</div>
      </div>
    </div>
    <div>
      <div class="profile-qr" id="profileQr"></div>
      <div class="profile-qr-label">${escapeHtml(d.code || item.id)}</div>
    </div>`;
  const qrBox = document.getElementById('profileQr');
  if(qrBox && window.QRCode){
    try{ new QRCode(qrBox, { text: 'EQUIP:' + (d.code || item.id), width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M }); }
    catch(e){ qrBox.textContent = d.code || item.id; }
  } else if(qrBox){
    qrBox.textContent = d.code || item.id;
  }
}
function renderProfileTabs(){
  document.getElementById('profileTabs').innerHTML = PROFILE_TABS.map(t => `
    <div class="profile-tab ${profileActiveTab === t.key ? 'active' : ''}" data-action="profile-tab" data-tab="${t.key}">${t.label}</div>
  `).join('');
}
function renderTimelineItemHtml(entry, showDelete){
  const typeLbl = TIMELINE_TYPE_LABEL[entry.type] || entry.type;
  const dateStr = entry.date ? new Date(entry.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : fmtDate(entry.at);
  const metaParts = [];
  if(entry.technician) metaParts.push('Tech: ' + entry.technician);
  if(entry.partName) metaParts.push(`Part: ${entry.partName}${entry.qty ? (' x' + entry.qty) : ''}`);
  return `
  <div class="tl-item tl-${entry.type}">
    ${showDelete ? `<span class="tl-del" data-action="delete-timeline-entry" data-id="${escapeHtml(entry.id)}">Delete</span>` : ''}
    <div class="tl-date">${escapeHtml(dateStr)} · ${escapeHtml(typeLbl)}</div>
    <div class="tl-title">${escapeHtml(entry.title || typeLbl)}</div>
    ${entry.description ? `<div class="tl-desc">${escapeHtml(entry.description)}</div>` : ''}
    ${metaParts.length ? `<div class="tl-meta">${escapeHtml(metaParts.join(' · '))}</div>` : ''}
  </div>`;
}
function renderProfileOverview(item){
  const d = getData(item);
  const p = getProfile(item.id);
  const related = findRelatedParts(item);
  const recentEntries = getTimeline(item.id).slice(0, 5);
  if(profileEditing){
    return `
    <div class="profile-section-title">Edit Profile Details</div>
    <div class="profile-edit-grid">
      <label><span class="k">Location</span><input type="text" id="pf-location" value="${escapeHtml(p.location)}" placeholder="e.g. Roof Deck, Tower 2"></label>
      <label><span class="k">Date Installed</span><input type="date" id="pf-dateInstalled" value="${escapeHtml(p.dateInstalled)}"></label>
      <label><span class="k">Warranty</span><input type="text" id="pf-warranty" value="${escapeHtml(p.warranty)}" placeholder="e.g. Until Dec 2027"></label>
      <label><span class="k">Supplier</span><input type="text" id="pf-supplier" value="${escapeHtml(p.supplier)}" placeholder="e.g. ABC Trading Corp"></label>
      <label><span class="k">Criticality</span>
        <select id="pf-criticality">${CRITICALITY_LEVELS.map(c => `<option value="${c}" ${p.criticality === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <label><span class="k">Photo URL</span><input type="text" id="pf-photo" value="${escapeHtml(p.photo)}" placeholder="https://…"></label>
    </div>
    <div class="profile-edit-actions">
      <button class="reset-btn" type="button" data-action="profile-cancel-edit">Cancel</button>
      <button class="save-btn-lg" type="button" data-action="profile-save-edit" data-id="${escapeHtml(item.id)}">Save changes</button>
    </div>`;
  }
  return `
    <div class="profile-section-title">Equipment Information <span class="profile-edit-toggle" data-action="profile-start-edit">Edit</span></div>
    <div class="profile-info-grid">
      <div class="pi-item"><span class="k">Tower</span><span class="v">${escapeHtml(towerOf(d))}</span></div>
      <div class="pi-item"><span class="k">Location</span><span class="v">${escapeHtml(p.location || '—')}</span></div>
      <div class="pi-item"><span class="k">Category</span><span class="v">${escapeHtml(item.section)}</span></div>
      <div class="pi-item"><span class="k">Brand</span><span class="v">${escapeHtml(d.brand || '—')}</span></div>
      <div class="pi-item"><span class="k">Model</span><span class="v">${escapeHtml(d.model || '—')}</span></div>
      <div class="pi-item"><span class="k">Serial Number</span><span class="v">${escapeHtml(d.serial || '—')}</span></div>
      <div class="pi-item"><span class="k">Date Installed</span><span class="v">${p.dateInstalled ? escapeHtml(p.dateInstalled) : '—'}</span></div>
      <div class="pi-item"><span class="k">Warranty</span><span class="v">${escapeHtml(p.warranty || '—')}</span></div>
      <div class="pi-item"><span class="k">Supplier</span><span class="v">${escapeHtml(p.supplier || '—')}</span></div>
      <div class="pi-item"><span class="k">Service Contractor</span><span class="v">${escapeHtml(d.provider || '—')}</span></div>
      <div class="pi-item"><span class="k">PM Schedule</span><span class="v">${escapeHtml(d.pm_schedule || '—')}${d.pm_schedule ? ` <span class="profile-edit-toggle" data-action="open-pm-detail" data-id="${escapeHtml(item.id)}" style="margin-left:6px;">Open PM</span>` : ''}</span></div>
      <div class="pi-item"><span class="k">Capacity</span><span class="v">${d.capacity_hp !== '' && d.capacity_hp !== null ? d.capacity_hp + ' HP' : '—'}</span></div>
    </div>

    <div class="profile-section-title">Spare Parts <span class="profile-edit-toggle" data-action="goto-view" data-view="parts">Open Catalog</span></div>
    ${related.length ? `
      <div class="related-note">Suggested matches from the Parts Catalog, based on equipment name.</div>
      <div class="related-parts-list">
        ${related.map(p2 => `<div class="rp-card"><div class="rp-name">${escapeHtml(p2.part)}</div><div class="rp-spec">${escapeHtml(p2.spec || '—')}</div><div class="rp-qty">Qty ${p2.qty ?? '—'} · ${escapeHtml(p2.equipment)}</div></div>`).join('')}
      </div>` : `<div class="tl-empty">No matching parts found in the catalog for this equipment.</div>`}

    <div class="profile-section-title">Recent Timeline</div>
    ${recentEntries.length ? `<div class="tl-list">${recentEntries.map(e => renderTimelineItemHtml(e, false)).join('')}</div>` : `<div class="tl-empty">No history logged yet. Use the tabs above to add maintenance, failure, or inspection records.</div>`}
  `;
}
function renderTimelineForm(type){
  const isParts = type === 'parts';
  const today = new Date().toISOString().slice(0, 10);
  return `
  <div class="tl-form">
    <div><label>Date<input type="date" id="tlf-date" value="${today}"></label></div>
    <div><label>Technician<input type="text" id="tlf-technician" placeholder="Name (optional)"></label></div>
    ${isParts ? `
    <div><label>Part Name<input type="text" id="tlf-partName" placeholder="e.g. V-Belt SPB-3600"></label></div>
    <div><label>Quantity<input type="number" id="tlf-qty" min="1" value="1"></label></div>
    ` : `
    <div class="full"><label>Title<input type="text" id="tlf-title" placeholder="Short summary"></label></div>
    `}
    <div class="full"><label>Description<textarea id="tlf-description" placeholder="Details, findings, actions taken…"></textarea></label></div>
    <div class="tl-form-actions">
      <button class="reset-btn" type="button" data-action="cancel-timeline-form">Cancel</button>
      <button class="save-btn-lg" type="button" data-action="submit-timeline-entry" data-type="${type}">Save</button>
    </div>
  </div>`;
}
function renderProfileTimelineTab(type){
  const entries = getTimeline(profileEquipId).filter(e => e.type === type);
  const formOpen = profileFormOpenType === type;
  const isParts = type === 'parts';
  return `
    ${formOpen ? renderTimelineForm(type) : `<div class="tl-add-btn" data-action="open-timeline-form" data-type="${type}">+ Add ${isParts ? 'part usage' : 'entry'}</div>`}
    ${entries.length ? `<div class="tl-list">${entries.map(e => renderTimelineItemHtml(e, true)).join('')}</div>` : `<div class="tl-empty">No ${TIMELINE_TYPE_LABEL[type].toLowerCase()} records logged yet.</div>`}
  `;
}
function renderDocumentForm(){
  return `
  <div class="tl-form">
    <div class="full"><label>Document name<input type="text" id="docf-name" placeholder="e.g. O&amp;M Manual, Warranty Card"></label></div>
    <div class="full"><label>Link / URL<input type="text" id="docf-url" placeholder="https://…"></label></div>
    <div class="tl-form-actions">
      <button class="reset-btn" type="button" data-action="cancel-document-form">Cancel</button>
      <button class="save-btn-lg" type="button" data-action="submit-document">Save</button>
    </div>
  </div>`;
}
function renderProfileDocuments(){
  const docs = getDocuments(profileEquipId);
  const formOpen = profileFormOpenType === 'document';
  return `
    ${formOpen ? renderDocumentForm() : `<div class="tl-add-btn" data-action="open-document-form">+ Add document</div>`}
    ${docs.length ? docs.map(doc => `
      <div class="doc-row">
        <div class="doc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="doc-info">
          <div class="doc-name">${escapeHtml(doc.name)}</div>
          <div class="doc-date">Added ${new Date(doc.addedAt).toLocaleDateString()}</div>
        </div>
        <div class="doc-actions">
          <span class="doc-open" data-action="open-document" data-url="${escapeHtml(doc.url)}">Open</span>
          <span class="doc-del" data-action="delete-document" data-id="${escapeHtml(doc.id)}" title="Remove">✕</span>
        </div>
      </div>`).join('') : `<div class="tl-empty">No documents attached yet — manuals, warranty cards, inspection certificates, etc.</div>`}
  `;
}
function renderProfileContent(){
  const item = EQUIPMENT_DATA.find(it => it.id === profileEquipId);
  if(!item) return;
  const el = document.getElementById('profileContent');
  if(profileActiveTab === 'overview') el.innerHTML = renderProfileOverview(item);
  else if(profileActiveTab === 'documents') el.innerHTML = renderProfileDocuments();
  else el.innerHTML = renderProfileTimelineTab(profileActiveTab);
}

function openProfileModal(id){
  const item = EQUIPMENT_DATA.find(it => it.id === id);
  if(!item) return;
  profileEquipId = id;
  profileActiveTab = 'overview';
  profileEditing = false;
  profileFormOpenType = null;
  renderProfileHeader(item);
  renderProfileTabs();
  renderProfileContent();
  document.getElementById('profileOverlay').style.display = 'flex';
}
function closeProfileModal(){
  document.getElementById('profileOverlay').style.display = 'none';
  profileEquipId = null;
  profileEditing = false;
  profileFormOpenType = null;
}
async function saveProfileEdit(id){
  if(!isAdmin()) return;
  const val = sel => document.getElementById(sel) ? document.getElementById(sel).value : '';
  profiles[id] = {
    ...(profiles[id] || {}),
    location: val('pf-location'),
    dateInstalled: val('pf-dateInstalled'),
    warranty: val('pf-warranty'),
    supplier: val('pf-supplier'),
    criticality: val('pf-criticality') || 'Medium',
    photo: val('pf-photo'),
  };
  profileEditing = false;
  renderProfileHeader(EQUIPMENT_DATA.find(it => it.id === id));
  renderProfileContent();
  await saveProfiles();
}
async function cycleCriticality(id){
  if(!isAdmin()) return;
  const p = getProfile(id);
  const idx = CRITICALITY_LEVELS.indexOf(p.criticality);
  const next = CRITICALITY_LEVELS[(idx + 1) % CRITICALITY_LEVELS.length];
  profiles[id] = { ...(profiles[id] || {}), criticality: next };
  renderProfileHeader(EQUIPMENT_DATA.find(it => it.id === id));
  await saveProfiles();
}
async function promptSetPhoto(id){
  if(!isAdmin()) return;
  const p = getProfile(id);
  const url = window.prompt('Paste an image URL for this equipment:', p.photo || '');
  if(url === null) return;
  profiles[id] = { ...(profiles[id] || {}), photo: url.trim() };
  renderProfileHeader(EQUIPMENT_DATA.find(it => it.id === id));
  await saveProfiles();
}
async function submitTimelineEntry(id, type){
  if(!canEdit()) return;
  const val = sel => document.getElementById(sel) ? document.getElementById(sel).value.trim() : '';
  const entry = {
    id: 'TL-' + Date.now().toString(36).toUpperCase(),
    type,
    date: val('tlf-date') || new Date().toISOString().slice(0, 10),
    title: type === 'parts' ? (val('tlf-partName') || 'Part replacement') : (val('tlf-title') || TIMELINE_TYPE_LABEL[type]),
    description: val('tlf-description'),
    technician: val('tlf-technician'),
    at: new Date().toISOString(),
  };
  if(type === 'parts'){
    entry.partName = val('tlf-partName');
    entry.qty = val('tlf-qty') || 1;
  }
  timelines[id] = [...(timelines[id] || []), entry];
  profileFormOpenType = null;
  renderProfileContent();
  await saveTimelines();
}
async function deleteTimelineEntry(id, entryId){
  if(!isAdmin()) return;
  timelines[id] = (timelines[id] || []).filter(e => e.id !== entryId);
  renderProfileContent();
  await saveTimelines();
}
async function submitDocument(id){
  if(!canEdit()) return;
  const name = document.getElementById('docf-name') ? document.getElementById('docf-name').value.trim() : '';
  const url = document.getElementById('docf-url') ? document.getElementById('docf-url').value.trim() : '';
  if(!name || !url) return;
  const doc = { id: 'DOC-' + Date.now().toString(36).toUpperCase(), name, url, addedAt: new Date().toISOString() };
  documents[id] = [...(documents[id] || []), doc];
  profileFormOpenType = null;
  renderProfileContent();
  await saveDocuments();
}
async function deleteDocument(id, docId){
  if(!isAdmin()) return;
  documents[id] = (documents[id] || []).filter(d => d.id !== docId);
  renderProfileContent();
  await saveDocuments();
}

document.addEventListener('click', (e) => {
  const openProfileBtn = e.target.closest('[data-action="open-profile"]');
  if(openProfileBtn){ openProfileModal(openProfileBtn.dataset.id); return; }
  if(e.target.closest('#profileClose')){ closeProfileModal(); return; }
  if(e.target.id === 'profileOverlay'){ closeProfileModal(); return; }

  const tab = e.target.closest('[data-action="profile-tab"]');
  if(tab){ profileActiveTab = tab.dataset.tab; profileFormOpenType = null; renderProfileTabs(); renderProfileContent(); return; }

  const photoBtn = e.target.closest('[data-action="profile-set-photo"]');
  if(photoBtn){ promptSetPhoto(photoBtn.dataset.id); return; }

  const critBadge = e.target.closest('[data-action="cycle-criticality"]');
  if(critBadge){ cycleCriticality(critBadge.dataset.id); return; }

  if(e.target.closest('[data-action="profile-start-edit"]')){ profileEditing = true; renderProfileContent(); return; }
  if(e.target.closest('[data-action="profile-cancel-edit"]')){ profileEditing = false; renderProfileContent(); return; }
  const saveEdit = e.target.closest('[data-action="profile-save-edit"]');
  if(saveEdit){ saveProfileEdit(saveEdit.dataset.id); return; }

  const openForm = e.target.closest('[data-action="open-timeline-form"]');
  if(openForm){ profileFormOpenType = openForm.dataset.type; renderProfileContent(); return; }
  if(e.target.closest('[data-action="cancel-timeline-form"]')){ profileFormOpenType = null; renderProfileContent(); return; }
  const submitEntry = e.target.closest('[data-action="submit-timeline-entry"]');
  if(submitEntry){ submitTimelineEntry(profileEquipId, submitEntry.dataset.type); return; }
  const delEntry = e.target.closest('[data-action="delete-timeline-entry"]');
  if(delEntry){ if(confirm('Delete this record?')) deleteTimelineEntry(profileEquipId, delEntry.dataset.id); return; }

  if(e.target.closest('[data-action="open-document-form"]')){ profileFormOpenType = 'document'; renderProfileContent(); return; }
  if(e.target.closest('[data-action="cancel-document-form"]')){ profileFormOpenType = null; renderProfileContent(); return; }
  if(e.target.closest('[data-action="submit-document"]')){ submitDocument(profileEquipId); return; }
  const openDoc = e.target.closest('[data-action="open-document"]');
  if(openDoc){ window.open(openDoc.dataset.url, '_blank', 'noopener'); return; }
  const delDoc = e.target.closest('[data-action="delete-document"]');
  if(delDoc){ if(confirm('Remove this document?')) deleteDocument(profileEquipId, delDoc.dataset.id); return; }

  // keep the profile header's status pill in sync when cycled from inside the modal
  const statusPill = e.target.closest('[data-action="cycle-status"]');
  if(statusPill && profileEquipId === statusPill.dataset.id){
    setTimeout(() => { const it = EQUIPMENT_DATA.find(x => x.id === profileEquipId); if(it) renderProfileHeader(it); }, 0);
  }
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape' && document.getElementById('profileOverlay').style.display !== 'none'){
    closeProfileModal();
  }
});

