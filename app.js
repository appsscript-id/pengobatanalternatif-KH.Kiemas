// Isi dengan URL Web App Google Apps Script setelah deployment.
const API_URL = 'TEMPEL_URL_WEB_APP_APPS_SCRIPT_DI_SINI';
const MAX_DAYS_AHEAD = 60; // samakan dengan CONFIG.MAX_DAYS_AHEAD di Code.gs

let adminPin = '';
let queueItems = [];
let toastTimer;
let busy = false;

const $ = (id) => document.getElementById(id);
const dateStr = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => dateStr(new Date());
const maxDate = () => dateStr(new Date(Date.now() + MAX_DAYS_AHEAD * 86400000));

function resetVisitDate() {
  $('visitDate').min = today();
  $('visitDate').max = maxDate();
  $('visitDate').value = today();
}
$('year').textContent = new Date().getFullYear();
$('filterDate').value = today();
resetVisitDate();

function notify(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function api(params) {
  return new Promise((resolve, reject) => {
    if (!API_URL || API_URL.includes('TEMPEL_URL')) return reject(new Error('URL Web App belum diatur pada app.js.'));
    const callback = 'antrianCallback' + Date.now() + Math.floor(Math.random() * 1000);
    const script = document.createElement('script');
    const query = new URLSearchParams({ ...params, callback });
    let timer;
    function cleanup() {
      delete window[callback];
      script.remove();
      clearTimeout(timer);
    }
    window[callback] = (data) => {
      cleanup();
      data && data.ok ? resolve(data) : reject(new Error((data && data.message) || 'Permintaan gagal.'));
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Tidak dapat terhubung ke server. Periksa URL dan deployment Apps Script.'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Server tidak merespons. Coba lagi.'));
    }, 15000);
    script.src = API_URL + (API_URL.includes('?') ? '&' : '?') + query.toString();
    document.body.appendChild(script);
  });
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Navigasi ---------- */
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x === btn));
  $('patientView').classList.toggle('hidden', btn.dataset.view !== 'patient');
  $('adminView').classList.toggle('hidden', btn.dataset.view !== 'admin');
}));

/* ---------- Pasien ---------- */
$('takeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('takeBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  try {
    const data = await api({
      action: 'take',
      name: $('patientName').value.trim(),
      age: $('patientAge').value.trim(),
      address: $('patientAddress').value.trim(),
      phone: $('patientPhone').value.trim(),
      visitDate: $('visitDate').value,
      note: $('patientNote').value.trim()
    });
    $('ticketNumber').textContent = data.item.number;
    $('ticketName').textContent = data.item.name + ' · ' + data.item.age + ' tahun · ' + data.item.phone + ' · Kunjungan ' + data.item.date;
    $('ticketResult').classList.remove('hidden');
    $('ticketResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('takeForm').reset();
    resetVisitDate();
    notify('Nomor antrian berhasil dibuat.');
  } catch (err) {
    notify(err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Ambil Nomor Antrian <span>→</span>';
  }
});
$('printTicket').onclick = () => window.print();
$('newTicket').onclick = () => $('ticketResult').classList.add('hidden');

/* ---------- Admin: login ---------- */
function logout() {
  adminPin = '';
  $('adminPin').value = '';
  $('adminDashboard').classList.add('hidden');
  $('adminLogin').classList.remove('hidden');
}
// Bila PIN ditolak server (misalnya PIN diganti), kembali ke halaman login.
function handleError(err) {
  notify(err.message);
  if (err.message === 'PIN admin salah.') logout();
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('loginForm').querySelector('button');
  btn.disabled = true;
  adminPin = $('adminPin').value;
  try {
    await loadQueues();
    $('adminLogin').classList.add('hidden');
    $('adminDashboard').classList.remove('hidden');
    notify('Berhasil masuk dashboard.');
  } catch (err) {
    adminPin = '';
    notify(err.message);
  } finally {
    btn.disabled = false;
  }
});
$('logoutBtn').onclick = logout;
$('refreshBtn').onclick = () => loadQueues().then(() => notify('Data diperbarui.')).catch(handleError);
$('filterDate').onchange = () => loadQueues().catch(handleError);

/* ---------- Admin: daftar antrian ---------- */
async function loadQueues() {
  const data = await api({ action: 'list', pin: adminPin, date: $('filterDate').value });
  queueItems = data.items || [];
  $('statTotal').textContent = data.summary.total;
  $('statWaiting').textContent = data.summary.waiting;
  $('statCalled').textContent = data.summary.called;
  $('statDone').textContent = data.summary.done;
  $('queueCount').textContent = queueItems.length + ' pasien terdaftar';
  renderGrid();
}

