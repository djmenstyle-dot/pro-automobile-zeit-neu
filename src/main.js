import { createClient } from '@supabase/supabase-js';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '');

// Default Config
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

// State
let allJobs = [];
let allEntries = [];
let allSignatures = [];
let currentJobId = null;
let runningEntry = null;
let timerInterval = null;
let signatureCtx = null;

// Utils
function formatDate(iso){ if(!iso) return '--'; return new Date(iso).toLocaleString('de-CH'); }
function formatDuration(min){ if(min<60) return `${min}min`; const h=Math.floor(min/60); const m=min%60; return `${h}h ${m}min`; }
function calculateDuration(startTs,endTs){ const s=new Date(startTs).getTime(); const e=endTs?new Date(endTs).getTime():Date.now(); return Math.max(0, Math.round((e-s)/60000)); }
function showToast(msg){ const t=document.getElementById('toast'); const m=document.getElementById('toast-message'); m.textContent=msg; t.classList.remove('translate-y-20','opacity-0'); setTimeout(()=>t.classList.add('translate-y-20','opacity-0'),3500); }
function getEntries(jobId){ return allEntries.filter(e=>e.job_id===jobId); }
function getSignature(jobId){ return allSignatures.find(s=>s.job_id===jobId); }

function makeJobUrl(jobId){
  const origin = window.location.origin;
  return `${origin}/job/${jobId}`;
}

async function renderJobQr(jobId){
  try{
    const url = makeJobUrl(jobId);
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
    let img = document.getElementById('job-qr-img');
    if (!img){
      const titleEl = document.getElementById('detail-title');
      const header = titleEl?.closest('div') || titleEl?.parentElement || document.getElementById('job-detail-view');
      if (!header) return;
      const wrap = document.createElement('div');
      wrap.id = 'job-qr-wrap';
      wrap.className = 'mt-4 flex items-start gap-4';
      wrap.innerHTML = `
        <div class="bg-slate-900/40 border border-slate-700 rounded-xl p-3">
          <div class="text-xs text-slate-400 mb-2">QR Code (Auftrag öffnen)</div>
          <img id="job-qr-img" class="w-28 h-28 rounded-lg bg-white p-1" alt="QR Code" />
          <div id="job-qr-url" class="mt-2 text-[10px] text-slate-500 break-all max-w-[220px]"></div>
        </div>
      `;
      header.appendChild(wrap);
      img = document.getElementById('job-qr-img');
    }
    img.src = dataUrl;
    const urlEl = document.getElementById('job-qr-url');
    if (urlEl) urlEl.textContent = url;
  }catch(e){
    console.error(e);
  }
}

