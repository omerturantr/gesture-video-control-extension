import {
  VIDEO_SELECTION_MIN_AREA,
  VIDEO_SELECTION_MIN_VISIBLE_RATIO,
} from "../shared/config";
import type { ActiveVideoSnapshot } from "../shared/types";

export interface VideoCandidate {
  element: HTMLVideoElement;
  score: number;
  reason: string;
  visibleRatio: number;
  area: number;
}

function getViewportIntersectionArea(rect: DOMRect): number {
  const overlapWidth = Math.max(
    0,
    Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top),
  );

  return overlapWidth * overlapHeight;
}

function isElementVisible(video: HTMLVideoElement, rect: DOMRect): boolean {
  const style = window.getComputedStyle(video);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0.05 &&
    rect.width > 80 &&
    rect.height > 60
  );
}

function scoreVideo(video: HTMLVideoElement): VideoCandidate | null {
  const rect = video.getBoundingClientRect();
  const area = rect.width * rect.height;

  if (!isElementVisible(video, rect) || area < VIDEO_SELECTION_MIN_AREA) {
    return null;
  }

  const visibleArea = getViewportIntersectionArea(rect);
  const visibleRatio = area > 0 ? visibleArea / area : 0;

  if (visibleRatio < VIDEO_SELECTION_MIN_VISIBLE_RATIO) {
    return null;
  }

  const viewportCenterX = window.innerWidth / 2;
  const viewportCenterY = window.innerHeight / 2;
  const videoCenterX = rect.left + rect.width / 2;
  const videoCenterY = rect.top + rect.height / 2;
  const centerDistance = Math.hypot(videoCenterX - viewportCenterX, videoCenterY - viewportCenterY);
  const proximityBonus = Math.max(0, 20_000 - centerDistance * 15);
  const playbackBonus = !video.paused && !video.ended ? 40_000 : 0;
  const controlsBonus = video.controls ? 5_000 : 0;
  const sourceBonus = video.currentSrc ? 3_500 : 0;

  const score = area * visibleRatio + proximityBonus + playbackBonus + controlsBonus + sourceBonus;

  return {
    element: video,
    score,
    visibleRatio,
    area,
    reason: `En büyük görünür oynatıcı seçildi (${Math.round(
      rect.width,
    )}x${Math.round(rect.height)}), görünürlük %${Math.round(visibleRatio * 100)}.`,
  };
}

export function getVideoCandidates(): VideoCandidate[] {
  return Array.from(document.querySelectorAll("video"))
    .map((video) => scoreVideo(video))
    .filter((candidate): candidate is VideoCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score);
}

export function selectPrimaryVideo(): VideoCandidate | null {
  return getVideoCandidates()[0] ?? null;
}

export function createVideoSnapshot(video: HTMLVideoElement): ActiveVideoSnapshot {
  return {
    paused: video.paused,
    ended: video.ended,
    muted: video.muted,
    volume: video.volume,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    playbackRate: video.playbackRate,
    readyState: video.readyState,
    title: document.title || null,
  };
}
