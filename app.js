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
    // Same idea for the Daily Report — its Assigned/In progress/On-hold
    // columns are sourced from ASSIGN_DATA, so if it rendered before this
    // fetch resolved, those columns would be stuck at 0 until something
    // else happened to trigger a re-render.
    if (S.view === 'report') renderReport();
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

  // ── Report export ─────────────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'exportReportBtn') generateReportPPTX();
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

  var items = [
    { label:'Total',        val: total,        cls:''  },
    { label:'Uploaded',     val: uploaded,     cls:'g' },
    { label:'Pending',      val: pending,      cls:'y' },
    { label:'Rejected',     val: rejected,     cls:'r' },
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

  if (rows.length === 0) {
    board.innerHTML = '<div class="no-results">No listings match the current filters.</div>';
    return;
  }

  if (S.editor === 'all') {
    var ordered = getOrderedEditors();
    ordered.forEach(function(editor) {
      var edRows = rows.filter(function(r) { return r._editor === editor; });
      board.appendChild(makeColumn(editor, edRows));
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
  }
}

function makeColumn(title, rows) {
  var col = document.createElement('div');
  var totalCount = rows.length;
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
    sortNewest(rows).forEach(function(r) {
      body.appendChild(makeCard(r));
    });
  }

  col.appendChild(header);
  col.appendChild(body);
  return col;
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

// Same date-bucket math as rowInRange(), but for an ISO timestamp coming
// from an Assigner entry (assignedAt/startedAt/onHoldAt/...) rather than a
// Copier row. Kept separate rather than reused because a MISSING timestamp
// means something different here: on a Copier row it's "row has no date
// field at all" (rowInRange treats that as "always match" — a data-quality
// fallback), but on an Assigner entry it means "this lifecycle event hasn't
// happened yet for this status," which should be EXCLUDED from any specific
// date filter rather than always matching it.
function entryInReportRange(iso) {
  if (S.fromDate && S.toDate) {
    if (!iso) return false;
    var d = new Date(iso);
    if (isNaN(d)) return false;
    var from = new Date(S.fromDate);
    var to   = new Date(S.toDate); to.setHours(23,59,59,999);
    return d >= from && d <= to;
  }
  if (!S.range || S.range === 'all') return true;
  if (!iso) return false;
  var d2 = new Date(iso);
  if (isNaN(d2)) return false;

  var now   = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (S.range === 'today') return d2 >= today;
  if (S.range === 'yesterday') {
    var yStart = new Date(today); yStart.setDate(yStart.getDate() - 1);
    var yEnd   = new Date(yStart); yEnd.setHours(23,59,59,999);
    return d2 >= yStart && d2 <= yEnd;
  }
  if (S.range === 'week')  { var w = new Date(today); w.setDate(w.getDate() - 7);  return d2 >= w; }
  if (S.range === 'month') { var m = new Date(today); m.setMonth(m.getMonth() - 1); return d2 >= m; }
  return true;
}

// Shared by renderReport() (on-screen Daily Report table) and
// generateReportPPTX() (the export), so the two can never drift apart.
//
// Photo / Agent / Offplan / Completed come from the Copier sheet (this
// editor's own per-request rows, Status = Uploaded, grouped by List Type).
// Assigned / In progress / On-hold come from the Assigner sheet (ASSIGN_DATA,
// fetched from S.assignUrl) — the Copier's own Status field has no concept
// of "assigned" or "in progress" at all, only Uploaded/Pending/Ongoing/
// Rejected, so those three columns can only be sourced from the Assigner.
// Rejected stays Copier-sourced (Status = Rejected) rather than switching to
// the Assigner's own "Rejected" status, because the Rejected Listings slide
// / Rejection Reason field are Copier-side concepts — keeping both Rejected
// numbers on the same source keeps them from silently disagreeing.
function computeEditorBreakdown() {
  var allRows      = getAllRows().filter(rowInRange);
  var rejectedRows = allRows.filter(function(r) { return norm(r['Status']) === 'rejected'; });

  var editorBreakdown = S.editors.map(function(editor) {
    var rows = (S.data[editor] || []).map(function(r) { return Object.assign({_editor:editor}, r); }).filter(rowInRange);
    var uploadedRows = rows.filter(function(r) { return norm(r['Status']) === 'uploaded'; });
    var photo   = uploadedRows.filter(function(r) { return norm(r['List Type']) === 'photo request'; }).length;
    var agent   = uploadedRows.filter(function(r) { return norm(r['List Type']) === 'agent request'; }).length;
    var offplan = uploadedRows.filter(function(r) { return norm(r['List Type']) === 'brochure'; }).length;

    var assignEntries = ASSIGN_DATA.assignments.filter(function(e) { return e && (e.editor || '') === editor; });
    var assigned    = assignEntries.filter(function(e) { return e.status === 'Assigned'    && entryInReportRange(e.assignedAt); }).length;
    var inProgress  = assignEntries.filter(function(e) { return e.status === 'In Progress' && entryInReportRange(e.startedAt || e.assignedAt); }).length;
    var onHold      = assignEntries.filter(function(e) { return e.status === 'On Hold'     && entryInReportRange(e.onHoldAt); }).length;

    var rejected    = rows.filter(function(r) { return norm(r['Status']) === 'rejected'; }).length;
    var completed   = photo + agent + offplan;

    return {
      editor: editor, photo: photo, agent: agent, offplan: offplan, completed: completed,
      assigned: assigned, inProgress: inProgress, onHold: onHold, rejected: rejected,
      total: completed + assigned + inProgress + onHold + rejected,
    };
  }).filter(function(r) { return r.total > 0; })
    .sort(function(a, b) { return b.total - a.total; });

  var team = editorBreakdown.reduce(function(s, r) {
    return {
      photo: s.photo+r.photo, agent: s.agent+r.agent, offplan: s.offplan+r.offplan,
      completed: s.completed+r.completed, assigned: s.assigned+r.assigned,
      inProgress: s.inProgress+r.inProgress, onHold: s.onHold+r.onHold,
      rejected: s.rejected+r.rejected, total: s.total+r.total,
    };
  }, {photo:0,agent:0,offplan:0,completed:0,assigned:0,inProgress:0,onHold:0,rejected:0,total:0});

  return { allRows: allRows, rejectedRows: rejectedRows, editorBreakdown: editorBreakdown, team: team };
}

// Runs fn() with S.fromDate/S.toDate/S.range temporarily swapped to a
// specific [from, to] window (ISO 'YYYY-MM-DD' strings), then restores the
// real filter state afterwards. Every date-scoped helper in this file
// (rowInRange, entryInReportRange, computeEditorBreakdown, …) reads its
// bounds from the S object rather than taking parameters, so this is the
// one place that lets us reuse all of that logic to compute stats for an
// arbitrary sub-range (e.g. a single week inside a longer selected range)
// without duplicating a single line of filtering logic.
function withDateRange(from, to, fn) {
  var savedRange = S.range, savedFrom = S.fromDate, savedTo = S.toDate;
  S.range = ''; S.fromDate = from; S.toDate = to;
  try {
    return fn();
  } finally {
    S.range = savedRange; S.fromDate = savedFrom; S.toDate = savedTo;
  }
}

function fmtISODate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// The [from, to] window the currently active filter represents, as ISO date
// strings — or null if the active filter isn't a fixed span (today/
// yesterday/week/all have no fixed end, so there's nothing to split into
// weeks). Used only to decide whether renderReport() should break the report
// into weekly sections.
function getEffectiveRangeBounds() {
  if (S.fromDate && S.toDate) return { from: S.fromDate, to: S.toDate };
  if (S.range === 'month') {
    var now = new Date();
    var to   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var from = new Date(to); from.setMonth(from.getMonth() - 1);
    return { from: fmtISODate(from), to: fmtISODate(to) };
  }
  return null;
}

// Splits the active range into consecutive 7-day "Week N" segments, only
// when the range is long enough that weekly sections actually mean
// something (10+ days — comfortably more than a single week, so the last
// segment is never just a stray day or two). Returns null otherwise, in
// which case renderReport() falls back to a single, non-split report.
function getWeekSegments() {
  var bounds = getEffectiveRangeBounds();
  if (!bounds) return null;

  var from = new Date(bounds.from);
  var to   = new Date(bounds.to);
  var totalDays = Math.round((to - from) / 86400000) + 1;
  if (totalDays < 10) return null;

  var segments = [];
  var cursor = new Date(from);
  var idx = 1;
  while (cursor <= to) {
    var segEnd = new Date(cursor);
    segEnd.setDate(segEnd.getDate() + 6);
    if (segEnd > to) segEnd = new Date(to);
    segments.push({ label: 'Week ' + idx, from: fmtISODate(cursor), to: fmtISODate(segEnd) });
    cursor.setDate(cursor.getDate() + 7);
    idx++;
  }
  return segments.length > 1 ? segments : null;
}

// Pulls together every number the report needs for whatever range is
// CURRENTLY active in S (fromDate/toDate/range) — same computation the
// single-range report always used, just factored out so it can be reused
// per-week as well as for the combined range.
function computeReportStats() {
  var allRows = getAllRows().filter(rowInRange);

  // ── Rejected rows are a SEPARATE metric — must NOT inflate other counts ──
  var rejectedRows = allRows.filter(function(r) { return norm(r['Status']) === 'rejected'; });
  var actualRej    = rejectedRows.length;

  // Photo / Agent / Brochure counts (Requests Summary cards) exclude rejected
  // rows but otherwise count all request VOLUME regardless of upload status —
  // a different question from the Editor Breakdown table's "Completed"
  // column, which counts only what's actually been uploaded.
  var nonRejected = allRows.filter(function(r) { return norm(r['Status']) !== 'rejected'; });
  var actualPhoto  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'photo request'; }).length;
  var actualAgent  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'agent request'; }).length;
  var actualBroch  = nonRejected.filter(function(r) { return norm(r['List Type']) === 'brochure'; }).length;
  var actualTotal  = actualPhoto + actualAgent + actualBroch;

  var uploaded = allRows.filter(function(r) { return norm(r['Status']) === 'uploaded'; }).length;
  var pending  = allRows.filter(function(r) { return norm(r['Status']) === 'pending' || norm(r['Status']) === 'ongoing'; }).length;
  var compRate = allRows.length > 0 ? Math.round(uploaded / allRows.length * 100) : 0;

  // ── Per-editor breakdown — Photo/Agent/Offplan/Completed from the Copier
  // sheet, Assigned/In progress/On-hold from the Assigner sheet, Rejected
  // from the Copier sheet. See computeEditorBreakdown() for why each column
  // is sourced where it is.
  var bd = computeEditorBreakdown();

  return {
    actualPhoto: actualPhoto, actualAgent: actualAgent, actualBroch: actualBroch,
    actualRej: actualRej, actualTotal: actualTotal,
    uploaded: uploaded, pending: pending, compRate: compRate,
    editorBreakdown: bd.editorBreakdown, team: bd.team,
  };
}

