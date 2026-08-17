// ─── Modal row reference (used by edit) ──────────────────────────────────────
var MODAL_ROW = null;

// ─── Column order (drag to reorder, persisted) ────────────────────────────────
var COL_ORDER = JSON.parse(localStorage.getItem('dp_col_order') || 'null');

function saveColOrder(editors) {
  COL_ORDER = editors;
  localStorage.setItem('dp_col_order', JSON.stringify(editors));
}

function getOrderedEditors() {
  if (!COL_ORDER) return S.editors;
  // Merge: keep saved order but add new editors at end, remove gone ones
  var saved   = COL_ORDER.filter(function(e) { return S.editors.indexOf(e) !== -1; });
  var newOnes = S.editors.filter(function(e) { return saved.indexOf(e) === -1; });
  return saved.concat(newOnes);
}

// ─── State ────────────────────────────────────────────────────────────────────
var S = {
  url:       'https://script.google.com/macros/s/AKfycbxRnU165B4OZoIyc-sDFrkQB-tePNsb9MBrMWJa7IRZuTWzzITQvxT6ES7eSCVzc6S-/exec',
  assignUrl: 'https://script.google.com/macros/s/AKfycbzpHle7iubZvZTSEtY3yUGdtQIwiFaKIQFSkRBnYFHDgYku9Gyt-Iwb30jGduddY2K0/exec',
  data:      {},
  editors:   [],
  editor:    'all',
  view:      'board',
  range:     'all',
  fromDate:  null,
  toDate:    null,
  search:    '',
  filters:   { status:'', category:'', listType:'', photographer:'', beds:'' },
  sortCol:   '',
  sortDir:   1,
  lastFetch: null,
};

// ─── Tabs to exclude from editor board/tabs ───────────────────────────────────
var EXCLUDED_TABS = ['Lifestyle', 'Amenities', 'Incoming', 'Assignments', 'Email Closed'];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // ── Theme & mode init (runs first so no flash) ──────────────────────────────
  initTheme();
  initMode();

  // ── Start background animation ────────────────────────────────────────────
  initAnimation();

  fetchData();

  // Prefetch Assignment data in the background on load too — not just when
  // the Assignment Dashboard tab is opened. Listing detail modals' History
  // section (buildHistorySectionHtml) reads from ASSIGN_DATA regardless of
  // which view is active, so without this, opening a modal before ever
  // visiting the Assignment Dashboard would show "No history" simply
  // because the data hadn't been fetched yet — not because none exists.
  fetchAssignData(function() {
    // Re-render only if a listing detail modal happens to already be open
    // at the moment this resolves, so its History section picks up the
    // freshly-arrived data instead of staying stuck on a pre-fetch render.
    var modalBg = document.getElementById('modalBg');
    if (modalBg && modalBg.style.display === 'flex' && typeof MODAL_ROW !== 'undefined' && MODAL_ROW) {
      openModal(MODAL_ROW);
    }
  });

  document.getElementById('searchInput').addEventListener('input', function() {
    S.search = this.value.toLowerCase();
    render();
  });

  // ── View toggle ──────────────────────────────────────────────────────────────
  document.querySelectorAll('.v-btn[data-view]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.v-btn[data-view]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      S.view = btn.dataset.view;
      render();
    });
  });

  // ── Filter panel ─────────────────────────────────────────────────────────────
  var filterPanel    = document.getElementById('filterPanel');
  var filterBackdrop = document.getElementById('filterBackdrop');

  function openFilterPanel() {
    filterPanel.classList.add('open');
    filterBackdrop.classList.add('open');
  }

  function closeFilterPanel() {
    filterPanel.classList.remove('open');
    filterBackdrop.classList.remove('open');
  }

  document.getElementById('filterTriggerBtn').addEventListener('click', openFilterPanel);
  document.getElementById('filterCloseBtn').addEventListener('click', closeFilterPanel);
  filterBackdrop.addEventListener('click', closeFilterPanel);

  // Time pills inside panel
  document.querySelectorAll('.fp-t-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.fp-t-pill').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      S.range = btn.dataset.range;
      S.fromDate = null; S.toDate = null;
      document.getElementById('dateFrom').value = '';
      document.getElementById('dateTo').value = '';
      updateFilterBadge();
      render();
    });
  });

  // Dropdowns inside panel — apply immediately on change
  ['fStatus','fCategory','fListType','fPhotographer','fBeds'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() {
      var map = { fStatus:'status', fCategory:'category', fListType:'listType', fPhotographer:'photographer', fBeds:'beds' };
      S.filters[map[id]] = this.value;
      updateFilterBadge();
      render();
    });
  });

  // Apply button — close panel
  document.getElementById('fpApplyBtn').addEventListener('click', function() {
    closeFilterPanel();
    render();
  });

  // Clear all
  document.getElementById('fpClearBtn').addEventListener('click', function() {
    clearFilters();
  });

  document.getElementById('refreshBtn').addEventListener('click', function() {
    fetchData();
    if (S.view === 'assigndash') fetchAssignData(function() { renderAssignDashboard(); });
  });

  // ── Amenities modal ───────────────────────────────────────────────────────
  document.getElementById('amenitiesBtn').addEventListener('click', function() {
    openAmenitiesModal();
  });

  // ── Incoming requests edit ────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'editIncomingBtn') openIncomingModal();
  });

  // ── Extension download modal ──────────────────────────────────────────────
  document.getElementById('getExtensionBtn').addEventListener('click', function() {
    document.getElementById('extModalBg').style.display = 'flex';
  });

  // ── Theme dropdown ────────────────────────────────────────────────────────
  document.getElementById('themeSelect').addEventListener('change', function() {
    applyTheme(this.value);
  });

  // ── Dark / Light toggle ───────────────────────────────────────────────────
  document.getElementById('modeToggleBtn').addEventListener('click', function() {
    var isLight = document.body.classList.contains('light');
    applyMode(isLight ? 'dark' : 'light');
  });

  // Background auto-refresh (zero flicker)
  setInterval(function () {
    if (S.url && document.visibilityState === 'visible') {
      fetchData(true);
    }
  }, 8000); // Apps Script CacheService responds in ~100ms, so this is cheap to poll often

});

// ─── Fetch ────────────────────────────────────────────────────────────────────
function fetchData(silent) {
  var btn = document.getElementById('refreshBtn');

  if (!silent) {
    hideAll();
    show('loadingState');
    btn.classList.add('spin');
    setConnStatus('checking');
  }

  fetch(S.url + '?action=getData', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      btn.classList.remove('spin');
      if (!json.success) throw new Error(json.error || 'Unknown error from Apps Script');

      setConnStatus('online');

      var newData    = json.data || {};
      var newEditors = Object.keys(newData)
        .filter(function(name) { return EXCLUDED_TABS.indexOf(name) === -1; })
        .sort(function(a,b) { return a.localeCompare(b); });

      S.lastFetch = new Date();
      document.getElementById('lastUpdated').style.display = 'flex';
      document.getElementById('luText').textContent = 'Updated ' + fmtTime(S.lastFetch);

      if (silent) {
        // ── Silent mode: only re-render if data actually changed ──────────────

        // Skip entirely if modal or delete confirm is open
        if (document.getElementById('modalBg').style.display !== 'none') {
          // Still update data quietly so next manual refresh is fresh
          S.data    = newData;
          S.editors = newEditors;
          return;
        }
        if (document.getElementById('delConfirmOverlay')) return;

        // Check if anything actually changed
        var changed = false;
        if (newEditors.join(',') !== S.editors.join(',')) changed = true;
        if (!changed) {
          newEditors.forEach(function(e) {
            if ((newData[e] || []).length !== (S.data[e] || []).length) changed = true;
          });
        }
        if (!changed) {
          var newLife = (newData['Lifestyle'] || []).length;
          var curLife = (S.data['Lifestyle'] || []).length;
          if (newLife !== curLife) changed = true;
        }
        if (!changed) {
          var newInc = (newData['Incoming'] || []).length;
          var curInc = (S.data['Incoming'] || []).length;
          if (newInc !== curInc) changed = true;
        }

        if (!changed) return; // Nothing new — leave UI completely alone

        // Save scroll positions before re-render
        var uiState = saveUIState();

        S.data    = newData;
        S.editors = newEditors;
        populateDropdowns();
        render();

        // Restore scroll positions after paint
        restoreUIState(uiState);

      } else {
        // ── Full load (first time or manual refresh) ──────────────────────────
        S.data    = newData;
        S.editors = newEditors;
        hide('loadingState');
        show('mainDash');
        populateDropdowns();
        render();
      }
    })
    .catch(function(err) {
      btn.classList.remove('spin');
      setConnStatus('offline');
      CONN_FAIL_COUNT++;
      if (CONN_FAIL_COUNT >= CONN_FAIL_THRESHOLD) showDisconnectToast();
      if (!silent) {
        hide('loadingState');
        show('errorState');
        document.getElementById('errorMsg').textContent = err.message;
      }
    });
}

// ─── Connection status ────────────────────────────────────────────────────────
var CONN_FAIL_COUNT = 0;
var CONN_FAIL_THRESHOLD = 2; // show warning after 2 consecutive failures

function setConnStatus(state) {
  var el   = document.getElementById('connStatus');
  var text = document.getElementById('connText');
  if (!el) return;
  el.className = 'conn-status conn-' + state;
  if (state === 'online')   { text.textContent = 'Connected';   CONN_FAIL_COUNT = 0; hideDisconnectToast(); }
  if (state === 'offline')  { text.textContent = 'Disconnected'; }
  if (state === 'checking') { text.textContent = 'Connecting…'; }
}

function showDisconnectToast() {
  var toast = document.getElementById('disconnectToast');
  if (toast) toast.style.display = 'block';
}

function hideDisconnectToast() {
  var toast = document.getElementById('disconnectToast');
  if (toast) toast.style.display = 'none';
}

function retryConnection() {
  hideDisconnectToast();
  fetchData();
}

// ─── Drag to reorder columns ──────────────────────────────────────────────────
function initDragColumns(board) {
  var dragging   = null;
  var placeholder = null;

  board.querySelectorAll('.col').forEach(function(col) {
    var handle = col.querySelector('.col-drag-handle');
    if (!handle) return;

    handle.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = col;
      var rect = col.getBoundingClientRect();

      // Style dragging col
      col.classList.add('col-dragging');
      col.style.width  = rect.width + 'px';
      col.style.height = rect.height + 'px';

      // Create placeholder
      placeholder = document.createElement('div');
      placeholder.className = 'col-placeholder';
      placeholder.style.minWidth = rect.width + 'px';
      placeholder.style.height   = rect.height + 'px';
      board.insertBefore(placeholder, col.nextSibling);

      // Initial position
      col.style.position = 'fixed';
      col.style.left     = rect.left + 'px';
      col.style.top      = rect.top  + 'px';
      col.style.zIndex   = '999';

      var startX = e.clientX - rect.left;
      var startY = e.clientY - rect.top;

      function onMove(ev) {
        col.style.left = (ev.clientX - startX) + 'px';
        col.style.top  = (ev.clientY - startY) + 'px';

        // Find which col the mouse is hovering over
        col.style.pointerEvents = 'none';
        var under = document.elementFromPoint(ev.clientX, ev.clientY);
        col.style.pointerEvents = '';

        var targetCol = under ? under.closest('.col') : null;
        if (targetCol && targetCol !== dragging && targetCol !== placeholder) {
          var targetRect   = targetCol.getBoundingClientRect();
          var insertBefore = ev.clientX < targetRect.left + targetRect.width / 2;
          if (insertBefore) {
            board.insertBefore(placeholder, targetCol);
          } else {
            board.insertBefore(placeholder, targetCol.nextSibling);
          }
        }
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);

        // Drop into placeholder position
        col.style.position = '';
        col.style.left     = '';
        col.style.top      = '';
        col.style.width    = '';
        col.style.height   = '';
        col.style.zIndex   = '';
        col.classList.remove('col-dragging');

        board.insertBefore(col, placeholder);
        placeholder.remove();
        placeholder = null;
        dragging    = null;

        // Save new order
        var newOrder = [];
        board.querySelectorAll('.col').forEach(function(c) {
          var nameEl = c.querySelector('.col-name');
          if (nameEl) newOrder.push(nameEl.textContent.trim());
        });
        saveColOrder(newOrder);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  });
}

// ─── UI State preservation ────────────────────────────────────────────────────
function saveUIState() {
  var state = {
    boardScrollLeft: 0,
    editorTabsLeft:  0,
    colScrollTops:   {},
    tableScrollTop:  0,
    collapsedCols:   [],  // track which columns are collapsed
  };

  var board = document.getElementById('boardView');
  if (board) state.boardScrollLeft = board.scrollLeft;

  var tabs = document.getElementById('editorTabs');
  if (tabs) state.editorTabsLeft = tabs.scrollLeft;

  var tableWrap = document.getElementById('tableView');
  if (tableWrap) state.tableScrollTop = tableWrap.scrollTop;

  // Per-column vertical scroll and collapsed state keyed by column header name
  document.querySelectorAll('.col').forEach(function(col) {
    var nameEl = col.querySelector('.col-name');
    if (!nameEl) return;
    var name = nameEl.textContent.trim();
    if (col.classList.contains('collapsed')) {
      state.collapsedCols.push(name);
    }
    var bodyEl = col.querySelector('.col-body');
    if (bodyEl) state.colScrollTops[name] = bodyEl.scrollTop;
  });

  return state;
}

function restoreUIState(state) {
  requestAnimationFrame(function() {
    var board = document.getElementById('boardView');
    if (board && state.boardScrollLeft) board.scrollLeft = state.boardScrollLeft;

    var tabs = document.getElementById('editorTabs');
    if (tabs && state.editorTabsLeft) tabs.scrollLeft = state.editorTabsLeft;

    var tableWrap = document.getElementById('tableView');
    if (tableWrap && state.tableScrollTop) tableWrap.scrollTop = state.tableScrollTop;

    document.querySelectorAll('.col').forEach(function(col) {
      var nameEl = col.querySelector('.col-name');
      if (!nameEl) return;
      var name = nameEl.textContent.trim();

      // Restore collapsed state
      if (state.collapsedCols && state.collapsedCols.indexOf(name) !== -1) {
        col.classList.remove('open');
        col.classList.add('collapsed');
      }

      // Restore scroll position
      var bodyEl = col.querySelector('.col-body');
      if (bodyEl && state.colScrollTops[name]) {
        bodyEl.scrollTop = state.colScrollTops[name];
      }
    });
  });
}

