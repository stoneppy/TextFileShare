# PasteVault

安全的文本 / 文件分享工具。支持管理员登录、访问密钥、有效期、跨设备访问。

## 功能

- 🔐 管理员密码登录，未登录不可创建分享
- 📝 纯文本 / 纯文件 / 文本+文件 三种模式
- 🔒 可选内容访问密钥（SHA-256 哈希，服务端不存明文）
- ⏱ 有效期：1小时 / 1天 / 7天 / 30天 / 永久
- 📦 文件上传，单文件最大 10 MB
- 🗂 管理页面：查看 / 删除所有分享
- ⚙️ 设置：修改密码、控制查看分享是否需要登录
- ♻️ 过期内容自动清理

---

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

---

## 部署到服务器

### 方式一：PM2 直接运行

```bash
npm install --production
npm install -g pm2
ADMIN_PASSWORD=yourpassword pm2 start server.js --name pastevault
pm2 save && pm2 startup
```

### 方式二：Nginx 反向代理（推荐）

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}
```

申请 HTTPS：
```bash
certbot --nginx -d your-domain.com
```

### 方式三：Docker

```bash
docker build -t pastevault .
docker run -d -p 3000:3000 \
  -e ADMIN_PASSWORD=yourpassword \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/uploads:/app/uploads \
  --name pastevault pastevault
```

---

## 目录结构

```
pastevault/
├── server.js           # Express 后端
├── package.json
├── public/
│   └── index.html      # 前端 SPA
├── data/
│   ├── shares.json     # 分享数据（自动创建）
│   └── config.json     # 配置（密码哈希等，自动创建）
└── uploads/            # 上传的文件（自动创建）
```

## 安全说明

- 管理员密码以 SHA-256 + 固定盐哈希存储，不保存明文
- 分享内容密钥同样哈希存储
- Session token 存储于 HttpOnly Cookie，有效期 7 天
- 修改密码后所有已有 session 立即失效
