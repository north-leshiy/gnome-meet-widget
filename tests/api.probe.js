// Read-only probe against the real Google API: counts per calendar for today,
// no titles. Then a fake token must produce one ensureCredentials and an 'auth' error.
import {GoaAccounts} from '../extension/lib/goa.js';
import {GoogleCalendarApi, ApiError} from '../extension/lib/googleApi.js';
import {dayKey, dayStart, addDays} from '../extension/core/meetings.js';

const goa = new GoaAccounts();
await goa.start();
const api = new GoogleCalendarApi(goa);
const today = dayKey(Date.now());
for (const a of goa.accounts()) {
    const cals = await api.calendars(a.id);
    print(`${a.email}: ${cals.length} calendars`);
    for (const c of cals) {
        const evs = await api.events(a.id, c.id, dayStart(today), dayStart(addDays(today, 1)));
        print(`  ${c.primary ? 'primary ' : ''}selected=${c.selected ?? false} role=${c.accessRole} events today=${evs.length}`);
    }
}

let ensured = 0;
const fake = {token: async () => 'invalid-token', ensureCredentials: async () => ensured++};
try {
    await new GoogleCalendarApi(fake).calendars('x');
    print('fake token: unexpected success');
} catch (e) {
    print(`fake token: ${e instanceof ApiError ? e.kind : e} status=${e.status} ensureCredentials=${ensured}`);
}
