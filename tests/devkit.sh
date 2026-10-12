#!/usr/bin/env bash
# Nested GNOME Shell (devkit) in a fully isolated environment: its own D-Bus
# session, dconf (XDG_CONFIG_HOME) and extensions directory (XDG_DATA_HOME);
# only gnome-meet-widget and the test helper are enabled.
# Settings and extensions of the main session are not touched.
# GNOME Online Accounts is REAL: tests/goa-forward.js serves it on the nested bus
# by forwarding to GOA of the main session (a nested goa-daemon cannot unlock the
# keyring), so the nested Shell sees the real Google calendar.
# Headless (virtual monitor) by default; DEVKIT_WINDOW=1 opens a window instead.
# Text scaling follows the real session unless DEVKIT_TEXT_SCALE is set;
# DEVKIT_THEME=light|dark picks the theme, DEVKIT_SIZE and DEVKIT_SCALE set the
# virtual monitor size and integer UI scale (headless mode only).
#
#   tests/devkit.sh start [extra-uuid ...]             start in the background
#   tests/devkit.sh eval 'JS'                           run JS in the nested Shell
#   tests/devkit.sh shot out.png                        screenshot of the nested Shell
#   tests/devkit.sh click X Y                           click in the nested Shell
#   tests/devkit.sh log                                 path to the log
#   tests/devkit.sh stop
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATE=${DEVKIT_STATE:-${XDG_RUNTIME_DIR:-/tmp}/gnome-meet-widget-devkit}
LOG=$STATE/shell.log
BUS_FILE=$STATE/bus
PIDS_FILE=$STATE/pids

bus() {
  [[ -s $BUS_FILE ]] || { echo "devkit is not running" >&2; exit 1; }
  cat "$BUS_FILE"
}

start() {
  local extra=("$@")
  # Read from the real session before the environment is switched: the nested
  # Shell gets the same text size, so it looks like the real one.
  local scaling
  scaling=${DEVKIT_TEXT_SCALE:-$(gsettings get org.gnome.desktop.interface text-scaling-factor)}
  [[ -s $BUS_FILE ]] && { echo "already running (tests/devkit.sh stop)" >&2; exit 1; }

  "$ROOT/build.sh"
  mkdir -p "$STATE/config" "$STATE/data/gnome-shell/extensions"
  ln -sfn "$ROOT/extension" "$STATE/data/gnome-shell/extensions/gnome-meet-widget@north-leshiy.github.io"
  ln -sfn "$ROOT/tests/devkit-helper" "$STATE/data/gnome-shell/extensions/devkit-helper@gnome-meet-widget.test"
  # Extensions of the main session, if asked for (e.g. to check compatibility).
  local u
  for u in "${extra[@]}"; do
    ln -sfn "$HOME/.local/share/gnome-shell/extensions/$u" "$STATE/data/gnome-shell/extensions/$u"
  done

  # IMPORTANT: the isolation environment is set BEFORE dbus-daemon starts. The bus
  # activates services (dconf-service!) with its own environment; otherwise
  # dconf-service writes to the real ~/.config/dconf/user of the main session.
  export XDG_CONFIG_HOME=$STATE/config
  export XDG_DATA_HOME=$STATE/data
  # Meeting cache and reminded.json of the nested Shell stay out of ~/.cache.
  export XDG_CACHE_HOME=$STATE/cache
  local real_dconf=$HOME/.config/dconf/user before
  before=$(stat -c %Y.%s "$real_dconf" 2>/dev/null || echo none)

  local real_bus=$DBUS_SESSION_BUS_ADDRESS
  local out addr pid
  out=$(dbus-daemon --session --fork --print-address=1 --print-pid=1)
  addr=$(sed -n 1p <<<"$out")
  pid=$(sed -n 2p <<<"$out")
  echo "$addr" >"$BUS_FILE"
  echo "$pid" >"$PIDS_FILE"
  export DBUS_SESSION_BUS_ADDRESS=$addr

  # Check isolation BEFORE any write: start dconf-service on this bus and make
  # sure from its environment that it writes to $STATE/config.
  gdbus introspect --address "$addr" --dest ca.desrt.dconf \
    --object-path /ca/desrt/dconf/Writer/user >/dev/null
  local dconf_pid dconf_cfg
  dconf_pid=$(gdbus call --address "$addr" --dest org.freedesktop.DBus \
    --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.GetConnectionUnixProcessID ca.desrt.dconf |
    grep -oE '[0-9]+' | tail -1)
  dconf_cfg=$(tr '\0' '\n' <"/proc/$dconf_pid/environ" | sed -n 's/^XDG_CONFIG_HOME=//p')
  if [[ $dconf_cfg != "$STATE/config" ]]; then
    echo "ABORT: nested dconf-service (pid $dconf_pid) has XDG_CONFIG_HOME='$dconf_cfg'" >&2
    stop
    exit 1
  fi

  # Second line of defence: the real database must not change after the first write.
  gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
  if [[ $(stat -c %Y.%s "$real_dconf" 2>/dev/null || echo none) != "$before" ]]; then
    echo "ABORT: nested dconf is not isolated, real $real_dconf changed" >&2
    stop
    exit 1
  fi

  # Own org.gnome.OnlineAccounts before anything activates a nested goa-daemon.
  gjs -m "$ROOT/tests/goa-forward.js" "$real_bus" >"$STATE/goa-forward.log" 2>&1 &
  echo $! >"$STATE/goa-forward.pid"
  local _
  for _ in $(seq 25); do
    grep -q serving "$STATE/goa-forward.log" && break
    sleep 0.2
  done
  grep -q serving "$STATE/goa-forward.log" || { echo "goa-forward failed, see $STATE/goa-forward.log" >&2; stop; exit 1; }

  local uuids="'gnome-meet-widget@north-leshiy.github.io', 'devkit-helper@gnome-meet-widget.test'"
  for u in "${extra[@]}"; do uuids+=", '$u'"; done
  gsettings set org.gnome.shell enabled-extensions "[$uuids]"
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.desktop.interface text-scaling-factor "$scaling"
  [[ -n ${DEVKIT_SCALE:-} ]] && gsettings set org.gnome.desktop.interface scaling-factor "$DEVKIT_SCALE"
  # DEVKIT_THEME=light|dark; the default is the Shell's own default.
  case ${DEVKIT_THEME:-} in
    light) gsettings set org.gnome.desktop.interface color-scheme prefer-light ;;
    dark) gsettings set org.gnome.desktop.interface color-scheme prefer-dark ;;
  esac
  # Headless by default: nothing pops up on the user's screen, and screenshots of
  # GTK windows are more reliable (in nested mode they sometimes do not draw).
  if [[ -n ${DEVKIT_WINDOW:-} ]]; then
    gnome-shell --devkit --wayland >"$LOG" 2>&1 &
  else
    gnome-shell --headless --virtual-monitor "${DEVKIT_SIZE:-1280x800}" --wayland --no-x11 >"$LOG" 2>&1 &
  fi
  echo $! >>"$PIDS_FILE"
  # wait until the Shell owns its name on the bus
  for _ in $(seq 50); do
    if gdbus call --address "$addr" --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
      --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true; then
      sleep 2
      echo "devkit started, log: $LOG"
      return 0
    fi
    sleep 0.2
  done
  echo "Shell did not start, see $LOG" >&2
  exit 1
}

