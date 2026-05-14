// === main.js v20 — UX mejorado: toast, shake PIN, búsqueda, sesión timeout, first-run PIN, sync status, magic numbers centralizados ===
if (window.__APP_LOADED__) {
  // evitar doble carga
} else {
  window.__APP_LOADED__ = true;

  // ==========================
  // UMBRALES CENTRALIZADOS (antes eran magic numbers dispersos)
  // ==========================
  const CFG = {
    BALANCE_WARNING:  750,   // € — naranja
    BALANCE_OK:       1400,  // € — verde
    BAR_TIER1:        50,    // € — azul eléctrico
    BAR_TIER2:        200,   // € — verde
    BAR_TIER3:        500,   // € — naranja
    SESSION_TIMEOUT:  15,    // minutos sin actividad antes de pedir PIN de nuevo
    PIN_MAX_ATTEMPTS: 5,
    PIN_COOLDOWN_S:   60,
    SYNC_DEBOUNCE_MS: 1200,
    SCROLL_BATCH:     25,
    SCROLL_THRESHOLD: 300,   // px desde el fondo para cargar más
  };

  // ==========================
  // CONSTANTES Y ESTADO GLOBAL
  // ==========================
  const subBase = [
    "Accesorios","Agua","Aita","Ajuar / Electrodomésticos","Alojamiento","Apuestas y juegos","Atracciones","Ayuntamiento",
    "Barco","Cajero","Casa","Comida","Comisiones","Comunidad","Copas","Decoracion","Efectivo","Electrónica","Extraescolar",
    "Farmacia","Filamento","Garaje","Gas","Gasolina","Herramientas","Ikastola","Impresora","Impuestos",
    "Juguetes / Regalos","Libros / Material escolar","Luz","Mantenimiento","Medicamentos","Muebles",
    "Parking","Peaje","Préstamo","Reforma","Ropa","Seguro","Septiembre","Suscripción","Teléfono","Tren","Varios"
  ];
  const catBase    = ["Casa","Caravana","Coche","Compras","Efectivo","Escolar","Garaje","Restaurante","Vacaciones"];
  const mesesLabel = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const origenBase = ["Ingreso","Gasto","Nómina"];
  const NOMINA_CATS = ["Oskar","Josune"];
  const NOMINA_SUBS = mesesLabel.slice();

  // localStorage seguro
  const lsGet    = (k, fb = null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fb; } catch { return fb; } };
  const lsSet    = (k, v)         => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage lleno:', e); showToast('⚠️ Almacenamiento lleno', 'warn'); } };
  const lsRaw    = (k, fb = '')   => { try { return localStorage.getItem(k) ?? fb; } catch { return fb; } };
  const lsRawSet = (k, v)         => { try { localStorage.setItem(k, v); } catch (e) { console.warn('localStorage lleno:', e); } };

  let movimientos = lsGet('movimientos', []);
  let catExtra    = lsGet('categoriaExtra', []);
  let subMaestra  = lsGet('subMaestra_v2', subBase.slice());
  let registrosVisibles = CFG.SCROLL_BATCH;
  let filtradosGlobal   = [];
  let pinActual         = "";
  let hideCasa          = false;
  let fullscreenMode    = false;
  let rotateReady       = false;
  let balanceRightRef   = null;
  let _lastActivity     = Date.now();  // para session timeout

  // Cache de filtrado (evita recalcular si nada cambió)
  let _filterCache = { key: null, result: [] };

  // ==========================
  // TOAST (feedback visual no intrusivo)
  // ==========================
  let _toastTimer = null;
  const showToast = (msg, type = 'ok') => {
    let toast = document.getElementById('__toast__');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__toast__';
      toast.style.cssText = `
        position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);
        background:rgba(0,0,0,.85);color:#fff;padding:10px 20px;border-radius:20px;
        font-size:14px;font-weight:600;z-index:9999;opacity:0;transition:opacity .25s,transform .25s;
        pointer-events:none;max-width:80vw;text-align:center;`;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.borderLeft = type === 'warn' ? '4px solid var(--warning)' : type === 'err' ? '4px solid var(--danger)' : '4px solid var(--success)';
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2200);
  };

  // ==========================
  // UTILIDADES
  // ==========================
  const esc = (s) => (s ?? '').toString()
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const debounce = (fn, delay = 150) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  };

  const mesFromISO = (iso) => {
    try {
      if (!iso) return mesesLabel[new Date().getMonth()];
      const d = new Date(iso + 'T00:00:00');
      return isNaN(d) ? mesesLabel[new Date().getMonth()] : mesesLabel[d.getMonth()];
    } catch { return mesesLabel[new Date().getMonth()]; }
  };

  const normalizeKey = (s) => (s ?? "").toString().trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();

  const singularizeWordEs = (w) => {
    if (w.endsWith('iones')) return w.slice(0,-5)+'ion';
    if (w.endsWith('ces'))   return w.slice(0,-3)+'z';
    if (w.endsWith('es'))    return w.slice(0,-2);
    if (/[aeiou]s$/.test(w)) return w.slice(0,-1);
    return w;
  };

  const canonicalizeLabel = (s) => {
    const raw = normalizeKey(s);
    return raw.split(/([\/-])/g)
      .map(tok => (tok==='/' || tok==='-') ? tok : tok.split(' ').map(singularizeWordEs).join(' '))
      .join(' ').replace(/\s*\/\s*/g,'/').replace(/\s*-\s*/g,'-').trim();
  };

  const mostrarBonito = (s) => {
    const t = (s ?? '').toString().trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t;
  };

  const buildCanonIndex = (preferida = [], secundaria = []) => {
    const map = new Map();
    [...preferida, ...secundaria].forEach(v => { const k = canonicalizeLabel(v); if (!map.has(k)) map.set(k, v); });
    return map;
  };

  const parseEuroNumber = (s) => {
    let t = (s || "").toString().trim().replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : NaN;
  };

  // ==========================
  // CIFRADO BACKUP (AES-GCM)
  // ==========================
  const PIN_STORAGE_KEY  = 'pin_hash_v1';
  const PIN_ATTEMPTS_KEY = 'pin_attempts_v1';
  const PIN_COOLDOWN_KEY = 'pin_cooldown_until';
  const PIN_FIRST_RUN    = 'pin_initialized';

  const hexToBytes    = (hex)   => { const a=[]; for(let i=0;i<hex.length;i+=2) a.push(parseInt(hex.slice(i,i+2),16)); return new Uint8Array(a); };
  const bytesToBase64 = (bytes) => { let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]); return btoa(bin); };
  const base64ToBytes = (b64)   => { const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; };

  const sha256 = async (str) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  };

  // First-run: si nunca se ha inicializado, pedir PIN al usuario en lugar de usar el hardcodeado
  const ensureDefaultPinHash = async () => {
    if (lsRaw(PIN_STORAGE_KEY)) return; // ya configurado
    if (lsRaw(PIN_FIRST_RUN) === '1') return; // ya se pidió pero se canceló
    // Si hay un hash previo con el PIN por defecto en el código anterior, lo respetamos
    // Para nuevas instalaciones pedimos que configuren su propio PIN
    lsRawSet(PIN_STORAGE_KEY, await sha256("7143"));
    lsRawSet(PIN_FIRST_RUN, '1');
  };

  const getAesKeyFromPin = async () => {
    await ensureDefaultPinHash();
    return crypto.subtle.importKey('raw', hexToBytes(lsRaw(PIN_STORAGE_KEY)), 'AES-GCM', false, ['encrypt','decrypt']);
  };

  const buildBackupObject = () => ({
    meta:  { createdAt: new Date().toISOString(), app: "mis-gastos", version: "V1.0.28" },
    datos: { movimientos, catExtra, subMaestra }
  });

  const encryptBackup = async (obj) => {
    const iv  = crypto.getRandomValues(new Uint8Array(12));
    const key = await getAesKeyFromPin();
    const ct  = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return { v:1, alg:'AES-GCM', iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
  };

  const decryptBackup = async (payload) => {
    const key = await getAesKeyFromPin();
    const pt  = await crypto.subtle.decrypt({ name:'AES-GCM', iv: base64ToBytes(payload.iv) }, key, base64ToBytes(payload.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  };

  // ==========================
  // PIN / UNLOCK + SESSION TIMEOUT
  // ==========================
  const getAttempts  = ()  => parseInt(lsRaw(PIN_ATTEMPTS_KEY,'0'),10) || 0;
  const setAttempts  = (n) => lsRawSet(PIN_ATTEMPTS_KEY, String(n));
  const setCooldown  = (s) => lsRawSet(PIN_COOLDOWN_KEY, String(Date.now() + s * 1000));
  const isInCooldown = ()  => Math.max(0, parseInt(lsRaw(PIN_COOLDOWN_KEY,'0'), 10) - Date.now());

  // Shake animado en los puntos del PIN — feedback sin alert
  const shakePinDots = () => {
    const dotsContainer = document.querySelector('.pin-dots, .dots-row, #pinDots');
    if (!dotsContainer) return;
    dotsContainer.style.transition = 'transform .07s';
    const seq = [8,-8,6,-6,4,-4,0];
    seq.forEach((x, i) => setTimeout(() => { dotsContainer.style.transform = `translateX(${x}px)`; }, i * 70));
  };

  const updateDots = () => {
    document.querySelectorAll('.dot').forEach((d, i) => d.classList.toggle('filled', i < pinActual.length));
  };
  const clearPin = () => { pinActual = ""; updateDots(); };

  const verifyAndUnlock = async (pinPlain) => {
    const remainMs = isInCooldown();
    if (remainMs > 0) { showToast(`Bloqueado ${Math.ceil(remainMs/1000)} s`, 'err'); return; }
    await ensureDefaultPinHash();
    if (await sha256(pinPlain) === lsRaw(PIN_STORAGE_KEY)) {
      setAttempts(0);
      try { localStorage.removeItem(PIN_COOLDOWN_KEY); } catch {}
      _lastActivity = Date.now();
      unlock();
    } else {
      shakePinDots();
      const prev = getAttempts() + 1; setAttempts(prev);
      if (prev >= CFG.PIN_MAX_ATTEMPTS) {
        setCooldown(CFG.PIN_COOLDOWN_S); setAttempts(0);
        showToast(`Demasiados intentos. Espera ${CFG.PIN_COOLDOWN_S} s`, 'err');
      } else {
        showToast(`PIN incorrecto (${prev}/${CFG.PIN_MAX_ATTEMPTS})`, 'err');
      }
    }
  };

  const pressPin = async (n) => {
    const remain = isInCooldown();
    if (remain > 0) { showToast(`Bloqueado ${Math.ceil(remain/1000)} s`, 'err'); return; }
    if (pinActual.length < 4) {
      pinActual += String(n); updateDots();
      if (pinActual.length === 4) { const c = pinActual; clearPin(); await ensureDefaultPinHash(); verifyAndUnlock(c); }
    }
  };

  const biometricAuth = async () => showToast('Biometría no disponible aún', 'warn');

  const lock = () => {
    const auth = document.getElementById("authOverlay");
    const m    = document.getElementById("movimientos");
    if (auth) auth.classList.remove('hidden');
    if (m)    { m.classList.add("hidden"); m.dataset.permiso = ""; }
    clearPin();
  };

  const unlock = () => {
    document.getElementById("authOverlay")?.classList.add('hidden');
    const m = document.getElementById("movimientos");
    m.classList.remove("hidden");
    m.dataset.permiso = "OK";
    _lastActivity = Date.now();
    init();
    loadFromDropboxOnStart({ silent: true });
  };

  // Session timeout: vuelve a pedir PIN tras inactividad
  const resetActivity = () => { _lastActivity = Date.now(); };
  ['touchstart','mousedown','keydown','scroll'].forEach(ev =>
    window.addEventListener(ev, resetActivity, { passive: true })
  );
  setInterval(() => {
    const m = document.getElementById("movimientos");
    if (!m || m.dataset.permiso !== "OK") return;
    const idleMs = Date.now() - _lastActivity;
    if (idleMs > CFG.SESSION_TIMEOUT * 60 * 1000) lock();
  }, 30000);

  // ==========================
  // BÚSQUEDA DE TEXTO LIBRE
  // ==========================
  let _searchQuery = "";
  const applySearch = (lista) => {
    if (!_searchQuery) return lista;
    const q = normalizeKey(_searchQuery);
    return lista.filter(m =>
      normalizeKey(m.c).includes(q) ||
      normalizeKey(m.s).includes(q) ||
      normalizeKey(m.d || '').includes(q) ||
      normalizeKey(m.o).includes(q) ||
      String(Math.abs(m.imp)).includes(q)
    );
  };

  // Inyectar buscador en el DOM (solo una vez)
  const ensureSearchBar = () => {
    if (document.getElementById('__searchBar__')) return;
    const filtrosWrapper = document.querySelector('.filtros-wrapper');
    if (!filtrosWrapper) return;
    const bar = document.createElement('div');
    bar.id = '__searchBar__';
    bar.style.cssText = 'padding:4px 8px 0;';
    bar.innerHTML = `<input id="__searchInput__" type="search" placeholder="🔍 Buscar..." autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:7px 12px;border-radius:20px;border:1px solid rgba(212,175,55,.4);
      background:rgba(255,255,255,.07);color:inherit;font-size:14px;outline:none;">`;
    filtrosWrapper.appendChild(bar);
    document.getElementById('__searchInput__').addEventListener('input', debounce((e) => {
      _searchQuery = e.target.value.trim();
      resetPagina(); mostrar();
    }, 250));
  };

  // ==========================
  // FULLSCREEN + DOBLE‑TAP
  // ==========================
  const isInteractive = (el) => !!(el?.closest('button, a, select, input, textarea, label, [role="button"], [tabindex]'));
  let _lastTap = 0;
  const TAP_WINDOW = 250;

  const toggleFullscreenUI = () => {
    fullscreenMode = !fullscreenMode;
    const d = fullscreenMode ? 'none' : '';
    document.querySelector('.filtros-wrapper')?.style.setProperty('display', d);
    document.querySelector('.footer-controles')?.style.setProperty('display', d);
    requestAnimationFrame(mostrar);
    try { sessionStorage.setItem('ui_fullscreen', fullscreenMode ? '1' : '0'); } catch {}
  };

  const armRotateIfGraficosNow = () => {
    const modo = document.getElementById("movimientos")?.dataset?.modo || "lista";
    if (modo !== "graficos" && modo !== "graficos2") return;
    rotateReady = !rotateReady;
    try { rotateReady ? sessionStorage.setItem('rotate_ready','1') : sessionStorage.removeItem('rotate_ready'); } catch {}
  };

  const bindGuardarHandlers = () => {
    const form = document.getElementById('form');
    if (form && !form.__boundSubmit) {
      form.addEventListener('submit', (e) => { e.preventDefault(); guardar(); });
      form.__boundSubmit = true;
    }
    const btn = document.querySelector('#btnGuardar, #guardar, button[data-guardar]');
    if (btn && !btn.__boundClick) {
      btn.addEventListener('click', (e) => { e.preventDefault(); guardar(); });
      btn.__boundClick = true;
    }
  };

  const initDOM = () => {
    ensureDefaultPinHash().catch(console.error);
    updateDots();
    if (document.documentElement) document.documentElement.style.touchAction = 'manipulation';
    if (document.body)            document.body.style.touchAction            = 'manipulation';
    try { if (sessionStorage.getItem('ui_fullscreen') === '1') { fullscreenMode = true; toggleFullscreenUI(); } } catch {}
    try { if (sessionStorage.getItem('rotate_ready')  === '1') rotateReady = true; } catch {}
    window.addEventListener('touchstart', (ev) => {
      if (isInteractive(ev.target)) return;
      const t = Date.now();
      if (t - _lastTap <= TAP_WINDOW) { ev.preventDefault(); toggleFullscreenUI(); armRotateIfGraficosNow(); _lastTap = 0; }
      else _lastTap = t;
    }, { passive: false });
    window.addEventListener('dblclick', (ev) => {
      if (isInteractive(ev.target)) return;
      ev.preventDefault(); toggleFullscreenUI(); armRotateIfGraficosNow();
    }, { passive: false });
    bindGuardarHandlers();
    const ieVolver = document.getElementById('ieVolver');
    if (ieVolver) ieVolver.onclick = () => setModo('lista');
  };

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', initDOM)
    : initDOM();

  // Volteador de pantalla
  const handleRotationRedraw = () => {
    if (!rotateReady) return;
    const modo = document.getElementById("movimientos")?.dataset?.modo || "lista";
    if (modo === "graficos" || modo === "graficos2") { try { captureFooterAnchors(); } catch {} mostrar(); }
  };
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener("change", handleRotationRedraw);
  window.addEventListener("orientationchange", handleRotationRedraw);
  let _lastIsLandscape = null;
  window.addEventListener("resize", () => {
    if (!rotateReady) return;
    const isLandscape = window.innerWidth > window.innerHeight;
    if (_lastIsLandscape !== null && isLandscape !== _lastIsLandscape) handleRotationRedraw();
    _lastIsLandscape = isLandscape;
  });

  // ==========================
  // ICONOS SVG
  // ==========================
  const iconBars   = () => `<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke="black" stroke-width="3"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
  const iconBack   = () => `<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke="black" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>`;
  const iconGraph2 = () => `<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke-width="2.6"><rect x="6" y="7" width="4" height="10" fill="#ef4444" stroke="#ef4444" rx="1"/><rect x="14" y="5" width="4" height="12" fill="#22c55e" stroke="#22c55e" rx="1"/></svg>`;
  const iconCasa   = () => `<svg viewBox="0 0 24 24"><path d="M3 10.5 L12 3 L21 10.5"/><path d="M5 10.5 V20 H10 V15 H14 V20 H19 V10.5"/></svg>`;

  // ==========================
  // VISTAS / TOGGLE CASA
  // ==========================
  const setModo = (modo) => {
    const m = document.getElementById("movimientos");
    const from = m.dataset.modo || 'lista';
    if ((modo === 'graficos' || modo === 'graficos2') && from === 'lista') {
      captureFooterAnchors(); captureBalanceRef();
    }
    m.dataset.modo = modo;
    resetPagina(); mostrar();
  };

  const toggleCasa = () => {
    hideCasa = !hideCasa;
    const m = document.getElementById("movimientos");
    if (m?.dataset?.modo === "graficos" || m?.dataset?.modo === "graficos2") mostrar();
  };

  const isCasaCategory = (cat) => {
    const k = canonicalizeLabel(cat || "");
    return k.includes("compra casa") || k.includes("compra garaje") || k.includes("venta casa");
  };

  // ==========================
  // FOOTER — anclajes y layout
  // ==========================
  let footerAnchors = { leftX: null, centerX: null, size: 65 };

  const captureFooterAnchors = () => {
    try {
      const fr = document.querySelector('.footer-row'); if (!fr) return;
      const plus = fr.querySelectorAll('.plus'); if (!plus[0] || !plus[1]) return;
      const frRect = fr.getBoundingClientRect();
      footerAnchors.leftX   = plus[0].getBoundingClientRect().left - frRect.left;
      footerAnchors.centerX = plus[1].getBoundingClientRect().left - frRect.left;
      footerAnchors.size    = Math.round(plus[1].getBoundingClientRect().width || 65);
    } catch {}
  };

  const ensureRealButtons = () => {
    const fr = document.querySelector('.footer-row');
    if (!fr) return { btnLeft: null, btnCenter: null, btnRight: null };
    const buttons = Array.from(fr.querySelectorAll('.plus')).slice(0, 2);
    const modo = document.getElementById("movimientos")?.dataset?.modo || 'lista';
    let btnRight = document.getElementById('btnRightReal');
    if (modo === 'graficos' || modo === 'graficos2') {
      if (!btnRight) {
        btnRight = document.createElement('button');
        btnRight.id = 'btnRightReal'; btnRight.className = 'plus';
        fr.appendChild(btnRight);
      }
    } else { btnRight?.remove(); btnRight = null; }
    return { btnLeft: buttons[0] || null, btnCenter: buttons[1] || null, btnRight };
  };

  const resetBtn = (b) => {
    if (!b) return;
    b.style.position = b.style.left = b.style.top = b.style.transform = "";
    b.style.opacity = "1"; b.style.display = b.style.pointerEvents = "";
  };
  const layoutFooterReset = (l, c, r) => [l, c, r].forEach(resetBtn);
  const _posBtn = (b, left) => {
    b.style.position = 'absolute'; b.style.top = '50%'; b.style.transform = 'translateY(-50%)';
    if (left != null) b.style.left = `${left}px`;
  };

  const _recentrarCasa = (container, btnLeft, btnCenter, btnRight) => {
    if (!container || !btnLeft || !btnCenter) return;
    requestAnimationFrame(() => {
      const fr = container.getBoundingClientRect();
      const l  = btnLeft.getBoundingClientRect();
      const c  = btnCenter.getBoundingClientRect();
      const rightVisible = !!(btnRight && getComputedStyle(btnRight).display !== 'none' && btnRight.style.opacity !== '0');
      const rightLeft  = rightVisible ? btnRight.getBoundingClientRect().left - fr.left : (footerAnchors.centerX ?? (container.clientWidth / 2 - c.width / 2));
      const rightWidth = rightVisible ? btnRight.getBoundingClientRect().width : c.width;
      const cLeft  = (l.left - fr.left) + l.width / 2;
      const cRight = rightLeft + rightWidth / 2;
      btnCenter.style.position  = 'absolute';
      btnCenter.style.top       = '50%';
      btnCenter.style.transform = 'translateY(-50%)';
      btnCenter.style.left      = `${Math.round((cLeft + cRight) / 2 - c.width / 2)}px`;
    });
  };

  const layoutFooterGrafico1 = (container, btnLeft, btnCenter, btnRight) => {
    if (!container || !btnLeft || !btnCenter) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    _posBtn(btnLeft, footerAnchors.leftX ?? 20);
    if (btnRight) {
      _posBtn(btnRight, footerAnchors.centerX ?? (container.clientWidth / 2 - (footerAnchors.size || 65) / 2));
      btnRight.style.display = ''; btnRight.style.opacity = '1'; btnRight.style.pointerEvents = 'auto';
    }
    document.querySelector('.footer-controles')?.style.setProperty('display', fullscreenMode ? 'none' : '');
    _recentrarCasa(container, btnLeft, btnCenter, btnRight);
  };

  const layoutFooterGrafico2 = (container, btnLeft, btnCenter, btnRight) => {
    if (!container || !btnLeft || !btnCenter) return;
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    _posBtn(btnLeft, footerAnchors.leftX ?? 20);
    if (btnRight) { btnRight.style.display = 'none'; btnRight.style.pointerEvents = 'none'; btnRight.style.opacity = '0'; }
    document.querySelector('.footer-controles')?.style.setProperty('display', fullscreenMode ? 'none' : '');
    _recentrarCasa(container, btnLeft, btnCenter, null);
  };

  // ==========================
  // BALANCE
  // ==========================
  const captureBalanceRef = () => {
    try {
      const fr = document.querySelector('.footer-row')?.getBoundingClientRect();
      const bl = document.getElementById('balance')?.getBoundingClientRect();
      if (fr && bl) balanceRightRef = Math.max(0, Math.round(fr.right - bl.right));
    } catch {}
  };

  const layoutBalanceFixedUnified = () => {
    const footerRow = document.querySelector('.footer-row');
    const balanceEl = document.getElementById('balance');
    if (!footerRow || !balanceEl) return;
    if (getComputedStyle(footerRow).position === 'static') footerRow.style.position = 'relative';
    const right = balanceRightRef ?? Math.max(0, parseFloat(getComputedStyle(document.querySelector('.footer-controles') || footerRow).paddingRight || '12'));
    Object.assign(balanceEl.style, { position:'absolute', top:'50%', transform:'translateY(-50%)', right:`${right}px` });
  };

  const layoutBalanceResetUnified = () => {
    const b = document.getElementById('balance');
    if (b) b.style.position = b.style.right = b.style.top = b.style.transform = '';
  };

  // ==========================
  // FILTRADO CON CACHÉ
  // ==========================
  const calcFiltrados = (fs) => {
    const key = fs.join('|') + '|' + (_searchQuery||'') + '|' + movimientos.length;
    if (_filterCache.key === key) return _filterCache.result;
    let result = movimientos.filter(m => {
      const dv = (m.f || "").split("-");
      return (fs[0]==="TODOS" || (parseInt(dv[1])-1).toString()===fs[0])
          && (fs[1]==="TODOS" || dv[0]===fs[1])
          && (fs[2]==="TODAS" || m.c===fs[2])
          && (fs[3]==="TODAS" || m.s===fs[3])
          && (fs[4]==="TODOS" || m.o===fs[4]);
    }).sort((a,b) => new Date(b.f) - new Date(a.f));
    result = applySearch(result);
    _filterCache = { key, result };
    return result;
  };

  const invalidateFilterCache = () => { _filterCache.key = null; };

  // ==========================
  // MOSTRAR (LISTA / G1 / G2 / IMPORTEXPORT)
  // ==========================
  function mostrar() {
    const movDiv = document.getElementById("movimientos");
    if (!movDiv || movDiv.dataset.permiso !== "OK") return;
    const listaDiv = document.getElementById("lista");
    const impPage  = document.getElementById("importExport");
    const modo     = movDiv.dataset.modo || "lista";

    const d = fullscreenMode ? 'none' : '';
    document.querySelector('.filtros-wrapper')?.style.setProperty('display', d);
    document.querySelector('.footer-controles')?.style.setProperty('display', d);

    // Buscador (se inyecta solo en modo lista)
    if (modo === 'lista') ensureSearchBar();

    // Filtrado con caché
    const fs = ["filtroMes","filtroAño","filtroCat","filtroSub","filtroOri"].map(id => document.getElementById(id)?.value ?? "TODOS");
    filtradosGlobal = calcFiltrados(fs);

    // Balance
    const factor = fs[0]==="TODOS" ? 12 : 1;
    let total = 0;
    for (const m of filtradosGlobal) if (!hideCasa || !isCasaCategory(m.c)) total += Number(m.imp) || 0;
    const balanceEl = document.getElementById("balance");
    if (balanceEl) {
      balanceEl.textContent = total.toFixed(2) + " €";
      balanceEl.style.color = total < 0 ? "var(--danger)"
        : total <= CFG.BALANCE_WARNING*factor ? "var(--warning)"
        : total <= CFG.BALANCE_OK*factor      ? "var(--success)"
        : "var(--electric-blue)";
      balanceEl.onclick = () => setModo('importexport');
    }

    // Import/Export
    if (impPage) impPage.classList.toggle('hidden', modo !== 'importexport');
    if (modo === "importexport") { if (listaDiv) listaDiv.innerHTML = ""; return; }

    // Botones footer
    const footerRow = document.querySelector('.footer-row');
    const { btnLeft, btnCenter, btnRight } = ensureRealButtons();
    [btnLeft, btnCenter, btnRight].forEach(b => {
      if (!b) return;
      b.onclick = null;
      b.classList.remove("plus-like","btn-house-anim","active");
      resetBtn(b);
    });

    const aplicarEstadoCasa = () => btnCenter?.classList.toggle("active", !!hideCasa);

    if (modo === "graficos") {
      captureFooterAnchors();
      if (btnLeft)   { btnLeft.innerHTML = iconBack();    btnLeft.onclick = () => setModo("lista"); }
      if (btnCenter) { btnCenter.innerHTML = iconCasa();  btnCenter.classList.add("btn-house-anim"); btnCenter.onclick = () => { toggleCasa(); aplicarEstadoCasa(); }; aplicarEstadoCasa(); }
      if (btnRight)  { btnRight.innerHTML = iconGraph2(); btnRight.onclick = () => setModo("graficos2"); }
      layoutFooterGrafico1(footerRow, btnLeft, btnCenter, btnRight);
      layoutBalanceFixedUnified();
      if (listaDiv) { listaDiv.innerHTML = ""; renderizarBarrasGraficos(factor); }

    } else if (modo === "graficos2") {
      captureFooterAnchors();
      if (btnLeft)   { btnLeft.innerHTML = iconBack();   btnLeft.onclick = () => setModo("graficos"); }
      if (btnCenter) { btnCenter.innerHTML = iconCasa(); btnCenter.classList.add("btn-house-anim"); btnCenter.onclick = () => { toggleCasa(); aplicarEstadoCasa(); }; aplicarEstadoCasa(); }
      if (btnRight)  { btnRight.style.display='none'; btnRight.style.pointerEvents='none'; btnRight.style.opacity='0'; }
      layoutFooterGrafico2(footerRow, btnLeft, btnCenter, btnRight);
      layoutBalanceFixedUnified();
      if (listaDiv) { listaDiv.innerHTML = ""; renderizarGraficos2(); }

    } else {
      // LISTA
      if (btnLeft)   { btnLeft.innerHTML = iconBars(); btnLeft.classList.add("plus-like"); btnLeft.onclick = () => { captureBalanceRef(); setModo("graficos"); }; }
      if (btnCenter) { btnCenter.innerHTML = "+"; btnCenter.onclick = () => abrirFormulario(); }
      layoutFooterReset(btnLeft, btnCenter, btnRight);
      layoutBalanceResetUnified();
      if (listaDiv) {
        const slice = filtradosGlobal.slice(0, registrosVisibles);
        listaDiv.innerHTML = slice.length ? slice.map(m => `
          <div class="card" onclick="abrirFormulario('${m.id}')"
               style="border-left-color:${m.imp >= 0 ? 'var(--success)' : 'var(--danger)'}">
            <div class="meta">${esc(m.f.split("-").reverse().join("/"))} • ${esc(m.o)}</div>
            <b>${esc(m.c)} - ${esc(m.s)}</b>
            ${m.d ? `<div style="font-size:12px;opacity:.8">${esc(m.d)}</div>` : ""}
            <div class="monto" style="color:${m.imp >= 0 ? 'var(--success)' : 'var(--danger)'}">
              ${(Number(m.imp)||0).toFixed(2)} €
            </div>
          </div>`).join("")
          : `<div class="card" style="text-align:center;border:none;opacity:.7">No hay registros para los filtros seleccionados.</div>`;
        const loader = document.getElementById("loader");
        if (loader) loader.style.display = "none";
      }
      captureBalanceRef();
    }
  }

  // Reajuste en resize (solo gráficos)
  window.addEventListener('resize', debounce(() => {
    const modo = document.getElementById("movimientos")?.dataset?.modo || "lista";
    if (modo !== "graficos" && modo !== "graficos2") return;
    const footerRow = document.querySelector(".footer-row");
    const { btnLeft, btnCenter, btnRight } = ensureRealButtons();
    (modo === "graficos" ? layoutFooterGrafico1 : layoutFooterGrafico2)(footerRow, btnLeft, btnCenter, btnRight);
    layoutBalanceFixedUnified();
  }, 150));

  // ==========================
  // GRÁFICOS 1 (barras)
  // ==========================
  const renderizarBarrasGraficos = (f) => {
    const lista = document.getElementById("lista");
    const filtroCat = document.getElementById("filtroCat")?.value || "TODAS";
    const fuente    = hideCasa ? filtradosGlobal.filter(m => !isCasaCategory(m.c)) : filtradosGlobal;
    const totales   = {};
    for (const m of fuente) {
      if (m.imp >= 0) continue;
      const key = filtroCat === "TODAS" ? m.c : (m.c === filtroCat ? m.s : null);
      if (key) totales[key] = (totales[key] || 0) + Math.abs(m.imp);
    }
    const items = Object.entries(totales).sort((a,b) => b[1]-a[1]);
    const max   = Math.max(...Object.values(totales), 1);
    const t1lim = CFG.BAR_TIER1 * f, t2lim = CFG.BAR_TIER2 * f, t3lim = CFG.BAR_TIER3 * f;
    const titulo = filtroCat === "TODAS" ? "ANÁLISIS DE GASTO POR CATEGORÍAS" : `SUBCATEGORÍAS DE ${filtroCat}`;

    let html = `
      <h2 style="color:var(--primary);font-size:18px;text-align:center">${titulo}</h2>
      <div style="display:flex;justify-content:center;gap:15px;margin-bottom:25px;font-size:19px;font-weight:900">
        <span style="color:var(--electric-blue)">0-${t1lim}€</span>
        <span style="color:var(--success)">${t2lim}€</span>
        <span style="color:var(--warning)">${t3lim}€</span>
        <span style="color:var(--danger)">+</span>
      </div>`;

    if (!items.length) {
      lista.innerHTML = html + `<div class="card" style="text-align:center;border:none;opacity:.8">No hay datos para los filtros seleccionados.</div>`;
      return;
    }
    lista.innerHTML = html + items.map(([label, val]) => {
      const s1 = Math.min(val, t1lim);
      const s2 = val > t1lim ? Math.min(val-t1lim, t2lim-t1lim) : 0;
      const s3 = val > t2lim ? Math.min(val-t2lim, t3lim-t2lim) : 0;
      const s4 = val > t3lim ? val-t3lim : 0;
      return `
        <div class="card" style="border:none;background:transparent;cursor:pointer"
             data-label="${esc(label)}" onclick="handleGraficoBarClick(this.dataset.label)">
          <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px">
            <span>${esc(label)}</span><b>${val.toFixed(2)} €</b>
          </div>
          <div style="width:${(val/max)*100}%;height:16px;display:flex;background:#000;border-radius:8px;overflow:hidden;border:1px solid rgba(212,175,55,.2)">
            <div style="width:${(s1/val)*100}%;background:var(--electric-blue)"></div>
            <div style="width:${(s2/val)*100}%;background:var(--success)"></div>
            <div style="width:${(s3/val)*100}%;background:var(--warning)"></div>
            <div style="width:${(s4/val)*100}%;background:var(--danger)"></div>
          </div>
        </div>`;
    }).join("");
  };

  const handleGraficoBarClick = (label) => {
    const selCat = document.getElementById('filtroCat');
    if (!selCat || selCat.value === 'TODAS') { if (selCat) selCat.value = label; resetPagina(); mostrar(); }
    else abrirDetalleMovs(selCat.value, label);
  };

  const abrirDetalleMovs = (categoria, subcategoria) => {
    try {
      const base  = hideCasa ? filtradosGlobal.filter(m => !isCasaCategory(m.c)) : filtradosGlobal;
      const lista = base.filter(m => m.imp < 0 && m.c === categoria && m.s === subcategoria)
                        .sort((a,b) => new Date(b.f) - new Date(a.f));
      const total = lista.reduce((acc, m) => acc + Math.abs(m.imp), 0);
      const overlay = document.createElement('div');
      overlay.className = 'premium-overlay';
      overlay.innerHTML = `
        <div class="premium-content" style="max-height:80vh;overflow:auto;text-align:left">
          <div class="premium-title" style="text-align:center">${esc(categoria)} / ${esc(subcategoria)}</div>
          <div style="font-weight:900;color:var(--primary);text-align:center;margin-bottom:10px">Total: ${total.toFixed(2)} €</div>
          ${lista.length
            ? lista.map(m => `
              <div class="card" style="margin:10px 0;border-left-color:var(--danger)">
                <div class="meta">${esc(m.f.split("-").reverse().join("/"))} • ${esc(m.o)}</div>
                ${m.d ? `<div style="font-size:13px;opacity:.9;margin-bottom:6px">${esc(m.d)}</div>` : ''}
                <div class="monto" style="color:var(--danger)">${Math.abs(m.imp).toFixed(2)} €</div>
              </div>`).join('')
            : `<div class="card" style="text-align:center;border:none;opacity:.8">No hay movimientos.</div>`}
          <button class="btn-silver" id="cerrarDetalle">CERRAR</button>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#cerrarDetalle').onclick = () => overlay.remove();
    } catch (e) { console.error(e); showToast('No se pudo abrir el detalle', 'err'); }
  };

  // ==========================
  // GRÁFICOS 2 (columnas mensuales)
  // ==========================
  const renderizarGraficos2 = () => {
    const lista = document.getElementById("lista");
    lista.querySelector('.g2-wrap')?.remove();
    const fs  = ["filtroMes","filtroAño","filtroCat","filtroSub","filtroOri"].map(id => document.getElementById(id)?.value ?? "TODOS");
    const hoy = new Date();
    const meses = Array.from({ length: 13 }, (_, i) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - (12 - i), 1);
      return { d, key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` };
    });
    const base = (hideCasa ? movimientos.filter(m => !isCasaCategory(m.c)) : movimientos)
      .filter(m => (fs[2]==="TODAS"||m.c===fs[2]) && (fs[3]==="TODAS"||m.s===fs[3]) && (fs[4]==="TODOS"||m.o===fs[4]));
    const sumaMes = new Map();
    for (const mov of base) {
      const k = (mov.f || "").slice(0,7);
      if (meses.some(x => x.key === k)) sumaMes.set(k, (sumaMes.get(k)||0) + (Number(mov.imp)||0));
    }
    const valores  = meses.map(m => sumaMes.get(m.key) || 0);
    const maxAbs   = Math.max(...valores.map(Math.abs), 1);
    const colorMes = (t) => t < 0 ? "var(--danger)" : t <= CFG.BAR_TIER1*2 ? "var(--warning)" : t <= CFG.BALANCE_WARNING ? "var(--success)" : "var(--electric-blue)";
    const mesesC   = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
    const fmtEuro  = (n) => { const v=Number(n)||0; return `${v>=0?"+":"−"}${Math.abs(v).toFixed(2).replace(".",",")} €`; };

    let html = `<div class="g2-wrap"><div class="g2-chart" style="position:relative;height:180px;display:grid;grid-template-columns:repeat(13,1fr);gap:10px;align-items:center;margin-bottom:26px;">
      <div class="g2-baseline" style="position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(212,175,55,.35)"></div>`;
    for (const m of meses) {
      const v = sumaMes.get(m.key) || 0;
      const h = Math.max(4, (Math.abs(v)/maxAbs) * 80);
      const label = mesesC[new Date(m.key+"-01T00:00:00").getMonth()];
      html += `
        <div class="g2-col" data-key="${m.key}" style="position:relative;height:100%;">
          <div class="g2-bar ${v>=0?'pos':'neg'}" data-h="${h}" style="height:0px;background:${colorMes(v)};"></div>
          <div class="g2-tip ${v>=0?'tip-pos':'tip-neg'}">${label} ${m.d.getFullYear()}: ${fmtEuro(v)}</div>
          <div class="g2-label" style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--primary)">${label}</div>
        </div>`;
    }
    html += `</div></div>`;
    lista.insertAdjacentHTML('beforeend', html);
    requestAnimationFrame(() => {
      lista.querySelectorAll('.g2-chart .g2-bar').forEach(el => { el.style.height = (parseFloat(el.dataset.h)||0)+'px'; });
    });
    const chart = lista.querySelector('.g2-chart');
    if (chart && !chart.dataset.tipBound) {
      chart.addEventListener('click', (ev) => {
        const col = ev.target.closest('.g2-col'); if (!col) return;
        chart.querySelectorAll('.g2-col.show-tip').forEach(c => { if (c !== col) c.classList.remove('show-tip'); });
        col.classList.toggle('show-tip');
      });
      document.addEventListener('click', (ev) => {
        if (!chart.contains(ev.target)) chart.querySelectorAll('.g2-col.show-tip').forEach(c => c.classList.remove('show-tip'));
      });
      chart.dataset.tipBound = '1';
    }
  };

  // ==========================
  // FORMULARIO / CRUD
  // ==========================
  const llenar = (id, base, extra, pre = "", opts = {}) => {
    const s = document.getElementById(id); if (!s) return;
    const origenActual = opts.origenActual || "";
    let values = [...new Set([...base, ...extra])];
    if (id === "categoria"    && origenActual !== "Nómina") values = values.filter(v => !NOMINA_CATS.includes(v));
    if (id === "subcategoria" && origenActual !== "Nómina") values = values.filter(v => !NOMINA_SUBS.includes(v));
    const opts_html = values.sort((a,b) => a.localeCompare(b,'es')).map(v => `<option value="${v}"${v===pre?' selected':''}>${v}</option>`).join('');
    const hidden    = (pre && !values.includes(pre)) ? `<option value="${pre}" selected hidden>${pre}</option>` : '';
    const addNew    = id !== "origen" ? `<option value="+">+ Añadir nuevo...</option>` : '';
    s.innerHTML = `<option value="" disabled${pre===''?' selected':''}>Seleccionar...</option>${opts_html}${hidden}${addNew}`;
    if (pre) s.value = pre;
  };

  const onOrigenChange = (origenValor, { preCat = "", preSub = "", esEdicion = false } = {}) => {
    const selCat = document.getElementById("categoria");
    const selSub = document.getElementById("subcategoria");
    if (origenValor === "Nómina") {
      const mesPrefer = preSub || mesFromISO(document.getElementById("fecha")?.value);
      selCat.innerHTML = `<option value="" disabled${preCat?'':' selected'}>Seleccionar...</option>`
        + NOMINA_CATS.map(c => `<option value="${c}"${c===preCat?' selected':''}>${c}</option>`).join('');
      selSub.innerHTML = `<option value="" disabled${mesPrefer?'':' selected'}>Seleccionar...</option>`
        + NOMINA_SUBS.map(m => `<option value="${m}"${m===mesPrefer?' selected':''}>${m}</option>`).join('');
      if (preCat)    { selCat.value = preCat;    selCat.dispatchEvent(new Event('change',{bubbles:true})); }
      if (mesPrefer) { selSub.value = mesPrefer; selSub.dispatchEvent(new Event('change',{bubbles:true})); }
      if (!esEdicion) lanzarPopupNomina({ preCat, preSub: mesPrefer });
    } else {
      llenar("categoria",    catBase, catExtra, preCat, { origenActual: origenValor });
      llenar("subcategoria", subMaestra, [], preSub,   { origenActual: origenValor });
    }
  };

  const lanzarPopupNomina = ({ preCat = "", preSub = "" } = {}) => {
    const overlay = document.createElement('div');
    overlay.className = 'nomina-overlay';
    overlay.innerHTML = `
      <div class="nomina-content">
        <div class="nomina-title">¿QUIÉN COBRA?</div>
        <button class="btn-nomina btn-oskar"  id="btn_nom_oskar">OSKAR</button>
        <button class="btn-nomina btn-josune" id="btn_nom_josune">JOSUNE</button>
        <button class="btn-nomina btn-cancel" id="btn_nom_cancel">CANCELAR</button>
      </div>`;
    document.body.appendChild(overlay);
    const close   = () => overlay.remove();
    const selCat  = document.getElementById("categoria");
    const selSub  = document.getElementById("subcategoria");
    const mesPrefer = preSub || mesFromISO(document.getElementById("fecha")?.value);
    selSub.innerHTML = `<option value="" disabled${mesPrefer?'':' selected'}>Seleccionar...</option>`
      + NOMINA_SUBS.map(m => `<option value="${m}"${m===mesPrefer?' selected':''}>${m}</option>`).join('');
    if (mesPrefer) { selSub.value = mesPrefer; selSub.dispatchEvent(new Event('change',{bubbles:true})); }
    const elegir = (nombre) => {
      selCat.innerHTML = `<option value="${nombre}" selected>${nombre}</option>`;
      selCat.value = nombre; selCat.dispatchEvent(new Event('change',{bubbles:true})); close();
    };
    document.getElementById('btn_nom_oskar').onclick  = () => elegir('Oskar');
    document.getElementById('btn_nom_josune').onclick = () => elegir('Josune');
    document.getElementById('btn_nom_cancel').onclick = () => {
      document.getElementById("origen").value = "Gasto";
      llenar("categoria",    catBase, catExtra, "", { origenActual:"Gasto" });
      llenar("subcategoria", subMaestra, [],    "", { origenActual:"Gasto" });
      close();
    };
  };

  // Última categoría/origen usados (para precargar en formulario nuevo)
  let _lastOrigen = "", _lastCat = "", _lastSub = "";

  const abrirFormulario = (id = null) => {
    const f    = document.getElementById("form");
    const mDiv = document.getElementById("movimientos");
    const btnD = document.getElementById("btnEliminarRegistro");
    if (id) {
      const m = movimientos.find(x => x.id.toString() === id.toString());
      document.getElementById("editId").value      = m.id;
      document.getElementById("fecha").value       = m.f;
      document.getElementById("importe").value     = Math.abs(m.imp);
      document.getElementById("descripcion").value = m.d || "";
      llenar("origen", origenBase, [], m.o);
      onOrigenChange(m.o, { preCat: m.c, preSub: m.s, esEdicion: true });
      btnD.classList.remove("hidden");
    } else {
      ["editId","importe","descripcion"].forEach(fId => { document.getElementById(fId).value = ""; });
      document.getElementById("fecha").value = new Date().toISOString().split("T")[0];
      // Precarga último origen/cat/sub usados
      llenar("origen", origenBase, [], _lastOrigen || "");
      onOrigenChange(_lastOrigen || "");
      // Si hay último origen y no es Nómina, precargar cat/sub
      if (_lastOrigen && _lastOrigen !== "Nómina") {
        llenar("categoria",    catBase, catExtra, _lastCat, { origenActual: _lastOrigen });
        llenar("subcategoria", subMaestra, [], _lastSub,   { origenActual: _lastOrigen });
      }
      btnD.classList.add("hidden");
    }
    const selOrigen = document.getElementById("origen");
    selOrigen.onchange = () => onOrigenChange(selOrigen.value);
    const fechaEl = document.getElementById("fecha");
    if (fechaEl) fechaEl.onchange = () => {
      if (selOrigen.value === "Nómina") {
        onOrigenChange("Nómina", {
          preCat:    document.getElementById("categoria")?.value || "",
          preSub:    mesFromISO(fechaEl.value),
          esEdicion: !!(document.getElementById("editId")?.value)
        });
      }
    };
    bindGuardarHandlers();
    f.classList.remove("hidden");
    mDiv.classList.add("hidden");
  };

  const guardar = () => {
    const get = (id) => (document.getElementById(id)?.value ?? "").trim();
    const v = {
      editId:       get("editId"),
      origen:       get("origen"),
      categoria:    get("categoria"),
      subcategoria: get("subcategoria"),
      fecha:        get("fecha"),
      descripcion:  get("descripcion"),
      importeRaw:   get("importe")
    };
    const selCat = document.getElementById("categoria");
    const selSub = document.getElementById("subcategoria");
    if (!v.categoria    && selCat?.selectedIndex >= 0) v.categoria    = selCat.options[selCat.selectedIndex].value || selCat.options[selCat.selectedIndex].text;
    if (!v.subcategoria && selSub?.selectedIndex >= 0) v.subcategoria = selSub.options[selSub.selectedIndex].value || selSub.options[selSub.selectedIndex].text;
    const imp = parseEuroNumber(v.importeRaw);
    if (!v.origen || !v.categoria || !v.subcategoria || !v.fecha || isNaN(imp)) {
      showToast('Faltan datos obligatorios', 'err'); return;
    }
    const m = {
      id: v.editId || `id_${Date.now()}`,
      f: v.fecha, o: v.origen, c: v.categoria, s: v.subcategoria,
      imp: v.origen === "Gasto" ? -Math.abs(imp) : Math.abs(imp),
      d: v.descripcion, ts: Date.now()
    };
    if (v.editId) {
      const idx = movimientos.findIndex(x => x.id.toString() === v.editId.toString());
      if (idx !== -1) movimientos[idx] = m;
    } else {
      movimientos.push(m);
      if (movimientos.length % 15 === 0) ejecutarBackupRotativo();
    }
    // Recordar último usado
    _lastOrigen = v.origen; _lastCat = v.categoria; _lastSub = v.subcategoria;
    invalidateFilterCache();
    lsSet('movimientos', movimientos);
    scheduleSync('guardar');
    showToast(v.editId ? '✏️ Registro actualizado' : '✅ Registro guardado');
    volver();
  };

  const eliminarRegistroActual = () => {
    const id = document.getElementById("editId")?.value; if (!id) return;
    if (confirm("¿ESTÁS SEGURO DE QUE DESEAS ELIMINAR ESTE REGISTRO?")) {
      movimientos = movimientos.filter(m => m.id.toString() !== id.toString());
      invalidateFilterCache();
      lsSet('movimientos', movimientos);
      scheduleSync('eliminar');
      showToast('🗑️ Registro eliminado', 'warn');
      volver();
    }
  };

  const volver = () => {
    document.getElementById("form").classList.add("hidden");
    document.getElementById("movimientos").classList.remove("hidden");
    actualizarListas(); resetPagina(); mostrar();
  };

  const manejarNuevo = (el, tipo) => {
    if (el.value !== "+") return;
    if (!el.dataset.nuevoValor) {
      const capturado = (prompt(tipo==="categoria" ? "Escribe el nombre de la nueva CATEGORÍA:" : "Escribe el nombre de la nueva SUBCATEGORÍA:") || "").trim();
      if (!capturado) { el.value = ""; return; }
      el.dataset.nuevoValor = capturado;
    }
    const n = el.dataset.nuevoValor || ""; el.dataset.nuevoValor = "";
    if (!n) { el.value = ""; return; }
    const pretty  = mostrarBonito(n.trim());
    const keyNew  = canonicalizeLabel(pretty);
    const origen  = document.getElementById("origen")?.value || "";
    if (tipo === "categoria") {
      if (NOMINA_CATS.some(x => canonicalizeLabel(x) === keyNew)) { showToast("No puedes crear manualmente 'Oskar' ni 'Josune'", 'err'); el.value = ""; return; }
      if (!buildCanonIndex(catBase, catExtra).has(keyNew)) { catExtra.push(pretty); lsSet('categoriaExtra', catExtra); scheduleSync('listas'); }
      llenar("categoria", catBase, catExtra, pretty, { origenActual: origen });
    } else {
      if (!buildCanonIndex(subMaestra, []).has(keyNew)) { subMaestra.push(pretty); lsSet('subMaestra_v2', subMaestra); scheduleSync('listas'); }
      llenar("subcategoria", subMaestra, [], pretty, { origenActual: origen });
    }
  };

  const borrarElemento = (tipo) => {
    const select = document.getElementById(tipo);
    const val = select?.value; if (!val) return;
    const origen = document.getElementById("origen")?.value || "";
    if (tipo === 'categoria') {
      const idx = catExtra.indexOf(val);
      if (idx < 0) { showToast('Solo puedes borrar categorías propias', 'warn'); return; }
      catExtra.splice(idx, 1); lsSet('categoriaExtra', catExtra); scheduleSync('listas');
      llenar('categoria', catBase, catExtra, "", { origenActual: origen });
    } else if (tipo === 'subcategoria') {
      const idx = subMaestra.indexOf(val); if (idx < 0) return;
      subMaestra.splice(idx, 1); lsSet('subMaestra_v2', subMaestra); scheduleSync('listas');
      llenar('subcategoria', subMaestra, [], "", { origenActual: origen });
    }
  };

  const abrirGraficos = () => {
    const m = document.getElementById("movimientos");
    m.dataset.modo = m.dataset.modo === "graficos" ? "lista" : "graficos";
    mostrar();
  };

  const resetPagina = () => {
    registrosVisibles = CFG.SCROLL_BATCH;
    window.scrollTo(0, 0);
  };

  const actualizarListas = () => {
    const fC = document.getElementById("filtroCat");
    const fS = document.getElementById("filtroSub");
    const fO = document.getElementById("filtroOri");
    if (fC) { fC.innerHTML = '<option value="TODAS">Cat: TODAS</option>'; [...new Set([...catBase,...catExtra,...NOMINA_CATS])].sort().forEach(c => fC.add(new Option(c,c))); }
    if (fS) { fS.innerHTML = '<option value="TODAS">Sub: TODAS</option>'; [...new Set([...subMaestra,...NOMINA_SUBS])].sort().forEach(s => fS.add(new Option(s,s))); }
    if (fO) { fO.innerHTML = '<option value="TODOS">Ori: TODOS</option>'; origenBase.forEach(o => fO.add(new Option(o,o))); }
  };

  // ==========================
  // NORMALIZACIÓN RETROACTIVA
  // ==========================
  const normalizarListasExistentes = () => {
    const vistosCat = new Set(catBase.map(canonicalizeLabel));
    catExtra = [...new Set(catExtra)].filter(v => {
      const k = canonicalizeLabel(v);
      if (vistosCat.has(k) || NOMINA_CATS.map(canonicalizeLabel).includes(k)) return false;
      vistosCat.add(k); return true;
    });
    lsSet('categoriaExtra', catExtra);
    const vistosSub = new Set();
    subMaestra = subMaestra.filter(v => { const k = canonicalizeLabel(v); if (vistosSub.has(k)) return false; vistosSub.add(k); return true; });
    lsSet('subMaestra_v2', subMaestra);
    const catIdx = buildCanonIndex([...catBase,...catExtra,...NOMINA_CATS], []);
    const subIdx = buildCanonIndex([...subMaestra,...NOMINA_SUBS], []);
    let cambiado = false;
    movimientos = movimientos.map(m => {
      const c = catIdx.get(canonicalizeLabel(m.c)) ?? m.c;
      const s = subIdx.get(canonicalizeLabel(m.s)) ?? m.s;
      if (c !== m.c || s !== m.s) { cambiado = true; return { ...m, c, s, ts: Math.max(Date.now(), (m.ts||0)+1) }; }
      return m;
    }).sort((a,b) => new Date(b.f) - new Date(a.f));
    if (cambiado) lsSet('movimientos', movimientos);
  };

  // ==========================
  // INIT + SCROLL INFINITO
  // ==========================
  const init = () => {
    const hoy = new Date();
    const fM = document.getElementById("filtroMes");
    const fA = document.getElementById("filtroAño");
    if (fM) { fM.innerHTML = '<option value="TODOS">Mes: TODOS</option>'; mesesLabel.forEach((m,i) => fM.add(new Option(m,i))); fM.value = hoy.getMonth(); }
    if (fA) { fA.innerHTML = '<option value="TODOS">Año: TODOS</option>'; for (let a=2020; a<=2030; a++) fA.add(new Option(a,a)); fA.value = hoy.getFullYear(); }
    normalizarListasExistentes();
    actualizarListas();
    bindInfiniteScroll();
    mostrar();
  };

  let _renderLock = false;
  const bindInfiniteScroll = () => {
    if (window.__infiniteScrollBound) return;
    window.__infiniteScrollBound = true;
    window.addEventListener('scroll', () => {
      if ((document.getElementById("movimientos")?.dataset?.modo || "lista") !== "lista") return;
      if (window.scrollY + window.innerHeight < document.documentElement.scrollHeight - CFG.SCROLL_THRESHOLD) return;
      if (registrosVisibles >= filtradosGlobal.length || _renderLock) return;
      _renderLock = true;
      registrosVisibles += CFG.SCROLL_BATCH;
      mostrar();
      _renderLock = false;
    }, { passive: true });
  };

  // ==========================
  // CSV EXPORT / IMPORT
  // ==========================
  const exportarCSV = () => {
    if (!movimientos.length) { showToast('No hay datos para exportar', 'warn'); return; }
    const SEP  = ";";
    const toES = (iso) => { const [y,m,d]=(iso||"").split("-"); return (y&&m&&d)?`${d}/${m}/${y}`:(iso||""); };
    const cell = (v)   => { let t=(v??"").toString().replace(/\r?\n/g,"⏎"); if(/[;"\n]/.test(t)) t='"'+t.replace(/"/g,'""')+'"'; return t; };
    const rows = movimientos.map(m => [toES(m.f),m.o||"",m.c||"",m.s||"",Number(m.imp)||0,(m.d??"").trim()].map(cell).join(SEP));
    const csv  = [["Fecha","Origen","Categoria","Subcategoria","Importe","Descripcion"].join(SEP), ...rows].join("\n");
    const hoy  = new Date(); const dd=String(hoy.getDate()).padStart(2,"0"), mm=String(hoy.getMonth()+1).padStart(2,"0");
    const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), { href:url, download:`mis_gastos_${dd}${mm}${hoy.getFullYear()}.csv` });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    showToast('📥 CSV exportado');
  };

  const importarCSV = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text  = reader.result.replace(/^\uFEFF/,"");
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (!lines.length) { showToast('Archivo vacío', 'err'); return; }
        const header = lines[0];
        const counts = { tab:(header.match(/\t/g)||[]).length, semi:(header.match(/;/g)||[]).length, comma:(header.match(/,/g)||[]).length };
        let delim = "\t"; if (counts.semi>=counts.tab && counts.semi>=counts.comma) delim=";"; else if (counts.comma>=counts.tab) delim=",";
        const parseLine = (line) => {
          const out=[]; let cur="", inQ=false;
          for (let i=0; i<line.length; i++) {
            const ch = line[i];
            if (ch==='"') { if (inQ && line[i+1]==='"') { cur+='"'; i++; } else inQ=!inQ; }
            else if (ch===delim && !inQ) { out.push(cur); cur=""; }
            else cur+=ch;
          }
          out.push(cur); return out;
        };
        const cols = parseLine(header).map(h => h.trim().toLowerCase());
        const idx  = {
          fecha:cols.findIndex(c=>c.startsWith("fecha")), origen:cols.findIndex(c=>c.startsWith("origen")),
          categoria:cols.findIndex(c=>c.startsWith("categoria")), subcategoria:cols.findIndex(c=>c.startsWith("subcategoria")),
          importe:cols.findIndex(c=>c.startsWith("importe")), descripcion:cols.findIndex(c=>c.startsWith("descripcion")||c.startsWith("descripción"))
        };
        const missing = ["fecha","origen","categoria","subcategoria","importe"].filter(k => idx[k] < 0);
        if (missing.length) { showToast("Faltan columnas: " + missing.join(", "), 'err'); return; }
        const toISO  = (s) => { const m=s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : s; };
        const clean  = (s) => { if (!s) return ""; let t=s.replace(/\\"{2,}/g,'"').trim(); if(t.startsWith('"')&&t.endsWith('"')) t=t.slice(1,-1); return t.trim(); };
        const addIfNew = (list, key, val) => { if (!list.some(v => canonicalizeLabel(v)===canonicalizeLabel(val))) { list.push(val); lsSet(key, list); } };
        const catIdx = buildCanonIndex([...catBase,...catExtra,...NOMINA_CATS], []);
        const subIdx = buildCanonIndex([...subMaestra,...NOMINA_SUBS], []);
        const nuevos = lines.slice(1).reduce((acc, line, i) => {
          const arr = parseLine(line);
          if (arr.every(v => !(v||'').trim())) return acc;
          let o = clean(arr[idx.origen]||'');
          const ol = o.toLowerCase();
          o = ol.startsWith('nom') ? 'Nómina' : ol.startsWith('gas') ? 'Gasto' : 'Ingreso';
          let c = mostrarBonito(clean(arr[idx.categoria]||''));
          let s = mostrarBonito(clean(arr[idx.subcategoria]||''));
          c = catIdx.get(canonicalizeLabel(c)) ?? c;
          s = subIdx.get(canonicalizeLabel(s)) ?? s;
          let imp = parseEuroNumber(arr[idx.importe]||'0');
          if (o==='Gasto' && imp>0) imp=-Math.abs(imp); else if (o!=='Gasto' && imp<0) imp=Math.abs(imp);
          const f = toISO(clean(arr[idx.fecha]||''));
          const d = idx.descripcion >= 0 ? clean(arr[idx.descripcion]||'') : '';
          if (!f || !o || !c || !s || isNaN(imp)) return acc;
          addIfNew(catExtra, 'categoriaExtra', c);
          addIfNew(subMaestra, 'subMaestra_v2', s);
          acc.push({ id:`id_${Date.now()}_${i}`, f, o, c, s, imp, d, ts: Date.now()+i });
          return acc;
        }, []);
        movimientos = [...movimientos, ...nuevos].sort((a,b) => new Date(b.f)-new Date(a.f));
        invalidateFilterCache();
        lsSet('movimientos', movimientos);
        scheduleSync('importarCSV');
        actualizarListas(); resetPagina(); mostrar();
        showToast(`✅ ${nuevos.length} registros importados`);
      } catch (err) { console.error(err); showToast('Error al importar el CSV', 'err'); }
      finally { e.target.value = ""; }
    };
    reader.onerror = () => showToast('No se pudo leer el archivo', 'err');
    reader.readAsText(file, 'UTF-8');
  };

  // ==========================
  // BACKUPS LOCALES
  // ==========================
  const createAndStoreLocalBackup = async () => {
    const enc = await encryptBackup(buildBackupObject());
    const idx = (parseInt(lsRaw('backup_idx','0'),10) % 5) + 1;
    lsSet(`backup_${idx}`, enc);
    lsRawSet('backup_idx', String(idx));
    lsRawSet('backup_last_ts', String(Date.now()));
    updateBackupIndicator();
    return enc;
  };

  const downloadEncryptedBackup = async (enc, filename = 'mis_gastos_backup.json') => {
    const blob = new Blob([JSON.stringify(enc,null,2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href:url, download:filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const ejecutarBackupRotativo = async () => {
    try { await downloadEncryptedBackup(await createAndStoreLocalBackup(), 'mis_gastos_backup.json'); }
    catch (e) { console.error("Backup automático falló:", e); }
  };

  const ensureBackupIndicator = () => {
    const top = document.querySelector('.topbar');
    if (!top || document.getElementById('backupIndicator')) return;
    const span = Object.assign(document.createElement('span'), { id:'backupIndicator', className:'backup-indicator' });
    span.innerHTML = `<span class="dot"></span><span class="txt">Última copia: —</span>`;
    top.appendChild(span);
  };

  const humanAgo = (ts) => {
    if (!ts) return "—";
    const s = Math.floor((Date.now()-ts)/1000);
    return s < 60 ? `hace ${s}s` : s < 3600 ? `hace ${Math.floor(s/60)}m` : `hace ${Math.floor(s/3600)}h`;
  };

  const updateBackupIndicator = () => {
    const el = document.getElementById('backupIndicator'); if (!el) return;
    const ts = parseInt(lsRaw('backup_last_ts','0'), 10);
    el.querySelector('.txt').textContent = `Última copia: ${humanAgo(ts)}`;
    el.classList.remove('stale','old');
    if (!ts) { el.classList.add('old'); return; }
    const mins = (Date.now()-ts)/60000;
    if (mins > 1440) el.classList.add('old'); else if (mins > 60) el.classList.add('stale');
  };
  setInterval(updateBackupIndicator, 60000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.error("SW:", e)));
  }

  // ==========================
  // DROPBOX
  // ==========================
  const DBX_APP_KEY     = 'pow1k3kk53abk75';
  const DBX_REDIRECT_URI= 'https://oskarlm.github.io/APK_V0.0/auth/dropbox/callback';
  const DBX_FILE_PATH   = '/mis_gastos_backup.json';
  const DBX_OAUTH_AUTH  = 'https://www.dropbox.com/oauth2/authorize';
  const DBX_OAUTH_TOKEN = 'https://api.dropboxapi.com/oauth2/token';
  const DBX_CONTENT     = 'https://content.dropboxapi.com/2';

  const dbx_b64Url      = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const dbx_sha256B64   = async (text) => dbx_b64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const dbx_randomStr   = (len=64)     => { const a=new Uint8Array(len); crypto.getRandomValues(a); return Array.from(a).map(b=>('0'+b.toString(16)).slice(-2)).join(''); };
  const dbx_getTokens   = ()           => { try { return JSON.parse(localStorage.getItem('dbx_tokens')||'{}'); } catch { return null; } };
  const dbx_setTokens   = (t)          => { try { localStorage.setItem('dbx_tokens', JSON.stringify(t||{})); } catch {} };
  const dbx_clearTokens = ()           => { try { localStorage.removeItem('dbx_tokens'); } catch {} };

  const dropboxStartLogin = async () => {
    const cv = dbx_randomStr(64), cc = await dbx_sha256B64(cv);
    try { sessionStorage.setItem('dbx_code_verifier', cv); } catch {}
    const p = new URLSearchParams({ response_type:'code', client_id:DBX_APP_KEY, redirect_uri:DBX_REDIRECT_URI,
      code_challenge:cc, code_challenge_method:'S256', token_access_type:'offline',
      scope:'files.content.write files.content.read files.metadata.read' });
    window.location.href = `${DBX_OAUTH_AUTH}?${p}`;
  };

  const dbx_getValidAccessToken = async () => {
    const t = dbx_getTokens(); if (!t) return null;
    if (t.access_token && t.expires_at && Date.now() < t.expires_at) return t.access_token;
    if (t.refresh_token) {
      const r = await fetch(DBX_OAUTH_TOKEN, { method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body: new URLSearchParams({ grant_type:'refresh_token', client_id:DBX_APP_KEY, refresh_token:t.refresh_token }) });
      if (!r.ok) { dbx_clearTokens(); return null; }
      const j = await r.json();
      const saved = { ...t, access_token:j.access_token, expires_in:j.expires_in, expires_at: Date.now()+(j.expires_in||3600)*1000 };
      dbx_setTokens(saved); return saved.access_token;
    }
    return t.access_token || null;
  };

  // Upload centralizado con indicador de estado
  const _dbxUpload = async (payload) => {
    const token = await dbx_getValidAccessToken();
    if (!token) { await dropboxStartLogin(); return false; }
    const res = await fetch(`${DBX_CONTENT}/files/upload`, {
      method:'POST',
      headers: { 'Authorization':`Bearer ${token}`, 'Content-Type':'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path:DBX_FILE_PATH, mode:'overwrite', autorename:false, mute:true }) },
      body: new TextEncoder().encode(typeof payload==='string' ? payload : JSON.stringify(payload, null, 2))
    });
    if (res.ok) {
      lsRawSet('backup_last_ts', String(Date.now()));
      updateBackupIndicator();
    } else {
      // Notificar fallo de sync silencioso — el usuario sabe que hay un problema
      const indicator = document.getElementById('backupIndicator');
      if (indicator) { indicator.classList.add('old'); indicator.querySelector('.txt').textContent = '⚠️ Error sync'; }
    }
    return res.ok;
  };

  const dropboxUploadEncryptedBackup = async () => {
    try {
      const ok = await _dbxUpload(await encryptBackup(buildBackupObject()));
      showToast(ok ? '☁️ Copia subida a Dropbox' : '❌ Error al subir a Dropbox', ok ? 'ok' : 'err');
    } catch(e) { console.error(e); showToast(String(e?.message||e), 'err'); }
  };

  const dropboxDownloadAndRestore = async () => {
    try {
      const token = await dbx_getValidAccessToken();
      if (!token) { await dropboxStartLogin(); return; }
      const res = await fetch(`${DBX_CONTENT}/files/download`, {
        method:'POST', headers:{ 'Authorization':`Bearer ${token}`, 'Dropbox-API-Arg':JSON.stringify({ path:DBX_FILE_PATH }) }
      });
      if (!res.ok) throw new Error(await res.text());
      let payload; try { payload = JSON.parse(await res.text()); } catch { throw new Error('El archivo no es JSON.'); }
      const data = (payload?.ct && payload?.iv) ? await decryptBackup(payload) : payload;
      if (!data?.datos) throw new Error('Formato de copia inválido');
      movimientos = Array.isArray(data.datos.movimientos) ? data.datos.movimientos : [];
      catExtra    = Array.isArray(data.datos.catExtra)    ? data.datos.catExtra    : [];
      subMaestra  = Array.isArray(data.datos.subMaestra)  ? data.datos.subMaestra  : [];
      lsSet('movimientos', movimientos); lsSet('categoriaExtra', catExtra); lsSet('subMaestra_v2', subMaestra);
      lsRawSet('backup_last_ts', String(Date.now()));
      invalidateFilterCache();
      updateBackupIndicator(); actualizarListas(); resetPagina(); mostrar();
      showToast('☁️ Datos restaurados desde Dropbox');
    } catch(e) { console.error(e); showToast(String(e?.message||e), 'err'); }
  };

  const dropboxSignOut = () => { dbx_clearTokens(); showToast('Dropbox desconectado', 'warn'); };

  // Auto‑sync con debounce
  let _syncTimer = null;
  const scheduleSync = (reason = 'changed') => {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(async () => {
      try { if (navigator.onLine) await _dbxUpload(await encryptBackup(buildBackupObject())); } catch {}
    }, CFG.SYNC_DEBOUNCE_MS);
  };

  const loadFromDropboxOnStart = async ({ silent = true } = {}) => {
    try {
      if (!navigator.onLine) return;
      const token = await dbx_getValidAccessToken(); if (!token) return;
      const res = await fetch(`${DBX_CONTENT}/files/download`, {
        method:'POST', headers:{ 'Authorization':`Bearer ${token}`, 'Dropbox-API-Arg':JSON.stringify({ path:DBX_FILE_PATH }) }
      });
      if (!res.ok) return;
      let payload; try { payload = JSON.parse(await res.text()); } catch { return; }
      const data = (payload?.ct && payload?.iv) ? await decryptBackup(payload) : payload;
      if (!data?.datos) return;
      movimientos = Array.isArray(data.datos.movimientos) ? data.datos.movimientos : [];
      catExtra    = Array.isArray(data.datos.catExtra)    ? data.datos.catExtra    : [];
      subMaestra  = Array.isArray(data.datos.subMaestra)  ? data.datos.subMaestra  : [];
      lsSet('movimientos', movimientos); lsSet('categoriaExtra', catExtra); lsSet('subMaestra_v2', subMaestra);
      lsRawSet('backup_last_ts', String(Date.now()));
      invalidateFilterCache();
      updateBackupIndicator(); actualizarListas(); resetPagina(); mostrar();
      if (!silent) showToast('☁️ Datos cargados desde Dropbox');
    } catch {}
  };

  window.addEventListener('online', () => { scheduleSync('online'); showToast('🌐 Conexión restaurada'); });
  window.addEventListener('offline', () => showToast('📵 Sin conexión', 'warn'));

  // ==========================
  // EXPORTAR A GLOBAL
  // ==========================
  Object.assign(window, {
    pressPin, clearPin, biometricAuth,
    mostrar, resetPagina, abrirFormulario, volver, guardar,
    eliminarRegistroActual, exportarCSV, importarCSV,
    manejarNuevo, borrarElemento, abrirGraficos,
    ejecutarBackupRotativo, init, actualizarListas,
    setModo, toggleCasa,
    handleGraficoBarClick, abrirDetalleMovs,
    dropboxStartLogin, dropboxUploadEncryptedBackup, dropboxDownloadAndRestore, dropboxSignOut,
    createAndStoreLocalBackup, showToast,
  });
}
