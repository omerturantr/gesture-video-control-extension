// src/shared/config.ts
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
var COMMAND_LABELS = {
  PLAY: "Oynat",
  PAUSE: "Duraklat",
  TOGGLE_PLAYBACK: "Oynat / duraklat",
  SEEK_FORWARD: "\u0130leri sar",
  SEEK_BACKWARD: "Geri sar",
  VOLUME_UP: "Sesi art\u0131r",
  VOLUME_DOWN: "Sesi azalt",
  PLAYBACK_RATE_UP: "H\u0131z\u0131 art\u0131r",
  PLAYBACK_RATE_DOWN: "H\u0131z\u0131 azalt",
  TOGGLE_FULLSCREEN: "Tam ekran",
  MUTE: "Sessize al"
};
var GESTURE_LABELS = {
  NONE: "Bo\u015Fta",
  NO_HAND: "El alg\u0131lanmad\u0131",
  OPEN_PALM: "A\xE7\u0131k avu\xE7",
  CLOSED_FIST: "Kapal\u0131 yumruk",
  MODIFIER_FIST: "Yard\u0131mc\u0131 yumruk",
  THUMB_UP: "Ba\u015Fparmak yukar\u0131",
  THUMB_DOWN: "Ba\u015Fparmak a\u015Fa\u011F\u0131",
  THUMB_LEFT: "Ba\u015Fparmak sola",
  THUMB_RIGHT: "Ba\u015Fparmak sa\u011Fa",
  TRACKING: "El izleniyor"
};
var HOLD_ACTION_LABELS = {
  NONE: "Bo\u015Fta",
  SEEK_FORWARD: "\u0130leri sar\u0131l\u0131yor",
  SEEK_BACKWARD: "Geri sar\u0131l\u0131yor",
  VOLUME_UP: "Ses art\u0131r\u0131l\u0131yor",
  VOLUME_DOWN: "Ses azalt\u0131l\u0131yor",
  PLAYBACK_RATE_UP: "H\u0131z art\u0131r\u0131l\u0131yor",
  PLAYBACK_RATE_DOWN: "H\u0131z azalt\u0131l\u0131yor"
};
var STATUS_POLL_INTERVAL_MS = 750;

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
var CAMERA_ACCESS_PRIMED_KEY = "gestureFlowCameraAccessPrimed";
async function getCameraAccessPrimed() {
  const result = await chrome.storage.local.get(CAMERA_ACCESS_PRIMED_KEY);
  return Boolean(result[CAMERA_ACCESS_PRIMED_KEY]);
}
async function setCameraAccessPrimed(isPrimed) {
  await chrome.storage.local.set({
    [CAMERA_ACCESS_PRIMED_KEY]: isPrimed
  });
}

// src/utils/format.ts
function formatGestureLabel(label) {
  return GESTURE_LABELS[label] ?? label;
}
function formatHoldActionLabel(action) {
  return HOLD_ACTION_LABELS[action] ?? action;
}
function formatCommandLabel(command) {
  return command ? COMMAND_LABELS[command] : "Yok";
}
function formatAttentionLabel(state, faceDetected) {
  if (!faceDetected) {
    return "Y\xFCz yok";
  }
  if (state === "looking") {
    return "Ekranda";
  }
  if (state === "away") {
    return "Ba\u015Fka y\xF6ne bak\u0131yor";
  }
  return "Kontrol ediliyor";
}
function formatEyeLabel(state, faceDetected) {
  if (!faceDetected) {
    return "Y\xFCz yok";
  }
  if (state === "open") {
    return "G\xF6zler a\xE7\u0131k";
  }
  if (state === "closed") {
    return "G\xF6zler kapal\u0131";
  }
  return "Kontrol ediliyor";
}

