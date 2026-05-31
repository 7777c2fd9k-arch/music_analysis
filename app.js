const storageKey = "music-analysis-notes-v2";
const cloudTableName = "music_analysis_notes";
const audioDbName = "music-analysis-audio";
const audioStoreName = "audio-files";

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function closestElement(target, selector) {
  return target && target.nodeType === 1 && typeof target.closest === "function" ? target.closest(selector) : null;
}

const sampleEntries = [
  {
    id: createId(),
    title: "Night Cruising",
    artist: "Fishmans",
    bpm: "92",
    songKey: "E major",
    trackUrl: "",
    audioName: "",
    audioType: "",
    tags: ["dub", "minimal"],
    favorite: true,
    introKey: "",
    introChords: "",
    intro: "余白のある入り。音数は少ないが、残響で奥行きが作られている。",
    verseAKey: "",
    verseAChords: "",
    verseA: "低域の反復に声が乗る。メロディは大きく動かず、質感で聴かせる。",
    verseBKey: "",
    verseBChords: "",
    verseB: "明確なBメロというより、音の重なりとテンションで少しずつ景色が変わる。",
    chorusKey: "",
    chorusChords: "",
    chorus: "サビの爆発よりも、反復の中に広がりが出るタイプ。",
    notes: "構成の派手さではなく、同じ素材の鳴らし方で曲を進めている。自作でも展開を増やす前に音色と空間で変化を作ってみたい。",
    updatedAt: new Date().toISOString(),
  },
];

const state = {
  entries: loadEntries(),
  selectedId: null,
  filter: "all",
  tagFilter: "",
  query: "",
  view: "detail",
  sort: "songKey",
};

const fields = [
  "title",
  "artist",
  "bpm",
  "songKey",
  "trackUrl",
  "tags",
  "introKey",
  "introChords",
  "intro",
  "verseAKey",
  "verseAChords",
  "verseA",
  "verseBKey",
  "verseBChords",
  "verseB",
  "chorusKey",
  "chorusChords",
  "chorus",
  "notes",
];
const form = document.querySelector("#analysisForm");
const entryList = document.querySelector("#entryList");
const detailView = document.querySelector("#detailView");
const tableBody = document.querySelector("#analysisTableBody");
const tableWrap = document.querySelector(".table-wrap");
const analysisTable = document.querySelector(".analysis-table");
const tableZoom = document.querySelector("#tableZoom");
const zoomValue = document.querySelector("#zoomValue");
const tagFilterSelect = document.querySelector("#tagFilterSelect");
const audioFileInput = document.querySelector("#audioFile");
const audioFileName = document.querySelector("#audioFileName");
const removeAudioButton = document.querySelector("#removeAudioButton");
const syncStatus = document.querySelector("#syncStatus");
const syncLoginControls = document.querySelector("#syncLoginControls");
const syncUserControls = document.querySelector("#syncUserControls");
const syncEmail = document.querySelector("#syncEmail");
const syncUserEmail = document.querySelector("#syncUserEmail");
const syncPanel = document.querySelector(".sync-panel");
const syncToggleButton = document.querySelector("#syncToggleButton");
const canvas = document.querySelector("#fingerprintCanvas");
const ctx = canvas.getContext("2d");
let tableDrag = null;
let lastTouchActionAt = 0;
let supabaseClient = null;
let currentUser = null;
let cloudSaveTimer = null;
let entrySaveTimer = null;
let isCloudReady = false;
let audioDbPromise = null;
let currentAudioUrl = "";

function loadEntries() {
  const current = localStorage.getItem(storageKey);
  if (current) {
    try {
      const parsed = JSON.parse(current);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return sampleEntries;
    }
  }

  const legacy = localStorage.getItem("music-analysis-notes-v1");
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) return parsed.map(convertLegacyEntry);
    } catch {
      return sampleEntries;
    }
  }
  return sampleEntries;
}

function convertLegacyEntry(entry) {
  return {
    id: entry.id || createId(),
    title: entry.title || "",
    artist: entry.artist || "",
    bpm: entry.bpm || "",
    songKey: entry.songKey || entry.keyMode || "",
    trackUrl: entry.trackUrl || "",
    audioName: entry.audioName || "",
    audioType: entry.audioType || "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    favorite: Boolean(entry.favorite),
    introKey: entry.introKey || "",
    introChords: entry.introChords || "",
    intro: entry.intro || entry.structure || "",
    verseAKey: entry.verseAKey || "",
    verseAChords: entry.verseAChords || "",
    verseA: entry.verseA || entry.melody || "",
    verseBKey: entry.verseBKey || "",
    verseBChords: entry.verseBChords || "",
    verseB: entry.verseB || entry.harmony || "",
    chorusKey: entry.chorusKey || "",
    chorusChords: entry.chorusChords || "",
    chorus: entry.chorus || entry.rhythm || "",
    notes: entry.notes || [entry.lyrics, entry.production, entry.takeaways].filter(Boolean).join("\n\n"),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
}

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state.entries));
  queueCloudSave();
}

