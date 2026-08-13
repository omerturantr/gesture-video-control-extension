// src/shared/messaging.ts
var MESSAGE_TYPES = {
  getPageStatus: "GET_PAGE_STATUS",
  pageStatusUpdated: "PAGE_STATUS_UPDATED",
  getPageOverlayState: "GET_PAGE_OVERLAY_STATE",
  pageOverlayStateUpdated: "PAGE_OVERLAY_STATE_UPDATED",
  executeVideoCommand: "EXECUTE_VIDEO_COMMAND",
  getAppState: "GET_APP_STATE",
  startController: "START_CONTROLLER",
  stopController: "STOP_CONTROLLER",
  startVisibleController: "START_VISIBLE_CONTROLLER",
  updateSettings: "UPDATE_SETTINGS",
  offscreenStart: "OFFSCREEN_START",
  offscreenStop: "OFFSCREEN_STOP",
  offscreenUpdateSettings: "OFFSCREEN_UPDATE_SETTINGS",
  offscreenStateUpdated: "OFFSCREEN_STATE_UPDATED",
  offscreenPreviewUpdated: "OFFSCREEN_PREVIEW_UPDATED"
};

// src/shared/config.ts
var PRODUCT_NAME = "GestureFlow Kontrol";
var EMPTY_CONTROLLER_STATE = {
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
  lastCommandMessage: "Haz\u0131r.",
  attentionElapsedMs: 0,
  eyeClosureElapsedMs: 0,
  updatedAt: 0
};
var COMMAND_LABELS = {
  PLAY: "Oynat",
  PAUSE: "Duraklat",
  TOGGLE_PLAYBACK: "Oynat / duraklat",
  SEEK_FORWARD: "\u0130leri sar",
  SEEK_BACKWARD: "Geri sar",
  VOLUME_UP: "Sesi art\u0131r",
  VOLUME_DOWN: "Sesi azalt",
  PLAYBACK_RATE_UP: "H\u0131z\u0131 art\u0131r",
  PLAYBACK_RATE_DOWN: "H\u0131z\u0131 azalt",
  TOGGLE_FULLSCREEN: "Tam ekran",
  MUTE: "Sessize al"
};
var GESTURE_LABELS = {
  NONE: "Bo\u015Fta",
  NO_HAND: "El alg\u0131lanmad\u0131",
  OPEN_PALM: "A\xE7\u0131k avu\xE7",
  CLOSED_FIST: "Kapal\u0131 yumruk",
  MODIFIER_FIST: "Yard\u0131mc\u0131 yumruk",
  THUMB_UP: "Ba\u015Fparmak yukar\u0131",
  THUMB_DOWN: "Ba\u015Fparmak a\u015Fa\u011F\u0131",
  THUMB_LEFT: "Ba\u015Fparmak sola",
  THUMB_RIGHT: "Ba\u015Fparmak sa\u011Fa",
  TRACKING: "El izleniyor"
};
var HOLD_ACTION_LABELS = {
  NONE: "Bo\u015Fta",
  SEEK_FORWARD: "\u0130leri sar\u0131l\u0131yor",
  SEEK_BACKWARD: "Geri sar\u0131l\u0131yor",
  VOLUME_UP: "Ses art\u0131r\u0131l\u0131yor",
  VOLUME_DOWN: "Ses azalt\u0131l\u0131yor",
  PLAYBACK_RATE_UP: "H\u0131z art\u0131r\u0131l\u0131yor",
  PLAYBACK_RATE_DOWN: "H\u0131z azalt\u0131l\u0131yor"
};
var VIDEO_SCAN_INTERVAL_MS = 1500;
var VIDEO_SELECTION_MIN_AREA = 18e3;
var VIDEO_SELECTION_MIN_VISIBLE_RATIO = 0.2;
var PLAYBACK_RATE_MIN = 0.25;
var PLAYBACK_RATE_MAX = 3;

