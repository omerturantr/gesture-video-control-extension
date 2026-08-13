import { EMPTY_CONTROLLER_STATE } from "../shared/config";
import {
  MESSAGE_TYPES,
  type AppStateResponse,
  type ControllerActionResponse,
  type ExecuteCommandResponse,
  type PageOverlayStateResponse,
  type PageStatusResponse,
  type RuntimeMessage,
} from "../shared/messaging";
import { getStoredSettings, updateStoredSettings } from "../shared/storage";
import type {
  AppState,
  ControllerRuntimeState,
  ExtensionSettings,
  PageStatus,
  PageOverlayRemoteState,
} from "../shared/types";

const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
const CAMERA_PERMISSION_PAGE_PATH = "camera-permission/camera-permission.html";
const pageStateStore = new Map<number, PageStatus>();
let controllerPreviewDataUrl: string | null = null;
let visibleCameraPermissionTabId: number | null = null;
const overlayDirtyTabs = new Set<number>();
let overlaySyncTimerId: number | null = null;

let controllerState: ControllerRuntimeState = {
  ...EMPTY_CONTROLLER_STATE,
};

let settingsCache: ExtensionSettings | null = null;
let settingsPromise: Promise<ExtensionSettings> | null = null;

function createEmptyPageStatus(tabId: number, tab?: chrome.tabs.Tab): PageStatus {
  return {
    pageSupported: Boolean(tab?.url && /^https?:\/\//.test(tab.url)),
    tabId,
    videoDetected: false,
    videoCount: 0,
    multipleVideos: false,
    primaryVideoReason: "Sayfadaki video aranıyor.",
    lastUpdatedAt: Date.now(),
    snapshot: null,
    title: tab?.title,
    url: tab?.url,
  };
}

async function getSettings(): Promise<ExtensionSettings> {
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

async function setSettings(partial: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const nextSettings = await updateStoredSettings(partial);
  settingsCache = nextSettings;
  return nextSettings;
}

function getPageStatus(tabId: number, tab?: chrome.tabs.Tab): PageStatus {
  const existing = pageStateStore.get(tabId);
  if (existing) {
    return existing;
  }

  const emptyStatus = createEmptyPageStatus(tabId, tab);
  pageStateStore.set(tabId, emptyStatus);
  return emptyStatus;
}

function mergeControllerState(
  partialState: Partial<ControllerRuntimeState>,
): ControllerRuntimeState {
  controllerState = {
    ...controllerState,
    ...partialState,
    updatedAt: Date.now(),
  };

  return controllerState;
}

function buildPageOverlayState(tabId: number): PageOverlayRemoteState {
  return {
    targetTabActive: controllerState.activeTabId === tabId,
    controller: controllerState,
    previewDataUrl: controllerState.activeTabId === tabId ? controllerPreviewDataUrl : null,
  };
}

async function pushOverlayState(tabId: number) {
  await sendMessageToTab<PageOverlayStateResponse>(tabId, {
    type: MESSAGE_TYPES.pageOverlayStateUpdated,
    state: buildPageOverlayState(tabId),
  });
}

async function flushOverlayUpdates() {
  overlaySyncTimerId = null;
  const tabIds = Array.from(overlayDirtyTabs);
  overlayDirtyTabs.clear();
  await Promise.all(tabIds.map((tabId) => pushOverlayState(tabId)));
}

function scheduleOverlaySync(tabId: number | null) {
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

function scheduleOverlaySyncForTabs(tabIds: Array<number | null>) {
  for (const tabId of tabIds) {
    scheduleOverlaySync(tabId);
  }
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return activeTab ?? null;
}

function isSupportedTab(tab: chrome.tabs.Tab | null): boolean {
  return Boolean(tab?.id && tab.url && /^https?:\/\//.test(tab.url));
}

async function sendMessageToTab<T>(tabId: number, message: RuntimeMessage): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

async function ensureContentScriptReady(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content-script.js"],
  });
}

async function refreshPageStatusForTab(tabId: number): Promise<PageStatus> {
  let response = await sendMessageToTab<PageStatusResponse>(tabId, {
    type: MESSAGE_TYPES.getPageStatus,
  });

  if (!response?.ok) {
    try {
      await ensureContentScriptReady(tabId);
      await new Promise((resolve) => {
        setTimeout(resolve, 150);
      });
      response = await sendMessageToTab<PageStatusResponse>(tabId, {
        type: MESSAGE_TYPES.getPageStatus,
      });
    } catch {
      response = null;
    }
  }

  if (response?.ok) {
    const nextStatus = {
      ...response.status,
      tabId,
      lastUpdatedAt: Date.now(),
    };
    pageStateStore.set(tabId, nextStatus);
    return nextStatus;
  }

  const tab = await chrome.tabs.get(tabId);
  const fallbackStatus = {
    ...createEmptyPageStatus(tabId, tab),
    primaryVideoReason: "Sayfa kontrolü henüz hazır değil. Video sekmesini yenileyip yeniden deneyin.",
  };
  pageStateStore.set(tabId, fallbackStatus);
  return fallbackStatus;
}

async function updateBadge(tabId: number) {
  const pageStatus = pageStateStore.get(tabId);

  let text = "";
  let color = "#1d4ed8";

  if (controllerState.activeTabId === tabId && controllerState.status === "active") {
    text = "AKT";
    color = "#0f766e";
  } else if (
    controllerState.activeTabId === tabId &&
    (controllerState.cameraStatus === "blocked" || controllerState.status === "error")
  ) {
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
  const tabIds = new Set<number>();
  if (controllerState.activeTabId) {
    tabIds.add(controllerState.activeTabId);
  }
  for (const tabId of pageStateStore.keys()) {
    tabIds.add(tabId);
  }

  await Promise.all(Array.from(tabIds, (tabId) => updateBadge(tabId)));
}

async function hasOffscreenDocument(): Promise<boolean> {
  const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (options: {
      contextTypes?: string[];
      documentUrls?: string[];
    }) => Promise<Array<{ documentUrl?: string }>>;
  };

  if (!runtimeWithContexts.getContexts) {
    return false;
  }

  const contexts = await runtimeWithContexts.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    return;
  }

  const offscreenApi = chrome.offscreen as typeof chrome.offscreen & {
    createDocument: (options: {
      url: string;
      reasons: string[];
      justification: string;
    }) => Promise<void>;
  };

  await offscreenApi.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Açılır pencere kapalıyken kamera tabanlı el ve yüz takibini çalıştır.",
  });
}

