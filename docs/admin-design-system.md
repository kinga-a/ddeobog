# 后台组件规范（重构基线）

- 版本：v1.0（2026-11-11）
- 适用范围：5iblog `/admin` 全部页面
- 目标：在不改变现有信息架构的前提下，补齐令牌、统一组件尺寸与状态、满足 WCAG 2.1 AA
- 配套文件：`docs/admin-ui-review.md`（问题与证据）、`docs/admin-ui-tokens.css`（可落地基线）

## 一、设计原则

1. **任务优先**：每个页面只有一个视觉最强的主动作；危险操作默认降权。
2. **一套尺寸**：同一层级的按钮、输入框、表格行只允许一个高度值。
3. **令牌先行**：颜色、字号、间距、圆角、动效不得在组件里写死。
4. **状态完整**：默认 / hover / active / focus-visible / disabled / loading / error 七态必须定义。
5. **无障碍内建**：标签、焦点、对比度、触摸目标在组件层解决，不靠页面补丁。

## 二、设计令牌

### 2.1 颜色（语义）

保留现有 zinc + 靛蓝体系，补齐控件边界与辅助文本：

| 令牌 | 浅色 | 深色 | 用途 | 对比度（浅色） |
|---|---|---|---|---|
| `--paper` | `#f6f6f7` | `#0d0d10` | 页面底色 | — |
| `--surface` | `#ffffff` | `#151519` | 卡片/输入框 | — |
| `--surface-2` | `#fafafa` | `#1a1a1f` | 侧栏、次级块 | — |
| `--surface-3` | `#f0f0f2` | `#222228` | hover 底色 | — |
| `--line` | `#e3e3e8` | `#26262d` | 分隔线（非控件边界） | 1.28（仅装饰） |
| `--control-border` | `#8f8f9b` | `#5b5b68` | **输入框/下拉边界** | 3.2 ✅ |
| `--ink` | `#17171c` | `#f4f4f6` | 主文本 | 17.0 ✅ |
| `--ink-2` | `#3f3f46` | `#d6d6dc` | 次文本 | 10.4 ✅ |
| `--ink-3` | `#6d6d78` | `#9c9ca8` | 辅助文本/占位 | 5.5 ✅ |
| `--ink-4` | `#a7a7b3` | `#62626e` | 仅禁用/装饰 | 2.4 ❌ 不用于文本 |
| `--accent` | `#5e6ad2` | `#8b96f9` | 焦点、选中 | 5.0 ✅ |
| `--accent-soft` | `#eef0fb` | `#1e2138` | 选中底色 | — |
| `--danger` | `#d92d20` | `#ff6b5e` | 危险文本 | 5.1 ✅ |
| `--ok` | `#177245` | `#3ecf8e` | 成功 | 5.2 ✅ |
| `--warn` | `#a15c00` | `#f5b544` | 警告 | 5.0 ✅ |

规则：
- 正文不得使用 `--ink-4`；侧栏分组标题、版本号改用 `--ink-3`。
- 非文本边界（输入框、复选框、分割线中的功能性边界）≥ 3:1；纯装饰分割线可低于 3:1。
- 深色模式按上表映射，对比度同样满足 AA。

### 2.2 字号与行高

| 令牌 | 值 | 行高 | 用途 |
|---|---|---|---|
| `--text-2xs` | 12px | 1.45 | 表格元信息、徽标、辅助说明 |
| `--text-xs` | 13px | 1.5 | 表格正文、面包屑 |
| `--text-sm` | 14px | 1.6 | 表单、正文、按钮 |
| `--text-md` | 16px | 1.5 | 导航、卡片标题 |
| `--text-lg` | 20px | 1.35 | 页面标题 |
| `--text-xl` | 24px | 1.25 | 仪表盘 hero |
| `--text-2xl` | 28px | 1.2 | 登录页品牌 |

删除 11 / 11.5 / 12.5 / 13.5 / 14.5 / 15 / 18 / 23 等零散档位；确实需要更小文字的，用 12px + `--ink-3`。