function numCell(v, color, faint) {
  var style = color ? ' style="color:' + color + '"' : '';
  var cls = 'num-cell' + (v===0?' num-zero':'') + (faint?' num-faint':'');
  var display = (v === 0 && faint) ? '' : v;
  return '<td class="' + cls + '"' + style + '>' + display + '</td>';
}

function summaryCard(label, actual, valClass) {
  return '<div class="incoming-item">'
    + '<div class="i-label">' + label + '</div>'
    + '<div class="i-val ' + (valClass||'') + '">' + actual + '</div>'
    + '</div>';
}

// Renders one full report block (summary cards + editor table) for a given
// stats object. Shared by the single-range report, each weekly section, and
// the combined section — so all three always render identically.
function buildReportSectionHTML(stats, title, subtitle, headerButtonsHtml) {
  var editorRows = stats.editorBreakdown.map(function(r) {
    return '<tr>'
      + '<td class="editor-name">' + esc(r.editor) + '</td>'
      + '<td class="num-cell hl-soft">' + r.photo   + '</td>'
      + '<td class="num-cell hl-soft">' + r.agent   + '</td>'
      + '<td class="num-cell hl-soft">' + r.offplan + '</td>'
      + '<td class="num-cell hl-strong">' + r.completed + '</td>'
      + numCell(r.assigned,   null, true)
      + numCell(r.inProgress, null, true)
      + numCell(r.onHold,     null, true)
      + numCell(r.rejected, r.rejected > 0 ? 'var(--red)' : null, true)
      + '<td class="num-cell" style="font-weight:700">' + r.total + '</td>'
      + '</tr>';
  }).join('');

  // colspan for pending/rate rows = 8 (photo+agent+offplan+completed+assigned+inProgress+onHold+rejected)
  var footColspan = '8';
  var team = stats.team;

  var headerHtml = title
    ? ('<div class="report-header">'
      + '<div>'
      +   '<div class="report-title">' + esc(title) + '</div>'
      +   '<div class="report-subtitle">' + esc(subtitle) + '</div>'
      + '</div>'
      + (headerButtonsHtml || '')
      + '</div>')
    : '';

  return headerHtml

    + '<div class="report-incoming">'
    +   '<h3>Requests Summary</h3>'
    +   '<div class="incoming-grid">'
    +     summaryCard('📷 Photographer Photos',  stats.actualPhoto, 'blue')
    +     summaryCard('🏠 Agent Property Photos', stats.actualAgent, 'orange')
    +     summaryCard('📄 Offplan / Brochure',    stats.actualBroch, 'green')
    +     '<div class="incoming-item">'
    +       '<div class="i-label">❌ Rejected</div>'
    +       '<div class="i-val" style="color:var(--red)">' + stats.actualRej + '</div>'
    +     '</div>'
    +     '<div class="incoming-item">'
    +       '<div class="i-label">Total Processed</div>'
    +       '<div class="i-val white">' + stats.actualTotal + '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>'

    + '<div class="report-table-wrap">'
    +   '<table class="report-table"><thead><tr>'
    +     '<th>Editor</th>'
    +     '<th class="hl-soft">Photo</th><th class="hl-soft">Agent</th><th class="hl-soft">Offplan</th>'
    +     '<th class="hl-strong">Completed</th>'
    +     '<th>Assigned</th><th>In progress</th><th>On-hold</th>'
    +     '<th style="color:var(--red)">Rejected</th>'
    +     '<th>Total</th>'
    +   '</tr></thead><tbody>'
    +   editorRows
    +   '<tr class="team-total"><td>Team Total</td>'
    +     '<td class="num-cell hl-soft">' + team.photo + '</td>'
    +     '<td class="num-cell hl-soft">' + team.agent + '</td>'
    +     '<td class="num-cell hl-soft">' + team.offplan + '</td>'
    +     '<td class="num-cell hl-strong">' + team.completed + '</td>'
    +     numCell(team.assigned,   null, true)
    +     numCell(team.inProgress, null, true)
    +     numCell(team.onHold,     null, true)
    +     numCell(team.rejected, team.rejected > 0 ? 'var(--red)' : null, true)
    +     '<td class="num-cell" style="font-weight:700">' + team.total + '</td>'
    +   '</tr>'
    +   '<tr class="pending-row"><td>Pending</td><td colspan="' + footColspan + '"></td><td class="num-cell">' + stats.pending + '</td></tr>'
    +   '<tr class="rate-row"><td>Completion Rate</td><td colspan="' + footColspan + '"><span style="font-size:11px;color:var(--text3)">Uploaded ÷ Total</span></td><td class="num-cell">' + stats.compRate + '%</td></tr>'
    +   '</tbody></table>'
    + '</div>';
}

