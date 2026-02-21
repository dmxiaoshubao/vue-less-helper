# 工程协作规则（v0.1.1）

目标：保证 `vue-less-helper` 在功能一致性、性能、内存和可回归性上持续稳定。

## 1. 执行优先级

1. 功能正确性优先。
2. 与 `easy-use-less-vue` 兼容优先（读取旧配置，写入新配置）。
3. 热路径性能优先（completion/hover/definition）。
4. 回归可验证优先（先补测试再改逻辑）。

## 2. 当前功能边界（必须遵守）

1. 生效语境仅限：
   - `.less` 文档
   - Vue SFC 的 `<style lang="less">`
2. 预览规则统一：
   - completion 与 hover 使用同一预览格式
   - mixin body 最多展示 5 行，超出为 `...`
3. 路径解析只支持：
   - 相对路径
   - 绝对路径
   - `tsconfig/jsconfig` 的 `baseUrl + paths`
4. 不允许引入隐式别名兜底（例如 `@ -> src`）。
5. 自动导入默认禁止不安全循环导入，优先导入符号定义文件。
6. 多根工作区必须按根目录隔离：
   - 索引、补全、悬浮、定义、自动导入均以当前文档所属 root 为准
   - 配置变化应尽量只重建受影响 root

## 3. 配置规则（必须遵守）

1. 新配置仅使用：
   - `vueLessHelper.lessFiles`
   - `vueLessHelper.notice`
2. 兼容读取旧配置：
   - `less.files`
   - `less.notice`
   - `less.suppressNotice`
3. 引导中的“不再提示”只应写入 `vueLessHelper.notice=false`。

## 4. 性能与内存规则

1. Provider 内避免重复构建全量集合；同次请求复用缓存结果。
2. alias 解析必须缓存，配置变更后再失效。
3. 文件监听必须去抖与合并，避免重复全量重建。
4. 索引改动优先走增量重建，不默认全量清空。
5. 支持 cancellation token 的路径必须尽早短路。

## 5. 测试规则（必须遵守）

1. 功能变更至少覆盖：
   - 正向命中
   - 负向防误判
   - 编辑中不完整语法
2. 至少执行：
   - `npm run test:unit`
3. 涉及宿主行为、配置读取、自动导入时，补跑：
   - `npm run test:host`
   - `npm run test:host:demos`
4. 涉及性能或缓存改动时，补跑：
   - `npm run test:perf`
   - `npm run test:perf:gc`（可选）

## 6. 默认交付流程

1. 明确行为差异与目标（含兼容策略）。
2. 最小化实现改动并补充回归用例。
3. 执行测试并记录结果。
4. 更新 README / docs / changelog，保持文档与实现一致。
