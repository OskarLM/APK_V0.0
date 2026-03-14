/* ==========================
   PIN V0.1 (hasheado + intentos + cooldown)
   Requiere utils.js (sha256, getAttempts, setAttempts, isInCooldown, setCooldown)
========================== */

// Estado interno del PIN
let pinActual = "";

// Compatibilidad con utils.js (nombres de claves)
const KEY_PIN = (typeof PIN_STORAGE_KEY !== 'undefined') ? PIN_STORAGE_KEY : (typeof PIN_STORAGE_KEY !== 'undefined') ? PIN_STORAGE_KEY : 'pinHash_v1';

// Helpers con *fallback* (por si faltaran en utils.js)
const _getAttempts  = (typeof getAttempts  === 'function') ? getAttempts  : () => parseInt(localStorage.getItem('pinAttempts_v1') || '0', 10);
const _setAttempts  = (typeof setAttempts  === 'function') ? setAttempts  : (n) => localStorage.setItem('pinAttempts_v1', String(n));
const _isInCooldown = (typeof isInCooldown === 'function') ? isInCooldown : (() => {
  const v = parseInt(localStorage.getItem('pinCooldownUntil_v1') || '0', 10);
  return Date.now() < v ? (v - Date.now()) : 0;
});
const _setCooldown  = (typeof setCooldown  === 'function') ? setCooldown  : ((sec) => {
  const until = Date.now() + sec * 1000;
  localStorage.setItem('pinCooldownUntil_v1', String(until));
});

// Crea hash por defecto (7143) si no existe
async function ensureDefaultPinHash() {
  try {
    if (!localStorage.getItem(KEY_PIN)) {
      const h = await sha256("7143");
      localStorage.setItem(KEY_PIN, h);
    }
  } catch (e) {
    console.error("[PIN] ensureDefaultPinHash error:", e);
  }
}

// Puntitos del overlay
function updateDots() {
  document.querySelectorAll('.pin-dots .dot').forEach((d, i) => {
    d.classList.toggle('filled', i < pinActual.length);
  });
}
function clearPin() { pinActual = ""; updateDots(); }

// Desbloquear app
function unlock() {
  const overlay = document.getElementById("authOverlay");
  if (overlay) overlay.style.display = "none";
  const m = document.getElementById("movimientos");
  if (m) { m.classList.remove("hidden"); m.dataset.permiso = "OK"; }
  if (typeof init === 'function') { try { init(); } catch(e){ console.error("init() error:", e); } }
}

// Verificar PIN con hash + control de intentos
async function verifyAndUnlock(pinPlain) {
  const remainMs = _isInCooldown();
  if (remainMs > 0) {
    const s = Math.ceil(remainMs / 1000);
    alert(`Has superado el número de intentos. Espera ${s} s e inténtalo de nuevo.`);
    return;
  }
  await ensureDefaultPinHash();
  const savedHash = localStorage.getItem(KEY_PIN);
  const givenHash = await sha256(pinPlain);
  if (givenHash === savedHash) {
    _setAttempts(0);
    if (typeof PIN_COOLDOWN_KEY !== 'undefined') localStorage.removeItem(PIN_COOLDOWN_KEY);
    unlock();
  } else {
    const prev = _getAttempts() + 1;
    _setAttempts(prev);
    if (prev >= 5) {
      _setCooldown(60);
      _setAttempts(0);
      alert("Demasiados intentos fallidos. Bloqueo temporal de 60 segundos.");
    } else {
      alert("PIN incorrecto");
    }
  }
}

// Pulsación de tecla PIN (usada por onclick del HTML)
async function pressPin(n) {
  const remain = _isInCooldown();
  if (remain > 0) {
    const s = Math.ceil(remain / 1000);
    alert(`Bloqueado temporalmente. Espera ${s} s.`);
    return;
  }
  if (pinActual.length < 4) {
    pinActual += String(n);
    updateDots();
    if (pinActual.length === 4) {
      const candidate = pinActual;
      clearPin();
      await ensureDefaultPinHash();
      verifyAndUnlock(candidate);
    }
  }
}