// ─── Dropdown population ──────────────────────────────────────────────────────
function populateDropdowns() {
  var allRows = getAllRows();
  fillSelect('fStatus',      allRows, 'Status',       'All Statuses');
  fillSelect('fCategory',    allRows, 'Category',     'All Categories');
  fillSelect('fListType',    allRows, 'List Type',    'All List Types');
  fillSelect('fPhotographer',allRows, 'Photographer', 'All Photographers');
  fillSelect('fBeds',        allRows, 'Beds',         'All Beds');
}

function fillSelect(id, rows, field, placeholder) {
  var sel = document.getElementById(id);
  var cur = sel.value;
  var vals = unique(rows.map(function(r) { return String(r[field] || ''); }).filter(Boolean)).sort();
  sel.innerHTML = '<option value="">' + placeholder + '</option>';
  vals.forEach(function(v) {
    var o = document.createElement('option');
    o.value = v; o.textContent = v;
    if (v === cur) o.selected = true;
    sel.appendChild(o);
  });
}

// ─── Date filtering ───────────────────────────────────────────────────────────
function applyRange() {
  var f = document.getElementById('dateFrom').value;
  var t = document.getElementById('dateTo').value;
  if (!f || !t) return;
  S.fromDate = f; S.toDate = t; S.range = '';
  document.querySelectorAll('.fp-t-pill').forEach(function(b) { b.classList.remove('active'); });
  updateFilterBadge();
  render();
}

function rowInRange(row) {
  var raw = row['Date Uploaded'] || row['Received Date'] || row['Date'] || row['Time Closed'];
  if (!raw) return true;

  var d = new Date(raw);
  if (isNaN(d)) { d = parseGSheetDate(String(raw)); }
  if (!d || isNaN(d)) return true;

  if (S.fromDate && S.toDate) {
    var from = new Date(S.fromDate);
    var to   = new Date(S.toDate); to.setHours(23,59,59,999);
    return d >= from && d <= to;
  }

  var now   = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (S.range === 'today') {
    return d >= today;

  } else if (S.range === 'yesterday') {
    var yStart = new Date(today);
    yStart.setDate(yStart.getDate() - 1);

    var yEnd = new Date(yStart);
    yEnd.setHours(23,59,59,999);

    return d >= yStart && d <= yEnd;

  } else if (S.range === 'week') {
    var w = new Date(today); w.setDate(w.getDate() - 7);
    return d >= w;
  } else if (S.range === 'month') {
    var m = new Date(today); m.setMonth(m.getMonth() - 1);
    return d >= m;
  }
  return true;
}

function parseGSheetDate(str) {
  var clean = str.replace(' at ', ' ').replace(/,/g, '');
  var d = new Date(clean);
  return isNaN(d) ? null : d;
}

// ─── Filtering ────────────────────────────────────────────────────────────────
function getAllRows() {
  var all = [];
  S.editors.forEach(function(e) {
    (S.data[e] || []).forEach(function(r) {
      all.push(Object.assign({ _editor: e }, r));
    });
  });
  return all;
}

function getRows(editor) {
  var base = editor === 'all'
    ? getAllRows()
    : (S.data[editor] || []).map(function(r) { return Object.assign({ _editor: editor }, r); });

  return base.filter(function(r) {
    if (!rowInRange(r)) return false;
    if (S.search && !rowMatch(r)) return false;
    if (S.filters.status       && r['Status']       !== S.filters.status)       return false;
    if (S.filters.category     && r['Category']     !== S.filters.category)     return false;
    if (S.filters.listType     && r['List Type']    !== S.filters.listType)     return false;
    if (S.filters.photographer && r['Photographer'] !== S.filters.photographer) return false;
    if (S.filters.beds         && String(r['Beds'])  !== S.filters.beds)         return false;
    return true;
  });
}

function rowMatch(r) {
  var s = S.search;
  return ['DP-REQ Number','Listing Reference','Location','Unit / Plot No','Status','Photographer','Category','List Type']
    .some(function(f) { return r[f] && String(r[f]).toLowerCase().includes(s); });
}

// Email Closed rows live in their own tab with a different shape (no Ref,
// Category, etc.), so they're gathered separately from getRows() rather than
// forced through the same listing-shaped filter pipeline. Still respects the
// current editor tab, date range, and search box (matched against Subject).
function getEmailClosedRows(editor) {
  var all  = S.data['Email Closed'] || [];
  var base = editor === 'all'
    ? all
    : all.filter(function(r) { return String(r['Editor'] || '').trim() === editor; });

  return base.filter(function(r) {
    if (!rowInRange(r)) return false;
    if (S.search && !(r['Subject'] && String(r['Subject']).toLowerCase().indexOf(S.search) !== -1)) return false;
    return true;
  });
}

// ─── Render dispatcher ────────────────────────────────────────────────────────
function render() {
  renderTabs();
  var rows = getRows(S.editor);
  renderStats(rows);

  var wasAssignDash = ASSIGN_DASH_VIEW_ACTIVE;
  var isAssignDash = S.view === 'assigndash';

  if (isAssignDash) {
    hide('boardView'); hide('tableView'); hide('reportView'); show('assignDashView');
    if (!wasAssignDash) {
      ASSIGN_DASH_VIEW_ACTIVE = true;
      openAssignDashboardView();
    }
    return; // the assignment dashboard manages its own re-renders (scope pills, clock, fetch)
  }

  if (wasAssignDash) { ASSIGN_DASH_VIEW_ACTIVE = false; assignStopClock(); assignStopPoll(); }
  hide('assignDashView');

  if (S.view === 'board') {
    show('boardView'); hide('tableView'); hide('reportView');
    var uiState = saveUIState();
    renderBoard(rows);
    restoreUIState(uiState);
  } else if (S.view === 'table') {
    hide('boardView'); show('tableView'); hide('reportView');
    renderTable(rows);
  } else if (S.view === 'report') {
    hide('boardView'); hide('tableView'); show('reportView');
    renderReport();
  }
}

// ─── Editor Tabs ──────────────────────────────────────────────────────────────
function renderTabs() {
  var wrap = document.getElementById('editorTabs');
  wrap.innerHTML = '';

  var allRows = getRows('all');
  wrap.appendChild(makeTab('all', 'All Editors', allRows.length));

  // Fix 1: Only show non-excluded editor tabs
  S.editors.forEach(function(editor) {
    var count = getRows(editor).length;
    wrap.appendChild(makeTab(editor, editor, count));
  });
}

