
import { initDB, addItem, queryItems, countItemsFiltered } from './db.js';
import { pinInit, onUnlocked } from './pin.js';
import './normalizer.js';

const state = {
  order: 'desc',
  limit: 10,
  cursor: null,
  filters: { textPrefix: '', dateFrom: null, dateTo: null },
};

async function boot() {
  // SW registration
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW fail', e); }
  }

  await initDB();

  // PIN flow
  const loginSection = document.getElementById('login-section');
  const appContent = document.getElementById('app-content');

  onUnlocked(() => {
    loginSection.hidden = true;
    appContent.hidden = false;
  });

  await pinInit();

  const form = document.getElementById('data-form');
  const input = document.getElementById('data-input');
  const list  = document.getElementById('data-list');

  const searchInput = document.getElementById('filter-text');
  const fromInput   = document.getElementById('filter-from');
  const toInput     = document.getElementById('filter-to');
  const moreBtn     = document.getElementById('btn-more');
  const resetBtn    = document.getElementById('btn-reset');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    await addItem({ text });
    input.value = '';
    await refresh(true);
  });

  function readDate(d) {
    if (!d) return null;
    const parts = d.split('-');
    if (parts.length !== 3) return null;
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
  }

  async function applyFilters() {
    state.filters.textPrefix = (searchInput.value || '').trim();
    state.filters.dateFrom   = readDate(fromInput.value);
    const end = readDate(toInput.value);
    state.filters.dateTo     = end != null ? (end + 24*60*60*1000 - 1) : null;
    await refresh(true);
  }

  searchInput.addEventListener('input', debounce(applyFilters, 250));
  fromInput.addEventListener('change', applyFilters);
  toInput.addEventListener('change', applyFilters);

  moreBtn.addEventListener('click', async () => refresh(false));
  resetBtn.addEventListener('click', async () => refresh(true));

  async function refresh(resetPage) {
    if (resetPage) state.cursor = null;

    const { items, page } = await queryItems({
      ...state.filters,
      order: state.order,
      limit: state.limit,
      cursor: state.cursor,
    });

    if (resetPage) {
      list.innerHTML = '';
    }

    list.insertAdjacentHTML('beforeend', items.map(renderItem).join(''));
    state.cursor = page?.nextCursor || null;
    moreBtn.disabled = !page?.hasNext;
    updateCount();
  }

  function renderItem(it) {
    const date = new Date(it.createdAt).toLocaleString();
    return `<li><span>${escapeHTML(it.text)} <small>(${date})</small></span></li>`;
  }

  function updateCount() {
    countItemsFiltered(state.filters).then((n) => {
      const el = document.getElementById('total-count');
      if (el) el.textContent = String(n);
    });
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

  await refresh(true);
}

document.addEventListener('DOMContentLoaded', boot);
