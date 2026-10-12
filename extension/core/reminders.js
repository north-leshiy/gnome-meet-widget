// Which reminders to fire and which to withdraw.

import {countsForPanel} from './schedule.js';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// One reminder per meeting instance and start time: a moved meeting gets a new key.
export function reminderKey(m) {
    return `${m.key}@${m.start}`;
}

// Reminders due now, grouped by start minute.
// reminded: Set or Map of keys already fired.
// Returns [{start, meetings, keys}] ordered by start.
export function dueReminders(meetings, now, minutes, reminded) {
    if (!minutes)
        return [];
    const due = meetings.filter(m =>
        countsForPanel(m) &&
        m.start > now &&
        m.start - now <= minutes * MIN &&
        !reminded.has(reminderKey(m)));

    const groups = new Map();
    for (const m of due) {
        const minute = Math.floor(m.start / MIN);
        if (!groups.has(minute))
            groups.set(minute, []);
        groups.get(minute).push(m);
    }
    return [...groups.values()]
        .map(ms => {
            ms.sort((a, b) => a.start - b.start || (a.title ?? '').localeCompare(b.title ?? ''));
            return {start: ms[0].start, meetings: ms, keys: ms.map(reminderKey)};
        })
        .sort((a, b) => a.start - b.start);
}

// Is a fired reminder (by its key) still worth showing?
// No once the meeting has ended, was declined, moved or vanished.
export function stillRelevant(key, meetings, now) {
    const m = meetings.find(x => reminderKey(x) === key);
    return Boolean(m) && countsForPanel(m) && now < m.end;
}

// Keys fired within the last day; older ones can no longer come back.
export function pruneReminded(reminded, now) {
    return new Map([...reminded].filter(([, firedAt]) => now - firedAt < DAY));
}
