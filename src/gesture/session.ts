import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  type FaceLandmarkerResult,
  type GestureRecognizerResult,
} from "@mediapipe/tasks-vision";
import {
  FACE_MODEL_FILENAME,
  MEDIAPIPE_WASM_DIR,
  MODEL_FILENAME,
  PRODUCT_NAME,
  SENSITIVITY_PRESETS,
} from "../shared/config";
import type {
  CommandOptions,
  ExtensionSettings,
  FaceFrameAnalysis,
  GestureEngineSnapshot,
  HandFrameAnalysis,
  GestureLabel,
  HoldAction,
  StableGestureEvent,
  VideoCommand,
} from "../shared/types";
import { GestureClassifier } from "./classifier";
import { FaceAnalyzer } from "./face-analyzer";

interface GestureSessionOptions {
  settings: ExtensionSettings;
  onSnapshot: (snapshot: GestureEngineSnapshot) => void;
  onStableGesture: (event: StableGestureEvent) => void | Promise<void>;
}

export class GestureSession {
  private static readonly COMMAND_GESTURE_MIN_CONFIDENCE = 0.36;
  private static readonly OPEN_PALM_MIN_CONFIDENCE = 0.5;
  private static readonly OPEN_PALM_CONFIRMATION_FRAMES = 2;
  private static readonly CLOSED_FIST_CONFIRMATION_FRAMES = 2;
  private static readonly SEEK_HOLD_CONFIRMATION_FRAMES = 3;
  private static readonly VOLUME_HOLD_CONFIRMATION_FRAMES = 3;
  private static readonly STATIC_GESTURE_SWITCH_CONFIRMATION_FRAMES = 2;
  private static readonly HOLD_ACTION_SWITCH_CONFIRMATION_FRAMES = 3;
  private static readonly OPEN_PALM_RELEASE_FRAMES = 12;
  private static readonly CLOSED_FIST_RELEASE_FRAMES = 4;
  private static readonly SEEK_HOLD_RELEASE_FRAMES = 8;
  private static readonly THUMB_HOLD_RELEASE_FRAMES = 3;
  private static readonly STATIC_GESTURE_PERSISTENCE_MS = 320;
  private static readonly SEEK_GESTURE_PERSISTENCE_MS = 240;
  private static readonly FIST_SHORT_CIRCUIT_MIN_CONFIDENCE = 0.5;
  private static readonly HAND_PERSISTENCE_MS = 280;
  private static readonly HOLD_COMMAND_FAILURE_LIMIT = 3;
  private static readonly FACE_ANALYSIS_INTERVAL_MS = 90;
  private static readonly FACE_RESUME_TIMEOUT_MS = 5000;
  private static readonly NO_SIGNAL_TIMEOUT_MS = 2500;
  private readonly classifier = new GestureClassifier();
  private readonly faceAnalyzer = new FaceAnalyzer();
  private readonly onSnapshot: GestureSessionOptions["onSnapshot"];
  private readonly onStableGesture: GestureSessionOptions["onStableGesture"];
  private settings: ExtensionSettings;
  private readonly videoElement = document.createElement("video");
  private readonly previewCanvas = document.createElement("canvas");
  private recognizer: GestureRecognizer | null = null;
  private faceLandmarker: FaceLandmarker | null = null;
  private stream: MediaStream | null = null;
  private isRunning = false;
  private frameTimerId: number | null = null;
  private latestVideoTime = -1;
  private oneShotCandidate: GestureLabel = "NONE";
  private oneShotFrames = 0;
  private oneShotReleaseFrames = 0;
  private latchedOneShot: GestureLabel = "NONE";
  private lastOneShotAt = new Map<GestureLabel, number>();
  private holdCandidateAction: HoldAction = "NONE";
  private holdCandidateFrames = 0;
  private activeHoldAction: HoldAction = "NONE";
  private blockedHoldAction: HoldAction = "NONE";
  private holdCommandFailureCounts = new Map<HoldAction, number>();
  private activeHoldStartedAt = 0;
  private activeHoldNextTriggerAt = 0;
  private holdMissingFrames = 0;
  private noSignalStartedAt: number | null = null;
  private attentionStartedAt: number | null = null;
  private eyeClosedStartedAt: number | null = null;
  private faceResumeStartedAt: number | null = null;
  private guardPauseLatched = false;
  private guardPauseResumePending = false;
  private faceResumeLatched = false;
  private commandQueue: Promise<void> = Promise.resolve();
  private lastFaceAnalysis: FaceFrameAnalysis = {
    faceDetected: false,
    attentionState: "unknown",
    eyeState: "unknown",
  };
  private lastHandAnalysis: HandFrameAnalysis = {
    handDetected: false,
    hands: [],
    displayGesture: "NO_HAND",
  };
  private lastStableStaticHand: HandFrameAnalysis = {
    handDetected: false,
    hands: [],
    displayGesture: "NO_HAND",
  };
  private lastStableSeekHand: HandFrameAnalysis = {
    handDetected: false,
    hands: [],
    displayGesture: "NO_HAND",
  };
  private lastFaceAnalysisAt = -1;
  private lastHandAnalysisAt = -1;
  private lastStableStaticHandAt = -1;
  private lastStableSeekHandAt = -1;

