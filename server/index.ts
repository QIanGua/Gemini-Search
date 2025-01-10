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

// 创建 Express 应用
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
    // 3. 创建 HTTP 服务器并注册路由
    const server = registerRoutes(app);

    // 4. 根据环境配置前端资源
    if (app.get("env") === "development") {
      // 开发环境：使用 Vite
      await setupVite(app, server);
    } else {
      // 生产环境：手动配置静态文件服务
      const publicDir = path.resolve(__dirname, "..", "dist", "public");
      const indexPath = path.join(publicDir, "index.html");

      // 确保构建目录存在
      if (!fs.existsSync(publicDir) || !fs.existsSync(indexPath)) {
        throw new Error(`构建文件不存在，请先执行 build 命令`);
      }

      // 静态资源服务
      app.use("/assets", express.static(path.join(publicDir, "assets")));
      app.use(
        "/favicon.ico",
        express.static(path.join(publicDir, "favicon.ico"))
      );

      // 所有非 API 路由返回 index.html
      app.get("*", (req, res, next) => {
        // API 路由交给注册的 API 处理程序处理
        if (req.path.startsWith("/api/")) {
          return next();
        }

        // 其他所有路由返回 index.html
        res.setHeader("Content-Type", "text/html");
        fs.createReadStream(indexPath).pipe(res);
      });
    }

    // 5. 错误处理中间件
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      console.error("Server Error:", err);
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
    });

    // 6. 启动服务器
    const PORT = parseInt(process.env.PORT || "3000", 10);
    server.listen(PORT, "0.0.0.0", () => {
      log(`Server running on port ${PORT} in ${app.get("env")} mode`);
    });
  } catch (error) {
    console.error("Server initialization error:", error);
    process.exit(1);
  }
})();
