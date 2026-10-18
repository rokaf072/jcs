// 아이콘 클릭 → 출연자 보드 탭 열기 (이미 열려 있으면 그 탭으로 이동)
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('app.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

// 새 버전으로 자동 재시작한 뒤, 열려 있던 출연자 창을 다시 열어줌
chrome.runtime.onInstalled.addListener(async () => {
  const { reopenApp } = await chrome.storage.local.get('reopenApp');
  if (!reopenApp) return;
  await chrome.storage.local.remove('reopenApp');
  const url = chrome.runtime.getURL('app.html');
  if (reopenApp.type === 'popup' || reopenApp.type === 'app') chrome.windows.create({ url, type: 'popup', state: 'maximized' });
  else chrome.tabs.create({ url });
});
