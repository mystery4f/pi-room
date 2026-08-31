/**
 * pi-room —— 房间广播协同（JSONL 文件总线）
 *
 * 三工具：room_join / room_broadcast / room_read。
 * 存储公开契约：<项目>/.pi/rooms/<roomId>.jsonl，append-only，一行一条 JSON：
 *   { index, ts, from, type: "join"|"broadcast", body?, to? }
 *
 * 异步语义：broadcast 即写即返（不阻塞、无在线要求）；read 按行号回看。
 * 归档语义：房间文件可被调用方整体搬走（append-only 文件搬运即完整迁移，不丢消息）。
 *
 * @author mystery4f
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type RoomMessageType = "join" | "broadcast" | "system";

export interface RoomMessage {
  index: number;
  ts: string;
  from: string;
  type: RoomMessageType;
  body?: string;
  to?: string;
}

export interface PiRoomLike {
  registerTool(tool: {
    name: string;
    label?: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }): Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
  }): void;
}

// ------------------------------------------------------------ 存储核心 ----------

export function roomsRoot(cwd: string): string {
  return path.join(cwd, ".pi", "rooms");
}

function sanitizeSeg(s: string): string {
  const seg = s.trim();
  if (!seg || seg === "." || seg === ".." || /[\\:*?"<>|]/.test(seg)) {
    throw new Error("非法房间 id 段：「" + s + "」（不允许空段/./../路径分隔符与特殊字符）");
  }
  return seg;
}

export function roomFilePath(cwd: string, roomId: string): string {
  const segs = roomId.split("/").map(sanitizeSeg);
  if (segs.length === 0) throw new Error("房间 id 不能为空");
  return path.join(roomsRoot(cwd), ...segs) + ".jsonl";
}

function rawLines(fp: string): string[] {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, "utf8").split("\n").filter((l) => l.trim() !== "");
}

export function appendMessage(cwd: string, roomId: string, msg: { from: string; type: RoomMessageType; body?: string; to?: string }): RoomMessage {
  const fp = roomFilePath(cwd, roomId);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const m: RoomMessage = {
    index: rawLines(fp).length,
    ts: new Date().toISOString(),
    from: msg.from,
    type: msg.type,
    ...(msg.body !== undefined ? { body: msg.body } : {}),
    ...(msg.to !== undefined ? { to: msg.to } : {}),
  };
  fs.appendFileSync(fp, JSON.stringify(m) + "\n", "utf8");
  return m;
}

export function readMessages(cwd: string, roomId: string, since = -1): RoomMessage[] {
  const out: RoomMessage[] = [];
  for (const line of rawLines(roomFilePath(cwd, roomId))) {
    try {
      const m = JSON.parse(line) as RoomMessage;
      if (typeof m.index === "number" && m.index > since) out.push(m);
    } catch {
      // 半行/损坏行跳过（append-only 总线在极端并发下可能产生半行）
    }
  }
  return out;
}

export function archiveRoom(cwd: string, roomId: string, destFile: string): { moved: number; from?: string; to: string } {
  const src = roomFilePath(cwd, roomId);
  const to = path.resolve(destFile);
  if (!fs.existsSync(src)) return { moved: 0, to };
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const moved = rawLines(src).length;
  fs.renameSync(src, to);
  return { moved, from: src, to };
}

export function members(cwd: string, roomId: string): string[] {
  const seen: string[] = [];
  for (const m of readMessages(cwd, roomId)) {
    if (m.type === "join" && !seen.includes(m.from)) seen.push(m.from);
  }
  return seen;
}

// ------------------------------------------------------------ 工具注册 ----------

const TOOL_DESCRIPTIONS = {
  join: "加入协同房间（记录成员）。并行批次成员在开工前调用一次。",
  broadcast: "向房间广播一条消息（异步、即写即返、无在线要求）。场景：冲突预警/成果共享/快速对齐/卡住求助。",
  read: "回看房间消息（since=已看过的最大行号，返回之后的）。随时可读，不要求在线。",
};

function textResult(text: string): { content: Array<{ type: string; text: string }>; details: unknown } {
  return { content: [{ type: "text", text }], details: {} };
}

const objectSchema = (properties: Record<string, unknown>, required: string[]): unknown => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export default function piRoom(pi: PiRoomLike): void {
  pi.registerTool({
    name: "room_join",
    label: "Room Join",
    description: TOOL_DESCRIPTIONS.join,
    parameters: objectSchema(
      {
        roomId: { type: "string", description: "房间 id，如 flow/sdd/my-feature/batch-10" },
        from: { type: "string", description: "你的身份名（agent 名或 主会话），缺省为主会话" },
      },
      ["roomId"],
    ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const from = typeof params.from === "string" && params.from.trim() ? params.from.trim() : "主会话";
      const m = appendMessage(ctx.cwd, String(params.roomId), { from, type: "join" });
      const all = members(ctx.cwd, String(params.roomId));
      return textResult("已加入房间 " + params.roomId + "（index " + m.index + "）。当前成员：" + (all.join(", ") || from));
    },
  });

  pi.registerTool({
    name: "room_broadcast",
    label: "Room Broadcast",
    description: TOOL_DESCRIPTIONS.broadcast,
    parameters: objectSchema(
      {
        roomId: { type: "string", description: "房间 id" },
        from: { type: "string", description: "你的身份名" },
        body: { type: "string", description: "消息内容（冲突预警请带文件路径；成果共享请带结论与出处）" },
        to: { type: "string", description: "可选定向（@某成员）；缺省全员" },
      },
      ["roomId", "from", "body"],
    ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const m = appendMessage(ctx.cwd, String(params.roomId), {
        from: String(params.from),
        type: "broadcast",
        body: String(params.body),
        ...(typeof params.to === "string" && params.to.trim() ? { to: params.to.trim() } : {}),
      });
      return textResult("已广播（index " + m.index + "），异步可达，无需等待。");
    },
  });

  pi.registerTool({
    name: "room_read",
    label: "Room Read",
    description: TOOL_DESCRIPTIONS.read,
    parameters: objectSchema(
      {
        roomId: { type: "string", description: "房间 id" },
        since: { type: "number", description: "已看过的最大行号（返回之后的消息）；缺省从头" },
      },
      ["roomId"],
    ),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const since = typeof params.since === "number" ? params.since : -1;
      const msgs = readMessages(ctx.cwd, String(params.roomId), since);
      if (msgs.length === 0) return textResult("房间 " + params.roomId + " 暂无 index > " + since + " 的消息。");
      const lines = msgs.map((m) => "[" + m.index + "] " + m.ts.slice(11, 19) + " " + m.from + (m.to ? " → " + m.to : "") + "：" + (m.body ?? "(" + m.type + ")"));
      const nextSince = msgs[msgs.length - 1]!.index;
      return textResult(lines.join("\n") + "\n（下次从 since=" + nextSince + " 继续）");
    },
  });
}
