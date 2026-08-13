import type {
  AppState,
  CommandExecutionResult,
  ControllerRuntimeState,
  ExtensionSettings,
  PageStatus,
  PageOverlayRemoteState,
  VideoCommand,
} from "./types";

export const MESSAGE_TYPES = {
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
  offscreenPreviewUpdated: "OFFSCREEN_PREVIEW_UPDATED",
} as const;

export type RuntimeMessage =
  | { type: typeof MESSAGE_TYPES.getPageStatus }
  | { type: typeof MESSAGE_TYPES.pageStatusUpdated; status: PageStatus }
  | { type: typeof MESSAGE_TYPES.getPageOverlayState }
  | {
      type: typeof MESSAGE_TYPES.pageOverlayStateUpdated;
      state: PageOverlayRemoteState;
    }
  | {
      type: typeof MESSAGE_TYPES.executeVideoCommand;
      command: VideoCommand;
      seekSeconds?: number;
      volumeDelta?: number;
      playbackRateDelta?: number;
      reason?: string;
      source: "gesture" | "popup" | "system";
    }
  | { type: typeof MESSAGE_TYPES.getAppState }
  | { type: typeof MESSAGE_TYPES.startController; tabId: number }
  | { type: typeof MESSAGE_TYPES.startVisibleController; tabId: number }
  | { type: typeof MESSAGE_TYPES.stopController }
  | {
      type: typeof MESSAGE_TYPES.updateSettings;
      settings: Partial<ExtensionSettings>;
    }
  | {
      type: typeof MESSAGE_TYPES.offscreenStart;
      settings: ExtensionSettings;
    }
  | { type: typeof MESSAGE_TYPES.offscreenStop }
  | {
      type: typeof MESSAGE_TYPES.offscreenUpdateSettings;
      settings: ExtensionSettings;
    }
  | {
      type: typeof MESSAGE_TYPES.offscreenStateUpdated;
      state: Partial<ControllerRuntimeState>;
    }
  | {
      type: typeof MESSAGE_TYPES.offscreenPreviewUpdated;
      previewDataUrl: string | null;
    };

export interface PageStatusResponse {
  ok: boolean;
  status: PageStatus;
}

export interface ExecuteCommandResponse extends CommandExecutionResult {}

export interface AppStateResponse {
  ok: boolean;
  state: AppState;
}

export interface PageOverlayStateResponse {
  ok: boolean;
  state: PageOverlayRemoteState;
}

export interface ControllerActionResponse {
  ok: boolean;
  message: string;
  state: ControllerRuntimeState;
}
