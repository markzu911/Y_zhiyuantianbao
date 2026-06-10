import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import chatHandler from "./api/chat.js";

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadDotEnv();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function createVercelLikeResponse(response) {
  return {
    setHeader: (...args) => response.setHeader(...args),
    status(code) {
      response.statusCode = code;
      return this;
    },
    json(payload) {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify(payload));
    },
    write: (...args) => response.write(...args),
    end: (...args) => response.end(...args),
    flushHeaders: () => response.flushHeaders?.(),
  };
}

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/api/chat") {
      const body = await readJsonBody(request);
      return chatHandler(
        { method: request.method, body },
        createVercelLikeResponse(response),
      );
    }

    const url = request.url === "/" ? "/index.html" : request.url;
    const filePath = join(ROOT, decodeURIComponent(url.split("?")[0]));
    const data = await readFile(filePath);
    response.setHeader("Content-Type", contentTypes[extname(filePath)] || "text/plain");
    response.end(data);
  } catch {
    response.statusCode = 404;
    response.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Local preview: http://localhost:${PORT}`);
});
