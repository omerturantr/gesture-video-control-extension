import type { FaceLandmarkerResult, NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { FaceFrameAnalysis } from "../shared/types";

export class FaceAnalyzer {
  analyze(result: FaceLandmarkerResult): FaceFrameAnalysis {
    const landmarks = result.faceLandmarks[0];
    if (!landmarks || landmarks.length === 0) {
      return {
        faceDetected: false,
        attentionState: "unknown",
        eyeState: "unknown",
      };
    }

    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const nose = landmarks[1];
    const faceWidth = Math.max(this.distance(leftCheek, rightCheek), 0.001);

    const leftEyeCenter = this.average([
      landmarks[33],
      landmarks[133],
      landmarks[159],
      landmarks[145],
    ]);
    const rightEyeCenter = this.average([
      landmarks[263],
      landmarks[362],
      landmarks[386],
      landmarks[374],
    ]);
    const eyeMidY = (leftEyeCenter.y + rightEyeCenter.y) / 2;
    const mouthY = (landmarks[13].y + landmarks[14].y) / 2;

    const leftSpan = Math.abs(nose.x - leftCheek.x);
    const rightSpan = Math.abs(rightCheek.x - nose.x);
    const horizontalOffset = Math.abs(leftSpan - rightSpan) / faceWidth;
    const verticalRatio = (nose.y - eyeMidY) / Math.max(mouthY - eyeMidY, 0.001);

    const attentionState =
      horizontalOffset < 0.18 && verticalRatio > 0.18 && verticalRatio < 0.82
        ? "looking"
        : "away";

    const leftEar = this.eyeAspectRatio(
      landmarks[33],
      landmarks[133],
      landmarks[159],
      landmarks[145],
      landmarks[160],
      landmarks[144],
    );
    const rightEar = this.eyeAspectRatio(
      landmarks[263],
      landmarks[362],
      landmarks[386],
      landmarks[374],
      landmarks[387],
      landmarks[373],
    );
    const eyeState = leftEar < 0.18 && rightEar < 0.18 ? "closed" : "open";

    return {
      faceDetected: true,
      attentionState,
      eyeState,
    };
  }

  private eyeAspectRatio(
    outer: NormalizedLandmark,
    inner: NormalizedLandmark,
    topA: NormalizedLandmark,
    bottomA: NormalizedLandmark,
    topB: NormalizedLandmark,
    bottomB: NormalizedLandmark,
  ): number {
    const verticalA = this.distance(topA, bottomA);
    const verticalB = this.distance(topB, bottomB);
    const horizontal = Math.max(this.distance(outer, inner), 0.001);
    return (verticalA + verticalB) / (2 * horizontal);
  }

  private average(points: NormalizedLandmark[]): NormalizedLandmark {
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      z: points.reduce((sum, point) => sum + (point.z ?? 0), 0) / points.length,
      visibility: points.reduce((sum, point) => sum + (point.visibility ?? 1), 0) / points.length,
    };
  }

  private distance(left: NormalizedLandmark, right: NormalizedLandmark): number {
    return Math.hypot(left.x - right.x, left.y - right.y, (left.z ?? 0) - (right.z ?? 0));
  }
}
