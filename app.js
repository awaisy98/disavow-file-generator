const state = {
  rawText: "",
  fileName: "",
  delimiter: "",
  parsedRows: [],
  workbookSheetName: "",
  workbookSheets: [],
  selectedSheetIndex: 0,
  useHeader: true,
  sourceColumnIndex: null,
  outputMode: "domain",
  stripWww: true,
  includeComments: true,
  errorMessage: "",
  result: null,
};

const headerKeywords = [
  { pattern: /referring domain|source domain|linking domain|root domain|domain/i, score: 6 },
  { pattern: /referring page|source page|backlink|page url|source url|link url|from url|url from|url/i, score: 5 },
  { pattern: /anchor/i, score: 2 },
  { pattern: /toxic|score|type|status|first seen|last seen|country|traffic/i, score: -4 },
  { pattern: /target|destination|landing|money page|url to|to url/i, score: -6 },
];

function setStatusPill(element, text, variant) {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove("is-idle", "is-ready", "is-error");
  element.classList.add(variant);
}

function updateDashboard(metrics = {}) {
  const rowsEl = document.querySelector("#metric-rows");
  const validEl = document.querySelector("#metric-valid");
  const ignoredEl = document.querySelector("#metric-ignored");
  const modeEl = document.querySelector("#metric-mode");
  const heroNoteEl = document.querySelector("#hero-note");
  const helperChipEl = document.querySelector("#helper-chip");
  const dropzoneFileEl = document.querySelector("#dropzone-file");
  const outputNoteEl = document.querySelector("#output-note");

  if (rowsEl) {
    rowsEl.textContent = String(metrics.rows ?? 0);
  }
  if (validEl) {
    validEl.textContent = String(metrics.valid ?? 0);
  }
  if (ignoredEl) {
    ignoredEl.textContent = String(metrics.ignored ?? 0);
  }
  if (modeEl) {
    modeEl.textContent = metrics.modeLabel || "Domain";
  }
  if (heroNoteEl) {
    heroNoteEl.textContent = metrics.heroNote || "Drop a backlink export or paste links to begin.";
  }
  if (helperChipEl) {
    helperChipEl.textContent = metrics.helperText || "Awaiting import";
  }
  if (dropzoneFileEl) {
    dropzoneFileEl.textContent = metrics.fileText || "No file selected yet";
  }
  if (outputNoteEl) {
    outputNoteEl.textContent = metrics.outputNote
      || "Domain mode generates `domain:example.com` lines. Exact URL mode keeps only valid URL entries.";
  }
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function detectDelimiter(text) {
  const firstChunk = text.split(/\r?\n/).slice(0, 6).join("\n");
  const options = [",", "\t", ";", "|"];
  let best = "";
  let bestScore = 0;

  for (const delimiter of options) {
    const rows = parseDelimitedText(firstChunk, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
    const widths = rows.map((row) => row.length).filter((length) => length > 1);
    if (!widths.length) {
      continue;
    }
    const min = Math.min(...widths);
    const max = Math.max(...widths);
    const score = min * 10 - (max - min);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function rowsToText(rows) {
  return rows
    .map((row) => row.map((cell) => String(cell ?? "")).join("\t"))
    .join("\n");
}

function isExcelFile(file) {
  return /\.(xlsx|xls|xlsm)$/i.test(file.name);
}

function parseExcelBuffer(buffer) {
  if (typeof window === "undefined" || !window.XLSX) {
    throw new Error("Excel support is not available because the spreadsheet parser did not load.");
  }

  const workbook = window.XLSX.read(buffer, { type: "array" });
  if (!workbook.SheetNames.length) {
    throw new Error("The workbook does not contain any sheets.");
  }

  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      blankrows: false,
      raw: false,
      defval: "",
    });
    const text = rowsToText(rows);
    const analysis = analyzeRows(text);
    const headerScore = (analysis.headers || []).reduce((sum, header) => sum + Math.max(scoreHeader(header), 0), 0);
    const signalScore = (analysis.dataRows.length * 5) + headerScore;

    return {
      name: sheetName,
      text,
      rowCount: analysis.dataRows.length,
      headerScore,
      signalScore,
    };
  });

  const populatedSheets = sheets.filter((sheet) => sheet.text.trim() !== "");
  if (!populatedSheets.length) {
    throw new Error("The workbook sheets are empty.");
  }

  let bestSheetIndex = 0;
  let bestSheetScore = Number.NEGATIVE_INFINITY;
  sheets.forEach((sheet, index) => {
    if (sheet.signalScore > bestSheetScore) {
      bestSheetScore = sheet.signalScore;
      bestSheetIndex = index;
    }
  });

  return {
    sheets,
    selectedSheetIndex: bestSheetIndex,
  };
}

