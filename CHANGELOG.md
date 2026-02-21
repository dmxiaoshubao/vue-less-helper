# Changelog

All notable changes to this project will be documented in this file.

> Historical entries before `0.1.1` are migrated from `easy-use-less-vue` (previously named `easier-less-vue`).

## [0.1.1] - 2026-02-21

### Added
- 增加 `demo/basic`、`demo/tsconfig-alias`、`demo/jsconfig-alias` 三套独立 demo 工作区。
- 增加 `demo/demo-multi-root.code-workspace`，用于验证多根工作区下的隔离行为。
- 增加多工作区 host 回归脚本 `test:host:demos`，覆盖无 alias、tsconfig alias、jsconfig alias 三种场景。
- 增加 `DemoWorkspaceMultiRoot` host 回归用例，验证多根 workspace 下按根目录隔离生效。
- 性能基线测试输出 `[perf]` 指标日志，便于发布前后对比。
- 增加未配置 `lessFiles` 的首次引导提示，支持“选择文件”与“不再提示”。

### Changed
- 发布版本调整为 `0.1.1`，承接 `easy-use-less-vue@0.1.0` 的后续版本线，扩展名保持 `vue-less-helper`。
- 增加 `less.files` / `less.notice` / `less.suppressNotice` 兼容配置读取，支持旧项目平滑迁移。
- 新配置移除 `vueLessHelper.suppressNotice`，统一由 `vueLessHelper.notice` 控制提示开关；同时继续兼容读取 `less.notice` / `less.suppressNotice`。
- 项目判定由“仅 vue 依赖”升级为“vue 或 less 依赖 + 文档 Less 语境触发”，避免 `.less` 场景被误跳过。
- 移除无配置时 `@ -> src` 的兜底别名解析，仅支持已配置 alias 或相对/绝对路径。
- host 默认工作区切换为 `demo/basic`，与多 demo 结构一致。
- 补全与悬浮预览定义体保持一致，且 body 最多展示 5 行，超出显示 `...`。
- 多根工作区索引改为按 root 精准隔离：配置变更按受影响根目录重建，避免全量重建所有根目录。
- `CacheManager` 增加 workspace owner 归属，修复嵌套 root 场景下潜在符号串扰。

### Tests (Release Gate)
- `npm run compile`
- `npm run test:unit`
- `npm run test:perf`
- `npm run test:perf:gc`
- `npm run test:host`
- `npm run test:host:demos`
- `npm run test:host:vue`

### Performance Comparison

| Metric | Baseline Gate (Before) | Measured (After, 2026-02-21) |
| --- | --- | --- |
| completion p95 (1200 symbols) | `< 120ms` | `0.89ms` |
| hover p95 (1200 symbols) | `< 150ms` | `0.00ms` |
| definition p95 (1200 symbols) | `< 150ms` | `0.00ms` |
| parser full extraction (1400 vars + 500 mixins) | `< 2000ms` | `17.11ms` |
| heap growth (200 completion triggers, GC mode) | `< 8MB` | `50,536 bytes` |
| incremental reindex average | `<= full*0.6 + 5ms` | `0.52ms` (`full=7.68ms`) |

> Notes:
> - 上述实测来自 `npm run test:perf:gc` 输出的 `[perf]` 指标。
> - 测试机为当前本地开发环境，CI 上可能存在轻微波动。

## [0.1.0] - 2026-02-14

### Added
- 新增 core 模块分层：`aliasCore`、`autoImportCore`、`editorCore`、`watcherCore`、`welcomeCore`
- 新增运行时诊断模块 `diagnostics`，支持记录重载耗时、watcher 数量与注册项数量，并提供阈值/趋势判定
- 新增与完善单元测试覆盖：`aliasCore`、`autoImportCore`、`diagnostics`、`editorCore`、`getStore`、`watcherCore`、`welcomeCore`

### Changed
- 重构扩展初始化与重载流程，统一动态注册项与 watcher 的清理/重建顺序，强化生命周期管理
- 自动补全插入逻辑升级为右侧上下文感知，支持根据 `()`、参数调用、分号与注释动态选择插入模板
- `@` 补全支持光标位于标识符中间时替换右侧后缀，避免重复拼接