async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) {
    return;
  }

  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Ignore repeated close attempts during shutdown.
  }
}

async function buildAppState(): Promise<AppState> {
  const activeTab = await getActiveTab();
  const activeTabId = activeTab?.id ?? null;
  const settings = await getSettings();

  return {
    activeTabId,
    activePage: activeTabId ? getPageStatus(activeTabId, activeTab ?? undefined) : null,
    targetPage: controllerState.activeTabId
      ? getPageStatus(controllerState.activeTabId)
      : null,
    settings,
    controller: controllerState,
  };
}

function createActionResponse(ok: boolean, message: string): ControllerActionResponse {
  return {
    ok,
    message,
    state: controllerState,
  };
}

async function startController(tabId: number): Promise<ControllerActionResponse> {
  const previousTargetTabId = controllerState.activeTabId;
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedTab(tab)) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      lastCommandMessage: "GestureFlow'u açmadan önce normal bir HTTP veya HTTPS video sayfası açın.",
      error: "Desteklenmeyen sayfa.",
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
      lastCommandMessage: "Bu sekmede aktif HTML5 video bulunamadı.",
      error: "Desteklenen video algılanmadı.",
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
    error: undefined,
    lastCommandMessage: "Kamera takibi başlatılıyor.",
  });
  scheduleOverlaySyncForTabs([previousTargetTabId, tabId]);
  await updateKnownBadges();

  try {
    await ensureOffscreenDocument();
    const response = (await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.offscreenStart,
      settings,
    } satisfies RuntimeMessage)) as { ok?: boolean; message?: string } | undefined;

    if (!response?.ok) {
      throw new Error(response?.message ?? "Arka plan kontrolü başlatılamadı.");
    }

    return createActionResponse(
      true,
      "Hareket kontrolü geçerli ayarlarla başlatılıyor.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Arka plan kontrolü başlatılamadı.";
    mergeControllerState({
      status: "error",
      cameraStatus: "error",
      error: message,
      lastCommandMessage: message,
    });
    await closeOffscreenDocument();
    await updateKnownBadges();
    return createActionResponse(false, message);
  }
}

