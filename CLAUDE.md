# test-project

各种临时小工具和测试的合集，没有统一主题，各子项目互不相关。

## 放在哪里

本仓库是**公开**的，并通过 GitHub Pages 发布 `site/`。默认一切都不公开：

- 新的子项目放在 `private/<子项目名>/`。`private/` 已被 git 忽略，不会进入版本库。
- 一次性的脚本、下载内容和中间输出放在 `tmp/`（同样被忽略）。
- 只有明确要发布到 Pages 的网页及其源码和测试才提交到仓库（目前是 `site/` 与 `tests/`）。
- 用户的论文、作业、邮件、密钥等私人内容一律不提交。提交前先看一眼 `git status`，确认没有误加的文件。

## 常用命令

```bash
npm test        # 运行 site/ 的单元测试
npm run serve   # 本地预览 site/（http://localhost:8000）
```

推送到 `main` 后，`.github/workflows/pages.yml` 会先跑测试，再把 `site/` 部署到 Pages。