### Fixed
- 修复导入检测误把注释中的 `@import` 识别为已导入的问题
- 修复 Vue 文件缺少 `<style>` 标签时自动导入插入位置异常的问题
- 修复 dot 补全在断开后再次触发无建议的问题
- 修复方法补全在已有参数调用（含嵌套括号参数）时重复插入括号或分号的问题
- 修复 `@primary-color` 连字符变量在符号识别与跳转场景中的匹配问题

## [0.0.4] - 2026-01-16

### Fixed
- 修复注释中的 @import 语句也会被加载的问题

## [0.0.3] - 2026-01-14

### Added
- 自动导入 Less 文件：使用变量或类名时，如果当前文件未导入对应的 Less 文件，自动添加 `@import (reference)` 语句
- 动态别名解析：自动读取项目的 `jsconfig.json` 或 `tsconfig.json`，支持项目配置的路径别名（如 `@/`、`~/` 等）
- 防重复导入机制：智能检测已导入文件，避免重复导入（支持别名和相对路径的识别）
- 增强悬停提示功能：
  - 支持 Less 变量（如 `@primary-color`）悬停提示
  - 支持 Less 类名（如 `.bg-black`）悬停提示
  - 同时支持 `.less` 和 `.vue` 文件
  - 优化显示格式，类定义自动格式化为多行显示
- 添加调试日志，便于排查问题

### Changed
- 改进自动补全：支持在属性值位置输入部分变量名继续补全
- 优化路径生成：优先使用项目配置别名，使导入路径更简洁
- 改进悬停识别逻辑：智能识别光标所在位置的完整变量名或类名

### Fixed
- 修复自动导入时路径缺少 `.less` 后缀的问题
- 修复别名路径解析不正确导致重复导入的问题
- 修复并发导入时的竞态条件问题
- 修复初始化配置时硬编码使用 `@/` 别名的问题，现在会根据 tsconfig.json/jsconfig.json 中实际配置的别名生成路径
- 修复更改别名配置后 less.files 路径不会更新的问题，现在支持动态读取所有配置的别名

## [0.0.2] - 2025-12-04

### Added
- 实时文件监听：监听所有 Less 文件（包括递归导入的文件）的变化
- 自动重新加载：文件修改后自动重新加载，无需重启 VS Code
- 状态栏提示：加载时在状态栏显示实时状态（同步图标）
- 文件删除警告：当监听的文件被删除时显示警告消息
- 加载统计：显示已加载的 Less 文件数量

### Fixed
- 优化文件监听器的资源释放逻辑
- 改进错误处理和日志输出

## [0.0.1] - 2025-11-27

### Added
- 路径别名支持：
  - 支持 `@/` 路径别名（指向项目根目录）
  - 自动解析相对路径和绝对路径
  - 配置文件时自动转换为 `@/` 格式
- 递归导入加载：
  - 自动递归加载 `@import` 导入的所有文件
  - 智能循环引用保护
  - 支持多层嵌套导入
- 增强的 CSS 类支持：
  - 支持普通 CSS 类（如 `.button`）的自动补全
  - 支持普通 CSS 类的跳转定义
  - 自动去重，避免补全时出现双点号
- Vue SFC 智能补全：
  - 只在 `<style>` 标签内触发补全
  - 智能括号检测，避免在函数参数中误触发
  - 支持 Vue 文件中的跳转定义
- 配置改进：
  - 配置保存到工作区（`.vscode/settings.json`）而非用户设置
  - 移除重复的更新提示
  - 优化欢迎消息和配置流程

### Fixed
- 修复选择自动补全项时出现重复点号的问题（`.button` -> `..button`）
- 改进单词识别逻辑，支持识别 `.` 开头的 CSS 类名
- 优化 `isMethod` 判断，使用更精确的正则表达式

### Documentation
- 更新 README.md，添加新功能说明
- 添加配置示例和使用场景
- 添加与原版功能对比表

## [0.0.9] - Previous Version

### Features
- 基础的 Less 变量自动补全（`@` 触发）
- 基础的 Mixin 方法自动补全（`.` 触发）
- 鼠标悬浮显示变量或方法的值
- 跳转到变量或方法的定义位置
- Vue SFC 基础支持
- 配置文件选择功能
