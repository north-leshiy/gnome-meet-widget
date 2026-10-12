// Loads tests/fixtures/*.json relative to this file.
import GLib from 'gi://GLib';

const dir = GLib.path_get_dirname(GLib.path_get_dirname(
    GLib.filename_from_uri(import.meta.url)[0]));

export function fixture(name) {
    const [, bytes] = GLib.file_get_contents(`${dir}/fixtures/${name}`);
    return JSON.parse(new TextDecoder().decode(bytes));
}

// 'Now' of all schedule tests: Monday 2026-10-12 in Europe/Moscow.
export const at = (hhmm, day = '2026-10-12') => Date.parse(`${day}T${hhmm}:00+03:00`);