// src/utils/format.ts
function formatGestureLabel(label) {
  return GESTURE_LABELS[label] ?? label;
}
function formatHoldActionLabel(action) {
  return HOLD_ACTION_LABELS[action] ?? action;
}
function formatCommandLabel(command) {
  return command ? COMMAND_LABELS[command] : "Yok";
}
function formatAttentionLabel(state, faceDetected) {
  if (!faceDetected) {
    return "Y\xFCz yok";
  }
  if (state === "looking") {
    return "Ekranda";
  }
  if (state === "away") {
    return "Ba\u015Fka y\xF6ne bak\u0131yor";
  }
  return "Kontrol ediliyor";
}
function formatEyeLabel(state, faceDetected) {
  if (!faceDetected) {
    return "Y\xFCz yok";
  }
  if (state === "open") {
    return "G\xF6zler a\xE7\u0131k";
  }
  if (state === "closed") {
    return "G\xF6zler kapal\u0131";
  }
  return "Kontrol ediliyor";
}

// src/content/overlay.ts
var DEFAULT_REMOTE_STATE = {
  targetTabActive: false,
  controller: { ...EMPTY_CONTROLLER_STATE },
  previewDataUrl: null
};
var PageOverlay = class {
  root;
  panel;
  sourceChip;
  videoChip;
  commandChip;
  recognitionLabel;
  recognitionDetail;
  messageLabel;
  footerLabel;
  debugLabel;
  state = {
    pageStatus: null,
    remote: { ...DEFAULT_REMOTE_STATE }
  };
  constructor() {
    this.root = document.createElement("div");
    this.root.setAttribute("data-gestureflow-overlay", "true");
    const shadowRoot = this.root.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        .panel {
          position: fixed;
          right: 18px;
          bottom: 18px;
          width: min(286px, calc(100vw - 24px));
          z-index: 2147483647;
          font-family: "Aptos", "Segoe UI", sans-serif;
          color: #f8fafc;
          background: rgba(17, 24, 39, 0.96);
          border: 1px solid rgba(226, 232, 240, 0.14);
          border-radius: 8px;
          box-shadow: 0 18px 42px rgba(2, 6, 23, 0.32);
          padding: 14px;
          pointer-events: none;
          opacity: 1;
          transform: translateY(0);
          transition: opacity 160ms ease, transform 160ms ease;
        }

        .panel.hidden {
          opacity: 0;
          transform: translateY(12px);
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
          color: #9ca3af;
        }

        .product {
          margin-top: 2px;
          font-size: 14px;
          font-weight: 700;
        }

        .video-chip {
          border-radius: 999px;
          padding: 5px 9px;
          background: rgba(240, 253, 250, 0.12);
          border: 1px solid rgba(240, 253, 250, 0.16);
          font-size: 11px;
          font-weight: 700;
          color: #ccfbf1;
          white-space: nowrap;
        }

        .signal-card {
          padding: 14px;
          background: rgba(31, 41, 55, 0.72);
          border: 1px solid rgba(226, 232, 240, 0.1);
          border-radius: 8px;
        }

        .signal-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .chip {
          border-radius: 999px;
          padding: 5px 9px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          white-space: nowrap;
        }

        .source-chip {
          color: #ccfbf1;
          background: rgba(15, 118, 110, 0.72);
        }

        .command-chip {
          color: #f9fafb;
          background: rgba(75, 85, 99, 0.82);
          border: 1px solid rgba(249, 250, 251, 0.12);
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 58%;
        }

        .recognition-label {
          margin-top: 14px;
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
        }

        .recognition-detail {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.45;
          color: rgba(226, 232, 240, 0.92);
        }

        .message {
          margin-top: 12px;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.45;
        }

        .footer {
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.45;
          color: rgba(191, 219, 254, 0.88);
        }

        .debug {
          margin-top: 8px;
          padding: 6px 8px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          line-height: 1.4;
          color: #fde68a;
          background: rgba(15, 23, 42, 0.62);
          border: 1px solid rgba(253, 230, 138, 0.18);
          border-radius: 6px;
          word-break: break-all;
        }

        .debug.hidden {
          display: none;
        }

        @media (max-width: 640px) {
          .panel {
            right: 12px;
            bottom: 12px;
            width: min(280px, calc(100vw - 16px));
          }
        }
      </style>
      <div class="panel hidden">
        <div class="header">
          <div>
            <div class="eyebrow">Canl\u0131 takip</div>
            <div class="product">${PRODUCT_NAME}</div>
          </div>
          <span class="video-chip"></span>
        </div>
        <div class="signal-card">
          <div class="signal-top">
            <span class="chip source-chip"></span>
            <span class="chip command-chip"></span>
          </div>
          <div class="recognition-label"></div>
          <div class="recognition-detail"></div>
        </div>
        <div class="message"></div>
        <div class="footer"></div>
        <div class="debug hidden"></div>
      </div>
    `;
    this.panel = shadowRoot.querySelector(".panel");
    this.sourceChip = shadowRoot.querySelector(".source-chip");
    this.videoChip = shadowRoot.querySelector(".video-chip");
    this.commandChip = shadowRoot.querySelector(".command-chip");
    this.recognitionLabel = shadowRoot.querySelector(
      ".recognition-label"
    );
    this.recognitionDetail = shadowRoot.querySelector(
      ".recognition-detail"
    );
    this.messageLabel = shadowRoot.querySelector(".message");
    this.footerLabel = shadowRoot.querySelector(".footer");
    this.debugLabel = shadowRoot.querySelector(".debug");
    document.documentElement.appendChild(this.root);
    this.render();
  }
  updatePageStatus(status) {
    this.state = {
      ...this.state,
      pageStatus: status
    };
    this.render();
  }
  applyRemoteState(remote) {
    this.state = {
      ...this.state,
      remote
    };
    this.render();
  }
  render() {
    const { pageStatus, remote } = this.state;
    const controller = remote.controller;
    const shouldShow = remote.targetTabActive;
    this.panel.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) {
      return;
    }
    const recognition = this.describeRecognition(controller);
    const videoLabel = pageStatus?.videoDetected ? "Video ba\u011Fl\u0131" : "Video bekleniyor";
    const footerDetail = pageStatus?.videoDetected ? pageStatus.primaryVideoReason : "Komut almak i\xE7in bu sekmede bir HTML5 video a\xE7\u0131n.";
    this.sourceChip.textContent = recognition.source;
    this.videoChip.textContent = videoLabel;
    this.commandChip.textContent = this.getCommandLabel(controller);
    this.recognitionLabel.textContent = recognition.title;
    this.recognitionDetail.textContent = recognition.detail;
    this.messageLabel.textContent = controller.lastCommandMessage || "Takibi ba\u015Flatmak i\xE7in y\xFCz\xFCn\xFCz\xFC veya elinizi kameraya g\xF6sterin.";
    this.footerLabel.textContent = footerDetail;
    if (controller.debug) {
      const d = controller.debug;
      const canned = d.cannedLabel ? `${d.cannedLabel}(${d.cannedScore.toFixed(2)})` : "\u2014";
      this.debugLabel.textContent = `${d.primaryGesture} \xB7 ${d.primaryConfidence.toFixed(2)} \xB7 curl ${d.curledCount}/4 \xB7 ext ${d.extendedCount}/4 \xB7 ${d.orientation} \xB7 canned ${canned}`;
      this.debugLabel.classList.remove("hidden");
    } else {
      this.debugLabel.classList.add("hidden");
    }
  }
  getCommandLabel(controller) {
    if (controller.activeHoldAction !== "NONE") {
      return formatHoldActionLabel(controller.activeHoldAction);
    }
    if (controller.lastCommand) {
      return formatCommandLabel(controller.lastCommand);
    }
    if (controller.cameraStatus === "requesting" || controller.status === "starting") {
      return "Ba\u015Flat\u0131l\u0131yor";
    }
    return "Dinleniyor";
  }
  describeRecognition(controller) {
    if (controller.cameraStatus === "blocked") {
      return {
        source: "Kamera",
        title: "Kamera engelli",
        detail: "Uzant\u0131 i\xE7in kamera eri\u015Fimine izin verip yeniden deneyin."
      };
    }
    if (controller.cameraStatus === "error") {
      return {
        source: "Kamera",
        title: "Kamera hatas\u0131",
        detail: controller.lastCommandMessage || "Kamera ak\u0131\u015F\u0131 ba\u015Flat\u0131lamad\u0131."
      };
    }
    if (controller.cameraStatus === "requesting" || controller.status === "starting") {
      return {
        source: "Kamera",
        title: "Kamera izni bekleniyor",
        detail: "Canl\u0131 takibi ba\u015Flatmak i\xE7in kamera eri\u015Fimini onaylay\u0131n."
      };
    }
    if (controller.activeHoldAction !== "NONE") {
      return {
        source: "El",
        title: formatHoldActionLabel(controller.activeHoldAction),
        detail: "Bas\u0131l\u0131 tutma hareketi aktif. Hareket s\xFCrd\xFCk\xE7e komut g\xF6ndermeye devam eder."
      };
    }
    if (controller.currentGesture !== "NONE" && controller.currentGesture !== "NO_HAND" && controller.currentGesture !== "TRACKING") {
      return {
        source: "El",
        title: formatGestureLabel(controller.currentGesture),
        detail: "Canl\u0131 kamera g\xF6r\xFCnt\xFCs\xFCnden el hareketi tan\u0131nd\u0131."
      };
    }
    if (controller.eyeState === "closed" && controller.faceDetected) {
      return {
        source: "Y\xFCz",
        title: "G\xF6zler kapal\u0131",
        detail: "G\xF6z kapama kural\u0131 iki g\xF6z\xFC de kapal\u0131 g\xF6r\xFCyor."
      };
    }
    if (controller.attentionState === "away") {
      return {
        source: "Y\xFCz",
        title: "Ekrandan uzakta",
        detail: "Y\xFCz takibi ekrandan uzak bakt\u0131\u011F\u0131n\u0131z\u0131 alg\u0131l\u0131yor."
      };
    }
    if (controller.faceDetected) {
      return {
        source: "Y\xFCz",
        title: formatEyeLabel(controller.eyeState, controller.faceDetected),
        detail: formatAttentionLabel(
          controller.attentionState,
          controller.faceDetected
        )
      };
    }
    if (controller.handVisible || controller.currentGesture === "TRACKING") {
      return {
        source: "El",
        title: "El izleniyor",
        detail: "A\xE7\u0131k avu\xE7 oynat\u0131r, kapal\u0131 yumruk duraklat\u0131r, ba\u015Fparmak yukar\u0131/a\u015Fa\u011F\u0131 sesi, sa\u011F/sol ise videoyu sarar."
      };
    }
    return {
      source: "Kamera",
      title: "Y\xFCz veya el bekleniyor",
      detail: "Takibin kilitlenmesi i\xE7in kamera alan\u0131na girin."
    };
  }
};

// src/content/video-selector.ts
function getViewportIntersectionArea(rect) {
  const overlapWidth = Math.max(
    0,
    Math.min(window.innerWidth, rect.right) - Math.max(0, rect.left)
  );
  const overlapHeight = Math.max(
    0,
    Math.min(window.innerHeight, rect.bottom) - Math.max(0, rect.top)
  );
  return overlapWidth * overlapHeight;
}
function isElementVisible(video, rect) {
  const style = window.getComputedStyle(video);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.05 && rect.width > 80 && rect.height > 60;
}
function scoreVideo(video) {
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
  const proximityBonus = Math.max(0, 2e4 - centerDistance * 15);
  const playbackBonus = !video.paused && !video.ended ? 4e4 : 0;
  const controlsBonus = video.controls ? 5e3 : 0;
  const sourceBonus = video.currentSrc ? 3500 : 0;
  const score = area * visibleRatio + proximityBonus + playbackBonus + controlsBonus + sourceBonus;
  return {
    element: video,
    score,
    visibleRatio,
    area,
    reason: `En b\xFCy\xFCk g\xF6r\xFCn\xFCr oynat\u0131c\u0131 se\xE7ildi (${Math.round(
      rect.width
    )}x${Math.round(rect.height)}), g\xF6r\xFCn\xFCrl\xFCk %${Math.round(visibleRatio * 100)}.`
  };
}
function getVideoCandidates() {
  return Array.from(document.querySelectorAll("video")).map((video) => scoreVideo(video)).filter((candidate) => Boolean(candidate)).sort((left, right) => right.score - left.score);
}
function selectPrimaryVideo() {
  return getVideoCandidates()[0] ?? null;
}
function createVideoSnapshot(video) {
  return {
    paused: video.paused,
    ended: video.ended,
    muted: video.muted,
    volume: video.volume,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    playbackRate: video.playbackRate,
    readyState: video.readyState,
    title: document.title || null
  };
}

// src/content/video-controller.ts
var VideoController = class {
  onStatusChange;
  mutationObserver;
  currentCandidate = null;
  refreshIntervalId = null;
  cleanupVideoListeners = null;
  latestStatus = this.createStatus(null, "Sayfada HTML5 video aran\u0131yor.");
  constructor(options) {
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
      attributeFilter: ["src", "style", "class"]
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
  getStatus() {
    return this.latestStatus;
  }
  async executeCommand(command, options = {}) {
    this.refreshTarget();
    if (!this.currentCandidate) {
      return {
        ok: false,
        command,
        applied: false,
        message: "Bu sayfada oynat\u0131labilir HTML5 video bulunamad\u0131.",
        status: this.latestStatus,
        options
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
        return this.createCommandResult(command, true, "Oynatma komutu g\xF6nderildi.", options);
      }
      if (command === "PAUSE") {
        if (video.paused) {
          return this.createCommandResult(command, false, "Video zaten duraklat\u0131lm\u0131\u015F.", options);
        }
        video.pause();
        return this.createCommandResult(command, true, "Duraklatma komutu g\xF6nderildi.", options);
      }
      if (command === "TOGGLE_PLAYBACK") {
        if (video.paused) {
          await video.play();
        } else {
          video.pause();
        }
        return this.createCommandResult(command, true, "Oynatma durumu de\u011Fi\u015Ftirildi.", options);
      }
      if (command === "SEEK_FORWARD" || command === "SEEK_BACKWARD") {
        const direction = command === "SEEK_FORWARD" ? 1 : -1;
        const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
        const nextTime = Math.min(Math.max(video.currentTime + direction * seekSeconds, 0), duration);
        video.currentTime = nextTime;
        return this.createCommandResult(
          command,
          true,
          `${command === "SEEK_FORWARD" ? "\u0130leri sar\u0131ld\u0131" : "Geri sar\u0131ld\u0131"}: ${seekSeconds.toFixed(1)} saniye.`,
          options
        );
      }
      if (command === "MUTE") {
        video.muted = !video.muted;
        return this.createCommandResult(
          command,
          true,
          video.muted ? "Video sessize al\u0131nd\u0131." : "Video sesi a\xE7\u0131ld\u0131.",
          options
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
        if (nextVolume === referenceVideo.volume && (nextVolume === 0 || nextVolume === 1) && !referenceVideo.muted) {
          return this.createCommandResult(
            command,
            false,
            `Ses zaten %${Math.round(nextVolume * 100)} seviyesinde.`,
            options
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
          PLAYBACK_RATE_MAX
        );
        if (nextRate === video.playbackRate) {
          return this.createCommandResult(
            command,
            false,
            `Oynatma h\u0131z\u0131 zaten ${video.playbackRate.toFixed(2)}x.`,
            options
          );
        }
        video.playbackRate = nextRate;
        return this.createCommandResult(
          command,
          true,
          `Oynatma h\u0131z\u0131 ${video.playbackRate.toFixed(2)}x.`,
          options
        );
      }
      if (command === "TOGGLE_FULLSCREEN") {
        const target = video.parentElement ?? video;
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else if (target.requestFullscreen) {
          await target.requestFullscreen();
        }
        return this.createCommandResult(command, true, "Tam ekran durumu de\u011Fi\u015Ftirildi.", options);
      }
      return this.createCommandResult(command, false, "Desteklenmeyen komut.", options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bilinmeyen oynatma hatas\u0131.";
      return {
        ok: false,
        command,
        applied: false,
        message,
        status: this.latestStatus,
        options
      };
    }
  }
  refreshTarget = () => {
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
      nextCandidate?.reason ?? "G\xF6r\xFCn\xFCr birincil video bulunamad\u0131."
    );
    this.onStatusChange(this.latestStatus);
  };
  getVolumeTargets() {
    const visibleCandidates = getVideoCandidates().map((candidate) => candidate.element);
    const uniqueTargets = new Set(visibleCandidates);
    if (this.currentCandidate?.element) {
      uniqueTargets.add(this.currentCandidate.element);
    }
    return Array.from(uniqueTargets);
  }
  applySiteSpecificVolume(command, options) {
    const youtubeResult = this.applyYoutubeVolume(command, options);
    if (youtubeResult) {
      return youtubeResult;
    }
    return null;
  }
  applyYoutubeVolume(command, options) {
    const moviePlayer = document.querySelector("#movie_player");
    if (!moviePlayer || typeof moviePlayer.getVolume !== "function" || typeof moviePlayer.setVolume !== "function") {
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
        options
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
  createStatus(candidate, reason) {
    return {
      pageSupported: /^https?:\/\//.test(window.location.href),
      url: window.location.href,
      title: document.title,
      videoDetected: Boolean(candidate),
      videoCount: document.querySelectorAll("video").length,
      multipleVideos: document.querySelectorAll("video").length > 1,
      primaryVideoReason: reason,
      lastUpdatedAt: Date.now(),
      snapshot: candidate ? createVideoSnapshot(candidate.element) : null
    };
  }
  attachVideoListeners(video) {
    const handler = () => {
      this.latestStatus = this.createStatus(
        this.currentCandidate,
        this.currentCandidate?.reason ?? "Ge\xE7erli video izleniyor."
      );
      this.onStatusChange(this.latestStatus);
    };
    const eventNames = [
      "play",
      "pause",
      "seeking",
      "seeked",
      "ratechange",
      "volumechange",
      "loadedmetadata",
      "emptied"
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
  createCommandResult(command, applied, message, options) {
    this.latestStatus = this.createStatus(this.currentCandidate, this.currentCandidate?.reason ?? message);
    this.onStatusChange(this.latestStatus);
    return {
      ok: true,
      command,
      applied,
      message,
      status: this.latestStatus,
      options
    };
  }
};

// src/content/content-script.ts
var contentScriptWindow = window;
if (!contentScriptWindow.__gestureFlowContentScriptStarted) {
  contentScriptWindow.__gestureFlowContentScriptStarted = true;
  const overlay = new PageOverlay();
  async function reportPageStatus(status) {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.pageStatusUpdated,
        status
      });
    } catch {
    }
  }
  const controller = new VideoController({
    onStatusChange: (status) => {
      overlay.updatePageStatus(status);
      void reportPageStatus(status);
    }
  });
  controller.start();
  async function refreshOverlayState() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.getPageOverlayState
      });
      if (response?.ok) {
        overlay.applyRemoteState(response.state);
      }
    } catch {
    }
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.pageOverlayStateUpdated) {
      overlay.applyRemoteState(message.state);
      sendResponse({ ok: true });
      return;
    }
    if (message.type === MESSAGE_TYPES.getPageStatus) {
      sendResponse({
        ok: true,
        status: controller.getStatus()
      });
      return;
    }
    if (message.type === MESSAGE_TYPES.executeVideoCommand) {
      void controller.executeCommand(message.command, {
        seekSeconds: message.seekSeconds,
        volumeDelta: message.volumeDelta,
        playbackRateDelta: message.playbackRateDelta
      }).then((result) => {
        sendResponse(result);
      });
      return true;
    }
  });
  window.addEventListener("beforeunload", () => {
    controller.stop();
  });
  void refreshOverlayState();
}
//# sourceMappingURL=content-script.js.map
