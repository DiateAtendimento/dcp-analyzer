const MAX_FILES = 10;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const btnPick = document.getElementById("btnPick");

const btnTheme = document.getElementById("btnTheme");

const btnNewAnalysis = document.getElementById("btnNewAnalysis");
const btnAnalyze = document.getElementById("btnAnalyze");

const fileList = document.getElementById("fileList");
const resultsEl = document.getElementById("results");
const countLabel = document.getElementById("countLabel");

const analyzeModalEl = document.getElementById("analyzeModal");
const progressText = document.getElementById("progressText");
const btnCancel = document.getElementById("btnCancel");

let files = [];
let abortController = null;

// ---- Tema (persistente) ----
function applyTheme(theme) {
  document.documentElement.setAttribute("data-bs-theme", theme);

  const isDark = theme === "dark";
  if (btnTheme) {
    btnTheme.textContent = isDark ? "☀️ Tema claro" : "🌙 Tema escuro";
    btnTheme.classList.toggle("btn-outline-light", isDark);
    btnTheme.classList.toggle("btn-outline-secondary", !isDark);
  }

  localStorage.setItem("dcp_theme", theme);
}

function initTheme() {
  const saved = localStorage.getItem("dcp_theme");
  if (saved === "light" || saved === "dark") {
    applyTheme(saved);
    return;
  }

  const prefersDark =
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  applyTheme(prefersDark ? "dark" : "light");
}

// Lottie (troque por JSON seu depois)
let lottieInstance = null;
function startLottie() {
  const container = document.getElementById("lottie");
  container.innerHTML = "";
  lottieInstance = lottie.loadAnimation({
    container,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "https://assets10.lottiefiles.com/packages/lf20_j1adxtyb.json"
  });
}
function stopLottie() {
  if (lottieInstance) {
    lottieInstance.destroy();
    lottieInstance = null;
  }
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resetAll() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  files = [];
  fileList.innerHTML = "";
  resultsEl.innerHTML = "";
  countLabel.textContent = "0";

  btnAnalyze.disabled = true;
  btnNewAnalysis.classList.add("d-none");

  fileInput.value = "";
}

function refreshUI() {
  countLabel.textContent = String(files.length);
  btnAnalyze.disabled = files.length === 0;

  if (files.length === 0) {
    btnNewAnalysis.classList.add("d-none");
    resultsEl.innerHTML = "";
  }

  fileList.innerHTML = "";
  files.forEach((f, idx) => {
    const chip = document.createElement("div");
    chip.className = "file-chip";
    chip.innerHTML = `
      <div class="file-icon">PDF</div>
      <div class="file-meta">
        <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
        <div class="file-sub">${formatBytes(f.size)}</div>
      </div>
      <button class="icon-btn" title="Remover" aria-label="Remover">✕</button>
    `;
    chip.querySelector("button").addEventListener("click", () => {
      files.splice(idx, 1);
      refreshUI();
    });
    fileList.appendChild(chip);
  });
}

function addFiles(newFiles) {
  resultsEl.innerHTML = "";
  btnNewAnalysis.classList.add("d-none");

  const pdfs = [...newFiles].filter(f =>
    f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
  );
  if (pdfs.length === 0) return;

  const remaining = MAX_FILES - files.length;
  const toAdd = pdfs.slice(0, remaining);

  files = files.concat(toAdd);
  refreshUI();
}

// Drag & drop
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

// Picker
btnPick.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) addFiles(fileInput.files);
  fileInput.value = "";
});

// Modal
const bsModal = new bootstrap.Modal(analyzeModalEl, { backdrop: "static", keyboard: false });

btnCancel.addEventListener("click", () => {
  if (abortController) abortController.abort();
  progressText.textContent = "Cancelando…";
});

// Nova análise
btnNewAnalysis.addEventListener("click", () => resetAll());

// Tema
initTheme();
btnTheme?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-bs-theme") || "light";
  applyTheme(current === "dark" ? "light" : "dark");
});

