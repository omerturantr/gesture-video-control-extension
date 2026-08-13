// src/shared/config.ts
var DEFAULT_SETTINGS = {
  seekSeconds: 10,
  volumeStepPercent: 8,
  holdAccelerationPercent: 35,
  playbackRateStep: 0.1,
  sensitivity: "responsive",
  attentionGuardEnabled: true,
  attentionTimeoutSeconds: 3,
  eyeClosureGuardEnabled: true,
  eyeClosureTimeoutSeconds: 2.5,
  debugClassifier: false
};
var EMPTY_CONTROLLER_STATE = {
  status: "idle",
  cameraStatus: "idle",
  trackingStatus: "idle",
  handVisible: false,
  faceDetected: false,
  attentionState: "unknown",
  eyeState: "unknown",
  activeTabId: null,
  currentGesture: "NONE",
  activeHoldAction: "NONE",
  lastStableGesture: "NONE",
  lastCommand: null,
  lastCommandMessage: "Haz\u0131r.",
  attentionElapsedMs: 0,
  eyeClosureElapsedMs: 0,
  updatedAt: 0
};

// src/shared/messaging.ts
var MESSAGE_TYPES = {
  getPageStatus: "GET_PAGE_STATUS",
  pageStatusUpdated: "PAGE_STATUS_UPDATED",
  getPageOverlayState: "GET_PAGE_OVERLAY_STATE",
  pageOverlayStateUpdated: "PAGE_OVERLAY_STATE_UPDATED",
  executeVideoCommand: "EXECUTE_VIDEO_COMMAND",
  getAppState: "GET_APP_STATE",
  startController: "START_CONTROLLER",
  stopController: "STOP_CONTROLLER",
  startVisibleController: "START_VISIBLE_CONTROLLER",
  updateSettings: "UPDATE_SETTINGS",
  offscreenStart: "OFFSCREEN_START",
  offscreenStop: "OFFSCREEN_STOP",
  offscreenUpdateSettings: "OFFSCREEN_UPDATE_SETTINGS",
  offscreenStateUpdated: "OFFSCREEN_STATE_UPDATED",
  offscreenPreviewUpdated: "OFFSCREEN_PREVIEW_UPDATED"
};

// src/shared/storage.ts
var SETTINGS_KEY = "gestureFlowSettings";
function sanitizeSettings(rawSettings) {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings
  };
}
async function getStoredSettings() {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY]);
}
async function updateStoredSettings(partial) {
  const nextSettings = sanitizeSettings({
    ...await getStoredSettings(),
    ...partial
  });
  await chrome.storage.sync.set({
    [SETTINGS_KEY]: nextSettings
  });
  return nextSettings;
}