async function exportJobPdf(){
  if(!currentJobId) return;
  const job = allJobs.find(j=>j.id===currentJobId);
  if(!job) return;

  const entries = getEntries(currentJobId);
  const signature = getSignature(currentJobId);

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFont('helvetica','bold');
  doc.setFontSize(18);
  doc.text(config.company_name || 'Pro Automobile', margin, 50);

  doc.setFont('helvetica','normal');
  doc.setFontSize(12);
  doc.text('Auftrag / Zeiterfassung', margin, 70);

  doc.setDrawColor(200);
  doc.line(margin, 85, pageWidth - margin, 85);

  let y = 110;
  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(job.title || 'Ohne Titel', margin, y); y += 18;

  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  const rows = [
    ['Kunde', job.customer || '--'],
    ['Fahrzeug', job.vehicle || '--'],
    ['Kennzeichen', (job.plate || '--').toUpperCase()],
    ['Status', job.status === 'done' ? 'Erledigt' : 'Offen'],
    ['Erstellt', formatDate(job.created_at)],
    ['Abgeschlossen', job.closed_at ? formatDate(job.closed_at) : '--'],
    ['Auftrags-ID', job.id],
  ];
  rows.forEach(([k,v])=>{
    doc.setFont('helvetica','bold'); doc.text(k+':', margin, y);
    doc.setFont('helvetica','normal'); doc.text(String(v), margin+110, y);
    y += 16;
  });

  const url = makeJobUrl(job.id);
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  doc.setFont('helvetica','bold');
  doc.text('QR Code', pageWidth - margin - 140, 110);
  doc.addImage(qrDataUrl, 'PNG', pageWidth - margin - 140, 120, 120, 120);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8);
  doc.text(url, pageWidth - margin - 140, 250, { maxWidth: 140 });

  y += 10;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('Zeiteinträge', margin, y); y += 14;
  doc.setFont('helvetica','normal'); doc.setFontSize(10);

  const sorted = [...entries].sort((a,b)=> new Date(a.start_ts) - new Date(b.start_ts));
  const header = ['Mitarbeiter', 'Arbeit', 'Start', 'Ende', 'Dauer'];
  const colX = [margin, margin+110, margin+230, margin+340, margin+450];

  doc.setFont('helvetica','bold');
  header.forEach((h,i)=>doc.text(h, colX[i], y));
  y += 10;
  doc.setFont('helvetica','normal');
  doc.setDrawColor(180);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;

  let total = 0;
  for (const e of sorted){
    const dur = calculateDuration(e.start_ts, e.end_ts);
    total += dur;
    const vals = [
      e.worker,
      e.task || '--',
      formatDate(e.start_ts),
      e.end_ts ? formatDate(e.end_ts) : '--',
      formatDuration(dur)
    ];
    vals.forEach((v,i)=>{
      doc.text(String(v).slice(0, 38), colX[i], y, { maxWidth: (i===1?100:120) });
    });
    y += 14;
    if (y > 720){
      doc.addPage();
      y = 60;
    }
  }

  doc.setFont('helvetica','bold');
  doc.text('Total:', margin+340, y+10);
  doc.text(formatDuration(total), margin+450, y+10);
  y += 40;

  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text('Unterschrift', margin, y); y += 12;

  if(signature && signature.signature_data){
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text(`Name: ${signature.signer_name || '--'}`, margin, y+14);
    doc.text(`Datum: ${formatDate(signature.signed_at)}`, margin, y+28);
    doc.addImage(signature.signature_data, 'JPEG', margin+260, y, 200, 100);
    y += 120;
  } else {
    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    doc.text('Keine Unterschrift vorhanden.', margin, y+14);
    y += 40;
  }

  doc.save(`auftrag_${job.plate || job.id}.pdf`);
}

// Router
function getPathJobId(){ const m=window.location.pathname.match(/^\/job\/([0-9a-fA-F-]{36})\/?$/); return m?m[1]:null; }
function navigateTo(path){ window.history.pushState({},'',path); handleRoute(); }
window.addEventListener('popstate', handleRoute);

// Supabase load
async function loadAll(){
  const [jobsRes, entriesRes, sigRes] = await Promise.all([
    supabase.from('jobs').select('*'),
    supabase.from('entries').select('*'),
    supabase.from('signatures').select('*'),
  ]);
  if(jobsRes.error) throw jobsRes.error;
  if(entriesRes.error) throw entriesRes.error;
  if(sigRes.error) throw sigRes.error;
  allJobs = jobsRes.data ?? [];
  allEntries = entriesRes.data ?? [];
  allSignatures = sigRes.data ?? [];
  updateStats(); renderJobList(); if(currentJobId) renderJobDetail();
}
const createRow=(t,p)=>supabase.from(t).insert(p);
const updateRow=(t,p,m)=>supabase.from(t).update(p).match(m);
const deleteRow=(t,m)=>supabase.from(t).delete().match(m);

// UI helpers
function applyConfig(cfg){
  const appTitle=document.getElementById('app-title');
  const companyName=document.getElementById('company-name');
  if(appTitle) appTitle.textContent=cfg.app_title||defaultConfig.app_title;
  if(companyName) companyName.textContent=cfg.company_name||defaultConfig.company_name;
  document.documentElement.style.setProperty('--primary', cfg.primary_color||defaultConfig.primary_color);
  document.documentElement.style.setProperty('--secondary', cfg.secondary_color||defaultConfig.secondary_color);
}
function updateStats(){
  const openJobs=allJobs.filter(j=>j.status==='open').length;
  const doneJobs=allJobs.filter(j=>j.status==='done').length;
  const activeEntries=allEntries.filter(e=>!e.end_ts).length;
  document.getElementById('stat-total').textContent=String(allJobs.length);
  document.getElementById('stat-open').textContent=String(openJobs);
  document.getElementById('stat-done').textContent=String(doneJobs);
  document.getElementById('stat-active').textContent=String(activeEntries);
}