// ✅ Ano como coluna / Competência como linhas
function renderResultCard(item) {
  const card = document.createElement("div");
  card.className = "result-card";

  const agreement = item.agreementNumber || "Não identificado";
  const compCount = item.rawCompetencies?.length ?? 0;
  const yearKeys = Object.keys(item.years || {}).sort();

  card.innerHTML = `
    <div class="result-header">
      <div>
        <h6 class="result-title mb-0">${escapeHtml(agreement)}</h6>
        <p class="result-sub">Arquivo: ${escapeHtml(item.fileName)} • Competências encontradas: ${compCount}</p>
      </div>
      <span class="badge text-bg-secondary">DCP</span>
    </div>

    <div class="mt-3">
      ${
        yearKeys.length === 0
          ? `<div class="text-muted small">Nenhuma competência válida (01..13 / ano) foi identificada nesse PDF.</div>`
          : `
          <div class="table-responsive">
            <table class="table table-sm align-middle dcp-table mb-0">
              <thead>
                <tr>
                  <th class="sticky-col text-start">Competência</th>
                  ${yearKeys.map(y => `<th>${escapeHtml(y)}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 13 }, (_, i) => {
                  const mm = String(i + 1).padStart(2, "0");
                  return `
                    <tr>
                      <td class="sticky-col text-start fw-semibold">${mm}</td>
                      ${yearKeys.map(year => {
                        const key = `${mm}/${year}`;
                        const present = item.years?.[year]?.present || [];
                        const ok = present.includes(key);
                        return `
                          <td>
                            <span class="${ok ? "badge-ok" : "badge-x"}" title="${ok ? "Presente" : "Faltando"}">
                              ${ok ? "✓" : "✕"}
                            </span>
                          </td>
                        `;
                      }).join("")}
                    </tr>
                  `;
                }).join("")}

                <tr class="summary-row">
                  <td class="sticky-col text-start text-muted small">Faltantes</td>
                  ${yearKeys.map(year => {
                    const missing = item.years?.[year]?.missing || [];
                    const complete = item.years?.[year]?.complete;
                    return `<td class="text-muted small">${complete ? "0" : String(missing.length)}</td>`;
                  }).join("")}
                </tr>
              </tbody>
            </table>
          </div>
          `
      }
    </div>
  `;

  return card;
}

// Analyze
btnAnalyze.addEventListener("click", async () => {
  resultsEl.innerHTML = "";
  btnNewAnalysis.classList.add("d-none");
  abortController = new AbortController();

  progressText.textContent = `Enviando ${files.length} arquivo(s)…`;
  startLottie();
  bsModal.show();

  try {
    const fd = new FormData();
    files.forEach(f => fd.append("pdfs", f, f.name));

    const apiBase = window.DCP_API_URL?.replace(/\/$/, "");
    if (!apiBase) throw new Error("DCP_API_URL não configurada.");

    const res = await fetch(`${apiBase}/api/analyze-dcps`, {
      method: "POST",
      body: fd,
      signal: abortController.signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Erro na API (${res.status}): ${txt || "sem detalhes"}`);
    }

    const data = await res.json();
    const items = data?.items ?? [];
    items.forEach(item => resultsEl.appendChild(renderResultCard(item)));

  } catch (err) {
    if (err.name === "AbortError") {
      const warn = document.createElement("div");
      warn.className = "alert alert-warning";
      warn.textContent = "Análise cancelada pelo usuário.";
      resultsEl.prepend(warn);
    } else {
      const alert = document.createElement("div");
      alert.className = "alert alert-danger";
      alert.textContent = `Falha ao analisar: ${err.message}`;
      resultsEl.prepend(alert);
    }
  } finally {
    stopLottie();
    bsModal.hide();
    abortController = null;

    btnNewAnalysis.classList.remove("d-none");
  }
});

refreshUI();
