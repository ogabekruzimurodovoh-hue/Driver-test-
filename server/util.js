import crypto from 'node:crypto';

/** Constant-time string comparison (safe for passwords and tokens). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function httpError(status, message, extra) {
  return Object.assign(new Error(message), { status, extra });
}
