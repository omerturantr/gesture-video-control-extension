import { build, context } from "esbuild";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const distDir = path.join(rootDir, "dist");
const publicDir = path.join(rootDir, "public");
const popupDir = path.join(rootDir, "src", "popup");
const cameraPermissionDir = path.join(rootDir, "src", "camera-permission");
const offscreenDir = path.join(rootDir, "src", "offscreen");
const mediapipeWasmDir = path.join(
  rootDir,
  "node_modules",
  "@mediapipe",
  "tasks-vision",
  "wasm",
);
const gestureModelPath = path.join(publicDir, "models", "gesture_recognizer.task");
const faceModelPath = path.join(publicDir, "models", "face_landmarker.task");
const gestureModelUrl =
  "https://storage.googleapis.com/mediapipe-tasks/gesture_recognizer/gesture_recognizer.task";
const faceModelUrl =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const isWatchMode = process.argv.includes("--watch");

const entryPoints = [
  "src/background/index.ts",
  "src/content/content-script.ts",
  "src/popup/popup.ts",
  "src/camera-permission/camera-permission.ts",
  "src/offscreen/offscreen.ts",
];

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureModel(modelPath, modelUrl, modelLabel) {
  if (await pathExists(modelPath)) {
    return;
  }

  await mkdir(path.dirname(modelPath), { recursive: true });

  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${modelLabel}: ${response.status}`);
  }

  const modelBuffer = Buffer.from(await response.arrayBuffer());
  await writeFile(modelPath, modelBuffer);
}

async function ensureMediaPipeModels() {
  await ensureModel(gestureModelPath, gestureModelUrl, "gesture recognizer model");
  await ensureModel(faceModelPath, faceModelUrl, "face landmarker model");
}

async function copyStaticAssets() {
  await mkdir(distDir, { recursive: true });
  await cp(path.join(rootDir, "manifest.json"), path.join(distDir, "manifest.json"));
  await cp(publicDir, distDir, { recursive: true });
  await cp(popupDir, path.join(distDir, "popup"), {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith(".ts"),
  });
  await cp(cameraPermissionDir, path.join(distDir, "camera-permission"), {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith(".ts"),
  });
  await cp(offscreenDir, path.join(distDir, "offscreen"), {
    recursive: true,
    filter: (sourcePath) => !sourcePath.endsWith(".ts"),
  });
  await cp(mediapipeWasmDir, path.join(distDir, "vendor", "mediapipe", "wasm"), {
    recursive: true,
  });
}

let hasCleaned = false;

const copyAssetsPlugin = {
  name: "copy-assets",
  setup(buildContext) {
    buildContext.onStart(async () => {
      if (!hasCleaned) {
        await rm(distDir, { recursive: true, force: true });
        hasCleaned = true;
      }

      await ensureMediaPipeModels();
      await copyStaticAssets();
    });
  },
};

const buildOptions = {
  entryPoints,
  outdir: distDir,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: true,
  entryNames: "[dir]/[name]",
  plugins: [copyAssetsPlugin],
  logLevel: "info",
};

if (isWatchMode) {
  const watchContext = await context(buildOptions);
  await watchContext.watch();
  console.log("Watching for changes...");
} else {
  await build(buildOptions);
  console.log(`Extension build completed in ${distDir}`);
}
