const HOST_NAME = "setoli";

browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL("setoli.html") });
});

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") return Promise.reject(new Error("要求が正しくありません。"));
  return browser.runtime.sendNativeMessage(HOST_NAME, message);
});
