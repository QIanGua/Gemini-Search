import { setupEnvironment } from "./env";
import path from "path";
import { fileURLToPath } from "url";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import fs from "fs";

// Setup environment variables first
const env = setupEnvironment();

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

    // 4. 配置环境
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      const publicDir = path.resolve(__dirname, "..", "dist", "public");

      // 检查构建目录
      if (!fs.existsSync(publicDir)) {
        throw new Error(`构建目录不存在: ${publicDir}`);
      }

      // 静态文件服务
      app.use(express.static(publicDir));

      // 处理客户端路由
      app.get("*", (req, res, next) => {
        if (req.url.startsWith("/api")) {
          return next();
        }
        res.sendFile(path.join(publicDir, "index.html"));
      });
    }

    // 5. 错误处理
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    // 6. 启动服务器
    const PORT = 3000;
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server initialization error:", error);
    process.exit(1);
  }
})();
