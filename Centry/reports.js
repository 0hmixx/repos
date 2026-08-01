/* =============================================================
   reports.js — Export / Reporting
   =============================================================
   Owns: the Export menu (Download Excel, Print/Save as PDF) for
   the Equipment Monitoring and Parts Catalog views.

   Depends on: storage.js (EQUIPMENT_DATA, PARTS_DATA, getData,
   getStatus, getMaintenanceInfo, textSettings), the global XLSX
   library (loaded via CDN in index.html).
   ============================================================= */

/* ---------- export ---------- */
function toggleExportMenu(force){
  const menu = document.getElementById('exportMenu');
  const show = force !== undefined ? force : menu.style.display === 'none';
  menu.style.display = show ? 'block' : 'none';
}
function exportExcel(){
  const equipRows = EQUIPMENT_DATA.map(item => {
    const d = getData(item);
    const st = getStatus(item.id);
    const maint = getMaintenanceInfo(item);
    return {
      'Category': SECTION_LABEL[item.section] || item.section,
      'Tower': towerOf(d),
      'Code': d.code || item.id,
      'Name': d.name,
      'Brand': d.brand,
      'Type': d.type,
      'Capacity (HP)': d.capacity_hp,
      'Model': d.model,
      'Serial': d.serial,
      'Provider': d.provider,
      'PM Schedule': d.pm_schedule,
      'Last Serviced': d.last_serviced || '',
      'Next PM Due': maint.nextDue ? maint.nextDue.toISOString().slice(0,10) : '',
      'PM Status': maint.state,
      'Equipment Status': st.status,
      'Note': st.note || '',
      'Last Updated': st.updatedAt || '',
    };
  });
  const partRows = PARTS_DATA.map(p => ({
    'Equipment': p.equipment, 'Part': p.part, 'Specification': p.spec, 'Qty': p.qty
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(equipRows), 'Equipment');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(partRows), 'Parts');
  const dateStr = new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `AVIDA_Centera_Equipment_Report_${dateStr}.xlsx`);
}
function exportPrint(){
  const savedCollapsedSections = collapsedSections;
  const savedCollapsedParts = collapsedPartSections;
  collapsedSections = new Set();
  collapsedPartSections = new Set();
  if(currentView === 'equipment') renderSections(); else renderPartsSections();

  const restore = () => {
    collapsedSections = savedCollapsedSections;
    collapsedPartSections = savedCollapsedParts;
    if(currentView === 'equipment') renderSections(); else renderPartsSections();
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  setTimeout(() => window.print(), 60);
}

