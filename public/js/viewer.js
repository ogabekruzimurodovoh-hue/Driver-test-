// 360° viewer. Exterior: the four side photos form a loop (front -> right -> rear -> left);
// dragging blends between neighbouring angles, so the truck appears to turn.
// Interior: swipeable gallery of cab/sleeper photos.
(function () {
  const id = new URLSearchParams(location.search).get('id');
  const $ = (sel) => document.querySelector(sel);

  const EXTERIOR = [
    { slot: 'front', label: 'Front' },
    { slot: 'right', label: 'Right side' },
    { slot: 'rear', label: 'Rear' },
    { slot: 'left', label: 'Left side' },
  ];
  const INTERIOR = [
    { slot: 'interior_dash', label: 'Dashboard' },
    { slot: 'interior_cab', label: 'Driver seat' },
    { slot: 'interior_sleeper', label: 'Sleeper' },
  ];

  const ext = { frames: [], imgs: [], dots: [], pos: 0, drag: null, raf: 0, last: 0, spinning: false };
  const int = { frames: [], index: 0, drag: null };

  // ---------- Exterior ----------
  function buildExterior(data) {
    const stage = $('#exteriorStage');
    ext.frames = EXTERIOR.filter((f) => data.photos[f.slot]);
    stage.innerHTML = '';
    ext.imgs = ext.frames.map((f) => {
      const img = new Image();
      img.alt = `${f.label} of truck`;
      img.draggable = false;
      img.src = photoUrl(id, f.slot);
      stage.appendChild(img);
      return img;
    });
    const label = document.createElement('div');
    label.className = 'angle-label';
    label.id = 'angleLabel';
    stage.appendChild(label);
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = ext.frames.length > 1 ? 'Drag to rotate' : 'Add side photos to enable the 360° view';
    stage.appendChild(hint);
    if (!ext.frames.length) {
      stage.insertAdjacentHTML('afterbegin', '<div class="empty">No exterior photos yet</div>');
    }

    const dots = $('#dots');
    dots.innerHTML = ext.frames.map((f, i) => `<button type="button" data-i="${i}" aria-label="${f.label}"></button>`).join('');
    ext.dots = [...dots.querySelectorAll('button')];

    paint();
  }

  function paint() {
    const n = ext.imgs.length;
    if (!n) return;
    const base = Math.floor(ext.pos);
    const f = ext.pos - base;
    const i = ((base % n) + n) % n;
    const j = (i + 1) % n;
    ext.imgs.forEach((img, k) => {
      img.classList.toggle('on', false);
      img.style.opacity = k === i ? String(1 - f) : k === j ? String(f) : '0';
    });
    const near = f < 0.5 ? i : j;
    if (n === 1) ext.imgs[0].style.opacity = '1';
    const label = $('#angleLabel');
    if (label) label.textContent = ext.frames[near].label;
    ext.dots.forEach((d, k) => d.classList.toggle('on', k === near));
  }

  function snap() {
    ext.pos = Math.round(ext.pos);
    paint();
  }

  function spinLoop(t) {
    if (!ext.spinning) return;
    if (ext.last) ext.pos += (t - ext.last) / 1100;
    ext.last = t;
    paint();
    ext.raf = requestAnimationFrame(spinLoop);
  }

  function setSpinning(on) {
    ext.spinning = on;
    $('#spinBtn').setAttribute('aria-pressed', String(on));
    $('#spinBtn').textContent = on ? 'Pause' : 'Auto-rotate';
    cancelAnimationFrame(ext.raf);
    ext.last = 0;
    if (on) ext.raf = requestAnimationFrame(spinLoop);
  }

  const stage = $('#exteriorStage');
  stage.addEventListener('pointerdown', (e) => {
    if (ext.imgs.length < 2) return;
    setSpinning(false);
    ext.drag = { x: e.clientX, pos: ext.pos };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!ext.drag) return;
    const dx = e.clientX - ext.drag.x;
    // One full side ≈ 60% of the stage width.
    ext.pos = ext.drag.pos - dx / (stage.clientWidth * 0.6);
    paint();
  });
  const endDrag = () => {
    if (!ext.drag) return;
    ext.drag = null;
    snap();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('keydown', (e) => {
    if (ext.imgs.length < 2) return;
    if (e.key === 'ArrowRight') { ext.pos = Math.round(ext.pos) + 1; paint(); }
    if (e.key === 'ArrowLeft') { ext.pos = Math.round(ext.pos) - 1; paint(); }
  });

  $('#dots').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    setSpinning(false);
    ext.pos = Number(b.dataset.i);
    paint();
  });
  $('#spinBtn').addEventListener('click', () => setSpinning(!ext.spinning));

  // ---------- Interior ----------
  function buildInterior(data) {
    int.frames = INTERIOR.filter((f) => data.photos[f.slot]);
    renderInterior();
  }

  function renderInterior() {
    const stage = $('#interiorStage');
    const thumbs = $('#intThumbs');
    if (!int.frames.length) {
      stage.innerHTML = '<div class="empty">No interior photos yet</div>';
      $('#intLabel').textContent = '';
      thumbs.innerHTML = '';
      return;
    }
    int.index = ((int.index % int.frames.length) + int.frames.length) % int.frames.length;
    const f = int.frames[int.index];
    stage.innerHTML = `<img class="on" alt="${esc(f.label)}" draggable="false" src="${esc(photoUrl(id, f.slot))}">
      <div class="angle-label">${esc(f.label)}</div>`;
    $('#intLabel').textContent = `${int.index + 1} / ${int.frames.length}`;
    thumbs.innerHTML = int.frames.map((fr, i) =>
      `<button type="button" data-i="${i}" class="${i === int.index ? 'on' : ''}" aria-label="${esc(fr.label)}">
        <img alt="" src="${esc(photoUrl(id, fr.slot))}"></button>`).join('');
  }

  function moveInterior(step) {
    int.index += step;
    renderInterior();
  }

  $('#prevInt').addEventListener('click', () => moveInterior(-1));
  $('#nextInt').addEventListener('click', () => moveInterior(1));
  $('#intThumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    int.index = Number(b.dataset.i);
    renderInterior();
  });

  const istage = $('#interiorStage');
  istage.addEventListener('pointerdown', (e) => { int.drag = e.clientX; });
  istage.addEventListener('pointerup', (e) => {
    if (int.drag === null) return;
    const dx = e.clientX - int.drag;
    int.drag = null;
    if (dx < -40) moveInterior(1);
    else if (dx > 40) moveInterior(-1);
  });
  istage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') moveInterior(1);
    if (e.key === 'ArrowLeft') moveInterior(-1);
  });

  // ---------- Tabs ----------
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      const name = tab.dataset.tab;
      $('#exterior').classList.toggle('hidden', name !== 'exterior');
      $('#interior').classList.toggle('hidden', name !== 'interior');
      if (name !== 'exterior') setSpinning(false);
    });
  });

  // ---------- Info ----------
  function renderInfo(d) {
    const t = d.truck;
    const failed = d.evaluation.failed;
    const failedHtml = failed.length
      ? `<ul class="list">${failed.map((f) => `<li><span>${esc(f.label)}</span>${f.critical ? '<span class="pill out_of_service">Critical</span>' : '<span class="pill needs_attention">Failed</span>'}</li>`).join('')}</ul>`
      : '<p class="muted" style="margin-top:12px">No failed items.</p>';
    const tms = d.tmsRef
      ? `<span class="pill ready">Synced · ${esc(d.tmsRef)}</span>`
      : d.tmsError
        ? `<span class="pill out_of_service" title="${esc(d.tmsError)}">Sync failed</span>`
        : '<span class="pill unknown">Not sent to TMS</span>';

    $('#title').textContent = `Unit ${t.unit}`;
    $('#status').innerHTML = pill(d.status);
    $('#info').innerHTML = `
      <h2>${esc([t.make, t.model, t.year].filter(Boolean).join(' ') || 'Truck')}</h2>
      <dl class="kv">
        <dt>Plate</dt><dd>${esc(t.plate || '—')}</dd>
        <dt>Driver</dt><dd>${d.driver ? esc(d.driver.name) : 'Not assigned'}</dd>
        <dt>Odometer</dt><dd>${esc(d.odometer ?? '—')}</dd>
        <dt>Completed</dt><dd>${esc(fmtDate(d.completedAt))}</dd>
        <dt>TMS</dt><dd>${tms}</dd>
      </dl>
      <h3 style="margin-top:24px">Failed items</h3>
      ${failedHtml}
      ${d.notes ? `<h3 style="margin-top:24px">Driver notes</h3><p style="margin-top:8px">${esc(d.notes)}</p>` : ''}`;
  }

  async function init() {
    if (!id) {
      $('#info').innerHTML = '<p>Missing inspection id.</p>';
      return;
    }
    try {
      const d = await api(`/api/inspections/${id}`);
      buildExterior(d);
      buildInterior(d);
      renderInfo(d);
    } catch (e) {
      $('#info').innerHTML = `<div class="notice bad">${esc(e.message)}</div>`;
    }
  }

  init();
})();
