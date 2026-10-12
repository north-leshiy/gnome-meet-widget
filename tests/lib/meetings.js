// All fixture events normalized, as the store would produce them.
import {fixture} from './fixtures.js';
import {normalize, calendarVisible, mergeDuplicates} from '../../extension/core/meetings.js';

export function fixtureMeetings({merge = true, overrides = {}} = {}) {
    const cal = fixture('calendar.json');
    const out = [];
    for (const calendar of cal.calendars) {
        if (!calendarVisible(calendar, overrides))
            continue;
        for (const e of cal.events[calendar.id] ?? []) {
            const m = normalize(e, {accountId: cal.account.id, calendar});
            if (m)
                out.push(m);
        }
    }
    return merge ? mergeDuplicates(out) : out;
}
