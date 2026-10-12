import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThreadListPage } from "../../src/features/threads/ThreadListPage";
import { aggregateThreads } from "../../src/features/threads/thread-list-model";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../src/backends/types";

const backend: BackendConfig = {
  id: "mini",
  name: "Mac mini",
  baseUrl: "http://mini.local:4173",
  token: "",
  enabled: true,
  order: 0,
};
const summaries: Record<string, BackendRuntimeSummary> = {
  mini: {
    backendId: "mini",
    connection: "online",
    busy: false,
    approvalCount: 0,
    error: "",
  },
};
const threads = aggregateThreads([backend], {
  mini: [
    {
      id: "pinned",
      preview: "置顶会话",
      cwd: "/tmp/project-a",
      updatedAt: 30,
      isPinned: true,
      status: { type: "idle" },
    },
    {
      id: "recent",
      preview: "最近会话",
      cwd: "/tmp/project-b",
      updatedAt: 20,
      status: { type: "active" },
    },
  ],
});

function renderList(
  selectedBackendId: string,
  {
    collapsedProjectKeys = new Set<string>(),
    loadingBackendIds = new Set<string>(),
    refreshing = false,
    projectDirectories = ["/tmp/project-a", "/tmp/project-b"],
    projectThreadStates = {},
    query = "",
    onRetryProject = () => undefined,
    onToggleProjectCollapsed = () => undefined,
  }: {
    collapsedProjectKeys?: Set<string>;
    loadingBackendIds?: Set<string>;
    refreshing?: boolean;
    projectDirectories?: string[];
    projectThreadStates?: Record<string, "loading" | "ready" | "error">;
    query?: string;
    onRetryProject?: (backendId: string, cwd: string) => void;
    onToggleProjectCollapsed?: (backendId: string, cwd: string) => void;
  } = {},
) {
  return render(
    <ThreadListPage
      backends={[backend]}
      summaries={summaries}
      selectedBackendId={selectedBackendId}
      threadListState="ready"
      visibleThreads={threads}
      totalThreadCount={threads.length}
      projectDirectories={projectDirectories}
      projectVisibleCounts={{}}
      collapsedProjectKeys={collapsedProjectKeys}
      loadingProjectKeys={new Set()}
      loadingBackendIds={loadingBackendIds}
      refreshing={refreshing}
      projectThreadStates={projectThreadStates}
      openingThreadId=""
      query={query}
      error=""
      onQueryChange={() => undefined}
      onOpenThread={() => undefined}
      onNewChat={() => undefined}
      onSelectBackend={() => undefined}
      onManageBackends={() => undefined}
      onRefresh={() => undefined}
      onRetryProject={onRetryProject}
      onToggleProject={() => undefined}
      onToggleProjectCollapsed={onToggleProjectCollapsed}
    />,
  );
}

