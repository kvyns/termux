// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

let apiHits = 0;
let history = [];

if (fs.existsSync("./logs/metrics-current.json")) {
  history = JSON.parse(fs.readFileSync("./logs/metrics-current.json"));
}

let lastCpu = process.cpuUsage();
let lastTime = Date.now();

function cpuPercent() {
  const now = Date.now();
  const cpu = process.cpuUsage();
  const diff =
    cpu.user + cpu.system - (lastCpu.user + lastCpu.system);
  const time = (now - lastTime) * 1000;

  lastCpu = cpu;
  lastTime = now;
  return Math.round((diff / time) * 100);
}

app.use((req, res, next) => {
  apiHits++;
  next();
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/dashboard.html");
});


app.get("/health", (_, res) => {
  res.json({
    status: "UP",
    apiHits,
    cpu: cpuPercent(),
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024)
  });
});

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "history", data: history }));

  const interval = setInterval(() => {
    const sample = {
      t: Date.now(),
      hits: apiHits,
      cpu: cpuPercent(),
      mem: Math.round(process.memoryUsage().rss / 1024 / 1024)
    };

    history.push(sample);
    fs.writeFileSync("./logs/metrics-current.json", JSON.stringify(history));

    ws.send(JSON.stringify({ type: "live", data: sample }));
  }, 1000);

  ws.on("close", () => clearInterval(interval));
});

server.listen(3000, "0.0.0.0", () =>
  console.log("Dashboard running on :3000")
);