function getSupabaseConfig() {
  const config = window.MUSIC_ANALYSIS_SUPABASE || {};
  return {
    url: String(config.url || "").trim(),
    anonKey: String(config.anonKey || "").trim(),
  };
}

function openAudioDb() {
  if (audioDbPromise) return audioDbPromise;
  audioDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("このブラウザでは音源保存に対応していません。"));
      return;
    }
    const request = window.indexedDB.open(audioDbName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(audioStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return audioDbPromise;
}

async function putAudioFile(entryId, file) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(audioStoreName, "readwrite");
    tx.objectStore(audioStoreName).put(file, entryId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function getAudioFile(entryId) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(audioStoreName, "readonly").objectStore(audioStoreName).get(entryId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function deleteAudioFile(entryId) {
  const db = await openAudioDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(audioStoreName, "readwrite");
    tx.objectStore(audioStoreName).delete(entryId);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function getAuthRedirectUrl() {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function cleanAuthUrl() {
  if (!window.history || typeof window.history.replaceState !== "function") return;
  if (!window.location.search && !window.location.hash) return;
  window.history.replaceState({}, document.title, getAuthRedirectUrl());
}

function setSyncStatus(message) {
  syncStatus.textContent = message;
}

function updateSyncUi() {
  if (!isCloudReady) {
    syncPanel.classList.remove("is-signed-in", "is-open");
    syncToggleButton.classList.add("is-hidden");
    syncLoginControls.classList.add("is-hidden");
    syncUserControls.classList.add("is-hidden");
    setSyncStatus("未設定");
    return;
  }

  if (currentUser) {
    syncPanel.classList.add("is-signed-in");
    syncPanel.classList.remove("is-open");
    syncToggleButton.classList.remove("is-hidden");
    syncToggleButton.setAttribute("aria-expanded", "false");
    syncLoginControls.classList.add("is-hidden");
    syncUserControls.classList.remove("is-hidden");
    syncUserEmail.textContent = currentUser.email || "ログイン中";
    setSyncStatus("同期できます");
    return;
  }

  syncPanel.classList.remove("is-signed-in", "is-open");
  syncToggleButton.classList.add("is-hidden");
  syncLoginControls.classList.remove("is-hidden");
  syncUserControls.classList.add("is-hidden");
  setSyncStatus("未ログイン");
}

async function initCloudSync() {
  const config = getSupabaseConfig();
  if (!config.url || !config.anonKey || !window.supabase || typeof window.supabase.createClient !== "function") {
    isCloudReady = false;
    updateSyncUi();
    return;
  }

  isCloudReady = true;
  supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  const sessionResult = await supabaseClient.auth.getSession();
  currentUser = sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null;
  if (currentUser) cleanAuthUrl();
  updateSyncUi();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    if (currentUser) cleanAuthUrl();
    updateSyncUi();
    if (event === "SIGNED_IN") loadCloudEntries(true);
  });

  if (currentUser) loadCloudEntries(false);
}

async function sendLoginLink() {
  if (!supabaseClient) return;
  const email = syncEmail.value.trim();
  if (!email) {
    setSyncStatus("メールを入力");
    return;
  }

  setSyncStatus("送信中");
  const result = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href,
    },
  });

  setSyncStatus(result.error ? `送信失敗: ${result.error.message}` : "メールを確認");
}

async function signInWithGoogle() {
  if (!supabaseClient) return;
  setSyncStatus("Googleへ移動");
  const result = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectUrl(),
      queryParams: {
        prompt: "select_account",
      },
    },
  });
  if (result.error) setSyncStatus(`Google失敗: ${result.error.message}`);
}

async function signOutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  updateSyncUi();
}

async function attachAudioFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  if (!file.type.startsWith("audio/") && !file.name.toLowerCase().endsWith(".mp3")) {
    alert("音声ファイルを選んでください。");
    event.target.value = "";
    return;
  }

  window.clearTimeout(entrySaveTimer);
  saveCurrentEntry(false);
  const entry = getSelectedEntry();
  if (!entry) return;

  try {
    await putAudioFile(entry.id, file);
    entry.audioName = file.name;
    entry.audioType = file.type || "audio/mpeg";
    entry.updatedAt = new Date().toISOString();
    persist();
    render();
  } catch (error) {
    alert(error && error.message ? error.message : "音源を保存できませんでした。");
  }
}

async function removeAudioFile() {
  const entry = getSelectedEntry();
  if (!entry || !entry.audioName) return;
  if (!confirm("この曲の音源ファイルを削除しますか？")) return;
  try {
    await deleteAudioFile(entry.id);
  } catch {
    // Metadata is still cleared so the screen does not keep showing a broken player.
  }
  entry.audioName = "";
  entry.audioType = "";
  entry.updatedAt = new Date().toISOString();
  persist();
  render();
}

