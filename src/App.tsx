import {isDesktopEnvironment} from './ui/desktop-layout';
import {DotsPage} from "./features/dots/DotsPage";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {createHistoryObservation,observeHistoryEvent,mergeObservedHistory,isHistoryEvent,observingHistoryClient,type HistoryObservation} from "./app-server/history-observation";
import {appendReasoningDelta} from "./ui/reasoning";
import {loadDesktopModels,loadDesktopPermissions} from "./app-server/model-catalog";
import {useDesktopBackends,type DesktopHost} from "./backends/desktop-hosts";
import {displayedHostIds} from "./backends/host-selection";
import { AppServerClient, type RpcMessage } from "./app-server/client";
import {
  createLatestThreadListLoader,
  type ProjectThreadLoadState,
} from "./app-server/thread-list-loader";
import {
  applyCompletedTurn,
  applyFileChangePatch,
  applyTurnDiff,
  applyTurnItem,
  applyTurnStarted,
  createPendingTurn,
  isThreadRunning,
  reconcileRecentTurns,
  removePendingTurn,
} from "./ui/conversation";
import {
  loadRecoverableRecentThreadTurns,
  loadOlderThreadTurns,
  prependUniqueTurns,
  resumeThreadSession,
  reconcileDesktopTurnsAfterResume,
  type OlderTurnsLoadState,
  type ThreadAccessMode,
} from "./app-server/thread-session";
import {
  activeTurnId,
  clearPendingSteerForItem,
  clearPendingSteerForRequest,
  clearPendingSteerForThread,
  clearPendingSteerForTimeline,
  mergeSteerDraft,
  type PendingSteerMessage,
} from "./app-server/turn-steering";
import {
  activeThreadAfterArchive,
  setThreadPinned,
} from "./app-server/thread-metadata";
import {
  ConversationPage,
  type ConversationLoadState,
} from "./features/conversation/ConversationPage";
import { ThreadListPage } from "./features/threads/ThreadListPage";
import { UserQuestionCard } from "./features/approvals/UserQuestionCard";
import { selectVisibleRequests, questionRequestKey, buildQuestionAnswers, isUnknownWrite } from "./features/approvals/user-questions";
import { sendSteeringInput, restoreSteeringDraft } from "./features/conversation/steer-request";
import { ApprovalSheet } from "./features/approvals/ApprovalSheet";
import {
  ComposerSettings,
  type ComposerPicker,
} from "./features/settings/ComposerSettings";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type ThreadListState,
} from "./ui/app-display";
import {
  ImageReadGeneration,
  buildOptimisticUserContent,
  buildTurnInput,
  mergeDraftImages,
  prepareImageFiles,
  prepareAttachmentFiles,
  isNativeImageFile,
  type DraftImage,
  type DraftFile,
} from "./ui/attachments";
import { uploadConversationAttachments } from "./backends/file-upload";
import {
  effortOptionsForModel,
  defaultNewChatPermissionMode,
  normalizeModelSettings,
  permissionModeFromSettings,
  permissionModesFromProfiles,
  permissionProfileLabel,
  speedOptionsForModel,
  type ApprovalPolicy,
  type ApprovalsReviewer,
  type PermissionMode,
  type PermissionModeId,
} from "./ui/settings";
import {
  assignBackendHostId,
  loadBackendRegistry,
  saveBackendRegistry,
} from "./backends/registry";
import { BackendConnectionManager } from "./backends/connection-manager";
import {
  bindConnectionRecovery,
  bindReadOnlyThreadRefresh,
  reconnectAndWaitUntilReady,
  recoverBackendConnection,
} from "./backends/connection-recovery";
import { fetchBackendHostInfo, fetchBackendProjects } from "./backends/probe";
import type {
  BackendConfig,
  BackendRegistry,
  BackendRuntimeSummary,
} from "./backends/types";
import { BackendManagerSheet } from "./features/backends/BackendManagerSheet";
import { BackendAttentionBanner } from "./features/backends/BackendAttentionBanner";
import { AppUpdateSheet } from "./features/update/AppUpdateSheet";
import {
  useAppUpdate,
  type AppUpdateController,
} from "./features/update/useAppUpdate";
import {
  aggregateThreads,
  filterAggregatedThreads,
  type AggregatedThreadItem,
} from "./features/threads/thread-list-model";
import {
  projectCollapseKey,
  readCollapsedProjectKeys,
  writeCollapsedProjectKeys,
} from "./features/threads/project-collapse";
import { useSidebarRefresh } from "./features/threads/sidebar-refresh";
import {
  readUnreadThreadIds,
  shouldMarkThreadUnread,
  writeUnreadThreadIds,
} from "./features/threads/thread-unread";
import { t, useI18n } from "./i18n";

type AnyRecord = Record<string, any>;

interface BackendThreadSnapshot {
  backendId: string;
  threads: AnyRecord[];
  projects: string[];
  projectThreadStates: Record<string, ProjectThreadLoadState>;
  loadingProjectCwd: string;
  refreshing: boolean;
  threadListState: ThreadListState;
  openingThreadId: string;
  error: string;
}

interface WorkspaceCommand {
  id: number;
  backendId: string;
  type: "new" | "open" | "load-project" | "retry-project";
  thread?: AnyRecord;
  cwd?: string | null;
  draft?: string;
  draftImages?: DraftImage[];
  draftFiles?: DraftFile[];
}

interface BackendWorkspaceProps {
  backend: BackendConfig;
  conversationVisible: boolean;
  backends: BackendConfig[];
  summaries: Record<string, BackendRuntimeSummary>;
  onSummaryChange: (summary: BackendRuntimeSummary) => void;
  onSnapshotChange: (snapshot: BackendThreadSnapshot) => void;
  onOpenSidebar: () => void;
  onSwitchNewChatBackend: (
    backendId: string,
    draft: string,
    draftImages: DraftImage[],
    draftFiles: DraftFile[],
  ) => void;
  command: WorkspaceCommand | null;
  refreshVersion: number;
}

