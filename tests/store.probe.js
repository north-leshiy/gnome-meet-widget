// Real GOA + Google + cache file. Prints counts only. Run twice, the second
// time with --offline: every API call then fails like a dead network, so the
// data can only come from the cache file. (`unshare -n` is blocked by AppArmor.)
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {GoaAccounts} from '../extension/lib/goa.js';
import {GoogleCalendarApi, ApiError} from '../extension/lib/googleApi.js';
import {MeetingStore} from '../extension/lib/store.js';
import {dayKey, addDays} from '../extension/core/meetings.js';
import {memorySettings} from './lib/settings.js';

const goa = new GoaAccounts();
await goa.start();
const offline = () => Promise.reject(new ApiError('network', 0, null, 'offline'));
const api = ARGV.includes('--offline') ? {calendars: offline, events: offline} : new GoogleCalendarApi(goa);
const store = new MeetingStore({goa, api, settings: memorySettings()});
await store.start();
await store._running;
const today = dayKey(Date.now());
const fetched = store.fetchedAt ? new Date(store.fetchedAt).toLocaleTimeString() : null;
print(`error=${store.error} lastFailure=${store.lastFailure} stale=${store.stale} fetchedAt=${fetched}`);
print(`today=${store.day(today).length} tomorrow=${store.day(addDays(today, 1)).length} window=${store.meetings.length}`);
const info = Gio.File.new_for_path(`${GLib.get_user_cache_dir()}/gnome-meet-widget/meetings.json`)
    .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
print(`cache mode=${(info.get_attribute_uint32('unix::mode') & 0o777).toString(8)}`);
store.destroy();