function queueCloudSave() {
  if (!supabaseClient || !currentUser) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(() => {
    saveCloudEntries(false);
  }, 900);
}

async function saveCloudEntries(showResult) {
  if (!supabaseClient || !currentUser) {
    if (showResult) setSyncStatus("未ログイン");
    return;
  }

  if (showResult) setSyncStatus("保存中");
  const result = await supabaseClient.from(cloudTableName).upsert({
    user_id: currentUser.id,
    entries: state.entries,
    updated_at: new Date().toISOString(),
  });

  setSyncStatus(result.error ? `保存失敗: ${result.error.message}` : "同期済み");
}

async function loadCloudEntries(confirmReplace) {
  if (!supabaseClient || !currentUser) {
    setSyncStatus("未ログイン");
    return;
  }

  setSyncStatus("読込中");
  const result = await supabaseClient.from(cloudTableName).select("entries, updated_at").eq("user_id", currentUser.id).maybeSingle();

  if (result.error) {
    setSyncStatus(`読込失敗: ${result.error.message}`);
    return;
  }

  if (!result.data || !Array.isArray(result.data.entries)) {
    await saveCloudEntries(false);
    setSyncStatus("初期同期済み");
    return;
  }

  const hasLocal = state.entries.length > 0;
  if (confirmReplace && hasLocal && !confirm("クラウドの内容でこの端末の分析を置き換えますか？")) {
    setSyncStatus("ローカル保持");
    return;
  }

  state.entries = result.data.entries.map(convertLegacyEntry);
  state.selectedId = state.entries[0] ? state.entries[0].id : null;
  localStorage.setItem(storageKey, JSON.stringify(state.entries));
  render();
  setSyncStatus("読込済み");
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value;
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getSelectedEntry() {
  return state.entries.find((entry) => entry.id === state.selectedId) || state.entries[0] || null;
}

function filteredEntries() {
  const query = state.query.trim().toLowerCase();
  const now = Date.now();
  return state.entries
    .filter((entry) => {
      if (state.filter === "favorite" && !entry.favorite) return false;
      if (state.filter === "recent") {
        const updated = new Date(entry.updatedAt || 0).getTime();
        if ((now - updated) / 86400000 > 14) return false;
      }
      if (state.tagFilter && !(entry.tags || []).includes(state.tagFilter)) return false;
      if (!query) return true;
      return [
        entry.title,
        entry.artist,
        entry.bpm,
        entry.songKey,
        entry.trackUrl,
        entry.introKey,
        entry.introChords,
        entry.intro,
        entry.verseAKey,
        entry.verseAChords,
        entry.verseA,
        entry.verseBKey,
        entry.verseBChords,
        entry.verseB,
        entry.chorusKey,
        entry.chorusChords,
        entry.chorus,
        entry.notes,
        ...(entry.tags || []),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
}

function sortedEntries(entries) {
  return [...entries].sort((a, b) => {
    if (state.sort === "bpm") return readNumber(a.bpm) - readNumber(b.bpm);
    if (state.sort === "updatedAt") return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    return readText(a[state.sort]).localeCompare(readText(b[state.sort]), "ja") || readText(a.title).localeCompare(readText(b.title), "ja");
  });
}

function readText(value) {
  return String(value || "未入力").trim().toLowerCase();
}

function readNumber(value) {
  const number = Number.parseFloat(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function render() {
  if (!state.selectedId && state.entries.length) state.selectedId = state.entries[0].id;
  const selected = getSelectedEntry();
  renderStats();
  renderTagFilter();
  renderList();
  renderTable();
  fillForm(selected);
  renderDetail(selected);
  drawSongMap(selected);
  renderViewMode();
}

function renderStats() {
  const tags = new Set(state.entries.flatMap((entry) => entry.tags || []));
  document.querySelector("#entryCount").textContent = state.entries.length;
  document.querySelector("#tagCount").textContent = tags.size;
}

function renderTagFilter() {
  const tags = [...new Set(state.entries.flatMap((entry) => entry.tags || []))].sort((a, b) => a.localeCompare(b, "ja"));
  if (state.tagFilter && !tags.includes(state.tagFilter)) state.tagFilter = "";
  tagFilterSelect.innerHTML = '<option value="">すべてのタグ</option>';
  tags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    option.selected = tag === state.tagFilter;
    tagFilterSelect.append(option);
  });
}

function renderList() {
  const entries = sortedEntries(filteredEntries());
  entryList.innerHTML = "";
  if (!entries.length) {
    entryList.innerHTML = '<div class="empty-state">条件に合う分析がありません。</div>';
    return;
  }

  entries.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `entry-card${entry.id === state.selectedId ? " is-selected" : ""}`;
    button.dataset.id = entry.id;
    const tags = (entry.tags || []).slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
    button.innerHTML = `
      <strong>${escapeHtml(entry.title || "無題")}</strong>
      <div class="entry-meta">
        <span>${escapeHtml(entry.artist || "Unknown")}</span>
        ${entry.bpm ? `<span>${escapeHtml(entry.bpm)} BPM</span>` : ""}
        ${entry.songKey ? `<span>${escapeHtml(entry.songKey)}</span>` : ""}
        ${entry.favorite ? "<span>重要</span>" : ""}
      </div>
      <div class="tag-list">${tags}</div>
    `;
    button.addEventListener("click", () => {
      state.selectedId = entry.id;
      render();
    });
    entryList.append(button);
  });
}

function renderTable() {
  const entries = sortedEntries(filteredEntries());
  tableBody.innerHTML = "";
  if (!entries.length) {
    tableBody.innerHTML = '<tr><td colspan="12" class="empty-state">条件に合う分析がありません。</td></tr>';
    return;
  }

  let currentGroup = "";
  entries.forEach((entry) => {
    const group = groupLabel(entry);
    if (group !== currentGroup && ["songKey", "title", "artist"].includes(state.sort)) {
      currentGroup = group;
      const groupRow = document.createElement("tr");
      groupRow.className = "group-row";
      groupRow.innerHTML = `<td colspan="12">${escapeHtml(group)}</td>`;
      tableBody.append(groupRow);
    }

    const row = document.createElement("tr");
    row.className = entry.id === state.selectedId ? "is-selected" : "";
    row.dataset.id = entry.id;
    row.innerHTML = `
      <td class="table-title">${escapeHtml(entry.title || "無題")}</td>
      <td>${escapeHtml(entry.artist || "Unknown")}</td>
      <td>${entry.bpm ? `${escapeHtml(entry.bpm)} BPM` : '<span class="muted-cell">未入力</span>'}</td>
      <td>${entry.songKey ? escapeHtml(entry.songKey) : '<span class="muted-cell">未入力</span>'}</td>
      <td class="table-url">${formatUrlCell(entry.trackUrl)}</td>
      <td>${formatTagsCell(entry.tags)}</td>
      <td class="table-note">${formatSectionCell(entry, "intro")}</td>
      <td class="table-note">${formatSectionCell(entry, "verseA")}</td>
      <td class="table-note">${formatSectionCell(entry, "verseB")}</td>
      <td class="table-note">${formatSectionCell(entry, "chorus")}</td>
      <td class="table-note">${formatCell(entry.notes)}</td>
      <td><button class="table-action" type="button" data-edit="${entry.id}">編集</button></td>
    `;
    tableBody.append(row);
  });
}

function groupLabel(entry) {
  if (state.sort === "songKey") return entry.songKey || "キー未入力";
  if (state.sort === "title") return entry.title || "曲名未入力";
  if (state.sort === "artist") return entry.artist || "アーティスト未入力";
  return "";
}

function formatTagsCell(tags) {
  if (!tags || !tags.length) return '<span class="muted-cell">未入力</span>';
  return `<div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`;
}

function formatSectionCell(entry, section) {
  const key = entry[`${section}Key`];
  const chords = entry[`${section}Chords`];
  const memo = entry[section];
  if (!key && !chords && !memo) return '<span class="muted-cell">未入力</span>';
  return `
    <div class="table-section-cell">
      ${key ? `<span><strong>キー</strong>${escapeHtml(key)}</span>` : ""}
      ${chords ? `<span><strong>コード</strong>${escapeHtml(chords)}</span>` : ""}
      ${memo ? `<p>${escapeHtml(memo)}</p>` : ""}
    </div>
  `;
}

function formatCell(value) {
  return value ? escapeHtml(value) : '<span class="muted-cell">未入力</span>';
}

function formatUrlCell(value) {
  if (!value) return '<span class="muted-cell">未入力</span>';
  const escaped = escapeHtml(value);
  return `<a href="${escaped}" target="_blank" rel="noreferrer">開く</a>`;
}

function renderViewMode() {
  document.querySelector("#detailMode").classList.toggle("is-hidden", state.view !== "detail");
  document.querySelector("#tableMode").classList.toggle("is-hidden", state.view !== "table");
  document.querySelector("#capoMode").classList.toggle("is-hidden", state.view !== "capo");
  document.querySelector(".table-tools").classList.toggle("is-hidden", state.view !== "table");
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  const selected = getSelectedEntry();
  document.querySelector("#workspaceTitle").textContent = state.view === "table" ? "分析表" : state.view === "capo" ? "早見表" : selected && selected.title ? selected.title : "分析を選ぶ";
}

function changeFilter(button) {
  state.filter = button.dataset.filter;
  document.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("is-active", chip === button));
  renderList();
  renderTable();
}

function changeView(view) {
  state.view = view;
  renderViewMode();
}

function changeSort(value) {
  state.sort = value;
  renderList();
  renderTable();
}

function setTableZoom(value) {
  const zoom = Math.min(130, Math.max(60, Number(value) || 100));
  tableZoom.value = zoom;
  zoomValue.textContent = `${zoom}%`;
  analysisTable.style.setProperty("--table-zoom", zoom / 100);
}

function moveTable(x, y) {
  tableWrap.scrollLeft += x;
  tableWrap.scrollTop += y;
}

function handleTableWheel(event) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const nextZoom = Number(tableZoom.value) + (event.deltaY > 0 ? -5 : 5);
    setTableZoom(nextZoom);
    return;
  }

  const hasHorizontalGesture = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (event.shiftKey || hasHorizontalGesture) {
    event.preventDefault();
    moveTable(event.shiftKey ? event.deltaY : event.deltaX, 0);
    return;
  }

  event.preventDefault();
  if (tableWrap.scrollHeight <= tableWrap.clientHeight && tableWrap.scrollWidth > tableWrap.clientWidth) {
    moveTable(event.deltaY, 0);
  } else {
    moveTable(0, event.deltaY);
  }
}

