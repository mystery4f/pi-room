# HANDOVER.md —— pi-room 交接

> 姊妹仓库 pi-flow-composer 有完整交接文档（HANDOVER.md），本篇是 room 侧速查。

## 这是什么

pi 的房间广播协同插件（独立包，v0.1.0，发布时升 1.0.0）。JSONL 文件总线实现房间通信：append-only、无服务器、跨进程安全、天然可回放可审计。

## 三工具

- room_join(roomId)：加入房间（记录成员）
- room_broadcast(roomId, msg)：即写即返广播（<200ms，不阻塞发送方）
- room_read(roomId, since?)：按行号分页回看历史

## 存储契约（公开约定，被 flow 依赖）

- 房间文件：.pi/rooms/<roomId>.jsonl（roomId 嵌套目录镜像层级，如 flow/sdd/<实例>/batch-10）
- 一行一条消息：{ts, from, to?, body}
- 损坏行容忍（跳过不崩）
- 归档 = rename 整体搬运（同卷原子，append-only 下等价完整）——禁止读-写复制，此为实现约束

## 硬约束

- 与 flow 的关系：flow 只依赖「三工具存在且语义符合」+ 本存储契约，零 import——改工具名/语义/路径前必须与 flow 侧（PM 会话）确认
- 写入边界：rooms/** 归本包；flow 只写 state/**
- author：mystery4f
- 零构建零依赖

## 当前状态

- 10/10 自测全绿；真机加载冒烟通过（Enabled 3 new tools）
- npm publish 待命（等 flow v1.0 验收触发，whoami 核 mystery4f）
- 远端：https://github.com/mystery4f/pi-room.git @ 8f57969

## 自测

node --experimental-strip-types --test scripts/selftest.ts

完整设计上下文见 pi-flow-composer/HANDOVER.md 与 shui4 知识库 area/project/pi sdd 插件/。