describe("会话侧边栏列表", () => {
  it("头部和机器选项位于同一个吸顶容器", () => {
    const { container } = renderList("mini");
    const sticky = container.querySelector(".thread-list-sticky");

    expect(sticky).not.toBeNull();
    expect(sticky?.querySelector(".list-header")).not.toBeNull();
    expect(sticky?.querySelector(".backend-switcher")).not.toBeNull();
  });

  it("全部视图把置顶独立展示且保留机器项目来源", () => {
    const { container } = renderList("all");
    const view = within(container);

    expect(view.getByRole("heading", { name: "Codex Mobile" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "置顶" })).not.toBeNull();
    expect(view.getByRole("heading", { name: "最近" })).not.toBeNull();
    expect(view.getAllByText("置顶会话")).toHaveLength(1);
    const projectA = view.getByText("Mac mini · project-a");
    const projectB = view.getByText("Mac mini · project-b");
    expect(projectA).not.toBeNull();
    expect(projectB).not.toBeNull();
    expect(projectA.closest(".thread-source")?.querySelector(".status-dot")).toBeNull();
    expect(projectB.closest(".thread-source")?.querySelector(".status-dot")).toBeNull();
    expect(view.getByLabelText("进行中")).not.toBeNull();
  });

  it("刷新期间只让右上角刷新按钮显示旋转状态", () => {
    const { container } = renderList("all", { refreshing: true });
    const refresh = within(container).getByRole("button", {
      name: "刷新会话列表",
    });

    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(refresh.classList.contains("refreshing")).toBe(true);
    expect(refresh.querySelector(".sidebar-refresh-spinner")).not.toBeNull();
    expect(refresh.querySelector("svg")).toBeNull();
  });

  it("单机视图只按项目分组且行内不重复机器项目", () => {
    const { container } = renderList("mini");
    const view = within(container);

    expect(view.queryByRole("heading", { name: "置顶" })).toBeNull();
    expect(view.getByRole("heading", { name: /project-a/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-b/ })).not.toBeNull();
    expect(view.queryByText("Mac mini · project-a")).toBeNull();
  });

  it("目录先返回时立即展示全部项目并为未加载项目显示局部骨架", () => {
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "ready",
        "/tmp/project-b": "loading",
        "/tmp/project-c": "loading",
      },
    });
    const view = within(container);

    expect(view.getByRole("heading", { name: /project-a/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-b/ })).not.toBeNull();
    expect(view.getByRole("heading", { name: /project-c/ })).not.toBeNull();
    expect(
      view.getAllByLabelText("正在加载项目会话"),
    ).toHaveLength(1);
  });

  it("静默刷新已有项目时保留线程且不显示项目骨架", () => {
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "loading",
        "/tmp/project-b": "ready",
      },
    });
    const view = within(container);

    expect(view.getByText("置顶会话")).not.toBeNull();
    expect(view.queryByLabelText("正在加载项目会话")).toBeNull();
  });

  it("首次加载失败时只重试对应项目", () => {
    const onRetryProject = vi.fn();
    const { container } = renderList("mini", {
      projectDirectories: [
        "/tmp/project-a",
        "/tmp/project-b",
        "/tmp/project-c",
      ],
      projectThreadStates: {
        "/tmp/project-a": "ready",
        "/tmp/project-b": "ready",
        "/tmp/project-c": "error",
      },
      onRetryProject,
    });
    const view = within(container);

    fireEvent.click(
      view.getByRole("button", { name: "重试加载 project-c 会话" }),
    );

    expect(onRetryProject).toHaveBeenCalledWith(
      "mini",
      "/tmp/project-c",
    );
  });

  it("首页项目请求未全部结束时在机器前显示 loading", () => {
    const { container } = renderList("mini", {
      loadingBackendIds: new Set(["mini"]),
    });
    const machine = within(container).getByRole("button", {
      name: /Mac mini/,
    });

    expect(
      within(machine).getByLabelText("正在加载机器会话"),
    ).not.toBeNull();
  });

  it("点击项目标题切换折叠状态并显示对应文件夹图标", () => {
    const onToggleProjectCollapsed = vi.fn();
    const { container } = renderList("mini", {
      collapsedProjectKeys: new Set(["mini:/tmp/project-a"]),
      onToggleProjectCollapsed,
    });
    const view = within(container);
    const projectButton = view.getByRole("button", { name: /project-a/ });

    expect(projectButton.getAttribute("aria-expanded")).toBe("false");
    expect(projectButton.querySelector('[data-icon="folder"]')).not.toBeNull();
    expect(view.queryByText("置顶会话")).toBeNull();
    expect(view.getByText("最近会话")).not.toBeNull();

    fireEvent.click(projectButton);
    expect(onToggleProjectCollapsed).toHaveBeenCalledWith(
      "mini",
      "/tmp/project-a",
    );
  });

  it("搜索期间临时展开匹配项目但不改变缓存状态", () => {
    const collapsedProjectKeys = new Set(["mini:/tmp/project-a"]);
    const { container } = renderList("mini", {
      collapsedProjectKeys,
      query: "置顶",
    });
    const view = within(container);
    const projectButton = view.getByRole("button", { name: /project-a/ });

    expect(projectButton.getAttribute("aria-expanded")).toBe("true");
    expect(projectButton.querySelector('[data-icon="folder-open"]')).not.toBeNull();
    expect(view.getByText("置顶会话")).not.toBeNull();
    expect(collapsedProjectKeys.has("mini:/tmp/project-a")).toBe(true);
  });

  it("在未查看会话的右侧时间前显示蓝点", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const unreadThreads = threads.map((thread) =>
      thread.threadId === "pinned" ? { ...thread, unread: true } : thread,
    );
    const { container } = render(
      <ThreadListPage
        backends={[backend]}
        summaries={summaries}
        selectedBackendId="mini"
        threadListState="ready"
        visibleThreads={unreadThreads}
        totalThreadCount={unreadThreads.length}
        projectDirectories={["/tmp/project-a", "/tmp/project-b"]}
        projectVisibleCounts={{}}
        collapsedProjectKeys={new Set()}
        loadingProjectKeys={new Set()}
        loadingBackendIds={new Set()}
        refreshing={false}
        projectThreadStates={{}}
        openingThreadId=""
        query=""
        error=""
        onQueryChange={() => undefined}
        onOpenThread={() => undefined}
        onNewChat={() => undefined}
        onSelectBackend={() => undefined}
        onManageBackends={() => undefined}
        onRefresh={() => undefined}
        onRetryProject={() => undefined}
        onToggleProject={() => undefined}
        onToggleProjectCollapsed={() => undefined}
      />,
    );

    const unread = within(container).getByLabelText("未读");
    const meta = unread.closest(".thread-row-meta");

    expect(meta).not.toBeNull();
    expect(within(meta as HTMLElement).getByText("1m")).not.toBeNull();
    expect(meta?.firstElementChild).toBe(unread);
    now.mockRestore();
  });
});