function startTableDrag(event) {
  if (event.pointerType && event.pointerType !== "mouse") return;
  if (event.button !== 0 || closestElement(event.target, "button, input, select, textarea")) return;
  tableDrag = {
    x: event.clientX,
    y: event.clientY,
    left: tableWrap.scrollLeft,
    top: tableWrap.scrollTop,
  };
  tableWrap.classList.add("is-dragging");
}

function dragTable(event) {
  if (!tableDrag) return;
  event.preventDefault();
  tableWrap.scrollLeft = tableDrag.left - (event.clientX - tableDrag.x);
  tableWrap.scrollTop = tableDrag.top - (event.clientY - tableDrag.y);
}

function stopTableDrag() {
  tableDrag = null;
  tableWrap.classList.remove("is-dragging");
}

function activateControl(event) {
  const control = closestElement(event.target, "button, .entry-card, label.icon-button");
  if (!control) return;
  control.classList.add("is-touching");
}

function deactivateControls() {
  document.querySelectorAll(".is-touching").forEach((control) => control.classList.remove("is-touching"));
}

function runTouchAction(event) {
  const target = event.target;
  const filterButton = closestElement(target, "[data-filter]");
  const viewButton = closestElement(target, "[data-view]");
  const tableEditButton = closestElement(target, "[data-edit]");
  const entryButton = closestElement(target, ".entry-card[data-id]");
  const ordinaryButton = closestElement(target, "button");
  const importLabel = closestElement(target, "#importInput, .import-action");

  if (importLabel) return;
  if (!filterButton && !viewButton && !tableEditButton && !entryButton && !ordinaryButton) return;

  event.preventDefault();
  lastTouchActionAt = Date.now();

  if (filterButton) {
    changeFilter(filterButton);
    return;
  }

  if (viewButton) {
    changeView(viewButton.dataset.view);
    return;
  }

  if (tableEditButton) {
    state.selectedId = tableEditButton.dataset.edit;
    state.view = "detail";
    render();
    return;
  }

  if (entryButton) {
    state.selectedId = entryButton.dataset.id;
    render();
    return;
  }

  if (!ordinaryButton) return;
  if (ordinaryButton.id === "newEntryButton") createEntry();
  if (ordinaryButton.id === "deleteButton") deleteSelected();
  if (ordinaryButton.id === "tableCsvExportButton") exportCsv();
  if (ordinaryButton.id === "exportButton") exportEntries();
  if (ordinaryButton.id === "removeAudioButton") removeAudioFile();
  if (ordinaryButton.id === "googleLoginButton") signInWithGoogle();
  if (ordinaryButton.id === "syncLoginButton") sendLoginLink();
  if (ordinaryButton.id === "cloudSaveButton") saveCloudEntries(true);
  if (ordinaryButton.id === "cloudLoadButton") loadCloudEntries(true);
  if (ordinaryButton.id === "syncLogoutButton") signOutCloud();
  if (ordinaryButton.id === "zoomOutButton") setTableZoom(Number(tableZoom.value) - 10);
  if (ordinaryButton.id === "zoomInButton") setTableZoom(Number(tableZoom.value) + 10);
  if (ordinaryButton.type === "submit") {
    if (typeof form.requestSubmit === "function") form.requestSubmit(ordinaryButton);
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }
}

