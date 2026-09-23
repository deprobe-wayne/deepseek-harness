# 本地验证 · 2026-09-21

- 插件 Node 测试：5/5 通过，覆盖成本计算与 Host 工具路径。
- 官方 GUI 测试：433 个文件，6180 通过、1 跳过。
- 官方完整构建：通过，构建标题 `DSH_CLIENT_TITLE=赚了么`。
- 官方 Web 全量回放：**未通过、未完成**。首次缺少指定 Playwright 浏览器；安装后重跑，`queue-actions.e2e.ts` 的队列编辑用例失败，后续运行长时间无进展，因此中断（退出码 130）。未确认该失败原因，不作为插件回归通过的依据。
- 隔离 DSH Profile + Google Chrome：创建店铺、收入录入、六类成本规则、采购不扣利润、持久化、编辑/撤销、负数拒绝、店铺隔离、未认证 API 401、桌面输入框位置及 390px 窄屏验收通过，浏览器无 pageerror。
- 正式 web Profile：已安装并重启，通过原有 start 脚本打开 Google Chrome；只读检查标题为「赚了么」、「我的店铺」已显示、插件 API 已注册，浏览器无 pageerror。没有向正式账本写入模拟数据。
- 独立界面审查：desktop.png、mobile.png、mobile-chat.png，结论 ship。截图全部来自隔离测试店铺。
- AI 工具调用及人工确认路径通过 Host 测试；**未验证真实模型聊天到工具调用的完整流程**。

临时测试日志保存在 `/tmp/zhuanleme-gui-tests.log` 和 `/tmp/zhuanleme-web-replay.log`。启动日志含本地认证链接，不加入源码。
