/* =============================================================
   inventory.js — Parts Catalog
   =============================================================
   Owns: the Parts Catalog view — search/filter by part type,
   stats row, and section/row rendering.

   Depends on: storage.js (PARTS_DATA, PART_TYPE_ORDER,
   PART_TYPE_NUMERAL, escapeHtml, collapsedPartSections,
   activePartType, partsSearchTerm).
   ============================================================= */

/* ---------- parts catalog: filtering ---------- */
function partsMatches(item){
  if(activePartType !== 'all' && item.part !== activePartType) return false;
  if(partsSearchTerm){
    const hay = [item.equipment, item.part, item.spec].join(' ').toLowerCase();
    if(!hay.includes(partsSearchTerm)) return false;
  }
  return true;
}

/* ---------- parts catalog: sidebar filter ---------- */
function renderPartTypeFilter(){
  const el = document.getElementById('partTypeFilter');
  const counts = {};
  PARTS_DATA.forEach(p => { counts[p.part] = (counts[p.part] || 0) + 1; });
  const all = [{key:'all', label:'All parts'}, ...PART_TYPE_ORDER.map(t => ({key:t, label:t}))];
  el.innerHTML = all.map(t => `
    <div class="chip ${activePartType === t.key ? 'active' : ''}" data-role="parttype" data-parttype="${escapeHtml(t.key)}">
      <span>${escapeHtml(t.label)}</span>${t.key !== 'all' ? `<span style="color:var(--text-faint)">${counts[t.key] || 0}</span>` : ''}
    </div>
  `).join('');
}

/* ---------- parts catalog: stats ---------- */
function renderPartsStats(){
  const scoped = PARTS_DATA.filter(p => partsSearchTerm ? partsMatches(p) : true);
  const totalQty = scoped.reduce((s,p) => s + (typeof p.qty === 'number' ? p.qty : 0), 0);
  const uniqueEquip = new Set(scoped.map(p => p.equipment)).size;
  const cards = [
    { num: scoped.length, lbl: 'Line items' },
    { num: totalQty.toLocaleString(), lbl: 'Total quantity' },
    { num: uniqueEquip, lbl: 'Equipment covered' },
    { num: PART_TYPE_ORDER.length, lbl: 'Part types' },
  ];
  document.getElementById('partsStatsRow').innerHTML = cards.map(c => `
    <div class="stat-card">
      <div class="num">${c.num}</div>
      <div class="lbl">${c.lbl}</div>
    </div>`).join('');
}

/* ---------- parts catalog: row + sections ---------- */
function renderPartRow(item){
  return `
  <div class="part-row">
    <div class="p-equip"><div class="nm">${escapeHtml(item.equipment)}</div></div>
    <div class="p-spec">${escapeHtml(item.spec || '—')}</div>
    <div class="p-qty">QTY ${escapeHtml(item.qty !== '' ? item.qty : '—')}</div>
  </div>`;
}
function renderPartsSections(){
  const container = document.getElementById('partsSections');
  const filtered = PARTS_DATA.filter(partsMatches);

  if(filtered.length === 0){
    container.innerHTML = `<div class="empty-state">No parts match the current filters.</div>`;
    return;
  }

  const order = activePartType === 'all' ? PART_TYPE_ORDER : [activePartType];
  let html = '';
  order.forEach(type => {
    const items = filtered.filter(p => p.part === type);
    if(items.length === 0) return;
    const isCollapsed = collapsedPartSections.has(type);
    html += `
      <div class="section-block ${isCollapsed ? 'collapsed' : ''}" data-section="${escapeHtml(type)}">
        <div class="section-head" data-action="toggle-part-section" data-section="${escapeHtml(type)}">
          <span class="section-numeral">${PART_TYPE_NUMERAL[type] || '·'}</span>
          <h2>${escapeHtml(type)}</h2>
          <span class="section-count">${items.length} item${items.length === 1 ? '' : 's'}</span>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-body">
          <div class="compact-list">${items.map(renderPartRow).join('')}</div>
        </div>
      </div>`;
  });
  container.innerHTML = html || `<div class="empty-state">No parts match the current filters.</div>`;
}
function renderParts(){
  renderPartsStats();
  renderPartTypeFilter();
  renderPartsSections();
}

