// Driver inspection wizard: truck -> photos -> checklist -> review & submit.
(function () {
  const id = new URLSearchParams(location.search).get('id');
  const $ = (sel) => document.querySelector(sel);
  const STEPS = ['Truck', 'Photos', 'Checklist', 'Review'];

  const state = {
    data: null,      // latest server view (photos, evaluation, truck, driver, status)
    config: null,    // checklist template and photo slots
    step: 0,
    answers: {},     // local answers are the source of truth while editing
    odometer: '',
    notes: '',
    saveTimer: null,
    photoVersion: {},
    busy: false,
  };

  // ---------- Derived state ----------
  const allItemKeys = () => state.config.checklist.flatMap((s) => s.items.map((i) => i.key));
  const answeredCount = () => allItemKeys().filter((k) => ['pass', 'fail', 'na'].includes(state.answers[k])).length;
  const failedItems = () => state.config.checklist.flatMap((s) => s.items).filter((i) => state.answers[i.key] === 'fail');
  const missingPhotos = () => state.config.requiredPhotos.filter((slot) => !state.data.photos[slot]);
  const isOpen = () => state.data.status === 'in_progress';

  // ---------- Save ----------
  function scheduleSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    clearTimeout(state.saveTimer);
    if (!isOpen()) return true;
    try {
      // Only server-derived fields are refreshed; local answers are never overwritten.
      state.data = await api(`/api/inspections/${id}/checklist`, {
        method: 'PUT',
        body: { answers: state.answers, odometer: state.odometer, notes: state.notes },
      });
      return true;
    } catch (e) {
      toast(e.message, true);
      return false;
    }
  }

  // ---------- Render ----------
  function render() {
    const footer = document.querySelector('.bottombar');
    const showFooter = isOpen();
    footer.style.display = showFooter ? '' : 'none';

    $('#title').textContent = state.data.truck ? `Unit ${state.data.truck.unit}` : 'Inspection';
    $('#counter').textContent = isOpen() ? `${state.step + 1}/${STEPS.length}` : '';
    $('#bar').style.width = isOpen() ? `${((state.step + 1) / STEPS.length) * 100}%` : '100%';
    $('#backBtn').style.visibility = state.step === 0 || !isOpen() ? 'hidden' : 'visible';
    $('#nextBtn').textContent = state.step === STEPS.length - 1 ? 'Submit inspection' : 'Continue';
    $('#nextBtn').disabled = false;

    if (!isOpen()) {
      $('#app').innerHTML = resultView();
      return;
    }

    const steps = `<nav class="steps" aria-label="Progress">${STEPS.map((s, i) =>
      `<div class="step ${i === state.step ? 'current' : i < state.step ? 'done' : ''}">${i < state.step ? '✓ ' : ''}${s}</div>`).join('')}</nav>`;
    const views = [renderTruck, renderPhotos, renderChecklist, renderReview];
    $('#app').innerHTML = steps + views[state.step]();
  }

  function renderTruck() {
    const t = state.data.truck;
    const d = state.data.driver;
    return `
      <div class="card" style="margin-top:16px">
        <div class="muted small">Vehicle</div>
        <div class="hero-h2">Unit ${esc(t.unit)}</div>
        <div class="muted">${esc([t.make, t.model, t.year].filter(Boolean).join(' '))}${t.plate ? ` · ${esc(t.plate)}` : ''}</div>
        <dl class="kv">
          <dt>Driver</dt><dd>${d ? esc(d.name) : 'Not assigned'}</dd>
          <dt>Readiness</dt><dd>${pill(t.readiness)}</dd>
        </dl>
      </div>
      <div class="card section-card">
        <label class="field">
          <span>Current odometer (miles or km)</span>
          <input class="input" id="odo" type="number" inputmode="numeric" min="0" step="1"
            value="${esc(state.odometer)}" placeholder="e.g. 412560">
        </label>
        <p class="muted small" style="margin-top:12px">Take the required photos (4 sides, dashboard and driver seat), then complete the checklist. Progress saves automatically.</p>
      </div>`;
  }

  function photoTile(slot, label, required) {
    const has = Boolean(state.data.photos[slot]);
    const src = photoUrl(id, slot, state.photoVersion[slot] || 0);
    const badge = has
      ? '<span class="badge ok">Saved</span>'
      : required ? '<span class="badge">Required</span>' : '<span class="badge opt">Optional</span>';
    return `
      <label class="photo-tile ${has ? 'done' : ''}">
        ${has
          ? `<img src="${esc(src)}" alt="${esc(label)} photo" loading="lazy">`
          : '<div class="placeholder"><div><div class="plus">+</div><div style="margin-top:10px">Tap to take photo</div></div></div>'}
        <div class="photo-label"><span>${esc(label)}</span>${badge}</div>
        <input type="file" accept="image/*" capture="environment" data-photo="${esc(slot)}">
      </label>`;
  }

  function renderPhotos() {
    const { photoSlots, requiredPhotos, photoGroups } = state.config;
    const missing = missingPhotos().length;
    const notice = missing
      ? `<div class="notice warn">${missing} required photo${missing > 1 ? 's' : ''} missing.</div>`
      : '<div class="notice good">All required photos are saved.</div>';
    const saved = photoGroups.reduce((n, g) => n + g.slots.filter((s) => state.data.photos[s]).length, 0);
    const total = photoGroups.reduce((n, g) => n + g.slots.length, 0);
    const groups = photoGroups.map((g) => `
      <section style="margin-top:24px">
        <div class="row" style="justify-content:space-between;align-items:baseline">
          <h3>${esc(g.title)}</h3>
          <span class="muted small">${g.slots.filter((s) => state.data.photos[s]).length} / ${g.slots.length}</span>
        </div>
        <p class="muted small" style="margin-top:4px">${esc(g.hint)}</p>
        <div class="photo-grid">
          ${g.slots.map((slot) => photoTile(slot, photoSlots[slot], requiredPhotos.includes(slot))).join('')}
        </div>
      </section>`).join('');
    return `
      <div style="margin-top:16px">${notice}
        <p class="muted small" style="margin-top:8px">${saved} of ${total} photos saved. Taking all 12 walk-around shots gives the smoothest 360° view.</p>
      </div>
      ${groups}`;
  }

  function renderChecklist() {
    const sections = state.config.checklist.map((section) => `
      <div class="card section-card">
        <h3>${esc(section.title)}</h3>
        ${section.items.map((item) => {
          const val = state.answers[item.key];
          const btn = (v, text) => `<button type="button" data-item="${esc(item.key)}" data-val="${v}" aria-pressed="${val === v}">${text}</button>`;
          return `
            <div class="check-row">
              <span class="check-label ${item.critical ? 'critical' : ''}">${esc(item.label)}</span>
              <div class="seg" role="group" aria-label="${esc(item.label)}">
                ${btn('pass', 'Pass')}${btn('fail', 'Fail')}${btn('na', 'N/A')}
              </div>
            </div>`;
        }).join('')}
      </div>`).join('');
    return `
      <div class="row" style="margin-top:16px;justify-content:space-between">
        <span class="muted" id="answeredLabel">${answeredCount()} of ${allItemKeys().length} answered</span>
      </div>
      ${sections}`;
  }

  function renderReview() {
    const failed = failedItems();
    const missing = missingPhotos();
    const unanswered = allItemKeys().length - answeredCount();
    const blockers = [
      unanswered ? `${unanswered} checklist item${unanswered > 1 ? 's' : ''} not answered` : null,
      missing.length ? `missing photos: ${missing.map((s) => state.config.photoSlots[s]).join(', ')}` : null,
    ].filter(Boolean);

    const summary = failed.length
      ? `<div class="notice bad">Failed items:<ul>${failed.map((f) => `<li>${esc(f.label)}${f.critical ? ' (critical)' : ''}</li>`).join('')}</ul></div>`
      : '<div class="notice good">No failed items so far.</div>';

    return `
      <div class="card" style="margin-top:16px">
        <h2>Review</h2>
        <dl class="kv">
          <dt>Odometer</dt><dd>${esc(state.odometer || '—')}</dd>
          <dt>Photos</dt><dd>${state.config.requiredPhotos.length - missing.length} / ${state.config.requiredPhotos.length} required</dd>
          <dt>Checklist</dt><dd>${answeredCount()} / ${allItemKeys().length}</dd>
        </dl>
        <div style="margin-top:16px">${summary}</div>
        ${blockers.length ? `<div class="notice warn" style="margin-top:12px">Before you submit: ${blockers.map(esc).join('; ')}.</div>` : ''}
      </div>
      <div class="card section-card">
        <label class="field">
          <span>Notes for the dispatcher (optional)</span>
          <textarea id="notes" maxlength="2000" placeholder="Anything the dispatcher should know">${esc(state.notes)}</textarea>
        </label>
      </div>`;
  }

  function resultView() {
    const st = state.data.status;
    const tone = st === 'ready' ? 'good' : st === 'needs_attention' ? 'warn' : 'bad';
    const failed = state.data.evaluation.failed;
    const viewer = `/viewer.html?id=${id}${TOKEN ? `&t=${encodeURIComponent(TOKEN)}` : ''}`;
    return `
      <div class="wrap narrow" style="padding:0">
        <div class="card" style="margin-top:16px">
          <div class="result-hero">
            <div class="muted">Inspection #${id} complete</div>
            <div class="big" style="margin-top:8px">${esc(STATUS_LABEL[st] || st)}</div>
          </div>
          <div class="notice ${tone}" style="margin-top:12px">
            ${failed.length ? `Failed: ${failed.map((f) => esc(f.label)).join(', ')}` : 'All checklist items passed.'}
            ${state.data.tmsError ? `<div class="small" style="margin-top:6px">TMS sync pending: ${esc(state.data.tmsError)}</div>` : ''}
          </div>
          <div class="row" style="margin-top:20px">
            <a class="btn btn-block" href="${esc(viewer)}">View 360° report</a>
          </div>
        </div>
        <p class="muted small" style="margin-top:14px;text-align:center">Your dispatcher has been notified.</p>
      </div>`;
  }

  // ---------- Events (delegated; bound once) ----------
  $('#app').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-item]');
    if (!btn) return;
    state.answers[btn.dataset.item] = btn.dataset.val;
    btn.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    const label = $('#answeredLabel');
    if (label) label.textContent = `${answeredCount()} of ${allItemKeys().length} answered`;
    scheduleSave();
  });

  $('#app').addEventListener('input', (e) => {
    if (e.target.id === 'odo') { state.odometer = e.target.value; scheduleSave(); }
    if (e.target.id === 'notes') { state.notes = e.target.value; scheduleSave(); }
  });

  $('#app').addEventListener('change', async (e) => {
    const input = e.target.closest('input[data-photo]');
    if (!input) return;
    const file = input.files?.[0];
    if (!file) return;
    const slot = input.dataset.photo;
    toast('Uploading photo…');
    try {
      const dataUrl = await compressImage(file);
      state.data = await api(`/api/inspections/${id}/photos/${slot}`, { method: 'PUT', body: { data: dataUrl } });
      state.photoVersion[slot] = Date.now();
      toast(`${state.config.photoSlots[slot]} saved`);
    } catch (err) {
      toast(err.message || 'Photo upload failed', true);
    }
    render();
  });

  async function go(step) {
    if (step < 0 || step >= STEPS.length) return;
    await saveNow();
    state.step = step;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit() {
    if (state.busy) return;
    if (allItemKeys().length !== answeredCount() || missingPhotos().length) {
      toast('Finish the checklist and required photos first.', true);
      return;
    }
    state.busy = true;
    const btn = $('#nextBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await saveNow();
      state.data = await api(`/api/inspections/${id}/complete`, { method: 'POST' });
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Submit inspection';
    } finally {
      state.busy = false;
    }
  }

  $('#nextBtn').addEventListener('click', () => (state.step === STEPS.length - 1 ? submit() : go(state.step + 1)));
  $('#prevBtn').addEventListener('click', () => go(state.step - 1));
  $('#backBtn').addEventListener('click', () => go(state.step - 1));

  // ---------- Boot ----------
  async function init() {
    if (!id) {
      $('#app').innerHTML = '<div class="notice bad">Missing inspection link. Ask your dispatcher for a new one.</div>';
      $('.bottombar').style.display = 'none';
      return;
    }
    try {
      const [data, config] = await Promise.all([api(`/api/inspections/${id}`), api('/api/config')]);
      state.data = data;
      state.config = config;
      state.answers = { ...(data.checklist.answers || {}) };
      state.odometer = data.odometer ?? '';
      state.notes = data.notes || '';
      // Resume at Review once everything is filled in; otherwise start at the truck step.
      state.step = !isOpen() || data.canComplete ? STEPS.length - 1 : 0;
      render();
    } catch (err) {
      $('#app').innerHTML = `<div class="notice bad">${esc(err.message)}. Ask your dispatcher for a new link.</div>`;
      $('.bottombar').style.display = 'none';
    }
  }

  init();
})();
