/* ── Dashboard ──────────────────────────────────────────────────────────── */
const Dashboard = (() => {
  let monthlyChart = null;
  let donutChart   = null;

  async function load() {
    try {
      const d = await App.get('/api/dashboard/stats');
      _renderStats(d);
      _renderMonthly(d.monthly || {});
      _renderDonut(d.approved || 0, d.under_review || 0, d.rejected || 0);
      _renderRecent(d.recent_reviews || []);
    } catch (e) {
      console.error('Dashboard load error', e);
    }
  }

  function _renderStats(d) {
    document.getElementById('stat-total').textContent    = d.total_reviews ?? 0;
    document.getElementById('stat-approved').textContent = d.approved      ?? 0;
    document.getElementById('stat-under').textContent    = d.under_review  ?? 0;
    document.getElementById('stat-rejected').textContent = d.rejected      ?? 0;

    const rate = d.pass_rate != null ? `${d.pass_rate}% approval rate` : 'No data yet';
    document.getElementById('stat-pass-rate').textContent = rate;
  }

  function _renderMonthly(monthly) {
    const labels = Object.keys(monthly).slice(-6);
    const approved   = labels.map(l => monthly[l]?.APPROVED     || 0);
    const underReview= labels.map(l => monthly[l]?.UNDER_REVIEW || 0);
    const rejected   = labels.map(l => monthly[l]?.REJECTED     || 0);

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

  function _renderDonut(approved, under, rejected) {
    if (donutChart) donutChart.destroy();
    const ctx = document.getElementById('chart-donut').getContext('2d');
    const total = approved + under + rejected;
    if (total === 0) {
      ctx.canvas.parentElement.innerHTML = '<p style="text-align:center;padding:40px;color:var(--text-2);font-size:13px;">No review data yet</p>';
      return;
    }
    donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Approved', 'Under Review', 'Rejected'],
        datasets: [{
          data: [approved, under, rejected],
          backgroundColor: ['#16a34a', '#d97706', '#dc2626'],
          borderWidth: 0,
          hoverOffset: 6,
        }],
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
        <td>
          ${r.score != null ? `<span style="font-weight:700;color:${App.scoreColor(r.score)};">${r.score.toFixed(1)}%</span>` : '—'}
        </td>
        <td>${App.statusBadge(r.status)}</td>
        <td class="text-muted text-sm">${App.fmtDate(r.created_at)}</td>
        <td><button class="btn btn-secondary btn-sm" onclick="History.openDetail(${r.id})">View</button></td>
      </tr>
    `).join('');
  }

  return { load };
})();