### 2.3 间距（4px 基准）

`--space-1: 4px`、`--space-2: 8px`、`--space-3: 12px`、`--space-4: 16px`、`--space-6: 24px`、`--space-8: 32px`、`--space-12: 48px`、`--space-16: 64px`。

- 组件内边距：8 / 12 / 16 / 24
- 卡片间距：16 / 24
- 页面区块：24 / 32 / 48
- 不允许 6 / 9 / 10 / 11 / 13 / 18 / 22 / 26 / 30 等随意值（现有 `td a.btn` 的 6px 改为 gap 8px）。

### 2.4 圆角、阴影、动效、控件高度

| 类别 | 令牌 | 值 |
|---|---|---|
| 圆角 | `--r-xs` / `--r-sm` / `--r-md` / `--r-lg` / `--r-xl` / `--r-pill` | 6 / 8 / 10 / 14 / 18 / 999 |
| 阴影 | `--sh-1` / `--sh-2` / `--sh-3` | 现有三档 |
| 动效 | `--t-fast` / `--t` / `--t-slow` | 120 / 180 / 260ms |
| 控件高度 | `--control-h-xs` / `sm` / `md` / `lg` / `xl` | 28 / 32 / 36 / 40 / 44 |

动效统一 `cubic-bezier(.22,.68,.32,1)`；`prefers-reduced-motion: reduce` 下位移与缩放归零，仅保留透明度变化。

## 三、组件规范

### 3.1 Button

| 变体 | 背景 | 文本 | 边框 | 用途 |
|---|---|---|---|---|
| `primary` | `--ink` | `#fff` | `--ink` | 页面唯一主动作 |
| `secondary` | `--surface` | `--ink` | `--control-border` | 次要动作 |
| `ghost` | 透明 | `--ink-3` | 透明 | 表格行内操作 |
| `danger` | `--surface` | `--danger` | `--line` | 删除（默认态） |
| `danger-solid` | `--danger` | `#fff` | `--danger` | 仅确认框内"确定删除" |

尺寸：

| 尺寸 | 高度 | 内边距 | 字号 | 圆角 | 场景 |
|---|---|---|---|---|---|
| xs | 28 | 0 10 | 12 | 6 | 表格紧凑操作（桌面） |
| sm | 32 | 0 12 | 13 | 8 | 行内操作 |
| md | 36 | 0 16 | 14 | 10 | 默认 |
| lg | 44 | 0 20 | 14 | 10 | 表单主按钮、移动端所有按钮 |

状态：
- hover：背景加深/边框 `--ink-4`，`translateY(-1px)`（reduced-motion 关闭）
- active：`scale(.99)`，阴影移除
- focus-visible：`outline: 2px solid var(--accent); outline-offset: 2px`
- disabled：`opacity: .45; cursor: not-allowed`
- loading：左侧 14px spinner + `aria-busy="true"`，宽度不塌陷

规则：纯图标按钮必须 `aria-label`；危险动作必须有确认；移动端（`pointer: coarse`）一律 ≥44px。

### 3.2 Input / Select / Textarea

- 高度：`--control-h-xl`（40px）；多行 textarea 最小 120px。
- 边框：`1px solid var(--control-border)`；hover `--ink-4`；focus `border-color: var(--accent)` + `box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent)`。
- 圆角 `--r-md`（10px）；内边距 `0 12px`。
- 标签：14px / 500 / `--ink-2`，与控件间距 8px；必须 `<label for="id">` 关联。
- 帮助文本：12px / `--ink-3`，`id` 通过 `aria-describedby` 关联。
- 错误文本：12px / `--danger`，同时给控件 `aria-invalid="true"` 与 `aria-describedby`。
- 必填：`required` + 标签旁 `*`（`aria-hidden="true"`），或直接标注"必填"。
- 禁止用 placeholder 代替 label。

```html
<div class="field">
  <label for="post-title">标题</label>
  <input id="post-title" name="title" required aria-describedby="post-title-help">
  <p id="post-title-help" class="field__help">建议 20–40 字。</p>
</div>
```