async function startVisibleController(tabId: number): Promise<ControllerActionResponse> {
  const previousTargetTabId = controllerState.activeTabId;
  const tab = await chrome.tabs.get(tabId);
  if (!isSupportedTab(tab)) {
    mergeControllerState({
      ...EMPTY_CONTROLLER_STATE,
      status: "error",
      lastCommandMessage: "GestureFlow'u açmadan önce normal bir HTTP veya HTTPS video sayfası açın.",
      error: "Desteklenmeyen sayfa.",
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
      lastCommandMessage: "Bu sekmede aktif HTML5 video bulunamadı.",
      error: "Desteklenen video algılanmadı.",
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
      error: undefined,
      lastCommandMessage: "Görünür kamera izin sayfası açılıyor.",
    });
    scheduleOverlaySyncForTabs([previousTargetTabId, tabId]);
    await updateKnownBadges();

    const cameraPermissionTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(CAMERA_PERMISSION_PAGE_PATH),
      active: true,
    });
    visibleCameraPermissionTabId = cameraPermissionTab.id ?? null;

    return createActionResponse(
      true,
      "Kamera izin sayfası açıldı. Devam etmek için orada kameraya izin verin.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kamera izin sayfası açılamadı.";
    mergeControllerState({
      status: "error",
      cameraStatus: "error",
      error: message,
      lastCommandMessage: message,
    });
    await updateKnownBadges();
    return createActionResponse(false, message);
  }
}

async function stopController(
  message = "Hareket kontrolü durduruldu.",
): Promise<ControllerActionResponse> {
  const previousTargetTabId = controllerState.activeTabId;

  mergeControllerState({
    status: "stopping",
    lastCommandMessage: "Kamera takibi durduruluyor.",
  });
  await updateKnownBadges();

  try {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.offscreenStop,
    } satisfies RuntimeMessage);
  } catch {
    // Ignore cases where the offscreen document is already gone.
  }
  await closeOffscreenDocument();

  visibleCameraPermissionTabId = null;
  controllerPreviewDataUrl = null;
  controllerState = {
    ...EMPTY_CONTROLLER_STATE,
    lastCommandMessage: message,
    updatedAt: Date.now(),
  };
  scheduleOverlaySync(previousTargetTabId);

  if (previousTargetTabId) {
    await updateBadge(previousTargetTabId);
  }

  return createActionResponse(true, message);
}

async function executeCommandOnTarget(
  message: Extract<RuntimeMessage, { type: typeof MESSAGE_TYPES.executeVideoCommand }>,
): Promise<ExecuteCommandResponse> {
  const targetTabId = controllerState.activeTabId;
  if (!targetTabId) {
    return {
      ok: false,
      command: message.command,
      applied: false,
      message: "Hedef video sekmesi seçilmedi.",
      status: createEmptyPageStatus(-1),
      options: {
        seekSeconds: message.seekSeconds,
        volumeDelta: message.volumeDelta,
        playbackRateDelta: message.playbackRateDelta,
        reason: message.reason,
      },
    };
  }

  const response = await sendMessageToTab<ExecuteCommandResponse>(targetTabId, message);
  if (!response) {
    const latestStatus = await refreshPageStatusForTab(targetTabId);
    mergeControllerState({
      status: "error",
      error: "Video sekmesine ulaşılamadı.",
      lastCommandMessage: "GestureFlow hedef sekmeyle bağlantıyı kaybetti.",
    });
    await updateKnownBadges();

    return {
      ok: false,
      command: message.command,
      applied: false,
      message: "GestureFlow hedef sekmeye ulaşamadı.",
      status: latestStatus,
      options: {
        seekSeconds: message.seekSeconds,
        volumeDelta: message.volumeDelta,
        playbackRateDelta: message.playbackRateDelta,
        reason: message.reason,
      },
    };
  }

  pageStateStore.set(targetTabId, {
    ...response.status,
    tabId: targetTabId,
    lastUpdatedAt: Date.now(),
  });

  mergeControllerState({
    status: "active",
    lastCommand: message.command,
    lastCommandMessage: response.message,
    error: undefined,
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

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.pageStatusUpdated) {
    const tabId = sender.tab?.id ?? message.status.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false });
      return;
    }

    pageStateStore.set(tabId, {
      ...message.status,
      tabId,
      lastUpdatedAt: Date.now(),
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
        state: buildPageOverlayState(-1),
      } satisfies PageOverlayStateResponse);
      return;
    }

    sendResponse({
      ok: true,
      state: buildPageOverlayState(tabId),
    } satisfies PageOverlayStateResponse);
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
        state,
      } satisfies AppStateResponse);
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
            settings,
          } satisfies RuntimeMessage);
        } catch (error) {
          const failureMessage =
            error instanceof Error ? error.message : "Yeni ayarlar eşitlenemedi.";
          mergeControllerState({
            status: "error",
            error: failureMessage,
            lastCommandMessage: failureMessage,
          });
        }
      }

      sendResponse(createActionResponse(true, "Ayarlar güncellendi."));
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
      void stopController("Hareket kontrolü durduruldu çünkü kamera izin sekmesi kapatıldı.");
    }
  } else if (controllerState.activeTabId === tabId) {
    void stopController("Hareket kontrolü durduruldu çünkü hedef sekme kapatıldı.");
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
