const OTHER_BOOKMARKS_ID = "unfiled_____";
const ROOT_TITLE = "Setoli";
const MAX_OPEN_FILES = 10;
let globalRootId, rootId, currentId, deviceConfig;
let menuNode, dragState;

const $ = (id) => document.getElementById(id);
function entryIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.classList.add("entry-icon"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", type === "folder" ? "M3.5 6.5h6l2 2h9v9.75A2.25 2.25 0 0 1 18.25 20.5h-14A2.25 2.25 0 0 1 2 18.25v-9.5A2.25 2.25 0 0 1 4.25 6.5Z" : "M6.5 2.75h7l4 4v14.5H6.5A2.25 2.25 0 0 1 4.25 19V5A2.25 2.25 0 0 1 6.5 2.75Zm6.5.5v4h4");
  svg.append(path); return svg;
}
function setEntryLabel(button, type, text) { button.replaceChildren(entryIcon(type), document.createTextNode(text)); }
function setStatus(message) { $("status").textContent = message; }
function validDeviceName(value) {
  const name = value.trim();
  if (!name) return "端末名を入力してください。";
  if (name.includes("/")) return "端末名に / は使えません。";
  return undefined;
}
async function native(message) {
  const result = await browser.runtime.sendMessage(message);
  if (!result.success) throw new Error(result.error?.message || "Native Hostとの通信に失敗しました。");
  return result.data;
}
async function metaStore() { return (await browser.storage.local.get("metadata")).metadata || {}; }
async function saveMeta(metadata) { await browser.storage.local.set({ metadata }); }
async function loadDeviceConfig() { return (await browser.storage.local.get("deviceConfig")).deviceConfig; }
async function saveDeviceConfig(config) { deviceConfig = config; await browser.storage.local.set({ deviceConfig: config }); }
async function ensureGlobalRoot() {
  const children = await browser.bookmarks.getChildren(OTHER_BOOKMARKS_ID);
  const existing = children.find((node) => node.type === "folder" && node.title === ROOT_TITLE);
  globalRootId = existing ? existing.id : (await browser.bookmarks.create({ parentId: OTHER_BOOKMARKS_ID, title: ROOT_TITLE })).id;
}
async function ensureRoot() {
  await ensureGlobalRoot();
  if (!deviceConfig?.deviceName) throw new Error("端末登録が必要です。");
  let node;
  if (deviceConfig.bookmarkId) {
    try { node = (await browser.bookmarks.get(deviceConfig.bookmarkId))[0]; } catch (_) { node = undefined; }
  }
  if (!node || node.type !== "folder" || node.parentId !== globalRootId || node.title !== deviceConfig.deviceName) {
    const matches = (await browser.bookmarks.getChildren(globalRootId)).filter((entry) => entry.type === "folder" && entry.title === deviceConfig.deviceName);
    if (matches.length > 1) throw new Error("同じ端末名の管理フォルダが複数あります。Setting で端末名を変更してください。");
    node = matches[0] || await browser.bookmarks.create({ parentId: globalRootId, title: deviceConfig.deviceName });
    await saveDeviceConfig({ ...deviceConfig, bookmarkId: node.id });
  }
  rootId = node.id;
  if (!currentId || !(await browser.bookmarks.get(currentId).catch(() => []))[0]) currentId = rootId;
}
async function parentChain(id) {
  const chain = []; let node = (await browser.bookmarks.get(id))[0];
  while (node) { chain.unshift(node); if (node.id === rootId) break; node = (await browser.bookmarks.get(node.parentId))[0]; }
  return chain;
}
async function removeEntry(node) {
  if (!node || !confirm(`「${node.title}」のブックマークを削除しますか？`)) return;
  await browser.bookmarks.removeTree(node.id);
  const metadata = await metaStore(); delete metadata[node.id]; await saveMeta(metadata); await render();
}
function clearDragState() {
  if (!dragState) return;
  dragState.item.classList.remove("dragging"); dragState.target?.classList.remove("drop-before", "drop-after"); dragState = undefined;
}
async function moveFileToTarget(source, target, placeAfter) {
  const entries = await browser.bookmarks.getChildren(currentId), sourceIndex = entries.findIndex((entry) => entry.id === source.id), targetIndex = entries.findIndex((entry) => entry.id === target.dataset.bookmarkId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
  const index = targetIndex - (sourceIndex < targetIndex ? 1 : 0) + (placeAfter ? 1 : 0);
  await browser.bookmarks.move(source.id, { parentId: currentId, index }); await render();
}
function beginFileDrag(event, node, item) {
  event.preventDefault(); const state = { node, item, target: undefined, placeAfter: false }; dragState = state; item.classList.add("dragging");
  const move = (moveEvent) => {
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("li[data-bookmark-id][data-file]");
    state.target?.classList.remove("drop-before", "drop-after");
    if (!target || target === item) { state.target = undefined; return; }
    state.target = target; state.placeAfter = moveEvent.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    target.classList.add(state.placeAfter ? "drop-after" : "drop-before");
  };
  const finish = async () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", finish); document.removeEventListener("pointercancel", finish);
    const { target, placeAfter } = state; clearDragState(); if (!target) return;
    try { await moveFileToTarget(node, target, placeAfter); setStatus("ファイルの順番を変更しました。"); } catch (error) { setStatus(error.message); }
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", finish, { once: true }); document.addEventListener("pointercancel", finish, { once: true });
}
async function render() {
  await ensureRoot(); const chain = await parentChain(currentId);
  $("breadcrumbs").replaceChildren(...chain.map((node, index) => {
    const button = document.createElement("button"); button.textContent = `${index ? "› " : ""}${node.title}`;
    button.onclick = () => { currentId = node.id; render(); }; return button;
  }));
  const entries = await browser.bookmarks.getChildren(currentId), list = $("entries"), metadata = await metaStore(); list.replaceChildren();
  for (const node of entries) {
    const item = document.createElement("li"), open = document.createElement("button"), more = document.createElement("button");
    open.className = "entry-open"; item.dataset.bookmarkId = node.id; if (node.type !== "folder") item.dataset.file = "true";
    const issue = metadata[node.id]?.repairStatus, suffix = issue === "ambiguous" ? "（要確認）" : issue === "missing" ? "（見つかりません）" : "";
    setEntryLabel(open, node.type, `${node.title}${suffix}`);
    open.onclick = async () => { try { if (node.type === "folder") { currentId = node.id; await render(); } else { await openFiles([node.url]); setStatus(`開きました: ${node.title}`); } } catch (error) { setStatus(error.message); } };
    more.textContent = "⋮"; more.className = "more"; more.setAttribute("aria-label", `${node.title} のメニュー`);
    more.onclick = () => { menuNode = node; $("entry-menu-title").textContent = node.title; $("entry-menu").showModal(); };
    if (node.type !== "folder") {
      const handle = document.createElement("button"); handle.type = "button"; handle.className = "drag-handle"; handle.textContent = "⠿";
      handle.setAttribute("aria-label", `${node.title} をドラッグして並べ替え`); handle.onpointerdown = (dragEvent) => beginFileDrag(dragEvent, node, item); item.append(handle);
    }
    item.append(open, more); list.append(item);
  }
  setStatus(`${deviceConfig.deviceName}：${entries.length}件`);
}
async function currentFolderUrls() { return (await browser.bookmarks.getChildren(currentId)).flatMap((node) => node.url ? [node.url] : []); }
async function openFiles(urls) {
  const fingerprints = await Promise.all(urls.map((url) => native({ action: "fingerprint", url })));
  await native({ action: "open", urls: fingerprints.map((fingerprint) => fingerprint.url) });
}
function rootPath(relativePath) { return deviceConfig.rootPath === "/" ? `/${relativePath}` : `${deviceConfig.rootPath}/${relativePath}`; }
function showScanResults(results, records) {
  const recordsById = new Map(records.map((record) => [record.bookmarkId, record]));
  const list = $("scan-results-list"); list.replaceChildren(); $("scan-root").textContent = deviceConfig.rootPath;
  for (const result of results) {
    const record = recordsById.get(result.bookmarkId), item = document.createElement("li"), name = record?.name || record?.relativePath || result.bookmarkId;
    if (result.status === "repaired") item.textContent = `修復: ${name} → ${rootPath(result.fingerprint.relativePath)}`;
    else if (result.status === "ok") item.textContent = `確認済み: ${name} → ${rootPath(result.fingerprint.relativePath)}`;
    else if (result.status === "ambiguous") item.textContent = `要確認: ${name}（一致候補が複数）`;
    else item.textContent = `未検出: ${name}`;
    list.append(item);
  }
  $("scan-results").showModal();
}
async function repairLinks() {
  const entries = await browser.bookmarks.getSubTree(rootId), metadata = await metaStore(), records = [];
  const visit = (node) => { if (node.url && metadata[node.id]) records.push({ bookmarkId: node.id, url: node.url, ...metadata[node.id] }); for (const child of node.children || []) visit(child); };
  visit(entries[0]); if (!records.length) return setStatus("検査対象はありません。");
  const results = await native({ action: "repair", records }); let repaired = 0, ambiguous = 0, missing = 0;
  for (const result of results) {
    if (result.status === "repaired") { await browser.bookmarks.update(result.bookmarkId, { url: result.fingerprint.url }); metadata[result.bookmarkId] = result.fingerprint; repaired++; }
    else if (result.status === "ok") metadata[result.bookmarkId] = result.fingerprint;
    else if (result.status === "ambiguous") { metadata[result.bookmarkId] = { ...metadata[result.bookmarkId], repairStatus: "ambiguous" }; ambiguous++; }
    else { metadata[result.bookmarkId] = { ...metadata[result.bookmarkId], repairStatus: "missing" }; missing++; }
  }
  await saveMeta(metadata); setStatus(`検査完了：修復 ${repaired}件、要確認 ${ambiguous}件、未検出 ${missing}件`); await render(); showScanResults(results, records);
}
async function showPicker(relativePath = "") {
  const data = await native({ action: "list_directory", relativePath }); $("picker-path").textContent = data.path ? `${deviceConfig.rootPath}/${data.path}` : deviceConfig.rootPath;
  const list = $("picker-entries"); list.replaceChildren();
  const add = (text, handler, type) => { const li = document.createElement("li"), button = document.createElement("button"); if (type) setEntryLabel(button, type, text); else button.textContent = text; button.onclick = handler; li.append(button); list.append(li); };
  if (data.path) add("↩ 親フォルダ", () => showPicker(data.path.split("/").slice(0, -1).join("/")));
  for (const folder of data.folders) add(folder.name, () => showPicker(folder.relativePath), "folder");
  for (const file of data.files) add(file.name, async () => {
    try { const fingerprint = await native({ action: "fingerprint", url: file.url }); const node = await browser.bookmarks.create({ parentId: currentId, title: file.name, url: fingerprint.url }); const metadata = await metaStore(); metadata[node.id] = fingerprint; await saveMeta(metadata); $("picker").close(); await render(); } catch (error) { setStatus(error.message); }
  }, "file");
  $("picker").showModal();
}
async function registerDevice(event) {
  event.preventDefault(); const name = $("device-name").value.trim(), rootPath = $("initial-root-path").value.trim(), error = validDeviceName(name);
  if (error) return setStatus(error);
  try {
    await ensureGlobalRoot();
    if ((await browser.bookmarks.getChildren(globalRootId)).some((node) => node.type === "folder" && node.title === name)) throw new Error("同じ端末名の管理フォルダが既にあります。別の端末名を入力してください。");
    const configured = await native({ action: "configure_root", rootPath }), node = await browser.bookmarks.create({ parentId: globalRootId, title: name });
    await saveDeviceConfig({ deviceName: name, rootPath: configured.rootPath, bookmarkId: node.id }); rootId = node.id; currentId = node.id;
    $("device-setup").close(); await render(); setStatus(`${name} を登録しました。`);
  } catch (error) { setStatus(error.message); }
}
async function changeRoot(event) {
  event.preventDefault();
  try {
    const configured = await native({ action: "configure_root", rootPath: $("changed-root-path").value.trim() });
    await saveDeviceConfig({ ...deviceConfig, rootPath: configured.rootPath }); $("root-change").close(); $("settings-root").textContent = configured.rootPath;
    setStatus("ルートディレクトリを変更しました。既存ブックマークは変更していません。");
  } catch (error) { setStatus(error.message); }
}
$("new-folder").onclick = async () => { const title = prompt("フォルダ名"); if (title?.trim()) { await browser.bookmarks.create({ parentId: currentId, title: title.trim() }); await render(); } };
$("add-file").onclick = () => { if (currentId === rootId) return setStatus("ファイルはディレクトリ内で追加してください。"); showPicker().catch((error) => setStatus(error.message)); };
$("open-folder").onclick = async () => { try { if (currentId === rootId) return setStatus("ルートではファイルを開けません。"); const urls = await currentFolderUrls(); if (!urls.length) return setStatus("このディレクトリにファイルはありません。"); if (urls.length > MAX_OPEN_FILES) return setStatus(`一括で開けるのは最大${MAX_OPEN_FILES}件です（${urls.length}件）。`); await openFiles(urls); setStatus(`${urls.length}件を開きました。`); } catch (error) { setStatus(error.message); } };
$("repair").onclick = () => repairLinks().catch((error) => setStatus(error.message));
$("settings").onclick = () => { $("settings-device").textContent = deviceConfig.deviceName; $("settings-root").textContent = deviceConfig.rootPath; $("settings-page").showModal(); };
$("change-root").onclick = () => { $("settings-page").close(); $("changed-root-path").value = deviceConfig.rootPath; $("root-change").showModal(); };
$("root-change-cancel").onclick = () => $("root-change").close();
$("change-skin").onclick = () => { $("settings-page").close(); $("skin-page").showModal(); };
$("skin-back").onclick = () => { $("skin-page").close(); $("settings-page").showModal(); };
$("delete-entry").onclick = async () => { $("entry-menu").close(); try { await removeEntry(menuNode); } catch (error) { setStatus(error.message); } finally { menuNode = undefined; } };
$("device-setup-form").addEventListener("submit", registerDevice);
$("root-change-form").addEventListener("submit", changeRoot);
async function initialize() {
  deviceConfig = await loadDeviceConfig();
  if (!deviceConfig?.deviceName || !deviceConfig?.rootPath) { $("device-setup").showModal(); setStatus("この端末を登録してください。"); return; }
  await native({ action: "configure_root", rootPath: deviceConfig.rootPath });
  await render(); await repairLinks();
}
initialize().catch((error) => setStatus(error.message));
