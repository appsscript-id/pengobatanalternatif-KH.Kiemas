// Isi dengan URL Web App Google Apps Script setelah deployment.
const API_URL = 'https://script.google.com/macros/s/AKfycbw9onG0TnP78rEaay7PyqcRqiXniZmVh_hobrHmReSx3lfIF4bk_sOwoOLyqqg5MOAB/exec';
let adminPin = '';
let queueItems = [];
let toastTimer;

const $ = (id) => document.getElementById(id);
const today = () => {
  const d = new Date(), local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
};
$('year').textContent = new Date().getFullYear();
$('filterDate').value = today();

function notify(message) {
  const el=$('toast'); el.textContent=message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),2800);
}
function api(params) {
  return new Promise((resolve,reject)=>{
    if (!API_URL || API_URL.includes('TEMPEL_URL')) return reject(new Error('URL Web App belum diatur pada app.js.'));
    const callback='antrianCallback'+Date.now()+Math.floor(Math.random()*1000);
    const script=document.createElement('script');
    const query=new URLSearchParams({...params,callback});
    window[callback]=(data)=>{cleanup(); data&&data.ok?resolve(data):reject(new Error(data?.message||'Permintaan gagal.'));};
    function cleanup(){delete window[callback];script.remove();clearTimeout(timer);}
    script.onerror=()=>{cleanup();reject(new Error('Tidak dapat terhubung ke server. Periksa URL dan deployment Apps Script.'));};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Server tidak merespons. Coba lagi.'));},15000);
    script.src=API_URL+'?'+query.toString();document.body.appendChild(script);
  });
}
document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===btn));
  $('patientView').classList.toggle('hidden',btn.dataset.view!=='patient');
  $('adminView').classList.toggle('hidden',btn.dataset.view!=='admin');
}));
$('takeForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=$('takeBtn');btn.disabled=true;btn.textContent='Memproses...';
  try{
    const data=await api({action:'take',name:$('patientName').value.trim(),age:$('patientAge').value.trim(),address:$('patientAddress').value.trim(),phone:$('patientPhone').value.trim(),note:$('patientNote').value.trim()});
    $('ticketNumber').textContent=data.item.number;$('ticketName').textContent=data.item.name+' · '+data.item.age+' tahun · '+data.item.phone;
    $('ticketResult').classList.remove('hidden');$('ticketResult').scrollIntoView({behavior:'smooth',block:'center'});
    $('takeForm').reset();notify('Nomor antrian berhasil dibuat.');
  }catch(err){notify(err.message);}finally{btn.disabled=false;btn.innerHTML='Ambil Nomor Antrian <span>→</span>';}
});
$('printTicket').onclick=()=>window.print();
$('newTicket').onclick=()=>$('ticketResult').classList.add('hidden');

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();adminPin=$('adminPin').value;
  try{await loadQueues();$('adminLogin').classList.add('hidden');$('adminDashboard').classList.remove('hidden');notify('Berhasil masuk dashboard.');}
  catch(err){adminPin='';notify(err.message);}
});
$('logoutBtn').onclick=()=>{adminPin='';$('adminPin').value='';$('adminDashboard').classList.add('hidden');$('adminLogin').classList.remove('hidden');};
$('refreshBtn').onclick=()=>loadQueues().then(()=>notify('Data diperbarui.')).catch(e=>notify(e.message));
$('filterDate').onchange=()=>loadQueues().catch(e=>notify(e.message));

