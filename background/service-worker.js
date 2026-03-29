const STORAGE_PREFIX = "cd::";
const INDEX_KEY = "cd::__index";
const CONFIG_KEY = "config::registryUrl";
const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/samjahanirad/CD-List/main/index.json";

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case "FETCH_REGISTRY":
      return fetchRegistry(message.url);
    case "GET_REGISTRY_URL":
      return getRegistryUrl();
    case "INSTALL_CD":
      return installCD(message.meta, message.rawUrl);
    case "UNINSTALL_CD":
      return uninstallCD(message.id);
    case "GET_INSTALLED":
      return getInstalled();
    case "RUN_GET_DATA":
      return runGetData(message.cdId);
    case "RUN_CD":
      return runCD(message.cdId, message.data);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

// ─── Registry ────────────────────────────────────────────────────────────────

async function getRegistryUrl() {
  const { [CONFIG_KEY]: stored } = await chrome.storage.local.get(CONFIG_KEY);
  return { url: stored || DEFAULT_REGISTRY_URL };
}

async function fetchRegistry(url) {
  const { [CONFIG_KEY]: storedUrl } = await chrome.storage.local.get(CONFIG_KEY);
  const registryUrl = url || storedUrl || DEFAULT_REGISTRY_URL;

  const res = await fetch(registryUrl);
  if (!res.ok) throw new Error(`Failed to fetch registry (${res.status})`);
  const items = await res.json();

  // Persist the URL that was used
  await chrome.storage.local.set({ [CONFIG_KEY]: registryUrl });

  return { items };
}

// ─── Install / Uninstall ─────────────────────────────────────────────────────

async function installCD(meta, rawUrl) {
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error(`Failed to download CD (${res.status})`);
  const code = await res.text();

  await chrome.storage.local.set({ [`${STORAGE_PREFIX}${meta.id}`]: code });

  const { [INDEX_KEY]: index = [] } = await chrome.storage.local.get(INDEX_KEY);
  const updated = index.filter((m) => m.id !== meta.id).concat(meta);
  await chrome.storage.local.set({ [INDEX_KEY]: updated });

  return { success: true };
}

async function uninstallCD(id) {
  await chrome.storage.local.remove(`${STORAGE_PREFIX}${id}`);
  const { [INDEX_KEY]: index = [] } = await chrome.storage.local.get(INDEX_KEY);
  await chrome.storage.local.set({ [INDEX_KEY]: index.filter((m) => m.id !== id) });
  return { success: true };
}

async function getInstalled() {
  const { [INDEX_KEY]: index = [] } = await chrome.storage.local.get(INDEX_KEY);
  return { items: index };
}

// ─── CD Execution ─────────────────────────────────────────────────────────────

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found.");
  return tab;
}

async function getCDCode(id) {
  const key = `${STORAGE_PREFIX}${id}`;
  const result = await chrome.storage.local.get(key);
  const code = result[key];
  if (!code) throw new Error(`CD "${id}" is not installed.`);
  return code;
}

// CD convention: DataCollector(currentUrl, context) and Run(data)
// Wraps result in {ok, data/error} so executeScript never returns null.
// Handles both sync and async implementations.

const INJECT_GET_DATA = (cdSource) => {
  try {
    const fn = new Function(cdSource + "\nreturn DataCollector(window.location.href, {});");
    const result = fn();
    if (result && typeof result.then === "function") {
      return result.then(
        (data) => ({ ok: true, data }),
        (err) => ({ ok: false, error: err.message || String(err) })
      );
    }
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
};

const INJECT_RUN_CD = (cdSource, inputData) => {
  try {
    const fn = new Function("data", cdSource + "\nreturn Run(data);");
    const result = fn(inputData);
    if (result && typeof result.then === "function") {
      return result.then(
        (data) => ({ ok: true, data }),
        (err) => ({ ok: false, error: err.message || String(err) })
      );
    }
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
};

async function runGetData(cdId) {
  const tab = await getActiveTab();
  const code = await getCDCode(cdId);

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: INJECT_GET_DATA,
    args: [code],
    world: "MAIN"
  });

  if (injection.error) throw new Error(String(injection.error));
  if (!injection.result?.ok) throw new Error(injection.result?.error || "DataCollector() failed");
  return { data: injection.result.data };
}

async function runCD(cdId, data) {
  const tab = await getActiveTab();
  const code = await getCDCode(cdId);

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: INJECT_RUN_CD,
    args: [code, data],
    world: "MAIN"
  });

  if (injection.error) throw new Error(String(injection.error));
  if (!injection.result?.ok) throw new Error(injection.result?.error || "runCD() failed");

  const result = injection.result.data;

  if (result?.action === "download") {
    // Support both { url, filename } and { download: { url, filename } } formats
    const dl = result.download || result;
    await chrome.downloads.download({ url: dl.url, filename: dl.filename });
    return { success: true, message: result.message || `Downloading: ${dl.filename}` };
  }

  if (result?.action === "copy") {
    return { success: true, message: result.message || "Copied to clipboard." };
  }

  return { success: true, message: result?.message || "Done.", data: result };
}
