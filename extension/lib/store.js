// Meetings for the panel, the agenda and reminders. Polls Google for today
// and tomorrow, keeps the last good result on disk, loads other days on
// demand and backs off when rate limited.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {normalize, calendarVisible, mergeDuplicates, dayKey, dayStart, addDays, onDay}
    from '../core/meetings.js';
import {ApiError} from './googleApi.js';
import {GoaError} from './goa.js';
import {JsonFile} from './jsonFile.js';

const MIN = 60 * 1000;
const BACKOFF_MAX_MIN = 30;
const DAY_CACHE_SIZE = 14;
const PARALLEL = 4;
const CACHE_VERSION = 1;

const isCancelled = e => e?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

async function pool(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            // eslint-disable-next-line no-await-in-loop
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({length: Math.min(size, items.length)}, worker));
    return out;
}

export class MeetingStore {
    // `cache` and `now` are replaced in tests.
    constructor({goa, api, settings, cache = new JsonFile('meetings.json'), now = () => Date.now()}) {
        this._goa = goa;
        this._api = api;
        this._settings = settings;
        this._cache = cache;
        this._now = now;

        this._meetings = [];        // today and tomorrow
        this._windowDay = null;     // dayKey of the first day in _meetings
        this._fetchedAt = null;
        this._error = null;         // account problem: 'no-goa' | 'no-account' | 'attention'
        this._lastFailure = null;   // ApiError kind of the last failed refresh
        this._days = new Map();     // other days by key, LRU
        this._running = null;
        this._pending = false;
        this._backoffMin = 0;
        this._timerId = 0;
        this._cancellable = new Gio.Cancellable();
        this._listeners = new Set();
    }

    async start() {
        const cached = await this._cache.read();
        if (this._cancellable.is_cancelled())
            return;
        if (cached?.version === CACHE_VERSION && Array.isArray(cached.meetings)) {
            this._meetings = cached.meetings;
            this._fetchedAt = cached.fetchedAt ?? null;
            this._windowDay = cached.windowDay ?? null;
        }
        this._unwatchGoa = this._goa.onChanged(() => this.refresh());
        this._settingsIds = [
            this._settings.connect('changed::refresh-interval', () => this._schedule()),
            this._settings.connect('changed::calendar-visibility', () => {
                this._days.clear();
                this.refresh();
            }),
        ];
        this._emit();
        this.refresh();
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._unwatchGoa?.();
        this._settingsIds?.forEach(id => this._settings.disconnect(id));
        this._listeners.clear();
    }

