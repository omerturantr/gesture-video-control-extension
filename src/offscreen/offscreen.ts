import {
  MESSAGE_TYPES,
  type ExecuteCommandResponse,
  type RuntimeMessage,
} from "../shared/messaging";
import { setCameraAccessPrimed } from "../shared/storage";
import type {
  ControllerRuntimeState,
  ExtensionSettings,
  GestureEngineSnapshot,
  StableGestureEvent,
} from "../shared/types";
import { GestureSession } from "../gesture/session";

let gestureSession: GestureSession | null = null;
let runtimeState: Partial<ControllerRuntimeState> = {};
let pendingSyncId: number | null = null;
let lastSyncedPayload = "";

function mergeRuntimeState(partialState: Partial<ControllerRuntimeState>) {
  runtimeState = {
    ...runtimeState,
    ...partialState,
    updatedAt: Date.now(),
  };
  scheduleStateSync();
}

async function syncState(force = false) {
  const payload = JSON.stringify(runtimeState);
  if (!force && payload === lastSyncedPayload) {
    return;
  }

  lastSyncedPayload = payload;
  await chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.offscreenStateUpdated,
    state: runtimeState,
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
    debug: snapshot.debug,
  });
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
      event.commandOptions?.reason ?? "Hareket komutu sayfaya gönderiliyor.",
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
      lastCommandMessage: "Hareket kontrolü arka planda çalışıyor.",
      error: "",
    });
    scheduleStateSync(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hareket kontrolü başlatılamadı.";
    const isPermissionError =
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "SecurityError");

    if (isPermissionError) {
      await setCameraAccessPrimed(false);
    }

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
      lastCommandMessage: isPermissionError
        ? "Kamera izni reddedildi."
        : message,
      error: message,
    });
    scheduleStateSync(true);
    throw error;
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
  scheduleStateSync(true);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.offscreenStart) {
    void startSession(message.settings)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        const responseMessage =
          error instanceof Error ? error.message : "GestureFlow başlatılamadı.";
        sendResponse({ ok: false, message: responseMessage });
      });
    return true;
  }

  if (message.type === MESSAGE_TYPES.offscreenStop) {
    void stopSession().then(() => {
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
