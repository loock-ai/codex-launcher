import { useEffect, useState } from "react";
import {
  isThreadRunning,
  relativeTime,
} from "../../ui/conversation";
import {
  AppIcon,
  titleOf,
  type ThreadListState,
} from "../../ui/app-display";
import { ErrorBanner } from "../../ui/ErrorBanner";
import type {
  BackendConfig,
  BackendRuntimeSummary,
} from "../../backends/types";
import type { ProjectThreadLoadState } from "../../app-server/thread-list-loader";
import { BackendSwitcher } from "../backends/BackendSwitcher";
import {
  groupThreadsByProject,
  splitAllThreads,
  type AggregatedThreadItem,
} from "./thread-list-model";
import { projectCollapseKey } from "./project-collapse";
import { t } from "../../i18n";

export function ThreadListPage({
  backends,
  summaries,
  selectedBackendId,
  loadingBackendIds,
  refreshing,
  threadListState,
  visibleThreads,
  totalThreadCount,
  projectDirectories,
  projectThreadStates,
  projectVisibleCounts,
  collapsedProjectKeys,
  loadingProjectKeys,
  openingThreadId,
  query,
  error,
  onQueryChange,
  onOpenThread,
  onNewChat,
  onSelectBackend,
  onManageBackends,
  onRefresh,
  onRetryProject,
  onToggleProject,
  onToggleProjectCollapsed,
}: {
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  selectedBackendId: string;
  loadingBackendIds: Set<string>;
  refreshing: boolean;
  threadListState: ThreadListState;
  visibleThreads: AggregatedThreadItem[];
  totalThreadCount: number;
  projectDirectories: string[];
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  projectVisibleCounts: Record<string, number>;
  collapsedProjectKeys: Set<string>;
  loadingProjectKeys: Set<string>;
  openingThreadId: string;
  query: string;
  error: string;
  onQueryChange: (value: string) => void;
  onOpenThread: (thread: AggregatedThreadItem) => void | Promise<void>;
  onNewChat: () => void;
  onSelectBackend: (backendId: string) => void;
  onManageBackends: () => void;
  onRefresh: () => void;
  onRetryProject: (backendId: string, cwd: string) => void;
  onToggleProject: (backendId: string, cwd: string) => void;
  onToggleProjectCollapsed: (backendId: string, cwd: string) => void;
}) {
  const enabledBackends = backends.filter((backend) => backend.enabled);
  const onlineCount = enabledBackends.filter(
    (backend) => summaries[backend.id]?.connection === "online",
  ).length;
  const selectedBackend = enabledBackends.find(
    (backend) => backend.id === selectedBackendId,
  );
  const selectedSummary = selectedBackend
    ? summaries[selectedBackend.id]
    : undefined;
  const allGroups = splitAllThreads(visibleThreads);
  const projectGroups = groupThreadsByProject(visibleThreads, projectDirectories);
  const [renderNow, setRenderNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setRenderNow(Math.floor(Date.now() / 1000)), 30000);
    return () => clearInterval(timer);
  }, []);
  const renderRow = (
    thread: AggregatedThreadItem,
    showSource: boolean,
  ) => (
    <button
      key={`${thread.backendId}:${thread.threadId}`}
      className={`thread-row${showSource ? " with-source" : ""}`}
      disabled={openingThreadId === `${thread.backendId}:${thread.threadId}`}
      aria-busy={openingThreadId === `${thread.backendId}:${thread.threadId}`}
      onClick={() => void onOpenThread(thread)}
    >
      <span className="thread-row-title">
        <span>{titleOf(thread.thread)}</span>
      </span>
      {isThreadRunning(thread.status) ? (
        <span className="thread-running" aria-label={t("进行中")}>
          <i className="running-dot" />
          <i className="running-spinner" />
        </span>
      ) : (
        <span className="thread-row-meta">
          {thread.unread && (
            <i className="thread-unread-dot" aria-label={t("未读")} />
          )}
          <time>{relativeTime(thread.timestamp, renderNow)}</time>
        </span>
      )}
      {showSource && (
        <small className="thread-source">
          {thread.backendName} · {thread.projectName}
        </small>
      )}
    </button>
  );

  return (
    <section className="thread-list-page">
      <div className="thread-list-sticky">
        <header className="list-header">
          <div>
            <h1>Codex Mobile</h1>
            <p>
              <i
                className={`status-dot ${
                  onlineCount ? "online" : "connecting"
                }`}
              />
              {selectedBackend
                ? `${selectedBackend.name} · ${
                    selectedSummary?.connection === "online"
                      ? t("已连接")
                      : selectedSummary?.connection === "offline"
                        ? t("已断开")
                        : t("连接中")
                  }`
                : t("{count} 台机器 · {online} 台已连接", {
                    count: enabledBackends.length,
                    online: onlineCount,
                  })}
            </p>
          </div>
          <div className="list-header-actions">
            <button type="button" className="round-button" aria-label="Dots" onClick={()=>{window.location.hash="dots";}}>Dots</button>
            <button
              className={`round-button${refreshing ? " refreshing" : ""}`}
              aria-label={t("刷新会话列表")}
              aria-busy={refreshing}
              onClick={onRefresh}
            >
              {refreshing ? (
                <i className="sidebar-refresh-spinner" aria-hidden="true" />
              ) : (
                <AppIcon name="refresh" />
              )}
            </button>
            <button
              className="round-button"
              aria-label={t("管理设备")}
              onClick={onManageBackends}
            >
              <AppIcon name="more" />
            </button>
          </div>
        </header>
        <BackendSwitcher
          backends={backends}
          summaries={summaries}
          selectedBackendId={selectedBackendId}
          loadingBackendIds={loadingBackendIds}
          onSelect={onSelectBackend}
        />
      </div>
      <div className="thread-list">
        {threadListState === "loading" && (
          <div
            className="thread-list-skeleton"
            aria-label={t("正在加载会话")}
            role="status"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <div className="thread-row-skeleton" key={index}>
                <i />
                <i />
              </div>
            ))}
          </div>
        )}
        {threadListState !== "loading" && selectedBackendId === "all" && (
          <>
            {!!allGroups.pinned.length && (
              <section className="thread-section">
                <h2>{t("置顶")}</h2>
                {allGroups.pinned.map((thread) => renderRow(thread, true))}
              </section>
            )}
            {!!allGroups.recent.length && (
              <section className="thread-section">
                <h2>{t("最近")}</h2>
                {allGroups.recent.map((thread) => renderRow(thread, true))}
              </section>
            )}
          </>
        )}
        {threadListState !== "loading" && selectedBackendId !== "all" && (
          <>
            {projectGroups
              .filter(
                (group) => !query.trim() || group.threads.length > 0,
              )
              .map((group) => {
                const projectKey = projectCollapseKey(
                  selectedBackendId,
                  group.cwd,
                );
                const isExpanded =
                  Boolean(query.trim()) ||
                  !collapsedProjectKeys.has(projectKey);
                const visibleCount =
                  projectVisibleCounts[projectKey] ?? 5;
                const isLoadingMore = loadingProjectKeys.has(projectKey);
                const projectThreadState =
                  projectThreadStates[group.cwd] ??
                  (group.threads.length ? "ready" : "idle");
                const showInitialLoading =
                  projectThreadState === "loading" &&
                  group.threads.length === 0;
                const showInitialError =
                  projectThreadState === "error" &&
                  group.threads.length === 0;
                return (
                  <section className="project-group" key={group.cwd}>
                    <h2>
                      <button
                        type="button"
                        className="project-heading"
                        aria-expanded={isExpanded}
                        onClick={() =>
                          onToggleProjectCollapsed(
                            selectedBackendId,
                            group.cwd,
                          )
                        }
                      >
                        <AppIcon
                          name={isExpanded ? "folder-open" : "folder"}
                        />
                        <span>{group.projectName}</span>
                      </button>
                    </h2>
                    {isExpanded && (
                      <>
                        {group.threads
                          .slice(0, visibleCount)
                          .map((thread) => renderRow(thread, false))}
                        {showInitialLoading && (
                          <div
                            className="project-thread-skeleton"
                            aria-label={t("正在加载项目会话")}
                            role="status"
                          >
                            {Array.from({ length: 3 }, (_, index) => (
                              <div className="thread-row-skeleton" key={index}>
                                <i />
                                <i />
                              </div>
                            ))}
                          </div>
                        )}
                        {showInitialError && (
                          <button
                            type="button"
                            className="project-retry"
                            aria-label={t("重试加载 {name} 会话", {
                              name: group.projectName,
                            })}
                            onClick={() =>
                              onRetryProject(selectedBackendId, group.cwd)
                            }
                          >
                            {t("加载失败，点击重试")}
                          </button>
                        )}
                        {!showInitialLoading &&
                          !showInitialError &&
                          (isLoadingMore ||
                            group.threads.length >= visibleCount) && (
                          <button
                            type="button"
                            className="project-more"
                            disabled={isLoadingMore}
                            aria-busy={isLoadingMore}
                            onClick={() =>
                              onToggleProject(
                                selectedBackendId,
                                group.cwd,
                              )
                            }
                          >
                            {isLoadingMore ? (
                              <>
                                <i
                                  className="action-spinner"
                                  aria-hidden="true"
                                />
                                {t("加载中")}
                              </>
                            ) : (
                              t("展开显示")
                            )}
                          </button>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
          </>
        )}
        {threadListState === "ready" &&
          !visibleThreads.length &&
          (selectedBackendId === "all" ||
            !projectDirectories.length ||
            Boolean(query.trim())) && (
          <div className="empty-state">
            {query.trim() ? t("没有匹配的对话") : t("暂无对话")}
          </div>
        )}
        {threadListState === "error" && !totalThreadCount && (
          <div className="empty-state">{t("无法加载会话")}</div>
        )}
      </div>
      <ErrorBanner message={error} />
      <footer className="list-actions">
        <label className="search-box"><AppIcon name="search" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("搜索聊天")} /></label>
        <button
          className="new-chat"
          onClick={onNewChat}
        >
          <AppIcon name="compose" />{t("聊天")}
        </button>
      </footer>
    </section>
  );
}