### 3.3 Checkbox / Radio / Switch

- 视觉尺寸 16px，点击热区 ≥ 40px（用 label 包裹扩大热区）。
- 勾选态使用 `--accent`，未选边界 `--control-border`。
- 必须有可见 label；说明文字用 `aria-describedby`。
- Switch 使用原生 checkbox + `role="switch"`（或保留 checkbox 语义），`aria-checked` 与视觉状态同步。

### 3.4 Table

- 表头：12px / 600 / `--ink-3`，`th scope="col"`，禁止大写转换（中文无效）。
- 行高：桌面 48px；单元格内边距 `10px 12px`；数字列 `font-variant-numeric: tabular-nums`。
- 操作列：右对齐，`display:flex; gap:8px; justify-content:flex-end`。
- 表格容器：`overflow-x:auto`，`border:1px solid var(--line)`，圆角 `--r-lg`。
- 空状态：`<tr><td colspan="N">` 内放空状态组件，不只写"暂无"。
- 移动端（≤760px）：转为卡片列表：
  - 首行：标题 + 状态徽标
  - 次行：时间 / 评论数 / 分类
  - 操作：独立一行，按钮 44px
  - 隐藏 ID、作者等次要列；需要时放入"详情"。
- 分页：`<nav aria-label="分页">`；当前页 `aria-current="page"`；上/下页有可访问名称。

### 3.5 Sidebar Navigation

- 宽度 240px；分组标题 12px / 600 / `--ink-3`（不得用 `--ink-4`）。
- 链接高度 36px（移动端 44px）；图标 16px；图标 `aria-hidden="true"`。
- 当前项：`aria-current="page"` + `--accent-soft` 背景 + `--accent-ink` 文本 + 左侧 2px 指示条。
- 窄屏（≤1080px）折叠为图标模式时，必须保留 `aria-label` 与 tooltip。
- 页面首个焦点为"跳到主要内容"链接（视觉隐藏，聚焦时显示）。

### 3.6 Page Header

- 页面唯一 `h1`（视觉可沿用 20px + 3.5px 竖条）。
- 标题右侧最多一个主按钮（`primary`）；次要操作放 `secondary` 或溢出菜单。
- 面包屑：`nav aria-label="面包屑"`，当前页用文本而非链接。
- 标题与内容间距 24px。

### 3.7 Card

- 背景 `--surface`，边框 `1px solid var(--line)`，圆角 `--r-lg`，阴影 `--sh-1`。
- 内边距：桌面 24px，移动 16px。
- 卡片标题用 `h2`（页面级卡片）或 `h3`（卡片内小节）；标题 16px / 600。
- 卡片内表单分区使用 `<details>` 时，`summary` 必须有可见文本与展开图标（现有实现可保留）。