function renderJobList(){
  const container=document.getElementById('job-list');
  const filterStatus=document.getElementById('filter-status').value;
  let jobs=[...allJobs];
  if(filterStatus!=='all') jobs=jobs.filter(j=>j.status===filterStatus);
  jobs.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  if(jobs.length===0){ container.innerHTML='<div class="p-8 text-center text-slate-500"><p>Keine Aufträge gefunden</p></div>'; return; }
  container.innerHTML = jobs.map(job=>{
    const entries=getEntries(job.id);
    const totalMinutes=entries.reduce((s,e)=>s+calculateDuration(e.start_ts,e.end_ts),0);
    const hasRunning=entries.some(e=>!e.end_ts);
    const statusClass=job.status==='done'?'bg-green-500/20 text-green-400':'bg-amber-500/20 text-amber-400';
    const statusText=job.status==='done'?'Erledigt':'Offen';
    return `
      <div class="p-4 hover:bg-slate-700/50 cursor-pointer transition-colors" data-job-id="${job.id}">
        <div class="flex items-center justify-between">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="font-semibold text-white truncate">${job.title||'Ohne Titel'}</h3>
              ${hasRunning?'<span class="w-2 h-2 bg-amber-500 rounded-full animate-pulse-dot"></span>':''}
            </div>
            <div class="flex items-center gap-4 mt-1 text-sm text-slate-400">
              <span>${job.customer||'--'}</span>
              <span>${job.vehicle||'--'}</span>
              <span>${job.plate||'--'}</span>
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
    el.addEventListener('click', ()=> navigateTo(`/job/${el.dataset.jobId}`));
  });
}

function showJobDetail(){
  document.getElementById('job-list-view').classList.add('hidden');
  document.getElementById('job-detail-view').classList.remove('hidden');
  document.getElementById('view-detail-btn').classList.remove('hidden');
  document.getElementById('view-list-btn').classList.remove('bg-amber-500','text-slate-900');
  document.getElementById('view-list-btn').classList.add('bg-slate-700','text-slate-300');
  document.getElementById('view-detail-btn').classList.remove('bg-slate-700','text-slate-300');
  document.getElementById('view-detail-btn').classList.add('bg-amber-500','text-slate-900');
  renderJobDetail(); startTimerInterval();
}
function showJobList(){
  document.getElementById('job-detail-view').classList.add('hidden');
  document.getElementById('job-list-view').classList.remove('hidden');
  document.getElementById('view-detail-btn').classList.add('hidden');
  document.getElementById('view-list-btn').classList.remove('bg-slate-700','text-slate-300');
  document.getElementById('view-list-btn').classList.add('bg-amber-500','text-slate-900');
  currentJobId=null; stopTimerInterval();
}

function renderJobDetail(){
  if(!currentJobId) return;
  const job=allJobs.find(j=>j.id===currentJobId);
  if(!job){ showJobList(); return; }
  document.getElementById('detail-title').textContent=job.title||'Ohne Titel';
  document.getElementById('detail-created').textContent='Erstellt: '+formatDate(job.created_at);
  document.getElementById('detail-customer').textContent=job.customer||'--';
  document.getElementById('detail-vehicle').textContent=job.vehicle||'--';
  document.getElementById('detail-plate').textContent=(job.plate||'--').toUpperCase();

  const statusBadge=document.getElementById('detail-status-badge');
  const signature=getSignature(currentJobId);
  const pdfBtn=document.getElementById('export-pdf-btn');

  if(job.status==='done'){
    statusBadge.className='px-3 py-1 rounded-full text-sm font-medium bg-green-500/20 text-green-400';
    statusBadge.textContent='Erledigt';
    document.getElementById('close-job-btn').classList.add('hidden');
    document.getElementById('time-entry-form').classList.add('hidden');
    (signature && signature.signature_data) ? pdfBtn.classList.remove('hidden') : pdfBtn.classList.add('hidden');
  } else {
    statusBadge.className='px-3 py-1 rounded-full text-sm font-medium bg-amber-500/20 text-amber-400';
    statusBadge.textContent='Offen';
    document.getElementById('close-job-btn').classList.remove('hidden');
    document.getElementById('time-entry-form').classList.remove('hidden');
    pdfBtn.classList.add('hidden');
  }
  renderTimeEntries(); renderSignature(); renderJobQr(currentJobId);
}

function renderTimeEntries(){
  const entries=getEntries(currentJobId);
  const container=document.getElementById('time-entries');
  const runningTimerEl=document.getElementById('running-timer');
  runningEntry=entries.find(e=>!e.end_ts);

  if(runningEntry){
    runningTimerEl.classList.remove('hidden');
    document.getElementById('running-worker').textContent=runningEntry.worker;
    document.getElementById('running-task').textContent=runningEntry.task||'--';
    document.getElementById('running-start').textContent=formatDate(runningEntry.start_ts);
    updateRunningDuration();
  } else runningTimerEl.classList.add('hidden');

  const completed=entries.filter(e=>e.end_ts);
  if(completed.length===0) container.innerHTML='<p class="text-slate-500 text-center py-4">Keine abgeschlossenen Zeiteinträge</p>';
  else {
    completed.sort((a,b)=>new Date(b.start_ts)-new Date(a.start_ts));
    container.innerHTML=completed.map(e=>{
      const dur=calculateDuration(e.start_ts,e.end_ts);
      return `<div class="bg-slate-700/30 rounded-lg p-3 flex items-center justify-between">
          <div>
            <p class="font-medium text-slate-200">${e.worker} - ${e.task||'--'}</p>
            <p class="text-xs text-slate-500">${formatDate(e.start_ts)} - ${formatDate(e.end_ts)}</p>
          </div>
          <span class="text-amber-400 font-medium">${formatDuration(dur)}</span>
        </div>`;
    }).join('');
  }

  if(entries.length>0){
    const summary=document.getElementById('time-summary');
    summary.classList.remove('hidden');
    let total=0; const perWorker={};
    entries.forEach(e=>{ const m=calculateDuration(e.start_ts,e.end_ts); total+=m; perWorker[e.worker]=(perWorker[e.worker]||0)+m; });
    document.getElementById('total-time').textContent=formatDuration(total);
    document.getElementById('worker-totals').innerHTML=Object.entries(perWorker).map(([w,m])=>`
      <div class="flex justify-between text-sm">
        <span class="text-slate-400">${w}</span>
        <span class="text-slate-300">${formatDuration(m)}</span>
      </div>`).join('');
  } else document.getElementById('time-summary').classList.add('hidden');
}

function updateRunningDuration(){
  if(!runningEntry) return;
  const minutes=calculateDuration(runningEntry.start_ts,null);
  const h=Math.floor(minutes/60);
  const m=minutes%60;
  document.getElementById('running-duration').textContent=`${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}
function startTimerInterval(){ stopTimerInterval(); timerInterval=setInterval(updateRunningDuration,1000); }
function stopTimerInterval(){ if(timerInterval){ clearInterval(timerInterval); timerInterval=null; } }

async function startTimer(){
  if(!currentJobId) return;
  if(getEntries(currentJobId).some(e=>!e.end_ts)) return showToast('Es läuft bereits ein Timer');
  const worker=document.getElementById('worker-select').value;
  const task=document.getElementById('task-select').value;
  const entry={ job_id: currentJobId, worker, task, start_ts:new Date().toISOString(), end_ts:null };
  const { error } = await createRow('entries', entry);
  if(error) showToast('Fehler beim Starten: '+(error.message||'')); else { showToast('Timer gestartet'); await loadAll(); }
}
async function stopTimer(){
  if(!runningEntry) return;
  const { error } = await updateRow('entries', { end_ts:new Date().toISOString() }, { id: runningEntry.id });
  if(error) showToast('Fehler beim Stoppen: '+(error.message||'')); else { showToast('Timer gestoppt'); await loadAll(); }
}

function setupSignatureCanvas(){
  setTimeout(()=>{
    const canvas=document.getElementById('signature-canvas'); if(!canvas) return;
    signatureCtx=canvas.getContext('2d'); canvas.width=600; canvas.height=400;
    signatureCtx.fillStyle='#FFFFFF'; signatureCtx.fillRect(0,0,canvas.width,canvas.height);
    signatureCtx.strokeStyle='#000000'; signatureCtx.lineWidth=3; signatureCtx.lineCap='round'; signatureCtx.lineJoin='round';
    let isDrawing=false, lastX=0, lastY=0;
    function getCoordinates(e){
      const rect=canvas.getBoundingClientRect(); const scaleX=canvas.width/rect.width; const scaleY=canvas.height/rect.height;
      if(e.touches && e.touches[0]) return { x:(e.touches[0].clientX-rect.left)*scaleX, y:(e.touches[0].clientY-rect.top)*scaleY };
      return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY };
    }
    function startDraw(e){ e.preventDefault(); isDrawing=true; const c=getCoordinates(e); lastX=c.x; lastY=c.y; }
    function draw(e){ if(!isDrawing) return; e.preventDefault(); const c=getCoordinates(e); signatureCtx.beginPath(); signatureCtx.moveTo(lastX,lastY); signatureCtx.lineTo(c.x,c.y); signatureCtx.stroke(); lastX=c.x; lastY=c.y; }
    function stopDraw(e){ if(isDrawing) e.preventDefault(); isDrawing=false; }
    canvas.addEventListener('mousedown', startDraw, { passive:false });
    canvas.addEventListener('mousemove', draw, { passive:false });
    canvas.addEventListener('mouseup', stopDraw, { passive:false });
    canvas.addEventListener('mouseleave', stopDraw, { passive:false });
    canvas.addEventListener('touchstart', startDraw, { passive:false });
    canvas.addEventListener('touchmove', draw, { passive:false });
    canvas.addEventListener('touchend', stopDraw, { passive:false });
    canvas.addEventListener('touchcancel', stopDraw, { passive:false });
  },250);
}
function clearSignatureCanvas(){
  const canvas=document.getElementById('signature-canvas');
  if(signatureCtx && canvas){ signatureCtx.fillStyle='#FFFFFF'; signatureCtx.fillRect(0,0,canvas.width,canvas.height); }
}
function canvasHasInk(canvas){
  const ctx=canvas.getContext('2d'); const { data } = ctx.getImageData(0,0,canvas.width,canvas.height);
  for(let i=0;i<data.length;i+=4){ const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3]; if(a===0) continue; if(r<245||g<245||b<245) return true; }
  return false;
}
async function saveSignature(){
  const name=document.getElementById('signer-name').value.trim();
  if(!name) return showToast('Bitte Namen eingeben');
  if(!currentJobId) return;
  const canvas=document.getElementById('signature-canvas');
  if(!canvasHasInk(canvas)) return showToast('Bitte unterschreiben');
  const smallCanvas=document.createElement('canvas'); smallCanvas.width=200; smallCanvas.height=100;
  const smallCtx=smallCanvas.getContext('2d');
  smallCtx.fillStyle='#FFFFFF'; smallCtx.fillRect(0,0,smallCanvas.width,smallCanvas.height);
  smallCtx.drawImage(canvas,0,0,smallCanvas.width,smallCanvas.height);
  const signatureData=smallCanvas.toDataURL('image/jpeg',0.6);
  const payload={ job_id: currentJobId, signer_name:name, signature_data:signatureData, signed_at:new Date().toISOString() };
  const { error } = await supabase.from('signatures').upsert(payload, { onConflict:'job_id' });
  if(error) showToast('Fehler: '+(error.message||'')); else { showToast('Unterschrift gespeichert ✓'); document.getElementById('signer-name').value=''; clearSignatureCanvas(); await loadAll(); }
}
function renderSignature(){
  const signature=getSignature(currentJobId);
  const displayEl=document.getElementById('signature-display');
  const formEl=document.getElementById('signature-form');
  if(signature && signature.signature_data){
    displayEl.classList.remove('hidden'); formEl.classList.add('hidden');
    document.getElementById('signature-image').src=signature.signature_data;
    document.getElementById('signed-by').textContent=signature.signer_name||'--';
    document.getElementById('signed-at').textContent=formatDate(signature.signed_at);
  } else {
    displayEl.classList.add('hidden'); formEl.classList.remove('hidden'); clearSignatureCanvas();
  }
}

// create / close / delete
async function createNewJob(){
  const title=document.getElementById('new-job-title').value.trim();
  if(!title) return showToast('Bitte Auftragstitel eingeben');
  const payload={
    title,
    customer:document.getElementById('new-job-customer').value.trim(),
    vehicle:document.getElementById('new-job-vehicle').value.trim(),
    plate: document.getElementById('new-job-plate').value.trim().toUpperCase(),
    status:'open',
    created_at:new Date().toISOString(),
    closed_at:null
  };
  const { error } = await createRow('jobs', payload);
  if(error) showToast('Fehler beim Erstellen: '+(error.message||'')); else { showToast('Auftrag erstellt'); closeModal('new-job-modal'); clearNewJobForm(); await loadAll(); }
}
function clearNewJobForm(){ document.getElementById('new-job-title').value=''; document.getElementById('new-job-customer').value=''; document.getElementById('new-job-vehicle').value=''; document.getElementById('new-job-plate').value=''; }
async function closeJob(){
  if(!currentJobId) return;
  if(runningEntry) return showToast('Bitte stoppen Sie zuerst den laufenden Timer');
  const { error } = await updateRow('jobs', { status:'done', closed_at:new Date().toISOString() }, { id: currentJobId });
  if(error) showToast('Fehler: '+(error.message||'')); else { showToast('Auftrag abgeschlossen'); await loadAll(); handleRoute(); }
}
async function deleteJob(){
  if(!currentJobId) return;
  await deleteRow('entries', { job_id: currentJobId }).catch(()=>{});
  await deleteRow('signatures', { job_id: currentJobId }).catch(()=>{});
  const { error } = await deleteRow('jobs', { id: currentJobId });
  if(error) showToast('Fehler: '+(error.message||'')); else { showToast('Auftrag gelöscht'); navigateTo('/'); await loadAll(); }
}

// Modal
function openModal(id){ document.getElementById(id).classList.remove('hidden'); }
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }

