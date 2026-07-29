require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'ee-pro-exam-dev-secret-2026';
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// PostgreSQL 连接池（Neon / Supabase / Render / Railway 等云数据库）
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});
pool.on('error', (err) => console.error('数据库连接错误:', err));

// ─── 数据库初始化 ───
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        reset_token TEXT,
        reset_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS chapters (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        parent_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
        order_index INTEGER DEFAULT 0,
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS live_courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
        level TEXT DEFAULT 'basic',
        teacher TEXT,
        scheduled_at TIMESTAMPTZ,
        duration_minutes INTEGER DEFAULT 90,
        external_url TEXT,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_title TEXT,
        content TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, item_type, item_id)
      );
      CREATE TABLE IF NOT EXISTS progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        status TEXT DEFAULT 'planned',
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, item_type, item_id)
      );
    `);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ`);
    console.log('✅ 数据库表初始化完成');
  } finally {
    client.release();
  }
}

// ─── 认证中间件 ───
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'token无效' });
  }
}

// ─── 用户认证 ───
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    const exists = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (exists.rows.length > 0) return res.status(400).json({ error: '用户名或邮箱已被注册' });
    const hashed = bcrypt.hashSync(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
      [username, email, hashed]
    );
    const id = result.rows[0].id;
    const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, username, email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $2', [login, login]);
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: '用户不存在' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(400).json({ error: '密码错误' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: '用户不存在' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 章节课本知识 ───
app.get('/api/chapters', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chapters ORDER BY order_index, id');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chapters', authMiddleware, async (req, res) => {
  try {
    const { title, parentId, content, orderIndex } = req.body;
    const result = await pool.query(
      'INSERT INTO chapters (title, parent_id, content, order_index) VALUES ($1, $2, $3, $4) RETURNING *',
      [title, parentId || null, content || '', orderIndex || 0]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/chapters/:id', authMiddleware, async (req, res) => {
  try {
    const { title, content, orderIndex } = req.body;
    const result = await pool.query(
      'UPDATE chapters SET title = COALESCE($1, title), content = COALESCE($2, content), order_index = COALESCE($3, order_index) WHERE id = $4 RETURNING *',
      [title, content, orderIndex, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/chapters/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM chapters WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 直播课程 ───
app.get('/api/live-courses', async (req, res) => {
  try {
    const level = req.query.level;
    let query = `
      SELECT lc.*, c.title as chapter_title
      FROM live_courses lc
      LEFT JOIN chapters c ON lc.chapter_id = c.id
    `;
    const params = [];
    if (level) {
      query += ' WHERE lc.level = $1';
      params.push(level);
    }
    query += ' ORDER BY lc.scheduled_at DESC, lc.id';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/live-courses', authMiddleware, async (req, res) => {
  try {
    const { title, chapterId, level, teacher, scheduledAt, durationMinutes, externalUrl, description } = req.body;
    const result = await pool.query(
      `INSERT INTO live_courses (title, chapter_id, level, teacher, scheduled_at, duration_minutes, external_url, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [title, chapterId || null, level || 'basic', teacher || '', scheduledAt || null, durationMinutes || 90, externalUrl || '', description || '']
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/live-courses/:id', authMiddleware, async (req, res) => {
  try {
    const { title, level, teacher, scheduledAt, durationMinutes, externalUrl, description } = req.body;
    const result = await pool.query(
      `UPDATE live_courses SET
        title = COALESCE($1, title),
        level = COALESCE($2, level),
        teacher = COALESCE($3, teacher),
        scheduled_at = COALESCE($4, scheduled_at),
        duration_minutes = COALESCE($5, duration_minutes),
        external_url = COALESCE($6, external_url),
        description = COALESCE($7, description)
       WHERE id = $8 RETURNING *`,
      [title, level, teacher, scheduledAt, durationMinutes, externalUrl, description, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/live-courses/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM live_courses WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 笔记 ───
app.get('/api/notes', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT item_type, item_id, item_title, content, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/notes/:itemType/:itemId', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, content, item_title, updated_at FROM notes WHERE user_id = $1 AND item_type = $2 AND item_id = $3',
      [req.user.id, req.params.itemType, req.params.itemId]
    );
    res.json(result.rows[0] || { content: '', item_title: null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/notes/:itemType/:itemId', authMiddleware, async (req, res) => {
  try {
    const { content, itemTitle } = req.body;
    const result = await pool.query(
      `INSERT INTO notes (user_id, item_type, item_id, item_title, content, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, item_type, item_id) DO UPDATE
       SET content = $5, item_title = COALESCE($4, notes.item_title), updated_at = CURRENT_TIMESTAMP
       RETURNING id, content, updated_at`,
      [req.user.id, req.params.itemType, req.params.itemId, itemTitle || null, content || '']
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 学习进度 ───
app.get('/api/progress', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT item_type, item_id, status FROM progress WHERE user_id = $1',
      [req.user.id]
    );
    const map = {};
    result.rows.forEach(r => { map[`${r.item_type}:${r.item_id}`] = r.status; });
    res.json(map);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/progress/:itemType/:itemId', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['planned', 'learning', 'done'].includes(status)) {
      return res.status(400).json({ error: '状态非法' });
    }
    await pool.query(
      `INSERT INTO progress (user_id, item_type, item_id, status, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET status = $4, updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, req.params.itemType, req.params.itemId, status]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 统计 ───
app.get('/api/stats', authMiddleware, async (req, res) => {
  try {
    const done = await pool.query("SELECT COUNT(*)::int AS n FROM progress WHERE user_id=$1 AND status='done'", [req.user.id]);
    const learning = await pool.query("SELECT COUNT(*)::int AS n FROM progress WHERE user_id=$1 AND status='learning'", [req.user.id]);
    const planned = await pool.query("SELECT COUNT(*)::int AS n FROM progress WHERE user_id=$1 AND status='planned'", [req.user.id]);
    const notes = await pool.query('SELECT COUNT(*)::int AS n FROM notes WHERE user_id=$1', [req.user.id]);
    res.json({
      done: done.rows[0].n,
      learning: learning.rows[0].n,
      planned: planned.rows[0].n,
      notes: notes.rows[0].n,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

initDB().then(() => {
  console.log('✅ 数据库就绪');
}).catch(err => {
  console.warn('⚠️ 数据库初始化失败（认证/笔记/进度功能不可用）：', err.message);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 注册电气工程师专业考试学习平台运行在 http://localhost:${PORT}`);
});