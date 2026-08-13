import { EMPTY_CONTROLLER_STATE, STATUS_POLL_INTERVAL_MS } from "../shared/config";
import {
  MESSAGE_TYPES,
  type AppStateResponse,
  type ControllerActionResponse,
  type RuntimeMessage,
} from "../shared/messaging";
import {
  getCameraAccessPrimed,
  setCameraAccessPrimed,
} from "../shared/storage";
import type {
  AppState,
  CameraStatus,
  ExtensionSettings,
  PageStatus,
} from "../shared/types";
import {
  formatAttentionLabel,
  formatCommandLabel,
  formatEyeLabel,
  formatGestureLabel,
  formatHoldActionLabel,
} from "../utils/format";
import { requireElement } from "../utils/dom";

const elements = {
  cameraChip: requireElement<HTMLElement>("#camera-chip"),
  targetLabel: requireElement<HTMLElement>("#target-label"),
  toggleSessionButton: requireElement<HTMLButtonElement>("#toggle-session"),
  toggleLabel: requireElement<HTMLElement>("#toggle-label"),
  toggleHint: requireElement<HTMLElement>("#toggle-hint"),
  runtimeMessage: requireElement<HTMLElement>("#runtime-message"),
  videoStatus: requireElement<HTMLElement>("#video-status"),
  videoDetail: requireElement<HTMLElement>("#video-detail"),
  attentionStatus: requireElement<HTMLElement>("#attention-status"),
  attentionDetail: requireElement<HTMLElement>("#attention-detail"),
  eyesStatus: requireElement<HTMLElement>("#eyes-status"),
  eyesDetail: requireElement<HTMLElement>("#eyes-detail"),
  currentGesture: requireElement<HTMLElement>("#current-gesture"),
  currentAction: requireElement<HTMLElement>("#current-action"),
  lastCommand: requireElement<HTMLElement>("#last-command"),
  seekSeconds: requireElement<HTMLSelectElement>("#seek-seconds"),
  volumeStep: requireElement<HTMLSelectElement>("#volume-step"),
  holdAcceleration: requireElement<HTMLSelectElement>("#hold-acceleration"),
  sensitivity: requireElement<HTMLSelectElement>("#sensitivity"),
  attentionEnabled: requireElement<HTMLInputElement>("#attention-enabled"),
  attentionTimeout: requireElement<HTMLSelectElement>("#attention-timeout"),
  eyesEnabled: requireElement<HTMLInputElement>("#eyes-enabled"),
  eyesTimeout: requireElement<HTMLSelectElement>("#eyes-timeout"),
  debugClassifier: requireElement<HTMLInputElement>("#debug-classifier"),
};

let appState: AppState = {
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
    debugClassifier: false,
  },
  controller: {
    ...EMPTY_CONTROLLER_STATE,
  },
};

let localCameraStatus: CameraStatus = "idle";
let localCameraMessage = "GestureFlow başlatıldığında kamera izni isteyecek.";

function formatCameraPrimeError(error: unknown): { status: CameraStatus; detail: string } {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return {
        status: "blocked",
        detail: "Kamera izni reddedildi. Uzantı için kameraya izin verip yeniden deneyin.",
      };
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return {
        status: "error",
        detail: "Bu cihazda kamera bulunamadı.",
      };
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return {
        status: "error",
        detail: "Kamera başka bir uygulama veya sekmede kullanılıyor. Kapatıp yeniden deneyin.",
      };
    }
  }

  return {
    status: "error",
    detail: error instanceof Error ? error.message : "Kameraya erişilemedi.",
  };
}

