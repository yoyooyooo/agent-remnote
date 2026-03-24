# Write Routes

只在这些情况加载本文件：

- 需要在 `rem children append|prepend|replace|clear`、`daily write`、`rem create`、`rem move`、`tag`、`apply` 之间选命令
- 需要决定“单步业务命令”还是“多步依赖型 `apply --payload`”
- 需要处理 promotion 路由、tag 写入、table/property 边界

## Further Routing

### Basic Write Routes

读 [write-basic.md](write-basic.md)：

- 需要选择单步写命令
- 需要处理 `rem children *`、`daily write`、`rem create --text`、`rem set-text`、`tag`

### Promotion And Apply

读 [promotion-and-apply.md](promotion-and-apply.md)：

- 需要处理 promotion 路由
- 需要判断是否必须用 `apply --payload`
- 存在“后一步依赖前一步新建节点”

### Table And Property Boundaries

读 [table-property-boundaries.md](table-property-boundaries.md)：

- 需要处理 table / property 边界
- 用户要改类型、建 typed property、加删 option

## Principle

- 只要用户意图能被一个业务命令直接表达，就不要升级到两步
- 只要目标 rem 已知，就不要先查再写
