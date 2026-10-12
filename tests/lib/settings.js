// Real schema, in-memory backend: tests never touch the user's dconf.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0])));

export function memorySettings() {
    const source = Gio.SettingsSchemaSource.new_from_directory(
        `${root}/extension/schemas`, Gio.SettingsSchemaSource.get_default(), false);
    const schema = source.lookup('org.gnome.shell.extensions.gnome-meet-widget', false);
    return new Gio.Settings({settings_schema: schema, backend: Gio.memory_settings_backend_new()});
}
