const OTHER_BOOKMARKS_ID = "unfiled_____";
const ROOT_TITLE = "Setoli";
const MAX_OPEN_FILES = 10;
let rootId, currentId;

const $ = (id) => document.getElementById(id);
function setStatus(message) { $("status").textContent = message; }
async function native(message) {
  const result = await browser.runtime.sendMessage(message);
  if (!result.success) throw new Error(result.error?.message || "Native Hostとの通信に失敗しました。");
  return result.data;
}
async function metaStore() { return (await browser.storage.local.get("metadata")).metadata || {}; }
async function saveMeta(metadata) { await browser.storage.local.set({ metadata }); }
async function ensureRoot() {
  const children = await browser.bookmarks.getChildren(OTHER_BOOKMARKS_ID);
  const existing = children.find((node) => node.type === "folder" && node.title === ROOT_TITLE);
  rootId = existing ? existing.id : (await browser.bookmarks.create({ parentId: OTHER_BOOKMARKS_ID, title: ROOT_TITLE })).id;
  currentId ||= rootId;
}
async function parentChain(id) {
  const chain = [];
  let node = (await browser.bookmarks.get(id))[0];
  while (node && node.id !== OTHER_BOOKMARKS_ID) {
    chain.unshift(node); if (node.id === rootId) break;
    node = (await browser.bookmarks.get(node.parentId))[0];
  }
  return chain;
}
async function render() {
  await ensureRoot();
  const chain = await parentChain(currentId);
  $("breadcrumbs").replaceChildren(...chain.map((node, index) => {
    const button = document.createElement("button"); button.textContent = `${index ? "› " : ""}${node.title || ROOT_TITLE}`;
    button.onclick = () => { currentId = node.id; render(); }; return button;
  }));
  const entries = await browser.bookmarks.getChildren(currentId);
  const list = $("entries"); list.replaceChildren();
  for (const node of entries) {
    const item = document.createElement("li"), open = document.createElement("button"), remove = document.createElement("button");
    const metadata = await metaStore();
    const issue = metadata[node.id]?.repairStatus;
    const suffix = issue === "ambiguous" ? "（要確認）" : issue === "missing" ? "（見つかりません）" : "";
    open.textContent = node.type === "folder" ? `📁 ${node.title}` : `📄 ${node.title}${suffix}`;
    open.onclick = async () => {
      try { if (node.type === "folder") { currentId = node.id; await render(); } else { await native({ action: "open", urls: [node.url] }); setStatus(`開きました: ${node.title}`); } }
      catch (error) { setStatus(error.message); }
    };
    remove.textContent = "削除"; remove.className = "remove";
    remove.onclick = async () => { if (confirm(`「${node.title}」のブックマークを削除しますか？`)) { await browser.bookmarks.removeTree(node.id); const metadata = await metaStore(); delete metadata[node.id]; await saveMeta(metadata); await render(); } };
    item.append(open);
    if (node.url) {
      const direct = document.createElement("a");
      direct.href = node.url;
      direct.target = "_blank";
      direct.rel = "noopener";
      direct.textContent = "リンクで開く（試験）";
      direct.addEventListener("click", () => setStatus(`リンクを開いています: ${node.title}`));
      item.append(direct);
    }
    item.append(remove); list.append(item);
  }
  setStatus(`${entries.length}件`);
}
async function descendantUrls(folderId) {
  const node = (await browser.bookmarks.getSubTree(folderId))[0], urls = [];
  const visit = (entry) => { if (entry.url) urls.push(entry.url); for (const child of entry.children || []) visit(child); };
  visit(node); return urls;
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
  await saveMeta(metadata); setStatus(`検査完了：修復 ${repaired}件、要確認 ${ambiguous}件、未検出 ${missing}件`); await render();
}
async function showPicker(relativePath = "") {
  const data = await native({ action: "list_directory", relativePath });
  $("picker-path").textContent = `score/${data.path}`;
  const list = $("picker-entries"); list.replaceChildren();
  const add = (text, handler) => { const li = document.createElement("li"), button = document.createElement("button"); button.textContent = text; button.onclick = handler; li.append(button); list.append(li); };
  if (data.path) add("↩ 親フォルダ", () => showPicker(data.path.split("/").slice(0, -1).join("/")));
  for (const folder of data.folders) add(`📁 ${folder.name}`, () => showPicker(folder.relativePath));
  for (const file of data.files) add(`📄 ${file.name}`, async () => {
    try { const fingerprint = await native({ action: "fingerprint", url: file.url }); const node = await browser.bookmarks.create({ parentId: currentId, title: file.name, url: fingerprint.url }); const metadata = await metaStore(); metadata[node.id] = fingerprint; await saveMeta(metadata); $("picker").close(); await render(); }
    catch (error) { setStatus(error.message); }
  });
  $("picker").showModal();
}
$("new-folder").onclick = async () => { const title = prompt("フォルダ名"); if (title?.trim()) { await browser.bookmarks.create({ parentId: currentId, title: title.trim() }); await render(); } };
$("add-file").onclick = () => showPicker().catch((error) => setStatus(error.message));
$("open-folder").onclick = async () => { try { const urls = await descendantUrls(currentId); if (!urls.length) return setStatus("このフォルダにファイルはありません。"); if (urls.length > MAX_OPEN_FILES) return setStatus(`一括で開けるのは最大${MAX_OPEN_FILES}件です（${urls.length}件）。`); await native({ action: "open", urls }); setStatus(`${urls.length}件を開きました。`); } catch (error) { setStatus(error.message); } };
$("repair").onclick = () => repairLinks().catch((error) => setStatus(error.message));
async function initialize() {
  await render();
  await repairLinks();
}
initialize().catch((error) => setStatus(error.message));
