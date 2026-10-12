# shellcheck shell=bash disable=SC2034
# Sourced by manual checks: stub URL launching and park the pointer in the middle.
E() { tests/devkit.sh eval "$1"; }
E "const Gio = imports.gi.Gio; globalThis.__opened = []; Gio.app_info_launch_default_for_uri = u => { globalThis.__opened.push(u); return true; }; 'stubbed'" >/dev/null
E "const {Clutter, GLib} = imports.gi; globalThis.__mwPointer ??= Clutter.get_default_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE); globalThis.__mwPointer.notify_absolute_motion(GLib.get_monotonic_time(), 640, 400); 'parked'" >/dev/null
IND="import('resource:///org/gnome/shell/ui/main.js').then(M => { const i = M.panel.statusArea['gnome-meet-widget@north-leshiy.github.io'];"
