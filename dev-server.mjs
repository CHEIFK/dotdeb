import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handler } from "./backend/index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff"
};

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost:8080"}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // Route API requests to backend Lambda handler
  if (pathname.startsWith("/api/")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const rawBody = Buffer.concat(chunks).toString("utf-8");

      const queryParams = {};
      for (const [k, v] of urlObj.searchParams.entries()) {
        queryParams[k] = v;
      }

      const event = {
        httpMethod: req.method,
        rawPath: pathname,
        path: pathname,
        headers: req.headers,
        queryStringParameters: queryParams,
        body: rawBody || null,
        requestContext: {
          http: {
            method: req.method,
            path: pathname,
            sourceIp: req.socket.remoteAddress || "127.0.0.1"
          }
        }
      };

      try {
        const lambdaRes = await handler(event);
        const headers = lambdaRes.headers || {};

        if (lambdaRes.cookies && Array.isArray(lambdaRes.cookies)) {
          headers["Set-Cookie"] = lambdaRes.cookies;
        }

        res.writeHead(lambdaRes.statusCode || 200, headers);
        res.end(lambdaRes.body || "");
      } catch (err) {
        console.error("Local dev handler error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
      }
    });
    return;
  }

  // Static file serving
  let relPath = pathname === "/" ? "/index.html" : pathname;
  let safePath = path.normalize(path.join(__dirname, relPath));

  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      safePath = path.join(safePath, "index.html");
    }
  } catch {
    // If not found, check if it's a known html file (e.g. /zootopia -> /zootopia.html)
    if (!path.extname(safePath) && fs.existsSync(`${safePath}.html`)) {
      safePath = `${safePath}.html`;
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 Not Found");
      return;
    }
  }

  const ext = path.extname(safePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Server Error reading file");
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Continental Network Dev Server running at http://0.0.0.0:${PORT}`);
});
