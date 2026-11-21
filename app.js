// Isi dengan URL Web App Google Apps Script setelah deployment.
const API_URL = 'https://script.google.com/macros/s/AKfycbyJ4urcj15Ab3R5LcpVHi6LTHXqO132dAqvLFzIXF4iftp4sVxr83-ct3md_WIRMj-Vdg/exec';
const MAX_DAYS_AHEAD = 60; // samakan dengan CONFIG.MAX_DAYS_AHEAD di Code.gs

let adminPin = '';
let queueItems = [];
let toastTimer;
let busy = false;
let holidays = []; // [{date, note}] tanggal libur yang akan datang
let weeklyHolidays = []; // [{day, note}] libur rutin tiap pekan (0=Minggu..6=Sabtu)
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
function firstOpenDate() {
  for (let i = 0; i <= MAX_DAYS_AHEAD; i++) {
    const d = dateStr(new Date(Date.now() + i * 86400000));
    if (!holidayOf(d)) return d;
  }
  return today();
}
function checkVisitDate() {
  const h = holidayOf($('visitDate').value);
  $('visitDateHint').textContent = h ? 'Libur' + (h.note ? ' — ' + h.note : '') + '. Silakan pilih tanggal lain.' : '';
  $('takeBtn').disabled = !!h;
}
function resetVisitDate() {
  $('visitDate').min = today();
  $('visitDate').max = maxDate();
  $('visitDate').value = firstOpenDate();
  checkVisitDate();
}
const APP_VERSION = '2026.11.21-d';
$('year').textContent = new Date().getFullYear();
$('appVer').textContent = 'v' + APP_VERSION;
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
      reject(new Error('Tidak dapat terhubung ke server. Periksa URL dan deployment Apps Script. [v' + APP_VERSION + ' · …' + API_URL.slice(-12) + ']'));
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
  $('patientHero').classList.add('hidden');
  $('ticketResult').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function hideTicket() {
  currentTicket = null;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  $('ticketResult').classList.add('hidden');
  $('patientHero').classList.remove('hidden');
}
// Bukti terakhir tetap tampil bila halaman dibuka ulang, sampai tanggal kunjungan lewat.
function loadSavedTicket() {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (t && t.number && t.date >= today()) showTicket(t);
    else if (t) localStorage.removeItem(STORE_KEY);
  } catch (e) {}
}

