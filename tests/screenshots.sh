#!/usr/bin/env bash
# Screenshots for the README: a synthetic English workday (tests/lib/demo-day.js)
# in a headless nested Shell at 2x, cropped into docs/screenshots/.
# No real calendar data reaches the pictures: the store is frozen and replaced.
#
#   tests/screenshots.sh
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
OUT=$ROOT/docs/screenshots
RAW=$(mktemp -d)
trap 'rm -rf "$RAW"; "$ROOT/tests/devkit.sh" stop >/dev/null' EXIT
SCALE=2
UUID=gnome-meet-widget@north-leshiy.github.io
WALL_DARK=/usr/share/backgrounds/mizuno-as-Big_Dipper.jpg
WALL_LIGHT=/usr/share/backgrounds/mendhak-Bluebells_Suspended_In_Time.jpg

E() { "$ROOT/tests/devkit.sh" eval "$1" >/dev/null; }
# Evaluate JS and print its string result.
Q() {
  "$ROOT/tests/devkit.sh" eval "$1" | sed -E "s/^\(true, '\"?//; s/\"?'\)$//"
}
MAIN="import('resource:///org/gnome/shell/ui/main.js').then(Main => { const ind = Main.panel.statusArea['$UUID'];"

theme() {
  local scheme=prefer-$1 wall=$WALL_DARK
  [[ $1 == light ]] && wall=$WALL_LIGHT
  E "const s = new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.interface'}); s.set_string('color-scheme', '$scheme');
     s.set_string('icon-theme', 'Adwaita'); s.set_enum('accent-color', 0);
     const b = new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.background'});
     b.set_string('picture-uri', 'file://$wall'); b.set_string('picture-uri-dark', 'file://$wall'); 'x'"
  sleep 1
}

setting() { E "$MAIN ind._settings.set_value('$1', imports.gi.GLib.Variant.new('$2', $3)); }); 'x'"; }

# demo NEXT_IN_MIN [ROUND_TO_MIN]
demo() {
  E "$MAIN ind.menu.close(); }); 'x'"
  E "globalThis.__demo($1, ${2:-5}); 'x'"
  sleep 1
}

# Pointer to logical (x, y).
pointer() {
  E "const {Clutter, GLib} = imports.gi;
     globalThis.__mwPointer ??= Clutter.get_default_backend().get_default_seat()
       .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
     globalThis.__mwPointer.notify_absolute_motion(GLib.get_monotonic_time(), $1, $2); 'x'"
}

# Logical extents "x y w h" of an actor expression evaluated with `ind` in scope.
extents() {
  E "$MAIN const e = ($1).get_transformed_extents();
     globalThis.__ext = [e.origin.x, e.origin.y, e.size.width, e.size.height].map(Math.round).join(' '); }); 'x'"
  sleep 0.3
  Q "globalThis.__ext"
}

shot() { "$ROOT/tests/devkit.sh" shot "$RAW/$1.png" >/dev/null; }

# crop NAME OUT X Y W H (logical px)
crop() {
  python3 - "$RAW/$1.png" "$OUT/$2.png" "$3" "$4" "$5" "$6" "$SCALE" <<'EOF'
import sys
from PIL import Image
src, dst, x, y, w, h, s = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:])
im = Image.open(src)
box = (max(0, x * s), max(0, y * s), min(im.width, (x + w) * s), min(im.height, (y + h) * s))
im.crop(box).save(dst, optimize=True)
EOF
}

clear_notifications() {
  E "$MAIN Main.messageTray.getSources().forEach(s => s.destroy()); }); 'x'"
}

mkdir -p "$OUT"
"$ROOT/tests/devkit.sh" stop >/dev/null || true
LANG=C.UTF-8 LC_ALL=C.UTF-8 LANGUAGE='' DEVKIT_SIZE=2560x1600 DEVKIT_SCALE=$SCALE DEVKIT_TEXT_SCALE=1.0 \
  "$ROOT/tests/devkit.sh" start >/dev/null
sleep 3
# shellcheck disable=SC1091
(cd "$ROOT" && source tests/lib/devkit-prep.sh)
E "eval(new TextDecoder().decode(imports.gi.GLib.file_get_contents('$ROOT/tests/lib/demo-day.js')[1]))"
clear_notifications

# 1. Agenda, dark: a meeting is running, the next one is in ten minutes.
theme dark
demo 10
E "$MAIN ind.menu.open(); }); 'x'"
sleep 1.5
read -r x y w h < <(extents 'ind.menu.actor')
shot agenda-dark
crop agenda-dark agenda-dark $((x - 40)) 0 $((w + 80)) $((y + h + 40))

# 2. Meeting card with attendees.
E "$MAIN ind.openOnCard('planning'); ind._card._attendeesOpen = true; ind._card.render(); }); 'x'"
sleep 1.5
read -r x y w h < <(extents 'ind.menu.actor')
shot card
crop card card $((x - 40)) 0 $((w + 80)) $((y + h + 40))

# 3. Agenda, light: two minutes to go, the button pulses.
theme light
demo 3
E "$MAIN ind.menu.open(); }); 'x'"
sleep 1.5
read -r x y w h < <(extents 'ind.menu.actor')
shot agenda-light
crop agenda-light agenda-light $((x - 40)) 0 $((w + 80)) $((y + h + 40))

# 4. Reminder notification.
E "$MAIN ind.menu.close(); }); 'x'"
theme dark
clear_notifications
demo 1 1
# Forget earlier reminders, so this one is shown again.
E "$MAIN Main.extensionManager.lookup('$UUID').stateObj._reminders._reminded.clear(); }); 'x'"
E "$MAIN Main.extensionManager.lookup('$UUID').stateObj._reminders._check(); }); 'x'"
sleep 1.5
read -r x y w h < <(extents 'Main.messageTray._banner')
# Banners show their buttons only when hovered.
pointer $((x + w / 2)) $((y + 30))
sleep 1.5
read -r x y w h < <(extents 'Main.messageTray._banner')
read -r px _ pw _ < <(extents 'ind')
shot reminder
crop reminder reminder $((x - 30)) 0 $((px + pw + 20 - x + 30)) $((y + h + 30))
pointer 640 400

# 5. Panel modes, cropped to the button.
clear_notifications
demo 25
for mode in smart countdown status; do
  setting panel-mode s "'$mode'"
  sleep 1
  read -r x y w h < <(extents 'ind')
  shot "panel-$mode"
  crop "panel-$mode" "panel-$mode" $((x - 12)) 0 $((w + 24)) $((y + h))
done
setting panel-mode s "'smart'"

# 6. Tooltip on hover.
sleep 1
read -r x y w h < <(extents 'ind')
pointer $((x + w / 2)) $((y + h / 2))
sleep 1.5
shot tooltip
crop tooltip tooltip $((x + w / 2 - 260)) 0 520 200
pointer 640 400

echo "screenshots in $OUT"
