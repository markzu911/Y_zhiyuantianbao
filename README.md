# 高考志愿助手

一个面向 Vercel 部署的 JS 对话智能体前端，后端通过 Serverless Function 调用 Z.AI / 智谱 GLM-5.1。

## 环境变量

在 Vercel Project Settings -> Environment Variables 中配置：

```bash
ZAI_API_KEY=你的 Z.AI / 智谱 API Key
```

可选：

```bash
ZAI_MODEL=glm-5.1
ZAI_BASE_URL=https://api.z.ai/api/paas/v4/chat/completions
```

## 本地开发

```bash
npm install
npm run dev
```

打开 Vercel Dev 提供的本地地址即可。

如果本机暂时没有 npm 或 Vercel CLI，也可以用零依赖预览：

```bash
node local-dev-server.js
```

## 部署

把项目推到 GitHub 后，在 Vercel 导入仓库。Vercel 会自动识别 `api/chat.js` 作为 Serverless Function，静态页面由 `index.html`、`app.js`、`styles.css` 提供。
