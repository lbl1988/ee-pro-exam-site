# 注册电气工程师专业考试学习平台

## 功能特性

- 📚 **章节知识管理**：按章节组织课本知识点，支持多级目录
- 🎬 **2025直播课程**：基础班、精讲班、冲刺班等分级课程
- 📖 **考试手册**：汇集电教中心、工控圈、匠工教育等权威培训机构资料
- 📝 **学习笔记**：云端同步笔记，按用户隔离
- 📊 **学习进度**：跟踪学习状态（计划学习、学习中、已学完）

## 本地运行

1. 安装依赖：
```bash
npm install
```

2. 配置环境变量：
```bash
cp .env.example .env
# 编辑 .env 填入数据库连接信息
```

3. 启动服务：
```bash
npm start
```

4. 访问 http://localhost:3000

## 部署到 Render

1. 在 GitHub 创建仓库并推送代码
2. 登录 [Render](https://render.com)，创建新的 Web Service
3. 连接 GitHub 仓库，选择分支
4. 配置：
   - Build Command: `npm install`
   - Start Command: `npm start`
5. 添加环境变量：
   - `DATABASE_URL`：PostgreSQL 数据库连接
   - `JWT_SECRET`：JWT 密钥
   - `SITE_URL`：网站地址
6. 部署

## 数据库

支持 PostgreSQL 数据库（推荐）：
- [Neon](https://neon.tech) - 免费PostgreSQL
- [Supabase](https://supabase.com) - 免费PostgreSQL
- Render PostgreSQL

## 技术栈

- 前端：HTML5 + Tailwind CSS + Vanilla JS
- 后端：Express.js + PostgreSQL
- 认证：JWT + bcrypt
- 托管：Render