import type {
  CommandExecutionResult,
  CommandOptions,
  PageStatus,
  VideoCommand,
} from "../shared/types";
import {
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  VIDEO_SCAN_INTERVAL_MS,
} from "../shared/config";
import {
  createVideoSnapshot,
  getVideoCandidates,
  selectPrimaryVideo,
  type VideoCandidate,
} from "./video-selector";

interface ControllerOptions {
  onStatusChange: (status: PageStatus) => void;
}

interface YoutubePlayerLike {
  getVolume?: () => number;
  setVolume?: (value: number) => void;
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
}

export class VideoController {
  private readonly onStatusChange: (status: PageStatus) => void;
  private readonly mutationObserver: MutationObserver;
  private currentCandidate: VideoCandidate | null = null;
  private refreshIntervalId: number | null = null;
  private cleanupVideoListeners: (() => void) | null = null;
  private latestStatus: PageStatus = this.createStatus(null, "Sayfada HTML5 video aranıyor.");

  constructor(options: ControllerOptions) {
    this.onStatusChange = options.onStatusChange;
    this.mutationObserver = new MutationObserver(() => {
      this.refreshTarget();
    });
  }

  start() {
    this.refreshTarget();
    this.mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "style", "class"],
    });
    this.refreshIntervalId = window.setInterval(() => {
      this.refreshTarget();
    }, VIDEO_SCAN_INTERVAL_MS);
    window.addEventListener("resize", this.refreshTarget);
  }

  stop() {
    this.mutationObserver.disconnect();
    if (this.refreshIntervalId) {
      window.clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }
    if (this.cleanupVideoListeners) {
      this.cleanupVideoListeners();
      this.cleanupVideoListeners = null;
    }
    window.removeEventListener("resize", this.refreshTarget);
  }

  getStatus(): PageStatus {
    return this.latestStatus;
  }

  async executeCommand(
    command: VideoCommand,
    options: CommandOptions = {},
  ): Promise<CommandExecutionResult> {
    this.refreshTarget();

    if (!this.currentCandidate) {
      return {
        ok: false,
        command,
        applied: false,
        message: "Bu sayfada oynatılabilir HTML5 video bulunamadı.",
        status: this.latestStatus,
        options,
      };
    }

    const video = this.currentCandidate.element;
    const seekSeconds = Math.max(options.seekSeconds ?? 10, 0.25);
    const volumeDelta = Math.max(options.volumeDelta ?? 0.1, 0.01);
    const playbackRateDelta = Math.max(options.playbackRateDelta ?? 0.1, 0.01);

    try {
      if (command === "PLAY") {
        if (!video.paused) {
          return this.createCommandResult(command, false, "Video zaten oynuyor.", options);
        }
        await video.play();
        return this.createCommandResult(command, true, "Oynatma komutu gönderildi.", options);
      }

      if (command === "PAUSE") {
        if (video.paused) {
          return this.createCommandResult(command, false, "Video zaten duraklatılmış.", options);
        }
        video.pause();
        return this.createCommandResult(command, true, "Duraklatma komutu gönderildi.", options);
      }

      if (command === "TOGGLE_PLAYBACK") {
        if (video.paused) {
          await video.play();
        } else {
          video.pause();
        }
        return this.createCommandResult(command, true, "Oynatma durumu değiştirildi.", options);
      }

      if (command === "SEEK_FORWARD" || command === "SEEK_BACKWARD") {
        const direction = command === "SEEK_FORWARD" ? 1 : -1;
        const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
        const nextTime = Math.min(Math.max(video.currentTime + direction * seekSeconds, 0), duration);
        video.currentTime = nextTime;
        return this.createCommandResult(
          command,
          true,
          `${command === "SEEK_FORWARD" ? "İleri sarıldı" : "Geri sarıldı"}: ${seekSeconds.toFixed(1)} saniye.`,
          options,
        );
      }

      if (command === "MUTE") {
        video.muted = !video.muted;
        return this.createCommandResult(
          command,
          true,
          video.muted ? "Video sessize alındı." : "Video sesi açıldı.",
          options,
        );
      }

      if (command === "VOLUME_UP" || command === "VOLUME_DOWN") {
        const siteVolumeResult = this.applySiteSpecificVolume(command, options);
        if (siteVolumeResult) {
          return siteVolumeResult;
        }

        const volumeTargets = this.getVolumeTargets();
        const referenceVideo = volumeTargets[0] ?? video;
        const delta = command === "VOLUME_UP" ? volumeDelta : -volumeDelta;
        const nextVolume = Math.min(Math.max(referenceVideo.volume + delta, 0), 1);

        if (
          nextVolume === referenceVideo.volume &&
          (nextVolume === 0 || nextVolume === 1) &&
          !referenceVideo.muted
        ) {
          return this.createCommandResult(
            command,
            false,
            `Ses zaten %${Math.round(nextVolume * 100)} seviyesinde.`,
            options,
          );
        }

        for (const targetVideo of volumeTargets) {
          targetVideo.muted = false;
          targetVideo.volume = nextVolume;
          targetVideo.muted = nextVolume === 0;
        }

        const volumePercent = Math.round(referenceVideo.volume * 100);
        const suffix = referenceVideo.muted || volumePercent === 0 ? " (sessiz)" : "";
        return this.createCommandResult(command, true, `Ses %${volumePercent}${suffix}.`, options);
      }

      if (command === "PLAYBACK_RATE_UP" || command === "PLAYBACK_RATE_DOWN") {
        const direction = command === "PLAYBACK_RATE_UP" ? 1 : -1;
        const nextRate = Math.min(
          Math.max(video.playbackRate + direction * playbackRateDelta, PLAYBACK_RATE_MIN),
          PLAYBACK_RATE_MAX,
        );

        if (nextRate === video.playbackRate) {
          return this.createCommandResult(
            command,
            false,
            `Oynatma hızı zaten ${video.playbackRate.toFixed(2)}x.`,
            options,
          );
        }

        video.playbackRate = nextRate;
        return this.createCommandResult(
          command,
          true,
          `Oynatma hızı ${video.playbackRate.toFixed(2)}x.`,
          options,
        );
      }

      if (command === "TOGGLE_FULLSCREEN") {
        const target = video.parentElement ?? video;
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if (target.requestFullscreen) {
          await target.requestFullscreen();
        }
        return this.createCommandResult(command, true, "Tam ekran durumu değiştirildi.", options);
      }

      return this.createCommandResult(command, false, "Desteklenmeyen komut.", options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen oynatma hatası.";
      return {
        ok: false,
        command,
        applied: false,
        message,
        status: this.latestStatus,
        options,
      };
    }
  }

  private readonly refreshTarget = () => {
    const nextCandidate = selectPrimaryVideo();
    const previousVideo = this.currentCandidate?.element ?? null;
    const nextVideo = nextCandidate?.element ?? null;

    if (previousVideo !== nextVideo) {
      this.cleanupVideoListeners?.();
      this.cleanupVideoListeners = nextVideo ? this.attachVideoListeners(nextVideo) : null;
    }

    this.currentCandidate = nextCandidate;
    this.latestStatus = this.createStatus(
      nextCandidate,
      nextCandidate?.reason ?? "Görünür birincil video bulunamadı.",
    );
    this.onStatusChange(this.latestStatus);
  };

  private getVolumeTargets(): HTMLVideoElement[] {
    const visibleCandidates = getVideoCandidates().map((candidate) => candidate.element);
    const uniqueTargets = new Set<HTMLVideoElement>(visibleCandidates);

    if (this.currentCandidate?.element) {
      uniqueTargets.add(this.currentCandidate.element);
    }

    return Array.from(uniqueTargets);
  }

  private applySiteSpecificVolume(
    command: VideoCommand,
    options: CommandOptions,
  ): CommandExecutionResult | null {
    const youtubeResult = this.applyYoutubeVolume(command, options);
    if (youtubeResult) {
      return youtubeResult;
    }

    return null;
  }

  private applyYoutubeVolume(
    command: VideoCommand,
    options: CommandOptions,
  ): CommandExecutionResult | null {
    const moviePlayer = document.querySelector("#movie_player") as YoutubePlayerLike | null;
    if (
      !moviePlayer ||
      typeof moviePlayer.getVolume !== "function" ||
      typeof moviePlayer.setVolume !== "function"
    ) {
      return null;
    }

    const currentVolume = Math.min(Math.max(moviePlayer.getVolume(), 0), 100);
    const stepPercent = Math.max(Math.round((options.volumeDelta ?? 0.1) * 100), 5);
    const delta = command === "VOLUME_UP" ? stepPercent : -stepPercent;
    const nextVolume = Math.min(Math.max(currentVolume + delta, 0), 100);

    if (nextVolume === currentVolume) {
      return this.createCommandResult(
        command,
        false,
        `Ses zaten %${currentVolume} seviyesinde.`,
        options,
      );
    }

    if (nextVolume > 0 && typeof moviePlayer.unMute === "function") {
      moviePlayer.unMute();
    }

    moviePlayer.setVolume(nextVolume);

    if (nextVolume === 0 && typeof moviePlayer.mute === "function") {
      moviePlayer.mute();
    }

    const targetVideo = this.currentCandidate?.element;
    if (targetVideo) {
      targetVideo.muted = nextVolume === 0;
      targetVideo.volume = nextVolume / 100;
    }

    const suffix = nextVolume === 0 ? " (sessiz)" : "";
    return this.createCommandResult(command, true, `Ses %${nextVolume}${suffix}.`, options);
  }

  private createStatus(candidate: VideoCandidate | null, reason: string): PageStatus {
    return {
      pageSupported: /^https?:\/\//.test(window.location.href),
      url: window.location.href,
      title: document.title,
      videoDetected: Boolean(candidate),
      videoCount: document.querySelectorAll("video").length,
      multipleVideos: document.querySelectorAll("video").length > 1,
      primaryVideoReason: reason,
      lastUpdatedAt: Date.now(),
      snapshot: candidate ? createVideoSnapshot(candidate.element) : null,
    };
  }

  private attachVideoListeners(video: HTMLVideoElement): () => void {
    const handler = () => {
      this.latestStatus = this.createStatus(
        this.currentCandidate,
        this.currentCandidate?.reason ?? "Geçerli video izleniyor.",
      );
      this.onStatusChange(this.latestStatus);
    };

    const eventNames: Array<keyof HTMLMediaElementEventMap> = [
      "play",
      "pause",
      "seeking",
      "seeked",
      "ratechange",
      "volumechange",
      "loadedmetadata",
      "emptied",
    ];

    for (const eventName of eventNames) {
      video.addEventListener(eventName, handler);
    }

    return () => {
      for (const eventName of eventNames) {
        video.removeEventListener(eventName, handler);
      }
    };
  }

  private createCommandResult(
    command: VideoCommand,
    applied: boolean,
    message: string,
    options: CommandOptions,
  ): CommandExecutionResult {
    this.latestStatus = this.createStatus(this.currentCandidate, this.currentCandidate?.reason ?? message);
    this.onStatusChange(this.latestStatus);
    return {
      ok: true,
      command,
      applied,
      message,
      status: this.latestStatus,
      options,
    };
  }
}