// src/utils/dom.ts
function requireElement(selector, parent = document) {
  const element = parent.querySelector(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

// src/popup/popup.ts
var elements = {
  cameraChip: requireElement("#camera-chip"),
  targetLabel: requireElement("#target-label"),
  toggleSessionButton: requireElement("#toggle-session"),
  toggleLabel: requireElement("#toggle-label"),
  toggleHint: requireElement("#toggle-hint"),
  runtimeMessage: requireElement("#runtime-message"),
  videoStatus: requireElement("#video-status"),
  videoDetail: requireElement("#video-detail"),
  attentionStatus: requireElement("#attention-status"),
  attentionDetail: requireElement("#attention-detail"),
  eyesStatus: requireElement("#eyes-status"),
  eyesDetail: requireElement("#eyes-detail"),
  currentGesture: requireElement("#current-gesture"),
  currentAction: requireElement("#current-action"),
  lastCommand: requireElement("#last-command"),
  seekSeconds: requireElement("#seek-seconds"),
  volumeStep: requireElement("#volume-step"),
  holdAcceleration: requireElement("#hold-acceleration"),
  sensitivity: requireElement("#sensitivity"),
  attentionEnabled: requireElement("#attention-enabled"),
  attentionTimeout: requireElement("#attention-timeout"),
  eyesEnabled: requireElement("#eyes-enabled"),
  eyesTimeout: requireElement("#eyes-timeout"),
  debugClassifier: requireElement("#debug-classifier")
};
var appState = {
  activeTabId: null,
  activePage: null,
  targetPage: null,
  settings: {
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
  },
  controller: {
    ...EMPTY_CONTROLLER_STATE
  }
};
var localCameraStatus = "idle";
var localCameraMessage = "GestureFlow ba\u015Flat\u0131ld\u0131\u011F\u0131nda kamera izni isteyecek.";
function formatCameraPrimeError(error) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        status: "blocked",
        detail: "Kamera izni reddedildi. Uzant\u0131 i\xE7in kameraya izin verip yeniden deneyin."
      };
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        status: "error",
        detail: "Bu cihazda kamera bulunamad\u0131."
      };
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return {
        status: "error",
        detail: "Kamera ba\u015Fka bir uygulama veya sekmede kullan\u0131l\u0131yor. Kapat\u0131p yeniden deneyin."
      };
    }
  }
  return {
    status: "error",
    detail: error instanceof Error ? error.message : "Kameraya eri\u015Filemedi."
  };
}
async function ensureCameraAccessPrimed() {
  const shouldReprime = !await getCameraAccessPrimed() || appState.controller.cameraStatus === "blocked";
  if (!shouldReprime) {
    localCameraStatus = "ready";
    localCameraMessage = "Kamera izni haz\u0131r.";
    render();
    return true;
  }
  localCameraStatus = "requesting";
  localCameraMessage = "GestureFlow'u ba\u015Flatmak i\xE7in kamera iznini onaylay\u0131n.";
  render();
  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true
    });
    await setCameraAccessPrimed(true);
    localCameraStatus = "ready";
    localCameraMessage = "Kamera izni verildi.";
    return true;
  } catch (error) {
    await setCameraAccessPrimed(false);
    const failure = formatCameraPrimeError(error);
    localCameraStatus = failure.status;
    localCameraMessage = failure.detail;
    return false;
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    render();
  }
}
function formatPageLabel(status) {
  if (!status?.title && !status?.url) {
    return "Kontrol etmek istedi\u011Finiz video sekmesini a\xE7\u0131n";
  }
  if (!status?.url) {
    return status.title ?? "Ge\xE7erli sekme";
  }
  try {
    const hostname = new URL(status.url).hostname.replace(/^www\./, "");
    return `${status.title ?? "Ge\xE7erli sekme"} - ${hostname}`;
  } catch {
    return status.title ?? status.url;
  }
}
function formatCountdownLabel(elapsedMs, timeoutSeconds) {
  const elapsedSeconds = Math.min(elapsedMs / 1e3, timeoutSeconds);
  return `${elapsedSeconds.toFixed(1)} / ${timeoutSeconds.toFixed(1)} sn`;
}
function getDisplayedPage() {
  return appState.controller.activeTabId ? appState.targetPage : appState.activePage;
}
function getEffectiveCameraStatus() {
  const controller = appState.controller;
  if (controller.status === "active" || controller.status === "starting" || controller.status === "stopping" || controller.cameraStatus !== "idle") {
    return {
      status: controller.cameraStatus,
      detail: controller.lastCommandMessage
    };
  }
  return {
    status: localCameraStatus,
    detail: localCameraMessage
  };
}
function setFormValues(settings) {
  elements.seekSeconds.value = String(settings.seekSeconds);
  elements.volumeStep.value = String(settings.volumeStepPercent);
  elements.holdAcceleration.value = String(settings.holdAccelerationPercent);
  elements.sensitivity.value = settings.sensitivity;
  elements.attentionEnabled.checked = settings.attentionGuardEnabled;
  elements.attentionTimeout.value = String(settings.attentionTimeoutSeconds);
  elements.eyesEnabled.checked = settings.eyeClosureGuardEnabled;
  elements.eyesTimeout.value = String(settings.eyeClosureTimeoutSeconds);
  elements.attentionTimeout.disabled = !settings.attentionGuardEnabled;
  elements.eyesTimeout.disabled = !settings.eyeClosureGuardEnabled;
  elements.debugClassifier.checked = settings.debugClassifier;
}
function render() {
  const controller = appState.controller;
  const settings = appState.settings;
  const page = getDisplayedPage();
  const { status: cameraStatus, detail: cameraDetail } = getEffectiveCameraStatus();
  elements.targetLabel.textContent = formatPageLabel(page);
  elements.videoStatus.textContent = page?.videoDetected ? "Haz\u0131r" : "Video yok";
  elements.videoDetail.textContent = page?.primaryVideoReason ?? "GestureFlow'u kullanmak i\xE7in YouTube veya ba\u015Fka bir HTML5 video a\xE7\u0131n.";
  elements.attentionStatus.textContent = settings.attentionGuardEnabled ? formatAttentionLabel(controller.attentionState, controller.faceDetected) : "Kapal\u0131";
  elements.attentionDetail.textContent = settings.attentionGuardEnabled ? controller.attentionState === "away" ? `${formatCountdownLabel(
    controller.attentionElapsedMs,
    settings.attentionTimeoutSeconds
  )} sonra duraklat\u0131r.` : `Ekrandan ${settings.attentionTimeoutSeconds.toFixed(1)} saniye uzak kal\u0131nca duraklat\u0131r.` : "Bak\u0131\u015F korumas\u0131 kapal\u0131.";
  elements.eyesStatus.textContent = settings.eyeClosureGuardEnabled ? formatEyeLabel(controller.eyeState, controller.faceDetected) : "Kapal\u0131";
  elements.eyesDetail.textContent = settings.eyeClosureGuardEnabled ? controller.eyeState === "closed" ? `${formatCountdownLabel(
    controller.eyeClosureElapsedMs,
    settings.eyeClosureTimeoutSeconds
  )} sonra duraklat\u0131r.` : `G\xF6zler ${settings.eyeClosureTimeoutSeconds.toFixed(1)} saniye kapal\u0131 kal\u0131nca duraklat\u0131r.` : "G\xF6z kapama korumas\u0131 kapal\u0131.";
  elements.currentGesture.textContent = formatGestureLabel(controller.currentGesture);
  elements.currentAction.textContent = controller.activeHoldAction !== "NONE" ? formatHoldActionLabel(controller.activeHoldAction) : controller.lastCommand ? formatCommandLabel(controller.lastCommand) : "Bo\u015Fta";
  elements.lastCommand.textContent = formatCommandLabel(controller.lastCommand);
  elements.toggleSessionButton.classList.toggle("is-active", controller.status === "active");
  elements.toggleSessionButton.classList.toggle("is-error", controller.status === "error");
  elements.toggleSessionButton.setAttribute(
    "aria-pressed",
    controller.status === "active" ? "true" : "false"
  );
  elements.toggleSessionButton.disabled = controller.status === "starting" || localCameraStatus === "requesting";
  elements.toggleLabel.textContent = controller.status === "active" || controller.status === "starting" ? "Durdur" : "Ba\u015Flat";
  elements.toggleHint.textContent = controller.status === "active" ? "GestureFlow arka planda \xE7al\u0131\u015F\u0131yor." : "Kamera takibi arka planda \xE7al\u0131\u015F\u0131r.";
  elements.runtimeMessage.textContent = controller.lastCommandMessage || cameraDetail;
  elements.cameraChip.textContent = cameraStatus === "ready" ? "Kamera haz\u0131r" : cameraStatus === "requesting" ? "\u0130zin bekleniyor" : cameraStatus === "blocked" ? "Kamera engelli" : cameraStatus === "error" ? "Kamera hatas\u0131" : "Kamera bo\u015Fta";
  setFormValues(settings);
}
async function refreshState() {
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.getAppState
  });
  if (!response?.ok) {
    return;
  }
  appState = response.state;
  render();
}
async function applySettings(partial) {
  appState.settings = {
    ...appState.settings,
    ...partial
  };
  render();
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.updateSettings,
    settings: partial
  });
  await refreshState();
}
async function toggleController() {
  const controller = appState.controller;
  if (controller.status === "active" || controller.status === "starting") {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.stopController
    });
    await refreshState();
    return;
  }
  if (!appState.activeTabId) {
    return;
  }
  const cameraReady = await ensureCameraAccessPrimed();
  if (!cameraReady) {
    if (localCameraStatus === "blocked") {
      const response2 = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.startVisibleController,
        tabId: appState.activeTabId
      });
      appState.controller = response2.state;
      render();
      await refreshState();
    }
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.startController,
    tabId: appState.activeTabId
  });
  appState.controller = response.state;
  render();
  await refreshState();
}
function bindEvents() {
  elements.toggleSessionButton.addEventListener("click", () => {
    void toggleController();
  });
  elements.seekSeconds.addEventListener("change", () => {
    void applySettings({
      seekSeconds: Number(elements.seekSeconds.value)
    });
  });
  elements.volumeStep.addEventListener("change", () => {
    void applySettings({
      volumeStepPercent: Number(elements.volumeStep.value)
    });
  });
  elements.holdAcceleration.addEventListener("change", () => {
    void applySettings({
      holdAccelerationPercent: Number(elements.holdAcceleration.value)
    });
  });
  elements.sensitivity.addEventListener("change", () => {
    void applySettings({
      sensitivity: elements.sensitivity.value
    });
  });
  elements.attentionEnabled.addEventListener("change", () => {
    void applySettings({
      attentionGuardEnabled: elements.attentionEnabled.checked
    });
  });
  elements.attentionTimeout.addEventListener("change", () => {
    void applySettings({
      attentionTimeoutSeconds: Number(elements.attentionTimeout.value)
    });
  });
  elements.eyesEnabled.addEventListener("change", () => {
    void applySettings({
      eyeClosureGuardEnabled: elements.eyesEnabled.checked
    });
  });
  elements.eyesTimeout.addEventListener("change", () => {
    void applySettings({
      eyeClosureTimeoutSeconds: Number(elements.eyesTimeout.value)
    });
  });
  elements.debugClassifier.addEventListener("change", () => {
    void applySettings({
      debugClassifier: elements.debugClassifier.checked
    });
  });
}
async function initialize() {
  bindEvents();
  await refreshState();
  window.setInterval(() => {
    void refreshState();
  }, STATUS_POLL_INTERVAL_MS);
}
void initialize();
//# sourceMappingURL=popup.js.map
