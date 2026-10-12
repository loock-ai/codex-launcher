import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  receivedItemCharacterCount,
  TurnCard,
} from "../../src/features/conversation/Timeline";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  automationAgentMessageText,
  createPendingTurn,
  MarkdownMessage,
  groupConversationTurns,
  groupTimelineEntries,
  groupTurnItems,
  imageSourcesForItem,
  isThreadRunning,
  parseAutomationHeartbeat,
  parseRemoteFileHref,
  relativeTime,
  reconcileRecentTurns,
  removePendingTurn,
  parseUnifiedDiff,
  shouldCollapseUserMessage,
  splitCompletedTurnResponses,
  splitTurnResponseSegments,
  stripGitDirectives,
  summarizeToolActivity,
  summarizeFileChange,
  toolActivityRowLabel,
} from "../../src/ui/conversation";

afterEach(() => {
  vi.useRealTimers();
});

describe("移动端对话格式", () => {
  it("按用户消息边界把连续 assistant-only turns 合并为逻辑回合", () => {
    const groups = groupConversationTurns([
      {
        id: "turn-user-1",
        status: "completed",
        liveDiff: "diff-1",
        items: [
          { id: "u1", type: "userMessage", text: "第一个问题" },
          { id: "a1", type: "agentMessage", text: "先检查" },
        ],
      },
      {
        id: "turn-process",
        status: "completed",
        liveDiff: "diff-2",
        items: [{ id: "r1", type: "reasoning", text: "检查过程" }],
      },
      {
        id: "turn-final",
        status: "completed",
        items: [
          {
            id: "a2",
            type: "agentMessage",
            phase: "final_answer",
            text: "第一个最终回复",
          },
        ],
      },
      {
        id: "turn-user-2",
        status: "completed",
        items: [
          { id: "u2", type: "userMessage", text: "第二个问题" },
          {
            id: "a3",
            type: "agentMessage",
            phase: "final_answer",
            text: "第二个最终回复",
          },
        ],
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.id)).toEqual([
      "turn-user-1",
      "turn-user-2",
    ]);
    expect(groups[0].items.map((item: any) => item.id)).toEqual([
      "u1",
      "a1",
      "r1",
      "a2",
    ]);
    expect(groups[0].liveDiff).toBe("diff-1\ndiff-2");
  });

  it("合并 assistant-only turns 时保留逻辑回合的完整耗时边界", () => {
    const [group] = groupConversationTurns([
      {
        id: "turn-start",
        status: "completed",
        startedAt: 100,
        completedAt: 150,
        durationMs: 50_000,
        items: [{ id: "u1", type: "userMessage", text: "开始" }],
      },
      {
        id: "turn-tail",
        status: "completed",
        startedAt: 151,
        completedAt: 225,
        durationMs: 74_000,
        items: [{ id: "a1", type: "agentMessage", text: "完成" }],
      },
    ]);

    expect(group.startedAt).toBe(100);
    expect(group.completedAt).toBe(225);
    expect(group.durationMs).toBe(125_000);
  });

  it("逻辑回合完成后只生成一个统一过程折叠区", () => {
    const [group] = groupConversationTurns([
      {
        id: "turn-user",
        status: "completed",
        items: [
          { id: "u1", type: "userMessage", text: "检查项目" },
          { id: "a1", type: "agentMessage", text: "开始检查" },
        ],
      },
      {
        id: "turn-process",
        status: "completed",
        items: [
          { id: "r1", type: "reasoning", text: "分析过程" },
          {
            id: "c1",
            type: "commandExecution",
            status: "completed",
            command: "npm test",
          },
        ],
      },
      {
        id: "turn-final",
        status: "completed",
        items: [
          {
            id: "a2",
            type: "agentMessage",
            phase: "final_answer",
            text: "检查完成",
          },
        ],
      },
    ]);

    const { container } = render(
      <TurnCard turn={group} client={null} />,
    );
    const view = within(container);

    const toggle = view.getByRole("button", {
      name: "之前的 3 条消息",
    });
    expect(
      view.getAllByRole("button", { name: /之前的 \d+ 条消息/ }),
    ).toHaveLength(1);
    expect(view.queryByText("开始检查")).toBeNull();
    expect(view.queryByText("分析过程")).toBeNull();
    expect(view.queryByText("检查完成")).not.toBeNull();

    fireEvent.click(toggle);
    expect(view.queryByText("开始检查")).not.toBeNull();
    expect(view.queryByText("分析过程")).not.toBeNull();
  });

  it("折叠入口只在整轮耗时超过一分钟时展示耗时", () => {
    const { container, rerender } = render(
      <TurnCard
        turn={{
          id: "turn-duration",
          status: "completed",
          durationMs: 90_000,
          items: [
            { id: "u1", type: "userMessage", text: "检查耗时" },
            { id: "r1", type: "reasoning", text: "处理中" },
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "处理完成",
            },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(
      view.getByRole("button", {
        name: "之前的 1 条消息 · 1分30秒",
      }),
    ).not.toBeNull();

    rerender(
      <TurnCard
        turn={{
          id: "turn-duration",
          status: "completed",
          durationMs: 60_000,
          items: [
            { id: "u1", type: "userMessage", text: "检查耗时" },
            { id: "r1", type: "reasoning", text: "处理中" },
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "处理完成",
            },
          ],
        }}
        client={null}
      />,
    );

    expect(
      view.getByRole("button", { name: "之前的 1 条消息" }),
    ).not.toBeNull();
    expect(view.queryByText("1分")).toBeNull();
  });

  it("多个引导折叠段只在最后一个入口展示整轮耗时", () => {
    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-steered-duration",
          status: "completed",
          startedAt: 100,
          completedAt: 225,
          items: [
            { id: "u1", type: "userMessage", text: "先检查" },
            { id: "r1", type: "reasoning", text: "第一次处理" },
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "第一次完成",
            },
            { id: "u2", type: "userMessage", text: "继续调整" },
            { id: "r2", type: "reasoning", text: "第二次处理" },
            {
              id: "a2",
              type: "agentMessage",
              phase: "final_answer",
              text: "最终完成",
            },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(
      view.getByRole("button", { name: "之前的 1 条消息" }),
    ).not.toBeNull();
    expect(
      view.getByRole("button", {
        name: "之前的 1 条消息 · 2分5秒",
      }),
    ).not.toBeNull();
    expect(view.getAllByText("· 2分5秒")).toHaveLength(1);
  });

  it("引导用户消息显示在对应过程折叠按钮之前", () => {
    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-with-steering",
          status: "completed",
          items: [
            { id: "u1", type: "userMessage", text: "先处理图标" },
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "先完成一版",
            },
            { id: "u2", type: "userMessage", text: "调整裁剪方式" },
            { id: "r2", type: "reasoning", text: "重新检查边缘" },
            {
              id: "a2",
              type: "agentMessage",
              phase: "final_answer",
              text: "裁剪完成",
            },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);
    const steeringBubble = view
      .getByText("调整裁剪方式")
      .closest(".user-bubble");
    const toggle = view.getByRole("button", {
      name: "之前的 1 条消息",
    });

    expect(steeringBubble?.nextElementSibling).toBe(toggle);
  });

  it("逻辑回合仍在执行时完整展示跨 turn 的实时过程", () => {
    const runningTurns = [
      {
        id: "turn-user",
        status: "completed",
        items: [
          { id: "u1", type: "userMessage", text: "运行测试" },
          { id: "a1", type: "agentMessage", text: "准备执行" },
        ],
      },
      {
        id: "turn-running",
        status: "inProgress",
        items: [
          { id: "r1", type: "reasoning", text: "测试进行中" },
          {
            id: "c1",
            type: "commandExecution",
            status: "inProgress",
            command: "npm test",
          },
        ],
      },
    ];
    const [group] = groupConversationTurns(runningTurns);

    const { container, rerender } = render(
      <TurnCard turn={group} client={null} />,
    );
    const view = within(container);

    expect(
      view.queryByRole("button", { name: /之前的 \d+ 条消息/ }),
    ).toBeNull();
    expect(view.queryByText("准备执行")).not.toBeNull();
    expect(view.queryByText("测试进行中")).not.toBeNull();
    expect(
      view.queryByRole("button", { name: "正在运行 npm test" }),
    ).not.toBeNull();

    const completedTurns = [
      runningTurns[0],
      {
        ...runningTurns[1],
        status: "completed",
        items: runningTurns[1].items.map((item) => ({
          ...item,
          status:
            item.type === "commandExecution" ? "completed" : item.status,
        })),
      },
      {
        id: "turn-final",
        status: "completed",
        items: [
          {
            id: "a2",
            type: "agentMessage",
            phase: "final_answer",
            text: "测试完成",
          },
        ],
      },
    ];
    const [completedGroup] = groupConversationTurns(completedTurns);
    expect(completedGroup.id).toBe(group.id);
    rerender(<TurnCard turn={completedGroup} client={null} />);

    expect(
      view.queryByRole("button", { name: "之前的 3 条消息" }),
    ).not.toBeNull();
    expect(view.queryByText("准备执行")).toBeNull();
    expect(view.queryByText("测试进行中")).toBeNull();
    expect(view.queryByText("测试完成")).not.toBeNull();
  });

  it("流式字符统计从用户发送后出现，始终位于回合末尾并在结束后隐藏", () => {
    const running = {
      id: "turn-stream-count",
      status: "inProgress",
      items: [
        { id: "u1", type: "userMessage", text: "先介绍上海" },
        { id: "a1", type: "agentMessage", text: "上海旧回复" },
        { id: "u2", type: "userMessage", text: "改成北京" },
        { id: "a2", type: "agentMessage", text: "北京😀" },
        {
          id: "c1",
          type: "commandExecution",
          command: "printf OK",
          aggregatedOutput: "OK\n",
        },
        { id: "a3", type: "agentMessage", text: "继续" },
        {
          id: "c2",
          type: "commandExecution",
          command: "pwd",
          aggregatedOutput: ".",
        },
      ],
    };
    const { container, rerender } = render(
      <TurnCard
        turn={{
          ...running,
          items: [running.items[0]],
        }}
        client={null}
      />,
    );
    let view = within(container);

    expect(view.getByLabelText("已接收 0 字符").textContent).toBe("0 字符");

    rerender(<TurnCard turn={running} client={null} />);
    view = within(container);
    expect(receivedItemCharacterCount(running.items[4])).toBe(12);
    expect(view.getByLabelText("已接收 21 字符").textContent).toBe("21 字符");
    expect(container.querySelectorAll(".stream-character-count"))
      .toHaveLength(1);
    expect(container.querySelector(".stream-character-spinner")).not.toBeNull();
    expect(
      container.querySelector(".turn-responses")?.lastElementChild,
    ).toBe(container.querySelector(".stream-character-count"));

    rerender(
      <TurnCard
        turn={{ ...running, status: "completed" }}
        client={null}
      />,
    );
    view = within(container);
    expect(view.queryByLabelText(/已接收 \d+ 字符/)).toBeNull();
  });

  it("流式字符状态从本轮开始时间实时展示运行耗时", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T12:01:24Z"));
    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-stream-duration",
          status: "inProgress",
          startedAt: Date.parse("2026-07-29T12:00:00Z") / 1000,
          items: [
            { id: "u1", type: "userMessage", text: "检查耗时" },
            { id: "a1", type: "agentMessage", text: "处理中" },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(
      view.getByLabelText("已接收 3 字符，已运行 1分24秒").textContent,
    ).toBe("3 字符· 1分24秒");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      view.getByLabelText("已接收 3 字符，已运行 1分25秒"),
    ).not.toBeNull();
  });

  it("运行中和完成后的对话时间线都不展示代码变更卡片", () => {
    const turn = {
      id: "turn-with-live-diff",
      status: "inProgress",
      liveDiff: "@@ -1 +1 @@\n-old\n+new",
      items: [
        { id: "u1", type: "userMessage", text: "修改文件" },
        { id: "a1", type: "agentMessage", text: "正在处理" },
      ],
    };
    const { container, rerender } = render(
      <TurnCard
        turn={turn}
        liveDiff={turn.liveDiff}
        client={null}
      />,
    );
    let view = within(container);

    expect(view.queryByText("代码变更")).toBeNull();
    expect(container.querySelector(".diff-card")).toBeNull();

    rerender(
      <TurnCard
        turn={{ ...turn, status: "completed" }}
        liveDiff={turn.liveDiff}
        client={null}
      />,
    );
    view = within(container);
    expect(view.queryByText("代码变更")).toBeNull();
    expect(container.querySelector(".diff-card")).toBeNull();
  });

  it("没有用户消息的回合不显示伪用户气泡", () => {
    const { container, rerender } = render(
      <TurnCard
        turn={{
          id: "assistant-only",
          status: "completed",
          items: [
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "自动执行结果",
            },
          ],
        }}
        client={null}
      />,
    );

    expect(screen.queryByText("Codex 回合")).toBeNull();
    expect(container.querySelector(".turn-user")).toBeNull();
    expect(screen.queryByText("自动执行结果")).not.toBeNull();

    rerender(
      <TurnCard
        turn={{
          id: "normal",
          status: "completed",
          items: [
            { id: "u1", type: "userMessage", text: "真实问题" },
            {
              id: "a2",
              type: "agentMessage",
              phase: "final_answer",
              text: "正常回答",
            },
          ],
        }}
        client={null}
      />,
    );
    expect(container.querySelector(".turn-user")).not.toBeNull();
    expect(screen.queryByText("真实问题")).not.toBeNull();
  });

  it("相对时间使用数字在前、单位在后", () => {
    expect(relativeTime(100, 220)).toBe("2m");
    expect(relativeTime(100, 7_300)).toBe("2h");
    expect(relativeTime(100, 9_400)).toBe("2h35m");
    expect(relativeTime(100, 172_900)).toBe("2d");
    expect(relativeTime(100, 180_280)).toBe("2d");
    expect(relativeTime(100, 86_500)).toBe("1d");
  });

  it("只把协议中的 active 线程标记为进行中", () => {
    expect(isThreadRunning({ type: "active", activeFlags: [] })).toBe(true);
    expect(isThreadRunning({ type: "idle" })).toBe(false);
    expect(isThreadRunning({ type: "notLoaded" })).toBe(false);
    expect(isThreadRunning("running")).toBe(false);
  });

  it("每个 Turn 分离用户标题和其后的 AI 内容", () => {
    expect(
      groupTurnItems({
        id: "turn-1",
        status: "completed",
        items: [
          { id: "u1", type: "userMessage", text: "问题" },
          { id: "a1", type: "agentMessage", text: "答案" },
          { id: "c1", type: "commandExecution", command: "pwd" },
        ],
      }),
    ).toEqual({
      id: "turn-1",
      running: false,
      user: { id: "u1", type: "userMessage", text: "问题" },
      responses: [
        { id: "a1", type: "agentMessage", text: "答案" },
        { id: "c1", type: "commandExecution", command: "pwd" },
      ],
    });
  });

  it("把连续的工具与文件活动合并，但保留 AI 消息顺序", () => {
    const entries = groupTimelineEntries([
      { id: "a1", type: "agentMessage", text: "先检查" },
      { id: "c1", type: "commandExecution", command: "rg foo" },
      {
        id: "f1",
        type: "fileChange",
        changes: [{ path: "src/a.ts", diff: "+const a = 1", kind: "update" }],
      },
      { id: "a2", type: "agentMessage", text: "检查完成" },
      { id: "m1", type: "mcpToolCall", tool: "browser_open" },
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual([
      "item",
      "activity",
      "item",
      "activity",
    ]);
    expect(entries[1]).toMatchObject({
      kind: "activity",
      items: [{ id: "c1" }, { id: "f1" }],
    });
  });

  it("从真实工具字段汇总文件、命令、工具和 diff 增删行", () => {
    expect(
      summarizeToolActivity([
        { type: "commandExecution", status: "completed" },
        { type: "commandExecution", status: "inProgress" },
        {
          type: "fileChange",
          status: "completed",
          changes: [
            {
              path: "src/a.ts",
              diff: "@@\n+one\n+two\n-old",
            },
            {
              path: "src/b.ts",
              diff: "@@\n+three",
            },
          ],
        },
        { type: "dynamicToolCall", status: "completed" },
      ]),
    ).toEqual({
      fileCount: 2,
      commandCount: 2,
      toolCount: 1,
      additions: 3,
      deletions: 1,
      running: true,
    });
  });

  it("解析 unified diff 的 hunk、行号与增删类型", () => {
    expect(
      parseUnifiedDiff(
        "@@ -138,3 +138,4 @@\n context\n-old value\n+new value\n+another value\n tail",
      ),
    ).toEqual([
      {
        type: "hunk",
        text: "@@ -138,3 +138,4 @@",
        oldLine: null,
        newLine: null,
      },
      {
        type: "context",
        text: "context",
        oldLine: 138,
        newLine: 138,
      },
      {
        type: "deletion",
        text: "old value",
        oldLine: 139,
        newLine: null,
      },
      {
        type: "addition",
        text: "new value",
        oldLine: null,
        newLine: 139,
      },
      {
        type: "addition",
        text: "another value",
        oldLine: null,
        newLine: 140,
      },
      {
        type: "context",
        text: "tail",
        oldLine: 140,
        newLine: 141,
      },
    ]);
  });

  it("文件 Diff 统计忽略头部，并对无 hunk 内容安全回退", () => {
    expect(
      summarizeFileChange({
        path: "src/App.tsx",
        diff: "--- a/src/App.tsx\n+++ b/src/App.tsx\n-old\n+new\n+next",
      }),
    ).toEqual({
      additions: 2,
      deletions: 1,
    });
    expect(parseUnifiedDiff("+new\n-old")).toEqual([
      {
        type: "addition",
        text: "new",
        oldLine: null,
        newLine: null,
      },
      {
        type: "deletion",
        text: "old",
        oldLine: null,
        newLine: null,
      },
    ]);
  });

  it("命令行标签优先使用 commandActions 表达读取与搜索", () => {
    expect(
      toolActivityRowLabel({
        type: "commandExecution",
        status: "completed",
        command: "sed -n '1,20p' src/App.tsx",
        commandActions: [
          {
            type: "read",
            name: "App.tsx",
            path: "/repo/src/App.tsx",
          },
        ],
      }),
    ).toBe("已读取 App.tsx");
    expect(
      toolActivityRowLabel({
        type: "commandExecution",
        status: "inProgress",
        command: "npm run dev",
        commandActions: [{ type: "unknown" }],
      }),
    ).toBe("正在运行 npm run dev");
  });

  it("从用户输入、图片查看和图片生成 item 提取真实图片来源", () => {
    expect(
      imageSourcesForItem({
        type: "userMessage",
        content: [
          { type: "text", text: "看图" },
          { type: "localImage", path: "/tmp/user.png" },
          { type: "image", url: "https://example.com/remote.jpg" },
        ],
      }),
    ).toEqual([
      { source: "/tmp/user.png", name: "user.png", local: true },
      {
        source: "https://example.com/remote.jpg",
        name: "remote.jpg",
        local: false,
      },
    ]);
    expect(
      imageSourcesForItem({ type: "imageView", path: "/tmp/view.webp" }),
    ).toEqual([{ source: "/tmp/view.webp", name: "view.webp", local: true }]);
    expect(
      imageSourcesForItem({
        type: "imageGeneration",
        savedPath: "/tmp/generated.png",
        result: "ignored",
      }),
    ).toEqual([
      { source: "/tmp/generated.png", name: "generated.png", local: true },
    ]);
  });

  it("长文本或多行用户消息默认折叠，短消息保持完整", () => {
    expect(shouldCollapseUserMessage("简短问题")).toBe(false);
    expect(shouldCollapseUserMessage("一行\n".repeat(9))).toBe(true);
    expect(shouldCollapseUserMessage("很长的用户消息".repeat(40))).toBe(true);
  });

  it("完成回合只保留最后一条 AI 回复，其余过程按原 item 数量折叠", () => {
    const early = { id: "a1", type: "agentMessage", text: "先检查" };
    const command = { id: "c1", type: "commandExecution" };
    const final = { id: "a2", type: "agentMessage", text: "最终答案" };
    const result = splitCompletedTurnResponses([early, command, final]);

    expect(result.final).toBe(final);
    expect(result.previous).toEqual([early, command]);
    expect(result.previousCount).toBe(2);
    expect(result.beforeFinal).toEqual([early, command]);
    expect(result.afterFinal).toEqual([]);
  });

  it("本轮后续的人类引导保持用户气泡且不计入 AI 过程折叠", () => {
    const command = { id: "c-steer", type: "commandExecution" };
    const steer = {
      id: "u-steer",
      type: "userMessage",
      text: "先修复失败测试，再继续构建",
    };
    const final = {
      id: "a-steer",
      type: "agentMessage",
      phase: "final_answer",
      text: "已经完成",
    };
    const result = splitCompletedTurnResponses([command, steer, final]);

    expect(result.previousCount).toBe(1);

    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-steered",
          status: "completed",
          items: [
            { id: "u-initial", type: "userMessage", text: "处理这个问题" },
            command,
            steer,
            final,
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);
    const steerText = view.getByText("先修复失败测试，再继续构建");

    expect(steerText.closest(".user-bubble")).not.toBeNull();
    expect(
      view.getByRole("button", { name: "之前的 1 条消息" }),
    ).not.toBeNull();
    expect(
      view.queryByRole("button", { name: "之前的 2 条消息" }),
    ).toBeNull();
  });

  it("人类引导把同一 Turn 切成独立显示段且单条 AI 回复不折叠", () => {
    const earlyAnswer = {
      id: "a-shanghai",
      type: "agentMessage",
      phase: "final_answer",
      text: "上海是一座现代化城市",
    };
    const steer = {
      id: "u-beijing",
      type: "userMessage",
      text: "改北京的介绍吧",
    };
    const finalAnswer = {
      id: "a-beijing",
      type: "agentMessage",
      phase: "final_answer",
      text: "北京是古都与现代活力交融的城市",
    };

    expect(
      splitTurnResponseSegments([earlyAnswer, steer, finalAnswer]),
    ).toEqual([
      [earlyAnswer],
      [steer, finalAnswer],
    ]);

    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-steered-once",
          status: "completed",
          items: [
            { id: "u-shanghai", type: "userMessage", text: "介绍上海" },
            earlyAnswer,
            steer,
            finalAnswer,
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(view.getByText("上海是一座现代化城市")).not.toBeNull();
    expect(view.getByText("改北京的介绍吧").closest(".user-bubble"))
      .not.toBeNull();
    expect(
      view.getByText("北京是古都与现代活力交融的城市"),
    ).not.toBeNull();
    expect(view.queryByRole("button", { name: /之前的/ })).toBeNull();
  });

  it("连续多个引导消息按顺序各展示一次", () => {
    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-steered-twice",
          status: "completed",
          items: [
            { id: "u-initial", type: "userMessage", text: "先检查问题" },
            {
              id: "a-initial",
              type: "agentMessage",
              phase: "final_answer",
              text: "开始检查",
            },
            { id: "u-steer-1", type: "userMessage", text: "先修复测试" },
            {
              id: "a-steer-1",
              type: "agentMessage",
              phase: "final_answer",
              text: "测试已修复",
            },
            { id: "u-steer-2", type: "userMessage", text: "再运行构建" },
            {
              id: "a-steer-2",
              type: "agentMessage",
              phase: "final_answer",
              text: "构建已通过",
            },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(view.getAllByText("先修复测试")).toHaveLength(1);
    expect(view.getAllByText("再运行构建")).toHaveLength(1);
    expect(view.getAllByText("测试已修复")).toHaveLength(1);
    expect(view.getAllByText("构建已通过")).toHaveLength(1);
  });

  it("没有 AI 最终回复时不丢弃过程 item", () => {
    const command = { id: "c1", type: "commandExecution" };
    expect(splitCompletedTurnResponses([command])).toEqual({
      final: null,
      previous: [command],
      previousCount: 1,
      beforeFinal: [command],
      afterFinal: [],
    });
  });

  it("上下文压缩提示不计入折叠数量，并随历史消息一起展开", () => {
    const compaction = { id: "compact-1", type: "contextCompaction" };
    const result = splitCompletedTurnResponses([
      { id: "c1", type: "commandExecution" },
      compaction,
      {
        id: "a1",
        type: "agentMessage",
        phase: "final_answer",
        text: "继续完成任务",
      },
    ]);

    expect(result.previous).toEqual([
      { id: "c1", type: "commandExecution" },
      compaction,
    ]);
    expect(result.previousCount).toBe(1);

    const { container } = render(
      <TurnCard
        turn={{
          id: "turn-compact",
          status: "completed",
          items: [
            { id: "u1", type: "userMessage", text: "继续" },
            { id: "c1", type: "commandExecution" },
            compaction,
            {
              id: "a1",
              type: "agentMessage",
              phase: "final_answer",
              text: "继续完成任务",
            },
          ],
        }}
        client={null}
      />,
    );
    const view = within(container);

    expect(view.queryByText("上下文已压缩")).toBeNull();
    const previousButton = view.getByRole("button", {
      name: "之前的 1 条消息",
    });
    fireEvent.click(previousButton);
    expect(view.getByRole("separator", { name: "上下文已压缩" })).not.toBeNull();
    const compactionNode = view.getByText("上下文已压缩");
    const finalNode = view.getByText("继续完成任务");
    expect(
      compactionNode.compareDocumentPosition(finalNode) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const after = render(
      <TurnCard
        turn={{
          id: "turn-compact-after",
          status: "completed",
          items: [
            { id: "u2", type: "userMessage", text: "继续" },
            { id: "c2", type: "commandExecution" },
            {
              id: "a2",
              type: "agentMessage",
              phase: "final_answer",
              text: "先完成回复",
            },
            { id: "compact-2", type: "contextCompaction" },
          ],
        }}
        client={null}
      />,
    );
    const afterView = within(after.container);
    expect(afterView.queryByText("上下文已压缩")).toBeNull();
    fireEvent.click(
      afterView.getByRole("button", { name: "之前的 1 条消息" }),
    );
    expect(
      afterView
        .getByText("先完成回复")
        .compareDocumentPosition(afterView.getByText("上下文已压缩")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    const standalone = render(
      <TurnCard
        turn={{
          id: "turn-compact-only",
          status: "completed",
          items: [
            { id: "u3", type: "userMessage", text: "继续" },
            {
              id: "a3",
              type: "agentMessage",
              phase: "final_answer",
              text: "完成回复",
            },
            { id: "compact-3", type: "contextCompaction" },
          ],
        }}
        client={null}
      />,
    );
    const standaloneView = within(standalone.container);
    expect(standaloneView.queryByRole("button", {
      name: /之前的/,
    })).toBeNull();
    expect(
      standaloneView.getByRole("separator", { name: "上下文已压缩" }),
    ).not.toBeNull();
  });

  it("turn/completed 只合并最终摘要，不丢失本地累计的完整过程", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          items: [
            { id: "u1", type: "userMessage", text: "问题" },
            { id: "r1", type: "reasoning", text: "检查中" },
            { id: "c1", type: "commandExecution", command: "npm test" },
          ],
        },
      ],
    };
    const completedTurn = {
      id: "turn-1",
      status: "completed",
      items: [
        { id: "a1", type: "agentMessage", text: "最终答案" },
      ],
    };

    expect(
      applyCompletedTurn(thread, {
        threadId: "thread-1",
        turn: completedTurn,
      }),
    ).toEqual({
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "completed",
          items: [
            { id: "u1", type: "userMessage", text: "问题" },
            { id: "r1", type: "reasoning", text: "检查中" },
            { id: "c1", type: "commandExecution", command: "npm test" },
            { id: "a1", type: "agentMessage", text: "最终答案" },
          ],
        },
      ],
    });
    expect(
      applyCompletedTurn(thread, {
        threadId: "other-thread",
        turn: completedTurn,
      }),
    ).toBe(thread);
  });

  it("turn/started 将本地 pending 回合升级为真实回合且保留用户消息", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "old-turn",
          status: "completed",
          items: [{ id: "old", type: "agentMessage", text: "旧回复" }],
        },
        {
          id: "pending-1",
          status: "inProgress",
          items: [{ id: "local-1", type: "userMessage", text: "新问题" }],
        },
      ],
    };
    const started = applyTurnStarted(thread, {
      threadId: "thread-1",
      turn: { id: "new-turn", status: "inProgress", items: [] },
    });

    expect(started.turns).toHaveLength(2);
    expect(started.turns[1]).toMatchObject({
      id: "new-turn",
      status: "inProgress",
      items: [{ id: "local-1", type: "userMessage", text: "新问题" }],
    });
  });

  it("乐观 pending 回合不使用手机本地时间", () => {
    expect(
      createPendingTurn("pending-1", {
        id: "local-1",
        type: "userMessage",
        text: "新问题",
      }),
    ).toEqual({
      id: "pending-1",
      status: "inProgress",
      items: [{ id: "local-1", type: "userMessage", text: "新问题" }],
    });
  });

  it("增量对账按 turn 和 item id 补齐后台期间漏掉的内容", () => {
    const current = [
      {
        id: "turn-1",
        status: "completed",
        startedAt: 100,
        completedAt: 110,
        items: [{ id: "a1", type: "agentMessage", text: "旧回复" }],
      },
      {
        id: "pending-2",
        status: "inProgress",
        items: [{ id: "local-2", type: "userMessage", text: "继续" }],
      },
    ];
    const latest = [
      current[0],
      {
        id: "turn-2",
        status: "completed",
        startedAt: 120,
        completedAt: 150,
        durationMs: 30_000,
        items: [
          { id: "u2", type: "userMessage", text: "继续" },
          { id: "a2", type: "agentMessage", text: "后台完成的回复" },
        ],
      },
    ];

    expect(reconcileRecentTurns(current, latest)).toEqual([
      current[0],
      {
        id: "turn-2",
        status: "completed",
        startedAt: 120,
        completedAt: 150,
        durationMs: 30_000,
        items: [
          { id: "u2", type: "userMessage", text: "继续" },
          { id: "a2", type: "agentMessage", text: "后台完成的回复" },
        ],
      },
    ]);
  });

  it("增量对账不会用无关的历史 turn 替换本地 pending 回合", () => {
    const pending = {
      id: "pending-3",
      status: "inProgress",
      items: [{ id: "local-3", type: "userMessage", text: "正在发送" }],
    };

    expect(
      reconcileRecentTurns(
        [pending],
        [
          {
            id: "turn-history",
            status: "completed",
            items: [
              { id: "u-history", type: "userMessage", text: "历史问题" },
              { id: "a-history", type: "agentMessage", text: "历史回复" },
            ],
          },
        ],
      ),
    ).toEqual([
      {
        id: "turn-history",
        status: "completed",
        items: [
          { id: "u-history", type: "userMessage", text: "历史问题" },
          { id: "a-history", type: "agentMessage", text: "历史回复" },
        ],
      },
      pending,
    ]);
  });

  it("增量对账使用服务端完整窗口纠正 turn 和 item 顺序", () => {
    expect(
      reconcileRecentTurns(
        [
          {
            id: "turn-2",
            status: "inProgress",
            items: [
              { id: "a2", type: "agentMessage", text: "不完整" },
              { id: "u2", type: "userMessage", text: "问题" },
            ],
          },
          {
            id: "turn-1",
            status: "completed",
            items: [],
          },
        ],
        [
          {
            id: "turn-1",
            status: "completed",
            items: [{ id: "a1", type: "agentMessage", text: "上一轮" }],
          },
          {
            id: "turn-2",
            status: "completed",
            items: [
              { id: "u2", type: "userMessage", text: "问题" },
              { id: "a2", type: "agentMessage", text: "完整回复" },
            ],
          },
        ],
      ),
    ).toEqual([
      {
        id: "turn-1",
        status: "completed",
        items: [{ id: "a1", type: "agentMessage", text: "上一轮" }],
      },
      {
        id: "turn-2",
        status: "completed",
        items: [
          { id: "u2", type: "userMessage", text: "问题" },
          { id: "a2", type: "agentMessage", text: "完整回复" },
        ],
      },
    ]);
  });

  it("pending 匹配忽略服务端新增的 text_elements 字段", () => {
    const pending = createPendingTurn("pending-4", {
      id: "local-4",
      type: "userMessage",
      content: [{ type: "text", text: "继续" }],
    });
    expect(
      reconcileRecentTurns(
        [pending],
        [
          {
            id: "turn-4",
            status: "completed",
            items: [
              {
                id: "u4",
                type: "userMessage",
                content: [
                  { type: "text", text: "继续", text_elements: [] },
                ],
              },
              { id: "a4", type: "agentMessage", text: "完成" },
            ],
          },
        ],
      ),
    ).toEqual([
      {
        id: "turn-4",
        status: "completed",
        items: [
          {
            id: "u4",
            type: "userMessage",
            content: [{ type: "text", text: "继续", text_elements: [] }],
          },
          { id: "a4", type: "agentMessage", text: "完成" },
        ],
      },
    ]);
  });

  it("图片消息 pending 优先按文字匹配，不受图片地址转换影响", () => {
    const pending = createPendingTurn(
      "pending-image",
      {
        id: "local-image",
        type: "userMessage",
        content: [
          { type: "text", text: "看看图片" },
          { type: "image", url: "data:image/png;base64,local" },
        ],
      },
      1,
    );
    const [turn] = reconcileRecentTurns(
      [pending],
      [
        {
          id: "turn-image",
          status: "completed",
          items: [
            {
              id: "u-image",
              type: "userMessage",
              content: [
                { type: "text", text: "看看图片", text_elements: [] },
                { type: "localImage", path: "/tmp/upload.png" },
              ],
            },
          ],
        },
      ],
      { discardPendingThrough: 1 },
    );

    expect(turn.id).toBe("turn-image");
    expect(turn.clientSequence).toBeUndefined();
  });

  it("稳定快照清理恢复开始前的 stale pending 并保留后来发送的消息", () => {
    const stale = createPendingTurn(
      "pending-stale",
      { id: "u-stale", type: "userMessage", text: "旧消息" },
      1,
    );
    const fresh = createPendingTurn(
      "pending-fresh",
      { id: "u-fresh", type: "userMessage", text: "新消息" },
      2,
    );

    expect(
      reconcileRecentTurns([stale, fresh], [], {
        discardPendingThrough: 1,
      }),
    ).toEqual([fresh]);
  });

  it("turn/start 失败时只删除对应的乐观 pending 回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        { id: "old-turn", status: "completed", items: [] },
        { id: "pending-failed", status: "inProgress", items: [] },
        { id: "pending-other", status: "inProgress", items: [] },
      ],
    };

    expect(removePendingTurn(thread, "pending-failed").turns).toEqual([
      thread.turns[0],
      thread.turns[2],
    ]);
    expect(removePendingTurn(thread, "missing")).toBe(thread);
  });

  it("未知 turn 的 item 创建目标回合，不污染最后一个旧回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "old-turn",
          status: "completed",
          items: [{ id: "old", type: "agentMessage", text: "旧回复" }],
        },
      ],
    };
    const updated = applyTurnItem(thread, {
      threadId: "thread-1",
      turnId: "new-turn",
      item: { id: "c1", type: "commandExecution", command: "pwd" },
    });

    expect(updated.turns[0].items).toEqual(thread.turns[0].items);
    expect(updated.turns[1]).toMatchObject({
      id: "new-turn",
      status: "inProgress",
      items: [{ id: "c1", type: "commandExecution", command: "pwd" }],
    });
  });

  it("turn diff 只写入所属回合", () => {
    const thread = {
      id: "thread-1",
      turns: [
        { id: "turn-1", status: "completed", items: [] },
        { id: "turn-2", status: "inProgress", items: [] },
      ],
    };
    const updated = applyTurnDiff(thread, {
      threadId: "thread-1",
      turnId: "turn-1",
      diff: "+old turn",
    });

    expect(updated.turns[0].liveDiff).toBe("+old turn");
    expect(updated.turns[1].liveDiff).toBeUndefined();
  });

  it("fileChange patchUpdated 更新对应 item 且不清空 turn diff", () => {
    const thread = {
      id: "thread-1",
      turns: [
        {
          id: "turn-1",
          status: "inProgress",
          liveDiff: "+aggregated",
          items: [
            {
              id: "file-1",
              type: "fileChange",
              status: "inProgress",
              changes: [],
            },
          ],
        },
      ],
    };
    const changes = [
      { path: "/tmp/App.tsx", kind: "update", diff: "+const ok = true;" },
    ];
    const updated = applyFileChangePatch(thread, {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "file-1",
      changes,
    });

    expect(updated.turns[0].liveDiff).toBe("+aggregated");
    expect(updated.turns[0].items[0].changes).toEqual(changes);
  });

  it("AI 消息按 Markdown 渲染且不执行 HTML", () => {
    render(
      <MarkdownMessage text={"**加粗**\n\n- 第一项\n\n<script>alert(1)</script>"} />,
    );
    expect(screen.getByText("加粗").tagName).toBe("STRONG");
    expect(screen.getByText("第一项").tagName).toBe("LI");
    expect(document.querySelector("script")).toBeNull();
  });

  it("从 AI 正文中移除独立成行的 Git 界面指令", () => {
    expect(
      stripGitDirectives(
        [
          "部署已经完成。",
          "",
          '::git-create-branch{cwd="/tmp/project" branch="codex/android"}',
          '::git-commit{cwd="/tmp/project"}',
          '::git-push{cwd="/tmp/project" branch="codex/android"}',
          "",
        ].join("\n"),
      ),
    ).toBe("部署已经完成。");
  });

  it("保留正文内和 Markdown 代码块内的 Git 指令示例", () => {
    const text = [
      "正文内的 ::git-commit 不应隐藏。",
      "",
      "```text",
      '::git-commit{cwd="/tmp/project"}',
      "```",
    ].join("\n");

    expect(stripGitDirectives(text)).toBe(text);
  });

  it("只在 AI 消息展示层隐藏 Git 指令", () => {
    render(
      <TurnCard
        client={null}
        turn={{
          id: "turn-git-directives",
          status: "completed",
          items: [
            {
              id: "user-git-example",
              type: "userMessage",
              text: '请解释 ::git-commit{cwd="/tmp/project"}',
            },
            {
              id: "assistant-final",
              type: "agentMessage",
              phase: "final_answer",
              text: [
                "部署已经完成。",
                "",
                '::git-commit{cwd="/tmp/project"}',
              ].join("\n"),
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("部署已经完成。")).not.toBeNull();
    expect(screen.getAllByText(/::git-commit/)).toHaveLength(1);
    expect(screen.getByText(/请解释 ::git-commit/)).not.toBeNull();
  });

  it("解析自动化 heartbeat 的用户指令和 AI 正文", () => {
    expect(
      parseAutomationHeartbeat(
        [
          "<heartbeat>",
          "<automation_id>automation-2</automation_id>",
          "<current_time_iso>2026-07-28T00:30:41.115Z</current_time_iso>",
          "<instructions>每天整理 Agent 开发动态。</instructions>",
          "</heartbeat>",
        ].join("\n"),
      ),
    ).toEqual({
      automationId: "automation-2",
      instructions: "每天整理 Agent 开发动态。",
      message: null,
    });
    expect(
      parseAutomationHeartbeat(
        [
          "<heartbeat>",
          "<automation_id>automation-2</automation_id>",
          "<decision>NOTIFY</decision>",
          "<message>趋势观察已完成。</message>",
          "</heartbeat>",
        ].join("\n"),
      ),
    ).toEqual({
      automationId: "automation-2",
      instructions: null,
      message: "趋势观察已完成。",
    });
  });

  it("恢复消息保留正常正文并移除末尾自动化 heartbeat 标签", () => {
    expect(
      automationAgentMessageText(
        [
          "已创建提交 fff5923，未 push。",
          "",
          "<heartbeat>",
          "<automation_id>agent</automation_id>",
          "<decision>NOTIFY</decision>",
          "<message>已完成 Agent 开发动态整理。</message>",
          "</heartbeat>",
        ].join("\n"),
      ),
    ).toBe("已创建提交 fff5923，未 push。");
  });

  it("整条 AI 消息只有 heartbeat 时继续展示 message 正文", () => {
    expect(
      automationAgentMessageText(
        [
          "<heartbeat>",
          "<automation_id>agent</automation_id>",
          "<decision>NOTIFY</decision>",
          "<message>已完成 Agent 开发动态整理。</message>",
          "</heartbeat>",
        ].join("\n"),
      ),
    ).toBe("已完成 Agent 开发动态整理。");
  });

  it("不解析普通正文、代码示例和缺少自动化 ID 的 heartbeat", () => {
    expect(
      parseAutomationHeartbeat(
        "正文中的 <heartbeat> 只是普通文字。",
      ),
    ).toBeNull();
    expect(
      parseAutomationHeartbeat(
        "```xml\n<heartbeat><automation_id>a</automation_id></heartbeat>\n```",
      ),
    ).toBeNull();
    expect(
      parseAutomationHeartbeat(
        "<heartbeat><message>普通消息</message></heartbeat>",
      ),
    ).toBeNull();
  });

  it("自动化用户和 AI 消息只显示对应正文", () => {
    const { container } = render(
      <TurnCard
        client={null}
        turn={{
          id: "turn-automation",
          status: "completed",
          items: [
            {
              id: "automation-user",
              type: "userMessage",
              text: [
                "<heartbeat>",
                "<automation_id>automation-2</automation_id>",
                "<current_time_iso>2026-07-28T00:30:41.115Z</current_time_iso>",
                "<instructions>每天整理 Agent 开发动态。</instructions>",
                "</heartbeat>",
              ].join("\n"),
            },
            {
              id: "automation-assistant",
              type: "agentMessage",
              phase: "final_answer",
              text: [
                "<heartbeat>",
                "<automation_id>automation-2</automation_id>",
                "<decision>NOTIFY</decision>",
                "<message>趋势观察已完成。</message>",
                "</heartbeat>",
              ].join("\n"),
            },
          ],
        }}
      />,
    );

    const automationLabel = screen.getByText("通过自动化功能发送");
    expect(screen.getAllByText("通过自动化功能发送")).toHaveLength(1);
    expect(
      automationLabel.nextElementSibling?.classList.contains("user-bubble"),
    ).toBe(true);
    expect(screen.getByText("每天整理 Agent 开发动态。")).not.toBeNull();
    expect(screen.getByText("趋势观察已完成。")).not.toBeNull();
    expect(container.textContent).not.toContain("<heartbeat>");
    expect(container.textContent).not.toContain("automation-2");
    expect(container.textContent).not.toContain("NOTIFY");
  });

  it("Markdown 渲染器允许用户气泡添加紧凑样式 class", () => {
    const { container } = render(
      <MarkdownMessage
        text={"# 用户标题\n\n**用户粗体**\n\n- 用户列表"}
        className="user-markdown"
      />,
    );
    expect(container.querySelector(".markdown-body.user-markdown h1")?.textContent)
      .toBe("用户标题");
    expect(container.querySelector(".user-markdown strong")?.textContent)
      .toBe("用户粗体");
    expect(container.querySelector(".user-markdown li")?.textContent)
      .toBe("用户列表");
  });

  it("识别远程文件路径与尾部行列号，不拦截网页链接", () => {
    expect(
      parseRemoteFileHref(
        "/Users/loock/project/src/App.tsx:1173:5",
      ),
    ).toEqual({
      path: "/Users/loock/project/src/App.tsx",
      line: 1173,
      column: 5,
    });
    expect(
      parseRemoteFileHref("file:///tmp/project/README.md:8"),
    ).toEqual({
      path: "/tmp/project/README.md",
      line: 8,
      column: null,
    });
    expect(parseRemoteFileHref("https://example.com/App.tsx")).toBeNull();
    expect(parseRemoteFileHref("/docs/getting-started")).toBeNull();
    expect(parseRemoteFileHref("#section")).toBeNull();
  });

  it("Markdown 渲染器允许调用方接管文件链接渲染", () => {
    render(
      <MarkdownMessage
        text={"[App.tsx](/Users/loock/project/src/App.tsx:12)"}
        renderLink={(href, children) => (
          <button type="button" data-href={href}>
            {children}
          </button>
        )}
      />,
    );
    expect(
      screen.getByRole("button", { name: "App.tsx" }).getAttribute("data-href"),
    ).toBe("/Users/loock/project/src/App.tsx:12");
  });
});
