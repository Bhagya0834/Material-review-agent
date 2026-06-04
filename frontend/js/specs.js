/* ── Specs Library ──────────────────────────────────────────────────────── */
const Specs = (() => {
  let allSpecs = [];
  let selectedFile = null;

  async function load() {
    try {
      allSpecs = await App.get('/api/specs/');
      filterSpecs();
    } catch (e) {
      document.getElementById('specs-grid').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  }

  function filterSpecs() {
    const q = (document.getElementById('specs-search')?.value || '').toLowerCase().trim();
    if (!q) { _render(allSpecs); return; }
    const filtered = allSpecs.filter(s =>
      (s.name          || '').toLowerCase().includes(q) ||
      (s.standard      || '').toLowerCase().includes(q) ||
      (s.grade         || '').toLowerCase().includes(q) ||
      (s.material_type || '').toLowerCase().includes(q) ||
      (s.description   || '').toLowerCase().includes(q)
    );
    _render(filtered);
  }

  function _render(specs) {
    const grid  = document.getElementById('specs-grid');
    const empty = document.getElementById('specs-empty');
    if (!specs.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    grid.innerHTML = specs.map(s => `
      <div class="card" style="display:flex;flex-direction:column;gap:12px;">
        <div class="flex justify-between items-center">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text);">${s.name}</div>
            <div class="text-sm text-muted mt-2">${s.standard || ''}${s.grade ? ' · ' + s.grade : ''}</div>
          </div>
          <button class="btn btn-danger btn-sm" onclick="Specs.delete(${s.id}, '${s.name.replace(/'/g,"\\'")}')">Delete</button>
        </div>
        <div class="flex gap-2 flex-wrap">
          ${s.material_type ? `<span class="cat-pill cat-other">${s.material_type}</span>` : ''}
          <span class="cat-pill cat-mechanical">${s.param_count} parameters</span>
        </div>
        ${s.description ? `<div class="text-sm text-muted">${s.description}</div>` : ''}
        <div class="text-xs text-muted">Added ${App.fmtDate(s.created_at)}</div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="Specs.viewParams(${s.id})">View Parameters</button>
          <button class="btn btn-primary btn-sm" style="flex:1;" onclick="Specs.openCustomParams(${s.id}, '${s.name.replace(/'/g,"\\'")}')">+ Custom Params</button>
        </div>
        <button class="btn btn-secondary btn-sm w-full" style="border:1.5px dashed var(--primary);color:var(--primary);" onclick="Specs.showReupload(${s.id},'${s.name.replace(/'/g,"\\'")}')">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
          Re-upload PDF (Revision Update)
        </button>
      </div>
    `).join('');
  }

  // ── Custom Parameters ──────────────────────────────────────────────────────

  async function openCustomParams(specId, specName) {
    const modal = document.getElementById('review-detail-modal');
    document.getElementById('detail-title').textContent = `Custom Parameters — ${specName}`;
    document.getElementById('detail-body').innerHTML = `<div style="text-align:center;padding:24px;"><div class="spinner" style="margin:0 auto;"></div></div>`;
    modal.classList.add('open');
    await _renderCustomParams(specId, specName);
  }

  async function _renderCustomParams(specId, specName) {
    try {
      const params = await App.get(`/api/specs/${specId}/custom-params`);
      document.getElementById('detail-body').innerHTML = `
        <div class="alert alert-info mb-4" style="font-size:13px;">
          Custom parameters are checked on <strong>every future review</strong> against this spec, alongside the extracted parameters.
          They appear tagged as <span class="cat-pill cat-other" style="font-size:10px;">Custom</span> in review results.
        </div>

        <!-- Existing custom params -->
        ${params.length ? `
          <div class="table-wrap mb-4">
            <table>
              <thead><tr><th>Parameter</th><th>Category</th><th>Min</th><th>Max</th><th>Unit</th><th>Requirement</th><th>Critical</th><th></th></tr></thead>
              <tbody>
                ${params.map(p => `
                  <tr>
                    <td><strong>${p.name}</strong>${p.symbol ? ` <small class="text-muted">(${p.symbol})</small>` : ''}</td>
                    <td>${App.catPill(p.category)}</td>
                    <td>${p.min_value ?? '—'}</td>
                    <td>${p.max_value ?? '—'}</td>
                    <td>${p.unit || '—'}</td>
                    <td class="text-sm text-muted" style="max-width:180px;">${p.requirement_text || '—'}</td>
                    <td>${p.is_critical ? '<span class="badge rejected" style="font-size:10px;">Critical</span>' : ''}</td>
                    <td>
                      <button class="btn btn-danger btn-sm" onclick="Specs._deleteCustomParam(${specId},'${specName.replace(/'/g,"\\'")}',${p.id})">Remove</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>` : `<div class="alert alert-warn mb-4" style="font-size:13px;">No custom parameters yet. Add one below.</div>`}

        <!-- Add new custom param form -->
        <div style="border:1.5px solid var(--border);border-radius:10px;padding:20px;">
          <div style="font-size:13px;font-weight:700;margin-bottom:14px;color:var(--text);">Add Custom Parameter</div>
          <div id="cp-err" class="alert alert-error hidden mb-3"></div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Parameter Name *</label>
              <input class="form-input" id="cp-name" type="text" placeholder="e.g. Stress Corrosion Test, PMI Check" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Symbol / Abbreviation</label>
              <input class="form-input" id="cp-symbol" type="text" placeholder="e.g. SCC, PMI" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Category</label>
              <select class="form-select" id="cp-category">
                <option value="chemical">Chemical</option>
                <option value="mechanical">Mechanical</option>
                <option value="dimensional">Dimensional</option>
                <option value="surface">Surface</option>
                <option value="compliance" selected>Compliance / NDE</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Unit <span class="text-muted">(leave blank if text requirement)</span></label>
              <input class="form-input" id="cp-unit" type="text" placeholder="e.g. %, MPa, HRC" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Min Value <span class="text-muted">(numeric only)</span></label>
              <input class="form-input" id="cp-min" type="number" step="any" placeholder="e.g. 110" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Max Value <span class="text-muted">(numeric only)</span></label>
              <input class="form-input" id="cp-max" type="number" step="any" placeholder="e.g. 150" />
            </div>
          </div>

          <div class="form-group mt-3" style="margin-bottom:12px;">
            <label class="form-label">Text Requirement <span class="text-muted">(for non-numeric requirements)</span></label>
            <input class="form-input" id="cp-reqtext" type="text"
              placeholder="e.g. Must be VAR remelted · UT per API 6A PSL3 · Stress relieved after welding" />
          </div>

          <div class="flex items-center gap-3">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;">
              <input type="checkbox" id="cp-critical" checked style="width:16px;height:16px;" />
              Mark as Critical
            </label>
            <span class="text-sm text-muted">(Critical parameters can trigger UNDER REVIEW if they fail)</span>
          </div>

          <button class="btn btn-primary mt-4 w-full" onclick="Specs._saveCustomParam(${specId}, '${specName.replace(/'/g,"\\'")}')">
            Save Custom Parameter
          </button>
        </div>
      `;
    } catch (e) {
      document.getElementById('detail-body').innerHTML = `<div class="alert alert-error">${e.message}</div>`;
    }
  }

  async function _saveCustomParam(specId, specName) {
    const name    = document.getElementById('cp-name').value.trim();
    const errEl   = document.getElementById('cp-err');
    errEl.classList.add('hidden');

    if (!name) { errEl.textContent = 'Parameter name is required.'; errEl.classList.remove('hidden'); return; }

    const minRaw = document.getElementById('cp-min').value;
    const maxRaw = document.getElementById('cp-max').value;

    const payload = {
      name,
      symbol:           document.getElementById('cp-symbol').value.trim(),
      category:         document.getElementById('cp-category').value,
      min_value:        minRaw !== '' ? parseFloat(minRaw) : null,
      max_value:        maxRaw !== '' ? parseFloat(maxRaw) : null,
      unit:             document.getElementById('cp-unit').value.trim(),
      requirement_text: document.getElementById('cp-reqtext').value.trim(),
      is_critical:      document.getElementById('cp-critical').checked,
    };

    try {
      await fetch(`/api/specs/${specId}/custom-params`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(async r => {
        if (!r.ok) { const e = await r.json(); throw new Error(e.detail || r.statusText); }
        return r.json();
      });
      await _renderCustomParams(specId, specName);
      await load();   // refresh param count on card
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  }

  async function _deleteCustomParam(specId, specName, paramId) {
    if (!confirm('Remove this custom parameter?')) return;
    try {
      await App.del(`/api/specs/${specId}/custom-params/${paramId}`);
      await _renderCustomParams(specId, specName);
      await load();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  // ── Upload spec ────────────────────────────────────────────────────────────

  function showUpload() {
    document.getElementById('upload-spec-modal').classList.add('open');
    document.getElementById('upload-error').classList.add('hidden');
    ['spec-name','spec-standard','spec-grade','spec-material-type','spec-description'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('spec-filename').textContent = 'Click or drag & drop';
    document.getElementById('spec-drop').classList.remove('has-file');
    selectedFile = null;
  }

  function closeUpload() {
    document.getElementById('upload-spec-modal').classList.remove('open');
  }

  function onFileChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    selectedFile = file;
    document.getElementById('spec-filename').textContent = file.name;
    document.getElementById('spec-drop').classList.add('has-file');
  }

  async function upload() {
    const name = document.getElementById('spec-name').value.trim();
    const errEl = document.getElementById('upload-error');
    errEl.classList.add('hidden');

    if (!name)         { errEl.textContent = 'Specification name is required.'; errEl.classList.remove('hidden'); return; }
    if (!selectedFile) { errEl.textContent = 'Please select a document.';        errEl.classList.remove('hidden'); return; }

    const btn = document.getElementById('upload-spec-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Processing…';

    const fd = new FormData();
    fd.append('file', selectedFile);
    fd.append('name', name);
    fd.append('standard',      document.getElementById('spec-standard').value.trim());
    fd.append('grade',         document.getElementById('spec-grade').value.trim());
    fd.append('material_type', document.getElementById('spec-material-type').value.trim());
    fd.append('description',   document.getElementById('spec-description').value.trim());

    try {
      const res = await App.post('/api/specs/upload', fd);
      closeUpload();
      await load();
      Review._specsCache = null;
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Upload & Process';
    }
  }

  async function del(id, name) {
    if (!confirm(`Delete specification "${name}"?\nExisting reviews will not be affected.`)) return;
    try {
      await App.del(`/api/specs/${id}`);
      await load();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function viewParams(id) {
    try {
      const spec   = await App.get(`/api/specs/${id}`);
      const params = spec.extracted_params?.parameters || [];
      const custom = await App.get(`/api/specs/${id}/custom-params`);
      const modal  = document.getElementById('review-detail-modal');
      document.getElementById('detail-title').textContent = `${spec.name} — All Parameters (${params.length + custom.length})`;
      document.getElementById('detail-body').innerHTML = `
        <div class="mb-3 flex gap-2 items-center justify-between">
          <div class="flex gap-2">
            <span class="cat-pill cat-mechanical">${params.length} extracted</span>
            <span class="cat-pill cat-other">${custom.length} custom</span>
          </div>
          <span class="text-xs text-muted">Click Edit on any row to change limits</span>
        </div>

        <div class="table-wrap">
          <table>
            <thead><tr><th>Parameter</th><th>Type</th><th>Category</th><th>Min</th><th>Max</th><th>Unit / Requirement</th><th>Critical</th><th></th></tr></thead>
            <tbody>
              ${params.map((p, i) => `
                <tr id="ep-row-${id}-${i}">
                  <td><strong>${p.name}</strong>${p.symbol ? ` <small class="text-muted">(${p.symbol})</small>` : ''}</td>
                  <td><span class="cat-pill cat-mechanical" style="font-size:10px;">Extracted</span></td>
                  <td>${App.catPill(p.category)}</td>
                  <td>${p.min_value ?? '—'}</td>
                  <td>${p.max_value ?? '—'}</td>
                  <td class="text-sm">${p.unit || p.requirement_text || '—'}</td>
                  <td>${p.is_critical ? '<span class="badge rejected" style="font-size:10px;">Critical</span>' : ''}</td>
                  <td style="display:flex;gap:4px;">
                    <button class="btn btn-secondary btn-sm" onclick="Specs._editExtractedParam(${id},'${spec.name.replace(/'/g,"\\'")}',${i})">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="Specs._deleteExtractedParam(${id},'${spec.name.replace(/'/g,"\\'")}',${i},'${p.name.replace(/'/g,"\\'")}')">Del</button>
                  </td>
                </tr>
              `).join('')}
              ${custom.map(p => `
                <tr id="cp-row-${id}-${p.id}" style="background:#fefce8;">
                  <td><strong>${p.name}</strong>${p.symbol ? ` <small class="text-muted">(${p.symbol})</small>` : ''}</td>
                  <td><span class="cat-pill cat-other" style="font-size:10px;">Custom</span></td>
                  <td>${App.catPill(p.category)}</td>
                  <td>${p.min_value ?? '—'}</td>
                  <td>${p.max_value ?? '—'}</td>
                  <td class="text-sm">${p.unit || p.requirement_text || '—'}</td>
                  <td>${p.is_critical ? '<span class="badge rejected" style="font-size:10px;">Critical</span>' : ''}</td>
                  <td style="display:flex;gap:4px;">
                    <button class="btn btn-secondary btn-sm" onclick="Specs._editCustomParam(${id},'${spec.name.replace(/'/g,"\\'")}',${p.id})">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="Specs._deleteCustomParam(${id},'${spec.name.replace(/'/g,"\\'")}',${p.id})">Del</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div style="margin-top:16px;">
          <button class="btn btn-primary btn-sm" onclick="Specs.openCustomParams(${id},'${spec.name.replace(/'/g,"\\'")}')">+ Add Custom Parameter</button>
        </div>

        <!-- Inline edit panel -->
        <div id="inline-edit-panel" class="hidden" style="margin-top:20px;border:1.5px solid var(--primary);border-radius:10px;padding:20px;background:var(--primary-lt);">
          <div style="font-size:13px;font-weight:700;margin-bottom:12px;" id="inline-edit-title">Edit Parameter</div>
          <div id="inline-edit-err" class="alert alert-error hidden mb-3"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <div><label class="form-label">Min Value</label><input class="form-input" id="ie-min" type="number" step="any" /></div>
            <div><label class="form-label">Max Value</label><input class="form-input" id="ie-max" type="number" step="any" /></div>
            <div><label class="form-label">Unit</label><input class="form-input" id="ie-unit" type="text" /></div>
            <div style="grid-column:span 3;"><label class="form-label">Requirement Text (if non-numeric)</label><input class="form-input" id="ie-req" type="text" /></div>
          </div>
          <div class="flex items-center gap-3 mt-3">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;">
              <input type="checkbox" id="ie-critical" style="width:16px;height:16px;" /> Critical
            </label>
            <button class="btn btn-primary btn-sm" id="ie-save-btn">Save Changes</button>
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('inline-edit-panel').classList.add('hidden')">Cancel</button>
          </div>
        </div>
      `;
      modal.classList.add('open');
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  async function _deleteExtractedParam(specId, specName, paramIndex, paramName) {
    if (!confirm(`Remove "${paramName}" from this specification?\n\nThis only removes it from the stored list — it will no longer be checked in future reviews.`)) return;
    try {
      await fetch(`/api/specs/${specId}/extracted-param/${paramIndex}`, { method: 'DELETE' })
        .then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.detail); } return r.json(); });
      await viewParams(specId);
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  function _editExtractedParam(specId, specName, paramIndex) {
    const spec = allSpecs.find(s => s.id === specId);
    document.getElementById('inline-edit-title').textContent = `Edit Extracted Parameter #${paramIndex + 1}`;
    document.getElementById('inline-edit-panel').classList.remove('hidden');
    document.getElementById('inline-edit-err').classList.add('hidden');
    document.getElementById('ie-min').value   = '';
    document.getElementById('ie-max').value   = '';
    document.getElementById('ie-unit').value  = '';
    document.getElementById('ie-req').value   = '';
    document.getElementById('ie-critical').checked = true;
    document.getElementById('ie-save-btn').onclick = async () => {
      const errEl = document.getElementById('inline-edit-err');
      errEl.classList.add('hidden');
      try {
        const payload = { index: paramIndex };
        const minV = document.getElementById('ie-min').value;
        const maxV = document.getElementById('ie-max').value;
        if (minV !== '') payload.min_value = parseFloat(minV);
        if (maxV !== '') payload.max_value = parseFloat(maxV);
        const unit = document.getElementById('ie-unit').value.trim();
        const req  = document.getElementById('ie-req').value.trim();
        if (unit) payload.unit = unit;
        if (req)  payload.requirement_text = req;
        payload.is_critical = document.getElementById('ie-critical').checked;
        await fetch(`/api/specs/${specId}/edit-extracted-param`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
        }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.detail); } return r.json(); });
        document.getElementById('inline-edit-panel').classList.add('hidden');
        await viewParams(specId);
      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    };
    document.getElementById('inline-edit-panel').scrollIntoView({ behavior: 'smooth' });
  }

  function _editCustomParam(specId, specName, paramId) {
    document.getElementById('inline-edit-title').textContent = `Edit Custom Parameter`;
    document.getElementById('inline-edit-panel').classList.remove('hidden');
    document.getElementById('inline-edit-err').classList.add('hidden');
    document.getElementById('ie-save-btn').onclick = async () => {
      const errEl = document.getElementById('inline-edit-err');
      errEl.classList.add('hidden');
      try {
        const payload = {};
        const minV = document.getElementById('ie-min').value;
        const maxV = document.getElementById('ie-max').value;
        if (minV !== '') payload.min_value = parseFloat(minV);
        if (maxV !== '') payload.max_value = parseFloat(maxV);
        const unit = document.getElementById('ie-unit').value.trim();
        const req  = document.getElementById('ie-req').value.trim();
        if (unit) payload.unit = unit;
        if (req)  payload.requirement_text = req;
        payload.is_critical = document.getElementById('ie-critical').checked;
        await fetch(`/api/specs/${specId}/custom-params/${paramId}`, {
          method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
        }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.detail); } return r.json(); });
        document.getElementById('inline-edit-panel').classList.add('hidden');
        await viewParams(specId);
      } catch (e) {
        errEl.textContent = e.message; errEl.classList.remove('hidden');
      }
    };
    document.getElementById('inline-edit-panel').scrollIntoView({ behavior: 'smooth' });
  }

  // ── Re-upload PDF ──────────────────────────────────────────────────────────

  let _reuploadSpecId   = null;
  let _reuploadSpecName = null;
  let _reuploadFile     = null;

  function showReupload(specId, specName) {
    _reuploadSpecId   = specId;
    _reuploadSpecName = specName;
    _reuploadFile     = null;

    const modal = document.getElementById('review-detail-modal');
    document.getElementById('detail-title').textContent = `Re-upload PDF — ${specName}`;
    document.getElementById('detail-body').innerHTML = `
      <div class="alert alert-info mb-4" style="font-size:13px;">
        Upload the new revision PDF. All parameters will be re-extracted and updated.<br>
        <strong>Custom parameters and spec details are preserved.</strong>
      </div>
      <div id="reupload-err" class="alert alert-error hidden mb-3"></div>
      <div class="drop-zone" id="reupload-drop" onclick="document.getElementById('reupload-file-input').click()">
        <input type="file" id="reupload-file-input" accept=".pdf,.png,.jpg,.jpeg" hidden
          onchange="Specs._onReuploadFile(event)" />
        <div class="drop-zone-icon">📋</div>
        <div class="drop-zone-title" id="reupload-filename">Click or drag &amp; drop new PDF</div>
        <div class="drop-zone-sub">PDF recommended · New revision will replace stored parameters</div>
      </div>
      <div class="flex gap-3 mt-4">
        <button class="btn btn-primary flex-1" id="reupload-btn" onclick="Specs._submitReupload()" disabled>
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
          Process New Revision
        </button>
        <button class="btn btn-secondary" onclick="document.getElementById('review-detail-modal').classList.remove('open')">Cancel</button>
      </div>
    `;
    modal.classList.add('open');

    // drag & drop
    const zone = document.getElementById('reupload-drop');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragging');
      const f = e.dataTransfer.files[0];
      if (f) { _reuploadFile = f; document.getElementById('reupload-filename').textContent = f.name; zone.classList.add('has-file'); document.getElementById('reupload-btn').disabled = false; }
    });
  }

  function _onReuploadFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    _reuploadFile = f;
    document.getElementById('reupload-filename').textContent = f.name;
    document.getElementById('reupload-drop').classList.add('has-file');
    document.getElementById('reupload-btn').disabled = false;
  }

  async function _submitReupload() {
    if (!_reuploadFile || !_reuploadSpecId) return;
    const btn   = document.getElementById('reupload-btn');
    const errEl = document.getElementById('reupload-err');
    errEl.classList.add('hidden');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px;"></span> Extracting parameters…';

    const fd = new FormData();
    fd.append('file', _reuploadFile);

    try {
      const res = await fetch(`/api/specs/${_reuploadSpecId}/reupload`, { method: 'POST', body: fd })
        .then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.detail); } return r.json(); });

      document.getElementById('review-detail-modal').classList.remove('open');
      await load();
      Review._specsCache = null;
      alert(`Done! "${_reuploadSpecName}" updated — ${res.param_count} parameters extracted from new revision.`);
    } catch (e) {
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.innerHTML = 'Process New Revision';
    }
  }

  // Drag & drop for spec upload
  window.addEventListener('DOMContentLoaded', () => {
    const zone = document.getElementById('spec-drop');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (file) { selectedFile = file; document.getElementById('spec-filename').textContent = file.name; zone.classList.add('has-file'); }
    });
  });

  return { load, filterSpecs, showUpload, closeUpload, onFileChange, upload, delete: del, viewParams, openCustomParams, _saveCustomParam, _deleteCustomParam, _editExtractedParam, _editCustomParam, _deleteExtractedParam, showReupload, _onReuploadFile, _submitReupload };
})();