// Biometría (stub seguro)
async function biometricAuth() {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) {
      alert("Biometría no disponible (requiere HTTPS y dispositivo compatible).");
      return;
    }
    alert("Biometría no implementada aún.");
  } catch (e) {
    console.error(e);
    alert("Error de biometría");
  }
}

// Exponer para los onclick inline del HTML
window.pressPin = pressPin;
window.clearPin = clearPin;
window.biometricAuth = biometricAuth;

// Preparación al cargar
document.addEventListener('DOMContentLoaded', () => {
  ensureDefaultPinHash().catch(console.error);
  updateDots();
});


/* ==========================
   Núcleo de datos + render (lista)
========================== */

let movimientos = JSON.parse(localStorage.getItem('movimientos') || '[]');
let registrosVisibles = 25;

const mesesLabel = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const origenBase = ["Ingreso","Gasto","Nómina"];

const _esc = (typeof esc === 'function')
  ? esc
  : (s)=> String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Inicialización básica de filtros y datos
function init(){
  const hoy = new Date();

  // Mes
  const fM = document.getElementById("filtroMes");
  if (fM) {
    fM.innerHTML = '<option value="TODOS">Mes: TODOS</option>';
    mesesLabel.forEach((m, i) => fM.add(new Option(m, i)));
    fM.value = hoy.getMonth();
  }

  // Año
  const fA = document.getElementById("filtroAño");
  if (fA) {
    fA.innerHTML = '<option value="TODOS">Año: TODOS</option>';
    for (let a = 2020; a <= 2030; a++) fA.add(new Option(a, a));
    fA.value = hoy.getFullYear();
  }

  actualizarListas();
  mostrar();
}

