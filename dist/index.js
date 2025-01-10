var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// server/env.ts
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var envPath = path.resolve(__dirname, "../.env");
function setupEnvironment() {
  const result = dotenv.config({ path: envPath });
  if (result.error) {
    throw new Error(
      `Failed to load .env file from ${envPath}: ${result.error.message}`
    );
  }
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error(
      "GOOGLE_API_KEY environment variable must be set in .env file"
    );
  }
  return {
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    NODE_ENV: process.env.NODE_ENV || "development"
  };
}
__name(setupEnvironment, "setupEnvironment");

// server/index.ts
import path4 from "path";
import { fileURLToPath as fileURLToPath4 } from "url";
import express2 from "express";

// server/routes.ts
import { createServer } from "http";
import {
  GoogleGenerativeAI
} from "@google/generative-ai";
import { marked } from "marked";
var env = setupEnvironment();
var genAI = new GoogleGenerativeAI(env.GOOGLE_API_KEY);
var model = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp",
  generationConfig: {
    temperature: 0.9,
    topP: 1,
    topK: 1,
    maxOutputTokens: 2048
  }
});
var chatSessions = /* @__PURE__ */ new Map();
async function formatResponseToMarkdown(text) {
  const resolvedText = await Promise.resolve(text);
  let processedText = resolvedText.replace(/\r\n/g, "\n");
  processedText = processedText.replace(
    /^([A-Za-z][A-Za-z\s]+):(\s*)/gm,
    "## $1$2"
  );
  processedText = processedText.replace(
    /(?<=\n|^)([A-Za-z][A-Za-z\s]+):(?!\d)/gm,
    "### $1"
  );
  processedText = processedText.replace(/^[•●○]\s*/gm, "* ");
  const paragraphs = processedText.split("\n\n").filter(Boolean);
  const formatted = paragraphs.map((p) => {
    if (p.startsWith("#") || p.startsWith("*") || p.startsWith("-")) {
      return p;
    }
    return `${p}
`;
  }).join("\n\n");
  marked.setOptions({
    gfm: true,
    breaks: true
  });
  return marked.parse(formatted);
}
__name(formatResponseToMarkdown, "formatResponseToMarkdown");
function registerRoutes(app2) {
  app2.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q;
      if (!query) {
        return res.status(400).json({
          message: "Query parameter 'q' is required"
        });
      }
      const chat = model.startChat({
        tools: [
          {
            // @ts-ignore - google_search is a valid tool but not typed in the SDK yet
            google_search: {}
          }
        ]
      });
      const result = await chat.sendMessage(query);
      const response = await result.response;
      console.log(
        "Raw Google API Response:",
        JSON.stringify(
          {
            text: response.text(),
            candidates: response.candidates,
            groundingMetadata: response.candidates?.[0]?.groundingMetadata
          },
          null,
          2
        )
      );
      const text = response.text();
      const formattedText = await formatResponseToMarkdown(text);
      const sourceMap = /* @__PURE__ */ new Map();
      const metadata = response.candidates?.[0]?.groundingMetadata;
      if (metadata) {
        const chunks = metadata.groundingChunks || [];
        const supports = metadata.groundingSupports || [];
        chunks.forEach((chunk, index) => {
          if (chunk.web?.uri && chunk.web?.title) {
            const url = chunk.web.uri;
            if (!sourceMap.has(url)) {
              const snippets = supports.filter(
                (support) => support.groundingChunkIndices.includes(index)
              ).map((support) => support.segment.text).join(" ");
              sourceMap.set(url, {
                title: chunk.web.title,
                url,
                snippet: snippets || ""
              });
            }
          }
        });
      }
      const sources = Array.from(sourceMap.values());
      const sessionId = Math.random().toString(36).substring(7);
      chatSessions.set(sessionId, chat);
      res.json({
        sessionId,
        summary: formattedText,
        sources
      });
    } catch (error) {
      console.error("Search error:", error);
      res.status(500).json({
        message: error.message || "An error occurred while processing your search"
      });
    }
  });
  app2.post("/api/follow-up", async (req, res) => {
    try {
      const { sessionId, query } = req.body;
      if (!sessionId || !query) {
        return res.status(400).json({
          message: "Both sessionId and query are required"
        });
      }
      const chat = chatSessions.get(sessionId);
      if (!chat) {
        return res.status(404).json({
          message: "Chat session not found"
        });
      }
      const result = await chat.sendMessage(query);
      const response = await result.response;
      console.log(
        "Raw Google API Follow-up Response:",
        JSON.stringify(
          {
            text: response.text(),
            candidates: response.candidates,
            groundingMetadata: response.candidates?.[0]?.groundingMetadata
          },
          null,
          2
        )
      );
      const text = response.text();
      const formattedText = await formatResponseToMarkdown(text);
      const sourceMap = /* @__PURE__ */ new Map();
      const metadata = response.candidates?.[0]?.groundingMetadata;
      if (metadata) {
        const chunks = metadata.groundingChunks || [];
        const supports = metadata.groundingSupports || [];
        chunks.forEach((chunk, index) => {
          if (chunk.web?.uri && chunk.web?.title) {
            const url = chunk.web.uri;
            if (!sourceMap.has(url)) {
              const snippets = supports.filter(
                (support) => support.groundingChunkIndices.includes(index)
              ).map((support) => support.segment.text).join(" ");
              sourceMap.set(url, {
                title: chunk.web.title,
                url,
                snippet: snippets || ""
              });
            }
          }
        });
      }
      const sources = Array.from(sourceMap.values());
      res.json({
        summary: formattedText,
        sources
      });
    } catch (error) {
      console.error("Follow-up error:", error);
      res.status(500).json({
        message: error.message || "An error occurred while processing your follow-up question"
      });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}
__name(registerRoutes, "registerRoutes");

// server/vite.ts
import express from "express";
import fs from "fs";
import path3, { dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import themePlugin from "@replit/vite-plugin-shadcn-theme-json";
import path2, { dirname } from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { fileURLToPath as fileURLToPath2 } from "url";
var __filename2 = fileURLToPath2(import.meta.url);
var __dirname2 = dirname(__filename2);
var vite_config_default = defineConfig({
  plugins: [react(), runtimeErrorOverlay(), themePlugin()],
  resolve: {
    alias: {
      "@db": path2.resolve(__dirname2, "db"),
      "@": path2.resolve(__dirname2, "client", "src")
    }
  },
  root: path2.resolve(__dirname2, "client"),
  build: {
    outDir: path2.resolve(__dirname2, "dist/public"),
    emptyOutDir: true
  }
});

// server/vite.ts
var __filename3 = fileURLToPath3(import.meta.url);
var __dirname3 = dirname2(__filename3);
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
__name(log, "log");
async function setupVite(app2, server) {
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: /* @__PURE__ */ __name((msg, options) => {
        if (msg.includes("[TypeScript] Found 0 errors. Watching for file changes")) {
          log("no errors found", "tsc");
          return;
        }
        if (msg.includes("[TypeScript] ")) {
          const [errors, summary] = msg.split("[TypeScript] ", 2);
          log(`${summary} ${errors}\x1B[0m`, "tsc");
          return;
        } else {
          viteLogger.error(msg, options);
          process.exit(1);
        }
      }, "error")
    },
    server: {
      middlewareMode: true,
      hmr: { server }
    },
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        __dirname3,
        "..",
        "client",
        "index.html"
      );
      const template = await fs.promises.readFile(clientTemplate, "utf-8");
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
__name(setupVite, "setupVite");
function serveStatic(app2) {
  const publicPath = path3.resolve(__dirname3, "..", "dist", "public");
  if (!fs.existsSync(publicPath)) {
    throw new Error(
      `Could not find the build directory: ${publicPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(publicPath));
  app2.get("*", (_req, res) => {
    res.sendFile(path3.resolve(publicPath, "index.html"));
  });
}
__name(serveStatic, "serveStatic");

// server/index.ts
var env2 = setupEnvironment();
console.log("\n--- Environment Setup Debug ---");
console.log("Environment variables loaded:", env2);
console.log("--- End Debug ---\n");
var __filename4 = fileURLToPath4(import.meta.url);
var __dirname4 = path4.dirname(__filename4);
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path5 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path5.startsWith("/api")) {
      let logLine = `${req.method} ${path5} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const PORT = 3e3;
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
  });
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2VydmVyL2Vudi50cyIsICIuLi9zZXJ2ZXIvaW5kZXgudHMiLCAiLi4vc2VydmVyL3JvdXRlcy50cyIsICIuLi9zZXJ2ZXIvdml0ZS50cyIsICIuLi92aXRlLmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGRvdGVudiBmcm9tIFwiZG90ZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShfX2ZpbGVuYW1lKTtcbmNvbnN0IGVudlBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy5lbnZcIik7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cEVudmlyb25tZW50KCkge1xuICBjb25zdCByZXN1bHQgPSBkb3RlbnYuY29uZmlnKHsgcGF0aDogZW52UGF0aCB9KTtcbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBGYWlsZWQgdG8gbG9hZCAuZW52IGZpbGUgZnJvbSAke2VudlBhdGh9OiAke3Jlc3VsdC5lcnJvci5tZXNzYWdlfWBcbiAgICApO1xuICB9XG5cbiAgaWYgKCFwcm9jZXNzLmVudi5HT09HTEVfQVBJX0tFWSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiR09PR0xFX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdCBiZSBzZXQgaW4gLmVudiBmaWxlXCJcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBHT09HTEVfQVBJX0tFWTogcHJvY2Vzcy5lbnYuR09PR0xFX0FQSV9LRVksXG4gICAgTk9ERV9FTlY6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8IFwiZGV2ZWxvcG1lbnRcIixcbiAgfTtcbn1cbiIsICJpbXBvcnQgeyBzZXR1cEVudmlyb25tZW50IH0gZnJvbSBcIi4vZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCBleHByZXNzLCB7IHR5cGUgUmVxdWVzdCwgUmVzcG9uc2UsIE5leHRGdW5jdGlvbiB9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgeyByZWdpc3RlclJvdXRlcyB9IGZyb20gXCIuL3JvdXRlc1wiO1xuaW1wb3J0IHsgc2V0dXBWaXRlLCBzZXJ2ZVN0YXRpYywgbG9nIH0gZnJvbSBcIi4vdml0ZVwiO1xuXG4vLyBTZXR1cCBlbnZpcm9ubWVudCB2YXJpYWJsZXMgZmlyc3RcbmNvbnN0IGVudiA9IHNldHVwRW52aXJvbm1lbnQoKTtcbmNvbnNvbGUubG9nKFwiXFxuLS0tIEVudmlyb25tZW50IFNldHVwIERlYnVnIC0tLVwiKTtcbmNvbnNvbGUubG9nKFwiRW52aXJvbm1lbnQgdmFyaWFibGVzIGxvYWRlZDpcIiwgZW52KTtcbmNvbnNvbGUubG9nKFwiLS0tIEVuZCBEZWJ1ZyAtLS1cXG5cIik7XG5cbi8vIEdldCB0aGUgZGlyZWN0b3J5IG5hbWUgcHJvcGVybHkgd2l0aCBFUyBtb2R1bGVzXG5jb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuY29uc3QgX19kaXJuYW1lID0gcGF0aC5kaXJuYW1lKF9fZmlsZW5hbWUpO1xuXG5jb25zdCBhcHAgPSBleHByZXNzKCk7XG5hcHAudXNlKGV4cHJlc3MuanNvbigpKTtcbmFwcC51c2UoZXhwcmVzcy51cmxlbmNvZGVkKHsgZXh0ZW5kZWQ6IGZhbHNlIH0pKTtcblxuLy8gQVBJIHJlcXVlc3QgbG9nZ2luZyBtaWRkbGV3YXJlXG5hcHAudXNlKChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XG4gIGNvbnN0IHBhdGggPSByZXEucGF0aDtcbiAgbGV0IGNhcHR1cmVkSnNvblJlc3BvbnNlOiBSZWNvcmQ8c3RyaW5nLCBhbnk+IHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuXG4gIGNvbnN0IG9yaWdpbmFsUmVzSnNvbiA9IHJlcy5qc29uO1xuICByZXMuanNvbiA9IGZ1bmN0aW9uIChib2R5SnNvbiwgLi4uYXJncykge1xuICAgIGNhcHR1cmVkSnNvblJlc3BvbnNlID0gYm9keUpzb247XG4gICAgcmV0dXJuIG9yaWdpbmFsUmVzSnNvbi5hcHBseShyZXMsIFtib2R5SnNvbiwgLi4uYXJnc10pO1xuICB9O1xuXG4gIHJlcy5vbihcImZpbmlzaFwiLCAoKSA9PiB7XG4gICAgY29uc3QgZHVyYXRpb24gPSBEYXRlLm5vdygpIC0gc3RhcnQ7XG4gICAgaWYgKHBhdGguc3RhcnRzV2l0aChcIi9hcGlcIikpIHtcbiAgICAgIGxldCBsb2dMaW5lID0gYCR7cmVxLm1ldGhvZH0gJHtwYXRofSAke3Jlcy5zdGF0dXNDb2RlfSBpbiAke2R1cmF0aW9ufW1zYDtcbiAgICAgIGlmIChjYXB0dXJlZEpzb25SZXNwb25zZSkge1xuICAgICAgICBsb2dMaW5lICs9IGAgOjogJHtKU09OLnN0cmluZ2lmeShjYXB0dXJlZEpzb25SZXNwb25zZSl9YDtcbiAgICAgIH1cblxuICAgICAgaWYgKGxvZ0xpbmUubGVuZ3RoID4gODApIHtcbiAgICAgICAgbG9nTGluZSA9IGxvZ0xpbmUuc2xpY2UoMCwgNzkpICsgXCLigKZcIjtcbiAgICAgIH1cblxuICAgICAgbG9nKGxvZ0xpbmUpO1xuICAgIH1cbiAgfSk7XG5cbiAgbmV4dCgpO1xufSk7XG5cbihhc3luYyAoKSA9PiB7XG4gIC8vIDEuIOazqOWGjCBBUEkg6Lev55SxXG4gIGNvbnN0IHNlcnZlciA9IHJlZ2lzdGVyUm91dGVzKGFwcCk7XG5cbiAgLy8gMi4g6ZSZ6K+v5aSE55CG5Lit6Ze05Lu2XG4gIGFwcC51c2UoKGVycjogYW55LCBfcmVxOiBSZXF1ZXN0LCByZXM6IFJlc3BvbnNlLCBfbmV4dDogTmV4dEZ1bmN0aW9uKSA9PiB7XG4gICAgY29uc3Qgc3RhdHVzID0gZXJyLnN0YXR1cyB8fCBlcnIuc3RhdHVzQ29kZSB8fCA1MDA7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVyci5tZXNzYWdlIHx8IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCI7XG4gICAgcmVzLnN0YXR1cyhzdGF0dXMpLmpzb24oeyBtZXNzYWdlIH0pO1xuICAgIHRocm93IGVycjtcbiAgfSk7XG5cbiAgLy8gMy4g5qC55o2u546v5aKD6K6+572u6Z2Z5oCB5paH5Lu25pyN5YqhXG4gIGlmIChhcHAuZ2V0KFwiZW52XCIpID09PSBcImRldmVsb3BtZW50XCIpIHtcbiAgICBhd2FpdCBzZXR1cFZpdGUoYXBwLCBzZXJ2ZXIpO1xuICB9IGVsc2Uge1xuICAgIHNlcnZlU3RhdGljKGFwcCk7XG4gIH1cblxuICAvLyA0LiDlkK/liqjmnI3liqHlmahcbiAgY29uc3QgUE9SVCA9IDMwMDA7XG4gIHNlcnZlci5saXN0ZW4oUE9SVCwgXCIwLjAuMC4wXCIsICgpID0+IHtcbiAgICBsb2coYHNlcnZpbmcgb24gcG9ydCAke1BPUlR9YCk7XG4gIH0pO1xufSkoKTtcbiIsICJpbXBvcnQgdHlwZSB7IEV4cHJlc3MgfSBmcm9tIFwiZXhwcmVzc1wiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyLCB0eXBlIFNlcnZlciB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQge1xuICBHb29nbGVHZW5lcmF0aXZlQUksXG4gIHR5cGUgQ2hhdFNlc3Npb24sXG4gIHR5cGUgR2VuZXJhdGVDb250ZW50UmVzdWx0LFxufSBmcm9tIFwiQGdvb2dsZS9nZW5lcmF0aXZlLWFpXCI7XG5pbXBvcnQgeyBtYXJrZWQgfSBmcm9tIFwibWFya2VkXCI7XG5pbXBvcnQgeyBzZXR1cEVudmlyb25tZW50IH0gZnJvbSBcIi4vZW52XCI7XG5cbmNvbnN0IGVudiA9IHNldHVwRW52aXJvbm1lbnQoKTtcbmNvbnN0IGdlbkFJID0gbmV3IEdvb2dsZUdlbmVyYXRpdmVBSShlbnYuR09PR0xFX0FQSV9LRVkpO1xuY29uc3QgbW9kZWwgPSBnZW5BSS5nZXRHZW5lcmF0aXZlTW9kZWwoe1xuICBtb2RlbDogXCJnZW1pbmktMi4wLWZsYXNoLWV4cFwiLFxuICBnZW5lcmF0aW9uQ29uZmlnOiB7XG4gICAgdGVtcGVyYXR1cmU6IDAuOSxcbiAgICB0b3BQOiAxLFxuICAgIHRvcEs6IDEsXG4gICAgbWF4T3V0cHV0VG9rZW5zOiAyMDQ4LFxuICB9LFxufSk7XG5cbi8vIFN0b3JlIGNoYXQgc2Vzc2lvbnMgaW4gbWVtb3J5XG5jb25zdCBjaGF0U2Vzc2lvbnMgPSBuZXcgTWFwPHN0cmluZywgQ2hhdFNlc3Npb24+KCk7XG5cbi8vIEZvcm1hdCByYXcgdGV4dCBpbnRvIHByb3BlciBtYXJrZG93blxuYXN5bmMgZnVuY3Rpb24gZm9ybWF0UmVzcG9uc2VUb01hcmtkb3duKFxuICB0ZXh0OiBzdHJpbmcgfCBQcm9taXNlPHN0cmluZz5cbik6IFByb21pc2U8c3RyaW5nPiB7XG4gIC8vIEVuc3VyZSB3ZSBoYXZlIGEgc3RyaW5nIHRvIHdvcmsgd2l0aFxuICBjb25zdCByZXNvbHZlZFRleHQgPSBhd2FpdCBQcm9taXNlLnJlc29sdmUodGV4dCk7XG5cbiAgLy8gRmlyc3QsIGVuc3VyZSBjb25zaXN0ZW50IG5ld2xpbmVzXG4gIGxldCBwcm9jZXNzZWRUZXh0ID0gcmVzb2x2ZWRUZXh0LnJlcGxhY2UoL1xcclxcbi9nLCBcIlxcblwiKTtcblxuICAvLyBQcm9jZXNzIG1haW4gc2VjdGlvbnMgKGxpbmVzIHRoYXQgc3RhcnQgd2l0aCB3b3JkKHMpIGZvbGxvd2VkIGJ5IGNvbG9uKVxuICBwcm9jZXNzZWRUZXh0ID0gcHJvY2Vzc2VkVGV4dC5yZXBsYWNlKFxuICAgIC9eKFtBLVphLXpdW0EtWmEtelxcc10rKTooXFxzKikvZ20sXG4gICAgXCIjIyAkMSQyXCJcbiAgKTtcblxuICAvLyBQcm9jZXNzIHN1Yi1zZWN0aW9ucyAoYW55IHJlbWFpbmluZyB3b3JkKHMpIGZvbGxvd2VkIGJ5IGNvbG9uIHdpdGhpbiB0ZXh0KVxuICBwcm9jZXNzZWRUZXh0ID0gcHJvY2Vzc2VkVGV4dC5yZXBsYWNlKFxuICAgIC8oPzw9XFxufF4pKFtBLVphLXpdW0EtWmEtelxcc10rKTooPyFcXGQpL2dtLFxuICAgIFwiIyMjICQxXCJcbiAgKTtcblxuICAvLyBQcm9jZXNzIGJ1bGxldCBwb2ludHNcbiAgcHJvY2Vzc2VkVGV4dCA9IHByb2Nlc3NlZFRleHQucmVwbGFjZSgvXlvigKLil4/il4tdXFxzKi9nbSwgXCIqIFwiKTtcblxuICAvLyBTcGxpdCBpbnRvIHBhcmFncmFwaHNcbiAgY29uc3QgcGFyYWdyYXBocyA9IHByb2Nlc3NlZFRleHQuc3BsaXQoXCJcXG5cXG5cIikuZmlsdGVyKEJvb2xlYW4pO1xuXG4gIC8vIFByb2Nlc3MgZWFjaCBwYXJhZ3JhcGhcbiAgY29uc3QgZm9ybWF0dGVkID0gcGFyYWdyYXBoc1xuICAgIC5tYXAoKHApID0+IHtcbiAgICAgIC8vIElmIGl0J3MgYSBoZWFkZXIgb3IgbGlzdCBpdGVtLCBwcmVzZXJ2ZSBpdFxuICAgICAgaWYgKHAuc3RhcnRzV2l0aChcIiNcIikgfHwgcC5zdGFydHNXaXRoKFwiKlwiKSB8fCBwLnN0YXJ0c1dpdGgoXCItXCIpKSB7XG4gICAgICAgIHJldHVybiBwO1xuICAgICAgfVxuICAgICAgLy8gQWRkIHByb3BlciBwYXJhZ3JhcGggZm9ybWF0dGluZ1xuICAgICAgcmV0dXJuIGAke3B9XFxuYDtcbiAgICB9KVxuICAgIC5qb2luKFwiXFxuXFxuXCIpO1xuXG4gIC8vIENvbmZpZ3VyZSBtYXJrZWQgb3B0aW9ucyBmb3IgYmV0dGVyIGhlYWRlciByZW5kZXJpbmdcbiAgbWFya2VkLnNldE9wdGlvbnMoe1xuICAgIGdmbTogdHJ1ZSxcbiAgICBicmVha3M6IHRydWUsXG4gIH0pO1xuXG4gIC8vIENvbnZlcnQgbWFya2Rvd24gdG8gSFRNTCB1c2luZyBtYXJrZWRcbiAgcmV0dXJuIG1hcmtlZC5wYXJzZShmb3JtYXR0ZWQpO1xufVxuXG5pbnRlcmZhY2UgV2ViU291cmNlIHtcbiAgdXJpOiBzdHJpbmc7XG4gIHRpdGxlOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBHcm91bmRpbmdDaHVuayB7XG4gIHdlYj86IFdlYlNvdXJjZTtcbn1cblxuaW50ZXJmYWNlIFRleHRTZWdtZW50IHtcbiAgc3RhcnRJbmRleDogbnVtYmVyO1xuICBlbmRJbmRleDogbnVtYmVyO1xuICB0ZXh0OiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBHcm91bmRpbmdTdXBwb3J0IHtcbiAgc2VnbWVudDogVGV4dFNlZ21lbnQ7XG4gIGdyb3VuZGluZ0NodW5rSW5kaWNlczogbnVtYmVyW107XG4gIGNvbmZpZGVuY2VTY29yZXM6IG51bWJlcltdO1xufVxuXG5pbnRlcmZhY2UgR3JvdW5kaW5nTWV0YWRhdGEge1xuICBncm91bmRpbmdDaHVua3M6IEdyb3VuZGluZ0NodW5rW107XG4gIGdyb3VuZGluZ1N1cHBvcnRzOiBHcm91bmRpbmdTdXBwb3J0W107XG4gIHNlYXJjaEVudHJ5UG9pbnQ/OiBhbnk7XG4gIHdlYlNlYXJjaFF1ZXJpZXM/OiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyUm91dGVzKGFwcDogRXhwcmVzcyk6IFNlcnZlciB7XG4gIC8vIFNlYXJjaCBlbmRwb2ludCAtIGNyZWF0ZXMgYSBuZXcgY2hhdCBzZXNzaW9uXG4gIGFwcC5nZXQoXCIvYXBpL3NlYXJjaFwiLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcXVlcnkgPSByZXEucXVlcnkucSBhcyBzdHJpbmc7XG5cbiAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHtcbiAgICAgICAgICBtZXNzYWdlOiBcIlF1ZXJ5IHBhcmFtZXRlciAncScgaXMgcmVxdWlyZWRcIixcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIENyZWF0ZSBhIG5ldyBjaGF0IHNlc3Npb24gd2l0aCBzZWFyY2ggY2FwYWJpbGl0eVxuICAgICAgY29uc3QgY2hhdCA9IG1vZGVsLnN0YXJ0Q2hhdCh7XG4gICAgICAgIHRvb2xzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZSAtIGdvb2dsZV9zZWFyY2ggaXMgYSB2YWxpZCB0b29sIGJ1dCBub3QgdHlwZWQgaW4gdGhlIFNESyB5ZXRcbiAgICAgICAgICAgIGdvb2dsZV9zZWFyY2g6IHt9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KTtcblxuICAgICAgLy8gR2VuZXJhdGUgY29udGVudCB3aXRoIHNlYXJjaCB0b29sXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjaGF0LnNlbmRNZXNzYWdlKHF1ZXJ5KTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVzdWx0LnJlc3BvbnNlO1xuICAgICAgY29uc29sZS5sb2coXG4gICAgICAgIFwiUmF3IEdvb2dsZSBBUEkgUmVzcG9uc2U6XCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHRleHQ6IHJlc3BvbnNlLnRleHQoKSxcbiAgICAgICAgICAgIGNhbmRpZGF0ZXM6IHJlc3BvbnNlLmNhbmRpZGF0ZXMsXG4gICAgICAgICAgICBncm91bmRpbmdNZXRhZGF0YTogcmVzcG9uc2UuY2FuZGlkYXRlcz8uWzBdPy5ncm91bmRpbmdNZXRhZGF0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIG51bGwsXG4gICAgICAgICAgMlxuICAgICAgICApXG4gICAgICApO1xuICAgICAgY29uc3QgdGV4dCA9IHJlc3BvbnNlLnRleHQoKTtcblxuICAgICAgLy8gRm9ybWF0IHRoZSByZXNwb25zZSB0ZXh0IHRvIHByb3BlciBtYXJrZG93bi9IVE1MXG4gICAgICBjb25zdCBmb3JtYXR0ZWRUZXh0ID0gYXdhaXQgZm9ybWF0UmVzcG9uc2VUb01hcmtkb3duKHRleHQpO1xuXG4gICAgICAvLyBFeHRyYWN0IHNvdXJjZXMgZnJvbSBncm91bmRpbmcgbWV0YWRhdGFcbiAgICAgIGNvbnN0IHNvdXJjZU1hcCA9IG5ldyBNYXA8XG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgeyB0aXRsZTogc3RyaW5nOyB1cmw6IHN0cmluZzsgc25pcHBldDogc3RyaW5nIH1cbiAgICAgID4oKTtcblxuICAgICAgLy8gR2V0IGdyb3VuZGluZyBtZXRhZGF0YSBmcm9tIHJlc3BvbnNlXG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHJlc3BvbnNlLmNhbmRpZGF0ZXM/LlswXT8uZ3JvdW5kaW5nTWV0YWRhdGEgYXMgYW55O1xuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIGNvbnN0IGNodW5rcyA9IG1ldGFkYXRhLmdyb3VuZGluZ0NodW5rcyB8fCBbXTtcbiAgICAgICAgY29uc3Qgc3VwcG9ydHMgPSBtZXRhZGF0YS5ncm91bmRpbmdTdXBwb3J0cyB8fCBbXTtcblxuICAgICAgICBjaHVua3MuZm9yRWFjaCgoY2h1bms6IGFueSwgaW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICAgIGlmIChjaHVuay53ZWI/LnVyaSAmJiBjaHVuay53ZWI/LnRpdGxlKSB7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBjaHVuay53ZWIudXJpO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2VNYXAuaGFzKHVybCkpIHtcbiAgICAgICAgICAgICAgLy8gRmluZCBzbmlwcGV0cyB0aGF0IHJlZmVyZW5jZSB0aGlzIGNodW5rXG4gICAgICAgICAgICAgIGNvbnN0IHNuaXBwZXRzID0gc3VwcG9ydHNcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChzdXBwb3J0OiBhbnkpID0+XG4gICAgICAgICAgICAgICAgICBzdXBwb3J0Lmdyb3VuZGluZ0NodW5rSW5kaWNlcy5pbmNsdWRlcyhpbmRleClcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgLm1hcCgoc3VwcG9ydDogYW55KSA9PiBzdXBwb3J0LnNlZ21lbnQudGV4dClcbiAgICAgICAgICAgICAgICAuam9pbihcIiBcIik7XG5cbiAgICAgICAgICAgICAgc291cmNlTWFwLnNldCh1cmwsIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogY2h1bmsud2ViLnRpdGxlLFxuICAgICAgICAgICAgICAgIHVybDogdXJsLFxuICAgICAgICAgICAgICAgIHNuaXBwZXQ6IHNuaXBwZXRzIHx8IFwiXCIsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZXMgPSBBcnJheS5mcm9tKHNvdXJjZU1hcC52YWx1ZXMoKSk7XG5cbiAgICAgIC8vIEdlbmVyYXRlIGEgc2Vzc2lvbiBJRCBhbmQgc3RvcmUgdGhlIGNoYXRcbiAgICAgIGNvbnN0IHNlc3Npb25JZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbiAgICAgIGNoYXRTZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCBjaGF0KTtcblxuICAgICAgcmVzLmpzb24oe1xuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIHN1bW1hcnk6IGZvcm1hdHRlZFRleHQsXG4gICAgICAgIHNvdXJjZXMsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiU2VhcmNoIGVycm9yOlwiLCBlcnJvcik7XG4gICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7XG4gICAgICAgIG1lc3NhZ2U6XG4gICAgICAgICAgZXJyb3IubWVzc2FnZSB8fCBcIkFuIGVycm9yIG9jY3VycmVkIHdoaWxlIHByb2Nlc3NpbmcgeW91ciBzZWFyY2hcIixcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gRm9sbG93LXVwIGVuZHBvaW50IC0gY29udGludWVzIGV4aXN0aW5nIGNoYXQgc2Vzc2lvblxuICBhcHAucG9zdChcIi9hcGkvZm9sbG93LXVwXCIsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IHNlc3Npb25JZCwgcXVlcnkgfSA9IHJlcS5ib2R5O1xuXG4gICAgICBpZiAoIXNlc3Npb25JZCB8fCAhcXVlcnkpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDAwKS5qc29uKHtcbiAgICAgICAgICBtZXNzYWdlOiBcIkJvdGggc2Vzc2lvbklkIGFuZCBxdWVyeSBhcmUgcmVxdWlyZWRcIixcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNoYXQgPSBjaGF0U2Vzc2lvbnMuZ2V0KHNlc3Npb25JZCk7XG4gICAgICBpZiAoIWNoYXQpIHtcbiAgICAgICAgcmV0dXJuIHJlcy5zdGF0dXMoNDA0KS5qc29uKHtcbiAgICAgICAgICBtZXNzYWdlOiBcIkNoYXQgc2Vzc2lvbiBub3QgZm91bmRcIixcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNlbmQgZm9sbG93LXVwIG1lc3NhZ2UgaW4gZXhpc3RpbmcgY2hhdFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2hhdC5zZW5kTWVzc2FnZShxdWVyeSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlc3VsdC5yZXNwb25zZTtcbiAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICBcIlJhdyBHb29nbGUgQVBJIEZvbGxvdy11cCBSZXNwb25zZTpcIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAge1xuICAgICAgICAgICAgdGV4dDogcmVzcG9uc2UudGV4dCgpLFxuICAgICAgICAgICAgY2FuZGlkYXRlczogcmVzcG9uc2UuY2FuZGlkYXRlcyxcbiAgICAgICAgICAgIGdyb3VuZGluZ01ldGFkYXRhOiByZXNwb25zZS5jYW5kaWRhdGVzPy5bMF0/Lmdyb3VuZGluZ01ldGFkYXRhLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbnVsbCxcbiAgICAgICAgICAyXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgICBjb25zdCB0ZXh0ID0gcmVzcG9uc2UudGV4dCgpO1xuXG4gICAgICAvLyBGb3JtYXQgdGhlIHJlc3BvbnNlIHRleHQgdG8gcHJvcGVyIG1hcmtkb3duL0hUTUxcbiAgICAgIGNvbnN0IGZvcm1hdHRlZFRleHQgPSBhd2FpdCBmb3JtYXRSZXNwb25zZVRvTWFya2Rvd24odGV4dCk7XG5cbiAgICAgIC8vIEV4dHJhY3Qgc291cmNlcyBmcm9tIGdyb3VuZGluZyBtZXRhZGF0YVxuICAgICAgY29uc3Qgc291cmNlTWFwID0gbmV3IE1hcDxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICB7IHRpdGxlOiBzdHJpbmc7IHVybDogc3RyaW5nOyBzbmlwcGV0OiBzdHJpbmcgfVxuICAgICAgPigpO1xuXG4gICAgICAvLyBHZXQgZ3JvdW5kaW5nIG1ldGFkYXRhIGZyb20gcmVzcG9uc2VcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gcmVzcG9uc2UuY2FuZGlkYXRlcz8uWzBdPy5ncm91bmRpbmdNZXRhZGF0YSBhcyBhbnk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gbWV0YWRhdGEuZ3JvdW5kaW5nQ2h1bmtzIHx8IFtdO1xuICAgICAgICBjb25zdCBzdXBwb3J0cyA9IG1ldGFkYXRhLmdyb3VuZGluZ1N1cHBvcnRzIHx8IFtdO1xuXG4gICAgICAgIGNodW5rcy5mb3JFYWNoKChjaHVuazogYW55LCBpbmRleDogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgaWYgKGNodW5rLndlYj8udXJpICYmIGNodW5rLndlYj8udGl0bGUpIHtcbiAgICAgICAgICAgIGNvbnN0IHVybCA9IGNodW5rLndlYi51cmk7XG4gICAgICAgICAgICBpZiAoIXNvdXJjZU1hcC5oYXModXJsKSkge1xuICAgICAgICAgICAgICAvLyBGaW5kIHNuaXBwZXRzIHRoYXQgcmVmZXJlbmNlIHRoaXMgY2h1bmtcbiAgICAgICAgICAgICAgY29uc3Qgc25pcHBldHMgPSBzdXBwb3J0c1xuICAgICAgICAgICAgICAgIC5maWx0ZXIoKHN1cHBvcnQ6IGFueSkgPT5cbiAgICAgICAgICAgICAgICAgIHN1cHBvcnQuZ3JvdW5kaW5nQ2h1bmtJbmRpY2VzLmluY2x1ZGVzKGluZGV4KVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAubWFwKChzdXBwb3J0OiBhbnkpID0+IHN1cHBvcnQuc2VnbWVudC50ZXh0KVxuICAgICAgICAgICAgICAgIC5qb2luKFwiIFwiKTtcblxuICAgICAgICAgICAgICBzb3VyY2VNYXAuc2V0KHVybCwge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBjaHVuay53ZWIudGl0bGUsXG4gICAgICAgICAgICAgICAgdXJsOiB1cmwsXG4gICAgICAgICAgICAgICAgc25pcHBldDogc25pcHBldHMgfHwgXCJcIixcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlcyA9IEFycmF5LmZyb20oc291cmNlTWFwLnZhbHVlcygpKTtcblxuICAgICAgcmVzLmpzb24oe1xuICAgICAgICBzdW1tYXJ5OiBmb3JtYXR0ZWRUZXh0LFxuICAgICAgICBzb3VyY2VzLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgY29uc29sZS5lcnJvcihcIkZvbGxvdy11cCBlcnJvcjpcIiwgZXJyb3IpO1xuICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oe1xuICAgICAgICBtZXNzYWdlOlxuICAgICAgICAgIGVycm9yLm1lc3NhZ2UgfHxcbiAgICAgICAgICBcIkFuIGVycm9yIG9jY3VycmVkIHdoaWxlIHByb2Nlc3NpbmcgeW91ciBmb2xsb3ctdXAgcXVlc3Rpb25cIixcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cbiAgY29uc3QgaHR0cFNlcnZlciA9IGNyZWF0ZVNlcnZlcihhcHApO1xuICByZXR1cm4gaHR0cFNlcnZlcjtcbn1cbiIsICJpbXBvcnQgZXhwcmVzcywgeyB0eXBlIEV4cHJlc3MgfSBmcm9tIFwiZXhwcmVzc1wiO1xuaW1wb3J0IGZzIGZyb20gXCJmc1wiO1xuaW1wb3J0IHBhdGgsIHsgZGlybmFtZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgeyBmaWxlVVJMVG9QYXRoIH0gZnJvbSBcInVybFwiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyIGFzIGNyZWF0ZVZpdGVTZXJ2ZXIsIGNyZWF0ZUxvZ2dlciB9IGZyb20gXCJ2aXRlXCI7XG5jb25zdCBfX2ZpbGVuYW1lID0gZmlsZVVSTFRvUGF0aChpbXBvcnQubWV0YS51cmwpO1xuY29uc3QgX19kaXJuYW1lID0gZGlybmFtZShfX2ZpbGVuYW1lKTtcbmltcG9ydCB7IHR5cGUgU2VydmVyIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB2aXRlQ29uZmlnIGZyb20gXCIuLi92aXRlLmNvbmZpZ1wiO1xuXG5jb25zdCB2aXRlTG9nZ2VyID0gY3JlYXRlTG9nZ2VyKCk7XG5cbmV4cG9ydCBmdW5jdGlvbiBsb2cobWVzc2FnZTogc3RyaW5nLCBzb3VyY2UgPSBcImV4cHJlc3NcIikge1xuICBjb25zdCBmb3JtYXR0ZWRUaW1lID0gbmV3IERhdGUoKS50b0xvY2FsZVRpbWVTdHJpbmcoXCJlbi1VU1wiLCB7XG4gICAgaG91cjogXCJudW1lcmljXCIsXG4gICAgbWludXRlOiBcIjItZGlnaXRcIixcbiAgICBzZWNvbmQ6IFwiMi1kaWdpdFwiLFxuICAgIGhvdXIxMjogdHJ1ZSxcbiAgfSk7XG5cbiAgY29uc29sZS5sb2coYCR7Zm9ybWF0dGVkVGltZX0gWyR7c291cmNlfV0gJHttZXNzYWdlfWApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2V0dXBWaXRlKGFwcDogRXhwcmVzcywgc2VydmVyOiBTZXJ2ZXIpIHtcbiAgY29uc3Qgdml0ZSA9IGF3YWl0IGNyZWF0ZVZpdGVTZXJ2ZXIoe1xuICAgIC4uLnZpdGVDb25maWcsXG4gICAgY29uZmlnRmlsZTogZmFsc2UsXG4gICAgY3VzdG9tTG9nZ2VyOiB7XG4gICAgICAuLi52aXRlTG9nZ2VyLFxuICAgICAgZXJyb3I6IChtc2csIG9wdGlvbnMpID0+IHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIG1zZy5pbmNsdWRlcyhcIltUeXBlU2NyaXB0XSBGb3VuZCAwIGVycm9ycy4gV2F0Y2hpbmcgZm9yIGZpbGUgY2hhbmdlc1wiKVxuICAgICAgICApIHtcbiAgICAgICAgICBsb2coXCJubyBlcnJvcnMgZm91bmRcIiwgXCJ0c2NcIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKG1zZy5pbmNsdWRlcyhcIltUeXBlU2NyaXB0XSBcIikpIHtcbiAgICAgICAgICBjb25zdCBbZXJyb3JzLCBzdW1tYXJ5XSA9IG1zZy5zcGxpdChcIltUeXBlU2NyaXB0XSBcIiwgMik7XG4gICAgICAgICAgbG9nKGAke3N1bW1hcnl9ICR7ZXJyb3JzfVxceDFCWzBtYCwgXCJ0c2NcIik7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZpdGVMb2dnZXIuZXJyb3IobXNnLCBvcHRpb25zKTtcbiAgICAgICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfSxcbiAgICBzZXJ2ZXI6IHtcbiAgICAgIG1pZGRsZXdhcmVNb2RlOiB0cnVlLFxuICAgICAgaG1yOiB7IHNlcnZlciB9LFxuICAgIH0sXG4gICAgYXBwVHlwZTogXCJjdXN0b21cIixcbiAgfSk7XG5cbiAgYXBwLnVzZSh2aXRlLm1pZGRsZXdhcmVzKTtcbiAgYXBwLnVzZShcIipcIiwgYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgY29uc3QgdXJsID0gcmVxLm9yaWdpbmFsVXJsO1xuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNsaWVudFRlbXBsYXRlID0gcGF0aC5yZXNvbHZlKFxuICAgICAgICBfX2Rpcm5hbWUsXG4gICAgICAgIFwiLi5cIixcbiAgICAgICAgXCJjbGllbnRcIixcbiAgICAgICAgXCJpbmRleC5odG1sXCJcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gYXdhaXQgZnMucHJvbWlzZXMucmVhZEZpbGUoY2xpZW50VGVtcGxhdGUsIFwidXRmLThcIik7XG4gICAgICBjb25zdCBwYWdlID0gYXdhaXQgdml0ZS50cmFuc2Zvcm1JbmRleEh0bWwodXJsLCB0ZW1wbGF0ZSk7XG4gICAgICByZXMuc3RhdHVzKDIwMCkuc2V0KHsgXCJDb250ZW50LVR5cGVcIjogXCJ0ZXh0L2h0bWxcIiB9KS5lbmQocGFnZSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdml0ZS5zc3JGaXhTdGFja3RyYWNlKGUgYXMgRXJyb3IpO1xuICAgICAgbmV4dChlKTtcbiAgICB9XG4gIH0pO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gc2VydmVTdGF0aWMoYXBwOiBFeHByZXNzKSB7XG4gIGNvbnN0IHB1YmxpY1BhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uXCIsIFwiZGlzdFwiLCBcInB1YmxpY1wiKTtcblxuICBpZiAoIWZzLmV4aXN0c1N5bmMocHVibGljUGF0aCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgQ291bGQgbm90IGZpbmQgdGhlIGJ1aWxkIGRpcmVjdG9yeTogJHtwdWJsaWNQYXRofSwgbWFrZSBzdXJlIHRvIGJ1aWxkIHRoZSBjbGllbnQgZmlyc3RgXG4gICAgKTtcbiAgfVxuXG4gIGFwcC51c2UoZXhwcmVzcy5zdGF0aWMocHVibGljUGF0aCkpO1xuXG4gIGFwcC5nZXQoXCIqXCIsIChfcmVxLCByZXMpID0+IHtcbiAgICByZXMuc2VuZEZpbGUocGF0aC5yZXNvbHZlKHB1YmxpY1BhdGgsIFwiaW5kZXguaHRtbFwiKSk7XG4gIH0pO1xufVxuIiwgImltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgdGhlbWVQbHVnaW4gZnJvbSBcIkByZXBsaXQvdml0ZS1wbHVnaW4tc2hhZGNuLXRoZW1lLWpzb25cIjtcbmltcG9ydCBwYXRoLCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHJ1bnRpbWVFcnJvck92ZXJsYXkgZnJvbSBcIkByZXBsaXQvdml0ZS1wbHVnaW4tcnVudGltZS1lcnJvci1tb2RhbFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IGRpcm5hbWUoX19maWxlbmFtZSk7XG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgcnVudGltZUVycm9yT3ZlcmxheSgpLCB0aGVtZVBsdWdpbigpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBkYlwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcImRiXCIpLFxuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiY2xpZW50XCIsIFwic3JjXCIpLFxuICAgIH0sXG4gIH0sXG4gIHJvb3Q6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiY2xpZW50XCIpLFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCJkaXN0L3B1YmxpY1wiKSxcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7OztBQUFBLE9BQU8sWUFBWTtBQUNuQixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFFOUIsSUFBTSxhQUFhLGNBQWMsWUFBWSxHQUFHO0FBQ2hELElBQU0sWUFBWSxLQUFLLFFBQVEsVUFBVTtBQUN6QyxJQUFNLFVBQVUsS0FBSyxRQUFRLFdBQVcsU0FBUztBQUUxQyxTQUFTLG1CQUFtQjtBQUNqQyxRQUFNLFNBQVMsT0FBTyxPQUFPLEVBQUUsTUFBTSxR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RUEsVUFBSSxPQUFPO0FBQUEsSUFDYjtBQUFBLEVBQ0YsQ0FBQztBQUVELE9BQUs7QUFDUCxDQUFDO0FBQUEsQ0FFQSxZQUFZO0FBRVgsUUFBTSxTQUFTLGVBQWUsR0FBRztBQUdqQyxNQUFJLElBQUksQ0FBQyxLQUFVLE1BQWUsS0FBZSxVQUF3QjtBQUN2RSxVQUFNLFNBQVMsSUFBSSxVQUFVLElBQUksY0FBYztBQUMvQyxVQUFNLFVBQVUsSUFBSSxXQUFXO0FBQy9CLFFBQUksT0FBTyxNQUFNLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQztBQUNuQyxVQUFNO0FBQUEsRUFDUixDQUFDO0FBR0QsTUFBSSxJQUFJLElBQUksS0FBSyxNQUFNLGVBQWU7QUFDcEMsVUFBTSxVQUFVLEtBQUssTUFBTTtBQUFBLEVBQzdCLE9BQU87QUFDTCxnQkFBWSxHQUFHO0FBQUEsRUFDakI7QUFHQSxRQUFNLE9BQU87QUFDYixTQUFPLE9BQU8sTUFBTSxXQUFXLE1BQU07QUFDbkMsUUFBSSxtQkFBbUIsSUFBSSxFQUFFO0FBQUEsRUFDL0IsQ0FBQztBQUNILEdBQUc7IiwKICAibmFtZXMiOiBbInBhdGgiLCAiZmlsZVVSTFRvUGF0aCIsICJleHByZXNzIiwgImFwcCIsICJwYXRoIiwgImRpcm5hbWUiLCAiZmlsZVVSTFRvUGF0aCIsICJwYXRoIiwgImZpbGVVUkxUb1BhdGgiLCAiX19maWxlbmFtZSIsICJfX2Rpcm5hbWUiLCAiX19maWxlbmFtZSIsICJmaWxlVVJMVG9QYXRoIiwgIl9fZGlybmFtZSIsICJkaXJuYW1lIiwgImFwcCIsICJwYXRoIiwgImVudiIsICJfX2ZpbGVuYW1lIiwgImZpbGVVUkxUb1BhdGgiLCAiX19kaXJuYW1lIiwgInBhdGgiLCAiZXhwcmVzcyJdCn0K
