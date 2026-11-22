// Isi dengan URL Web App Google Apps Script setelah deployment.
const API_URL = 'https://script.google.com/macros/s/AKfycbzDO9jJq4ceUOXDPOCpUhksc56Ue0LvBoDJPeVhcFLaMyXnAzlNRh3XE1g6LcHtBoY4UQ/exec';
const MAX_DAYS_AHEAD = 60; // samakan dengan CONFIG.MAX_DAYS_AHEAD di Code.gs

let adminPin = '';
let queueItems = [];
let toastTimer;
let busy = false;
let holidays = []; // [{date, note}] tanggal libur yang akan datang
let weeklyHolidays = []; // [{day, note}] libur rutin tiap pekan (0=Minggu..6=Sabtu)
let quota = 0; // kuota pendaftaran online per hari (0 = tanpa batas)
let counts = {}; // {tanggal: jumlah antrian aktif}
const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

const $ = (id) => document.getElementById(id);
const dateStr = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => dateStr(new Date());
const maxDate = () => dateStr(new Date(Date.now() + MAX_DAYS_AHEAD * 86400000));

const weekdayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
function holidayOf(date) {
  if (!date) return null;
  const h = holidays.find(x => x.date === date);
  if (h) return h;
  const w = weeklyHolidays.find(x => x.day === weekdayOf(date));
  return w ? { date, note: w.note || ('Libur setiap hari ' + DAY_NAMES[w.day]), weekly: true } : null;
}
function isFull(date) {
  return !!date && quota > 0 && (counts[date] || 0) >= quota;
}
function firstOpenDate() {
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = dateStr(new Date(Date.now() + i * 86400000));
    if (!holidayOf(d) && !isFull(d)) return d;
  }
  return today();
}
function checkVisitDate() {
  const d = $('visitDate').value, h = holidayOf(d), full = isFull(d), hint = $('visitDateHint');
  let msg = '';
  if (h) msg = 'Libur' + (h.note ? ' — ' + h.note : '') + '. Silakan pilih tanggal lain.';
  else if (full) msg = 'Kuota tanggal ini sudah penuh. Silakan pilih tanggal lain.';
  hint.textContent = msg;
  $('takeBtn').disabled = !!h || full;
}
function resetVisitDate() {
  $('visitDate').min = today();
  $('visitDate').max = maxDate();
  $('visitDate').value = firstOpenDate();
  checkVisitDate();
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

/* Dialog konfirmasi sendiri, pengganti dialog bawaan browser yang menampilkan nama situs */
function askConfirm(message, okLabel = 'Ya, lanjutkan', title = 'Konfirmasi') {
  return new Promise(resolve => {
    const m = $('confirmModal'), yes = $('confirmYes'), no = $('confirmNo');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = message;
    yes.textContent = okLabel;
    m.classList.remove('hidden');
    const done = v => {
      m.classList.add('hidden');
      yes.onclick = no.onclick = m.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    m.onclick = e => { if (e.target === m) done(false); };
    document.addEventListener('keydown', onKey, true);
  });
}

function api(params) {
  if (!API_URL || API_URL.includes('TEMPEL_URL')) {
    return Promise.reject(new Error('URL Web App belum diatur pada app.js.'));
  }
  const query = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  return fetch(API_URL + (API_URL.includes('?') ? '&' : '?') + query, {
    method: 'GET',
    credentials: 'omit', // jangan kirim cookie akun Google
    redirect: 'follow',
    signal: ctrl.signal
  })
    .then(r => r.json())
    .then(data => {
      if (data && data.ok) return data;
      throw new Error((data && data.message) || 'Permintaan gagal.');
    })
    .catch(err => {
      if (err.name === 'AbortError') throw new Error('Server tidak merespons. Coba lagi.');
      if (err instanceof TypeError || err instanceof SyntaxError) {
        throw new Error('Tidak dapat terhubung ke server. Periksa URL dan deployment Apps Script.');
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- Navigasi ---------- */
const PIN_KEY = 'antrianKiemasPin', VIEW_KEY = 'antrianKiemasView';
function showView(name) {
  document.querySelectorAll('[data-view]').forEach(x => x.classList.toggle('active', x.dataset.view === name));
  $('patientView').classList.toggle('hidden', name !== 'patient');
  $('adminView').classList.toggle('hidden', name !== 'admin');
  try { sessionStorage.setItem(VIEW_KEY, name); } catch (e) {}
}
document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));

/* ---------- Pasien ---------- */
const STORE_KEY = 'antrianKiemasBukti';
let currentTicket = null;

function fmtIssued(d) {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
const noOf = (n) => String(n ?? '').replace(/^\D+/, '');
function showTicket(t) {
  t = { ...t, number: noOf(t.number) };
  currentTicket = t;
  $('ticketNumber').textContent = t.number;
  $('ticketName').textContent = t.name;
  $('ticketAge').textContent = t.age + ' tahun';
  $('ticketDate').textContent = fmtDate(t.date);
  $('ticketIssued').textContent = t.issued;
  // Tombol ubah/batal hanya muncul bila nomor telepon pendaftar diketahui
  $('proofManage').classList.toggle('hidden', !t.phone);
  $('movePanel').classList.add('hidden');
  $('patientHero').classList.add('hidden');
  $('ticketResult').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hideTicket() {
  currentTicket = null;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  $('ticketResult').classList.add('hidden');
  $('movePanel').classList.add('hidden');
  $('patientHero').classList.remove('hidden');
  // Kembalikan bagian "cari bukti" ke keadaan awal
  $('lookupForm').reset();
  $('lookupForm').classList.add('hidden');
  $('lookupResult').innerHTML = '';
  lookupItems = [];
}
// Bukti terakhir tetap tampil bila halaman dibuka ulang, sampai tanggal kunjungan lewat.
function loadSavedTicket() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (t && t.number && t.date >= today()) showTicket(t);
    else if (t) localStorage.removeItem(STORE_KEY);
  } catch (e) {}
}
function storeTicket(t) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (err) {}
}

$('visitDate').addEventListener('change', checkVisitDate);

$('takeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('takeBtn');
  btn.disabled = true;
  btn.textContent = 'Memproses...';
  const phone = $('patientPhone').value.trim();
  try {
    const data = await api({
      action: 'take',
      name: $('patientName').value.trim(),
      age: $('patientAge').value.trim(),
      address: $('patientAddress').value.trim(),
      phone,
      visitDate: $('visitDate').value,
      note: $('patientNote').value.trim()
    });
    const t = {
      number: data.item.number, name: data.item.name, age: data.item.age, date: data.item.date, phone: data.item.phone || phone,
      issued: data.duplicate && data.item.created ? fmtIssued(data.item.created) : new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
    storeTicket(t);
    $('takeForm').reset();
    resetVisitDate();
    showTicket(t);
    notify(data.duplicate ? 'Anda sudah terdaftar pada tanggal ini. Berikut nomor Anda.' : 'Pendaftaran berhasil. Simpan bukti Anda.');
    loadHolidays(); // perbarui sisa kuota
  } catch (err) {
    notify(err.message);
    loadHolidays(); // kuota mungkin baru saja penuh
  } finally {
    btn.innerHTML = 'Ambil Nomor Antrian <span>→</span>';
    btn.disabled = false;
    checkVisitDate();
  }
});

/* Gambar bukti (PNG) untuk disimpan di galeri / dibagikan */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapLines(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
async function drawTicketImage(t) {
  const H1 = "Manrope, 'DM Sans', Arial, sans-serif", H2 = "'DM Sans', Arial, sans-serif";
  try { await Promise.all([document.fonts.load('800 64px Manrope'), document.fonts.load("700 14px 'DM Sans'")]); } catch (e) {}
  const W = 360, H = 520, S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = '#f5f8fa'; ctx.fillRect(0, 0, W, H);
  const x = 20, y = 20, w = W - 40, h = H - 40, cx = x + w / 2;

  ctx.save();
  roundRect(ctx, x, y, w, h, 18); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
  ctx.fillStyle = '#102a43'; ctx.fillRect(x, y, w, 64);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.font = '800 13px ' + H1; ctx.fillText('KH. KIEMAS', x + 20, y + 30);
  ctx.globalAlpha = .65; ctx.font = '700 8px ' + H2; ctx.fillText('PENGOBATAN ALTERNATIF', x + 20, y + 44); ctx.globalAlpha = 1;
  ctx.textAlign = 'right'; ctx.font = '700 10px ' + H2; ctx.fillText('BUKTI PENDAFTARAN', x + w - 20, y + 37);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#2b9a91'; ctx.font = '800 10px ' + H1; ctx.fillText('NOMOR ANTRIAN', cx, y + 102);
  ctx.fillStyle = '#102a43'; ctx.font = '800 66px ' + H1; ctx.fillText(t.number, cx, y + 172);

  const cy = y + 204;
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#dbe3e9'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 18, cy); ctx.lineTo(x + w - 18, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f5f8fa';
  ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w, cy, 11, 0, Math.PI * 2); ctx.fill();

  ctx.textAlign = 'left';
  const colW = (w - 48) / 2;
  const field = (label, value, fx, fy, maxW) => {
    ctx.fillStyle = '#91a0ab'; ctx.font = '700 9px ' + H2; ctx.fillText(label.toUpperCase(), fx, fy);
    ctx.fillStyle = '#102a43'; ctx.font = '700 14px ' + H2;
    const lines = wrapLines(ctx, value, maxW).slice(0, 2);
    lines.forEach((ln, i) => ctx.fillText(ln, fx, fy + 20 + i * 18));
    return fy + 20 + lines.length * 18;
  };
  let yy = cy + 38;
  yy = field('Nama pasien', t.name, x + 24, yy, w - 48) + 18;
  yy = field('Tanggal kunjungan', fmtDate(t.date), x + 24, yy, w - 48) + 18;
  field('Umur', t.age + ' tahun', x + 24, yy, colW);
  field('Didaftarkan', t.issued, x + 24 + colW + 8, yy, colW);

  const bh = 58, by = y + h - bh - 20;
  roundRect(ctx, x + 24, by, w - 48, bh, 10); ctx.fillStyle = '#f1f8f7'; ctx.fill();
  ctx.fillStyle = '#2b6f69'; ctx.font = '500 10.5px ' + H2; ctx.textAlign = 'center';
  const noteLines = wrapLines(ctx, 'Tunjukkan bukti ini kepada petugas untuk menerima kartu antrian fisik dengan nomor yang sama.', w - 76);
  noteLines.forEach((ln, i) => ctx.fillText(ln, cx, by + (bh - noteLines.length * 15) / 2 + 11 + i * 15));
  ctx.restore();

  roundRect(ctx, x, y, w, h, 18); ctx.strokeStyle = '#e5ebf0'; ctx.lineWidth = 1; ctx.stroke();
  return canvas;
}
async function saveTicketImage() {
  if (!currentTicket) return;
  const btn = $('saveTicket');
  btn.disabled = true;
  try {
    const canvas = await drawTicketImage(currentTicket);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Gagal membuat gambar.');
    const file = new File([blob], 'antrian-' + currentTicket.number + '-' + currentTicket.date + '.png', { type: 'image/png' });
    // Di HP, lembar bagikan menyediakan pilihan "Simpan gambar"; di komputer langsung diunduh.
    if (window.matchMedia('(pointer:coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Bukti pendaftaran antrian ' + currentTicket.number });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    notify('Bukti disimpan sebagai gambar.');
  } catch (err) {
    notify(err.message || 'Gagal menyimpan gambar.');
  } finally {
    btn.disabled = false;
  }
}
$('saveTicket').onclick = saveTicketImage;
$('printTicket').onclick = () => { clearPrint(); window.print(); };
$('newTicket').onclick = hideTicket;
loadSavedTicket();

/* Pasien mengubah tanggal / membatalkan antriannya sendiri */
function checkMoveDate() {
  const d = $('moveDate').value, h = holidayOf(d);
  let msg = '';
  if (d && currentTicket && d === currentTicket.date) msg = 'Itu tanggal kunjungan Anda saat ini. Pilih tanggal lain.';
  else if (h) msg = 'Libur' + (h.note ? ' — ' + h.note : '') + '. Silakan pilih tanggal lain.';
  else if (isFull(d)) msg = 'Kuota tanggal ini sudah penuh. Silakan pilih tanggal lain.';
  $('moveHint').textContent = msg;
  $('moveSave').disabled = !d || !!msg;
}
$('moveTicketBtn').onclick = async () => {
  if (!currentTicket) return;
  const panel = $('movePanel');
  panel.classList.toggle('hidden');
  if (panel.classList.contains('hidden')) return;
  await loadHolidays(); // ambil data libur & kuota terbaru
  $('moveDate').min = today();
  $('moveDate').max = maxDate();
  $('moveDate').value = '';
  checkMoveDate();
  panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
};
$('moveCancel').onclick = () => $('movePanel').classList.add('hidden');
$('moveDate').addEventListener('change', checkMoveDate);
$('movePanel').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentTicket || !currentTicket.phone) return;
  const btn = $('moveSave');
  btn.disabled = true;
  try {
    const r = await api({ action: 'moveMine', phone: currentTicket.phone, date: currentTicket.date, number: currentTicket.number, newDate: $('moveDate').value });
    const t = { number: r.item.number, name: r.item.name, age: r.item.age, date: r.item.date, phone: currentTicket.phone, issued: fmtIssued(r.item.created) };
    storeTicket(t);
    showTicket(t);
    notify(r.message);
    loadHolidays();
  } catch (err) {
    notify(err.message);
    loadHolidays();
  } finally {
    btn.disabled = false;
    checkMoveDate();
  }
});
$('cancelTicketBtn').onclick = async () => {
  if (!currentTicket || !currentTicket.phone || busy) return;
  if (!(await askConfirm('Batalkan antrian nomor ' + currentTicket.number + ' tanggal ' + fmtDate(currentTicket.date) + '?', 'Ya, batalkan', 'Batalkan antrian'))) return;
  busy = true;
  try {
    const r = await api({ action: 'cancelMine', phone: currentTicket.phone, date: currentTicket.date, number: currentTicket.number });
    hideTicket();
    notify(r.message);
    loadHolidays();
  } catch (err) {
    notify(err.message);
  } finally {
    busy = false;
  }
};