function makeTab(id, label, count) {
  var btn = document.createElement('button');
  btn.className = 'e-tab' + (S.editor === id ? ' active' : '');
  btn.innerHTML = esc(label) + '<span class="e-count">' + count + '</span>';
  btn.addEventListener('click', function() {
    S.editor = id;
    render();
  });
  return btn;
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats(rows) {
  var total    = rows.length;
  var uploaded = rows.filter(function(r) { return norm(r['Status']) === 'uploaded'; }).length;
  // Fix: match both 'ongoing' (old) and 'pending' (new) status values
  var pending  = rows.filter(function(r) { return norm(r['Status']) === 'pending' || norm(r['Status']) === 'ongoing'; }).length;
  var rejected = rows.filter(function(r) { return norm(r['Status']) === 'rejected'; }).length;
  var other    = total - uploaded - pending - rejected;

  var emailClosed = getEmailClosedRows(S.editor).length;
  // Total includes Email Closed (unlike Uploaded/Pending/Rejected/Other,
  // which stay listing-only) — computed from the un-inflated `total` above
  // so it doesn't skew the Other bucket.
  var grandTotal = total + emailClosed;

  var items = [
    { label:'Total',        val: grandTotal,  cls:''  },
    { label:'Uploaded',     val: uploaded,     cls:'g' },
    { label:'Pending',      val: pending,      cls:'y' },
    { label:'Rejected',     val: rejected,     cls:'r' },
    { label:'Email Closed', val: emailClosed,  cls:'c' },
  ];

  if (other > 0) items.push({ label:'Other', val: other, cls:'b' });

  if (S.editor === 'all') {
    var editorsRep = unique(rows.map(function(r) { return r._editor; })).length;
    items.push({ label:'Editors', val: editorsRep, cls:'' });
  }

  document.getElementById('statsRow').innerHTML = items.map(function(i) {
    return '<div class="stat-card">'
      + '<div class="stat-label">' + i.label + '</div>'
      + '<div class="stat-value ' + i.cls + '">' + i.val + '</div>'
      + '</div>';
  }).join('');
}

// ─── Board View ───────────────────────────────────────────────────────────────
function sortNewest(rows) {
  return rows.slice().sort(function(a, b) {
    var da = parseAnyDate(a['Date Uploaded']);
    var db = parseAnyDate(b['Date Uploaded']);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });
}

function parseAnyDate(val) {
  if (!val) return null;
  var d = new Date(val);
  if (!isNaN(d)) return d;
  return parseGSheetDate(String(val));
}

function renderBoard(rows) {
  var board = document.getElementById('boardView');
  board.innerHTML = '';

  var emailClosedAll = getEmailClosedRows(S.editor);

  if (rows.length === 0 && emailClosedAll.length === 0) {
    board.innerHTML = '<div class="no-results">No listings match the current filters.</div>';
    return;
  }

  if (S.editor === 'all') {
    var ordered = getOrderedEditors();
    ordered.forEach(function(editor) {
      var edRows = rows.filter(function(r) { return r._editor === editor; });
      var edEmailClosed = getEmailClosedRows(editor);
      board.appendChild(makeColumn(editor, edRows, edEmailClosed));
    });
    initDragColumns(board);
  } else {
    var statuses = unique(rows.map(function(r) { return r['Status'] || '—'; }));
    var order = ['Uploaded','Pending','Ongoing','Rejected'];
    statuses.sort(function(a, b) {
      var ai = order.indexOf(a), bi = order.indexOf(b);
      if (ai === -1) ai = 99; if (bi === -1) bi = 99;
      return ai - bi || a.localeCompare(b);
    });
    statuses.forEach(function(status) {
      var sRows = rows.filter(function(r) { return (r['Status'] || '—') === status; });
      board.appendChild(makeColumn(status, sRows));
    });
    // Email Closed entries have no Status, so they don't belong in any of the
    // status columns above — they get their own column instead, same as any
    // other status bucket, only shown when this editor actually has any.
    if (emailClosedAll.length) {
      board.appendChild(makeColumn('Email Closed', [], emailClosedAll));
    }
  }
}

function makeColumn(title, rows, emailClosedRows) {
  emailClosedRows = emailClosedRows || [];
  var col = document.createElement('div');
  var totalCount = rows.length + emailClosedRows.length;
  var isEmpty = totalCount === 0;
  col.className = 'col ' + (isEmpty ? 'collapsed' : 'open');

  var header = document.createElement('div');
  header.className = 'col-header';
  header.innerHTML = '<div class="col-header-left">'
    + '<span class="col-drag-handle" title="Drag to reorder">⠿</span>'
    + '<span class="col-name">' + esc(title) + '</span>'
    + '</div>'
    + '<span class="col-count">' + totalCount + '</span>';

  // Click anywhere on header (except drag handle) to collapse/expand
  header.addEventListener('click', function(e) {
    if (e.target.closest('.col-drag-handle')) return;
    if (col.classList.contains('collapsed')) {
      col.classList.replace('collapsed','open');
    } else {
      col.classList.replace('open','collapsed');
    }
  });

  var body = document.createElement('div');
  body.className = 'col-body';

  if (totalCount === 0) {
    body.innerHTML = '<div class="col-empty">No listings</div>';
  } else {
    // Merge listing cards and Email Closed cards into one chronological
    // feed (newest first) rather than showing Email Closed as a separate
    // block, so a column reads as "everything this editor did, in order."
    var merged = rows.map(function(r) {
      return { kind: 'listing', row: r, date: parseAnyDate(r['Date Uploaded']) };
    }).concat(emailClosedRows.map(function(r) {
      return { kind: 'emailClosed', row: r, date: parseAnyDate(r['Time Closed']) };
    }));

    merged.sort(function(a, b) {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date - a.date;
    });

    merged.forEach(function(item) {
      body.appendChild(item.kind === 'emailClosed' ? makeEmailClosedCard(item.row) : makeCard(item.row));
    });
  }

  col.appendChild(header);
  col.appendChild(body);
  return col;
}

function makeEmailClosedCard(row) {
  var card = document.createElement('div');
  card.className = 'listing-card email-closed-card';

  card.innerHTML =
    '<div class="card-top-row">'
    +   '<div class="card-req">📧 Email</div>'
    + '</div>'
    + '<div class="card-loc">' + esc(row['Subject'] || '—') + '</div>'
    + '<div class="card-footer">'
    +   '<span class="card-date">' + esc(fmtDateFull(row['Time Closed'])) + '</span>'
    +   '<span class="sbadge s-closed">Closed</span>'
    + '</div>';

  return card;
}

function makeCard(row) {
  var card = document.createElement('div');
  card.className = 'listing-card';

  var status    = row['Status'] || '';
  var sCls      = statusClass(status);
  var isPending = norm(status) === 'pending' || norm(status) === 'ongoing' || norm(status) === 'no reference';
  var location  = String(row['Location'] || '—');
  if (location.length > 55) location = location.substring(0, 55) + '…';

  // Fix 4: List Type moved to top-right badge, removed from tags
  var listType    = row['List Type'] || '';
  var listTypeCls = listTypeClass(listType);

  var tags = [
    row['Category'],
    row['Beds'] ? row['Beds'] + ' Bed' : null,
    row['Furnishing'],
  ].filter(Boolean).map(function(t) {
    return '<span class="ctag">' + esc(String(t)) + '</span>';
  }).join('');

  var unitStr = row['Unit / Plot No'] ? ' · ' + row['Unit / Plot No'] : '';

  card.innerHTML =
    // Top row: REQ on left, List Type badge on right
    '<div class="card-top-row">'
    +   '<div class="card-req">' + esc(row['DP-REQ Number'] || '—') + '</div>'
    +   (listType ? '<span class="card-listtype ' + listTypeCls + '">' + esc(listType) + '</span>' : '')
    + '</div>'
    + '<div class="card-ref">' + esc(row['Listing Reference'] || '') + unitStr + '</div>'
    + '<div class="card-loc">' + esc(location) + '</div>'
    + (tags ? '<div class="card-tags">' + tags + '</div>' : '')
    + '<div class="card-footer">'
    +   '<span class="card-date">' + fmtDate(row['Date Uploaded']) + '</span>'
    +   '<span class="sbadge ' + sCls + '">' + esc(status || '—') + '</span>'
    + '</div>';

  card.addEventListener('click', function() { openModal(row); });
  return card;
}

// ─── Table View ───────────────────────────────────────────────────────────────
var COLS = [
  'Date Uploaded','DP-REQ Number','Listing Reference','Listing Link',
  'Location','Unit / Plot No','Category','Beds','Furnishing',
  'Photographer','List Type','Status','Received Date',
  'Rejection Reason','Agent Request Sub-type','Notes'
];

function renderTable(rows) {
  var wrap = document.getElementById('tableView');

  if (rows.length === 0) {
    wrap.innerHTML = '<div class="no-results">No listings match the current filters.</div>';
    return;
  }

  if (S.sortCol) {
    var dateColumns = ['Date Uploaded', 'Received Date'];
    var isDateCol   = dateColumns.indexOf(S.sortCol) !== -1;

    rows = rows.slice().sort(function(a, b) {
      if (isDateCol) {
        var da = parseAnyDate(a[S.sortCol]) || new Date(0);
        var db = parseAnyDate(b[S.sortCol]) || new Date(0);
        return (da - db) * S.sortDir;
      }
      var av = String(a[S.sortCol] || '').toLowerCase();
      var bv = String(b[S.sortCol] || '').toLowerCase();
      return av < bv ? -S.sortDir : av > bv ? S.sortDir : 0;
    });
  }

  var allCols = S.editor === 'all' ? ['Editor'].concat(COLS) : COLS;

  var html = '<table class="data-table"><thead><tr>';
  allCols.forEach(function(col) {
    var arrow = col === S.sortCol ? (S.sortDir > 0 ? ' ↑' : ' ↓') : '';
    html += '<th data-col="' + esc(col) + '">' + esc(col) + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';

  rows.forEach(function(row) {
    html += '<tr>';
    allCols.forEach(function(col) {
      if (col === 'Editor') {
        html += '<td><span class="sbadge s-default">' + esc(row._editor || '') + '</span></td>';
      } else if (col === 'Listing Link') {
        var v = row[col];
        html += '<td>' + (v ? '<a href="' + esc(v) + '" target="_blank">↗ View</a>' : '') + '</td>';
      } else if (col === 'Status') {
        var v = row[col] || '';
        html += '<td><span class="sbadge ' + statusClass(v) + '">' + esc(v || '—') + '</span></td>';
      } else if (col === 'Date Uploaded') {
        html += '<td class="tbl-mono">' + esc(fmtDateFull(row[col])) + '</td>';
      } else if (col === 'Received Date') {
        html += '<td class="tbl-mono">' + esc(fmtDate(row[col])) + '</td>';
      } else if (col === 'DP-REQ Number' || col === 'Listing Reference') {
        html += '<td class="tbl-mono" style="color:var(--green)">' + esc(String(row[col] || '')) + '</td>';
      } else {
        html += '<td>' + esc(String(row[col] || '')) + '</td>';
      }
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('th[data-col]').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.dataset.col;
      if (S.sortCol === col) { S.sortDir *= -1; }
      else {
        S.sortCol = col;
        // Date columns default to newest first (descending)
        S.sortDir = (['Date Uploaded','Received Date'].indexOf(col) !== -1) ? -1 : 1;
      }
      renderTable(getRows(S.editor));
    });
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openModal(row) {
  MODAL_ROW = row;
  var status = row['Status'] || '';
  var sCls   = statusClass(status);
  var fields = [
    'Location','Unit / Plot No','Category','Beds','Furnishing',
    'Photographer','List Type','Received Date','Rejection Reason',
    'Agent Request Sub-type','Notes'
  ];

  var html = '<div class="modal-head">'
    + '<div>'
    +   '<div class="modal-req">' + esc(row['DP-REQ Number'] || 'Listing Detail') + '</div>'
    +   '<div class="modal-ref">' + esc(row['Listing Reference'] || '') + '</div>'
    +   '<div style="margin-top:6px"><span class="sbadge ' + sCls + '">' + esc(status || '—') + '</span></div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;">'
    +   '<button class="modal-edit-btn" onclick="openEditModal()">✏️ Edit</button>'
    +   '<button class="modal-delete-btn" onclick="confirmDelete(MODAL_ROW)">🗑 Delete</button>'
    +   '<button class="modal-close" onclick="document.getElementById(\'modalBg\').style.display=\'none\'">✕</button>'
    + '</div>'
    + '</div>'
    + '<div class="detail-grid">';

  if (row['Listing Link']) {
    html += '<div class="detail-item full">'
      + '<div class="d-label">Listing Link</div>'
      + '<div class="d-val"><a href="' + esc(row['Listing Link']) + '" target="_blank">↗ Open Listing</a></div>'
      + '</div>';
  }

  html += '<div class="detail-item">'
    + '<div class="d-label">Date Uploaded</div>'
    + '<div class="d-val">' + esc(fmtDateFull(row['Date Uploaded'])) + '</div>'
    + '</div>';

  fields.forEach(function(f) {
    var raw = row[f];
    var val;
    if (f === 'Received Date') {
      val = fmtDate(raw);
    } else {
      val = String(raw || '—');
    }
    var isFull = (f === 'Notes') ? ' full' : '';
    html += '<div class="detail-item' + isFull + '">'
      + '<div class="d-label">' + esc(f) + '</div>'
      + '<div class="d-val">' + esc(val) + '</div>'
      + '</div>';
  });

  html += '</div>';

    html += buildHistorySectionHtml(row['DP-REQ Number']);

  if (row._editor) {
    html += '<div class="modal-editor">Editor tab: ' + esc(row._editor) + '</div>';
  }

  document.getElementById('modalInner').innerHTML = html;
  document.getElementById('modalBg').style.display = 'flex';
}

// ─── Assigner history (from the merged "Assignments" tab) ─────────────────────
// Joined on Listing Reference (Copier) === Ref (Assigner) — same DP-R/DP-S value
// in both sheets.
//
// Preferred path: Apps Script now writes every assign/reassign/start/hold/
// complete/reject/download/recategorize as its own immutable entry in the
// row's History column (a JSON array), specifically so reassigning a
// listing — or auto-reopening a Rejected one once new photos land under a
// different category — no longer erases whoever/whatever came before.
// Falls back to reconstructing from the flat AssignedAt/StartedAt/etc.
// columns (the old approach — only ever shows the single most recent
// assignment/reassignment) for any row that hasn't been touched since that
// column was added.
var HISTORY_EVENT_META = {
  assigned:      { label: 'Assigned',      type: 'assigned' },
  started:       { label: 'Started',       type: 'started' },
  onhold:        { label: 'On hold',       type: 'onhold' },
  completed:     { label: 'Completed',     type: 'completed' },
  rejected:      { label: 'Rejected',      type: 'rejected' },
  downloaded:    { label: 'Downloaded',    type: 'downloaded' },
  reassigned:    { label: 'Reassigned',    type: 'reassigned' },
  unassigned:    { label: 'Unassigned',    type: 'unassigned' },
  recategorized: { label: 'Recategorized', type: 'recategorized' },
  downloaded_cleared: { label: 'Download cleared', type: 'downloaded_cleared' },
};

function metaForHistoryEvent(ev) {
  switch (ev.type) {
    case 'assigned':      return ev.editor ? ('to ' + ev.editor) : '';
    case 'reassigned':    return (ev.from && ev.to ? (ev.from + ' \u2192 ' + ev.to) : '') + (ev.by ? (' by ' + ev.by) : '');
    case 'unassigned':    return ev.editor ? ('was ' + ev.editor) : '';
    case 'onhold':        return ev.reason || '';
    case 'recategorized': return (ev.from && ev.to) ? (ev.from + ' \u2192 ' + ev.to) : '';
    case 'downloaded_cleared': return ev.reason || '';
    case 'started': case 'completed': case 'rejected': case 'downloaded':
      return ev.editor ? ('by ' + ev.editor) : '';
    default: return '';
  }
}

function parseAssignmentHistory(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw; // ASSIGN_DATA already parses this server-side
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function buildHistorySectionHtml(ref) {
  var html = '<div class="history-section">'
    + '<div class="d-label">History</div>';

  // Assignments now lives on its own dedicated backend (ASSIGN_DATA, fetched
  // from S.assignUrl) rather than S.data['Assignments'] — that tab no
  // longer exists in the Copier spreadsheet/script at all since the split,
  // so a lookup against S.data would always come back empty here.
  var rows = (ASSIGN_DATA && Array.isArray(ASSIGN_DATA.assignments)) ? ASSIGN_DATA.assignments : [];
  var match = null;
  // Search from the END — a Ref can now have more than one row (see the
  // Apps Script's reopenOnCategoryChange, which appends a fresh row instead
  // of overwriting on a rework cycle), and new rows are always appended
  // after old ones. The first match would silently grab an old, permanently
  // -preserved Rejected/Completed cycle instead of the current one.
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].ref === ref) { match = rows[i]; break; }
  }

  if (!match) {
    html += '<div class="history-empty">No history</div></div>';
    return html;
  }

  var events = [];
  var log = parseAssignmentHistory(match.history);

  if (log.length > 0) {
    events = log
      .filter(function(ev) { return ev && ev.ts && HISTORY_EVENT_META[ev.type]; })
      .map(function(ev) {
        return {
          at:    ev.ts,
          type:  HISTORY_EVENT_META[ev.type].type,
          label: HISTORY_EVENT_META[ev.type].label,
          meta:  metaForHistoryEvent(ev),
        };
      });
  } else {
    // Fallback for listings whose last write happened before the History
    // column existed. Field names are camelCase here (ASSIGN_DATA's own
    // shape from getAssignerAssignments), not the PascalCase sheet-header
    // names S.data used to carry.
    if (match.assignedAt) {
      // If this listing was later reassigned, the "assigned to" name for this
      // very first event is who it was ORIGINALLY given to — reassignedFrom —
      // not the current editor, which by then has already moved on.
      var firstEditor = match.reassignedFrom || match.editor || '';
      events.push({
        at:    match.assignedAt,
        type:  'assigned',
        label: 'Assigned',
        meta:  firstEditor ? ('to ' + firstEditor) : '',
      });
    }

    if (match.reassignedAt) {
      var from = match.reassignedFrom || '?';
      var to   = match.reassignedTo   || '?';
      var by   = match.reassignedBy;
      events.push({
        at:    match.reassignedAt,
        type:  'reassigned',
        label: 'Reassigned',
        meta:  from + ' \u2192 ' + to + (by ? (' by ' + by) : ''),
      });
    }

    if (match.startedAt) {
      events.push({
        at:    match.startedAt,
        type:  'started',
        label: 'Started',
        meta:  '',
      });
    }

    if (match.onHoldAt) {
      events.push({
        at:    match.onHoldAt,
        type:  'onhold',
        label: 'On hold',
        meta:  match.onHoldReason || '',
      });
    }

    if (match.completedAt) {
      events.push({
        at:    match.completedAt,
        type:  'completed',
        label: 'Completed',
        meta:  '',
      });
    }

    if (match.rejectedAt) {
      events.push({
        at:    match.rejectedAt,
        type:  'rejected',
        label: 'Rejected',
        meta:  '',
      });
    }
  }

  if (!events.length) {
    html += '<div class="history-empty">No history</div></div>';
    return html;
  }

  events.sort(function(a, b) { return new Date(a.at) - new Date(b.at); });

  html += '<div class="history-timeline">';
  events.forEach(function(ev, i) {
    var isLast = i === events.length - 1;
    html += '<div class="history-item' + (isLast ? ' is-last' : '') + '">'
      +   '<div class="history-dot h-dot-' + ev.type + '"></div>'
      +   '<div class="history-item-body">'
      +     '<div class="history-label">' + esc(ev.label) + '</div>'
      +     '<div class="history-meta">' + esc(fmtDateFull(ev.at)) + (ev.meta ? ' \u00B7 ' + esc(ev.meta) : '') + '</div>'
      +   '</div>'
      + '</div>';
  });
  html += '</div></div>';

  return html;
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function openEditModal() {
  var row = MODAL_ROW;
  if (!row) return;

  var editFields = [
    { key:'DP-REQ Number',          type:'text' },
    { key:'Listing Reference',      type:'text' },
    { key:'Listing Link',           type:'text' },
    { key:'Location',               type:'text' },
    { key:'Unit / Plot No',         type:'text' },
    { key:'Category',               type:'select', options:['','Apartment','Villa','Townhouse','Penthouse','Bulk Units','Office','Retail','Warehouse','Land','Other'] },
    { key:'Beds',                   type:'text' },
    { key:'Furnishing',             type:'select', options:['','Furnished','Unfurnished','Partly Furnished'] },
    { key:'Photographer',           type:'text' },
    { key:'List Type',              type:'select', options:['','Photo Request','Agent Request','Brochure'] },
    { key:'Rejection Reason',       type:'text' },
    { key:'Agent Request Sub-type', type:'text' },
    { key:'Notes',                  type:'textarea' },
  ];

  var formRows = editFields.map(function(f) {
    var val = String(row[f.key] || '');
    var isFull = (f.type === 'textarea' || f.key === 'Listing Link') ? ' full' : '';
    var input = '';

    if (f.type === 'select') {
      input = '<select class="edit-input" data-field="' + esc(f.key) + '">';
      f.options.forEach(function(o) {
        input += '<option value="' + esc(o) + '"' + (o === val ? ' selected' : '') + '>' + (o || '— none —') + '</option>';
      });
      input += '</select>';
    } else if (f.type === 'textarea') {
      input = '<textarea class="edit-input" data-field="' + esc(f.key) + '" rows="3">' + esc(val) + '</textarea>';
    } else {
      input = '<input class="edit-input" type="text" data-field="' + esc(f.key) + '" value="' + esc(val) + '">';
    }

    return '<div class="detail-item' + isFull + '">'
      + '<div class="d-label">' + esc(f.key) + '</div>'
      + input
      + '</div>';
  }).join('');

  var html = '<div class="modal-head">'
    + '<div>'
    +   '<div class="modal-req">' + esc(row['DP-REQ Number'] || 'Edit Listing') + '</div>'
    +   '<div class="modal-ref">' + esc(row['Listing Reference'] || '') + '</div>'
    +   '<div style="margin-top:4px;font-size:11px;font-family:var(--mono);color:var(--text3)">Date Uploaded updates to now · Status sets to <span style="color:var(--green)">Uploaded</span> on save</div>'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:8px;">'
    +   '<button class="modal-edit-btn" id="editPasteBtn" title="Paste copied data from extension">📋 Paste</button>'
    +   '<button class="modal-close" onclick="openModal(MODAL_ROW)">✕</button>'
    + '</div>'
    + '</div>'
    + '<div class="edit-form-grid">' + formRows + '</div>'
    + '<div style="font-size:11px;font-family:var(--mono);color:var(--text3);margin-bottom:16px;">'
    +   'Received Date: <strong style="color:var(--text2)">' + esc(fmtDate(row['Received Date'])) + '</strong> (unchanged)'
    + '</div>'
    + '<div class="edit-actions">'
    +   '<button class="edit-save-btn" id="editSaveBtn">Save Changes</button>'
    +   '<button class="edit-cancel-btn" id="editCancelBtn">Cancel</button>'
    + '</div>';

  document.getElementById('modalInner').innerHTML = html;

  document.getElementById('editCancelBtn').addEventListener('click', function() {
    openModal(MODAL_ROW);
  });

  // Paste button — reads clipboard and fills matching fields
  document.getElementById('editPasteBtn').addEventListener('click', function() {
    navigator.clipboard.readText()
      .then(function(text) {
        var parsed;
        try { parsed = JSON.parse(text); } catch(e) {
          alert('Clipboard does not contain valid copied data. Use the "📋 Copy Data" button in the extension first.');
          return;
        }

        if (!parsed.__dp_edit_paste__) {
          alert('Clipboard data was not copied from the DP extension. Use "📋 Copy Data" button first.');
          return;
        }

        var filled = 0;
        document.querySelectorAll('#modalInner .edit-input').forEach(function(inp) {
          var field = inp.dataset.field;
          if (field && parsed.hasOwnProperty(field) && parsed[field] !== '') {
            inp.value = parsed[field];
            inp.style.borderColor = 'var(--green)';
            filled++;
            setTimeout(function() { inp.style.borderColor = ''; }, 1500);
          }
        });

        if (filled > 0) {
          var btn = document.getElementById('editPasteBtn');
          btn.textContent = '✅ Pasted ' + filled + ' fields';
          setTimeout(function() { btn.textContent = '📋 Paste'; }, 2000);
        }
      })
      .catch(function() {
        alert('Could not read clipboard. Make sure you clicked "📋 Copy Data" in the extension and allow clipboard access.');
      });
  });

  document.getElementById('editSaveBtn').addEventListener('click', function() {
    saveEdit(row);
  });
}

function saveEdit(row) {
  var inputs = document.querySelectorAll('#modalInner .edit-input');
  var updates = {};
  inputs.forEach(function(inp) {
    updates[inp.dataset.field] = inp.value;
  });

  // Auto-update Date Uploaded — formatted same as extension (long readable format)
  var now = new Date();
  var days    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var months  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var hours   = now.getHours();
  var mins    = String(now.getMinutes()).padStart(2,'0');
  var ampm    = hours >= 12 ? 'PM' : 'AM';
  var h12     = hours % 12 || 12;
  updates['Date Uploaded'] = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear()
    + ' at ' + h12 + ':' + mins + ' ' + ampm;

  // Auto-set Status to Uploaded on save
  updates['Status'] = 'Uploaded';

  var btn = document.getElementById('editSaveBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  fetch(S.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action:     'updateRow',
      editorName: row._editor,
      rowIndex:   row._rowIndex || -1,
      updates:    updates,
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    if (!json.success) {
      alert('Update failed: ' + (json.error || 'Unknown error'));
      btn.textContent = 'Save Changes';
      btn.disabled = false;
      return;
    }
    // Update local state
    if (row._editor && S.data[row._editor]) {
      S.data[row._editor] = S.data[row._editor].map(function(r) {
        if (r._rowIndex === row._rowIndex) return Object.assign({}, r, updates);
        return r;
      });
    }
    MODAL_ROW = Object.assign({}, row, updates);
    document.getElementById('modalBg').style.display = 'none';
    render();
  })
  .catch(function(err) {
    alert('Error: ' + err.message);
    btn.textContent = 'Save Changes';
    btn.disabled = false;
  });
}

function closeModal(e) {
  if (e.target === document.getElementById('modalBg')) {
    document.getElementById('modalBg').style.display = 'none';
  }
}

function closeExtModal(e) {
  if (e.target === document.getElementById('extModalBg')) {
    document.getElementById('extModalBg').style.display = 'none';
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.getElementById('modalBg').style.display = 'none';
    document.getElementById('extModalBg').style.display = 'none';
    document.getElementById('amenitiesBg').style.display = 'none';
  }
});

// ─── Report View ──────────────────────────────────────────────────────────────
function getRangeLabel() {
  if (S.fromDate && S.toDate) return S.fromDate + ' → ' + S.toDate;
  if (S.range === 'today') return 'Today — ' + new Date().toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  if (S.range === 'yesterday') return 'Yesterday';
  if (S.range === 'week')  return 'Last 7 days';
  if (S.range === 'month') return 'Last 30 days';
  return 'All time';
}

function getTodayKey() {
  var now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
}

function getIncomingForRange() {
  var rows = (S.data['Incoming'] || []);
  if (!rows.length) return null;
  if (S.range === 'today' || (!S.range && !S.fromDate)) {
    var todayKey = getTodayKey();
    return rows.find(function(r) {
      var d = parseAnyDate(r['Date']);
      if (!d) return false;
      var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      return key === todayKey;
    }) || null;
  }
  var inRange = rows.filter(rowInRange);
  if (!inRange.length) return null;
  return inRange.reduce(function(acc, r) {
    return {
      'Photo Request': (acc['Photo Request']||0) + (parseInt(r['Photo Request'],10)||0),
      'Agent Request': (acc['Agent Request']||0) + (parseInt(r['Agent Request'],10)||0),
      'Brochure':      (acc['Brochure']     ||0) + (parseInt(r['Brochure'],     10)||0),
      'Lifestyle':     (acc['Lifestyle']    ||0) + (parseInt(r['Lifestyle'],    10)||0),
      'Profile':       (acc['Profile']      ||0) + (parseInt(r['Profile'],      10)||0),
      'Others':        (acc['Others']       ||0) + (parseInt(r['Others'],       10)||0),
    };
  }, {});
}

function renderReport() {
  var wrap    = document.getElementById('reportView');
  var allRows = getAllRows().filter(rowInRange);

  // ── Rejected rows are a SEPARATE metric — must NOT inflate other counts ─────
  var rejectedRows = allRows.filter(function(r) { return norm(r['Status']) === 'rejected'; });
  var actualRej    = rejectedRows.length;

  // Photo / Agent / Brochure counts exclude rejected rows
  var nonRejected = allRows.filter(function(r) { return norm(r['Status']) !== 'rejected'; });
  var actualPhoto  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'photo request'; }).length;
  var actualAgent  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'agent request'; }).length;
  var actualBroch  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'brochure'; }).length;
  var actualTotal  = actualPhoto + actualAgent + actualBroch;

  var uploaded = allRows.filter(function(r) { return norm(r['Status']) === 'uploaded'; }).length;
  var pending  = allRows.filter(function(r) { return norm(r['Status']) === 'pending' || norm(r['Status']) === 'ongoing'; }).length;
  var compRate = allRows.length > 0 ? Math.round(uploaded / allRows.length * 100) : 0;

  var lifestyleRows   = (S.data['Lifestyle'] || []).filter(rowInRange);
  var actualLifestyle = lifestyleRows.reduce(function(s,r) { return s+(parseInt(r['Lifestyle'],10)||0); }, 0);
  var actualProfile   = lifestyleRows.reduce(function(s,r) { return s+(parseInt(r['Profile'],  10)||0); }, 0);
  var actualOthers    = lifestyleRows.reduce(function(s,r) { return s+(parseInt(r['Others'],   10)||0)+(parseInt(r['Count'],10)||0); }, 0);

  // Email Closed — unlike Lifestyle/Profile/Others, this DOES roll into Total
  // (see editorBreakdown/team below), per how it's meant to read next to Rejected.
  var emailClosedRows = (S.data['Email Closed'] || []).filter(rowInRange);

  var incoming = getIncomingForRange();
  var expPhoto = incoming ? (parseInt(incoming['Photo Request'],10)||0) : null;
  var expAgent = incoming ? (parseInt(incoming['Agent Request'],10)||0) : null;
  var expBroch = incoming ? (parseInt(incoming['Brochure'],     10)||0) : null;
  var expLife  = incoming ? (parseInt(incoming['Lifestyle'],    10)||0) : null;
  var expProf  = incoming ? (parseInt(incoming['Profile'],      10)||0) : null;
  var expOth   = incoming ? (parseInt(incoming['Others'],       10)||0) : null;
  var expTotal = incoming ? (expPhoto + expAgent + expBroch) : null;

  function diffBadge(actual, expected) {
    if (expected === null) return '';
    var diff = actual - expected;
    if (diff === 0) return '<span class="inc-diff inc-even">✓</span>';
    if (diff > 0)   return '<span class="inc-diff inc-over">▲ +' + diff + '</span>';
    return '<span class="inc-diff inc-under">▼ ' + diff + '</span>';
  }

  function incCard(label, actual, expected, valClass) {
    return '<div class="incoming-item">'
      + '<div class="i-label">' + label + '</div>'
      + '<div class="i-val ' + (valClass||'') + '">' + actual + '</div>'
      + (expected !== null
          ? '<div class="inc-expected">Expected: <strong>' + expected + '</strong>' + diffBadge(actual, expected) + '</div>'
          : '<div class="inc-expected inc-no-data">No morning input</div>')
      + '</div>';
  }

  // ── Per-editor breakdown — rejected is its own column ─────────────────────
  var editorBreakdown = S.editors.map(function(editor) {
    var rows    = (S.data[editor] || []).map(function(r) { return Object.assign({_editor:editor},r); }).filter(rowInRange);
    var nonRej  = rows.filter(function(r) { return norm(r['Status']) !== 'rejected'; });
    var lRows   = lifestyleRows.filter(function(r) { return String(r['Editor']||'').trim() === editor; });
    var ecRows  = emailClosedRows.filter(function(r) { return String(r['Editor']||'').trim() === editor; });
    return {
      editor:      editor,
      photo:       nonRej.filter(function(r) { return norm(r['List Type']) === 'photo request'; }).length,
      agent:       nonRej.filter(function(r) { return norm(r['List Type']) === 'agent request'; }).length,
      broch:       nonRej.filter(function(r) { return norm(r['List Type']) === 'brochure'; }).length,
      rejected:    rows.filter(function(r)   { return norm(r['Status'])   === 'rejected'; }).length,
      emailClosed: ecRows.length,
      lifestyle:   lRows.reduce(function(s,r){return s+(parseInt(r['Lifestyle'],10)||0);},0),
      profile:     lRows.reduce(function(s,r){return s+(parseInt(r['Profile'],  10)||0);},0),
      others:      lRows.reduce(function(s,r){return s+(parseInt(r['Others'],   10)||0)+(parseInt(r['Count'],10)||0);},0),
      // Email Closed rolls into Total (unlike Lifestyle/Profile/Others, which
      // are tracked separately) — per how it's meant to sit next to Rejected.
      total:       rows.length + ecRows.length,
    };
  }).filter(function(r) { return r.total + r.lifestyle + r.profile + r.others > 0; })
    .sort(function(a,b) { return (b.total+b.lifestyle+b.profile+b.others)-(a.total+a.lifestyle+a.profile+a.others); });

  var team = editorBreakdown.reduce(function(s,r) {
    return {
      photo:       s.photo       + r.photo,
      agent:       s.agent       + r.agent,
      broch:       s.broch       + r.broch,
      rejected:    s.rejected    + r.rejected,
      emailClosed: s.emailClosed + r.emailClosed,
      lifestyle:   s.lifestyle   + r.lifestyle,
      profile:     s.profile     + r.profile,
      others:      s.others      + r.others,
      total:       s.total       + r.total,
    };
  }, {photo:0,agent:0,broch:0,rejected:0,emailClosed:0,lifestyle:0,profile:0,others:0,total:0});

  function num(v, color) {
    var style = color ? ' style="color:' + color + '"' : '';
    return '<td class="num-cell' + (v===0?' num-zero':'') + '"' + style + '>' + v + '</td>';
  }

  var editorRows = editorBreakdown.map(function(r) {
    return '<tr>'
      + '<td class="editor-name">' + esc(r.editor) + '</td>'
      + num(r.photo) + num(r.agent) + num(r.broch)
      + num(r.rejected, r.rejected > 0 ? 'var(--red)' : null)
      + num(r.emailClosed, r.emailClosed > 0 ? 'var(--cyan)' : null)
      + num(r.lifestyle,'var(--purple)') + num(r.profile,'var(--blue)') + num(r.others,'var(--orange)')
      + num(r.total)
      + '</tr>';
  }).join('');

  // colspan for pending/rate rows = 8 (photo+agent+offplan+rejected+emailClosed+lifestyle+profile+others)
  var footColspan = '8';

  wrap.innerHTML =
    '<div class="report-header">'
    + '<div>'
    +   '<div class="report-title">Daily Report</div>'
    +   '<div class="report-subtitle">' + esc(getRangeLabel()) + '</div>'
    + '</div>'
    + '<button class="modal-edit-btn" id="editIncomingBtn" style="height:32px;padding:0 14px;font-size:12px;">✏️ Morning Input</button>'
    + '</div>'

    + '<div class="report-incoming">'
    +   '<h3>Incoming Requests <span style="font-size:10px;font-weight:400;color:var(--text3);margin-left:8px;">ACTUAL vs EXPECTED</span></h3>'
    +   '<div class="incoming-grid">'
    +     incCard('📷 Photographer Photos',   actualPhoto,     expPhoto, 'blue')
    +     incCard('🏠 Agent Property Photos',  actualAgent,     expAgent, 'orange')
    +     incCard('📄 Offplan / Brochure',     actualBroch,     expBroch, 'green')
    // FEATURE 1 — Rejected card between Offplan and Lifestyle
    +     '<div class="incoming-item">'
    +       '<div class="i-label">❌ Rejected</div>'
    +       '<div class="i-val" style="color:var(--red)">' + actualRej + '</div>'
    +       '<div class="inc-expected inc-no-data">Independent metric</div>'
    +     '</div>'
    +     incCard('🎬 Lifestyle',              actualLifestyle, expLife,  '')
    +     incCard('👤 Profile',                actualProfile,   expProf,  '')
    +     incCard('📦 Others',                 actualOthers,    expOth,   '')
    +     '<div class="incoming-item">'
    +       '<div class="i-label">Total Processed</div>'
    +       '<div class="i-val white">' + actualTotal + '</div>'
    +       (expTotal !== null
    +         '<div class="inc-expected">Expected: <strong>' + expTotal + '</strong>' + diffBadge(actualTotal, expTotal) + '</div>'
    +         '<div class="inc-expected inc-no-data">No morning input</div>')
    +     '</div>'
    +   '</div>'
    + '</div>'

    + '<div class="report-table-wrap">'
    +   '<table class="report-table"><thead><tr>'
    +     '<th>Editor</th><th>Photo</th><th>Agent</th><th>Offplan</th>'
    // FEATURE 2 — Rejected column between Offplan and Lifestyle
    +     '<th style="color:var(--red)">Rejected</th>'
    +     '<th style="color:var(--cyan)">Email Closed</th>'
    +     '<th style="color:var(--purple)">Lifestyle</th>'
    +     '<th style="color:var(--blue)">Profile</th>'
    +     '<th style="color:var(--orange)">Others</th>'
    +     '<th>Total</th>'
    +   '</tr></thead><tbody>'
    +   editorRows
    // FEATURE 4 — Team Total includes Rejected
    +   '<tr class="team-total"><td>Team Total</td>'
    +     num(team.photo) + num(team.agent) + num(team.broch)
    +     num(team.rejected, team.rejected > 0 ? 'var(--red)' : null)
    +     num(team.emailClosed, team.emailClosed > 0 ? 'var(--cyan)' : null)
    +     num(team.lifestyle,'var(--purple)') + num(team.profile,'var(--blue)') + num(team.others,'var(--orange)')
    +     num(team.total)
    +   '</tr>'
    // FEATURE 5 — Pending and Completion Rate unchanged
    +   '<tr class="pending-row"><td>Pending</td><td colspan="' + footColspan + '"></td><td class="num-cell">' + pending + '</td></tr>'
    +   '<tr class="rate-row"><td>Completion Rate</td><td colspan="' + footColspan + '"><span style="font-size:11px;color:var(--text3)">Uploaded ÷ Total</span></td><td class="num-cell">' + compRate + '%</td></tr>'
    +   '</tbody></table>'
    + '</div>';
}
// ─── Incoming Modal ───────────────────────────────────────────────────────────
function openIncomingModal() {
  var existing = document.getElementById('incomingModalBg');
  if (existing) existing.remove();

  var todayRow = (S.range === 'today' || !S.range) ? getIncomingForRange() : null;
  var fields = [
    { key:'Photo Request', label:'📷 Photographer Photos', color:'var(--blue)' },
    { key:'Agent Request', label:'🏠 Agent Property Photos', color:'var(--orange)' },
    { key:'Brochure',      label:'📄 Offplan / Brochure',   color:'var(--green)' },
    { key:'Lifestyle',     label:'🎬 Lifestyle',             color:'var(--purple)' },
    { key:'Profile',       label:'👤 Profile',               color:'var(--blue)' },
    { key:'Others',        label:'📦 Others',                color:'var(--orange)' },
  ];

  var today = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'short', year:'numeric' });

  var inputsHtml = fields.map(function(f) {
    var val = todayRow ? (parseInt(todayRow[f.key],10)||0) : 0;
    return '<div class="detail-item">'
      + '<div class="d-label" style="color:' + f.color + '">' + f.label + '</div>'
      + '<input class="edit-input incoming-field" type="number" min="0" step="1" data-field="' + esc(f.key) + '" value="' + val + '" placeholder="0">'
      + '</div>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.id = 'incomingModalBg';
  overlay.className = 'modal-bg';
  overlay.style.display = 'flex';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = '<div class="modal" style="max-width:500px;">'
    + '<div class="modal-head">'
    +   '<div>'
    +     '<div class="modal-req" style="font-size:16px;">✏️ Morning Input</div>'
    +     '<div class="modal-ref">' + esc(today) + '</div>'
    +     '<div style="margin-top:4px;font-size:11px;font-family:var(--mono);color:var(--text3)">Enter expected request counts for today. Updates if already submitted.</div>'
    +   '</div>'
    +   '<button class="modal-close" id="incomingCloseBtn">✕</button>'
    + '</div>'
    + '<div class="edit-form-grid" style="margin-bottom:16px;">' + inputsHtml + '</div>'
    + '<div class="edit-actions">'
    +   '<button class="edit-save-btn" id="incomingSaveBtn">Save Morning Input</button>'
    +   '<button class="edit-cancel-btn" id="incomingCancelBtn">Cancel</button>'
    + '</div>'
    + '<p id="incomingFeedback" style="font-size:12px;margin-top:10px;font-family:var(--mono);display:none;"></p>'
    + '</div>';

  document.body.appendChild(overlay);
  document.getElementById('incomingCloseBtn').onclick  = function() { overlay.remove(); };
  document.getElementById('incomingCancelBtn').onclick = function() { overlay.remove(); };
  document.getElementById('incomingSaveBtn').onclick   = function() { saveIncoming(overlay); };
}

function saveIncoming(overlay) {
  var inputs = overlay.querySelectorAll('.incoming-field');
  var data   = {};
  inputs.forEach(function(inp) { data[inp.dataset.field] = parseInt(inp.value,10)||0; });

  var btn      = document.getElementById('incomingSaveBtn');
  var feedback = document.getElementById('incomingFeedback');
  btn.textContent = 'Saving…';
  btn.disabled    = true;

  fetch(S.url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ action: 'saveIncoming', data: data })
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    btn.textContent = 'Save Morning Input';
    btn.disabled    = false;
    if (!json.success) {
      feedback.textContent = '❌ ' + (json.error || 'Unknown error');
      feedback.style.color = 'var(--red)';
      feedback.style.display = 'block';
      return;
    }
    var todayStr = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    if (!S.data['Incoming']) S.data['Incoming'] = [];
    var todayKey = getTodayKey();
    var existIdx = -1;
    S.data['Incoming'].forEach(function(r, i) {
      var d = parseAnyDate(r['Date']);
      if (!d) return;
      var key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      if (key === todayKey) existIdx = i;
    });
    var newRow = Object.assign({ 'Date': todayStr }, data);
    if (existIdx >= 0) { S.data['Incoming'][existIdx] = newRow; }
    else { S.data['Incoming'].push(newRow); }
    overlay.remove();
    renderReport();
  })
  .catch(function(err) {
    btn.textContent = 'Save Morning Input';
    btn.disabled    = false;
    feedback.textContent = '❌ ' + err.message;
    feedback.style.color = 'var(--red)';
    feedback.style.display = 'block';
  });
}

