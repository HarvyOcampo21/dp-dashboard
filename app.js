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
  url:       'https://script.google.com/a/macros/drivenproperties.com/s/AKfycbxRnU165B4OZoIyc-sDFrkQB-tePNsb9MBrMWJa7IRZuTWzzITQvxT6ES7eSCVzc6S-/exec',
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
var EXCLUDED_TABS = ['Lifestyle'];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {

  // ── Theme & mode init (runs first so no flash) ──────────────────────────────
  initTheme();
  initMode();

  fetchData();

  document.getElementById('searchInput').addEventListener('input', function() {
    S.search = this.value.toLowerCase();
    render();
  });

  // ── View toggle ──────────────────────────────────────────────────────────────
  document.querySelectorAll('.v-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.v-btn').forEach(function(b) { b.classList.remove('active'); });
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
  });

  // ── Extension download modal ──────────────────────────────────────────────
  document.getElementById('getExtensionBtn').addEventListener('click', function() {
    document.getElementById('extModalBg').style.display = 'flex';
  });

  // ── Color theme swatches ──────────────────────────────────────────────────
  document.querySelectorAll('.swatch').forEach(function(btn) {
    btn.addEventListener('click', function() {
      applyTheme(btn.dataset.theme);
    });
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
  }, 15000);

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

  fetch(S.url + '?action=getData')
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
  var raw = row['Date Uploaded'] || row['Received Date'] || row['Date'];
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
    { label:'Total',    val: total,    cls:'' },
    { label:'Uploaded', val: uploaded, cls:'g' },
    { label:'Pending',  val: pending,  cls:'y' },
    { label:'Rejected', val: rejected, cls:'r' },
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
  var isEmpty = rows.length === 0;
  col.className = 'col ' + (isEmpty ? 'collapsed' : 'open');

  var header = document.createElement('div');
  header.className = 'col-header';
  header.innerHTML = '<div class="col-header-left">'
    + '<span class="col-drag-handle" title="Drag to reorder">⠿</span>'
    + '<span class="col-name">' + esc(title) + '</span>'
    + '</div>'
    + '<span class="col-count">' + rows.length + '</span>';

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

  if (rows.length === 0) {
    body.innerHTML = '<div class="col-empty">No listings</div>';
  } else {
    sortNewest(rows).forEach(function(row) { body.appendChild(makeCard(row)); });
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
    rows = rows.slice().sort(function(a, b) {
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
      else { S.sortCol = col; S.sortDir = 1; }
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

  if (row._editor) {
    html += '<div class="modal-editor">Editor tab: ' + esc(row._editor) + '</div>';
  }

  document.getElementById('modalInner').innerHTML = html;
  document.getElementById('modalBg').style.display = 'flex';
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
  }
});

// ─── Report View ──────────────────────────────────────────────────────────────
function getRangeLabel() {
  if (S.fromDate && S.toDate) return S.fromDate + ' → ' + S.toDate;
  if (S.range === 'today') return 'Today — ' + new Date().toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });
  if (S.range === 'week')  return 'Last 7 days';
  if (S.range === 'month') return 'Last 30 days';
  return 'All time';
}

