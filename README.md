# 抖音回复助手 · 测试工具链

[抖音回复助手](https://github.com/POKMJN/douyin-reply-assistant) 的独立测试项目。包含单元测试、对话模拟器、性能基准和压力测试，用于验证 AI 回复质量、对话纪律与识别能力。

测试项目**不复制应用源码**，运行时按配置定位应用目录（见下方"准备"）。

## 快速开始

```bash
# 1. 指定应用源码位置（任选一种）
cp config.example.json config.json     # 然后编辑 sourcePath
# 或：export DRA_SOURCE=/path/to/app-source

# 2. 跑单元测试（不需要启动应用，89 项）
npm test

# 3. 连续多轮回归
node run-all.cjs 12
```

需要驱动真实模型的模拟器/基准，要先启动应用并开启调试端口：

```bash
# Windows
"抖音回复助手.exe" --remote-debugging-port=9223
```

然后：

```bash
node sim/conversation-sim.cjs        # 对话模拟（轮次纪律/视频上下文/防带偏/时间语境）
node sim/morning-sim.cjs 100         # "每天只发早上好"场景（跨天解锁/多样性）
node sim/spark-sim.cjs 200           # 续火花今日播报（天气/热点/祝福覆盖率）
node bench/ai-bench.cjs              # 识别准确度 + 效率 + 回复质量
node bench/ai-bench-chat.cjs 300     # 6 维度对话理解基准
node soak/soak-3h.cjs 60             # 压力测试（虚拟时钟马拉松 + 故障注入）
```

## 目录结构

```
lib/        共享库
  resolve-app.cjs   定位应用源码目录（env / config / 常见布局 / vendor）
  app.cjs           按相对路径加载应用模块
  cdp.cjs           Chrome DevTools 协议客户端（驱动真实应用）
  config.cjs        统一配置（端口/路径/产物目录）
  paths.cjs         报告输出目录
  setup.cjs         测试引导（electron 桩 + 内存存储）
  electron-stub.cjs require('electron') 的桩实现

unit/       单元测试（89 项，纯 Node，不需要应用运行）
  01-turn-machine      轮次状态机（同一消息只回一次、跨天解锁）
  02-context-weight    上下文权重（视频/话题/长期记忆分层）
  03-quality-gates     质量门（思考泄漏/攻击性/AI 腔/空壳/限长）
  04-draft-pipeline    回复生成链路（含故障转移、双消息、复读守卫）
  05-storage-migration 数据迁移（旧版 → 当前 schema）
  06-automation-helpers 自动化纯函数
  07-turnflow          多轮流程组合（模拟轮询）
  08-train             训练场学习链路（风格归因分流）

sim/        对话模拟器（需要应用 + 真实模型）
  conversation-sim     多场景对话
  morning-sim          "每天只发问候"跨天场景
  spark-sim            续火花播报专项

bench/      性能与质量基准
  ai-bench             准确度/效率/质量三维度
  ai-bench-chat        6 维度对话理解（300 轮）
  ai-bench-volume      大容量跑批（1000 轮，多模型轮换）

soak/       压力测试
  soak-3h              虚拟时钟对话马拉松 + 模型故障注入 + 重启恢复

verify/     运行时验证
  check-branding       界面用词检查
  verify-train         训练场链路端到端
  verify-ui-live       界面交互（滚动保持/焦点保护）
```

## 配置

复制 `config.example.json` 为 `config.json`（该文件已 gitignore，不会入库）：

```json
{
  "sourcePath": "/path/to/app-source",
  "appExe": "/path/to/抖音回复助手.exe",
  "debugPort": 9223,
  "userData": "/path/to/userData",
  "artifactsDir": ""
}
```

也可用环境变量覆盖：`DRA_SOURCE`、`DRA_APP_EXE`、`DRA_DEBUG_PORT`、`DRA_USER_DATA`、`DRA_ARTIFACTS`。

`sourcePath` 指向应用源码根目录（需含 `electron/ai-service.cjs` 与 `electron/conversation-engine.cjs`）。查找顺序：环境变量 → config.json → `./vendor/app-source` → 同级常见布局。

## 测试分层

| 层级 | 依赖 | 用途 |
|---|---|---|
| 单元测试 | 无（electron 桩 + 内存存储） | 逻辑正确性、边界条件、回归锁定 |
| 模拟器 | 应用 + 真实模型 | 对话质量、轮次纪律、上下文理解 |
| 基准 | 应用 + 真实模型 | 识别准确率、延迟分布、维度通过率 |
| 压力测试 | 无（注入 mock 传输层） | 长时间稳定性、内存、状态持久化 |
| 运行时验证 | 应用（调试端口） | 界面交互、端到端链路 |

## 注意

- **模型配额**：模拟器/基准会真实调用你配置的模型接口。免费档限流通常在 4 次/分钟量级，跑批脚本内置了节奏控制与冷却自愈；大量测试前建议确认配额。
- **测试数据**：模拟器使用 `模拟·` / `simspark·` / `morningsim·` 前缀的联系人，运行结束会清理；`bench·` / `训练·` 前缀的临时对象也会清理。
- **产物**：报告与逐轮 JSONL 写入 `artifacts/`（已 gitignore）。
- 压力测试的故障注入率按虚拟时钟调低（≤0.5%），避免冷却锁死模型池导致失真。

## 许可

仅供个人学习与自用。
