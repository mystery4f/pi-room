# pi-room

> **EN**: Room-based broadcast collaboration for pi — a serverless JSONL file bus (`<project>/.pi/rooms/<roomId>.jsonl`, append-only). Three tools: `room_join`, `room_broadcast` (fire-and-forget, no online requirement), `room_read` (paged replay). Rooms are isolated by id (instance slug included) and archivable by plain file moves.

房间广播协同：JSONL 文件总线。三工具：`room_join` / `room_broadcast` / `room_read`。

- **异步无在线要求**：broadcast 即写即返（append-only），接收方按自己节奏 read 回看
- **跨进程安全**：无服务器，一行一条 JSON 消息，天然可回放可归档
- **隔离**：房间 id 即命名空间（建议 `flow/<模板>/<实例>/batch-<order>`），不同实例互不可见

## 存储约定（公开契约）

- 位置：`<项目>/.pi/rooms/<roomId>.jsonl`（UTF-8，LF，一行一条）
- 消息结构：`{index, ts, from, type: "join"|"broadcast", body?, to?}`，index 为行号（0 起）
- 房间文件惰性创建；归档 = 调用方把文件搬走（如 flow 批次结束搬入 state 目录）

## 工具

| 工具 | 参数 | 语义 |
| ---- | ---- | ---- |
| `room_join` | roomId, from? | 加入房间（记录一行 join），返回当前成员 |
| `room_broadcast` | roomId, from, body, to? | 广播一条消息，立即返回（不阻塞、无在线要求） |
| `room_read` | roomId, since? | 回看消息（since=行号，只看之后的），返回 nextSince |

## 协同四场景（并行批次）

冲突预警（要写的文件撞车）/ 成果共享（先完成方广播关键结论）/ 快速对齐（格式分歧广播提问）/ 卡住求助（依赖未完成就广播说明）。原则：能靠上下文避让就不通信，通信是兜底。

## 测试

```bash
npm test
```