/* Pasien lupa menyimpan bukti: cari kembali memakai nomor telepon */
let lookupItems = [];
$('lookupToggle').onclick = () => {
  $('lookupForm').classList.toggle('hidden');
  if (!$('lookupForm').classList.contains('hidden')) $('lookupPhone').focus();
};
$('lookupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('lookupBtn'), box = $('lookupResult');
  btn.disabled = true;
  box.innerHTML = '';
  try {
    const phone = $('lookupPhone').value.trim();
    const data = await api({ action: 'find', phone });
    lookupItems = (data.items || [])
      .map(i => ({ ...i, number: noOf(i.number), phone }))
      .filter(i => i.date >= today())                   // tanggal lewat tidak ditampilkan
      .sort((a, b) => a.date.localeCompare(b.date));    // urut dari tanggal terdekat
    box.innerHTML = lookupItems.length
      ? lookupItems.map((it, i) => `<button type="button" class="lookup-item" data-i="${i}"><b>${esc(it.number)}</b><span>${esc(it.name)}<small>${esc(fmtDate(it.date))}</small></span><em>Lihat bukti</em></button>`).join('')
      : '<p class="lookup-empty">Tidak ada pendaftaran aktif dengan nomor tersebut. Pastikan nomornya sama dengan saat mendaftar.</p>';
  } catch (err) {
    notify(err.message);
  } finally {
    btn.disabled = false;
  }
});
$('lookupResult').addEventListener('click', e => {
  const b = e.target.closest('[data-i]');
  const it = b && lookupItems[b.dataset.i];
  if (!it) return;
  const t = { number: it.number, name: it.name, age: it.age, date: it.date, phone: it.phone, issued: fmtIssued(it.created) };
  storeTicket(t);
  showTicket(t);
});

