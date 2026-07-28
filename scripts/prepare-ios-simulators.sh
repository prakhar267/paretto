#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${GITHUB_ENV:-}" ]]; then
  echo "GITHUB_ENV is required so simulator destinations can reach later CI steps." >&2
  exit 1
fi

latest_ios_runtime() {
  xcrun simctl list runtimes --json |
    jq -r '
      [
        .runtimes[]
        | select((.isAvailable // false) == true)
        | select(.identifier | contains("SimRuntime.iOS-"))
      ]
      | sort_by(.version | split(".") | map(tonumber))
      | last
      | .identifier // empty
    '
}

runtime_identifier="$(latest_ios_runtime)"
if [[ -z "$runtime_identifier" ]]; then
  echo "No available iOS Simulator runtime was found; downloading the Xcode-matched runtime."
  xcodebuild -downloadPlatform iOS
  runtime_identifier="$(latest_ios_runtime)"
fi

if [[ -z "$runtime_identifier" ]]; then
  echo "Xcode did not expose an available iOS Simulator runtime after provisioning." >&2
  exit 1
fi

available_device() {
  local family="$1"
  local preferred_name="$2"

  xcrun simctl list devices --json |
    jq -r \
      --arg runtime "$runtime_identifier" \
      --arg family "$family" \
      --arg preferred "$preferred_name" '
        [
          .devices[$runtime][]?
          | select((.isAvailable // false) == true)
          | select(.name | startswith($family))
        ]
        | sort_by(if .name == $preferred then 0 else 1 end)
        | first
        | .udid // empty
      '
}

compatible_device_type() {
  local family="$1"
  local preferred_name="$2"

  xcrun simctl list devicetypes --json |
    jq -r \
      --arg family "$family" \
      --arg preferred "$preferred_name" '
        [
          .devicetypes[]
          | select(
              (.productFamily? == $family)
              or (.name | startswith($family))
            )
        ]
        | sort_by(if .name == $preferred then 0 else 1 end)
        | first
        | .identifier // empty
      '
}

ensure_device() {
  local family="$1"
  local preferred_name="$2"
  local ci_name="$3"
  local device_identifier
  local device_type

  device_identifier="$(available_device "$family" "$preferred_name")"
  if [[ -n "$device_identifier" ]]; then
    printf '%s\n' "$device_identifier"
    return
  fi

  device_type="$(compatible_device_type "$family" "$preferred_name")"
  if [[ -z "$device_type" ]]; then
    echo "No $family Simulator device type is available in this Xcode installation." >&2
    exit 1
  fi

  xcrun simctl create "$ci_name" "$device_type" "$runtime_identifier"
}

iphone_identifier="$(
  ensure_device "iPhone" "iPhone 16 Pro" "Paretto CI iPhone"
)"
ipad_identifier="$(
  ensure_device "iPad" "iPad Pro 13-inch (M4)" "Paretto CI iPad"
)"

if [[ -z "$iphone_identifier" || -z "$ipad_identifier" ]]; then
  echo "Both iPhone and iPad Simulator destinations are required." >&2
  exit 1
fi

{
  printf 'PARETTO_IOS_RUNTIME=%s\n' "$runtime_identifier"
  printf 'PARETTO_IPHONE_DESTINATION=platform=iOS Simulator,id=%s\n' \
    "$iphone_identifier"
  printf 'PARETTO_IPAD_DESTINATION=platform=iOS Simulator,id=%s\n' \
    "$ipad_identifier"
} >>"$GITHUB_ENV"

echo "Prepared iPhone $iphone_identifier and iPad $ipad_identifier on $runtime_identifier."
