import { setupEnvironment } from "./env";
import path from "path";
import { fileURLToPath } from "url";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import fs from "fs";

// Setup environment variables first
const env = setupEnvironment();
console.log("\n--- Environment Setup Debug ---");
console.log("Environment variables loaded:", env);
console.log("--- End Debug ---\n");

// Get the directory name properly with ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// 1. 基础中间件
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// 2. API 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
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
    // 3. 创建 HTTP 服务器
    const server = registerRoutes(app);

    // 4. 根据环境配置前端资源
    if (app.get("env") === "development") {
      // 开发环境：使用 Vite 开发服务器
      await setupVite(app, server);
    } else {
      // 生产环境：使用优化的静态文件服务
      const distDir = path.resolve(__dirname, "..", "dist");
      const publicDir = path.resolve(distDir, "public");

      if (!fs.existsSync(publicDir)) {
        throw new Error(`Build directory not found: ${publicDir}`);
      }

      // 4.1 先处理 API 路由
      app.use("/api/*", (req, res, next) => {
        if (!res.headersSent) {
          next();
        }
      });

      // 4.2 静态资源服务
      app.use(
        express.static(publicDir, {
          index: false,
          maxAge: "30d",
          immutable: true,
        })
      );

      // 4.3 所有非 API 路由返回 index.html
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          return next();
        }

        const indexPath = path.join(publicDir, "index.html");
        if (!fs.existsSync(indexPath)) {
          return next(new Error("index.html not found"));
        }

        res.set({
          "Cache-Control": "no-cache",
          "Content-Type": "text/html",
        });

        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error(`Error sending ${indexPath}:`, err);
            next(err);
          }
        });
      });
    }

    // 5. 错误处理中间件
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });

    // 6. 启动服务器
    const PORT = 3000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT} in ${app.get("env")} mode`);
    });
  } catch (error) {
    console.error("Server initialization error:", error);
    process.exit(1);
  }
})();