// ─── Delete (Pending/Ongoing only) ───────────────────────────────────────────
function confirmDelete(row) {
  // Close the modal first
  document.getElementById('modalBg').style.display = 'none';

  var existing = document.getElementById('delConfirmOverlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'delConfirmOverlay';
  overlay.className = 'del-confirm';

  var preview = [row['DP-REQ Number'], row['Listing Reference'], row['Location']]
    .filter(Boolean).join(' · ');

  overlay.innerHTML =
    '<div class="del-box">'
    + '<h3>Delete Entry?</h3>'
    + '<p>This will permanently remove the row from the Google Sheet. This cannot be undone.</p>'
    + (preview ? '<div class="req-preview">' + esc(preview) + '</div>' : '')
    + '<div class="del-actions">'
    +   '<button class="del-cancel" id="delCancelBtn">Cancel</button>'
    +   '<button class="del-confirm-btn" id="delConfirmBtn">Delete</button>'
    + '</div>'
    + '</div>';

  document.body.appendChild(overlay);

  document.getElementById('delCancelBtn').addEventListener('click', function() {
    overlay.remove();
  });
  document.getElementById('delConfirmBtn').addEventListener('click', function() {
    overlay.remove();
    executeDelete(row);
  });
}

function executeDelete(row) {
  var btn = document.getElementById('refreshBtn');
  btn.classList.add('spin');

  fetch(S.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action:           'deleteRow',
      editorName:       row._editor,
      dpReqNumber:      row['DP-REQ Number']     || '',
      listingReference: row['Listing Reference']  || '',
      location:         row['Location']           || '',
      rowIndex:         row._rowIndex             || -1,
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    btn.classList.remove('spin');
    if (!json.success) {
      alert('Delete failed: ' + (json.error || 'Unknown error'));
      return;
    }
    if (row._editor && S.data[row._editor]) {
      S.data[row._editor] = S.data[row._editor].filter(function(r) {
        if (row._rowIndex && row._rowIndex > 0) return r._rowIndex !== row._rowIndex;
        return !(r['DP-REQ Number']    === row['DP-REQ Number']
              && r['Listing Reference'] === row['Listing Reference']
              && r['Location']          === row['Location']);
      });
    }
    render();
  })
  .catch(function(err) {
    btn.classList.remove('spin');
    alert('Error: ' + err.message);
  });
}

