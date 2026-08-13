import { EMPTY_CONTROLLER_STATE, PRODUCT_NAME } from "../shared/config";
import type {
  ControllerRuntimeState,
  PageOverlayRemoteState,
  PageStatus,
} from "../shared/types";
import {
  formatAttentionLabel,
  formatCommandLabel,
  formatEyeLabel,
  formatGestureLabel,
  formatHoldActionLabel,
} from "../utils/format";

interface OverlayState {
  pageStatus: PageStatus | null;
  remote: PageOverlayRemoteState;
}

const DEFAULT_REMOTE_STATE: PageOverlayRemoteState = {
  targetTabActive: false,
  controller: { ...EMPTY_CONTROLLER_STATE },
  previewDataUrl: null,
};

export class PageOverlay {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly sourceChip: HTMLSpanElement;
  private readonly videoChip: HTMLSpanElement;
  private readonly commandChip: HTMLSpanElement;
  private readonly recognitionLabel: HTMLDivElement;
  private readonly recognitionDetail: HTMLDivElement;
  private readonly messageLabel: HTMLDivElement;
  private readonly footerLabel: HTMLDivElement;
  private readonly debugLabel: HTMLDivElement;
  private state: OverlayState = {
    pageStatus: null,
    remote: { ...DEFAULT_REMOTE_STATE },
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
            <div class="eyebrow">Canlı takip</div>
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

    this.panel = shadowRoot.querySelector(".panel") as HTMLDivElement;
    this.sourceChip = shadowRoot.querySelector(".source-chip") as HTMLSpanElement;
    this.videoChip = shadowRoot.querySelector(".video-chip") as HTMLSpanElement;
    this.commandChip = shadowRoot.querySelector(".command-chip") as HTMLSpanElement;
    this.recognitionLabel = shadowRoot.querySelector(
      ".recognition-label",
    ) as HTMLDivElement;
    this.recognitionDetail = shadowRoot.querySelector(
      ".recognition-detail",
    ) as HTMLDivElement;
    this.messageLabel = shadowRoot.querySelector(".message") as HTMLDivElement;
    this.footerLabel = shadowRoot.querySelector(".footer") as HTMLDivElement;
    this.debugLabel = shadowRoot.querySelector(".debug") as HTMLDivElement;

    document.documentElement.appendChild(this.root);
    this.render();
  }

  updatePageStatus(status: PageStatus) {
    this.state = {
      ...this.state,
      pageStatus: status,
    };
    this.render();
  }

  applyRemoteState(remote: PageOverlayRemoteState) {
    this.state = {
      ...this.state,
      remote,
    };
    this.render();
  }

  private render() {
    const { pageStatus, remote } = this.state;
    const controller = remote.controller;
    const shouldShow = remote.targetTabActive;

    this.panel.classList.toggle("hidden", !shouldShow);
    if (!shouldShow) {
      return;
    }

    const recognition = this.describeRecognition(controller);
    const videoLabel = pageStatus?.videoDetected ? "Video bağlı" : "Video bekleniyor";
    const footerDetail = pageStatus?.videoDetected
      ? pageStatus.primaryVideoReason
      : "Komut almak için bu sekmede bir HTML5 video açın.";

    this.sourceChip.textContent = recognition.source;
    this.videoChip.textContent = videoLabel;
    this.commandChip.textContent = this.getCommandLabel(controller);
    this.recognitionLabel.textContent = recognition.title;
    this.recognitionDetail.textContent = recognition.detail;
    this.messageLabel.textContent =
      controller.lastCommandMessage || "Takibi başlatmak için yüzünüzü veya elinizi kameraya gösterin.";
    this.footerLabel.textContent = footerDetail;

    if (controller.debug) {
      const d = controller.debug;
      const canned = d.cannedLabel ? `${d.cannedLabel}(${d.cannedScore.toFixed(2)})` : "—";
      this.debugLabel.textContent =
        `${d.primaryGesture} · ${d.primaryConfidence.toFixed(2)} · curl ${d.curledCount}/4 · ext ${d.extendedCount}/4 · ${d.orientation} · canned ${canned}`;
      this.debugLabel.classList.remove("hidden");
    } else {
      this.debugLabel.classList.add("hidden");
    }
  }

  private getCommandLabel(controller: ControllerRuntimeState): string {
    if (controller.activeHoldAction !== "NONE") {
      return formatHoldActionLabel(controller.activeHoldAction);
    }

    if (controller.lastCommand) {
      return formatCommandLabel(controller.lastCommand);
    }

    if (controller.cameraStatus === "requesting" || controller.status === "starting") {
      return "Başlatılıyor";
    }

    return "Dinleniyor";
  }

  private describeRecognition(controller: ControllerRuntimeState): {
    source: string;
    title: string;
    detail: string;
  } {
    if (controller.cameraStatus === "blocked") {
      return {
        source: "Kamera",
        title: "Kamera engelli",
        detail: "Uzantı için kamera erişimine izin verip yeniden deneyin.",
      };
    }

    if (controller.cameraStatus === "error") {
      return {
        source: "Kamera",
        title: "Kamera hatası",
        detail: controller.lastCommandMessage || "Kamera akışı başlatılamadı.",
      };
    }

    if (controller.cameraStatus === "requesting" || controller.status === "starting") {
      return {
        source: "Kamera",
        title: "Kamera izni bekleniyor",
        detail: "Canlı takibi başlatmak için kamera erişimini onaylayın.",
      };
    }

    if (controller.activeHoldAction !== "NONE") {
      return {
        source: "El",
        title: formatHoldActionLabel(controller.activeHoldAction),
        detail: "Basılı tutma hareketi aktif. Hareket sürdükçe komut göndermeye devam eder.",
      };
    }

    if (
      controller.currentGesture !== "NONE" &&
      controller.currentGesture !== "NO_HAND" &&
      controller.currentGesture !== "TRACKING"
    ) {
      return {
        source: "El",
        title: formatGestureLabel(controller.currentGesture),
        detail: "Canlı kamera görüntüsünden el hareketi tanındı.",
      };
    }

    if (controller.eyeState === "closed" && controller.faceDetected) {
      return {
        source: "Yüz",
        title: "Gözler kapalı",
        detail: "Göz kapama kuralı iki gözü de kapalı görüyor.",
      };
    }

    if (controller.attentionState === "away") {
      return {
        source: "Yüz",
        title: "Ekrandan uzakta",
        detail: "Yüz takibi ekrandan uzak baktığınızı algılıyor.",
      };
    }

    if (controller.faceDetected) {
      return {
        source: "Yüz",
        title: formatEyeLabel(controller.eyeState, controller.faceDetected),
        detail: formatAttentionLabel(
          controller.attentionState,
          controller.faceDetected,
        ),
      };
    }

    if (controller.handVisible || controller.currentGesture === "TRACKING") {
      return {
        source: "El",
        title: "El izleniyor",
        detail: "Açık avuç oynatır, kapalı yumruk duraklatır, başparmak yukarı/aşağı sesi, sağ/sol ise videoyu sarar.",
      };
    }

    return {
      source: "Kamera",
      title: "Yüz veya el bekleniyor",
      detail: "Takibin kilitlenmesi için kamera alanına girin.",
    };
  }
}
