#!/bin/bash
# Real-window resize test v2: emulates a HAND DRAG (many small pixel steps),
# refocuses the Jeeves window before every action, and crops every screenshot
# to the Jeeves window's own bounds.
set -e
cd "/Users/macdaddy/Documents/Projects/Jeeves CLI Project"
# The window runs the BUILT code (dist) - test yesterday's build by accident once
# and the whole proof is worthless. Build first, every time (3 Oct).
npm run build --silent
SHOT=/private/tmp/jeeves-realshots
mkdir -p "$SHOT"; rm -f "$SHOT"/*.png

front() {
  osascript <<'ASC'
tell application "Terminal"
  activate
  repeat with w in windows
    if name of w contains "node dist/index.js" then
      set index of w to 1
      exit repeat
    end if
  end repeat
end tell
ASC
  sleep 0.3
}

wbounds() {
  osascript -e "tell application \"Terminal\" to get bounds of window 1 whose name contains \"node dist/index.js\"" 2>/dev/null
}

shot() {
  front
  local b=$(wbounds)
  if [ -n "$b" ]; then
    local x=$(echo $b | cut -d, -f1 | tr -d ' ')
    local y=$(echo $b | cut -d, -f2 | tr -d ' ')
    local w=$(echo $b | cut -d, -f3 | tr -d ' ' | awk '{print $1-x}' x=$x)
    w=$(python3 -c "print($w)")
    local h=$(python3 -c "b='$b'.split(','); print(int(b[3].strip())-int(b[1].strip()))")
    screencapture -x -R${x},${y},${w},${h} "$SHOT/$1.png"
  else
    screencapture -x "$SHOT/$1.png"
  fi
  echo "shot: $1"
}

# The stdout-capture hook is copied fresh from the repo on every run: /private/tmp
# is cleaned by macOS between sessions, and a missing hook used to kill the boot
# SILENTLY (no Jeeves window at all, then the drag failed and set -e exited) - 3 Oct.
cp bench/capture-hook.cjs /private/tmp/capture-hook.cjs
# Stale test windows from an earlier run match the same name filter and steal the
# keystrokes - close them first. And the capture starts clean every run.
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1
rm -f /private/tmp/jeeves-capture.txt
osascript -e 'tell application "Terminal" to do script "cd '\''/Users/macdaddy/Documents/Projects/Jeeves CLI Project'\'' && NODE_ENV=test JEEVES_KEYCHAIN_SERVICE=jeeves-tests JEEVES_ZAI_BASE_URL=http://127.0.0.1:4123 JEEVES_NO_BROWSER=1 PATH=/private/tmp/jv-shim:$PATH NODE_OPTIONS='\''--require /private/tmp/capture-hook.cjs'\'' JEEVES_CAPTURE=/private/tmp/jeeves-capture.txt node dist/index.js"'
# WAIT for the app, as the pty rig does - a blind sleep raced the boot, and one
# slow start put the typed question into the picker's search field instead of the
# chat (3 Oct). Watch the capture for the picker row, pick it, then watch again
# for the conversation screen before typing anything.
for i in $(seq 1 60); do
  grep -q "Just chat" /private/tmp/jeeves-capture.txt 2>/dev/null && break
  sleep 0.5
done
front
osascript -e 'tell application "System Events" to keystroke return'
for i in $(seq 1 60); do
  grep -q "What can I do for you" /private/tmp/jeeves-capture.txt 2>/dev/null && break
  sleep 0.5
done
sleep 1
shot 1-start

front
osascript -e 'tell application "System Events" to keystroke "Write about 900 words on the history of Spain, in many short paragraphs."'
sleep 0.4
osascript -e 'tell application "System Events" to key code 36'
sleep 7
shot 2-streaming

# THE DRAG: 24 small pixel steps, like a hand. Window grows ~640x420 -> 1300x850.
# (Errors are NOT swallowed: a failed resize must stop the test loudly, not silently.)
for i in $(seq 1 24); do
  W=$(python3 -c "print(640 + int(($i)*27.5))")
  H=$(python3 -c "print(420 + int(($i)*18))")
  osascript -e "tell application \"Terminal\" to set size of window 1 whose name contains \"node dist/index.js\" to {$W, $H}"
  sleep 0.05
done
shot 3-drag-end

# keep streaming, drag back down
for i in $(seq 1 12); do
  W=$(python3 -c "print(1300 - int(($i)*50))")
  H=$(python3 -c "print(850 - int(($i)*30))")
  osascript -e "tell application \"Terminal\" to set size of window 1 whose name contains \"node dist/index.js\" to {$W, $H}"
  sleep 0.05
done
shot 4-drag-back-down

# let the healing ladder finish, then look again
sleep 3
shot 5-after-heal

# NATIVE SCROLLING (6 Oct): Terminal's own scrollback, while the answer is still
# printing - Shift+Page Up is Terminal.app's scroll-back key. A character is typed
# first so the typing area shows live text; the shot must show older text above AND
# the typing area still alive below (Terminal keeps it at the bottom of the live view).
front
osascript -e 'tell application "System Events" to keystroke "x"'
sleep 0.3
for i in 1 2; do osascript -e 'tell application "System Events" to key code 116 using shift down'; sleep 0.3; done
sleep 0.6
shot 6-native-scrolled-while-streaming
osascript -e 'tell application "System Events" to key code 119 using shift down'
sleep 1
shot 7-back-at-the-end
osascript -e 'tell application "System Events" to key code 51'

echo DONE
