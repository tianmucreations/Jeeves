#!/bin/bash
# Builds "Jeeves.app" for this Mac (a preview, unsigned), following Electron's
# manual rebranding guide (electronjs.org/docs/latest/tutorial/application-distribution):
# copy Electron.app, rename it and its Info.plist names, give it the Jeeves icon, and
# put a small app/ in Resources that starts the desktop code in this folder.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$HOME/Applications}"
app="$out/Jeeves.app"
plist=/usr/libexec/PlistBuddy

# The icon: every size macOS asks for, from the 1024px drawing.
iconset="$here/build/Jeeves.iconset"
rm -rf "$iconset" && mkdir -p "$iconset"
for size in 16 32 128 256 512; do
  sips -z $size $size "$here/build/icon-1024.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$here/build/icon-1024.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$here/build/Jeeves.icns"

rm -rf "$app"
mkdir -p "$out"
ditto "$here/node_modules/electron/dist/Electron.app" "$app"
for key in CFBundleName CFBundleDisplayName; do
  $plist -c "Set :$key Jeeves" "$app/Contents/Info.plist" 2>/dev/null || $plist -c "Add :$key string Jeeves" "$app/Contents/Info.plist"
done
$plist -c "Set :CFBundleIdentifier com.tianmucreations.jeeves" "$app/Contents/Info.plist"
for helper in "$app"/Contents/Frameworks/Electron\ Helper*.app; do
  $plist -c "Set :CFBundleIdentifier com.tianmucreations.jeeves.helper$(basename "$helper" .app | sed 's/Electron Helper//; s/[ ()]//g' | tr 'A-Z' 'a-z' | sed 's/^./.&/')" "$helper/Contents/Info.plist"
done
cp "$here/build/Jeeves.icns" "$app/Contents/Resources/electron.icns"

# The app starts the desktop code where it lives, so changes need no rebuild.
mkdir -p "$app/Contents/Resources/app"
cat > "$app/Contents/Resources/app/package.json" <<JSON
{ "name": "jeeves-desktop", "productName": "Jeeves", "private": true, "type": "module", "main": "main.js" }
JSON
cat > "$app/Contents/Resources/app/main.js" <<JS
// Starts Jeeves Desktop from its project folder (a preview build for this Mac).
// This is the real app - never the practice one, whatever the session's own
// environment happens to hold (NODE_ENV=test is only ever meant for a
// deliberate "npm run dev"/"npm start" in a terminal, never a double-click).
delete process.env.NODE_ENV;
await import(new URL('file://' + encodeURI('$here/main.js')).href);
JS

# Changing Info.plist breaks Electron's signature; sign again for this Mac only.
codesign --force --deep --sign - "$app" 2>/dev/null
echo "$app"