// Events
function setupEventListeners(){
  document.getElementById('new-job-btn').addEventListener('click', ()=>openModal('new-job-modal'));
  document.getElementById('cancel-new-job-btn').addEventListener('click', ()=>{ closeModal('new-job-modal'); clearNewJobForm(); });
  document.getElementById('save-new-job-btn').addEventListener('click', createNewJob);

  // Kennzeichen immer GROSS
  const plateInput = document.getElementById('new-job-plate');
  if (plateInput){
    plateInput.addEventListener('input', () => {
      plateInput.value = (plateInput.value || '').toUpperCase();
    });
  }

  document.getElementById('view-list-btn').addEventListener('click', ()=>navigateTo('/'));
  document.getElementById('view-detail-btn').addEventListener('click', ()=> currentJobId && navigateTo(`/job/${currentJobId}`));
  document.getElementById('back-to-list-btn').addEventListener('click', ()=>navigateTo('/'));

  document.getElementById('start-timer-btn').addEventListener('click', startTimer);
  document.getElementById('stop-timer-btn').addEventListener('click', stopTimer);

  document.getElementById('clear-signature-btn').addEventListener('click', clearSignatureCanvas);
  document.getElementById('save-signature-btn').addEventListener('click', saveSignature);

  document.getElementById('close-job-btn').addEventListener('click', closeJob);

  const exportBtn = document.getElementById('export-pdf-btn');
  if (exportBtn){
    exportBtn.addEventListener('click', exportJobPdf);
  }

  document.getElementById('delete-job-btn').addEventListener('click', ()=>openModal('delete-confirm-modal'));
  document.getElementById('cancel-delete-btn').addEventListener('click', ()=>closeModal('delete-confirm-modal'));
  document.getElementById('confirm-delete-btn').addEventListener('click', ()=>{ closeModal('delete-confirm-modal'); deleteJob(); });

  document.getElementById('filter-status').addEventListener('change', renderJobList);

  ['new-job-modal','delete-confirm-modal'].forEach(modalId=>{
    document.getElementById(modalId).addEventListener('click',(e)=>{ if(e.target.id===modalId) closeModal(modalId); });
  });
}

function handleRoute(){
  const id=getPathJobId();
  if(id){ currentJobId=id; showJobDetail(); }
  else { currentJobId=null; showJobList(); }
}

async function init(){
  applyConfig(config);
  setupEventListeners();
  setupSignatureCanvas();
  try{ await loadAll(); } catch(e){ console.error(e); showToast('Supabase prüfen (URL/Key/RLS)'); }
  handleRoute();
}
init();