// ─── Amenities ────────────────────────────────────────────────────────────────

var amenitiesMode = 'search'; // 'search' | 'add'

function openAmenitiesModal() {
  // Reset to search mode
  amenitiesMode = 'search';
  document.getElementById('amenitiesSearchMode').style.display = '';
  document.getElementById('amenitiesAddMode').style.display = 'none';
  document.getElementById('amenitiesToggleBtn').textContent = '➕ Add New';
  document.getElementById('amenitiesSubtitle').textContent = 'Search properties for amenity info';

  // Clear search
  document.getElementById('amenitiesSearchInput').value = '';
  renderAmenitiesResults('');

  document.getElementById('amenitiesBg').style.display = 'flex';

  // Focus search input
  setTimeout(function() {
    document.getElementById('amenitiesSearchInput').focus();
  }, 100);

  // Wire up search input
  var input = document.getElementById('amenitiesSearchInput');
  input.oninput = function() {
    renderAmenitiesResults(this.value.toLowerCase().trim());
  };

  // Wire up save button
  document.getElementById('amSaveBtn').onclick = saveAmenity;
}

function closeAmenitiesModal(e) {
  if (e.target === document.getElementById('amenitiesBg')) {
    document.getElementById('amenitiesBg').style.display = 'none';
  }
}

function toggleAmenitiesMode() {
  amenitiesMode = amenitiesMode === 'search' ? 'add' : 'search';
  var isAdd = amenitiesMode === 'add';

  document.getElementById('amenitiesSearchMode').style.display = isAdd ? 'none' : '';
  document.getElementById('amenitiesAddMode').style.display   = isAdd ? '' : 'none';
  document.getElementById('amenitiesToggleBtn').textContent   = isAdd ? '🔍 Search' : '➕ Add New';
  document.getElementById('amenitiesSubtitle').textContent    = isAdd ? 'Add a new amenity entry' : 'Search properties for amenity info';

  if (isAdd) {
    document.getElementById('amLocation').value  = '';
    document.getElementById('amDriveLink').value = '';
    document.getElementById('amNotes').value     = '';
    document.getElementById('amFeedback').style.display = 'none';
    setTimeout(function() { document.getElementById('amLocation').focus(); }, 100);
  } else {
    setTimeout(function() { document.getElementById('amenitiesSearchInput').focus(); }, 100);
  }
}

function renderAmenitiesResults(query) {
  var wrap     = document.getElementById('amenitiesResults');
  var amenities = (S.data['Amenities'] || []);

  var filtered = query
    ? amenities.filter(function(r) {
        return (String(r['Location'] || '') + String(r['Notes'] || ''))
          .toLowerCase().includes(query);
      })
    : amenities;

  if (amenities.length === 0) {
    wrap.innerHTML = '<div class="am-empty">No amenities added yet.<br>Click ➕ Add New to get started.</div>';
    return;
  }

  if (filtered.length === 0) {
    wrap.innerHTML = '<div class="am-empty">No results for "<strong>' + esc(query) + '</strong>"</div>';
    return;
  }

  var countHtml = '<div class="am-count">' + filtered.length + ' result' + (filtered.length !== 1 ? 's' : '') + '</div>';

  var cardsHtml = filtered.map(function(r) {
    var loc   = esc(String(r['Location']   || '—'));
    var notes = esc(String(r['Notes']      || ''));
    var link  = String(r['Drive Link']     || '');
    return '<a class="am-result-card" href="' + esc(link) + '" target="_blank" rel="noopener">'
      + '<div class="am-result-loc">🏢 ' + loc + '</div>'
      + (notes ? '<div class="am-result-notes">📋 ' + notes + '</div>' : '')
      + '<div class="am-result-link">↗ Open in Google Drive</div>'
      + '</a>';
  }).join('');

  wrap.innerHTML = countHtml + cardsHtml;
}

function saveAmenity() {
  var location  = document.getElementById('amLocation').value.trim();
  var driveLink = document.getElementById('amDriveLink').value.trim();
  var notes     = document.getElementById('amNotes').value.trim();
  var feedback  = document.getElementById('amFeedback');
  var btn       = document.getElementById('amSaveBtn');

  if (!location) {
    feedback.textContent = '❌ Location is required.';
    feedback.style.color = 'var(--red)';
    feedback.style.display = 'block';
    return;
  }
  if (!driveLink) {
    feedback.textContent = '❌ Google Drive link is required.';
    feedback.style.color = 'var(--red)';
    feedback.style.display = 'block';
    return;
  }

  btn.textContent = 'Saving…';
  btn.disabled    = true;
  feedback.style.display = 'none';

  fetch(S.url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({
      action:    'addAmenity',
      location:  location,
      driveLink: driveLink,
      notes:     notes,
    })
  })
  .then(function(r) { return r.json(); })
  .then(function(json) {
    btn.textContent = 'Save Amenity';
    btn.disabled    = false;

    if (!json.success) {
      feedback.textContent    = '❌ ' + (json.error || 'Unknown error');
      feedback.style.color    = 'var(--red)';
      feedback.style.display  = 'block';
      return;
    }

    // Add to local state immediately
    if (!S.data['Amenities']) S.data['Amenities'] = [];
    S.data['Amenities'].push({
      'Location':   location,
      'Drive Link': driveLink,
      'Notes':      notes,
      '_rowIndex':  S.data['Amenities'].length + 2,
    });

    feedback.textContent   = '✅ Amenity saved!';
    feedback.style.color   = 'var(--green)';
    feedback.style.display = 'block';

    // Switch back to search and show the new entry after a moment
    setTimeout(function() {
      toggleAmenitiesMode();
      document.getElementById('amenitiesSearchInput').value = location;
      renderAmenitiesResults(location.toLowerCase());
    }, 800);
  })
  .catch(function(err) {
    btn.textContent = 'Save Amenity';
    btn.disabled    = false;
    feedback.textContent   = '❌ ' + err.message;
    feedback.style.color   = 'var(--red)';
    feedback.style.display = 'block';
  });
}

