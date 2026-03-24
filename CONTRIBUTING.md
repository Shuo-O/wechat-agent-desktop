# 贡献指南

感谢你关注 `WeChat Agent Desktop`。

这个项目目前仍处于实验和快速迭代阶段。为了让公开协作保持可控，提交变更前请先理解下面几条约束。

## 贡献范围

欢迎提交：

- Bug 修复
- 文档修正与补充
- UI 可用性优化
- Provider 接入层的兼容性改进
- 更稳定的错误处理、日志和恢复逻辑
- 自动化测试与构建脚本改进

暂不建议直接提交：

- 大规模重写协议层
- 未经讨论的产品方向切换
- 会扩大账号风控或法律风险的能力
- 默认开启高权限、本地写文件或批量自动操作的行为

## 本地开发

安装依赖并启动：

```bash
npm install
npm run start
```

提交前至少执行：

```bash
npm run build
npm run typecheck
```

如果你改动了聊天链路、登录链路或 Provider 行为，请再按 [docs/VALIDATION.md](./docs/VALIDATION.md) 做一次手工验证。

## 提交原则

- 保持改动最小、边界清晰
- 优先补充文档和验证步骤
- 不要提交任何真实账号、Token、API Key、二维码截图或本地日志
- 不要把 `node_modules/`、`dist/`、`release/` 这类构建产物提交进仓库
- 如果改动涉及协议风险、账号风控或安全影响，请在描述里明确说明

## 协议与风险

本项目的微信接入能力依赖非官方协议。提交相关改动时请保持克制：

- 不要提交鼓励滥用、规避风控或扩大攻击面的实现
- 不要在 issue 或 PR 中公开真实凭证、完整请求包或敏感账号信息
- 如需讨论安全问题，请走 [SECURITY.md](./SECURITY.md) 中的私下披露流程

## 文档要求

如果你的改动会影响使用方式、目录结构、主流程或风险边界，请同步更新：

- [README.md](./README.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/PROVIDERS.md](./docs/PROVIDERS.md)
- [docs/VALIDATION.md](./docs/VALIDATION.md)