stop() {
  [[ -s $PIDS_FILE ]] || return 0
  local shell_pid bus_pid
  bus_pid=$(sed -n 1p "$PIDS_FILE")
  shell_pid=$(sed -n 2p "$PIDS_FILE")
  if [[ -n $shell_pid ]]; then kill "$shell_pid" 2>/dev/null || true; fi
  if [[ -s $STATE/goa-forward.pid ]]; then
    kill "$(cat "$STATE/goa-forward.pid")" 2>/dev/null || true
    : >"$STATE/goa-forward.pid"
  fi
  sleep 1
  if [[ -n $bus_pid ]]; then kill "$bus_pid" 2>/dev/null || true; fi
  : >"$PIDS_FILE"
  : >"$BUS_FILE"
  echo "devkit stopped"
}

shell_eval() {
  local reply
  reply=$(gdbus call --address "$(bus)" --dest org.gnome.Shell --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval "$1")
  echo "$reply"
  [[ $reply == "(true,"* ]]
}

# Left click at nested Shell coordinates (Clutter virtual pointer).
# Motion, press and release go in separate calls with pauses: GTK windows
# ignore a click that arrives in the same batch as the pointer entering the surface.
click() {
  local init="const {Clutter, GLib} = imports.gi;
    globalThis.__mwPointer ??= Clutter.get_default_backend().get_default_seat()
      .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const p = globalThis.__mwPointer, t = GLib.get_monotonic_time();"
  shell_eval "$init p.notify_absolute_motion(t, $1 - 1, $2); 'ok'" >/dev/null
  sleep 0.2
  shell_eval "$init p.notify_absolute_motion(t, $1, $2); 'ok'" >/dev/null
  sleep 0.2
  shell_eval "$init p.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED); 'ok'" >/dev/null
  sleep 0.1
  shell_eval "$init p.notify_button(t, Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED); 'ok'" >/dev/null
}

shot() {
  local file
  file=$(realpath -m "$1")
  gdbus call --address "$(bus)" --dest org.gnome.Shell.Screenshot \
    --object-path /org/gnome/Shell/Screenshot \
    --method org.gnome.Shell.Screenshot.Screenshot false false "$file" >/dev/null
  echo "$file"
}

cmd=${1:-}
shift || true
case "$cmd" in
  start) start "$@" ;;
  stop) stop ;;
  eval) shell_eval "$1" ;;
  shot) shot "$1" ;;
  click) click "$1" "$2" ;;
  log) echo "$LOG" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