// ─── Aurora + Particle Animation ─────────────────────────────────────────────

var _animationFrame = null;
var _canvas         = null;
var _ctx            = null;
var _particles      = [];
var _blobs          = [];
var _animRunning    = false;

function getAuroraColors() {
  var theme = document.documentElement.getAttribute('data-theme') || 'green';
  var light = document.body.classList.contains('light');

  var palettes = {
    green:    ['#22c55e','#16a34a','#4ade80','#052e16'],
    blue:     ['#3b82f6','#1d4ed8','#60a5fa','#1e3a5f'],
    red:      ['#ef4444','#dc2626','#f87171','#450a0a'],
    yellow:   ['#eab308','#ca8a04','#fde047','#422006'],
    stellar:  ['#38CE3C','#7c3aed','#2563eb','#0d0d1a'],
    staradmin:['#F29F67','#f97316','#fb923c','#1a0a00'],
    corona:   ['#AF1763','#db2777','#f472b6','#1a0010'],
    black:    ['#ffffff','#aaaaaa','#555555','#000000'],
    white:    ['#111111','#444444','#888888','#ffffff'],
  };

  var colors = palettes[theme] || palettes.green;

  if (light) {
    // Lighter, more pastel in light mode
    return colors.map(function(c) { return c + '55'; });
  }
  return colors;
}

function initAnimation() {
  _canvas = document.getElementById('dp-aurora-canvas');
  if (!_canvas) return;
  _ctx = _canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  initBlobs();
  initParticles();

  setTimeout(function() {
    _canvas.classList.add('visible');
  }, 300);

  _animRunning = true;
  animationLoop();
}

function resizeCanvas() {
  if (!_canvas) return;
  _canvas.width  = window.innerWidth;
  _canvas.height = window.innerHeight;
  initBlobs();
  initParticles();
}

function initBlobs() {
  _blobs = [];
  var colors = getAuroraColors();
  var count  = 5;
  for (var i = 0; i < count; i++) {
    _blobs.push({
      x:      Math.random() * window.innerWidth,
      y:      Math.random() * window.innerHeight,
      r:      200 + Math.random() * 350,
      color:  colors[i % colors.length],
      vx:     (Math.random() - 0.5) * 0.4,
      vy:     (Math.random() - 0.5) * 0.4,
      phase:  Math.random() * Math.PI * 2,
      speed:  0.003 + Math.random() * 0.005,
    });
  }
}

function initParticles() {
  _particles = [];
  var count = Math.floor((window.innerWidth * window.innerHeight) / 18000);
  count = Math.max(30, Math.min(count, 120));

  for (var i = 0; i < count; i++) {
    _particles.push(makeParticle());
  }
}

function makeParticle() {
  return {
    x:       Math.random() * window.innerWidth,
    y:       Math.random() * window.innerHeight,
    r:       0.5 + Math.random() * 2,
    vx:      (Math.random() - 0.5) * 0.3,
    vy:      -0.1 - Math.random() * 0.3,
    opacity: 0.2 + Math.random() * 0.5,
    flicker: Math.random() * Math.PI * 2,
    fSpeed:  0.02 + Math.random() * 0.03,
  };
}

function animationLoop() {
  if (!_animRunning || !_ctx) return;

  var W = _canvas.width;
  var H = _canvas.height;

  _ctx.clearRect(0, 0, W, H);

  // ── Draw aurora blobs ──────────────────────────────────────────────────────
  _blobs.forEach(function(b) {
    b.phase += b.speed;
    b.x += b.vx + Math.sin(b.phase) * 0.3;
    b.y += b.vy + Math.cos(b.phase * 0.7) * 0.3;

    // Bounce softly off edges
    if (b.x < -b.r)  b.x = W + b.r;
    if (b.x > W + b.r) b.x = -b.r;
    if (b.y < -b.r)  b.y = H + b.r;
    if (b.y > H + b.r) b.y = -b.r;

    var grad = _ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    // Parse alpha from theme
    var isLight = document.body.classList.contains('light');
    var alpha1  = isLight ? '18' : '12';
    var alpha2  = '00';

    grad.addColorStop(0,   b.color + alpha1);
    grad.addColorStop(0.5, b.color + '08');
    grad.addColorStop(1,   b.color + alpha2);

    _ctx.beginPath();
    _ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    _ctx.fillStyle = grad;
    _ctx.fill();
  });

  // ── Draw particles ─────────────────────────────────────────────────────────
  var colors   = getAuroraColors();
  var isLight  = document.body.classList.contains('light');
  var pAlpha   = isLight ? 0.25 : 0.4;

  _particles.forEach(function(p, i) {
    p.x += p.vx;
    p.y += p.vy;
    p.flicker += p.fSpeed;

    var flick = Math.sin(p.flicker) * 0.15;
    var alpha  = Math.max(0, Math.min(1, p.opacity + flick)) * pAlpha;

    // Reset if out of bounds
    if (p.y < -10 || p.x < -10 || p.x > window.innerWidth + 10) {
      _particles[i] = makeParticle();
      _particles[i].y = window.innerHeight + 5;
      return;
    }

    var col = colors[i % colors.length] || '#ffffff';
    // Strip any existing alpha from color
    var baseCol = col.length > 7 ? col.slice(0, 7) : col;

    _ctx.beginPath();
    _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    _ctx.fillStyle = baseCol + Math.round(alpha * 255).toString(16).padStart(2, '0');
    _ctx.fill();
  });

  _animationFrame = requestAnimationFrame(animationLoop);
}

function updateAuroraColors() {
  // Refresh blob colors when theme changes without reinitialising everything
  var colors = getAuroraColors();
  _blobs.forEach(function(b, i) {
    b.color = colors[i % colors.length];
  });
}

// ─── Theme & Mode ─────────────────────────────────────────────────────────────

var THEMES = ['green','blue','red','yellow','stellar','staradmin','corona','black','white'];

function initTheme() {
  var saved = localStorage.getItem('dp_theme') || 'green';
  applyTheme(saved);
}

function applyTheme(theme) {
  if (THEMES.indexOf(theme) === -1) theme = 'green';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dp_theme', theme);
  var sel = document.getElementById('themeSelect');
  if (sel) sel.value = theme;
  updateAuroraColors();
}

function initMode() {
  var saved = localStorage.getItem('dp_mode') || 'dark';
  applyMode(saved);
}