/* ---------- Admin: login ---------- */
function logout() {
  adminPin = '';
  try { sessionStorage.removeItem(PIN_KEY); } catch (e) {}
  $('adminPin').value = '';
  searchQuery = ''; $('queueSearch').value = '';
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
    try { sessionStorage.setItem(PIN_KEY, adminPin); } catch (err) {}
    $('holidayFrom').min = today();
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
$('filterDate').onchange = () => { searchQuery = ''; $('queueSearch').value = ''; loadQueues().catch(handleError); };

/* ---------- Admin: daftar antrian ---------- */
async function loadQueues() {
  const data = await api({ action: 'list', pin: adminPin, date: $('filterDate').value });
  queueItems = (data.items || []).map(i => ({ ...i, number: noOf(i.number) }));
  adminQuota = data.quota || 0;
  if (document.activeElement !== $('quotaInput')) $('quotaInput').value = adminQuota;
  renderStats();
  renderGrid();
  renderHolidayUI();
}

let adminQuota = 0;
function renderStats() {
  const active = queueItems.filter(i => i.status !== 'Batal');
  const taken = active.filter(i => i.cardTaken).length;
  $('statTotal').textContent = queueItems.length;
  $('statPending').textContent = active.length - taken;
  $('statTaken').textContent = taken;
  $('statCancelled').textContent = queueItems.length - active.length;
  $('queueCount').textContent = queueItems.length + ' pasien terdaftar · ' + queueItems.filter(i => i.cardTaken).length + ' kartu sudah diambil' + (adminQuota ? ' · kuota ' + active.length + '/' + adminQuota : '');
}

/* Tandai kartu secara optimistis: tampilan langsung berubah, server menyusul di latar belakang.
   Bila server gagal, tampilan dikembalikan seperti semula. */
function setCardOptimistic(item, taken) {
  const prev = { cardTaken: item.cardTaken, cardAt: item.cardAt };
  item.cardTaken = taken;
  item.cardAt = taken ? new Date().toISOString() : '';
  renderStats();
  renderGrid();
  notify(taken ? 'Kartu ' + item.number + ' ditandai sudah diambil.' : 'Tanda kartu ' + item.number + ' dibatalkan.');
  return api({ action: 'card', value: taken ? '1' : '0', pin: adminPin, id: item.id }).catch(err => {
    item.cardTaken = prev.cardTaken;
    item.cardAt = prev.cardAt;
    renderStats();
    renderGrid();
    handleError(err);
  });
}

/* Ubah status (Batal / Buka lagi) secara optimistis, sama seperti penandaan kartu. */
function setStatusOptimistic(item, action) {
  const status = action === 'cancel' ? 'Batal' : 'Menunggu';
  const prev = item.status;
  item.status = status;
  renderStats();
  renderGrid();
  notify(ACTION_MESSAGES[action]);
  return api({ action, pin: adminPin, id: item.id }).catch(err => {
    item.status = prev;
    renderStats();
    renderGrid();
    handleError(err);
  });
}

let searchQuery = '';
const normPhone =(v) => String(v || '').replace(/\D/g, '').replace(/^(62|0)/, '');
const numOf = (n) => Number(String(n).replace(/^\D+/, '')) || 0;

function filteredItems() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return queueItems;
  if (/^\d+$/.test(q)) {
    // 6 digit ke atas dianggap nomor telepon; selebihnya nomor antrian ("10" atau "010" -> A010)
    if (q.length >= 6) return queueItems.filter(i => normPhone(i.phone).includes(normPhone(q)));
    return queueItems.filter(i => numOf(i.number) === Number(q));
  }
  return queueItems.filter(i => i.number.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
}

function renderGrid() {
  const grid = $('queueGrid');
  if (!queueItems.length) {
    grid.innerHTML = '<div class="empty-state">Belum ada antrian pada tanggal ini.<br>Tekan “Tambah Antrian” untuk memasukkan pasien.</div>';
    return;
  }
  const items = filteredItems();
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state">Tidak ditemukan: “' + esc(searchQuery) + '”.</div>';
    return;
  }
  const classes = { Dipanggil: 'called', Selesai: 'done', Batal: 'cancelled' };
  grid.innerHTML = items.map(item => {
    const state = classes[item.status] ? item.status : 'Menunggu';
    const open = state === 'Menunggu' || state === 'Dipanggil';
    const cls = [classes[state] || '', item.cardTaken ? 'has-card' : ''].join(' ').trim();
    const btn = (act, label, extra = '') => `<button class="mini-btn ${extra}" data-action="${act}" data-id="${esc(item.id)}">${label}</button>`;
    const time = item.cardAt ? new Date(item.cardAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    const badge = state === 'Batal' ? '<span class="seat-state">Batal</span>'
      : item.cardTaken ? `<span class="seat-state st-taken">✓ Diambil${time ? ' · ' + time : ''}</span>`
      : state === 'Menunggu' ? '<span class="seat-state st-wait">Belum diambil</span>'
      : `<span class="seat-state">${state}</span>`;
    return `<article class="queue-seat ${cls}" data-id="${esc(item.id)}" tabindex="0" title="Klik untuk melihat data pasien">
      <div class="seat-top"><span class="seat-number">${esc(item.number)}</span>${badge}</div>
      <div class="seat-name" title="${esc(item.name)}">${esc(item.name)}</div>
      <div class="seat-phone">${esc(item.age)} tahun · ${esc(item.phone)}</div>
      <div class="seat-phone seat-addr" title="${esc(item.address)}">${esc(item.address)}</div>
      <div class="seat-actions">
        ${open && !item.cardTaken ? btn('card', 'Kartu diambil', 'card span2') : ''}
        ${open && item.cardTaken ? btn('uncard', 'Batalkan kartu', 'span2') : ''}
        ${open ? btn('cancel', 'Batal') : btn('reopen', 'Buka lagi', 'span2')}
        ${btn('edit', 'Edit', open ? '' : 'span2')}
      </div></article>`;
  }).join('');
}

const ACTION_MESSAGES = {
  call: 'Pasien dipanggil.',
  complete: 'Antrian ditandai selesai.',
  cancel: 'Antrian dibatalkan.',
  reopen: 'Antrian dibuka kembali.',
  delete: 'Antrian dihapus.',
  card: 'Kartu ditandai sudah diambil.',
  uncard: 'Tanda kartu dibatalkan.'
};

$('queueGrid').addEventListener('click', async e => {
  const b = e.target.closest('[data-action]');
  if (!b) {
    const seat = e.target.closest('.queue-seat');
    const it = seat && queueItems.find(x => x.id === seat.dataset.id);
    if (it) openView(it);
    return;
  }
  if (busy) return;
  const item = queueItems.find(x => x.id === b.dataset.id);
  if (!item) return;
  const action = b.dataset.action;
  if (action === 'edit') { openModal(item); return; }
  if (action === 'card' || action === 'uncard') { setCardOptimistic(item, action === 'card'); return; }
  if (action === 'cancel' || action === 'reopen') { setStatusOptimistic(item, action); return; }
  if (action === 'delete' && !(await askConfirm('Hapus antrian ' + item.number + ' atas nama ' + item.name + '?', 'Ya, hapus', 'Hapus antrian'))) return;
  const request = action === 'card' ? { action: 'card', value: '1' }
    : action === 'uncard' ? { action: 'card', value: '0' }
    : { action };
  busy = true;
  b.disabled = true;
  try {
    await api({ ...request, pin: adminPin, id: item.id });
    await loadQueues();
    notify(ACTION_MESSAGES[action] || 'Status antrian diperbarui.');
  } catch (err) {
    handleError(err);
    b.disabled = false;
  } finally {
    busy = false;
  }
});

$('queueGrid').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.classList.contains('queue-seat')) return;
  const it = queueItems.find(x => x.id === e.target.dataset.id);
  if (it) openView(it);
});

