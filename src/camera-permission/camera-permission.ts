import { GestureSession } from "../gesture/session";
import {
  MESSAGE_TYPES,
  type ControllerActionResponse,
  type ExecuteCommandResponse,
  type RuntimeMessage,
} from "../shared/messaging";
import { getStoredSettings } from "../shared/storage";
import type {
  ControllerRuntimeState,
  ExtensionSettings,
  GestureEngineSnapshot,
  StableGestureEvent,
} from "../shared/types";

const statusElement = document.querySelector<HTMLElement>("#status");
const actionButton = document.querySelector<HTMLButtonElement>("#allow-camera");
const STATE_SYNC_GRANULARITY_MS = 250;

if (!statusElement || !actionButton) {
  throw new Error("Kamera kontrol sayfası başlatılamadı.");
}

const statusLabel = statusElement;
const cameraButton = actionButton;

let gestureSession: GestureSession | null = null;
let runtimeState: Partial<ControllerRuntimeState> = {};
let pendingSyncId: number | null = null;
let lastSyncedPayload = "";

function setStatus(message: string) {
  statusLabel.textContent = message;
}

function setActionButton(label: string, disabled = false) {
  cameraButton.textContent = label;
  cameraButton.disabled = disabled;
}

function formatControllerError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Chrome kamera isteğini engelledi. Bu sekmede kameraya izin verip yeniden deneyin.";
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "Bu cihazda kamera bulunamadı.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Chrome kamerayı buldu fakat kamera kullanımda. Diğer kamera uygulamalarını veya sekmeleri kapatıp yeniden deneyin.";
    }
  }

  return error instanceof Error && error.message
    ? `Kamera kontrolü başarısız oldu: ${error.message}`
    : "Bilinmeyen kamera kontrol hatası.";
}

function mergeRuntimeState(partialState: Partial<ControllerRuntimeState>) {
  runtimeState = {
    ...runtimeState,
    ...partialState,
    updatedAt: Date.now(),
  };
  scheduleStateSync();
}

function roundElapsedMs(value: number | undefined): number {
  if (!value || value <= 0) {
    return 0;
  }

  return Math.round(value / STATE_SYNC_GRANULARITY_MS) * STATE_SYNC_GRANULARITY_MS;
}

function createSyncedState(
  state: Partial<ControllerRuntimeState>,
): Partial<ControllerRuntimeState> {
  return {
    ...state,
    attentionElapsedMs: roundElapsedMs(state.attentionElapsedMs),
    eyeClosureElapsedMs: roundElapsedMs(state.eyeClosureElapsedMs),
  };
}

async function syncState(force = false) {
  const nextState = createSyncedState(runtimeState);
  const payload = JSON.stringify(nextState);
  if (!force && payload === lastSyncedPayload) {
    return;
  }

  lastSyncedPayload = payload;
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.offscreenStateUpdated,
    state: nextState,
  } satisfies RuntimeMessage);
}

function scheduleStateSync(force = false) {
  if (force) {
    void syncState(true);
    return;
  }

  if (pendingSyncId) {
    return;
  }

  pendingSyncId = window.setTimeout(() => {
    pendingSyncId = null;
    void syncState();
  }, 120);
}

function updateFromSnapshot(snapshot: GestureEngineSnapshot) {
  mergeRuntimeState({
    status: "active",
    cameraStatus: "ready",
    trackingStatus: snapshot.handDetected ? "detected" : "not_detected",
    handVisible: snapshot.handDetected,
    faceDetected: snapshot.faceDetected,
    attentionState: snapshot.attentionState,
    eyeState: snapshot.eyeState,
    currentGesture: snapshot.displayGesture,
    activeHoldAction: snapshot.activeHoldAction,
    attentionElapsedMs: snapshot.attentionElapsedMs,
    eyeClosureElapsedMs: snapshot.eyeClosureElapsedMs,
  });

  setStatus(
    snapshot.handDetected
      ? "Kamera hazır. El algılandı. Video sekmenize dönün ve bu sayfayı açık bırakın."
      : "Kamera hazır. Videoyu kontrol ederken bu sayfayı açık bırakın.",
  );
}