function applyMode(mode) {
  var isLight = mode === 'light';
  document.body.classList.toggle('light', isLight);
  localStorage.setItem('dp_mode', mode);
  var btn = document.getElementById('modeToggleBtn');
  if (btn) btn.textContent = isLight ? '🌙' : '☀️';
  updateAuroraColors();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(val) {
  if (!val) return '—';
  var d = new Date(val);
  if (isNaN(d)) { d = parseGSheetDate(String(val)); }
  if (!d || isNaN(d)) return String(val).substring(0, 16);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtDateFull(val) {
  if (!val) return '—';
  var d = new Date(val);
  if (isNaN(d)) { d = parseGSheetDate(String(val)); }
  if (!d || isNaN(d)) return String(val);
  return d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function statusClass(s) {
  var n = norm(s);
  if (n === 'uploaded')                    return 's-uploaded';
  if (n === 'ongoing' || n === 'pending')  return 's-ongoing';
  if (n === 'rejected')                    return 's-rejected';
  if (n === 'no reference')               return 's-no-ref';
  if (n === 'no noc')                     return 's-rejected';
  return 's-default';
}

function listTypeClass(s) {
  var n = norm(s);
  if (n === 'photo request')  return 'lt-photo';
  if (n === 'agent request')  return 'lt-agent';
  if (n === 'brochure')       return 'lt-brochure';
  return 'lt-default';
}

function norm(s) { return (s || '').toLowerCase().trim(); }

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function unique(arr) {
  return arr.filter(function(v, i, a) { return a.indexOf(v) === i; });
}

function show(id) { document.getElementById(id).style.display = ''; }
function hide(id) { document.getElementById(id).style.display = 'none'; }

function hideAll() {
  ['loadingState','errorState','mainDash'].forEach(hide);
}

function updateFilterBadge() {
  var active = Object.values(S.filters).filter(Boolean).length;
  // Also count date range as a filter if custom range is set
  if (S.fromDate && S.toDate) active++;
  // Count time range as active if not 'today' (default)
  if (S.range && S.range !== 'today') active++;

  var badge   = document.getElementById('filterBadge');
  var trigger = document.getElementById('filterTriggerBtn');

  if (active > 0) {
    badge.textContent = active;
    badge.style.display = 'inline-block';
    trigger.classList.add('has-filters');
  } else {
    badge.style.display = 'none';
    trigger.classList.remove('has-filters');
  }
}

// Keep old name as alias for any remaining calls
function updateFilterCount() { updateFilterBadge(); }

function clearFilters() {
  S.range    = 'all';
  S.fromDate = null;
  S.toDate   = null;

  ['fStatus','fCategory','fListType','fPhotographer','fBeds'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value   = '';

  document.querySelectorAll('.fp-t-pill').forEach(function(b) { b.classList.remove('active'); });
  var allPill = document.querySelector('.fp-t-pill[data-range="all"]');
  if (allPill) allPill.classList.add('active');

  updateFilterBadge();
  render();
}
// ═══════════════════════════════════════════════════════════════════════
// ASSIGNMENT DASHBOARD
// Ported from the DP Toolkit Chrome extension's "Assignment Dashboard".
// Reads the same "Assignments" tab through the same Apps Script deployment
// this app already uses (S.url), via the token-authenticated GET endpoint
// (?token=DPPE) — the same one the extension itself calls — rather than
// the ?action=getData endpoint the rest of this dashboard uses for the
// Copier sheet data.
// ═══════════════════════════════════════════════════════════════════════

var ASSIGN_TOKEN = 'DPPE';
var ASSIGN_CATEGORY_OPTIONS = ['Offplan Pending', 'Photos For QC', 'Stock Photos For QC', 'Upload Pending', 'Re-shoot'];
var ASSIGN_BED_TRACKED_CATEGORIES = ['Upload Pending'];
var ASSIGN_BED_BUCKETS = ['0', '1', '2', '3', '4', '5+', '?'];
var ASSIGN_DATA = { assignments: [], loaded: false };
var ASSIGN_DASH_VIEW_ACTIVE = false;
var ASSIGN_POLL_INTERVAL = null;
var ASSIGN_SCOPE = 'today'; // 'today' | 'yesterday' | 'week' | 'all' | { type:'custom', start, end }
var ASSIGN_CUSTOM_DRAFT = { start: '', end: '' };
var ASSIGN_CLOCK_INTERVAL = null;

function assignBedroomChipLabel(val) { return val === '0' ? 'Studio' : val === '?' ? 'Unknown' : val; }

function assignFmtRelative(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}

function assignStartOfLocalDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function assignAddDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

// Turns a scope descriptor into a [start, end) local-time range, or null
// for "all" (no filtering). Mirrors the extension's scopeToRange exactly,
// including "week" being a rolling last-7-days window ending yesterday.
function assignScopeToRange(scope) {
  var now = new Date();
  if (scope === 'today') {
    var s1 = assignStartOfLocalDay(now);
    return [s1, assignAddDays(s1, 1)];
  }
  if (scope === 'yesterday') {
    var s2 = assignAddDays(assignStartOfLocalDay(now), -1);
    return [s2, assignAddDays(s2, 1)];
  }
  if (scope === 'week') {
    var yest = assignAddDays(assignStartOfLocalDay(now), -1);
    var s3 = assignAddDays(yest, -6);
    return [s3, assignAddDays(yest, 1)];
  }
  if (scope === 'thisweek') {
    // Full calendar week, Monday through Sunday — not clipped to today.
    // Mirrors the extension's startOfWeekMonday()/scopeToRange("thisWeek").
    var day0 = assignStartOfLocalDay(now).getDay(); // 0=Sun..6=Sat
    var monday = assignAddDays(assignStartOfLocalDay(now), -((day0 + 6) % 7));
    return [monday, assignAddDays(monday, 7)];
  }
  if (scope === 'month') {
    // 1st of the current month through the end of TODAY (month-to-date,
    // not the full calendar month) — e.g. on Aug 13 this is Aug 1–13, and
    // on Aug 14 it's automatically Aug 1–14 with no code change needed,
    // since both ends are computed fresh from "now" every time this runs.
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return [monthStart, assignAddDays(assignStartOfLocalDay(now), 1)];
  }
  if (scope && scope.type === 'custom') {
    if (!scope.start || !scope.end) return null;
    var s4 = new Date(scope.start + 'T00:00:00');
    var e4 = new Date(scope.end + 'T00:00:00');
    if (isNaN(s4) || isNaN(e4)) return null;
    return [s4, assignAddDays(e4, 1)];
  }
  return null; // "all"
}

function assignIsWithinRange(iso, range) {
  if (!range) return true;
  if (!iso) return false;
  var d = new Date(iso);
  if (isNaN(d)) return false;
  return d >= range[0] && d < range[1];
}

// Collapses whitespace (including non-breaking spaces picked up from the
// CRM page's DOM text) before comparing a stored Category value against
// ASSIGN_CATEGORY_OPTIONS.
function assignNormCategory(v) { return (v || '').replace(/\s+/g, ' ').trim(); }

function assignEmptyCategoryTally() {
  var t = {};
  ASSIGN_CATEGORY_OPTIONS.forEach(function(c) {
    t[c] = {
      completed: 0, pending: 0, onHold: 0, rejected: 0, total: 0, beds: {},
      // Individual DP-REQ refs behind each count, so a cell's number can
      // be clicked to reveal exactly which listings it's made of.
      refs: { completed: [], pending: [], onHold: [], rejected: [] },
    };
  });
  return t;
}

function computeAssignDashboardStats(scope) {
  var range = assignScopeToRange(scope);
  var byEditor = {};
  var team = { categories: assignEmptyCategoryTally(), total: 0 };
  var unassigned = { categories: assignEmptyCategoryTally(), total: 0, latest: null };
  var uncategorized = 0;

  ASSIGN_DATA.assignments.forEach(function(entry) {
    if (!entry || !entry.status) return;

    // Unassigned-but-on-hold listings have no assignedAt — use onHoldAt
    // instead so date-range scoping still works for them.
    var scopeTimestamp = entry.assignedAt || entry.onHoldAt || '';
    if (!assignIsWithinRange(scopeTimestamp, range)) return;

    var bedBucket = entry.bedrooms || '';
    var crmNorm = assignNormCategory(entry.crmStatus);
    var category = (crmNorm && ASSIGN_CATEGORY_OPTIONS.indexOf(crmNorm) > -1) ? crmNorm : '';
    if (!category) { uncategorized++; return; } // not one of the tracked categories — excluded
    if (!bedBucket) bedBucket = '?';

    var editor = entry.editor || '';
    var status = entry.status || '';
    var bucket = status === 'Completed' ? 'completed' : status === 'Rejected' ? 'rejected' :
      status === 'On Hold' ? 'onHold' : 'pending';

    var target = editor
      ? (byEditor[editor] || (byEditor[editor] = { total: 0, latest: null, categories: assignEmptyCategoryTally() }))
      : unassigned;

    target.total++;
    target.categories[category][bucket]++;
    target.categories[category].total++;
    target.categories[category].refs[bucket].push(entry.ref);

    if (editor) {
      team.categories[category][bucket]++;
      team.categories[category].total++;
      team.categories[category].refs[bucket].push(entry.ref);
      team.total++;
    }

    if (ASSIGN_BED_TRACKED_CATEGORIES.indexOf(category) > -1) {
      target.categories[category].beds[bedBucket] = (target.categories[category].beds[bedBucket] || 0) + 1;
      if (editor) team.categories[category].beds[bedBucket] = (team.categories[category].beds[bedBucket] || 0) + 1;
    }

    if (scopeTimestamp && (!target.latest || new Date(scopeTimestamp) > new Date(target.latest.assignedAt))) {
      target.latest = { ref: entry.ref, bedBucket: bedBucket, crmStatus: category, assignedAt: scopeTimestamp };
    }
  });

  return { byEditor: byEditor, team: team, unassigned: unassigned, uncategorized: uncategorized };
}

// ── HTML builders (string-based, matching renderReport()'s style; reuses
// the .report-table / .report-table-wrap classes already defined for the
// RPT view so this looks native to the rest of the dashboard) ────────────

// Registry mapping a short id -> {title, refs}, rebuilt on every render so
// the clickable stat buttons (wired via delegated click listener below,
// since this dashboard is built from HTML strings rather than DOM nodes
// with attached handlers) can look up which refs a given button represents.
var ASSIGN_REFS_REGISTRY = {};
var ASSIGN_REFS_COUNTER = 0;

function assignRegisterRefs(title, refs) {
  ASSIGN_REFS_COUNTER++;
  var id = 'r' + ASSIGN_REFS_COUNTER;
  ASSIGN_REFS_REGISTRY[id] = { title: title, refs: refs };
  return id;
}

function assignNumCell(v, refs, title) {
  if (v > 0 && refs && refs.length > 0) {
    var id = assignRegisterRefs(title, refs);
    return '<td class="num-cell"><button type="button" class="dp-dash-stat-btn" data-refs-id="' + id
      + '" title="Click to see reference numbers">' + v + '</button></td>';
  }
  return '<td class="num-cell' + (v === 0 ? ' num-zero' : '') + '">' + (v || '\u2013') + '</td>';
}

function assignCategoryTableHtml(categories, ownerLabel) {
  var emptyRefs = { completed: [], pending: [], onHold: [], rejected: [] };
  var sums = { completed: 0, pending: 0, onHold: 0, rejected: 0, total: 0 };
  var sumRefs = { completed: [], pending: [], onHold: [], rejected: [] };
  var rows = ASSIGN_CATEGORY_OPTIONS.map(function(cat) {
    var d = categories[cat] || { completed: 0, pending: 0, onHold: 0, rejected: 0, total: 0 };
    var refs = d.refs || emptyRefs;
    sums.completed += d.completed; sums.pending += d.pending; sums.onHold += d.onHold;
    sums.rejected += d.rejected; sums.total += d.total;
    sumRefs.completed = sumRefs.completed.concat(refs.completed);
    sumRefs.pending = sumRefs.pending.concat(refs.pending);
    sumRefs.onHold = sumRefs.onHold.concat(refs.onHold);
    sumRefs.rejected = sumRefs.rejected.concat(refs.rejected);
    var rowAllRefs = refs.completed.concat(refs.pending, refs.onHold, refs.rejected);
    return '<tr>'
      + '<td class="editor-name">' + esc(cat) + '</td>'
      + assignNumCell(d.completed, refs.completed, ownerLabel + ' \u00B7 ' + cat + ' \u00B7 Completed')
      + assignNumCell(d.pending, refs.pending, ownerLabel + ' \u00B7 ' + cat + ' \u00B7 Pending')
      + assignNumCell(d.onHold, refs.onHold, ownerLabel + ' \u00B7 ' + cat + ' \u00B7 On Hold')
      + assignNumCell(d.rejected, refs.rejected, ownerLabel + ' \u00B7 ' + cat + ' \u00B7 Rejected')
      + assignNumCell(d.total, rowAllRefs, ownerLabel + ' \u00B7 ' + cat + ' \u00B7 All statuses')
      + '</tr>';
  }).join('');

  var grandAllRefs = sumRefs.completed.concat(sumRefs.pending, sumRefs.onHold, sumRefs.rejected);
  return '<div class="report-table-wrap"><table class="report-table"><thead><tr>'
    + '<th>Category</th><th>Completed</th><th>Pending</th><th>On Hold</th><th>Rejected</th><th>Total</th>'
    + '</tr></thead><tbody>'
    + rows
    + '<tr class="team-total"><td>Total</td>'
    + assignNumCell(sums.completed, sumRefs.completed, ownerLabel + ' \u00B7 Completed')
    + assignNumCell(sums.pending, sumRefs.pending, ownerLabel + ' \u00B7 Pending')
    + assignNumCell(sums.onHold, sumRefs.onHold, ownerLabel + ' \u00B7 On Hold')
    + assignNumCell(sums.rejected, sumRefs.rejected, ownerLabel + ' \u00B7 Rejected')
    + assignNumCell(sums.total, grandAllRefs, ownerLabel + ' \u00B7 All statuses')
    + '</tr></tbody></table></div>';
}

// Sums an editor's per-category tallies down into flat status totals (plus
// the refs behind each), for the leaderboard-style "Quick Report" table
// (mirrors the CRM extension's dashboard, which shows this ahead of the
// full category breakdown).
function assignEditorStatusTotals(editorData) {
  var t = { completed: 0, pending: 0, onHold: 0, rejected: 0, total: editorData.total };
  var refs = { completed: [], pending: [], onHold: [], rejected: [] };
  ASSIGN_CATEGORY_OPTIONS.forEach(function(cat) {
    var d = editorData.categories[cat];
    if (!d) return;
    t.completed += d.completed; t.pending += d.pending; t.onHold += d.onHold; t.rejected += d.rejected;
    if (d.refs) {
      refs.completed = refs.completed.concat(d.refs.completed);
      refs.pending = refs.pending.concat(d.refs.pending);
      refs.onHold = refs.onHold.concat(d.refs.onHold);
      refs.rejected = refs.rejected.concat(d.refs.rejected);
    }
  });
  return { sums: t, refs: refs };
}

function assignQuickReportHtml(byEditor, editorNames) {
  if (editorNames.length === 0) return '';
  var grand = { completed: 0, pending: 0, onHold: 0, rejected: 0, total: 0 };
  var grandRefs = { completed: [], pending: [], onHold: [], rejected: [] };
  var rows = editorNames.map(function(name) {
    var r = assignEditorStatusTotals(byEditor[name]);
    var d = r.sums, refs = r.refs;
    grand.completed += d.completed; grand.pending += d.pending; grand.onHold += d.onHold;
    grand.rejected += d.rejected; grand.total += d.total;
    grandRefs.completed = grandRefs.completed.concat(refs.completed);
    grandRefs.pending = grandRefs.pending.concat(refs.pending);
    grandRefs.onHold = grandRefs.onHold.concat(refs.onHold);
    grandRefs.rejected = grandRefs.rejected.concat(refs.rejected);
    var rowAllRefs = refs.completed.concat(refs.pending, refs.onHold, refs.rejected);
    return '<tr>'
      + '<td class="editor-name">' + esc(name) + '</td>'
      + assignNumCell(d.completed, refs.completed, name + ' \u00B7 Completed')
      + assignNumCell(d.pending, refs.pending, name + ' \u00B7 Pending')
      + assignNumCell(d.onHold, refs.onHold, name + ' \u00B7 On Hold')
      + assignNumCell(d.rejected, refs.rejected, name + ' \u00B7 Rejected')
      + assignNumCell(d.total, rowAllRefs, name + ' \u00B7 All statuses')
      + '</tr>';
  }).join('');

  var grandAllRefs = grandRefs.completed.concat(grandRefs.pending, grandRefs.onHold, grandRefs.rejected);
  return '<div class="dp-dash-quick-report">'
    + '<div class="dp-bed-table-title">Quick Report</div>'
    + '<div class="report-table-wrap"><table class="report-table"><thead><tr>'
    + '<th></th><th>Completed</th><th>Pending</th><th>On Hold</th><th>Rejected</th><th>Total</th>'
    + '</tr></thead><tbody>'
    + rows
    + '<tr class="team-total"><td>Total</td>'
    + assignNumCell(grand.completed, grandRefs.completed, 'Whole Team \u00B7 Completed')
    + assignNumCell(grand.pending, grandRefs.pending, 'Whole Team \u00B7 Pending')
    + assignNumCell(grand.onHold, grandRefs.onHold, 'Whole Team \u00B7 On Hold')
    + assignNumCell(grand.rejected, grandRefs.rejected, 'Whole Team \u00B7 Rejected')
    + assignNumCell(grand.total, grandAllRefs, 'Whole Team \u00B7 All statuses')
    + '</tr></tbody></table></div>'
    + '</div>';
}

function assignBedTableHtml(beds, rowLabel) {
  var total = 0;
  var cells = ASSIGN_BED_BUCKETS.map(function(b) {
    var count = beds[b] || 0;
    total += count;
    return assignNumCell(count);
  }).join('');
  var headCells = ASSIGN_BED_BUCKETS.map(function(b) { return '<th>' + assignBedroomChipLabel(b) + '</th>'; }).join('');
  return '<div class="report-table-wrap" style="margin-top:8px;"><table class="report-table"><thead><tr>'
    + '<th></th>' + headCells + '<th>Total</th>'
    + '</tr></thead><tbody><tr>'
    + '<td class="editor-name">' + esc(rowLabel) + '</td>' + cells + assignNumCell(total)
    + '</tr></tbody></table></div>';
}

function assignBedTablesHtml(categories) {
  var html = '';
  ASSIGN_BED_TRACKED_CATEGORIES.forEach(function(cat) {
    var beds = categories[cat] && categories[cat].beds;
    if (!beds || Object.keys(beds).length === 0) return;
    html += '<div class="dp-bed-table-title">' + esc(cat) + ' \u2014 by bedrooms</div>' + assignBedTableHtml(beds, cat);
  });
  return html;
}

function assignLatestLineHtml(latest) {
  if (!latest) return '';
  var bedLabel = assignBedroomChipLabel(latest.bedBucket) + (latest.bedBucket === '?' ? '' : ' Bed');
  var bits = [latest.ref || '\u2014'];
  if (ASSIGN_BED_TRACKED_CATEGORIES.indexOf(latest.crmStatus) > -1) bits.push(bedLabel);
  bits.push(latest.crmStatus, assignFmtRelative(latest.assignedAt));
  return '<div class="dp-dash-latest">Latest: ' + esc(bits.join(' \u00B7 ')) + '</div>';
}

function assignCardHtml(title, data, isTeam) {
  return '<div class="dp-dash-card' + (isTeam ? ' team' : '') + '">'
    + '<div class="dp-dash-card-head">'
    +   '<div class="dp-dash-card-title">' + esc(title) + '</div>'
    +   '<div class="dp-dash-card-total">Total: ' + data.total + '</div>'
    + '</div>'
    + assignLatestLineHtml(data.latest)
    + assignCategoryTableHtml(data.categories, title)
    + assignBedTablesHtml(data.categories)
    + '</div>';
}

// ── Scope labels & date display ───────────────────────────────────────────

function assignTrackedCategoriesText() { return '(' + ASSIGN_CATEGORY_OPTIONS.join(', ') + ')'; }

function assignScopeLabelText(s) {
  if (s === 'today') return 'assigned today';
  if (s === 'yesterday') return 'assigned yesterday';
  if (s === 'thisweek') return 'assigned this week (Mon\u2013Sun)';
  if (s === 'week') return 'assigned in the last 7 days';
  if (s === 'month') return 'assigned this month (month-to-date)';
  if (s === 'all') return 'assigned (all time)';
  if (s && s.type === 'custom') return 'assigned from ' + s.start + ' to ' + s.end;
  return 'assigned';
}

function assignEmptyLabelText(s) {
  var suffix = 'in one of the tracked categories ' + assignTrackedCategoriesText() + '.';
  if (s === 'today') return 'No listings assigned or put on hold today ' + suffix;
  if (s === 'yesterday') return 'No listings assigned or put on hold yesterday ' + suffix;
  if (s === 'thisweek') return 'No listings assigned or put on hold this week ' + suffix;
  if (s === 'week') return 'No listings assigned or put on hold in the last 7 days ' + suffix;
  if (s === 'month') return 'No listings assigned or put on hold this month (month-to-date) ' + suffix;
  if (s === 'all') return 'No assigned or on-hold listings found ' + suffix;
  if (s && s.type === 'custom') return 'No listings assigned or put on hold in that date range ' + suffix;
  return 'No listings found ' + suffix;
}

function assignFmtFullDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
function assignFmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}
function assignFmtShortDate(d, includeYear) {
  var opts = { month: 'short', day: 'numeric' };
  if (includeYear) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}
function assignDateInfoText(s) {
  if (s === 'all') return '';
  var range = assignScopeToRange(s);
  if (!range) return '';
  var startDate = range[0];
  var endDate = assignAddDays(range[1], -1); // range end is exclusive
  if (s === 'today' || s === 'yesterday') return assignFmtFullDate(startDate);
  var sameYear = startDate.getFullYear() === endDate.getFullYear();
  return assignFmtShortDate(startDate, !sameYear) + ' \u2013 ' + assignFmtShortDate(endDate, true);
}

// ── Modal render / wiring ─────────────────────────────────────────────────

// Fixed id for the DP Toolkit Chrome extension (pinned via a "key" in its
// manifest.json specifically so this stays stable across every teammate's
// install — see the manifest for the matching public key). Lets DP Studio,
// a plain website, ask the *extension* to do the tab-switching/searching
// that only an extension's chrome.tabs access can do.
var DP_TOOLKIT_EXTENSION_ID = 'fnldgmmjlbpogkecndmccfbboakhgdai';

function assignAutoSearchInCRM(ref, actionEl) {
  if (!(window.chrome && chrome.runtime && chrome.runtime.sendMessage)) return;
  try {
    chrome.runtime.sendMessage(DP_TOOLKIT_EXTENSION_ID, { type: 'DP_AUTO_SEARCH', ref: ref }, function(resp) {
      // chrome.runtime.lastError fires when the extension isn't installed,
      // is disabled, or hasn't picked up the externally_connectable update
      // yet — none of that should surprise the person, the ref is already
      // copied to their clipboard either way, so just leave it there.
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && actionEl) {
        actionEl.textContent = 'Opened in CRM \u2713';
        setTimeout(function() { if (actionEl) actionEl.textContent = 'Copy'; }, 1800);
      }
    });
  } catch (e) { /* extension messaging unavailable — clipboard copy still worked */ }
}

function renderAssignDashboard() {
  var inner = document.getElementById('assignDashView');
  if (!inner) return;
  ASSIGN_REFS_REGISTRY = {};
  ASSIGN_REFS_COUNTER = 0;
  var scope = ASSIGN_SCOPE;
  var isCustom = !!(scope && scope.type === 'custom');

  function pillClass(active) { return 'fp-t-pill' + (active ? ' active' : ''); }

  var scopeRowHtml =
    '<div class="fp-time-pills" id="assignScopePills">'
    + '<button type="button" class="' + pillClass(scope === 'today') + '" data-scope="today">Today</button>'
    + '<button type="button" class="' + pillClass(scope === 'yesterday') + '" data-scope="yesterday">Yesterday</button>'
    + '<button type="button" class="' + pillClass(scope === 'thisweek') + '" data-scope="thisweek">This Week</button>'
    + '<button type="button" class="' + pillClass(scope === 'week') + '" data-scope="week">Last 7 Days</button>'
    + '<button type="button" class="' + pillClass(scope === 'month') + '" data-scope="month">Month</button>'
    + '<button type="button" class="' + pillClass(scope === 'all') + '" data-scope="all">All time</button>'
    + '<button type="button" class="' + pillClass(isCustom) + '" data-scope="custom">Custom Range</button>'
    + '</div>';

  var customRangeHtml =
    '<div class="fp-date-row" id="assignCustomRow" style="display:' + (isCustom ? 'flex' : 'none') + ';margin-top:10px;">'
    + '<input type="date" id="assignDateFrom" class="fp-date-in" title="From" value="' + esc(ASSIGN_CUSTOM_DRAFT.start) + '">'
    + '<span class="fp-date-sep">\u2192</span>'
    + '<input type="date" id="assignDateTo" class="fp-date-in" title="To" value="' + esc(ASSIGN_CUSTOM_DRAFT.end) + '">'
    + '<button class="fp-apply-date" id="assignApplyRangeBtn" type="button">Apply</button>'
    + '</div>';

  var dateText = assignDateInfoText(scope);
  var dateInfoHtml = dateText
    ? '<div class="dp-dash-date-info">' + esc(dateText)
      + ' \u00B7 <span class="dp-dash-live-time" id="assignLiveTime">' + esc(assignFmtTime(new Date())) + '</span></div>'
    : '';

  var headerHtml =
    '<div class="report-header">'
    +   '<div>'
    +     '<div class="report-title">\uD83D\uDCCA Assignment Dashboard</div>'
    +     '<div class="report-subtitle">From the Assignments tab \u2014 same data as the CRM extension</div>'
    +   '</div>'
    + '</div>'
    + scopeRowHtml + customRangeHtml + dateInfoHtml;

  if (isCustom && !assignScopeToRange(scope)) {
    inner.innerHTML = headerHtml + '<div class="dp-dash-summary">Pick a start and end date, then Apply.</div>';
    assignWireDashboardControls();
    return;
  }

  if (!ASSIGN_DATA.loaded) {
    inner.innerHTML = headerHtml + '<div class="dp-dash-empty">Loading assignment data\u2026</div>';
    assignWireDashboardControls();
    return;
  }

  var stats = computeAssignDashboardStats(scope);
  var byEditor = stats.byEditor, team = stats.team, unassigned = stats.unassigned, uncategorized = stats.uncategorized;

  var summary = team.total + ' assigned listing' + (team.total === 1 ? '' : 's') + ' ' + assignScopeLabelText(scope)
    + ' across the ' + ASSIGN_CATEGORY_OPTIONS.length + ' tracked categories ' + assignTrackedCategoriesText();
  if (unassigned.total > 0) {
    summary += ', plus ' + unassigned.total + ' unassigned listing' + (unassigned.total === 1 ? '' : 's') + ' on hold';
  }
  summary += ' \u2014 data pulled from the sheet, not limited to what\'s loaded on this page.';
  if (uncategorized > 0) {
    summary += ' ' + uncategorized + ' listing' + (uncategorized === 1 ? '' : 's') + ' excluded \u2014 not one of the '
      + ASSIGN_CATEGORY_OPTIONS.length + ' tracked categories, or the category was never captured.';
  }

  var editorNames = Object.keys(byEditor).sort(function(a, b) { return byEditor[b].total - byEditor[a].total; });
  var quickReportHtml = assignQuickReportHtml(byEditor, editorNames);

  var bodyHtml;
  if (editorNames.length === 0 && unassigned.total === 0) {
    bodyHtml = '<div class="dp-dash-empty">' + esc(assignEmptyLabelText(scope)) + '</div>';
  } else {
    bodyHtml = '<div class="dp-dash-body">';
    if (team.total > 0) bodyHtml += assignCardHtml('Whole Team', team, true);
    if (unassigned.total > 0) bodyHtml += assignCardHtml('Unassigned (On Hold)', unassigned, false);
    editorNames.forEach(function(name) { bodyHtml += assignCardHtml(name, byEditor[name], false); });
    bodyHtml += '</div>';
  }

  inner.innerHTML = headerHtml + quickReportHtml + '<div class="dp-dash-summary">' + esc(summary) + '</div>' + bodyHtml;
  assignWireDashboardControls();
}

function assignWireDashboardControls() {
  document.querySelectorAll('#assignScopePills [data-scope]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var next = btn.dataset.scope;
      if (next === 'custom') {
        ASSIGN_SCOPE = { type: 'custom', start: ASSIGN_CUSTOM_DRAFT.start, end: ASSIGN_CUSTOM_DRAFT.end };
      } else {
        ASSIGN_SCOPE = next;
      }
      renderAssignDashboard();
    });
  });
  var applyBtn = document.getElementById('assignApplyRangeBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', function() {
      ASSIGN_CUSTOM_DRAFT = {
        start: document.getElementById('assignDateFrom').value,
        end: document.getElementById('assignDateTo').value,
      };
      ASSIGN_SCOPE = { type: 'custom', start: ASSIGN_CUSTOM_DRAFT.start, end: ASSIGN_CUSTOM_DRAFT.end };
      renderAssignDashboard();
    });
  }
}