function parseDelimitedText(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function looksLikeUrl(value) {
  return /^(https?:)?\/\//i.test(value) || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(value);
}

function looksLikeDomain(value) {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
}

function normalizeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  let candidate = trimmed;
  if (!/^[a-z]+:\/\//i.test(candidate) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeExactUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  const hasProtocol = /^[a-z]+:\/\//i.test(trimmed);
  const hasPathOrQueryWithoutProtocol = /^[a-z0-9.-]+\.[a-z]{2,}(\/|\?)/i.test(trimmed);

  if (!hasProtocol && !hasPathOrQueryWithoutProtocol) {
    return null;
  }

  return normalizeUrl(trimmed);
}

function normalizeDomain(value, stripWww = true) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  let hostname = trimmed;

  if (looksLikeUrl(trimmed)) {
    const normalized = normalizeUrl(trimmed);
    if (!normalized) {
      return null;
    }
    hostname = new URL(normalized).hostname.toLowerCase();
  }

  hostname = hostname
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/\s+/g, "");

  if (stripWww) {
    hostname = hostname.replace(/^www\./, "");
  }

  return looksLikeDomain(hostname) ? hostname : null;
}

function scoreHeader(cell) {
  const normalized = normalizeHeader(cell);
  return headerKeywords.reduce((score, item) => {
    return score + (item.pattern.test(normalized) ? item.score : 0);
  }, 0);
}

function detectHeader(rows) {
  if (!rows.length) {
    return false;
  }

  const firstRow = rows[0];
  const scores = firstRow.map(scoreHeader);
  return scores.some((score) => score > 0);
}

