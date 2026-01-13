import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '');

// --------------------
// Config
// --------------------
const defaultConfig = {
  app_title: 'Werkstatt Auftragsmanager',
  company_name: 'Pro Automobile',
  primary_color: '#f59e0b',
  secondary_color: '#1e293b',
  text_color: '#f1f5f9',
  accent_color: '#0f172a',
  surface_color: '#334155'
};
const CONFIG_KEY = 'pa_zeit_config_v1';
function loadConfig() {
  try { const raw = localStorage.getItem(CONFIG_KEY); return raw ? { ...defaultConfig, ...JSON.parse(raw) } : { ...defaultConfig }; }
  catch { return { ...defaultConfig }; }
}
let config = loadConfig();

// --------------------
// State
// --------------------
let allJobs = [];
let allEntries = [];
let allSignatures = [];
let allItems = [];
let allPhotos = [];

let currentJobId = null;
let runningEntry = null;
let timerInterval = null;

// --------------------
// Utils
// --------------------
function formatDate(iso){
  if(!iso) return '--';
  return new Date(iso).toLocaleString('de-CH');
}
function formatDateShort(iso){
  if(!iso) return '--';
  return new Date(iso).toLocaleDateString('de-CH');
}
function formatDuration(min){
  if(min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}
function calculateDuration(startTs, endTs){
  const s = new Date(startTs).getTime();
  const e = endTs ? new Date(endTs).getTime() : Date.now();
  return Math.max(0, Math.round((e - s) / 60000));
}
function money(n){
  if(n === null || n === undefined || Number.isNaN(Number(n))) return '--';
  return Number(n).toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
}
function showToast(msg){
  const t = document.getElementById('toast');
  const m = document.getElementById('toast-message');
  if(!t || !m) return alert(msg);
  m.textContent = msg;
  t.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 3500);
}
function getEntries(jobId){ return allEntries.filter(e => e.job_id === jobId); }
function getSignature(jobId){ return allSignatures.find(s => s.job_id === jobId); }
function getItems(jobId){ return allItems.filter(i => i.job_id === jobId); }
function getPhotos(jobId){ return allPhotos.filter(p => p.job_id === jobId); }

function isUUID(v){ return /^[0-9a-fA-F-]{36}$/.test(v || ''); }

// --------------------
// Router
// --------------------
function getPathJobId(){
  const m = window.location.pathname.match(/^\/job\/([0-9a-fA-F-]{36})\/?$/);
  return m ? m[1] : null;
}
function navigateTo(path){
  window.history.pushState({}, '', path);
  handleRoute();
}
window.addEventListener('popstate', handleRoute);

// --------------------
// Supabase helpers
// --------------------
async function loadAll(){
  const [jobsRes, entriesRes, sigRes, itemsRes, photosRes] = await Promise.all([
    supabase.from('jobs').select('*'),
    supabase.from('entries').select('*'),
    supabase.from('signatures').select('*'),
    supabase.from('job_items').select('*'),
    supabase.from('job_photos').select('*'),
  ]);

  // If extra tables are not created yet, don't hard-fail the app.
  if(jobsRes.error) throw jobsRes.error;
  if(entriesRes.error) throw entriesRes.error;
  if(sigRes.error) throw sigRes.error;

  allJobs = jobsRes.data ?? [];
  allEntries = entriesRes.data ?? [];
  allSignatures = sigRes.data ?? [];

  allItems = (itemsRes.error ? [] : (itemsRes.data ?? []));
  allPhotos = (photosRes.error ? [] : (photosRes.data ?? []));

  updateStats();
  renderJobList();
  if(currentJobId) renderJobDetail();
}

const createRow = (t, payload) => supabase.from(t).insert(payload);
const updateRow = (t, payload, match) => supabase.from(t).update(payload).match(match);
const deleteRow = (t, match) => supabase.from(t).delete().match(match);

// --------------------
// UI basics
// --------------------
function applyConfig(cfg){
  const appTitle = document.getElementById('app-title');
  const companyName = document.getElementById('company-name');
  if(appTitle) appTitle.textContent = cfg.app_title || defaultConfig.app_title;
  if(companyName) companyName.textContent = cfg.company_name || defaultConfig.company_name;
  document.documentElement.style.setProperty('--primary', cfg.primary_color || defaultConfig.primary_color);
  document.documentElement.style.setProperty('--secondary', cfg.secondary_color || defaultConfig.secondary_color);
}

function updateStats(){
  const openJobs = allJobs.filter(j => j.status === 'open').length;
  const doneJobs = allJobs.filter(j => j.status === 'done').length;
  const activeEntries = allEntries.filter(e => !e.end_ts).length;
  const elTotal = document.getElementById('stat-total');
  const elOpen = document.getElementById('stat-open');
  const elDone = document.getElementById('stat-done');
  const elActive = document.getElementById('stat-active');
  if(elTotal) elTotal.textContent = String(allJobs.length);
  if(elOpen) elOpen.textContent = String(openJobs);
  if(elDone) elDone.textContent = String(doneJobs);
  if(elActive) elActive.textContent = String(activeEntries);
}

function ensureSearchBox(){
  const filter = document.getElementById('filter-status');
  if(!filter) return;
  const parent = filter.parentElement;
  if(!parent) return;
  if(document.getElementById('search-jobs')) return;

  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-2 ml-auto';
  wrap.innerHTML = `
    <div class="relative">
      <input id="search-jobs" type="text" placeholder="Suche: Kennzeichen, Kunde, Fahrzeug, Nr..."
        class="w-72 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none">
    </div>
  `;
  // try to place near filter
  parent.parentElement?.appendChild(wrap);
  document.getElementById('search-jobs')?.addEventListener('input', renderJobList);
}

