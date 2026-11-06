// Dispatcher dashboard: fleet overview, driver assignment, inspection start, TMS sync, Telegram linking.
(function () {
  const $ = (sel) => document.querySelector(sel);
  let trucks = [];
  let drivers = [];

  function renderStats() {
    const counts = { ready: 0, needs_attention: 0, out_of_service: 0, unknown: 0 };
    trucks.forEach((t) => { counts[counts[t.readiness] !== undefined ? t.readiness : 'unknown'] += 1; });
    const tiles = [
      ['ready', 'Ready', 'var(--green)'],
      ['needs_attention', 'Needs attention', 'var(--amber)'],
      ['out_of_service', 'Out of service', 'var(--red)'],
      ['unknown', 'Not inspected', 'var(--gray)'],
    ];
    $('#stats').innerHTML = tiles.map(([key, label, color]) => `
      <div class="card stat">
        <div class="stat-value">${counts[key]}</div>
        <div class="stat-label"><span class="dot" style="background:${color}"></span>${label}</div>
      </div>`).join('');
  }

  function driverOptions(selectedId) {
    return ['<option value="">Unassigned</option>']
      .concat(drivers.map((d) => `<option value="${d.id}" ${Number(selectedId) === d.id ? 'selected' : ''}>${esc(d.name)}</option>`))
      .join('');
  }

  function renderTrucks() {
    $('#fleetCount').textContent = `${trucks.length} trucks`;
    if (!trucks.length) {
      $('#trucks').innerHTML = '<div class="card"><p class="muted">No trucks yet. Sync from your TMS or add trucks.</p></div>';
      return;
    }
    $('#trucks').innerHTML = trucks.map((t) => {
      const spec = [t.make, t.model, t.year].filter(Boolean).join(' ');
      const hasOpen = Boolean(t.open_inspection_id);
      const viewBtn = t.last_inspection_id
        ? `<a class="btn btn-ghost btn-sm" href="/viewer.html?id=${t.last_inspection_id}">360° view</a>`
        : '';
      return `
        <article class="card truck" data-truck="${t.id}">
          <div class="truck-head">
            <div>
              <div class="unit">Unit ${esc(t.unit)}</div>
              <div class="truck-meta">${esc(spec) || '&nbsp;'}${t.plate ? ` · ${esc(t.plate)}` : ''}</div>
            </div>
            ${pill(t.readiness)}
          </div>
          <label class="field">
            <span>Driver</span>
            <select data-assign="${t.id}" aria-label="Assign driver to unit ${esc(t.unit)}">${driverOptions(t.driver_id)}</select>
          </label>
          <div class="muted small">Last inspection: ${esc(fmtDate(t.last_inspection_at))}</div>
          <div class="actions">
            <button class="btn btn-sm" type="button" data-inspect="${t.id}">${hasOpen ? 'Continue inspection' : 'Start inspection'}</button>
            ${viewBtn}
          </div>
        </article>`;
    }).join('');
  }

  function renderDrivers() {
    $('#drivers').innerHTML = drivers.length
      ? drivers.map((d) => `
        <li>
          <div>
            <div style="font-weight:600">${esc(d.name)}</div>
            <div class="muted small">${esc(d.phone || 'No phone')} · ${d.telegram_linked ? 'Telegram linked' : 'Telegram not linked'}</div>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-code="${d.id}" data-name="${esc(d.name)}">Link code</button>
        </li>`).join('')
      : '<li class="muted">No drivers yet.</li>';
  }

  async function load() {
    try {
      [trucks, drivers] = await Promise.all([api('/api/trucks'), api('/api/drivers')]);
      renderStats();
      renderTrucks();
      renderDrivers();
    } catch (e) {
      toast(e.message, true);
    }
  }

  // ----- Events (delegated) -----
  $('#trucks').addEventListener('change', async (e) => {
    const sel = e.target.closest('[data-assign]');
    if (!sel) return;
    const driverId = sel.value ? Number(sel.value) : null;
    try {
      await api(`/api/trucks/${sel.dataset.assign}/assign`, { method: 'POST', body: { driverId } });
      toast(driverId ? 'Driver assigned' : 'Driver removed');
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#trucks').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-inspect]');
    if (!btn) return;
    btn.disabled = true;
    try {
      const r = await api(`/api/trucks/${btn.dataset.inspect}/inspections`, { method: 'POST', body: {} });
      location.href = r.url;
    } catch (err) {
      btn.disabled = false;
      toast(err.message, true);
    }
  });

  $('#drivers').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-code]');
    if (!btn) return;
    try {
      const { code } = await api(`/api/drivers/${btn.dataset.code}/link-code`, { method: 'POST' });
      $('#linkResult').innerHTML = `
        <div class="notice good">
          <strong>${esc(btn.dataset.name)}</strong> — code <strong style="font-size:20px;letter-spacing:.1em">${esc(code)}</strong>
          <div class="small" style="margin-top:6px">Driver sends: <code>/link ${esc(code)}</code> to the bot.</div>
        </div>`;
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#driverForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      await api('/api/drivers', { method: 'POST', body: data });
      form.reset();
      toast('Driver added');
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#syncBtn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api('/api/tms/sync', { method: 'POST' });
      toast(`Synced ${r.trucks} trucks and ${r.drivers} drivers`);
      await load();
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  load();
})();