async function ensureCameraAccessPrimed(): Promise<boolean> {
  const shouldReprime =
    !(await getCameraAccessPrimed()) || appState.controller.cameraStatus === "blocked";

  if (!shouldReprime) {
    localCameraStatus = "ready";
    localCameraMessage = "Kamera izni hazır.";
    render();
    return true;
  }

  localCameraStatus = "requesting";
  localCameraMessage = "GestureFlow'u başlatmak için kamera iznini onaylayın.";
  render();

  let stream: MediaStream | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: true,
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

function formatPageLabel(status: PageStatus | null): string {
  if (!status?.title && !status?.url) {
    return "Kontrol etmek istediğiniz video sekmesini açın";
  }

  if (!status?.url) {
    return status.title ?? "Geçerli sekme";
  }

  try {
    const hostname = new URL(status.url).hostname.replace(/^www\./, "");
    return `${status.title ?? "Geçerli sekme"} - ${hostname}`;
  } catch {
    return status.title ?? status.url;
  }
}

function formatCountdownLabel(elapsedMs: number, timeoutSeconds: number): string {
  const elapsedSeconds = Math.min(elapsedMs / 1000, timeoutSeconds);
  return `${elapsedSeconds.toFixed(1)} / ${timeoutSeconds.toFixed(1)} sn`;
}

function getDisplayedPage(): PageStatus | null {
  return appState.controller.activeTabId ? appState.targetPage : appState.activePage;
}

function getEffectiveCameraStatus(): { status: CameraStatus; detail: string } {
  const controller = appState.controller;
  if (
    controller.status === "active" ||
    controller.status === "starting" ||
    controller.status === "stopping" ||
    controller.cameraStatus !== "idle"
  ) {
    return {
      status: controller.cameraStatus,
      detail: controller.lastCommandMessage,
    };
  }

  return {
    status: localCameraStatus,
    detail: localCameraMessage,
  };
}

function setFormValues(settings: ExtensionSettings) {
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
  elements.videoStatus.textContent = page?.videoDetected ? "Hazır" : "Video yok";
  elements.videoDetail.textContent =
    page?.primaryVideoReason ?? "GestureFlow'u kullanmak için YouTube veya başka bir HTML5 video açın.";

  elements.attentionStatus.textContent = settings.attentionGuardEnabled
    ? formatAttentionLabel(controller.attentionState, controller.faceDetected)
    : "Kapalı";
  elements.attentionDetail.textContent = settings.attentionGuardEnabled
    ? controller.attentionState === "away"
      ? `${formatCountdownLabel(
          controller.attentionElapsedMs,
          settings.attentionTimeoutSeconds,
        )} sonra duraklatır.`
      : `Ekrandan ${settings.attentionTimeoutSeconds.toFixed(1)} saniye uzak kalınca duraklatır.`
    : "Bakış koruması kapalı.";

  elements.eyesStatus.textContent = settings.eyeClosureGuardEnabled
    ? formatEyeLabel(controller.eyeState, controller.faceDetected)
    : "Kapalı";
  elements.eyesDetail.textContent = settings.eyeClosureGuardEnabled
    ? controller.eyeState === "closed"
      ? `${formatCountdownLabel(
          controller.eyeClosureElapsedMs,
          settings.eyeClosureTimeoutSeconds,
        )} sonra duraklatır.`
      : `Gözler ${settings.eyeClosureTimeoutSeconds.toFixed(1)} saniye kapalı kalınca duraklatır.`
    : "Göz kapama koruması kapalı.";

  elements.currentGesture.textContent = formatGestureLabel(controller.currentGesture);
  elements.currentAction.textContent =
    controller.activeHoldAction !== "NONE"
      ? formatHoldActionLabel(controller.activeHoldAction)
      : controller.lastCommand
        ? formatCommandLabel(controller.lastCommand)
        : "Boşta";
  elements.lastCommand.textContent = formatCommandLabel(controller.lastCommand);

  elements.toggleSessionButton.classList.toggle("is-active", controller.status === "active");
  elements.toggleSessionButton.classList.toggle("is-error", controller.status === "error");
  elements.toggleSessionButton.setAttribute(
    "aria-pressed",
    controller.status === "active" ? "true" : "false",
  );
  elements.toggleSessionButton.disabled =
    controller.status === "starting" || localCameraStatus === "requesting";
  elements.toggleLabel.textContent =
    controller.status === "active" || controller.status === "starting" ? "Durdur" : "Başlat";
  elements.toggleHint.textContent =
    controller.status === "active"
      ? "GestureFlow arka planda çalışıyor."
      : "Kamera takibi arka planda çalışır.";
  elements.runtimeMessage.textContent = controller.lastCommandMessage || cameraDetail;

  elements.cameraChip.textContent =
    cameraStatus === "ready"
      ? "Kamera hazır"
      : cameraStatus === "requesting"
        ? "İzin bekleniyor"
        : cameraStatus === "blocked"
          ? "Kamera engelli"
          : cameraStatus === "error"
            ? "Kamera hatası"
            : "Kamera boşta";

  setFormValues(settings);
}

async function refreshState() {
  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.getAppState,
  } satisfies RuntimeMessage)) as AppStateResponse;

  if (!response?.ok) {
    return;
  }

  appState = response.state;
  render();
}

async function applySettings(partial: Partial<ExtensionSettings>) {
  appState.settings = {
    ...appState.settings,
    ...partial,
  };
  render();

  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.updateSettings,
    settings: partial,
  } satisfies RuntimeMessage);

  await refreshState();
}

async function toggleController() {
  const controller = appState.controller;

  if (controller.status === "active" || controller.status === "starting") {
    await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.stopController,
    } satisfies RuntimeMessage);
    await refreshState();
    return;
  }

  if (!appState.activeTabId) {
    return;
  }

  const cameraReady = await ensureCameraAccessPrimed();
  if (!cameraReady) {
    if (localCameraStatus === "blocked") {
      const response = (await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.startVisibleController,
        tabId: appState.activeTabId,
      } satisfies RuntimeMessage)) as ControllerActionResponse;

      appState.controller = response.state;
      render();
      await refreshState();
    }
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.startController,
    tabId: appState.activeTabId,
  } satisfies RuntimeMessage)) as ControllerActionResponse;

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
      seekSeconds: Number(elements.seekSeconds.value),
    });
  });

  elements.volumeStep.addEventListener("change", () => {
    void applySettings({
      volumeStepPercent: Number(elements.volumeStep.value),
    });
  });

  elements.holdAcceleration.addEventListener("change", () => {
    void applySettings({
      holdAccelerationPercent: Number(elements.holdAcceleration.value),
    });
  });

  elements.sensitivity.addEventListener("change", () => {
    void applySettings({
      sensitivity: elements.sensitivity.value as ExtensionSettings["sensitivity"],
    });
  });

  elements.attentionEnabled.addEventListener("change", () => {
    void applySettings({
      attentionGuardEnabled: elements.attentionEnabled.checked,
    });
  });

  elements.attentionTimeout.addEventListener("change", () => {
    void applySettings({
      attentionTimeoutSeconds: Number(elements.attentionTimeout.value),
    });
  });

  elements.eyesEnabled.addEventListener("change", () => {
    void applySettings({
      eyeClosureGuardEnabled: elements.eyesEnabled.checked,
    });
  });

  elements.eyesTimeout.addEventListener("change", () => {
    void applySettings({
      eyeClosureTimeoutSeconds: Number(elements.eyesTimeout.value),
    });
  });

  elements.debugClassifier.addEventListener("change", () => {
    void applySettings({
      debugClassifier: elements.debugClassifier.checked,
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