function renderJobList(){
  ensureSearchBox();
  const container = document.getElementById('job-list');
  if(!container) return;

  const filterStatus = document.getElementById('filter-status')?.value ?? 'all';
  const q = (document.getElementById('search-jobs')?.value ?? '').trim().toLowerCase();

  let jobs = [...allJobs];

  if(filterStatus !== 'all') jobs = jobs.filter(j => j.status === filterStatus);

  if(q){
    jobs = jobs.filter(j => {
      const hay = [
        j.job_no, j.title, j.customer, j.vehicle, j.plate, j.notes
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  // important first, newest first
  jobs.sort((a,b) => {
    const ai = a.important ? 1 : 0;
    const bi = b.important ? 1 : 0;
    if(ai !== bi) return bi - ai;
    return new Date(b.created_at) - new Date(a.created_at);
  });

  if(jobs.length === 0){
    container.innerHTML = '<div class="p-8 text-center text-slate-500"><p>Keine Aufträge gefunden</p></div>';
    return;
  }

  container.innerHTML = jobs.map(job => {
    const entries = getEntries(job.id);
    const totalMinutes = entries.reduce((s,e)=> s + calculateDuration(e.start_ts, e.end_ts), 0);
    const hasRunning = entries.some(e => !e.end_ts);

    const statusClass = job.status === 'done' ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400';
    const statusText = job.status === 'done' ? 'Erledigt' : 'Offen';

    const star = job.important ? '★' : '☆';
    const jobNo = job.job_no ? `<span class="text-xs text-slate-400">${job.job_no}</span>` : '';

    return `
      <div class="p-4 hover:bg-slate-700/50 cursor-pointer transition-colors" data-job-id="${job.id}">
        <div class="flex items-center justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <button class="no-print text-amber-400 text-lg leading-none" data-star="${job.id}" title="Wichtig markieren">${star}</button>
              <h3 class="font-semibold text-white truncate">${job.title || 'Ohne Titel'}</h3>
              ${hasRunning ? '<span class="w-2 h-2 bg-amber-500 rounded-full animate-pulse-dot"></span>' : ''}
            </div>
            <div class="flex items-center gap-4 mt-1 text-sm text-slate-400">
              <span>${job.customer || '--'}</span>
              <span>${job.vehicle || '--'}</span>
              <span class="font-mono">${job.plate || '--'}</span>
              ${jobNo}
            </div>
          </div>
          <div class="flex items-center gap-4 ml-4">
            <span class="text-sm text-slate-400">${formatDuration(totalMinutes)}</span>
            <span class="px-2.5 py-1 rounded-full text-xs font-medium ${statusClass}">${statusText}</span>
            <svg class="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-job-id]').forEach(el=>{
    el.addEventListener('click', (e) => {
      // prevent clicking star from navigating twice
      if(e.target?.getAttribute?.('data-star')) return;
      navigateTo(`/job/${el.dataset.jobId}`);
    });
  });

  container.querySelectorAll('[data-star]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const id = btn.getAttribute('data-star');
      const job = allJobs.find(j=>j.id===id);
      if(!job) return;
      const { error } = await updateRow('jobs', { important: !job.important }, { id });
      if(error) showToast('Fehler: ' + (error.message||'')); else await loadAll();
    });
  });
}

function showJobDetail(){
  document.getElementById('job-list-view')?.classList.add('hidden');
  document.getElementById('job-detail-view')?.classList.remove('hidden');
  document.getElementById('view-detail-btn')?.classList.remove('hidden');
  document.getElementById('view-list-btn')?.classList.remove('bg-amber-500','text-slate-900');
  document.getElementById('view-list-btn')?.classList.add('bg-slate-700','text-slate-300');
  document.getElementById('view-detail-btn')?.classList.remove('bg-slate-700','text-slate-300');
  document.getElementById('view-detail-btn')?.classList.add('bg-amber-500','text-slate-900');
  renderJobDetail();
  startTimerInterval();
}

function showJobList(){
  document.getElementById('job-detail-view')?.classList.add('hidden');
  document.getElementById('job-list-view')?.classList.remove('hidden');
  document.getElementById('view-detail-btn')?.classList.add('hidden');
  document.getElementById('view-list-btn')?.classList.remove('bg-slate-700','text-slate-300');
  document.getElementById('view-list-btn')?.classList.add('bg-amber-500','text-slate-900');
  currentJobId = null;
  stopTimerInterval();
}

// --------------------
// Detail view - inject "Pro features" without changing HTML
// --------------------
function ensureDetailExtrasContainer(){
  const anchor = document.getElementById('time-entry-form') ?? document.getElementById('time-entries') ?? document.getElementById('job-detail-view');
  if(!anchor) return null;

  let extras = document.getElementById('detail-extras');
  if(extras) return extras;

  extras = document.createElement('div');
  extras.id = 'detail-extras';
  extras.className = 'space-y-6';
  // insert before time tracking if possible
  const parent = anchor.parentElement;
  if(parent) parent.insertBefore(extras, anchor);
  return extras;
}

function jobUrl(jobId){
  return `${window.location.origin}/job/${jobId}`;
}

async function renderJobDetail(){
  if(!currentJobId) return;
  const job = allJobs.find(j => j.id === currentJobId);
  if(!job){ showJobList(); return; }

  document.getElementById('detail-title').textContent = job.title || 'Ohne Titel';
  document.getElementById('detail-created').textContent = 'Erstellt: ' + formatDate(job.created_at);
  document.getElementById('detail-customer').textContent = job.customer || '--';
  document.getElementById('detail-vehicle').textContent = job.vehicle || '--';
  document.getElementById('detail-plate').textContent = job.plate || '--';

  // status badge
  const statusBadge = document.getElementById('detail-status-badge');
  if(job.status === 'done'){
    statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-green-500/20 text-green-400';
    statusBadge.textContent = 'Erledigt';
    document.getElementById('close-job-btn')?.classList.add('hidden');
    document.getElementById('time-entry-form')?.classList.add('hidden');
  } else {
    statusBadge.className = 'px-3 py-1 rounded-full text-sm font-medium bg-amber-500/20 text-amber-400';
    statusBadge.textContent = 'Offen';
    document.getElementById('close-job-btn')?.classList.remove('hidden');
    document.getElementById('time-entry-form')?.classList.remove('hidden');
  }

  renderTimeEntries();
  renderSignature();
  await renderQrRightCard();
  renderExtras(job);
}

async function renderQrRightCard(){
  const holder = document.getElementById('qr-placeholder');
  if(!holder || !currentJobId) return;
  const url = jobUrl(currentJobId);
  try{
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    holder.innerHTML = `<img src="${dataUrl}" alt="QR" class="w-48 h-48 mx-auto rounded-lg shadow-sm"><p class="text-xs text-slate-500 mt-2 break-all">${url}</p>`;
  } catch(e){
    holder.innerHTML = `<p class="text-slate-500 text-sm">QR konnte nicht generiert werden</p>`;
  }
}

// Extras: odometer, dates, checklist, items, photos, pdf
function renderExtras(job){
  const extras = ensureDetailExtrasContainer();
  if(!extras) return;

  // --------- KM Stand + Termine + Auftrag Nr
  const kmVal = job.odometer_km ?? '';
  const dropoff = job.dropoff_at ?? '';
  const pickup = job.pickup_at ?? '';
  const jobNo = job.job_no ?? '--';

  const importantChecked = job.important ? 'checked' : '';

  extras.innerHTML = `
    <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-slate-100 font-semibold">Auftrag</h3>
          <p class="text-xs text-slate-500">Nr: <span class="font-mono">${jobNo}</span></p>
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input id="important-toggle" type="checkbox" ${importantChecked} class="accent-amber-500">
          Wichtig
        </label>
      </div>

      <div class="grid md:grid-cols-3 gap-4 mt-4">
        <div>
          <label class="block text-sm text-slate-400 mb-1">KM-Stand (Pflicht zum Abschließen)</label>
          <input id="odometer-input" type="number" inputmode="numeric" min="0" value="${kmVal}"
            placeholder="z.B. 123456"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-500 focus:border-amber-500 focus:outline-none">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">Abgabe-Termin</label>
          <input id="dropoff-input" type="datetime-local" value="${toLocalDatetime(dropoff)}"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:border-amber-500 focus:outline-none">
        </div>
        <div>
          <label class="block text-sm text-slate-400 mb-1">Abhol-Termin</label>
          <input id="pickup-input" type="datetime-local" value="${toLocalDatetime(pickup)}"
            class="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:border-amber-500 focus:outline-none">
        </div>
      </div>

      <div class="mt-3 flex gap-2">
        <button id="save-job-meta" class="bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium px-4 py-2 rounded-lg">Speichern</button>
        <button id="export-pdf" class="bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium px-4 py-2 rounded-lg">PDF erstellen</button>
      </div>

      <p class="text-xs text-slate-500 mt-2">Tipp: QR-Code rechts scannen → öffnet diesen Auftrag direkt.</p>
    </div>

    ${renderChecklistBlock(job)}
    ${renderItemsBlock(job)}
    ${renderPhotosBlock(job)}
  `;

  // bind events
  document.getElementById('save-job-meta')?.addEventListener('click', () => saveJobMeta(job.id));
  document.getElementById('export-pdf')?.addEventListener('click', () => exportPdf(job.id));
  document.getElementById('important-toggle')?.addEventListener('change', async (e) => {
    const checked = e.target.checked;
    const { error } = await updateRow('jobs', { important: checked }, { id: job.id });
    if(error) showToast('Fehler: ' + (error.message||'')); else await loadAll();
  });

  // checklist events
  extras.querySelectorAll('[data-check]').forEach(cb=>{
    cb.addEventListener('change', async ()=>{
      await saveChecklist(job.id);
    });
  });

  // items
  document.getElementById('add-item')?.addEventListener('click', ()=>addItemRow(job.id));
  extras.querySelectorAll('[data-del-item]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del-item');
      const { error } = await deleteRow('job_items', { id });
      if(error) showToast('Fehler: ' + (error.message||'')); else await loadAll();
    });
  });

  // photos
  document.getElementById('photo-upload')?.addEventListener('change', (e)=>uploadPhoto(job.id, e.target.files?.[0] ?? null, 'general'));
  document.getElementById('id-upload')?.addEventListener('change', (e)=>uploadPhoto(job.id, e.target.files?.[0] ?? null, 'id'));
  extras.querySelectorAll('[data-del-photo]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const id = btn.getAttribute('data-del-photo');
      const p = allPhotos.find(x=>x.id===id);
      if(!p) return;
      await supabase.storage.from('job-photos').remove([p.path]).catch(()=>{});
      const { error } = await deleteRow('job_photos', { id });
      if(error) showToast('Fehler: ' + (error.message||'')); else await loadAll();
    });
  });
}

function toLocalDatetime(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const pad = (n)=> String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function fromLocalDatetime(v){
  if(!v) return null;
  const d = new Date(v);
  return d.toISOString();
}

async function saveJobMeta(jobId){
  const km = document.getElementById('odometer-input')?.value;
  const dropoff = document.getElementById('dropoff-input')?.value;
  const pickup = document.getElementById('pickup-input')?.value;

  const payload = {
    odometer_km: km ? Number(km) : null,
    dropoff_at: fromLocalDatetime(dropoff),
    pickup_at: fromLocalDatetime(pickup),
  };
  const { error } = await updateRow('jobs', payload, { id: jobId });
  if(error) showToast('Fehler: ' + (error.message||'')); else { showToast('Gespeichert'); await loadAll(); }
}

// --------------------
// Checklist (stored in jobs.checklist jsonb)
// --------------------
const CHECKLIST_KEYS = [
  ['vehicle_received', 'Fahrzeug angenommen'],
  ['damage_documented', 'Schäden dokumentiert'],
  ['test_drive', 'Probefahrt'],
  ['customer_informed', 'Kunde informiert'],
  ['keys_returned', 'Schlüssel zurückgegeben'],
];

function getChecklist(job){
  const c = job.checklist && typeof job.checklist === 'object' ? job.checklist : {};
  const out = {};
  CHECKLIST_KEYS.forEach(([k])=> out[k] = !!c[k]);
  return out;
}

function renderChecklistBlock(job){
  const c = getChecklist(job);
  const rows = CHECKLIST_KEYS.map(([k,label])=>{
    return `<label class="flex items-center gap-2 text-slate-300">
      <input type="checkbox" class="accent-amber-500" data-check="${k}" ${c[k]?'checked':''}>
      <span>${label}</span>
    </label>`;
  }).join('');
  return `
    <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
      <h3 class="text-slate-100 font-semibold mb-3">Checkliste</h3>
      <div class="grid md:grid-cols-2 gap-3">${rows}</div>
    </div>
  `;
}

async function saveChecklist(jobId){
  const job = allJobs.find(j=>j.id===jobId);
  if(!job) return;
  const current = getChecklist(job);

  document.querySelectorAll('#detail-extras [data-check]').forEach(cb=>{
    const k = cb.getAttribute('data-check');
    current[k] = cb.checked;
  });

  const { error } = await updateRow('jobs', { checklist: current }, { id: jobId });
  if(error) showToast('Fehler: ' + (error.message||'')); else showToast('Checkliste gespeichert');
  await loadAll();
}

// --------------------
// Items (table job_items)
// --------------------
function renderItemsBlock(job){
  const items = getItems(job.id).slice().sort((a,b)=> new Date(a.created_at||0) - new Date(b.created_at||0));
  const rows = items.map(it=>{
    const type = it.item_type || 'arbeit';
    return `
      <tr class="border-t border-slate-700">
        <td class="py-2 pr-2 text-slate-200">${type}</td>
        <td class="py-2 pr-2 text-slate-200">${escapeHtml(it.description||'')}</td>
        <td class="py-2 pr-2 text-slate-200 text-right">${it.qty ?? ''}</td>
        <td class="py-2 pr-2 text-slate-200 text-right">${money(it.unit_price)}</td>
        <td class="py-2 pr-2 text-slate-200 text-right">${money((it.qty||0) * (it.unit_price||0))}</td>
        <td class="py-2 text-right">
          <button data-del-item="${it.id}" class="bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1 rounded-lg text-sm">Löschen</button>
        </td>
      </tr>`;
  }).join('');

  const total = items.reduce((s,it)=> s + (Number(it.qty||0) * Number(it.unit_price||0)), 0);

  return `
    <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-slate-100 font-semibold">Arbeiten & Material</h3>
        <button id="add-item" class="bg-amber-500 hover:bg-amber-400 text-slate-900 font-medium px-3 py-2 rounded-lg">+ Position</button>
      </div>

      <div class="overflow-auto">
        <table class="w-full text-sm">
          <thead class="text-slate-400">
            <tr>
              <th class="text-left py-2 pr-2">Typ</th>
              <th class="text-left py-2 pr-2">Beschreibung</th>
              <th class="text-right py-2 pr-2">Menge</th>
              <th class="text-right py-2 pr-2">Preis</th>
              <th class="text-right py-2 pr-2">Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" class="py-3 text-slate-500">Noch keine Positionen</td></tr>`}</tbody>
        </table>
      </div>

      <div class="mt-3 text-right text-slate-200 font-semibold">Summe: ${money(total)}</div>
    </div>
  `;
}

async function addItemRow(jobId){
  const type = prompt('Typ (arbeit/material)', 'arbeit');
  if(!type) return;
  const desc = prompt('Beschreibung', '') || '';
  const qty = Number(prompt('Menge', '1') || '1');
  const price = Number(prompt('Einzelpreis (CHF)', '0') || '0');
  const payload = { job_id: jobId, item_type: type, description: desc, qty, unit_price: price };
  const { error } = await createRow('job_items', payload);
  if(error) showToast('Fehler: ' + (error.message||'')); else await loadAll();
}

// --------------------
// Photos (storage bucket job-photos + table job_photos)
// --------------------
function photoPublicUrl(path){
  try{
    return supabase.storage.from('job-photos').getPublicUrl(path).data.publicUrl;
  } catch { return null; }
}

function renderPhotosBlock(job){
  const photos = getPhotos(job.id);
  const idPhoto = photos.find(p=>p.kind==='id');
  const general = photos.filter(p=>p.kind!=='id');

  const idUrl = idPhoto ? photoPublicUrl(idPhoto.path) : null;

  const generalHtml = general.map(p=>{
    const url = photoPublicUrl(p.path);
    return `
      <div class="relative group">
        <img src="${url}" class="w-full h-32 object-cover rounded-lg border border-slate-700">
        <button data-del-photo="${p.id}" class="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100">X</button>
      </div>`;
  }).join('');

  return `
    <div class="bg-slate-800/40 border border-slate-700 rounded-xl p-5">
      <h3 class="text-slate-100 font-semibold mb-3">Fotos / Dokumente</h3>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="bg-slate-900/40 rounded-xl border border-slate-700 p-4">
          <div class="flex items-center justify-between">
            <p class="text-slate-200 font-medium">Ausweis Foto</p>
          </div>
          <div class="mt-3">
            ${idUrl ? `<img src="${idUrl}" class="w-full h-48 object-cover rounded-lg border border-slate-700">` : `<p class="text-slate-500 text-sm">Noch kein Ausweis-Foto</p>`}
          </div>
          <div class="mt-3">
            <input id="id-upload" type="file" accept="image/*" capture="environment" class="block w-full text-slate-300 text-sm">
          </div>
        </div>

        <div class="bg-slate-900/40 rounded-xl border border-slate-700 p-4">
          <p class="text-slate-200 font-medium">Fahrzeug / Schäden</p>
          <div class="mt-3 grid grid-cols-2 gap-3">
            ${generalHtml || `<p class="text-slate-500 text-sm col-span-2">Noch keine Fotos</p>`}
          </div>
          <div class="mt-3">
            <input id="photo-upload" type="file" accept="image/*" capture="environment" class="block w-full text-slate-300 text-sm">
          </div>
        </div>
      </div>
    </div>
  `;
}

async function uploadPhoto(jobId, file, kind){
  if(!file) return;
  if(!currentJobId) return;
  try{
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${jobId}/${kind}-${Date.now()}.${ext}`;

    const up = await supabase.storage.from('job-photos').upload(path, file, { upsert: true });
    if(up.error) return showToast('Upload Fehler: ' + (up.error.message||''));

    // for id photo, replace previous
    if(kind === 'id'){
      const old = getPhotos(jobId).find(p=>p.kind==='id');
      if(old){
        await supabase.storage.from('job-photos').remove([old.path]).catch(()=>{});
        await deleteRow('job_photos', { id: old.id }).catch(()=>{});
      }
    }

    const { error } = await createRow('job_photos', { job_id: jobId, path, kind });
    if(error) showToast('DB Fehler: ' + (error.message||'')); else { showToast('Foto gespeichert'); await loadAll(); }
  } catch(e){
    showToast('Fehler beim Upload');
  }
}

// --------------------
// Time tracking
// --------------------
function renderTimeEntries(){
  const entries = getEntries(currentJobId);
  const container = document.getElementById('time-entries');
  const runningTimerEl = document.getElementById('running-timer');
  runningEntry = entries.find(e => !e.end_ts);

  if(runningEntry){
    runningTimerEl?.classList.remove('hidden');
    document.getElementById('running-worker').textContent = runningEntry.worker;
    document.getElementById('running-task').textContent = runningEntry.task || '--';
    document.getElementById('running-start').textContent = formatDate(runningEntry.start_ts);
    updateRunningDuration();
  } else {
    runningTimerEl?.classList.add('hidden');
  }

  const completed = entries.filter(e => e.end_ts);
  if(container){
    if(completed.length === 0){
      container.innerHTML = '<p class="text-slate-500 text-center py-4">Keine abgeschlossenen Zeiteinträge</p>';
    } else {
      completed.sort((a,b)=> new Date(b.start_ts) - new Date(a.start_ts));
      container.innerHTML = completed.map(e=>{
        const dur = calculateDuration(e.start_ts, e.end_ts);
        return `<div class="bg-slate-700/30 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="font-medium text-slate-200">${e.worker} - ${e.task || '--'}</p>
            <p class="text-xs text-slate-500">${formatDate(e.start_ts)} - ${formatDate(e.end_ts)}</p>
          </div>
          <span class="text-amber-400 font-medium">${formatDuration(dur)}</span>
        </div>`;
      }).join('');
    }
  }

  // summary
  const summary = document.getElementById('time-summary');
  if(entries.length > 0 && summary){
    summary.classList.remove('hidden');
    let total = 0;
    const perWorker = {};
    entries.forEach(e=>{
      const m = calculateDuration(e.start_ts, e.end_ts);
      total += m;
      perWorker[e.worker] = (perWorker[e.worker] || 0) + m;
    });
    document.getElementById('total-time').textContent = formatDuration(total);
    document.getElementById('worker-totals').innerHTML = Object.entries(perWorker).map(([w,m])=>`
      <div class="flex justify-between text-sm">
        <span class="text-slate-400">${w}</span>
        <span class="text-slate-300">${formatDuration(m)}</span>
      </div>`).join('');
  } else summary?.classList.add('hidden');
}

function updateRunningDuration(){
  if(!runningEntry) return;
  const minutes = calculateDuration(runningEntry.start_ts, null);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const el = document.getElementById('running-duration');
  if(el) el.textContent = `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}
function startTimerInterval(){
  stopTimerInterval();
  timerInterval = setInterval(updateRunningDuration, 1000);
}
function stopTimerInterval(){
  if(timerInterval){
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function startTimer(){
  if(!currentJobId) return;
  if(getEntries(currentJobId).some(e => !e.end_ts)) return showToast('Es läuft bereits ein Timer');
  const worker = document.getElementById('worker-select').value;
  const task = document.getElementById('task-select').value;
  const entry = { job_id: currentJobId, worker, task, start_ts: new Date().toISOString(), end_ts: null };
  const { error } = await createRow('entries', entry);
  if(error) showToast('Fehler beim Starten: ' + (error.message||'')); else { showToast('Timer gestartet'); await loadAll(); }
}

async function stopTimer(){
  if(!runningEntry) return;
  const { error } = await updateRow('entries', { end_ts: new Date().toISOString() }, { id: runningEntry.id });
  if(error) showToast('Fehler beim Stoppen: ' + (error.message||'')); else { showToast('Timer gestoppt'); await loadAll(); }
}

// --------------------
// Signature (existing UI canvas)
// --------------------
let signatureCtx = null;
function setupSignatureCanvas(){
  setTimeout(()=>{
    const canvas = document.getElementById('signature-canvas');
    if(!canvas) return;
    signatureCtx = canvas.getContext('2d');
    canvas.width = 600; canvas.height = 400;
    signatureCtx.fillStyle = '#FFFFFF';
    signatureCtx.fillRect(0,0,canvas.width,canvas.height);
    signatureCtx.strokeStyle = '#000000';
    signatureCtx.lineWidth = 3;
    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';

    let isDrawing = false, lastX = 0, lastY = 0;

    function getCoordinates(e){
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      if(e.touches && e.touches[0]){
        return { x:(e.touches[0].clientX-rect.left)*scaleX, y:(e.touches[0].clientY-rect.top)*scaleY };
      }
      return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY };
    }

    function startDraw(e){
      e.preventDefault();
      isDrawing = true;
      const c = getCoordinates(e);
      lastX = c.x; lastY = c.y;
    }
    function draw(e){
      if(!isDrawing) return;
      e.preventDefault();
      const c = getCoordinates(e);
      signatureCtx.beginPath();
      signatureCtx.moveTo(lastX,lastY);
      signatureCtx.lineTo(c.x,c.y);
      signatureCtx.stroke();
      lastX=c.x; lastY=c.y;
    }
    function stopDraw(e){
      if(isDrawing) e.preventDefault();
      isDrawing = false;
    }

    canvas.addEventListener('mousedown', startDraw, { passive:false });
    canvas.addEventListener('mousemove', draw, { passive:false });
    canvas.addEventListener('mouseup', stopDraw, { passive:false });
    canvas.addEventListener('mouseleave', stopDraw, { passive:false });

    canvas.addEventListener('touchstart', startDraw, { passive:false });
    canvas.addEventListener('touchmove', draw, { passive:false });
    canvas.addEventListener('touchend', stopDraw, { passive:false });
    canvas.addEventListener('touchcancel', stopDraw, { passive:false });
  }, 250);
}

function clearSignatureCanvas(){
  const canvas = document.getElementById('signature-canvas');
  if(signatureCtx && canvas){
    signatureCtx.fillStyle = '#FFFFFF';
    signatureCtx.fillRect(0,0,canvas.width,canvas.height);
  }
}

function canvasHasInk(canvas){
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<data.length;i+=4){
    const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
    if(a === 0) continue;
    if(r<245 || g<245 || b<245) return true;
  }
  return false;
}

async function saveSignature(){
  const name = document.getElementById('signer-name').value.trim();
  if(!name) return showToast('Bitte Namen eingeben');
  if(!currentJobId) return;
  const canvas = document.getElementById('signature-canvas');
  if(!canvasHasInk(canvas)) return showToast('Bitte unterschreiben');

  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = 200; smallCanvas.height = 100;
  const smallCtx = smallCanvas.getContext('2d');
  smallCtx.fillStyle = '#FFFFFF';
  smallCtx.fillRect(0,0,smallCanvas.width,smallCanvas.height);
  smallCtx.drawImage(canvas,0,0,smallCanvas.width,smallCanvas.height);
  const signatureData = smallCanvas.toDataURL('image/jpeg', 0.6);

  const payload = { job_id: currentJobId, signer_name: name, signature_data: signatureData, signed_at: new Date().toISOString() };
  const { error } = await supabase.from('signatures').upsert(payload, { onConflict:'job_id' });
  if(error) showToast('Fehler: ' + (error.message||'')); else { showToast('Unterschrift gespeichert ✓'); document.getElementById('signer-name').value=''; clearSignatureCanvas(); await loadAll(); }
}

function renderSignature(){
  const signature = getSignature(currentJobId);
  const displayEl = document.getElementById('signature-display');
  const formEl = document.getElementById('signature-form');

  if(signature && signature.signature_data){
    displayEl?.classList.remove('hidden');
    formEl?.classList.add('hidden');
    document.getElementById('signature-image').src = signature.signature_data;
    document.getElementById('signed-by').textContent = signature.signer_name || '--';
    document.getElementById('signed-at').textContent = formatDate(signature.signed_at);
  } else {
    displayEl?.classList.add('hidden');
    formEl?.classList.remove('hidden');
    clearSignatureCanvas();
  }
}

// --------------------
// Create / close / delete jobs
// --------------------
function uppercasePlateInput(el){
  if(!el) return;
  el.addEventListener('input', ()=>{
    const pos = el.selectionStart;
    el.value = (el.value || '').toUpperCase();
    if(pos !== null) el.setSelectionRange(pos,pos);
  });
}

async function createNewJob(){
  const title = document.getElementById('new-job-title').value.trim();
  if(!title) return showToast('Bitte Auftragstitel eingeben');

  const plate = (document.getElementById('new-job-plate').value || '').trim().toUpperCase();

  const payload = {
    title,
    customer: document.getElementById('new-job-customer').value.trim(),
    vehicle: document.getElementById('new-job-vehicle').value.trim(),
    plate,
    status: 'open',
    created_at: new Date().toISOString(),
    closed_at: null
  };

  const { error } = await createRow('jobs', payload);
  if(error) showToast('Fehler beim Erstellen: ' + (error.message||'')); else { showToast('Auftrag erstellt'); closeModal('new-job-modal'); clearNewJobForm(); await loadAll(); }
}

function clearNewJobForm(){
  ['new-job-title','new-job-customer','new-job-vehicle','new-job-plate'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = '';
  });
}

// auto-stop timers on close + enforce KM
async function closeJob(){
  if(!currentJobId) return;

  // enforce KM
  const job = allJobs.find(j=>j.id===currentJobId);
  const km = job?.odometer_km ?? null;
  if(!km || Number(km) <= 0){
    showToast('KM-Stand fehlt. Bitte im Auftrag eintragen.');
    // focus
    document.getElementById('odometer-input')?.focus();
    return;
  }

  // auto-stop running timer if any
  const running = getEntries(currentJobId).find(e=>!e.end_ts);
  if(running){
    await updateRow('entries', { end_ts: new Date().toISOString() }, { id: running.id }).catch(()=>{});
  }

  const { error } = await updateRow('jobs', { status:'done', closed_at: new Date().toISOString() }, { id: currentJobId });
  if(error) showToast('Fehler: ' + (error.message||'')); else { showToast('Auftrag abgeschlossen'); await loadAll(); handleRoute(); }
}

async function deleteJob(){
  if(!currentJobId) return;

  // delete related tables first (ignore errors)
  await deleteRow('entries', { job_id: currentJobId }).catch(()=>{});
  await deleteRow('signatures', { job_id: currentJobId }).catch(()=>{});
  await deleteRow('job_items', { job_id: currentJobId }).catch(()=>{});
  const photos = getPhotos(currentJobId);
  if(photos.length){
    await supabase.storage.from('job-photos').remove(photos.map(p=>p.path)).catch(()=>{});
    await deleteRow('job_photos', { job_id: currentJobId }).catch(()=>{});
  }

  const { error } = await deleteRow('jobs', { id: currentJobId });
  if(error) showToast('Fehler: ' + (error.message||'')); else { showToast('Auftrag gelöscht'); navigateTo('/'); await loadAll(); }
}

// --------------------
// PDF (print-to-PDF, beautiful layout) + QR
// --------------------
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

async function exportPdf(jobId){
  const job = allJobs.find(j=>j.id===jobId);
  if(!job) return;

  const url = jobUrl(jobId);
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 220 });

  const entries = getEntries(jobId).slice().sort((a,b)=> new Date(a.start_ts) - new Date(b.start_ts));
  const items = getItems(jobId);
  const photos = getPhotos(jobId);
  const signature = getSignature(jobId);

  const idPhoto = photos.find(p=>p.kind==='id');
  const idUrl = idPhoto ? photoPublicUrl(idPhoto.path) : null;
  const general = photos.filter(p=>p.kind!=='id').slice(0,6).map(p=>photoPublicUrl(p.path)).filter(Boolean);

  const itemsTotal = items.reduce((s,it)=> s + (Number(it.qty||0) * Number(it.unit_price||0)), 0);

  const checklist = getChecklist(job);

  const html = `
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>Auftrag ${escapeHtml(job.job_no || jobId)}</title>
      <style>
        body{ font-family: Arial, sans-serif; color:#0f172a; margin: 24px; }
        .top{ display:flex; justify-content:space-between; gap:20px; align-items:flex-start; }
        .brand h1{ margin:0; font-size:22px; }
        .brand p{ margin:4px 0 0; color:#334155; }
        .card{ border:1px solid #cbd5e1; border-radius:12px; padding:14px; margin-top:14px; }
        .grid{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
        .label{ color:#64748b; font-size:12px; }
        .val{ font-size:14px; font-weight:600; }
        table{ width:100%; border-collapse:collapse; margin-top:8px; }
        th,td{ border-top:1px solid #e2e8f0; padding:8px; text-align:left; font-size:12px; }
        th{ background:#f8fafc; }
        .right{ text-align:right; }
        .muted{ color:#64748b; font-size:12px; }
        .photos{ display:grid; grid-template-columns: repeat(3, 1fr); gap:8px; margin-top:10px; }
        .photos img{ width:100%; height:140px; object-fit:cover; border-radius:10px; border:1px solid #e2e8f0; }
        .sig img{ width:260px; border:1px solid #e2e8f0; border-radius:10px; background:#fff; padding:6px; }
        @media print { .noprint{ display:none; } body{ margin: 0; } }
      </style>
    </head>
    <body>
      <div class="top">
        <div class="brand">
          <h1>${escapeHtml(config.company_name)} – Auftrag</h1>
          <p>${escapeHtml(config.app_title)}</p>
          <p class="muted">Erstellt: ${escapeHtml(formatDate(job.created_at))} • Status: ${escapeHtml(job.status==='done'?'Erledigt':'Offen')}</p>
        </div>
        <div>
          <img src="${qr}" alt="QR" style="width:140px;height:140px;border:1px solid #e2e8f0;border-radius:12px;padding:6px;background:#fff"/>
          <div class="muted" style="margin-top:6px; max-width:220px; word-break:break-all;">${escapeHtml(url)}</div>
        </div>
      </div>

      <div class="card">
        <div class="grid">
          <div><div class="label">Auftrags-Nr</div><div class="val">${escapeHtml(job.job_no || '--')}</div></div>
          <div><div class="label">Titel</div><div class="val">${escapeHtml(job.title||'')}</div></div>
          <div><div class="label">Kennzeichen</div><div class="val">${escapeHtml(job.plate||'')}</div></div>
          <div><div class="label">Kunde</div><div class="val">${escapeHtml(job.customer||'')}</div></div>
          <div><div class="label">Fahrzeug</div><div class="val">${escapeHtml(job.vehicle||'')}</div></div>
          <div><div class="label">KM-Stand</div><div class="val">${escapeHtml(job.odometer_km ?? '--')}</div></div>
          <div><div class="label">Abgabe</div><div class="val">${escapeHtml(job.dropoff_at ? formatDate(job.dropoff_at) : '--')}</div></div>
          <div><div class="label">Abholung</div><div class="val">${escapeHtml(job.pickup_at ? formatDate(job.pickup_at) : '--')}</div></div>
          <div><div class="label">Wichtig</div><div class="val">${job.important ? 'Ja' : 'Nein'}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="val">Checkliste</div>
        <div class="muted" style="margin-top:6px;">
          ${CHECKLIST_KEYS.map(([k,label])=> `${checklist[k] ? '☑' : '☐'} ${escapeHtml(label)}`).join('<br/>')}
        </div>
      </div>

      <div class="card">
        <div class="val">Arbeiten & Material</div>
        <table>
          <thead>
            <tr><th>Typ</th><th>Beschreibung</th><th class="right">Menge</th><th class="right">Preis</th><th class="right">Total</th></tr>
          </thead>
          <tbody>
            ${items.length ? items.map(it=>`
              <tr>
                <td>${escapeHtml(it.item_type||'')}</td>
                <td>${escapeHtml(it.description||'')}</td>
                <td class="right">${escapeHtml(it.qty ?? '')}</td>
                <td class="right">${escapeHtml(money(it.unit_price))}</td>
                <td class="right">${escapeHtml(money((it.qty||0)*(it.unit_price||0)))}</td>
              </tr>
            `).join('') : `<tr><td colspan="5" class="muted">Keine Positionen</td></tr>`}
          </tbody>
        </table>
        <div class="right" style="margin-top:8px; font-weight:700;">Summe: ${escapeHtml(money(itemsTotal))}</div>
      </div>

      <div class="card">
        <div class="val">Zeiterfassung</div>
        <table>
          <thead>
            <tr><th>Mitarbeiter</th><th>Aufgabe</th><th>Start</th><th>Ende</th><th class="right">Dauer</th></tr>
          </thead>
          <tbody>
            ${entries.length ? entries.map(e=>{
              const dur = calculateDuration(e.start_ts, e.end_ts);
              return `<tr>
                <td>${escapeHtml(e.worker||'')}</td>
                <td>${escapeHtml(e.task||'')}</td>
                <td>${escapeHtml(formatDate(e.start_ts))}</td>
                <td>${escapeHtml(e.end_ts ? formatDate(e.end_ts) : '--')}</td>
                <td class="right">${escapeHtml(formatDuration(dur))}</td>
              </tr>`;
            }).join('') : `<tr><td colspan="5" class="muted">Keine Zeiteinträge</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="card">
        <div class="val">Dokumente / Fotos</div>
        ${idUrl ? `<div class="muted" style="margin-top:6px;">Ausweis Foto:</div><img src="${idUrl}" style="width:320px;height:200px;object-fit:cover;border-radius:12px;border:1px solid #e2e8f0;margin-top:6px;"/>` : `<div class="muted" style="margin-top:6px;">Kein Ausweis Foto</div>`}
        ${general.length ? `<div class="muted" style="margin-top:10px;">Fahrzeug / Schäden:</div><div class="photos">${general.map(u=>`<img src="${u}"/>`).join('')}</div>` : ''}
      </div>

      <div class="card sig">
        <div class="val">Unterschrift</div>
        ${signature?.signature_data ? `
          <div class="muted" style="margin-top:6px;">${escapeHtml(signature.signer_name || '--')} • ${escapeHtml(formatDate(signature.signed_at))}</div>
          <img src="${signature.signature_data}" alt="Unterschrift"/>
        ` : `<div class="muted" style="margin-top:6px;">Keine Unterschrift</div>`}
      </div>

      <div class="noprint" style="margin-top:16px;">
        <button onclick="window.print()" style="padding:10px 14px; border-radius:10px; border:1px solid #cbd5e1; background:#0f172a; color:#fff; cursor:pointer;">Drucken / Als PDF speichern</button>
      </div>
    </body>
  </html>`;

  const w = window.open('', '_blank');
  if(!w) return showToast('Popup blockiert – bitte erlauben');
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// --------------------
// Modal helpers
// --------------------
function openModal(id){ document.getElementById(id)?.classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id)?.classList.add('hidden'); }

// --------------------
// Events / init
// --------------------
function setupEventListeners(){
  document.getElementById('new-job-btn')?.addEventListener('click', ()=>openModal('new-job-modal'));
  document.getElementById('cancel-new-job-btn')?.addEventListener('click', ()=>{ closeModal('new-job-modal'); clearNewJobForm(); });
  document.getElementById('save-new-job-btn')?.addEventListener('click', createNewJob);

  document.getElementById('view-list-btn')?.addEventListener('click', ()=>navigateTo('/'));
  document.getElementById('view-detail-btn')?.addEventListener('click', ()=> currentJobId && navigateTo(`/job/${currentJobId}`));
  document.getElementById('back-to-list-btn')?.addEventListener('click', ()=>navigateTo('/'));

  document.getElementById('start-timer-btn')?.addEventListener('click', startTimer);
  document.getElementById('stop-timer-btn')?.addEventListener('click', stopTimer);

  document.getElementById('clear-signature-btn')?.addEventListener('click', clearSignatureCanvas);
  document.getElementById('save-signature-btn')?.addEventListener('click', saveSignature);

  document.getElementById('close-job-btn')?.addEventListener('click', closeJob);

  document.getElementById('delete-job-btn')?.addEventListener('click', ()=>openModal('delete-confirm-modal'));
  document.getElementById('cancel-delete-btn')?.addEventListener('click', ()=>closeModal('delete-confirm-modal'));
  document.getElementById('confirm-delete-btn')?.addEventListener('click', ()=>{ closeModal('delete-confirm-modal'); deleteJob(); });

  document.getElementById('filter-status')?.addEventListener('change', renderJobList);

  ['new-job-modal','delete-confirm-modal'].forEach(modalId=>{
    document.getElementById(modalId)?.addEventListener('click',(e)=>{ if(e.target.id===modalId) closeModal(modalId); });
  });

  // plate uppercase
  uppercasePlateInput(document.getElementById('new-job-plate'));
  uppercasePlateInput(document.getElementById('edit-job-plate'));
}

function handleRoute(){
  const id = getPathJobId();
  if(id){
    currentJobId = id;
    showJobDetail();
  } else {
    currentJobId = null;
    showJobList();
  }
}

async function init(){
  applyConfig(config);
  setupEventListeners();
  setupSignatureCanvas();

  try{
    await loadAll();
  } catch(e){
    console.error(e);
    showToast('Supabase prüfen (URL/Key/RLS/Tables)');
  }

  handleRoute();
}
init();
