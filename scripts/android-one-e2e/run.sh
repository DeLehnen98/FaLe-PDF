#!/usr/bin/env bash
# FaLe One Android smoke test. Runs inside ReactiveCircus/android-emulator-runner (emulator booted, adb
# connected): installs $APK, pushes test photos into DCIM and hands over to smoke.mjs (CDP + adb).
# Output: e2e-out/ (screenshots, logcat, console, results.json).
set -uo pipefail
OUT="${E2E_OUT:-e2e-out}"
PKG=dev.fale.one
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
adb wait-for-device
for i in $(seq 1 60); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
adb shell input keyevent 82 || true   # unlock
adb shell wm dismiss-keyguard || true
adb shell getprop ro.build.version.release | sed 's/^/Android /'

# install WITHOUT -g: the test checks the permission flow itself (pm grant later)
if ! adb install -r "$APK" > "$OUT/install.txt" 2>&1; then
  cat "$OUT/install.txt"
  echo "::error title=One-Smoke Installation::APK konnte nicht installiert werden"
  exit 1
fi

# test photos (EXIF date + GPS) into the camera folder, then let MediaStore index them
adb shell mkdir -p /sdcard/DCIM/Camera
for f in "$HERE"/fixtures/*.jpg; do adb push "$f" "/sdcard/DCIM/Camera/$(basename "$f")" > /dev/null; done
adb shell content call --uri content://media/none --method scan_volume --arg external_primary > /dev/null 2>&1 || true
for f in "$HERE"/fixtures/*.jpg; do
  n="$(basename "$f")"
  adb shell content call --uri content://media/none --method scan_file --arg "/storage/emulated/0/DCIM/Camera/$n" > /dev/null 2>&1 || true
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/DCIM/Camera/$n" > /dev/null 2>&1 || true
done

adb logcat -c || true
(adb logcat -v time > "$OUT/logcat.txt" 2>&1 &)
node "$HERE/smoke.mjs"
rc=$?
grep -E "FaleMedia|FaleSystem|Capacitor|chromium|AndroidRuntime|E/" "$OUT/logcat.txt" | grep -iE "fale|capacitor|exception|error" | tail -n 120 > "$OUT/logcat-excerpt.txt" || true
exit $rc
