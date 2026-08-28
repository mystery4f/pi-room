/**
 * pi-room 行为自测（零依赖）
 * 覆盖：异步即写即返 / 行号顺序 / since 分页 / 实例隔离 / 归档完整搬移不丢消息 /
 *       非法 roomId 拒绝 / 损坏行容忍 / 三工具注册形状与 execute 冒烟
 *
 * @author dongcheng.xie
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import piRoom, { appendMessage, archiveRoom, members, readMessages, roomFilePath } from "../extensions/room.ts";

let passed = 0;
const failures: string[] = [];
function ok(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log("  ✓ " + name);
    })
    .catch((e) => {
      failures.push(name + " :: " + (e && e.message ? e.message : String(e)));
      console.log("  ✗ " + name + "\n    " + (e && e.message ? e.message : e));
    });
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-room-test-"));
}

async function main(): Promise<void> {
  console.log("pi-room selftest\n");
  const cwd = tempRoot();

  await ok("异步即写即返：broadcast 立即返回且落盘可读（验收 a）", () => {
    const before = Date.now();
    const m = appendMessage(cwd, "flow/sdd/s1/batch-10", { from: "写手", type: "broadcast", body: "我要写 specs/a.md，注意避让" });
    assert.ok(Date.now() - before < 200, "广播不应阻塞");
    assert.equal(m.index, 0);
    assert.equal(readMessages(cwd, "flow/sdd/s1/batch-10").length, 1);
  });

  await ok("行号连续递增；join 记录成员", () => {
    appendMessage(cwd, "flow/sdd/s1/batch-10", { from: "写手", type: "join" });
    appendMessage(cwd, "flow/sdd/s1/batch-10", { from: "施工员", type: "join" });
    const m3 = appendMessage(cwd, "flow/sdd/s1/batch-10", { from: "施工员", type: "broadcast", body: "共享结论 X" });
    assert.equal(m3.index, 3);
    assert.deepEqual(members(cwd, "flow/sdd/s1/batch-10"), ["写手", "施工员"]);
  });

  await ok("验收 b 隔离性：不同实例（slug）房间互不可见", () => {
    appendMessage(cwd, "flow/sdd/s2/batch-10", { from: "别人", type: "broadcast", body: "另一个实例的消息" });
    const s1 = readMessages(cwd, "flow/sdd/s1/batch-10");
    assert.ok(!s1.some((m) => m.from === "别人"), "s1 不应看到 s2 消息");
    assert.equal(readMessages(cwd, "flow/sdd/s2/batch-10").length, 1);
  });

  await ok("since 分页：只回看之后的消息", () => {
    const later = readMessages(cwd, "flow/sdd/s1/batch-10", 1);
    assert.equal(later.length, 2);
    assert.equal(later[0]!.index, 2);
  });

  await ok("验收 c 归档完整性：整体搬移不丢消息，源文件消失", () => {
    appendMessage(cwd, "flow/sdd/s1/batch-10", { from: "主会话", type: "broadcast", body: "裁决：按 A 方案" });
    const before = readMessages(cwd, "flow/sdd/s1/batch-10");
    const dest = path.join(cwd, "archive", "batch-10.jsonl");
    const res = archiveRoom(cwd, "flow/sdd/s1/batch-10", dest);
    assert.equal(res.moved, before.length);
    assert.ok(!fs.existsSync(roomFilePath(cwd, "flow/sdd/s1/batch-10")), "源文件应消失");
    const lines = fs.readFileSync(dest, "utf8").trim().split("\n");
    assert.equal(lines.length, before.length, "不丢消息");
    const reparsed = lines.map((l) => JSON.parse(l) as { index: number });
    assert.deepEqual(reparsed.map((m) => m.index), before.map((m) => m.index));
  });

  await ok("归档不存在的房间：moved=0 不报错", () => {
    const res = archiveRoom(cwd, "flow/x/y/batch-99", path.join(cwd, "archive", "none.jsonl"));
    assert.equal(res.moved, 0);
  });

  await ok("非法 roomId 拒绝（穿越/空段/特殊字符）", () => {
    for (const bad of ["../evil", "a//b", "a/../b", "a|b", ""]) {
      assert.throws(() => roomFilePath(cwd, bad));
    }
  });

  await ok("损坏行容忍：半行不致 read 崩溃", () => {
    const room = "flow/t/half/batch-1";
    appendMessage(cwd, room, { from: "a", type: "broadcast", body: "1" });
    appendMessage(cwd, room, { from: "b", type: "broadcast", body: "2" });
    fs.appendFileSync(roomFilePath(cwd, room), '{"index":2,"from":"半', "utf8");
    assert.equal(readMessages(cwd, room).length, 2);
  });

  await ok("三工具注册形状：名称/描述/execute 存在", () => {
    const registered: Array<{ name: string; description: string; execute: unknown }> = [];
    piRoom({ registerTool: (t) => registered.push(t as never) });
    assert.deepEqual(registered.map((t) => t.name).sort(), ["room_broadcast", "room_join", "room_read"]);
    for (const t of registered) {
      assert.ok(t.description.length > 8, t.name + " 缺描述");
      assert.equal(typeof t.execute, "function");
    }
  });

  await ok("工具 execute 冒烟：join→broadcast→read 走通", async () => {
    type Tool = { execute: (id: string, params: Record<string, unknown>, s: unknown, u: unknown, ctx: { cwd: string }) => Promise<{ content: Array<{ type: string; text: string }> }> };
    const registered = new Map<string, Tool>();
    piRoom({ registerTool: (t) => registered.set(t.name, t as never) });
    const dir = tempRoot();
    await registered.get("room_join")!.execute("i1", { roomId: "flow/t/i1/batch-1", from: "施工员" }, null, null, { cwd: dir });
    await registered.get("room_broadcast")!.execute("i2", { roomId: "flow/t/i1/batch-1", from: "施工员", body: "B 方案可行" }, null, null, { cwd: dir });
    const read = await registered.get("room_read")!.execute("i3", { roomId: "flow/t/i1/batch-1" }, null, null, { cwd: dir });
    const text = read.content[0]!.text;
    assert.ok(text.includes("施工员") && text.includes("B 方案可行") && text.includes("since="), text);
  });

  console.log("");
  if (failures.length) {
    console.error(failures.length + " FAILED / " + (passed + failures.length));
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(passed + "/" + passed + " PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
