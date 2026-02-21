# 性能基线（v0.1.1）

关联规则：`docs/quality/engineering-rules.md`

## 1. 覆盖范围

性能基线用于约束以下路径：

- Less 索引构建（全量 + 增量）
- Completion / Hover / Definition provider
- 自动导入路径判重与循环依赖检查
- 高频触发下的堆内存稳定性

## 2. 基线命令

1. `npm run compile`
2. `npm run test:unit`
3. `npm run test:perf`
4. `npm run test:perf:gc`（可选，需 `--expose-gc`）
5. `npm run test:host`
6. `npm run test:host:demos`

说明：

- `test:perf*` 由 `src/test/unit/PerformanceBaseline.test.ts` 输出 `[perf]` 指标。
- host 失败时必须区分环境问题和代码问题并记录。
- 涉及 provider、索引、缓存改动，至少跑 `compile + test:unit`。
- `test:host:demos` 默认覆盖：
  - `demo/basic`
  - `demo/tsconfig-alias`
  - `demo/jsconfig-alias`
  - `demo/demo-multi-root.code-workspace`

## 3. 当前门槛

1. completion p95（1200 symbols） `< 120ms`
2. hover/definition p95（1200 symbols） `< 150ms`
3. parser 全量提取（约 1400 变量 + 500 mixin） `< 2000ms`
4. 高频触发（200 次）无明显堆增长（`test:perf:gc`）
5. 增量重建优于全量重建：
   - `avgIncremental <= avgFull * 0.6 + 5ms`

## 4. 验收标准

1. 功能不退化：补全、悬浮、跳转、自动导入结果正确。
2. 性能不退化：关键指标不低于当前门槛。
3. 内存可控：缓存可失效、可清理，无明显持续增长。

## 5. 执行建议

1. 在 CI 固定机型定期跑 `test:perf` 与 `test:perf:gc`。
2. 对 `[perf]` 指标做版本留档，便于发布前后比较。
3. 当门槛调整时，先更新测试与文档，再合并实现变更。