$('visitDate').addEventListener('change', checkVisitDate);

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
    const t = {
      number: data.item.number, name: data.item.name, age: data.item.age, date: data.item.date,
      issued: data.duplicate && data.item.created ? fmtIssued(data.item.created) : new Date().toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (err) {}
    $('takeForm').reset();
    resetVisitDate();
    showTicket(t);
    notify(data.duplicate ? 'Anda sudah terdaftar pada tanggal ini. Berikut nomor Anda.' : 'Pendaftaran berhasil. Simpan bukti Anda.');
  } catch (err) {
    notify(err.message);
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
  const GOLD = '#c8a96a';
  try { await Promise.all([document.fonts.load('800 70px Manrope'), document.fonts.load("700 14px 'DM Sans'")]); } catch (e) {}
  const W = 360, H = 590, S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  ctx.fillStyle = '#f5f8fa'; ctx.fillRect(0, 0, W, H);
  const x = 20, y = 20, w = W - 40, h = H - 40, cx = x + w / 2;

  // bayangan kartu
  ctx.save();
  ctx.shadowColor = 'rgba(16,42,67,.16)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  roundRect(ctx, x, y, w, h, 20); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, x, y, w, h, 20); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);

  // header
  const hg = ctx.createLinearGradient(x, y, x + w, y + 72);
  hg.addColorStop(0, '#0c2034'); hg.addColorStop(1, '#17395c');
  ctx.fillStyle = hg; ctx.fillRect(x, y, w, 72);
  ctx.fillStyle = GOLD; ctx.fillRect(x, y + 72, w, 3);
  ctx.beginPath(); ctx.arc(x + 40, y + 36, 18, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = '#e3cc96'; ctx.textAlign = 'center'; ctx.font = '800 17px ' + H1; ctx.fillText('K', x + 40, y + 42);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
  ctx.font = '800 13px ' + H1; ctx.fillText('KH. KIEMAS', x + 68, y + 33);
  ctx.globalAlpha = .65; ctx.font = '700 8px ' + H2; ctx.fillText('PENGOBATAN ALTERNATIF', x + 68, y + 47); ctx.globalAlpha = 1;
  ctx.font = '700 8.5px ' + H2;
  const bt = 'BUKTI PENDAFTARAN', bw = ctx.measureText(bt).width + 22;
  roundRect(ctx, x + w - 20 - bw, y + 25, bw, 22, 11);
  ctx.strokeStyle = 'rgba(200,169,106,.66)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#ecdcb0'; ctx.textAlign = 'center'; ctx.fillText(bt, x + w - 20 - bw / 2, y + 39);

  // nomor antrian
  ctx.fillStyle = '#2b9a91'; ctx.font = '800 10px ' + H1;
  const et = 'NOMOR ANTRIAN', ew = ctx.measureText(et).width;
  ctx.fillText(et, cx, y + 112);
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx - ew / 2 - 12, y + 108); ctx.lineTo(cx - ew / 2 - 40, y + 108);
  ctx.moveTo(cx + ew / 2 + 12, y + 108); ctx.lineTo(cx + ew / 2 + 40, y + 108); ctx.stroke();
  ctx.fillStyle = '#102a43'; ctx.font = '800 72px ' + H1; ctx.fillText(t.number, cx, y + 186);
  roundRect(ctx, cx - 23, y + 202, 46, 3, 1.5); ctx.fillStyle = GOLD; ctx.fill();

  // garis sobekan
  const cy = y + 236;
  ctx.setLineDash([5, 4]); ctx.strokeStyle = '#dbe3e9'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 18, cy); ctx.lineTo(x + w - 18, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#f5f8fa';
  ctx.beginPath(); ctx.arc(x, cy, 11, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w, cy, 11, 0, Math.PI * 2); ctx.fill();

  // data pasien
  ctx.textAlign = 'left';
  const colW = (w - 48) / 2;
  const field = (label, value, fx, fy, maxW) => {
    ctx.fillStyle = '#8d9ba7'; ctx.font = '700 9px ' + H2; ctx.fillText(label.toUpperCase(), fx, fy);
    ctx.fillStyle = '#102a43'; ctx.font = '700 14.5px ' + H2;
    const lines = wrapLines(ctx, value, maxW).slice(0, 2);
    lines.forEach((ln, i) => ctx.fillText(ln, fx, fy + 20 + i * 18));
    return fy + 20 + lines.length * 18;
  };
  const sep = (sy) => { ctx.strokeStyle = '#eef2f5'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 24, sy); ctx.lineTo(x + w - 24, sy); ctx.stroke(); };
  let yy = cy + 38;
  yy = field('Nama pasien', t.name, x + 24, yy, w - 48) + 12; sep(yy); yy += 22;
  yy = field('Tanggal kunjungan', fmtDate(t.date), x + 24, yy, w - 48) + 12; sep(yy); yy += 22;
  field('Umur', t.age + ' tahun', x + 24, yy, colW);
  field('Didaftarkan', t.issued, x + 24 + colW + 8, yy, colW);

  // catatan & penutup
  const bh = 56, by = y + h - bh - 56;
  roundRect(ctx, x + 24, by, w - 48, bh, 10); ctx.fillStyle = '#f2f8f7'; ctx.fill();
  ctx.strokeStyle = '#dcebe8'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = '#2b6f69'; ctx.font = '500 10.5px ' + H2; ctx.textAlign = 'center';
  const noteLines = wrapLines(ctx, 'Tunjukkan bukti ini kepada petugas untuk menerima kartu antrian fisik dengan nomor yang sama.', w - 76);
  noteLines.forEach((ln, i) => ctx.fillText(ln, cx, by + (bh - noteLines.length * 15) / 2 + 11 + i * 15));
  ctx.fillStyle = '#9c7d3f'; ctx.font = '700 9px ' + H2;
  ctx.fillText('S E M O G A   L E K A S   S E M B U H', cx, y + h - 22);
  ctx.restore();

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
$('printTicket').onclick = () => window.print();
$('newTicket').onclick = () => {
  if (confirm('Pastikan bukti sudah disimpan. Lanjut mendaftarkan pasien baru?')) hideTicket();
};
loadSavedTicket();

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
    const data = await api({ action: 'find', phone: $('lookupPhone').value.trim() });
    lookupItems = (data.items || []).map(i => ({ ...i, number: noOf(i.number) }));
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
  const t = { number: it.number, name: it.name, age: it.age, date: it.date, issued: fmtIssued(it.created) };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(t)); } catch (err) {}
  showTicket(t);
});