function BackendWorkspace({
  backend,
  conversationVisible,
  backends,
  summaries,
  onSummaryChange,
  onSnapshotChange,
  onOpenSidebar,
  onSwitchNewChatBackend,
  command,
  refreshVersion,
}: BackendWorkspaceProps) {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [threads, setThreads] = useState<AnyRecord[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [projectThreadStates, setProjectThreadStates] = useState<
    Record<string, ProjectThreadLoadState>
  >({});
  const [loadingProjectCwd, setLoadingProjectCwd] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [threadListState, setThreadListState] =
    useState<ThreadListState>("loading");
  const [active, setActive] = useState<AnyRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftFiles, setDraftFiles] = useState<DraftFile[]>([]);
  const [imageReading, setImageReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startingThreadContext, setStartingThreadContext] = useState<
    number | null
  >(null);
  const [steering, setSteering] = useState(false);
  const [pendingSteerMessage, setPendingSteerMessage] =
    useState<PendingSteerMessage | null>(null);
  const [error, setError] = useState("");
  const [requests, setRequests] = useState<RpcMessage[]>([]);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [approvalUnknown,setApprovalUnknown] = useState(false);
  const [approvalSubmitted,setApprovalSubmitted] = useState(false);
  const requestReplyLocks = useRef(new Map<string,'pending'|'unknown'|'submitted'>());
  const requestsRef = useRef(requests); requestsRef.current = requests;
  const currentApprovalKeyRef = useRef('');
  const steeringRequestRef = useRef(false);
  const [userAnswers, setUserAnswers] = useState<Record<string, string>>({});
  const [models, setModels] = useState<AnyRecord[]>([]);
  const [permissionProfiles, setPermissionProfiles] = useState<AnyRecord[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [desktopModelOverride,setDesktopModelOverride]=useState(false);
  const [desktopPermissionOverride,setDesktopPermissionOverride]=useState(false);
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [selectedServiceTier, setSelectedServiceTier] = useState<string | null>(null);
  const [selectedPermission, setSelectedPermission] = useState("");
  const [selectedApprovalPolicy, setSelectedApprovalPolicy] =
    useState<ApprovalPolicy>("on-request");
  const [selectedApprovalsReviewer, setSelectedApprovalsReviewer] =
    useState<ApprovalsReviewer>("user");
  const [newChatPermissionMode, setNewChatPermissionMode] =
    useState<PermissionMode | null>(null);
  const [activeSettingsSynchronized, setActiveSettingsSynchronized] =
    useState(true);
  const [activeThreadAccessMode, setActiveThreadAccessMode] =
    useState<ThreadAccessMode>("interactive");
  const [activeThreadResumeError, setActiveThreadResumeError] = useState("");
  const [openingThreadId, setOpeningThreadId] = useState("");
  const [conversationLoadState, setConversationLoadState] =
    useState<ConversationLoadState>("idle");
  const [conversationLoadError, setConversationLoadError] = useState("");
  const [olderTurnsState, setOlderTurnsState] =
    useState<OlderTurnsLoadState>("exhausted");
  const [tokenUsageByThread, setTokenUsageByThread] = useState<
    Record<string, AnyRecord>
  >({});
  const [rateLimits, setRateLimits] = useState<AnyRecord | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [notice, setNotice] = useState("");
  const [picker, setPicker] = useState<ComposerPicker>(null);
  const clientRef = useRef<AppServerClient | null>(null);
  const connectionManagerRef = useRef<BackendConnectionManager | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const imageReadGenerationRef = useRef(new ImageReadGeneration());
  const draftContextGenerationRef = useRef(0);
  const activeRef = useRef<AnyRecord | null>(null);
  const conversationVisibleRef = useRef(conversationVisible);
  const activeThreadTargetRef = useRef<string | null>(null);
  const openSequenceRef = useRef(0);
  const olderTurnsCursorRef = useRef<string | null>(null);
  const olderTurnsGenerationRef = useRef(0);
  const olderTurnsLoadingRef = useRef(false);
  const fullyLoadedProjectCwdsRef = useRef(new Set<string>());
  const refreshSequenceRef = useRef(0);
  const threadNotificationSequenceRef = useRef(0);
  const historyObservationRef=useRef<HistoryObservation|null>(null);
  const pendingSequenceRef = useRef(0);
  const readLocalUnread = () =>
    readUnreadThreadIds(localStorage, backend.id);
  const writeLocalUnread = (ids: Set<string>) => {
    writeUnreadThreadIds(localStorage, backend.id, ids);
  };
  const markThreadRead = (threadId: string) => {
    const unread = readLocalUnread();
    if (!unread.delete(threadId)) return;
    writeLocalUnread(unread);
    setThreads((current) =>
      current.map((thread) =>
        String(thread.id) === threadId
          ? { ...thread, isUnread: false }
          : thread,
      ),
    );
  };
  const markThreadUnread = (threadId: string) => {
    const unread = readLocalUnread();
    unread.add(threadId);
    writeLocalUnread(unread);
    setThreads((current) =>
      current.map((thread) =>
        String(thread.id) === threadId
          ? { ...thread, isUnread: true }
          : thread,
      ),
    );
  };
  const threadListLoaderRef = useRef<ReturnType<
    typeof createLatestThreadListLoader
  > | null>(null);
  if (!threadListLoaderRef.current) {
    const decorateThreads = (data: AnyRecord[]): AnyRecord[] => {
      const localUnread = readLocalUnread();
      return data.map((thread) => ({
        ...thread,
        isPinned: thread.isPinned === true,
        isUnread: localUnread.has(String(thread.id)),
      }));
    };
    threadListLoaderRef.current = createLatestThreadListLoader({
      onData(data) {
        setThreads(decorateThreads(data));
        setThreadListState("ready");
      },
      onProjectStart(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "loading",
        }));
      },
      onProjectData(cwd, data) {
        const nextProjectThreads = decorateThreads(data);
        setThreads((current) => {
          const currentProjectThreads = current.filter(
            (thread) => thread.cwd === cwd,
          );
          const retainedExpandedThreads =
            fullyLoadedProjectCwdsRef.current.has(cwd)
              ? currentProjectThreads.filter(
                  (thread) =>
                    !nextProjectThreads.some(
                      (next) => String(next.id) === String(thread.id),
                    ),
                )
              : [];
          return [
            ...current.filter((thread) => thread.cwd !== cwd),
            ...nextProjectThreads,
            ...retainedExpandedThreads,
          ];
        });
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "ready",
        }));
        setThreadListState("ready");
      },
      onProjectError(cwd) {
        setProjectThreadStates((current) => ({
          ...current,
          [cwd]: "error",
        }));
      },
      onSettled() {
        setThreadListState("ready");
      },
    });
  }

  useEffect(() => {
    activeRef.current = active;
    setPendingSteerMessage((current) =>
      clearPendingSteerForTimeline(current, active),
    );
  }, [active]);

  useEffect(() => {
    conversationVisibleRef.current = conversationVisible;
  }, [conversationVisible]);

  async function loadThreads(client = clientRef.current) {
    if (!client || client !== clientRef.current) return;
    try {
      let directories: string[] = [];
      try {
        directories = await fetchBackendProjects(backend);
        setProjects(directories);
        if (directories.length) setThreadListState("ready");
      } catch {
        directories = projects;
        if (directories.length) setThreadListState("ready");
      }
      await threadListLoaderRef.current!.load(client, directories);
    } catch (reason) {
      setThreadListState((current) =>
        current === "loading" ? "error" : current,
      );
      throw reason;
    }
  }

  async function reconcileActiveThread(
    client: AppServerClient,
    isCurrent: () => boolean = () => true,
  ) {
    const threadId = String(
      activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
    );
    if (!threadId || client !== clientRef.current) return;
    const discardPendingThrough = pendingSequenceRef.current;

    const latestTurns = await loadRecoverableRecentThreadTurns(
      client,
      threadId,
      () => threadNotificationSequenceRef.current,
    );
    if (
      client !== clientRef.current ||
      String(
        activeThreadTargetRef.current ?? activeRef.current?.id ?? "",
      ) !== threadId ||
      activeRef.current?.id !== threadId ||
      latestTurns == null ||
      !isCurrent()
    ) {
      return;
    }

    const lastTurn = latestTurns.at(-1);
    const running =
      ["inProgress", "in_progress", "running"].includes(
        String(lastTurn?.status ?? ""),
      ) || pendingSequenceRef.current > discardPendingThrough;
    setActive((current) =>
      current?.id === threadId
        ? {
            ...current,
            turns: reconcileRecentTurns(current.turns ?? [], latestTurns, {
              discardPendingThrough,
            }),
          }
        : current,
    );
    setBusy(running);
    setThreads((entries) =>
      entries.map((entry) =>
        entry.id === threadId
          ? {
              ...entry,
              status: { type: running ? "active" : "idle" },
            }
          : entry,
      ),
    );
  }

  useEffect(() => {
    if (
      activeThreadAccessMode !== "readOnly" ||
      !active?.id ||
      !conversationVisible ||
      conversationLoadState !== "ready"
    ) return;
    return bindReadOnlyThreadRefresh({
      refresh: async (isCurrent) => {
        const client = clientRef.current;
        if (client) await reconcileActiveThread(client, isCurrent);
      },
    });
  }, [
    active?.id,
    activeThreadAccessMode,
    conversationLoadState,
    conversationVisible,
  ]);

  useEffect(() => {
    const hasRunningThread = threads.some((thread) =>
      isThreadRunning(thread.status),
    );
    onSummaryChange({
      backendId: backend.id,
      connection,
      busy: busy || hasRunningThread,
      approvalCount: requests.length,
      error,
    });
  }, [
    backend.id,
    busy,
    connection,
    error,
    onSummaryChange,
    requests.length,
    threads,
  ]);

  useEffect(() => {
    onSnapshotChange({
      backendId: backend.id,
      threads,
      projects,
      projectThreadStates,
      loadingProjectCwd,
      refreshing,
      threadListState,
      openingThreadId,
      error,
    });
  }, [
    backend.id,
    error,
    onSnapshotChange,
    openingThreadId,
    threadListState,
    threads,
    projects,
    projectThreadStates,
    loadingProjectCwd,
    refreshing,
  ]);

  useEffect(() => {
    if (!refreshVersion) return;
    const sequence = ++refreshSequenceRef.current;
    fullyLoadedProjectCwdsRef.current.clear();
    setThreadListState((current) => (projects.length ? current : "loading"));
    setRefreshing(true);
    if (!clientRef.current) {
      connectionManagerRef.current?.reconnect(backend.id);
      return;
    }
    void loadThreads()
      .catch(() => undefined)
      .finally(() => {
        if (sequence === refreshSequenceRef.current) setRefreshing(false);
      });
  }, [refreshVersion]);

  useEffect(() => {
    let disposed = false;
    let manager: BackendConnectionManager;
    manager = new BackendConnectionManager({
      onConnection: (_backendId, status, connectionError) => {
        if (disposed) return;
        setConnection(status);
        if (status === "online") setError("");
        if (connectionError) setError(connectionError);
        if (status === "connecting") {
          clientRef.current = null;
        }
        if (status === "offline") {
          clientRef.current = null;
          setRefreshing(false);
          setBusy(false);
          setSteering(false);
          setPendingSteerMessage(null);
          setRequests([]);
          void fetchBackendHostInfo(backend).catch((reason) => {
            const message =
              reason instanceof Error ? reason.message : String(reason);
            if (
              message.includes(t("访问口令不正确")) ||
              message.includes(t("当前前端地址未被设备允许"))
            ) {
              manager.sync([]);
              setError(message);
            }
          });
        }
      },
      onNotification: (_backendId, message, source) => {
          const client = source as AppServerClient;
          const params = (message.params ?? {}) as AnyRecord;
          observeHistoryEvent(historyObservationRef.current,message);
          if (
            isHistoryEvent(message.method??"") && params.threadId &&
            params.threadId ===
              (activeThreadTargetRef.current ?? activeRef.current?.id)
          ) {
            threadNotificationSequenceRef.current += 1;
          }
          if (message.method === "desktop/disconnected") { setError(params.reason ?? "桌面控制通道断开"); manager.socket(backend.id)?.close(1011, "desktop disconnected"); }
          if (message.method === "desktop/error") setError(params.message ?? t("桌面操作未确认，请在桌面核对"));
          if (message.method === "desktop/approval/resolved" || message.method === "serverRequest/resolved") {
            const resolvedId = params.id ?? params.requestId;
            setRequests(current => current.filter(request => {
              const matches = String(request.id) === String(resolvedId) && (!params.threadId || (request.params as AnyRecord)?.threadId === params.threadId);
              if(matches)requestReplyLocks.current.delete(questionRequestKey(request));
              return !matches;
            }));
          }
          if ((message.method === "desktop/thread/changed" || message.method === "desktop/thread/snapshot") && params.thread) {
            activeThreadTargetRef.current = params.threadId;
            setActive(params.thread);
            setBusy(params.thread.status?.type === "active");
          }
          if (message.method === "turn/started" && params.turn) {
            if (params.threadId) {
              setThreads((current) => {
                const index = current.findIndex(
                  (thread) => thread.id === params.threadId,
                );
                if (index >= 0) {
                  return current.map((thread, threadIndex) =>
                    threadIndex === index
                      ? { ...thread, status: { type: "active" } }
                      : thread,
                  );
                }
                const opened = activeRef.current;
                return opened?.id === params.threadId
                  ? [{ ...opened, status: { type: "active" } }, ...current]
                  : current;
              });
            }
            setActive((current) => {
              if (!current) return current;
              const started = applyTurnStarted(current, params);
              if (started !== current) setBusy(true);
              return started;
            });
          }
          if (
            message.method === "thread/tokenUsage/updated" &&
            params.threadId &&
            params.tokenUsage
          ) {
            setTokenUsageByThread((current) => ({
              ...current,
              [params.threadId]: params.tokenUsage,
            }));
          }
          if (
            message.method === "account/rateLimits/updated" &&
            params.rateLimits
          ) {
            setRateLimits((current) => ({
              ...(current ?? {}),
              rateLimits: {
                ...(current?.rateLimits ?? {}),
                ...params.rateLimits,
              },
            }));
          }
          if (message.method === "item/agentMessage/delta" && params.delta) {
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item) item.text = `${item.text ?? ""}${params.delta}`;
              return copy;
            });
          }
          if (message.method === "item/started" && params.item) {
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, params),
            );
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (message.method === "item/completed" && params.item) {
            setPendingSteerMessage((current) =>
              clearPendingSteerForItem(current, params),
            );
            setActive((current) =>
              current ? applyTurnItem(current, params) : current,
            );
          }
          if (
            message.method === "item/commandExecution/outputDelta" ||
            message.method === "item/fileChange/outputDelta" ||
            message.method === "item/reasoning/summaryTextDelta" ||
            message.method === "item/reasoning/textDelta"
          ) {
            const streamMethod = message.method ?? "";
            setActive((current) => {
              if (!current || current.id !== params.threadId) return current;
              const copy = structuredClone(current);
              const turn = copy.turns?.find(
                (entry: AnyRecord) => entry.id === params.turnId,
              );
              const item = turn?.items?.find((entry: AnyRecord) => entry.id === params.itemId);
              if (!item) return current;
              if (item && streamMethod.includes("reasoning")) appendReasoningDelta(item,streamMethod,params);
              else if (item) {
                const key = streamMethod.includes("commandExecution") || streamMethod.includes("fileChange")
                  ? "aggregatedOutput"
                  : "text";
                item[key] = `${item[key] ?? ""}${params.delta ?? ""}`;
              }
              return copy;
            });
          }
          if (message.method === "item/fileChange/patchUpdated") {
            setActive((current) =>
              current ? applyFileChangePatch(current, params) : current,
            );
          }
          if (message.method === "turn/diff/updated") {
            setActive((current) =>
              current ? applyTurnDiff(current, params) : current,
            );
          }
          if (message.method === "turn/completed") {
            if (params.threadId) {
              const threadId = String(params.threadId);
              setPendingSteerMessage((current) =>
                clearPendingSteerForThread(current, threadId),
              );
              if (
                shouldMarkThreadUnread({
                  threadId,
                  activeThreadId: String(activeRef.current?.id ?? ""),
                  conversationVisible: conversationVisibleRef.current,
                  documentVisible:
                    document.visibilityState === "visible",
                })
              ) {
                markThreadUnread(threadId);
              } else {
                markThreadRead(threadId);
              }
              setThreads((current) =>
                current.map((thread) =>
                  String(thread.id) === threadId
                    ? { ...thread, status: { type: "idle" } }
                    : thread,
                ),
              );
            }
            setActive((current) => {
              if (!current) return current;
              const completed = applyCompletedTurn(current, params);
              if (completed === current) return current;
              setBusy(false);
              setSteering(false);
              return completed;
            });
            void loadThreads(client);
          }
          if (
            message.method === "thread/status/changed" &&
            params.threadId &&
            params.status
          ) {
            setThreads((current) =>
              current.map((thread) =>
                thread.id === params.threadId
                  ? { ...thread, status: params.status }
                  : thread,
              ),
            );
          }
          if (
            message.method === "thread/settings/updated" &&
            activeRef.current?.id === params.threadId
          ) {
            const settings = (params.threadSettings ?? {}) as AnyRecord;
            if (typeof settings.model === "string") setSelectedModel(settings.model);
            if ("effort" in settings) {
              setSelectedEffort(settings.effort ?? null);
            }
            if ("serviceTier" in settings) {
              setSelectedServiceTier(settings.serviceTier ?? null);
            }
            if (settings.approvalPolicy) {
              setSelectedApprovalPolicy(settings.approvalPolicy as ApprovalPolicy);
            }
            if (settings.approvalsReviewer) {
              setSelectedApprovalsReviewer(
                settings.approvalsReviewer as ApprovalsReviewer,
              );
            }
            if ("activePermissionProfile" in settings) {
              setSelectedPermission(settings.activePermissionProfile?.id ?? "");
            }
            setActiveSettingsSynchronized(true);
          }
      },
      onRequest: (_backendId, request, source) => {
          const client = source as AppServerClient;
          if(client.backend==='desktop-control'&&(request.params as AnyRecord)?.threadId!==activeThreadTargetRef.current)return;
          if (
            request.method === "item/commandExecution/requestApproval" ||
            request.method === "item/fileChange/requestApproval" ||
            request.method === "item/permissions/requestApproval" ||
            request.method === "item/tool/requestUserInput"
          ) {
            setRequests((current) => {
              const existing = current.find(entry => entry.id === request.id);
              if (!existing) return [...current,request];
              return JSON.stringify(existing.params) === JSON.stringify(request.params) ? current : current.map(entry => entry.id === request.id ? request : entry);
            });
          } else if (client.backend === "desktop-control") {
            setError("此请求需要在桌面处理：" + request.method);
          } else {
            client.respondError(
              request.id!,
              -32601,
              t("Codex Mobile Web 暂不支持服务器请求：{method}", {
                method: request.method ?? "unknown",
              }),
            );
          }
      },
      onReady: (_backendId, source) => {
        const client = source as AppServerClient;
        setDesktopModelOverride(false);setDesktopPermissionOverride(false);
        clientRef.current = client;
        void (async () => {
          let observation:HistoryObservation|null=null;
          try {
            if (!disposed && manager.client(backend.id) === source) {
            const [
              modelResult,
              permissionResult,
              configResult,
              rateLimitResult,
            ] = await (client.backend === "desktop-control"
              ? Promise.all([loadDesktopModels(client).catch(reason=>({data:[] as AnyRecord[],error:reason instanceof Error?reason.message:String(reason)})), loadDesktopPermissions(client).catch(reason=>({data:[] as AnyRecord[],error:reason instanceof Error?reason.message:String(reason)})), Promise.resolve({config:{} as AnyRecord}), Promise.resolve(null)] as const)
              : Promise.all([
              client.request<{ data: AnyRecord[] }>("model/list", {
                limit: 100,
                includeHidden: false,
              }),
              client.request<{ data: AnyRecord[] }>("permissionProfile/list", {
                limit: 100,
                cwd: null,
              }),
              client
                .request<{ config: AnyRecord }>("config/read", {
                  cwd: null,
                  includeLayers: false,
                })
                .catch(() => ({ config: {} })),
              client
                .request<AnyRecord>("account/rateLimits/read", undefined)
                .catch(() => null),
            ]));
            if (disposed || manager.client(backend.id) !== source) return;
            if("error" in permissionResult&&permissionResult.error)setError(t("权限列表加载失败：{message}",{message:String(permissionResult.error)}));
            const availableProfiles = permissionResult.data.filter(
              (profile) => profile.allowed,
            );
            if("error" in modelResult&&modelResult.error)setError(t("模型列表加载失败：{message}",{message:String(modelResult.error)}));
            const config = (configResult.config ?? {}) as AnyRecord;
            const configuredModel = client.backend === "desktop-control" ? "" :
              config.model ||
              modelResult.data.find((model) => model.isDefault)?.model ||
              modelResult.data[0]?.model ||
              "";
            const configuredCatalog = modelResult.data.find(
              (model) => model.model === configuredModel,
            );
            const normalized = normalizeModelSettings(
              configuredCatalog,
              config.model_reasoning_effort,
              config.service_tier,
            );
            const sandboxProfileId =
              config.sandbox_mode === "workspace-write"
                ? ":workspace"
                : typeof config.sandbox_mode === "string"
                  ? `:${config.sandbox_mode}`
                  : "";
            const configuredPermission = client.backend === "desktop-control" ? "" :
              availableProfiles.find((profile) => profile.id === sandboxProfileId)
                ?.id ||
              availableProfiles.find((profile) => profile.id === ":workspace")?.id ||
              availableProfiles.find((profile) => profile.id === ":read-only")?.id ||
              availableProfiles[0]?.id ||
              "";
            setModels(modelResult.data);
            setRateLimits(rateLimitResult);
            setPermissionProfiles(availableProfiles);
            setSelectedModel((current) => current || configuredModel);
            setSelectedEffort((current) => current ?? normalized.effort);
            setSelectedServiceTier(
              (current) => current ?? normalized.serviceTier,
            );
            setSelectedPermission((current) => current || configuredPermission);
            setSelectedApprovalPolicy(
              (current) =>
                config.approval_policy ||
                (configuredPermission === ":danger-full-access"
                  ? "never"
                  : current),
            );
            setSelectedApprovalsReviewer(
              (current) => config.approvals_reviewer || current,
            );
            await loadThreads(client);
            if (disposed || manager.client(backend.id) !== source) return;
            setRefreshing(false);
            const currentThread = activeRef.current;
            if (currentThread?.id) {
              activeThreadTargetRef.current = currentThread.id;
              observation=client.backend==="desktop-control"?createHistoryObservation(currentThread.id):null;
              historyObservationRef.current=observation;
              const resumeSequence=threadNotificationSequenceRef.current;
              const historyClient=observingHistoryClient(client,observation);
              let resumed = await resumeThreadSession(historyClient, currentThread.id,()=>!disposed&&manager.client(backend.id)===source&&activeThreadTargetRef.current===currentThread.id);
              if(client.backend==='desktop-control'&&threadNotificationSequenceRef.current!==resumeSequence){
                const turns=await reconcileDesktopTurnsAfterResume(historyClient,currentThread.id,resumeSequence,()=>threadNotificationSequenceRef.current,resumed.thread.turns??[]);
                resumed={...resumed,thread:{...resumed.thread,turns}};
              }
              if (
                !disposed &&
                manager.client(backend.id) === source &&
                activeRef.current?.id === currentThread.id
              ) {
                const resumedSettings = normalizeModelSettings(
                  modelResult.data.find(
                    (model) => model.model === resumed.model,
                  ),
                  resumed.reasoningEffort,
                  resumed.serviceTier,
                );
                setActive(current=>{const next=mergeObservedHistory(resumed.thread,current,observation);setBusy(["inProgress","in_progress","running"].includes(next.turns?.at(-1)?.status));return {...next,isPinned:next.isPinned===true};});
                resetOlderTurns(resumed.nextTurnsCursor);
                setConversationLoadState("ready");
                setConversationLoadError("");
                setActiveSettingsSynchronized(resumed.settingsSynchronized);
                setActiveThreadAccessMode(resumed.accessMode);
                setActiveThreadResumeError(resumed.resumeError ?? "");
                setSelectedModel(resumed.model ?? "");
                setSelectedEffort(resumedSettings.effort);
                setSelectedServiceTier(resumedSettings.serviceTier);
                if (resumed.approvalPolicy) {
                  setSelectedApprovalPolicy(resumed.approvalPolicy);
                }
                if (resumed.approvalsReviewer) {
                  setSelectedApprovalsReviewer(resumed.approvalsReviewer);
                }
                setSelectedPermission(resumed.activePermissionProfile?.id ?? "");

              }
            }
          }
          } catch (reason) {
            if((reason as {code?:string})?.code==='STALE_RESUME')return;
            if (
              !disposed &&
              manager.client(backend.id) === source
            ) {
              setRefreshing(false);
              setError(
                reason instanceof Error ? reason.message : String(reason),
              );
              if (manager.client(backend.id) === source) {
                manager.socket(backend.id)?.close(
                  1011,
                  "workspace initialization failed",
                );
              }
            }
          } finally {if(historyObservationRef.current===observation)historyObservationRef.current=null;}
        })();
      },
    });
    connectionManagerRef.current = manager;
    manager.sync([backend]);
    const unbindConnectionRecovery = bindConnectionRecovery({
      reconnect: () =>
        recoverBackendConnection(
          clientRef.current,
          () =>
            reconnectAndWaitUntilReady(
              () => manager.reconnect(backend.id),
              () => disposed || clientRef.current != null,
            ),
          reconcileActiveThread,
        ),
    });
    return () => {
      disposed = true;
      unbindConnectionRecovery();
      manager.close();
      if (connectionManagerRef.current === manager) {
        connectionManagerRef.current = null;
      }
      clientRef.current = null;
    };
  }, [backend.baseUrl, backend.id, backend.token]);

  function invalidateImageReads() {
    imageReadGenerationRef.current.invalidate();
    setImageReading(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  function resetDraftContext() {
    draftContextGenerationRef.current += 1;
    invalidateImageReads();
    setPendingSteerMessage(null);
  }

  function resetOlderTurns(cursor: string | null = null) {
    olderTurnsGenerationRef.current += 1;
    olderTurnsLoadingRef.current = false;
    olderTurnsCursorRef.current = cursor;
    setOlderTurnsState(cursor ? "idle" : "exhausted");
  }

  async function loadOlderTurns() {
    const client = clientRef.current;
    const threadId = String(activeRef.current?.id ?? "");
    const cursor = olderTurnsCursorRef.current;
    if (olderTurnsLoadingRef.current) return true;
    if (!client || !threadId || !cursor) {
      return false;
    }

    const generation = olderTurnsGenerationRef.current;
    olderTurnsLoadingRef.current = true;
    setOlderTurnsState("loading");
    try {
      const page = await loadOlderThreadTurns(client, threadId, cursor);
      if (
        generation !== olderTurnsGenerationRef.current ||
        String(activeRef.current?.id ?? "") !== threadId
      ) {
        return false;
      }
      setActive((current) =>
        current && String(current.id) === threadId
          ? {
              ...current,
              turns: prependUniqueTurns(
                current.turns ?? [],
                page.turns,
              ),
            }
          : current,
      );
      olderTurnsCursorRef.current = page.nextCursor;
      setOlderTurnsState(page.nextCursor ? "idle" : "exhausted");
      return true;
    } catch {
      if (
        generation === olderTurnsGenerationRef.current &&
        String(activeRef.current?.id ?? "") === threadId
      ) {
        setOlderTurnsState("error");
      }
      return false;
    } finally {
      if (generation === olderTurnsGenerationRef.current) {
        olderTurnsLoadingRef.current = false;
      }
    }
  }

  async function loadThreadDetail(threadId: string, sequence: number) {
    const client = clientRef.current;
    const observation=client?.backend==='desktop-control'?createHistoryObservation(threadId):null;
    historyObservationRef.current=observation;
    try {
      if (!client) throw new Error(t("设备尚未连接，请稍后重试"));
      const resumeSequence=threadNotificationSequenceRef.current;
      const historyClient=observingHistoryClient(client,observation);
      let session = await resumeThreadSession(historyClient, threadId,()=>sequence===openSequenceRef.current&&clientRef.current===client);
      if(client.backend==='desktop-control'&&threadNotificationSequenceRef.current!==resumeSequence){
        const turns=await reconcileDesktopTurnsAfterResume(historyClient,threadId,resumeSequence,()=>threadNotificationSequenceRef.current,session.thread.turns??[]);
        session={...session,thread:{...session.thread,turns}};
      }
      if (sequence !== openSequenceRef.current) {
        if (activeThreadTargetRef.current !== threadId && client.backend !== "desktop-control") {
          void client
            .request("thread/unsubscribe", { threadId })
            .catch(() => undefined);
        }
        return;
      }
      if (!session.thread?.id) {
        throw new Error(t("会话详情返回无效，请重试"));
      }
      const resumedSettings = normalizeModelSettings(
        models.find((model) => model.model === session.model),
        session.reasoningEffort,
        session.serviceTier,
      );
      setActive(current=>{const next=mergeObservedHistory(session.thread,current,observation);setBusy(["inProgress","in_progress","running"].includes(next.turns?.at(-1)?.status));return {...next,isPinned:next.isPinned===true};});
      resetOlderTurns(session.nextTurnsCursor);
      setActiveSettingsSynchronized(session.settingsSynchronized);
      setActiveThreadAccessMode(session.accessMode);
      setActiveThreadResumeError(session.resumeError ?? "");
      setSelectedModel(session.model ?? "");
      setSelectedEffort(resumedSettings.effort);
      setSelectedServiceTier(resumedSettings.serviceTier);
      if (session.approvalPolicy) {
        setSelectedApprovalPolicy(session.approvalPolicy);
      }
      if (session.approvalsReviewer) {
        setSelectedApprovalsReviewer(session.approvalsReviewer);
      }
      setSelectedPermission(session.activePermissionProfile?.id ?? "");
      setConversationLoadState("ready");
      setConversationLoadError("");


      if (session.thread.cwd) {
        void (client.backend === "desktop-control"
          ? loadDesktopPermissions(client, session.thread.cwd)
          : client.request<{ data: AnyRecord[] }>("permissionProfile/list", {
              limit: 100,
              cwd: session.thread.cwd,
            }))
          .then((result) => {
            if (sequence === openSequenceRef.current) {
              setPermissionProfiles(result.data.filter((profile) => profile.allowed));
            }
          })
          .catch(() => undefined);
      }
    } catch (reason) {
      if (sequence === openSequenceRef.current) {
        setBusy(false);
        setSteering(false);
        setConversationLoadState("error");
        setConversationLoadError(
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    } finally {
      if(historyObservationRef.current===observation)historyObservationRef.current=null;
      if (sequence === openSequenceRef.current) setOpeningThreadId("");
    }
  }

  const projectOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ cwd: string; name: string }> = [];
    for (const thread of threads) {
      const cwd =
        typeof thread.cwd === "string" ? thread.cwd.trim() : "";
      if (!cwd || seen.has(cwd)) continue;
      seen.add(cwd);
      options.push({
        cwd,
        name: cwd.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) || cwd,
      });
    }
    return options;
  }, [threads]);

  function openThread(thread: AnyRecord) {
    setRequests(current=>current.filter(request=>(request.params as AnyRecord)?.threadId===thread.id));setApprovalError('');
    const sequence = ++openSequenceRef.current;
    setDesktopModelOverride(false);setDesktopPermissionOverride(false);
    markThreadRead(String(thread.id));
    resetDraftContext();
    setDraft("");
    setDraftImages([]);
    setDraftFiles((current) => {
      current.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      return [];
    });
    setOpeningThreadId(thread.id);
    setError("");
    setBusy(false);
    setStartingThreadContext(null);
    setNewChatPermissionMode(null);
    setSteering(false);
    setConversationLoadError("");
    setConversationLoadState("loading");
    setActiveThreadAccessMode("interactive");
    setActiveThreadResumeError("");
    resetOlderTurns();
    activeThreadTargetRef.current = thread.id;
    setActive({
      ...thread,
      turns: thread.turns ?? [],
    });
    void loadThreadDetail(thread.id, sequence);
  }

  function retryThreadDetail() {
    const threadId = activeRef.current?.id;
    if (!threadId) return;
    const sequence = ++openSequenceRef.current;
    activeThreadTargetRef.current = threadId;
    setOpeningThreadId(threadId);
    setConversationLoadError("");
    setConversationLoadState("loading");
    resetOlderTurns();
    void loadThreadDetail(threadId, sequence);
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (active?.id && activeThreadAccessMode !== "interactive") return;
    const text = draft.trim();
    const pendingImages = draftImages;
    const pendingFiles = draftFiles;
    if (
      imageReading ||
      (!text && !pendingImages.length && !pendingFiles.length) ||
      !clientRef.current
    ) {
      return;
    }
    const draftContext = draftContextGenerationRef.current;
    const conversationBusy = active?.id
      ? busy
      : startingThreadContext === draftContextGenerationRef.current;
    if (conversationBusy) {
      if(clientRef.current.backend==='desktop-cdp'){setError(t('请等待当前任务完成，或先停止任务'));return;}
      if(steeringRequestRef.current)return;
      const steeringClient = clientRef.current;
      let sent = false;
      const threadId = String(active?.id ?? "");
      const turnId = activeTurnId(active);
      if (!threadId || !turnId) {
        setError(t("当前任务正在启动，请稍后再引导"));
        return;
      }
      const clientUserMessageId =
        `steer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const pendingSteerText =
        text ||
        (pendingFiles.length
          ? t("{count} 个文件", { count: pendingFiles.length })
          : t("{count} 张图片", { count: pendingImages.length }));
      invalidateImageReads();
      setDraft("");
      setDraftImages([]);
      setDraftFiles([]);
      steeringRequestRef.current = true;
      setSteering(true);
      setPendingSteerMessage({
        id: clientUserMessageId,
        threadId,
        text: pendingSteerText,
      });
      setError("");
      try {
        setImageReading(Boolean(pendingFiles.length || pendingImages.length));
        await sendSteeringInput({
          backend, client: steeringClient, threadId, turnId, clientUserMessageId, text,
          images: pendingImages, files: pendingFiles.map(file => file.file),
          isCurrent: () => draftContext === draftContextGenerationRef.current && clientRef.current === steeringClient && activeThreadTargetRef.current === threadId,
        });
        sent = true;
      } catch (reason) {
        setPendingSteerMessage((current) =>
          clearPendingSteerForRequest(current, clientUserMessageId),
        );
        if (draftContext === draftContextGenerationRef.current) {
          if (restoreSteeringDraft(reason)) {
            setDraft((current) => mergeSteerDraft(current, text));
            setDraftImages((current) => mergeDraftImages(current, pendingImages));
            setDraftFiles((current) => current.length ? current : pendingFiles);
          }
          setError(isUnknownWrite(reason) ? t('引导消息投递结果未确认，请先核对会话，不要重复发送。') : reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        steeringRequestRef.current = false;
        if (draftContext === draftContextGenerationRef.current) {
          setSteering(false);
          setImageReading(false);
        }
      }
      if (sent && draftContext === draftContextGenerationRef.current) {
        pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
      }
      return;
    }
    invalidateImageReads();
    setDraft("");
    setDraftImages([]);
    setDraftFiles([]);
    setBusy(true);
    if (!active?.id) setStartingThreadContext(draftContext);
    const pendingTurnId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let thread = active;
    let sent = false;
    try {
      setImageReading(Boolean(pendingFiles.length));
      const uploads=await uploadConversationAttachments(backend,pendingImages,pendingFiles.map(file=>file.file),clientRef.current.backend==='desktop-control');
      const uploadedFiles=uploads.files;
      const shouldSendSettings = clientRef.current.backend !== "desktop-control" && (!thread?.id || activeSettingsSynchronized);
      const shouldSendPermissions = shouldSendSettings || (clientRef.current.backend === "desktop-control" && desktopPermissionOverride);
      const shouldSendModel = shouldSendSettings || (clientRef.current.backend === "desktop-control" && desktopModelOverride);
      const effectivePermission =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.permissions
          : selectedPermission;
      const effectiveApprovalPolicy =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.approvalPolicy
          : selectedApprovalPolicy;
      const effectiveApprovalsReviewer =
        !thread?.id && newChatPermissionMode
          ? newChatPermissionMode.approvalsReviewer
          : selectedApprovalsReviewer;
      if (!thread?.id) {
        const started = await clientRef.current.request<{
          thread: AnyRecord;
          model?: string;
          reasoningEffort?: string | null;
          serviceTier?: string | null;
          approvalPolicy?: ApprovalPolicy;
          approvalsReviewer?: ApprovalsReviewer;
          activePermissionProfile?: { id: string } | null;
        }>("thread/start", {
          cwd: thread?.cwd ?? null,
          ...(shouldSendModel && selectedModel ? { model: selectedModel } : {}),
          ...(clientRef.current.backend !== 'desktop-control' && selectedServiceTier ? { serviceTier: selectedServiceTier } : {}),
          ...(shouldSendPermissions && effectivePermission ? { permissions: effectivePermission } : {}),
          ...(shouldSendPermissions ? {approvalPolicy: effectiveApprovalPolicy, approvalsReviewer: effectiveApprovalsReviewer} : {}),
        });
        thread = started.thread;
        setThreads((current) => [
          { ...thread!, status: { type: "active" } },
          ...current.filter((entry) => entry.id !== thread!.id),
        ]);
        const startedModel = started.model || selectedModel;
        const startedSettings = normalizeModelSettings(
          models.find((model) => model.model === startedModel),
          started.reasoningEffort ?? selectedEffort,
          started.serviceTier ?? selectedServiceTier,
        );
        if (draftContext === draftContextGenerationRef.current) {
          activeThreadTargetRef.current = thread.id;
          setStartingThreadContext(null);
          if (started.model) setSelectedModel(started.model);
          setSelectedEffort(startedSettings.effort);
          setSelectedServiceTier(startedSettings.serviceTier);
          if (started.approvalPolicy) {
            setSelectedApprovalPolicy(started.approvalPolicy);
          }
          if (started.approvalsReviewer) {
            setSelectedApprovalsReviewer(started.approvalsReviewer);
          }
          if (started.activePermissionProfile?.id) {
            setSelectedPermission(started.activePermissionProfile.id);
          }
          setActiveSettingsSynchronized(true);
          setActive(thread);
        }
      }
      const localItem = {
        id: `local-${pendingTurnId}`,
        type: "userMessage",
        content: buildOptimisticUserContent(text, pendingImages, uploadedFiles),
      };
      const pendingSequence = ++pendingSequenceRef.current;
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current || current.id !== thread!.id) return current;
          return {
            ...current,
            turns: [
              ...(current.turns ?? thread!.turns ?? []),
              {
                ...createPendingTurn(
                  pendingTurnId,
                  localItem,
                  pendingSequence,
                ),
              },
            ],
          };
        });
      }
      if(clientRef.current.backend==='desktop-control'&&draftContext===draftContextGenerationRef.current){
        await clientRef.current.request('desktop/subscribe',{threadIds:[thread.id]});
      }
      const startedTurn = await clientRef.current.request<{ turn: AnyRecord }>("turn/start", {
        threadId: thread.id,
        input: clientRef.current.backend==='desktop-control'?[...buildTurnInput(text,[],uploadedFiles),...uploads.imagePaths.map(path=>({type:'localImage',path}))]:buildTurnInput(text,pendingImages,uploadedFiles),
        ...(shouldSendModel && selectedModel ? { model: selectedModel } : {}),
        ...(shouldSendModel && selectedEffort
          ? { effort: selectedEffort }
          : {}),
        ...(shouldSendSettings && selectedServiceTier
          ? { serviceTier: selectedServiceTier }
          : {}),
        ...(shouldSendPermissions && effectivePermission
          ? { permissions: effectivePermission }
          : {}),
        ...(shouldSendPermissions
          ? {
              approvalPolicy: effectiveApprovalPolicy,
              approvalsReviewer: effectiveApprovalsReviewer,
            }
          : {}),
      });
      sent = true;
      if (draftContext === draftContextGenerationRef.current) {
        setActive((current) => {
          if (!current) return current;
          const params = { threadId: thread!.id, turn: startedTurn.turn };
          return startedTurn.turn.status === "completed" ? applyCompletedTurn(current, params) : applyTurnStarted(current, params);
        });
      }
    } catch (reason) {
      if (thread?.id) {
        setThreads((current) =>
          current.map((entry) =>
            entry.id === thread!.id
              ? { ...entry, status: { type: "idle" } }
              : entry,
          ),
        );
        void loadThreads().catch(() => undefined);
      }
      if (draftContext === draftContextGenerationRef.current) {
        setBusy(false);
        setStartingThreadContext(null);
        setActive((current) =>
          current && current.id === thread?.id
            ? removePendingTurn(current, pendingTurnId)
            : current,
        );
        if ((reason as {code?:string})?.code !== "ACTION_WRITE_UNKNOWN") setDraft((current) => current || text);
        if((reason as {code?:string})?.code !== 'ACTION_WRITE_UNKNOWN'){
          setDraftImages((current) => mergeDraftImages(current, pendingImages));
          setDraftFiles((current) => current.length ? current : pendingFiles);
        }
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (draftContext === draftContextGenerationRef.current) {
        setImageReading(false);
      }
    }
    if (sent && draftContext === draftContextGenerationRef.current) {
      pendingFiles.forEach((file) => URL.revokeObjectURL(file.previewUrl));
    }
  }

  async function selectImages(files: FileList | null) {
    if (
      !files?.length ||
      (active?.id && activeThreadAccessMode !== "interactive")
    ) return;
    const generation = imageReadGenerationRef.current.begin();
    const existingBytes = draftImages.reduce(
      (total, image) => total + image.size,
      0,
    );
    setImageReading(true);
    try {
      const selected = Array.from(files);
      const imageFiles = selected.filter(isNativeImageFile);
      const attachmentFiles = selected.filter((file) => !isNativeImageFile(file));
      const result = await prepareImageFiles(
        imageFiles,
        draftImages.length,
        undefined,
        existingBytes,
      );
      if (!imageReadGenerationRef.current.isCurrent(generation)) return;
      const attachmentResult = prepareAttachmentFiles(
        clientRef.current?.backend==='desktop-control'?attachmentFiles.filter(file=>file.size<=20*1024*1024):attachmentFiles,
        draftFiles.length,
      );
      setDraftImages((current) => mergeDraftImages(current, result.images));
      setDraftFiles((current) => [...current, ...attachmentResult.files].slice(0, 4));
      const sizeErrors=clientRef.current?.backend==='desktop-control'?attachmentFiles.filter(file=>file.size>20*1024*1024).map(file=>t("{name} 超过桌面上传限制 20 MB",{name:file.name})):[];
      const errors = [...result.errors, ...attachmentResult.errors,...sizeErrors];
      if (errors.length) setError(errors.join("；"));
      else setError("");
    } finally {
      if (imageReadGenerationRef.current.isCurrent(generation)) {
        setImageReading(false);
      }
    }
  }

  async function interrupt() {
    if (activeThreadAccessMode !== "interactive") return;
    const turn = active?.turns?.at(-1);
    if (!turn) return;
    await clientRef.current?.request("turn/interrupt", { threadId: active!.id, turnId: turn.id });
  }

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(
      () => setNotice((current) => (current === message ? "" : current)),
      1800,
    );
  }

  async function togglePinned() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const nextPinned = thread.isPinned !== true;
    setPendingAction("pin");
    setError("");
    try {
      const refreshed = await setThreadPinned(
        client,
        thread.id,
        nextPinned,
      );
      const persistedPinned = refreshed.isPinned;
      setThreads((current) =>
        current.map((entry) =>
          entry.id === thread.id
            ? { ...entry, isPinned: persistedPinned }
            : entry,
        ),
      );
      setActive((current) =>
        current?.id === thread.id
          ? { ...current, isPinned: persistedPinned }
          : current,
      );
      showNotice(persistedPinned ? t("已置顶") : t("已取消置顶"));
      return true;
    } catch {
      setError(nextPinned ? t("置顶失败，请重试") : t("取消置顶失败，请重试"));
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function renameThread() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    const name = window.prompt(t("输入新的会话名称"), titleOf(thread))?.trim();
    if (!name || name === titleOf(thread)) return false;
    setPendingAction("rename");
    setError("");
    try {
      await client.request("thread/name/set", {
        threadId: thread.id,
        name,
      });
      setThreads((current) =>
        current.map((entry) =>
          entry.id === thread.id ? { ...entry, name } : entry,
        ),
      );
      setActive((current) =>
        current?.id === thread.id ? { ...current, name } : current,
      );
      showNotice(t("已重命名"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("重命名失败，请重试"),
      );
      return false;
    } finally {
      setPendingAction("");
    }
  }

  async function archiveThread() {
    const client = clientRef.current;
    const thread = activeRef.current;
    if (
      !client ||
      !thread?.id ||
      pendingAction ||
      activeThreadAccessMode !== "interactive"
    ) return false;
    setPendingAction("archive");
    setError("");
    try {
      await client.request("thread/archive", { threadId: thread.id });
      markThreadRead(String(thread.id));
      setThreads((current) =>
        current.filter((entry) => entry.id !== thread.id),
      );
      const archivedThreadStillOpen =
        activeThreadTargetRef.current === thread.id;
      setActive((current) =>
        activeThreadAfterArchive(current, thread.id),
      );
      if (archivedThreadStillOpen) {
        activeThreadTargetRef.current = null;
        setConversationLoadState("idle");
        onOpenSidebar();
      }
      showNotice(t("已归档"));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : t("归档失败，请重试"),
      );
      return false;
    } finally {
      setPendingAction("");
    }
  }

  const selectedModelEntry =
    models.find((model) => model.model === selectedModel) ?? null;
  const selectedModelLabel = clientRef.current?.backend === "desktop-control"
    ? selectedModelEntry?.displayName || selectedModel || t("沿用桌面模型")
    : !activeSettingsSynchronized && active?.id
      ? t("沿用线程模型")
      : selectedModelEntry?.displayName ||
        selectedModel ||
        t("默认模型");
  const effortOptions = effortOptionsForModel(selectedModelEntry);
  const speedOptions = speedOptionsForModel(selectedModelEntry);
  const selectedSpeedLabel =
    speedOptions.find((option) => option.id === selectedServiceTier)?.label ??
    t("正常");
  const permissionModes = permissionModesFromProfiles(
    permissionProfiles as Array<{ id: string; allowed?: boolean }>,
  );
  const effectivePermissionMode =
    !active?.id && newChatPermissionMode
      ? newChatPermissionMode
      : null;
  const selectedPermissionModeId = permissionModeFromSettings(
    effectivePermissionMode?.permissions ?? selectedPermission,
    effectivePermissionMode?.approvalPolicy ?? selectedApprovalPolicy,
    effectivePermissionMode?.approvalsReviewer ?? selectedApprovalsReviewer,
  );
  const selectedPermissionMode = permissionModes.find(
    (mode) => mode.id === selectedPermissionModeId,
  );
  const selectedPermissionLabel = clientRef.current?.backend === "desktop-control"
    ? (selectedPermission ? permissionProfileLabel(selectedPermission, permissionProfiles.find(profile => profile.id === selectedPermission)?.description) : t("权限未获取"))
    : !activeSettingsSynchronized && active?.id
      ? t("沿用线程权限")
      : selectedPermissionMode?.label ??
        permissionProfileLabel(
          selectedPermission,
          permissionProfiles.find(
            (profile) => profile.id === selectedPermission,
          )?.description,
        );
  const chooseModel = (modelId: string) => {
    if(clientRef.current?.backend === "desktop-control")setDesktopModelOverride(true);
    const model = models.find((option) => option.model === modelId);
    const normalized = normalizeModelSettings(
      model,
      selectedEffort,
      selectedServiceTier,
    );
    setSelectedModel(modelId);
    setSelectedEffort(normalized.effort);
    setSelectedServiceTier(normalized.serviceTier);
  };
  const choosePermissionMode = (modeId: PermissionModeId) => {
    const mode = permissionModes.find((option) => option.id === modeId);
    if (!mode) return;
    if(clientRef.current?.backend === "desktop-control")setDesktopPermissionOverride(true);
    setSelectedPermission(mode.permissions);
    setSelectedApprovalPolicy(mode.approvalPolicy);
    setSelectedApprovalsReviewer(mode.approvalsReviewer);
    if (!active?.id) setNewChatPermissionMode(mode);
    setPicker(null);
  };
  const {approval, question: nonBlockingQuestion} = selectVisibleRequests(requests,String(active?.id ?? ''),backend.desktopHostId ?? 'local');
  const approvalKey = approval ? questionRequestKey(approval) : '';
  currentApprovalKeyRef.current = approvalKey;
  useEffect(() => {
    setUserAnswers({}); setApprovalSubmitting(requestReplyLocks.current.get(approvalKey) === 'pending'); setApprovalSubmitted(requestReplyLocks.current.get(approvalKey) === 'submitted'); setApprovalError('');
    setApprovalUnknown(requestReplyLocks.current.get(approvalKey) === 'unknown');
  }, [approvalKey]);
  async function respondToRequest(request: RpcMessage, result: unknown) {
    const key = questionRequestKey(request);
    const existing = requestReplyLocks.current.get(key);
    if (existing) throw Object.assign(new Error(t('回答结果未确认，请在桌面核对，不要重复提交。')), {code: existing === 'unknown' ? 'ACTION_WRITE_UNKNOWN' : 'REQUEST_PENDING'});
    const client = clientRef.current;
    const threadId = String((request.params as AnyRecord)?.threadId ?? '');
    if (!client || !requestsRef.current.some(entry => questionRequestKey(entry) === key) || (threadId && threadId !== activeThreadTargetRef.current)) throw new Error(t('问题已失效或会话已切换，请刷新后核对。'));
    requestReplyLocks.current.set(key,'pending');
    try {
      await client.respond(request.id!,result);
      requestReplyLocks.current.set(key,'submitted');
      // Desktop pending requests are removed only by the authoritative resolved event/snapshot.
      if (client.backend !== 'desktop-control') setRequests(current => current.filter(entry => questionRequestKey(entry) !== key));
    } catch (reason) {
      if(isUnknownWrite(reason)) requestReplyLocks.current.set(key,'unknown');
      else requestReplyLocks.current.delete(key);
      throw reason;
    }
  }
  async function submitApproval(result: unknown) {
    if (!approval || approvalSubmitting || approvalUnknown || approvalSubmitted) return;
    const key = questionRequestKey(approval); setApprovalSubmitting(true); setApprovalError('');
    try {
      await respondToRequest(approval,result);
      if(currentApprovalKeyRef.current === key)setApprovalSubmitted(true);
      return true;
    } catch(reason) {
      if(currentApprovalKeyRef.current === key){setApprovalUnknown(isUnknownWrite(reason));setApprovalError(isUnknownWrite(reason)?t('回答结果未确认，请在桌面核对，不要重复提交。'):reason instanceof Error?reason.message:String(reason));}
      return false;
    } finally {if(currentApprovalKeyRef.current === key)setApprovalSubmitting(false);}
  }
  const finishRequest = (decision: "accept" | "decline") => {
    if (!approval) return;
    const params = (approval.params ?? {}) as AnyRecord;
    if (approval.method === "item/permissions/requestApproval") {
      const requested = (params.permissions ?? {}) as AnyRecord;
      const granted = {
        ...(requested.fileSystem != null ? { fileSystem: requested.fileSystem } : {}),
        ...(requested.network != null ? { network: requested.network } : {}),
      };
      void submitApproval({
        permissions: decision === "accept" ? granted : {},
        scope: "turn",
      });
    } else {
      void submitApproval({ decision });
    }

  };
  const answerQuestions = () => {
    if (approval) void submitApproval(buildQuestionAnswers(approval,userAnswers));
  };

  const startNewChat = (
    cwd: string | null = null,
    nextDraft = "",
    nextDraftImages: DraftImage[] = [],
    nextDraftFiles: DraftFile[] = [],
  ) => {
    setRequests([]);setApprovalError('');setUserAnswers({});
    setDesktopModelOverride(false);setDesktopPermissionOverride(false);if(clientRef.current?.backend==='desktop-control'){setSelectedModel('');setSelectedEffort(null);}
    if(clientRef.current?.backend==='desktop-control')void clientRef.current.request('desktop/unsubscribe',{}).catch(()=>{});
    const savedCwd = window.localStorage.getItem(
      `codex-mobile:new-chat-project:${backend.id}`,
    );
    const selectedCwd =
      cwd ||
      projectOptions.find((project) => project.cwd === savedCwd)?.cwd ||
      projectOptions[0]?.cwd ||
      null;
    openSequenceRef.current += 1;
    activeThreadTargetRef.current = null;
    resetDraftContext();
    const defaultPermissionMode = clientRef.current?.backend==='desktop-control'?null:
      defaultNewChatPermissionMode(
        permissionProfiles as Array<{ id: string; allowed?: boolean }>,
      );
    if(clientRef.current?.backend==='desktop-control'){setNewChatPermissionMode(null);setSelectedPermission('');}
    setOpeningThreadId("");
    setBusy(false);
    setStartingThreadContext(null);
    setSteering(false);
    setImageReading(false);
    setError("");
    setDraft(nextDraft);
    setDraftImages(nextDraftImages);
    setDraftFiles(nextDraftFiles);
    setConversationLoadState("ready");
    setConversationLoadError("");
    resetOlderTurns();
    setActiveSettingsSynchronized(true);
    setActiveThreadAccessMode("interactive");
    setActiveThreadResumeError("");
    if (defaultPermissionMode) {
      setNewChatPermissionMode(defaultPermissionMode);
      setSelectedPermission(defaultPermissionMode.permissions);
      setSelectedApprovalPolicy(defaultPermissionMode.approvalPolicy);
      setSelectedApprovalsReviewer(defaultPermissionMode.approvalsReviewer);
    }
    setActive({
      id: "",
      turns: [],
      preview: t("新对话"),
      cwd: selectedCwd,
    });
  };

  const chooseNewChatProject = (cwd: string) => {
    window.localStorage.setItem(
      `codex-mobile:new-chat-project:${backend.id}`,
      cwd,
    );
    setActive((current) =>
      current && !current.id ? { ...current, cwd } : current,
    );
  };

  async function loadAllProjectThreads(cwd: string) {
    const client = clientRef.current;
    if (!client) return;
    setLoadingProjectCwd(cwd);
    try {
      const all: AnyRecord[] = [];
      let cursor: string | null = null;
      do {
        const result: { data: AnyRecord[]; nextCursor?: string | null } =
          await client.request("thread/list", {
            limit: 50,
            cwd,
            sortKey: "updated_at",
            ...(cursor ? { cursor } : {}),
          });
        all.push(...result.data);
        cursor = result.nextCursor ?? null;
      } while (cursor);
      fullyLoadedProjectCwdsRef.current.add(cwd);
      setThreads((current) => [
        ...current.filter((thread) => thread.cwd !== cwd),
        ...all,
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingProjectCwd((current) => (current === cwd ? "" : current));
    }
  }

  const handledCommandRef = useRef(0);
  useEffect(() => {
    if (
      !command ||
      command.backendId !== backend.id ||
      command.id === handledCommandRef.current
    ) {
      return;
    }
    handledCommandRef.current = command.id;
    if (command.type === "open" && command.thread) {
      openThread(command.thread);
    } else if (command.type === "new") {
      startNewChat(
        command.cwd ?? null,
        command.draft ?? "",
        command.draftImages ?? [],
        command.draftFiles ?? [],
      );
    } else if (command.type === "load-project" && command.cwd) {
      void loadAllProjectThreads(command.cwd);
    } else if (command.type === "retry-project" && command.cwd) {
      const client = clientRef.current;
      if (client) {
        void threadListLoaderRef.current!.loadProject(client, command.cwd);
      }
    }
  }, [backend.id, command, projectOptions]);

  const conversationBusy = active?.id
    ? busy
    : startingThreadContext === draftContextGenerationRef.current;

  return (
    <main className="app-shell">
      {active ? (
        <ConversationPage
          active={active}
          backendId={backend.id}
          backendName={backend.name}
          backends={backends.filter((entry) => entry.enabled)}
          projectOptions={projectOptions}
          loadState={conversationLoadState}
          loadError={conversationLoadError}
          olderTurnsState={olderTurnsState}
          connection={connection}
          client={clientRef.current}
          error={error}
          draft={draft}
          draftImages={draftImages}
          draftFiles={draftFiles}
          imageReading={imageReading}
          busy={conversationBusy}
          steering={steering}
          steerable={Boolean(activeTurnId(active))}
          questionCard={nonBlockingQuestion ? <UserQuestionCard request={nonBlockingQuestion} submissionState={requestReplyLocks.current.get(questionRequestKey(nonBlockingQuestion))} onSubmit={result => respondToRequest(nonBlockingQuestion,result)} /> : null}
          pendingSteerText={
            pendingSteerMessage?.threadId === String(active.id)
              ? pendingSteerMessage.text
              : ""
          }
          accessMode={activeThreadAccessMode}
          resumeError={activeThreadResumeError}
          tokenUsage={tokenUsageByThread[active.id] ?? null}
          rateLimits={rateLimits}
          pendingAction={pendingAction}
          selectedServiceTier={selectedServiceTier}
          modelSelectionAvailable={models.length>0}
          selectedModelLabel={selectedModelLabel}
          selectedEffort={selectedEffort}
          permissionSelectionAvailable={permissionModes.length>0}
          selectedPermissionLabel={selectedPermissionLabel}
          imageInputRef={imageInputRef}
          onBack={onOpenSidebar}
          onNewChatBackendChange={(backendId) =>
            onSwitchNewChatBackend(backendId, draft, draftImages, draftFiles)
          }
          onNewChatProjectChange={chooseNewChatProject}
          onPin={togglePinned}
          onRename={renameThread}
          onArchive={archiveThread}
          onRetry={retryThreadDetail}
          onLoadOlderTurns={loadOlderTurns}
          onSubmit={send}
          onRemoveImage={(imageId) =>
            setDraftImages((current) =>
              current.filter((entry) => entry.id !== imageId),
            )
          }
          onRemoveFile={(fileId) =>
            setDraftFiles((current) => {
              const removed = current.find((entry) => entry.id === fileId);
              if (removed) URL.revokeObjectURL(removed.previewUrl);
              return current.filter((entry) => entry.id !== fileId);
            })
          }
          onSelectImages={selectImages}
          onOpenAgentSettings={() => setPicker("agent")}
          onOpenPermissionSettings={() => setPicker("permission")}
          onDraftChange={setDraft}
          onInterrupt={interrupt}
        />
      ) : (
        <section className="conversation conversation-empty">
          <header className="conversation-header">
            <button
              className="round-button"
              aria-label={t("打开会话列表")}
              onClick={onOpenSidebar}
            >
              <AppIcon name="menu" />
            </button>
            <div className="thread-heading">
              <strong>Codex Mobile</strong>
              <span>
                <i className={`status-dot ${connection}`} />
                {backend.name}
              </span>
            </div>
          </header>
          <div className="empty-state">{t("从会话列表选择对话")}</div>
        </section>
      )}
      {notice && (
        <div className="notice-banner" role="status">
          {notice}
        </div>
      )}
      <ApprovalSheet
        onDesktopChoice={(choice) => {
          if (approval) void submitApproval({ desktopChoice: choice });
        }}
        submitting={approvalSubmitting || approvalSubmitted}
        submissionUnknown={approvalUnknown}
        submissionError={approvalError || (approvalSubmitted ? t("回答已提交，等待桌面同步。") : "")}
        approval={approval}
        userAnswers={userAnswers}
        onAnswerChange={(questionId, value) =>
          setUserAnswers((current) => ({
            ...current,
            [questionId]: value,
          }))
        }
        onSubmitAnswers={answerQuestions}
        onDecision={finishRequest}
      />
      <ComposerSettings
        picker={picker}
        effortOptions={effortOptions}
        speedOptions={speedOptions}
        permissionModes={permissionModes}
        models={models}
        selectedEffort={selectedEffort}
        selectedModel={selectedModel}
        selectedModelLabel={selectedModelLabel}
        selectedServiceTier={selectedServiceTier}
        selectedSpeedLabel={selectedSpeedLabel}
        selectedPermissionModeId={selectedPermissionModeId}
        onPickerChange={setPicker}
        allowSpeed={clientRef.current?.backend!=="desktop-control"}
        onChooseEffort={effort=>{if(clientRef.current?.backend==="desktop-control")setDesktopModelOverride(true);setSelectedEffort(effort);}}
        onChooseModel={chooseModel}
        onChooseSpeed={setSelectedServiceTier}
        onChoosePermissionMode={choosePermissionMode}
      />
    </main>
  );
}

export function App() {
  useI18n();
  const desktopLayout=isDesktopEnvironment(window.navigator);
  const [initialRegistry] = useState<BackendRegistry>(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const initial = loadBackendRegistry(
      window.localStorage,
      window.location.origin,
      token,
    );
    if (initial.backends.length) {
      saveBackendRegistry(window.localStorage, initial);
    }
    return initial;
  });
  const [dotsOpen,setDotsOpen]=useState(()=>window.location.hash==="#dots");
  const [dotsBackends,setDotsBackends]=useState(initialRegistry.backends);
  useEffect(()=>{
    const changed=()=>{
      setDotsOpen(window.location.hash==="#dots");
      setDotsBackends(loadBackendRegistry(window.localStorage,window.location.origin,new URLSearchParams(window.location.search).get("token")??"").backends);
    };
    window.addEventListener("hashchange",changed);return()=>window.removeEventListener("hashchange",changed);
  },[]);
  return <div className={desktopLayout?"desktop-client":"mobile-client"}><div hidden={dotsOpen&&!desktopLayout}><AppBootstrap initialRegistry={initialRegistry} conversationHidden={dotsOpen}/></div>
    {dotsOpen&&<div className={desktopLayout?"desktop-dots-panel":""}><DotsPage backends={dotsBackends} onBack={()=>{window.location.hash="";setDotsOpen(false);}}/></div>}</div>;
}

export function AppBootstrap({
  initialRegistry,
  conversationHidden=false,
}: {
  initialRegistry: BackendRegistry;
  conversationHidden?: boolean;
}) {
  const [registry, setRegistry] = useState(initialRegistry);
  const [managerOpen, setManagerOpen] = useState(
    !initialRegistry.backends.length,
  );
  const appUpdate = useAppUpdate();

  if (registry.backends.length) {
    return (
      <ConfiguredApp
        initialRegistry={registry}
        conversationHidden={conversationHidden}
        appUpdate={appUpdate}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="empty-state">
        <h1>Codex Mobile</h1>
        <p>{t("添加设备后即可连接 Codex。")}</p>
        <button
          className="backend-add-device"
          type="button"
          onClick={() => setManagerOpen(true)}
        >
          {t("添加设备")}
        </button>
      </section>
      <BackendManagerSheet
        open={managerOpen}
        registry={registry}
        summaries={{}}
        onChange={(next) => {
          saveBackendRegistry(window.localStorage, next);
          setRegistry(next);
        }}
        onClose={() => setManagerOpen(false)}
        appUpdate={{
          supported: appUpdate.supported,
          currentVersion: appUpdate.state.currentVersion,
          checking: appUpdate.state.phase === "checking",
          status:
            appUpdate.state.phase === "current"
              ? t("已是最新版本")
              : appUpdate.state.phase === "error"
                ? appUpdate.state.error
                : undefined,
          onCheck: () => void appUpdate.check(true),
        }}
      />
      <AppUpdateSheet
        open={appUpdate.sheetOpen}
        state={appUpdate.state}
        onClose={() => appUpdate.setSheetOpen(false)}
        onInstall={appUpdate.install}
        onRetry={appUpdate.install}
      />
    </main>
  );
}

function ConfiguredApp({
  initialRegistry,
  appUpdate,
  conversationHidden=false,
}: {
  initialRegistry: BackendRegistry;
  appUpdate: AppUpdateController;
  conversationHidden?: boolean;
}) {
  const desktopLayout=isDesktopEnvironment(window.navigator);
  const [registry, setRegistry] = useState(initialRegistry);
  const [runtimeSelection,setRuntimeSelection]=useState<string|null>(null);
  const [summaries, setSummaries] = useState<
    Record<string, BackendRuntimeSummary>
  >({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Record<string, BackendThreadSnapshot>
  >({});
  const [listBackendId, setListBackendId] = useState(
    () =>
      window.localStorage.getItem("codex-mobile:list-backend") || "all",
  );
  const [query, setQuery] = useState("");
  const [projectVisibleCounts, setProjectVisibleCounts] = useState<
    Record<string, number>
  >({});
  const [collapsedProjectKeys, setCollapsedProjectKeys] = useState(() =>
    readCollapsedProjectKeys(window.localStorage),
  );
  const loadedProjectsRef = useRef(new Set<string>());
  const [command, setCommand] = useState<WorkspaceCommand | null>(null);
  const commandIdRef = useRef(0);
  const edgeTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const resetListExpansion = useCallback(() => {
    setProjectVisibleCounts({});
    loadedProjectsRef.current.clear();
  }, []);
  const {
    sidebarOpen,
    refreshVersion,
    openSidebar,
    closeSidebar,
    refresh: refreshAllBackends,
  } = useSidebarRefresh(resetListExpansion,desktopLayout);
  const saveDiscoveredHosts=useCallback((source:BackendConfig,hosts:DesktopHost[])=>{
    setRegistry(current=>{
      const target=current.backends.find(b=>b.id===source.id);
      if(!target||target.baseUrl!==source.baseUrl||target.token!==source.token)return current;
      if(JSON.stringify(target.desktopHosts)!==JSON.stringify(source.desktopHosts))return current;
      const visibleHostIds=displayedHostIds(target,hosts);
      if(JSON.stringify(target.desktopHosts)===JSON.stringify(hosts)&&target.visibleHostIds!==undefined)return current;
      const next={...current,backends:current.backends.map(b=>b.id===source.id?{...b,desktopHosts:hosts,visibleHostIds,remoteProjects:false}:b)};
      saveBackendRegistry(window.localStorage,next);return next;
    });
  },[]);
  const desktopBackends=useDesktopBackends(registry.backends,refreshVersion,saveDiscoveredHosts);
  const runtimeBackends=desktopBackends.backends;
  const selectListBackend = useCallback((backendId: string) => {
    window.localStorage.setItem("codex-mobile:list-backend", backendId);
    setListBackendId(backendId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    for (const backend of registry.backends) {
      if (!backend.enabled || backend.hostId) continue;
      void fetchBackendHostInfo(backend)
        .then((host) => {
          if (cancelled || !host.hostId.trim()) return;
          setRegistry((current) => {
            const target = current.backends.find(
              (entry) => entry.id === backend.id,
            );
            if (
              !target ||
              target.hostId ||
              target.baseUrl !== backend.baseUrl
            ) {
              return current;
            }
            const next = assignBackendHostId(
              current,
              backend.id,
              host.hostId,
            );
            if (next === current) return current;
            saveBackendRegistry(window.localStorage, next);
            return next;
          });
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [registry.backends]);

  useEffect(() => {
    if (
      !desktopLayout && sidebarOpen &&
      !(window.history.state as AnyRecord | null)?.codexMobileSidebar
    ) {
      window.history.pushState(
        {
          ...(window.history.state ?? {}),
          codexMobileSidebar: true,
        },
        "",
      );
    }
  }, [sidebarOpen,desktopLayout]);

  useEffect(() => {
    if(desktopLayout)return;
    const handlePopState = () => {
      if (sidebarOpen) closeSidebar();
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      edgeTouchStartRef.current =
        !sidebarOpen && touch && touch.clientX <= 24
          ? { x: touch.clientX, y: touch.clientY }
          : null;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const start = edgeTouchStartRef.current;
      const touch = event.touches[0];
      if (!start || !touch) return;
      if (Math.abs(touch.clientY - start.y) > 44) {
        edgeTouchStartRef.current = null;
        return;
      }
      if (touch.clientX - start.x < 56) return;
      edgeTouchStartRef.current = null;
      openSidebar();
    };
    const handleTouchEnd = () => {
      edgeTouchStartRef.current = null;
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [closeSidebar, openSidebar, sidebarOpen,desktopLayout]);

  const enabledBackends = useMemo(
    () => runtimeBackends.filter((backend) => backend.enabled),
    [runtimeBackends],
  );
  const mountedBackends = enabledBackends;
  const selectedBackend =
    mountedBackends.find(
      (backend) => backend.id === (runtimeSelection ?? registry.selectedBackendId),
    ) ?? mountedBackends[0];

  useEffect(() => {
    if (
      listBackendId !== "all" &&
      !mountedBackends.some((backend) => backend.id === listBackendId)
    ) {
      selectListBackend("all");
    }
  }, [listBackendId, mountedBackends, selectListBackend]);

  const persistRegistry = useCallback((next: BackendRegistry) => {
    saveBackendRegistry(window.localStorage, next);
    setRegistry(
      loadBackendRegistry(window.localStorage, window.location.origin),
    );
  }, []);

  const selectBackend = useCallback((backendId: string) => {
    setRuntimeSelection(backendId);
    setRegistry((current) => {
      const target = current.backends.find(
        (backend) => backend.id === backendId && backend.enabled,
      );
      if (!target || current.selectedBackendId === backendId) return current;
      const next = { ...current, selectedBackendId: backendId };
      saveBackendRegistry(window.localStorage, next);
      return next;
    });
  }, []);

  const updateSummary = useCallback((summary: BackendRuntimeSummary) => {
    setSummaries((current) => {
      const previous = current[summary.backendId];
      if (
        previous &&
        previous.connection === summary.connection &&
        previous.busy === summary.busy &&
        previous.approvalCount === summary.approvalCount &&
        previous.error === summary.error
      ) {
        return current;
      }
      return { ...current, [summary.backendId]: summary };
    });
  }, []);

  const updateSnapshot = useCallback((snapshot: BackendThreadSnapshot) => {
    setSnapshots((current) => {
      const previous = current[snapshot.backendId];
      if (
        previous &&
        previous.threads === snapshot.threads &&
        previous.projects === snapshot.projects &&
        previous.projectThreadStates === snapshot.projectThreadStates &&
        previous.loadingProjectCwd === snapshot.loadingProjectCwd &&
        previous.refreshing === snapshot.refreshing &&
        previous.threadListState === snapshot.threadListState &&
        previous.openingThreadId === snapshot.openingThreadId &&
        previous.error === snapshot.error
      ) {
        return current;
      }
      return { ...current, [snapshot.backendId]: snapshot };
    });
  }, []);

  const aggregatedThreads = useMemo(
    () =>
      aggregateThreads(
        mountedBackends,
        Object.fromEntries(
          mountedBackends.map((backend) => [
            backend.id,
            snapshots[backend.id]?.threads ?? [],
          ]),
        ),
      ),
    [mountedBackends, snapshots],
  );
  const scopedThreads = useMemo(
    () =>
      filterAggregatedThreads(
        listBackendId === "all"
          ? aggregatedThreads
          : aggregatedThreads.filter(
              (thread) => thread.backendId === listBackendId,
            ),
        query,
        listBackendId === "all",
      ),
    [aggregatedThreads, listBackendId, query],
  );
  const scopedSnapshots =
    listBackendId === "all"
      ? mountedBackends.map((backend) => snapshots[backend.id]).filter(Boolean)
      : [snapshots[listBackendId]].filter(Boolean);
  const scopedThreadCount =
    listBackendId === "all"
      ? aggregatedThreads.length
      : aggregatedThreads.filter(
          (thread) => thread.backendId === listBackendId,
        ).length;
  const threadListState: ThreadListState = scopedSnapshots.some(
    (snapshot) => snapshot.threadListState === "ready",
  )
    ? "ready"
    : scopedSnapshots.length &&
        scopedSnapshots.every(
          (snapshot) => snapshot.threadListState === "error",
        )
      ? "error"
      : "loading";
  const listError = [...scopedSnapshots.map((snapshot) => snapshot.error), desktopBackends.error]
    .filter(Boolean)
    .join("；");
  const openingThreadId =
    scopedSnapshots
      .filter((snapshot) => snapshot.openingThreadId)
      .map(
        (snapshot) =>
          `${snapshot.backendId}:${snapshot.openingThreadId}`,
      )[0] ?? "";
  const projectDirectories =
    listBackendId === "all" ? [] : snapshots[listBackendId]?.projects ?? [];
  const projectThreadStates =
    listBackendId === "all"
      ? {}
      : snapshots[listBackendId]?.projectThreadStates ?? {};
  const loadingBackendIds = new Set(
    Object.values(snapshots)
      .filter((snapshot) =>
        Object.values(snapshot.projectThreadStates ?? {}).some(
          (state) => state === "loading",
        ),
      )
      .map((snapshot) => snapshot.backendId),
  );
  const refreshing = enabledBackends.some(
    (backend) => snapshots[backend.id]?.refreshing,
  );
  const loadingProjectKeys = new Set(
    Object.values(snapshots)
      .filter((snapshot) => snapshot.loadingProjectCwd)
      .map(
        (snapshot) =>
          `${snapshot.backendId}:${snapshot.loadingProjectCwd}`,
      ),
  );

  const toggleProject = useCallback(
    (backendId: string, cwd: string) => {
      const key = `${backendId}:${cwd}`;
      setProjectVisibleCounts((current) => ({
        ...current,
        [key]: (current[key] ?? 5) + 10,
      }));
      if (!loadedProjectsRef.current.has(key)) {
        loadedProjectsRef.current.add(key);
        setCommand({
          id: ++commandIdRef.current,
          backendId,
          type: "load-project",
          cwd,
        });
      }
    },
    [],
  );

  const toggleProjectCollapsed = useCallback(
    (backendId: string, cwd: string) => {
      const key = projectCollapseKey(backendId, cwd);
      setCollapsedProjectKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        writeCollapsedProjectKeys(window.localStorage, next);
        return next;
      });
    },
    [],
  );

  const retryProject = useCallback((backendId: string, cwd: string) => {
    setCommand({
      id: ++commandIdRef.current,
      backendId,
      type: "retry-project",
      cwd,
    });
  }, []);

  const openThread = useCallback(
    (item: AggregatedThreadItem) => {
      if(desktopLayout&&window.location.hash==="#dots")window.location.hash="";
      selectBackend(item.backendId);
      setCommand({
        id: ++commandIdRef.current,
        backendId: item.backendId,
        type: "open",
        thread: item.thread,
      });
      closeSidebar();
    },
    [closeSidebar, selectBackend,desktopLayout],
  );

  const startNewChat = useCallback(() => {
    if(desktopLayout&&window.location.hash==="#dots")window.location.hash="";
    const savedBackendId = window.localStorage.getItem(
      "codex-mobile:new-chat-backend",
    );
    const backendId =
      listBackendId === "all"
        ? mountedBackends.find(
            (backend) => backend.id === savedBackendId,
          )?.id ??
          selectedBackend?.id ??
          mountedBackends[0]?.id
        : listBackendId;
    if (!backendId) return;
    window.localStorage.setItem("codex-mobile:new-chat-backend", backendId);
    selectBackend(backendId);
    setCommand({
      id: ++commandIdRef.current,
      backendId,
      type: "new",
      cwd: null,
    });
    closeSidebar();
  }, [
    closeSidebar,
    desktopLayout,
    listBackendId,
    mountedBackends,
    selectBackend,
    selectedBackend?.id,
  ]);

  const switchNewChatBackend = useCallback(
    (
      backendId: string,
      currentDraft: string,
      currentDraftImages: DraftImage[],
      currentDraftFiles: DraftFile[],
    ) => {
      const target = mountedBackends.find(
        (backend) => backend.id === backendId,
      );
      if (!target) return;
      window.localStorage.setItem("codex-mobile:new-chat-backend", backendId);
      selectBackend(backendId);
      setCommand({
        id: ++commandIdRef.current,
        backendId,
        type: "new",
        cwd: null,
        draft: currentDraft,
        draftImages: currentDraftImages,
        draftFiles: currentDraftFiles,
      });
    },
    [mountedBackends, selectBackend],
  );

  if (!selectedBackend) {
    return <main className="app-shell"><div className="empty-state"><p>{t("没有展示的主机，请在设备管理中开启。")}</p><button type="button" onClick={()=>{window.location.hash="dots";}}>Dots</button><button type="button" onClick={()=>setManagerOpen(true)}>{t("管理设备")}</button></div>
      <BackendManagerSheet open={managerOpen} registry={registry} summaries={summaries} onChange={persistRegistry} onClose={()=>setManagerOpen(false)}/>
    </main>;
  }

  return (
    <div className={desktopLayout?"desktop-layout":"mobile-layout"}>
      {mountedBackends.map((backend) => (
        <div
          className="backend-workspace"
          hidden={backend.id !== selectedBackend.id || (desktopLayout&&conversationHidden)}
          key={`${backend.id}:${backend.baseUrl}:${backend.token}`}
        >
          <BackendWorkspace
            backend={backend}
            conversationVisible={
              backend.id === selectedBackend.id && !conversationHidden && (desktopLayout || !sidebarOpen)
            }
            backends={runtimeBackends}
            summaries={summaries}
            onSummaryChange={updateSummary}
            onSnapshotChange={updateSnapshot}
            onOpenSidebar={openSidebar}
            onSwitchNewChatBackend={switchNewChatBackend}
            command={command}
            refreshVersion={refreshVersion}
          />
        </div>
      ))}
      <div
        className={`conversation-sidebar-layer${
          sidebarOpen ? " open" : ""
        }`}
        aria-hidden={!desktopLayout && !sidebarOpen}
        inert={!desktopLayout && !sidebarOpen}
      >
        <aside className="conversation-sidebar" aria-label={t("会话列表")}>
          <ThreadListPage
            backends={runtimeBackends}
            summaries={summaries}
            selectedBackendId={listBackendId}
            loadingBackendIds={loadingBackendIds}
            refreshing={refreshing}
            threadListState={threadListState}
            visibleThreads={scopedThreads}
            totalThreadCount={scopedThreadCount}
            projectDirectories={projectDirectories}
            projectThreadStates={projectThreadStates}
            projectVisibleCounts={projectVisibleCounts}
            collapsedProjectKeys={collapsedProjectKeys}
            loadingProjectKeys={loadingProjectKeys}
            openingThreadId={openingThreadId}
            query={query}
            error={listError}
            onQueryChange={setQuery}
            onOpenThread={openThread}
            onNewChat={startNewChat}
            onSelectBackend={selectListBackend}
            onManageBackends={() => setManagerOpen(true)}
            onRefresh={refreshAllBackends}
            onToggleProject={toggleProject}
            onToggleProjectCollapsed={toggleProjectCollapsed}
            onRetryProject={retryProject}
          />
        </aside>
        {!desktopLayout&&<button
          className="conversation-sidebar-scrim"
          type="button"
          aria-label={t("关闭会话列表")}
          onClick={closeSidebar}
        />}
      </div>
      <BackendAttentionBanner
        backends={runtimeBackends}
        summaries={summaries}
        selectedBackendId={selectedBackend.id}
        onSelect={(backendId) => {
          selectBackend(backendId);
          selectListBackend(backendId);
          openSidebar();
        }}
      />
      <BackendManagerSheet
        open={managerOpen}
        registry={registry}
        summaries={summaries}
        onChange={persistRegistry}
        onClose={() => setManagerOpen(false)}
        appUpdate={{
          supported: appUpdate.supported,
          currentVersion: appUpdate.state.currentVersion,
          checking: appUpdate.state.phase === "checking",
          status:
            appUpdate.state.phase === "current"
              ? t("已是最新版本")
              : appUpdate.state.phase === "error"
                ? appUpdate.state.error
                : undefined,
          onCheck: () => void appUpdate.check(true),
        }}
      />
      <AppUpdateSheet
        open={appUpdate.sheetOpen}
        state={appUpdate.state}
        onClose={() => appUpdate.setSheetOpen(false)}
        onInstall={appUpdate.install}
        onRetry={appUpdate.install}
      />
    </div>
  );
}
