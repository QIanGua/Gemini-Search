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
      const publicDir = path4.resolve(__dirname4, "..", "dist", "public");
      const indexPath = path4.join(publicDir, "index.html");
      if (!fs2.existsSync(publicDir) || !fs2.existsSync(indexPath)) {
        throw new Error(`构建文件不存在，请先执行 build 命令`);
      }
      app.use("/assets", express.static(path4.join(publicDir, "assets")));
      app.use(
        "/favicon.ico",
        express.static(path4.join(publicDir, "favicon.ico"))
      );
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api/")) {
          return next();
        }
        res.setHeader("Content-Type", "text/html");
        fs2.createReadStream(indexPath).pipe(res);
      });
    }
    app.use((err, _req, res, _next) => {
      console.error("Server Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });
    const PORT = parseInt(process.env.PORT || "3000", 10);
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT} in ${app.get("env")} mode`);
    });
  } catch (error) {
    console.error("Server initialization error:", error);
    process.exit(1);
  }
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc2VydmVyL2Vudi50cyIsICIuLi9zZXJ2ZXIvaW5kZXgudHMiLCAiLi4vc2VydmVyL3JvdXRlcy50cyIsICIuLi9zZXJ2ZXIvdml0ZS50cyIsICIuLi92aXRlLmNvbmZpZy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IGRvdGVudiBmcm9tIFwiZG90ZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShfX2ZpbGVuYW1lKTtcbmNvbnN0IGVudlBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy5lbnZcIik7XG5cbmV4cG9ydCBmdW5jdGlvbiBzZXR1cEVudmlyb25tZW50KCkge1xuICBjb25zdCByZXN1bHQgPSBkb3RlbnYuY29uZmlnKHsgcGF0aDogZW52UGF0aCB9KTtcbiAgaWYgKHJlc3VsdC5lcnJvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBGYWlsZWQgdG8gbG9hZCAuZW52IGZpbGUgZnJvbSAke2VudlBhdGh9OiAke3Jlc3VsdC5lcnJvci5tZXNzYWdlfWBcbiAgICApO1xuICB9XG5cbiAgaWYgKCFwcm9jZXNzLmVudi5HT09HTEVfQVBJX0tFWSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIFwiR09PR0xFX0FQSV9LRVkgZW52aXJvbm1lbnQgdmFyaWFibGUgbXVzdCBiZSBzZXQgaW4gLmVudiBmaWxlXCJcbiAgICApO1xuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBHT09HTEVfQVBJX0tFWTogcHJvY2Vzcy5lbnYuR09PR0xFX0FQSV9LRVksXG4gICAgTk9ERV9FTlY6IHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8IFwiZGV2ZWxvcG1lbnRcIixcbiAgfTtcbn1cbiIsICJpbXBvcnQgeyBzZXR1cEVudmlyb25tZW50IH0gZnJvbSBcIi4vZW52XCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCBleHByZXNzLCB7IHR5cGUgUmVxdWVzdCwgUmVzcG9uc2UsIE5leHRGdW5jdGlvbiB9IGZyb20gXCJleHByZXNzXCI7XG5pbXBvcnQgeyByZWdpc3RlclJvdXRlcyB9IGZyb20gXCIuL3JvdXRlc1wiO1xuaW1wb3J0IHsgc2V0dXBWaXRlLCBsb2cgfSBmcm9tIFwiLi92aXRlXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzXCI7XG5cbi8vIFNldHVwIGVudmlyb25tZW50IHZhcmlhYmxlcyBmaXJzdFxuY29uc3QgZW52ID0gc2V0dXBFbnZpcm9ubWVudCgpO1xuXG4vLyBHZXQgdGhlIGRpcmVjdG9yeSBuYW1lIHByb3Blcmx5IHdpdGggRVMgbW9kdWxlc1xuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IHBhdGguZGlybmFtZShfX2ZpbGVuYW1lKTtcblxuLy8g5Yib5bu6IEV4cHJlc3Mg5bqU55SoXG5jb25zdCBhcHAgPSBleHByZXNzKCk7XG5cbi8vIDEuIOWfuuehgOS4remXtOS7tlxuYXBwLnVzZShleHByZXNzLmpzb24oKSk7XG5hcHAudXNlKGV4cHJlc3MudXJsZW5jb2RlZCh7IGV4dGVuZGVkOiBmYWxzZSB9KSk7XG5cbi8vIDIuIEFQSSDor7fmsYLml6Xlv5fkuK3pl7Tku7ZcbmFwcC51c2UoKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gIGNvbnN0IHN0YXJ0ID0gRGF0ZS5ub3coKTtcbiAgY29uc3QgcGF0aCA9IHJlcS5wYXRoO1xuICBsZXQgY2FwdHVyZWRKc29uUmVzcG9uc2U6IFJlY29yZDxzdHJpbmcsIGFueT4gfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG5cbiAgY29uc3Qgb3JpZ2luYWxSZXNKc29uID0gcmVzLmpzb247XG4gIHJlcy5qc29uID0gZnVuY3Rpb24gKGJvZHlKc29uLCAuLi5hcmdzKSB7XG4gICAgY2FwdHVyZWRKc29uUmVzcG9uc2UgPSBib2R5SnNvbjtcbiAgICByZXR1cm4gb3JpZ2luYWxSZXNKc29uLmFwcGx5KHJlcywgW2JvZHlKc29uLCAuLi5hcmdzXSk7XG4gIH07XG5cbiAgcmVzLm9uKFwiZmluaXNoXCIsICgpID0+IHtcbiAgICBjb25zdCBkdXJhdGlvbiA9IERhdGUubm93KCkgLSBzdGFydDtcbiAgICBpZiAocGF0aC5zdGFydHNXaXRoKFwiL2FwaVwiKSkge1xuICAgICAgbGV0IGxvZ0xpbmUgPSBgJHtyZXEubWV0aG9kfSAke3BhdGh9ICR7cmVzLnN0YXR1c0NvZGV9IGluICR7ZHVyYXRpb259bXNgO1xuICAgICAgaWYgKGNhcHR1cmVkSnNvblJlc3BvbnNlKSB7XG4gICAgICAgIGxvZ0xpbmUgKz0gYCA6OiAke0pTT04uc3RyaW5naWZ5KGNhcHR1cmVkSnNvblJlc3BvbnNlKX1gO1xuICAgICAgfVxuICAgICAgaWYgKGxvZ0xpbmUubGVuZ3RoID4gODApIHtcbiAgICAgICAgbG9nTGluZSA9IGxvZ0xpbmUuc2xpY2UoMCwgNzkpICsgXCLigKZcIjtcbiAgICAgIH1cbiAgICAgIGxvZyhsb2dMaW5lKTtcbiAgICB9XG4gIH0pO1xuXG4gIG5leHQoKTtcbn0pO1xuXG4oYXN5bmMgKCkgPT4ge1xuICB0cnkge1xuICAgIC8vIDMuIOWIm+W7uiBIVFRQIOacjeWKoeWZqOW5tuazqOWGjOi3r+eUsVxuICAgIGNvbnN0IHNlcnZlciA9IHJlZ2lzdGVyUm91dGVzKGFwcCk7XG5cbiAgICAvLyA0LiDmoLnmja7njq/looPphY3nva7liY3nq6/otYTmupBcbiAgICBpZiAoYXBwLmdldChcImVudlwiKSA9PT0gXCJkZXZlbG9wbWVudFwiKSB7XG4gICAgICAvLyDlvIDlj5Hnjq/looPvvJrkvb/nlKggVml0ZVxuICAgICAgYXdhaXQgc2V0dXBWaXRlKGFwcCwgc2VydmVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8g55Sf5Lqn546v5aKD77ya5omL5Yqo6YWN572u6Z2Z5oCB5paH5Lu25pyN5YqhXG4gICAgICBjb25zdCBwdWJsaWNEaXIgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uXCIsIFwiZGlzdFwiLCBcInB1YmxpY1wiKTtcbiAgICAgIGNvbnN0IGluZGV4UGF0aCA9IHBhdGguam9pbihwdWJsaWNEaXIsIFwiaW5kZXguaHRtbFwiKTtcblxuICAgICAgLy8g56Gu5L+d5p6E5bu655uu5b2V5a2Y5ZyoXG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMocHVibGljRGlyKSB8fCAhZnMuZXhpc3RzU3luYyhpbmRleFBhdGgpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihg5p6E5bu65paH5Lu25LiN5a2Y5Zyo77yM6K+35YWI5omn6KGMIGJ1aWxkIOWRveS7pGApO1xuICAgICAgfVxuXG4gICAgICAvLyDpnZnmgIHotYTmupDmnI3liqFcbiAgICAgIGFwcC51c2UoXCIvYXNzZXRzXCIsIGV4cHJlc3Muc3RhdGljKHBhdGguam9pbihwdWJsaWNEaXIsIFwiYXNzZXRzXCIpKSk7XG4gICAgICBhcHAudXNlKFxuICAgICAgICBcIi9mYXZpY29uLmljb1wiLFxuICAgICAgICBleHByZXNzLnN0YXRpYyhwYXRoLmpvaW4ocHVibGljRGlyLCBcImZhdmljb24uaWNvXCIpKVxuICAgICAgKTtcblxuICAgICAgLy8g5omA5pyJ6Z2eIEFQSSDot6/nlLHov5Tlm54gaW5kZXguaHRtbFxuICAgICAgYXBwLmdldChcIipcIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgICAgIC8vIEFQSSDot6/nlLHkuqTnu5nms6jlhoznmoQgQVBJIOWkhOeQhueoi+W6j+WkhOeQhlxuICAgICAgICBpZiAocmVxLnBhdGguc3RhcnRzV2l0aChcIi9hcGkvXCIpKSB7XG4gICAgICAgICAgcmV0dXJuIG5leHQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIOWFtuS7luaJgOaciei3r+eUsei/lOWbniBpbmRleC5odG1sXG4gICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgXCJ0ZXh0L2h0bWxcIik7XG4gICAgICAgIGZzLmNyZWF0ZVJlYWRTdHJlYW0oaW5kZXhQYXRoKS5waXBlKHJlcyk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyA1LiDplJnor6/lpITnkIbkuK3pl7Tku7ZcbiAgICBhcHAudXNlKChlcnI6IGFueSwgX3JlcTogUmVxdWVzdCwgcmVzOiBSZXNwb25zZSwgX25leHQ6IE5leHRGdW5jdGlvbikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcihcIlNlcnZlciBFcnJvcjpcIiwgZXJyKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGVyci5zdGF0dXMgfHwgZXJyLnN0YXR1c0NvZGUgfHwgNTAwO1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVyci5tZXNzYWdlIHx8IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCI7XG4gICAgICByZXMuc3RhdHVzKHN0YXR1cykuanNvbih7IG1lc3NhZ2UgfSk7XG4gICAgfSk7XG5cbiAgICAvLyA2LiDlkK/liqjmnI3liqHlmahcbiAgICBjb25zdCBQT1JUID0gcGFyc2VJbnQocHJvY2Vzcy5lbnYuUE9SVCB8fCBcIjMwMDBcIiwgMTApO1xuICAgIHNlcnZlci5saXN0ZW4oUE9SVCwgXCIwLjAuMC4wXCIsICgpID0+IHtcbiAgICAgIGxvZyhgU2VydmVyIHJ1bm5pbmcgb24gcG9ydCAke1BPUlR9IGluICR7YXBwLmdldChcImVudlwiKX0gbW9kZWApO1xuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJTZXJ2ZXIgaW5pdGlhbGl6YXRpb24gZXJyb3I6XCIsIGVycm9yKTtcbiAgICBwcm9jZXNzLmV4aXQoMSk7XG4gIH1cbn0pKCk7XG4iLCAiaW1wb3J0IHR5cGUgeyBFeHByZXNzIH0gZnJvbSBcImV4cHJlc3NcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgdHlwZSBTZXJ2ZXIgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHtcbiAgR29vZ2xlR2VuZXJhdGl2ZUFJLFxuICB0eXBlIENoYXRTZXNzaW9uLFxuICB0eXBlIEdlbmVyYXRlQ29udGVudFJlc3VsdCxcbn0gZnJvbSBcIkBnb29nbGUvZ2VuZXJhdGl2ZS1haVwiO1xuaW1wb3J0IHsgbWFya2VkIH0gZnJvbSBcIm1hcmtlZFwiO1xuaW1wb3J0IHsgc2V0dXBFbnZpcm9ubWVudCB9IGZyb20gXCIuL2VudlwiO1xuXG5jb25zdCBlbnYgPSBzZXR1cEVudmlyb25tZW50KCk7XG5jb25zdCBnZW5BSSA9IG5ldyBHb29nbGVHZW5lcmF0aXZlQUkoZW52LkdPT0dMRV9BUElfS0VZKTtcbmNvbnN0IG1vZGVsID0gZ2VuQUkuZ2V0R2VuZXJhdGl2ZU1vZGVsKHtcbiAgbW9kZWw6IFwiZ2VtaW5pLTIuMC1mbGFzaC1leHBcIixcbiAgZ2VuZXJhdGlvbkNvbmZpZzoge1xuICAgIHRlbXBlcmF0dXJlOiAwLjksXG4gICAgdG9wUDogMSxcbiAgICB0b3BLOiAxLFxuICAgIG1heE91dHB1dFRva2VuczogMjA0OCxcbiAgfSxcbn0pO1xuXG4vLyBTdG9yZSBjaGF0IHNlc3Npb25zIGluIG1lbW9yeVxuY29uc3QgY2hhdFNlc3Npb25zID0gbmV3IE1hcDxzdHJpbmcsIENoYXRTZXNzaW9uPigpO1xuXG4vLyBGb3JtYXQgcmF3IHRleHQgaW50byBwcm9wZXIgbWFya2Rvd25cbmFzeW5jIGZ1bmN0aW9uIGZvcm1hdFJlc3BvbnNlVG9NYXJrZG93bihcbiAgdGV4dDogc3RyaW5nIHwgUHJvbWlzZTxzdHJpbmc+XG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAvLyBFbnN1cmUgd2UgaGF2ZSBhIHN0cmluZyB0byB3b3JrIHdpdGhcbiAgY29uc3QgcmVzb2x2ZWRUZXh0ID0gYXdhaXQgUHJvbWlzZS5yZXNvbHZlKHRleHQpO1xuXG4gIC8vIEZpcnN0LCBlbnN1cmUgY29uc2lzdGVudCBuZXdsaW5lc1xuICBsZXQgcHJvY2Vzc2VkVGV4dCA9IHJlc29sdmVkVGV4dC5yZXBsYWNlKC9cXHJcXG4vZywgXCJcXG5cIik7XG5cbiAgLy8gUHJvY2VzcyBtYWluIHNlY3Rpb25zIChsaW5lcyB0aGF0IHN0YXJ0IHdpdGggd29yZChzKSBmb2xsb3dlZCBieSBjb2xvbilcbiAgcHJvY2Vzc2VkVGV4dCA9IHByb2Nlc3NlZFRleHQucmVwbGFjZShcbiAgICAvXihbQS1aYS16XVtBLVphLXpcXHNdKyk6KFxccyopL2dtLFxuICAgIFwiIyMgJDEkMlwiXG4gICk7XG5cbiAgLy8gUHJvY2VzcyBzdWItc2VjdGlvbnMgKGFueSByZW1haW5pbmcgd29yZChzKSBmb2xsb3dlZCBieSBjb2xvbiB3aXRoaW4gdGV4dClcbiAgcHJvY2Vzc2VkVGV4dCA9IHByb2Nlc3NlZFRleHQucmVwbGFjZShcbiAgICAvKD88PVxcbnxeKShbQS1aYS16XVtBLVphLXpcXHNdKyk6KD8hXFxkKS9nbSxcbiAgICBcIiMjIyAkMVwiXG4gICk7XG5cbiAgLy8gUHJvY2VzcyBidWxsZXQgcG9pbnRzXG4gIHByb2Nlc3NlZFRleHQgPSBwcm9jZXNzZWRUZXh0LnJlcGxhY2UoL15b4oCi4peP4peLXVxccyovZ20sIFwiKiBcIik7XG5cbiAgLy8gU3BsaXQgaW50byBwYXJhZ3JhcGhzXG4gIGNvbnN0IHBhcmFncmFwaHMgPSBwcm9jZXNzZWRUZXh0LnNwbGl0KFwiXFxuXFxuXCIpLmZpbHRlcihCb29sZWFuKTtcblxuICAvLyBQcm9jZXNzIGVhY2ggcGFyYWdyYXBoXG4gIGNvbnN0IGZvcm1hdHRlZCA9IHBhcmFncmFwaHNcbiAgICAubWFwKChwKSA9PiB7XG4gICAgICAvLyBJZiBpdCdzIGEgaGVhZGVyIG9yIGxpc3QgaXRlbSwgcHJlc2VydmUgaXRcbiAgICAgIGlmIChwLnN0YXJ0c1dpdGgoXCIjXCIpIHx8IHAuc3RhcnRzV2l0aChcIipcIikgfHwgcC5zdGFydHNXaXRoKFwiLVwiKSkge1xuICAgICAgICByZXR1cm4gcDtcbiAgICAgIH1cbiAgICAgIC8vIEFkZCBwcm9wZXIgcGFyYWdyYXBoIGZvcm1hdHRpbmdcbiAgICAgIHJldHVybiBgJHtwfVxcbmA7XG4gICAgfSlcbiAgICAuam9pbihcIlxcblxcblwiKTtcblxuICAvLyBDb25maWd1cmUgbWFya2VkIG9wdGlvbnMgZm9yIGJldHRlciBoZWFkZXIgcmVuZGVyaW5nXG4gIG1hcmtlZC5zZXRPcHRpb25zKHtcbiAgICBnZm06IHRydWUsXG4gICAgYnJlYWtzOiB0cnVlLFxuICB9KTtcblxuICAvLyBDb252ZXJ0IG1hcmtkb3duIHRvIEhUTUwgdXNpbmcgbWFya2VkXG4gIHJldHVybiBtYXJrZWQucGFyc2UoZm9ybWF0dGVkKTtcbn1cblxuaW50ZXJmYWNlIFdlYlNvdXJjZSB7XG4gIHVyaTogc3RyaW5nO1xuICB0aXRsZTogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgR3JvdW5kaW5nQ2h1bmsge1xuICB3ZWI/OiBXZWJTb3VyY2U7XG59XG5cbmludGVyZmFjZSBUZXh0U2VnbWVudCB7XG4gIHN0YXJ0SW5kZXg6IG51bWJlcjtcbiAgZW5kSW5kZXg6IG51bWJlcjtcbiAgdGV4dDogc3RyaW5nO1xufVxuXG5pbnRlcmZhY2UgR3JvdW5kaW5nU3VwcG9ydCB7XG4gIHNlZ21lbnQ6IFRleHRTZWdtZW50O1xuICBncm91bmRpbmdDaHVua0luZGljZXM6IG51bWJlcltdO1xuICBjb25maWRlbmNlU2NvcmVzOiBudW1iZXJbXTtcbn1cblxuaW50ZXJmYWNlIEdyb3VuZGluZ01ldGFkYXRhIHtcbiAgZ3JvdW5kaW5nQ2h1bmtzOiBHcm91bmRpbmdDaHVua1tdO1xuICBncm91bmRpbmdTdXBwb3J0czogR3JvdW5kaW5nU3VwcG9ydFtdO1xuICBzZWFyY2hFbnRyeVBvaW50PzogYW55O1xuICB3ZWJTZWFyY2hRdWVyaWVzPzogc3RyaW5nW107XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclJvdXRlcyhhcHA6IEV4cHJlc3MpOiBTZXJ2ZXIge1xuICAvLyBTZWFyY2ggZW5kcG9pbnQgLSBjcmVhdGVzIGEgbmV3IGNoYXQgc2Vzc2lvblxuICBhcHAuZ2V0KFwiL2FwaS9zZWFyY2hcIiwgYXN5bmMgKHJlcSwgcmVzKSA9PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gcmVxLnF1ZXJ5LnEgYXMgc3RyaW5nO1xuXG4gICAgICBpZiAoIXF1ZXJ5KSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7XG4gICAgICAgICAgbWVzc2FnZTogXCJRdWVyeSBwYXJhbWV0ZXIgJ3EnIGlzIHJlcXVpcmVkXCIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBDcmVhdGUgYSBuZXcgY2hhdCBzZXNzaW9uIHdpdGggc2VhcmNoIGNhcGFiaWxpdHlcbiAgICAgIGNvbnN0IGNoYXQgPSBtb2RlbC5zdGFydENoYXQoe1xuICAgICAgICB0b29sczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIC8vIEB0cy1pZ25vcmUgLSBnb29nbGVfc2VhcmNoIGlzIGEgdmFsaWQgdG9vbCBidXQgbm90IHR5cGVkIGluIHRoZSBTREsgeWV0XG4gICAgICAgICAgICBnb29nbGVfc2VhcmNoOiB7fSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEdlbmVyYXRlIGNvbnRlbnQgd2l0aCBzZWFyY2ggdG9vbFxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY2hhdC5zZW5kTWVzc2FnZShxdWVyeSk7XG4gICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlc3VsdC5yZXNwb25zZTtcbiAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICBcIlJhdyBHb29nbGUgQVBJIFJlc3BvbnNlOlwiLFxuICAgICAgICBKU09OLnN0cmluZ2lmeShcbiAgICAgICAgICB7XG4gICAgICAgICAgICB0ZXh0OiByZXNwb25zZS50ZXh0KCksXG4gICAgICAgICAgICBjYW5kaWRhdGVzOiByZXNwb25zZS5jYW5kaWRhdGVzLFxuICAgICAgICAgICAgZ3JvdW5kaW5nTWV0YWRhdGE6IHJlc3BvbnNlLmNhbmRpZGF0ZXM/LlswXT8uZ3JvdW5kaW5nTWV0YWRhdGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBudWxsLFxuICAgICAgICAgIDJcbiAgICAgICAgKVxuICAgICAgKTtcbiAgICAgIGNvbnN0IHRleHQgPSByZXNwb25zZS50ZXh0KCk7XG5cbiAgICAgIC8vIEZvcm1hdCB0aGUgcmVzcG9uc2UgdGV4dCB0byBwcm9wZXIgbWFya2Rvd24vSFRNTFxuICAgICAgY29uc3QgZm9ybWF0dGVkVGV4dCA9IGF3YWl0IGZvcm1hdFJlc3BvbnNlVG9NYXJrZG93bih0ZXh0KTtcblxuICAgICAgLy8gRXh0cmFjdCBzb3VyY2VzIGZyb20gZ3JvdW5kaW5nIG1ldGFkYXRhXG4gICAgICBjb25zdCBzb3VyY2VNYXAgPSBuZXcgTWFwPFxuICAgICAgICBzdHJpbmcsXG4gICAgICAgIHsgdGl0bGU6IHN0cmluZzsgdXJsOiBzdHJpbmc7IHNuaXBwZXQ6IHN0cmluZyB9XG4gICAgICA+KCk7XG5cbiAgICAgIC8vIEdldCBncm91bmRpbmcgbWV0YWRhdGEgZnJvbSByZXNwb25zZVxuICAgICAgY29uc3QgbWV0YWRhdGEgPSByZXNwb25zZS5jYW5kaWRhdGVzPy5bMF0/Lmdyb3VuZGluZ01ldGFkYXRhIGFzIGFueTtcbiAgICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgICBjb25zdCBjaHVua3MgPSBtZXRhZGF0YS5ncm91bmRpbmdDaHVua3MgfHwgW107XG4gICAgICAgIGNvbnN0IHN1cHBvcnRzID0gbWV0YWRhdGEuZ3JvdW5kaW5nU3VwcG9ydHMgfHwgW107XG5cbiAgICAgICAgY2h1bmtzLmZvckVhY2goKGNodW5rOiBhbnksIGluZGV4OiBudW1iZXIpID0+IHtcbiAgICAgICAgICBpZiAoY2h1bmsud2ViPy51cmkgJiYgY2h1bmsud2ViPy50aXRsZSkge1xuICAgICAgICAgICAgY29uc3QgdXJsID0gY2h1bmsud2ViLnVyaTtcbiAgICAgICAgICAgIGlmICghc291cmNlTWFwLmhhcyh1cmwpKSB7XG4gICAgICAgICAgICAgIC8vIEZpbmQgc25pcHBldHMgdGhhdCByZWZlcmVuY2UgdGhpcyBjaHVua1xuICAgICAgICAgICAgICBjb25zdCBzbmlwcGV0cyA9IHN1cHBvcnRzXG4gICAgICAgICAgICAgICAgLmZpbHRlcigoc3VwcG9ydDogYW55KSA9PlxuICAgICAgICAgICAgICAgICAgc3VwcG9ydC5ncm91bmRpbmdDaHVua0luZGljZXMuaW5jbHVkZXMoaW5kZXgpXG4gICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgICAgIC5tYXAoKHN1cHBvcnQ6IGFueSkgPT4gc3VwcG9ydC5zZWdtZW50LnRleHQpXG4gICAgICAgICAgICAgICAgLmpvaW4oXCIgXCIpO1xuXG4gICAgICAgICAgICAgIHNvdXJjZU1hcC5zZXQodXJsLCB7XG4gICAgICAgICAgICAgICAgdGl0bGU6IGNodW5rLndlYi50aXRsZSxcbiAgICAgICAgICAgICAgICB1cmw6IHVybCxcbiAgICAgICAgICAgICAgICBzbmlwcGV0OiBzbmlwcGV0cyB8fCBcIlwiLFxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBzb3VyY2VzID0gQXJyYXkuZnJvbShzb3VyY2VNYXAudmFsdWVzKCkpO1xuXG4gICAgICAvLyBHZW5lcmF0ZSBhIHNlc3Npb24gSUQgYW5kIHN0b3JlIHRoZSBjaGF0XG4gICAgICBjb25zdCBzZXNzaW9uSWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHJpbmcoNyk7XG4gICAgICBjaGF0U2Vzc2lvbnMuc2V0KHNlc3Npb25JZCwgY2hhdCk7XG5cbiAgICAgIHJlcy5qc29uKHtcbiAgICAgICAgc2Vzc2lvbklkLFxuICAgICAgICBzdW1tYXJ5OiBmb3JtYXR0ZWRUZXh0LFxuICAgICAgICBzb3VyY2VzLFxuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgY29uc29sZS5lcnJvcihcIlNlYXJjaCBlcnJvcjpcIiwgZXJyb3IpO1xuICAgICAgcmVzLnN0YXR1cyg1MDApLmpzb24oe1xuICAgICAgICBtZXNzYWdlOlxuICAgICAgICAgIGVycm9yLm1lc3NhZ2UgfHwgXCJBbiBlcnJvciBvY2N1cnJlZCB3aGlsZSBwcm9jZXNzaW5nIHlvdXIgc2VhcmNoXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIEZvbGxvdy11cCBlbmRwb2ludCAtIGNvbnRpbnVlcyBleGlzdGluZyBjaGF0IHNlc3Npb25cbiAgYXBwLnBvc3QoXCIvYXBpL2ZvbGxvdy11cFwiLCBhc3luYyAocmVxLCByZXMpID0+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBzZXNzaW9uSWQsIHF1ZXJ5IH0gPSByZXEuYm9keTtcblxuICAgICAgaWYgKCFzZXNzaW9uSWQgfHwgIXF1ZXJ5KSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwMCkuanNvbih7XG4gICAgICAgICAgbWVzc2FnZTogXCJCb3RoIHNlc3Npb25JZCBhbmQgcXVlcnkgYXJlIHJlcXVpcmVkXCIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjaGF0ID0gY2hhdFNlc3Npb25zLmdldChzZXNzaW9uSWQpO1xuICAgICAgaWYgKCFjaGF0KSB7XG4gICAgICAgIHJldHVybiByZXMuc3RhdHVzKDQwNCkuanNvbih7XG4gICAgICAgICAgbWVzc2FnZTogXCJDaGF0IHNlc3Npb24gbm90IGZvdW5kXCIsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICAvLyBTZW5kIGZvbGxvdy11cCBtZXNzYWdlIGluIGV4aXN0aW5nIGNoYXRcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNoYXQuc2VuZE1lc3NhZ2UocXVlcnkpO1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXN1bHQucmVzcG9uc2U7XG4gICAgICBjb25zb2xlLmxvZyhcbiAgICAgICAgXCJSYXcgR29vZ2xlIEFQSSBGb2xsb3ctdXAgUmVzcG9uc2U6XCIsXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHRleHQ6IHJlc3BvbnNlLnRleHQoKSxcbiAgICAgICAgICAgIGNhbmRpZGF0ZXM6IHJlc3BvbnNlLmNhbmRpZGF0ZXMsXG4gICAgICAgICAgICBncm91bmRpbmdNZXRhZGF0YTogcmVzcG9uc2UuY2FuZGlkYXRlcz8uWzBdPy5ncm91bmRpbmdNZXRhZGF0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIG51bGwsXG4gICAgICAgICAgMlxuICAgICAgICApXG4gICAgICApO1xuICAgICAgY29uc3QgdGV4dCA9IHJlc3BvbnNlLnRleHQoKTtcblxuICAgICAgLy8gRm9ybWF0IHRoZSByZXNwb25zZSB0ZXh0IHRvIHByb3BlciBtYXJrZG93bi9IVE1MXG4gICAgICBjb25zdCBmb3JtYXR0ZWRUZXh0ID0gYXdhaXQgZm9ybWF0UmVzcG9uc2VUb01hcmtkb3duKHRleHQpO1xuXG4gICAgICAvLyBFeHRyYWN0IHNvdXJjZXMgZnJvbSBncm91bmRpbmcgbWV0YWRhdGFcbiAgICAgIGNvbnN0IHNvdXJjZU1hcCA9IG5ldyBNYXA8XG4gICAgICAgIHN0cmluZyxcbiAgICAgICAgeyB0aXRsZTogc3RyaW5nOyB1cmw6IHN0cmluZzsgc25pcHBldDogc3RyaW5nIH1cbiAgICAgID4oKTtcblxuICAgICAgLy8gR2V0IGdyb3VuZGluZyBtZXRhZGF0YSBmcm9tIHJlc3BvbnNlXG4gICAgICBjb25zdCBtZXRhZGF0YSA9IHJlc3BvbnNlLmNhbmRpZGF0ZXM/LlswXT8uZ3JvdW5kaW5nTWV0YWRhdGEgYXMgYW55O1xuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIGNvbnN0IGNodW5rcyA9IG1ldGFkYXRhLmdyb3VuZGluZ0NodW5rcyB8fCBbXTtcbiAgICAgICAgY29uc3Qgc3VwcG9ydHMgPSBtZXRhZGF0YS5ncm91bmRpbmdTdXBwb3J0cyB8fCBbXTtcblxuICAgICAgICBjaHVua3MuZm9yRWFjaCgoY2h1bms6IGFueSwgaW5kZXg6IG51bWJlcikgPT4ge1xuICAgICAgICAgIGlmIChjaHVuay53ZWI/LnVyaSAmJiBjaHVuay53ZWI/LnRpdGxlKSB7XG4gICAgICAgICAgICBjb25zdCB1cmwgPSBjaHVuay53ZWIudXJpO1xuICAgICAgICAgICAgaWYgKCFzb3VyY2VNYXAuaGFzKHVybCkpIHtcbiAgICAgICAgICAgICAgLy8gRmluZCBzbmlwcGV0cyB0aGF0IHJlZmVyZW5jZSB0aGlzIGNodW5rXG4gICAgICAgICAgICAgIGNvbnN0IHNuaXBwZXRzID0gc3VwcG9ydHNcbiAgICAgICAgICAgICAgICAuZmlsdGVyKChzdXBwb3J0OiBhbnkpID0+XG4gICAgICAgICAgICAgICAgICBzdXBwb3J0Lmdyb3VuZGluZ0NodW5rSW5kaWNlcy5pbmNsdWRlcyhpbmRleClcbiAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICAgICAgLm1hcCgoc3VwcG9ydDogYW55KSA9PiBzdXBwb3J0LnNlZ21lbnQudGV4dClcbiAgICAgICAgICAgICAgICAuam9pbihcIiBcIik7XG5cbiAgICAgICAgICAgICAgc291cmNlTWFwLnNldCh1cmwsIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogY2h1bmsud2ViLnRpdGxlLFxuICAgICAgICAgICAgICAgIHVybDogdXJsLFxuICAgICAgICAgICAgICAgIHNuaXBwZXQ6IHNuaXBwZXRzIHx8IFwiXCIsXG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHNvdXJjZXMgPSBBcnJheS5mcm9tKHNvdXJjZU1hcC52YWx1ZXMoKSk7XG5cbiAgICAgIHJlcy5qc29uKHtcbiAgICAgICAgc3VtbWFyeTogZm9ybWF0dGVkVGV4dCxcbiAgICAgICAgc291cmNlcyxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoXCJGb2xsb3ctdXAgZXJyb3I6XCIsIGVycm9yKTtcbiAgICAgIHJlcy5zdGF0dXMoNTAwKS5qc29uKHtcbiAgICAgICAgbWVzc2FnZTpcbiAgICAgICAgICBlcnJvci5tZXNzYWdlIHx8XG4gICAgICAgICAgXCJBbiBlcnJvciBvY2N1cnJlZCB3aGlsZSBwcm9jZXNzaW5nIHlvdXIgZm9sbG93LXVwIHF1ZXN0aW9uXCIsXG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG4gIGNvbnN0IGh0dHBTZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoYXBwKTtcbiAgcmV0dXJuIGh0dHBTZXJ2ZXI7XG59XG4iLCAiaW1wb3J0IGV4cHJlc3MsIHsgdHlwZSBFeHByZXNzIH0gZnJvbSBcImV4cHJlc3NcIjtcbmltcG9ydCBmcyBmcm9tIFwiZnNcIjtcbmltcG9ydCBwYXRoLCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciBhcyBjcmVhdGVWaXRlU2VydmVyLCBjcmVhdGVMb2dnZXIgfSBmcm9tIFwidml0ZVwiO1xuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IGRpcm5hbWUoX19maWxlbmFtZSk7XG5pbXBvcnQgeyB0eXBlIFNlcnZlciB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgdml0ZUNvbmZpZyBmcm9tIFwiLi4vdml0ZS5jb25maWdcIjtcblxuY29uc3Qgdml0ZUxvZ2dlciA9IGNyZWF0ZUxvZ2dlcigpO1xuXG5leHBvcnQgZnVuY3Rpb24gbG9nKG1lc3NhZ2U6IHN0cmluZywgc291cmNlID0gXCJleHByZXNzXCIpIHtcbiAgY29uc3QgZm9ybWF0dGVkVGltZSA9IG5ldyBEYXRlKCkudG9Mb2NhbGVUaW1lU3RyaW5nKFwiZW4tVVNcIiwge1xuICAgIGhvdXI6IFwibnVtZXJpY1wiLFxuICAgIG1pbnV0ZTogXCIyLWRpZ2l0XCIsXG4gICAgc2Vjb25kOiBcIjItZGlnaXRcIixcbiAgICBob3VyMTI6IHRydWUsXG4gIH0pO1xuXG4gIGNvbnNvbGUubG9nKGAke2Zvcm1hdHRlZFRpbWV9IFske3NvdXJjZX1dICR7bWVzc2FnZX1gKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNldHVwVml0ZShhcHA6IEV4cHJlc3MsIHNlcnZlcjogU2VydmVyKSB7XG4gIGNvbnN0IHZpdGUgPSBhd2FpdCBjcmVhdGVWaXRlU2VydmVyKHtcbiAgICAuLi52aXRlQ29uZmlnLFxuICAgIGNvbmZpZ0ZpbGU6IGZhbHNlLFxuICAgIGN1c3RvbUxvZ2dlcjoge1xuICAgICAgLi4udml0ZUxvZ2dlcixcbiAgICAgIGVycm9yOiAobXNnLCBvcHRpb25zKSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICBtc2cuaW5jbHVkZXMoXCJbVHlwZVNjcmlwdF0gRm91bmQgMCBlcnJvcnMuIFdhdGNoaW5nIGZvciBmaWxlIGNoYW5nZXNcIilcbiAgICAgICAgKSB7XG4gICAgICAgICAgbG9nKFwibm8gZXJyb3JzIGZvdW5kXCIsIFwidHNjXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChtc2cuaW5jbHVkZXMoXCJbVHlwZVNjcmlwdF0gXCIpKSB7XG4gICAgICAgICAgY29uc3QgW2Vycm9ycywgc3VtbWFyeV0gPSBtc2cuc3BsaXQoXCJbVHlwZVNjcmlwdF0gXCIsIDIpO1xuICAgICAgICAgIGxvZyhgJHtzdW1tYXJ5fSAke2Vycm9yc31cXHgxQlswbWAsIFwidHNjXCIpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2aXRlTG9nZ2VyLmVycm9yKG1zZywgb3B0aW9ucyk7XG4gICAgICAgICAgcHJvY2Vzcy5leGl0KDEpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH0sXG4gICAgc2VydmVyOiB7XG4gICAgICBtaWRkbGV3YXJlTW9kZTogdHJ1ZSxcbiAgICAgIGhtcjogeyBzZXJ2ZXIgfSxcbiAgICB9LFxuICAgIGFwcFR5cGU6IFwiY3VzdG9tXCIsXG4gIH0pO1xuXG4gIC8vIDEuIOWFiOWkhOeQhiBBUEkg6Lev55SxXG4gIGFwcC51c2UoXCIvYXBpLypcIiwgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgaWYgKCFyZXMuaGVhZGVyc1NlbnQpIHtcbiAgICAgIG5leHQoKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIDIuIFZpdGUg5byA5Y+R5pyN5Yqh5Zmo5Lit6Ze05Lu2XG4gIGFwcC51c2Uodml0ZS5taWRkbGV3YXJlcyk7XG5cbiAgLy8gMy4gSFRNTCDlm57pgIDot6/nlLFcbiAgYXBwLnVzZShcIipcIiwgYXN5bmMgKHJlcSwgcmVzLCBuZXh0KSA9PiB7XG4gICAgY29uc3QgdXJsID0gcmVxLm9yaWdpbmFsVXJsO1xuXG4gICAgdHJ5IHtcbiAgICAgIC8vIOWmguaenOaYryBBUEkg6K+35rGC77yM6Lez6L+HXG4gICAgICBpZiAodXJsLnN0YXJ0c1dpdGgoXCIvYXBpXCIpKSB7XG4gICAgICAgIHJldHVybiBuZXh0KCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHRlbXBsYXRlID0gYXdhaXQgZnMucHJvbWlzZXMucmVhZEZpbGUoXG4gICAgICAgIHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi5cIiwgXCJjbGllbnRcIiwgXCJpbmRleC5odG1sXCIpLFxuICAgICAgICBcInV0Zi04XCJcbiAgICAgICk7XG5cbiAgICAgIGNvbnN0IGh0bWwgPSBhd2FpdCB2aXRlLnRyYW5zZm9ybUluZGV4SHRtbCh1cmwsIHRlbXBsYXRlKTtcblxuICAgICAgcmVzLnN0YXR1cygyMDApLnNldCh7IFwiQ29udGVudC1UeXBlXCI6IFwidGV4dC9odG1sXCIgfSkuZW5kKGh0bWwpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHZpdGUuc3NyRml4U3RhY2t0cmFjZShlIGFzIEVycm9yKTtcbiAgICAgIG5leHQoZSk7XG4gICAgfVxuICB9KTtcbn1cblxuZXhwb3J0IHt9O1xuIiwgImltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0XCI7XG5pbXBvcnQgdGhlbWVQbHVnaW4gZnJvbSBcIkByZXBsaXQvdml0ZS1wbHVnaW4tc2hhZGNuLXRoZW1lLWpzb25cIjtcbmltcG9ydCBwYXRoLCB7IGRpcm5hbWUgfSBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHJ1bnRpbWVFcnJvck92ZXJsYXkgZnJvbSBcIkByZXBsaXQvdml0ZS1wbHVnaW4tcnVudGltZS1lcnJvci1tb2RhbFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJ1cmxcIjtcblxuY29uc3QgX19maWxlbmFtZSA9IGZpbGVVUkxUb1BhdGgoaW1wb3J0Lm1ldGEudXJsKTtcbmNvbnN0IF9fZGlybmFtZSA9IGRpcm5hbWUoX19maWxlbmFtZSk7XG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKSwgcnVudGltZUVycm9yT3ZlcmxheSgpLCB0aGVtZVBsdWdpbigpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBkYlwiOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcImRiXCIpLFxuICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiY2xpZW50XCIsIFwic3JjXCIpLFxuICAgIH0sXG4gIH0sXG4gIHJvb3Q6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiY2xpZW50XCIpLFxuICBidWlsZDoge1xuICAgIG91dERpcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCJkaXN0L3B1YmxpY1wiKSxcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7OztBQUFBLE9BQU8sWUFBWTtBQUNuQixPQUFPLFVBQVU7QUFDakIsU0FBUyxxQkFBcUI7QUFFOUIsSUFBTSxhQUFhLGNBQWMsWUFBWSxHQUFHO0FBQ2hELElBQU0sWUFBWSxLQUFLLFFBQVEsVUFBVTtBQUN6QyxJQUFNLFVBQVUsS0FBSyxRQUFRLFdBQVcsU0FBUztBQUUxQyxTQUFTLG1CQUFtQjtBQUNqQyxRQUFNLFNBQVMsT0FBTyxPQUFPLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFDOUMsTUFBSSxPQUFPLE9BQU87QUFDaEIsVUFBTSxJQUFJO0FBQUEsTUFDUixpQ0FBaUMsT0FBTyxLQUFLLE9BQU8sTUFBTSxPQUFPO0FBQUEsSUFDbkU7QUFBQSxFQUNGO0FBRUEsTUFBSSxDQUFDLFFBQVEsSUFBSSxnQkFBZ0I7QUFDL0IsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUFBLElBQ0wsZ0JBQWdCLFFBQVEsSUFBSTtBQUFBLElBQzVCLFVBQVUsUUFBUSxJQUFJLFlBQVk7QUFBQSxFQUNwQztBQUNGO0FBbEJnQjs7O0FDUGhCLE9BQU9BLFdBQVU7QUFDakIsU0FBUyxpQkFBQUMsc0JBQXFCO0FBQzlCLE9BQU8sYUFBdUQ7OztBQ0Y5RCxTQUFTLG9CQUFpQztBQUMxQztBQUFBLEVBQ0U7QUFBQSxPQUdLO0FBQ1AsU0FBUyxjQUFjO0FBR3ZCLElBQU0sTUFBTSxpQkFBaUI7QUFDN0IsSUFBTSxRQUFRLElBQUksbUJBQW1CLElBQUksY0FBYztBQUN2RCxJQUFNLFFBQVEsTUFBTSxtQkFBbUI7QUFBQSxFQUNyQyxPQUFPO0FBQUEsRUFDUCxrQkFBa0I7QUFBQSxJQUNoQixhQUFhO0FBQUEsSUFDYixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixpQkFBaUI7QUFBQSxFQUNuQjtBQUNGLENBQUM7QUFHRCxJQUFNLGVBQWUsb0JBQUksSUFBeUI7QUFHbEQsZUFBZSx5QkFDYixNQUNpQjtBQUVqQixRQUFNLGVBQWUsTUFBTSxRQUFRLFFBQVEsSUFBSTtBQUcvQyxNQUFJLGdCQUFnQixhQUFhLFFBQVEsU0FBUyxJQUFJO0FBR3RELGtCQUFnQixjQUFjO0FBQUEsSUFDNUI7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUdBLGtCQUFnQixjQUFjO0FBQUEsSUFDNUI7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUdBLGtCQUFnQixjQUFjLFFBQVEsZUFBZSxJQUFJO0FBR3pELFFBQU0sYUFBYSxjQUFjLE1BQU0sTUFBTSxFQUFFLE9BQU8sT0FBTztBQUc3RCxRQUFNLFlBQVksV0FDZixJQUFJLENBQUMsTUFBTTtBQUVWLFFBQUksRUFBRSxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsR0FBRyxLQUFLLEVBQUUsV0FBVyxHQUFHLEdBQUc7QUFDL0QsYUFBTztBQUFBLElBQ1Q7QUFFQSxXQUFPLEdBQUcsQ0FBQztBQUFBO0FBQUEsRUFDYixDQUFDLEVBQ0EsS0FBSyxNQUFNO0FBR2QsU0FBTyxXQUFXO0FBQUEsSUFDaEIsS0FBSztBQUFBLElBQ0wsUUFBUTtBQUFBLEVBQ1YsQ0FBQztBQUdELFNBQU8sT0FBTyxNQUFNLFNBQVM7QUFDL0I7QUEvQ2U7QUE2RVIsU0FBUyxlQUFlQyxNQUFzQjtBQUVuRCxFQUFBQSxLQUFJLElBQUksZUFBZSxPQUFPLEtBQUssUUFBUTtBQUN6QyxRQUFJO0FBQ0YsWUFBTSxRQUFRLElBQUksTUFBTTtBQUV4QixVQUFJLENBQUMsT0FBTztBQUNWLGVBQU8sSUFBSSxPQUFPLEdBQUcsRUFBRSxLQUFLO0FBQUEsVUFDMUIsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFHQSxZQUFNLE9BQU8sTUFBTSxVQUFVO0FBQUEsUUFDM0IsT0FBTztBQUFBLFVBQ0w7QUFBQTtBQUFBLFlBRUUsZUFBZSxDQUFDO0FBQUEsVUFDbEI7QUFBQSxRQUNGO0FBQUEsTUFDRixDQUFDO0FBR0QsWUFBTSxTQUFTLE1BQU0sS0FBSyxZQUFZLEtBQUs7QUFDM0MsWUFBTSxXQUFXLE1BQU0sT0FBTztBQUM5QixjQUFRO0FBQUEsUUFDTjtBQUFBLFFBQ0EsS0FBSztBQUFBLFVBQ0g7QUFBQSxZQUNFLE1BQU0sU0FBUyxLQUFLO0FBQUEsWUFDcEIsWUFBWSxTQUFTO0FBQUEsWUFDckIsbUJBQW1CLFNBQVMsYUFBYSxDQUFDLEdBQUc7QUFBQSxVQUMvQztBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sU0FBUyxLQUFLO0FBRzNCLFlBQU0sZ0JBQWdCLE1BQU0seUJBQXlCLElBQUk7QUFHekQsWUFBTSxZQUFZLG9CQUFJLElBR3BCO0FBR0YsWUFBTSxXQUFXLFNBQVMsYUFBYSxDQUFDLEdBQUc7QUFDM0MsVUFBSSxVQUFVO0FBQ1osY0FBTSxTQUFTLFNBQVMsbUJBQW1CLENBQUM7QUFDNUMsY0FBTSxXQUFXLFNBQVMscUJBQXFCLENBQUM7QUFFaEQsZUFBTyxRQUFRLENBQUMsT0FBWSxVQUFrQjtBQUM1QyxjQUFJLE1BQU0sS0FBSyxPQUFPLE1BQU0sS0FBSyxPQUFPO0FBQ3RDLGtCQUFNLE1BQU0sTUFBTSxJQUFJO0FBQ3RCLGdCQUFJLENBQUMsVUFBVSxJQUFJLEdBQUcsR0FBRztBQUV2QixvQkFBTSxXQUFXLFNBQ2Q7QUFBQSxnQkFBTyxDQUFDLFlBQ1AsUUFBUSxzQkFBc0IsU0FBUyxLQUFLO0FBQUEsY0FDOUMsRUFDQyxJQUFJLENBQUMsWUFBaUIsUUFBUSxRQUFRLElBQUksRUFDMUMsS0FBSyxHQUFHO0FBRVgsd0JBQVUsSUFBSSxLQUFLO0FBQUEsZ0JBQ2pCLE9BQU8sTUFBTSxJQUFJO0FBQUEsZ0JBQ2pCO0FBQUEsZ0JBQ0EsU0FBUyxZQUFZO0FBQUEsY0FDdkIsQ0FBQztBQUFBLFlBQ0g7QUFBQSxVQUNGO0FBQUEsUUFDRixDQUFDO0FBQUEsTUFDSDtBQUVBLFlBQU0sVUFBVSxNQUFNLEtBQUssVUFBVSxPQUFPLENBQUM7QUFHN0MsWUFBTSxZQUFZLEtBQUssT0FBTyxFQUFFLFNBQVMsRUFBRSxFQUFFLFVBQVUsQ0FBQztBQUN4RCxtQkFBYSxJQUFJLFdBQVcsSUFBSTtBQUVoQyxVQUFJLEtBQUs7QUFBQSxRQUNQO0FBQUEsUUFDQSxTQUFTO0FBQUEsUUFDVDtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0gsU0FBUyxPQUFZO0FBQ25CLGNBQVEsTUFBTSxpQkFBaUIsS0FBSztBQUNwQyxVQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUs7QUFBQSxRQUNuQixTQUNFLE1BQU0sV0FBVztBQUFBLE1BQ3JCLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRixDQUFDO0FBR0QsRUFBQUEsS0FBSSxLQUFLLGtCQUFrQixPQUFPLEtBQUssUUFBUTtBQUM3QyxRQUFJO0FBQ0YsWUFBTSxFQUFFLFdBQVcsTUFBTSxJQUFJLElBQUk7QUFFakMsVUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPO0FBQ3hCLGVBQU8sSUFBSSxPQUFPLEdBQUcsRUFBRSxLQUFLO0FBQUEsVUFDMUIsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFFQSxZQUFNLE9BQU8sYUFBYSxJQUFJLFNBQVM7QUFDdkMsVUFBSSxDQUFDLE1BQU07QUFDVCxlQUFPLElBQUksT0FBTyxHQUFHLEVBQUUsS0FBSztBQUFBLFVBQzFCLFNBQVM7QUFBQSxRQUNYLENBQUM7QUFBQSxNQUNIO0FBR0EsWUFBTSxTQUFTLE1BQU0sS0FBSyxZQUFZLEtBQUs7QUFDM0MsWUFBTSxXQUFXLE1BQU0sT0FBTztBQUM5QixjQUFRO0FBQUEsUUFDTjtBQUFBLFFBQ0EsS0FBSztBQUFBLFVBQ0g7QUFBQSxZQUNFLE1BQU0sU0FBUyxLQUFLO0FBQUEsWUFDcEIsWUFBWSxTQUFTO0FBQUEsWUFDckIsbUJBQW1CLFNBQVMsYUFBYSxDQUFDLEdBQUc7QUFBQSxVQUMvQztBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sU0FBUyxLQUFLO0FBRzNCLFlBQU0sZ0JBQWdCLE1BQU0seUJBQXlCLElBQUk7QUFHekQsWUFBTSxZQUFZLG9CQUFJLElBR3BCO0FBR0YsWUFBTSxXQUFXLFNBQVMsYUFBYSxDQUFDLEdBQUc7QUFDM0MsVUFBSSxVQUFVO0FBQ1osY0FBTSxTQUFTLFNBQVMsbUJBQW1CLENBQUM7QUFDNUMsY0FBTSxXQUFXLFNBQVMscUJBQXFCLENBQUM7QUFFaEQsZUFBTyxRQUFRLENBQUMsT0FBWSxVQUFrQjtBQUM1QyxjQUFJLE1BQU0sS0FBSyxPQUFPLE1BQU0sS0FBSyxPQUFPO0FBQ3RDLGtCQUFNLE1BQU0sTUFBTSxJQUFJO0FBQ3RCLGdCQUFJLENBQUMsVUFBVSxJQUFJLEdBQUcsR0FBRztBQUV2QixvQkFBTSxXQUFXLFNBQ2Q7QUFBQSxnQkFBTyxDQUFDLFlBQ1AsUUFBUSxzQkFBc0IsU0FBUyxLQUFLO0FBQUEsY0FDOUMsRUFDQyxJQUFJLENBQUMsWUFBaUIsUUFBUSxRQUFRLElBQUksRUFDMUMsS0FBSyxHQUFHO0FBRVgsd0JBQVUsSUFBSSxLQUFLO0FBQUEsZ0JBQ2pCLE9BQU8sTUFBTSxJQUFJO0FBQUEsZ0JBQ2pCO0FBQUEsZ0JBQ0EsU0FBUyxZQUFZO0FBQUEsY0FDdkIsQ0FBQztBQUFBLFlBQ0g7QUFBQSxVQUNGO0FBQUEsUUFDRixDQUFDO0FBQUEsTUFDSDtBQUVBLFlBQU0sVUFBVSxNQUFNLEtBQUssVUFBVSxPQUFPLENBQUM7QUFFN0MsVUFBSSxLQUFLO0FBQUEsUUFDUCxTQUFTO0FBQUEsUUFDVDtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0gsU0FBUyxPQUFZO0FBQ25CLGNBQVEsTUFBTSxvQkFBb0IsS0FBSztBQUN2QyxVQUFJLE9BQU8sR0FBRyxFQUFFLEtBQUs7QUFBQSxRQUNuQixTQUNFLE1BQU0sV0FDTjtBQUFBLE1BQ0osQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGLENBQUM7QUFFRCxRQUFNLGFBQWEsYUFBYUEsSUFBRztBQUNuQyxTQUFPO0FBQ1Q7QUExTGdCOzs7QUN0R2hCLE9BQU8sUUFBUTtBQUNmLE9BQU9DLFNBQVEsV0FBQUMsZ0JBQWU7QUFDOUIsU0FBUyxpQkFBQUMsc0JBQXFCO0FBQzlCLFNBQVMsZ0JBQWdCLGtCQUFrQixvQkFBb0I7OztBQ0ovRCxTQUFTLG9CQUFvQjtBQUM3QixPQUFPLFdBQVc7QUFDbEIsT0FBTyxpQkFBaUI7QUFDeEIsT0FBT0MsU0FBUSxlQUFlO0FBQzlCLE9BQU8seUJBQXlCO0FBQ2hDLFNBQVMsaUJBQUFDLHNCQUFxQjtBQUU5QixJQUFNQyxjQUFhRCxlQUFjLFlBQVksR0FBRztBQUNoRCxJQUFNRSxhQUFZLFFBQVFELFdBQVU7QUFDcEMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sR0FBRyxvQkFBb0IsR0FBRyxZQUFZLENBQUM7QUFBQSxFQUN2RCxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxPQUFPRixNQUFLLFFBQVFHLFlBQVcsSUFBSTtBQUFBLE1BQ25DLEtBQUtILE1BQUssUUFBUUcsWUFBVyxVQUFVLEtBQUs7QUFBQSxJQUM5QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU1ILE1BQUssUUFBUUcsWUFBVyxRQUFRO0FBQUEsRUFDdEMsT0FBTztBQUFBLElBQ0wsUUFBUUgsTUFBSyxRQUFRRyxZQUFXLGFBQWE7QUFBQSxJQUM3QyxhQUFhO0FBQUEsRUFDZjtBQUNGLENBQUM7OztBRGpCRCxJQUFNQyxjQUFhQyxlQUFjLFlBQVksR0FBRztBQUNoRCxJQUFNQyxhQUFZQyxTQUFRSCxXQUFVO0FBSXBDLElBQU0sYUFBYSxhQUFhO0FBRXpCLFNBQVMsSUFBSSxTQUFpQixTQUFTLFdBQVc7QUFDdkQsUUFBTSxpQkFBZ0Isb0JBQUksS0FBSyxHQUFFLG1CQUFtQixTQUFTO0FBQUEsSUFDM0QsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLElBQ1IsUUFBUTtBQUFBLElBQ1IsUUFBUTtBQUFBLEVBQ1YsQ0FBQztBQUVELFVBQVEsSUFBSSxHQUFHLGFBQWEsS0FBSyxNQUFNLEtBQUssT0FBTyxFQUFFO0FBQ3ZEO0FBVGdCO0FBV2hCLGVBQXNCLFVBQVVJLE1BQWMsUUFBZ0I7QUFDNUQsUUFBTSxPQUFPLE1BQU0saUJBQWlCO0FBQUEsSUFDbEMsR0FBRztBQUFBLElBQ0gsWUFBWTtBQUFBLElBQ1osY0FBYztBQUFBLE1BQ1osR0FBRztBQUFBLE1BQ0gsT0FBTyx3QkFBQyxLQUFLLFlBQVk7QUFDdkIsWUFDRSxJQUFJLFNBQVMsd0RBQXdELEdBQ3JFO0FBQ0EsY0FBSSxtQkFBbUIsS0FBSztBQUM1QjtBQUFBLFFBQ0Y7QUFFQSxZQUFJLElBQUksU0FBUyxlQUFlLEdBQUc7QUFDakMsZ0JBQU0sQ0FBQyxRQUFRLE9BQU8sSUFBSSxJQUFJLE1BQU0saUJBQWlCLENBQUM7QUFDdEQsY0FBSSxHQUFHLE9BQU8sSUFBSSxNQUFNLFdBQVcsS0FBSztBQUN4QztBQUFBLFFBQ0YsT0FBTztBQUNMLHFCQUFXLE1BQU0sS0FBSyxPQUFPO0FBQzdCLGtCQUFRLEtBQUssQ0FBQztBQUFBLFFBQ2hCO0FBQUEsTUFDRixHQWhCTztBQUFBLElBaUJUO0FBQUEsSUFDQSxRQUFRO0FBQUEsTUFDTixnQkFBZ0I7QUFBQSxNQUNoQixLQUFLLEVBQUUsT0FBTztBQUFBLElBQ2hCO0FBQUEsSUFDQSxTQUFTO0FBQUEsRUFDWCxDQUFDO0FBR0QsRUFBQUEsS0FBSSxJQUFJLFVBQVUsQ0FBQyxLQUFLLEtBQUssU0FBUztBQUNwQyxRQUFJLENBQUMsSUFBSSxhQUFhO0FBQ3BCLFdBQUs7QUFBQSxJQUNQO0FBQUEsRUFDRixDQUFDO0FBR0QsRUFBQUEsS0FBSSxJQUFJLEtBQUssV0FBVztBQUd4QixFQUFBQSxLQUFJLElBQUksS0FBSyxPQUFPLEtBQUssS0FBSyxTQUFTO0FBQ3JDLFVBQU0sTUFBTSxJQUFJO0FBRWhCLFFBQUk7QUFFRixVQUFJLElBQUksV0FBVyxNQUFNLEdBQUc7QUFDMUIsZUFBTyxLQUFLO0FBQUEsTUFDZDtBQUVBLFlBQU0sV0FBVyxNQUFNLEdBQUcsU0FBUztBQUFBLFFBQ2pDQyxNQUFLLFFBQVFILFlBQVcsTUFBTSxVQUFVLFlBQVk7QUFBQSxRQUNwRDtBQUFBLE1BQ0Y7QUFFQSxZQUFNLE9BQU8sTUFBTSxLQUFLLG1CQUFtQixLQUFLLFFBQVE7QUFFeEQsVUFBSSxPQUFPLEdBQUcsRUFBRSxJQUFJLEVBQUUsZ0JBQWdCLFlBQVksQ0FBQyxFQUFFLElBQUksSUFBSTtBQUFBLElBQy9ELFNBQVMsR0FBRztBQUNWLFdBQUssaUJBQWlCLENBQVU7QUFDaEMsV0FBSyxDQUFDO0FBQUEsSUFDUjtBQUFBLEVBQ0YsQ0FBQztBQUNIO0FBaEVzQjs7O0FGakJ0QixPQUFPSSxTQUFRO0FBR2YsSUFBTUMsT0FBTSxpQkFBaUI7QUFHN0IsSUFBTUMsY0FBYUMsZUFBYyxZQUFZLEdBQUc7QUFDaEQsSUFBTUMsYUFBWUMsTUFBSyxRQUFRSCxXQUFVO0FBR3pDLElBQU0sTUFBTSxRQUFRO0FBR3BCLElBQUksSUFBSSxRQUFRLEtBQUssQ0FBQztBQUN0QixJQUFJLElBQUksUUFBUSxXQUFXLEVBQUUsVUFBVSxNQUFNLENBQUMsQ0FBQztBQUcvQyxJQUFJLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUztBQUMxQixRQUFNLFFBQVEsS0FBSyxJQUFJO0FBQ3ZCLFFBQU1HLFFBQU8sSUFBSTtBQUNqQixNQUFJLHVCQUF3RDtBQUU1RCxRQUFNLGtCQUFrQixJQUFJO0FBQzVCLE1BQUksT0FBTyxTQUFVLGFBQWEsTUFBTTtBQUN0QywyQkFBdUI7QUFDdkIsV0FBTyxnQkFBZ0IsTUFBTSxLQUFLLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQztBQUFBLEVBQ3ZEO0FBRUEsTUFBSSxHQUFHLFVBQVUsTUFBTTtBQUNyQixVQUFNLFdBQVcsS0FBSyxJQUFJLElBQUk7QUFDOUIsUUFBSUEsTUFBSyxXQUFXLE1BQU0sR0FBRztBQUMzQixVQUFJLFVBQVUsR0FBRyxJQUFJLE1BQU0sSUFBSUEsS0FBSSxJQUFJLElBQUksVUFBVSxPQUFPLFFBQVE7QUFDcEUsVUFBSSxzQkFBc0I7QUFDeEIsbUJBQVcsT0FBTyxLQUFLLFVBQVUsb0JBQW9CLENBQUM7QUFBQSxNQUN4RDtBQUNBLFVBQUksUUFBUSxTQUFTLElBQUk7QUFDdkIsa0JBQVUsUUFBUSxNQUFNLEdBQUcsRUFBRSxJQUFJO0FBQUEsTUFDbkM7QUFDQSxVQUFJLE9BQU87QUFBQSxJQUNiO0FBQUEsRUFDRixDQUFDO0FBRUQsT0FBSztBQUNQLENBQUM7QUFBQSxDQUVBLFlBQVk7QUFDWCxNQUFJO0FBRUYsVUFBTSxTQUFTLGVBQWUsR0FBRztBQUdqQyxRQUFJLElBQUksSUFBSSxLQUFLLE1BQU0sZUFBZTtBQUVwQyxZQUFNLFVBQVUsS0FBSyxNQUFNO0FBQUEsSUFDN0IsT0FBTztBQUVMLFlBQU0sWUFBWUEsTUFBSyxRQUFRRCxZQUFXLE1BQU0sUUFBUSxRQUFRO0FBQ2hFLFlBQU0sWUFBWUMsTUFBSyxLQUFLLFdBQVcsWUFBWTtBQUduRCxVQUFJLENBQUNMLElBQUcsV0FBVyxTQUFTLEtBQUssQ0FBQ0EsSUFBRyxXQUFXLFNBQVMsR0FBRztBQUMxRCxjQUFNLElBQUksTUFBTSx1QkFBdUI7QUFBQSxNQUN6QztBQUdBLFVBQUksSUFBSSxXQUFXLFFBQVEsT0FBT0ssTUFBSyxLQUFLLFdBQVcsUUFBUSxDQUFDLENBQUM7QUFDakUsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxRQUNBLFFBQVEsT0FBT0EsTUFBSyxLQUFLLFdBQVcsYUFBYSxDQUFDO0FBQUEsTUFDcEQ7QUFHQSxVQUFJLElBQUksS0FBSyxDQUFDLEtBQUssS0FBSyxTQUFTO0FBRS9CLFlBQUksSUFBSSxLQUFLLFdBQVcsT0FBTyxHQUFHO0FBQ2hDLGlCQUFPLEtBQUs7QUFBQSxRQUNkO0FBR0EsWUFBSSxVQUFVLGdCQUFnQixXQUFXO0FBQ3pDLFFBQUFMLElBQUcsaUJBQWlCLFNBQVMsRUFBRSxLQUFLLEdBQUc7QUFBQSxNQUN6QyxDQUFDO0FBQUEsSUFDSDtBQUdBLFFBQUksSUFBSSxDQUFDLEtBQVUsTUFBZSxLQUFlLFVBQXdCO0FBQ3ZFLGNBQVEsTUFBTSxpQkFBaUIsR0FBRztBQUNsQyxZQUFNLFNBQVMsSUFBSSxVQUFVLElBQUksY0FBYztBQUMvQyxZQUFNLFVBQVUsSUFBSSxXQUFXO0FBQy9CLFVBQUksT0FBTyxNQUFNLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQztBQUFBLElBQ3JDLENBQUM7QUFHRCxVQUFNLE9BQU8sU0FBUyxRQUFRLElBQUksUUFBUSxRQUFRLEVBQUU7QUFDcEQsV0FBTyxPQUFPLE1BQU0sV0FBVyxNQUFNO0FBQ25DLFVBQUksMEJBQTBCLElBQUksT0FBTyxJQUFJLElBQUksS0FBSyxDQUFDLE9BQU87QUFBQSxJQUNoRSxDQUFDO0FBQUEsRUFDSCxTQUFTLE9BQU87QUFDZCxZQUFRLE1BQU0sZ0NBQWdDLEtBQUs7QUFDbkQsWUFBUSxLQUFLLENBQUM7QUFBQSxFQUNoQjtBQUNGLEdBQUc7IiwKICAibmFtZXMiOiBbInBhdGgiLCAiZmlsZVVSTFRvUGF0aCIsICJhcHAiLCAicGF0aCIsICJkaXJuYW1lIiwgImZpbGVVUkxUb1BhdGgiLCAicGF0aCIsICJmaWxlVVJMVG9QYXRoIiwgIl9fZmlsZW5hbWUiLCAiX19kaXJuYW1lIiwgIl9fZmlsZW5hbWUiLCAiZmlsZVVSTFRvUGF0aCIsICJfX2Rpcm5hbWUiLCAiZGlybmFtZSIsICJhcHAiLCAicGF0aCIsICJmcyIsICJlbnYiLCAiX19maWxlbmFtZSIsICJmaWxlVVJMVG9QYXRoIiwgIl9fZGlybmFtZSIsICJwYXRoIl0KfQo=
