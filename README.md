# PasteVault

安全的文本 / 文件分享工具。支持管理员登录、访问密钥、有效期、大文件上传。

## 功能

- 🔐 管理员密码登录，未登录不可创建分享
- 📝 纯文本 / 纯文件 / 文本+文件 三种分享模式
- 🔒 可选访问密钥（SHA-256 哈希，服务端不存明文）
- ⏱ 有效期：1小时 / 1天 / 7天 / 30天 / 永久
- 📦 文件上传，单文件最大 200 MB，带上传进度条
- 📁 上传文件按月份自动归档（uploads/YYYY-MM/）
- 🗂 管理页面：查看 / 删除所有分享
- ⚙️ 设置：修改密码、控制查看分享是否需要登录
- ♻️ 过期内容自动清理

## 快速启动

```bash
npm install
npm start
# 访问 http://localhost:3000
# 默认密码: admin123  ← 请登录后立即修改！
```

自定义初始密码（首次启动前设置）：

```bash
ADMIN_PASSWORD=yourpassword node server.js
```

## Docker 部署

```bash
# 构建镜像
docker build -t pastevault .

# 运行容器
docker run -d -p 3000:3000 \
  -e ADMIN_PASSWORD=yourpassword \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  --restart=always \
  --name pastevault pastevault
```

## Nginx 反向代理（推荐）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 250m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 600;
        proxy_connect_timeout 600;
        proxy_send_timeout 600;
    }
}
```

申请 HTTPS：

```bash
certbot --nginx -d your-domain.com
```

## PM2 部署（不用 Docker）

```bash
npm install --production
npm install -g pm2
ADMIN_PASSWORD=yourpassword pm2 start server.js --name pastevault
pm2 save && pm2 startup
```

## 目录结构

```
pastevault/
├── server.js              # Express 后端
├── package.json
├── Dockerfile
├── public/
│   ├── index.html         # 前端 SPA
│   └── favicon.svg        # 图标
├── data/                  # 自动创建
│   ├── shares.json        # 分享数据
│   └── config.json        # 配置（密码哈希等）
└── uploads/               # 自动创建，按月归档
    └── YYYY-MM/           # 如 2026-04/
```

## 安全说明

- 管理员密码以 SHA-256 + 盐值哈希存储，不保存明文
- 分享访问密钥同样哈希存储
- Session token 存于 HttpOnly Cookie，有效期 7 天
- 修改密码后所有已有 session 立即失效
- Docker 容器以非 root 用户运行
