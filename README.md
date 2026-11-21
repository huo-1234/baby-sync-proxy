# 成长日记 · 同步中转

Supabase 反向代理。国内无法直连 supabase.co 时，通过这个 Netlify 站点转发请求。

## 部署

1. 在 Netlify 选择 Add new site → Import an existing project
2. 连接这个 GitHub 仓库
3. 构建配置留空（netlify.toml 已包含）
4. Deploy

部署完成后，把站点地址填进 App 的「项目地址」。
