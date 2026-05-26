#!/usr/bin/env -S osascript -l JavaScript

ObjC.import("Foundation");

function fail(message) {
  throw new Error(message);
}

function unwrap(value) {
  return ObjC.unwrap(value);
}

function run(argv) {
  if (argv.length < 3) {
    fail("usage: smoke-menus.jxa.js APP_PATH BUNDLE_IDENTIFIER APP_NAME");
  }

  const appPath = argv[0];
  const expectedBundleIdentifier = argv[1];
  const appName = argv[2];
  const bundle = $.NSBundle.bundleWithPath(appPath);
  if (!bundle) {
    fail(`Could not read bundle at ${appPath}`);
  }

  const bundleIdentifier = unwrap(bundle.bundleIdentifier);
  if (bundleIdentifier !== expectedBundleIdentifier) {
    fail(`Expected bundle id ${expectedBundleIdentifier}, got ${bundleIdentifier}`);
  }

  const info = bundle.infoDictionary;
  const displayName = unwrap(info.objectForKey("CFBundleDisplayName"));
  if (displayName !== appName) {
    fail(`Expected display name ${appName}, got ${displayName}`);
  }

  const documentTypes = info.objectForKey("CFBundleDocumentTypes");
  if (!documentTypes || documentTypes.count < 1) {
    fail("Expected at least one document type");
  }

  const firstDocumentType = documentTypes.objectAtIndex(0);
  const extensions = firstDocumentType.objectForKey("CFBundleTypeExtensions");
  if (!extensions || !unwrap(extensions.containsObject("canvas"))) {
    fail("Expected .canvas document type");
  }

  return `JSONCanvas metadata smoke ok: ${appPath}`;
}
