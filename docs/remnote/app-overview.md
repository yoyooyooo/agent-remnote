# RemNote 功能概览

总导航：`docs/remnote/README.md`

> 基于 RemNote 帮助中心公开文档汇总的应用层概念，聚焦于核心工作流与术语，便于后续 CLI 命令、自动化脚本在语义层与用户对齐。

## 核心对象
- **Rem**：RemNote 中的一切内容单元，呈树状层级排列。回车创建同级 Rem，Tab 缩进形成父子层级。
- **Document / Folder**：Rem 的集合，用于按主题组织。可在侧边栏使用 `Create` 创建，并通过 Folder 做多层分组。
- **Daily Document**：快速输入的日记式入口（Today’s Note）。适合先捕捉，再移动至专门文档。

## 笔记与知识结构
- **Outline Notes**：Rem 本身即支持大纲，配合缩进与多 Pane 可快速拆解复杂主题。
- **Concept / Descriptor Framework (CDF)**：将知识拆为 *Concept*（概念、名词）与 *Descriptor*（属性、问题）。
  - 概念构成树状层级，可为抽象或具体对象。
  - 描述用于刻画属性或回答关于该概念的具体问题。
  - RemNote 会据此自动生成适配的卡片提示，便于实现“细粒度记忆 + 层次化理解”。
- **引用与链接**
  - `[[` 或 `@` 插入 **Rem Reference**，重用既有 Rem 内容。
  - `((` 插入 **Portal**，将另一处 Rem 的子树投影至当前上下文，保持双向同步。
  - `##` 插入 **Tag**，为 Rem 标注主题；Tag 既可用于筛选，也可扩展为模板/表格（见下文）。
  - **Deep Link（桌面端跳转）**：`remnote://w/<workspaceId>/<remId>`，其中 `workspaceId` 是工作区标识（常见 24 位十六进制），`remId` 是具体 Rem 的 `_id`。
  - 本仓库 CLI 的 `--ref` 已支持直接粘贴上述 deep link（会自动提取其中的 `remId` 作为目标）。

## Flashcards 与间隔重复
- 在编辑器中输入 `==` 或 `>>` 将 Rem 分割为卡片正反面，RemNote 自动转为箭头样式。
- **卡片类型**：基础卡片之外，还支持双向、反向、填空、多步骤、图像遮挡、表格生成、选择题等，高阶类型可按需学习。
- **AI 卡片生成**：可调用内置 AI 生成初版卡片，再人工微调。
- **Practice 模式**
  - `Practice with Spaced Repetition`：RemNote 依据遗忘曲线调度复习，只需每天处理到期卡片即可。
  - `Practice All`：不考虑到期状态，针对某个文档或主题进行额外练习。
- 复习时点击“Show Answer”后对回忆效果评分，系统据此调整下次间隔；可在侧边栏 `Flashcards` 查看待复习数量。
- **评分按钮与间隔**：
  - `Forgot` 会立即安排短时间内复习；`Partially Recalled`、`Recalled with effort`、`Easily recalled` 分别对应从保守到宽松的下次间隔。
  - `Skip` 用于误操作或未准备好的情况，系统会在约一小时后再推送该卡。
  - 默认策略让你约 10% 的卡出现遗忘迹象，此时重新巩固记忆成本最低。
- **每日学习目标**：可设置 Daily Learning Goal，顶部进度条和热力图记录完成情况；开启通知后若当日未达标会收到提醒。
- **优先级与考试调度**：通过“Prioritize” 指定即将考试、普通重要或暂不需要的文档，帮助调度器调整卡片队列；Exam Scheduler 可为考试日临时加强记忆。
- **移动端练习**：iOS/Android 可随时练习，当空闲时点击右下角闪卡图标进入复习。

## 搜索与导航
- **Ctrl/Cmd + P**：全局搜索（Omnibar），可快速跳转任何 Rem；支持层级过滤（Hierarchical Search）。
- **引用/Portal/Tag 搜索**：在输入 `[[`、`((`、`##` 时同样触发搜索，支持“仅限 Tag”或“显示非 Tag”。
- **选择文本即搜**：选中任意文字，可立即看到知识库中出现该字符串的其他 Rem，便于建立连接（可通过工具栏放大镜开关）。
- **文档内搜索（Ctrl/Cmd + F）**：在当前文档执行查找、筛选、替换或 Query Filter。
- **Descendants Search（Ctrl/Cmd + Shift + C）**：在庞大子树中快速定位目标 Rem。
- **索引与排序策略**：RemNote 仅索引“单词前缀”；搜索结果综合最近访问、层级深度、是否文档/概念等因素排名。

