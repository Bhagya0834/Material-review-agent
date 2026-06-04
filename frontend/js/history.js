/* ── Review History ─────────────────────────────────────────────────────── */
const History = (() => {
  let allReviews = [];

  async function load() {
    try {
      allReviews = await App.get('/api/reviews/');
      _render(allReviews);
    } catch (e) {
      document.getElementById('history-body').innerHTML =
        `<tr><td colspan="9"><div class="alert alert-error">${e.message}</div></td></tr>`;
    }
  }

  function filter() {
    const q      = (document.getElementById('history-search')?.value || '').toLowerCase();
    const status = document.getElementById('history-status-filter')?.value || '';
    const filtered = allReviews.filter(r => {
      const matchQ = !q ||
        (r.vendor      || '').toLowerCase().includes(q) ||
        (r.material    || '').toLowerCase().includes(q) ||
        (r.spec_name   || '').toLowerCase().includes(q) ||
        (r.heat_number || '').toLowerCase().includes(q) ||
        (r.po_number   || '').toLowerCase().includes(q);
      const matchS = !status || r.status === status;
      return matchQ && matchS;
    });
    _render(filtered);
  }

  function _render(reviews) {
    const tbody = document.getElementById('history-body');
    if (!reviews.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="text-muted" style="text-align:center;padding:32px;">No reviews found.</td></tr>';
      return;
    }
    tbody.innerHTML = reviews.map((r, idx) => {
      const displayStatus = r.reviewer_decision || r.status;
      const opts = ['APPROVED','UNDER_REVIEW','REJECTED'].map(v =>
        `<option value="${v}" ${displayStatus===v?'selected':''}>${v==='UNDER_REVIEW'?'Under Review':v==='APPROVED'?'Approved':'Rejected'}</option>`
      ).join('');
      return `
      <tr>
        <td class="text-muted text-sm" style="font-weight:600;">${idx + 1}</td>
        <td>${r.vendor || '—'}</td>
        <td>${r.material || '—'}</td>
        <td class="text-sm">${r.heat_number || '—'}</td>
        <td class="truncate" style="max-width:140px;">${r.spec_name || '—'}</td>
        <td>
          ${r.score != null
            ? `<span style="font-weight:700;color:${App.scoreColor(r.score)};">${r.score.toFixed(1)}%</span>`
            : '<span class="text-muted">—</span>'
          }
        </td>
        <td>
          ${App.statusBadge(displayStatus)}
          ${r.reviewer_decision ? '<span class="text-xs text-muted" style="display:block;margin-top:2px;">Overridden</span>' : ''}
        </td>
        <td class="text-sm text-muted">${App.fmtDate(r.created_at)}</td>
        <td style="min-width:170px;">
          ${r.status !== 'PROCESSING' ? `
            <div style="display:flex;gap:5px;align-items:center;">
              <select id="ov-dec-${r.id}" style="padding:4px 6px;font-size:11px;border:1.5px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);cursor:pointer;">
                ${opts}
              </select>
              <button class="btn btn-primary btn-sm" style="padding:4px 9px;font-size:11px;" onclick="History.quickOverride(${r.id})">Save</button>
            </div>
            <div id="ov-msg-${r.id}" style="font-size:10px;margin-top:3px;"></div>
          ` : '<span class="spinner" style="width:12px;height:12px;border-width:2px;"></span>'}
        </td>
        <td style="min-width:160px;">
          ${r.status !== 'PROCESSING' ? `
            <div style="display:flex;gap:5px;align-items:center;">
              <input id="ov-rem-${r.id}" type="text" value="${(r.reviewer_comment||'').replace(/"/g,'&quot;')}"
                placeholder="Add remark…"
                style="padding:4px 7px;font-size:11px;border:1.5px solid var(--border);border-radius:6px;width:130px;background:var(--card);color:var(--text);"
                onkeydown="if(event.key==='Enter') History.quickOverride(${r.id})" />
            </div>
          ` : ''}
        </td>
        <td>
          ${r.status !== 'PROCESSING'
            ? `<button class="btn btn-secondary btn-sm" onclick="History.openDetail(${r.id})">Detail</button>`
            : ''}
        </td>
      </tr>
    `}).join('');
  }

  async function openDetail(reviewId) {
    try {
      const r  = await App.get(`/api/reviews/${reviewId}`);
      const cr = r.comparison_result || {};
      const params = cr.parameters || [];

      // Sort: FAIL / NOT_COMPLIANT first, then NOT_FOUND, then PASS
      const sorted = [...params].sort((a, b) => {
        const order = { 'FAIL': 0, 'NOT_COMPLIANT': 0, 'NOT_FOUND': 1, 'NOT_STATED': 2, 'PASS': 3, 'CONFIRMED': 3 };
        return (order[a.status] ?? 2) - (order[b.status] ?? 2);
      });

      const displayStatus = r.reviewer_decision || r.status;
      const statusLower   = displayStatus.toLowerCase().replace('_', '-');
      const scClass       = App.scoreClass(r.score);

      const failedParams  = params.filter(p => ['FAIL','NOT_COMPLIANT'].includes(p.status));
      const chemical      = sorted.filter(p => (p.category||'').toLowerCase() === 'chemical');
      const mech          = sorted.filter(p => (p.category||'').toLowerCase() === 'mechanical');
      const others        = sorted.filter(p => !['chemical','mechanical'].includes((p.category||'').toLowerCase()));

      document.getElementById('detail-title').textContent = `Review #${r.id} — ${r.vendor || 'Unknown vendor'}`;

      document.getElementById('detail-body').innerHTML = `
        <!-- System decision banner -->
        <div class="result-header ${statusLower}" style="margin-bottom:16px;">
          <div>
            <div class="result-status-label result-${statusLower}">
              ${displayStatus==='APPROVED'?'✓':displayStatus==='REJECTED'?'✗':'⚠'}
              ${r.reviewer_decision ? 'Reviewer Decision' : 'System Decision'}
            </div>
            <div class="result-status-text result-${statusLower}">
              ${displayStatus==='APPROVED'?'APPROVED':displayStatus==='UNDER_REVIEW'?'UNDER REVIEW':'REJECTED'}
            </div>
            ${r.reviewer_decision ? `<div class="text-sm mt-2" style="color:var(--text-2);">System: ${App.statusBadge(r.status)}</div>` : ''}
            <div class="text-sm mt-2 text-muted">${cr.decision_reason || ''}</div>
          </div>
          <div style="text-align:center;padding:0 20px;border-left:1px solid rgba(0,0,0,.1);border-right:1px solid rgba(0,0,0,.1);">
            <div class="big-score ${scClass}">${r.score != null ? r.score.toFixed(1) : '—'}%</div>
            <div class="text-sm text-muted mt-2">Compliance Score</div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
            <div><div style="font-size:20px;font-weight:800;color:var(--success);">${r.passed??0}</div><div class="text-xs text-muted">PASS</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--danger);">${r.failed??0}</div><div class="text-xs text-muted">FAIL</div></div>
            <div><div style="font-size:20px;font-weight:800;color:var(--neutral);">${r.not_found??0}</div><div class="text-xs text-muted">NOT FOUND</div></div>
          </div>
        </div>

        <!-- Failed parameters alert — shown only when failures exist -->
        ${failedParams.length ? `
          <div class="alert alert-error mb-3" style="flex-direction:column;align-items:flex-start;">
            <strong style="margin-bottom:6px;">Failed Parameters (${failedParams.length}):</strong>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              ${failedParams.map(p => `
                <span style="background:#fca5a5;color:#7f1d1d;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">
                  ${p.name}${p.symbol ? ` (${p.symbol})` : ''} — Actual: ${p.actual_value ?? '—'} | Spec: ${p.spec_min ?? '—'} to ${p.spec_max ?? '—'} ${p.spec_unit || ''}
                </span>`).join('')}
            </div>
          </div>` : ''}

        <!-- Reviewer comment (if any) -->
        ${r.reviewer_comment ? `
          <div class="alert alert-warn mb-3">
            <strong>Reviewer note:</strong> ${r.reviewer_comment}
          </div>` : ''}

        ${cr.summary ? `<div class="alert alert-info mb-3">${cr.summary}</div>` : ''}

        <!-- Info grid -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;background:var(--neutral-lt);border-radius:8px;padding:16px;margin-bottom:16px;">
          ${_cell('Vendor',    cr.vendor || r.vendor || '—')}
          ${_cell('Heat No.',  cr.heat_number || r.heat_number || '—')}
          ${_cell('Material',  cr.material || r.material || '—')}
          ${_cell('Spec',      r.spec_name || '—')}
          ${_cell('PO No.',    r.po_number || '—')}
          ${_cell('Cert File', r.cert_filename || '—')}
          ${_cell('Reviewed',  App.fmtDate(r.reviewed_at))}
          ${_cell('Submitted', App.fmtDate(r.created_at))}
        </div>

        <!-- Tabs -->
        <div class="tabs">
          <button class="tab-btn active" onclick="History._tab(this,'tab-all')">All Parameters</button>
          <button class="tab-btn" onclick="History._tab(this,'tab-fail')" style="${failedParams.length?'color:var(--danger);font-weight:700;':''}">
            Failures ${failedParams.length ? `<span style="background:var(--danger);color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-left:4px;">${failedParams.length}</span>` : 'Only'}
          </button>
          <button class="tab-btn" onclick="History._tab(this,'tab-chem')">Chemical</button>
          <button class="tab-btn" onclick="History._tab(this,'tab-mech')">Mechanical</button>
        </div>

        <div id="tab-all">${_paramTable(sorted)}</div>
        <div id="tab-fail" class="hidden">${_paramTable(failedParams.length ? failedParams : params.filter(p=>!['PASS','CONFIRMED'].includes(p.status)))}</div>
        <div id="tab-chem" class="hidden">${_paramTable(chemical)}</div>
        <div id="tab-mech" class="hidden">${_paramTable(mech)}</div>

        <!-- Reviewer Override Section -->
        <div style="margin-top:24px;border-top:1px solid var(--border);padding-top:20px;">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:12px;">Reviewer Override</div>
          ${r.reviewer_decision ? `
            <div class="alert alert-warn mb-3" style="font-size:13px;">
              Last override: <strong>${r.reviewer_decision}</strong>
              ${r.reviewer_at ? ` on ${App.fmtDate(r.reviewer_at)}` : ''}
              ${r.reviewer_comment ? ` — "${r.reviewer_comment}"` : ''}
            </div>` : ''}
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
            <div style="flex:0 0 180px;">
              <label class="form-label">Decision</label>
              <select class="form-select" id="override-decision">
                <option value="">— Select —</option>
                <option value="APPROVED" ${r.reviewer_decision==='APPROVED'?'selected':''}>Approved</option>
                <option value="UNDER_REVIEW" ${r.reviewer_decision==='UNDER_REVIEW'?'selected':''}>Under Review</option>
                <option value="REJECTED" ${r.reviewer_decision==='REJECTED'?'selected':''}>Rejected</option>
              </select>
            </div>
            <div style="flex:1;min-width:200px;">
              <label class="form-label">Comment / Reason</label>
              <input class="form-input" id="override-comment" type="text" placeholder="e.g. Deviation accepted per engineering approval" value="${r.reviewer_comment || ''}" />
            </div>
            <button class="btn btn-primary" onclick="History._submitOverride(${r.id})">Save Override</button>
          </div>
          <div id="override-msg" style="margin-top:8px;font-size:13px;"></div>
        </div>
      `;

      document.getElementById('review-detail-modal').classList.add('open');
    } catch (e) {
      alert('Error loading review: ' + e.message);
    }
  }

  async function _submitOverride(reviewId) {
    const decision = document.getElementById('override-decision').value;
    const comment  = document.getElementById('override-comment').value.trim();
    const msgEl    = document.getElementById('override-msg');

    if (!decision) { msgEl.innerHTML = '<span style="color:var(--danger);">Please select a decision.</span>'; return; }

    try {
      msgEl.innerHTML = '<span style="color:var(--text-2);">Saving…</span>';
      await fetch(`/api/reviews/${reviewId}/override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      }).then(async r => {
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || r.statusText); }
        return r.json();
      });
      msgEl.innerHTML = '<span style="color:var(--success);font-weight:600;">Override saved successfully.</span>';
      await History.load();   // refresh history table in background
    } catch (e) {
      msgEl.innerHTML = `<span style="color:var(--danger);">Error: ${e.message}</span>`;
    }
  }

  function _tab(btn, tabId) {
    document.querySelectorAll('#detail-body .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#detail-body [id^="tab-"]').forEach(t => t.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(tabId)?.classList.remove('hidden');
  }

  function _cell(label, val) {
    return `<div><div class="text-xs text-muted font-semibold" style="text-transform:uppercase;letter-spacing:.06em;">${label}</div><div style="font-size:13px;font-weight:600;margin-top:3px;">${val}</div></div>`;
  }

  function _paramTable(params) {
    if (!params.length) return '<p class="text-muted text-sm" style="padding:16px;">No parameters in this category.</p>';
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Parameter</th><th>Category</th><th>Spec Min</th><th>Spec Max</th><th>Actual</th><th>Unit</th><th>Critical</th><th>Result</th><th>Notes</th></tr></thead>
          <tbody>
            ${params.map(p => `
              <tr class="${['FAIL','NOT_COMPLIANT'].includes(p.status)?'row-fail':p.status==='PASS'||p.status==='CONFIRMED'?'row-pass':'row-nf'}">
                <td><strong>${p.name}</strong>${p.symbol?` <small class="text-muted">(${p.symbol})</small>`:''}</td>
                <td>${App.catPill(p.category)}</td>
                <td>${p.spec_min??'—'}</td>
                <td>${p.spec_max??'—'}</td>
                <td style="font-weight:600;${['FAIL','NOT_COMPLIANT'].includes(p.status)?'color:var(--danger);':''}">${p.actual_value??'—'}</td>
                <td>${p.spec_unit||p.actual_unit||'—'}</td>
                <td>${p.is_critical?'<span class="badge rejected" style="font-size:10px;">Critical</span>':''}</td>
                <td>${App.paramBadge(p.status)}</td>
                <td class="text-sm text-muted">${p.notes||''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function quickOverride(reviewId) {
    const decEl = document.getElementById(`ov-dec-${reviewId}`);
    const remEl = document.getElementById(`ov-rem-${reviewId}`);
    const msgEl = document.getElementById(`ov-msg-${reviewId}`);
    if (!decEl) return;
    const decision = decEl.value;
    const comment  = remEl ? remEl.value.trim() : '';
    if (!decision) return;
    try {
      msgEl.innerHTML = '<span style="color:var(--text-2);">Saving…</span>';
      await fetch(`/api/reviews/${reviewId}/override`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comment }),
      }).then(async res => {
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail || res.statusText); }
        return res.json();
      });
      msgEl.innerHTML = '<span style="color:var(--success);font-weight:600;">Saved</span>';
      setTimeout(() => { msgEl.innerHTML = ''; }, 2500);
      await History.load();
    } catch (e) {
      msgEl.innerHTML = `<span style="color:var(--danger);">${e.message}</span>`;
    }
  }

  function closeDetail() {
    document.getElementById('review-detail-modal').classList.remove('open');
  }

  return { load, filter, openDetail, closeDetail, _tab, _submitOverride, quickOverride };
})();