function pickSourceColumn(headers) {
  if (!headers.length) {
    return 0;
  }

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  headers.forEach((header, index) => {
    const score = scoreHeader(header);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function analyzeRows(rawText, options = {}) {
  const delimiter = detectDelimiter(rawText);
  let parsedRows = delimiter
    ? parseDelimitedText(rawText, delimiter)
    : rawText.split(/\r?\n/).map((line) => [line]);

  parsedRows = parsedRows
    .map((row) => row.map((cell) => String(cell || "").trim()))
    .filter((row) => row.some((cell) => cell !== ""));

  const useHeader = options.useHeader ?? detectHeader(parsedRows);
  const headerRow = useHeader ? parsedRows[0] || [] : [];
  const dataRows = useHeader ? parsedRows.slice(1) : parsedRows;
  const normalizedHeaders = headerRow.length
    ? headerRow
    : dataRows[0]?.map((_, index) => `Column ${index + 1}`) || [];
  const sourceColumnIndex = options.sourceColumnIndex ?? pickSourceColumn(normalizedHeaders);

  return {
    delimiter: delimiter || "line list",
    parsedRows,
    useHeader,
    headers: normalizedHeaders,
    dataRows,
    sourceColumnIndex,
  };
}

function buildDisavowText(analysis, options = {}) {
  const outputMode = options.outputMode || "domain";
  const stripWww = options.stripWww ?? true;
  const includeComments = options.includeComments ?? true;
  const sourceColumnIndex = options.sourceColumnIndex ?? analysis.sourceColumnIndex ?? 0;

  const lines = [];
  const ignored = [];
  const preview = [];
  const dedupe = new Set();

  for (const row of analysis.dataRows) {
    const rawValue = String(row[sourceColumnIndex] || "").trim();
    if (!rawValue) {
      ignored.push({ value: rawValue, reason: "Blank row" });
      continue;
    }

    let outputValue = null;
    if (outputMode === "url") {
      outputValue = normalizeExactUrl(rawValue);
    } else {
      const normalizedDomain = normalizeDomain(rawValue, stripWww);
      outputValue = normalizedDomain ? `domain:${normalizedDomain}` : null;
    }

    if (!outputValue) {
      const reason = outputMode === "url"
        ? "Exact URL mode only accepts full URLs or domain/path values"
        : "Could not recognize URL or domain";
      ignored.push({ value: rawValue, reason });
      continue;
    }

    if (dedupe.has(outputValue)) {
      continue;
    }

    dedupe.add(outputValue);
    lines.push(outputValue);
    preview.push({
      source: rawValue,
      output: outputValue,
      row,
    });
  }

  const header = [];
  if (includeComments) {
    const modeLabel = outputMode === "domain" ? "domain directives" : "exact URLs";
    header.push(`# Disavow file generated by Disavow File Builder`);
    header.push(`# ${lines.length} unique entries prepared as ${modeLabel}`);
    header.push(`# Review before submission in Google Search Console`);
    header.push("");
  }

  return {
    text: [...header, ...lines].join("\n"),
    lines,
    ignored,
    preview,
  };
}

function formatDelimiterLabel(delimiter) {
  if (delimiter === "\t") {
    return "TSV / tab-separated";
  }
  if (delimiter === ",") {
    return "CSV / comma-separated";
  }
  if (delimiter === ";") {
    return "Semicolon-separated";
  }
  if (delimiter === "|") {
    return "Pipe-separated";
  }
  return "One value per line";
}

function renderTable(analysis, result) {
  const previewHead = document.querySelector("#preview-head");
  const previewBody = document.querySelector("#preview-body");
  const previewMeta = document.querySelector("#preview-meta");

  if (!analysis || !result) {
    previewHead.innerHTML = "";
    previewBody.innerHTML = "<tr><td class=\"empty-state\">Your parsed rows will appear here.</td></tr>";
    previewMeta.textContent = "No preview yet";
    return;
  }

  const columns = analysis.headers.length
    ? analysis.headers
    : analysis.dataRows[0]?.map((_, index) => `Column ${index + 1}`) || [];

  previewHead.innerHTML = `
    <tr>
      ${columns.slice(0, 4).map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}
      <th>Output</th>
    </tr>
  `;

  const rows = result.preview.slice(0, 12);
  if (!rows.length) {
    previewBody.innerHTML = "<tr><td class=\"empty-state\" colspan=\"5\">No valid rows detected yet.</td></tr>";
    previewMeta.textContent = "0 valid rows";
    return;
  }

  previewBody.innerHTML = rows.map((item) => {
    const visibleCells = item.row.slice(0, 4)
      .map((cell) => `<td>${escapeHtml(cell || "")}</td>`)
      .join("");
    return `<tr>${visibleCells}<td>${escapeHtml(item.output)}</td></tr>`;
  }).join("");

  previewMeta.textContent = `${result.preview.length} valid rows, showing ${rows.length}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyWorkbookSheet(index) {
  const sheet = state.workbookSheets[index];
  if (!sheet) {
    state.rawText = "";
    state.workbookSheetName = "";
    return;
  }

  state.selectedSheetIndex = index;
  state.workbookSheetName = sheet.name;
  state.rawText = sheet.text;
  state.useHeader = detectHeader(parseDelimitedText(state.rawText, detectDelimiter(state.rawText) || "\t"));
  state.sourceColumnIndex = null;
  const hasHeader = document.querySelector("#has-header");
  if (hasHeader) {
    hasHeader.checked = state.useHeader;
  }
}

function refresh() {
  const outputEl = document.querySelector("#output");
  const summaryEl = document.querySelector("#summary");
  const sheetSelectEl = document.querySelector("#sheet-select");
  const sourceColumnEl = document.querySelector("#source-column");
  const detectedFormatEl = document.querySelector("#detected-format");
  const statusPillEl = document.querySelector("#status-pill");
  const copyButton = document.querySelector("#copy-output");
  const downloadButton = document.querySelector("#download-output");
  const textInput = document.querySelector("#text-input");
  const modeLabel = state.outputMode === "url" ? "Exact URL" : "Domain";

  if (!state.rawText.trim()) {
    outputEl.textContent = "The generated disavow text will appear here.";
    summaryEl.textContent = state.errorMessage || "Load an export to see detected columns, valid rows, and ignored lines.";
    detectedFormatEl.value = state.fileName ? `Could not parse ${state.fileName}` : "No file loaded";
    setStatusPill(statusPillEl, state.errorMessage ? "Could not read file" : "Waiting for data", state.errorMessage ? "is-error" : "is-idle");
    sheetSelectEl.disabled = true;
    sheetSelectEl.innerHTML = "<option>No workbook loaded</option>";
    sourceColumnEl.disabled = true;
    copyButton.disabled = true;
    downloadButton.disabled = true;
    if (state.errorMessage) {
      textInput.setAttribute("aria-invalid", "true");
    } else {
      textInput.removeAttribute("aria-invalid");
    }
    updateDashboard({
      rows: 0,
      valid: 0,
      ignored: 0,
      modeLabel,
      heroNote: state.errorMessage || "Drop a backlink export or paste links to begin.",
      helperText: state.errorMessage ? "Import error" : "Awaiting import",
      fileText: state.fileName || "No file selected yet",
      outputNote: state.outputMode === "url"
        ? "Exact URL mode exports only valid URL lines. Bare domains are intentionally ignored."
        : "Domain mode generates `domain:example.com` directives for Search Console submissions.",
    });
    renderTable(null, null);
    return;
  }

  state.errorMessage = "";
  textInput.removeAttribute("aria-invalid");

  const analysis = analyzeRows(state.rawText, {
    useHeader: state.useHeader,
    sourceColumnIndex: state.sourceColumnIndex,
  });

  state.parsedRows = analysis.parsedRows;
  state.delimiter = analysis.delimiter;

  if (state.workbookSheets.length) {
    sheetSelectEl.disabled = false;
    sheetSelectEl.innerHTML = state.workbookSheets
      .map((sheet, index) => {
        const selected = index === state.selectedSheetIndex ? "selected" : "";
        const summary = `${sheet.name} (${sheet.rowCount} rows)`;
        return `<option value="${index}" ${selected}>${escapeHtml(summary)}</option>`;
      })
      .join("");
  } else {
    sheetSelectEl.disabled = true;
    sheetSelectEl.innerHTML = "<option>No workbook loaded</option>";
  }

  sourceColumnEl.disabled = false;
  sourceColumnEl.innerHTML = analysis.headers
    .map((header, index) => {
      const selected = index === analysis.sourceColumnIndex ? "selected" : "";
      return `<option value="${index}" ${selected}>${escapeHtml(header)}</option>`;
    })
    .join("");

  const result = buildDisavowText(analysis, {
    outputMode: state.outputMode,
    stripWww: state.stripWww,
    includeComments: state.includeComments,
    sourceColumnIndex: Number(sourceColumnEl.value || analysis.sourceColumnIndex),
  });

  state.result = result;
  outputEl.textContent = result.text || "No valid entries were produced.";
  const originBits = [
    formatDelimiterLabel(analysis.delimiter),
    state.workbookSheetName ? `sheet ${state.workbookSheetName}` : "",
    state.fileName ? `from ${state.fileName}` : "",
  ].filter(Boolean);
  detectedFormatEl.value = originBits.join(" ");
  setStatusPill(statusPillEl, result.lines.length ? "Ready to export" : "Needs review", result.lines.length ? "is-ready" : "is-idle");
  summaryEl.innerHTML = [
    `<strong>${result.lines.length}</strong> unique disavow lines prepared.`,
    `<strong>${result.ignored.length}</strong> rows ignored.`,
    state.workbookSheetName ? `Reading <strong>${escapeHtml(state.workbookSheetName)}</strong>.` : "",
    `Using <strong>${escapeHtml(analysis.headers[Number(sourceColumnEl.value) || 0] || "Column 1")}</strong> as the source column.`,
  ].join(" ");

  updateDashboard({
    rows: analysis.dataRows.length,
    valid: result.lines.length,
    ignored: result.ignored.length,
    modeLabel,
    heroNote: state.workbookSheetName
      ? `Working from the ${state.workbookSheetName} sheet in ${state.fileName}.`
      : state.fileName
        ? `Processing ${state.fileName} and preparing a ${modeLabel.toLowerCase()} disavow list.`
        : "Using pasted rows as the current input source.",
    helperText: state.workbookSheets.length
      ? `${state.workbookSheets.length} workbook sheets detected`
      : state.fileName === "pasted-data.txt"
        ? "Using pasted rows"
        : "Flat file loaded",
    fileText: state.fileName || "No file selected yet",
    outputNote: state.outputMode === "url"
      ? "Exact URL mode keeps only valid URLs such as `https://site.com/spam-page`. Bare domains are ignored on purpose."
      : "Domain mode exports entries like `domain:example.com`, which is the usual format for sitewide disavow directives.",
  });

  copyButton.disabled = result.lines.length === 0;
  downloadButton.disabled = result.lines.length === 0;
  renderTable(analysis, result);
}

function applyPastedText(rawValue) {
  state.rawText = rawValue;
  state.fileName = rawValue.trim() ? "pasted-data.txt" : "";
  state.workbookSheetName = "";
  state.workbookSheets = [];
  state.selectedSheetIndex = 0;
  state.errorMessage = "";

  if (!rawValue.trim()) {
    state.parsedRows = [];
    state.result = null;
    refresh();
    return;
  }

  state.useHeader = detectHeader(parseDelimitedText(state.rawText, detectDelimiter(state.rawText) || ","));
  state.sourceColumnIndex = null;
  const hasHeader = document.querySelector("#has-header");
  if (hasHeader) {
    hasHeader.checked = state.useHeader;
  }
  refresh();
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      if (isExcelFile(file)) {
        const parsedWorkbook = parseExcelBuffer(reader.result);
        state.workbookSheets = parsedWorkbook.sheets;
        applyWorkbookSheet(parsedWorkbook.selectedSheetIndex);
      } else {
        state.rawText = String(reader.result || "");
        state.workbookSheetName = "";
        state.workbookSheets = [];
        state.selectedSheetIndex = 0;
      }

      state.fileName = file.name;
      state.errorMessage = "";
      if (!isExcelFile(file)) {
        state.useHeader = detectHeader(parseDelimitedText(state.rawText, detectDelimiter(state.rawText) || "\t"));
        state.sourceColumnIndex = null;
        document.querySelector("#has-header").checked = state.useHeader;
      }
      refresh();
    } catch (error) {
      state.rawText = "";
      state.fileName = file.name;
      state.workbookSheetName = "";
      state.workbookSheets = [];
      state.selectedSheetIndex = 0;
      state.errorMessage = String(error.message || error);
      refresh();
    }
  };

  if (isExcelFile(file)) {
    reader.readAsArrayBuffer(file);
    return;
  }

  reader.readAsText(file);
}