    onChanged(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners) {
            try {
                fn();
            } catch (e) {
                console.error(`gnome-meet-widget: store listener: ${e.stack ?? e}`);
            }
        }
    }

    get meetings() {
        return this._meetings;
    }

    get error() {
        return this._error;
    }

    get fetchedAt() {
        return this._fetchedAt;
    }

    get loading() {
        return this._running !== null;
    }

    get lastFailure() {
        return this._lastFailure;
    }

    get intervalMin() {
        return Math.min(60, Math.max(1, this._settings.get_uint('refresh-interval')));
    }

    // Older than two refresh intervals.
    get stale() {
        return this._fetchedAt === null || this._now() - this._fetchedAt > 2 * this.intervalMin * MIN;
    }

    // Meetings of a day: from the regular window, from the on-demand cache, or
    // null while loading (a load is started and onChanged fires when done).
    day(key) {
        if (this._windowDay && (key === this._windowDay || key === addDays(this._windowDay, 1)))
            return this._meetings.filter(m => onDay(m, key));
        const cached = this._days.get(key);
        if (cached?.meetings) {
            // LRU: move to the end.
            this._days.delete(key);
            this._days.set(key, cached);
            return cached.meetings;
        }
        if (!cached)
            this._loadDay(key);
        return null;
    }

    // Replace one meeting after an RSVP so the UI need not wait for a refresh.
    updateMeeting(meeting) {
        const swap = list => list.map(m => (m.key === meeting.key ? meeting : m));
        this._meetings = swap(this._meetings);
        for (const v of this._days.values()) {
            if (v.meetings)
                v.meetings = swap(v.meetings);
        }
        this._emit();
    }

    // Refresh when the data is older than maxAgeMs (menu opened), or when the
    // local day has changed since the last load (midnight, resume).
    refreshIfOlder(maxAgeMs) {
        if (this._windowDay !== dayKey(this._now()) ||
            this._fetchedAt === null || this._now() - this._fetchedAt > maxAgeMs)
            this.refresh();
    }

    // The local day has turned (midnight, resume): one attempt per new day.
    // Retries after a failure go by the regular timer and its backoff.
    refreshIfNewDay() {
        const today = dayKey(this._now());
        if (this._windowDay === null || this._windowDay === today || this._newDayAttempt === today)
            return;
        this._newDayAttempt = today;
        this.refresh();
    }

    // One refresh at a time; a call during a refresh asks for one more run.
    refresh() {
        if (this._running) {
            this._pending = true;
            return this._running;
        }
        this._running = this._refresh().finally(() => {
            this._running = null;
            if (this._pending && !this._cancellable.is_cancelled()) {
                this._pending = false;
                this.refresh();
            }
        });
        this._emit();
        return this._running;
    }

    async _refresh() {
        const today = dayKey(this._now());
        try {
            const problem = this._goa.problem();
            if (problem)
                throw new GoaError(problem, problem);

            const meetings = await this._fetchRange(dayStart(today), dayStart(addDays(today, 2)));
            this._dropOldDays(today);
            this._meetings = meetings;
            this._windowDay = today;
            this._fetchedAt = this._now();
            this._error = null;
            this._lastFailure = null;
            this._backoffMin = 0;
            await this._cache.write({
                version: CACHE_VERSION, fetchedAt: this._fetchedAt, windowDay: today, meetings,
            }).catch(e => console.warn(`gnome-meet-widget: cache write: ${e.message}`));
        } catch (e) {
            if (isCancelled(e))
                return;
            this._fail(e);
        }
        if (!this._cancellable.is_cancelled()) {
            this._schedule();
            this._emit();
        }
    }

    _fail(e) {
        const previous = this._lastFailure;
        if (e instanceof GoaError) {
            this._error = e.code;
            this._lastFailure = e.code;
        } else if (e instanceof ApiError && e.kind === 'auth') {
            // 401 again right after EnsureCredentials: the user has to sign in.
            this._error = 'attention';
            this._lastFailure = 'auth';
        } else if (e instanceof ApiError) {
            this._lastFailure = e.kind;
            if (e.kind === 'rate')
                this._backoffMin = Math.min(BACKOFF_MAX_MIN, (this._backoffMin || this.intervalMin) * 2);
        } else {
            this._lastFailure = 'server';
            console.error(`gnome-meet-widget: refresh: ${e.stack ?? e}`);
        }
        // Offline, this repeats every refresh; log only when the cause changes.
        if ((e instanceof ApiError || e instanceof GoaError) && this._lastFailure !== previous)
            console.warn(`gnome-meet-widget: refresh failed: ${e.message}`);
    }

    // Normalized and merged meetings of all visible calendars in [from, to).
    async _fetchRange(from, to) {
        const overrides = this._settings.get_value('calendar-visibility').deepUnpack();
        const perAccount = await pool(this._goa.accounts(), PARALLEL, async account => {
            const calendars = await this._api.calendars(account.id, this._cancellable);
            const visible = calendars.filter(c => calendarVisible(c, overrides));
            const lists = await pool(visible, PARALLEL, async calendar => {
                const events = await this._api.events(account.id, calendar.id, from, to, this._cancellable);
                return events.map(e => normalize(e, {accountId: account.id, calendar})).filter(Boolean);
            });
            return lists.flat();
        });
        return mergeDuplicates(perAccount.flat());
    }

    async _loadDay(key) {
        this._days.set(key, {loading: true});
        try {
            const meetings = (await this._fetchRange(dayStart(key), dayStart(addDays(key, 1))))
                .filter(m => onDay(m, key));
            this._days.set(key, {meetings, fetchedAt: this._now()});
            while (this._days.size > DAY_CACHE_SIZE)
                this._days.delete(this._days.keys().next().value);
        } catch (e) {
            this._days.delete(key);
            if (isCancelled(e))
                return;
            this._days.set(key, {meetings: [], failed: true});
            console.warn(`gnome-meet-widget: day ${key}: ${e.message}`);
        }
        this._emit();
    }

    // On-demand days are cheap to refetch; drop them when the day turns
    // (called before _windowDay moves to `today`).
    _dropOldDays(today) {
        if (this._windowDay !== today)
            this._days.clear();
        for (const [key, v] of this._days) {
            if (v.failed)
                this._days.delete(key);
        }
    }

    _schedule() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        const minutes = Math.max(this.intervalMin, this._backoffMin);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._timerId = 0;
            this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }
}
