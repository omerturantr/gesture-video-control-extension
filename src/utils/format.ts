import {
  COMMAND_LABELS,
  GESTURE_LABELS,
  HOLD_ACTION_LABELS,
} from "../shared/config";
import type {
  AttentionState,
  EyeState,
  GestureLabel,
  HoldAction,
  VideoCommand,
} from "../shared/types";

export function formatGestureLabel(label: GestureLabel): string {
  return GESTURE_LABELS[label] ?? label;
}

export function formatHoldActionLabel(action: HoldAction): string {
  return HOLD_ACTION_LABELS[action] ?? action;
}

export function formatCommandLabel(command: VideoCommand | null): string {
  return command ? COMMAND_LABELS[command] : "Yok";
}

export function formatAttentionLabel(state: AttentionState, faceDetected: boolean): string {
  if (!faceDetected) {
    return "Yüz yok";
  }

  if (state === "looking") {
    return "Ekranda";
  }

  if (state === "away") {
    return "Başka yöne bakıyor";
  }

  return "Kontrol ediliyor";
}

export function formatEyeLabel(state: EyeState, faceDetected: boolean): string {
  if (!faceDetected) {
    return "Yüz yok";
  }

  if (state === "open") {
    return "Gözler açık";
  }

  if (state === "closed") {
    return "Gözler kapalı";
  }

  return "Kontrol ediliyor";
}

export function formatVolumePercent(volume: number, muted: boolean): string {
  const percent = Math.round(volume * 100);
  return muted || percent === 0 ? `${percent}% sessiz` : `${percent}%`;
}
