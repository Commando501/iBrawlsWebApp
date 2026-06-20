// Electron main process for the iBrawls desktop build.
//
// Single-player vs AI is fully client-side, so this app needs no backend — it
// only has to serve the built `dist/` to a browser window. We can't use
// `file://` because the client fetches absolute-path assets at runtime (the
// service worker `sw.js`, neural-net weights under `brains/*.bin`, audio, the
// PWA manifest). So we spin up a tiny localhost static server and point the
// window at it, which mirrors exactly how `server.ts` serves dist in production.

const { app, BrowserWindow, Menu, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

// dist/ lives next to this file's parent (project root in dev, app.asar root
// when packaged). app.getAppPath() resolves to both.
const DIST_DIR = path.join(app.getAppPath(), "dist");
const HOST = "127.0.0.1";
const PREFERRED_PORT = 4317;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

// Resolve a request URL to a file inside DIST_DIR, guarding against path
// traversal. Returns null if the resolved path escapes DIST_DIR.
function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(DIST_DIR, rel));
  if (full !== DIST_DIR && !full.startsWith(DIST_DIR + path.sep)) return null;
  return full;
}

function sendFile(res, filePath) {
  const stream = fs.createReadStream(filePath);
  stream.on("open", () => {
    res.writeHead(200, { "Content-Type": contentType(filePath) });
  });
  stream.on("error", () => {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
  stream.pipe(res);
}

function createStaticServer() {
  return http.createServer((req, res) => {
    const safe = resolveSafe(req.url || "/");
    if (!safe) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(safe, (err, stat) => {
      if (!err && stat.isFile()) {
        sendFile(res, safe);
        return;
      }
      if (!err && stat.isDirectory()) {
        const indexInDir = path.join(safe, "index.html");
        if (fs.existsSync(indexInDir)) {
          sendFile(res, indexInDir);
          return;
        }
      }
      // SPA fallback: anything unresolved (client-side routes) -> index.html.
      sendFile(res, path.join(DIST_DIR, "index.html"));
    });
  });
}

function listen(server, port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
        listen(server, port + 1, attemptsLeft - 1).then(resolve, reject);
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.removeListener("error", onError);
      resolve(port);
    });
  });
}

async function createWindow() {
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(
      `Build output not found at ${DIST_DIR}. Run "npm run build:client" first.`
    );
  }

  const server = createStaticServer();
  const port = await listen(server, PREFERRED_PORT, 20);

  // Smoke mode: load headless, report whether the renderer loaded, then exit.
  // Used to verify the static server + asset paths without a visible GUI.
  const smoke = process.env.IBRAWLS_SMOKE === "1";

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !smoke,
    backgroundColor: "#050b1a",
    title: "iBrawls",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (smoke) {
    win.webContents.on("did-finish-load", () => {
      console.log(`SMOKE_OK served on http://${HOST}:${port}/`);
      server.close();
      app.exit(0);
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      console.error(`SMOKE_FAIL ${code} ${desc} ${url}`);
      server.close();
      app.exit(1);
    });
  }

  Menu.setApplicationMenu(null);

  // Open any external links (e.g. target=_blank) in the system browser, not a
  // new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`http://${HOST}:${port}/`);

  win.on("closed", () => {
    server.close();
  });
}

// Keep a single running instance.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow().catch((err) => {
      console.error(err);
      app.quit();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
