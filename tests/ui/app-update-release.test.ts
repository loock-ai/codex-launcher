import { describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_API_URL,
  APP_UPDATE_REPOSITORY,
  compareSemanticVersions,
  createReleaseChecker,
  nextPatchVersion,
  parseGithubRelease,
  parseSemanticVersion,
} from "../../src/app-update/release";

const releasePayload = {
  tag_name: "v0.2.1",
  name: "Codex Mobile v0.2.1",
  body: "自动更新说明",
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
      size: 12_345,
    },
  ],
};

describe("App 自动更新 Release 模型", () => {
  it("使用不可变的本项目 Latest Release 地址", () => {
    expect(APP_UPDATE_API_URL).toBe(
      "https://raw.githubusercontent.com/loock-ai/codex-launcher-plugins/main/plugins/mobile/app/latest.json",
    );
  });

  it("解析、比较语义版本并自动增加补丁版本", () => {
    expect(parseSemanticVersion("v1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
    expect(parseSemanticVersion("1.2")).toBeNull();
    expect(compareSemanticVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemanticVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(nextPatchVersion("v1.2.3", "0.2.0")).toBe("1.2.4");
    expect(nextPatchVersion("not-semver", "0.2.0")).toBe("0.2.1");
  });

  it("只接受本项目正式 Release、预期 APK 和 SHA-256", () => {
    expect(
      parseGithubRelease(releasePayload, APP_UPDATE_REPOSITORY),
    ).toMatchObject({
      version: "0.2.1",
      tag: "v0.2.1",
      notes: "自动更新说明",
      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      size: 12_345,
    });
    expect(
      parseGithubRelease(
        { ...releasePayload, prerelease: true },
        APP_UPDATE_REPOSITORY,
      ),
    ).toBeNull();
    expect(
      parseGithubRelease(
        {
          ...releasePayload,
          assets: [
            {
              ...releasePayload.assets[0],
              browser_download_url:
                "https://example.com/CodexMobile-v0.2.1.apk",
            },
          ],
        },
        APP_UPDATE_REPOSITORY,
      ),
    ).toBeNull();
    expect(
      parseGithubRelease(
        {
          ...releasePayload,
          assets: [{ ...releasePayload.assets[0], digest: null }],
        },
        APP_UPDATE_REPOSITORY,
      ),
    ).toBeNull();
  });

  it("自动检测在缓存时间内复用结果，手动检测绕过缓存", async () => {
    const fetchRelease = vi.fn(async () => releasePayload);
    const storage = localStorage;
    const checker = createReleaseChecker({
      fetchRelease,
      storage,
      now: () => 10_000,
      cacheMs: 60_000,
    });

    await expect(checker.check(false)).resolves.toMatchObject({
      version: "0.2.1",
    });
    await expect(checker.check(false)).resolves.toMatchObject({
      version: "0.2.1",
    });
    expect(fetchRelease).toHaveBeenCalledTimes(1);

    await checker.check(true);
    expect(fetchRelease).toHaveBeenCalledTimes(2);
  });
});
