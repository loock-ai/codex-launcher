import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { t } from "../i18n";
import remarkGfm from "remark-gfm";
import { CopyButton, reactNodeText } from "./copy";

export type ConversationRecord = Record<string, any>;

export type RemoteFileTarget = {
  path: string;
  line: number | null;
  column: number | null;
};

const gitDirectivePattern =
  /^\s*::git-[a-z0-9-]+\{[^\r\n]*\}\s*$/i;

export type AutomationHeartbeat = {
  automationId: string;
  instructions: string | null;
  message: string | null;
};

function heartbeatField(source: string, name: string) {
  const match = source.match(
    new RegExp(`<${name}>\\s*([\\s\\S]*?)\\s*</${name}>`, "i"),
  );
  const value = match?.[1]?.trim();
  return value || null;
}

export function parseAutomationHeartbeat(
  text: string,
): AutomationHeartbeat | null {
  const envelope = text
    .trim()
    .match(/^<heartbeat>\s*([\s\S]*?)\s*<\/heartbeat>$/i);
  if (!envelope) return null;
  const automationId = heartbeatField(envelope[1], "automation_id");
  if (!automationId) return null;
  return {
    automationId,
    instructions: heartbeatField(envelope[1], "instructions"),
    message: heartbeatField(envelope[1], "message"),
  };
}

export function automationAgentMessageText(text: string) {
  const completeHeartbeat = parseAutomationHeartbeat(text);
  if (completeHeartbeat) return completeHeartbeat.message ?? "";

  const trailingEnvelope = text.match(
    /(?:^|\r?\n)\s*(<heartbeat>\s*[\s\S]*?<\/heartbeat>)\s*$/i,
  );
  if (!trailingEnvelope) return text;
  const heartbeat = parseAutomationHeartbeat(trailingEnvelope[1]);
  if (!heartbeat) return text;

  const visibleText = text.slice(0, trailingEnvelope.index).trimEnd();
  return visibleText || heartbeat.message || "";
}

export function stripGitDirectives(text: string) {
  const visibleLines: string[] = [];
  let fenceMarker = "";
  let fenceLength = 0;

  for (const line of text.split(/\r?\n/)) {
    const fence = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!fenceMarker) {
        fenceMarker = marker;
        fenceLength = fence[1].length;
      } else if (marker === fenceMarker && fence[1].length >= fenceLength) {
        fenceMarker = "";
        fenceLength = 0;
      }
      visibleLines.push(line);
      continue;
    }
    if (!fenceMarker && gitDirectivePattern.test(line)) continue;
    visibleLines.push(line);
  }

  while (visibleLines.at(-1)?.trim() === "") visibleLines.pop();
  return visibleLines.join("\n");
}

const remoteFileRoots = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/private/",
  "/var/",
  "/opt/",
  "/workspace/",
  "/workspaces/",
  "/repo/",
  "/app/",
];

export function parseRemoteFileHref(
  href: string | null | undefined,
): RemoteFileTarget | null {
  if (!href) return null;
  let decoded = href;
  try {
    decoded = href.startsWith("file://")
      ? new URL(href).pathname
      : decodeURIComponent(href);
  } catch {
    return null;
  }
  if (!remoteFileRoots.some((root) => decoded.startsWith(root))) return null;
  const location = decoded.match(/^(.*?):(\d+)(?::(\d+))?$/);
  const path = location?.[1] ?? decoded;
  if (!path || path.endsWith("/")) return null;
  return {
    path,
    line: location ? Number(location[2]) : null,
    column: location?.[3] ? Number(location[3]) : null,
  };
}

export function removePendingTurn(
  thread: ConversationRecord,
  pendingTurnId: string,
) {
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === pendingTurnId);
  if (index < 0) return thread;
  return {
    ...thread,
    turns: turns.filter((_, turnIndex) => turnIndex !== index),
  };
}

export function relativeTime(timestamp: number, now = Math.floor(Date.now() / 1000)) {
  const elapsed = Math.max(0, Math.floor(now - timestamp));
  if (elapsed < 60) return t("刚刚");
  const days = Math.floor(elapsed / 86400);
  if (days) return `${days}d`;
  const hours = Math.floor(elapsed / 3600) % 24;
  const minutes = Math.floor(elapsed / 60) % 60;
  return `${hours ? `${hours}h` : ""}${minutes ? `${hours ? String(minutes).padStart(2, "0") : minutes}m` : ""}`;
}

