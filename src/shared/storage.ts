import { DEFAULT_SETTINGS } from "./config";
import type { ExtensionSettings } from "./types";

const SETTINGS_KEY = "gestureFlowSettings";
const CAMERA_ACCESS_PRIMED_KEY = "gestureFlowCameraAccessPrimed";

function sanitizeSettings(rawSettings: Partial<ExtensionSettings> | undefined): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
  };
}

export async function getStoredSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function updateStoredSettings(
  partial: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const nextSettings = sanitizeSettings({
    ...(await getStoredSettings()),
    ...partial,
  });

  await chrome.storage.sync.set({
    [SETTINGS_KEY]: nextSettings,
  });

  return nextSettings;
}

export async function getCameraAccessPrimed(): Promise<boolean> {
  const result = await chrome.storage.local.get(CAMERA_ACCESS_PRIMED_KEY);
  return Boolean(result[CAMERA_ACCESS_PRIMED_KEY]);
}

export async function setCameraAccessPrimed(isPrimed: boolean) {
  await chrome.storage.local.set({
    [CAMERA_ACCESS_PRIMED_KEY]: isPrimed,
  });
}