// Week-over-week comparison table shown under the weekly sections — one row
// per metric, one column per week, plus a trend column comparing the first
// week to the last so a multi-week swing is visible at a glance.
function buildWeekAnalysisHTML(weeks) {
  var metrics = [
    { key: 'actualPhoto', label: '📷 Photographer Photos' },
    { key: 'actualAgent', label: '🏠 Agent Property Photos' },
    { key: 'actualBroch', label: '📄 Offplan / Brochure' },
    { key: 'actualRej',   label: '❌ Rejected' },
    { key: 'actualTotal', label: 'Total Processed' },
    { key: 'compRate',    label: 'Completion Rate', suffix: '%' },
  ];

  function trendCell(first, last, suffix) {
    var diff = last - first;
    if (diff === 0) return '<span class="inc-diff inc-even">— even</span>';
    var pct = first !== 0 ? Math.round((diff / first) * 100) : null;
    var cls   = diff > 0 ? 'inc-over' : 'inc-under';
    var arrow = diff > 0 ? '▲' : '▼';
    var pctTxt = pct === null ? '' : ' (' + (diff > 0 ? '+' : '') + pct + '%)';
    return '<span class="inc-diff ' + cls + '">' + arrow + ' ' + (diff > 0 ? '+' : '') + diff + (suffix||'') + pctTxt + '</span>';
  }

  var headerCells = weeks.map(function(w) {
    return '<th>' + esc(w.label) + '<br><span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:9px;">'
      + esc(w.from) + ' → ' + esc(w.to) + '</span></th>';
  }).join('');

  var bodyRows = metrics.map(function(m) {
    var cells = weeks.map(function(w) {
      return '<td class="num-cell">' + w.stats[m.key] + (m.suffix||'') + '</td>';
    }).join('');
    var first = weeks[0].stats[m.key];
    var last  = weeks[weeks.length - 1].stats[m.key];
    return '<tr><td class="editor-name">' + m.label + '</td>' + cells
      + '<td class="num-cell">' + trendCell(first, last, m.suffix) + '</td></tr>';
  }).join('');

  return '<div class="report-table-wrap" style="margin-top:8px;">'
    +   '<table class="report-table"><thead><tr>'
    +     '<th>Metric</th>' + headerCells
    +     '<th>Trend (Wk 1 → Wk ' + weeks.length + ')</th>'
    +   '</tr></thead><tbody>' + bodyRows + '</tbody></table>'
    + '</div>';
}