function recentlyHandledTouch() {
  return Date.now() - lastTouchActionAt < 650;
}

function fillForm(entry) {
  document.querySelector("#entryId").value = entry && entry.id ? entry.id : "";
  document.querySelector("#favorite").checked = Boolean(entry && entry.favorite);
  document.querySelector("#deleteButton").disabled = !entry;
  audioFileInput.value = "";
  audioFileName.textContent = entry && entry.audioName ? entry.audioName : "未選択";
  removeAudioButton.disabled = !entry || !entry.audioName;

  fields.forEach((field) => {
    const input = document.querySelector(`#${field}`);
    input.value = field === "tags" ? (entry && entry.tags ? entry.tags : []).join(", ") : entry && entry[field] ? entry[field] : "";
  });
}

function renderDetail(entry) {
  if (!entry) {
    detailView.innerHTML = '<div class="empty-state">左の「新規分析」から最初の曲を登録できます。</div>';
    return;
  }

  const sections = [
    ["イントロ", "intro"],
    ["Aメロ", "verseA"],
    ["Bメロ", "verseB"],
    ["サビ", "chorus"],
  ]
    .map(([label, section]) => [label, renderSectionDetail(entry, section)])
    .filter(([, value]) => value)
    .map(([label, value]) => `
      <div class="detail-section">
        <strong>${label}</strong>
        ${value}
      </div>
    `)
    .join("");
  const notes = entry.notes
    ? `<div class="detail-section"><strong>備考</strong><p>${escapeHtml(entry.notes)}</p></div>`
    : "";

  const tags = (entry.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  detailView.innerHTML = `
    <div>
      <h3>${escapeHtml(entry.title || "無題")}</h3>
      <div class="detail-meta">
        <span>${escapeHtml(entry.artist || "Unknown")}</span>
        ${entry.bpm ? `<span>${escapeHtml(entry.bpm)} BPM</span>` : ""}
        ${entry.songKey ? `<span>${escapeHtml(entry.songKey)}</span>` : ""}
        ${entry.trackUrl ? `<a href="${escapeHtml(entry.trackUrl)}" target="_blank" rel="noreferrer">URL</a>` : ""}
      </div>
    </div>
    <div class="tag-list">${tags}</div>
    ${renderAudioBlock(entry)}
    ${sections || notes ? `${sections}${notes}` : '<div class="empty-state">まだ詳細メモがありません。</div>'}
  `;
  hydrateAudioPlayer(entry);
}

function renderAudioBlock(entry) {
  if (!entry.audioName) return "";
  return `
    <div class="audio-player-card">
      <strong>音源</strong>
      <span>${escapeHtml(entry.audioName)}</span>
      <div id="audioPlayerSlot" class="audio-player-slot">読み込み中</div>
    </div>
  `;
}

async function hydrateAudioPlayer(entry) {
  if (!entry || !entry.audioName) return;
  const slot = document.querySelector("#audioPlayerSlot");
  if (!slot) return;
  try {
    const file = await getAudioFile(entry.id);
    if (!file) {
      slot.innerHTML = '<span class="muted-cell">この端末には音源ファイルがありません。</span>';
      return;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(file);
    slot.innerHTML = `<audio controls preload="metadata" src="${currentAudioUrl}"></audio>`;
  } catch {
    slot.innerHTML = '<span class="muted-cell">音源を読み込めませんでした。</span>';
  }
}

function renderSectionDetail(entry, section) {
  const key = entry[`${section}Key`];
  const chords = entry[`${section}Chords`];
  const memo = entry[section];
  if (!key && !chords && !memo) return "";
  return `
    <div class="detail-subgrid">
      ${key ? `<span><b>キー</b>${escapeHtml(key)}</span>` : ""}
      ${chords ? `<span><b>コード進行</b>${escapeHtml(chords)}</span>` : ""}
    </div>
    ${memo ? `<p>${escapeHtml(memo)}</p>` : ""}
  `;
}

function drawSongMap(entry) {
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#17201c";
  ctx.fillRect(0, 0, width, height);

  const parts = [
    ["Intro", sectionValue(entry, "intro"), "#d9a441"],
    ["A", sectionValue(entry, "verseA"), "#58a188"],
    ["B", sectionValue(entry, "verseB"), "#f1eee5"],
    ["Chorus", sectionValue(entry, "chorus"), "#b8422d"],
  ];
  const filled = parts.filter(([, value]) => value).length || 1;
  const barWidth = (width - 96) / parts.length;

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(entry ? entry.title || "無題" : "No track selected", width / 2, 44);

  parts.forEach(([label, value, color], index) => {
    const x = 48 + index * barWidth;
    const strength = value ? Math.min(1, value.length / 110 + 0.35) : 0.2;
    const barHeight = 82 + strength * 92;
    const y = height - 82 - barHeight;
    ctx.fillStyle = value ? color : "rgba(255,255,255,0.16)";
    ctx.fillRect(x + 8, y, barWidth - 16, barHeight);
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "800 14px system-ui, sans-serif";
    ctx.fillText(label, x + barWidth / 2, height - 44);
  });

  ctx.fillStyle = "rgba(255,255,255,0.62)";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.fillText(`filled sections: ${filled}/4`, width / 2, height - 18);
}

function sectionValue(entry, section) {
  if (!entry) return "";
  return [entry[`${section}Key`], entry[`${section}Chords`], entry[section]].filter(Boolean).join(" ");
}

function readForm() {
  return {
    id: document.querySelector("#entryId").value || createId(),
    title: document.querySelector("#title").value.trim(),
    artist: document.querySelector("#artist").value.trim(),
    bpm: document.querySelector("#bpm").value.trim(),
    songKey: document.querySelector("#songKey").value.trim(),
    trackUrl: document.querySelector("#trackUrl").value.trim(),
    audioName: getSelectedEntry() && getSelectedEntry().id === document.querySelector("#entryId").value ? getSelectedEntry().audioName || "" : "",
    audioType: getSelectedEntry() && getSelectedEntry().id === document.querySelector("#entryId").value ? getSelectedEntry().audioType || "" : "",
    tags: normalizeTags(document.querySelector("#tags").value),
    favorite: document.querySelector("#favorite").checked,
    introKey: document.querySelector("#introKey").value.trim(),
    introChords: document.querySelector("#introChords").value.trim(),
    intro: document.querySelector("#intro").value.trim(),
    verseAKey: document.querySelector("#verseAKey").value.trim(),
    verseAChords: document.querySelector("#verseAChords").value.trim(),
    verseA: document.querySelector("#verseA").value.trim(),
    verseBKey: document.querySelector("#verseBKey").value.trim(),
    verseBChords: document.querySelector("#verseBChords").value.trim(),
    verseB: document.querySelector("#verseB").value.trim(),
    chorusKey: document.querySelector("#chorusKey").value.trim(),
    chorusChords: document.querySelector("#chorusChords").value.trim(),
    chorus: document.querySelector("#chorus").value.trim(),
    notes: document.querySelector("#notes").value.trim(),
    updatedAt: new Date().toISOString(),
  };
}

function saveCurrentEntry(showResult) {
  const entry = readForm();
  const index = state.entries.findIndex((item) => item.id === entry.id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.unshift(entry);
  state.selectedId = entry.id;
  persist();
  renderStats();
  renderList();
  renderTable();
  if (showResult) showSaved();
}

function queueEntrySave() {
  window.clearTimeout(entrySaveTimer);
  entrySaveTimer = window.setTimeout(() => {
    saveCurrentEntry(false);
  }, 500);
}

function saveEntry(event) {
  event.preventDefault();
  window.clearTimeout(entrySaveTimer);
  saveCurrentEntry(true);
}

function createEntry() {
  const entry = {
    id: createId(),
    title: "",
    artist: "",
    bpm: "",
    songKey: "",
    trackUrl: "",
    audioName: "",
    audioType: "",
    tags: [],
    favorite: false,
    introKey: "",
    introChords: "",
    intro: "",
    verseAKey: "",
    verseAChords: "",
    verseA: "",
    verseBKey: "",
    verseBChords: "",
    verseB: "",
    chorusKey: "",
    chorusChords: "",
    chorus: "",
    notes: "",
    updatedAt: new Date().toISOString(),
  };
  state.entries.unshift(entry);
  state.selectedId = entry.id;
  state.view = "detail";
  persist();
  render();
  document.querySelector("#title").focus();
}

function deleteSelected() {
  if (!state.selectedId) return;
  const entry = getSelectedEntry();
  if (!confirm(`${entry && entry.title ? entry.title : "この分析"}を削除しますか？`)) return;
  deleteAudioFile(state.selectedId).catch(() => {});
  state.entries = state.entries.filter((item) => item.id !== state.selectedId);
  state.selectedId = state.entries[0] ? state.entries[0].id : null;
  persist();
  render();
}

function exportEntries() {
  const blob = new Blob([JSON.stringify(state.entries, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `music-analysis-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const headers = [
    "曲名",
    "アーティスト",
    "BPM",
    "曲のキー",
    "URL",
    "タグ",
    "イントロ キー",
    "イントロ コード進行",
    "イントロ メモ",
    "Aメロ キー",
    "Aメロ コード進行",
    "Aメロ メモ",
    "Bメロ キー",
    "Bメロ コード進行",
    "Bメロ メモ",
    "サビ キー",
    "サビ コード進行",
    "サビ メモ",
    "備考",
    "重要",
    "更新日",
  ];
  const visibleIds = [...tableBody.querySelectorAll("tr[data-id]")].map((row) => row.dataset.id);
  const visibleEntries = visibleIds.length
    ? visibleIds.map((id) => state.entries.find((entry) => entry.id === id)).filter(Boolean)
    : sortedEntries(filteredEntries());
  const rows = visibleEntries.map((entry) => [
    entry.title || "",
    entry.artist || "",
    entry.bpm || "",
    entry.songKey || "",
    entry.trackUrl || "",
    (entry.tags || []).join(", "),
    entry.introKey || "",
    entry.introChords || "",
    entry.intro || "",
    entry.verseAKey || "",
    entry.verseAChords || "",
    entry.verseA || "",
    entry.verseBKey || "",
    entry.verseBChords || "",
    entry.verseB || "",
    entry.chorusKey || "",
    entry.chorusChords || "",
    entry.chorus || "",
    entry.notes || "",
    entry.favorite ? "TRUE" : "FALSE",
    entry.updatedAt ? new Date(entry.updatedAt).toLocaleString("ja-JP") : "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `music-analysis-sheet-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value) {
  const text = String(value == null ? "" : value);
  return `"${text.replace(/"/g, '""')}"`;
}

async function importEntries(event) {
  const [file] = event.target.files;
  if (!file) return;
  const imported = JSON.parse(await file.text());
  if (!Array.isArray(imported)) {
    alert("読み込める形式ではありません。");
    return;
  }
  const existingIds = new Set(state.entries.map((entry) => entry.id));
  const merged = imported.map((entry) => {
    const converted = convertLegacyEntry(entry);
    return {
      ...converted,
      id: existingIds.has(converted.id) ? createId() : converted.id,
      updatedAt: converted.updatedAt || new Date().toISOString(),
    };
  });
  state.entries = [...merged, ...state.entries];
  state.selectedId = state.entries[0] ? state.entries[0].id : null;
  persist();
  render();
  event.target.value = "";
}

function showSaved() {
  const status = document.querySelector("#saveStatus");
  status.textContent = "保存しました";
  window.clearTimeout(showSaved.timer);
  showSaved.timer = window.setTimeout(() => {
    status.textContent = "";
  }, 1800);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.querySelector("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
  renderTable();
});

document.querySelectorAll(".chip").forEach((button) => {
  button.addEventListener("click", () => {
    if (recentlyHandledTouch()) return;
    changeFilter(button);
  });
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    if (recentlyHandledTouch()) return;
    changeView(button.dataset.view);
  });
});

document.querySelector("#sortSelect").addEventListener("change", (event) => {
  changeSort(event.target.value);
});

tagFilterSelect.addEventListener("change", (event) => {
  state.tagFilter = event.target.value;
  renderList();
  renderTable();
});

tableZoom.addEventListener("input", (event) => setTableZoom(event.target.value));

document.querySelector("#zoomOutButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) setTableZoom(Number(tableZoom.value) - 10);
});
document.querySelector("#zoomInButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) setTableZoom(Number(tableZoom.value) + 10);
});

tableWrap.addEventListener("wheel", handleTableWheel, { passive: false });
tableWrap.addEventListener("mousedown", startTableDrag);
window.addEventListener("mousemove", dragTable);
window.addEventListener("mouseup", stopTableDrag);
document.addEventListener("touchstart", activateControl, { passive: true });
document.addEventListener("touchend", runTouchAction, { passive: false });
document.addEventListener("touchend", deactivateControls);
document.addEventListener("touchcancel", deactivateControls);

tableBody.addEventListener("click", (event) => {
  const editButton = closestElement(event.target, "[data-edit]");
  const row = closestElement(event.target, "tr[data-id]");
  if (!editButton && !row) return;
  if (recentlyHandledTouch()) return;
  state.selectedId = editButton ? editButton.dataset.edit : row.dataset.id;
  if (editButton) state.view = "detail";
  render();
});

form.addEventListener("input", () => {
  drawSongMap(readForm());
  queueEntrySave();
});
form.addEventListener("change", queueEntrySave);
form.addEventListener("submit", saveEntry);
document.querySelector("#newEntryButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) createEntry();
});
document.querySelector("#deleteButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) deleteSelected();
});
document.querySelector("#tableCsvExportButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) exportCsv();
});
document.querySelector("#exportButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) exportEntries();
});
document.querySelector("#importInput").addEventListener("change", importEntries);
audioFileInput.addEventListener("change", attachAudioFile);
removeAudioButton.addEventListener("click", () => {
  if (!recentlyHandledTouch()) removeAudioFile();
});
document.querySelector("#syncLoginButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) sendLoginLink();
});
document.querySelector("#googleLoginButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) signInWithGoogle();
});
syncToggleButton.addEventListener("click", () => {
  const isOpen = syncPanel.classList.toggle("is-open");
  syncToggleButton.setAttribute("aria-expanded", String(isOpen));
});
document.querySelector("#cloudSaveButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) saveCloudEntries(true);
});
document.querySelector("#cloudLoadButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) loadCloudEntries(true);
});
document.querySelector("#syncLogoutButton").addEventListener("click", () => {
  if (!recentlyHandledTouch()) signOutCloud();
});

setTableZoom(tableZoom.value);
render();
initCloudSync();
