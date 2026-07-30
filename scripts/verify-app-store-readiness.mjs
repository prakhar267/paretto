#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const storeRoot = resolve(root, "ios/Paretto/AppStore");
const localeRoot = resolve(storeRoot, "metadata/en-US");

const [
  packageSource,
  appInformationSource,
  projectSpec,
  generatedProject,
  entitlements,
  infoPlist,
  privacyManifest,
  icon,
  name,
  subtitle,
  promotionalText,
  keywords,
  description,
  releaseNotes,
  supportURL,
  privacyURL,
  marketingURL,
  reviewNotes,
  privacyLabels,
  ageRating,
  accessibilityLabels,
] = await Promise.all([
  read("package.json"),
  read("ios/Paretto/AppStore/app-information.json"),
  read("ios/Paretto/project.yml"),
  read("ios/Paretto/Paretto.xcodeproj/project.pbxproj"),
  read("ios/Paretto/ParettoApp/Paretto.entitlements"),
  read("ios/Paretto/ParettoApp/Info.plist"),
  read("ios/Paretto/ParettoApp/PrivacyInfo.xcprivacy"),
  readBytes(
    "ios/Paretto/ParettoApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png",
  ),
  readStoreText("name.txt"),
  readStoreText("subtitle.txt"),
  readStoreText("promotional_text.txt"),
  readStoreText("keywords.txt"),
  readStoreText("description.txt"),
  readStoreText("release_notes.txt"),
  readStoreText("support_url.txt"),
  readStoreText("privacy_url.txt"),
  readStoreText("marketing_url.txt"),
  read("ios/Paretto/AppStore/review-notes.md"),
  read("ios/Paretto/AppStore/privacy-labels.md"),
  read("ios/Paretto/AppStore/age-rating.md"),
  read("ios/Paretto/AppStore/accessibility-labels.md"),
]);

const packageManifest = JSON.parse(packageSource);
const appInformation = JSON.parse(appInformationSource);
const version = packageManifest.version;
const bundleID = appInformation.bundleId;

limit(name, 30, "App name");
limit(subtitle, 30, "Subtitle");
limit(promotionalText, 170, "Promotional text");
limit(keywords, 100, "Keywords");
limit(description, 4_000, "Description");
limit(releaseNotes, 4_000, "Release notes");

for (const [label, value] of [
  ["name", name],
  ["subtitle", subtitle],
  ["promotional text", promotionalText],
  ["keywords", keywords],
  ["description", description],
  ["release notes", releaseNotes],
]) {
  invariant(value.length > 0, `${label} must not be empty.`);
  rejectPlaceholders(value, label);
}

invariant(
  /^[a-z][a-z0-9]*(?:\.[a-z0-9-]+)+$/i.test(bundleID),
  "Bundle identifier is invalid.",
);
invariant(
  appInformation.sku === "PARETTO-IOS-001",
  "The stable App Store SKU changed unexpectedly.",
);
invariant(
  appInformation.primaryLanguage === "en-US",
  "The prepared primary language must remain en-US.",
);
invariant(
  appInformation.primaryCategory === "EDUCATION",
  "The primary category must remain Education.",
);
invariant(
  appInformation.pricing === "Free" &&
    appInformation.containsInAppPurchases === false,
  "The metadata must not imply billing before StoreKit exists.",
);
invariant(
  appInformation.usesEncryption === false &&
    appInformation.usesAdvertisingIdentifier === false,
  "Encryption/export or advertising declarations changed; reassess the submission.",
);

