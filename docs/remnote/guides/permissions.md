# 权限模型（Scope + Level）用法食谱

## TL;DR

- 权限由 **Scope（可访问范围）+ Level（读写能力）** 组成；越权访问通常返回 `undefined`（不是异常），必须判空。
- 通用插件：优先最小权限（先 Read，再逐步加 Create/Modify/Delete）。
- 本仓库的“执行器插件”（`packages/plugin`）目前用 `All + ReadCreateModifyDelete` 以覆盖队列写入能力（这是执行器的工程权衡，不是通用最佳实践）。

## 1) Scope 选择策略（从窄到宽）

- `DescendantsOfName`：最推荐的“固定根”策略（把可写范围锁在某个顶级 Rem 名称下）。
- `DescendantsOfId`：运行时选择某个 Rem 作为根（更灵活；适合“用户点选范围”）。
- `Powerup`：围绕“业务模型（Powerup）”授权（适合结构化数据写入/维护）。
- `All`：全局范围（尽量避免；只有执行器/全局工具类插件才考虑）。

## 2) Level 选择策略

- `Read`：只读（默认起步）。
- `ReadCreate`：允许创建（导入/生成内容）。
- `ReadCreateModify`：允许修改（同步/修复/批量更新）。
- `ReadCreateModifyDelete`：允许删除（必须有二次确认与可回滚策略）。

## 3) 一个常见“误会”：`undefined` 不是 bug

RemNote 的权限模型倾向于“越权静默失败”（返回 `undefined`），因此：

- 任何 `findOne/findMany/findByName` 的返回值都要判空；
- 对“越权/不存在”的用户提示要清晰（提示用户检查 scope/level，而不是让用户以为插件坏了）。

## 4) `createRem` 创建在哪（与 Scope 强相关）

`createRem` 的默认创建位置会受“当前最大 Scope”影响（具体规则以官方实现为准）。实践上：

- 权限越宽，默认创建的位置越“靠外”（例如全局）。
- 为了可控：创建后通常应显式移动到目标父节点（本仓库写入 op 里要求提供 `parent_id`，并在插件端强制移动）。

## 5) 本仓库现状与代码锚点

- 执行器插件 manifest：`packages/plugin/public/manifest.json`
  - 当前：`requestNative: true` + `requiredScopes: [{ type: "All", level: "ReadCreateModifyDelete" }]`
- 插件执行器入口：`packages/plugin/src/widgets/index.tsx`
  - 多数写入路径都会先 `findOne`/`createRem`，并在 `parent_id` 缺失时直接失败（避免“写到顶级”）。

## 6) 本机参考（若存在）

更完整的“权限食谱”在你本机提炼版：

- `guides/permissions-cookbook.md`（位于你的本机提炼版目录中，例如 `~/llms.txt/docs/remnote`）
