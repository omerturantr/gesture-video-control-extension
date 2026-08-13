import type {
  ControllerRuntimeState,
  ExtensionSettings,
  GestureLabel,
  HoldAction,
  SensitivityMode,
  VideoCommand,
} from "./types";

export const PRODUCT_NAME = "GestureFlow Kontrol";
export const PRODUCT_TAGLINE = "HTML5 video oynatıcıları için eller serbest kontrol";
export const MODEL_FILENAME = "gesture_recognizer.task";
export const FACE_MODEL_FILENAME = "face_landmarker.task";
export const MEDIAPIPE_WASM_DIR = "vendor/mediapipe/wasm";

export const DEFAULT_SETTINGS: ExtensionSettings = {
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
};

export const EMPTY_CONTROLLER_STATE: ControllerRuntimeState = {
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
  lastCommandMessage: "Hazır.",
  attentionElapsedMs: 0,
  eyeClosureElapsedMs: 0,
  updatedAt: 0,
};

export const SEEK_OPTIONS = [5, 10, 15, 30];
export const VOLUME_STEP_OPTIONS = [4, 6, 8, 10, 15];
export const HOLD_ACCELERATION_OPTIONS = [15, 25, 35, 50, 75];
export const PLAYBACK_RATE_STEP_OPTIONS = [0.05, 0.1, 0.25];
export const TIMEOUT_OPTIONS = [1.5, 2, 3, 4, 5, 7];

export const COMMAND_LABELS: Record<VideoCommand, string> = {
  PLAY: "Oynat",
  PAUSE: "Duraklat",
  TOGGLE_PLAYBACK: "Oynat / duraklat",
  SEEK_FORWARD: "İleri sar",
  SEEK_BACKWARD: "Geri sar",
  VOLUME_UP: "Sesi artır",
  VOLUME_DOWN: "Sesi azalt",
  PLAYBACK_RATE_UP: "Hızı artır",
  PLAYBACK_RATE_DOWN: "Hızı azalt",
  TOGGLE_FULLSCREEN: "Tam ekran",
  MUTE: "Sessize al",
};

export const GESTURE_LABELS: Record<GestureLabel, string> = {
  NONE: "Boşta",
  NO_HAND: "El algılanmadı",
  OPEN_PALM: "Açık avuç",
  CLOSED_FIST: "Kapalı yumruk",
  MODIFIER_FIST: "Yardımcı yumruk",
  THUMB_UP: "Başparmak yukarı",
  THUMB_DOWN: "Başparmak aşağı",
  THUMB_LEFT: "Başparmak sola",
  THUMB_RIGHT: "Başparmak sağa",
  TRACKING: "El izleniyor",
};

export const HOLD_ACTION_LABELS: Record<HoldAction, string> = {
  NONE: "Boşta",
  SEEK_FORWARD: "İleri sarılıyor",
  SEEK_BACKWARD: "Geri sarılıyor",
  VOLUME_UP: "Ses artırılıyor",
  VOLUME_DOWN: "Ses azaltılıyor",
  PLAYBACK_RATE_UP: "Hız artırılıyor",
  PLAYBACK_RATE_DOWN: "Hız azaltılıyor",
};

export const VIDEO_SCAN_INTERVAL_MS = 1500;
export const STATUS_POLL_INTERVAL_MS = 750;
export const VIDEO_SELECTION_MIN_AREA = 18_000;
export const VIDEO_SELECTION_MIN_VISIBLE_RATIO = 0.2;
export const PLAYBACK_RATE_MIN = 0.25;
export const PLAYBACK_RATE_MAX = 3;

export const SENSITIVITY_PRESETS: Record<
  SensitivityMode,
  {
    staticConfidenceThreshold: number;
    holdConfidenceThreshold: number;
    oneShotConfirmationFrames: number;
    holdConfirmationFrames: number;
    releaseFrames: number;
    oneShotCooldownMs: number;
    holdBaseIntervalMs: number;
    holdMinIntervalMs: number;
    seekHoldMinConfidence: number;
    thumbHoldMinConfidence: number;
  }
> = {
  relaxed: {
    staticConfidenceThreshold: 0.62,
    holdConfidenceThreshold: 0.56,
    oneShotConfirmationFrames: 2,
    holdConfirmationFrames: 3,
    releaseFrames: 2,
    oneShotCooldownMs: 900,
    holdBaseIntervalMs: 460,
    holdMinIntervalMs: 220,
    seekHoldMinConfidence: 0.44,
    thumbHoldMinConfidence: 0.4,
  },
  balanced: {
    staticConfidenceThreshold: 0.5,
    holdConfidenceThreshold: 0.46,
    oneShotConfirmationFrames: 1,
    holdConfirmationFrames: 2,
    releaseFrames: 1,
    oneShotCooldownMs: 550,
    holdBaseIntervalMs: 380,
    holdMinIntervalMs: 180,
    seekHoldMinConfidence: 0.36,
    thumbHoldMinConfidence: 0.32,
  },
  responsive: {
    staticConfidenceThreshold: 0.42,
    holdConfidenceThreshold: 0.4,
    oneShotConfirmationFrames: 1,
    holdConfirmationFrames: 1,
    releaseFrames: 1,
    oneShotCooldownMs: 420,
    holdBaseIntervalMs: 260,
    holdMinIntervalMs: 110,
    seekHoldMinConfidence: 0.3,
    thumbHoldMinConfidence: 0.26,
  },
};