## Tags、Properties 与 Tables
- **Tag**：最基础的语义标记。执行 `taggedRem()`（插件）或在 UI 中查看 “Tagged with …” 即可获得所有被该 Tag 标注的 Rem。
- **Property**：当 Tag 的子 Rem 被标记为“属性”（UI 中的表格列），其 `doc` 中 `rcrs`（属性类型）会以 `t.<code>` 形式标记，例如 `t.s`（单选）、`t.m`（多选）、`t.n`（数字）。
- **Table**：在同一 Tag 下维护的结构化集合；行是带有该 Tag 的 Rem，列是 `setIsProperty(true)` 的子 Rem。列选项对应子 Rem 再挂载的 `rcre`/`pd` 结构，可统计使用情况。
- **关系**：Tag→属性→选项，共同构建类似数据库的结构；通过 `read_table_rem` 工具可还原属性定义与多选引用。
- **模板与 Powerup**：特定 Tag 可注册为模板（自定义 Powerup），在打 Tag 时自动附带预设属性字段；Property 值存储为 RichText，可被其它插件读取。

## 其他重要功能
- **Search 结果/Portal 练习序列化**：搜索文章提及 RemNote 会根据引用结构微调卡片顺序，加强关联记忆。
- **AI 助手**：支持根据文档生成摘要、提问（需高阶付费计划）。
- **侧边栏与多窗格（Pane）**：可同时打开多份文档、固定常用 Rem，提升多线程整理效率。
- **平台支持**：桌面端、移动端、浏览器扩展及插件生态（Electron + 前端 SDK，协议与契约见 `docs/ssot/agent-remnote/README.md`）。
- **Reader & 标注**：RemNote Reader 允许导入 PDF/Web 页面进行高亮与摘录，摘录内容可直接生成 Rem 与闪卡，并与原文保持链接（高级文章多需订阅）。

## 与数据库的关联
- 笔记层概念与本地 SQLite 字段存在对应关系：
  - Rem（`quanta` 表）中的 `key`、`parent`、`f` 等字段决定层级与排序；`tp`/`pd`/`pe` 则承载属性、选项、模板信息。
  - 搜索相关操作映射至 `remsSearchInfos`、`remsSearchRanks` 以及 FTS 虚拟表（详见 `docs/remnote/database-notes.md`）。
  - 间隔重复调度与卡片练习数据写入 `cards`、`spaced_repetition_scheduler` 等派生表。

> 后续若需要扩展更多 RemNote 功能（如 Reader、PDF 高亮、协作、移动端差异），可继续在此文档增补章节并与数据库笔记交叉引用。

## 闪卡类型速查
- **Basic**：`==`/`>>`；可通过 `<<`、`<>`、`=-` 控制方向 / 禁用。
- **Concept**：`::`；默认双向，概念名称加粗，适合名词解释。
- **Descriptor**：`;;`；默认正向，斜体呈现，描绘概念属性。
- **Cloze**：`{{ ... }}` 或选中后 `{`；可一次遮蔽多段文本，并决定是否同卡显示。
- **Multiple Choice**：`>>A)`，默认选项 A 为正确，可用 `/mcr`、`/mcw` 调整正确项。
- **Image Occlusion**：Ctrl/Cmd+单击图片。
- **Multi-line**：触发符号连打三次（例如 `>>>`），或回车后继续输入，多用于列表/集合。
- **禁用卡片**：在触发符号后追加 `-`（如 `>>-`）。
- **AI 生成**：支持用 AI 批量生成 Basic/Concept/Descriptor 等卡片，再人工验证。

## Reader 与导入
- RemNote Reader 支持导入 PDF、网页，直接高亮并生成 Rem/闪卡；付费计划提供高级功能（如 AI 摘要）。
- 支持从多种来源导入：Anki、Notion、纯文本等；导出亦可选 JSON/Markdown 等格式（详见 Import/Export 文档）。
- Reader 与表格/Tag 可结合，将高亮内容标注属性后，统一汇总在 Tag 视图处理。

## 多端与生态
- 桌面版（Win/macOS/Linux）与移动端（iOS/Android）保持功能 parity，可通过 app 内侧边栏练习闪卡。
- 插件体系基于前端 SDK，可自定义 Powerup、Hook、表格交互（详见 `docs/remnote/` 与 `docs/ssot/agent-remnote/README.md`）。

## Documents、Folders、Nested Documents
- 任何 Rem 均可标记为 Document/Folders（/document、/folder 或快捷键），并在侧边栏、All Notes、搜索结果中提升优先级。
- Folder 仅用于组织 Document 的“外壳”，适合做目录；若需要边编辑边聚合，可使用嵌套 Document（Document 中包含 Document），兼具层级与可编辑性。
- Document Style 提供 `Add Icon`、`Hide Bullets`、`Wide Layout` 等展示选项，可更好地呈现长文或宽表格。
- 任意层级都可以随时切换是否为 Document，顶层 Rem ≠ Document：顶层只是“无父 Rem”，可选用 Document/Folders 控制展示与检索。