/* ---------- Admin: login ---------- */
function logout() {
  adminPin = '';
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
  const active = queueItems.filter(i => i.status !== 'Batal');
  $('statTotal').textContent = queueItems.length;
  $('statPending').textContent = active.filter(i => !i.cardTaken).length;
  $('statTaken').textContent = active.filter(i => i.cardTaken).length;
  $('statCancelled').textContent = queueItems.length - active.length;
  $('queueCount').textContent = queueItems.length + ' pasien terdaftar · ' + (data.summary.cardTaken || 0) + ' kartu sudah diambil';
  renderGrid();
  renderHolidayUI();
}

let searchQuery = '';
const normPhone = (v) => String(v || '').replace(/\D/g, '').replace(/^(62|0)/, '');
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
  if (action === 'delete' && !confirm('Hapus antrian ' + item.number + ' atas nama ' + item.name + '?')) return;
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
  busy = true;
  try {
    await api({ action: 'card', value: '1', pin: adminPin, id: item.id });
    searchQuery = ''; $('queueSearch').value = '';
    await loadQueues();
    notify('Kartu ' + item.number + ' ditandai sudah diambil.');
  } catch (err) {
    handleError(err);
  } finally {
    busy = false;
  }
});

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
  $('editName').focus();
}
function closeModal() { $('queueModal').classList.add('hidden'); setPageLock(false); }
$('deleteQueue').onclick = async () => {
  const item = queueItems.find(x => x.id === $('editId').value);
  if (!item || busy) return;
  if (!confirm('Hapus antrian ' + item.number + ' atas nama ' + item.name + '? Data tidak dapat dikembalikan.')) return;
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

/* ---------- Hari libur ---------- */
const shortDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }); };

function renderHolidayUI() {
  // Halaman pasien
  const list = $('holidayList');
  const parts = [];
  if (weeklyHolidays.length) parts.push('Libur rutin: setiap ' + weeklyHolidays.map(w => DAY_NAMES[w.day]).join(', '));
  if (holidays.length) parts.push('Tanggal libur: ' + holidays.slice(0, 6).map(h => shortDate(h.date) + (h.note ? ' (' + h.note + ')' : '')).join(' · ') + (holidays.length > 6 ? ' …' : ''));
  if (parts.length) {
    list.textContent = parts.join(' | ');
    list.classList.remove('hidden');
  } else list.classList.add('hidden');
  if (holidayOf($('visitDate').value)) $('visitDate').value = firstOpenDate();
  checkVisitDate();
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
  } catch (e) { holidays = []; weeklyHolidays = []; }
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
  if (!confirm('Hapus tanggal libur ' + fmtDate(b.dataset.date) + '?')) return;
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
  if (!confirm('Hapus libur rutin setiap hari ' + DAY_NAMES[b.dataset.day] + '?')) return;
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

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