function downloadOutput() {
  if (!state.result?.text) {
    return;
  }

  const blob = new Blob([state.result.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.fileName
    ? `${state.fileName.replace(/\.[^.]+$/, "")}-disavow.txt`
    : "disavow.txt";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function copyOutput() {
  if (!state.result?.text) {
    return;
  }

  await navigator.clipboard.writeText(state.result.text);
  const copyButton = document.querySelector("#copy-output");
  const previous = copyButton.textContent;
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = previous;
  }, 1600);
}

function init() {
  const fileInput = document.querySelector("#file-input");
  const textInput = document.querySelector("#text-input");
  const loadTextButton = document.querySelector("#load-text");
  const hasHeader = document.querySelector("#has-header");
  const stripWww = document.querySelector("#strip-www");
  const includeComments = document.querySelector("#include-comments");
  const outputMode = document.querySelector("#output-mode");
  const sheetSelect = document.querySelector("#sheet-select");
  const sourceColumn = document.querySelector("#source-column");
  const downloadButton = document.querySelector("#download-output");
  const copyButton = document.querySelector("#copy-output");
  const dropzone = document.querySelector("#dropzone");
  let pasteUpdateTimer = null;

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      readFile(file);
    }
  });

  loadTextButton.addEventListener("click", () => {
    applyPastedText(textInput.value);
  });

  textInput.addEventListener("input", () => {
    if (pasteUpdateTimer) {
      window.clearTimeout(pasteUpdateTimer);
    }
    pasteUpdateTimer = window.setTimeout(() => {
      applyPastedText(textInput.value);
    }, 120);
  });

  hasHeader.addEventListener("change", (event) => {
    state.useHeader = event.target.checked;
    refresh();
  });

  stripWww.addEventListener("change", (event) => {
    state.stripWww = event.target.checked;
    refresh();
  });

  includeComments.addEventListener("change", (event) => {
    state.includeComments = event.target.checked;
    refresh();
  });

  outputMode.addEventListener("change", (event) => {
    state.outputMode = event.target.value;
    refresh();
  });

  sheetSelect.addEventListener("change", (event) => {
    applyWorkbookSheet(Number(event.target.value));
    refresh();
  });

  sourceColumn.addEventListener("change", (event) => {
    state.sourceColumnIndex = Number(event.target.value);
    refresh();
  });

  downloadButton.addEventListener("click", downloadOutput);
  copyButton.addEventListener("click", () => {
    copyOutput().catch(() => {
      const output = document.querySelector("#output");
      output.focus();
    });
  });

  ["dragenter", "dragover"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((type) => {
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      fileInput.files = event.dataTransfer.files;
      readFile(file);
    }
  });

  refresh();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.disavowApp = {
    analyzeRows,
    buildDisavowText,
    normalizeDomain,
    normalizeUrl,
  };
  init();
}