function renderGrid() {
  const grid = $('queueGrid');
  if (!queueItems.length) {
    grid.innerHTML = '<div class="empty-state">Belum ada antrian pada tanggal ini.<br>Tekan “Tambah Antrian” untuk memasukkan pasien.</div>';
    return;
  }
  const classes = { Dipanggil: 'called', Selesai: 'done', Batal: 'cancelled' };
  grid.innerHTML = queueItems.map(item => {
    const state = classes[item.status] ? item.status : 'Menunggu';
    const cls = classes[state] || '';
    const open = state === 'Menunggu' || state === 'Dipanggil';
    const btn = (act, label, extra = '') => `<button class="mini-btn ${extra}" data-action="${act}" data-id="${esc(item.id)}">${label}</button>`;
    return `<article class="queue-seat ${cls}">
      <div class="seat-top"><span class="seat-number">${esc(item.number)}</span><span class="seat-state">${state}</span></div>
      <div class="seat-name" title="${esc(item.name)}">${esc(item.name)}</div>
      <div class="seat-phone">${esc(item.age)} tahun · ${esc(item.phone)}</div>
      <div class="seat-phone seat-addr" title="${esc(item.address)}">${esc(item.address)}</div>
      <div class="seat-actions">
        ${state === 'Menunggu' ? btn('call', 'Panggil', 'primary') : ''}
        ${open ? btn('complete', 'Selesai') : ''}
        ${open ? btn('cancel', 'Batal') : btn('reopen', 'Buka lagi')}
        ${btn('edit', 'Edit')}
        ${btn('delete', 'Hapus', 'danger')}
      </div></article>`;
  }).join('');
}

const ACTION_MESSAGES = {
  call: 'Pasien dipanggil.',
  complete: 'Antrian ditandai selesai.',
  cancel: 'Antrian dibatalkan.',
  reopen: 'Antrian dibuka kembali.',
  delete: 'Antrian dihapus.'
};

$('queueGrid').addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b || busy) return;
  const item = queueItems.find(x => x.id === b.dataset.id);
  if (!item) return;
  const action = b.dataset.action;
  if (action === 'edit') { openModal(item); return; }
  if (action === 'delete' && !confirm('Hapus antrian ' + item.number + ' atas nama ' + item.name + '?')) return;
  busy = true;
  b.disabled = true;
  try {
    await api({ action, pin: adminPin, id: item.id });
    await loadQueues();
    notify(ACTION_MESSAGES[action] || 'Status antrian diperbarui.');
  } catch (err) {
    handleError(err);
    b.disabled = false;
  } finally {
    busy = false;
  }
});

/* ---------- Admin: modal tambah/edit ---------- */
function openModal(item) {
  $('modalTitle').textContent = item ? 'Edit Antrian' : 'Tambah Antrian';
  $('editId').value = item?.id || '';
  $('editName').value = item?.name || '';
  $('editAge').value = item?.age || '';
  $('editAddress').value = item?.address || '';
  $('editPhone').value = item?.phone || '';
  $('editVisitDate').value = item?.date || $('filterDate').value;
  $('editNote').value = item?.note || '';
  $('queueModal').classList.remove('hidden');
  $('editName').focus();
}
function closeModal() { $('queueModal').classList.add('hidden'); }
$('addQueueBtn').onclick = () => openModal(null);
$('closeModal').onclick = closeModal;
$('cancelModal').onclick = closeModal;
$('queueModal').addEventListener('click', e => { if (e.target === $('queueModal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('queueModal').classList.contains('hidden')) closeModal(); });

$('queueForm').onsubmit = async e => {
  e.preventDefault();
  const id = $('editId').value;
  const btn = $('saveQueue');
  btn.disabled = true;
  const fields = {
    name: $('editName').value.trim(),
    age: $('editAge').value.trim(),
    address: $('editAddress').value.trim(),
    phone: $('editPhone').value.trim(),
    visitDate: $('editVisitDate').value,
    note: $('editNote').value.trim()
  };
  try {
    await api(id
      ? { action: 'update', pin: adminPin, id, ...fields }
      : { action: 'take', pin: adminPin, ...fields });
    closeModal();
    await loadQueues();
    notify(id ? 'Data berhasil diedit.' : 'Antrian berhasil ditambahkan.');
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
};

$('resetDayBtn').onclick = async () => {
  if (busy) return;
  if (!confirm('Yakin menghapus SEMUA antrian pada tanggal ' + $('filterDate').value + '? Tindakan ini tidak dapat dibatalkan.')) return;
  busy = true;
  try {
    await api({ action: 'reset', pin: adminPin, date: $('filterDate').value });
    await loadQueues();
    notify('Antrian tanggal ini dikosongkan.');
  } catch (err) {
    handleError(err);
  } finally {
    busy = false;
  }
};

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
