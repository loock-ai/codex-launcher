import {RemoteFileCwdContext} from "./sheets/RemoteFileContext";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
  useEffect,
  useState,
} from "react";
import { AppServerClient } from "../../app-server/client";
import type { OlderTurnsLoadState } from "../../app-server/thread-session";
import type { BackendConfig } from "../../backends/types";
import { type DraftFile, type DraftImage } from "../../ui/attachments";
import {
  AppIcon,
  titleOf,
  type ConnectionState,
  type DisplayRecord,
} from "../../ui/app-display";
import { effortLabel } from "../../ui/settings";
import { groupConversationTurns } from "../../ui/conversation";
import { ErrorBanner } from "../../ui/ErrorBanner";
import { TurnCard } from "./Timeline";
import {
  ContextUsageButton,
  ConversationActionMenu,
  ConversationStatusSheet,
} from "./ConversationControls";
import { ImagePreviewSheet } from "./sheets/ImagePreviewSheet";
import { useConversationAutoScroll } from "./conversation-scroll";
import { useRealtimeConversation } from "./useRealtimeConversation";
import { t } from "../../i18n";
import videoPoster from "../../assets/video-poster.svg";

export type ConversationLoadState = "idle" | "loading" | "ready" | "error";

function formatRealtimeDuration(startedAt: number | null, now: number) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function RealtimeControls({
  status,
  startedAt,
  muted,
  userTranscript,
  assistantTranscript,
  onToggleMute,
  onStop,
}: {
  status: "connecting" | "listening" | "stopping";
  startedAt: number | null;
  muted: boolean;
  userTranscript: string;
  assistantTranscript: string;
  onToggleMute: () => void;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const statusLabel =
    status === "connecting"
      ? t("正在连接")
      : status === "stopping"
        ? t("正在结束")
        : muted
          ? t("已静音")
          : assistantTranscript
            ? t("Codex 正在回复")
            : t("正在聆听");
  return (
    <section className="realtime-panel" aria-label={t("实时语音控制")}>
      {(userTranscript || assistantTranscript) && (
        <div className="realtime-transcript" aria-live="polite">
          {userTranscript && <p className="user">{userTranscript}</p>}
          {assistantTranscript && <p>{assistantTranscript}</p>}
        </div>
      )}
      <div className="realtime-controls">
        <span>
          <i className="realtime-pulse" aria-hidden="true" />
          <strong>{statusLabel}</strong>
          <time>{formatRealtimeDuration(startedAt, now)}</time>
        </span>
        <button
          type="button"
          disabled={status !== "listening"}
          onClick={onToggleMute}
        >
          {muted ? t("恢复") : t("静音")}
        </button>
        <button
          type="button"
          className="realtime-stop"
          disabled={status === "stopping"}
          onClick={onStop}
        >
          {t("结束")}
        </button>
      </div>
    </section>
  );
}

export function ConversationPage({
  active,
  backendId,
  backendName,
  backends,
  projectOptions,
  loadState,
  loadError,
  olderTurnsState,
  connection,
  client,
  error,
  draft,
  draftImages,
  draftFiles,
  imageReading,
  busy,
  steering,
  steerable,
  pendingSteerText,
  questionCard,
  accessMode,
  resumeError,
  tokenUsage,
  rateLimits,
  pendingAction,
  selectedServiceTier,
  selectedModelLabel,
  modelSelectionAvailable = true,
  selectedEffort,
  selectedPermissionLabel,
  permissionSelectionAvailable=true,
  imageInputRef,
  onBack,
  onNewChatBackendChange,
  onNewChatProjectChange,
  onPin,
  onRename,
  onArchive,
  onRetry,
  onLoadOlderTurns,
  onSubmit,
  onRemoveImage,
  onRemoveFile,
  onSelectImages,
  onOpenAgentSettings,
  onOpenPermissionSettings,
  onDraftChange,
  onInterrupt,
}: {
  active: DisplayRecord;
  backendId: string;
  backendName: string;
  backends: BackendConfig[];
  projectOptions: Array<{ cwd: string; name: string }>;
  loadState: ConversationLoadState;
  loadError: string;
  olderTurnsState: OlderTurnsLoadState;
  connection: ConnectionState;
  client: AppServerClient | null;
  error: string;
  draft: string;
  draftImages: DraftImage[];
  draftFiles: DraftFile[];
  imageReading: boolean;
  busy: boolean;
  steering: boolean;
  steerable: boolean;
  pendingSteerText: string;
  questionCard?: ReactNode;
  accessMode: "interactive" | "readOnly";
  resumeError: string;
  tokenUsage: Record<string, any> | null;
  rateLimits: Record<string, any> | null;
  pendingAction: string;
  selectedServiceTier: string | null;
  selectedModelLabel: string;
  modelSelectionAvailable?: boolean;
  selectedEffort: string | null;
  selectedPermissionLabel: string;
  permissionSelectionAvailable?: boolean;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onBack: () => void;
  onNewChatBackendChange: (backendId: string) => void;
  onNewChatProjectChange: (cwd: string) => void;
  onPin: () => Promise<boolean>;
  onRename: () => Promise<boolean>;
  onArchive: () => Promise<boolean>;
  onRetry: () => void;
  onLoadOlderTurns: () => Promise<boolean>;
  onSubmit: (event: FormEvent) => void;
  onRemoveImage: (imageId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onSelectImages: (files: FileList | null) => Promise<void>;
  onOpenAgentSettings: () => void;
  onOpenPermissionSettings: () => void;
  onDraftChange: (value: string) => void;
  onInterrupt: () => void | Promise<void>;
}) {
  const selectedBackend =
    backends.find((backend) => backend.id === backendId) ?? null;
  const [previewImage, setPreviewImage] = useState<DraftImage | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const turns = groupConversationTurns(active.turns ?? []);
  const isNewChat = !active.id;
  const hasDraft = Boolean(draft.trim() || draftImages.length || draftFiles.length);
  const desktopBridge = client?.backend === "desktop-cdp" || client?.backend === "desktop-control";
  const canSteer = busy && steerable && hasDraft && client?.backend !== "desktop-cdp";
  const realtime = useRealtimeConversation({
    client,
    threadId: String(active.id ?? ""),
    connectionOnline: connection === "online",
  });
  const realtimeActive = ["connecting", "listening", "stopping"].includes(
    realtime.state.status,
  );
  const {
    scrollRef,
    contentRef,
    onScroll,
    beginPrependPreservation,
    cancelPrependPreservation,
  } = useConversationAutoScroll({
    threadId: String(active.id ?? `new:${backendId}`),
    contentRevision: active.turns,
    ready: loadState === "ready",
  });
  const interactive =
    loadState === "ready" &&
    accessMode === "interactive" &&
    (!isNewChat || !!active.cwd || desktopBridge);
  const requestOlderTurns = () => {
    if (!["idle", "error"].includes(olderTurnsState)) return;
    beginPrependPreservation();
    void onLoadOlderTurns().then((loaded) => {
      if (!loaded) cancelPrependPreservation();
    });
  };
  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    onScroll(event);
    if (
      event.currentTarget.scrollTop <= 48 &&
      olderTurnsState === "idle"
    ) {
      requestOlderTurns();
    }
  };
  return (
    <RemoteFileCwdContext.Provider value={active.cwd??null}><section className="conversation">
      <header className="conversation-header">
        <button
          className="round-button sidebar-toggle"
          aria-label={t("打开会话列表")}
          onClick={onBack}
        >
          <AppIcon name="menu" />
        </button>
        <div className="thread-heading">
          <strong>{titleOf(active)}</strong>
          <span>
            <i className={`status-dot ${connection}`} />
            {backendName} · {active.cwd?.split("/").pop() || t("未选择项目")} ·{" "}
            {connection === "online" ? t("已连接") : t("连接中")}
          </span>
        </div>
        {!!active.id && (
          <div
            className="conversation-header-actions"
            role="group"
            aria-label={t("会话详情操作")}
          >
            <ContextUsageButton
              tokenUsage={tokenUsage}
              onClick={() => {
                setActionsOpen(false);
                setStatusOpen(true);
              }}
            />
            <button
              className="round-button"
              type="button"
              aria-label={t("会话操作")}
              aria-expanded={actionsOpen}
              onClick={() => {
                setStatusOpen(false);
                setActionsOpen((current) => !current);
              }}
            >
              <AppIcon name="more" />
            </button>
          </div>
        )}
      </header>
      <ConversationActionMenu
        open={actionsOpen}
        readOnly={accessMode === "readOnly" || desktopBridge}
        thread={active}
        pendingAction={pendingAction}
        onClose={() => setActionsOpen(false)}
        onPin={() => {
          void onPin().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onRefresh={() => {
          setActionsOpen(false);
          onRetry();
        }}
        onCopy={() => {
          void navigator.clipboard?.writeText(String(active.id));
          setActionsOpen(false);
        }}
        onRename={() => {
          void onRename().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
        onArchive={() => {
          void onArchive().then((completed) => {
            if (completed) setActionsOpen(false);
          });
        }}
      />
      <div
        className="conversation-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        <div className="conversation-scroll-content" ref={contentRef}>
          {isNewChat && (
            <section className="new-chat-targets" aria-label={t("新聊天目标")}>
              <h2>{t("开始处理")}</h2>
              <label>
                <AppIcon name="folder" />
                <span>
                  <small>{t("项目")}</small>
                  <strong>
                    {projectOptions.find(
                      (project) => project.cwd === active.cwd,
                    )?.name ?? t("请选择项目")}
                  </strong>
                </span>
                <select
                  aria-label={t("选择项目")}
                  value={active.cwd ?? ""}
                  disabled={!projectOptions.length}
                  onChange={(event) =>
                    onNewChatProjectChange(event.currentTarget.value)
                  }
                >
                  {!projectOptions.length && (
                    <option value="">{t("没有可用项目")}</option>
                  )}
                  {projectOptions.map((project) => (
                    <option value={project.cwd} key={project.cwd}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="device-glyph" aria-hidden="true">▰</span>
                <span>
                  <small>{t("机器")}</small>
                  <strong>{backendName}</strong>
                </span>
                <select
                  aria-label={t("选择机器")}
                  value={backendId}
                  onChange={(event) =>
                    onNewChatBackendChange(event.currentTarget.value)
                  }
                >
                  {backends.map((backend) => (
                    <option value={backend.id} key={backend.id}>
                      {backend.name}
                    </option>
                  ))}
                </select>
              </label>
              {!projectOptions.length && (
                <p role="alert">{t("没有可用项目，暂时无法启动新聊天。")}</p>
              )}
            </section>
          )}
          <div className="timeline" aria-busy={loadState === "loading"}>
            {loadState === "ready" && olderTurnsState === "idle" && (
              <button
                type="button"
                className="older-turns-control"
                onClick={requestOlderTurns}
              >
                {t("加载更早消息")}
              </button>
            )}
            {loadState === "ready" && olderTurnsState === "loading" && (
              <div className="older-turns-status" role="status">
                <i className="action-spinner" aria-hidden="true" />
                {t("正在加载更早消息")}
              </div>
            )}
            {loadState === "ready" && olderTurnsState === "error" && (
              <button
                type="button"
                className="older-turns-control error"
                onClick={requestOlderTurns}
              >
                {t("加载失败，点击重试")}
              </button>
            )}
            {loadState === "loading" ? (
              <div
                className="conversation-skeleton"
                role="status"
                aria-label={t("正在加载会话详情")}
              >
                {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
              </div>
            ) : loadState === "error" ? (
              <div className="conversation-load-error" role="alert">
                <strong>{t("无法加载会话")}</strong>
                <p>{loadError || t("请检查连接后重试。")}</p>
                <button type="button" onClick={onRetry}>{t("重试")}</button>
              </div>
            ) : turns.length ? turns.map((turn: DisplayRecord, index: number) => (
              <TurnCard
                key={turn.id ?? index}
                turn={turn}
                liveDiff={turn.liveDiff}
                client={client}
                backend={selectedBackend}
              />
            )) : !isNewChat && (
              <div className="empty-state">{t("开始一次新的 Codex 对话")}</div>
            )}
            {questionCard}
          </div>
        </div>
      </div>
      <ErrorBanner message={error} />
      <form
        className="composer-wrap"
        aria-busy={imageReading}
        onSubmit={onSubmit}
      >
        {accessMode === "readOnly" && (
          <div
            className="readonly-thread-banner"
            role="status"
            title={resumeError}
          >
            <span>{t("该会话正在其他 Codex 客户端运行，当前为只读模式")}</span>
            <button type="button" onClick={onRetry}>
              {t("重新连接")}
            </button>
          </div>
        )}
        {realtimeActive && (
          <RealtimeControls
            status={
              realtime.state.status as "connecting" | "listening" | "stopping"
            }
            startedAt={realtime.state.startedAt}
            muted={realtime.state.muted}
            userTranscript={realtime.state.userTranscript}
            assistantTranscript={realtime.state.assistantTranscript}
            onToggleMute={realtime.toggleMute}
            onStop={() => void realtime.stop()}
          />
        )}
        {pendingSteerText && (
          <div
            className="pending-steer-message"
            role="status"
            aria-label={t("已发送引导")}
            title={pendingSteerText}
          >
            {pendingSteerText}
          </div>
        )}
        {draftImages.length > 0 && (
          <div className="draft-images" aria-label={t("待发送图片")}>
            {draftImages.map((image) => (
              <figure key={image.id}>
                <button
                  type="button"
                  className="draft-image-preview"
                  aria-label={t("预览 {name}", { name: image.name })}
                  onClick={() => setPreviewImage(image)}
                >
                  <img src={image.url} alt={t("待发送 {name}", { name: image.name })} />
                </button>
                <button
                  type="button"
                  className="draft-image-remove"
                  aria-label={t("移除 {name}", { name: image.name })}
                  onClick={() => onRemoveImage(image.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </figure>
            ))}
          </div>
        )}
        {draftFiles.length > 0 && (
          <div className="draft-files" aria-label={t("待发送文件")}>
            {draftFiles.map((file) => (
              <figure key={file.id}>
                {file.type.startsWith("video/") ? (
                  <video
                    src={file.previewUrl}
                    aria-label={t("待发送 {name}", { name: file.name })}
                    controls
                    preload="metadata"
                    poster={videoPoster}
                  />
                ) : file.type.startsWith("audio/") ? (
                  <div className="draft-file-audio">
                    <span aria-hidden="true">♪</span>
                    <audio src={file.previewUrl} controls preload="metadata" />
                  </div>
                ) : (
                  <div className="draft-file-glyph" aria-hidden="true">
                    <span>
                      {file.name.split(".").at(-1)?.slice(0, 5).toUpperCase() || "FILE"}
                    </span>
                  </div>
                )}
                <figcaption title={file.name}>{file.name}</figcaption>
                <button
                  type="button"
                  className="draft-image-remove"
                  aria-label={t("移除 {name}", { name: file.name })}
                  onClick={() => onRemoveFile(file.id)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </figure>
            ))}
          </div>
        )}
        {previewImage && (
          <ImagePreviewSheet
            src={previewImage.url}
            name={previewImage.name}
            alt={t("待发送 {name}", { name: previewImage.name })}
            onClose={() => setPreviewImage(null)}
          />
        )}
        {imageReading && (
          <div className="draft-image-reading" role="status" aria-live="polite">
            {t("正在处理附件…")}
          </div>
        )}
        {client?.backend === "desktop-cdp" ? <div className="chips"><span>{t("桌面当前模型与权限")}</span></div> : <div className="chips">
          <button
            type="button"
            aria-label={t(client?.backend === "desktop-control" ? "选择模型与思考强度" : "选择模型、智能与速度")}
            disabled={!interactive || !modelSelectionAvailable || busy}
            onClick={onOpenAgentSettings}
          >
            {selectedServiceTier ? "⚡ " : ""}
            {selectedModelLabel} {effortLabel(selectedEffort)}
          </button>
          {<button
            type="button"
            aria-label={t("选择审批与权限模式")}
            disabled={!interactive || !permissionSelectionAvailable || busy}
            onClick={onOpenPermissionSettings}
          >
            {selectedPermissionLabel}
          </button>}
        </div>}
        <div className="composer">
          <input
            ref={imageInputRef}
            className="visually-hidden"
            type="file"
            accept="*/*"
            multiple
            aria-label={t("选择图片或视频")}
            onChange={(event) => {
              const input = event.currentTarget;
              void onSelectImages(input.files).finally(() => {
                input.value = "";
              });
            }}
          />
          <button
            type="button"
            className="add-button"
            aria-label={t("添加附件")}
            disabled={
              !interactive ||
              client?.backend === "desktop-cdp" ||
              realtimeActive ||
              imageReading
            }
            onClick={() => imageInputRef.current?.click()}
          >
            ＋
          </button>
          <textarea
            aria-label={t("向 Codex 提问")}
            value={draft}
            disabled={!interactive || steering || realtimeActive}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t("向 Codex 提问")}
            rows={1}
          />
          <button
            type={busy && !canSteer ? "button" : "submit"}
            onClick={
              busy && !canSteer ? onInterrupt : undefined
            }
            className={`send-button${
              busy && !canSteer ? " send-button-running" : ""
            }`}
            aria-busy={busy && !canSteer}
            aria-label={
              steering
                ? t("正在引导")
                : canSteer
                  ? t("引导")
                  : busy
                    ? t("停止")
                    : t("发送")
            }
            disabled={
              !interactive ||
              steering ||
              (canSteer && imageReading) ||
              (!busy && (imageReading || !hasDraft))
            }
          >
            {steering ? (
              <i className="action-spinner composer-steer-spinner" />
            ) : (
              <AppIcon name={busy && !canSteer ? "stop" : "send"} />
            )}
          </button>
        </div>
      </form>
      <ConversationStatusSheet
        open={statusOpen}
        thread={active}
        tokenUsage={tokenUsage}
        rateLimits={rateLimits}
        onClose={() => setStatusOpen(false)}
      />
    </section></RemoteFileCwdContext.Provider>
  );
}
