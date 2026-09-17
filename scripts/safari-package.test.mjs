import { describe, expect, it, vi } from "vitest";

import {
  createXcodeBuildArguments,
  verifyBuiltSafariProducts,
} from "./safari-build.mjs";
import {
  assertMacOS,
  createPackagerArguments,
  normalizeGeneratedProjectContents,
  resolvePackagerTool,
  safariNativeConfiguration,
} from "./safari-package.mjs";

describe("Safari native packaging", () => {
  it("uses the current noninteractive macOS packager without opening Xcode", () => {
    const argumentsList = createPackagerArguments({
      extensionDirectory: "/repo/dist-safari",
      projectLocation: "/repo/safari/generated",
    });

    expect(argumentsList).toEqual([
      "safari-web-extension-packager",
      "/repo/dist-safari",
      "--project-location",
      "/repo/safari/generated",
      "--app-name",
      "Awesomer Lists",
      "--bundle-identifier",
      "ai.berrydev.awesomerlists",
      "--swift",
      "--macos-only",
      "--copy-resources",
      "--no-open",
      "--no-prompt",
      "--force",
    ]);
  });

  it("builds the generated project without signing or archiving", () => {
    const argumentsList = createXcodeBuildArguments(
      "/repo/safari/generated/Awesomer Lists.xcodeproj",
      "/repo/safari/build",
    );

    expect(argumentsList).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(argumentsList).toContain("CODE_SIGNING_REQUIRED=NO");
    expect(argumentsList).toContain("-quiet");
    expect(argumentsList).toContain("macosx");
    expect(argumentsList).toContain("SYMROOT=/repo/safari/build/products");
    expect(argumentsList).toContain("OBJROOT=/repo/safari/build/intermediates");
    expect(argumentsList).toContain("MACOSX_DEPLOYMENT_TARGET=12.0");
    expect(argumentsList).not.toContain("archive");
  });

  it("normalizes an older comment-free PBX project repeatably", () => {
    const target = (id, name, configurationListId) => `
\t\t${id} = {
\t\t\tisa = PBXNativeTarget;
\t\t\tbuildConfigurationList = ${configurationListId};
\t\t\tname = "${name}";
\t\t};`;
    const configurationList = (id, configurationIds) => `
\t\t${id} = {
\t\t\tisa = XCConfigurationList;
\t\t\tbuildConfigurations = (
${configurationIds.map((configurationId) => `\t\t\t\t${configurationId},`).join("\n")}
\t\t\t);
\t\t};`;
    const configuration = (id, identifier, deploymentTarget) => `
\t\t${id} = {
\t\t\tisa = XCBuildConfiguration;
\t\t\tbuildSettings = {
\t\t\t\tMACOSX_DEPLOYMENT_TARGET = ${deploymentTarget};
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = ${identifier};
\t\t\t};
\t\t};`;
    const appTarget = "AAAAAAAAAAAAAAAAAAAAAAA1";
    const extensionTarget = "AAAAAAAAAAAAAAAAAAAAAAA2";
    const appList = "BBBBBBBBBBBBBBBBBBBBBBB1";
    const extensionList = "BBBBBBBBBBBBBBBBBBBBBBB2";
    const appConfigurations = [
      "CCCCCCCCCCCCCCCCCCCCCCC1",
      "CCCCCCCCCCCCCCCCCCCCCCC2",
    ];
    const extensionConfigurations = [
      "CCCCCCCCCCCCCCCCCCCCCCC3",
      "CCCCCCCCCCCCCCCCCCCCCCC4",
    ];
    const project = [
      target(appTarget, "Awesomer Lists", appList),
      target(extensionTarget, "Awesomer Lists Extension", extensionList),
      configurationList(appList, appConfigurations),
      configurationList(extensionList, extensionConfigurations),
      ...appConfigurations.map((id) =>
        configuration(id, '"ai.berrydev.Awesomer-Lists"', "27.0"),
      ),
      ...extensionConfigurations.map((id) =>
        configuration(id, "wrong.Extension", "12.0"),
      ),
    ].join("\n");

    const normalized = normalizeGeneratedProjectContents(project);

    expect(normalized).not.toContain("ai.berrydev.Awesomer-Lists");
    expect(normalized.match(/ai\.berrydev\.awesomerlists;/g)).toHaveLength(2);
    expect(normalized.match(/ai\.berrydev\.awesomerlists\.Extension;/g)).toHaveLength(2);
    expect(normalized.match(/MACOSX_DEPLOYMENT_TARGET = 12\.0;/g)).toHaveLength(4);
    expect(normalizeGeneratedProjectContents(normalized)).toBe(normalized);
  });

  it("verifies identifiers and minimum macOS in the built app", async () => {
    const readValue = vi.fn(async (path, key) => {
      if (key === "LSMinimumSystemVersion") return "12.0";
      return path.includes("Extension.appex")
        ? safariNativeConfiguration.extensionBundleIdentifier
        : safariNativeConfiguration.appBundleIdentifier;
    });

    await expect(
      verifyBuiltSafariProducts({ buildDirectory: "/repo/safari/build", readValue }),
    ).resolves.toEqual({
      appIdentifier: "ai.berrydev.awesomerlists",
      extensionIdentifier: "ai.berrydev.awesomerlists.Extension",
      macOSDeploymentTarget: "12.0",
    });
    expect(readValue).toHaveBeenCalledTimes(4);
  });

  it("rejects native packaging outside macOS", () => {
    expect(() => assertMacOS("linux")).toThrow(/requires macOS and Xcode/);
    expect(() => assertMacOS("darwin")).not.toThrow();
  });

  it("uses the legacy converter name only when the current utility is absent", async () => {
    const probe = vi.fn(async (toolName) =>
      toolName === "safari-web-extension-packager"
        ? { code: 72, errorOutput: "unable to find utility" }
        : { code: 0, errorOutput: "" },
    );

    await expect(resolvePackagerTool(probe)).resolves.toBe(
      "safari-web-extension-converter",
    );
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("does not hide an Xcode license failure behind the fallback", async () => {
    const probe = vi.fn(async () => ({
      code: 69,
      errorOutput: "You have not agreed to the Xcode license agreements.",
    }));

    await expect(resolvePackagerTool(probe)).rejects.toThrow(/Xcode license/);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