### 3.8 Modal（确认框）

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby` 指向标题。
- 打开：焦点移到"取消"按钮（危险操作默认安全项）；背景内容 `inert`。
- Tab / Shift+Tab 在弹窗内循环；Esc 关闭；点击遮罩关闭（需与业务确认）。
- 关闭：焦点归还触发按钮。
- 按钮顺序：取消（左）/ 确定（右）；确定使用 `danger-solid` 并写明动作（"删除评论"）。
- 弹窗必须存在于脚本可查询的 DOM 之后，或使用 `DOMContentLoaded` / 事件委托绑定。

### 3.9 Toast / 反馈

- 成功：`role="status"` / `aria-live="polite"`，4 秒自动消失。
- 错误：`role="alert"` / `aria-live="assertive"`，需手动关闭。
- 位置：右下角，宽度 ≤ 360px，不遮挡主操作；移动端置底。
- 文案格式：动词 + 对象 + 结果（"文章已发布"、"删除失败，请重试"）。

### 3.10 Empty State

- 结构：图标（`aria-hidden`）+ 标题 + 一句说明 + 主操作按钮。
- 例：`还没有文章` / `发布第一篇，开始记录。` / `[写文章]`。
- 禁止只有"暂无数据"。

### 3.11 Badge / Status

- 高度 20px，圆角 `--r-pill`，12px / 500。
- 语义色：成功 `ok-soft/ok`、警告 `warn-soft/warn`、危险 `danger-soft/danger`、中性 `surface-3/ink-3`。
- 状态不能只靠颜色区分，需有文字（"已通过 / 待审核"）。

## 四、无障碍规范

### 4.1 对比度

- 正文 ≥ 4.5:1；大字（≥18.66px 且 600，或 ≥24px）≥ 3:1。
- 控件边界、焦点环、图标按钮 ≥ 3:1。
- 禁用态可低于标准，但必须同时有 `disabled` 语义与视觉提示。

### 4.2 键盘与焦点

- 所有功能可仅用键盘完成；Tab 顺序遵循视觉顺序。
- 焦点环：2px `--accent` + 2px offset，禁止 `outline:none`。
- 弹窗焦点陷阱；关闭归还焦点。
- 侧栏前提供 skip link；折叠面板使用原生 `<details>`（现有实现可保留）。

### 4.3 表单

- 每个控件有可访问名称（label / aria-label）。
- 错误通过 `aria-invalid` + `aria-describedby` 关联；错误摘要用 `role="alert"`。
- 不用 placeholder 替代 label；必填有文本标识。

### 4.4 触摸与缩放

- 移动端触摸目标 ≥44×44px；桌面最小 24×24px（WCAG 2.5.8）。
- 200% 字体缩放时页面不横向滚动；表格允许容器内滚动。
- 正文行高 ≥1.5，段落间距 ≥1.5 倍字号。

### 4.5 动效

- `prefers-reduced-motion: reduce` 下关闭位移、缩放、视差；保留透明度过渡。
- 自动播放/轮播需可暂停（当前后台无此组件）。

## 五、响应式规范

| 断点 | 宽度 | 行为 |
|---|---|---|
| 宽屏 | ≥1280px | 侧栏 240px，主区最大 1240px |
| 桌面 | 1081–1279px | 侧栏 240px，主区 padding 28px |
| 平板 | 761–1080px | 侧栏收为 72px 图标模式，主区 padding 24px |
| 手机 | ≤760px | 侧栏抽屉 + 遮罩，主区 padding 16px，表格卡片化，按钮 44px |

只保留 4 个断点；删除重复的 700/760/1080/1100 组合，统一到上表。

## 六、迁移步骤

1. **接入令牌**：把 `docs/admin-ui-tokens.css` 的 `:root` 变量合并进 `admin.css`，先不改组件。
2. **替换颜色**：把散落的 98 处硬编码颜色按语义映射到令牌；优先处理 `--ink-4` 文本与输入框边框。
3. **统一控件尺寸**：按 3.1–3.2 替换 `.btn` / `.input` 高度与内边距，删除 `.btn.mini` 与 `.btn.sm` 的重复定义。
4. **修表单语义**：为所有字段补 `id` + `for`；自定义字段补 label。
5. **修弹窗**：调整脚本与 `.ui-modal` 顺序，补焦点陷阱与归还焦点。
6. **修表格**：补 `th scope`；移动端卡片化；操作区改 flex gap。
7. **页面标题**：主标题 h2 → h1，卡片标题降级；补 skip link 与 `<main id="main">`。
8. **视觉回归**：对 10 个后台页面做 1366/768/375 三档截图对比；跑 axe 与键盘走查。

## 七、验收标准

- axe-core：0 critical / 0 serious（登录、仪表盘、文章、编辑器、设置、评论、备份）
- 对比度：脚本扫描无正文 <4.5、无控件边界 <3
- 键盘：登录 → 发文 → 审核 → 删除确认 → 退出，全流程无鼠标
- 移动端：375px 无横向溢出，所有操作按钮 ≥44px
- 弹窗：焦点进入、循环、Esc、归还焦点全部通过
- 设计令牌：`admin.css` 中不再出现新的硬编码颜色/字号/间距（lint 规则可选）

> 本规范是重构目标，不是现状描述；落地时按阶段推进，避免一次性重写造成回归。