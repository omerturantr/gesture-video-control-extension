import {
  MESSAGE_TYPES,
  type ExecuteCommandResponse,
  type PageOverlayStateResponse,
  type PageStatusResponse,
  type RuntimeMessage,
} from "../shared/messaging";
import type { PageStatus } from "../shared/types";
import { PageOverlay } from "./overlay";
import { VideoController } from "./video-controller";

const contentScriptWindow = window as Window & {
  __gestureFlowContentScriptStarted?: boolean;
};

if (!contentScriptWindow.__gestureFlowContentScriptStarted) {
  contentScriptWindow.__gestureFlowContentScriptStarted = true;

  const overlay = new PageOverlay();

  async function reportPageStatus(status: PageStatus) {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.pageStatusUpdated,
        status,
      } satisfies RuntimeMessage);
    } catch {
      // Background may be restarting; the content script can safely continue.
    }
  }

  const controller = new VideoController({
    onStatusChange: (status) => {
      overlay.updatePageStatus(status);
      void reportPageStatus(status);
    },
  });

  controller.start();

  async function refreshOverlayState() {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.getPageOverlayState,
      } satisfies RuntimeMessage)) as PageOverlayStateResponse;

      if (response?.ok) {
        overlay.applyRemoteState(response.state);
      }
    } catch {
      // Background may be restarting; overlay will recover on the next update.
    }
  }

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.pageOverlayStateUpdated) {
      overlay.applyRemoteState(message.state);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === MESSAGE_TYPES.getPageStatus) {
      sendResponse({
        ok: true,
        status: controller.getStatus(),
      } satisfies PageStatusResponse);
      return;
    }

    if (message.type === MESSAGE_TYPES.executeVideoCommand) {
      void controller
        .executeCommand(message.command, {
          seekSeconds: message.seekSeconds,
          volumeDelta: message.volumeDelta,
          playbackRateDelta: message.playbackRateDelta,
        })
        .then((result) => {
          sendResponse(result satisfies ExecuteCommandResponse);
        });
      return true;
    }
  });

  window.addEventListener("beforeunload", () => {
    controller.stop();
  });

  void refreshOverlayState();
}
