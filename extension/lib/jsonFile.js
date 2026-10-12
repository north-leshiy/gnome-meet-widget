// JSON files in ~/.cache/gnome-meet-widget/. They hold meeting titles and
// attendee addresses, hence mode 0600.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

export class JsonFile {
    constructor(name) {
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gnome-meet-widget']);
        this._file = Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
    }

    // Parsed contents, or null when missing or broken.
    async read() {
        try {
            const [bytes] = await this._file.load_contents_async(null);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.warn(`gnome-meet-widget: cannot read ${this._file.get_basename()}: ${e.message}`);
            return null;
        }
    }

    async write(value) {
        GLib.mkdir_with_parents(this._dir, 0o700);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(value)));
        await this._file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        // PRIVATE covers a new file; an existing one keeps its mode otherwise.
        this._file.set_attribute_uint32('unix::mode', 0o600, Gio.FileQueryInfoFlags.NONE, null);
    }
}
