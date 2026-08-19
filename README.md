# AI 店长

面向个人电商卖家的轻量经营中台。运行时页面和 API 使用 Supabase PostgreSQL/Auth，不依赖静态 Demo 数据。

## 技术栈

Next.js 16、React 19、TypeScript strict、Supabase PostgreSQL/Auth、Zod、Recharts、pnpm。

## 本地启动

1. 安装 Node.js 20+ 和 pnpm。
2. 执行 `pnpm install`。
3. 复制 `.env.example` 为 `.env.local` 并填写配置。
4. 执行 `pnpm dlx supabase link --project-ref <project-ref>`。
5. 执行 `pnpm dlx supabase db push` 应用全部迁移。
6. 执行 `pnpm dev`，访问 `http://localhost:3000/dashboard`。

## 环境变量

- `NEXT_PUBLIC_SUPABASE_URL`：Supabase 项目 URL。
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：浏览器可用的 anon key，安全边界由 RLS 提供。
- `SUPABASE_SERVICE_ROLE_KEY`：仅服务端使用，禁止暴露到客户端或提交仓库。
- `OPENAI_API_KEY`：仅服务端使用的 OpenAI-compatible API Key。
- `OPENAI_MODEL`：AI 功能使用的模型。
- `OPENAI_BASE_URL`：可选的 OpenAI-compatible API 地址。

密钥文件已被 `.gitignore` 忽略。部署时应在托管平台的环境变量面板中配置，不能写入源码。

## 数据库与安全

迁移位于 `supabase/migrations/`。业务表均带 `user_id` 并启用 RLS，只允许登录用户访问自己的记录。正式部署必须执行全部迁移，不应只执行首个 schema 文件。

`supabase/seed.sql` 只用于开发或验收样本数据，所有样本记录带 `is_demo=true`；生产账户应通过页面或 CSV 导入真实数据。

## CSV 导入

模板位于 `examples/daily_metrics_template.csv`，也可在 `/analytics/import` 下载。系统执行客户端预览、服务端二次校验，并按 `sku_id + date` upsert。

## 上线检查

```bash
pnpm lint
pnpm build
```

上线前还应确认：

- Supabase Auth 的 Site URL 与 Redirect URLs 已设置为正式域名。
- RLS 跨账户隔离测试通过。
- `SUPABASE_SERVICE_ROLE_KEY` 和 AI Key 仅存在于服务端。
- 若启用 AI 功能，已配置真实模型并执行一次人工审核的生成测试。
- 已使用非样本账户完成登录、CRUD、CSV 导入和核心页面冒烟测试。

## 当前能力

- 候选商品、供应商、SKU 的真实数据库管理。
- SKU 每日指标 CSV 导入、7/30 天汇总与趋势。
- 单 SKU 诊断、全店分析和任务生成。
- 内容草稿、客服回复草稿、AI 日报和周报。
- 单变量实验及 before/after 指标快照。

AI 功能始终由用户主动触发，结果保存审计记录；客服内容只生成草稿，不自动发送。
