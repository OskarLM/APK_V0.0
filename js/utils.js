// === utils.js v2 ===
// Nota: sha256, esc, lsGet/lsSet los gestiona main.js internamente.
// Este archivo existe por compatibilidad y expone versiones globales
// por si algún componente externo las necesita.

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function esc(s) {
  return (s??'').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