function renderReport() {
  var wrap = document.getElementById('reportView');

  var allRows = getAllRows().filter(rowInRange);

  // Build Lifestyle count per editor for current range
    var lifestyleByEditor = {};

    (S.data['Lifestyle'] || []).forEach(function(r) {
      if (!rowInRange(r)) return;

      var editor = String(r['Editor'] || '').trim();
      var count  = parseInt(r['Count'], 10) || 0;

      if (!editor || count === 0) return;

      lifestyleByEditor[editor] =
        (lifestyleByEditor[editor] || 0) + count;
    });


  var photoReq = allRows.filter(function(r) { return norm(r['List Type']) === 'photo request'; }).length;
  var agentReq = allRows.filter(function(r) { return norm(r['List Type']) === 'agent request'; }).length;
  var brochure = allRows.filter(function(r) { return norm(r['List Type']) === 'brochure'; }).length;
  var totalIn  = photoReq + agentReq + brochure;

  var uploaded = allRows.filter(function(r) { return norm(r['Status']) === 'uploaded'; }).length;
  var pending  = allRows.filter(function(r) { return norm(r['Status']) === 'pending' || norm(r['Status']) === 'ongoing'; }).length;
  var compRate = allRows.length > 0 ? Math.round(uploaded / allRows.length * 100) : 0;

  // Per-editor breakdown
  var editorBreakdown = S.editors.map(function(editor) {
    var rows = (S.data[editor] || [])
      .map(function(r) { return Object.assign({ _editor: editor }, r); })
      .filter(rowInRange);

    var lifestyle = lifestyleByEditor[editor] || 0;

    var photo = rows.filter(r => norm(r['List Type']) === 'photo request').length;
    var agent = rows.filter(r => norm(r['List Type']) === 'agent request').length;
    var broch = rows.filter(r => norm(r['List Type']) === 'brochure').length;

    return {
      editor: editor,
      photo: photo,
      agent: agent,
      lifestyle: lifestyle,
      broch: broch,
      total: photo + agent + lifestyle + broch,
    };

  }).filter(function(r) { return r.total > 0; })
    .sort(function(a,b) { return b.total - a.total; });

  // Fix 2: Lifestyle from its own tab — sum Count values in date range
  var lifestyleRows = (S.data['Lifestyle'] || []).filter(rowInRange);
  var lifestyleTotal = lifestyleRows.reduce(function(s, r) {
    return s + (parseInt(r['Count'], 10) || 0);
  }, 0);

    var teamPhoto     = editorBreakdown.reduce((s,r) => s + r.photo, 0);
    var teamAgent     = editorBreakdown.reduce((s,r) => s + r.agent, 0);
    var teamLifestyle = editorBreakdown.reduce((s,r) => s + r.lifestyle, 0);
    var teamBroch     = editorBreakdown.reduce((s,r) => s + r.broch, 0);

    // ✅ this guarantees Row Total matches visible columns
    var teamTotal = teamPhoto + teamAgent + teamLifestyle + teamBroch;


  function numCell(v) {
    return '<td class="num-cell' + (v === 0 ? ' num-zero' : '') + '">' + v + '</td>';
  }

  var editorRows = editorBreakdown.map(function(r) {
    return '<tr>'
      + '<td class="editor-name">' + esc(r.editor) + '</td>'
      + numCell(r.photo)
      + numCell(r.agent)
      + numCell(r.lifestyle)
      + numCell(r.broch)
      + numCell(r.total)
      + '</tr>';
  }).join('');

  // Fix 2: Lifestyle row — only shows Row Total, dashes for breakdown columns

  wrap.innerHTML =
    '<div class="report-header">'
    +  '<div>'
    +    '<div class="report-title">Daily Report</div>'
    +    '<div class="report-subtitle">' + esc(getRangeLabel()) + '</div>'
    +  '</div>'
    + '</div>'

    + '<div class="report-incoming">'
    +  '<h3>Incoming Requests</h3>'
    +  '<div class="incoming-grid">'
    +    '<div class="incoming-item"><div class="i-label">Photographer Photos<br>(Photo Request)</div><div class="i-val blue">' + photoReq + '</div></div>'
    +    '<div class="incoming-item"><div class="i-label">Agent Property Photos<br>(Agent Request)</div><div class="i-val orange">' + agentReq + '</div></div>'
    +    '<div class="incoming-item"><div class="i-label">Offplan<br>(Brochure)</div><div class="i-val green">' + brochure + '</div></div>'
    +    '<div class="incoming-item"><div class="i-label">Total Processed<br>&nbsp;</div><div class="i-val white">' + totalIn + '</div></div>'
    +    (lifestyleTotal > 0 ? '<div class="incoming-item"><div class="i-label">Lifestyle / Profile / Others<br>&nbsp;</div><div class="i-val" style="color:var(--purple)">' + lifestyleTotal + '</div></div>' : '')
    +  '</div>'
    + '</div>'

    + '<div class="report-table-wrap">'
    +  '<table class="report-table">'
    +  '<thead><tr>'
    +    '<th>Editor</th>'
    +    '<th>Photographer Photos</th>'
    +    '<th>Agent Property Photos</th>'
    +    '<th style="color:var(--purple)">Profile / Lifestyle / Others</th>'
    +    '<th>Offplan</th>'
    +    '<th>Total</th>'
    +  '</tr></thead>'
    +  '<tbody>'
    +  editorRows
    +  '<tr class="team-total">'
    +    '<td>Team Total</td>'
    +    numCell(teamPhoto) + numCell(teamAgent) + numCell(teamLifestyle) + numCell(teamBroch) + numCell(teamTotal)
    +  '</tr>'
    +  '<tr class="pending-row">'
    +    '<td>Pending</td>'
    +    '<td colspan="4"></td>'
    +    '<td class="num-cell">' + pending + '</td>'
    +  '</tr>'
    +  '<tr class="rate-row">'
    +    '<td>Completion Rate</td>'
    +    '<td colspan="4"><span style="font-size:11px;color:var(--text3)">Uploaded ÷ Total</span></td>'
    +    '<td class="num-cell">' + compRate + '%</td>'
    +  '</tr>'
    +  '</tbody></table>'
    + '</div>';
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

// ─── Theme & Mode ─────────────────────────────────────────────────────────────

var THEMES = ['green','blue','red','yellow'];

function initTheme() {
  var saved = localStorage.getItem('dp_theme') || 'green';
  applyTheme(saved);
}

function applyTheme(theme) {
  if (THEMES.indexOf(theme) === -1) theme = 'green';
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dp_theme', theme);

  // Update swatch active state
  document.querySelectorAll('.swatch').forEach(function(s) {
    s.classList.toggle('active', s.dataset.theme === theme);
  });
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