// Shared helpers for all pages.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const TOKEN = new URLSearchParams(location.search).get('t') || '';

const STATUS_LABEL = {
  ready: 'Ready',
  needs_attention: 'Needs attention',
  out_of_service: 'Out of service',
  in_progress: 'In progress',
  unknown: 'Not inspected',
};

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers['X-Inspection-Token'] = TOKEN;
  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function photoUrl(inspectionId, slot, version = 0) {
  const params = new URLSearchParams();
  if (TOKEN) params.set('t', TOKEN);
  if (version) params.set('v', String(version));
  const qs = params.toString();
  return `/api/inspections/${inspectionId}/photos/${slot}${qs ? `?${qs}` : ''}`;
}

/** Resize and compress a camera photo to JPEG before upload (keeps uploads fast on mobile). */
async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}

let toastTimer;
function toast(message, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value.replace(' ', 'T') + (value.includes('T') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function pill(status) {
  const key = STATUS_LABEL[status] ? status : 'unknown';
  return `<span class="pill ${key}">${esc(STATUS_LABEL[key])}</span>`;
}
