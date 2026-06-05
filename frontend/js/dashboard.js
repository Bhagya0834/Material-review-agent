/* ── Dashboard ──────────────────────────────────────────────────────────── */
const Dashboard = (() => {
  let monthlyChart  = null;
  let donutChart    = null;
  let vendorChart   = null;
  let materialChart = null;
  let specChart     = null;
  let reviewerChart = null;

  const COLORS     = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed'];
  const TREND_KEYS = ['vendor', 'material', 'spec', 'reviewer'];

  let _rawData   = null;
  let _selMonths = {};   // { vendor: Set<string>, ... }

  // ── Load ────────────────────────────────────────────────────────────────
  async function load() {
    try {
      const d = await App.get('/api/dashboard/stats');
      _rawData = d;
      _renderStats(d);
      _renderMonthly(d.monthly || {});
      _renderDonut(d.approved || 0, d.under_review || 0, d.rejected || 0);
      _initTrends(d);
      _renderRecent(d.recent_reviews || []);
    } catch (e) {
      console.error('Dashboard load error', e);
    }
  }

  // ── Stats cards ──────────────────────────────────────────────────────────
  function _renderStats(d) {
    document.getElementById('stat-total').textContent    = d.total_reviews ?? 0;
    document.getElementById('stat-approved').textContent = d.approved      ?? 0;
    document.getElementById('stat-under').textContent    = d.under_review  ?? 0;
    document.getElementById('stat-rejected').textContent = d.rejected      ?? 0;
    document.getElementById('stat-pass-rate').textContent =
      d.pass_rate != null ? `${d.pass_rate}% approval rate` : 'No data yet';
  }

  // ── Monthly bar chart ────────────────────────────────────────────────────
  function _renderMonthly(monthly) {
    const labels      = Object.keys(monthly).slice(-6);
    const approved    = labels.map(l => monthly[l]?.APPROVED     || 0);
    const underReview = labels.map(l => monthly[l]?.UNDER_REVIEW || 0);
    const rejected    = labels.map(l => monthly[l]?.REJECTED     || 0);
    if (monthlyChart) monthlyChart.destroy();
    const ctx = document.getElementById('chart-monthly').getContext('2d');
    monthlyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Approved',     data: approved,    backgroundColor: '#16a34a', borderRadius: 4 },
          { label: 'Under Review', data: underReview, backgroundColor: '#d97706', borderRadius: 4 },
          { label: 'Rejected',     data: rejected,    backgroundColor: '#dc2626', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } },
        },
      },
    });
  }

  // ── Donut chart ──────────────────────────────────────────────────────────
  function _renderDonut(approved, under, rejected) {
    if (donutChart) donutChart.destroy();
    const ctx   = document.getElementById('chart-donut').getContext('2d');
    const total = approved + under + rejected;
    if (total === 0) {
      ctx.canvas.parentElement.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-2);font-size:13px;">No review data yet</p>';
      return;
    }
    donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Approved', 'Under Review', 'Rejected'],
        datasets: [{ data: [approved, under, rejected], backgroundColor: ['#16a34a', '#d97706', '#dc2626'], borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${Math.round(ctx.parsed/total*100)}%)` } },
        },
      },
    });
  }

  // ── Trend line charts with month filters ─────────────────────────────────
  function _initTrends(d) {
    const months = d.trend_months || [];
    TREND_KEYS.forEach(key => {
      _selMonths[key] = new Set(months);
      _buildFilterPanel(key, months);
      _updateFilterBtn(key);
      _refreshChart(key);
    });
  }

  function _buildFilterPanel(key, months) {
    const panel = document.getElementById(`filter-panel-${key}`);
    if (!panel) return;
    if (!months.length) {
      panel.innerHTML = '<span style="font-size:11px;color:var(--text-2);padding:4px 6px;display:block;">No data yet</span>';
      return;
    }
    panel.innerHTML =
      months.map(m => `
        <label style="display:flex;align-items:center;gap:8px;padding:5px 8px;cursor:pointer;font-size:12px;border-radius:5px;white-space:nowrap;"
               onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=''">
          <input type="checkbox" ${_selMonths[key] && _selMonths[key].has(m) ? 'checked' : ''}
                 onchange="Dashboard.toggleMonth('${key}','${m}')"
                 style="cursor:pointer;width:14px;height:14px;accent-color:var(--primary);">
          ${m}
        </label>`).join('') +
      `<div style="border-top:1px solid var(--border);margin:6px 4px 2px;padding-top:6px;display:flex;gap:4px;">
         <button class="btn btn-secondary btn-sm" style="flex:1;font-size:11px;padding:3px 6px;"
                 onclick="Dashboard.selectAllMonths('${key}')">All</button>
         <button class="btn btn-secondary btn-sm" style="flex:1;font-size:11px;padding:3px 6px;"
                 onclick="Dashboard.clearMonths('${key}')">None</button>
       </div>`;
  }

  function toggleFilter(key) {
    // Close all other panels first
    TREND_KEYS.forEach(k => {
      if (k !== key) {
        const p = document.getElementById(`filter-panel-${k}`);
        if (p) p.style.display = 'none';
      }
    });
    const panel = document.getElementById(`filter-panel-${key}`);
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  }

  function toggleMonth(key, month) {
    if (_selMonths[key].has(month)) _selMonths[key].delete(month);
    else _selMonths[key].add(month);
    _updateFilterBtn(key);
    _refreshChart(key);
  }

  function selectAllMonths(key) {
    const months = _rawData?.trend_months || [];
    _selMonths[key] = new Set(months);
    _buildFilterPanel(key, months);
    _updateFilterBtn(key);
    _refreshChart(key);
  }

  function clearMonths(key) {
    _selMonths[key] = new Set();
    const months = _rawData?.trend_months || [];
    _buildFilterPanel(key, months);
    _updateFilterBtn(key);
    _refreshChart(key);
  }

  function _updateFilterBtn(key) {
    const btn   = document.getElementById(`filter-btn-${key}`);
    if (!btn) return;
    const total = (_rawData?.trend_months || []).length;
    const sel   = _selMonths[key]?.size ?? 0;
    if (total === 0)        btn.textContent = 'No data ▾';
    else if (sel === total) btn.textContent = 'All Months ▾';
    else if (sel === 0)     btn.textContent = 'No months ▾';
    else                    btn.textContent = `${sel} / ${total} months ▾`;
  }

  function _getFilteredData(key) {
    const allMonths = _rawData?.trend_months || [];
    const selected  = _selMonths[key] || new Set(allMonths);
    const indices   = allMonths.reduce((acc, m, i) => { if (selected.has(m)) acc.push(i); return acc; }, []);
    const filteredMonths = indices.map(i => allMonths[i]);
    const trends = (_rawData?.[`${key}_trends`] || []).map(t => ({
      label: t.label,
      data:  indices.map(i => t.data[i]),
    }));
    return { filteredMonths, trends };
  }

  function _refreshChart(key) {
    const { filteredMonths, trends } = _getFilteredData(key);
    const store = { vendor: vendorChart, material: materialChart, spec: specChart, reviewer: reviewerChart };
    const result = _renderTrendLine(`chart-${key}`, store[key], filteredMonths, trends);
    if      (key === 'vendor')   vendorChart   = result;
    else if (key === 'material') materialChart = result;
    else if (key === 'spec')     specChart     = result;
    else if (key === 'reviewer') reviewerChart = result;
  }

  function _renderTrendLine(canvasId, existingChart, months, trends) {
    if (existingChart) existingChart.destroy();
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    if (!trends.length || !months.length) {
      canvas.style.display = 'none';
      if (!canvas.parentElement.querySelector('.no-data-msg')) {
        const msg = document.createElement('p');
        msg.className = 'no-data-msg';
        msg.style.cssText = 'text-align:center;padding:20px;color:var(--text-2);font-size:12px;';
        msg.textContent = trends.length ? 'No months selected' : 'No data yet';
        canvas.parentElement.appendChild(msg);
      }
      return null;
    }
    canvas.style.display = '';
    canvas.parentElement.querySelectorAll('.no-data-msg').forEach(el => el.remove());
    return new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: months,
        datasets: trends.map((t, i) => ({
          label: t.label.length > 24 ? t.label.slice(0, 24) + '…' : t.label,
          data:  t.data,
          borderColor:     COLORS[i % COLORS.length],
          backgroundColor: COLORS[i % COLORS.length] + '18',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: false,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 }, padding: 8 } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#f1f5f9' } },
        },
      },
    });
  }

  // ── Recent reviews table ─────────────────────────────────────────────────
  function _renderRecent(reviews) {
    const tbody = document.getElementById('dash-recent-body');
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center;padding:24px;">No reviews yet. <a style="color:var(--primary);cursor:pointer;" onclick="App.navigate(\'new-review\')">Start your first review →</a></td></tr>';
      return;
    }
    tbody.innerHTML = reviews.map(r => `
      <tr>
        <td>${r.vendor || '—'}</td>
        <td>${r.material || '—'}</td>
        <td class="truncate" style="max-width:160px;">${r.spec_name || '—'}</td>
        <td>${r.score != null ? `<span style="font-weight:700;color:${App.scoreColor(r.score)};">${r.score.toFixed(1)}%</span>` : '—'}</td>
        <td>${App.statusBadge(r.status)}</td>
        <td class="text-muted text-sm">${App.fmtDate(r.created_at)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="History.openDetail(${r.id})">View</button></td>
      </tr>`).join('');
  }

  // Close filter panels when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('[id^="filter-panel-"]') && !e.target.closest('[id^="filter-btn-"]')) {
      TREND_KEYS.forEach(key => {
        const p = document.getElementById(`filter-panel-${key}`);
        if (p) p.style.display = 'none';
      });
    }
  });

  return { load, toggleFilter, toggleMonth, selectAllMonths, clearMonths };
})();
