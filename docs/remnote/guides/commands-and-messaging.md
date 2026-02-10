# 命令（Commands）与消息（Messaging）用法食谱

## TL;DR

- 命令用于把能力暴露给用户（菜单/快捷入口）；消息用于在多个 Widget 间通信。
- 本仓库执行器插件通过命令提供：连接控制通道、启动同步、查看队列统计、调试写入等。
- 插件与后端通信走 WebSocket（不是 Messaging）。

## 1) Commands：把能力暴露给用户

- `plugin.app.registerCommand({ id, name, action })`

建议：

- `id` 稳定；`name` 面向用户（中文即可）。
- 命令应尽量幂等；失败要 toast 明确原因（尤其是权限/连接类问题）。

代码锚点：`packages/plugin/src/widgets/index.tsx`（多条 `registerCommand`）

## 2) Messaging：组件间广播（Widget ↔ Widget）

- 发送：`plugin.messaging.broadcast(payload)`
- 接收：`useOnMessageBroadcast(handler)`

适合：

- 解耦“命令触发”与“UI 刷新”；
- 多个 Widget 共享轻量事件（而不是共享大对象）。

不适合：

- 与后端交换任务/结果（本仓库用 WS + 队列解决可靠性与审计）。

## 3) 本机参考（若存在）

- 命令与消息：`guides/messaging-and-commands.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