async function dispatchGestureCommand(event: StableGestureEvent) {
  if (!event.command) {
    return;
  }

  mergeRuntimeState({
    status: "active",
    lastStableGesture: event.label,
    lastCommand: event.command,
    lastCommandMessage:
      event.commandOptions?.reason ?? "Hareket komutu video sekmesine gönderiliyor.",
    error: "",
  });
  scheduleStateSync(true);

  const response = (await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.executeVideoCommand,
    command: event.command,
    seekSeconds: event.commandOptions?.seekSeconds,
    volumeDelta: event.commandOptions?.volumeDelta,
    playbackRateDelta: event.commandOptions?.playbackRateDelta,
    reason: event.commandOptions?.reason,
    source: "gesture",
  } satisfies RuntimeMessage)) as ExecuteCommandResponse;
  gestureSession?.handleCommandFeedback(event.command, response.applied);

  mergeRuntimeState({
    status: response.ok ? "active" : "error",
    lastCommand: event.command,
    lastCommandMessage: response.message,
    error: response.ok ? "" : response.message,
  });
  scheduleStateSync(true);
}

async function startSession(settings: ExtensionSettings) {
  if (gestureSession) {
    gestureSession.updateSettings(settings);
    setStatus("Kamera kontrolü zaten çalışıyor.");
    setActionButton("Kontrolü durdur");
    return;
  }

  mergeRuntimeState({
    status: "starting",
    cameraStatus: "requesting",
    trackingStatus: "idle",
    handVisible: false,
    faceDetected: false,
    currentGesture: "NONE",
    activeHoldAction: "NONE",
    attentionElapsedMs: 0,
    eyeClosureElapsedMs: 0,
    lastCommandMessage: "Kamera izni isteniyor.",
    error: "",
  });
  scheduleStateSync(true);
  setStatus("Kamera izni isteniyor.");
  setActionButton("Başlatılıyor...", true);

  try {
    gestureSession = new GestureSession({
      settings,
      onSnapshot: updateFromSnapshot,
      onStableGesture: dispatchGestureCommand,
    });
    await gestureSession.start();

    mergeRuntimeState({
      status: "active",
      cameraStatus: "ready",
      lastCommandMessage: "Kamera kontrolü etkin.",
      error: "",
    });
    scheduleStateSync(true);
    setStatus("Kamera hazır. Video sekmenize dönün ve bu sayfayı açık bırakın.");
    setActionButton("Kontrolü durdur");
  } catch (error) {
    const message = formatControllerError(error);
    const isPermissionError =
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError");

    gestureSession = null;
    mergeRuntimeState({
      status: "error",
      cameraStatus: isPermissionError ? "blocked" : "error",
      trackingStatus: "idle",
      handVisible: false,
      faceDetected: false,
      currentGesture: "NONE",
      activeHoldAction: "NONE",
      attentionElapsedMs: 0,
      eyeClosureElapsedMs: 0,
      lastCommandMessage: message,
      error: message,
    });
    scheduleStateSync(true);
    setStatus(message);
    setActionButton("Kamerayı yeniden dene");
  }
}

async function stopSession(message = "Hareket kontrolü durduruldu.") {
  if (gestureSession) {
    await gestureSession.stop();
    gestureSession = null;
  }

  runtimeState = {
    status: "idle",
    cameraStatus: "idle",
    trackingStatus: "idle",
    handVisible: false,
    faceDetected: false,
    attentionState: "unknown",
    eyeState: "unknown",
    currentGesture: "NONE",
    activeHoldAction: "NONE",
    lastStableGesture: "NONE",
    lastCommand: runtimeState.lastCommand ?? null,
    lastCommandMessage: message,
    attentionElapsedMs: 0,
    eyeClosureElapsedMs: 0,
    error: "",
    updatedAt: Date.now(),
  };
  setStatus(message);
  setActionButton("Kamerayı başlat");
  scheduleStateSync(true);
}

async function toggleSession() {
  if (gestureSession) {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.stopController,
      } satisfies RuntimeMessage)) as ControllerActionResponse | undefined;
      await stopSession(response?.message ?? "Hareket kontrolü durduruldu. Bu sekmeyi kapatabilirsiniz.");
    } catch {
      await stopSession("Hareket kontrolü durduruldu. Bu sekmeyi kapatabilirsiniz.");
    }
    return;
  }

  const settings = await getStoredSettings();
  await startSession(settings);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.offscreenStop) {
    void stopSession("Hareket kontrolü durduruldu.").then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.offscreenUpdateSettings) {
    gestureSession?.updateSettings(message.settings);
    sendResponse({ ok: true });
    return;
  }
});

window.addEventListener("beforeunload", () => {
  void stopSession("Hareket kontrolü durduruldu.");
});

cameraButton.addEventListener("click", () => {
  void toggleSession();
});

async function initialize() {
  setStatus("Kamera kontrolü açılıyor.");
  setActionButton("Başlatılıyor...", true);
  const settings = await getStoredSettings();
  await startSession(settings);
}

void initialize();
