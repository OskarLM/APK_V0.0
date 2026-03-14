// === utils.js ===

// Hash SHA-256 (Web Crypto)
async function sha256(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Escapar HTML seguro
function esc(s) {
  return String(s).replace(/[&<>\"']/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]
  ));
}

// Intentos / cooldown (storage keys)
const PIN_STORAGE_KEY = 'pinHash_v1';
const PIN_ATTEMPTS_KEY = 'pinAttempts_v1';
const PIN_COOLDOWN_KEY = 'pinCooldownUntil_v1';

function getAttempts() {
  return parseInt(localStorage.getItem(PIN_ATTEMPTS_KEY) || '0', 10);
}
function setAttempts(n) {
  localStorage.setItem(PIN_ATTEMPTS_KEY, String(n));
}
function getCooldownUntil() {
  const v = parseInt(localStorage.getItem(PIN_COOLDOWN_KEY) || '0', 10);
  return isNaN(v) ? 0 : v;
}
function setCooldown(seconds) {
  const until = Date.now() + seconds * 1000;
  localStorage.setItem(PIN_COOLDOWN_KEY, String(until));
}
function isInCooldown() {
  const until = getCooldownUntil();
  const now = Date.now();
  return now < until ? (until - now) : 0;
}
