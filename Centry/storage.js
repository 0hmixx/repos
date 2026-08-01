/* =============================================================
   storage.js — Data Access Layer
   =============================================================
   Every function that reads or writes persisted data lives here.
   This is the ONLY file that talks to window.storage / localStorage
   or fetches the equipment/parts source data.

   Why this matters for future backend integration:
   To swap this app onto a real backend later, you only need to
   change the bodies of the load()/save() functions in this file
   (e.g. replace `window.storage.get(...)` with `fetch('/api/...')`).
   No other file needs to change — every other module only calls
   these named functions and never touches window.storage,
   localStorage, or the raw JSON files directly.

   Two storage backends are used today, both already abstracted here:
   - window.storage: the shared, multi-user store used for equipment
     statuses, overrides, work orders, PM/dashboard config, profiles,
     documents, and timelines. Personal vs "shared/team" scope is
     controlled by the `dataMode` flag.
   - localStorage: used only for the Preventive Maintenance module's
     checklists/engineer assignments/completion log and the reminder
     dismissal flag, per the explicit requirement that PM data stay
     on-device. See the PM section below for the same disclaimer
     that used to live inline.
   ============================================================= */

let EQUIPMENT_DATA = [];
let PARTS_DATA = [];

/**
 * Loads the core equipment & parts datasets.
 * Today this reads static JSON files shipped with the app. Swapping
 * to a real backend later means replacing the two fetch() calls
 * below with calls to your API — every other module already treats
 * EQUIPMENT_DATA / PARTS_DATA as the live source of truth and needs
 * no changes.
 */
async function loadCoreData(){
  const [equipRes, partsRes] = await Promise.all([
    fetch('data/equipment.json'),
    fetch('data/parts.json'),
  ]);
  EQUIPMENT_DATA = await equipRes.json();
  PARTS_DATA = await partsRes.json();
}

/* ---------- constants ---------- */
const SECTION_ORDER = [
  'Motors and Pumps',
  'Fire Fighting Equipments',
  'Generator Set Units',
  'Elevator System',
  'Air Conditiong Units',
  'Exhaust Fans'
];
const SECTION_NUMERAL = {
  'Motors and Pumps': 'I',
  'Fire Fighting Equipments': 'II',
  'Generator Set Units': 'III',
  'Elevator System': 'IV',
  'Air Conditiong Units': 'V',
  'Exhaust Fans': 'VI'
};
const SECTION_LABEL = {
  'Motors and Pumps': 'Motors & Pumps',
  'Fire Fighting Equipments': 'Fire Fighting Equipment',
  'Generator Set Units': 'Generator Set Units',
  'Elevator System': 'Elevator System',
  'Air Conditiong Units': 'Air Conditioning Units',
  'Exhaust Fans': 'Exhaust Fans'
};
const STATUS_DEFS = [
  { key: 'operational', label: 'Operational' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'down', label: 'Down' }
];
const STORAGE_KEY = 'equipment-statuses';
const OVERRIDES_KEY = 'equipment-overrides';
const EDITABLE_FIELDS = [
  { key: 'name', label: 'Equipment name' },
  { key: 'code', label: 'Equipment code' },
  { key: 'brand', label: 'Brand' },
  { key: 'type', label: 'Type' },
  { key: 'capacity_hp', label: 'Capacity (HP)' },
  { key: 'model', label: 'Model' },
  { key: 'serial', label: 'Serial no.' },
  { key: 'provider', label: 'Service provider' },
  { key: 'pm_schedule', label: 'PM schedule' },
  { key: 'last_serviced', label: 'Last serviced', type: 'date' },
];

