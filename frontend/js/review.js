/* ── New Review ─────────────────────────────────────────────────────────── */
const Review = (() => {
  let selectedFile   = null;
  let selectedSpecId = null;
  let _specsCache    = null;
  let _pollTimer     = null;

  const steps = [
    'Reading specification from database…',
    'Processing mill certificate pages…',
    'Extracting parameters with OCR…',
    'Matching parameters to specification…',
    'Calculating compliance score…',
    'Generating review summary…',
  ];

  async function init() {
    // Reset form
    selectedFile   = null;
    selectedSpecId = null;
    document.getElementById('cert-filename').textContent = 'Click or drag & drop';
    document.getElementById('cert-drop').classList.remove('has-file');
    document.getElementById('cert-file-input').value = '';
    document.getElementById('po-number').value = '';
    document.getElementById('spec-search').value = '';
    document.getElementById('review-form-section').classList.remove('hidden');
    document.getElementById('review-processing').classList.add('hidden');
    document.getElementById('review-result').classList.add('hidden');
    _updateStartBtn();
    await _loadSpecs();
  }

  async function _loadSpecs() {
    if (_specsCache) { _renderSpecList(_specsCache); return; }
    try {
      _specsCache = await App.get('/api/specs/');
      _renderSpecList(_specsCache);
    } catch (e) {
      document.getElementById('spec-list').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  }

  function _renderSpecList(specs) {
    const q = (document.getElementById('spec-search')?.value || '').toLowerCase();
    const filtered = specs.filter(s =>
      s.name.toLowerCase().includes(q) ||
      (s.standard || '').toLowerCase().includes(q) ||
      (s.material_type || '').toLowerCase().includes(q)
    );

    const list  = document.getElementById('spec-list');
    const empty = document.getElementById('spec-empty');

    if (!filtered.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = filtered.map(s => `
      <div class="spec-option ${s.id === selectedSpecId ? 'selected' : ''}"
           style="padding:12px;border:1.5px solid ${s.id === selectedSpecId ? 'var(--primary)' : 'var(--border)'};
                  border-radius:8px;cursor:pointer;background:${s.id === selectedSpecId ? 'var(--primary-lt)' : 'var(--card)'};"
           onclick="Review.selectSpec(${s.id})">
        <div style="font-weight:600;font-size:13px;">${s.name}</div>
        <div class="text-sm text-muted mt-2">${s.standard || ''}${s.grade ? ' · ' + s.grade : ''} · ${s.param_count} params</div>
      </div>
    `).join('');
  }

  function filterSpecs() {
    if (_specsCache) _renderSpecList(_specsCache);
  }

  function selectSpec(id) {
    selectedSpecId = id;
    _renderSpecList(_specsCache || []);
    _updateStartBtn();
  }

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    document.getElementById('cert-filename').textContent = file.name;
    document.getElementById('cert-drop').classList.add('has-file');
    _updateStartBtn();
  }

  function _updateStartBtn() {
    document.getElementById('start-review-btn').disabled = !(selectedFile && selectedSpecId);
  }

  async function start() {
    if (!selectedFile || !selectedSpecId) return;

    // Show processing
    document.getElementById('review-form-section').classList.add('hidden');
    document.getElementById('review-result').classList.add('hidden');
    document.getElementById('review-processing').classList.remove('hidden');
    _animateSteps();

    const fd = new FormData();
    fd.append('file',      selectedFile);
    fd.append('spec_id',   selectedSpecId);
    fd.append('po_number', document.getElementById('po-number').value.trim());

    try {
      const res = await App.post('/api/reviews/start', fd);
      _pollResult(res.review_id);
    } catch (e) {
      _showError(e.message);
    }
  }

  let _stepIdx = 0;
  function _animateSteps() {
    _stepIdx = 0;
    clearInterval(_pollTimer);
    const el = document.getElementById('processing-step');
    const iv = setInterval(() => {
      if (_stepIdx < steps.length - 1) {
        _stepIdx++;
        el.textContent = steps[_stepIdx];
      } else {
        clearInterval(iv);
      }
    }, 4000);
  }

  function _pollResult(reviewId) {
    const iv = setInterval(async () => {
      try {
        const r = await App.get(`/api/reviews/${reviewId}`);
        if (r.status !== 'PROCESSING') {
          clearInterval(iv);
          document.getElementById('review-processing').classList.add('hidden');
          if (r.status === 'ERROR') { _showError(r.error_message || 'Unknown error'); return; }
          _showResult(r);
        }
      } catch (e) {
        clearInterval(iv);
        _showError(e.message);
      }
    }, 2500);
  }

  function _showError(msg) {
    document.getElementById('review-processing').classList.add('hidden');
    document.getElementById('review-result').classList.remove('hidden');
    document.getElementById('review-result').innerHTML = `
      <div class="alert alert-error" style="max-width:600px;">
        <strong>Review failed:</strong> ${msg}
        <button class="btn btn-secondary btn-sm" style="margin-left:12px;" onclick="Review.init()">Try again</button>
      </div>`;
  }

  function _showResult(r) {
    const cr = r.comparison_result || {};
    const params = cr.parameters || [];
    const statusLower = (r.status || '').toLowerCase().replace('_', '-');

    const chemical  = params.filter(p => (p.category || '').toLowerCase() === 'chemical');
    const mech      = params.filter(p => (p.category || '').toLowerCase() === 'mechanical');
    const others    = params.filter(p => !['chemical','mechanical'].includes((p.category||'').toLowerCase()));

    const scClass = App.scoreClass(r.score);

    const html = `
      <div>
        <!-- Result header -->
        <div class="result-header ${statusLower}" style="margin-bottom:20px;">
          <div>
            <div class="result-status-label result-${statusLower}">
              ${r.status === 'APPROVED' ? '✓' : r.status === 'REJECTED' ? '✗' : '⚠'} Overall Decision
            </div>
            <div class="result-status-text result-${statusLower}">
              ${r.status === 'APPROVED' ? 'APPROVED' : r.status === 'UNDER_REVIEW' ? 'UNDER REVIEW' : 'REJECTED'}
            </div>
            <div class="text-sm mt-2 text-muted">${cr.decision_reason || ''}</div>
          </div>
          <div style="text-align:center;padding:0 20px;border-left:1px solid rgba(0,0,0,.1);border-right:1px solid rgba(0,0,0,.1);">
            <div class="big-score ${scClass}">${r.score != null ? r.score.toFixed(1) : '—'}%</div>
            <div class="text-sm text-muted mt-2">Compliance Score</div>
            <div style="margin-top:8px;width:120px;"><div class="score-bar-bg"><div class="score-bar score-${scClass}" style="width:${r.score||0}%;"></div></div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;text-align:center;">
            <div><div style="font-size:22px;font-weight:800;color:var(--success);">${r.passed ?? 0}</div><div class="text-xs text-muted">PASS</div></div>
            <div><div style="font-size:22px;font-weight:800;color:var(--danger);">${r.failed ?? 0}</div><div class="text-xs text-muted">FAIL</div></div>
            <div><div style="font-size:22px;font-weight:800;color:var(--neutral);">${r.not_found ?? 0}</div><div class="text-xs text-muted">NOT FOUND</div></div>
          </div>
        </div>

        <!-- Cert info -->
        <div class="card mb-4" style="background:var(--neutral-lt);">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
            ${_infoCell('Vendor',        cr.vendor || r.vendor || '—')}
            ${_infoCell('Heat / Lot No.',cr.heat_number || r.heat_number || '—')}
            ${_infoCell('Material',      cr.material || r.material || '—')}
            ${_infoCell('Certificate',   cr.certificate_number || '—')}
          </div>
        </div>

        ${cr.critical_failures?.length ? `
          <div class="alert alert-error mb-4">
            <strong>Critical Failures:</strong> ${cr.critical_failures.join(', ')}
          </div>` : ''}

        ${cr.summary ? `
          <div class="alert alert-info mb-4">${cr.summary}</div>` : ''}

        <!-- Parameter tables by category -->
        ${_paramSection('Chemical Composition', chemical)}
        ${_paramSection('Mechanical Properties', mech)}
        ${others.length ? _paramSection('Other Parameters', others) : ''}

        <div class="flex gap-3 mt-4">
          <button class="btn btn-secondary" onclick="Review.init()">New Review</button>
          <button class="btn btn-secondary" onclick="App.navigate('history')">View History</button>
        </div>
      </div>
    `;

    const el = document.getElementById('review-result');
    el.classList.remove('hidden');
    el.innerHTML = html;
  }

  function _infoCell(label, val) {
    return `<div><div class="text-xs text-muted font-semibold" style="text-transform:uppercase;letter-spacing:.06em;">${label}</div><div style="font-size:14px;font-weight:600;margin-top:3px;">${val}</div></div>`;
  }

  function _paramSection(title, params) {
    if (!params.length) return '';
    return `
      <div class="card mb-4">
        <div class="card-header"><div class="card-title">${title}</div>
          <div class="flex gap-2">
            <span class="badge pass">${params.filter(p=>p.status==='PASS').length} Pass</span>
            <span class="badge fail">${params.filter(p=>p.status==='FAIL').length} Fail</span>
            <span class="badge not-found">${params.filter(p=>p.status==='NOT_FOUND').length} Not Found</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Parameter</th><th>Spec Min</th><th>Spec Max</th><th>Actual Value</th><th>Unit</th><th>Critical</th><th>Result</th><th>Notes</th></tr></thead>
            <tbody>
              ${params.map(p => `
                <tr class="${p.status==='PASS'?'row-pass':p.status==='FAIL'?'row-fail':'row-nf'}">
                  <td><strong>${p.name}</strong>${p.symbol ? ` <small class="text-muted">(${p.symbol})</small>` : ''}</td>
                  <td>${p.spec_min ?? '—'}</td>
                  <td>${p.spec_max ?? '—'}</td>
                  <td style="font-weight:600;">${p.actual_value ?? '—'}</td>
                  <td>${p.spec_unit || p.actual_unit || '—'}</td>
                  <td>${p.is_critical ? '<span class="badge rejected" style="font-size:10px;">Critical</span>' : ''}</td>
                  <td>${App.paramBadge(p.status)}</td>
                  <td class="text-sm text-muted">${p.notes || ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // Drag & drop for cert upload
  window.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('cert-drop');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) {
        selectedFile = file;
        document.getElementById('cert-filename').textContent = file.name;
        zone.classList.add('has-file');
        _updateStartBtn();
      }
    });
  });

  return { init, onFileChange, filterSpecs, selectSpec, start, _specsCache };
})();