  constructor(options: GestureSessionOptions) {
    this.settings = options.settings;
    this.onSnapshot = options.onSnapshot;
    this.onStableGesture = options.onStableGesture;
    this.videoElement.autoplay = true;
    this.videoElement.playsInline = true;
    this.videoElement.muted = true;
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 540 },
      },
    });

    this.videoElement.srcObject = this.stream;
    await this.videoElement.play();

    const visionFiles = await FilesetResolver.forVisionTasks(
      chrome.runtime.getURL(MEDIAPIPE_WASM_DIR),
    );

    this.recognizer = await GestureRecognizer.createFromOptions(visionFiles, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL(`models/${MODEL_FILENAME}`),
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.26,
      minHandPresenceConfidence: 0.24,
      minTrackingConfidence: 0.22,
      cannedGesturesClassifierOptions: {
        scoreThreshold: 0.12,
        categoryAllowlist: ["Open_Palm", "Closed_Fist", "Thumb_Up", "Thumb_Down"],
      },
    });

    this.faceLandmarker = await FaceLandmarker.createFromOptions(visionFiles, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL(`models/${FACE_MODEL_FILENAME}`),
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      minTrackingConfidence: 0.4,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    this.resetRecognitionState();
    this.isRunning = true;
    this.processFrame();
  }

  async stop() {
    this.isRunning = false;

    if (this.frameTimerId) {
      window.clearTimeout(this.frameTimerId);
      this.frameTimerId = null;
    }

    this.recognizer?.close();
    this.faceLandmarker?.close();
    this.recognizer = null;
    this.faceLandmarker = null;

    this.videoElement.pause();
    this.videoElement.srcObject = null;

    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.latestVideoTime = -1;
    this.resetRecognitionState();

    this.onSnapshot({
      handDetected: false,
      faceDetected: false,
      displayGesture: "NO_HAND",
      activeHoldAction: "NONE",
      attentionState: "unknown",
      eyeState: "unknown",
      attentionElapsedMs: 0,
      eyeClosureElapsedMs: 0,
      stableEvent: null,
    });
  }

  updateSettings(settings: ExtensionSettings) {
    this.settings = settings;
  }

  handleCommandFeedback(command: VideoCommand, applied: boolean) {
    const holdAction = this.mapCommandToHoldAction(command);
    if (holdAction === "NONE") {
      return;
    }

    if (applied) {
      this.holdCommandFailureCounts.set(holdAction, 0);
      return;
    }

    const nextFailureCount = (this.holdCommandFailureCounts.get(holdAction) ?? 0) + 1;
    this.holdCommandFailureCounts.set(holdAction, nextFailureCount);

    if (nextFailureCount >= GestureSession.HOLD_COMMAND_FAILURE_LIMIT) {
      this.blockedHoldAction = holdAction;
      if (this.activeHoldAction === holdAction || this.holdCandidateAction === holdAction) {
        this.resetHoldState();
      }
    }
  }

  capturePreviewFrame(maxWidth = 220, quality = 0.72): string | null {
    if (
      !this.isRunning ||
      !this.stream ||
      this.videoElement.videoWidth === 0 ||
      this.videoElement.videoHeight === 0
    ) {
      return null;
    }

    const sourceWidth = this.videoElement.videoWidth;
    const sourceHeight = this.videoElement.videoHeight;
    const scale = Math.min(maxWidth / sourceWidth, 1);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    if (this.previewCanvas.width !== width || this.previewCanvas.height !== height) {
      this.previewCanvas.width = width;
      this.previewCanvas.height = height;
    }

    const context = this.previewCanvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.save();
    context.clearRect(0, 0, width, height);
    context.translate(width, 0);
    context.scale(-1, 1);
    context.drawImage(this.videoElement, 0, 0, width, height);
    context.restore();

    return this.previewCanvas.toDataURL("image/jpeg", quality);
  }

  private readonly processFrame = () => {
    if (!this.isRunning || !this.recognizer || !this.faceLandmarker) {
      return;
    }

    if (
      this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      this.videoElement.currentTime === this.latestVideoTime
    ) {
      this.scheduleNextFrame();
      return;
    }

    this.latestVideoTime = this.videoElement.currentTime;
    const timestamp = performance.now();

    try {
      const handResult = this.recognizer.recognizeForVideo(this.videoElement, timestamp);
      const handAnalysis = this.getHandAnalysis(this.classifier.analyze(handResult), timestamp);
      const faceAnalysis = this.getFaceAnalysis(handAnalysis.handDetected, timestamp);
      const snapshot = this.consumeFrame(handAnalysis, faceAnalysis, timestamp);

      this.onSnapshot(snapshot);

      if (snapshot.stableEvent) {
        this.commandQueue = this.commandQueue
          .then(() => this.onStableGesture(snapshot.stableEvent as StableGestureEvent))
          .catch((error) => {
            console.error(`${PRODUCT_NAME} command dispatch failed`, error);
          });
      }
    } catch (error) {
      console.error(`${PRODUCT_NAME} recognition failed`, error);
    }

    this.scheduleNextFrame();
  };

  private consumeFrame(
    handAnalysis: ReturnType<GestureSession["classifier"]["analyze"]>,
    faceAnalysis: FaceFrameAnalysis,
    timestamp: number,
  ): GestureEngineSnapshot {
    const effectiveFaceAnalysis = handAnalysis.handDetected
      ? {
          faceDetected: false,
          attentionState: "unknown" as const,
          eyeState: "unknown" as const,
        }
      : faceAnalysis;
    const oneShotGesture = this.detectOneShotGesture(handAnalysis.hands);
    const primaryHand = handAnalysis.hands[0];
    const fistShortCircuit =
      primaryHand?.gesture === "CLOSED_FIST" &&
      primaryHand.confidence >= GestureSession.FIST_SHORT_CIRCUIT_MIN_CONFIDENCE;
    const holdAction = fistShortCircuit ? "NONE" : this.detectHoldAction(handAnalysis.hands);

    const holdEvent = fistShortCircuit
      ? this.consumeHoldAction("NONE", timestamp)
      : this.consumeHoldAction(holdAction, timestamp);
    const oneShotEvent =
      holdEvent === null ? this.consumeOneShotGesture(oneShotGesture, timestamp) : null;

    if (handAnalysis.handDetected) {
      this.resetFaceGuardState();
    }

    const { event: faceEvent, attentionElapsedMs, eyeClosureElapsedMs } =
      !handAnalysis.handDetected && holdEvent === null && oneShotEvent === null
        ? this.consumeFaceGuards(handAnalysis.handDetected, effectiveFaceAnalysis, timestamp)
        : {
            event: null,
            attentionElapsedMs: 0,
            eyeClosureElapsedMs: 0,
          };

    const stableEvent = holdEvent ?? oneShotEvent ?? faceEvent;
    const effectiveGesture =
      stableEvent?.label && stableEvent.label !== "TRACKING"
        ? stableEvent.label
        : this.latchedOneShot !== "NONE" && handAnalysis.handDetected && this.activeHoldAction === "NONE"
          ? this.latchedOneShot
        : handAnalysis.displayGesture;

    const debug = this.settings.debugClassifier ? primaryHand?.debug : undefined;

    return {
      handDetected: handAnalysis.handDetected,
      faceDetected: effectiveFaceAnalysis.faceDetected,
      displayGesture: effectiveGesture,
      activeHoldAction: this.activeHoldAction,
      attentionState: effectiveFaceAnalysis.attentionState,
      eyeState: effectiveFaceAnalysis.eyeState,
      attentionElapsedMs,
      eyeClosureElapsedMs,
      stableEvent,
      debug,
    };
  }

  private detectOneShotGesture(
    hands: Array<{ gesture: GestureLabel; confidence: number }>,
  ): GestureLabel {
    const primaryHand = hands[0];
    if (
      !primaryHand ||
      primaryHand.confidence < this.getCommandMinConfidence(primaryHand.gesture)
    ) {
      return "NONE";
    }

    if (primaryHand.gesture === "OPEN_PALM" || primaryHand.gesture === "CLOSED_FIST") {
      return primaryHand.gesture;
    }

    const openPalm = hands.find((hand) => hand.gesture === "OPEN_PALM");
    if (openPalm && openPalm.confidence >= this.getCommandMinConfidence("OPEN_PALM")) {
      return "OPEN_PALM";
    }

    const closedFist = hands.find((hand) => hand.gesture === "CLOSED_FIST");
    if (closedFist && closedFist.confidence >= this.getCommandMinConfidence("CLOSED_FIST")) {
      return "CLOSED_FIST";
    }

    return "NONE";
  }

  private detectHoldAction(
    hands: Array<{ gesture: GestureLabel; confidence: number }>,
  ): HoldAction {
    const thumbGesture = hands.find(
      (hand) =>
        this.isHoldGestureAboveThreshold(hand.gesture, hand.confidence),
    );

    const nextAction = thumbGesture
      ? this.mapGestureToHoldAction(thumbGesture.gesture)
      : "NONE";

    if (nextAction === "NONE") {
      this.blockedHoldAction = "NONE";
      this.holdCommandFailureCounts.set("SEEK_FORWARD", 0);
      this.holdCommandFailureCounts.set("SEEK_BACKWARD", 0);
      this.holdCommandFailureCounts.set("VOLUME_UP", 0);
      this.holdCommandFailureCounts.set("VOLUME_DOWN", 0);
      return "NONE";
    }

    if (this.blockedHoldAction === nextAction) {
      return "NONE";
    }

    return nextAction;
  }

  private isHoldGestureAboveThreshold(
    gesture: GestureLabel,
    confidence: number,
  ): boolean {
    const preset = SENSITIVITY_PRESETS[this.settings.sensitivity];

    if (gesture === "THUMB_LEFT" || gesture === "THUMB_RIGHT") {
      return confidence >= preset.seekHoldMinConfidence;
    }

    if (gesture === "THUMB_UP" || gesture === "THUMB_DOWN") {
      return confidence >= preset.thumbHoldMinConfidence;
    }

    return false;
  }

  private static isOppositeHoldAction(left: HoldAction, right: HoldAction): boolean {
    if (left === "SEEK_FORWARD" && right === "SEEK_BACKWARD") return true;
    if (left === "SEEK_BACKWARD" && right === "SEEK_FORWARD") return true;
    if (left === "VOLUME_UP" && right === "VOLUME_DOWN") return true;
    if (left === "VOLUME_DOWN" && right === "VOLUME_UP") return true;
    if (left === "PLAYBACK_RATE_UP" && right === "PLAYBACK_RATE_DOWN") return true;
    if (left === "PLAYBACK_RATE_DOWN" && right === "PLAYBACK_RATE_UP") return true;
    return false;
  }

  private consumeOneShotGesture(
    gesture: GestureLabel,
    timestamp: number,
  ): StableGestureEvent | null {
    const preset = SENSITIVITY_PRESETS[this.settings.sensitivity];

    if (gesture === "NONE") {
      this.oneShotCandidate = "NONE";
      this.oneShotFrames = 0;

      if (this.latchedOneShot !== "NONE") {
        this.oneShotReleaseFrames += 1;
        if (
          this.oneShotReleaseFrames >=
          this.getOneShotReleaseFrames(this.latchedOneShot, preset.releaseFrames)
        ) {
          this.latchedOneShot = "NONE";
        }
      }

      return null;
    }

    this.oneShotReleaseFrames = 0;

    if (this.latchedOneShot !== "NONE" && gesture !== this.latchedOneShot) {
      if (this.oneShotCandidate === gesture) {
        this.oneShotFrames += 1;
      } else {
        this.oneShotCandidate = gesture;
        this.oneShotFrames = 1;
      }

      if (
        this.oneShotFrames < GestureSession.STATIC_GESTURE_SWITCH_CONFIRMATION_FRAMES ||
        !this.isOffCooldown(gesture, timestamp, preset.oneShotCooldownMs)
      ) {
        return null;
      }

      return this.emitOneShotGesture(gesture, timestamp);
    }

    if (gesture === this.latchedOneShot) {
      this.oneShotCandidate = gesture;
      this.oneShotFrames = 0;
      return null;
    }

    if (this.oneShotCandidate === gesture) {
      this.oneShotFrames += 1;
    } else {
      this.oneShotCandidate = gesture;
      this.oneShotFrames = 1;
    }

    if (
      this.oneShotFrames < this.getOneShotConfirmationFrames(gesture, preset.oneShotConfirmationFrames) ||
      !this.isOffCooldown(gesture, timestamp, preset.oneShotCooldownMs)
    ) {
      return null;
    }

    return this.emitOneShotGesture(gesture, timestamp);
  }

  private emitOneShotGesture(
    gesture: GestureLabel,
    timestamp: number,
  ): StableGestureEvent | null {
    this.latchedOneShot = gesture;
    this.lastOneShotAt.set(gesture, timestamp);
    this.oneShotCandidate = gesture;
    this.oneShotFrames = 0;

    if (gesture === "OPEN_PALM") {
      return this.createEvent("OPEN_PALM", "PLAY", timestamp);
    }

    if (gesture === "CLOSED_FIST") {
      return this.createEvent("CLOSED_FIST", "PAUSE", timestamp);
    }

    return null;
  }

  private consumeHoldAction(
    holdAction: HoldAction,
    timestamp: number,
  ): StableGestureEvent | null {
    const preset = SENSITIVITY_PRESETS[this.settings.sensitivity];

    if (this.activeHoldAction !== "NONE") {
      if (holdAction === this.activeHoldAction) {
        this.holdMissingFrames = 0;
        this.holdCandidateAction = "NONE";
        this.holdCandidateFrames = 0;
        if (timestamp >= this.activeHoldNextTriggerAt) {
          return this.emitHoldEvent(timestamp);
        }
        return null;
      }

      if (holdAction !== "NONE") {
        this.holdMissingFrames = 0;

        if (this.holdCandidateAction === holdAction) {
          this.holdCandidateFrames += 1;
        } else if (
          GestureSession.isOppositeHoldAction(this.activeHoldAction, holdAction)
        ) {
          this.holdCandidateAction = holdAction;
          this.holdCandidateFrames = 0;
          return null;
        } else {
          this.holdCandidateAction = holdAction;
          this.holdCandidateFrames = 1;
        }

        if (
          this.holdCandidateFrames <
          Math.max(
            this.getHoldConfirmationFrames(holdAction, preset.holdConfirmationFrames),
            GestureSession.HOLD_ACTION_SWITCH_CONFIRMATION_FRAMES,
          )
        ) {
          return null;
        }

        this.activeHoldAction = holdAction;
        this.activeHoldStartedAt = timestamp;
        this.activeHoldNextTriggerAt = timestamp;
        this.holdMissingFrames = 0;
        this.holdCandidateAction = "NONE";
        this.holdCandidateFrames = 0;
        return this.emitHoldEvent(timestamp);
      }

      if (holdAction === "NONE") {
        this.holdCandidateAction = "NONE";
        this.holdCandidateFrames = 0;
        this.holdMissingFrames += 1;
        if (
          this.holdMissingFrames >=
          this.getHoldReleaseFrames(this.activeHoldAction, preset.releaseFrames)
        ) {
          this.resetHoldState();
        }
        return null;
      }
    }

    if (holdAction === "NONE") {
      this.holdCandidateAction = "NONE";
      this.holdCandidateFrames = 0;
      return null;
    }

    if (this.holdCandidateAction === holdAction) {
      this.holdCandidateFrames += 1;
    } else if (
      GestureSession.isOppositeHoldAction(this.holdCandidateAction, holdAction)
    ) {
      this.holdCandidateAction = holdAction;
      this.holdCandidateFrames = 0;
      return null;
    } else {
      this.holdCandidateAction = holdAction;
      this.holdCandidateFrames = 1;
    }

    if (
      this.holdCandidateFrames <
      this.getHoldConfirmationFrames(holdAction, preset.holdConfirmationFrames)
    ) {
      return null;
    }

    this.activeHoldAction = holdAction;
    this.activeHoldStartedAt = timestamp;
    this.activeHoldNextTriggerAt = timestamp;
    this.holdMissingFrames = 0;
    return this.emitHoldEvent(timestamp);
  }

  private emitHoldEvent(timestamp: number): StableGestureEvent {
    const holdDurationMs = Math.max(timestamp - this.activeHoldStartedAt, 0);
    const intervalMs = this.computeHoldInterval(holdDurationMs);
    this.activeHoldNextTriggerAt = timestamp + intervalMs;
    this.holdCandidateAction = this.activeHoldAction;
    this.holdCandidateFrames = 0;

    if (this.activeHoldAction === "SEEK_FORWARD") {
      return this.createEvent("THUMB_RIGHT", "SEEK_FORWARD", timestamp, {
        seekSeconds: this.computeSeekAmount(holdDurationMs),
      });
    }

    if (this.activeHoldAction === "SEEK_BACKWARD") {
      return this.createEvent("THUMB_LEFT", "SEEK_BACKWARD", timestamp, {
        seekSeconds: this.computeSeekAmount(holdDurationMs),
      });
    }

    if (this.activeHoldAction === "VOLUME_UP") {
      return this.createEvent("THUMB_UP", "VOLUME_UP", timestamp, {
        volumeDelta: this.computeVolumeDelta(holdDurationMs),
      });
    }

    if (this.activeHoldAction === "VOLUME_DOWN") {
      return this.createEvent("THUMB_DOWN", "VOLUME_DOWN", timestamp, {
        volumeDelta: this.computeVolumeDelta(holdDurationMs),
      });
    }

    if (this.activeHoldAction === "PLAYBACK_RATE_UP") {
      return this.createEvent("THUMB_RIGHT", "PLAYBACK_RATE_UP", timestamp, {
        playbackRateDelta: this.computePlaybackRateDelta(holdDurationMs),
      });
    }

    return this.createEvent("THUMB_LEFT", "PLAYBACK_RATE_DOWN", timestamp, {
      playbackRateDelta: this.computePlaybackRateDelta(holdDurationMs),
    });
  }

  private consumeFaceGuards(
    handDetected: boolean,
    faceAnalysis: { faceDetected: boolean; attentionState: "unknown" | "looking" | "away"; eyeState: "unknown" | "open" | "closed" },
    timestamp: number,
  ): {
    event: StableGestureEvent | null;
    attentionElapsedMs: number;
    eyeClosureElapsedMs: number;
  } {
    const noSignalCondition = !handDetected && !faceAnalysis.faceDetected;
    const attentionCondition =
      this.settings.attentionGuardEnabled &&
      faceAnalysis.faceDetected &&
      faceAnalysis.attentionState === "away";
    const eyesClosedCondition =
      this.settings.eyeClosureGuardEnabled &&
      faceAnalysis.faceDetected &&
      faceAnalysis.eyeState === "closed";
    const resumeCondition =
      this.guardPauseResumePending &&
      faceAnalysis.faceDetected &&
      faceAnalysis.attentionState === "looking";

    if (noSignalCondition) {
      this.noSignalStartedAt ??= timestamp;
    } else {
      this.noSignalStartedAt = null;
    }

    if (attentionCondition) {
      this.attentionStartedAt ??= timestamp;
    } else {
      this.attentionStartedAt = null;
    }

    if (eyesClosedCondition) {
      this.eyeClosedStartedAt ??= timestamp;
    } else {
      this.eyeClosedStartedAt = null;
    }

    if (resumeCondition) {
      this.faceResumeStartedAt ??= timestamp;
    } else {
      this.faceResumeStartedAt = null;
      this.faceResumeLatched = false;
    }

    const noSignalElapsedMs = this.noSignalStartedAt !== null ? timestamp - this.noSignalStartedAt : 0;
    const attentionElapsedMs = this.attentionStartedAt !== null ? timestamp - this.attentionStartedAt : 0;
    const eyeClosureElapsedMs = this.eyeClosedStartedAt !== null ? timestamp - this.eyeClosedStartedAt : 0;
    const faceResumeElapsedMs =
      this.faceResumeStartedAt !== null ? timestamp - this.faceResumeStartedAt : 0;

    if (!noSignalCondition && !attentionCondition && !eyesClosedCondition) {
      this.guardPauseLatched = false;
    }

    if (!this.guardPauseLatched) {
      if (noSignalCondition && noSignalElapsedMs >= GestureSession.NO_SIGNAL_TIMEOUT_MS) {
        this.guardPauseLatched = true;
        this.guardPauseResumePending = true;
        return {
          event: this.createEvent("TRACKING", "PAUSE", timestamp, {
            reason: `${(GestureSession.NO_SIGNAL_TIMEOUT_MS / 1000).toFixed(1)} saniye boyunca el veya yüz algılanmadığı için duraklatıldı.`,
          }),
          attentionElapsedMs: noSignalElapsedMs,
          eyeClosureElapsedMs,
        };
      }

      if (
        eyesClosedCondition &&
        eyeClosureElapsedMs >= this.settings.eyeClosureTimeoutSeconds * 1000
      ) {
        this.guardPauseLatched = true;
        this.guardPauseResumePending = true;
        return {
          event: this.createEvent("TRACKING", "PAUSE", timestamp, {
            reason: `Gözler ${this.settings.eyeClosureTimeoutSeconds.toFixed(1)} saniye kapalı kaldığı için duraklatıldı.`,
          }),
          attentionElapsedMs,
          eyeClosureElapsedMs,
        };
      }

      if (
        attentionCondition &&
        attentionElapsedMs >= this.settings.attentionTimeoutSeconds * 1000
      ) {
        this.guardPauseLatched = true;
        this.guardPauseResumePending = true;
        return {
          event: this.createEvent("TRACKING", "PAUSE", timestamp, {
            reason: `${this.settings.attentionTimeoutSeconds.toFixed(1)} saniye boyunca ekrandan uzak bakıldığı için duraklatıldı.`,
          }),
          attentionElapsedMs,
          eyeClosureElapsedMs,
        };
      }
    }

    if (
      !this.faceResumeLatched &&
      resumeCondition &&
      faceResumeElapsedMs >= GestureSession.FACE_RESUME_TIMEOUT_MS
    ) {
      this.faceResumeLatched = true;
      this.guardPauseResumePending = false;
      return {
        event: this.createEvent("TRACKING", "PLAY", timestamp, {
          reason: `${(GestureSession.FACE_RESUME_TIMEOUT_MS / 1000).toFixed(1)} saniye boyunca ekrana bakıldığı için oynatıldı.`,
        }),
        attentionElapsedMs,
        eyeClosureElapsedMs,
      };
    }

    return {
      event: null,
      attentionElapsedMs,
      eyeClosureElapsedMs,
    };
  }

  private createEvent(
    label: GestureLabel,
    command: StableGestureEvent["command"],
    timestamp: number,
    commandOptions?: CommandOptions,
  ): StableGestureEvent {
    return {
      label,
      command,
      confidence: 1,
      timestamp,
      commandOptions,
    };
  }

  private computeHoldInterval(holdDurationMs: number): number {
    const preset = SENSITIVITY_PRESETS[this.settings.sensitivity];
    return Math.max(
      preset.holdMinIntervalMs,
      preset.holdBaseIntervalMs - holdDurationMs * 0.08,
    );
  }

  private computeAccelerationMultiplier(holdDurationMs: number): number {
    return 1 + (holdDurationMs / 1000) * (this.settings.holdAccelerationPercent / 100);
  }

  private computeSeekAmount(holdDurationMs: number): number {
    return Number((this.settings.seekSeconds * this.computeAccelerationMultiplier(holdDurationMs)).toFixed(2));
  }

  private computeVolumeDelta(holdDurationMs: number): number {
    return Number((((this.settings.volumeStepPercent / 100) * this.computeAccelerationMultiplier(holdDurationMs))).toFixed(3));
  }

  private computePlaybackRateDelta(holdDurationMs: number): number {
    return Number((this.settings.playbackRateStep * this.computeAccelerationMultiplier(holdDurationMs)).toFixed(2));
  }

  private isOffCooldown(label: GestureLabel, timestamp: number, cooldownMs: number): boolean {
    return timestamp - (this.lastOneShotAt.get(label) ?? 0) >= cooldownMs;
  }

  private getCommandMinConfidence(gesture: GestureLabel): number {
    if (gesture === "OPEN_PALM") {
      return GestureSession.OPEN_PALM_MIN_CONFIDENCE;
    }

    return GestureSession.COMMAND_GESTURE_MIN_CONFIDENCE;
  }

  private getOneShotConfirmationFrames(
    gesture: GestureLabel,
    defaultConfirmationFrames: number,
  ): number {
    if (gesture === "OPEN_PALM") {
      return Math.max(defaultConfirmationFrames, GestureSession.OPEN_PALM_CONFIRMATION_FRAMES);
    }

    if (gesture === "CLOSED_FIST") {
      return Math.max(defaultConfirmationFrames, GestureSession.CLOSED_FIST_CONFIRMATION_FRAMES);
    }

    return defaultConfirmationFrames;
  }

  private getOneShotReleaseFrames(
    gesture: GestureLabel,
    defaultReleaseFrames: number,
  ): number {
    if (gesture === "OPEN_PALM") {
      return Math.max(defaultReleaseFrames, GestureSession.OPEN_PALM_RELEASE_FRAMES);
    }

    if (gesture === "CLOSED_FIST") {
      return Math.max(defaultReleaseFrames, GestureSession.CLOSED_FIST_RELEASE_FRAMES);
    }

    return defaultReleaseFrames;
  }

  private scheduleNextFrame() {
    this.frameTimerId = window.setTimeout(this.processFrame, 16);
  }

  private getHandAnalysis(
    nextHandAnalysis: HandFrameAnalysis,
    timestamp: number,
  ): HandFrameAnalysis {
    if (nextHandAnalysis.handDetected) {
      if (
        nextHandAnalysis.displayGesture === "OPEN_PALM" ||
        nextHandAnalysis.displayGesture === "CLOSED_FIST"
      ) {
        this.lastStableStaticHand = nextHandAnalysis;
        this.lastStableStaticHandAt = timestamp;
      }

      if (
        nextHandAnalysis.displayGesture === "THUMB_LEFT" ||
        nextHandAnalysis.displayGesture === "THUMB_RIGHT"
      ) {
        this.lastStableSeekHand = nextHandAnalysis;
        this.lastStableSeekHandAt = timestamp;
      } else if (
        nextHandAnalysis.displayGesture === "TRACKING" &&
        this.lastStableSeekHand.handDetected &&
        this.lastStableSeekHandAt >= 0 &&
        timestamp - this.lastStableSeekHandAt < GestureSession.SEEK_GESTURE_PERSISTENCE_MS &&
        this.lastStableSeekHandAt >= this.lastStableStaticHandAt
      ) {
        this.lastHandAnalysis = this.lastStableSeekHand;
        this.lastHandAnalysisAt = timestamp;
        return this.lastStableSeekHand;
      } else if (
        nextHandAnalysis.displayGesture === "TRACKING" &&
        this.lastStableStaticHand.handDetected &&
        this.lastStableStaticHandAt >= 0 &&
        timestamp - this.lastStableStaticHandAt < GestureSession.STATIC_GESTURE_PERSISTENCE_MS
      ) {
        this.lastHandAnalysis = this.lastStableStaticHand;
        this.lastHandAnalysisAt = timestamp;
        return this.lastStableStaticHand;
      }

      this.lastHandAnalysis = nextHandAnalysis;
      this.lastHandAnalysisAt = timestamp;
      return nextHandAnalysis;
    }

    if (
      this.lastHandAnalysis.handDetected &&
      this.lastHandAnalysisAt >= 0 &&
      timestamp - this.lastHandAnalysisAt < GestureSession.HAND_PERSISTENCE_MS
    ) {
      return this.activeHoldAction !== "NONE"
        ? this.lastHandAnalysis
        : {
            handDetected: true,
            hands: [],
            displayGesture: "TRACKING",
          };
    }

    this.lastHandAnalysis = nextHandAnalysis;
    this.lastHandAnalysisAt = timestamp;
    return nextHandAnalysis;
  }

  private resetHoldState() {
    this.holdCandidateAction = "NONE";
    this.holdCandidateFrames = 0;
    this.activeHoldAction = "NONE";
    this.activeHoldStartedAt = 0;
    this.activeHoldNextTriggerAt = 0;
    this.holdMissingFrames = 0;
  }

  private getHoldConfirmationFrames(
    action: HoldAction,
    defaultConfirmationFrames: number,
  ): number {
    if (action === "SEEK_FORWARD" || action === "SEEK_BACKWARD") {
      return Math.max(defaultConfirmationFrames, GestureSession.SEEK_HOLD_CONFIRMATION_FRAMES);
    }

    if (action === "VOLUME_UP" || action === "VOLUME_DOWN") {
      return Math.max(defaultConfirmationFrames, GestureSession.VOLUME_HOLD_CONFIRMATION_FRAMES);
    }

    return defaultConfirmationFrames;
  }

  private getHoldReleaseFrames(action: HoldAction, defaultReleaseFrames: number): number {
    if (action === "SEEK_FORWARD" || action === "SEEK_BACKWARD") {
      return Math.max(defaultReleaseFrames, GestureSession.SEEK_HOLD_RELEASE_FRAMES);
    }

    if (action === "VOLUME_UP" || action === "VOLUME_DOWN") {
      return Math.max(defaultReleaseFrames, GestureSession.THUMB_HOLD_RELEASE_FRAMES);
    }

    return defaultReleaseFrames;
  }

  private mapCommandToHoldAction(command: VideoCommand): HoldAction {
    if (command === "SEEK_FORWARD") {
      return "SEEK_FORWARD";
    }

    if (command === "SEEK_BACKWARD") {
      return "SEEK_BACKWARD";
    }

    if (command === "VOLUME_UP") {
      return "VOLUME_UP";
    }

    if (command === "VOLUME_DOWN") {
      return "VOLUME_DOWN";
    }

    return "NONE";
  }

  private mapGestureToHoldAction(gesture: GestureLabel): HoldAction {
    if (gesture === "THUMB_RIGHT") {
      return "SEEK_FORWARD";
    }

    if (gesture === "THUMB_LEFT") {
      return "SEEK_BACKWARD";
    }

    if (gesture === "THUMB_UP") {
      return "VOLUME_UP";
    }

    if (gesture === "THUMB_DOWN") {
      return "VOLUME_DOWN";
    }

    return "NONE";
  }

  private resetRecognitionState() {
    this.oneShotCandidate = "NONE";
    this.oneShotFrames = 0;
    this.oneShotReleaseFrames = 0;
    this.latchedOneShot = "NONE";
    this.lastOneShotAt.clear();
    this.blockedHoldAction = "NONE";
    this.resetHoldState();
    this.resetFaceGuardState();
    this.lastFaceAnalysis = {
      faceDetected: false,
      attentionState: "unknown",
      eyeState: "unknown",
    };
    this.lastHandAnalysis = {
      handDetected: false,
      hands: [],
      displayGesture: "NO_HAND",
    };
    this.lastStableStaticHand = {
      handDetected: false,
      hands: [],
      displayGesture: "NO_HAND",
    };
    this.lastStableSeekHand = {
      handDetected: false,
      hands: [],
      displayGesture: "NO_HAND",
    };
    this.lastFaceAnalysisAt = -1;
    this.lastHandAnalysisAt = -1;
    this.lastStableStaticHandAt = -1;
    this.lastStableSeekHandAt = -1;
  }

  private resetFaceGuardState() {
    this.noSignalStartedAt = null;
    this.attentionStartedAt = null;
    this.eyeClosedStartedAt = null;
    this.faceResumeStartedAt = null;
    this.guardPauseLatched = false;
    this.guardPauseResumePending = false;
    this.faceResumeLatched = false;
  }

  private getFaceAnalysis(
    handDetected: boolean,
    timestamp: number,
  ): FaceFrameAnalysis {
    if (handDetected) {
      this.lastFaceAnalysis = {
        faceDetected: false,
        attentionState: "unknown",
        eyeState: "unknown",
      };
      this.lastFaceAnalysisAt = -1;
      return this.lastFaceAnalysis;
    }

    if (
      this.lastFaceAnalysisAt >= 0 &&
      timestamp - this.lastFaceAnalysisAt < GestureSession.FACE_ANALYSIS_INTERVAL_MS
    ) {
      return this.lastFaceAnalysis;
    }

    const faceResult = this.faceLandmarker?.detectForVideo(this.videoElement, timestamp);
    this.lastFaceAnalysis = faceResult
      ? this.faceAnalyzer.analyze(faceResult)
      : {
          faceDetected: false,
          attentionState: "unknown",
          eyeState: "unknown",
        };
    this.lastFaceAnalysisAt = timestamp;
    return this.lastFaceAnalysis;
  }
}
