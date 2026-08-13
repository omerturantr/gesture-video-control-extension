import type { GestureRecognizerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { GestureLabel, HandFrameAnalysis, HandPose } from "../shared/types";
import { clamp } from "../utils/math";

export class GestureClassifier {
  analyze(result: GestureRecognizerResult): HandFrameAnalysis {
    if (result.landmarks.length === 0) {
      return {
        handDetected: false,
        hands: [],
        displayGesture: "NO_HAND",
      };
    }

    const hands = result.landmarks
      .map((landmarks, index) => {
        const rawHandedness = result.handedness[index]?.[0]?.categoryName;
        const rawGesture = result.gestures[index]?.[0];
        return this.classifyHand(
          landmarks,
          this.normalizeHandedness(
            rawHandedness === "Left" || rawHandedness === "Right" ? rawHandedness : null,
          ),
          {
            label: this.mapCannedGesture(rawGesture?.categoryName),
            score: rawGesture?.score ?? 0,
          },
        );
      })
      .sort((left, right) => right.confidence - left.confidence);

    const displayGesture = hands.find((hand) => hand.gesture !== "TRACKING")?.gesture ?? "TRACKING";

    return {
      handDetected: true,
      hands,
      displayGesture,
    };
  }

  private classifyHand(
    landmarks: NormalizedLandmark[],
    handedness: "Left" | "Right" | null,
    cannedGesture: { label: GestureLabel | null; score: number },
  ): HandPose {
    const palmCenter = this.averagePoints([
      landmarks[0],
      landmarks[5],
      landmarks[9],
      landmarks[13],
      landmarks[17],
    ]);
    const palmWidth = Math.max(this.distance(landmarks[5], landmarks[17]), 0.001);
    const palmFacing = this.isPalmFacingCamera(landmarks, handedness);
    const orientation: "palm" | "back" | "unknown" =
      palmFacing === null ? "unknown" : palmFacing ? "palm" : "back";

    const extendedFingers = [
      [8, 6, 5],
      [12, 10, 9],
      [16, 14, 13],
      [20, 18, 17],
    ].map(([tip, pip, mcp]) => this.isFingerExtended(landmarks, tip, pip, mcp, palmCenter, palmWidth));

    const curledFingers = [
      [8, 6],
      [12, 10],
      [16, 14],
      [20, 18],
    ].map(([tip, pip]) => this.isFingerCurled(landmarks, tip, pip, palmCenter));

    const extendedCount = extendedFingers.filter(Boolean).length;
    const curledCount = curledFingers.filter(Boolean).length;
    const thumbVector = {
      x: this.mirrorX(landmarks[4].x) - this.mirrorX(landmarks[2].x),
      y: landmarks[4].y - landmarks[2].y,
    };
    const thumbTipY = landmarks[4].y;
    const thumbTipX = this.mirrorX(landmarks[4].x);
    const thumbBaseX = this.mirrorX(landmarks[2].x);
    const averageFingerTipY =
      [8, 12, 16, 20].reduce((sum, index) => sum + landmarks[index].y, 0) / 4;
    const averageFingerTipX =
      [8, 12, 16, 20].reduce((sum, index) => sum + this.mirrorX(landmarks[index].x), 0) / 4;
    const thumbLength = this.distance(landmarks[4], landmarks[2]);
    const thumbTipToPalm = this.distance(landmarks[4], palmCenter);
    const thumbTipToIndexBase = this.distance(landmarks[4], landmarks[5]);
    const thumbHorizontalSeparation = Math.abs(thumbTipX - averageFingerTipX);
    const thumbExtended =
      thumbLength > palmWidth * 0.7 &&
      this.distance(landmarks[4], palmCenter) > this.distance(landmarks[3], palmCenter) * 1.06;
    const thumbClearlyExtended =
      thumbExtended &&
      thumbTipToPalm > palmWidth * 1.02 &&
      thumbTipToIndexBase > palmWidth * 0.72;
    const thumbLikelyExtended =
      thumbExtended &&
      thumbTipToPalm > palmWidth * 0.72 &&
      thumbTipToIndexBase > palmWidth * 0.4;
    const thumbSidewaysExtended =
      thumbLength > palmWidth * 0.54 &&
      thumbTipToIndexBase > palmWidth * 0.18 &&
      thumbHorizontalSeparation > palmWidth * 0.1;
    const thumbClearlyTucked =
      thumbTipToPalm < palmWidth * 0.95 &&
      thumbTipToIndexBase < palmWidth * 0.78;

    const fingerSpread = [8, 12, 16, 20]
      .map((index) => this.distance(landmarks[index], palmCenter))
      .reduce((sum, value) => sum + value, 0) /
      4;
    const averageFingerTipDistance = [8, 12, 16, 20]
      .map((index) => this.distance(landmarks[index], palmCenter))
      .reduce((sum, value) => sum + value, 0) /
      4;
    const fingerTipSpan =
      Math.max(...[8, 12, 16, 20].map((index) => this.mirrorX(landmarks[index].x))) -
      Math.min(...[8, 12, 16, 20].map((index) => this.mirrorX(landmarks[index].x)));
    const maxFingerTipX = Math.max(...[8, 12, 16, 20].map((index) => this.mirrorX(landmarks[index].x)));
    const minFingerTipX = Math.min(...[8, 12, 16, 20].map((index) => this.mirrorX(landmarks[index].x)));
    const cannedOpenPalmMatch =
      cannedGesture.label === "OPEN_PALM" && cannedGesture.score >= 0.1;
    const relaxedOpenPalmGeometry =
      extendedCount >= 3 &&
      curledCount <= 1 &&
      thumbLikelyExtended &&
      fingerSpread > palmWidth * 1.24 &&
      averageFingerTipDistance > palmWidth * 1.3 &&
      fingerTipSpan > palmWidth * 0.2 &&
      orientation === "palm";
    const openPalmGeometry =
      extendedCount === 4 &&
      curledCount <= 1 &&
      thumbLikelyExtended &&
      fingerSpread > palmWidth * 1.28 &&
      averageFingerTipDistance > palmWidth * 1.34 &&
      fingerTipSpan > palmWidth * 0.22 &&
      orientation === "palm";
    const strongOpenPalmGeometry =
      openPalmGeometry &&
      thumbClearlyExtended &&
      fingerSpread > palmWidth * 1.36 &&
      averageFingerTipDistance > palmWidth * 1.4;

    const debugBase = {
      cannedLabel: cannedGesture.label,
      cannedScore: cannedGesture.score,
      curledCount,
      extendedCount,
      orientation,
    };

    if (
      strongOpenPalmGeometry ||
      (openPalmGeometry && cannedOpenPalmMatch) ||
      (relaxedOpenPalmGeometry && cannedGesture.score >= 0.22)
    ) {
      const confidence = clamp(
        0.54 +
          (strongOpenPalmGeometry ? 0.1 : 0) +
          (thumbClearlyExtended ? 0.06 : 0) +
          (fingerSpread / palmWidth - 1.24) * 0.26 +
          (averageFingerTipDistance / palmWidth - 1.3) * 0.2 +
          cannedGesture.score * 0.28,
        0,
        0.98,
      );
      return {
        handedness,
        orientation,
        gesture: "OPEN_PALM",
        confidence,
        debug: { primaryGesture: "OPEN_PALM", primaryConfidence: confidence, ...debugBase },
      };
    }

    const cannedClosedFistMatch =
      cannedGesture.label === "CLOSED_FIST" && cannedGesture.score >= 0.45;
    const cannedThumbHint =
      (cannedGesture.label === "THUMB_UP" || cannedGesture.label === "THUMB_DOWN") &&
      cannedGesture.score >= 0.3;
    const thumbProtruding =
      thumbClearlyExtended ||
      thumbHorizontalSeparation > palmWidth * 0.32 ||
      thumbTipToPalm > palmWidth * 1.05 ||
      thumbTipToIndexBase > palmWidth * 0.55;
    const fistThumbVeto = cannedThumbHint || thumbProtruding;
    const strongFistGeometry =
      !fistThumbVeto &&
      curledCount >= 4 &&
      extendedCount === 0 &&
      thumbClearlyTucked &&
      thumbHorizontalSeparation < palmWidth * 0.32 &&
      fingerSpread < palmWidth * 1.18;
    const relaxedFistGeometry =
      !fistThumbVeto &&
      curledCount >= 3 &&
      extendedCount <= 1 &&
      thumbClearlyTucked &&
      thumbHorizontalSeparation < palmWidth * 0.3 &&
      fingerSpread < palmWidth * 1.24;
    const cannedFistFallback =
      cannedClosedFistMatch &&
      !cannedThumbHint &&
      curledCount >= 3 &&
      fingerSpread < palmWidth * 1.3;

    if (strongFistGeometry || relaxedFistGeometry || cannedFistFallback) {
      const tightnessBonus = Math.max(0, 1.18 - fingerSpread / palmWidth) * 0.28;
      const curlBonus = Math.max(0, curledCount - 3) * 0.06;
      const cannedBonus = cannedClosedFistMatch ? cannedGesture.score * 0.2 : 0;
      const confidence = clamp(
        (strongFistGeometry ? 0.78 : 0.7) + tightnessBonus + curlBonus + cannedBonus,
        0,
        0.98,
      );
      return {
        handedness,
        orientation,
        gesture: "CLOSED_FIST",
        confidence,
        debug: { primaryGesture: "CLOSED_FIST", primaryConfidence: confidence, ...debugBase },
      };
    }

    const fistShapeVeto =
      curledCount === 4 &&
      fingerSpread < palmWidth * 1.1 &&
      thumbTipToPalm < palmWidth * 1.0;

    if (
      !fistShapeVeto &&
      curledCount >= 1 &&
      extendedCount <= 2 &&
      (thumbLikelyExtended || thumbSidewaysExtended)
    ) {
      const absX = Math.abs(thumbVector.x);
      const absY = Math.abs(thumbVector.y);
      const directionStrength = Math.max(absX, absY) / Math.max(palmWidth, 0.001);
      const thumbSeparation = Math.abs(thumbTipY - averageFingerTipY);
      const handLooksClosed =
        (curledCount >= 2 && extendedCount <= 1) ||
        (curledCount >= 1 &&
          extendedCount <= 2 &&
          fingerSpread < palmWidth * 1.24 &&
          averageFingerTipDistance < palmWidth * 1.3);
      const compactFingerCluster =
        fingerSpread < palmWidth * 1.34 &&
        averageFingerTipDistance < palmWidth * 1.42 &&
        fingerTipSpan < palmWidth * 0.34;
      const relaxedClosedLikeShape =
        curledCount >= 1 &&
        fingerSpread < palmWidth * 1.4 &&
        averageFingerTipDistance < palmWidth * 1.48 &&
        fingerTipSpan < palmWidth * 0.42;
      const backFacingSeekShape =
        orientation === "back" &&
        fingerSpread < palmWidth * 1.58 &&
        averageFingerTipDistance < palmWidth * 1.62 &&
        fingerTipSpan < palmWidth * 0.52;
      const thumbBeyondFingerCluster =
        thumbVector.x > 0
          ? thumbTipX > maxFingerTipX + palmWidth * 0.02
          : thumbTipX < minFingerTipX - palmWidth * 0.02;
      const thumbDirectionAligned =
        thumbVector.x > 0
          ? thumbTipX > averageFingerTipX + palmWidth * 0.01
          : thumbTipX < averageFingerTipX - palmWidth * 0.01;
      const thumbBaseDirectionAligned =
        thumbVector.x > 0
          ? thumbTipX > thumbBaseX + palmWidth * 0.06
          : thumbTipX < thumbBaseX - palmWidth * 0.06;
      const horizontalThumbHandShape =
        (handLooksClosed || compactFingerCluster || relaxedClosedLikeShape) &&
        thumbTipToIndexBase > palmWidth * 0.1 &&
        thumbLength > palmWidth * 0.58 &&
        thumbBaseDirectionAligned;

      const cannedVerticalThumbMatch =
        (cannedGesture.label === "THUMB_UP" || cannedGesture.label === "THUMB_DOWN") &&
        cannedGesture.score >= 0.35;
      const cannedVerticalHint =
        (cannedGesture.label === "THUMB_UP" || cannedGesture.label === "THUMB_DOWN") &&
        cannedGesture.score >= 0.2;
      const geometricThumbMatch =
        thumbClearlyExtended &&
        absY > absX * 1.4 &&
        thumbSeparation > palmWidth * 0.4 &&
        thumbSeparation > thumbHorizontalSeparation * 1.2;
      const cannedThumbMatch =
        cannedVerticalThumbMatch &&
        thumbClearlyExtended &&
        thumbSeparation > palmWidth * 0.18 &&
        thumbSeparation > thumbHorizontalSeparation * 0.9;

      if (geometricThumbMatch || cannedThumbMatch) {
        const resolvedGesture: GestureLabel =
          cannedVerticalThumbMatch && cannedGesture.label
            ? cannedGesture.label
            : thumbVector.y < 0
              ? "THUMB_UP"
              : "THUMB_DOWN";
        const confidence = clamp(
          Math.max(
            0.8 + Math.max(curledCount - 2, 0) * 0.04 + directionStrength * 0.18,
            0.6 + cannedGesture.score * 0.4,
          ),
          0,
          0.98,
        );
        return {
          handedness,
          orientation,
          gesture: resolvedGesture,
          confidence,
          debug: { primaryGesture: resolvedGesture, primaryConfidence: confidence, ...debugBase },
        };
      }

      const horizontalThumbMatch =
        !cannedVerticalHint &&
        horizontalThumbHandShape &&
        thumbDirectionAligned &&
        absX > absY * 1.2 &&
        thumbHorizontalSeparation > palmWidth * 0.16 &&
        thumbHorizontalSeparation > thumbSeparation * 1.1 &&
        thumbTipToPalm > palmWidth * 0.34;
      const backFacingHorizontalThumbMatch =
        !cannedVerticalHint &&
        orientation !== "palm" &&
        (compactFingerCluster || relaxedClosedLikeShape || backFacingSeekShape) &&
        thumbBeyondFingerCluster &&
        thumbBaseDirectionAligned &&
        absX > absY * 1.0 &&
        thumbHorizontalSeparation > palmWidth * 0.22 &&
        thumbTipToPalm > palmWidth * 0.5;
      const strongBackFacingHorizontalThumbMatch =
        !cannedVerticalHint &&
        backFacingSeekShape &&
        thumbBeyondFingerCluster &&
        thumbBaseDirectionAligned &&
        absX > absY * 0.9 &&
        thumbHorizontalSeparation > palmWidth * 0.2 &&
        thumbTipToPalm > palmWidth * 0.42 &&
        thumbLength > palmWidth * 0.5;

      if (
        horizontalThumbMatch ||
        backFacingHorizontalThumbMatch ||
        strongBackFacingHorizontalThumbMatch
      ) {
        const gesture: GestureLabel = thumbVector.x > 0 ? "THUMB_RIGHT" : "THUMB_LEFT";
        const confidence = clamp(
          0.58 +
            Math.max(curledCount - 1, 0) * 0.04 +
            directionStrength * 0.16 +
            (thumbHorizontalSeparation / palmWidth - 0.03) * 0.18 +
            (backFacingHorizontalThumbMatch ? 0.05 : 0) +
            (strongBackFacingHorizontalThumbMatch ? 0.04 : 0),
          0,
          0.96,
        );
        return {
          handedness,
          orientation,
          gesture,
          confidence,
          debug: { primaryGesture: gesture, primaryConfidence: confidence, ...debugBase },
        };
      }

    }

    return {
      handedness,
      orientation,
      gesture: "TRACKING",
      confidence: 0.32,
      debug: { primaryGesture: "TRACKING", primaryConfidence: 0.32, ...debugBase },
    };
  }

  private isFingerExtended(
    landmarks: NormalizedLandmark[],
    tipIndex: number,
    pipIndex: number,
    mcpIndex: number,
    palmCenter: NormalizedLandmark,
    palmWidth: number,
  ): boolean {
    const tipDistance = this.distance(landmarks[tipIndex], palmCenter);
    const pipDistance = this.distance(landmarks[pipIndex], palmCenter);
    const mcpDistance = this.distance(landmarks[mcpIndex], palmCenter);

    return tipDistance > pipDistance * 1.08 && tipDistance > mcpDistance * 1.25 && tipDistance > palmWidth * 0.72;
  }

  private isFingerCurled(
    landmarks: NormalizedLandmark[],
    tipIndex: number,
    pipIndex: number,
    palmCenter: NormalizedLandmark,
  ): boolean {
    return this.distance(landmarks[tipIndex], palmCenter) < this.distance(landmarks[pipIndex], palmCenter) * 0.97;
  }

  private isPalmFacingCamera(
    landmarks: NormalizedLandmark[],
    handedness: "Left" | "Right" | null,
  ): boolean | null {
    if (!handedness) {
      return null;
    }

    const indexX = this.mirrorX(landmarks[5].x);
    const pinkyX = this.mirrorX(landmarks[17].x);

    if (handedness === "Right") {
      return indexX > pinkyX;
    }

    return indexX < pinkyX;
  }

  private normalizeHandedness(
    handedness: "Left" | "Right" | null,
  ): "Left" | "Right" | null {
    // MediaPipe handedness assumes a mirrored selfie input; our raw camera feed is not mirrored.
    if (handedness === "Left") {
      return "Right";
    }

    if (handedness === "Right") {
      return "Left";
    }

    return null;
  }

  private mapCannedGesture(categoryName: string | undefined): GestureLabel | null {
    if (categoryName === "Open_Palm") {
      return "OPEN_PALM";
    }

    if (categoryName === "Closed_Fist") {
      return "CLOSED_FIST";
    }

    if (categoryName === "Thumb_Up") {
      return "THUMB_UP";
    }

    if (categoryName === "Thumb_Down") {
      return "THUMB_DOWN";
    }

    return null;
  }

  private averagePoints(points: NormalizedLandmark[]): NormalizedLandmark {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      z: points.reduce((sum, point) => sum + (point.z ?? 0), 0) / points.length,
      visibility: points.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / points.length,
    };
  }

  private mirrorX(value: number): number {
    return 1 - value;
  }

  private distance(left: NormalizedLandmark, right: NormalizedLandmark): number {
    return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
  }
}