invariant(
  projectSpec.includes(`PRODUCT_BUNDLE_IDENTIFIER: ${bundleID}`),
  "XcodeGen bundle identifier does not match App Store metadata.",
);
invariant(
  generatedProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${bundleID};`),
  "Generated Xcode bundle identifier does not match App Store metadata.",
);
invariant(
  projectSpec.includes(`MARKETING_VERSION: ${version}`),
  "Native marketing version does not match package.json.",
);
invariant(
  entitlements.includes("<key>com.apple.developer.applesignin</key>") &&
    entitlements.includes("<string>Default</string>"),
  "Sign in with Apple entitlement is missing.",
);
invariant(
  infoPlist.includes("<key>ITSAppUsesNonExemptEncryption</key>") &&
    infoPlist.includes("<false/>"),
  "Export-compliance declaration is missing or no longer false.",
);
invariant(
  privacyManifest.includes("<key>NSPrivacyTracking</key>") &&
    privacyManifest.includes("<false/>") &&
    privacyManifest.includes("NSPrivacyAccessedAPICategoryUserDefaults") &&
    privacyManifest.includes("<string>CA92.1</string>"),
  "Privacy manifest tracking or required-reason declarations are incomplete.",
);
for (const dataType of [
  "NSPrivacyCollectedDataTypeName",
  "NSPrivacyCollectedDataTypeEmailAddress",
  "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyCollectedDataTypeDeviceID",
  "NSPrivacyCollectedDataTypeProductInteraction",
  "NSPrivacyCollectedDataTypeGameplayContent",
]) {
  invariant(
    privacyManifest.includes(`<string>${dataType}</string>`),
    `Privacy manifest is missing ${dataType}.`,
  );
}

verifyPNGIcon(icon);
await verifyStoreScreenshots();
for (const [label, value, expectedPath] of [
  ["Support URL", supportURL, "/support"],
  ["Privacy URL", privacyURL, "/privacy"],
  ["Marketing URL", marketingURL, "/"],
]) {
  const url = new URL(value);
  invariant(url.protocol === "https:", `${label} must use HTTPS.`);
  invariant(
    url.hostname === "paretto.prakhargupta267.workers.dev",
    `${label} must target the verified production origin until the custom domain is attached.`,
  );
  invariant(url.pathname === expectedPath, `${label} has the wrong path.`);
  invariant(url.username === "" && url.password === "", `${label} cannot contain credentials.`);
}

for (const [label, value] of [
  ["review notes", reviewNotes],
  ["privacy labels", privacyLabels],
  ["age rating", ageRating],
  ["accessibility labels", accessibilityLabels],
]) {
  invariant(value.trim().length > 100, `${label} worksheet is incomplete.`);
  rejectPlaceholders(value, label);
}
invariant(
  reviewNotes.includes("An account is not required") &&
    reviewNotes.includes("Delete account and learning data"),
  "Review notes must explain guest access and in-app account deletion.",
);
invariant(
  privacyLabels.includes("Data used to track the user: **No**"),
  "Privacy worksheet must explicitly answer tracking.",
);
invariant(
  ageRating.includes("User-Generated Content: No") &&
    ageRating.includes("Unrestricted Web Access: No"),
  "Age-rating worksheet is missing high-risk content answers.",
);
invariant(
  accessibilityLabels.includes("Do not claim VoiceOver"),
  "Accessibility worksheet must preserve the final signed-build verification gate.",
);

console.log(
  `App Store package verified: Paretto ${version}, build ${nativeBuild(projectSpec)}, ` +
    `${bundleID}, metadata limits, HTTPS URLs, privacy manifest, age rating, ` +
    `review notes, accessibility worksheet, and opaque 1024×1024 icon.`,
);

async function read(path) {
  return readFile(resolve(root, path), "utf8");
}

async function readBytes(path) {
  return readFile(resolve(root, path));
}

async function readStoreText(filename) {
  return (await readFile(resolve(localeRoot, filename), "utf8")).trim();
}

function limit(value, maximum, label) {
  invariant(
    [...value].length <= maximum,
    `${label} exceeds ${maximum} characters (${[...value].length}).`,
  );
}

function rejectPlaceholders(value, label) {
  invariant(
    !/\b(?:TODO|TBD|FIXME|CHANGEME)\b|example\.com|<[^>\n]+>/i.test(value),
    `${label} contains a placeholder.`,
  );
}

function nativeBuild(source) {
  const match = source.match(/^\s*CURRENT_PROJECT_VERSION:\s*([1-9]\d*)\s*$/m);
  invariant(match, "Native build number is missing from project.yml.");
  return match[1];
}

function verifyPNGIcon(source) {
  invariant(
    source.length > 33 &&
      source.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    "App Store icon is not a valid PNG.",
  );
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  const colorType = source[25];
  invariant(width === 1024 && height === 1024, "App Store icon must be 1024×1024.");
  invariant(
    colorType !== 4 && colorType !== 6,
    "App Store icon must be opaque and cannot contain an alpha channel.",
  );
}

async function verifyStoreScreenshots() {
  const requirements = {
    "iphone-6.9": new Set(["1320x2868", "1290x2796", "1260x2736"]),
    "ipad-13": new Set(["2064x2752", "2048x2732"]),
  };
  for (const [family, dimensions] of Object.entries(requirements)) {
    for (const name of [
      "01-onboarding",
      "02-today",
      "03-journey",
      "04-lesson",
    ]) {
      const path = `ios/Paretto/AppStore/screenshots/${family}/${name}.png`;
      const source = await readBytes(path);
      invariant(
        source.length > 33 &&
          source.subarray(0, 8).equals(
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          ),
        `${path} is not a valid PNG.`,
      );
      const size = `${source.readUInt32BE(16)}x${source.readUInt32BE(20)}`;
      invariant(
        dimensions.has(size),
        `${path} has unsupported App Store dimensions ${size}.`,
      );
    }
  }
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
