const express = require('express');
const multer  = require('multer');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Storage paths ─────────────────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE    = path.join(DATA_DIR, 'shares.json');
const CFG_FILE   = path.join(DATA_DIR, 'config.json');

[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({}));

// ── Password hashing ──────────────────────────────────────────────────────────
function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd + 'pastevault_salt_2024').digest('hex');
}

// ── Config ────────────────────────────────────────────────────────────────────
function readCfg() {
  try { return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function writeCfg(c) { fs.writeFileSync(CFG_FILE, JSON.stringify(c, null, 2)); }

// First-run: initialise config
let cfg = readCfg();
if (!cfg.adminHash) {
  const defaultPwd = process.env.ADMIN_PASSWORD || 'admin123';
  cfg.adminHash = hashPwd(defaultPwd);
  cfg.viewRequiresLogin = false;
  writeCfg(cfg);
  console.log('\n  ┌──────────────────────────────────────────────┐');
  console.log(`  │  初始管理员密码: ${defaultPwd.padEnd(29)}│`);
  console.log('  │  请登录后立即在设置中修改密码！              │');
  console.log('  └──────────────────────────────────────────────┘\n');
}

// ── In-memory sessions ────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL);
  return token;
}
function validSession(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

// ── Cookie helpers ────────────────────────────────────────────────────────────
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie',
    `pv_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'pv_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}
function getToken(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)pv_session=([a-f0-9]{64})/);
  return m ? m[1] : null;
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (validSession(getToken(req))) return next();
  res.status(401).json({ error: '请先登录', needLogin: true });
}

// ── Multer ────────────────────────────────────────────────────────────────────
function getMonthDir() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const monthDir = path.join(UPLOAD_DIR, getMonthDir());
    if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true });
    cb(null, monthDir);
  },
  filename: (req, file, cb) => {
    cb(null, crypto.randomBytes(12).toString('hex') + '_' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 200 * 1024 * 1024 } });

// ── DB helpers ────────────────────────────────────────────────────────────────
function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { return {}; }
}
function writeDB(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

// ── Misc ──────────────────────────────────────────────────────────────────────
function genId()     { return crypto.randomBytes(6).toString('base64url').slice(0, 10); }
function hashKey(k)  { return crypto.createHash('sha256').update(k).digest('hex'); }

// ── Auto-cleanup ──────────────────────────────────────────────────────────────
function cleanup() {
  const db = readDB(), now = Date.now(); let changed = false;
  for (const [id, s] of Object.entries(db)) {
    if (s.expiry && s.expiry < now) {
      (s.files || []).forEach(f => {
        const filePath = f.monthDir 
          ? path.join(UPLOAD_DIR, f.monthDir, f.storedName)
          : path.join(UPLOAD_DIR, f.storedName);
        try { fs.unlinkSync(filePath); } catch (e) {}
      });
      delete db[id]; changed = true;
    }
  }
  if (changed) writeDB(db);
}
setInterval(cleanup, 60_000);
cleanup();

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '250mb' }));
app.use(express.urlencoded({ extended: true, limit: '250mb' }));

// 上传超时设置
app.use('/api/share', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000); // 10 分钟
  next();
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH API
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/auth/status', (req, res) => {
  const cfg = readCfg();
  res.json({ loggedIn: validSession(getToken(req)), viewRequiresLogin: !!cfg.viewRequiresLogin });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  const cfg = readCfg();
  if (!password || hashPwd(password) !== cfg.adminHash)
    return res.status(401).json({ error: '密码不正确' });
  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const t = getToken(req); if (t) sessions.delete(t);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireLogin, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const cfg = readCfg();
  if (!oldPassword || hashPwd(oldPassword) !== cfg.adminHash)
    return res.status(401).json({ error: '原密码不正确' });
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: '新密码至少 6 位' });
  cfg.adminHash = hashPwd(newPassword);
  writeCfg(cfg);
  sessions.clear();
  const token = createSession();
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/auth/settings', requireLogin, (req, res) => {
  const cfg = readCfg();
  if (typeof req.body.viewRequiresLogin === 'boolean')
    cfg.viewRequiresLogin = req.body.viewRequiresLogin;
  writeCfg(cfg);
  res.json({ ok: true, viewRequiresLogin: cfg.viewRequiresLogin });
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARE API
// ══════════════════════════════════════════════════════════════════════════════

// View-gate helper
function viewGate(req, res) {
  const cfg = readCfg();
  if (cfg.viewRequiresLogin && !validSession(getToken(req))) {
    res.status(401).json({ error: '请先登录', needLogin: true }); return true;
  }
  return false;
}

// Create
app.post('/api/share', requireLogin, (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: `文件超过 200 MB 限制` });
      return res.status(400).json({ error: '文件上传失败：' + err.message });
    }
    try {
      const { title, text, passkey, expiry } = req.body;
      if (!text && (!req.files || !req.files.length))
        return res.status(400).json({ error: '请提供文本内容或上传文件' });

      const id    = genId();
      const monthDir = getMonthDir();
      const files = (req.files || []).map(f => ({
        storedName: f.filename, originalName: f.originalname, size: f.size, mimetype: f.mimetype, monthDir
      }));
      const share = {
        id, title: title || '', text: text || '', files,
        passkey: passkey ? hashKey(passkey) : null,
        created: Date.now(),
        expiry:  parseInt(expiry) > 0 ? Date.now() + parseInt(expiry) * 1000 : 0
      };
      const db = readDB(); db[id] = share; writeDB(db);
      res.json({ id, url: `/s/${id}` });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
  });
});

// List (admin)
app.get('/api/shares', requireLogin, (req, res) => {
  const db = readDB();
  const list = Object.values(db).map(s => ({
    id: s.id, title: s.title, created: s.created, expiry: s.expiry,
    hasPasskey: !!s.passkey, fileCount: s.files.length, hasText: !!s.text
  })).sort((a, b) => b.created - a.created);
  res.json(list);
});

// Delete (admin)
app.delete('/api/share/:id', requireLogin, (req, res) => {
  const db = readDB(), share = db[req.params.id];
  if (!share) return res.status(404).json({ error: '不存在' });
  (share.files || []).forEach(f => {
    const filePath = f.monthDir 
      ? path.join(UPLOAD_DIR, f.monthDir, f.storedName)
      : path.join(UPLOAD_DIR, f.storedName);
    try { fs.unlinkSync(filePath); } catch (e) {}
  });
  delete db[req.params.id]; writeDB(db);
  res.json({ ok: true });
});

// Edit (admin)
app.put('/api/share/:id', requireLogin, (req, res) => {
  upload.array('files', 20)(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(413).json({ error: '文件超过 200 MB 限制' });
      return res.status(400).json({ error: '文件上传失败：' + err.message });
    }
    try {
      const db = readDB(), share = db[req.params.id];
      if (!share) return res.status(404).json({ error: '不存在' });

      const { title, text, passkey, removeFiles } = req.body;

      // 更新标题和文本
      if (typeof title === 'string') share.title = title;
      if (typeof text === 'string') share.text = text;

      // 更新密钥
      if (passkey === '') share.passkey = null;
      else if (passkey) share.passkey = hashKey(passkey);

      // 删除指定的旧文件
      if (removeFiles) {
        const toRemove = JSON.parse(removeFiles);
        share.files = share.files.filter(f => {
          if (toRemove.includes(f.storedName)) {
            const filePath = f.monthDir
              ? path.join(UPLOAD_DIR, f.monthDir, f.storedName)
              : path.join(UPLOAD_DIR, f.storedName);
            try { fs.unlinkSync(filePath); } catch (e) {}
            return false;
          }
          return true;
        });
      }

      // 添加新上传的文件
      if (req.files && req.files.length) {
        const monthDir = getMonthDir();
        const newFiles = req.files.map(f => ({
          storedName: f.filename, originalName: f.originalname, size: f.size, mimetype: f.mimetype, monthDir
        }));
        share.files = share.files.concat(newFiles);
      }

      share.updated = Date.now();
      db[req.params.id] = share;
      writeDB(db);
      res.json({ ok: true, id: share.id, url: `/s/${share.id}` });
    } catch (e) { console.error(e); res.status(500).json({ error: '服务器错误' }); }
  });
});

// Get full share data (admin, for editing)
app.get('/api/share/:id/full', requireLogin, (req, res) => {
  const db = readDB(), share = db[req.params.id];
  if (!share) return res.status(404).json({ error: '不存在' });
  res.json({
    id: share.id, title: share.title, text: share.text,
    files: share.files.map(f => ({
      storedName: f.storedName, name: f.originalName, size: f.size, mimetype: f.mimetype
    })),
    hasPasskey: !!share.passkey, created: share.created, expiry: share.expiry,
    url: `/s/${share.id}`
  });
});

// Metadata
app.get('/api/share/:id', (req, res) => {
  if (viewGate(req, res)) return;
  const db = readDB(), share = db[req.params.id];
  if (!share) return res.status(404).json({ error: '不存在或已过期' });
  if (share.expiry && share.expiry < Date.now()) return res.status(410).json({ error: '内容已过期' });
  res.json({
    id: share.id, title: share.title, created: share.created, expiry: share.expiry,
    hasPasskey: !!share.passkey, fileCount: share.files.length, hasText: !!share.text
  });
});

// Unlock / view content
app.post('/api/share/:id/unlock', (req, res) => {
  if (viewGate(req, res)) return;
  const db = readDB(), share = db[req.params.id];
  if (!share) return res.status(404).json({ error: '不存在或已过期' });
  if (share.expiry && share.expiry < Date.now()) return res.status(410).json({ error: '内容已过期' });
  if (share.passkey) {
    const { passkey } = req.body;
    if (!passkey || hashKey(passkey) !== share.passkey)
      return res.status(403).json({ error: '密钥不正确' });
  }
  res.json({
    id: share.id, title: share.title, text: share.text,
    files: share.files.map(f => ({
      name: f.originalName, size: f.size, mimetype: f.mimetype,
      url: `/api/file/${share.id}/${encodeURIComponent(f.storedName)}`
    })),
    created: share.created, expiry: share.expiry
  });
});

// Download file
app.get('/api/file/:shareId/:filename', (req, res) => {
  if (viewGate(req, res)) return;
  const db = readDB(), share = db[req.params.shareId];
  if (!share) return res.status(404).send('Not found');
  if (share.expiry && share.expiry < Date.now()) return res.status(410).send('Expired');
  const storedName = decodeURIComponent(req.params.filename);
  const file = share.files.find(f => f.storedName === storedName);
  if (!file) return res.status(404).send('File not found');
  const fp = file.monthDir 
    ? path.join(UPLOAD_DIR, file.monthDir, storedName)
    : path.join(UPLOAD_DIR, storedName);
  if (!fs.existsSync(fp)) return res.status(404).send('File missing');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  res.sendFile(fp);
});

// ── SPA ───────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const server = app.listen(PORT, () => console.log(`PasteVault → http://localhost:${PORT}`));
server.timeout = 10 * 60 * 1000; // 10 分钟超时
server.keepAliveTimeout = 10 * 60 * 1000;
