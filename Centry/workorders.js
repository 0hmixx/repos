/* =============================================================
   workorders.js — Work Orders
   =============================================================
   Owns: the "New Work Order" / "Report Breakdown" modal, its form
   state, and cycling a work order's status (open -> waiting on
   contractor -> closed). Triggered from the Dashboard's Quick
   Actions and KPI cards (see dashboard.js's click handler).

   Depends on: storage.js (workOrders state + saveWorkOrders,
   EQUIPMENT_DATA, getData, setStatus for breakdown auto-flagging).
   ============================================================= */

let woModalType = 'workorder';
async function cycleWorkOrderStatus(id){
  const order = ['open', 'waiting_contractor', 'closed'];
  const wo = workOrders.find(w => w.id === id);
  if(!wo) return;
  wo.status = order[(order.indexOf(wo.status) + 1) % order.length];
  renderActivityFeed();
  renderKPIGrid();
  await saveWorkOrders();
}
function populateWoEquipSelect(){
  const sel = document.getElementById('woEquip');
  sel.innerHTML = EQUIPMENT_DATA.map(it => {
    const d = getData(it);
    return `<option value="${escapeHtml(it.id)}">${escapeHtml(d.name)} (${escapeHtml(d.code || it.id)})</option>`;
  }).join('');
}
function openWoModal(type){
  woModalType = type;
  document.getElementById('woModalTitle').textContent = type === 'breakdown' ? 'Report Breakdown' : 'New Work Order';
  populateWoEquipSelect();
  document.getElementById('woPriority').value = type === 'breakdown' ? 'high' : 'medium';
  document.getElementById('woDesc').value = '';
  document.getElementById('woOverlay').style.display = 'flex';
}
function closeWoModal(){
  document.getElementById('woOverlay').style.display = 'none';
}
async function submitWoModal(){
  if(!canEdit()) return;
  const equipId = document.getElementById('woEquip').value;
  const item = EQUIPMENT_DATA.find(it => it.id === equipId);
  if(!item) return;
  const d = getData(item);
  const priority = document.getElementById('woPriority').value;
  const description = document.getElementById('woDesc').value.trim();
  const wo = {
    id: 'WO-' + Date.now().toString(36).toUpperCase(),
    equipmentId: item.id,
    equipmentName: d.name,
    type: woModalType,
    priority,
    description,
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  workOrders.unshift(wo);
  closeWoModal();
  if(woModalType === 'breakdown' && getStatus(item.id).status === 'operational'){
    await setStatus(item.id, { status: 'attention' });
  }
  renderDashboard();
  await saveWorkOrders();
}

