import GLib from 'gi://GLib';
import {test, eq, ok, run} from './lib/assert.js';
import {fixture, at} from './lib/fixtures.js';
import {memorySettings} from './lib/settings.js';
import {MeetingStore} from '../extension/lib/store.js';
import {ApiError} from '../extension/lib/googleApi.js';

const cal = fixture('calendar.json');

function fakes({problem = null} = {}) {
    const calls = {events: 0, calendars: 0, ranges: []};
    const goa = {
        problem: () => problem,
        accounts: () => [{id: 'account_1', email: 'alex@example.com'}],
        onChanged: () => () => {},
    };
    const api = {
        fail: null,
        async calendars() {
            calls.calendars++;
            if (this.fail)
                throw this.fail;
            return cal.calendars;
        },
        async events(_a, calendarId, from, to) {
            calls.events++;
            calls.ranges.push([from, to]);
            return cal.events[calendarId] ?? [];
        },
    };
    const cache = {written: null, read: async () => null, async write(v) {
        this.written = v;
    }};
    return {goa, api, cache, calls};
}

function make(f, now = at('13:10')) {
    const store = new MeetingStore({goa: f.goa, api: f.api, cache: f.cache,
        settings: memorySettings(), now: () => now});
    return store;
}

test('refresh loads today and tomorrow of visible calendars and writes the cache', async () => {
    const f = fakes();
    const store = make(f);
    await store.refresh();
    // primary, two copies; hidden, birthdays and holidays are skipped
    eq(f.calls.events, 3);
    eq(f.calls.ranges[0], [Date.parse('2026-10-12T00:00:00+03:00'), Date.parse('2026-10-14T00:00:00+03:00')]);
    eq(f.cache.written.windowDay, '2026-10-12');
    eq(store.day('2026-10-13').map(m => m.title), ['Business trip', 'Standup']);
    eq(store.stale, false);
    store.destroy();
});

test('one refresh at a time; a call during it asks for one more run', async () => {
    const f = fakes();
    const store = make(f);
    const a = store.refresh();
    const b = store.refresh();
    ok(a === b);
    await a;
    // the pending run starts right after the first one
    await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => r() ?? false));
    await store._running;
    eq(f.calls.calendars, 2);
    store.destroy();
});

test('network error keeps the last data', async () => {
    const f = fakes();
    const store = make(f);
    await store.refresh();
    f.api.fail = new ApiError('network', 0, null, 'offline');
    await store.refresh();
    eq(store.lastFailure, 'network');
    eq(store.error, null);
    ok(store.meetings.length > 0);
    store.destroy();
});

test('rate limit doubles the pause up to 30 minutes', async () => {
    const f = fakes();
    const store = make(f);
    f.api.fail = new ApiError('rate', 429, 'rateLimitExceeded', 'slow down');
    const pauses = [];
    for (let i = 0; i < 4; i++) {
        await store.refresh();
        pauses.push(store._backoffMin);
    }
    eq(pauses, [10, 20, 30, 30]);
    f.api.fail = null;
    await store.refresh();
    eq(store._backoffMin, 0);
    store.destroy();
});

test('401 after EnsureCredentials means the user must sign in', async () => {
    const f = fakes();
    const store = make(f);
    f.api.fail = new ApiError('auth', 401, null, 'unauthorized');
    await store.refresh();
    eq(store.error, 'attention');
    store.destroy();
});

test('no account in GOA', async () => {
    const f = fakes({problem: 'no-account'});
    const store = make(f);
    await store.refresh();
    eq(store.error, 'no-account');
    eq(f.calls.calendars, 0);
    store.destroy();
});

test('far day loads on demand, then comes from memory', async () => {
    const f = fakes();
    const store = make(f);
    await store.refresh();
    const before = f.calls.events;
    eq(store.day('2026-10-20'), null);
    await new Promise(r => store.onChanged(r));
    eq(store.day('2026-10-20'), []);
    eq(f.calls.events, before + 3);
    store.day('2026-10-20');
    eq(f.calls.events, before + 3);
    store.destroy();
});

test('stale after two intervals', async () => {
    const f = fakes();
    let now = at('13:10');
    const store = new MeetingStore({goa: f.goa, api: f.api, cache: f.cache,
        settings: memorySettings(), now: () => now});
    await store.refresh();
    now = at('13:20');
    eq(store.stale, false);
    now = at('13:21');
    eq(store.stale, true);
    store.destroy();
});

test('new day: one attempt, then the regular timer', async () => {
    const f = fakes();
    let now = at('23:50');
    const store = new MeetingStore({goa: f.goa, api: f.api, cache: f.cache,
        settings: memorySettings(), now: () => now});
    store.refreshIfNewDay();
    eq(f.calls.calendars, 0);   // nothing loaded yet: the start-up refresh handles it
    await store.refresh();
    store.refreshIfNewDay();
    eq(f.calls.calendars, 1);   // same day
    now = at('00:01', '2026-10-13');
    f.api.fail = new ApiError('network', 0, null, 'offline');
    store.refreshIfNewDay();
    await store._running;
    store.refreshIfNewDay();
    store.refreshIfNewDay();
    eq(f.calls.calendars, 2);   // one attempt only, no retry on every tick
    store.destroy();
});

await run();
