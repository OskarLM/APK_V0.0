// === main.js v23 — Escaneo tickets OCR, Entrada rápida, PDF mensual, Comparativa año, Edición masiva, Meta ahorro, Duplicados, Resumen semanal ===
if (window.__APP_LOADED__) {
} else {
  window.__APP_LOADED__ = true;

  // ==========================
  // CFG CENTRALIZADO
  // ==========================
  const CFG = {
    BALANCE_WARNING:  750,
    BALANCE_OK:       1400,
    BAR_TIER1:        50,
    BAR_TIER2:        200,
    BAR_TIER3:        500,
    SESSION_TIMEOUT:  15,
    PIN_MAX_ATTEMPTS: 5,
    PIN_COOLDOWN_S:   60,
    PIN_LENGTH:       4,      // PIN de 4 dígitos
    SYNC_DEBOUNCE_MS: 1200,
    SCROLL_BATCH:     25,
    SCROLL_THRESHOLD: 300,
    SUGERENCIAS_TOP:  3,      // Cuántas sugerencias mostrar
    ANOMALIA_RATIO:   1.6,    // Umbral para anomalía (160% de la media)
    SUSCRIPCION_MESES: 3,     // Meses consecutivos para detectar suscripción
    DUPLICADO_HORAS:   24,    // horas para considerar duplicado
  };

  // ==========================
  // CONSTANTES Y ESTADO
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

  const lsGet    = (k, fb = null) => { try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fb; } catch { return fb; } };
  const lsSet    = (k, v)         => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('localStorage lleno:', e); showToast('⚠️ Almacenamiento lleno', 'warn'); } };
  const lsRaw    = (k, fb = '')   => { try { return localStorage.getItem(k) ?? fb; } catch { return fb; } };
  const lsRawSet = (k, v)         => { try { localStorage.setItem(k, v); } catch (e) { console.warn('localStorage lleno:', e); } };

  let movimientos  = lsGet('movimientos', []);
  let catExtra     = lsGet('categoriaExtra', []);
  let subMaestra   = lsGet('subMaestra_v2', subBase.slice());
  let presupuestos = lsGet('presupuestos_v1', {});
  let metaAhorro   = lsGet('meta_ahorro_v1', 0);
  let _seleccionMasiva = new Set();
  let _modoMasivo      = false;
  let registrosVisibles = CFG.SCROLL_BATCH;
  let filtradosGlobal   = [];
  let pinActual         = "";
  let hideCasa          = false;
  let fullscreenMode    = false;
  let rotateReady       = false;
  let balanceRightRef   = null;
  let _lastActivity     = Date.now();
  let _filterCache      = { key: null, result: [] };
  let _lastOrigen = "", _lastCat = "", _lastSub = "";
  let _modoInicio = lsRaw('modo_inicio', 'dashboard'); // 'dashboard' | 'lista'

  // ==========================
  // TOAST
  // ==========================
  let _toastTimer = null;
  const showToast = (msg, type = 'ok') => {
    let t = document.getElementById('__toast__');
    if (!t) {
      t = document.createElement('div'); t.id = '__toast__';
      t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(20px);
        background:rgba(0,0,0,.88);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;font-weight:600;
        z-index:9999;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;max-width:80vw;text-align:center;`;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.borderLeft = type==='warn'?'4px solid var(--warning)':type==='err'?'4px solid var(--danger)':'4px solid var(--success)';
    t.style.opacity='1'; t.style.transform='translateX(-50%) translateY(0)';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)'; }, 2400);
  };

  // ==========================
  // UTILIDADES
  // ==========================
  const esc = (s) => (s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const debounce = (fn, d=150) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),d); }; };
  const mesFromISO = (iso) => { try { const d=new Date((iso||'')+'T00:00:00'); return isNaN(d)?mesesLabel[new Date().getMonth()]:mesesLabel[d.getMonth()]; } catch { return mesesLabel[new Date().getMonth()]; } };
  const normalizeKey = (s) => (s??'').toString().trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  const singularizeWordEs = (w) => { if(w.endsWith('iones'))return w.slice(0,-5)+'ion'; if(w.endsWith('ces'))return w.slice(0,-3)+'z'; if(w.endsWith('es'))return w.slice(0,-2); if(/[aeiou]s$/.test(w))return w.slice(0,-1); return w; };
  const canonicalizeLabel = (s) => { const raw=normalizeKey(s); return raw.split(/([\/-])/g).map(tok=>(tok==='/'||tok==='-')?tok:tok.split(' ').map(singularizeWordEs).join(' ')).join(' ').replace(/\s*\/\s*/g,'/').replace(/\s*-\s*/g,'-').trim(); };
  const mostrarBonito = (s) => { const t=(s??'').toString().trim(); return t?t.charAt(0).toUpperCase()+t.slice(1).toLowerCase():t; };
  const buildCanonIndex = (p=[],s=[]) => { const m=new Map(); [...p,...s].forEach(v=>{const k=canonicalizeLabel(v);if(!m.has(k))m.set(k,v);}); return m; };
  const parseEuroNumber = (s) => { let t=(s||'').toString().trim().replace(/\.(?=\d{3}(?:\D|$))/g,'').replace(',','.'); const n=parseFloat(t); return Number.isFinite(n)?n:NaN; };

  // ==========================
  // CIFRADO / PIN
  // ==========================
  const PIN_STORAGE_KEY  = 'pin_hash_v1';
  const PIN_ATTEMPTS_KEY = 'pin_attempts_v1';
  const PIN_COOLDOWN_KEY = 'pin_cooldown_until';

  const hexToBytes    = (hex)   => { const a=[]; for(let i=0;i<hex.length;i+=2)a.push(parseInt(hex.slice(i,i+2),16)); return new Uint8Array(a); };
  const bytesToBase64 = (bytes) => { let b=''; for(let i=0;i<bytes.length;i++)b+=String.fromCharCode(bytes[i]); return btoa(b); };
  const base64ToBytes = (b64)   => { const b=atob(b64),o=new Uint8Array(b.length); for(let i=0;i<b.length;i++)o[i]=b.charCodeAt(i); return o; };
  const sha256 = async (s) => { const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)); return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join(''); };

  const ensureDefaultPinHash = async () => { if(!lsRaw(PIN_STORAGE_KEY)) lsRawSet(PIN_STORAGE_KEY, await sha256('7143')); };
  const getAesKeyFromPin = async () => { await ensureDefaultPinHash(); return crypto.subtle.importKey('raw',hexToBytes(lsRaw(PIN_STORAGE_KEY)),'AES-GCM',false,['encrypt','decrypt']); };
  const buildBackupObject = () => ({ meta:{createdAt:new Date().toISOString(),app:'mis-gastos',version:'V1.0.31'}, datos:{movimientos,catExtra,subMaestra,presupuestos,metaAhorro} });
  const encryptBackup = async (obj) => { const iv=crypto.getRandomValues(new Uint8Array(12)),key=await getAesKeyFromPin(),ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj))); return {v:1,alg:'AES-GCM',iv:bytesToBase64(iv),ct:bytesToBase64(new Uint8Array(ct))}; };
  const decryptBackup = async (p) => { const key=await getAesKeyFromPin(),pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(p.iv)},key,base64ToBytes(p.ct)); return JSON.parse(new TextDecoder().decode(pt)); };

  const getAttempts  = ()  => parseInt(lsRaw(PIN_ATTEMPTS_KEY,'0'),10)||0;
  const setAttempts  = (n) => lsRawSet(PIN_ATTEMPTS_KEY,String(n));
  const setCooldown  = (s) => lsRawSet(PIN_COOLDOWN_KEY,String(Date.now()+s*1000));
  const isInCooldown = ()  => Math.max(0,parseInt(lsRaw(PIN_COOLDOWN_KEY,'0'),10)-Date.now());

  // Shake animado en dots del PIN
  const shakePinDots = () => {
    const c=document.querySelector('.pin-dots,.dots-row,#pinDots'); if(!c) return;
    c.style.transition='transform .07s';
    [8,-8,6,-6,4,-4,0].forEach((x,i)=>setTimeout(()=>{ c.style.transform=`translateX(${x}px)`; },i*70));
  };

  // Renderizar dots dinámicamente según CFG.PIN_LENGTH
  const renderPinDots = () => {
    const containers = document.querySelectorAll('.pin-dots,.dots-row,#pinDots');
    containers.forEach(c => {
      if(c.children.length !== CFG.PIN_LENGTH) {
        c.innerHTML = Array.from({length:CFG.PIN_LENGTH}).map(()=>'<div class="dot"></div>').join('');
      }
    });
  };

  const updateDots = () => { document.querySelectorAll('.dot').forEach((d,i)=>d.classList.toggle('filled',i<pinActual.length)); };
  const clearPin   = () => { pinActual=''; updateDots(); };

  const verifyAndUnlock = async (pinPlain) => {
    const rem=isInCooldown(); if(rem>0){showToast(`Bloqueado ${Math.ceil(rem/1000)} s`,'err');return;}
    await ensureDefaultPinHash();
    if(await sha256(pinPlain)===lsRaw(PIN_STORAGE_KEY)){ setAttempts(0); try{localStorage.removeItem(PIN_COOLDOWN_KEY);}catch{} _lastActivity=Date.now(); unlock(); }
    else { shakePinDots(); const p=getAttempts()+1; setAttempts(p); if(p>=CFG.PIN_MAX_ATTEMPTS){setCooldown(CFG.PIN_COOLDOWN_S);setAttempts(0);showToast(`Demasiados intentos. Espera ${CFG.PIN_COOLDOWN_S} s`,'err');}else showToast(`PIN incorrecto (${p}/${CFG.PIN_MAX_ATTEMPTS})`,'err'); }
  };

  const pressPin = async (n) => {
    const rem=isInCooldown(); if(rem>0){showToast(`Bloqueado ${Math.ceil(rem/1000)} s`,'err');return;}
    if(pinActual.length < CFG.PIN_LENGTH) {
      pinActual+=String(n); updateDots();
      if(pinActual.length===CFG.PIN_LENGTH){ const c=pinActual; clearPin(); await ensureDefaultPinHash(); verifyAndUnlock(c); }
    }
  };

  const biometricAuth = async () => showToast('Biometría no disponible aún','warn');

  // Cambio de PIN con soporte para longitud configurable
  const cambiarPin = async () => {
    const overlay=document.createElement('div'); overlay.className='premium-overlay';
    overlay.innerHTML=`
      <div class="premium-content" style="text-align:center">
        <div class="premium-title">CAMBIAR PIN</div>
        <p style="opacity:.7;font-size:13px;margin-bottom:16px">PIN de ${CFG.PIN_LENGTH} dígitos</p>
        <input id="_pinOld"  type="password" inputmode="numeric" maxlength="${CFG.PIN_LENGTH}" placeholder="PIN actual"
          style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:18px;text-align:center;margin-bottom:10px;box-sizing:border-box">
        <input id="_pinNew1" type="password" inputmode="numeric" maxlength="${CFG.PIN_LENGTH}" placeholder="Nuevo PIN"
          style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:18px;text-align:center;margin-bottom:10px;box-sizing:border-box">
        <input id="_pinNew2" type="password" inputmode="numeric" maxlength="${CFG.PIN_LENGTH}" placeholder="Repetir nuevo PIN"
          style="width:100%;padding:10px;border-radius:12px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:18px;text-align:center;margin-bottom:16px;box-sizing:border-box">
        <div style="display:flex;gap:10px">
          <button class="btn-silver" id="_pinCambiarOk" style="flex:1">GUARDAR</button>
          <button class="btn-silver" id="_pinCambiarCancel" style="flex:1">CANCELAR</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_pinCambiarCancel').onclick=()=>overlay.remove();
    overlay.querySelector('#_pinCambiarOk').onclick=async()=>{
      const old=overlay.querySelector('#_pinOld').value.trim();
      const new1=overlay.querySelector('#_pinNew1').value.trim();
      const new2=overlay.querySelector('#_pinNew2').value.trim();
      if(!old||!new1||!new2){showToast('Rellena todos los campos','err');return;}
      if(new1!==new2){showToast('Los PINs nuevos no coinciden','err');return;}
      if(!/^\d+$/.test(new1)||new1.length<4){showToast(`El PIN debe tener al menos 4 dígitos`,'err');return;}
      await ensureDefaultPinHash();
      if(await sha256(old)!==lsRaw(PIN_STORAGE_KEY)){showToast('PIN actual incorrecto','err');return;}
      lsRawSet(PIN_STORAGE_KEY, await sha256(new1));
      showToast('✅ PIN cambiado correctamente'); overlay.remove();
    };
  };

  // Borrado seguro
  const borradoSeguro = () => {
    const overlay=document.createElement('div'); overlay.className='premium-overlay';
    overlay.innerHTML=`
      <div class="premium-content" style="text-align:center">
        <div class="premium-title" style="color:var(--danger)">⚠️ BORRAR TODO</div>
        <p style="opacity:.8;margin-bottom:10px">Esto eliminará <b>todos los datos</b> de la app. No se puede deshacer.</p>
        <p style="opacity:.7;font-size:13px;margin-bottom:16px">Escribe <b>BORRAR</b> para confirmar</p>
        <input id="_confirmBorrar" type="text" placeholder="Escribe BORRAR"
          style="width:100%;padding:10px;border-radius:12px;border:2px solid var(--danger);background:rgba(255,255,255,.07);color:inherit;font-size:16px;text-align:center;margin-bottom:16px;box-sizing:border-box">
        <div style="display:flex;gap:10px">
          <button class="btn-silver" id="_borrarOk" style="flex:1;border-color:var(--danger);color:var(--danger)">BORRAR</button>
          <button class="btn-silver" id="_borrarCancel" style="flex:1">CANCELAR</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_borrarCancel').onclick=()=>overlay.remove();
    overlay.querySelector('#_borrarOk').onclick=()=>{
      if(overlay.querySelector('#_confirmBorrar').value.trim().toUpperCase()!=='BORRAR'){showToast('Escribe exactamente: BORRAR','err');return;}
      ['movimientos','categoriaExtra','subMaestra_v2','presupuestos_v1','pin_hash_v1','pin_attempts_v1',
       'pin_cooldown_until','pin_initialized','backup_last_ts','backup_idx','dbx_tokens','modo_inicio',
       'backup_1','backup_2','backup_3','backup_4','backup_5'].forEach(k=>{try{localStorage.removeItem(k);}catch{}});
      overlay.remove(); showToast('Datos borrados. Recargando...','warn');
      setTimeout(()=>window.location.reload(),1500);
    };
  };

  const lock = () => {
    document.getElementById('authOverlay')?.classList.remove('hidden');
    const m=document.getElementById('movimientos'); if(m){m.classList.add('hidden');m.dataset.permiso='';}
    clearPin(); renderPinDots();
  };

  const unlock = () => {
    document.getElementById('authOverlay')?.classList.add('hidden');
    const m=document.getElementById('movimientos'); m.classList.remove('hidden'); m.dataset.permiso='OK';
    _lastActivity=Date.now(); init(); loadFromDropboxOnStart({silent:true});
  };

  const resetActivity=()=>{_lastActivity=Date.now();};
  ['touchstart','mousedown','keydown','scroll'].forEach(ev=>window.addEventListener(ev,resetActivity,{passive:true}));
  setInterval(()=>{ const m=document.getElementById('movimientos'); if(!m||m.dataset.permiso!=='OK')return; if(Date.now()-_lastActivity>CFG.SESSION_TIMEOUT*60000)lock(); },30000);

  // ==========================
  // BÚSQUEDA LIBRE
  // ==========================
  let _searchQuery='';
  const applySearch=(lista)=>{
    if(!_searchQuery)return lista;
    const q=normalizeKey(_searchQuery);
    return lista.filter(m=>normalizeKey(m.c).includes(q)||normalizeKey(m.s).includes(q)||normalizeKey(m.d||'').includes(q)||normalizeKey(m.o).includes(q)||String(Math.abs(m.imp)).includes(q));
  };
  const ensureSearchBar=()=>{
    if(document.getElementById('__searchBar__'))return;
    const fw=document.querySelector('.filtros-wrapper'); if(!fw)return;
    const bar=document.createElement('div'); bar.id='__searchBar__'; bar.style.cssText='padding:4px 8px 0;';
    bar.innerHTML=`<input id="__searchInput__" type="search" placeholder="🔍 Buscar..." autocomplete="off"
      style="width:100%;box-sizing:border-box;padding:7px 12px;border-radius:20px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:14px;outline:none;">`;
    fw.appendChild(bar);
    document.getElementById('__searchInput__').addEventListener('input',debounce(e=>{_searchQuery=e.target.value.trim();resetPagina();mostrar();},250));
  };

  // ==========================
  // SUGERENCIAS INTELIGENTES
  // ==========================
  const calcSugerencias=()=>{
    // Analiza los últimos movimientos y calcula los patrones más frecuentes
    // por hora del día y día de la semana
    const ahora=new Date();
    const horaActual=ahora.getHours();
    const diaActual=ahora.getDay(); // 0=Dom

    // Contar frecuencias de (origen, cat, sub) con factor de hora y día
    const scores={};
    const ventana=movimientos.filter(m=>m.imp<0).slice(-200); // últimos 200 gastos
    for(const m of ventana){
      const d=new Date(m.f+'T12:00:00');
      const diaM=d.getDay();
      const key=`${m.o}||${m.c}||${m.s}`;
      if(!scores[key]) scores[key]={o:m.o,c:m.c,s:m.s,count:0,score:0};
      scores[key].count++;
      scores[key].score++;
      // Bonus si es el mismo día de la semana
      if(diaM===diaActual) scores[key].score+=2;
    }
    return Object.values(scores)
      .sort((a,b)=>b.score-a.score)
      .slice(0,CFG.SUGERENCIAS_TOP);
  };

  // ==========================
  // DETECCIÓN DE SUSCRIPCIONES
  // ==========================
  const detectarSuscripciones=()=>{
    const ahora=new Date();
    const sospechosas=[];
    // Agrupa gastos por (cat+sub+importe redondeado) y busca repetición mensual
    const grupos={};
    for(const m of movimientos){
      if(m.imp>=0)continue;
      const impRound=Math.round(Math.abs(m.imp)*10)/10;
      const key=`${m.c}|${m.s}|${impRound}`;
      if(!grupos[key])grupos[key]={c:m.c,s:m.s,imp:impRound,meses:new Set()};
      grupos[key].meses.add((m.f||'').slice(0,7));
    }
    for(const g of Object.values(grupos)){
      if(g.meses.size>=CFG.SUSCRIPCION_MESES){
        // Verificar que los meses son consecutivos (o casi)
        const sorted=[...g.meses].sort();
        const last=sorted[sorted.length-1];
        const [ly,lm]=last.split('-').map(Number);
        const mesActual=`${ahora.getFullYear()}-${String(ahora.getMonth()+1).padStart(2,'0')}`;
        if(last===mesActual||last===`${ly}-${String(lm).padStart(2,'0')}`)
          sospechosas.push({...g,mesesCount:g.meses.size,ultimoMes:last});
      }
    }
    return sospechosas.sort((a,b)=>b.mesesCount-a.mesesCount).slice(0,5);
  };

  // ==========================
  // DÍA DE PELIGRO
  // ==========================
  const calcDiaPeligro=()=>{
    // Analiza en qué día del mes históricamente se supera el presupuesto
    const diasGasto=[]; // Array de {mes, dia, gasto_acumulado}
    const mesesKeys=[...new Set(movimientos.map(m=>(m.f||'').slice(0,7)))].sort().slice(-12);

    for(const mesKey of mesesKeys){
      const [y,mo]=mesKey.split('-').map(Number);
      const gastosMes=movimientos.filter(m=>m.imp<0&&(m.f||'').startsWith(mesKey));
      let acum=0;
      const porDia={};
      for(const m of gastosMes){
        const dia=parseInt((m.f||'').split('-')[2]||'0');
        porDia[dia]=(porDia[dia]||0)+Math.abs(m.imp);
      }
      let supero=false;
      for(let d=1;d<=31;d++){
        acum+=(porDia[d]||0);
        if(!supero&&acum>CFG.BALANCE_WARNING){
          diasGasto.push(d); supero=true;
        }
      }
    }
    if(!diasGasto.length)return null;
    const promedio=Math.round(diasGasto.reduce((a,b)=>a+b,0)/diasGasto.length);
    return promedio;
  };

  // ==========================
  // INTELIGENCIA: PREDICCIÓN + ANOMALÍAS + INSIGHT
  // ==========================
  const calcEstadisticasMes=(yearNum,monthNum)=>{
    const gastos=movimientos.filter(m=>{const d=(m.f||'').split('-');return parseInt(d[0])===yearNum&&parseInt(d[1])-1===monthNum&&m.imp<0;});
    const total=gastos.reduce((s,m)=>s+Math.abs(m.imp),0);
    const porCat={};
    for(const m of gastos)porCat[m.c]=(porCat[m.c]||0)+Math.abs(m.imp);
    return{total,porCat,n:gastos.length};
  };
  const calcPromedioHistorico=(cat,mesesAtras=6)=>{
    const ahora=new Date(); let suma=0,count=0;
    for(let i=1;i<=mesesAtras;i++){const d=new Date(ahora.getFullYear(),ahora.getMonth()-i,1);const s=calcEstadisticasMes(d.getFullYear(),d.getMonth());if(s.porCat[cat]){suma+=s.porCat[cat];count++;}}
    return count>0?suma/count:0;
  };

  const generarInsightMensual=()=>{
    const ahora=new Date();
    const mesActual=ahora.getMonth(),añoActual=ahora.getFullYear();
    const diasMes=new Date(añoActual,mesActual+1,0).getDate(),diaHoy=ahora.getDate();
    const stats=calcEstadisticasMes(añoActual,mesActual);
    const statsPrev=calcEstadisticasMes(añoActual,mesActual===0?11:mesActual-1);
    const prediccion=diaHoy>0?Math.round((stats.total/diaHoy)*diasMes):0;
    const diff=stats.total-statsPrev.total;
    const diffPct=statsPrev.total>0?Math.round((diff/statsPrev.total)*100):0;
    const anomalias=[];
    for(const[cat,val]of Object.entries(stats.porCat)){
      const prom=calcPromedioHistorico(cat,6);
      if(prom>20&&val>prom*CFG.ANOMALIA_RATIO)anomalias.push({cat,val,prom,ratio:Math.round((val/prom)*100)});
    }
    anomalias.sort((a,b)=>b.ratio-a.ratio);
    const topCat=Object.entries(stats.porCat).sort((a,b)=>b[1]-a[1])[0];
    const diaPeligro=calcDiaPeligro();
    return{prediccion,diff,diffPct,anomalias:anomalias.slice(0,2),topCat,total:stats.total,diaHoy,diasMes,diaPeligro};
  };

  // ==========================
  // DASHBOARD (pantalla de inicio)
  // ==========================
  const renderDashboard=()=>{
    const lista=document.getElementById('lista'); if(!lista)return;
    const ins=generarInsightMensual();
    const ahora=new Date();
    const mesNombre=mesesLabel[ahora.getMonth()];
    const fmtE=(n)=>`${Math.round(n).toLocaleString('es')} €`;
    const sugerencias=calcSugerencias();
    const suscripciones=detectarSuscripciones();

    let html=``;

    // ── CABECERA RESUMEN MES ──
    html+=`<div style="background:linear-gradient(135deg,rgba(212,175,55,.15),rgba(0,0,0,.4));border:1px solid rgba(212,175,55,.35);border-radius:18px;padding:18px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:var(--primary);letter-spacing:1px">💡 ${mesNombre.toUpperCase()}</div>
        <button onclick="lsRawSet('modo_inicio','lista');mostrar()" style="background:none;border:none;color:var(--primary);font-size:11px;cursor:pointer;opacity:.7">VER LISTA →</button>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <div><div style="font-size:10px;opacity:.55;margin-bottom:2px">GASTADO</div><div style="font-size:26px;font-weight:900;color:var(--danger)">${fmtE(ins.total)}</div></div>
        <div style="text-align:right"><div style="font-size:10px;opacity:.55;margin-bottom:2px">PREVISIÓN FIN MES</div><div style="font-size:26px;font-weight:900;color:var(--warning)">${fmtE(ins.prediccion)}</div></div>
      </div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:10px;opacity:.5;margin-bottom:4px"><span>Día ${ins.diaHoy} / ${ins.diasMes}</span><span>${Math.round((ins.diaHoy/ins.diasMes)*100)}% del mes</span></div>
        <div style="height:5px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden">
          <div style="width:${Math.round((ins.diaHoy/ins.diasMes)*100)}%;height:100%;background:var(--primary);border-radius:4px"></div>
        </div>
      </div>
      ${ins.diff!==0?`<div style="font-size:12px;color:${ins.diff>0?'var(--danger)':'var(--success)'};margin-bottom:6px">${ins.diff>0?'↑':'↓'} ${Math.abs(ins.diffPct)}% vs mes anterior</div>`:''}
      ${ins.topCat?`<div style="font-size:12px;opacity:.75">📌 Mayor gasto: <b>${ins.topCat[0]}</b> — ${fmtE(ins.topCat[1])}</div>`:''}
      ${ins.diaPeligro?`<div style="font-size:12px;color:var(--warning);margin-top:6px">⚡ Históricamente superas el presupuesto hacia el día <b>${ins.diaPeligro}</b>${ins.diaHoy>=ins.diaPeligro-3&&ins.diaHoy<=ins.diaPeligro+3?' — ¡estás en zona de riesgo!':''}</div>`:''}
    </div>`;

    // ── ANOMALÍAS ──
    if(ins.anomalias.length){
      html+=`<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--danger);letter-spacing:1px;margin-bottom:8px">⚠️ GASTOS INUSUALES</div>`;
      for(const a of ins.anomalias)
        html+=`<div style="font-size:13px;margin-bottom:4px"><b>${esc(a.cat)}</b>: ${fmtE(a.val)} <span style="opacity:.6;font-size:11px">(${a.ratio}% sobre tu media de ${fmtE(a.prom)})</span></div>`;
      html+=`</div>`;
    }

    // ── META DE AHORRO ──
    if(metaAhorro>0){
      const ingresosMes=movimientos.filter(m=>{const d=(m.f||'').split('-');return parseInt(d[0])===ahora.getFullYear()&&parseInt(d[1])-1===ahora.getMonth()&&m.imp>0;}).reduce((s,m)=>s+m.imp,0);
      const ahorroActual=ingresosMes-ins.total;
      const pctAhorro=Math.min(100,Math.round((ahorroActual/metaAhorro)*100));
      const colAhorro=ahorroActual>=metaAhorro?'var(--success)':ahorroActual>0?'var(--warning)':'var(--danger)';
      const fmtE2=(n)=>`${Math.round(n).toLocaleString('es')} €`;
      html+=`<div style="background:rgba(0,0,0,.2);border:1px solid rgba(212,175,55,.2);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:var(--primary);letter-spacing:1px">🎯 META DE AHORRO</div>
          <button onclick="abrirMetaAhorro()" style="background:none;border:none;color:var(--primary);font-size:11px;cursor:pointer;opacity:.7">EDITAR</button>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
          <span>Ahorro: <b style="color:${colAhorro}">${fmtE2(ahorroActual)}</b></span><span style="opacity:.6">Meta: ${fmtE2(metaAhorro)}</span>
        </div>
        <div style="height:7px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden">
          <div style="width:${Math.max(0,pctAhorro)}%;height:100%;background:${colAhorro};border-radius:4px;transition:width .5s"></div>
        </div>
        ${ahorroActual>=metaAhorro?'<div style="font-size:11px;color:var(--success);margin-top:4px">✅ ¡Meta alcanzada!</div>':''}
      </div>`;
    }

    // ── PRESUPUESTOS ──
    const presKeys=Object.keys(presupuestos);
    if(presKeys.length){
      const statsActual=calcEstadisticasMes(ahora.getFullYear(),ahora.getMonth());
      html+=`<div style="background:rgba(0,0,0,.25);border:1px solid rgba(212,175,55,.2);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:700;color:var(--primary);letter-spacing:1px">📊 PRESUPUESTOS</div>
          <button onclick="abrirPresupuestos()" style="background:none;border:none;color:var(--primary);font-size:11px;cursor:pointer;opacity:.7">EDITAR</button>
        </div>`;
      for(const cat of presKeys){
        const lim=presupuestos[cat],gast=statsActual.porCat[cat]||0,pct=Math.min(100,Math.round((gast/lim)*100));
        const col=pct>=100?'var(--danger)':pct>=80?'var(--warning)':'var(--success)';
        html+=`<div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${esc(cat)}</span><span style="color:${col}">${fmtE(gast)} / ${fmtE(lim)}</span>
          </div>
          <div style="height:5px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${col};border-radius:4px;transition:width .5s"></div>
          </div>
        </div>`;
      }
      html+=`</div>`;
    }

    // ── SUGERENCIAS RÁPIDAS ──
    if(sugerencias.length){
      html+=`<div style="background:rgba(0,0,0,.2);border:1px solid rgba(212,175,55,.15);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:var(--primary);letter-spacing:1px;margin-bottom:10px">⚡ ACCESO RÁPIDO</div>
        <div style="display:flex;flex-direction:column;gap:6px">`;
      for(const s of sugerencias){
        html+=`<button onclick="abrirFormularioConSugerencia('${esc(s.o)}','${esc(s.c)}','${esc(s.s)}')"
          style="background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.2);border-radius:10px;padding:10px 14px;color:inherit;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:13px;text-align:left">
          <span><b>${esc(s.c)}</b> · ${esc(s.s)}</span>
          <span style="opacity:.5;font-size:11px">${s.count}×</span>
        </button>`;
      }
      html+=`</div></div>`;
    }

    // ── SUSCRIPCIONES DETECTADAS ──
    if(suscripciones.length){
      html+=`<div style="background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.25);border-radius:14px;padding:12px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:700;color:#a78bfa;letter-spacing:1px;margin-bottom:8px">🔄 PAGOS RECURRENTES DETECTADOS</div>`;
      for(const s of suscripciones)
        html+=`<div style="font-size:12px;margin-bottom:4px;display:flex;justify-content:space-between"><span><b>${esc(s.c)}</b> · ${esc(s.s)}</span><span style="color:#a78bfa">${s.imp.toFixed(2)}€/mes · ${s.mesesCount} meses</span></div>`;
      html+=`</div>`;
    }

    // ── ACCIONES ──
    html+=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <button onclick="abrirEntradaRapida()" class="btn-silver" style="padding:12px;font-size:13px">⚡ Entrada rápida</button>
      <button onclick="escanearTicket()" class="btn-silver" style="padding:12px;font-size:13px">📷 Escanear ticket</button>
      <button onclick="iniciarDictado()" class="btn-silver" style="padding:12px;font-size:13px">🎤 Añadir por voz</button>
      <button onclick="abrirFormulario()" class="btn-silver" style="padding:12px;font-size:13px">➕ Formulario</button>
      <button onclick="setModo('graficos')" class="btn-silver" style="padding:12px;font-size:13px">📈 Gráficos</button>
      <button onclick="renderComparativaAnual()" class="btn-silver" style="padding:12px;font-size:13px">📅 Año vs año</button>
      <button onclick="exportarPDFMensual()" class="btn-silver" style="padding:12px;font-size:13px">📄 Informe PDF</button>
      <button onclick="abrirPresupuestos()" class="btn-silver" style="padding:12px;font-size:13px">📊 Presupuestos</button>
      <button onclick="abrirMetaAhorro()" class="btn-silver" style="padding:12px;font-size:13px">🎯 Meta ahorro</button>
      <button onclick="toggleModoMasivo()" class="btn-silver" style="padding:12px;font-size:13px">✏️ Edición masiva</button>
      <button onclick="cambiarPin()" class="btn-silver" style="padding:12px;font-size:13px">🔑 Cambiar PIN</button>
      <button onclick="borradoSeguro()" class="btn-silver" style="padding:12px;font-size:13px;color:var(--danger)">🗑️ Borrar datos</button>
    </div>`;

    lista.innerHTML = html;
  };

  // Abrir formulario con sugerencia precargada
  const abrirFormularioConSugerencia=(origen,cat,sub)=>{
    _lastOrigen=origen; _lastCat=cat; _lastSub=sub;
    abrirFormulario(null);
  };

  // ==========================
  // INSIGHT PANEL (en modo lista debajo del buscador)
  // ==========================
  const renderInsightPanel=()=>{
    const lista=document.getElementById('lista'); if(!lista)return;
    const ins=generarInsightMensual();
    const ahora=new Date();
    const fmtE=(n)=>`${Math.round(n).toLocaleString('es')} €`;
    const mesNombre=mesesLabel[ahora.getMonth()];

    let html=`<div style="background:linear-gradient(135deg,rgba(212,175,55,.1),rgba(0,0,0,.25));border:1px solid rgba(212,175,55,.25);border-radius:14px;padding:14px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--primary);letter-spacing:1px">💡 INSIGHT DE ${mesNombre.toUpperCase()}</div>
        <button onclick="lsRawSet('modo_inicio','dashboard');mostrar()" style="background:none;border:none;color:var(--primary);font-size:11px;cursor:pointer;opacity:.7">← DASHBOARD</button>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <div><div style="font-size:10px;opacity:.55">GASTADO</div><div style="font-size:18px;font-weight:900;color:var(--danger)">${fmtE(ins.total)}</div></div>
        <div style="text-align:right"><div style="font-size:10px;opacity:.55">PREVISIÓN</div><div style="font-size:18px;font-weight:900;color:var(--warning)">${fmtE(ins.prediccion)}</div></div>
      </div>
      ${ins.diff!==0?`<div style="font-size:12px;color:${ins.diff>0?'var(--danger)':'var(--success)'}">${ins.diff>0?'↑':'↓'} ${Math.abs(ins.diffPct)}% vs mes anterior</div>`:''}
      ${ins.diaPeligro&&ins.diaHoy>=ins.diaPeligro-3?`<div style="font-size:12px;color:var(--warning);margin-top:4px">⚡ Zona de riesgo (día ${ins.diaPeligro} histórico)</div>`:''}
      <div style="display:flex;gap:6px;margin-top:10px">
        <button onclick="abrirPresupuestos()" class="btn-silver" style="flex:1;font-size:11px;padding:6px">📊</button>
        <button onclick="escanearTicket()" class="btn-silver" style="flex:1;font-size:11px;padding:6px">📷</button>
        <button onclick="iniciarDictado()" class="btn-silver" style="flex:1;font-size:11px;padding:6px">🎤</button>
        <button onclick="exportarPDFMensual()" class="btn-silver" style="flex:1;font-size:11px;padding:6px">📄</button>
        <button onclick="toggleModoMasivo()" class="btn-silver" style="flex:1;font-size:11px;padding:6px">✏️</button>
      </div>
    </div>`;

    lista.insertAdjacentHTML('afterbegin',html);
  };

  // ==========================
  // HEATMAP SEMANAL
  // ==========================
  const renderHeatmap=()=>{
    const lista=document.getElementById('lista'); if(!lista)return;
    const desde=new Date(); desde.setDate(desde.getDate()-83);
    const porDia=[0,0,0,0,0,0,0],countDia=[0,0,0,0,0,0,0];
    for(const m of movimientos){
      if(m.imp>=0)continue;
      const d=new Date(m.f+'T00:00:00'); if(d<desde)continue;
      const wd=d.getDay(); porDia[wd]+=Math.abs(m.imp); countDia[wd]++;
    }
    const labDias=['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const maxD=Math.max(...porDia,1);
    const colorH=(v)=>{const p=v/maxD;return p>.8?'var(--danger)':p>.5?'var(--warning)':p>.2?'var(--success)':'rgba(212,175,55,.2)';};
    let html=`<div style="background:rgba(0,0,0,.25);border:1px solid rgba(212,175,55,.2);border-radius:14px;padding:14px;margin-bottom:14px;">
      <div style="font-size:11px;font-weight:700;color:var(--primary);letter-spacing:1px;margin-bottom:10px">🔥 DÍAS QUE MÁS GASTAS</div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center">`;
    for(let i=1;i<=7;i++){
      const wd=i%7,v=porDia[wd],avg=countDia[wd]>0?Math.round(v/countDia[wd]):0;
      const h=Math.max(8,Math.round((v/maxD)*50));
      html+=`<div><div style="height:${h}px;background:${colorH(v)};border-radius:4px;margin-bottom:4px"></div>
        <div style="font-size:10px;opacity:.7">${labDias[wd]}</div>
        <div style="font-size:9px;opacity:.5">${avg}€</div></div>`;
    }
    html+=`</div></div>`;
    lista.insertAdjacentHTML('afterbegin',html);
  };

  // ==========================
  // VOZ — dictado mejorado (fecha natural)
  // ==========================
  let _recognizing=false;
  const iniciarDictado=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){showToast('Reconocimiento de voz no disponible','warn');return;}
    if(_recognizing){showToast('Ya estoy escuchando...','warn');return;}
    const r=new SR(); r.lang='es-ES'; r.continuous=false; r.interimResults=false; r.maxAlternatives=1;
    _recognizing=true; showToast('🎤 Escuchando... ej: "cuarenta euros gasolina ayer"','ok'); r.start();
    r.onresult=(e)=>{ _recognizing=false; const t=e.results[0][0].transcript.toLowerCase().trim(); showToast(`🎤 "${t}"','ok`); _procesarDictado(t); };
    r.onerror=(e)=>{ _recognizing=false; showToast('Error: '+e.error,'err'); };
    r.onend=()=>{ _recognizing=false; };
  };

  const _procesarDictado=(texto)=>{
    const matchNum=texto.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:euros?|€)?/i);
    if(!matchNum){showToast('No entendí el importe','warn');return;}
    const imp=parseFloat(matchNum[1].replace(',','.'));
    if(isNaN(imp)){showToast('Importe no reconocido','warn');return;}

    // Detectar fecha en el texto
    const ahora=new Date(); let fechaISO=ahora.toISOString().split('T')[0];
    if(/ayer/.test(texto)){const d=new Date(ahora);d.setDate(d.getDate()-1);fechaISO=d.toISOString().split('T')[0];}
    else if(/anteayer|antes de ayer/.test(texto)){const d=new Date(ahora);d.setDate(d.getDate()-2);fechaISO=d.toISOString().split('T')[0];}
    else{
      const matchDia=texto.match(/el\s+(\d{1,2})/);
      if(matchDia){const dia=parseInt(matchDia[1]);const d=new Date(ahora.getFullYear(),ahora.getMonth(),dia);fechaISO=d.toISOString().split('T')[0];}
    }

    // Buscar categoría/subcategoría
    const textoNorm=normalizeKey(texto);
    const todasCats=[...catBase,...catExtra,...NOMINA_CATS];
    const todasSubs=[...subMaestra,...NOMINA_SUBS];
    let catFound='',subFound='';
    for(const c of todasCats){if(textoNorm.includes(normalizeKey(c))){catFound=c;break;}}
    for(const s of todasSubs){if(textoNorm.includes(normalizeKey(s))){subFound=s;break;}}

    abrirFormulario(null);
    setTimeout(()=>{
      const impEl=document.getElementById('importe'); if(impEl)impEl.value=imp.toFixed(2);
      const feEl=document.getElementById('fecha'); if(feEl)feEl.value=fechaISO;
      const orEl=document.getElementById('origen'); if(orEl)orEl.value='Gasto';
      if(catFound)llenar('categoria',catBase,catExtra,catFound,{origenActual:'Gasto'});
      if(subFound)llenar('subcategoria',subMaestra,[],subFound,{origenActual:'Gasto'});
      showToast(`✅ ${imp}€${fechaISO!==ahora.toISOString().split('T')[0]?' · '+fechaISO:''}${catFound?' · '+catFound:''}${subFound?' · '+subFound:''}','ok`);
    },300);
  };

  // ==========================
  // DETECCIÓN DE DUPLICADOS
  // ==========================
  const detectarDuplicado=(imp,cat,sub,fecha)=>{
    const ventana=CFG.DUPLICADO_HORAS*3600000;
    const ref=new Date(fecha+'T12:00:00').getTime();
    return movimientos.some(m=>{
      if(m.imp>=0)return false;
      const diff=Math.abs(new Date(m.f+'T12:00:00').getTime()-ref);
      return diff<=ventana&&Math.abs(Math.abs(m.imp)-Math.abs(imp))<0.01&&m.c===cat&&m.s===sub;
    });
  };

  // ==========================
  // ENTRADA RÁPIDA
  // ==========================
  const abrirEntradaRapida=()=>{
    const overlay=document.createElement('div');overlay.className='premium-overlay';
    const sugs=calcSugerencias();
    const sugHtml=sugs.map(s=>`<button onclick="window._erSug('${esc(s.o)}','${esc(s.c)}','${esc(s.s)}')"
      style="background:rgba(255,255,255,.05);border:1px solid rgba(212,175,55,.2);border-radius:10px;padding:8px 12px;color:inherit;cursor:pointer;font-size:13px;text-align:left;margin-bottom:6px;width:100%;display:flex;justify-content:space-between">
      <span><b>${esc(s.c)}</b> · ${esc(s.s)}</span><span style="opacity:.5">${s.count}×</span>
    </button>`).join('');
    overlay.innerHTML=`<div class="premium-content">
      <div class="premium-title">⚡ ENTRADA RÁPIDA</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;align-items:center">
        <input id="_qkImp" type="number" inputmode="decimal" placeholder="0.00" min="0" step="0.01"
          style="flex:1;padding:14px;border-radius:12px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:22px;font-weight:700;text-align:center;outline:none">
        <span style="font-size:20px;opacity:.5">€</span>
      </div>
      ${sugHtml}
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-silver" id="_qkFull" style="flex:1;font-size:12px">Formulario completo</button>
        <button class="btn-silver" id="_qkClose" style="flex:1;font-size:12px">Cancelar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    setTimeout(()=>overlay.querySelector('#_qkImp')?.focus(),100);
    overlay.querySelector('#_qkClose').onclick=()=>overlay.remove();
    overlay.querySelector('#_qkFull').onclick=()=>{overlay.remove();abrirFormulario();};
    window._erSug=(origen,cat,sub)=>{
      const imp=parseFloat(overlay.querySelector('#_qkImp')?.value||'0');
      if(!imp||isNaN(imp)){showToast('Introduce el importe primero','warn');return;}
      overlay.remove();
      const fecha=new Date().toISOString().split('T')[0];
      if(detectarDuplicado(imp,cat,sub,fecha)){if(!confirm(`Ya existe un gasto similar de ${imp}€ en ${cat}·${sub} hoy. ¿Añadir igualmente?`))return;}
      const m={id:`id_${Date.now()}`,f:fecha,o:origen,c:cat,s:sub,imp:-Math.abs(imp),d:'',ts:Date.now()};
      movimientos.push(m);if(movimientos.length%15===0)ejecutarBackupRotativo();
      invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('entrada-rapida');
      showToast(`✅ ${imp}€ · ${cat}`);resetPagina();mostrar();
    };
  };

  // ==========================
  // ESCANEO DE TICKETS (OCR via Anthropic API)
  // ==========================
  const escanearTicket=()=>{
    const input=document.createElement('input');input.type='file';input.accept='image/*';input.capture='environment';
    input.onchange=async(e)=>{
      const file=e.target.files?.[0];if(!file)return;
      showToast('📷 Analizando ticket...','ok');
      try{
        const base64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(file);});
        const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:300,
            messages:[{role:'user',content:[
              {type:'image',source:{type:'base64',media_type:file.type||'image/jpeg',data:base64}},
              {type:'text',text:`Analiza este ticket y extrae SOLO en JSON sin markdown:\n{"importe":numero,"fecha":"YYYY-MM-DD o null","descripcion":"breve o null","categoria_sugerida":"una de: ${[...catBase,...catExtra].join(',')} o null"}\nSi no hay ticket responde {"error":"no_ticket"}`}
            ]}]})});
        const data=await resp.json();
        const texto=data.content?.[0]?.text||'{}';
        let parsed;try{parsed=JSON.parse(texto.replace(/```json|```/g,'').trim());}catch{parsed={error:'parse'};}
        if(parsed.error){showToast('No se detectó ticket válido','warn');return;}
        showToast(`✅ Ticket ${parsed.importe}€ detectado`,'ok');
        abrirFormulario(null);
        setTimeout(()=>{
          if(parsed.importe){const el=document.getElementById('importe');if(el)el.value=Math.abs(parsed.importe).toFixed(2);}
          if(parsed.fecha){const el=document.getElementById('fecha');if(el)el.value=parsed.fecha;}
          if(parsed.descripcion){const el=document.getElementById('descripcion');if(el)el.value=parsed.descripcion;}
          const orEl=document.getElementById('origen');if(orEl)orEl.value='Gasto';
          if(parsed.categoria_sugerida&&parsed.categoria_sugerida!=='null')llenar('categoria',catBase,catExtra,parsed.categoria_sugerida,{origenActual:'Gasto'});
        },300);
      }catch(err){console.error(err);showToast('Error al analizar el ticket','err');}
    };
    input.click();
  };

  // ==========================
  // EDICIÓN MASIVA
  // ==========================
  const toggleModoMasivo=()=>{_modoMasivo=!_modoMasivo;_seleccionMasiva.clear();mostrar();showToast(_modoMasivo?'Selecciona registros para editar':'Modo masivo desactivado',_modoMasivo?'ok':'warn');};
  const toggleSeleccion=(id)=>{if(_seleccionMasiva.has(id))_seleccionMasiva.delete(id);else _seleccionMasiva.add(id);mostrar();};
  const abrirEdicionMasiva=()=>{
    if(!_seleccionMasiva.size){showToast('Selecciona al menos un registro','warn');return;}
    const overlay=document.createElement('div');overlay.className='premium-overlay';
    const cats=[...new Set([...catBase,...catExtra])].sort(),subs=[...subMaestra].sort();
    overlay.innerHTML=`<div class="premium-content"><div class="premium-title">EDITAR ${_seleccionMasiva.size} REGISTRO(S)</div>
      <p style="font-size:12px;opacity:.6;margin-bottom:12px">Solo se cambian los campos que rellenes</p>
      <select id="_masivaCat" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(212,175,55,.3);background:rgba(255,255,255,.07);color:inherit;font-size:14px;margin-bottom:8px">
        <option value="">— Categoría (sin cambiar) —</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
      <select id="_masivaSub" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(212,175,55,.3);background:rgba(255,255,255,.07);color:inherit;font-size:14px;margin-bottom:8px">
        <option value="">— Subcategoría (sin cambiar) —</option>${subs.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select>
      <select id="_masivaOrigen" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(212,175,55,.3);background:rgba(255,255,255,.07);color:inherit;font-size:14px;margin-bottom:14px">
        <option value="">— Origen (sin cambiar) —</option>${origenBase.map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>
      <div style="display:flex;gap:8px">
        <button class="btn-silver" id="_masivaAplicar" style="flex:1">APLICAR</button>
        <button class="btn-silver" id="_masivaEliminar" style="flex:1;color:var(--danger)">ELIMINAR</button>
        <button class="btn-silver" id="_masivaCerrar" style="flex:1">CANCELAR</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_masivaCerrar').onclick=()=>overlay.remove();
    overlay.querySelector('#_masivaAplicar').onclick=()=>{
      const cat=overlay.querySelector('#_masivaCat').value,sub=overlay.querySelector('#_masivaSub').value,origen=overlay.querySelector('#_masivaOrigen').value;
      if(!cat&&!sub&&!origen){showToast('Selecciona al menos un campo','warn');return;}
      movimientos=movimientos.map(m=>{if(!_seleccionMasiva.has(m.id))return m;const u={...m,ts:Date.now()};if(cat)u.c=cat;if(sub)u.s=sub;if(origen){u.o=origen;u.imp=origen==='Gasto'?-Math.abs(m.imp):Math.abs(m.imp);}return u;});
      invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('masiva');
      showToast(`✅ ${_seleccionMasiva.size} registros actualizados`);_seleccionMasiva.clear();_modoMasivo=false;overlay.remove();mostrar();
    };
    overlay.querySelector('#_masivaEliminar').onclick=()=>{
      if(!confirm(`¿Eliminar ${_seleccionMasiva.size} registro(s)?`))return;
      movimientos=movimientos.filter(m=>!_seleccionMasiva.has(m.id));
      invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('masiva-delete');
      showToast(`🗑️ ${_seleccionMasiva.size} eliminados`,'warn');_seleccionMasiva.clear();_modoMasivo=false;overlay.remove();mostrar();
    };
  };

  // ==========================
  // META DE AHORRO
  // ==========================
  const abrirMetaAhorro=()=>{
    const overlay=document.createElement('div');overlay.className='premium-overlay';
    overlay.innerHTML=`<div class="premium-content" style="text-align:center"><div class="premium-title">🎯 META DE AHORRO</div>
      <p style="opacity:.7;font-size:13px;margin-bottom:16px">¿Cuánto quieres ahorrar este mes?</p>
      <input id="_metaVal" type="number" min="0" step="50" value="${metaAhorro||''}" placeholder="0"
        style="width:100%;padding:14px;border-radius:12px;border:1px solid rgba(212,175,55,.4);background:rgba(255,255,255,.07);color:inherit;font-size:24px;font-weight:700;text-align:center;margin-bottom:6px;box-sizing:border-box">
      <div style="font-size:12px;opacity:.5;margin-bottom:16px">€ / mes</div>
      <div style="display:flex;gap:8px"><button class="btn-silver" id="_metaOk" style="flex:1">GUARDAR</button><button class="btn-silver" id="_metaCancel" style="flex:1">CANCELAR</button></div></div>`;
    document.body.appendChild(overlay);
    setTimeout(()=>overlay.querySelector('#_metaVal')?.focus(),100);
    overlay.querySelector('#_metaCancel').onclick=()=>overlay.remove();
    overlay.querySelector('#_metaOk').onclick=()=>{const v=parseFloat(overlay.querySelector('#_metaVal').value||'0');metaAhorro=v>=0?v:0;lsSet('meta_ahorro_v1',metaAhorro);showToast(metaAhorro>0?`🎯 Meta: ${metaAhorro}€/mes guardada`:'Meta eliminada');overlay.remove();mostrar();};
  };

  // ==========================
  // EXPORT PDF MENSUAL
  // ==========================
  const exportarPDFMensual=()=>{
    const ahora=new Date(),mesActual=ahora.getMonth(),añoActual=ahora.getFullYear();
    const gastosMes=movimientos.filter(m=>{const d=(m.f||'').split('-');return parseInt(d[0])===añoActual&&parseInt(d[1])-1===mesActual;}).sort((a,b)=>new Date(a.f)-new Date(b.f));
    if(!gastosMes.length){showToast('No hay datos este mes','warn');return;}
    const totalGasto=gastosMes.filter(m=>m.imp<0).reduce((s,m)=>s+Math.abs(m.imp),0);
    const totalIngreso=gastosMes.filter(m=>m.imp>0).reduce((s,m)=>s+m.imp,0);
    const balance=totalIngreso-totalGasto,mesNombre=mesesLabel[mesActual];
    const porCat={};gastosMes.filter(m=>m.imp<0).forEach(m=>{porCat[m.c]=(porCat[m.c]||0)+Math.abs(m.imp);});
    const topCats=Object.entries(porCat).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const barW=200,barMax=topCats[0]?.[1]||1;
    const barsHtml=topCats.map(([c,v])=>`<tr><td style="padding:3px 8px 3px 0;font-size:11px;color:#333">${c}</td><td><div style="width:${Math.round((v/barMax)*barW)}px;height:10px;background:#d4af37;border-radius:3px;display:inline-block"></div></td><td style="padding:3px 0 3px 8px;font-size:11px;color:#333;text-align:right">${v.toFixed(2)}€</td></tr>`).join('');
    const rowsHtml=gastosMes.map(m=>`<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:4px 6px;font-size:10px;color:#666">${m.f.split('-').reverse().join('/')}</td><td style="padding:4px 6px;font-size:10px">${m.o}</td><td style="padding:4px 6px;font-size:10px">${m.c}</td><td style="padding:4px 6px;font-size:10px">${m.s}</td><td style="padding:4px 6px;font-size:10px;text-align:right;color:${m.imp<0?'#dc2626':'#16a34a'};font-weight:600">${m.imp.toFixed(2)}€</td><td style="padding:4px 6px;font-size:10px;color:#999">${m.d||''}</td></tr>`).join('');
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Informe ${mesNombre} ${añoActual}</title>
    <style>body{font-family:Arial,sans-serif;color:#333;padding:30px;max-width:800px;margin:0 auto}h1{color:#d4af37;border-bottom:2px solid #d4af37;padding-bottom:8px}.resumen{display:flex;gap:20px;margin:20px 0;flex-wrap:wrap}.card-r{background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:14px 20px;flex:1;min-width:130px;text-align:center}.card-r .val{font-size:22px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:10px}th{background:#d4af37;color:#fff;padding:6px 8px;font-size:11px;text-align:left}@media print{button{display:none}}</style></head><body>
    <h1>📊 Informe de ${mesNombre} ${añoActual}</h1>
    <div class="resumen">
      <div class="card-r"><div style="font-size:11px;opacity:.6">INGRESOS</div><div class="val" style="color:#16a34a">+${totalIngreso.toFixed(2)}€</div></div>
      <div class="card-r"><div style="font-size:11px;opacity:.6">GASTOS</div><div class="val" style="color:#dc2626">-${totalGasto.toFixed(2)}€</div></div>
      <div class="card-r"><div style="font-size:11px;opacity:.6">BALANCE</div><div class="val" style="color:${balance>=0?'#16a34a':'#dc2626'}">${balance>=0?'+':''}${balance.toFixed(2)}€</div></div>
      ${metaAhorro>0?`<div class="card-r"><div style="font-size:11px;opacity:.6">META AHORRO</div><div class="val" style="color:${balance>=metaAhorro?'#16a34a':'#f59e0b'}">${metaAhorro.toFixed(0)}€</div></div>`:''}
    </div>
    <h2 style="font-size:14px;color:#d4af37;margin-top:24px">TOP CATEGORÍAS</h2><table><tbody>${barsHtml}</tbody></table>
    <h2 style="font-size:14px;color:#d4af37;margin-top:24px">DETALLE</h2>
    <table><thead><tr><th>Fecha</th><th>Origen</th><th>Categoría</th><th>Subcategoría</th><th>Importe</th><th>Descripción</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <p style="font-size:10px;color:#999;margin-top:20px;text-align:right">Generado el ${new Date().toLocaleDateString('es-ES')} · Mis Gastos v23</p>
    <button onclick="window.print()" style="margin-top:16px;padding:10px 20px;background:#d4af37;color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:700">🖨️ Guardar como PDF</button>
    </body></html>`;
    const blob=new Blob([html],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:`informe_${mesNombre}_${añoActual}.html`});
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    showToast('📄 Abre el archivo y usa "Guardar como PDF"');
  };

  // ==========================
  // COMPARATIVA AÑO VS AÑO
  // ==========================
  const renderComparativaAnual=()=>{
    const overlay=document.createElement('div');overlay.className='premium-overlay';
    const ahora=new Date(),añoA=ahora.getFullYear(),añoB=añoA-1;
    const mesesC=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const datosA=Array.from({length:12},(_,i)=>calcEstadisticasMes(añoA,i).total);
    const datosB=Array.from({length:12},(_,i)=>calcEstadisticasMes(añoB,i).total);
    const maxVal=Math.max(...datosA,...datosB,1);
    const fmtE=(n)=>n>0?`${Math.round(n).toLocaleString('es')}€`:'—';
    const filas=Array.from({length:12},(_,i)=>{
      const diff=datosA[i]-datosB[i],col=diff>0?'var(--danger)':diff<0?'var(--success)':'inherit';
      const pA=Math.round((datosA[i]/maxVal)*100),pB=Math.round((datosB[i]/maxVal)*100);
      return`<div style="display:grid;grid-template-columns:30px 1fr 80px;gap:6px;align-items:center;margin-bottom:8px;font-size:12px">
        <span style="opacity:.6">${mesesC[i]}</span>
        <div><div style="height:7px;background:var(--danger);border-radius:3px;width:${pA}%;margin-bottom:2px"></div><div style="height:7px;background:rgba(212,175,55,.4);border-radius:3px;width:${pB}%"></div></div>
        <div style="text-align:right"><div style="color:var(--danger)">${fmtE(datosA[i])}</div><div style="opacity:.5">${fmtE(datosB[i])}</div>${diff!==0?`<div style="font-size:10px;color:${col}">${diff>0?'↑':'↓'}${Math.abs(Math.round(diff))}€</div>`:''}</div>
      </div>`;
    }).join('');
    overlay.innerHTML=`<div class="premium-content" style="max-height:80vh;overflow:auto">
      <div class="premium-title">📅 ${añoA} vs ${añoB}</div>
      <div style="display:flex;gap:16px;margin-bottom:14px;font-size:12px">
        <span><div style="width:12px;height:7px;background:var(--danger);border-radius:2px;display:inline-block;margin-right:4px"></div>${añoA}</span>
        <span><div style="width:12px;height:7px;background:rgba(212,175,55,.4);border-radius:2px;display:inline-block;margin-right:4px"></div>${añoB}</span>
      </div>${filas}
      <button class="btn-silver" id="_compCerrar" style="width:100%;margin-top:12px">CERRAR</button></div>`;
    document.body.appendChild(overlay);overlay.querySelector('#_compCerrar').onclick=()=>overlay.remove();
  };

  // ==========================
  // RESUMEN SEMANAL AUTOMÁTICO
  // ==========================
  const checkResumenSemanal=()=>{
    const hoy=new Date(),lunes=new Date(hoy);lunes.setDate(hoy.getDate()-((hoy.getDay()+6)%7));
    const lunesISO=lunes.toISOString().split('T')[0];
    if(lsRaw('resumen_semanal_last','')===lunesISO)return;
    lsRawSet('resumen_semanal_last',lunesISO);
    const lunesAnt=new Date(lunes);lunesAnt.setDate(lunes.getDate()-7);
    const domAnt=new Date(lunes);domAnt.setDate(lunes.getDate()-1);
    const la=lunesAnt.toISOString().split('T')[0],da=domAnt.toISOString().split('T')[0];
    const semAnt=movimientos.filter(m=>m.imp<0&&m.f>=la&&m.f<=da);
    if(!semAnt.length)return;
    const total=semAnt.reduce((s,m)=>s+Math.abs(m.imp),0);
    const la2=new Date(lunesAnt);la2.setDate(la2.getDate()-7);const da2=new Date(lunesAnt);da2.setDate(da2.getDate()-1);
    const semAA=movimientos.filter(m=>m.imp<0&&m.f>=la2.toISOString().split('T')[0]&&m.f<=da2.toISOString().split('T')[0]);
    const totalAA=semAA.reduce((s,m)=>s+Math.abs(m.imp),0);
    const diff=total-totalAA,pct=totalAA>0?Math.round(Math.abs(diff)/totalAA*100):0;
    setTimeout(()=>showToast(`📅 Semana pasada: ${Math.round(total)}€${totalAA>0?(diff>0?` ↑${pct}%`:` ↓${pct}%`):''}`,diff>0?'warn':'ok'),2000);
  };

  // ==========================
  const isInteractive=(el)=>!!(el?.closest('button,a,select,input,textarea,label,[role="button"],[tabindex]'));
  let _lastTap=0; const TAP_WINDOW=250;
  const toggleFullscreenUI=()=>{
    fullscreenMode=!fullscreenMode;
    const d=fullscreenMode?'none':'';
    document.querySelector('.filtros-wrapper')?.style.setProperty('display',d);
    document.querySelector('.footer-controles')?.style.setProperty('display',d);
    requestAnimationFrame(mostrar);
    try{sessionStorage.setItem('ui_fullscreen',fullscreenMode?'1':'0');}catch{}
  };
  const armRotateIfGraficosNow=()=>{
    const modo=document.getElementById('movimientos')?.dataset?.modo||'lista';
    if(modo!=='graficos'&&modo!=='graficos2')return;
    rotateReady=!rotateReady;
    try{rotateReady?sessionStorage.setItem('rotate_ready','1'):sessionStorage.removeItem('rotate_ready');}catch{}
  };
  const bindGuardarHandlers=()=>{
    const form=document.getElementById('form');
    if(form&&!form.__boundSubmit){form.addEventListener('submit',e=>{e.preventDefault();guardar();});form.__boundSubmit=true;}
    const btn=document.querySelector('#btnGuardar,#guardar,button[data-guardar]');
    if(btn&&!btn.__boundClick){btn.addEventListener('click',e=>{e.preventDefault();guardar();});btn.__boundClick=true;}
  };
  const initDOM=()=>{
    ensureDefaultPinHash().catch(console.error);
    renderPinDots(); updateDots();
    if(document.documentElement)document.documentElement.style.touchAction='manipulation';
    if(document.body)document.body.style.touchAction='manipulation';
    try{if(sessionStorage.getItem('ui_fullscreen')==='1'){fullscreenMode=true;toggleFullscreenUI();}}catch{}
    try{if(sessionStorage.getItem('rotate_ready')==='1')rotateReady=true;}catch{}
    window.addEventListener('touchstart',ev=>{
      if(isInteractive(ev.target))return;
      const t=Date.now();
      if(t-_lastTap<=TAP_WINDOW){ev.preventDefault();toggleFullscreenUI();armRotateIfGraficosNow();_lastTap=0;}
      else _lastTap=t;
    },{passive:false});
    window.addEventListener('dblclick',ev=>{
      if(isInteractive(ev.target))return;
      ev.preventDefault();toggleFullscreenUI();armRotateIfGraficosNow();
    },{passive:false});
    bindGuardarHandlers();
    const iv=document.getElementById('ieVolver');if(iv)iv.onclick=()=>setModo('lista');
  };
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',initDOM):initDOM();

  const handleRotationRedraw=()=>{
    if(!rotateReady)return;
    const modo=document.getElementById('movimientos')?.dataset?.modo||'lista';
    if(modo==='graficos'||modo==='graficos2'){try{captureFooterAnchors();}catch{}mostrar();}
  };
  if(screen.orientation?.addEventListener)screen.orientation.addEventListener('change',handleRotationRedraw);
  window.addEventListener('orientationchange',handleRotationRedraw);
  let _lastIsLandscape=null;
  window.addEventListener('resize',()=>{
    if(!rotateReady)return;
    const iL=window.innerWidth>window.innerHeight;
    if(_lastIsLandscape!==null&&iL!==_lastIsLandscape)handleRotationRedraw();
    _lastIsLandscape=iL;
  });

  // ==========================
  // ICONOS SVG
  // ==========================
  const iconBars  =()=>`<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke="black" stroke-width="3"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
  const iconBack  =()=>`<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke="black" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 19l-7-7 7-7"/></svg>`;
  const iconGraph2=()=>`<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke-width="2.6"><rect x="6" y="7" width="4" height="10" fill="#ef4444" stroke="#ef4444" rx="1"/><rect x="14" y="5" width="4" height="12" fill="#22c55e" stroke="#22c55e" rx="1"/></svg>`;
  const iconCasa  =()=>`<svg viewBox="0 0 24 24"><path d="M3 10.5 L12 3 L21 10.5"/><path d="M5 10.5 V20 H10 V15 H14 V20 H19 V10.5"/></svg>`;
  const iconHome  =()=>`<svg viewBox="0 0 24 24" class="btn-icon" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>`;

  // ==========================
  // VISTAS
  // ==========================
  const setModo=(modo)=>{
    const m=document.getElementById('movimientos');const from=m.dataset.modo||'lista';
    if((modo==='graficos'||modo==='graficos2')&&from==='lista'){captureFooterAnchors();captureBalanceRef();}
    m.dataset.modo=modo;resetPagina();mostrar();
  };
  const toggleCasa=()=>{ hideCasa=!hideCasa; const m=document.getElementById('movimientos'); if(m?.dataset?.modo==='graficos'||m?.dataset?.modo==='graficos2')mostrar(); };
  const isCasaCategory=(cat)=>{ const k=canonicalizeLabel(cat||''); return k.includes('compra casa')||k.includes('compra garaje')||k.includes('venta casa'); };

  // ==========================
  // FOOTER
  // ==========================
  let footerAnchors={leftX:null,centerX:null,size:65};
  const captureFooterAnchors=()=>{try{const fr=document.querySelector('.footer-row');if(!fr)return;const p=fr.querySelectorAll('.plus');if(!p[0]||!p[1])return;const r=fr.getBoundingClientRect();footerAnchors.leftX=p[0].getBoundingClientRect().left-r.left;footerAnchors.centerX=p[1].getBoundingClientRect().left-r.left;footerAnchors.size=Math.round(p[1].getBoundingClientRect().width||65);}catch{}};
  const ensureRealButtons=()=>{
    const fr=document.querySelector('.footer-row');if(!fr)return{btnLeft:null,btnCenter:null,btnRight:null};
    const buttons=Array.from(fr.querySelectorAll('.plus')).slice(0,2);
    const modo=document.getElementById('movimientos')?.dataset?.modo||'lista';
    let btnRight=document.getElementById('btnRightReal');
    if(modo==='graficos'||modo==='graficos2'){if(!btnRight){btnRight=document.createElement('button');btnRight.id='btnRightReal';btnRight.className='plus';fr.appendChild(btnRight);}}
    else{btnRight?.remove();btnRight=null;}
    return{btnLeft:buttons[0]||null,btnCenter:buttons[1]||null,btnRight};
  };
  const resetBtn=(b)=>{if(!b)return;b.style.position=b.style.left=b.style.top=b.style.transform='';b.style.opacity='1';b.style.display=b.style.pointerEvents='';};
  const layoutFooterReset=(l,c,r)=>[l,c,r].forEach(resetBtn);
  const _posBtn=(b,left)=>{b.style.position='absolute';b.style.top='50%';b.style.transform='translateY(-50%)';if(left!=null)b.style.left=`${left}px`;};
  const _recentrarCasa=(container,btnLeft,btnCenter,btnRight)=>{
    if(!container||!btnLeft||!btnCenter)return;
    requestAnimationFrame(()=>{
      const fr=container.getBoundingClientRect(),l=btnLeft.getBoundingClientRect(),c=btnCenter.getBoundingClientRect();
      const rv=!!(btnRight&&getComputedStyle(btnRight).display!=='none'&&btnRight.style.opacity!=='0');
      const rL=rv?btnRight.getBoundingClientRect().left-fr.left:(footerAnchors.centerX??(container.clientWidth/2-c.width/2));
      const rW=rv?btnRight.getBoundingClientRect().width:c.width;
      const cL=(l.left-fr.left)+l.width/2,cR=rL+rW/2;
      btnCenter.style.position='absolute';btnCenter.style.top='50%';btnCenter.style.transform='translateY(-50%)';
      btnCenter.style.left=`${Math.round((cL+cR)/2-c.width/2)}px`;
    });
  };
  const layoutFooterGrafico1=(container,btnLeft,btnCenter,btnRight)=>{
    if(!container||!btnLeft||!btnCenter)return;
    if(getComputedStyle(container).position==='static')container.style.position='relative';
    _posBtn(btnLeft,footerAnchors.leftX??20);
    if(btnRight){_posBtn(btnRight,footerAnchors.centerX??(container.clientWidth/2-(footerAnchors.size||65)/2));btnRight.style.display='';btnRight.style.opacity='1';btnRight.style.pointerEvents='auto';}
    document.querySelector('.footer-controles')?.style.setProperty('display',fullscreenMode?'none':'');
    _recentrarCasa(container,btnLeft,btnCenter,btnRight);
  };
  const layoutFooterGrafico2=(container,btnLeft,btnCenter,btnRight)=>{
    if(!container||!btnLeft||!btnCenter)return;
    if(getComputedStyle(container).position==='static')container.style.position='relative';
    _posBtn(btnLeft,footerAnchors.leftX??20);
    if(btnRight){btnRight.style.display='none';btnRight.style.pointerEvents='none';btnRight.style.opacity='0';}
    document.querySelector('.footer-controles')?.style.setProperty('display',fullscreenMode?'none':'');
    _recentrarCasa(container,btnLeft,btnCenter,null);
  };

  // ==========================
  // BALANCE
  // ==========================
  const captureBalanceRef=()=>{try{const fr=document.querySelector('.footer-row')?.getBoundingClientRect(),bl=document.getElementById('balance')?.getBoundingClientRect();if(fr&&bl)balanceRightRef=Math.max(0,Math.round(fr.right-bl.right));}catch{}};
  const layoutBalanceFixedUnified=()=>{const fr=document.querySelector('.footer-row'),bl=document.getElementById('balance');if(!fr||!bl)return;if(getComputedStyle(fr).position==='static')fr.style.position='relative';const r=balanceRightRef??Math.max(0,parseFloat(getComputedStyle(document.querySelector('.footer-controles')||fr).paddingRight||'12'));Object.assign(bl.style,{position:'absolute',top:'50%',transform:'translateY(-50%)',right:`${r}px`});};
  const layoutBalanceResetUnified=()=>{const b=document.getElementById('balance');if(b)b.style.position=b.style.right=b.style.top=b.style.transform='';};

  // ==========================
  // FILTRADO CON CACHÉ
  // ==========================
  const calcFiltrados=(fs)=>{
    const key=fs.join('|')+'|'+(_searchQuery||'')+'|'+movimientos.length;
    if(_filterCache.key===key)return _filterCache.result;
    let result=movimientos.filter(m=>{const dv=(m.f||'').split('-');return(fs[0]==='TODOS'||(parseInt(dv[1])-1).toString()===fs[0])&&(fs[1]==='TODOS'||dv[0]===fs[1])&&(fs[2]==='TODAS'||m.c===fs[2])&&(fs[3]==='TODAS'||m.s===fs[3])&&(fs[4]==='TODOS'||m.o===fs[4]);}).sort((a,b)=>new Date(b.f)-new Date(a.f));
    result=applySearch(result);
    _filterCache={key,result};return result;
  };
  const invalidateFilterCache=()=>{_filterCache.key=null;};

  // ==========================
  // MOSTRAR
  // ==========================
  function mostrar() {
    const movDiv=document.getElementById('movimientos'); if(!movDiv||movDiv.dataset.permiso!=='OK')return;
    const listaDiv=document.getElementById('lista'),impPage=document.getElementById('importExport');
    const modo=movDiv.dataset.modo||'lista';
    const modoInicio=lsRaw('modo_inicio','dashboard');

    const d=fullscreenMode?'none':'';
    document.querySelector('.filtros-wrapper')?.style.setProperty('display',d);
    document.querySelector('.footer-controles')?.style.setProperty('display',d);

    const fs=['filtroMes','filtroAño','filtroCat','filtroSub','filtroOri'].map(id=>document.getElementById(id)?.value??'TODOS');
    filtradosGlobal=calcFiltrados(fs);

    const factor=fs[0]==='TODOS'?12:1;
    let total=0; for(const m of filtradosGlobal)if(!hideCasa||!isCasaCategory(m.c))total+=Number(m.imp)||0;
    const balEl=document.getElementById('balance');
    if(balEl){
      balEl.textContent=total.toFixed(2)+' €';
      balEl.style.color=total<0?'var(--danger)':total<=CFG.BALANCE_WARNING*factor?'var(--warning)':total<=CFG.BALANCE_OK*factor?'var(--success)':'var(--electric-blue)';
      balEl.onclick=()=>setModo('importexport');
    }

    if(impPage)impPage.classList.toggle('hidden',modo!=='importexport');
    if(modo==='importexport'){if(listaDiv)listaDiv.innerHTML='';return;}

    const footerRow=document.querySelector('.footer-row');
    const{btnLeft,btnCenter,btnRight}=ensureRealButtons();
    [btnLeft,btnCenter,btnRight].forEach(b=>{if(!b)return;b.onclick=null;b.classList.remove('plus-like','btn-house-anim','active');resetBtn(b);});
    const aplCasa=()=>btnCenter?.classList.toggle('active',!!hideCasa);

    if(modo==='graficos'){
      captureFooterAnchors();
      if(btnLeft){btnLeft.innerHTML=iconBack();btnLeft.onclick=()=>setModo('lista');}
      if(btnCenter){btnCenter.innerHTML=iconCasa();btnCenter.classList.add('btn-house-anim');btnCenter.onclick=()=>{toggleCasa();aplCasa();};aplCasa();}
      if(btnRight){btnRight.innerHTML=iconGraph2();btnRight.onclick=()=>setModo('graficos2');}
      layoutFooterGrafico1(footerRow,btnLeft,btnCenter,btnRight);
      layoutBalanceFixedUnified();
      if(listaDiv){listaDiv.innerHTML='';renderizarBarrasGraficos(factor);}
    } else if(modo==='graficos2'){
      captureFooterAnchors();
      if(btnLeft){btnLeft.innerHTML=iconBack();btnLeft.onclick=()=>setModo('graficos');}
      if(btnCenter){btnCenter.innerHTML=iconCasa();btnCenter.classList.add('btn-house-anim');btnCenter.onclick=()=>{toggleCasa();aplCasa();};aplCasa();}
      if(btnRight){btnRight.style.display='none';btnRight.style.pointerEvents='none';btnRight.style.opacity='0';}
      layoutFooterGrafico2(footerRow,btnLeft,btnCenter,btnRight);
      layoutBalanceFixedUnified();
      if(listaDiv){listaDiv.innerHTML='';renderizarGraficos2();renderHeatmap();}
    } else {
      // LISTA o DASHBOARD
      if(btnLeft){
        if(modoInicio==='dashboard'){
          btnLeft.innerHTML=iconHome(); btnLeft.classList.add('plus-like');
          btnLeft.onclick=()=>{ lsRawSet('modo_inicio','dashboard'); resetPagina(); mostrar(); };
        } else {
          btnLeft.innerHTML=iconBars(); btnLeft.classList.add('plus-like');
          btnLeft.onclick=()=>{ captureBalanceRef(); setModo('graficos'); };
        }
      }
      if(btnCenter){btnCenter.innerHTML='+';btnCenter.onclick=()=>abrirFormulario();}
      layoutFooterReset(btnLeft,btnCenter,btnRight);
      layoutBalanceResetUnified();

      if(modoInicio==='dashboard'&&movimientos.length>0){
        // Ocultar filtros en dashboard
        document.querySelector('.filtros-wrapper')?.style.setProperty('display','none');
        if(listaDiv) renderDashboard();
      } else {
        if(modo==='lista') ensureSearchBar();
        if(listaDiv){
          if(_modoMasivo){
            const slice=filtradosGlobal.slice(0,registrosVisibles);
            listaDiv.innerHTML=`<div style="background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.3);border-radius:12px;padding:10px 14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:13px">✏️ Modo masivo · ${_seleccionMasiva.size} sel.</span>
              <div style="display:flex;gap:6px">
                <button onclick="abrirEdicionMasiva()" class="btn-silver" style="font-size:11px;padding:5px 10px">Editar</button>
                <button onclick="toggleModoMasivo()" class="btn-silver" style="font-size:11px;padding:5px 10px">Salir</button>
              </div></div>`
            +slice.map(m=>{const sel=_seleccionMasiva.has(m.id);return`<div onclick="toggleSeleccion('${m.id}')" style="cursor:pointer;border-left:4px solid ${sel?'var(--primary)':m.imp>=0?'var(--success)':'var(--danger)'};background:${sel?'rgba(212,175,55,.1)':'transparent'}" class="card"><div style="display:flex;justify-content:space-between"><div><div class="meta">${esc(m.f.split('-').reverse().join('/'))} • ${esc(m.o)}</div><b>${esc(m.c)} - ${esc(m.s)}</b></div><div style="display:flex;align-items:center;gap:8px"><div class="monto" style="color:${m.imp>=0?'var(--success)':'var(--danger)'}">${(Number(m.imp)||0).toFixed(2)} €</div><div style="width:20px;height:20px;border-radius:50%;border:2px solid ${sel?'var(--primary)':'rgba(255,255,255,.3)'};background:${sel?'var(--primary)':'transparent'};display:flex;align-items:center;justify-content:center;font-size:11px">${sel?'✓':''}</div></div></div></div>`;}).join('');
          }else{
            const slice=filtradosGlobal.slice(0,registrosVisibles);
            listaDiv.innerHTML=slice.length?slice.map(m=>`
              <div class="card" onclick="abrirFormulario('${m.id}')" style="border-left-color:${m.imp>=0?'var(--success)':'var(--danger)'}">
                <div class="meta">${esc(m.f.split('-').reverse().join('/'))} • ${esc(m.o)}</div>
                <b>${esc(m.c)} - ${esc(m.s)}</b>
                ${m.d?`<div style="font-size:12px;opacity:.8">${esc(m.d)}</div>`:''}
                <div class="monto" style="color:${m.imp>=0?'var(--success)':'var(--danger)'}">${(Number(m.imp)||0).toFixed(2)} €</div>
              </div>`).join(''):`<div class="card" style="text-align:center;border:none;opacity:.7">No hay registros.</div>`;
            const loader=document.getElementById('loader');if(loader)loader.style.display='none';
          }
        }
        captureBalanceRef();
        if(movimientos.length>5&&fs[0]!=='TODOS'&&listaDiv)renderInsightPanel();
      }
    }
  }

  window.addEventListener('resize',debounce(()=>{
    const modo=document.getElementById('movimientos')?.dataset?.modo||'lista';
    if(modo!=='graficos'&&modo!=='graficos2')return;
    const fr=document.querySelector('.footer-row');
    const{btnLeft,btnCenter,btnRight}=ensureRealButtons();
    (modo==='graficos'?layoutFooterGrafico1:layoutFooterGrafico2)(fr,btnLeft,btnCenter,btnRight);
    layoutBalanceFixedUnified();
  },150));

  // ==========================
  // GRÁFICOS 1
  // ==========================
  const renderizarBarrasGraficos=(f)=>{
    const lista=document.getElementById('lista');
    const filtroCat=document.getElementById('filtroCat')?.value||'TODAS';
    const fuente=hideCasa?filtradosGlobal.filter(m=>!isCasaCategory(m.c)):filtradosGlobal;
    const totales={};
    for(const m of fuente){if(m.imp>=0)continue;const key=filtroCat==='TODAS'?m.c:(m.c===filtroCat?m.s:null);if(key)totales[key]=(totales[key]||0)+Math.abs(m.imp);}
    const items=Object.entries(totales).sort((a,b)=>b[1]-a[1]),max=Math.max(...Object.values(totales),1);
    const t1=CFG.BAR_TIER1*f,t2=CFG.BAR_TIER2*f,t3=CFG.BAR_TIER3*f;
    const titulo=filtroCat==='TODAS'?'ANÁLISIS DE GASTO POR CATEGORÍAS':`SUBCATEGORÍAS DE ${filtroCat}`;
    let html=`<h2 style="color:var(--primary);font-size:18px;text-align:center">${titulo}</h2>
      <div style="display:flex;justify-content:center;gap:15px;margin-bottom:25px;font-size:19px;font-weight:900">
        <span style="color:var(--electric-blue)">0-${t1}€</span><span style="color:var(--success)">${t2}€</span>
        <span style="color:var(--warning)">${t3}€</span><span style="color:var(--danger)">+</span>
      </div>`;
    if(!items.length){lista.innerHTML=html+`<div class="card" style="text-align:center;border:none;opacity:.8">No hay datos.</div>`;return;}
    lista.innerHTML=html+items.map(([label,val])=>{
      const s1=Math.min(val,t1),s2=val>t1?Math.min(val-t1,t2-t1):0,s3=val>t2?Math.min(val-t2,t3-t2):0,s4=val>t3?val-t3:0;
      const pres=presupuestos[label];
      const presHtml=pres?`<div style="margin-top:4px;height:3px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden"><div style="width:${Math.min(100,(val/pres)*100)}%;height:100%;background:${val>pres?'var(--danger)':'rgba(212,175,55,.6)'};border-radius:3px"></div></div>`:'';
      return `<div class="card" style="border:none;background:transparent;cursor:pointer" data-label="${esc(label)}" onclick="handleGraficoBarClick(this.dataset.label)">
        <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:5px">
          <span>${esc(label)}</span><b>${val.toFixed(2)} €${pres?` <span style="font-size:11px;opacity:.5">/ ${pres}€</span>`:''}</b>
        </div>
        <div style="width:${(val/max)*100}%;height:16px;display:flex;background:#000;border-radius:8px;overflow:hidden;border:1px solid rgba(212,175,55,.2)">
          <div style="width:${(s1/val)*100}%;background:var(--electric-blue)"></div>
          <div style="width:${(s2/val)*100}%;background:var(--success)"></div>
          <div style="width:${(s3/val)*100}%;background:var(--warning)"></div>
          <div style="width:${(s4/val)*100}%;background:var(--danger)"></div>
        </div>${presHtml}
      </div>`;
    }).join('');
  };

  const handleGraficoBarClick=(label)=>{const s=document.getElementById('filtroCat');if(!s||s.value==='TODAS'){if(s)s.value=label;resetPagina();mostrar();}else abrirDetalleMovs(s.value,label);};
  const abrirDetalleMovs=(categoria,subcategoria)=>{
    try{
      const base=hideCasa?filtradosGlobal.filter(m=>!isCasaCategory(m.c)):filtradosGlobal;
      const lista=base.filter(m=>m.imp<0&&m.c===categoria&&m.s===subcategoria).sort((a,b)=>new Date(b.f)-new Date(a.f));
      const total=lista.reduce((a,m)=>a+Math.abs(m.imp),0);
      const overlay=document.createElement('div');overlay.className='premium-overlay';
      overlay.innerHTML=`<div class="premium-content" style="max-height:80vh;overflow:auto;text-align:left">
        <div class="premium-title" style="text-align:center">${esc(categoria)} / ${esc(subcategoria)}</div>
        <div style="font-weight:900;color:var(--primary);text-align:center;margin-bottom:10px">Total: ${total.toFixed(2)} €</div>
        ${lista.length?lista.map(m=>`<div class="card" style="margin:10px 0;border-left-color:var(--danger)"><div class="meta">${esc(m.f.split('-').reverse().join('/'))} • ${esc(m.o)}</div>${m.d?`<div style="font-size:13px;opacity:.9;margin-bottom:6px">${esc(m.d)}</div>`:''}<div class="monto" style="color:var(--danger)">${Math.abs(m.imp).toFixed(2)} €</div></div>`).join(''):`<div class="card" style="text-align:center;border:none;opacity:.8">No hay movimientos.</div>`}
        <button class="btn-silver" id="cerrarDetalle">CERRAR</button>
      </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#cerrarDetalle').onclick=()=>overlay.remove();
    }catch(e){console.error(e);showToast('No se pudo abrir el detalle','err');}
  };

  // ==========================
  // GRÁFICOS 2
  // ==========================
  const renderizarGraficos2=()=>{
    const lista=document.getElementById('lista');lista.querySelector('.g2-wrap')?.remove();
    const fs=['filtroMes','filtroAño','filtroCat','filtroSub','filtroOri'].map(id=>document.getElementById(id)?.value??'TODOS');
    const ahora=new Date();
    const meses=Array.from({length:13},(_,i)=>{const d=new Date(ahora.getFullYear(),ahora.getMonth()-(12-i),1);return{d,key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};});
    const base=(hideCasa?movimientos.filter(m=>!isCasaCategory(m.c)):movimientos).filter(m=>(fs[2]==='TODAS'||m.c===fs[2])&&(fs[3]==='TODAS'||m.s===fs[3])&&(fs[4]==='TODOS'||m.o===fs[4]));
    const sumaMes=new Map();
    for(const mov of base){const k=(mov.f||'').slice(0,7);if(meses.some(x=>x.key===k))sumaMes.set(k,(sumaMes.get(k)||0)+(Number(mov.imp)||0));}
    const valores=meses.map(m=>sumaMes.get(m.key)||0),maxAbs=Math.max(...valores.map(Math.abs),1);
    const colorMes=(t)=>t<0?'var(--danger)':t<=CFG.BAR_TIER1*2?'var(--warning)':t<=CFG.BALANCE_WARNING?'var(--success)':'var(--electric-blue)';
    const mesesC=['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const fmtEuro=(n)=>{const v=Number(n)||0;return`${v>=0?'+':'−'}${Math.abs(v).toFixed(2).replace('.',',')} €`;};
    let html=`<div class="g2-wrap"><div class="g2-chart" style="position:relative;height:180px;display:grid;grid-template-columns:repeat(13,1fr);gap:10px;align-items:center;margin-bottom:26px;">
      <div class="g2-baseline" style="position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(212,175,55,.35)"></div>`;
    for(const m of meses){
      const v=sumaMes.get(m.key)||0,h=Math.max(4,(Math.abs(v)/maxAbs)*80),label=mesesC[new Date(m.key+'-01T00:00:00').getMonth()];
      html+=`<div class="g2-col" data-key="${m.key}" style="position:relative;height:100%;">
        <div class="g2-bar ${v>=0?'pos':'neg'}" data-h="${h}" style="height:0px;background:${colorMes(v)};"></div>
        <div class="g2-tip ${v>=0?'tip-pos':'tip-neg'}">${label} ${m.d.getFullYear()}: ${fmtEuro(v)}</div>
        <div class="g2-label" style="position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:10px;color:var(--primary)">${label}</div>
      </div>`;}
    html+=`</div></div>`;
    lista.insertAdjacentHTML('beforeend',html);
    requestAnimationFrame(()=>{lista.querySelectorAll('.g2-chart .g2-bar').forEach(el=>{el.style.height=(parseFloat(el.dataset.h)||0)+'px';});});
    const chart=lista.querySelector('.g2-chart');
    if(chart&&!chart.dataset.tipBound){
      chart.addEventListener('click',ev=>{const col=ev.target.closest('.g2-col');if(!col)return;chart.querySelectorAll('.g2-col.show-tip').forEach(c=>{if(c!==col)c.classList.remove('show-tip');});col.classList.toggle('show-tip');});
      document.addEventListener('click',ev=>{if(!chart.contains(ev.target))chart.querySelectorAll('.g2-col.show-tip').forEach(c=>c.classList.remove('show-tip'));});
      chart.dataset.tipBound='1';
    }
  };

  // ==========================
  // PRESUPUESTOS
  // ==========================
  const abrirPresupuestos=()=>{
    const overlay=document.createElement('div');overlay.className='premium-overlay';
    const cats=[...new Set([...catBase,...catExtra])].sort();
    const rows=cats.map(c=>`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="flex:1;font-size:13px">${esc(c)}</span>
        <input type="number" min="0" placeholder="0" value="${presupuestos[c]||''}" data-cat="${esc(c)}"
          style="width:80px;padding:6px;border-radius:8px;border:1px solid rgba(212,175,55,.3);background:rgba(255,255,255,.07);color:inherit;font-size:13px;text-align:right">
        <span style="font-size:12px;opacity:.5">€/mes</span>
      </div>`).join('');
    overlay.innerHTML=`<div class="premium-content" style="max-height:75vh;overflow:auto">
      <div class="premium-title">PRESUPUESTOS MENSUALES</div>
      <p style="font-size:12px;opacity:.6;margin-bottom:12px">Deja en blanco para no limitar</p>
      ${rows}
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn-silver" id="_presSave" style="flex:1">GUARDAR</button>
        <button class="btn-silver" id="_presClose" style="flex:1">CERRAR</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#_presClose').onclick=()=>overlay.remove();
    overlay.querySelector('#_presSave').onclick=()=>{
      const nuevos={};
      overlay.querySelectorAll('input[data-cat]').forEach(inp=>{const v=parseFloat(inp.value);if(v>0)nuevos[inp.dataset.cat]=v;});
      presupuestos=nuevos;lsSet('presupuestos_v1',presupuestos);
      showToast('✅ Presupuestos guardados');overlay.remove();mostrar();
    };
  };

  // ==========================
  // FORMULARIO / CRUD
  // ==========================
  const llenar=(id,base,extra,pre='',opts={})=>{
    const s=document.getElementById(id);if(!s)return;
    const oA=opts.origenActual||'';
    let values=[...new Set([...base,...extra])];
    if(id==='categoria'&&oA!=='Nómina')values=values.filter(v=>!NOMINA_CATS.includes(v));
    if(id==='subcategoria'&&oA!=='Nómina')values=values.filter(v=>!NOMINA_SUBS.includes(v));
    const oh=values.sort((a,b)=>a.localeCompare(b,'es')).map(v=>`<option value="${v}"${v===pre?' selected':''}>${v}</option>`).join('');
    const hid=(pre&&!values.includes(pre))?`<option value="${pre}" selected hidden>${pre}</option>`:'';
    const an=id!=='origen'?`<option value="+">+ Añadir nuevo...</option>`:'';
    s.innerHTML=`<option value="" disabled${pre===''?' selected':''}>Seleccionar...</option>${oh}${hid}${an}`;
    if(pre)s.value=pre;
  };
  const onOrigenChange=(origenValor,{preCat='',preSub='',esEdicion=false}={})=>{
    const sc=document.getElementById('categoria'),ss=document.getElementById('subcategoria');
    if(origenValor==='Nómina'){
      const mp=preSub||mesFromISO(document.getElementById('fecha')?.value);
      sc.innerHTML=`<option value="" disabled${preCat?'':' selected'}>Seleccionar...</option>`+NOMINA_CATS.map(c=>`<option value="${c}"${c===preCat?' selected':''}>${c}</option>`).join('');
      ss.innerHTML=`<option value="" disabled${mp?'':' selected'}>Seleccionar...</option>`+NOMINA_SUBS.map(m=>`<option value="${m}"${m===mp?' selected':''}>${m}</option>`).join('');
      if(preCat){sc.value=preCat;sc.dispatchEvent(new Event('change',{bubbles:true}));}
      if(mp){ss.value=mp;ss.dispatchEvent(new Event('change',{bubbles:true}));}
      if(!esEdicion)lanzarPopupNomina({preCat,preSub:mp});
    }else{llenar('categoria',catBase,catExtra,preCat,{origenActual:origenValor});llenar('subcategoria',subMaestra,[],preSub,{origenActual:origenValor});}
  };
  const lanzarPopupNomina=({preCat='',preSub=''}={})=>{
    const overlay=document.createElement('div');overlay.className='nomina-overlay';
    overlay.innerHTML=`<div class="nomina-content"><div class="nomina-title">¿QUIÉN COBRA?</div><button class="btn-nomina btn-oskar" id="btn_nom_oskar">OSKAR</button><button class="btn-nomina btn-josune" id="btn_nom_josune">JOSUNE</button><button class="btn-nomina btn-cancel" id="btn_nom_cancel">CANCELAR</button></div>`;
    document.body.appendChild(overlay);
    const close=()=>overlay.remove(),sc=document.getElementById('categoria'),ss=document.getElementById('subcategoria');
    const mp=preSub||mesFromISO(document.getElementById('fecha')?.value);
    ss.innerHTML=`<option value="" disabled${mp?'':' selected'}>Seleccionar...</option>`+NOMINA_SUBS.map(m=>`<option value="${m}"${m===mp?' selected':''}>${m}</option>`).join('');
    if(mp){ss.value=mp;ss.dispatchEvent(new Event('change',{bubbles:true}));}
    const elegir=(n)=>{sc.innerHTML=`<option value="${n}" selected>${n}</option>`;sc.value=n;sc.dispatchEvent(new Event('change',{bubbles:true}));close();};
    document.getElementById('btn_nom_oskar').onclick=()=>elegir('Oskar');
    document.getElementById('btn_nom_josune').onclick=()=>elegir('Josune');
    document.getElementById('btn_nom_cancel').onclick=()=>{document.getElementById('origen').value='Gasto';llenar('categoria',catBase,catExtra,'',{origenActual:'Gasto'});llenar('subcategoria',subMaestra,[],''  ,{origenActual:'Gasto'});close();};
  };
  const abrirFormulario=(id=null)=>{
    const f=document.getElementById('form'),mDiv=document.getElementById('movimientos'),btnD=document.getElementById('btnEliminarRegistro');
    if(id){
      const m=movimientos.find(x=>x.id.toString()===id.toString());
      document.getElementById('editId').value=m.id;document.getElementById('fecha').value=m.f;
      document.getElementById('importe').value=Math.abs(m.imp);document.getElementById('descripcion').value=m.d||'';
      llenar('origen',origenBase,[],m.o);onOrigenChange(m.o,{preCat:m.c,preSub:m.s,esEdicion:true});btnD.classList.remove('hidden');
    }else{
      ['editId','importe','descripcion'].forEach(fId=>{document.getElementById(fId).value='';});
      document.getElementById('fecha').value=new Date().toISOString().split('T')[0];
      llenar('origen',origenBase,[],_lastOrigen||'');onOrigenChange(_lastOrigen||'');
      if(_lastOrigen&&_lastOrigen!=='Nómina'){llenar('categoria',catBase,catExtra,_lastCat,{origenActual:_lastOrigen});llenar('subcategoria',subMaestra,[],_lastSub,{origenActual:_lastOrigen});}
      btnD.classList.add('hidden');
    }
    const so=document.getElementById('origen');so.onchange=()=>onOrigenChange(so.value);
    const fe=document.getElementById('fecha');
    if(fe)fe.onchange=()=>{if(so.value==='Nómina')onOrigenChange('Nómina',{preCat:document.getElementById('categoria')?.value||'',preSub:mesFromISO(fe.value),esEdicion:!!(document.getElementById('editId')?.value)});};
    bindGuardarHandlers();f.classList.remove('hidden');mDiv.classList.add('hidden');
  };
  const guardar=()=>{
    const get=(id)=>(document.getElementById(id)?.value??'').trim();
    const v={editId:get('editId'),origen:get('origen'),categoria:get('categoria'),subcategoria:get('subcategoria'),fecha:get('fecha'),descripcion:get('descripcion'),importeRaw:get('importe')};
    const sc=document.getElementById('categoria'),ss=document.getElementById('subcategoria');
    if(!v.categoria&&sc?.selectedIndex>=0)v.categoria=sc.options[sc.selectedIndex].value||sc.options[sc.selectedIndex].text;
    if(!v.subcategoria&&ss?.selectedIndex>=0)v.subcategoria=ss.options[ss.selectedIndex].value||ss.options[ss.selectedIndex].text;
    const imp=parseEuroNumber(v.importeRaw);
    if(!v.origen||!v.categoria||!v.subcategoria||!v.fecha||isNaN(imp)){showToast('Faltan datos obligatorios','err');return;}
    if(!v.editId&&v.origen==='Gasto'&&detectarDuplicado(imp,v.categoria,v.subcategoria,v.fecha)){
      if(!confirm(`Ya existe un gasto similar de ${imp}€ en ${v.categoria}·${v.subcategoria}. ¿Añadir igualmente?`))return;
    }
    const m={id:v.editId||`id_${Date.now()}`,f:v.fecha,o:v.origen,c:v.categoria,s:v.subcategoria,imp:v.origen==='Gasto'?-Math.abs(imp):Math.abs(imp),d:v.descripcion,ts:Date.now()};
    if(v.editId){const idx=movimientos.findIndex(x=>x.id.toString()===v.editId.toString());if(idx!==-1)movimientos[idx]=m;}
    else{movimientos.push(m);if(movimientos.length%15===0)ejecutarBackupRotativo();}
    if(v.origen==='Gasto'&&presupuestos[v.categoria]){
      const ahora=new Date(),stats=calcEstadisticasMes(ahora.getFullYear(),ahora.getMonth());
      const gast=stats.porCat[v.categoria]||0,lim=presupuestos[v.categoria];
      if(gast>=lim)showToast(`⚠️ Superado presupuesto de ${v.categoria}!`,'warn');
      else if(gast>=lim*0.8)showToast(`⚡ ${v.categoria}: ${Math.round(gast)}€ / ${lim}€`,'warn');
    }
    _lastOrigen=v.origen;_lastCat=v.categoria;_lastSub=v.subcategoria;
    invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('guardar');
    showToast(v.editId?'✏️ Registro actualizado':'✅ Registro guardado');volver();
  };
  const eliminarRegistroActual=()=>{
    const id=document.getElementById('editId')?.value;if(!id)return;
    if(confirm('¿ESTÁS SEGURO DE QUE DESEAS ELIMINAR ESTE REGISTRO?')){
      movimientos=movimientos.filter(m=>m.id.toString()!==id.toString());
      invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('eliminar');
      showToast('🗑️ Registro eliminado','warn');volver();
    }
  };
  const volver=()=>{document.getElementById('form').classList.add('hidden');document.getElementById('movimientos').classList.remove('hidden');actualizarListas();resetPagina();mostrar();};
  const manejarNuevo=(el,tipo)=>{
    if(el.value!=='+')return;
    if(!el.dataset.nuevoValor){const c=(prompt(tipo==='categoria'?'Escribe el nombre de la nueva CATEGORÍA:':'Escribe el nombre de la nueva SUBCATEGORÍA:')||'').trim();if(!c){el.value='';return;}el.dataset.nuevoValor=c;}
    const n=el.dataset.nuevoValor||'';el.dataset.nuevoValor='';if(!n){el.value='';return;}
    const pretty=mostrarBonito(n.trim()),keyNew=canonicalizeLabel(pretty),origen=document.getElementById('origen')?.value||'';
    if(tipo==='categoria'){if(NOMINA_CATS.some(x=>canonicalizeLabel(x)===keyNew)){showToast("No puedes crear manualmente 'Oskar' ni 'Josune'",'err');el.value='';return;}if(!buildCanonIndex(catBase,catExtra).has(keyNew)){catExtra.push(pretty);lsSet('categoriaExtra',catExtra);scheduleSync('listas');}llenar('categoria',catBase,catExtra,pretty,{origenActual:origen});}
    else{if(!buildCanonIndex(subMaestra,[]).has(keyNew)){subMaestra.push(pretty);lsSet('subMaestra_v2',subMaestra);scheduleSync('listas');}llenar('subcategoria',subMaestra,[],pretty,{origenActual:origen});}
  };
  const borrarElemento=(tipo)=>{
    const select=document.getElementById(tipo),val=select?.value;if(!val)return;
    const origen=document.getElementById('origen')?.value||'';
    if(tipo==='categoria'){const idx=catExtra.indexOf(val);if(idx<0){showToast('Solo puedes borrar categorías propias','warn');return;}catExtra.splice(idx,1);lsSet('categoriaExtra',catExtra);scheduleSync('listas');llenar('categoria',catBase,catExtra,'',{origenActual:origen});}
    else if(tipo==='subcategoria'){const idx=subMaestra.indexOf(val);if(idx<0)return;subMaestra.splice(idx,1);lsSet('subMaestra_v2',subMaestra);scheduleSync('listas');llenar('subcategoria',subMaestra,[],''  ,{origenActual:origen});}
  };
  const abrirGraficos=()=>{const m=document.getElementById('movimientos');m.dataset.modo=m.dataset.modo==='graficos'?'lista':'graficos';mostrar();};
  const resetPagina=()=>{registrosVisibles=CFG.SCROLL_BATCH;window.scrollTo(0,0);};
  const actualizarListas=()=>{
    const fC=document.getElementById('filtroCat'),fS=document.getElementById('filtroSub'),fO=document.getElementById('filtroOri');
    if(fC){fC.innerHTML='<option value="TODAS">Cat: TODAS</option>';[...new Set([...catBase,...catExtra,...NOMINA_CATS])].sort().forEach(c=>fC.add(new Option(c,c)));}
    if(fS){fS.innerHTML='<option value="TODAS">Sub: TODAS</option>';[...new Set([...subMaestra,...NOMINA_SUBS])].sort().forEach(s=>fS.add(new Option(s,s)));}
    if(fO){fO.innerHTML='<option value="TODOS">Ori: TODOS</option>';origenBase.forEach(o=>fO.add(new Option(o,o)));}
  };

  // ==========================
  // NORMALIZACIÓN
  // ==========================
  const normalizarListasExistentes=()=>{
    const vc=new Set(catBase.map(canonicalizeLabel));
    catExtra=[...new Set(catExtra)].filter(v=>{const k=canonicalizeLabel(v);if(vc.has(k)||NOMINA_CATS.map(canonicalizeLabel).includes(k))return false;vc.add(k);return true;});lsSet('categoriaExtra',catExtra);
    const vs=new Set();subMaestra=subMaestra.filter(v=>{const k=canonicalizeLabel(v);if(vs.has(k))return false;vs.add(k);return true;});lsSet('subMaestra_v2',subMaestra);
    const ci=buildCanonIndex([...catBase,...catExtra,...NOMINA_CATS],[]),si=buildCanonIndex([...subMaestra,...NOMINA_SUBS],[]);
    let ch=false;
    movimientos=movimientos.map(m=>{const c=ci.get(canonicalizeLabel(m.c))??m.c,s=si.get(canonicalizeLabel(m.s))??m.s;if(c!==m.c||s!==m.s){ch=true;return{...m,c,s,ts:Math.max(Date.now(),(m.ts||0)+1)};}return m;}).sort((a,b)=>new Date(b.f)-new Date(a.f));
    if(ch)lsSet('movimientos',movimientos);
  };

  // ==========================
  // INIT + SCROLL INFINITO
  // ==========================
  const init=()=>{
    const ahora=new Date(),fM=document.getElementById('filtroMes'),fA=document.getElementById('filtroAño');
    if(fM){fM.innerHTML='<option value="TODOS">Mes: TODOS</option>';mesesLabel.forEach((m,i)=>fM.add(new Option(m,i)));fM.value=ahora.getMonth();}
    if(fA){fA.innerHTML='<option value="TODOS">Año: TODOS</option>';for(let a=2020;a<=2030;a++)fA.add(new Option(a,a));fA.value=ahora.getFullYear();}
    normalizarListasExistentes();actualizarListas();bindInfiniteScroll();mostrar();
    checkResumenSemanal();
  };
  let _renderLock=false;
  const bindInfiniteScroll=()=>{
    if(window.__infiniteScrollBound)return;window.__infiniteScrollBound=true;
    window.addEventListener('scroll',()=>{
      if((document.getElementById('movimientos')?.dataset?.modo||'lista')!=='lista')return;
      if(lsRaw('modo_inicio','dashboard')==='dashboard')return; // no scroll infinito en dashboard
      if(window.scrollY+window.innerHeight<document.documentElement.scrollHeight-CFG.SCROLL_THRESHOLD)return;
      if(registrosVisibles>=filtradosGlobal.length||_renderLock)return;
      _renderLock=true;registrosVisibles+=CFG.SCROLL_BATCH;mostrar();_renderLock=false;
    },{passive:true});
  };

  // ==========================
  // CSV EXPORT / IMPORT
  // ==========================
  const exportarCSV=()=>{
    if(!movimientos.length){showToast('No hay datos para exportar','warn');return;}
    const SEP=';',toES=(iso)=>{const[y,m,d]=(iso||'').split('-');return(y&&m&&d)?`${d}/${m}/${y}`:(iso||'');};
    const cell=(v)=>{let t=(v??'').toString().replace(/\r?\n/g,'⏎');if(/[;"\n]/.test(t))t='"'+t.replace(/"/g,'""')+'"';return t;};
    const rows=movimientos.map(m=>[toES(m.f),m.o||'',m.c||'',m.s||'',Number(m.imp)||0,(m.d??'').trim()].map(cell).join(SEP));
    const csv=[['Fecha','Origen','Categoria','Subcategoria','Importe','Descripcion'].join(SEP),...rows].join('\n');
    const ahora=new Date(),dd=String(ahora.getDate()).padStart(2,'0'),mm=String(ahora.getMonth()+1).padStart(2,'0');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob);
    const a=Object.assign(document.createElement('a'),{href:url,download:`mis_gastos_${dd}${mm}${ahora.getFullYear()}.csv`});
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);showToast('📥 CSV exportado');
  };
  const importarCSV=(e)=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const text=reader.result.replace(/^\uFEFF/,''),lines=text.split(/\r?\n/).filter(l=>l.trim());
        if(!lines.length){showToast('Archivo vacío','err');return;}
        const header=lines[0],counts={tab:(header.match(/\t/g)||[]).length,semi:(header.match(/;/g)||[]).length,comma:(header.match(/,/g)||[]).length};
        let delim='\t';if(counts.semi>=counts.tab&&counts.semi>=counts.comma)delim=';';else if(counts.comma>=counts.tab)delim=',';
        const parseLine=(line)=>{const out=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===delim&&!inQ){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;};
        const cols=parseLine(header).map(h=>h.trim().toLowerCase());
        const idx={fecha:cols.findIndex(c=>c.startsWith('fecha')),origen:cols.findIndex(c=>c.startsWith('origen')),categoria:cols.findIndex(c=>c.startsWith('categoria')),subcategoria:cols.findIndex(c=>c.startsWith('subcategoria')),importe:cols.findIndex(c=>c.startsWith('importe')),descripcion:cols.findIndex(c=>c.startsWith('descripcion')||c.startsWith('descripción'))};
        const missing=['fecha','origen','categoria','subcategoria','importe'].filter(k=>idx[k]<0);
        if(missing.length){showToast('Faltan columnas: '+missing.join(', '),'err');return;}
        const toISO=(s)=>{const m=s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s;};
        const clean=(s)=>{if(!s)return'';let t=s.replace(/\\"{2,}/g,'"').trim();if(t.startsWith('"')&&t.endsWith('"'))t=t.slice(1,-1);return t.trim();};
        const addIfNew=(list,key,val)=>{if(!list.some(v=>canonicalizeLabel(v)===canonicalizeLabel(val))){list.push(val);lsSet(key,list);}};
        const ci=buildCanonIndex([...catBase,...catExtra,...NOMINA_CATS],[]),si=buildCanonIndex([...subMaestra,...NOMINA_SUBS],[]);
        const nuevos=lines.slice(1).reduce((acc,line,i)=>{
          const arr=parseLine(line);if(arr.every(v=>!(v||'').trim()))return acc;
          let o=clean(arr[idx.origen]||'');const ol=o.toLowerCase();o=ol.startsWith('nom')?'Nómina':ol.startsWith('gas')?'Gasto':'Ingreso';
          let c=mostrarBonito(clean(arr[idx.categoria]||'')),s=mostrarBonito(clean(arr[idx.subcategoria]||''));
          c=ci.get(canonicalizeLabel(c))??c;s=si.get(canonicalizeLabel(s))??s;
          let imp=parseEuroNumber(arr[idx.importe]||'0');if(o==='Gasto'&&imp>0)imp=-Math.abs(imp);else if(o!=='Gasto'&&imp<0)imp=Math.abs(imp);
          const f=toISO(clean(arr[idx.fecha]||'')),d=idx.descripcion>=0?clean(arr[idx.descripcion]||''):'';
          if(!f||!o||!c||!s||isNaN(imp))return acc;
          addIfNew(catExtra,'categoriaExtra',c);addIfNew(subMaestra,'subMaestra_v2',s);
          acc.push({id:`id_${Date.now()}_${i}`,f,o,c,s,imp,d,ts:Date.now()+i});return acc;
        },[]);
        movimientos=[...movimientos,...nuevos].sort((a,b)=>new Date(b.f)-new Date(a.f));
        invalidateFilterCache();lsSet('movimientos',movimientos);scheduleSync('importarCSV');
        actualizarListas();resetPagina();mostrar();showToast(`✅ ${nuevos.length} registros importados`);
      }catch(err){console.error(err);showToast('Error al importar el CSV','err');}
      finally{e.target.value='';}
    };
    reader.onerror=()=>showToast('No se pudo leer el archivo','err');
    reader.readAsText(file,'UTF-8');
  };

  // ==========================
  // BACKUPS
  // ==========================
  const createAndStoreLocalBackup=async()=>{const enc=await encryptBackup(buildBackupObject());const idx=(parseInt(lsRaw('backup_idx','0'),10)%5)+1;lsSet(`backup_${idx}`,enc);lsRawSet('backup_idx',String(idx));lsRawSet('backup_last_ts',String(Date.now()));updateBackupIndicator();return enc;};
  const downloadEncryptedBackup=async(enc,filename='mis_gastos_backup.json')=>{const blob=new Blob([JSON.stringify(enc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);const a=Object.assign(document.createElement('a'),{href:url,download:filename});document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);};
  const ejecutarBackupRotativo=async()=>{try{await downloadEncryptedBackup(await createAndStoreLocalBackup(),'mis_gastos_backup.json');}catch(e){console.error('Backup falló:',e);}};
  const humanAgo=(ts)=>{if(!ts)return'—';const s=Math.floor((Date.now()-ts)/1000);return s<60?`hace ${s}s`:s<3600?`hace ${Math.floor(s/60)}m`:`hace ${Math.floor(s/3600)}h`;};
  const updateBackupIndicator=()=>{const el=document.getElementById('backupIndicator');if(!el)return;const ts=parseInt(lsRaw('backup_last_ts','0'),10);el.querySelector('.txt').textContent=`Última copia: ${humanAgo(ts)}`;el.classList.remove('stale','old');if(!ts){el.classList.add('old');return;}const mins=(Date.now()-ts)/60000;if(mins>1440)el.classList.add('old');else if(mins>60)el.classList.add('stale');};
  setInterval(updateBackupIndicator,60000);
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(e=>console.error('SW:',e)));

  // ==========================
  // DROPBOX
  // ==========================
  const DBX_APP_KEY='pow1k3kk53abk75',DBX_REDIRECT_URI='https://oskarlm.github.io/APK_V0.0/auth/dropbox/callback',DBX_FILE_PATH='/mis_gastos_backup.json';
  const DBX_OAUTH_AUTH='https://www.dropbox.com/oauth2/authorize',DBX_OAUTH_TOKEN='https://api.dropboxapi.com/oauth2/token',DBX_CONTENT='https://content.dropboxapi.com/2';
  const dbx_b64Url=(bytes)=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const dbx_sha256B64=async(text)=>dbx_b64Url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const dbx_randomStr=(len=64)=>{const a=new Uint8Array(len);crypto.getRandomValues(a);return Array.from(a).map(b=>('0'+b.toString(16)).slice(-2)).join('');};
  const dbx_getTokens=()=>{try{return JSON.parse(localStorage.getItem('dbx_tokens')||'{}');}catch{return null;}};
  const dbx_setTokens=(t)=>{try{localStorage.setItem('dbx_tokens',JSON.stringify(t||{}));}catch{}};
  const dbx_clearTokens=()=>{try{localStorage.removeItem('dbx_tokens');}catch{}};
  const dropboxStartLogin=async()=>{const cv=dbx_randomStr(64),cc=await dbx_sha256B64(cv);try{sessionStorage.setItem('dbx_code_verifier',cv);}catch{}const p=new URLSearchParams({response_type:'code',client_id:DBX_APP_KEY,redirect_uri:DBX_REDIRECT_URI,code_challenge:cc,code_challenge_method:'S256',token_access_type:'offline',scope:'files.content.write files.content.read files.metadata.read'});window.location.href=`${DBX_OAUTH_AUTH}?${p}`;};
  const dbx_getValidAccessToken=async()=>{const t=dbx_getTokens();if(!t)return null;if(t.access_token&&t.expires_at&&Date.now()<t.expires_at)return t.access_token;if(t.refresh_token){const r=await fetch(DBX_OAUTH_TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:DBX_APP_KEY,refresh_token:t.refresh_token})});if(!r.ok){dbx_clearTokens();return null;}const j=await r.json();const saved={...t,access_token:j.access_token,expires_in:j.expires_in,expires_at:Date.now()+(j.expires_in||3600)*1000};dbx_setTokens(saved);return saved.access_token;}return t.access_token||null;};
  const _dbxUpload=async(payload)=>{
    const token=await dbx_getValidAccessToken();if(!token){await dropboxStartLogin();return false;}
    const res=await fetch(`${DBX_CONTENT}/files/upload`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:DBX_FILE_PATH,mode:'overwrite',autorename:false,mute:true})},body:new TextEncoder().encode(typeof payload==='string'?payload:JSON.stringify(payload,null,2))});
    if(res.ok){lsRawSet('backup_last_ts',String(Date.now()));updateBackupIndicator();}
    else{const ind=document.getElementById('backupIndicator');if(ind){ind.classList.add('old');ind.querySelector('.txt').textContent='⚠️ Error sync';}}
    return res.ok;
  };
  const dropboxUploadEncryptedBackup=async()=>{try{const ok=await _dbxUpload(await encryptBackup(buildBackupObject()));showToast(ok?'☁️ Copia subida a Dropbox':'❌ Error al subir a Dropbox',ok?'ok':'err');}catch(e){console.error(e);showToast(String(e?.message||e),'err');}};
  const dropboxDownloadAndRestore=async()=>{
    try{const token=await dbx_getValidAccessToken();if(!token){await dropboxStartLogin();return;}
    const res=await fetch(`${DBX_CONTENT}/files/download`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Dropbox-API-Arg':JSON.stringify({path:DBX_FILE_PATH})}});
    if(!res.ok)throw new Error(await res.text());let payload;try{payload=JSON.parse(await res.text());}catch{throw new Error('El archivo no es JSON.');}
    const data=(payload?.ct&&payload?.iv)?await decryptBackup(payload):payload;if(!data?.datos)throw new Error('Formato inválido');
    movimientos=Array.isArray(data.datos.movimientos)?data.datos.movimientos:[];catExtra=Array.isArray(data.datos.catExtra)?data.datos.catExtra:[];subMaestra=Array.isArray(data.datos.subMaestra)?data.datos.subMaestra:[];
    if(data.datos.presupuestos)presupuestos=data.datos.presupuestos;
    if(data.datos.metaAhorro!=null)metaAhorro=data.datos.metaAhorro;
    lsSet('movimientos',movimientos);lsSet('categoriaExtra',catExtra);lsSet('subMaestra_v2',subMaestra);lsSet('presupuestos_v1',presupuestos);lsSet('meta_ahorro_v1',metaAhorro);
    lsRawSet('backup_last_ts',String(Date.now()));invalidateFilterCache();updateBackupIndicator();actualizarListas();resetPagina();mostrar();showToast('☁️ Datos restaurados desde Dropbox');}
    catch(e){console.error(e);showToast(String(e?.message||e),'err');}
  };
  const dropboxSignOut=()=>{dbx_clearTokens();showToast('Dropbox desconectado','warn');};
  let _syncTimer=null;
  const scheduleSync=(reason='changed')=>{clearTimeout(_syncTimer);_syncTimer=setTimeout(async()=>{try{if(navigator.onLine)await _dbxUpload(await encryptBackup(buildBackupObject()));}catch{}},CFG.SYNC_DEBOUNCE_MS);};
  const loadFromDropboxOnStart=async({silent=true}={})=>{
    try{if(!navigator.onLine)return;const token=await dbx_getValidAccessToken();if(!token)return;
    const res=await fetch(`${DBX_CONTENT}/files/download`,{method:'POST',headers:{'Authorization':`Bearer ${token}`,'Dropbox-API-Arg':JSON.stringify({path:DBX_FILE_PATH})}});
    if(!res.ok)return;let payload;try{payload=JSON.parse(await res.text());}catch{return;}
    const data=(payload?.ct&&payload?.iv)?await decryptBackup(payload):payload;if(!data?.datos)return;
    movimientos=Array.isArray(data.datos.movimientos)?data.datos.movimientos:[];catExtra=Array.isArray(data.datos.catExtra)?data.datos.catExtra:[];subMaestra=Array.isArray(data.datos.subMaestra)?data.datos.subMaestra:[];
    if(data.datos.presupuestos)presupuestos=data.datos.presupuestos;
    if(data.datos.metaAhorro!=null)metaAhorro=data.datos.metaAhorro;
    lsSet('movimientos',movimientos);lsSet('categoriaExtra',catExtra);lsSet('subMaestra_v2',subMaestra);lsSet('presupuestos_v1',presupuestos);lsSet('meta_ahorro_v1',metaAhorro);
    lsRawSet('backup_last_ts',String(Date.now()));invalidateFilterCache();updateBackupIndicator();actualizarListas();resetPagina();mostrar();
    if(!silent)showToast('☁️ Datos cargados desde Dropbox');}catch{}
  };
  window.addEventListener('online',()=>{scheduleSync('online');showToast('🌐 Conexión restaurada');});
  window.addEventListener('offline',()=>showToast('📵 Sin conexión','warn'));

  // ==========================
  // EXPORTAR A GLOBAL
  // ==========================
  Object.assign(window,{
    pressPin,clearPin,biometricAuth,cambiarPin,borradoSeguro,
    mostrar,resetPagina,abrirFormulario,abrirFormularioConSugerencia,volver,guardar,
    eliminarRegistroActual,exportarCSV,importarCSV,
    manejarNuevo,borrarElemento,abrirGraficos,
    ejecutarBackupRotativo,init,actualizarListas,
    setModo,toggleCasa,
    handleGraficoBarClick,abrirDetalleMovs,
    dropboxStartLogin,dropboxUploadEncryptedBackup,dropboxDownloadAndRestore,dropboxSignOut,
    createAndStoreLocalBackup,showToast,lsRawSet,
    abrirPresupuestos,iniciarDictado,escanearTicket,
    abrirEntradaRapida,toggleModoMasivo,toggleSeleccion,abrirEdicionMasiva,
    exportarPDFMensual,renderComparativaAnual,abrirMetaAhorro,
  });
}
