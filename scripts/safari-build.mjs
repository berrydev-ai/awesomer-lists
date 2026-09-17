import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  assertMacOS,
  runCommand,
  safariNativeConfiguration,
  safariPaths,
} from "./safari-package.mjs";

const execFilePromise = promisify(execFile);

export async function findXcodeProjects(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const projects = [];

  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".xcodeproj")) {
      projects.push(path);
    } else if (entry.isDirectory()) {
      projects.push(...(await findXcodeProjects(path)));
    }
  }

  return projects;
}

export function createXcodeBuildArguments(
  projectPath,
  buildDirectory = safariPaths.buildDirectory,
) {
  return [
    "-quiet",
    "-project",
    projectPath,
    "-alltargets",
    "-configuration",
    "Release",
    "-sdk",
    "macosx",
    `SYMROOT=${resolve(buildDirectory, "products")}`,
    `OBJROOT=${resolve(buildDirectory, "intermediates")}`,
    `MACOSX_DEPLOYMENT_TARGET=${safariNativeConfiguration.macOSDeploymentTarget}`,
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "build",
  ];
}

export function safariProductInfoPaths(
  buildDirectory = safariPaths.buildDirectory,
) {
  const app = resolve(
    buildDirectory,
    "products",
    "Release",
    `${safariNativeConfiguration.appName}.app`,
  );
  return {
    app: resolve(app, "Contents", "Info.plist"),
    extension: resolve(
      app,
      "Contents",
      "PlugIns",
      `${safariNativeConfiguration.appName} Extension.appex`,
      "Contents",
      "Info.plist",
    ),
  };
}

export async function readPlistValue(plistPath, key) {
  const { stdout } = await execFilePromise("/usr/bin/plutil", [
    "-extract",
    key,
    "raw",
    "-o",
    "-",
    plistPath,
  ]);
  return stdout.trim();
}

export async function verifyBuiltSafariProducts({
  buildDirectory = safariPaths.buildDirectory,
  readValue = readPlistValue,
} = {}) {
  const paths = safariProductInfoPaths(buildDirectory);
  const [appIdentifier, extensionIdentifier, appMinimum, extensionMinimum] =
    await Promise.all([
      readValue(paths.app, "CFBundleIdentifier"),
      readValue(paths.extension, "CFBundleIdentifier"),
      readValue(paths.app, "LSMinimumSystemVersion"),
      readValue(paths.extension, "LSMinimumSystemVersion"),
    ]);

  const expected = safariNativeConfiguration;
  if (appIdentifier !== expected.appBundleIdentifier) {
    throw new Error(`Built Safari app has unexpected bundle identifier ${appIdentifier}.`);
  }
  if (extensionIdentifier !== expected.extensionBundleIdentifier) {
    throw new Error(
      `Built Safari extension has unexpected bundle identifier ${extensionIdentifier}.`,
    );
  }
  if (appMinimum !== expected.macOSDeploymentTarget) {
    throw new Error(`Built Safari app requires unexpected macOS ${appMinimum}.`);
  }
  if (extensionMinimum !== expected.macOSDeploymentTarget) {
    throw new Error(`Built Safari extension requires unexpected macOS ${extensionMinimum}.`);
  }

  return {
    appIdentifier,
    extensionIdentifier,
    macOSDeploymentTarget: appMinimum,
  };
}

export async function buildSafariNativeProject() {
  assertMacOS();
  const projects = await findXcodeProjects(safariPaths.projectLocation);
  if (projects.length !== 1) {
    throw new Error(
      `Expected one generated Xcode project in ${safariPaths.projectLocation}, found ${projects.length}.`,
    );
  }
  await runCommand("xcodebuild", createXcodeBuildArguments(projects[0]));
  await verifyBuiltSafariProducts();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSafariNativeProject();
}
