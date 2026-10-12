# to-work Server

可选账号云端同步 + 后台管理（SQLite）。

## 启动

```bash
cd server
npm install
npm start
```

默认地址：`http://127.0.0.1:3789`

- 管理后台：打开上述地址
- 默认管理员：`admin@local` / `admin123`
- API 健康检查：`GET /api/health`

环境变量（可选）：

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 端口 | `3789` |
| `JWT_SECRET` | JWT 密钥 | 开发默认值 |
| `ADMIN_EMAIL` | 初始管理员邮箱 | `admin@local` |
| `ADMIN_PASSWORD` | 初始管理员密码 | `admin123` |
| `DB_PATH` | SQLite 路径 | `server/data/to-work.sqlite` |

## 主要 API

- `POST /api/auth/register` / `POST /api/auth/login` / `GET /api/auth/me`
- `GET|PUT /api/resume`
- `GET|PUT /api/llm`
- `GET|POST /api/applications`，`PUT|DELETE /api/applications/:id`
- `GET /api/admin/*`（需 admin）

扩展端可不登录使用；登录后可在「账号」页同步简历、LLM 设置与投递记录。