/* Pencarian cepat: ketik nomor kartu lalu Enter untuk menandai kartu sudah diambil */
$('queueSearch').addEventListener('input', e => { searchQuery = e.target.value; renderGrid(); });
$('queueSearch').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const list = filteredItems();
  if (!searchQuery.trim() || busy) return;
  if (list.length !== 1) { notify(list.length ? 'Ada lebih dari satu hasil. Ketik nomor lengkap.' : 'Nomor tidak ditemukan.'); return; }
  const item = list[0];
  if (item.cardTaken) { notify('Kartu ' + item.number + ' sudah ditandai diambil.'); return; }
  searchQuery = ''; $('queueSearch').value = '';
  setCardOptimistic(item, true);
});

/* ---------- Admin: cetak daftar harian & kartu antrian ---------- */
function clearPrint() {
  document.body.classList.remove('print-list', 'print-cards');
  $('printArea').innerHTML = '';
}
function startPrint(html, mode) {
  clearPrint();
  $('printArea').innerHTML = html;
  document.body.classList.add(mode);
  setTimeout(() => window.print(), 80);
}
window.addEventListener('afterprint', clearPrint);

$('printListBtn').onclick = () => {
  if (!queueItems.length) { notify('Belum ada antrian pada tanggal ini.'); return; }
  const date = $('filterDate').value;
  const active = queueItems.filter(i => i.status !== 'Batal');
  const rows = queueItems.map(i => {
    const cancelled = i.status === 'Batal';
    return `<tr class="${cancelled ? 'cx' : ''}"><td class="c">${esc(i.number)}</td><td>${esc(i.name)}${cancelled ? ' <em>(Batal)</em>' : ''}</td><td class="c">${esc(i.age)}</td><td>${esc(i.address)}</td><td>${esc(i.phone)}</td><td class="c">${i.cardTaken ? '&#10003;' : '&#9744;'}</td><td>${esc(i.note)}</td></tr>`;
  }).join('');
  const html = `<div class="pl-head"><h1>Daftar Antrian Pasien</h1><p>Pengobatan Alternatif KH. Kiemas &middot; ${esc(fmtDate(date))}</p></div>
    <table class="pl-table"><thead><tr><th>No</th><th>Nama</th><th>Umur</th><th>Alamat</th><th>Telepon</th><th>Kartu</th><th>Catatan</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="pl-foot">Total ${active.length} pasien aktif (${queueItems.length - active.length} batal) &middot; Dicetak ${esc(fmtIssued(new Date()))}</p>`;
  startPrint(html, 'print-list');
};

