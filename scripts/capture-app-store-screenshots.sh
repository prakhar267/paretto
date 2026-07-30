#!/usr/bin/env bash

set -euo pipefail

paretto_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    pwd
)"
paretto_developer_dir="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
paretto_iphone="${PARETTO_IPHONE_STORE_DEVICE:-iPhone 17 Pro Max}"
paretto_ipad="${PARETTO_IPAD_STORE_DEVICE:-iPad Pro 13-inch (M5)}"
paretto_output="$paretto_root/ios/Paretto/AppStore/screenshots"
paretto_capture_tmp="$(mktemp -d /private/tmp/paretto-store-capture.XXXXXX)"
trap 'rm -rf "$paretto_capture_tmp"' EXIT

export DEVELOPER_DIR="$paretto_developer_dir"

capture_family() {
  local family="$1"
  local device="$2"
  local result="$paretto_capture_tmp/$family.xcresult"
  local attachments="$paretto_capture_tmp/$family-attachments"
  local log="$paretto_capture_tmp/$family-xcodebuild.log"

  echo "Capturing ${family} screenshots on ${device}…"
  if ! xcodebuild \
    -project "$paretto_root/ios/Paretto/Paretto.xcodeproj" \
    -scheme Paretto \
    -destination "platform=iOS Simulator,name=$device" \
    -derivedDataPath "$paretto_capture_tmp/derived" \
    -resultBundlePath "$result" \
    -only-testing:ParettoUITests/ParettoUITests/testCaptureAppStoreScreenshots \
    -parallel-testing-enabled NO \
    test >"$log" 2>&1; then
    tail -200 "$log"
    return 1
  fi

  xcrun xcresulttool export attachments \
    --path "$result" \
    --output-path "$attachments"
  node "$paretto_root/scripts/collect-xcresult-screenshots.mjs" \
    "$attachments" \
    "$paretto_output/$family" \
    "$family"
}

capture_family "iphone-6.9" "$paretto_iphone"
capture_family "ipad-13" "$paretto_ipad"

echo "App Store screenshots are ready in $paretto_output."