## 标签语义分类（e 字段部分映射）
- `u.d.*`：常见的系统模板（如每日文档、状态标签等）。
- `u.f.*`：文件/媒体类型（Image、PDF 等）。
- `u.g.*`：通用标签群（如收藏、Pinned 等）；`u.g` 下子项反映不同 Tag 功能。
- 这些编码在本地 `quanta.doc.e` 字段出现时，可用来识别系统级 Rem（例如 Daily Document）。

## 其他结构化能力
- **Nested Documents**：在普通文档中嵌套子文档，既能保持层级上下文，也能为不同部分设置独立样式或练习范围。
- **侧边栏 Pin & Pane**：常用 Document 可 Pin 在侧边栏，配合 Pane 同时查看多个上下文。
- **文档优先级 (Prioritize)**：用于 Spaced Repetition 调度，标记为“考试临近/重要/一般/不再记忆”以调整卡片出现频率。

> 更多字段详见 `docs/remnote/database-notes.md`，可结合 `quanta.doc.e/tp/pd` 等结构判断 Rem 类型和模板属性。

## 键盘快捷键与命令面板
- **/-menu**：在编辑器中按 `/` 或 `\` 调出，输入描述或指令名即可触发；常用指令可记住右侧 shortcode（如 `imlc`）。
- **Omnibar（Ctrl/Cmd + K）**：集合 /-menu 功能并扩展到导航、批处理，支持搜索指令后对多条 Rem 执行操作。
- **Markdown 风格格式化**：`*` 粗体、`_` 下划线、`` ` `` 行内代码、`` ``` `` 代码块、`>` 引用、`$$` LaTeX 等。
- **Rem 专用插入器**：`[[` or `@` 引用、`((` Portal、`##` Tag、`!!` Daily Document、`{{ }}` Cloze、`%%` Emoji。
- **快捷键面板**：按 `Ctrl+Alt+Shift+H`（macOS `Cmd+Opt+Shift+H`）或点击右下角 `?` → Keyboard Shortcuts，可搜索所有快捷键并一键生成学习卡片。
- **自定义快捷键**：`Settings > Keyboard Shortcuts` 支持重映射大部分快捷键，解决与系统/输入法冲突的问题。

## 共享与协作
- **Shared Knowledge Base**：Pro 用户可将同步知识库共享给他人协作；受邀成员可使用免费账户查看/编辑（若需使用 Pro 功能仍需自己的 Pro 订阅）。
  - 在 `Settings > Knowledge Bases` 中选择或创建要共享的知识库，点击 `Invite` 输入邮件即可发送邀请。
  - 角色分为 `Admin` 与 `Member`：Admin 可增删成员、重命名或删除知识库；Member 可读写内容但无管理权限。
  - 可随时将成员角色切换或移除；未来将提供只读模式，目前可通过分享文档满足只读需求。
- **协作场景**：团队共建资料库、分工制作课程卡片、与同学共享闪卡等。

## 文档发布与分享
- 任意 Document 可通过右上角 `Share` 发布至 RemNote Community 或生成为非公开链接；再次分享会以相同链接更新快照。
- 可为分享内容添加 Topics 方便检索，也可随时 `Un-Share` 使链接失效（重新分享会生成新链接）。
- 适合公开笔记、教学资料或打包模板；若仅暂时协作可结合共享知识库或复制模块。

- **Groups & Profiles**：支持创建学习群组或公开个人主页，集中管理共享文档、协作项目（见 RemNote 社区功能）。

## Import & Export 支持
- **常见导入来源**：
  - Anki（.apkg）、Notion、Roam Research、Obsidian/Markdown、Workflowy/OPML、纯文本/CSV、Cloze Cards；亦可导入 PDF/Web 标注至 Reader。
  - 可在 `Settings > Import` 选择模板或使用 Copy & Paste（支持自动解析标题、闪卡分隔符）。
  - 导入时可指定目标知识库/文档，并选择保留或忽略原有标签、层级信息。
- **导出**：
  - 支持导出 Markdown、LaTeX、PDF、Anki（.apkg）、纯文本等；可在 `Settings > Export` 或文档右上 `...` 选择导出范围。
  - 导出可带层级、引用与卡片数据，便于迁移至其他工具或离线备份。
- **批量迁移建议**：在导入大体量内容前备份当前数据库（使用 `list_rem_backups` 工具或手动拷贝 `remnote.db`），完成后检查 `pendingRecomputeRems` 是否回落，以确认索引重建完毕。
