const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, screen } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const assetExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".webm", ".mov"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const videoExtensions = new Set([".mp4", ".webm", ".mov"]);
const BASE_WINDOW_SIZE = 240;

let mainWindow;
let tray;

function homeBounds() {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const [windowWidth, windowHeight] = mainWindow ? mainWindow.getSize() : [BASE_WINDOW_SIZE, BASE_WINDOW_SIZE];
  return {
    x: workArea.x + workArea.width - windowWidth - 80,
    y: workArea.y + workArea.height - windowHeight - 80
  };
}

function moveWindowHome() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { x, y } = homeBounds();
  mainWindow.setPosition(x, y, false);
}

function petDir() {
  return path.join(app.getPath("userData"), "pet-assets");
}

function userCutoutDir() {
  return path.join(app.getPath("userData"), "pet-cutouts");
}

function bundledPetDir() {
  return path.join(app.getAppPath(), "assets", "pet");
}

function bundledPetCutoutDir() {
  return path.join(app.getAppPath(), "assets", "pet-cutouts");
}

async function ensurePetDir() {
  await fs.mkdir(petDir(), { recursive: true });
  await fs.mkdir(userCutoutDir(), { recursive: true });
}

async function listPetAssets() {
  await ensurePetDir();
  const dirs = [userCutoutDir(), bundledPetCutoutDir(), petDir(), bundledPetDir()];
  const assets = [];

  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !assetExtensions.has(path.extname(entry.name).toLowerCase())) {
          continue;
        }
        const ext = path.extname(entry.name).toLowerCase();
        const fullPath = path.join(dir, entry.name);
        const isCutout = dir === userCutoutDir() || dir === bundledPetCutoutDir();
        assets.push({
          name: entry.name,
          path: fullPath,
          url: pathToFileURL(fullPath).toString(),
          type: videoExtensions.has(ext) ? "video" : "image",
          isCutout
        });
      }
    } catch {
      // Bundled assets are optional; imported assets are created on demand.
    }
  }

  const cutoutKeys = new Set(
    assets
      .filter((asset) => asset.isCutout)
      .map((asset) => path.basename(asset.name, path.extname(asset.name)).replace(/-cutout$/i, ""))
  );
  const visibleAssets = assets.filter((asset) => {
    if (asset.isCutout || asset.type === "video" || cutoutKeys.size === 0) {
      return true;
    }
    const key = path.basename(asset.name, path.extname(asset.name));
    return !cutoutKeys.has(key);
  });

  return visibleAssets.sort((a, b) => {
    if (a.isCutout !== b.isCutout) {
      return a.isCutout ? -1 : 1;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: BASE_WINDOW_SIZE,
    height: BASE_WINDOW_SIZE,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  moveWindowHome();
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function createTray() {
  const svgIcon = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#f7f2e8"/>
      <circle cx="16" cy="17" r="9" fill="#ffffff"/>
      <circle cx="12" cy="15" r="2" fill="#252525"/>
      <circle cx="20" cy="15" r="2" fill="#252525"/>
      <path d="M14 20c1.2 1 2.8 1 4 0" stroke="#252525" stroke-width="2" stroke-linecap="round" fill="none"/>
    </svg>
  `);
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml,${svgIcon}`);
  tray = new Tray(icon);
  tray.setToolTip("Bichon Desktop Pet");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show / Hide", click: () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
}

async function copyUniqueFile(sourcePath) {
  await ensurePetDir();
  const parsed = path.parse(sourcePath);
  const safeBase = parsed.name.replace(/[^\w\u4e00-\u9fa5-]+/g, "_").slice(0, 60) || "pet";
  const safeExt = parsed.ext.toLowerCase();
  let target = path.join(petDir(), `${safeBase}${safeExt}`);
  let index = 1;

  while (true) {
    try {
      await fs.access(target);
      target = path.join(petDir(), `${safeBase}_${index}${safeExt}`);
      index += 1;
    } catch {
      await fs.copyFile(sourcePath, target);
      return target;
    }
  }
}

async function importAssets() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose pet photos or videos",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Pet media", extensions: [...imageExtensions, ...videoExtensions].map((ext) => ext.slice(1)) },
      { name: "Images", extensions: [...imageExtensions].map((ext) => ext.slice(1)) },
      { name: "Videos", extensions: [...videoExtensions].map((ext) => ext.slice(1)) }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const copied = [];
  for (const filePath of result.filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (assetExtensions.has(ext)) {
      copied.push(await copyUniqueFile(filePath));
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("assets-updated", await listPetAssets());
  }
  return copied;
}

ipcMain.handle("assets:list", () => listPetAssets());
ipcMain.handle("assets:import", () => importAssets());
ipcMain.handle("window:setAlwaysOnTop", (_event, value) => {
  mainWindow.setAlwaysOnTop(Boolean(value), "floating");
});
ipcMain.handle("window:setSize", (_event, scale) => {
  const clamped = Math.min(1.45, Math.max(0.75, Number(scale) || 1));
  mainWindow.setSize(Math.round(BASE_WINDOW_SIZE * clamped), Math.round(BASE_WINDOW_SIZE * clamped), true);
});
ipcMain.handle("window:nudge", (_event, dx, dy) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const [x, y] = mainWindow.getPosition();
  const [width, height] = mainWindow.getSize();
  const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
  const nextX = Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, x + Math.round(Number(dx) || 0)));
  const nextY = Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, y + Math.round(Number(dy) || 0)));
  mainWindow.setPosition(nextX, nextY, false);
});
ipcMain.handle("window:home", () => moveWindowHome());
ipcMain.handle("app:quit", () => app.quit());

app.whenReady().then(async () => {
  await ensurePetDir();
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});
