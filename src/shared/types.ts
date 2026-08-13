export type VideoCommand =
  | "PLAY"
  | "PAUSE"
  | "TOGGLE_PLAYBACK"
  | "SEEK_FORWARD"
  | "SEEK_BACKWARD"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "PLAYBACK_RATE_UP"
  | "PLAYBACK_RATE_DOWN"
  | "TOGGLE_FULLSCREEN"
  | "MUTE";

export type GestureLabel =
  | "NONE"
  | "NO_HAND"
  | "OPEN_PALM"
  | "CLOSED_FIST"
  | "MODIFIER_FIST"
  | "THUMB_UP"
  | "THUMB_DOWN"
  | "THUMB_LEFT"
  | "THUMB_RIGHT"
  | "TRACKING";

export type HoldAction =
  | "NONE"
  | "SEEK_FORWARD"
  | "SEEK_BACKWARD"
  | "VOLUME_UP"
  | "VOLUME_DOWN"
  | "PLAYBACK_RATE_UP"
  | "PLAYBACK_RATE_DOWN";

export type CameraStatus = "idle" | "requesting" | "ready" | "blocked" | "error";
export type TrackingStatus = "idle" | "detected" | "not_detected";
export type ControllerStatus = "idle" | "starting" | "active" | "stopping" | "error";
export type SensitivityMode = "relaxed" | "balanced" | "responsive";
export type AttentionState = "unknown" | "looking" | "away";
export type EyeState = "unknown" | "open" | "closed";

export interface ExtensionSettings {
  seekSeconds: number;
  volumeStepPercent: number;
  holdAccelerationPercent: number;
  playbackRateStep: number;
  sensitivity: SensitivityMode;
  attentionGuardEnabled: boolean;
  attentionTimeoutSeconds: number;
  eyeClosureGuardEnabled: boolean;
  eyeClosureTimeoutSeconds: number;
  debugClassifier: boolean;
}

export interface ClassifierDebugInfo {
  primaryGesture: GestureLabel;
  primaryConfidence: number;
  cannedLabel: GestureLabel | null;
  cannedScore: number;
  curledCount: number;
  extendedCount: number;
  orientation: "palm" | "back" | "unknown";
}

export interface ActiveVideoSnapshot {
  paused: boolean;
  ended: boolean;
  muted: boolean;
  volume: number;
  currentTime: number;
  duration: number;
  playbackRate: number;
  readyState: number;
  title: string | null;
}

export interface PageStatus {
  pageSupported: boolean;
  tabId?: number;
  url?: string;
  title?: string;
  videoDetected: boolean;
  videoCount: number;
  multipleVideos: boolean;
  primaryVideoReason: string;
  lastUpdatedAt: number;
  snapshot: ActiveVideoSnapshot | null;
  error?: string;
}

export interface CommandOptions {
  seekSeconds?: number;
  volumeDelta?: number;
  playbackRateDelta?: number;
  reason?: string;
}

export interface CommandExecutionResult {
  ok: boolean;
  command: VideoCommand;
  applied: boolean;
  message: string;
  status: PageStatus;
  options?: CommandOptions;
}

export interface ControllerRuntimeState {
  status: ControllerStatus;
  cameraStatus: CameraStatus;
  trackingStatus: TrackingStatus;
  handVisible: boolean;
  faceDetected: boolean;
  attentionState: AttentionState;
  eyeState: EyeState;
  activeTabId: number | null;
  currentGesture: GestureLabel;
  activeHoldAction: HoldAction;
  lastStableGesture: GestureLabel;
  lastCommand: VideoCommand | null;
  lastCommandMessage: string;
  attentionElapsedMs: number;
  eyeClosureElapsedMs: number;
  error?: string;
  updatedAt: number;
  debug?: ClassifierDebugInfo;
}

export interface AppState {
  activeTabId: number | null;
  activePage: PageStatus | null;
  targetPage: PageStatus | null;
  settings: ExtensionSettings;
  controller: ControllerRuntimeState;
}

export interface PageOverlayRemoteState {
  targetTabActive: boolean;
  controller: ControllerRuntimeState;
  previewDataUrl: string | null;
}

export interface HandPose {
  handedness: "Left" | "Right" | null;
  gesture: GestureLabel;
  confidence: number;
  orientation: "palm" | "back" | "unknown";
  debug?: ClassifierDebugInfo;
}

export interface HandFrameAnalysis {
  handDetected: boolean;
  hands: HandPose[];
  displayGesture: GestureLabel;
}

export interface FaceFrameAnalysis {
  faceDetected: boolean;
  attentionState: AttentionState;
  eyeState: EyeState;
}

export interface StableGestureEvent {
  label: GestureLabel;
  command: VideoCommand | null;
  confidence: number;
  timestamp: number;
  commandOptions?: CommandOptions;
}

export interface GestureEngineSnapshot {
  handDetected: boolean;
  faceDetected: boolean;
  displayGesture: GestureLabel;
  activeHoldAction: HoldAction;
  attentionState: AttentionState;
  eyeState: EyeState;
  attentionElapsedMs: number;
  eyeClosureElapsedMs: number;
  stableEvent: StableGestureEvent | null;
  debug?: ClassifierDebugInfo;
}