/* ---------- maintenance due-date logic ---------- */
const PM_INTERVAL_DAYS = {
  'daily': 1, 'weekly': 7, 'monthly': 30, 'quarterly': 91, 'semi-annual': 182,
  'semi-annually': 182, 'biannual': 182, 'annual': 365, 'annually': 365, 'yearly': 365,
};
function pmIntervalDays(pmSchedule){
  if(!pmSchedule) return null;
  const key = String(pmSchedule).trim().toLowerCase();
  return PM_INTERVAL_DAYS[key] || null;
}
function getMaintenanceInfo(item){
  const d = getData(item);
  const interval = pmIntervalDays(d.pm_schedule);
  if(!d.last_serviced || !interval){
    return { state: 'unknown', nextDue: null };
  }
  const last = new Date(d.last_serviced + 'T00:00:00');
  if(isNaN(last.getTime())) return { state: 'unknown', nextDue: null };
  const next = new Date(last.getTime() + interval * 86400000);
  const today = new Date(); today.setHours(0,0,0,0);
  const daysLeft = Math.round((next - today) / 86400000);
  let state;
  if(daysLeft < 0) state = 'overdue';
  else if(daysLeft <= 7) state = 'due-soon';
  else state = 'ok';
  return { state, nextDue: next, daysLeft };
}
function fmtShortDate(d){
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

const PART_TYPE_ORDER = [
  'Main Breaker', 'Control Circuit Breaker', 'Contactor', 'Overload Relay',
  'VFD', 'Contact Relay', 'Voltage Relay', 'Transformer', 'Branch Circuit Breaker', 'Belt'
];
const PART_TYPE_NUMERAL = {};
PART_TYPE_ORDER.forEach((t, i) => { PART_TYPE_NUMERAL[t] = String.fromCharCode(65 + i); }); // A, B, C...

const TEXT_SETTINGS_KEY = 'site-text-settings';
const TEXT_DEFAULTS = {
  eyebrow: 'Facilities & Engineering — Asset Register',
  title: 'AVIDA TOWERS CENTERA',
  sub: 'Equipment Monitoring · Towers 1–4',
  panelEquipTitle: 'Summary of Equipment',
  panelPartsTitle: 'Parts Catalog',
  tabEquip: 'Equipment Monitoring',
  tabParts: 'Parts Catalog',
  footEquipLeft: '125 registered units · 6 categories · Towers 1–4',
  footEquipRight: 'Source: ATCEN Summary of Equipment',
  footPartsLeft: `${PARTS_DATA.length} spare-part line items · ${PART_TYPE_ORDER.length} part types`,
  footPartsRight: 'Source: Building Equipment Parts',
};
const TEXT_FIELDS = [
  { key:'eyebrow', label:'Eyebrow (small line above title)', group:'Header' },
  { key:'title', label:'Main title', group:'Header' },
  { key:'sub', label:'Subtitle', group:'Header' },
  { key:'tabEquip', label:'"Equipment" tab label', group:'Sidebar tabs' },
  { key:'tabParts', label:'"Parts" tab label', group:'Sidebar tabs' },
  { key:'panelEquipTitle', label:'Equipment filter panel title', group:'Sidebar tabs' },
  { key:'panelPartsTitle', label:'Parts filter panel title', group:'Sidebar tabs' },
  { key:'footEquipLeft', label:'Footer, left (Equipment view)', group:'Footer' },
  { key:'footEquipRight', label:'Footer, right (Equipment view)', group:'Footer' },
  { key:'footPartsLeft', label:'Footer, left (Parts view)', group:'Footer' },
  { key:'footPartsRight', label:'Footer, right (Parts view)', group:'Footer' },
];

/* ---------- state ---------- */
let statuses = {};           // { id: { status, note, updatedAt } }
let overrides = {};          // { id: { field: value, ... } }
let editingIds = new Set();  // ids currently in edit mode
let collapsedSections = new Set(); // category section keys currently collapsed
let collapsedPartSections = new Set();
let activeStatusFilter = 'all';
let activeTower = 'all';
let activeCategory = 'all';
let activePartType = 'all';
let searchTerm = '';
let partsSearchTerm = '';
let compactView = false;
let currentView = 'dashboard'; // 'dashboard' | 'equipment' | 'parts'
let textSettings = {};
let dataMode = 'personal'; // 'personal' | 'shared'
let activePmFilter = false;
let criticalSystemsStatus = {}; // manual-mode critical systems: { key: 'operational'|'attention'|'down' }
let workOrders = [];            // [{ id, equipmentId, equipmentName, type, priority, description, status, createdAt }]
let profiles = {};              // { [equipmentId]: { photo, criticality, location, dateInstalled, warranty, supplier } }
let timelines = {};             // { [equipmentId]: [ { id, type, date, title, description, technician, partName, qty, cost, at } ] }
let documents = {};             // { [equipmentId]: [ { id, name, url, addedAt } ] }
let profileEquipId = null;      // id of equipment currently open in the profile modal
let profileActiveTab = 'overview';
let profileEditing = false;
let profileFormOpenType = null; // which "add entry" form is open within the current tab
let currentRole = null;         // 'admin' | 'technician' | 'viewer' — set after login
let selectedLoginRole = 'admin';
let pmDetails = {};             // { [equipmentId]: { engineer, estimatedTime, checklist:[{id,text,done}] } } — localStorage-backed
let pmActiveSubview = 'calendar'; // 'calendar' | 'today' | 'upcoming' | 'overdue'
let pmCalMode = 'month';        // 'month' | 'week'
let pmCalCursor = new Date();   // anchor date for the visible month/week
let pmSelectedDay = null;       // 'YYYY-MM-DD' selected day in calendar view
let pmDetailEquipId = null;     // id of equipment currently open in the PM detail modal
let pmDetailEditing = false;
// NOTE: this is a client-side access gate meant to prevent accidental edits
// and separate day-to-day roles — it is NOT secure authentication. Anyone
// with access to this file's source can read these values. Change them below.
const ROLE_CREDENTIALS = {
  admin: 'admin123',
  technician: 'tech123',
  viewer: 'view123',
};
const ROLE_LABELS = { admin: 'Admin', technician: 'Technician', viewer: 'Viewer' };

function canEdit(){ return currentRole === 'admin' || currentRole === 'technician'; }
function isAdmin(){ return currentRole === 'admin'; }
function towerOf(item){
  const hay = (item.code + ' ' + item.name).toUpperCase();
  const m = hay.match(/T(?:OWER)?\s*-?\s*([1-4])\b/);
  return m ? 'Tower ' + m[1] : 'Common';
}
function getStatus(id){
  const base = statuses[id] || { status: 'operational', note: '', updatedAt: null };
  return { history: [], ...base };
}
function getData(item){
  return { ...item, ...(overrides[item.id] || {}) };
}
function fmtDate(iso){
  if(!iso) return 'No status logged yet';
  const d = new Date(iso);
  return 'Updated ' + d.toLocaleDateString(undefined, { month:'short', day:'numeric' }) + ' · ' +
    d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ---------- persistence ---------- */
async function loadStatuses(){
  try{
    const res = await window.storage.get(STORAGE_KEY, dataMode === 'shared');
    statuses = res && res.value ? JSON.parse(res.value) : {};
  }catch(e){
    statuses = {};
  }
}
async function saveStatuses(){
  try{
    await window.storage.set(STORAGE_KEY, JSON.stringify(statuses), dataMode === 'shared');
  }catch(e){
    console.error('Could not save status data', e);
  }
}
async function loadOverrides(){
  try{
    const res = await window.storage.get(OVERRIDES_KEY, dataMode === 'shared');
    overrides = res && res.value ? JSON.parse(res.value) : {};
  }catch(e){
    overrides = {};
  }
}
async function saveOverrides(){
  try{
    await window.storage.set(OVERRIDES_KEY, JSON.stringify(overrides), dataMode === 'shared');
  }catch(e){
    console.error('Could not save equipment edits', e);
  }
}
async function loadTextSettings(){
  try{
    const res = await window.storage.get(TEXT_SETTINGS_KEY, false);
    const saved = res && res.value ? JSON.parse(res.value) : {};
    textSettings = { ...TEXT_DEFAULTS, ...saved };
  }catch(e){
    textSettings = { ...TEXT_DEFAULTS };
  }
}
async function saveTextSettings(){
  try{
    await window.storage.set(TEXT_SETTINGS_KEY, JSON.stringify(textSettings), false);
  }catch(e){
    console.error('Could not save text settings', e);
  }
}
function applyTextSettings(){
  document.getElementById('txtEyebrow').textContent = textSettings.eyebrow;
  document.getElementById('txtTitle').textContent = textSettings.title;
  document.getElementById('txtSub').textContent = textSettings.sub;
  document.getElementById('txtTabEquip').textContent = textSettings.tabEquip;
  document.getElementById('txtTabParts').textContent = textSettings.tabParts;
  document.getElementById('txtPanelEquipTitle').textContent = textSettings.panelEquipTitle;
  document.getElementById('txtPanelPartsTitle').textContent = textSettings.panelPartsTitle;
  updateFooterText();
}
function updateFooterText(){
  const isEquip = currentView === 'equipment';
  document.getElementById('footLeft').textContent = isEquip ? textSettings.footEquipLeft : textSettings.footPartsLeft;
  document.getElementById('footRight').textContent = isEquip ? textSettings.footEquipRight : textSettings.footPartsRight;
}

const CRITICAL_SYSTEMS_KEY = 'critical-systems-status';
const WORK_ORDERS_KEY = 'work-orders';
async function loadCriticalSystems(){
  try{
    const res = await window.storage.get(CRITICAL_SYSTEMS_KEY, dataMode === 'shared');
    criticalSystemsStatus = res && res.value ? JSON.parse(res.value) : {};
  }catch(e){
    criticalSystemsStatus = {};
  }
}
async function saveCriticalSystems(){
  try{
    await window.storage.set(CRITICAL_SYSTEMS_KEY, JSON.stringify(criticalSystemsStatus), dataMode === 'shared');
  }catch(e){
    console.error('Could not save critical systems status', e);
  }
}
async function loadWorkOrders(){
  try{
    const res = await window.storage.get(WORK_ORDERS_KEY, dataMode === 'shared');
    workOrders = res && res.value ? JSON.parse(res.value) : [];
  }catch(e){
    workOrders = [];
  }
}
async function saveWorkOrders(){
  try{
    await window.storage.set(WORK_ORDERS_KEY, JSON.stringify(workOrders), dataMode === 'shared');
  }catch(e){
    console.error('Could not save work orders', e);
  }
}

const PROFILE_KEY = 'equipment-profiles';
const TIMELINE_KEY = 'equipment-timeline';
const DOCUMENTS_KEY = 'equipment-documents';
const CRITICALITY_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
async function loadProfiles(){
  try{ const res = await window.storage.get(PROFILE_KEY, dataMode === 'shared'); profiles = res && res.value ? JSON.parse(res.value) : {}; }
  catch(e){ profiles = {}; }
}
async function saveProfiles(){
  try{ await window.storage.set(PROFILE_KEY, JSON.stringify(profiles), dataMode === 'shared'); }
  catch(e){ console.error('Could not save equipment profiles', e); }
}
async function loadTimelines(){
  try{ const res = await window.storage.get(TIMELINE_KEY, dataMode === 'shared'); timelines = res && res.value ? JSON.parse(res.value) : {}; }
  catch(e){ timelines = {}; }
}
async function saveTimelines(){
  try{ await window.storage.set(TIMELINE_KEY, JSON.stringify(timelines), dataMode === 'shared'); }
  catch(e){ console.error('Could not save equipment timeline', e); }
}
async function loadDocuments(){
  try{ const res = await window.storage.get(DOCUMENTS_KEY, dataMode === 'shared'); documents = res && res.value ? JSON.parse(res.value) : {}; }
  catch(e){ documents = {}; }
}
async function saveDocuments(){
  try{ await window.storage.set(DOCUMENTS_KEY, JSON.stringify(documents), dataMode === 'shared'); }
  catch(e){ console.error('Could not save equipment documents', e); }
}

const LS_PM_DETAILS_KEY = 'cmms-pm-details-v1';
const LS_PM_COMPLETIONS_KEY = 'cmms-pm-completions-v1';
const LS_PM_REMINDER_DISMISS_KEY = 'cmms-pm-reminder-dismissed-v1';

function lsGet(key, fallback){
  try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch(e){ return fallback; }
}
function lsSet(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }
  catch(e){ console.error('Could not save to local storage', key, e); }
}
function loadPmDetails(){ pmDetails = lsGet(LS_PM_DETAILS_KEY, {}); }
function savePmDetails(){ lsSet(LS_PM_DETAILS_KEY, pmDetails); }
function logPmCompletion(id, entry){
  const all = lsGet(LS_PM_COMPLETIONS_KEY, {});
  all[id] = [...(all[id] || []), entry];
  lsSet(LS_PM_COMPLETIONS_KEY, all);
}
