// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const LOG_DIR = path.join(__dirname, "logs");
const LOG_FILE = path.join(LOG_DIR, "metrics-current.json");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

let apiHits = 0;
let history = [];

if (fs.existsSync(LOG_FILE)) {
  history = JSON.parse(fs.readFileSync(LOG_FILE));
}

let lastCpu = process.cpuUsage();
let lastTime = Date.now();

function cpuPercent() {
  const now = Date.now();
  const cpu = process.cpuUsage();

  const diff =
    cpu.user +
    cpu.system -
    (lastCpu.user + lastCpu.system);

  const time = (now - lastTime) * 1000;

  lastCpu = cpu;
  lastTime = now;

  return Math.max(0, Math.round((diff / time) * 100));
}

function getDeviceInfo() {
  const cpus = os.cpus() || [];
  // try to discover CPU info from /proc/cpuinfo when os.cpus() is empty (common on Android/Termux)
  let cpuModel;
  let cpuCount = cpus.length;

  if (!cpuModel && cpus[0]) {
    cpuModel = cpus[0].model;
  }

  if ((!cpuModel || cpuCount === 0) && fs.existsSync('/proc/cpuinfo')) {
    try {
      const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
      const lines = info.split('\n');
      for (const line of lines) {
        const parts = line.split(':');
        if (parts.length < 2) continue;
        const key = parts[0].trim().toLowerCase();
        const val = parts.slice(1).join(':').trim();
        if (!cpuModel && (key === 'model name' || key === 'processor' || key === 'hardware' || key === 'cpu part' || key === 'model')) {
          cpuModel = val;
        }
      }
      const matches = info.match(/^processor\s*:/gm);
      if (matches) cpuCount = matches.length;
    } catch (err) {
      // ignore and fallback
    }
  }

  // try to get Android model name via getprop when available
  let modelName;
  try {
    const out = child_process.execSync('getprop ro.product.model', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) modelName = out;
  } catch (e) {
    // getprop may not exist on non-Android systems
  }

  if (!modelName) {
    try {
      const out = child_process.execSync('getprop ro.product.device', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (out) modelName = out;
    } catch (e) {}
  }

  const hostname = process.env.DEVICE_NAME || modelName || os.hostname();

  return {
    hostname,
    platform: os.platform(),
    arch: os.arch(),
    model: modelName,
    cpuModel: cpuModel || undefined,
    cpuCount: cpuCount || undefined,
    uptime: Math.floor(os.uptime()),
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024)
  };
}

app.use((req, res, next) => {
  apiHits++;
  next();
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/health", (_, res) => {
  res.json({
    status: "UP",
    apiHits,
    cpu: cpuPercent(),
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024)
  });
});

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "history",
      data: history
    })
  );

  // send current device info once on connect
  ws.send(
    JSON.stringify({
      type: "device",
      device: getDeviceInfo()
    })
  );

  const interval = setInterval(() => {
    const sample = {
      time: Date.now(),
      apiHits,
      cpu: cpuPercent(),
      memory: Math.round(
        process.memoryUsage().rss / 1024 / 1024
      )
    };

      // attach device/system snapshot to each live sample
      sample.device = getDeviceInfo();

    history.push(sample);

    if (history.length > 500) {
      history.shift();
    }

    fs.writeFileSync(
      LOG_FILE,
      JSON.stringify(history, null, 2)
    );

    ws.send(
      JSON.stringify({
        type: "live",
        data: sample
      })
    );
  }, 1000);

  ws.on("close", () => {
    clearInterval(interval);
  });
});

server.listen(3000, "0.0.0.0", () => {
  console.log("🚀 Server running on http://localhost:3000");
});