// ===================== API CONFIG =====================
const API_BASE = 'http://127.0.0.1:8765';
const REFRESH_MS = 60 * 60 * 1000; // 1 jam

// ===================== SHARED STATE =====================
window._modelData = null;

// ===================== LABEL MAPPING =====================
function labelToRiskLevel(label) {
  return { 'Bahaya':'danger', 'Waspada':'warning', 'Siaga':'caution', 'Aman':'safe' }[label] || 'safe';
}

// ===================== SHARED HELPERS =====================
function getRiskBadgeClass(l){ return {danger:'badge-red',warning:'badge-orange',caution:'badge-yellow',safe:'badge-green'}[l]||''; }
function getRiskDotClass(l)  { return {danger:'dot-red',warning:'dot-orange',caution:'dot-yellow',safe:'dot-green'}[l]||''; }
function getRiskTextClass(l) { return {danger:'text-red',warning:'text-orange',caution:'text-yellow',safe:'text-green'}[l]||''; }
function getRiskLabel(l)     { return {danger:'BAHAYA',warning:'WASPADA',caution:'SIAGA',safe:'AMAN'}[l]||'UNKNOWN'; }

// ===================== ICONS =====================
const ICONS = {
  mapPin:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
  clock:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  trendUp:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>`,
  droplets: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 14v-4m0-4h.01"/></svg>`,
  alertTri: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`,
  refresh:  `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>`,
  cpu:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>`,
  bell:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`,
};

// ===================== FETCH FROM SERVER =====================
async function fetchPrediction() {
  try {
    const res = await fetch(`${API_BASE}/api/prediction`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    window._modelData = data;
    return data;
  } catch(e) {
    console.warn('Server tidak terjangkau:', e.message);
    return null;
  }
}

async function forceRefresh() {
  try { await fetch(`${API_BASE}/api/refresh`); } catch(e) {}
}

// ===================== STATUS BANNER =====================
function buildStatusBanner(data) {
  const el = document.getElementById('status-banner');
  if (!el) return;
  if (!data) {
    el.style.display = 'block';
    el.innerHTML = `
      <div class="box-red" style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="#dc2626" stroke-width="2" style="width:1.25rem;height:1.25rem;flex-shrink:0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div style="font-size:0.875rem;color:#7f1d1d;flex:1;">
          <strong>Server tidak terjangkau.</strong> Jalankan dulu:
          <code style="background:#fecaca;padding:0.1rem 0.4rem;border-radius:4px;">python3 server.py</code>
          di folder yang sama dengan file pkl.
        </div>
      </div>`;
    return;
  }
  if (data.status === 'error') {
    el.style.display = 'block';
    el.innerHTML = `
      <div class="box-orange" style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="#ea580c" stroke-width="2" style="width:1.25rem;height:1.25rem;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
        <div style="font-size:0.875rem;color:#7c2d12;flex:1;">Error fetch data: <strong>${data.error}</strong></div>
      </div>`;
    return;
  }
  el.style.display = 'none';
}

// ===================== COUNTDOWN TIMER =====================
function startCountdown(nextUpdateStr) {
  const el = document.getElementById('countdown-timer');
  if (!el || !nextUpdateStr) return;
  clearInterval(window._countdownInterval);
  window._countdownInterval = setInterval(() => {
    const diff = Math.max(0, Math.floor((new Date(nextUpdateStr) - new Date()) / 1000));
    const m = String(Math.floor(diff / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    el.textContent = `Update berikutnya: ${m}:${s}`;
    if (diff === 0) clearInterval(window._countdownInterval);
  }, 1000);
}

// ===================== AUTO REFRESH SCHEDULER =====================
function scheduleAutoRefresh(callback) {
  setTimeout(async () => {
    await forceRefresh();
    await new Promise(r => setTimeout(r, 3000)); // tunggu server proses
    const data = await fetchPrediction();
    callback(data);
    scheduleAutoRefresh(callback); // schedule berikutnya
  }, REFRESH_MS);
}

// ===================== HEADER / FOOTER =====================
function buildLayout(activePage) {
  const nav = [
    { id:'dashboard',     label:'Dashboard',        href:'dashboard.html',     icon:`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>` },
    { id:'notifications', label:'Notifikasi',       href:'notifications.html', icon:ICONS.bell },
    { id:'report',        label:'Laporan Warga',    href:'report.html',        icon:`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/></svg>` },
    { id:'guide',         label:'Panduan Mitigasi', href:'guide.html',         icon:`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>` },
  ];
  const navLinks = nav.map(n => `
    <a href="${n.href}" class="nav-btn${activePage===n.id?' active':''}">
      ${n.icon}<span>${n.label}</span>
    </a>`).join('');

  document.getElementById('app-header').innerHTML = `
    <div class="header-inner">
      <div class="header-top">
        <a href="dashboard.html" class="logo">
          <div class="logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 10c0 0 2-4 5-4s4 4 4 4 2-4 5-4 5 4 5 4M3 18c0 0 2-4 5-4s4 4 4 4 2-4 5-4 5 4 5 4"/>
            </svg>
          </div>
          <div class="logo-text"><h1>FloodWatch</h1><p>Sistem Prediksi Banjir</p></div>
        </a>
        <nav class="nav-desktop">${navLinks}</nav>
        <div class="live-indicator">
          <div class="live-dot"></div>
          <span class="live-label">Live</span>
        </div>
      </div>
      <nav class="nav-mobile">${navLinks}</nav>
    </div>`;

  document.getElementById('app-footer').innerHTML = `
    <div class="footer-inner">
      <p>© 2026 FloodWatch · RF Regressor + RF Classifier · Data: Open-Meteo API · Auto-refresh setiap 1 jam</p>
      <div class="footer-links">
        <span id="countdown-timer" style="font-size:0.75rem;color:var(--muted-foreground);font-variant-numeric:tabular-nums;"></span>
        <a href="#">Tentang</a><a href="#">Kontak</a>
      </div>
    </div>`;
}