// src/background/index.ts
var OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
var CAMERA_PERMISSION_PAGE_PATH = "camera-permission/camera-permission.html";
var pageStateStore = /* @__PURE__ */ new Map();
var controllerPreviewDataUrl = null;
var visibleCameraPermissionTabId = null;
var overlayDirtyTabs = /* @__PURE__ */ new Set();
var overlaySyncTimerId = null;
var controllerState = {
  ...EMPTY_CONTROLLER_STATE
};
var settingsCache = null;
var settingsPromise = null;
function createEmptyPageStatus(tabId, tab) {
  return {
    pageSupported: Boolean(tab?.url && /^https?:\/\//.test(tab.url)),
    tabId,
    videoDetected: false,
    videoCount: 0,
    multipleVideos: false,
    primaryVideoReason: "Sayfadaki video aran\u0131yor.",
    lastUpdatedAt: Date.now(),
    snapshot: null,
    title: tab?.title,
    url: tab?.url
  };
}
async function getSettings() {
  if (settingsCache) {
    return settingsCache;
  }
  if (!settingsPromise) {
    settingsPromise = getStoredSettings().then((settings) => {
      settingsCache = settings;
      settingsPromise = null;
      return settings;
    });
  }
  return settingsPromise;
}
async function setSettings(partial) {
  const nextSettings = await updateStoredSettings(partial);
  settingsCache = nextSettings;
  return nextSettings;
}
function getPageStatus(tabId, tab) {
  const existing = pageStateStore.get(tabId);
  if (existing) {
    return existing;
  }
  const emptyStatus = createEmptyPageStatus(tabId, tab);
  pageStateStore.set(tabId, emptyStatus);
  return emptyStatus;
}
function mergeControllerState(partialState) {
  controllerState = {
    ...controllerState,
    ...partialState,
    updatedAt: Date.now()
  };
  return controllerState;
}
function buildPageOverlayState(tabId) {
  return {
    targetTabActive: controllerState.activeTabId === tabId,
    controller: controllerState,
    previewDataUrl: controllerState.activeTabId === tabId ? controllerPreviewDataUrl : null
  };
}
async function pushOverlayState(tabId) {
  await sendMessageToTab(tabId, {
    type: MESSAGE_TYPES.pageOverlayStateUpdated,
    state: buildPageOverlayState(tabId)
  });
}
async function flushOverlayUpdates() {
  overlaySyncTimerId = null;
  const tabIds = Array.from(overlayDirtyTabs);
  overlayDirtyTabs.clear();
  await Promise.all(tabIds.map((tabId) => pushOverlayState(tabId)));
}
function scheduleOverlaySync(tabId) {
  if (typeof tabId !== "number" || tabId < 0) {
    return;
  }
  overlayDirtyTabs.add(tabId);
  if (overlaySyncTimerId !== null) {
    return;
  }
  overlaySyncTimerId = setTimeout(() => {
    void flushOverlayUpdates();
  }, 120);
}
function scheduleOverlaySyncForTabs(tabIds) {
  for (const tabId of tabIds) {
    scheduleOverlaySync(tabId);
  }
}
async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return activeTab ?? null;
}
function isSupportedTab(tab) {
  return Boolean(tab?.id && tab.url && /^https?:\/\//.test(tab.url));
}
async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}
async function ensureContentScriptReady(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content-script.js"]
  });
}
async function refreshPageStatusForTab(tabId) {
  let response = await sendMessageToTab(tabId, {
    type: MESSAGE_TYPES.getPageStatus
  });
  if (!response?.ok) {
    try {
      await ensureContentScriptReady(tabId);
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      response = await sendMessageToTab(tabId, {
        type: MESSAGE_TYPES.getPageStatus
      });
    } catch {
      response = null;
    }
  }
  if (response?.ok) {
    const nextStatus = {
      ...response.status,
      tabId,
      lastUpdatedAt: Date.now()
    };
    pageStateStore.set(tabId, nextStatus);
    return nextStatus;
  }
  const tab = await chrome.tabs.get(tabId);
  const fallbackStatus = {
    ...createEmptyPageStatus(tabId, tab),
    primaryVideoReason: "Sayfa kontrol\xFC hen\xFCz haz\u0131r de\u011Fil. Video sekmesini yenileyip yeniden deneyin."
  };
  pageStateStore.set(tabId, fallbackStatus);
  return fallbackStatus;
}
async function updateBadge(tabId) {
  const pageStatus = pageStateStore.get(tabId);
  let text = "";
  let color = "#1d4ed8";
  if (controllerState.activeTabId === tabId && controllerState.status === "active") {
    text = "AKT";
    color = "#0f766e";
  } else if (controllerState.activeTabId === tabId && (controllerState.cameraStatus === "blocked" || controllerState.status === "error")) {
    text = "HAT";
    color = "#b91c1c";
  } else if (pageStatus?.videoDetected) {
    text = "VID";
    color = "#1d4ed8";
  }
  await chrome.action.setBadgeText({ tabId, text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
  }
}
async function updateKnownBadges() {
  const tabIds = /* @__PURE__ */ new Set();
  if (controllerState.activeTabId) {
    tabIds.add(controllerState.activeTabId);
  }
  for (const tabId of pageStateStore.keys()) {
    tabIds.add(tabId);
  }
  await Promise.all(Array.from(tabIds, (tabId) => updateBadge(tabId)));
}
async function hasOffscreenDocument() {
  const runtimeWithContexts = chrome.runtime;
  if (!runtimeWithContexts.getContexts) {
    return false;
  }
  const contexts = await runtimeWithContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });
  return contexts.length > 0;
}
async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }
  const offscreenApi = chrome.offscreen;
  await offscreenApi.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "A\xE7\u0131l\u0131r pencere kapal\u0131yken kamera tabanl\u0131 el ve y\xFCz takibini \xE7al\u0131\u015Ft\u0131r."
  });
}
async function closeOffscreenDocument() {
  if (!await hasOffscreenDocument()) {
    return;
  }
  try {
    await chrome.offscreen.closeDocument();
  } catch {
  }
}
async function buildAppState() {
  const activeTab = await getActiveTab();
  const activeTabId = activeTab?.id ?? null;
  const settings = await getSettings();
  return {
    activeTabId,
    activePage: activeTabId ? getPageStatus(activeTabId, activeTab ?? void 0) : null,
    targetPage: controllerState.activeTabId ? getPageStatus(controllerState.activeTabId) : null,
    settings,
    controller: controllerState
  };
}
function createActionResponse(ok, message) {
  return {
    ok,
    message,
    state: controllerState
  };
}
async function startController(tabId) {
  const previousTargetTabId = controllerState.activeTabId;
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedTab(tab)) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      lastCommandMessage: "GestureFlow'u a\xE7madan \xF6nce normal bir HTTP veya HTTPS video sayfas\u0131 a\xE7\u0131n.",
      error: "Desteklenmeyen sayfa."
    });
    await updateKnownBadges();
    return createActionResponse(false, controllerState.lastCommandMessage);
  }
  const pageStatus = await refreshPageStatusForTab(tabId);
  if (!pageStatus.videoDetected) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      activeTabId: tabId,
      lastCommandMessage: "Bu sekmede aktif HTML5 video bulunamad\u0131.",
      error: "Desteklenen video alg\u0131lanmad\u0131."
    });
    await updateKnownBadges();
    return createActionResponse(false, controllerState.lastCommandMessage);
  }
  const settings = await getSettings();
  controllerPreviewDataUrl = null;
  mergeControllerState({
    status: "starting",
    cameraStatus: "requesting",
    activeTabId: tabId,
    error: void 0,
    lastCommandMessage: "Kamera takibi ba\u015Flat\u0131l\u0131yor."
  });
  scheduleOverlaySyncForTabs([previousTargetTabId, tabId]);
  await updateKnownBadges();
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.offscreenStart,
      settings
    });
    if (!response?.ok) {
      throw new Error(response?.message ?? "Arka plan kontrol\xFC ba\u015Flat\u0131lamad\u0131.");
    }
    return createActionResponse(
      true,
      "Hareket kontrol\xFC ge\xE7erli ayarlarla ba\u015Flat\u0131l\u0131yor."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Arka plan kontrol\xFC ba\u015Flat\u0131lamad\u0131.";
    mergeControllerState({
      status: "error",
      cameraStatus: "error",
      error: message,
      lastCommandMessage: message
    });
    await closeOffscreenDocument();
    await updateKnownBadges();
    return createActionResponse(false, message);
  }
}
async function startVisibleController(tabId) {
  const previousTargetTabId = controllerState.activeTabId;
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedTab(tab)) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      lastCommandMessage: "GestureFlow'u a\xE7madan \xF6nce normal bir HTTP veya HTTPS video sayfas\u0131 a\xE7\u0131n.",
      error: "Desteklenmeyen sayfa."
    });
    await updateKnownBadges();
    return createActionResponse(false, controllerState.lastCommandMessage);
  }
  const pageStatus = await refreshPageStatusForTab(tabId);
  if (!pageStatus.videoDetected) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      activeTabId: tabId,
      lastCommandMessage: "Bu sekmede aktif HTML5 video bulunamad\u0131.",
      error: "Desteklenen video alg\u0131lanmad\u0131."
    });
    await updateKnownBadges();
    return createActionResponse(false, controllerState.lastCommandMessage);
  }
  try {
    await closeOffscreenDocument();
    mergeControllerState({
      status: "starting",
      cameraStatus: "requesting",
      activeTabId: tabId,
      error: void 0,
      lastCommandMessage: "G\xF6r\xFCn\xFCr kamera izin sayfas\u0131 a\xE7\u0131l\u0131yor."
    });
    scheduleOverlaySyncForTabs([previousTargetTabId, tabId]);
    await updateKnownBadges();
    const cameraPermissionTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(CAMERA_PERMISSION_PAGE_PATH),
      active: true
    });
    visibleCameraPermissionTabId = cameraPermissionTab.id ?? null;
    return createActionResponse(
      true,
      "Kamera izin sayfas\u0131 a\xE7\u0131ld\u0131. Devam etmek i\xE7in orada kameraya izin verin."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kamera izin sayfas\u0131 a\xE7\u0131lamad\u0131.";
    mergeControllerState({
      status: "error",
      cameraStatus: "error",
      error: message,
      lastCommandMessage: message
    });
    await updateKnownBadges();
    return createActionResponse(false, message);
  }
}
async function stopController(message = "Hareket kontrol\xFC durduruldu.") {
  const previousTargetTabId = controllerState.activeTabId;
  mergeControllerState({
    status: "stopping",
    lastCommandMessage: "Kamera takibi durduruluyor."
  });
  await updateKnownBadges();
  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.offscreenStop
    });
  } catch {
  }
  await closeOffscreenDocument();
  visibleCameraPermissionTabId = null;
  controllerPreviewDataUrl = null;
  controllerState = {
    ...EMPTY_CONTROLLER_STATE,
    lastCommandMessage: message,
    updatedAt: Date.now()
  };
  scheduleOverlaySync(previousTargetTabId);
  if (previousTargetTabId) {
    await updateBadge(previousTargetTabId);
  }
  return createActionResponse(true, message);
}
async function executeCommandOnTarget(message) {
  const targetTabId = controllerState.activeTabId;
  if (!targetTabId) {
    return {
      ok: false,
      command: message.command,
      applied: false,
      message: "Hedef video sekmesi se\xE7ilmedi.",
      status: createEmptyPageStatus(-1),
      options: {
        seekSeconds: message.seekSeconds,
        volumeDelta: message.volumeDelta,
        playbackRateDelta: message.playbackRateDelta,
        reason: message.reason
      }
    };
  }
  const response = await sendMessageToTab(targetTabId, message);
  if (!response) {
    const latestStatus = await refreshPageStatusForTab(targetTabId);
    mergeControllerState({
      status: "error",
      error: "Video sekmesine ula\u015F\u0131lamad\u0131.",
      lastCommandMessage: "GestureFlow hedef sekmeyle ba\u011Flant\u0131y\u0131 kaybetti."
    });
    await updateKnownBadges();
    return {
      ok: false,
      command: message.command,
      applied: false,
      message: "GestureFlow hedef sekmeye ula\u015Famad\u0131.",
      status: latestStatus,
      options: {
        seekSeconds: message.seekSeconds,
        volumeDelta: message.volumeDelta,
        playbackRateDelta: message.playbackRateDelta,
        reason: message.reason
      }
    };
  }
  pageStateStore.set(targetTabId, {
    ...response.status,
    tabId: targetTabId,
    lastUpdatedAt: Date.now()
  });
  mergeControllerState({
    status: "active",
    lastCommand: message.command,
    lastCommandMessage: response.message,
    error: void 0
  });
  scheduleOverlaySync(targetTabId);
  await updateKnownBadges();
  return response;
}
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.action.setBadgeText({ text: "" });
  await getSettings();
});
chrome.runtime.onStartup.addListener(() => {
  void getSettings();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.pageStatusUpdated) {
    const tabId = sender.tab?.id ?? message.status.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false });
      return;
    }
    pageStateStore.set(tabId, {
      ...message.status,
      tabId,
      lastUpdatedAt: Date.now()
    });
    void updateBadge(tabId);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === MESSAGE_TYPES.getPageOverlayState) {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        state: buildPageOverlayState(-1)
      });
      return;
    }
    sendResponse({
      ok: true,
      state: buildPageOverlayState(tabId)
    });
    return;
  }
  if (message.type === MESSAGE_TYPES.offscreenStateUpdated) {
    mergeControllerState(message.state);
    scheduleOverlaySync(controllerState.activeTabId);
    void updateKnownBadges();
    sendResponse({ ok: true });
    return;
  }
  if (message.type === MESSAGE_TYPES.offscreenPreviewUpdated) {
    controllerPreviewDataUrl = message.previewDataUrl;
    scheduleOverlaySync(controllerState.activeTabId);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === MESSAGE_TYPES.getAppState) {
    void buildAppState().then((state) => {
      sendResponse({
        ok: true,
        state
      });
    });
    return true;
  }
  if (message.type === MESSAGE_TYPES.startController) {
    void startController(message.tabId).then((response) => {
      sendResponse(response);
    });
    return true;
  }
  if (message.type === MESSAGE_TYPES.startVisibleController) {
    void startVisibleController(message.tabId).then((response) => {
      sendResponse(response);
    });
    return true;
  }
  if (message.type === MESSAGE_TYPES.stopController) {
    void stopController().then((response) => {
      sendResponse(response);
    });
    return true;
  }
  if (message.type === MESSAGE_TYPES.updateSettings) {
    void setSettings(message.settings).then(async (settings) => {
      if (controllerState.status === "active" || controllerState.status === "starting") {
        try {
          await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.offscreenUpdateSettings,
            settings
          });
        } catch (error) {
          const failureMessage = error instanceof Error ? error.message : "Yeni ayarlar e\u015Fitlenemedi.";
          mergeControllerState({
            status: "error",
            error: failureMessage,
            lastCommandMessage: failureMessage
          });
        }
      }
      sendResponse(createActionResponse(true, "Ayarlar g\xFCncellendi."));
    });
    return true;
  }
  if (message.type === MESSAGE_TYPES.executeVideoCommand) {
    void executeCommandOnTarget(message).then((response) => {
      sendResponse(response);
    });
    return true;
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pageStateStore.delete(tabId);
  if (visibleCameraPermissionTabId === tabId) {
    visibleCameraPermissionTabId = null;
    if (controllerState.status !== "idle") {
      void stopController("Hareket kontrol\xFC durduruldu \xE7\xFCnk\xFC kamera izin sekmesi kapat\u0131ld\u0131.");
    }
  } else if (controllerState.activeTabId === tabId) {
    void stopController("Hareket kontrol\xFC durduruldu \xE7\xFCnk\xFC hedef sekme kapat\u0131ld\u0131.");
  } else {
    void updateBadge(tabId);
  }
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading") {
    return;
  }
  pageStateStore.set(tabId, createEmptyPageStatus(tabId, tab));
  void updateBadge(tabId);
});
//# sourceMappingURL=index.js.map
