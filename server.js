// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: cpus[0] ? cpus[0].model : undefined,
    cpuCount: cpus.length,
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