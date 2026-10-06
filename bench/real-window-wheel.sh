#!/bin/bash
# Real Terminal window: a REAL wheel turn while an answer prints (native scrollback), then a REAL click on Settings.
set -e
cd "/Users/macdaddy/Documents/Projects/Jeeves CLI Project"
npm run build --silent
SHOT=/private/tmp/jeeves-realshots; mkdir -p "$SHOT"; rm -f "$SHOT"/wheel-*.png
cp bench/capture-hook.cjs /private/tmp/capture-hook.cjs
pkill -f "node dist/index.js" 2>/dev/null || true; sleep 1; rm -f /private/tmp/jeeves-capture.txt
osascript -e 'tell application "Terminal" to do script "cd '\''/Users/macdaddy/Documents/Projects/Jeeves CLI Project'\'' && NODE_ENV=test JEEVES_KEYCHAIN_SERVICE=jeeves-tests JEEVES_ZAI_BASE_URL=http://127.0.0.1:4123 JEEVES_NO_BROWSER=1 PATH=/private/tmp/jv-shim:$PATH NODE_OPTIONS='\''--require /private/tmp/capture-hook.cjs'\'' JEEVES_CAPTURE=/private/tmp/jeeves-capture.txt node dist/index.js"'
for i in $(seq 1 60); do grep -q "Just chat" /private/tmp/jeeves-capture.txt 2>/dev/null && break; sleep 0.5; done
front() { osascript -e 'tell application "Terminal"
 activate
 repeat with w in windows
  if name of w contains "node dist/index.js" then
   set index of w to 1
   exit repeat
  end if
 end repeat
end tell'; sleep 0.3; }
bounds() { osascript -e 'tell application "Terminal" to get bounds of window 1 whose name contains "node dist/index.js"'; }
shot() { front; b=$(bounds); python3 - "$b" "$SHOT/wheel-$1.png" <<'PY'
import sys,subprocess
x1,y1,x2,y2=[int(v) for v in sys.argv[1].split(',')]
subprocess.run(['screencapture','-x',f'-R{x1},{y1},{x2-x1},{y2-y1}',sys.argv[2]])
PY
echo "shot $1"; }
front; osascript -e 'tell application "System Events" to keystroke return'
for i in $(seq 1 60); do grep -q "What can I do for you" /private/tmp/jeeves-capture.txt 2>/dev/null && break; sleep 0.5; done
sleep 1
front
osascript -e 'tell application "System Events" to keystroke "Write about 900 words on the history of Spain, in many short paragraphs."'
sleep 0.4; osascript -e 'tell application "System Events" to key code 36'
sleep 9
B=$(bounds); CX=$(python3 -c "b='$B'.split(',');print((int(b[0])+int(b[2]))//2)"); CY=$(python3 -c "b='$B'.split(',');print((int(b[1])+int(b[3]))//2)")
shot 1-printing
osascript -l JavaScript -e "ObjC.import('CoreGraphics');
var m=\$.CGEventCreateMouseEvent(null,\$.kCGEventMouseMoved,{x:$CX,y:$CY},0);\$.CGEventPost(\$.kCGHIDEventTap,m);
delay(0.3);
for (var i=0;i<12;i++){var e=\$.CGEventCreateScrollWheelEvent(null,0,1,8);\$.CGEventPost(\$.kCGHIDEventTap,e);delay(0.05);}"
sleep 1; shot 2-after-wheel-up
sleep 6; shot 3-six-seconds-later
echo DONE
