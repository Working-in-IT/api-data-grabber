(function () {
  "use strict";

  const MAX_REQUESTS = 1000;
  const LARGE_RESPONSE_THRESHOLD = 1024 * 1024; // 1 MB

  let capturedRequests = [];
  let selectedRequestId = null;
  let currentArrays = [];

  // DOM elements
  const requestListBody = document.querySelector("#request-list tbody");
  const requestCount = document.getElementById("request-count");
  const btnClear = document.getElementById("btn-clear");
  const filterType = document.getElementById("filter-type");
  const searchUrl = document.getElementById("search-url");
  const jsonViewer = document.getElementById("json-viewer");
  const headersViewer = document.getElementById("headers-viewer");
  const arraySelector = document.getElementById("array-selector");
  const tableContainer = document.getElementById("table-container");
  const emptyState = document.getElementById("empty-state");
  const tabs = document.querySelectorAll(".tab");
  const tabContents = document.querySelectorAll(".tab-content");
  const tableTab = document.querySelector('.tab[data-tab="table"]');

  // ── Network capture ──────────────────────────────────────────────

  chrome.devtools.network.onRequestFinished.addListener(function (request) {
    const entry = {
      id: capturedRequests.length,
      method: request.request.method,
      url: request.request.url,
      status: request.response.status,
      statusText: request.response.statusText,
      time: Math.round(request.time * 1000),
      mimeType: request.response.content.mimeType || "",
      size: request.response.content.size || 0,
      requestHeaders: request.request.headers,
      responseHeaders: request.response.headers,
      _harEntry: request,
      _body: null,
      _bodyLoaded: false,
    };

    if (capturedRequests.length >= MAX_REQUESTS) {
      capturedRequests.shift();
      rebuildRequestList();
    }

    capturedRequests.push(entry);
    addRequestRow(entry);
    updateRequestCount();
  });

  chrome.devtools.network.onNavigated.addListener(function () {
    capturedRequests = [];
    selectedRequestId = null;
    currentArrays = [];
    requestListBody.innerHTML = "";
    clearResponseViewer();
    updateRequestCount();
    emptyState.classList.remove("hidden");
  });

  // ── Request list ─────────────────────────────────────────────────

  function addRequestRow(entry) {
    if (!matchesFilter(entry)) return;

    const tr = document.createElement("tr");
    tr.dataset.id = entry.id;

    const methodClass = "method-" + entry.method.toLowerCase();
    const statusClass = getStatusClass(entry.status);

    tr.innerHTML =
      '<td class="' + methodClass + '">' + escapeHtml(entry.method) + "</td>" +
      "<td title=\"" + escapeHtml(entry.url) + "\">" + escapeHtml(shortenUrl(entry.url)) + "</td>" +
      '<td class="' + statusClass + '">' + entry.status + "</td>" +
      "<td>" + entry.time + " ms</td>";

    tr.addEventListener("click", function () {
      selectRequest(entry.id);
    });

    requestListBody.appendChild(tr);
  }

  function rebuildRequestList() {
    requestListBody.innerHTML = "";
    for (const entry of capturedRequests) {
      addRequestRow(entry);
    }
  }

  function selectRequest(id) {
    selectedRequestId = id;

    // Highlight row
    const rows = requestListBody.querySelectorAll("tr");
    for (const row of rows) {
      row.classList.toggle("selected", parseInt(row.dataset.id) === id);
    }

    const entry = capturedRequests.find(function (e) { return e.id === id; });
    if (!entry) return;

    emptyState.classList.add("hidden");
    showHeaders(entry);
    loadAndShowResponse(entry);
  }

  function matchesFilter(entry) {
    const type = filterType.value;
    if (type === "xhr" && !isXhr(entry)) return false;
    if (type === "fetch" && !isFetch(entry)) return false;

    const search = searchUrl.value.toLowerCase();
    if (search && entry.url.toLowerCase().indexOf(search) === -1) return false;

    return true;
  }

  function isXhr(entry) {
    return entry._harEntry._resourceType === "xhr";
  }

  function isFetch(entry) {
    return entry._harEntry._resourceType === "fetch";
  }

  // ── Response loading ─────────────────────────────────────────────

  function loadAndShowResponse(entry) {
    if (entry._bodyLoaded) {
      displayResponse(entry);
      return;
    }

    jsonViewer.textContent = "Loading...";
    clearTable();

    entry._harEntry.getContent(function (content, encoding) {
      if (encoding === "base64" && content) {
        try {
          content = atob(content);
        } catch (e) {
          // keep original
        }
      }
      entry._body = content || "";
      entry._bodyLoaded = true;

      if (entry.id === selectedRequestId) {
        displayResponse(entry);
      }
    });
  }

  function displayResponse(entry) {
    const body = entry._body;
    currentArrays = [];

    // Size warning
    if (body.length > LARGE_RESPONSE_THRESHOLD) {
      jsonViewer.innerHTML =
        '<div class="size-warning">Large response (' +
        formatBytes(body.length) +
        "). Rendering may be slow.</div>";
    } else {
      jsonViewer.innerHTML = "";
    }

    // Try parse JSON
    let parsed = null;
    if (isJsonMime(entry.mimeType)) {
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        // not valid JSON
      }
    }

    if (parsed !== null) {
      jsonViewer.innerHTML += renderJson(parsed);
      currentArrays = detectArrays(parsed);
      updateTableTab();
    } else {
      jsonViewer.textContent = body || "(empty response)";
      tableTab.classList.remove("has-arrays");
      clearTable();
      arraySelector.innerHTML = "";
    }
  }

  // ── Headers ──────────────────────────────────────────────────────

  function showHeaders(entry) {
    let html = '<div class="headers-section"><h3>Request Headers</h3>';
    for (const h of entry.requestHeaders) {
      html +=
        '<div class="header-row"><span class="header-name">' +
        escapeHtml(h.name) +
        ': </span><span class="header-value">' +
        escapeHtml(h.value) +
        "</span></div>";
    }
    html += "</div>";

    html += '<div class="headers-section"><h3>Response Headers</h3>';
    for (const h of entry.responseHeaders) {
      html +=
        '<div class="header-row"><span class="header-name">' +
        escapeHtml(h.name) +
        ': </span><span class="header-value">' +
        escapeHtml(h.value) +
        "</span></div>";
    }
    html += "</div>";

    headersViewer.innerHTML = html;
  }

  // ── JSON rendering ───────────────────────────────────────────────

  function renderJson(data, indent) {
    if (indent === undefined) indent = 0;
    var pad = "  ".repeat(indent);
    var padInner = "  ".repeat(indent + 1);

    if (data === null) {
      return '<span class="json-null">null</span>';
    }
    if (typeof data === "boolean") {
      return '<span class="json-boolean">' + data + "</span>";
    }
    if (typeof data === "number") {
      return '<span class="json-number">' + data + "</span>";
    }
    if (typeof data === "string") {
      return '<span class="json-string">"' + escapeHtml(data) + '"</span>';
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return "[]";
      var items = [];
      for (var i = 0; i < data.length; i++) {
        items.push(padInner + renderJson(data[i], indent + 1));
      }
      return "[\n" + items.join(",\n") + "\n" + pad + "]";
    }
    if (typeof data === "object") {
      var keys = Object.keys(data);
      if (keys.length === 0) return "{}";
      var entries = [];
      for (var k = 0; k < keys.length; k++) {
        entries.push(
          padInner +
          '<span class="json-key">"' + escapeHtml(keys[k]) + '"</span>: ' +
          renderJson(data[keys[k]], indent + 1)
        );
      }
      return "{\n" + entries.join(",\n") + "\n" + pad + "}";
    }
    return String(data);
  }

  // ── Array detection ──────────────────────────────────────────────

  function detectArrays(obj, path, depth) {
    if (path === undefined) path = "";
    if (depth === undefined) depth = 0;
    if (depth > 10) return [];

    var results = [];

    if (
      Array.isArray(obj) &&
      obj.length > 0 &&
      typeof obj[0] === "object" &&
      obj[0] !== null &&
      !Array.isArray(obj[0])
    ) {
      results.push({ path: path || "(root)", data: obj });
    }

    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) {
        var childPath = path ? path + "." + keys[i] : keys[i];
        var childResults = detectArrays(obj[keys[i]], childPath, depth + 1);
        for (var j = 0; j < childResults.length; j++) {
          results.push(childResults[j]);
        }
      }
    }

    return results;
  }

  // ── Table / DataTables ───────────────────────────────────────────

  function updateTableTab() {
    if (currentArrays.length > 0) {
      tableTab.classList.add("has-arrays");
      renderArrayButtons();
    } else {
      tableTab.classList.remove("has-arrays");
      arraySelector.innerHTML = "";
      tableContainer.innerHTML =
        '<div class="no-arrays-msg">No arrays of objects detected in this response</div>';
    }
  }

  function renderArrayButtons() {
    arraySelector.innerHTML = "";
    for (var i = 0; i < currentArrays.length; i++) {
      var btn = document.createElement("button");
      btn.className = "array-btn";
      btn.textContent = currentArrays[i].path + " (" + currentArrays[i].data.length + " items)";
      btn.dataset.index = i;
      btn.addEventListener("click", function () {
        var idx = parseInt(this.dataset.index);
        var buttons = arraySelector.querySelectorAll(".array-btn");
        for (var b = 0; b < buttons.length; b++) {
          buttons[b].classList.toggle("active", b === idx);
        }
        renderDataTable(currentArrays[idx].data);
      });
      arraySelector.appendChild(btn);
    }

    // Don't auto-select — let user pick which array to view
    clearTable();
    if (currentArrays.length === 1) {
      arraySelector.querySelector(".array-btn").classList.add("active");
      renderDataTable(currentArrays[0].data);
    } else {
      tableContainer.innerHTML =
        '<div class="no-arrays-msg">Select an array above to view as table</div>';
    }
  }

  function renderDataTable(arrayData) {
    // Destroy existing
    if ($.fn.DataTable.isDataTable("#response-table")) {
      $("#response-table").DataTable().destroy();
      $("#response-table").empty();
    }

    // Collect all keys (union)
    var keySet = {};
    for (var i = 0; i < arrayData.length; i++) {
      if (arrayData[i] && typeof arrayData[i] === "object") {
        var keys = Object.keys(arrayData[i]);
        for (var k = 0; k < keys.length; k++) {
          keySet[keys[k]] = true;
        }
      }
    }
    var allKeys = Object.keys(keySet);

    var columns = allKeys.map(function (key) {
      return {
        title: key,
        data: key,
        defaultContent: "",
        render: function (data) {
          if (data === null) return '<span style="color:#999">null</span>';
          if (data === undefined) return "";
          if (typeof data === "object") {
            return "<code>" + escapeHtml(JSON.stringify(data)) + "</code>";
          }
          return escapeHtml(String(data));
        },
      };
    });

    tableContainer.innerHTML =
      '<table id="response-table" class="display compact" style="width:100%"></table>';

    $("#response-table").DataTable({
      data: arrayData,
      columns: columns,
      pageLength: 25,
      scrollX: true,
      scrollY: "400px",
      scrollCollapse: true,
      order: [],
      dom: '<"dt-toolbar"fB>rtip<"dt-bottom"l>',
      buttons: [
        {
          extend: "excelHtml5",
          text: "Export to Excel",
          title: null,
          exportOptions: {
            orthogonal: "export",
          },
        },
        {
          extend: "csvHtml5",
          text: "Export to CSV",
          title: null,
        },
      ],
      language: {
        emptyTable: "No data in array",
        info: "Showing _START_ to _END_ of _TOTAL_ entries",
      },
    });
  }

  function clearTable() {
    if ($.fn.DataTable.isDataTable("#response-table")) {
      $("#response-table").DataTable().destroy();
    }
    tableContainer.innerHTML = "";
  }

  // ── Tabs ─────────────────────────────────────────────────────────

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      var target = this.dataset.tab;
      tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.tab === target); });
      tabContents.forEach(function (tc) {
        tc.classList.toggle("active", tc.id === "tab-" + target);
      });
    });
  });

  // ── Toolbar ──────────────────────────────────────────────────────

  btnClear.addEventListener("click", function () {
    capturedRequests = [];
    selectedRequestId = null;
    currentArrays = [];
    requestListBody.innerHTML = "";
    clearResponseViewer();
    updateRequestCount();
    emptyState.classList.remove("hidden");
  });

  filterType.addEventListener("change", rebuildRequestList);
  searchUrl.addEventListener("input", rebuildRequestList);

  // ── Divider drag ─────────────────────────────────────────────────

  var divider = document.getElementById("divider");
  var requestPane = document.getElementById("request-list-pane");
  var isDragging = false;

  divider.addEventListener("mousedown", function (e) {
    isDragging = true;
    e.preventDefault();
  });

  document.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    var containerRect = document.getElementById("split-container").getBoundingClientRect();
    var newWidth = e.clientX - containerRect.left;
    var minW = 150;
    var maxW = containerRect.width - 200;
    if (newWidth < minW) newWidth = minW;
    if (newWidth > maxW) newWidth = maxW;
    requestPane.style.width = newWidth + "px";
  });

  document.addEventListener("mouseup", function () {
    isDragging = false;
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function clearResponseViewer() {
    jsonViewer.innerHTML = "";
    headersViewer.innerHTML = "";
    arraySelector.innerHTML = "";
    clearTable();
    tableTab.classList.remove("has-arrays");
  }

  function updateRequestCount() {
    requestCount.textContent = capturedRequests.length + " requests";
  }

  function getStatusClass(status) {
    if (status >= 200 && status < 300) return "status-2xx";
    if (status >= 300 && status < 400) return "status-3xx";
    if (status >= 400 && status < 500) return "status-4xx";
    if (status >= 500) return "status-5xx";
    return "";
  }

  function shortenUrl(url) {
    try {
      var u = new URL(url);
      return u.pathname + u.search;
    } catch (e) {
      return url;
    }
  }

  function isJsonMime(mime) {
    if (!mime) return false;
    return mime.indexOf("json") !== -1 || mime.indexOf("javascript") !== -1;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