function renderReport() {
  var wrap = document.getElementById('reportView');
  var headerButtons = '<button class="modal-edit-btn" id="exportReportBtn" style="height:32px;padding:0 14px;font-size:12px;">📄 Export Report</button>';

  var segments = getWeekSegments();

  // Single range — same report as always, no weekly split.
  if (!segments) {
    var stats = computeReportStats();
    wrap.innerHTML = buildReportSectionHTML(stats, 'Daily Report', getRangeLabel(), headerButtons);
    return;
  }

  // Multi-week range — a section per week (computed by temporarily scoping
  // the shared date filters to that week), then a Combined section for the
  // full selected range, then a week-over-week analysis of the combined data.
  var weeks = segments.map(function(seg) {
    var wStats = withDateRange(seg.from, seg.to, computeReportStats);
    return { label: seg.label, from: seg.from, to: seg.to, stats: wStats };
  });

  var combinedStats = computeReportStats();

  var html = '<div class="report-header" style="margin-bottom:20px;">'
    + '<div>'
    +   '<div class="report-title">Daily Report</div>'
    +   '<div class="report-subtitle">' + esc(getRangeLabel()) + ' · split into ' + weeks.length + ' weekly sections</div>'
    + '</div>'
    + headerButtons
    + '</div>';

  weeks.forEach(function(w) {
    html += '<div class="report-week-block">'
      + buildReportSectionHTML(w.stats, w.label, w.from + ' → ' + w.to, '')
      + '</div>';
  });

  html += '<div class="report-week-block">'
    + '<div class="report-title" style="font-size:15px;margin-bottom:2px;">📊 Combined — All Weeks</div>'
    + '<div class="report-subtitle" style="margin-bottom:14px;">' + esc(getRangeLabel()) + '</div>'
    + buildReportSectionHTML(combinedStats, '', '', '')
    + '</div>';

  html += '<div class="report-week-block">'
    + '<div class="report-title" style="font-size:15px;margin-bottom:2px;">📈 Week-over-Week Analysis</div>'
    + '<div class="report-subtitle" style="margin-bottom:14px;">How the combined totals moved between weeks</div>'
    + buildWeekAnalysisHTML(weeks)
    + '</div>';

  wrap.innerHTML = html;
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
// enabled: the toggle's own on/off state. withinWindow: whether it's
// currently 9:00-17:30 Dubai time. active: enabled && withinWindow — this
// is what the 3-state indicator actually shows, since "enabled but outside
// hours" (Paused) is a normal expected state, not the same as fully Off.
var AUTO_ASSIGN_STATUS = { enabled: false, withinWindow: false, active: false, roster: [], loaded: false };
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

// 3-state indicator, not a plain on/off: "enabled but outside the 9am–5:30pm
// Dubai window" is a normal, expected state (Paused), distinct from fully
// disabled (Off) — collapsing those into one state would make the toggle
// look "off" every evening/morning even when nothing needs fixing, since
// it'll resume automatically at 9am with no action needed.
function renderAutoAssignToggleHtml() {
  if (!AUTO_ASSIGN_STATUS.loaded) {
    return '<div style="font-size:12px;color:#6b7280;">Auto-Assign \u2014 checking\u2026</div>';
  }
  var enabled = AUTO_ASSIGN_STATUS.enabled;
  var active = AUTO_ASSIGN_STATUS.active;
  var stateColor = active ? '#00d1b2' : (enabled ? '#e6941a' : '#6b7280');
  var stateLabel = active ? 'Active' : (enabled ? 'Paused \u2014 outside 9am\u20135:30pm' : 'Off');
  var trackBg = enabled ? '#00d1b2' : '#353b4d';
  var knobLeft = enabled ? '18px' : '2px';

  return ''
    + '<div style="display:flex;align-items:center;gap:10px;">'
    +   '<span style="font-size:12px;color:#9aa0ad;font-weight:600;">Auto-Assign</span>'
    +   '<button type="button" id="autoAssignSwitch" title="' + esc(stateLabel) + ' \u2014 click to toggle" '
    +     'style="position:relative;width:36px;height:20px;border-radius:10px;border:none;cursor:pointer;'
    +     'background:' + trackBg + ';flex-shrink:0;transition:background .15s;padding:0;">'
    +     '<span style="position:absolute;top:2px;left:' + knobLeft + ';width:16px;height:16px;border-radius:50%;'
    +     'background:#fff;transition:left .15s;"></span>'
    +   '</button>'
    +   '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:' + stateColor + ';font-weight:700;white-space:nowrap;">'
    +     '<span style="width:7px;height:7px;border-radius:50%;background:' + stateColor + ';display:inline-block;"></span>'
    +     esc(stateLabel)
    +   '</span>'
    + '</div>';
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

  var autoAssignHtml = renderAutoAssignToggleHtml();

  var headerHtml =
    '<div class="report-header">'
    +   '<div>'
    +     '<div class="report-title">\uD83D\uDCCA Assignment Dashboard</div>'
    +     '<div class="report-subtitle">From the Assignments tab \u2014 same data as the CRM extension</div>'
    +   '</div>'
    +   autoAssignHtml
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
  var autoAssignSwitch = document.getElementById('autoAssignSwitch');
  if (autoAssignSwitch) {
    autoAssignSwitch.addEventListener('click', function() {
      if (!AUTO_ASSIGN_STATUS.loaded || autoAssignSwitch.disabled) return;
      autoAssignSwitch.disabled = true;
      setAutoAssignEnabled(!AUTO_ASSIGN_STATUS.enabled, function(err) {
        if (err) console.error('Auto-Assign toggle failed:', err);
        // No need to manually re-enable here — setAutoAssignEnabled always
        // calls renderAssignDashboard on both success and failure, which
        // rebuilds this whole button fresh (and thus un-disabled) either way.
      });
    });
  }

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
  // Matches the extension's background.js fetchWithTimeout() call exactly —
  // no cache option set, so this behaves the same way the extension's
  // fetch does (subject to normal browser HTTP caching), rather than
  // forcing a network round-trip on every poll the way 'no-store' did.
  fetch(S.assignUrl + '?token=' + ASSIGN_TOKEN)
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

// Read-only — current enabled/window/active state, for the header toggle's
// 3-state indicator. Cheap, no lock contention server-side (goes through
// doGet, not doPost), safe to poll on the same cadence as assignment data.
function fetchAutoAssignStatus(cb) {
  fetch(S.assignUrl + '?token=' + ASSIGN_TOKEN + '&action=autoAssignStatus', { cache: 'no-store' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || data.error) { if (cb) cb(data && data.error); return; }
      AUTO_ASSIGN_STATUS.enabled = !!data.enabled;
      AUTO_ASSIGN_STATUS.withinWindow = !!data.withinWindow;
      AUTO_ASSIGN_STATUS.active = !!data.active;
      AUTO_ASSIGN_STATUS.roster = Array.isArray(data.roster) ? data.roster : [];
      AUTO_ASSIGN_STATUS.loaded = true;
      if (cb) cb(null);
    })
    .catch(function(err) {
      console.error('Auto-assign status fetch failed', err);
      if (cb) cb(err);
    });
}

// Writes the toggle. Applies for everyone immediately (server-side flag),
// not just this browser tab. Optimistically flips the local state right
// away so the toggle feels instant, then reconciles with the server's
// actual response — reverting the optimistic flip on failure rather than
// leaving the UI showing something that didn't actually take effect.
function setAutoAssignEnabled(nextEnabled, cb) {
  var prevEnabled = AUTO_ASSIGN_STATUS.enabled;
  AUTO_ASSIGN_STATUS.enabled = nextEnabled;
  AUTO_ASSIGN_STATUS.active = nextEnabled && AUTO_ASSIGN_STATUS.withinWindow;
  renderAssignDashboard();

  fetch(S.assignUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token: ASSIGN_TOKEN, action: 'setAutoAssignEnabled', enabled: nextEnabled }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data || data.error || data.enabled !== nextEnabled) {
        AUTO_ASSIGN_STATUS.enabled = prevEnabled;
        AUTO_ASSIGN_STATUS.active = prevEnabled && AUTO_ASSIGN_STATUS.withinWindow;
        renderAssignDashboard();
        if (cb) cb((data && data.error) || 'Did not save — please try again');
        return;
      }
      fetchAutoAssignStatus(function() { renderAssignDashboard(); });
      if (cb) cb(null);
    })
    .catch(function(err) {
      AUTO_ASSIGN_STATUS.enabled = prevEnabled;
      AUTO_ASSIGN_STATUS.active = prevEnabled && AUTO_ASSIGN_STATUS.withinWindow;
      renderAssignDashboard();
      if (cb) cb(String(err));
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

// Refresh while the dashboard tab is open — matched to the extension's own
// active-tab refresh rate (REFRESH_INTERVAL_MS = 3000 in assigner-content.js;
// its 15s BACKGROUND_REFRESH_INTERVAL_MS only applies when the CRM tab
// itself isn't visible, which doesn't have an equivalent here) so both
// surfaces poll the sheet on the same cadence.
var ASSIGN_POLL_MS = 3000;

function assignStartPoll() {
  assignStopPoll();
  ASSIGN_POLL_INTERVAL = setInterval(function() {
    if (document.visibilityState === 'visible' && ASSIGN_DASH_VIEW_ACTIVE) {
      fetchAssignData(function() { renderAssignDashboard(); }, true);
      fetchAutoAssignStatus(function() { renderAssignDashboard(); });
    }
  }, ASSIGN_POLL_MS);
}

function assignStopPoll() {
  if (ASSIGN_POLL_INTERVAL) { clearInterval(ASSIGN_POLL_INTERVAL); ASSIGN_POLL_INTERVAL = null; }
}

function openAssignDashboardView() {
  renderAssignDashboard(); // show something immediately (loading state)
  fetchAssignData(function() { renderAssignDashboard(); });
  fetchAutoAssignStatus(function() { renderAssignDashboard(); });
  assignStartClock();
  assignStartPoll();
}

// ─── PPTX Export ────────────────────────────────────────────────────────────
// Builds an editable PowerPoint (title / summary+breakdown per week (if the
// active range splits into weeks) / combined summary+breakdown / week-over-
// week analysis (if split) / rejected detail) scoped to whatever date range
// + editor tab is currently active on screen. Mirrors renderReport() exactly
// so the numbers in the deck always match what's on screen.
// Palette: Coolors "0a0908-22333b-f2f4f3-a9927d-5e503f"
function generateReportPPTX() {
  if (typeof PptxGenJS === 'undefined') {
    alert('Export library failed to load. Check your internet connection and try again.');
    return;
  }

  var BG        = 'F2F4F3'; // White Smoke — page background
  var PANEL     = 'FFFFFF';
  var PANEL2    = 'EDEAE5'; // header / team-total row
  var LIGHT_HL  = 'F6EFE4'; // Photo/Agent/Offplan light highlight
  var STRONG_HL = 'E9D9BC'; // Completed strong highlight
  var BORDER    = 'D9D2C7';
  var INK       = '0A0908'; // Black — primary text
  var JET       = '22333B'; // Jet Black — headers / dark accent
  var TAUPE     = 'A9927D'; // Dusty Taupe — accent
  var BROWN     = '5E503F'; // Stone Brown — muted text
  var RED       = 'B3452F'; // rejected / downward trend
  var GREEN     = '3F7D57'; // upward trend
  var FONT      = 'Calibri';
  var W = 13.33, H = 7.5;

  // ── Gather data for one range (whatever S.fromDate/S.toDate/S.range are
  // currently set to) — same source + same computation as the on-screen
  // report (computeEditorBreakdown() / computeReportStats()), so numbers in
  // the exported deck can never drift from what's on screen. Called directly
  // for the combined/full-range data, and via withDateRange() for each
  // week's data so it can reuse the exact same logic per week. ────────────
  function gatherSlideData() {
    var bd    = computeEditorBreakdown();
    var stats = computeReportStats();
    var compRate = bd.team.total > 0 ? Math.round(bd.team.completed / bd.team.total * 100) : 0;
    return { editorBreakdown: bd.editorBreakdown, team: bd.team, rejectedRows: bd.rejectedRows, compRate: compRate, stats: stats };
  }

  var combined = gatherSlideData();

  // Same week-splitting the on-screen report uses — only kicks in for a
  // sufficiently long selected range (10+ days). See getWeekSegments().
  var segments = getWeekSegments();
  var weeks = segments && segments.map(function(seg) {
    var data = withDateRange(seg.from, seg.to, gatherSlideData);
    return { label: seg.label, from: seg.from, to: seg.to, data: data };
  });

  var rangeLabel = getRangeLabel();
  var now = new Date();
  var generatedAt = 'Generated ' + now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
    + ', ' + now.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });

  // ── Build deck ──────────────────────────────────────────────────────────
  var pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  function bgSlide() {
    var s = pres.addSlide();
    s.background = { color: BG };
    return s;
  }

  // Slide 1 (title) is unlabeled, so page numbering starts at 2 and just
  // auto-increments regardless of how many weekly sections get inserted.
  var pageCounter = 2;
  function footer(s) {
    s.addText('DP Photo Editors Studio', { x:0.5, y:H-0.45, w:6, h:0.3, fontFace:FONT, fontSize:9, color:BROWN });
    s.addText('Page ' + pageCounter, { x:W-6.5, y:H-0.45, w:6, h:0.3, align:'right', fontFace:FONT, fontSize:9, color:BROWN });
    pageCounter++;
  }

  // Slide 1 — Title
  (function() {
    var s = bgSlide();
    s.addShape('rect', { x:0, y:0, w:0.12, h:H, fill:{ color: TAUPE } });
    s.addText('DP PHOTO EDITORS STUDIO', { x:0.9, y:2.55, w:11.5, h:0.4, fontFace:FONT, fontSize:14, color:BROWN, charSpacing:3, bold:true });
    s.addText('Daily Report', { x:0.85, y:2.9, w:11.5, h:1.1, fontFace:FONT, fontSize:44, color:INK, bold:true });
    s.addText(rangeLabel, { x:0.9, y:3.95, w:11.5, h:0.5, fontFace:FONT, fontSize:20, color:JET });
    if (weeks) {
      s.addText('Split into ' + weeks.length + ' weekly sections + combined summary + week-over-week analysis',
        { x:0.9, y:4.4, w:11.5, h:0.35, fontFace:FONT, fontSize:12.5, color:TAUPE });
      s.addText(generatedAt, { x:0.9, y:4.72, w:11.5, h:0.4, fontFace:FONT, fontSize:12, color:BROWN });
    } else {
      s.addText(generatedAt, { x:0.9, y:4.45, w:11.5, h:0.4, fontFace:FONT, fontSize:12, color:BROWN });
    }
  })();

  // Summary + Editor Breakdown slide — used once for a single-range report,
  // or once per week plus once for the combined range when the report is
  // split into weeks. Layout numbers match the original single-slide design,
  // just with a "Requests Summary" line inserted under the subtitle so each
  // slide also carries the same actual-volume numbers the on-screen
  // Requests Summary cards show for that same range.
  function addSummarySlide(title, subtitle, data) {
    var s = bgSlide();
    s.addText(title, { x:0.6, y:0.4, w:9.5, h:0.5, fontFace:FONT, fontSize:26, color:INK, bold:true });
    s.addText(subtitle, { x:0.6, y:0.88, w:9.5, h:0.35, fontFace:FONT, fontSize:13, color:BROWN });

    var st = data.stats;
    var reqLine = '📷 Photo ' + st.actualPhoto + '   🏠 Agent ' + st.actualAgent
      + '   📄 Offplan ' + st.actualBroch + '   ❌ Rejected ' + st.actualRej
      + '   ·   Total Processed ' + st.actualTotal;
    s.addText(reqLine, { x:0.6, y:1.22, w:12.1, h:0.3, fontFace:FONT, fontSize:10.5, color:BROWN });

    var team = data.team;
    var kpis = [
      { label: 'Total Processed', val: String(team.total), color: INK },
      { label: 'Completed',       val: String(team.completed), color: JET },
      { label: 'Assigned',        val: String(team.assigned), color: TAUPE },
      { label: 'In progress',     val: String(team.inProgress), color: TAUPE },
      { label: 'On-hold',         val: String(team.onHold), color: TAUPE },
      { label: 'Rejected',        val: String(team.rejected), color: RED },
      { label: 'Completion Rate', val: data.compRate + '%', color: BROWN },
    ];

    var cardGap = 0.2, startX = 0.6, cardY = 1.62, cardH = 1.2;
    var cardW = (12.1 - (kpis.length - 1) * cardGap) / kpis.length;
    kpis.forEach(function(k, i) {
      var x = startX + i * (cardW + cardGap);
      s.addShape('roundRect', { x:x, y:cardY, w:cardW, h:cardH, rectRadius:0.08, fill:{ color:PANEL }, line:{ color:BORDER, width:1 } });
      s.addText(k.label.toUpperCase(), { x:x+0.12, y:cardY+0.13, w:cardW-0.24, h:0.45, fontFace:FONT, fontSize:8.5, color:BROWN, charSpacing:0.5 });
      s.addText(k.val, { x:x+0.12, y:cardY+0.55, w:cardW-0.24, h:0.55, fontFace:FONT, fontSize:20, color:k.color, bold:true });
    });

    var breakdownY = cardY + cardH + 0.2;
    s.addText('Editor Breakdown', { x:0.6, y:breakdownY, w:8, h:0.4, fontFace:FONT, fontSize:16, color:INK, bold:true });

    var header = ['Editor','Photo','Agent','Offplan','Completed','Assigned','In progress','On-hold','Rejected','Total'].map(function(t, i) {
      return { text:t, options:{ bold:true, fontSize:11, align: i===0 ? 'left' : 'center',
        color: i===4 ? INK : BROWN, fill:{ color: i===4 ? STRONG_HL : (i>=1 && i<=3 ? LIGHT_HL : PANEL2) } } };
    });

    var rows = data.editorBreakdown.map(function(e) {
      return [
        { text:e.editor, options:{ color:INK, fontSize:12.5, bold:true, fill:{ color:PANEL } } },
        { text:String(e.photo),   options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:LIGHT_HL } } },
        { text:String(e.agent),   options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:LIGHT_HL } } },
        { text:String(e.offplan), options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:LIGHT_HL } } },
        { text:String(e.completed), options:{ color:INK, fontSize:12.5, align:'center', bold:true, fill:{ color:STRONG_HL } } },
        { text:e.assigned   ? String(e.assigned)   : '', options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:PANEL } } },
        { text:e.inProgress ? String(e.inProgress) : '', options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:PANEL } } },
        { text:e.onHold     ? String(e.onHold)     : '', options:{ color:INK, fontSize:12.5, align:'center', fill:{ color:PANEL } } },
        { text:e.rejected   ? String(e.rejected)   : '', options:{ color:e.rejected>0?RED:INK, fontSize:12.5, align:'center', fill:{ color:PANEL } } },
        { text:String(e.total), options:{ color:INK, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL } } },
      ];
    });

    var teamRow = [
      { text:'Team Total', options:{ color:JET, fontSize:12.5, bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.photo),   options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.agent),   options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.offplan), options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.completed), options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:team.assigned   ? String(team.assigned)   : '', options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:team.inProgress ? String(team.inProgress) : '', options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:team.onHold     ? String(team.onHold)     : '', options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.rejected), options:{ color:RED, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
      { text:String(team.total), options:{ color:JET, fontSize:12.5, align:'center', bold:true, fill:{ color:PANEL2 } } },
    ];

    var tableY = breakdownY + 0.45;
    s.addTable([header].concat(rows, [teamRow]), {
      x:0.6, y:tableY, w:12.1, h:H - 0.65 - tableY,
      colW:[2.45,1.05,1.05,1.05,1.15,1.05,1.05,1.05,1.05,1.15],
      border:{ type:'solid', color:BORDER, pt:0.75 },
      fill:{ color:PANEL }, autoPage:false, rowH:0.525, valign:'middle',
    });

    footer(s);
  }

  // Week-over-week analysis slide — one row per metric, one column per
  // week, plus a trend column comparing the first week to the last. Mirrors
  // buildWeekAnalysisHTML() on screen so the numbers always match.
  function addWeekAnalysisSlide(weeks) {
    var s = bgSlide();
    s.addText('Week-over-Week Analysis', { x:0.6, y:0.45, w:10, h:0.5, fontFace:FONT, fontSize:26, color:INK, bold:true });
    s.addText('How the combined totals moved between weeks', { x:0.6, y:0.95, w:10, h:0.35, fontFace:FONT, fontSize:13, color:BROWN });

    var metrics = [
      { key:'actualPhoto', label:'📷 Photographer Photos' },
      { key:'actualAgent', label:'🏠 Agent Property Photos' },
      { key:'actualBroch', label:'📄 Offplan / Brochure' },
      { key:'actualRej',   label:'❌ Rejected' },
      { key:'actualTotal', label:'Total Processed' },
      { key:'compRate',    label:'Completion Rate', suffix:'%' },
    ];

    function trendText(first, last, suffix) {
      var diff = last - first;
      if (diff === 0) return '— even';
      var pct = first !== 0 ? Math.round((diff / first) * 100) : null;
      var arrow = diff > 0 ? '▲' : '▼';
      var pctTxt = pct === null ? '' : ' (' + (diff > 0 ? '+' : '') + pct + '%)';
      return arrow + ' ' + (diff > 0 ? '+' : '') + diff + (suffix||'') + pctTxt;
    }
    function trendColor(first, last) {
      var diff = last - first;
      return diff === 0 ? BROWN : (diff > 0 ? GREEN : RED);
    }

    var metricColW = 2.9, trendColW = 2.3;
    var weekColW = (12.1 - metricColW - trendColW) / weeks.length;

    var header = [{ text:'Metric', options:{ bold:true, fontSize:11, align:'left', color:BROWN, fill:{ color:PANEL2 } } }]
      .concat(weeks.map(function(w) {
        return { text: w.label + '\n' + w.from + ' → ' + w.to, options:{ bold:true, fontSize:9.5, align:'center', color:BROWN, fill:{ color:PANEL2 } } };
      }))
      .concat([{ text:'Trend (Wk 1 → Wk ' + weeks.length + ')', options:{ bold:true, fontSize:10, align:'center', color:BROWN, fill:{ color:PANEL2 } } }]);

    var rows = metrics.map(function(m) {
      var cells = [{ text:m.label, options:{ color:INK, fontSize:12, bold:true, fill:{ color:PANEL } } }];
      weeks.forEach(function(w) {
        cells.push({ text: String(w.data.stats[m.key]) + (m.suffix||''), options:{ color:INK, fontSize:12, align:'center', fill:{ color:PANEL } } });
      });
      var first = weeks[0].data.stats[m.key];
      var last  = weeks[weeks.length - 1].data.stats[m.key];
      cells.push({ text: trendText(first, last, m.suffix), options:{ color: trendColor(first, last), fontSize:11.5, bold:true, align:'center', fill:{ color:PANEL } } });
      return cells;
    });

    s.addTable([header].concat(rows), {
      x:0.6, y:1.5, w:12.1,
      colW: [metricColW].concat(weeks.map(function() { return weekColW; }), [trendColW]),
      border:{ type:'solid', color:BORDER, pt:0.75 },
      fill:{ color:PANEL }, autoPage:false, rowH:0.55, valign:'middle',
    });

    footer(s);
  }

  if (weeks) {
    weeks.forEach(function(w) { addSummarySlide(w.label, w.from + ' → ' + w.to, w.data); });
    addSummarySlide('Combined — All Weeks', rangeLabel, combined);
    addWeekAnalysisSlide(weeks);
  } else {
    addSummarySlide('Summary', rangeLabel, combined);
  }

  // Rejected listings detail — always the full/combined range (a per-week
  // breakdown of individual rejected listings would just be noise; the
  // Rejected KPI/column already shows the per-week and combined counts).
  // Rows are packed by ESTIMATED WRAPPED HEIGHT (not a fixed row count) so a
  // long Rejection Reason can never push the table past the footer.
  var rejections = combined.rejectedRows.map(function(r) {
    return {
      req:    r['DP-REQ Number']     || '—',
      ref:    r['Listing Reference'] || '—',
      editor: r._editor              || '—',
      reason: r['Rejection Reason']  || 'No reason recorded',
    };
  });

  var REASON_COL_W = 5.2; // inches — must match colW[3] below
  var CHARS_PER_LINE = Math.max(10, Math.floor(REASON_COL_W * 15)); // ~15 chars/inch at 11.5pt
  var TABLE_TOP = 1.6, FOOTER_Y = H - 0.6;
  var HEADER_H = 0.45;
  var PAGE_BUDGET = (FOOTER_Y - TABLE_TOP) - HEADER_H; // available height for data rows

  function estimateRowH(text) {
    var lines = Math.max(1, Math.ceil(String(text || '').length / CHARS_PER_LINE));
    return Math.min(2.3, 0.42 + lines * 0.24); // cap so one giant row can't blow the budget
  }

  var pages = [];
  (function packPages() {
    var current = [], currentH = 0;
    rejections.forEach(function(r) {
      var rh = estimateRowH(r.reason);
      if (current.length && currentH + rh > PAGE_BUDGET) {
        pages.push(current);
        current = []; currentH = 0;
      }
      current.push({ r: r, h: rh });
      currentH += rh;
    });
    pages.push(current); // always at least one page, even if empty
  })();

  var pageCount = pages.length;
  pages.forEach(function(pageRows, pageNum) {
    var s = bgSlide();
    s.addText('Rejected Listings', { x:0.6, y:0.45, w:8, h:0.5, fontFace:FONT, fontSize:26, color:INK, bold:true });
    var sub = rangeLabel + (weeks ? '  ·  Combined' : '') + '  ·  ' + rejections.length + ' item(s)' + (pageCount > 1 ? '  ·  Page ' + (pageNum+1) + ' of ' + pageCount : '');
    s.addText(sub, { x:0.6, y:0.95, w:11, h:0.35, fontFace:FONT, fontSize:13, color:BROWN });

    var header = ['DP-REQ Number','Listing Reference','Editor','Rejection Reason'].map(function(t) {
      return { text:t, options:{ bold:true, color:BROWN, fill:{ color:PANEL2 }, fontSize:12 } };
    });

    var dataRows, rowHeights;
    if (pageRows.length) {
      dataRows = pageRows.map(function(x) {
        var r = x.r;
        return [
          { text:r.req,    options:{ color:RED, fontSize:12, bold:true, fontFace:'Courier New', fill:{ color:PANEL } } },
          { text:r.ref,    options:{ color:INK, fontSize:12, fill:{ color:PANEL } } },
          { text:r.editor, options:{ color:INK, fontSize:12, fill:{ color:PANEL } } },
          { text:r.reason, options:{ color:BROWN, fontSize:11.5, fill:{ color:PANEL } } },
        ];
      });
      rowHeights = [HEADER_H].concat(pageRows.map(function(x) { return x.h; }));
    } else {
      dataRows = [[
        { text:'No rejected listings in this range.', options:{ color:BROWN, fontSize:12, fill:{ color:PANEL }, italic:true } },
        { text:'', options:{ fill:{ color:PANEL } } },
        { text:'', options:{ fill:{ color:PANEL } } },
        { text:'', options:{ fill:{ color:PANEL } } },
      ]];
      rowHeights = [HEADER_H, 0.6];
    }

    s.addTable([header].concat(dataRows), {
      x:0.6, y:TABLE_TOP, w:12.1,
      colW:[2.3,3.1,1.5,REASON_COL_W],
      border:{ type:'solid', color:BORDER, pt:0.75 },
      fill:{ color:PANEL }, autoPage:false, rowH:rowHeights, valign:'middle',
    });

    footer(s);
  });

  var rangeSlug = (S.fromDate && S.toDate) ? (S.fromDate + '_to_' + S.toDate) : (S.range || 'all');
  var dateSlug = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  pres.writeFile({ fileName: 'DP-Report-' + rangeSlug + '-' + dateSlug + '.pptx' });
}
