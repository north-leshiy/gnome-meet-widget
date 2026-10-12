// Google Calendar events to meetings. No GNOME imports, so this runs in tests.
//
// A meeting is a plain object so it can go to the disk cache as is. Timed
// meetings have start/end in ms; all-day ones have allDayStart/allDayEnd as
// 'YYYY-MM-DD', end exclusive.

import {findCallLink} from './links.js';

// Calendars Google creates by itself; hidden unless the user turns them on.
const AUTO_CALENDAR = /#(contacts|holiday)@group\.v\.calendar\.google\.com$/;

// overrides: {calendarId: bool} from the calendar-visibility setting.
export function calendarVisible(calendar, overrides = {}) {
    if (calendar.id in overrides)
        return overrides[calendar.id];
    return calendar.selected === true && !AUTO_CALENDAR.test(calendar.id);
}

function attendeeOf(a) {
    return {
        name: a.displayName ?? null,
        email: a.email ?? null,
        response: a.responseStatus ?? 'needsAction',
        optional: a.optional === true,
        organizer: a.organizer === true,
        self: a.self === true,
    };
}

// Meeting for one event of `calendar`, or null for a cancelled instance.
export function normalize(event, {accountId, calendar}) {
    if (event.status === 'cancelled')
        return null;

    // Rooms booked in Google Workspace are attendees with resource: true. They
    // are the place, not people: shown as the location when none is typed;
    // a room that declined is not booked.
    const people = (event.attendees ?? []).filter(a => a.resource !== true);
    const rooms = (event.attendees ?? [])
        .filter(a => a.resource === true && a.responseStatus !== 'declined')
        .map(a => a.displayName ?? a.email)
        .filter(Boolean);
    const attendees = people.map(attendeeOf);
    const self = attendees.find(a => a.self) ?? null;
    const isOrganizer = event.organizer?.self === true || self?.organizer === true;

    const m = {
        key: `${accountId}/${calendar.id}/${event.id}`,
        accountId,
        calendarId: calendar.id,
        calendarName: calendar.summaryOverride ?? calendar.summary ?? calendar.id,
        calendarColor: calendar.backgroundColor ?? null,
        calendarPrimary: calendar.primary === true,
        eventId: event.id,
        iCalUID: event.iCalUID ?? null,
        etag: event.etag ?? null,
        title: (event.summary ?? '').trim() || null,
        start: null,
        end: null,
        allDayStart: null,
        allDayEnd: null,
        eventType: event.eventType ?? 'default',
        recurring: Boolean(event.recurringEventId),
        selfResponse: self?.response ?? null,
        isOrganizer,
        canRespond: self !== null && !isOrganizer,
        // A calendar copy names its owner as the organizer; that is not news
        // worth showing, so the organizer is kept only when someone was invited.
        organizer: attendees.length && event.organizer
            ? {name: event.organizer.displayName ?? null, email: event.organizer.email ?? null,
                self: event.organizer.self === true}
            : null,
        attendees,
        location: event.location?.trim() || rooms.join(', ') || null,
        descriptionHtml: event.description ?? null,
        link: findCallLink(event),
        htmlLink: event.htmlLink ?? null,
    };

    if (event.start?.date) {
        m.allDayStart = event.start.date;
        m.allDayEnd = event.end?.date ?? addDays(event.start.date, 1);
    } else {
        m.start = Date.parse(event.start?.dateTime);
        m.end = Date.parse(event.end?.dateTime);
        if (!Number.isFinite(m.start))
            return null;
        if (!Number.isFinite(m.end) || m.end < m.start)
            m.end = m.start;
    }
    return m;
}

export function isAllDay(m) {
    return m.allDayStart !== null;
}

// 'YYYY-MM-DD' of the local day containing ms.
export function dayKey(ms) {
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Local midnight (ms) of a 'YYYY-MM-DD' day.
export function dayStart(key) {
    const [y, mo, d] = key.split('-').map(Number);
    return new Date(y, mo - 1, d).getTime();
}

export function addDays(key, n) {
    const [y, mo, d] = key.split('-').map(Number);
    return dayKey(new Date(y, mo - 1, d + n).getTime());
}

// Does the meeting touch the local day `key`?
export function onDay(m, key) {
    if (isAllDay(m))
        return m.allDayStart <= key && key < m.allDayEnd;
    const from = dayStart(key);
    const to = dayStart(addDays(key, 1));
    // A zero-length meeting at midnight belongs to the day it starts.
    return m.start < to && (m.end > from || m.start === from);
}

const normTitle = t => (t ?? '').trim().toLowerCase();

function better(a, b) {
    for (const f of [m => m.canRespond, m => m.link !== null, m => m.calendarPrimary]) {
        if (f(a) !== f(b))
            return f(a) ? a : b;
    }
    return a.key <= b.key ? a : b;
}

// The same meeting seen in several calendars or accounts. Duplicates share
// iCalUID and start, or start and title. The kept copy is the one that can be
// answered, then the one with a call link; a link found only in a dropped copy
// moves over.
export function mergeDuplicates(meetings) {
    const parent = meetings.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i, j) => {
        parent[find(i)] = find(j);
    };

    const byKey = new Map();
    meetings.forEach((m, i) => {
        const start = isAllDay(m) ? m.allDayStart : m.start;
        const keys = [];
        if (normTitle(m.title))
            keys.push(`t:${start}|${normTitle(m.title)}`);
        if (m.iCalUID)
            keys.push(`u:${m.iCalUID}|${start}`);
        for (const k of keys) {
            if (byKey.has(k))
                union(i, byKey.get(k));
            else
                byKey.set(k, i);
        }
    });

    const groups = new Map();
    meetings.forEach((m, i) => {
        const g = find(i);
        groups.set(g, [...groups.get(g) ?? [], m]);
    });

    return [...groups.values()].map(group => {
        const best = group.reduce(better);
        if (best.link)
            return best;
        const withLink = group.find(m => m.link);
        return withLink ? {...best, link: withLink.link} : best;
    });
}
