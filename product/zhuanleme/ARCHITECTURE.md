# 产品插件边界

`product/zhuanleme` 是包含 Host 和 Client 的独立产品 Bundle，复用官方 DSH 工作区、对话、工具与认证服务。产品代码不进入官方 Web Bundle；安装和构建方式见 [README](README.md#安装与构建)。

1. 官方工作区是店铺标识的权威源。创建店铺使用官方 WorkspaceRegistry，在当前 Profile 数据目录建立店铺工作目录。
2. Host Ledger 负责格式校验、整数计算、事务、幂等和审计。UI 和模型工具经 Ledger 提交业务操作；账本、成本规则和建议状态以 `ledger.sqlite` 为权威源。
3. UI 通过官方认证的 `/api/zhuanleme` Fetch route 访问；AI 的店铺从会话解析。当前本地 Profile 的使用者共享这些店铺，不将此声明为商户级权限系统。
4. 已有 `main.conversation` 的官方子 Slot 仍由原注册声明。产品替换渲染入口，只调用公开 Factory，不重新声明其 children。
5. 不复制官方聊天源码。产品布局通过公开 Slot、`conversation.content` owner props 和 Workspace/Session 投影接入；确认卡片通过 `tool.call.toolview` 接入 Native 调用和 PTC 子调用，回合末尾通过 `conversation.chat.turnTail` 保留确认入口，避免宿主折叠工具记录后隐藏卡片；调用树与结果配对仍由官方 Runtime 负责。
6. 插件使用独立构建脚本生成官方模块协议的 factory，保持 React 的平台身份；CSS Modules 由同一产物内的生命周期效果注入。
7. 当前不迁移相邻 SaaS 项目的数据库或权限。业务范围和成本模型限制见 [README](README.md#数据与成本模型)。
8. AI 新增保留为草稿，修改保留为独立建议；对话确认卡片用持久化的店铺、类型和记录 ID，通过认证 API 读取当前记录，再提交人工选择。确认在同一事务内检查版本并更新业务记录和审计，手动规则编辑也核验表单打开时的版本；详细重试与冲突行为见 [README](README.md#数据与成本模型)。
9. ToolDefinition 由官方 defineTool 生成，不直接调用运行器的私有调度标识，不修改官方 AgentLoop，也不打包 DSH 运行时。外层启动器使用同一构建平面的 CLI 和 Profile 插件。
10. 对话归档和取消归档委托官方 WorkspaceRegistry；可恢复删除标记独立存入 `conversations.sqlite`，不改写 Session 日志或店铺账本。侧栏对完整店铺对话列表分组、按标题搜索并逐步展开较早记录；没有永久删除入口。Host 显式依赖官方 `agents` 服务，拒绝删除正在运行的对话。
