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
import express from "express";

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
  app2.use("/api/*", (req, res, next) => {
    if (!res.headersSent) {
      next();
    }
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      if (url.startsWith("/api")) {
        return next();
      }
      const template = await fs.promises.readFile(
        path3.resolve(__dirname3, "..", "client", "index.html"),
        "utf-8"
      );
      const html = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
__name(setupVite, "setupVite");

// server/index.ts
import fs2 from "fs";
var env2 = setupEnvironment();
console.log("\n--- Environment Setup Debug ---");
console.log("Environment variables loaded:", env2);
console.log("--- End Debug ---\n");
var __filename4 = fileURLToPath4(import.meta.url);
var __dirname4 = path4.dirname(__filename4);
var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
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
  try {
    const server = registerRoutes(app);
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      const distDir = path4.resolve(__dirname4, "..", "dist");
      const publicDir = path4.resolve(distDir, "public");
      if (!fs2.existsSync(publicDir)) {
        throw new Error(`Build directory not found: ${publicDir}`);
      }
      app.use("/api/*", (req, res, next) => {
        if (!res.headersSent) {
          next();
        }
      });
      app.use(
        express.static(publicDir, {
          index: false,
          maxAge: "30d",
          immutable: true
        })
      );
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          return next();
        }
        const indexPath = path4.join(publicDir, "index.html");
        if (!fs2.existsSync(indexPath)) {
          return next(new Error("index.html not found"));
        }
        res.set({
          "Cache-Control": "no-cache",
          "Content-Type": "text/html"
        });
        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error(`Error sending ${indexPath}:`, err);
            next(err);
          }
        });
      });
    }
    app.use((err, _req, res, _next) => {
      console.error("Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });
    const PORT = 3e3;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT} in ${app.get("env")} mode`);
    });
  } catch (error) {
    console.error("Server initialization error:", error);
    process.exit(1);
  }
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2VydmVyL2Vudi50cyIsICIuLi9zZXJ2ZXIvaW5kZXgudHMiLCAiLi4vc2VydmVyL3JvdXRlcy50cyIsICIuLi9zZXJ2ZXIvdml0ZS50cyIsICIuLi92aXRlLmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGRvdGVudiBmcm9tIFwiZG90ZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShfX2ZpbGVuYW1lKTtcbmNvbnN0IGVudlBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy5lbnZcIik7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cEVudmlyb25tZW50KCkge1xuICBjb25zdCByZXN1bHQgPSBkb3RlbnYuY29uZmlnKHsgcGF0aDogZW52UGF0aCB9KTtcbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBGYWlsZWQgdG8gbG9hZCAuZW52IGZpbGUgZnJvbSAke2VudlBhdGh9OiAke3Jlc3VsdC5lcnJvci5tZXNzYWdlfWBcbiAgICApO1xuICB9XG5cbiAgaWYgKCFwcm9jZXNzLmVudi5HT09HTEVfQVBJX0tFWSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiR09PR0xFX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdCBiZSBzZXQgaW4gLmVudiBmaWxlXCJcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBHT09HTEVfQVBJX0tFWTogcHJvY2Vzcy5lbnYuR09PR0xFX0FQSV9LRVksXG4gICAgTk9ERV9FTlY6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8IFwiZGV2ZWxvcG1lbnRcIixcbiAgfTtcbn1cbiIsICJpbXBvcnQgeyBzZXR1cEVudmlyb25tZW50IH0gZnJvbSBcIi4vZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCBleHByZXNzLCB7IHR5cGUgUmVxdWVzdCwgUmVzcG9uc2UsIE5leHRGdW5jdGlvbiB9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgeyByZWdpc3RlclJvdXRlcyB9IGZyb20gXCIuL3JvdXRlc1wiO1xuaW1wb3J0IHsgc2V0dXBWaXRlLCBsb2cgfSBmcm9tIFwiLi92aXRlXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5cbi8vIFNldHVwIGVudmlyb25tZW50IHZhcmlhYmxlcyBmaXJzdFxuY29uc3QgZW52ID0gc2V0dXBFbnZpcm9ubWVudCgpO1xuY29uc29sZS5sb2coXCJcXG4tLS0gRW52aXJvbm1lbnQgU2V0dXAgRGVidWcgLS0tXCIpO1xuY29uc29sZS5sb2coXCJFbnZpcm9ubWVudCB2YXJpYWJsZXMgbG9hZGVkOlwiLCBlbnYpO1xuY29uc29sZS5sb2coXCItLS0gRW5kIERlYnVnIC0tLVxcblwiKTtcblxuLy8gR2V0IHRoZSBkaXJlY3RvcnkgbmFtZSBwcm9wZXJseSB3aXRoIEVTIG1vZHVsZXNcbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBwYXRoLmRpcm5hbWUoX19maWxlbmFtZSk7XG5cbmNvbnN0IGFwcCA9IGV4cHJlc3MoKTtcblxuLy8gMS4g5Z+656GA5Lit6Ze05Lu2XG5hcHAudXNlKGV4cHJlc3MuanNvbigpKTtcbmFwcC51c2UoZXhwcmVzcy51cmxlbmNvZGVkKHsgZXh0ZW5kZWQ6IGZhbHNlIH0pKTtcblxuLy8gMi4gQVBJIOivt+axguaXpeW/l+S4remXtOS7tlxuYXBwLnVzZSgocmVxLCByZXMsIG5leHQpID0+IHtcbiAgY29uc3Qgc3RhcnQgPSBEYXRlLm5vdygpO1xuICBjb25zdCBwYXRoID0gcmVxLnBhdGg7XG4gIGxldCBjYXB0dXJlZEpzb25SZXNwb25zZTogUmVjb3JkPHN0cmluZywgYW55PiB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcblxuICBjb25zdCBvcmlnaW5hbFJlc0pzb24gPSByZXMuanNvbjtcbiAgcmVzLmpzb24gPSBmdW5jdGlvbiAoYm9keUpzb24sIC4uLmFyZ3MpIHtcbiAgICBjYXB0dXJlZEpzb25SZXNwb25zZSA9IGJvZHlKc29uO1xuICAgIHJldHVybiBvcmlnaW5hbFJlc0pzb24uYXBwbHkocmVzLCBbYm9keUpzb24sIC4uLmFyZ3NdKTtcbiAgfTtcblxuICByZXMub24oXCJmaW5pc2hcIiwgKCkgPT4ge1xuICAgIGNvbnN0IGR1cmF0aW9uID0gRGF0ZS5ub3coKSAtIHN0YXJ0O1xuICAgIGlmIChwYXRoLnN0YXJ0c1dpdGgoXCIvYXBpXCIpKSB7XG4gICAgICBsZXQgbG9nTGluZSA9IGAke3JlcS5tZXRob2R9ICR7cGF0aH0gJHtyZXMuc3RhdHVzQ29kZX0gaW4gJHtkdXJhdGlvbn1tc2A7XG4gICAgICBpZiAoY2FwdHVyZWRKc29uUmVzcG9uc2UpIHtcbiAgICAgICAgbG9nTGluZSArPSBgIDo6ICR7SlNPTi5zdHJpbmdpZnkoY2FwdHVyZWRKc29uUmVzcG9uc2UpfWA7XG4gICAgICB9XG5cbiAgICAgIGlmIChsb2dMaW5lLmxlbmd0aCA+IDgwKSB7XG4gICAgICAgIGxvZ0xpbmUgPSBsb2dMaW5lLnNsaWNlKDAsIDc5KSArIFwi4oCmXCI7XG4gICAgICB9XG5cbiAgICAgIGxvZyhsb2dMaW5lKTtcbiAgICB9XG4gIH0pO1xuXG4gIG5leHQoKTtcbn0pO1xuXG4oYXN5bmMgKCkgPT4ge1xuICB0cnkge1xuICAgIC8vIDMuIOWIm+W7uiBIVFRQIOacjeWKoeWZqFxuICAgIGNvbnN0IHNlcnZlciA9IHJlZ2lzdGVyUm91dGVzKGFwcCk7XG5cbiAgICAvLyA0LiDmoLnmja7njq/looPphY3nva7liY3nq6/otYTmupBcbiAgICBpZiAoYXBwLmdldChcImVudlwiKSA9PT0gXCJkZXZlbG9wbWVudFwiKSB7XG4gICAgICAvLyDlvIDlj5Hnjq/looPvvJrkvb/nlKggVml0ZSDlvIDlj5HmnI3liqHlmahcbiAgICAgIGF3YWl0IHNldHVwVml0ZShhcHAsIHNlcnZlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIOeUn+S6p+eOr+Wig++8muS9v+eUqOS8mOWMlueahOmdmeaAgeaWh+S7tuacjeWKoVxuICAgICAgY29uc3QgZGlzdERpciA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi5cIiwgXCJkaXN0XCIpO1xuICAgICAgY29uc3QgcHVibGljRGlyID0gcGF0aC5yZXNvbHZlKGRpc3REaXIsIFwicHVibGljXCIpO1xuXG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMocHVibGljRGlyKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWxkIGRpcmVjdG9yeSBub3QgZm91bmQ6ICR7cHVibGljRGlyfWApO1xuICAgICAgfVxuXG4gICAgICAvLyA0LjEg5YWI5aSE55CGIEFQSSDot6/nlLFcbiAgICAgIGFwcC51c2UoXCIvYXBpLypcIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGlmICghcmVzLmhlYWRlcnNTZW50KSB7XG4gICAgICAgICAgbmV4dCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgLy8gNC4yIOmdmeaAgei1hOa6kOacjeWKoVxuICAgICAgYXBwLnVzZShcbiAgICAgICAgZXhwcmVzcy5zdGF0aWMocHVibGljRGlyLCB7XG4gICAgICAgICAgaW5kZXg6IGZhbHNlLFxuICAgICAgICAgIG1heEFnZTogXCIzMGRcIixcbiAgICAgICAgICBpbW11dGFibGU6IHRydWUsXG4gICAgICAgIH0pXG4gICAgICApO1xuXG4gICAgICAvLyA0LjMg5omA5pyJ6Z2eIEFQSSDot6/nlLHov5Tlm54gaW5kZXguaHRtbFxuICAgICAgYXBwLmdldChcIipcIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIGlmIChyZXEucGF0aC5zdGFydHNXaXRoKFwiL2FwaVwiKSkge1xuICAgICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4ocHVibGljRGlyLCBcImluZGV4Lmh0bWxcIik7XG4gICAgICAgIGlmICghZnMuZXhpc3RzU3luYyhpbmRleFBhdGgpKSB7XG4gICAgICAgICAgcmV0dXJuIG5leHQobmV3IEVycm9yKFwiaW5kZXguaHRtbCBub3QgZm91bmRcIikpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzLnNldCh7XG4gICAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcInRleHQvaHRtbFwiLFxuICAgICAgICB9KTtcblxuICAgICAgICByZXMuc2VuZEZpbGUoaW5kZXhQYXRoLCAoZXJyKSA9PiB7XG4gICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRXJyb3Igc2VuZGluZyAke2luZGV4UGF0aH06YCwgZXJyKTtcbiAgICAgICAgICAgIG5leHQoZXJyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gNS4g6ZSZ6K+v5aSE55CG5Lit6Ze05Lu2XG4gICAgYXBwLnVzZSgoZXJyOiBhbnksIF9yZXE6IFJlcXVlc3QsIHJlczogUmVzcG9uc2UsIF9uZXh0OiBOZXh0RnVuY3Rpb24pID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJFcnJvcjpcIiwgZXJyKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGVyci5zdGF0dXMgfHwgZXJyLnN0YXR1c0NvZGUgfHwgNTAwO1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVyci5tZXNzYWdlIHx8IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCI7XG4gICAgICBpZiAoIXJlcy5oZWFkZXJzU2VudCkge1xuICAgICAgICByZXMuc3RhdHVzKHN0YXR1cykuanNvbih7IG1lc3NhZ2UgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyA2LiDlkK/liqjmnI3liqHlmahcbiAgICBjb25zdCBQT1JUID0gMzAwMDtcbiAgICBzZXJ2ZXIubGlzdGVuKFBPUlQsIFwiMC4wLjAuMFwiLCAoKSA9PiB7XG4gICAgICBsb2coYFNlcnZlciBydW5uaW5nIG9uIHBvcnQgJHtQT1JUfSBpbiAke2FwcC5nZXQoXCJlbnZcIil9IG1vZGVgKTtcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKFwiU2VydmVyIGluaXRpYWxpemF0aW9uIGVycm9yOlwiLCBlcnJvcik7XG4gICAgcHJvY2Vzcy5leGl0KDEpO1xuICB9XG59KSgpO1xuIiwgImltcG9ydCB0eXBlIHsgRXhwcmVzcyB9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIHR5cGUgU2VydmVyIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7XG4gIEdvb2dsZUdlbmVyYXRpdmVBSSxcbiAgdHlwZSBDaGF0U2Vzc2lvbixcbiAgdHlwZSBHZW5lcmF0ZUNvbnRlbnRSZXN1bHQsXG59IGZyb20gXCJAZ29vZ2xlL2dlbmVyYXRpdmUtYWlcIjtcbmltcG9ydCB7IG1hcmtlZCB9IGZyb20gXCJtYXJrZWRcIjtcbmltcG9ydCB7IHNldHVwRW52aXJvbm1lbnQgfSBmcm9tIFwiLi9lbnZcIjtcblxuY29uc3QgZW52ID0gc2V0dXBFbnZpcm9ubWVudCgpO1xuY29uc3QgZ2VuQUkgPSBuZXcgR29vZ2xlR2VuZXJhdGl2ZUFJKGVudi5HT09HTEVfQVBJX0tFWSk7XG5jb25zdCBtb2RlbCA9IGdlbkFJLmdldEdlbmVyYXRpdmVNb2RlbCh7XG4gIG1vZGVsOiBcImdlbWluaS0yLjAtZmxhc2gtZXhwXCIsXG4gIGdlbmVyYXRpb25Db25maWc6IHtcbiAgICB0ZW1wZXJhdHVyZTogMC45LFxuICAgIHRvcFA6IDEsXG4gICAgdG9wSzogMSxcbiAgICBtYXhPdXRwdXRUb2tlbnM6IDIwNDgsXG4gIH0sXG59KTtcblxuLy8gU3RvcmUgY2hhdCBzZXNzaW9ucyBpbiBtZW1vcnlcbmNvbnN0IGNoYXRTZXNzaW9ucyA9IG5ldyBNYXA8c3RyaW5nLCBDaGF0U2Vzc2lvbj4oKTtcblxuLy8gRm9ybWF0IHJhdyB0ZXh0IGludG8gcHJvcGVyIG1hcmtkb3duXG5hc3luYyBmdW5jdGlvbiBmb3JtYXRSZXNwb25zZVRvTWFya2Rvd24oXG4gIHRleHQ6IHN0cmluZyB8IFByb21pc2U8c3RyaW5nPlxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgLy8gRW5zdXJlIHdlIGhhdmUgYSBzdHJpbmcgdG8gd29yayB3aXRoXG4gIGNvbnN0IHJlc29sdmVkVGV4dCA9IGF3YWl0IFByb21pc2UucmVzb2x2ZSh0ZXh0KTtcblxuICAvLyBGaXJzdCwgZW5zdXJlIGNvbnNpc3RlbnQgbmV3bGluZXNcbiAgbGV0IHByb2Nlc3NlZFRleHQgPSByZXNvbHZlZFRleHQucmVwbGFjZSgvXFxyXFxuL2csIFwiXFxuXCIpO1xuXG4gIC8vIFByb2Nlc3MgbWFpbiBzZWN0aW9ucyAobGluZXMgdGhhdCBzdGFydCB3aXRoIHdvcmQocykgZm9sbG93ZWQgYnkgY29sb24pXG4gIHByb2Nlc3NlZFRleHQgPSBwcm9jZXNzZWRUZXh0LnJlcGxhY2UoXG4gICAgL14oW0EtWmEtel1bQS1aYS16XFxzXSspOihcXHMqKS9nbSxcbiAgICBcIiMjICQxJDJcIlxuICApO1xuXG4gIC8vIFByb2Nlc3Mgc3ViLXNlY3Rpb25zIChhbnkgcmVtYWluaW5nIHdvcmQocykgZm9sbG93ZWQgYnkgY29sb24gd2l0aGluIHRleHQpXG4gIHByb2Nlc3NlZFRleHQgPSBwcm9jZXNzZWRUZXh0LnJlcGxhY2UoXG4gICAgLyg/PD1cXG58XikoW0EtWmEtel1bQS1aYS16XFxzXSspOig/IVxcZCkvZ20sXG4gICAgXCIjIyMgJDFcIlxuICApO1xuXG4gIC8vIFByb2Nlc3MgYnVsbGV0IHBvaW50c1xuICBwcm9jZXNzZWRUZXh0ID0gcHJvY2Vzc2VkVGV4dC5yZXBsYWNlKC9eW+KAouKXj+KXi11cXHMqL2dtLCBcIiogXCIpO1xuXG4gIC8vIFNwbGl0IGludG8gcGFyYWdyYXBoc1xuICBjb25zdCBwYXJhZ3JhcGhzID0gcHJvY2Vzc2VkVGV4dC5zcGxpdChcIlxcblxcblwiKS5maWx0ZXIoQm9vbGVhbik7XG5cbiAgLy8gUHJvY2VzcyBlYWNoIHBhcmFncmFwaFxuICBjb25zdCBmb3JtYXR0ZWQgPSBwYXJhZ3JhcGhzXG4gICAgLm1hcCgocCkgPT4ge1xuICAgICAgLy8gSWYgaXQncyBhIGhlYWRlciBvciBsaXN0IGl0ZW0sIHByZXNlcnZlIGl0XG4gICAgICBpZiAocC5zdGFydHNXaXRoKFwiI1wiKSB8fCBwLnN0YXJ0c1dpdGgoXCIqXCIpIHx8IHAuc3RhcnRzV2l0aChcIi1cIikpIHtcbiAgICAgICAgcmV0dXJuIHA7XG4gICAgICB9XG4gICAgICAvLyBBZGQgcHJvcGVyIHBhcmFncmFwaCBmb3JtYXR0aW5nXG4gICAgICByZXR1cm4gYCR7cH1cXG5gO1xuICAgIH0pXG4gICAgLmpvaW4oXCJcXG5cXG5cIik7XG5cbiAgLy8gQ29uZmlndXJlIG1hcmtlZCBvcHRpb25zIGZvciBiZXR0ZXIgaGVhZGVyIHJlbmRlcmluZ1xuICBtYXJrZWQuc2V0T3B0aW9ucyh7XG4gICAgZ2ZtOiB0cnVlLFxuICAgIGJyZWFrczogdHJ1ZSxcbiAgfSk7XG5cbiAgLy8gQ29udmVydCBtYXJrZG93biB0byBIVE1MIHVzaW5nIG1hcmtlZFxuICByZXR1cm4gbWFya2VkLnBhcnNlKGZvcm1hdHRlZCk7XG59XG5cbmludGVyZmFjZSBXZWJTb3VyY2Uge1xuICB1cmk6IHN0cmluZztcbiAgdGl0bGU6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEdyb3VuZGluZ0NodW5rIHtcbiAgd2ViPzogV2ViU291cmNlO1xufVxuXG5pbnRlcmZhY2UgVGV4dFNlZ21lbnQge1xuICBzdGFydEluZGV4OiBudW1iZXI7XG4gIGVuZEluZGV4OiBudW1iZXI7XG4gIHRleHQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIEdyb3VuZGluZ1N1cHBvcnQge1xuICBzZWdtZW50OiBUZXh0U2VnbWVudDtcbiAgZ3JvdW5kaW5nQ2h1bmtJbmRpY2VzOiBudW1iZXJbXTtcbiAgY29uZmlkZW5jZVNjb3JlczogbnVtYmVyW107XG59XG5cbmludGVyZmFjZSBHcm91bmRpbmdNZXRhZGF0YSB7XG4gIGdyb3VuZGluZ0NodW5rczogR3JvdW5kaW5nQ2h1bmtbXTtcbiAgZ3JvdW5kaW5nU3VwcG9ydHM6IEdyb3VuZGluZ1N1cHBvcnRbXTtcbiAgc2VhcmNoRW50cnlQb2ludD86IGFueTtcbiAgd2ViU2VhcmNoUXVlcmllcz86IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJSb3V0ZXMoYXBwOiBFeHByZXNzKTogU2VydmVyIHtcbiAgLy8gU2VhcmNoIGVuZHBvaW50IC0gY3JlYXRlcyBhIG5ldyBjaGF0IHNlc3Npb25cbiAgYXBwLmdldChcIi9hcGkvc2VhcmNoXCIsIGFzeW5jIChyZXEsIHJlcykgPT4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBxdWVyeSA9IHJlcS5xdWVyeS5xIGFzIHN0cmluZztcblxuICAgICAgaWYgKCFxdWVyeSkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oe1xuICAgICAgICAgIG1lc3NhZ2U6IFwiUXVlcnkgcGFyYW1ldGVyICdxJyBpcyByZXF1aXJlZFwiLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQ3JlYXRlIGEgbmV3IGNoYXQgc2Vzc2lvbiB3aXRoIHNlYXJjaCBjYXBhYmlsaXR5XG4gICAgICBjb25zdCBjaGF0ID0gbW9kZWwuc3RhcnRDaGF0KHtcbiAgICAgICAgdG9vbHM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICAvLyBAdHMtaWdub3JlIC0gZ29vZ2xlX3NlYXJjaCBpcyBhIHZhbGlkIHRvb2wgYnV0IG5vdCB0eXBlZCBpbiB0aGUgU0RLIHlldFxuICAgICAgICAgICAgZ29vZ2xlX3NlYXJjaDoge30sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBHZW5lcmF0ZSBjb250ZW50IHdpdGggc2VhcmNoIHRvb2xcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNoYXQuc2VuZE1lc3NhZ2UocXVlcnkpO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXN1bHQucmVzcG9uc2U7XG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgXCJSYXcgR29vZ2xlIEFQSSBSZXNwb25zZTpcIixcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoXG4gICAgICAgICAge1xuICAgICAgICAgICAgdGV4dDogcmVzcG9uc2UudGV4dCgpLFxuICAgICAgICAgICAgY2FuZGlkYXRlczogcmVzcG9uc2UuY2FuZGlkYXRlcyxcbiAgICAgICAgICAgIGdyb3VuZGluZ01ldGFkYXRhOiByZXNwb25zZS5jYW5kaWRhdGVzPy5bMF0/Lmdyb3VuZGluZ01ldGFkYXRhLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbnVsbCxcbiAgICAgICAgICAyXG4gICAgICAgIClcbiAgICAgICk7XG4gICAgICBjb25zdCB0ZXh0ID0gcmVzcG9uc2UudGV4dCgpO1xuXG4gICAgICAvLyBGb3JtYXQgdGhlIHJlc3BvbnNlIHRleHQgdG8gcHJvcGVyIG1hcmtkb3duL0hUTUxcbiAgICAgIGNvbnN0IGZvcm1hdHRlZFRleHQgPSBhd2FpdCBmb3JtYXRSZXNwb25zZVRvTWFya2Rvd24odGV4dCk7XG5cbiAgICAgIC8vIEV4dHJhY3Qgc291cmNlcyBmcm9tIGdyb3VuZGluZyBtZXRhZGF0YVxuICAgICAgY29uc3Qgc291cmNlTWFwID0gbmV3IE1hcDxcbiAgICAgICAgc3RyaW5nLFxuICAgICAgICB7IHRpdGxlOiBzdHJpbmc7IHVybDogc3RyaW5nOyBzbmlwcGV0OiBzdHJpbmcgfVxuICAgICAgPigpO1xuXG4gICAgICAvLyBHZXQgZ3JvdW5kaW5nIG1ldGFkYXRhIGZyb20gcmVzcG9uc2VcbiAgICAgIGNvbnN0IG1ldGFkYXRhID0gcmVzcG9uc2UuY2FuZGlkYXRlcz8uWzBdPy5ncm91bmRpbmdNZXRhZGF0YSBhcyBhbnk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgY29uc3QgY2h1bmtzID0gbWV0YWRhdGEuZ3JvdW5kaW5nQ2h1bmtzIHx8IFtdO1xuICAgICAgICBjb25zdCBzdXBwb3J0cyA9IG1ldGFkYXRhLmdyb3VuZGluZ1N1cHBvcnRzIHx8IFtdO1xuXG4gICAgICAgIGNodW5rcy5mb3JFYWNoKChjaHVuazogYW55LCBpbmRleDogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgaWYgKGNodW5rLndlYj8udXJpICYmIGNodW5rLndlYj8udGl0bGUpIHtcbiAgICAgICAgICAgIGNvbnN0IHVybCA9IGNodW5rLndlYi51cmk7XG4gICAgICAgICAgICBpZiAoIXNvdXJjZU1hcC5oYXModXJsKSkge1xuICAgICAgICAgICAgICAvLyBGaW5kIHNuaXBwZXRzIHRoYXQgcmVmZXJlbmNlIHRoaXMgY2h1bmtcbiAgICAgICAgICAgICAgY29uc3Qgc25pcHBldHMgPSBzdXBwb3J0c1xuICAgICAgICAgICAgICAgIC5maWx0ZXIoKHN1cHBvcnQ6IGFueSkgPT5cbiAgICAgICAgICAgICAgICAgIHN1cHBvcnQuZ3JvdW5kaW5nQ2h1bmtJbmRpY2VzLmluY2x1ZGVzKGluZGV4KVxuICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICAgICAubWFwKChzdXBwb3J0OiBhbnkpID0+IHN1cHBvcnQuc2VnbWVudC50ZXh0KVxuICAgICAgICAgICAgICAgIC5qb2luKFwiIFwiKTtcblxuICAgICAgICAgICAgICBzb3VyY2VNYXAuc2V0KHVybCwge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBjaHVuay53ZWIudGl0bGUsXG4gICAgICAgICAgICAgICAgdXJsOiB1cmwsXG4gICAgICAgICAgICAgICAgc25pcHBldDogc25pcHBldHMgfHwgXCJcIixcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3Qgc291cmNlcyA9IEFycmF5LmZyb20oc291cmNlTWFwLnZhbHVlcygpKTtcblxuICAgICAgLy8gR2VuZXJhdGUgYSBzZXNzaW9uIElEIGFuZCBzdG9yZSB0aGUgY2hhdFxuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyaW5nKDcpO1xuICAgICAgY2hhdFNlc3Npb25zLnNldChzZXNzaW9uSWQsIGNoYXQpO1xuXG4gICAgICByZXMuanNvbih7XG4gICAgICAgIHNlc3Npb25JZCxcbiAgICAgICAgc3VtbWFyeTogZm9ybWF0dGVkVGV4dCxcbiAgICAgICAgc291cmNlcyxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJTZWFyY2ggZXJyb3I6XCIsIGVycm9yKTtcbiAgICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHtcbiAgICAgICAgbWVzc2FnZTpcbiAgICAgICAgICBlcnJvci5tZXNzYWdlIHx8IFwiQW4gZXJyb3Igb2NjdXJyZWQgd2hpbGUgcHJvY2Vzc2luZyB5b3VyIHNlYXJjaFwiLFxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICAvLyBGb2xsb3ctdXAgZW5kcG9pbnQgLSBjb250aW51ZXMgZXhpc3RpbmcgY2hhdCBzZXNzaW9uXG4gIGFwcC5wb3N0KFwiL2FwaS9mb2xsb3ctdXBcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgc2Vzc2lvbklkLCBxdWVyeSB9ID0gcmVxLmJvZHk7XG5cbiAgICAgIGlmICghc2Vzc2lvbklkIHx8ICFxdWVyeSkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDApLmpzb24oe1xuICAgICAgICAgIG1lc3NhZ2U6IFwiQm90aCBzZXNzaW9uSWQgYW5kIHF1ZXJ5IGFyZSByZXF1aXJlZFwiLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY2hhdCA9IGNoYXRTZXNzaW9ucy5nZXQoc2Vzc2lvbklkKTtcbiAgICAgIGlmICghY2hhdCkge1xuICAgICAgICByZXR1cm4gcmVzLnN0YXR1cyg0MDQpLmpzb24oe1xuICAgICAgICAgIG1lc3NhZ2U6IFwiQ2hhdCBzZXNzaW9uIG5vdCBmb3VuZFwiLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gU2VuZCBmb2xsb3ctdXAgbWVzc2FnZSBpbiBleGlzdGluZyBjaGF0XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjaGF0LnNlbmRNZXNzYWdlKHF1ZXJ5KTtcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVzdWx0LnJlc3BvbnNlO1xuICAgICAgY29uc29sZS5sb2coXG4gICAgICAgIFwiUmF3IEdvb2dsZSBBUEkgRm9sbG93LXVwIFJlc3BvbnNlOlwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0ZXh0OiByZXNwb25zZS50ZXh0KCksXG4gICAgICAgICAgICBjYW5kaWRhdGVzOiByZXNwb25zZS5jYW5kaWRhdGVzLFxuICAgICAgICAgICAgZ3JvdW5kaW5nTWV0YWRhdGE6IHJlc3BvbnNlLmNhbmRpZGF0ZXM/LlswXT8uZ3JvdW5kaW5nTWV0YWRhdGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBudWxsLFxuICAgICAgICAgIDJcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICAgIGNvbnN0IHRleHQgPSByZXNwb25zZS50ZXh0KCk7XG5cbiAgICAgIC8vIEZvcm1hdCB0aGUgcmVzcG9uc2UgdGV4dCB0byBwcm9wZXIgbWFya2Rvd24vSFRNTFxuICAgICAgY29uc3QgZm9ybWF0dGVkVGV4dCA9IGF3YWl0IGZvcm1hdFJlc3BvbnNlVG9NYXJrZG93bih0ZXh0KTtcblxuICAgICAgLy8gRXh0cmFjdCBzb3VyY2VzIGZyb20gZ3JvdW5kaW5nIG1ldGFkYXRhXG4gICAgICBjb25zdCBzb3VyY2VNYXAgPSBuZXcgTWFwPFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHsgdGl0bGU6IHN0cmluZzsgdXJsOiBzdHJpbmc7IHNuaXBwZXQ6IHN0cmluZyB9XG4gICAgICA+KCk7XG5cbiAgICAgIC8vIEdldCBncm91bmRpbmcgbWV0YWRhdGEgZnJvbSByZXNwb25zZVxuICAgICAgY29uc3QgbWV0YWRhdGEgPSByZXNwb25zZS5jYW5kaWRhdGVzPy5bMF0/Lmdyb3VuZGluZ01ldGFkYXRhIGFzIGFueTtcbiAgICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBtZXRhZGF0YS5ncm91bmRpbmdDaHVua3MgfHwgW107XG4gICAgICAgIGNvbnN0IHN1cHBvcnRzID0gbWV0YWRhdGEuZ3JvdW5kaW5nU3VwcG9ydHMgfHwgW107XG5cbiAgICAgICAgY2h1bmtzLmZvckVhY2goKGNodW5rOiBhbnksIGluZGV4OiBudW1iZXIpID0+IHtcbiAgICAgICAgICBpZiAoY2h1bmsud2ViPy51cmkgJiYgY2h1bmsud2ViPy50aXRsZSkge1xuICAgICAgICAgICAgY29uc3QgdXJsID0gY2h1bmsud2ViLnVyaTtcbiAgICAgICAgICAgIGlmICghc291cmNlTWFwLmhhcyh1cmwpKSB7XG4gICAgICAgICAgICAgIC8vIEZpbmQgc25pcHBldHMgdGhhdCByZWZlcmVuY2UgdGhpcyBjaHVua1xuICAgICAgICAgICAgICBjb25zdCBzbmlwcGV0cyA9IHN1cHBvcnRzXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoc3VwcG9ydDogYW55KSA9PlxuICAgICAgICAgICAgICAgICAgc3VwcG9ydC5ncm91bmRpbmdDaHVua0luZGljZXMuaW5jbHVkZXMoaW5kZXgpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIC5tYXAoKHN1cHBvcnQ6IGFueSkgPT4gc3VwcG9ydC5zZWdtZW50LnRleHQpXG4gICAgICAgICAgICAgICAgLmpvaW4oXCIgXCIpO1xuXG4gICAgICAgICAgICAgIHNvdXJjZU1hcC5zZXQodXJsLCB7XG4gICAgICAgICAgICAgICAgdGl0bGU6IGNodW5rLndlYi50aXRsZSxcbiAgICAgICAgICAgICAgICB1cmw6IHVybCxcbiAgICAgICAgICAgICAgICBzbmlwcGV0OiBzbmlwcGV0cyB8fCBcIlwiLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2VzID0gQXJyYXkuZnJvbShzb3VyY2VNYXAudmFsdWVzKCkpO1xuXG4gICAgICByZXMuanNvbih7XG4gICAgICAgIHN1bW1hcnk6IGZvcm1hdHRlZFRleHQsXG4gICAgICAgIHNvdXJjZXMsXG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBjb25zb2xlLmVycm9yKFwiRm9sbG93LXVwIGVycm9yOlwiLCBlcnJvcik7XG4gICAgICByZXMuc3RhdHVzKDUwMCkuanNvbih7XG4gICAgICAgIG1lc3NhZ2U6XG4gICAgICAgICAgZXJyb3IubWVzc2FnZSB8fFxuICAgICAgICAgIFwiQW4gZXJyb3Igb2NjdXJyZWQgd2hpbGUgcHJvY2Vzc2luZyB5b3VyIGZvbGxvdy11cCBxdWVzdGlvblwiLFxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuICBjb25zdCBodHRwU2VydmVyID0gY3JlYXRlU2VydmVyKGFwcCk7XG4gIHJldHVybiBodHRwU2VydmVyO1xufVxuIiwgImltcG9ydCBleHByZXNzLCB7IHR5cGUgRXhwcmVzcyB9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5pbXBvcnQgcGF0aCwgeyBkaXJuYW1lIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwidXJsXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIgYXMgY3JlYXRlVml0ZVNlcnZlciwgY3JlYXRlTG9nZ2VyIH0gZnJvbSBcInZpdGVcIjtcbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKF9fZmlsZW5hbWUpO1xuaW1wb3J0IHsgdHlwZSBTZXJ2ZXIgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHZpdGVDb25maWcgZnJvbSBcIi4uL3ZpdGUuY29uZmlnXCI7XG5cbmNvbnN0IHZpdGVMb2dnZXIgPSBjcmVhdGVMb2dnZXIoKTtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvZyhtZXNzYWdlOiBzdHJpbmcsIHNvdXJjZSA9IFwiZXhwcmVzc1wiKSB7XG4gIGNvbnN0IGZvcm1hdHRlZFRpbWUgPSBuZXcgRGF0ZSgpLnRvTG9jYWxlVGltZVN0cmluZyhcImVuLVVTXCIsIHtcbiAgICBob3VyOiBcIm51bWVyaWNcIixcbiAgICBtaW51dGU6IFwiMi1kaWdpdFwiLFxuICAgIHNlY29uZDogXCIyLWRpZ2l0XCIsXG4gICAgaG91cjEyOiB0cnVlLFxuICB9KTtcblxuICBjb25zb2xlLmxvZyhgJHtmb3JtYXR0ZWRUaW1lfSBbJHtzb3VyY2V9XSAke21lc3NhZ2V9YCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZXR1cFZpdGUoYXBwOiBFeHByZXNzLCBzZXJ2ZXI6IFNlcnZlcikge1xuICBjb25zdCB2aXRlID0gYXdhaXQgY3JlYXRlVml0ZVNlcnZlcih7XG4gICAgLi4udml0ZUNvbmZpZyxcbiAgICBjb25maWdGaWxlOiBmYWxzZSxcbiAgICBjdXN0b21Mb2dnZXI6IHtcbiAgICAgIC4uLnZpdGVMb2dnZXIsXG4gICAgICBlcnJvcjogKG1zZywgb3B0aW9ucykgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgbXNnLmluY2x1ZGVzKFwiW1R5cGVTY3JpcHRdIEZvdW5kIDAgZXJyb3JzLiBXYXRjaGluZyBmb3IgZmlsZSBjaGFuZ2VzXCIpXG4gICAgICAgICkge1xuICAgICAgICAgIGxvZyhcIm5vIGVycm9ycyBmb3VuZFwiLCBcInRzY1wiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAobXNnLmluY2x1ZGVzKFwiW1R5cGVTY3JpcHRdIFwiKSkge1xuICAgICAgICAgIGNvbnN0IFtlcnJvcnMsIHN1bW1hcnldID0gbXNnLnNwbGl0KFwiW1R5cGVTY3JpcHRdIFwiLCAyKTtcbiAgICAgICAgICBsb2coYCR7c3VtbWFyeX0gJHtlcnJvcnN9XFx4MUJbMG1gLCBcInRzY1wiKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdml0ZUxvZ2dlci5lcnJvcihtc2csIG9wdGlvbnMpO1xuICAgICAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9LFxuICAgIHNlcnZlcjoge1xuICAgICAgbWlkZGxld2FyZU1vZGU6IHRydWUsXG4gICAgICBobXI6IHsgc2VydmVyIH0sXG4gICAgfSxcbiAgICBhcHBUeXBlOiBcImN1c3RvbVwiLFxuICB9KTtcblxuICAvLyAxLiDlhYjlpITnkIYgQVBJIOi3r+eUsVxuICBhcHAudXNlKFwiL2FwaS8qXCIsIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgIGlmICghcmVzLmhlYWRlcnNTZW50KSB7XG4gICAgICBuZXh0KCk7XG4gICAgfVxuICB9KTtcblxuICAvLyAyLiBWaXRlIOW8gOWPkeacjeWKoeWZqOS4remXtOS7tlxuICBhcHAudXNlKHZpdGUubWlkZGxld2FyZXMpO1xuXG4gIC8vIDMuIEhUTUwg5Zue6YCA6Lev55SxXG4gIGFwcC51c2UoXCIqXCIsIGFzeW5jIChyZXEsIHJlcywgbmV4dCkgPT4ge1xuICAgIGNvbnN0IHVybCA9IHJlcS5vcmlnaW5hbFVybDtcblxuICAgIHRyeSB7XG4gICAgICAvLyDlpoLmnpzmmK8gQVBJIOivt+axgu+8jOi3s+i/h1xuICAgICAgaWYgKHVybC5zdGFydHNXaXRoKFwiL2FwaVwiKSkge1xuICAgICAgICByZXR1cm4gbmV4dCgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCB0ZW1wbGF0ZSA9IGF3YWl0IGZzLnByb21pc2VzLnJlYWRGaWxlKFxuICAgICAgICBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uXCIsIFwiY2xpZW50XCIsIFwiaW5kZXguaHRtbFwiKSxcbiAgICAgICAgXCJ1dGYtOFwiXG4gICAgICApO1xuXG4gICAgICBjb25zdCBodG1sID0gYXdhaXQgdml0ZS50cmFuc2Zvcm1JbmRleEh0bWwodXJsLCB0ZW1wbGF0ZSk7XG5cbiAgICAgIHJlcy5zdGF0dXMoMjAwKS5zZXQoeyBcIkNvbnRlbnQtVHlwZVwiOiBcInRleHQvaHRtbFwiIH0pLmVuZChodG1sKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICB2aXRlLnNzckZpeFN0YWNrdHJhY2UoZSBhcyBFcnJvcik7XG4gICAgICBuZXh0KGUpO1xuICAgIH1cbiAgfSk7XG59XG5cbmV4cG9ydCB7fTtcbiIsICJpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHRoZW1lUGx1Z2luIGZyb20gXCJAcmVwbGl0L3ZpdGUtcGx1Z2luLXNoYWRjbi10aGVtZS1qc29uXCI7XG5pbXBvcnQgcGF0aCwgeyBkaXJuYW1lIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCBydW50aW1lRXJyb3JPdmVybGF5IGZyb20gXCJAcmVwbGl0L3ZpdGUtcGx1Z2luLXJ1bnRpbWUtZXJyb3ItbW9kYWxcIjtcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGggfSBmcm9tIFwidXJsXCI7XG5cbmNvbnN0IF9fZmlsZW5hbWUgPSBmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCk7XG5jb25zdCBfX2Rpcm5hbWUgPSBkaXJuYW1lKF9fZmlsZW5hbWUpO1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCksIHJ1bnRpbWVFcnJvck92ZXJsYXkoKSwgdGhlbWVQbHVnaW4oKV0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAZGJcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCJkYlwiKSxcbiAgICAgIFwiQFwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcImNsaWVudFwiLCBcInNyY1wiKSxcbiAgICB9LFxuICB9LFxuICByb290OiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcImNsaWVudFwiKSxcbiAgYnVpbGQ6IHtcbiAgICBvdXREaXI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiZGlzdC9wdWJsaWNcIiksXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7QUFBQSxPQUFPLFlBQVk7QUFDbkIsT0FBTyxVQUFVO0FBQ2pCLFNBQVMscUJBQXFCO0FBRTlCLElBQU0sYUFBYSxjQUFjLFlBQVksR0FBRztBQUNoRCxJQUFNLFlBQVksS0FBSyxRQUFRLFVBQVU7QUFDekMsSUFBTSxVQUFVLEtBQUssUUFBUSxXQUFXLFNBQVM7QUFFMUMsU0FBUyxtQkFBbUI7QUFDakMsUUFBTSxTQUFTLE9BQU8sT0FBTyxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQzlDLE1BQUksT0FBTyxPQUFPO0FBQ2hCLFVBQU0sSUFBSTtBQUFBLE1BQ1IsaUNBQWlDLE9BQU8sS0FBSyxPQUFPLE1BQU0sT0FBTztBQUFBLElBQ25FO0FBQUEsRUFDRjtBQUVBLE1BQUksQ0FBQyxRQUFRLElBQUksZ0JBQWdCO0FBQy9CLFVBQU0sSUFBSTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMLGdCQUFnQixRQUFRLElBQUk7QUFBQSxJQUM1QixVQUFVLFFBQVEsSUFBSSxZQUFZO0FBQUEsRUFDcEM7QUFDRjtBQWxCZ0I7OztBQ1BoQixPQUFPQSxXQUFVO0FBQ2pCLFNBQVMsaUJBQUFDLHNCQUFxQjtBQUM5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LFFBQVE7QUFBQSxVQUNSLFdBQVc7QUFBQSxRQUNiLENBQUM7QUFBQSxNQUNIO0FBR0EsVUFBSSxJQUFJLEtBQUssQ0FBQyxLQUFLLEtBQUssU0FBUztBQUMvQixZQUFJLElBQUksS0FBSyxXQUFXLE1BQU0sR0FBRztBQUMvQixpQkFBTyxLQUFLO0FBQUEsUUFDZDtBQUVBLGNBQU0sWUFBWUssTUFBSyxLQUFLLFdBQVcsWUFBWTtBQUNuRCxZQUFJLENBQUNMLElBQUcsV0FBVyxTQUFTLEdBQUc7QUFDN0IsaUJBQU8sS0FBSyxJQUFJLE1BQU0sc0JBQXNCLENBQUM7QUFBQSxRQUMvQztBQUVBLFlBQUksSUFBSTtBQUFBLFVBQ04saUJBQWlCO0FBQUEsVUFDakIsZ0JBQWdCO0FBQUEsUUFDbEIsQ0FBQztBQUVELFlBQUksU0FBUyxXQUFXLENBQUMsUUFBUTtBQUMvQixjQUFJLEtBQUs7QUFDUCxvQkFBUSxNQUFNLGlCQUFpQixTQUFTLEtBQUssR0FBRztBQUNoRCxpQkFBSyxHQUFHO0FBQUEsVUFDVjtBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ0gsQ0FBQztBQUFBLElBQ0g7QUFHQSxRQUFJLElBQUksQ0FBQyxLQUFVLE1BQWUsS0FBZSxVQUF3QjtBQUN2RSxjQUFRLE1BQU0sVUFBVSxHQUFHO0FBQzNCLFlBQU0sU0FBUyxJQUFJLFVBQVUsSUFBSSxjQUFjO0FBQy9DLFlBQU0sVUFBVSxJQUFJLFdBQVc7QUFDL0IsVUFBSSxDQUFDLElBQUksYUFBYTtBQUNwQixZQUFJLE9BQU8sTUFBTSxFQUFFLEtBQUssRUFBRSxRQUFRLENBQUM7QUFBQSxNQUNyQztBQUFBLElBQ0YsQ0FBQztBQUdELFVBQU0sT0FBTztBQUNiLFdBQU8sT0FBTyxNQUFNLFdBQVcsTUFBTTtBQUNuQyxVQUFJLDBCQUEwQixJQUFJLE9BQU8sSUFBSSxJQUFJLEtBQUssQ0FBQyxPQUFPO0FBQUEsSUFDaEUsQ0FBQztBQUFBLEVBQ0gsU0FBUyxPQUFPO0FBQ2QsWUFBUSxNQUFNLGdDQUFnQyxLQUFLO0FBQ25ELFlBQVEsS0FBSyxDQUFDO0FBQUEsRUFDaEI7QUFDRixHQUFHOyIsCiAgIm5hbWVzIjogWyJwYXRoIiwgImZpbGVVUkxUb1BhdGgiLCAiYXBwIiwgInBhdGgiLCAiZGlybmFtZSIsICJmaWxlVVJMVG9QYXRoIiwgInBhdGgiLCAiZmlsZVVSTFRvUGF0aCIsICJfX2ZpbGVuYW1lIiwgIl9fZGlybmFtZSIsICJfX2ZpbGVuYW1lIiwgImZpbGVVUkxUb1BhdGgiLCAiX19kaXJuYW1lIiwgImRpcm5hbWUiLCAiYXBwIiwgInBhdGgiLCAiZnMiLCAiZW52IiwgIl9fZmlsZW5hbWUiLCAiZmlsZVVSTFRvUGF0aCIsICJfX2Rpcm5hbWUiLCAicGF0aCJdCn0K
