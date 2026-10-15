#!/usr/bin/env bash
# Runs inside ReactiveCircus/android-emulator-runner (emulator booted, adb connected).
# Installs $APK, then hands over to e2e.mjs (CDP + adb input). Output: e2e-out/.
set -uo pipefail
OUT="${E2E_OUT:-e2e-out}"
PKG=dev.fale.pdf
mkdir -p "$OUT"
adb wait-for-device
for i in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
adb shell settings put secure show_ime_with_hard_keyboard 1 || true
adb shell input keyevent 82 || true   # unlock
adb shell wm dismiss-keyguard || true
adb shell getprop ro.build.version.release | sed 's/^/Android /'
adb shell dumpsys package com.google.android.webview 2>/dev/null | grep -m1 versionName || true

if ! adb install -r -g "$APK" > "$OUT/install.txt" 2>&1; then
  cat "$OUT/install.txt"
  echo "::error title=E2E install::APK konnte nicht installiert werden"
  exit 1
fi
adb logcat -c || true
(adb logcat -v time > "$OUT/logcat.txt" 2>&1 &)
node scripts/android-e2e/e2e.mjs
rc=$?
adb shell dumpsys activity activities > "$OUT/activities.txt" 2>&1 || true
grep -E "FaleIncoming|FalePrint|Capacitor|chromium|AndroidRuntime|E/" "$OUT/logcat.txt" | grep -iE "fale|capacitor|share|print|exception|error" | tail -n 120 > "$OUT/logcat-excerpt.txt" || true
exit $rc
