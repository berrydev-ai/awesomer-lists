import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");

export const safariNativeConfiguration = {
  appName: "Awesomer Lists",
  appBundleIdentifier: "ai.berrydev.awesomerlists",
  extensionBundleIdentifier: "ai.berrydev.awesomerlists.Extension",
  macOSDeploymentTarget: "12.0",
};

export const safariPaths = {
  extensionDirectory: resolve(root, "dist-safari"),
  projectLocation: resolve(root, "safari", "generated"),
  buildDirectory: resolve(root, "safari", "build"),
};

export const packagerToolNames = [
  "safari-web-extension-packager",
  "safari-web-extension-converter",
];

export function assertMacOS(platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error("Safari native packaging requires macOS and Xcode.");
  }
}

export function createPackagerArguments({
  toolName = packagerToolNames[0],
  extensionDirectory = safariPaths.extensionDirectory,
  projectLocation = safariPaths.projectLocation,
} = {}) {
  return [
    toolName,
    extensionDirectory,
    "--project-location",
    projectLocation,
    "--app-name",
    safariNativeConfiguration.appName,
    "--bundle-identifier",
    safariNativeConfiguration.appBundleIdentifier,
    "--swift",
    "--macos-only",
    "--copy-resources",
    "--no-open",
    "--no-prompt",
    "--force",
  ];
}

function readPbxObjects(contents) {
  const objects = new Map();
  const objectStart = /^(\t\t| {8})([A-F0-9]{8,})(?: \/\*[^\r\n]*\*\/)? = \{\r?$/gm;
  let match;

  while ((match = objectStart.exec(contents)) !== null) {
    const indent = match[1];
    const id = match[2];
    const endMarker = `\n${indent}};`;
    const endStart = contents.indexOf(endMarker, objectStart.lastIndex);
    if (endStart === -1) {
      throw new Error(`Generated Xcode project has an incomplete object ${id}.`);
    }
    const end = endStart + endMarker.length;
    objects.set(id, {
      id,
      start: match.index,
      end,
      contents: contents.slice(match.index, end),
    });
  }

  return objects;
}

function pbxValue(objectContents, key) {
  const match = objectContents.match(
    new RegExp(`^\\s*${key} = (.+);\\r?$`, "m"),
  );
  if (!match) return undefined;
  const value = match[1].trim();
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function normalizeTargetBundleIdentifier(contents, targetName, identifier) {
  const objects = readPbxObjects(contents);
  const target = [...objects.values()].find(
    (object) =>
      pbxValue(object.contents, "isa") === "PBXNativeTarget" &&
      pbxValue(object.contents, "name") === targetName,
  );
  if (!target) throw new Error(`Generated Xcode project is missing target ${targetName}.`);

  const configurationListId = pbxValue(
    target.contents,
    "buildConfigurationList",
  )?.match(/^[A-F0-9]{8,}/)?.[0];
  const configurationList = configurationListId
    ? objects.get(configurationListId)
    : undefined;
  if (
    !configurationList ||
    pbxValue(configurationList.contents, "isa") !== "XCConfigurationList"
  ) {
    throw new Error(`Target ${targetName} has no build configuration list.`);
  }

  const configurationIds = configurationList.contents
    .match(/buildConfigurations = \(([\s\S]*?)\);/)?.[1]
    .match(/[A-F0-9]{8,}/g);
  if (!configurationIds?.length) {
    throw new Error(`Target ${targetName} has no build configurations.`);
  }

  const updates = configurationIds.map((configurationId) => {
    const configuration = objects.get(configurationId);
    if (
      !configuration ||
      pbxValue(configuration.contents, "isa") !== "XCBuildConfiguration"
    ) {
      throw new Error(
        `Target ${targetName} references missing configuration ${configurationId}.`,
      );
    }
    if (!/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/.test(configuration.contents)) {
      throw new Error(
        `Target ${targetName} configuration ${configurationId} has no bundle identifier.`,
      );
    }

    return {
      ...configuration,
      replacement: configuration.contents.replace(
        /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/,
        `PRODUCT_BUNDLE_IDENTIFIER = ${identifier};`,
      ),
    };
  });

  let normalized = contents;
  for (const update of updates.sort((left, right) => right.start - left.start)) {
    normalized =
      normalized.slice(0, update.start) +
      update.replacement +
      normalized.slice(update.end);
  }
  return normalized;
}

export function normalizeGeneratedProjectContents(contents) {
  let normalized = normalizeTargetBundleIdentifier(
    contents,
    safariNativeConfiguration.appName,
    safariNativeConfiguration.appBundleIdentifier,
  );
  normalized = normalizeTargetBundleIdentifier(
    normalized,
    `${safariNativeConfiguration.appName} Extension`,
    safariNativeConfiguration.extensionBundleIdentifier,
  );

  let deploymentTargetCount = 0;
  normalized = normalized.replace(
    /MACOSX_DEPLOYMENT_TARGET = [^;]+;/g,
    () => {
      deploymentTargetCount += 1;
      return `MACOSX_DEPLOYMENT_TARGET = ${safariNativeConfiguration.macOSDeploymentTarget};`;
    },
  );
  if (deploymentTargetCount < 2) {
    throw new Error(
      `Expected generated macOS deployment settings, found ${deploymentTargetCount}.`,
    );
  }

  return normalized;
}

export async function normalizeGeneratedProject(
  projectLocation = safariPaths.projectLocation,
) {
  const projectFile = resolve(
    projectLocation,
    safariNativeConfiguration.appName,
    `${safariNativeConfiguration.appName}.xcodeproj`,
    "project.pbxproj",
  );
  const contents = await readFile(projectFile, "utf8");
  await writeFile(projectFile, normalizeGeneratedProjectContents(contents));
  return projectFile;
}

export async function probeXcrunTool(toolName) {
  return new Promise((resolvePromise) => {
    const child = spawn("xcrun", ["--find", toolName], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.once("error", (error) => {
      resolvePromise({ code: null, errorOutput: error.message });
    });
    child.once("exit", (code) => resolvePromise({ code, errorOutput }));
  });
}

export async function resolvePackagerTool(probe = probeXcrunTool) {
  for (const toolName of packagerToolNames) {
    const result = await probe(toolName);
    if (result.code === 0) return toolName;
    if (result.code !== 72 && !/unable to find utility/i.test(result.errorOutput)) {
      throw new Error(result.errorOutput.trim() || `xcrun failed with exit code ${result.code}`);
    }
  }
  throw new Error(
    `Xcode does not provide ${packagerToolNames.join(" or ")}.`,
  );
}

export async function runCommand(command, argumentsList) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        reject(
          new Error(
            `${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          ),
        );
      }
    });
  });
}

export async function packageSafariExtension() {
  assertMacOS();
  await access(resolve(safariPaths.extensionDirectory, "manifest.json"));
  await mkdir(dirname(safariPaths.projectLocation), { recursive: true });
  const toolName = await resolvePackagerTool();
  await runCommand("xcrun", createPackagerArguments({ toolName }));
  await normalizeGeneratedProject();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await packageSafariExtension();
}