export function isThreadRunning(status: unknown) {
  return (
    typeof status === "object" &&
    status !== null &&
    (status as { type?: unknown }).type === "active"
  );
}

const toolActivityTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "sleep",
]);

export function isToolActivityItem(item: ConversationRecord) {
  return toolActivityTypes.has(String(item.type ?? ""));
}

export type TimelineEntry =
  | { kind: "item"; item: ConversationRecord }
  | { kind: "activity"; items: ConversationRecord[] };

export function groupTimelineEntries(
  items: ConversationRecord[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const item of items) {
    if (!isToolActivityItem(item)) {
      entries.push({ kind: "item", item });
      continue;
    }
    const previous = entries.at(-1);
    if (previous?.kind === "activity") {
      previous.items.push(item);
    } else {
      entries.push({ kind: "activity", items: [item] });
    }
  }
  return entries;
}

export type ParsedDiffLine = {
  type: "hunk" | "context" | "addition" | "deletion" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  if (!diff) return [];
  const sourceLines = diff.split("\n");
  let oldLine: number | null = null;
  let newLine: number | null = null;
  const parsed: ParsedDiffLine[] = [];

  sourceLines.forEach((line, index) => {
    if (index === sourceLines.length - 1 && line === "") return;
    const hunk = line.match(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
    );
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      parsed.push({
        type: "hunk",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }
    if (line.startsWith("---") || line.startsWith("+++")) return;
    if (line.startsWith("\\ No newline")) {
      parsed.push({
        type: "meta",
        text: line,
        oldLine: null,
        newLine: null,
      });
      return;
    }
    if (line.startsWith("+")) {
      parsed.push({
        type: "addition",
        text: line.slice(1),
        oldLine: null,
        newLine,
      });
      if (newLine != null) newLine += 1;
      return;
    }
    if (line.startsWith("-")) {
      parsed.push({
        type: "deletion",
        text: line.slice(1),
        oldLine,
        newLine: null,
      });
      if (oldLine != null) oldLine += 1;
      return;
    }
    parsed.push({
      type: "context",
      text: line.startsWith(" ") ? line.slice(1) : line,
      oldLine,
      newLine,
    });
    if (oldLine != null) oldLine += 1;
    if (newLine != null) newLine += 1;
  });

  return parsed;
}

function diffLineStats(diff: string) {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export function summarizeFileChange(change: ConversationRecord) {
  return diffLineStats(
    typeof change.diff === "string" ? change.diff : "",
  );
}

export function summarizeToolActivity(items: ConversationRecord[]) {
  const files = new Set<string>();
  let commandCount = 0;
  let toolCount = 0;
  let additions = 0;
  let deletions = 0;
  let running = false;
  for (const item of items) {
    if (item.status === "inProgress") running = true;
    if (item.type === "commandExecution") commandCount += 1;
    else if (item.type === "fileChange") {
      for (const change of item.changes ?? []) {
        if (change.path) files.add(change.path);
        const stats = diffLineStats(change.diff ?? "");
        additions += stats.additions;
        deletions += stats.deletions;
      }
    } else {
      toolCount += 1;
    }
  }
  return {
    fileCount: files.size,
    commandCount,
    toolCount,
    additions,
    deletions,
    running,
  };
}

function shortValue(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value) return fallback;
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

export function toolActivityRowLabel(item: ConversationRecord) {
  const running = item.status === "inProgress";
  if (item.type === "commandExecution") {
    const action = item.commandActions?.[0];
    if (action?.type === "read") {
      return t(running ? "正在读取 {target}" : "已读取 {target}", { target: shortValue(action.name || action.path, t("文件")) });
    }
    if (action?.type === "listFiles") {
      return t(running ? "正在查看 {target}" : "已查看 {target}", { target: shortValue(action.path, t("文件")) });
    }
    if (action?.type === "search") {
      return t(running ? "正在搜索 {target}" : "已搜索 {target}", { target: action.query || shortValue(action.path, t("内容")) });
    }
    return t(running ? "正在运行 {target}" : item.status === "failed" ? "执行失败 {target}" : "已执行 {target}", { target: item.command || t("命令") });
  }
  if (item.type === "fileChange") {
    const changes = item.changes ?? [];
    const target =
      changes.length === 1
        ? shortValue(changes[0]?.path, t("文件"))
        : t("{count} 个文件", { count: changes.length });
    return t(running ? "正在修改 {target}" : item.status === "failed" ? "修改失败 {target}" : "已编辑 {target}", { target });
  }
  if (item.type === "sleep") return t("已等待");
  if (
    item.type === "collabToolCall" ||
    item.type === "collabAgentToolCall"
  ) {
    return t(running ? "正在调用智能体 {name}" : "已调用智能体 {name}", { name: item.tool ?? "" }).trim();
  }
  const name = item.tool || item.query || item.type || t("工具");
  return t(running ? "正在调用 {name}" : "已调用 {name}", { name });
}

export interface ImageSource {
  source: string;
  name: string;
  local: boolean;
}

function imageName(source: string) {
  if (source.startsWith("data:")) return t("图片");
  try {
    const path = /^https?:/i.test(source) ? new URL(source).pathname : source;
    return decodeURIComponent(
      path.split(/[\\/]/).filter(Boolean).at(-1) ?? t("图片"),
    );
  } catch {
    return shortValue(source, t("图片"));
  }
}

export function imageSourcesForItem(
  item: ConversationRecord,
): ImageSource[] {
  if (item.type === "userMessage") {
    return (item.content ?? []).flatMap((part: ConversationRecord) => {
      if (part.type === "localImage" && part.path) {
        return [
          {
            source: part.path,
            name: imageName(part.path),
            local: true,
          },
        ];
      }
      if (part.type === "image" && part.url) {
        return [
          {
            source: part.url,
            name: imageName(part.url),
            local: !/^(data:|https?:)/i.test(part.url),
          },
        ];
      }
      return [];
    });
  }
  if (item.type === "imageView" && item.path) {
    return [
      { source: item.path, name: imageName(item.path), local: true },
    ];
  }
  if (item.type === "imageGeneration") {
    const source =
      item.savedPath ||
      (/^(data:|https?:)/i.test(item.result ?? "") ? item.result : "");
    return source
      ? [{ source, name: imageName(source), local: !/^(data:|https?:)/i.test(source) }]
      : [];
  }
  return [];
}

export function shouldCollapseUserMessage(text: string) {
  return text.length > 260 || text.split("\n").length > 8;
}

export function splitCompletedTurnResponses(
  responses: ConversationRecord[],
) {
  let finalIndex = -1;
  for (let index = responses.length - 1; index >= 0; index -= 1) {
    if (
      responses[index]?.type === "agentMessage" &&
      responses[index]?.phase === "final_answer"
    ) {
      finalIndex = index;
      break;
    }
  }
  if (finalIndex < 0) {
    for (let index = responses.length - 1; index >= 0; index -= 1) {
      if (responses[index]?.type === "agentMessage") {
        finalIndex = index;
        break;
      }
    }
  }
  const final = finalIndex >= 0 ? responses[finalIndex] : null;
  const beforeFinal =
    finalIndex >= 0 ? responses.slice(0, finalIndex) : [...responses];
  const afterFinal =
    finalIndex >= 0 ? responses.slice(finalIndex + 1) : [];
  const previous =
    finalIndex >= 0 ? [...beforeFinal, ...afterFinal] : beforeFinal;
  return {
    final,
    previous,
    previousCount: previous.filter(
      (item) =>
        item.type !== "contextCompaction" &&
        item.type !== "userMessage",
    ).length,
    beforeFinal,
    afterFinal,
  };
}

export function splitTurnResponseSegments(
  responses: ConversationRecord[],
) {
  const segments: ConversationRecord[][] = [];
  for (const item of responses) {
    if (item.type === "userMessage" && segments.length > 0) {
      segments.push([item]);
      continue;
    }
    const current = segments.at(-1);
    if (current) {
      current.push(item);
    } else {
      segments.push([item]);
    }
  }
  return segments;
}

function mergeTurnItems(
  currentItems: ConversationRecord[],
  incomingItems: ConversationRecord[],
) {
  const merged = [...currentItems];
  for (const item of incomingItems) {
    let index = merged.findIndex((current) => current.id === item.id);
    if (index < 0 && item.type === "userMessage") {
      index = merged.findIndex(
        (current) =>
          current.type === "userMessage" &&
          String(current.id ?? "").startsWith("local-"),
      );
    }
    if (index >= 0) merged[index] = { ...merged[index], ...item };
    else merged.push(item);
  }
  return merged;
}

export function applyTurnStarted(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId || !params.turn?.id) {
    return thread;
  }
  const incoming = params.turn as ConversationRecord;
  const turns = (thread.turns ?? []) as ConversationRecord[];
  let index = turns.findIndex((turn) => turn.id === incoming.id);
  if (index < 0) {
    for (let candidate = turns.length - 1; candidate >= 0; candidate -= 1) {
      if (String(turns[candidate]?.id ?? "").startsWith("pending-")) {
        index = candidate;
        break;
      }
    }
  }
  const existing = index >= 0 ? turns[index] : null;
  const replacement = {
    ...(existing ?? {}),
    ...incoming,
    items: mergeTurnItems(existing?.items ?? [], incoming.items ?? []),
  };
  return {
    ...thread,
    turns:
      index >= 0
        ? turns.map((turn, turnIndex) =>
            turnIndex === index ? replacement : turn,
          )
        : [...turns, replacement],
  };
}

export function createPendingTurn(
  id: string,
  userItem: ConversationRecord,
  clientSequence?: number,
): ConversationRecord {
  return {
    id,
    status: "inProgress",
    items: [userItem],
    ...(clientSequence == null ? {} : { clientSequence }),
  };
}

export function reconcileRecentTurns(
  currentTurns: ConversationRecord[],
  serverTurns: ConversationRecord[],
  options: { discardPendingThrough?: number } = {},
): ConversationRecord[] {
  const pendingTurn = (turn: ConversationRecord) =>
    String(turn.id ?? "").startsWith("pending-");
  const userSignature = (turn: ConversationRecord) => {
    const user = (turn.items ?? []).find(
      (item: ConversationRecord) => item.type === "userMessage",
    );
    if (!user) return "";
    const content = Array.isArray(user.content) ? user.content : [];
    return content.length
      ? content
          .filter((part: ConversationRecord) => part.type === "text")
          .map((part: ConversationRecord) => String(part.text ?? ""))
          .join("\n")
          .trim()
      : String(user.text ?? "").trim();
  };
  const hasUserImage = (turn: ConversationRecord) => {
    const user = (turn.items ?? []).find(
      (item: ConversationRecord) => item.type === "userMessage",
    );
    return Array.isArray(user?.content)
      ? user.content.some(
          (part: ConversationRecord) =>
            part.type === "image" || part.type === "localImage",
        )
      : false;
  };
  const keepUnmatchedPending = (turn: ConversationRecord) => {
    if (!pendingTurn(turn)) return true;
    if (options.discardPendingThrough == null) return true;
    return Number(turn.clientSequence ?? 0) > options.discardPendingThrough;
  };
  const mergeItems = (
    currentItems: ConversationRecord[],
    incomingItems: ConversationRecord[],
  ) => {
    const used = new Set<number>();
    const ordered = incomingItems.map((incoming) => {
      let currentIndex = currentItems.findIndex(
        (current, index) => !used.has(index) && current.id === incoming.id,
      );
      if (currentIndex < 0 && incoming.type === "userMessage") {
        currentIndex = currentItems.findIndex(
          (current, index) =>
            !used.has(index) && current.type === "userMessage",
        );
      }
      if (currentIndex < 0) return incoming;
      used.add(currentIndex);
      return { ...currentItems[currentIndex], ...incoming };
    });
    return [
      ...ordered,
      ...currentItems.filter((_, index) => !used.has(index)),
    ];
  };
  const mergeTurn = (
    current: ConversationRecord,
    incoming: ConversationRecord,
  ) => {
    const merged: ConversationRecord = {
      ...current,
      ...incoming,
      items: mergeItems(current.items ?? [], incoming.items ?? []),
    };
    delete merged.clientSequence;
    return merged;
  };

  const matchedCurrentIndexes = new Set<number>();
  const exactOverlapIndexes: number[] = [];
  const reconciledWindow = serverTurns.map((incoming, serverIndex) => {
    let index = currentTurns.findIndex(
      (turn, currentIndex) =>
        !matchedCurrentIndexes.has(currentIndex) && turn.id === incoming.id,
    );
    if (index >= 0) exactOverlapIndexes.push(index);
    if (index < 0) {
      const signature = userSignature(incoming);
      if (signature) {
        index = currentTurns.findIndex(
          (turn, currentIndex) =>
            !matchedCurrentIndexes.has(currentIndex) &&
            pendingTurn(turn) &&
            userSignature(turn) === signature,
        );
      }
    }
    if (index < 0 && serverIndex === serverTurns.length - 1) {
      const unmatchedPending = currentTurns
        .map((turn, currentIndex) => ({ turn, currentIndex }))
        .filter(
          ({ turn, currentIndex }) =>
            !matchedCurrentIndexes.has(currentIndex) && pendingTurn(turn),
        );
      if (
        unmatchedPending.length === 1 &&
        !userSignature(incoming) &&
        !userSignature(unmatchedPending[0].turn) &&
        hasUserImage(incoming) &&
        hasUserImage(unmatchedPending[0].turn) &&
        (incoming.items ?? []).some(
          (item: ConversationRecord) => item.type === "userMessage",
        )
      ) {
        index = unmatchedPending[0].currentIndex;
      }
    }
    if (index >= 0) {
      matchedCurrentIndexes.add(index);
      return mergeTurn(currentTurns[index], incoming);
    }
    return incoming;
  });

  if (exactOverlapIndexes.length) {
    const firstOverlap = Math.min(...exactOverlapIndexes);
    return [
      ...currentTurns.filter(
        (turn, index) =>
          index < firstOverlap &&
          !matchedCurrentIndexes.has(index) &&
          keepUnmatchedPending(turn),
      ),
      ...reconciledWindow,
      ...currentTurns.filter(
        (turn, index) =>
          index >= firstOverlap &&
          !matchedCurrentIndexes.has(index) &&
          keepUnmatchedPending(turn),
      ),
    ];
  }
  return [
    ...currentTurns.filter(
      (turn, index) =>
        !pendingTurn(turn) && !matchedCurrentIndexes.has(index),
    ),
    ...reconciledWindow,
    ...currentTurns.filter(
      (turn, index) =>
        pendingTurn(turn) &&
        !matchedCurrentIndexes.has(index) &&
        keepUnmatchedPending(turn),
    ),
  ];
}

export function applyTurnItem(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (
    !thread ||
    thread.id !== params.threadId ||
    !params.turnId ||
    !params.item
  ) {
    return thread;
  }
  const started = applyTurnStarted(thread, {
    threadId: params.threadId,
    turn: { id: params.turnId, status: "inProgress", items: [] },
  });
  const turns = (started.turns ?? []) as ConversationRecord[];
  return {
    ...started,
    turns: turns.map((turn) =>
      turn.id === params.turnId
        ? {
            ...turn,
            items: mergeTurnItems(turn.items ?? [], [params.item]),
          }
        : turn,
    ),
  };
}

export function applyTurnDiff(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId || !params.turnId) {
    return thread;
  }
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === params.turnId);
  if (index < 0) return thread;
  return {
    ...thread,
    turns: turns.map((turn, turnIndex) =>
      turnIndex === index
        ? { ...turn, liveDiff: params.diff ?? params.patch ?? "" }
        : turn,
    ),
  };
}