// ── Refs modal — clicking any non-zero count above opens this, listing the
// individual DP-REQ refs that make up that number. Built dynamically (like
// the extension's showRefsModal) rather than pre-declared in index.html,
// and stacks on top of the Assignment Dashboard modal.
function assignCloseRefsModal() {
  var el = document.getElementById('assignRefsBg');
  if (el) el.remove();
}

function assignShowRefsModal(title, refs) {
  assignCloseRefsModal();
  var uniqueRefs = Array.prototype.filter.call(refs || [], function(r, i, arr) { return r && arr.indexOf(r) === i; }).sort();

  var itemsHtml = uniqueRefs.length === 0
    ? '<div class="dp-dash-empty">No reference numbers found.</div>'
    : '<div class="dp-refs-list">' + uniqueRefs.map(function(ref) {
        return '<button type="button" class="dp-refs-list-item" data-ref="' + esc(ref) + '">'
          + '<span class="dp-refs-list-ref">' + esc(ref) + '</span>'
          + '<span class="dp-refs-list-action">Copy</span>'
          + '</button>';
      }).join('') + '</div>';

  var bg = document.createElement('div');
  bg.id = 'assignRefsBg';
  bg.className = 'modal-bg';
  bg.style.zIndex = '260'; // stack above the Assignment Dashboard modal
  bg.addEventListener('click', function(e) { if (e.target === bg) assignCloseRefsModal(); });
  bg.innerHTML =
    '<div class="modal dp-refs-modal" style="max-width:420px;">'
    +   '<div class="modal-head">'
    +     '<div class="modal-req" style="font-size:15px;">' + esc(title) + ' (' + uniqueRefs.length + ')</div>'
    +     '<button class="modal-close" id="assignRefsCloseBtn">\u2715</button>'
    +   '</div>'
    +   itemsHtml
    +   '<div class="edit-actions" style="margin-top:14px;">'
    +     '<button class="edit-save-btn" id="assignRefsCopyAllBtn"' + (uniqueRefs.length === 0 ? ' disabled' : '') + '>Copy List</button>'
    +     '<button class="edit-cancel-btn" id="assignRefsCloseBtn2">Close</button>'
    +   '</div>'
    + '</div>';
  document.body.appendChild(bg);

  var closeBtn1 = document.getElementById('assignRefsCloseBtn');
  var closeBtn2 = document.getElementById('assignRefsCloseBtn2');
  if (closeBtn1) closeBtn1.addEventListener('click', assignCloseRefsModal);
  if (closeBtn2) closeBtn2.addEventListener('click', assignCloseRefsModal);

  var copyAllBtn = document.getElementById('assignRefsCopyAllBtn');
  if (copyAllBtn && uniqueRefs.length > 0) {
    copyAllBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(uniqueRefs.join('\n')).then(function() {
        copyAllBtn.textContent = 'Copied!';
        setTimeout(function() { copyAllBtn.textContent = 'Copy List'; }, 1500);
      }).catch(function() {});
    });
  }

  bg.querySelectorAll('.dp-refs-list-item').forEach(function(item) {
    item.title = 'Copy, and auto-search in the CRM if the DP Toolkit extension is installed';
    item.addEventListener('click', function() {
      var ref = item.getAttribute('data-ref');
      var actionEl = item.querySelector('.dp-refs-list-action');
      navigator.clipboard.writeText(ref).then(function() {
        if (actionEl) {
          actionEl.textContent = 'Copied \u2713';
          setTimeout(function() { if (actionEl) actionEl.textContent = 'Copy'; }, 1200);
        }
        assignAutoSearchInCRM(ref, actionEl);
      }).catch(function() {});
    });
  });
}

// Delegated (added once, at load) — the stat buttons are re-created on
// every renderAssignDashboard() call, so per-element listeners would leak
// or go stale; delegation on document sidesteps that entirely.
document.addEventListener('click', function(e) {
  var btn = e.target.closest && e.target.closest('.dp-dash-stat-btn');
  if (!btn) return;
  var id = btn.getAttribute('data-refs-id');
  var entry = id && ASSIGN_REFS_REGISTRY[id];
  if (entry) assignShowRefsModal(entry.title, entry.refs);
});

function fetchAssignData(cb, silent) {
  fetch(S.assignUrl + '?token=' + ASSIGN_TOKEN, { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var next = (data && Array.isArray(data.assignments)) ? data.assignments : [];
      // Silent (background poll) mode: skip the re-render entirely if the
      // ref-list modal is open, so a mid-read refresh can't yank the list
      // out from under someone, and skip it if nothing actually changed so
      // there's no needless flicker/scroll-jump on every tick.
      if (silent) {
        if (document.getElementById('assignRefsBg')) { ASSIGN_DATA.assignments = next; ASSIGN_DATA.loaded = true; return; }
        if (next.length === ASSIGN_DATA.assignments.length && JSON.stringify(next) === JSON.stringify(ASSIGN_DATA.assignments)) return;
      }
      ASSIGN_DATA.assignments = next;
      ASSIGN_DATA.loaded = true;
      if (cb) cb(null);
    })
    .catch(function(err) {
      console.error('Assignment Dashboard fetch failed', err);
      if (cb) cb(err);
    });
}

function assignStartClock() {
  assignStopClock();
  ASSIGN_CLOCK_INTERVAL = setInterval(function() {
    var el = document.getElementById('assignLiveTime');
    if (el) el.textContent = assignFmtTime(new Date());
  }, 1000);
}

function assignStopClock() {
  if (ASSIGN_CLOCK_INTERVAL) { clearInterval(ASSIGN_CLOCK_INTERVAL); ASSIGN_CLOCK_INTERVAL = null; }
}

// Background refresh while the dashboard tab is open — the extension's own
// dashboard polls every 15s (REFRESH_INTERVAL_MS in assigner-content.js);
// matched here so DP Studio doesn't lag behind it.
var ASSIGN_POLL_MS = 8000;

function assignStartPoll() {
  assignStopPoll();
  ASSIGN_POLL_INTERVAL = setInterval(function() {
    if (document.visibilityState === 'visible' && ASSIGN_DASH_VIEW_ACTIVE) {
      fetchAssignData(function() { renderAssignDashboard(); }, true);
    }
  }, ASSIGN_POLL_MS);
}

function assignStopPoll() {
  if (ASSIGN_POLL_INTERVAL) { clearInterval(ASSIGN_POLL_INTERVAL); ASSIGN_POLL_INTERVAL = null; }
}

function openAssignDashboardView() {
  renderAssignDashboard(); // show something immediately (loading state)
  fetchAssignData(function() { renderAssignDashboard(); });
  assignStartClock();
  assignStartPoll();
}
