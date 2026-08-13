export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return activeTab ?? null;
}

export function isSupportedTab(tab: chrome.tabs.Tab | null): boolean {
  const url = tab?.url;
  return Boolean(url && /^https?:\/\//.test(url));
}
