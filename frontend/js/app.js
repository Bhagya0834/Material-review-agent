/* ── App router ─────────────────────────────────────────────────────────── */
const API = '';   // same origin

const PAGES = {
  dashboard:  { title: 'Dashboard',       subtitle: 'Overview of all material reviews' },
  'new-review':{ title: 'New Review',     subtitle: 'Upload a mill certificate for compliance check' },
  history:    { title: 'Review History',  subtitle: 'All past reviews and decisions' },
  specs:      { title: 'Specs Library',   subtitle: 'Manage your organisation specification documents' },
};

const App = {
  current: 'dashboard',

  navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const el = document.getElementById('page-' + page);
    if (el) el.classList.add('active');

    const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (nav) nav.classList.add('active');

    const meta = PAGES[page] || {};
    document.getElementById('topbar-title').textContent    = meta.title    || '';
    document.getElementById('topbar-subtitle').textContent = meta.subtitle || '';

    App.current = page;

    if (page === 'dashboard')   Dashboard.load();
    if (page === 'new-review')  Review.init();
    if (page === 'history')     History.load();
    if (page === 'specs')       Specs.load();
  },

  async get(path) {
    const r = await fetch(API + path);
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
    return r.json();
  },

  async post(path, body) {
    const r = await fetch(API + path, { method: 'POST', body });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
    return r.json();
  },

  async del(path) {
    const r = await fetch(API + path, { method: 'DELETE' });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || r.statusText); }
    return r.json();
  },

  fmtDate(iso) {
    if (!iso) return '—';
    // Treat stored timestamps as UTC (append Z if no timezone info present)
    const utcStr = /[Zz+]/.test(iso) ? iso : iso + 'Z';
    return new Date(utcStr).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) + ' IST';
  },

  statusBadge(status) {
    const map = {
      APPROVED:     '<span class="badge approved">✓ Approved</span>',
      UNDER_REVIEW: '<span class="badge under-review">⚠ Under Review</span>',
      REJECTED:     '<span class="badge rejected">✗ Rejected</span>',
      PROCESSING:   '<span class="badge processing"><span class="spinner" style="width:10px;height:10px;border-width:1.5px;"></span> Processing</span>',
      ERROR:        '<span class="badge error">⚠ Error</span>',
    };
    return map[status] || `<span class="badge">${status}</span>`;
  },

  scoreColor(s) {
    if (s == null) return 'var(--neutral)';
    if (s >= 90) return 'var(--success)';
    if (s >= 70) return 'var(--warn)';
    return 'var(--danger)';
  },

  scoreClass(s) {
    if (s == null) return '';
    if (s >= 90) return 'green';
    if (s >= 70) return 'yellow';
    return 'red';
  },

  paramBadge(status) {
    if (status === 'PASS')      return '<span class="badge pass">PASS</span>';
    if (status === 'FAIL')      return '<span class="badge fail">FAIL</span>';
    if (status === 'NOT_FOUND') return '<span class="badge not-found">NOT FOUND</span>';
    return `<span class="badge">${status}</span>`;
  },

  catPill(cat) {
    const c = (cat||'other').toLowerCase();
    return `<span class="cat-pill cat-${c}">${c}</span>`;
  },
};

// Boot
document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => App.navigate(el.dataset.page));
});

window.addEventListener('DOMContentLoaded', () => App.navigate('dashboard'));
