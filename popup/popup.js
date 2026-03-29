// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

// ─── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.tab).classList.remove("hidden");

    if (tab.dataset.tab === "my-cds") loadMyCDs();
    if (tab.dataset.tab === "discover") loadDiscoverFromRegistry();
  });
});

// ─── Discover Tab ──────────────────────────────────────────────────────────────

async function loadDiscoverFromRegistry(overrideUrl = null) {
  const list = document.getElementById("registry-list");
  list.innerHTML = '<div class="loading-text">Fetching registry…</div>';

  try {
    const res = await send("FETCH_REGISTRY", { url: overrideUrl || undefined });
    if (res.error) throw new Error(res.error);

    const { items: installed = [] } = await send("GET_INSTALLED");
    const installedIds = new Set(installed.map((m) => m.id));

    const term = document.getElementById("search-input").value.toLowerCase();
    const filtered = term
      ? res.items.filter(
          (cd) =>
            cd.name.toLowerCase().includes(term) ||
            (cd.description || "").toLowerCase().includes(term) ||
            cd.id.toLowerCase().includes(term)
        )
      : res.items;

    list.innerHTML = "";
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty">No CDs found in registry.</div>';
      return;
    }

    filtered.forEach((cd) => list.appendChild(createDiscoverCard(cd, installedIds.has(cd.id))));
  } catch (err) {
    list.innerHTML = `<div class="empty">Could not load registry.<br>${escHtml(err.message)}</div>`;
  }
}

function createDiscoverCard(cd, isInstalled) {
  const card = document.createElement("div");
  card.className = "cd-card";
  card.innerHTML = `
    <div class="cd-card-top">
      <div class="cd-info">
        <div class="cd-name">${escHtml(cd.name)}</div>
        <div class="cd-meta">${escHtml(cd.id)} · v${escHtml(cd.version || "1.0.0")}</div>
        <div class="cd-desc">${escHtml(cd.description || "")}</div>
      </div>
      <div class="cd-card-btns">
        <button class="btn-install ${isInstalled ? "installed" : ""}" ${isInstalled ? "disabled" : ""}>
          ${isInstalled ? "Installed" : "Install"}
        </button>
        ${isInstalled ? `<button class="btn-remove-discover" title="Remove">×</button>` : ""}
      </div>
    </div>
  `;

  const installBtn = card.querySelector(".btn-install");

  if (!isInstalled) {
    installBtn.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.textContent = "Installing…";
      btn.disabled = true;

      try {
        const res = await send("INSTALL_CD", { meta: cd, rawUrl: cd.rawUrl });
        if (res.error) throw new Error(res.error);
        btn.textContent = "Installed";
        btn.classList.add("installed");
        // Add remove button after install
        const removeBtn = document.createElement("button");
        removeBtn.className = "btn-remove-discover";
        removeBtn.title = "Remove";
        removeBtn.textContent = "×";
        btn.insertAdjacentElement("afterend", removeBtn);
        attachRemoveHandler(removeBtn, cd, btn);
      } catch (err) {
        btn.textContent = "Failed";
        btn.disabled = false;
        console.error(err);
      }
    });
  } else {
    attachRemoveHandler(card.querySelector(".btn-remove-discover"), cd, installBtn);
  }

  return card;
}

function attachRemoveHandler(removeBtn, cd, installBtn) {
  removeBtn.addEventListener("click", async () => {
    removeBtn.disabled = true;
    const res = await send("UNINSTALL_CD", { id: cd.id });
    if (res.error) { removeBtn.disabled = false; return; }
    removeBtn.remove();
    installBtn.textContent = "Install";
    installBtn.classList.remove("installed");
    installBtn.disabled = false;
  });
}

// ─── Registry controls ────────────────────────────────────────────────────────

document.getElementById("refresh-btn").addEventListener("click", () => {
  const url = document.getElementById("registry-url").value.trim() || undefined;
  loadDiscoverFromRegistry(url || null);
});

document.getElementById("search-btn").addEventListener("click", () => {
  loadDiscoverFromRegistry();
});

document.getElementById("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadDiscoverFromRegistry();
});

// ─── My CDs Tab ───────────────────────────────────────────────────────────────

async function loadMyCDs() {
  const list = document.getElementById("installed-list");
  list.innerHTML = '<div class="loading-text">Loading…</div>';

  const { items: installed = [] } = await send("GET_INSTALLED");

  list.innerHTML = "";
  if (installed.length === 0) {
    list.innerHTML =
      '<div class="empty">No CDs installed yet.<br>Go to Discover to add some.</div>';
    return;
  }

  installed.forEach((meta) => list.appendChild(createMyCDCard(meta)));
}

function createMyCDCard(meta) {
  const card = document.createElement("div");
  card.className = "cd-card";
  card.innerHTML = `
    <div class="cd-card-top">
      <div class="cd-info">
        <div class="cd-name">${escHtml(meta.name)}</div>
        <div class="cd-meta">${escHtml(meta.id)} · v${escHtml(meta.version || "1.0.0")}</div>
        <div class="cd-desc">${escHtml(meta.description || "")}</div>
      </div>
      <button class="btn-remove" title="Uninstall">×</button>
    </div>
    <div class="cd-actions">
      <button class="btn-get-data">Get Data</button>
      <button class="btn-run-cd" disabled>Run CD</button>
    </div>
  `;

  const statusEl = document.createElement("div");
  statusEl.className = "cd-status";
  card.appendChild(statusEl);

  let fetchedData = null;

  const getDataBtn = card.querySelector(".btn-get-data");
  const runCDBtn = card.querySelector(".btn-run-cd");
  const removeBtn = card.querySelector(".btn-remove");

  getDataBtn.addEventListener("click", async () => {
    setStatus(statusEl, "loading", "Getting data…");
    getDataBtn.disabled = true;

    try {
      const res = await send("RUN_GET_DATA", { cdId: meta.id });
      if (res.error) throw new Error(res.error);

      fetchedData = res.data;
      setStatus(statusEl, "success", "Data ready:\n" + JSON.stringify(res.data, null, 2));
      runCDBtn.disabled = false;
    } catch (err) {
      setStatus(statusEl, "error", err.message);
    } finally {
      getDataBtn.disabled = false;
    }
  });

  runCDBtn.addEventListener("click", async () => {
    setStatus(statusEl, "loading", "Running…");
    runCDBtn.disabled = true;

    try {
      const res = await send("RUN_CD", { cdId: meta.id, data: fetchedData });
      if (res.error) throw new Error(res.error);
      setStatus(statusEl, "success", res.message || "Done.");
    } catch (err) {
      setStatus(statusEl, "error", err.message);
      runCDBtn.disabled = false;
    }
  });

  removeBtn.addEventListener("click", async () => {
    const res = await send("UNINSTALL_CD", { id: meta.id });
    if (res.error) { alert(res.error); return; }
    card.remove();
    const list = document.getElementById("installed-list");
    if (!list.querySelector(".cd-card")) {
      list.innerHTML =
        '<div class="empty">No CDs installed yet.<br>Go to Discover to add some.</div>';
    }
  });

  return card;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

function setStatus(el, type, text) {
  el.className = "cd-status " + type;
  el.textContent = text;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Pre-fill registry URL input from storage
  const { url } = await send("GET_REGISTRY_URL");
  if (url) document.getElementById("registry-url").value = url;

  loadDiscoverFromRegistry();
}

init();