$('printCardsBtn').onclick = () => {
  const date = $('filterDate').value;
  const list = queueItems.filter(i => i.status !== 'Batal');
  if (!list.length) { notify('Belum ada antrian aktif untuk dicetak.'); return; }
  const cards = list.map(i => `<div class="pcard"><div class="pc-head"><b>KH. KIEMAS</b><small>PENGOBATAN ALTERNATIF</small></div><div class="pc-label">NOMOR ANTRIAN</div><div class="pc-num">${esc(i.number)}</div><div class="pc-name">${esc(i.name)}</div><div class="pc-date">${esc(fmtDate(date))}</div></div>`).join('');
  startPrint(`<div class="pcards">${cards}</div>`, 'print-cards');
};

/* ---------- Admin: modal tambah/edit ---------- */
function setPageLock(on) {
  ['main', '.topbar', 'footer'].forEach(sel => { const el = document.querySelector(sel); if (el) el.inert = on; });
  document.body.style.overflow = on ? 'hidden' : '';
}

/* ---------- Admin: preview data pasien ---------- */
function openView(item) {
  const phoneDigits = String(item.phone || '').replace(/[^\d+]/g, '');
  const wa = phoneDigits.replace(/^\+/, '').replace(/^0/, '62');
  const time = item.cardAt ? new Date(item.cardAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
  const status = item.status === 'Batal' ? 'Dibatalkan' : (item.cardTaken ? 'Kartu sudah diambil' + (time ? ' · ' + time : '') : 'Kartu belum diambil');
  const tone = item.status === 'Batal' ? 'bad' : (item.cardTaken ? 'ok' : 'wait');
  const row = (k, v, wide) => `<div class="${wide ? 'wide' : ''}"><dt>${k}</dt><dd>${v}</dd></div>`;
  $('viewNumber').textContent = item.number;
  $('viewStatus').className = 'view-status ' + tone;
  $('viewStatus').textContent = status;
  $('viewBody').innerHTML =
    row('Nama pasien', esc(item.name), true) +
    row('Umur', esc(item.age) + ' tahun') +
    row('Tanggal kunjungan', esc(item.date ? fmtDate(item.date) : '-')) +
    row('Telepon / WhatsApp', esc(item.phone) + (phoneDigits ? ` <a class="view-link" href="tel:${esc(phoneDigits)}">Telepon</a> <a class="view-link" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''), true) +
    row('Alamat', esc(item.address || '-'), true) +
    row('Catatan', item.note ? esc(item.note) : '<span class="muted">Tidak ada catatan</span>', true) +
    row('Didaftarkan', esc(fmtIssued(item.created)), true);
  $('viewEdit').dataset.id = item.id;
  $('viewModal').classList.remove('hidden');
  setPageLock(true);
}
function closeView() { $('viewModal').classList.add('hidden'); setPageLock(false); }
$('closeView').onclick = closeView;
$('viewClose').onclick = closeView;
$('viewModal').addEventListener('click', e => { if (e.target === $('viewModal')) closeView(); });
$('viewEdit').onclick = () => {
  const it = queueItems.find(x => x.id === $('viewEdit').dataset.id);
  closeView();
  if (it) openModal(it);
};

function openModal(item) {
  $('modalTitle').textContent = item ? 'Edit Antrian' : 'Tambah Antrian';
  $('editId').value = item?.id || '';
  $('editName').value = item?.name || '';
  $('editAge').value = item?.age || '';
  $('editAddress').value = item?.address || '';
  $('editPhone').value = item?.phone || '';
  $('editVisitDate').value = item?.date || $('filterDate').value;
  $('editNote').value = item?.note || '';
  $('deleteQueue').classList.toggle('hidden', !item);
  $('queueModal').classList.remove('hidden');
  setPageLock(true);
  // Tidak fokus otomatis, supaya keyboard HP tidak langsung terbuka saat menekan Edit.
  $('queueModal').querySelector('.modal-card').scrollTop = 0;
}
function closeModal() { $('queueModal').classList.add('hidden'); setPageLock(false); }
// Saat kolom diketuk dan keyboard muncul, geser layar agar kolom tetap terlihat.
$('queueForm').addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches('input,textarea')) return;
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {} }, 300);
});
$('deleteQueue').onclick = async () => {
  const item = queueItems.find(x => x.id === $('editId').value);
  if (!item || busy) return;
  if (!(await askConfirm('Hapus antrian ' + item.number + ' atas nama ' + item.name + '? Data tidak dapat dikembalikan.', 'Ya, hapus', 'Hapus antrian'))) return;
  busy = true;
  try {
    await api({ action: 'delete', pin: adminPin, id: item.id });
    closeModal();
    await loadQueues();
    notify('Antrian dihapus.');
  } catch (err) {
    handleError(err);
  } finally {
    busy = false;
  }
};
$('addQueueBtn').onclick = () => openModal(null);
$('closeModal').onclick = closeModal;
$('cancelModal').onclick = closeModal;
// Dialog edit bersifat modal: klik di luar kotak tidak menutupnya (hanya memberi isyarat), harus lewat Batal / ×.
$('queueModal').addEventListener('click', e => {
  if (e.target !== $('queueModal')) return;
  const card = $('queueModal').querySelector('.modal-card');
  card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('queueModal').classList.contains('hidden')) closeModal();
  else if (!$('viewModal').classList.contains('hidden')) closeView();
});

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
  if (!(await askConfirm('Yakin menghapus SEMUA antrian pada tanggal ' + $('filterDate').value + '? Tindakan ini tidak dapat dibatalkan.', 'Ya, kosongkan', 'Kosongkan antrian'))) return;
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

/* ---------- Admin: kuota harian ---------- */
$('quotaForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('quotaBtn');
  btn.disabled = true;
  try {
    const r = await api({ action: 'setQuota', pin: adminPin, value: $('quotaInput').value.trim() });
    await loadQueues();
    await loadHolidays();
    notify(r.message);
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Hari libur ---------- */
function renderHolidayUI() {
  // Halaman pasien
  if (holidayOf($('visitDate').value) || isFull($('visitDate').value)) $('visitDate').value = firstOpenDate();
  checkVisitDate();
  if (!$('movePanel').classList.contains('hidden')) checkMoveDate();
  // Dashboard admin
  $('holidayItems').innerHTML = holidays.length
    ? holidays.map(h => `<div class="holiday-item"><div><b>${esc(fmtDate(h.date))}</b><small>${esc(h.note || 'Libur')}</small></div><button class="mini-btn danger" data-date="${esc(h.date)}">Hapus</button></div>`).join('')
    : '<p class="lookup-empty">Belum ada tanggal libur.</p>';
  $('weeklyItems').innerHTML = weeklyHolidays.length
    ? weeklyHolidays.map(w => `<div class="holiday-item"><div><b>Setiap hari ${esc(DAY_NAMES[w.day])}</b><small>${esc(w.note || 'Libur rutin')}</small></div><button class="mini-btn danger" data-day="${w.day}">Hapus</button></div>`).join('')
    : '<p class="lookup-empty">Belum ada libur rutin mingguan.</p>';
  const banner = $('holidayBanner'), h = holidayOf($('filterDate').value);
  banner.textContent = h ? 'Tanggal ini libur' + (h.note ? ' — ' + h.note : '') + '. Pasien tidak dapat mendaftar pada tanggal ini.' : '';
  banner.classList.toggle('hidden', !h);
}

async function loadHolidays() {
  try {
    const r = await api({ action: 'holidays' });
    holidays = r.items || [];
    weeklyHolidays = r.weekly || [];
    quota = r.quota || 0;
    counts = r.counts || {};
  } catch (e) { holidays = []; weeklyHolidays = []; quota = 0; counts = {}; }
  renderHolidayUI();
}

$('holidayForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('holidayBtn');
  btn.disabled = true;
  try {
    const r = await api({ action: 'addHoliday', pin: adminPin, date: $('holidayFrom').value, endDate: $('holidayTo').value, note: $('holidayNote').value.trim() });
    $('holidayForm').reset();
    await loadHolidays();
    notify(r.message);
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
});
$('holidayItems').addEventListener('click', async e => {
  const b = e.target.closest('[data-date]');
  if (!b || busy) return;
  if (!(await askConfirm('Hapus tanggal libur ' + fmtDate(b.dataset.date) + '?', 'Ya, hapus', 'Hapus tanggal libur'))) return;
  busy = true;
  try {
    await api({ action: 'removeHoliday', pin: adminPin, date: b.dataset.date });
    await loadHolidays();
    notify('Tanggal libur dihapus.');
  } catch (err) {
    handleError(err);
  } finally {
    busy = false;
  }
});
$('weeklyForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('weeklyBtn');
  btn.disabled = true;
  try {
    const r = await api({ action: 'addWeekly', pin: adminPin, day: $('weeklyDay').value, note: $('weeklyNote').value.trim() });
    $('weeklyForm').reset();
    await loadHolidays();
    notify(r.message);
  } catch (err) {
    handleError(err);
  } finally {
    btn.disabled = false;
  }
});
$('weeklyItems').addEventListener('click', async e => {
  const b = e.target.closest('[data-day]');
  if (!b || busy) return;
  if (!(await askConfirm('Hapus libur rutin setiap hari ' + DAY_NAMES[b.dataset.day] + '?', 'Ya, hapus', 'Hapus libur rutin'))) return;
  busy = true;
  try {
    await api({ action: 'removeWeekly', pin: adminPin, day: b.dataset.day });
    await loadHolidays();
    notify('Libur rutin dihapus.');
  } catch (err) {
    handleError(err);
  } finally {
    busy = false;
  }
});
loadHolidays();

/* Tetap masuk setelah halaman di-refresh */
(async function restoreAdmin() {
  let pin = '', view = '';
  try { pin = sessionStorage.getItem(PIN_KEY) || ''; view = sessionStorage.getItem(VIEW_KEY) || ''; } catch (e) {}
  if (view === 'admin') showView('admin');
  if (!pin) return;

  // Langsung tampilkan dashboard tanpa menunggu server, supaya tidak berkedip
  adminPin = pin;
  $('adminLogin').classList.add('hidden');
  $('adminDashboard').classList.remove('hidden');

  try {
    await loadQueues();
    $('holidayFrom').min = today();
  } catch (err) {
    // Gagal: kembali ke layar login
    adminPin = '';
    $('adminDashboard').classList.add('hidden');
    $('adminLogin').classList.remove('hidden');
    if (err.message === 'PIN admin salah.') { try { sessionStorage.removeItem(PIN_KEY); } catch (e) {} }
    else notify(err.message);
  }
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