// Rellena selects de filtros a partir de datos
function actualizarListas(){
  const fC = document.getElementById("filtroCat");
  const fS = document.getElementById("filtroSub");
  const fO = document.getElementById("filtroOri");

  const setSel = (sel, arr, titulo) => {
    if (!sel) return;
    sel.innerHTML = `<option value="${titulo === 'Ori' ? 'TODOS':'TODAS'}">${titulo}: ${titulo==='Ori'?'TODOS':'TODAS'}</option>`;
    [...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'))
      .forEach(v => sel.add(new Option(v, v)));
  };

  const cats = movimientos.map(m=>m.c||'');
  const subs = movimientos.map(m=>m.s||'');
  setSel(fC, cats, 'Cat');
  setSel(fS, subs, 'Sub');

  if (fO) {
    fO.innerHTML = '<option value="TODOS">Ori: TODOS</option>';
    origenBase.forEach(o=>fO.add(new Option(o,o)));
  }
}

// Pinta la lista según filtros
function mostrar(){
  const cont = document.getElementById("lista");
  const movDiv = document.getElementById("movimientos");
  if (!cont || !movDiv || movDiv.dataset.permiso !== "OK") return;

  const fMes = document.getElementById("filtroMes")?.value ?? "TODOS";
  const fAño = document.getElementById("filtroAño")?.value ?? "TODOS";
  const fCat = document.getElementById("filtroCat")?.value ?? "TODAS";
  const fSub = document.getElementById("filtroSub")?.value ?? "TODAS";
  const fOri = document.getElementById("filtroOri")?.value ?? "TODOS";

  let total = 0;
  const filtrados = movimientos
    .filter(m=>{
      const [y,mm] = (m.f||'').split('-');
      const okMes = fMes === "TODOS" || String(parseInt(mm,10)-1) === fMes;
      const okAño = fAño === "TODOS" || y === fAño;
      const okCat = fCat === "TODAS" || m.c === fCat;
      const okSub = fSub === "TODAS" || m.s === fSub;
      const okOri = fOri === "TODOS" || m.o === fOri;
      return okMes && okAño && okCat && okSub && okOri;
    })
    .sort((a,b)=> new Date(b.f) - new Date(a.f));

  filtrados.forEach(m=> total += Number(m.imp)||0);

  // Balance
  const bD = document.getElementById("balance");
  if (bD){
    bD.innerText = total.toFixed(2) + " €";
    if (total < 0) bD.style.color = "var(--danger)";
    else if (total <= 750) bD.style.color = "var(--warning)";
    else if (total <= 1400) bD.style.color = "var(--success)";
    else bD.style.color = "var(--electric-blue)";
  }

  cont.innerHTML = filtrados
    .slice(0, registrosVisibles)
    .map(m => `
      <div class='card' onclick="abrirFormulario('${_esc(m.id)}')" style="border-left-color:${m.imp >= 0 ? 'var(--success)' : 'var(--danger)'}">
        <div class="meta">${_esc((m.f||'').split("-").reverse().join("/"))} • ${_esc(m.o||'')}</div>
        <b>${_esc(m.c||'')} - ${_esc(m.s||'')}</b>
        ${m.d ? `<div style="font-size:12px;opacity:.8">${_esc(m.d)}</div>` : ''}
        <div class="monto" style="color:${m.imp >= 0 ? 'var(--success)' : 'var(--danger)'}">${(Number(m.imp)||0).toFixed(2)} €</div>
      </div>
    `).join("");
}

/* ==========================
   CRUD / UI mínimas
========================== */

function abrirFormulario(id=null){
  const f = document.getElementById("form");
  const m = document.getElementById("movimientos");
  if (!f || !m) return;
  m.classList.add("hidden");
  f.classList.remove("hidden");

  if (id){
    const mov = movimientos.find(x => String(x.id) === String(id));
    if (mov){
      document.getElementById("editId").value = mov.id;
      document.getElementById("fecha").value = mov.f || new Date().toISOString().split("T")[0];
      document.getElementById("origen").value = mov.o || "";
      document.getElementById("categoria").value = mov.c || "";
      document.getElementById("subcategoria").value = mov.s || "";
      document.getElementById("importe").value = Math.abs(Number(mov.imp)||0);
      document.getElementById("descripcion").value = mov.d || "";
    }
  } else {
    document.getElementById("editId").value = "";
    document.getElementById("fecha").value = new Date().toISOString().split("T")[0];
    document.getElementById("origen").value = origenBase[1]; // "Gasto"
    document.getElementById("categoria").value = "";
    document.getElementById("subcategoria").value = "";
    document.getElementById("importe").value = "";
    document.getElementById("descripcion").value = "";
  }
}

function volver(){
  const f = document.getElementById("form");
  const m = document.getElementById("movimientos");
  if (!f || !m) return;
  f.classList.add("hidden");
  m.classList.remove("hidden");
  actualizarListas();
  mostrar();
}

function eliminarRegistroActual(){
  const idAEliminar = document.getElementById("editId").value;
  if (!idAEliminar) return;
  if (confirm("¿ESTÁS SEGURO DE QUE DESEAS ELIMINAR ESTE REGISTRO?")) {
    movimientos = movimientos.filter(x => String(x.id) !== String(idAEliminar));
    localStorage.setItem('movimientos', JSON.stringify(movimientos));
    volver();
  }
}

function resetPagina(){ registrosVisibles = 25; window.scrollTo(0,0); }
function ejecutarBackupRotativo(){ /* opcional */ }
function resetTotal(){ if (confirm("¿BORRAR TODO?")) { localStorage.clear(); location.reload(); } }

// Stubs para compatibilidad con tu HTML (no rompen si se usan)
function abrirGraficos(){ /* aún no implementado en este núcleo; se mantiene lista */ }
function manejarNuevo(el,tipo){ if (el && el.value === '+') { const n = prompt(`Nueva ${tipo}:`); if (n) el.value = n.trim(); else el.value = ""; } }
function borrarElemento(tipo){ const sel = document.getElementById(tipo); if (sel) sel.value = ""; }

/* ==========================
   EXPORT / IMPORT CSV
========================== */

function exportarCSV(){
  if (!movimientos || !movimientos.length) {
    alert("No hay datos para exportar.");
    return;
  }
  const SEP = ";";
  const toESDate = (iso) => {
    const [y,m,d] = (iso||"").split("-");
    return (y && m && d) ? `${d}/${m}/${y}` : (iso||"");
  };
  const toEuro = (n) => {
    const val = (typeof n === "number" ? n : parseFloat(n || 0));
    const s = Number.isFinite(val) ? val.toString() : "0";
    return s.includes(".") ? s.replace(".", ",") : s;
  };
  const csvCell = (v) => {
    let t = (v ?? "").toString().replace(/\r?\n/g, "⏎");
    if (/[;"\n]/.test(t)) t = '"' + t.replace(/"/g,'""') + '"';
    return t;
  };
  const headers = ["Fecha","Origen","Categoria","Subcategoria","Importe","Descripcion"].join(SEP);
  const rows = movimientos.map(m =>
    [toESDate(m.f), m.o||"", m.c||"", m.s||"", (Number(m.imp)||0), (m.d??"").trim()]
      .map(csvCell).join(SEP)
  );
  const csv = [headers, ...rows].join("\n");
  const hoy = new Date();
  const dd = String(hoy.getDate()).padStart(2,"0");
  const mm = String(hoy.getMonth()+1).padStart(2,"0");
  const yyyy = hoy.getFullYear();
  const fileName = `mis_gastos_${dd}${mm}${yyyy}.csv`;

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importarCSV(e){
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "").replace(/^\uFEFF/,"");
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      if (!lines.length) { alert("El archivo está vacío."); return; }

      // Detectar delimitador
      const header = lines[0];
      const counts = {
        tab:(header.match(/\t/g)||[]).length,
        semi:(header.match(/;/g)||[]).length,
        comma:(header.match(/,/g)||[]).length
      };
      let delim = "\t";
      if (counts.tab >= counts.semi && counts.tab >= counts.comma) delim = "\t";
      else if (counts.semi >= counts.comma) delim = ";";
      else delim = ",";

      // Parser con comillas
      const parseLine = (line) => {
        const out = []; let cur = "", inQ = false;
        for (let i=0;i<line.length;i++){
          const ch = line[i];
          if (ch === '"'){
            if (inQ && line[i+1] === '"'){ cur += '"'; i++; }
            else inQ = !inQ;
          } else if (ch === delim && !inQ) { out.push(cur); cur = ""; }
          else { cur += ch; }
        }
        out.push(cur);
        return out;
      };

      // Índices columnas
      const cols = parseLine(header).map(h=>h.trim().toLowerCase());
      const idx = {
        fecha: cols.findIndex(c => c.startsWith("fecha")),
        origen: cols.findIndex(c => c.startsWith("origen")),
        categoria: cols.findIndex(c => c.startsWith("categoria")),
        subcategoria: cols.findIndex(c => c.startsWith("subcategoria")),
        importe: cols.findIndex(c => c.startsWith("importe")),
        descripcion: cols.findIndex(c => c.startsWith("descripcion") || c.startsWith("descripción"))
      };
      const required = ["fecha","origen","categoria","subcategoria","importe"];
      const missing = required.filter(k => idx[k] < 0);
      if (missing.length) { alert("Faltan columnas: " + missing.join(", ")); return; }

      // Utils parse
      const toISODate = (ddmmyyyy) => {
        const m = ddmmyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return ddmmyyyy;
        return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
      };
      const parseEuroNumber = (s) => {
        let t = (s || '').toString().trim();
        t = t.replace(/\.(?=\d{3}(?:\D|$))/g, ''); // miles
        t = t.replace(',', '.'); // decimal
        const n = parseFloat(t);
        return isNaN(n) ? 0 : n;
      };
      const clean = (s) => {
        if (!s) return "";
        let t = s.replace(/\\"{2,}/g, '"').trim();
        if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1,-1);
        return t.trim();
      };

      const nuevos = [];
      for (let i=1; i<lines.length; i++){
        const arr = parseLine(lines[i]);
        if (arr.every(v => (v||'').trim() === '')) continue;

        const f = toISODate(clean(arr[idx.fecha] ?? ''));
        let  o = clean(arr[idx.origen] ?? '');
        let  c = clean(arr[idx.categoria] ?? '');
        let  s = clean(arr[idx.subcategoria] ?? '');
        let  d = clean(idx.descripcion >= 0 ? (arr[idx.descripcion] ?? '') : '');

        // Normaliza origen y signo
        const oLow = o.toLowerCase();
        if (oLow.startsWith('nom')) o = 'Nómina';
        else if (oLow.startsWith('gas')) o = 'Gasto';
        else if (oLow.startsWith('ing')) o = 'Ingreso';

        let imp = parseEuroNumber(arr[idx.importe] ?? 0);
        if (o === 'Gasto' && imp > 0) imp = -Math.abs(imp);
        if (o !== 'Gasto' && imp < 0) imp = Math.abs(imp);

        if (!f || !o || !c || !s || isNaN(imp)) continue;
        nuevos.push({ id:`id_${Date.now()}_${i}`, f, o, c, s, imp, d, ts: Date.now()+i });
      }

      movimientos = [...movimientos, ...nuevos]
        .sort((a,b)=> new Date(b.f) - new Date(a.f));
      localStorage.setItem('movimientos', JSON.stringify(movimientos));
      actualizarListas();
      resetPagina();
      mostrar();

      alert(`Importación completa: ${nuevos.length} registros añadidos.`);
    } catch (err) {
      console.error(err);
      alert("Error al importar el CSV. Revisa el formato.");
    } finally {
      e.target.value = "";
    }
  };
  reader.onerror = () => alert("No se pudo leer el archivo.");
  reader.readAsText(file, 'UTF-8');
}

/* Exponer funciones al global para los handlers del HTML */
window.init = init;
window.mostrar = mostrar;
window.actualizarListas = actualizarListas;
window.importarCSV = importarCSV;
window.exportarCSV = exportarCSV;
window.volver = volver;
window.abrirFormulario = abrirFormulario;
window.eliminarRegistroActual = eliminarRegistroActual;
window.resetPagina = resetPagina;
window.resetTotal = resetTotal;
window.abrirGraficos = abrirGraficos;
window.manejarNuevo = manejarNuevo;
window.borrarElemento = borrarElemento;


/* ==========================
   GUARDAR (corregido)
========================== */

// Corrección clave: construir v con sus claves (antes faltaba y rompía el script)
const guardar = () => {
  const ids = ["editId","origen","categoria","subcategoria","fecha","descripcion","importe"];
  const v = Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.value]));
  const imp = parseFloat(v.importe);
  if (!v.origen || !v.categoria || !v.subcategoria || isNaN(imp)) {
    alert("Faltan datos");
    return;
  }
  const m = {
    id : v.editId || `id_${Date.now()}`,
    f  : v.fecha,
    o  : v.origen,
    c  : v.categoria,
    s  : v.subcategoria,
    imp: v.origen === "Gasto" ? -Math.abs(imp) : Math.abs(imp),
    d  : v.descripcion,
    ts : Date.now()
  };
  if (v.editId) {
    const idx = movimientos.findIndex(x => x.id.toString() === v.editId.toString());
    if (idx !== -1) movimientos[idx] = m;
  } else {
    movimientos.push(m);
    if (movimientos.length % 15 === 0) ejecutarBackupRotativo();
  }
  localStorage.setItem('movimientos', JSON.stringify(movimientos));
  volver();
};
window.guardar = guardar; // por si lo llamas desde onclick

/* ==========================
   Autoinit si ya estás desbloqueado
========================== */
document.addEventListener('DOMContentLoaded', ()=>{
  const m = document.getElementById("movimientos");
  if (m && m.dataset.permiso === "OK") {
    try { init(); } catch(e){ console.error(e); }
  }
});