async function loadQueues(){
  const data=await api({action:'list',pin:adminPin,date:$('filterDate').value});
  queueItems=data.items||[];
  $('statTotal').textContent=data.summary.total;$('statWaiting').textContent=data.summary.waiting;
  $('statCalled').textContent=data.summary.called;$('statDone').textContent=data.summary.done;
  $('queueCount').textContent=queueItems.length+' pasien terdaftar';
  renderGrid();
}
function renderGrid(){
  const grid=$('queueGrid');
  if(!queueItems.length){grid.innerHTML='<div class="empty-state">Belum ada antrian pada tanggal ini.<br>Tekan “Tambah Antrian” untuk memasukkan pasien.</div>';return;}
  grid.innerHTML=queueItems.map(item=>{
    const cls=item.status==='Dipanggil'?'called':item.status==='Selesai'?'done':item.status==='Batal'?'cancelled':'';
    const state=item.status==='Dipanggil'?'Dipanggil':item.status==='Selesai'?'Selesai':item.status==='Batal'?'Batal':'Menunggu';
    return `<article class="queue-seat ${cls}">
      <div class="seat-top"><span class="seat-number">${esc(item.number)}</span><span class="seat-state">${state}</span></div>
      <div class="seat-name" title="${esc(item.name)}">${esc(item.name)}</div><div class="seat-phone">${esc(item.age)} tahun · ${esc(item.phone)}</div><div class="seat-phone" title="${esc(item.address)}">${esc(item.address)}</div>
      <div class="seat-actions">
        ${item.status!=='Dipanggil'&&item.status!=='Selesai'&&item.status!=='Batal'?`<button class="mini-btn primary" data-action="call" data-id="${esc(item.id)}">Panggil</button>`:''}
        ${item.status!=='Selesai'&&item.status!=='Batal'?`<button class="mini-btn" data-action="complete" data-id="${esc(item.id)}">Selesai</button>`:''}
        <button class="mini-btn" data-action="edit" data-id="${esc(item.id)}">Edit</button>
        <button class="mini-btn danger" data-action="delete" data-id="${esc(item.id)}">Hapus</button>
      </div></article>`;
  }).join('');
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
$('queueGrid').addEventListener('click',async e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const item=queueItems.find(x=>x.id===b.dataset.id);if(!item)return;
  const action=b.dataset.action;
  if(action==='edit'){openModal(item);return;}
  if(action==='delete'&&!confirm('Hapus antrian '+item.number+' atas nama '+item.name+'?'))return;
  try{
    await api({action,pin:adminPin,id:item.id});await loadQueues();
    notify(action==='delete'?'Antrian dihapus.':action==='call'?'Pasien dipanggil.':'Status antrian diperbarui.');
  }catch(err){notify(err.message);}
});
function openModal(item){
  $('modalTitle').textContent=item?'Edit Antrian':'Tambah Antrian';
  $('editId').value=item?.id||'';$('editName').value=item?.name||'';
  $('editAge').value=item?.age||'';$('editAddress').value=item?.address||'';
  $('editPhone').value=item?.phone||'';$('editNote').value=item?.note||'';
  $('queueModal').classList.remove('hidden');
}
function closeModal(){$('queueModal').classList.add('hidden');}
$('addQueueBtn').onclick=()=>openModal(null);$('closeModal').onclick=closeModal;$('cancelModal').onclick=closeModal;
$('queueForm').onsubmit=async e=>{
  e.preventDefault();
  const id=$('editId').value;
  try{
    if(id) await api({action:'update',pin:adminPin,id,name:$('editName').value.trim(),age:$('editAge').value.trim(),address:$('editAddress').value.trim(),phone:$('editPhone').value.trim(),note:$('editNote').value.trim()});
    else await api({action:'take',name:$('editName').value.trim(),age:$('editAge').value.trim(),address:$('editAddress').value.trim(),phone:$('editPhone').value.trim(),note:$('editNote').value.trim()});
    closeModal();await loadQueues();notify(id?'Data berhasil diedit.':'Antrian berhasil ditambahkan.');
  }catch(err){notify(err.message);}
};
$('resetDayBtn').onclick=async()=>{
  if(!confirm('Yakin menghapus SEMUA antrian pada tanggal '+$('filterDate').value+'? Tindakan ini tidak dapat dibatalkan.'))return;
  try{await api({action:'reset',pin:adminPin,date:$('filterDate').value});await loadQueues();notify('Antrian tanggal ini dikosongkan.');}
  catch(err){notify(err.message);}
};
if('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
