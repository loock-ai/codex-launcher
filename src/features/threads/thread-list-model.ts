import { titleOf, type DisplayRecord } from "../../ui/app-display";
import { t } from "../../i18n";

export interface ThreadSource {
  id: string;
  name: string;
}

export interface AggregatedThreadItem extends DisplayRecord {
  backendId: string;
  backendName: string;
  threadId: string;
  projectName: string;
  timestamp: number;
  pinned: boolean;
  unread: boolean;
  thread: DisplayRecord;
}

export interface ProjectThreadGroup {
  cwd: string;
  projectName: string;
  threads: AggregatedThreadItem[];
}

export function projectNameOf(thread: DisplayRecord) {
  const cwd = typeof thread.cwd === "string" ? thread.cwd.trim() : "";
  const normalized = cwd.replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).at(-1) || t("未识别项目");
}

function threadTimestamp(thread: DisplayRecord) {
  // 元数据同步会更新 updatedAt；列表时间与排序优先使用最近一轮活动时间。
  if (typeof thread.recencyAt === "number" && Number.isFinite(thread.recencyAt) && thread.recencyAt > 0) {
    return thread.recencyAt;
  }
  return Number(thread.updatedAt ?? thread.createdAt ?? 0);
}

export function aggregateThreads(
  backends: ThreadSource[],
  threadsByBackend: Record<string, DisplayRecord[]>,
) {
  return backends
    .flatMap((backend) =>
      (threadsByBackend[backend.id] ?? []).map(
        (thread): AggregatedThreadItem => ({
          ...thread,
          backendId: backend.id,
          backendName: backend.name,
          threadId: String(thread.id),
          projectName: projectNameOf(thread),
          timestamp: threadTimestamp(thread),
          pinned: thread.isPinned === true,
          unread: thread.isUnread === true,
          thread,
        }),
      ),
    )
    .sort(
      (left, right) =>
        right.timestamp - left.timestamp ||
        left.threadId.localeCompare(right.threadId),
    );
}

export function filterAggregatedThreads(
  threads: AggregatedThreadItem[],
  query: string,
  includeBackendName = true,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return threads;
  return threads.filter((item) =>
    [
      titleOf(item.thread),
      ...(includeBackendName ? [item.backendName] : []),
      item.projectName,
    ]
      .join("\n")
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export function splitAllThreads(threads: AggregatedThreadItem[]) {
  return {
    pinned: threads.filter((thread) => thread.pinned),
    recent: threads.filter((thread) => !thread.pinned),
  };
}

export function groupThreadsByProject(
  threads: AggregatedThreadItem[],
  projectDirectories: string[] = [],
): ProjectThreadGroup[] {
  const projectOrder = new Map(
    projectDirectories.map((cwd, index) => [cwd, index]),
  );
  const groups = new Map<string, AggregatedThreadItem[]>();
  for (const cwd of projectDirectories) groups.set(cwd, []);
  for (const thread of threads) {
    const cwd = String(thread.cwd ?? "");
    const group = groups.get(cwd) ?? [];
    group.push(thread);
    groups.set(cwd, group);
  }
  return [...groups.entries()]
    .map(([cwd, projectThreads]) => ({
      cwd,
      projectName: projectNameOf({ cwd }),
      threads: projectThreads.sort(
        (left, right) => right.timestamp - left.timestamp,
      ),
    }))
    .sort((left, right) => {
      const leftOrder = projectOrder.get(left.cwd);
      const rightOrder = projectOrder.get(right.cwd);
      if (leftOrder !== undefined || rightOrder !== undefined) {
        if (leftOrder === undefined) return 1;
        if (rightOrder === undefined) return -1;
        return leftOrder - rightOrder;
      }
      const timeDifference =
        (right.threads[0]?.timestamp ?? 0) -
        (left.threads[0]?.timestamp ?? 0);
      return timeDifference || left.projectName.localeCompare(right.projectName);
    });
}
