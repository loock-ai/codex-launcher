import { describe, expect, it } from "vitest";
import {
  aggregateThreads,
  filterAggregatedThreads,
  groupThreadsByProject,
  splitAllThreads,
} from "../../src/features/threads/thread-list-model";

const backends = [
  { id: "book", name: "MacBook" },
  { id: "mini", name: "Mac mini" },
];

describe("会话列表派生", () => {
  it("元数据批量同步不改变会话活动时间与排序，旧协议仍回退更新时间", () => {
    const rows = aggregateThreads(backends.slice(0, 1), {book:[
      {id:"morning", updatedAt:10000, recencyAt:1000},
      {id:"afternoon", updatedAt:9000, recencyAt:8000},
      {id:"legacy", updatedAt:5000, recencyAt:null},
    ]});
    expect(rows.map(row=>[row.threadId,row.timestamp])).toEqual([
      ["afternoon",8000],["legacy",5000],["morning",1000],
    ]);
  });
  const items = aggregateThreads(backends, {
    book: [
      {
        id: "book-pinned",
        preview: "优化移动端会话列表",
        cwd: "/Users/me/codex-web-mobile",
        updatedAt: 30,
        isPinned: true,
      },
      {
        id: "book-recent",
        preview: "查看 Docker 配置",
        cwd: "/Users/me/infra",
        updatedAt: 20,
      },
    ],
    mini: [
      {
        id: "mini-pinned",
        preview: "HA运维",
        cwd: "/srv/home-assistant",
        updatedAt: 40,
        isPinned: true,
      },
      {
        id: "mini-recent",
        preview: "查找 TTS Key",
        cwd: "/srv/sub2api/",
        updatedAt: 10,
      },
      {
        id: "mini-unknown",
        preview: "未知目录",
        cwd: null,
        createdAt: 5,
      },
    ],
  });

  it("为线程附加机器和项目来源并按时间降序汇总", () => {
    expect(items.map((item) => item.threadId)).toEqual([
      "mini-pinned",
      "book-pinned",
      "book-recent",
      "mini-recent",
      "mini-unknown",
    ]);
    expect(items[0]).toMatchObject({
      backendId: "mini",
      backendName: "Mac mini",
      projectName: "home-assistant",
      pinned: true,
    });
    expect(items.at(-1)?.projectName).toBe("未识别项目");
  });

  it("全部视图把置顶和最近拆分且不重复", () => {
    const groups = splitAllThreads(items);
    expect(groups.pinned.map((item) => item.threadId)).toEqual([
      "mini-pinned",
      "book-pinned",
    ]);
    expect(groups.recent.map((item) => item.threadId)).toEqual([
      "book-recent",
      "mini-recent",
      "mini-unknown",
    ]);
  });

  it("单机视图按项目分组并按组内最新时间排序", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
    );
    expect(groups.map((group) => group.projectName)).toEqual([
      "home-assistant",
      "sub2api",
      "未识别项目",
    ]);
    expect(groups[0].threads.map((item) => item.threadId)).toEqual([
      "mini-pinned",
    ]);
  });

  it("配置中的无会话项目也会出现在项目分组", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
      ["/srv/home-assistant", "/srv/empty-project"],
    );
    expect(groups.some((group) => group.cwd === "/srv/empty-project")).toBe(true);
  });

  it("有桌面项目顺序时按目录顺序展示，组内仍按会话时间倒序", () => {
    const groups = groupThreadsByProject(
      items.filter((item) => item.backendId === "mini"),
      ["/srv/sub2api/", "/srv/home-assistant"],
    );
    expect(groups.map((group) => group.cwd)).toEqual([
      "/srv/sub2api/",
      "/srv/home-assistant",
      "",
    ]);
    expect(groups[0].threads.map((item) => item.threadId)).toEqual([
      "mini-recent",
    ]);
  });

  it("全部搜索覆盖标题、机器和项目，单机可复用过滤结果", () => {
    expect(
      filterAggregatedThreads(items, "MacBook").map((item) => item.threadId),
    ).toEqual(["book-pinned", "book-recent"]);
    expect(
      filterAggregatedThreads(items, "sub2api").map((item) => item.threadId),
    ).toEqual(["mini-recent"]);
    expect(
      filterAggregatedThreads(items, "HA运维").map((item) => item.threadId),
    ).toEqual(["mini-pinned"]);
    expect(filterAggregatedThreads(items, "MacBook", false)).toEqual([]);
  });
});
