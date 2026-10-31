import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_EVENT,
  type AndroidAppUpdateBridge,
} from "../../src/app-update/native-bridge";
import { useAppUpdate } from "../../src/features/update/useAppUpdate";

const releasePayload = {
  tag_name: "v0.2.1",
  body: "新版本",
  draft: false,
  prerelease: false,
  html_url: "https://github.com/loock-ai/codex-launcher-plugins/releases/tag/v0.2.1",
  assets: [
    {
      name: "CodexMobile-v0.2.1.apk",
      browser_download_url:
        "https://github.com/loock-ai/codex-launcher-plugins/releases/download/v0.2.1/CodexMobile-v0.2.1.apk",
      digest:
        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      size: 1_024,
    },
  ],
};

describe("App 更新控制器", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("普通浏览器不检查也不展示更新能力", () => {
    const fetchRelease = vi.fn(async () => releasePayload);
    const { result } = renderHook(() =>
      useAppUpdate({ bridge: null, fetchRelease }),
    );

    expect(result.current.supported).toBe(false);
    expect(result.current.state.phase).toBe("idle");
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("Android 启动时自动检查，手动检查绕过缓存", async () => {
    const bridge: AndroidAppUpdateBridge = {
      appVersion: () => "0.2.0",
      installApk: vi.fn(),
    };
    const fetchRelease = vi.fn(async () => releasePayload);
    const { result } = renderHook(() =>
      useAppUpdate({ bridge, fetchRelease }),
    );

    await waitFor(() => expect(result.current.state.phase).toBe("available"));
    expect(result.current.sheetOpen).toBe(true);
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.check(false);
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.check(true);
    });
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });

  it("立即更新调用原生桥，并接收下载、校验和失败状态", async () => {
    const installApk = vi.fn();
    const bridge: AndroidAppUpdateBridge = {
      appVersion: () => "0.2.0",
      installApk,
    };
    const { result } = renderHook(() =>
      useAppUpdate({
        bridge,
        fetchRelease: async () => releasePayload,
      }),
    );
    await waitFor(() => expect(result.current.state.phase).toBe("available"));

    act(() => result.current.install());
    expect(installApk).toHaveBeenCalledWith(
      releasePayload.assets[0].browser_download_url,
      releasePayload.assets[0].digest.slice("sha256:".length),
    );
    expect(result.current.state.phase).toBe("downloading");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "downloading", progress: 57 },
        }),
      );
    });
    expect(result.current.state.progress).toBe(57);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "verifying" },
        }),
      );
    });
    expect(result.current.state.phase).toBe("verifying");

    act(() => {
      window.dispatchEvent(
        new CustomEvent(APP_UPDATE_EVENT, {
          detail: { phase: "error", error: "安装包校验失败" },
        }),
      );
    });
    expect(result.current.state).toMatchObject({
      phase: "error",
      error: "安装包校验失败",
    });
  });
});