export function applyFileChangePatch(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (
    !thread ||
    thread.id !== params.threadId ||
    !params.turnId ||
    !params.itemId
  ) {
    return thread;
  }
  const turns = (thread.turns ?? []) as ConversationRecord[];
  const turnIndex = turns.findIndex((turn) => turn.id === params.turnId);
  const itemIndex = turns[turnIndex]?.items?.findIndex(
    (item: ConversationRecord) => item.id === params.itemId,
  );
  if (turnIndex < 0 || itemIndex == null || itemIndex < 0) return thread;
  return {
    ...thread,
    turns: turns.map((turn, currentTurnIndex) =>
      currentTurnIndex !== turnIndex
        ? turn
        : {
            ...turn,
            items: turn.items.map(
              (item: ConversationRecord, currentItemIndex: number) =>
                currentItemIndex === itemIndex
                  ? { ...item, changes: params.changes ?? [] }
                  : item,
            ),
          },
    ),
  };
}

export function applyCompletedTurn(
  thread: ConversationRecord,
  params: ConversationRecord,
) {
  if (!thread || thread.id !== params.threadId) return thread;
  const completedTurn = params.turn as ConversationRecord | undefined;
  const turnId = completedTurn?.id ?? params.turnId;
  if (!turnId) return thread;
  const withTurn = applyTurnStarted(thread, {
    threadId: params.threadId,
    turn: { ...(completedTurn ?? {}), id: turnId, items: [] },
  });
  const turns = (withTurn.turns ?? []) as ConversationRecord[];
  const index = turns.findIndex((turn) => turn.id === turnId);
  if (index < 0) return withTurn;
  const replacement = {
    ...turns[index],
    ...(completedTurn ?? {}),
    status: completedTurn?.status ?? "completed",
    items: mergeTurnItems(
      turns[index]?.items ?? [],
      completedTurn?.items ?? [],
    ),
  };
  return {
    ...withTurn,
    turns: turns.map((turn, turnIndex) =>
      turnIndex === index ? replacement : turn,
    ),
  };
}

