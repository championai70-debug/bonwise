#!/usr/bin/env bash
# Runs inside an Android emulator in CI: installs the APK, opens the app, loads the sample data
# and checks that the result screen appears. Also checks the app has no internet permission.
set -u
APK="${1:-salesplan.apk}"
PKG="${2:-app.salesplan.planner}"
adb install -r "$APK"
if adb shell dumpsys package "$PKG" | grep -q "android.permission.INTERNET"; then
  echo "::error::The app asks for the INTERNET permission"; exit 1
fi
adb shell am start -W -n "$PKG/app.salesplan.MainActivity"

dump() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
wait_for() {
  for _ in $(seq 1 40); do
    if dump | grep -q "$1"; then echo "Seen: $1"; return 0; fi
    sleep 2
  done
  echo "::error::Did not see: $1"
  dump | head -c 4000; echo
  adb logcat -d | grep -i -E "chromium|console|AndroidRuntime|salesplan" | tail -60
  adb exec-out screencap -p > emulator.png
  return 1
}
# Tap the element showing this text; scroll down first while it is below the screen.
tap() {
  local h
  h=$(adb shell wm size | grep -o '[0-9]*x[0-9]*' | tail -1 | cut -dx -f2)
  for _ in 1 2 3 4 5 6; do
    dump > ui.xml
    read -r x y < <(python3 - "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
want = sys.argv[1]
for n in ET.parse('ui.xml').iter('node'):
    if want in (n.get('text') or '') or want in (n.get('content-desc') or ''):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
else:
    print(0, 0)
PY
)
    if [ "$y" -gt 0 ] && [ "$y" -lt $((h * 85 / 100)) ]; then
      echo "Tap \"$1\" at $x,$y"
      adb shell input tap "$x" "$y"
      return 0
    fi
    adb shell input swipe $((h / 4)) $((h * 3 / 4)) $((h / 4)) $((h / 4)) 300
    sleep 1
  done
  echo "::error::Could not tap: $1"
  return 1
}

wait_for "Welcome to SalesPlan" || exit 1
tap "Try it with sample data" || exit 1
wait_for "Checked: placed" || exit 1
adb exec-out screencap -p > emulator.png
echo "The app works: sample plan calculated and checked."
