import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
);
const cliPath = resolve("bin/codex-mobile.mjs");
const cliSource = readFileSync(cliPath, "utf8");
const serverSource = readFileSync(resolve("server/index.ts"), "utf8");
const isolatedRuntimeDirectory = mkdtempSync(
  `${tmpdir()}/codex-mobile-cli-tests-`,
);
const isolatedRuntimeFile = resolve(
  isolatedRuntimeDirectory,
  "runtime.json",
);

afterAll(() => {
  rmSync(isolatedRuntimeDirectory, { recursive: true, force: true });
});

function isolatedCliEnv(overrides: NodeJS.ProcessEnv = {}) {
  return {
    ...process.env,
    CODEX_MOBILE_RUNTIME_FILE: isolatedRuntimeFile,
    ...overrides,
  };
}

describe("npm 全局安装包", () => {
  it("声明公开 CLI、运行时文件和 Node 版本要求", () => {
    expect(packageJson.name).toBe("codex-mobile");
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.bin).toEqual({
      "codex-mobile": "bin/codex-mobile.mjs",
    });
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        "bin",
        "dist",
        "npm-dist/server",
        "README.md",
        "LICENSE",
      ]),
    );
    expect(packageJson.engines.node).toBe(">=20");
    expect(packageJson.publishConfig.access).toBe("public");
    expect(packageJson.dependencies).toEqual({
      "playwright-core": expect.any(String),
      qrcode: expect.any(String),
      yauzl: expect.any(String),
      ws: expect.any(String),
    });
  });

  it("prepack 同时构建前端和可直接运行的服务端", () => {
    expect(packageJson.scripts.prepack).toBe("npm run build:package");
    expect(packageJson.scripts["build:package"]).toContain("npm run build");
    expect(packageJson.scripts["build:package"]).toContain(
      "npm run build:server",
    );
  });

  it("CLI 提供帮助和版本信息", () => {
    const help = execFileSync(process.execPath, [cliPath, "--help"], {
      encoding: "utf8",
    });
    const version = execFileSync(process.execPath, [cliPath, "--version"], {
      encoding: "utf8",
    });

    expect(help).toContain("codex-mobile start");
    expect(help).toContain("CODEX_MOBILE_TOKEN");
    expect(version.trim()).toBe(packageJson.version);
  });

  it("CLI 拒绝未知命令", () => {
    const result = spawnSync(
      process.execPath,
      [cliPath, "unknown-command"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("未知命令");
  });

  it("CLI 输出带访问口令的局域网链接", () => {
    const output = execFileSync(process.execPath, [cliPath, "auth", "--plain"], {
      encoding: "utf8",
      env: isolatedCliEnv({
        HOST: "0.0.0.0",
        PORT: "5173",
        CODEX_MOBILE_TOKEN: "token with spaces",
        CODEX_MOBILE_LAN_IP: "192.168.100.35",
      }),
    });

    expect(output.trim()).toBe(
      "http://192.168.100.35:5173/?token=token+with+spaces",
    );
  });

  it("CLI 默认生成可扫描的终端二维码", () => {
    const output = execFileSync(process.execPath, [cliPath, "auth"], {
      encoding: "utf8",
      env: isolatedCliEnv({
        PORT: "5173",
        CODEX_MOBILE_TOKEN: "secret",
        CODEX_MOBILE_LAN_IP: "192.168.100.35",
      }),
    });

    expect(output).toContain("扫描二维码连接");
    expect(output).toContain(
      "http://192.168.100.35:5173/?token=secret",
    );
  });

  it("CLI 默认使用不常见的 18766 网关端口", () => {
    const output = execFileSync(
      process.execPath,
      [cliPath, "auth", "--plain"],
      {
        encoding: "utf8",
        env: isolatedCliEnv({
          PORT: "",
          CODEX_MOBILE_TOKEN: "secret",
          CODEX_MOBILE_LAN_IP: "192.168.100.35",
        }),
      },
    );

    expect(output.trim()).toBe(
      "http://192.168.100.35:18766/?token=secret",
    );
  });

  it("auth 直接读取 start 保存的端口和口令", () => {
    const directory = mkdtempSync(`${tmpdir()}/codex-mobile-auth-`);
    const runtimeFile = resolve(directory, "runtime.json");
    writeFileSync(
      runtimeFile,
      JSON.stringify({ port: 19000, token: "saved-token" }),
    );
    const output = execFileSync(process.execPath, [cliPath, "auth", "--plain"], {
      encoding: "utf8",
      env: isolatedCliEnv({
        PORT: "19999",
        CODEX_MOBILE_TOKEN: "environment-token",
        CODEX_MOBILE_LAN_IP: "192.168.100.35",
        CODEX_MOBILE_RUNTIME_FILE: runtimeFile,
      }),
    });
    const invalid = spawnSync(
      process.execPath,
      [cliPath, "auth", "--port", "19000"],
      { encoding: "utf8" },
    );
    rmSync(directory, { recursive: true, force: true });

    expect(output.trim()).toBe(
      "http://192.168.100.35:19000/?token=saved-token",
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("未知命令");
  });

  it("start 支持通过 --port 设置网关端口", () => {
    const invalid = spawnSync(
      process.execPath,
      [cliPath, "start", "--port", "invalid"],
      { encoding: "utf8" },
    );

    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("端口");
  });

  it("生成局域网链接时必须配置访问口令", () => {
    const result = spawnSync(process.execPath, [cliPath, "auth"], {
      encoding: "utf8",
      env: isolatedCliEnv({
        CODEX_MOBILE_TOKEN: "",
        CODEX_MOBILE_LAN_IP: "192.168.100.35",
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CODEX_MOBILE_TOKEN");
  });

  it("保留调用目录，并显式传递静态资源目录和版本", () => {
    expect(cliSource).not.toContain("process.chdir(");
    expect(cliSource).toContain("CODEX_MOBILE_STATIC_DIR");
    expect(cliSource).toContain("CODEX_MOBILE_VERSION");
    expect(serverSource).toContain("process.env.CODEX_MOBILE_STATIC_DIR");
    expect(serverSource).toContain("process.env.CODEX_MOBILE_VERSION");
  });
});