export function groupTurnItems(turn: ConversationRecord) {
  const items = (turn.items ?? []) as ConversationRecord[];
  const userIndex = items.findIndex((item) => item.type === "userMessage");
  return {
    id: turn.id,
    running: ["inProgress", "in_progress", "running"].includes(turn.status),
    user: userIndex >= 0 ? items[userIndex] : null,
    responses: items.filter((_, index) => index !== userIndex),
  };
}

function isRunningTurnStatus(status: unknown) {
  return ["inProgress", "in_progress", "running"].includes(String(status));
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function turnDurationMs(turn: ConversationRecord) {
  const duration = finiteNumber(turn.durationMs);
  if (duration != null && duration >= 0) return duration;
  const startedAt = finiteNumber(turn.startedAt);
  const completedAt = finiteNumber(turn.completedAt);
  return startedAt != null &&
    completedAt != null &&
    completedAt >= startedAt
    ? (completedAt - startedAt) * 1000
    : null;
}

export function groupConversationTurns(
  turns: ConversationRecord[],
): ConversationRecord[] {
  const groups: ConversationRecord[] = [];
  for (const turn of turns) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    const startsLogicalTurn = items.some(
      (item: ConversationRecord) => item.type === "userMessage",
    );
    const previous = groups.at(-1);
    if (startsLogicalTurn || !previous) {
      groups.push({ ...turn, items: [...items] });
      continue;
    }
    const liveDiff = [previous.liveDiff, turn.liveDiff]
      .filter((value) => typeof value === "string" && value)
      .join("\n");
    const startedAtValues = [previous.startedAt, turn.startedAt]
      .map(finiteNumber)
      .filter((value): value is number => value != null);
    const completedAtValues = [previous.completedAt, turn.completedAt]
      .map(finiteNumber)
      .filter((value): value is number => value != null);
    const startedAt = startedAtValues.length
      ? Math.min(...startedAtValues)
      : null;
    const completedAt = completedAtValues.length
      ? Math.max(...completedAtValues)
      : null;
    const knownDurations = [turnDurationMs(previous), turnDurationMs(turn)]
      .filter((value): value is number => value != null);
    const durationMs =
      startedAt != null && completedAt != null && completedAt >= startedAt
        ? (completedAt - startedAt) * 1000
        : knownDurations.length
          ? knownDurations.reduce((total, value) => total + value, 0)
          : null;
    groups[groups.length - 1] = {
      ...previous,
      status:
        isRunningTurnStatus(previous.status) ||
        isRunningTurnStatus(turn.status)
          ? "inProgress"
          : (turn.status ?? previous.status),
      items: [...(previous.items ?? []), ...items],
      ...(startedAt != null ? { startedAt } : {}),
      ...(completedAt != null ? { completedAt } : {}),
      ...(durationMs != null ? { durationMs } : {}),
      ...(liveDiff ? { liveDiff } : {}),
    };
  }
  return groups;
}

export function MarkdownMessage({
  text,
  renderImage,
  renderLink,
  className = "",
}: {
  text: string;
  renderImage?: (source: string, alt: string) => ReactNode;
  renderLink?: (href: string, children: ReactNode) => ReactNode;
  className?: string;
}) {
  const components = {
    pre: ({ children }: { children?: ReactNode }) => {
      const code = reactNodeText(children)
        .replace(/^\n/, "")
        .replace(/\n$/, "");
      return (
        <div className="markdown-code-block">
          <pre>{children}</pre>
          <CopyButton
            text={code}
            label={t("复制代码块")}
            className="code-block-copy"
          />
        </div>
      );
    },
    ...(renderImage
      ? {
          img: ({ src, alt }: { src?: string; alt?: string }) => (
            <>{renderImage(src ?? "", alt ?? t("图片"))}</>
          ),
        }
      : {}),
    ...(renderLink
      ? {
          a: ({
            href,
            children,
          }: {
            href?: string;
            children?: ReactNode;
          }) => <>{renderLink(href ?? "", children)}</>,
        }
      : {}),
  };
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
