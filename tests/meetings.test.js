import {test, eq, ok, run} from './lib/assert.js';
import {fixture} from './lib/fixtures.js';
import {fixtureMeetings} from './lib/meetings.js';
import * as M from '../extension/core/meetings.js';

const cal = fixture('calendar.json');
const calendar = id => cal.calendars.find(c => c.id === id);
const byId = (list, id) => list.find(m => m.eventId === id);

test('calendar visibility: selected, auto calendars hidden, overrides win', () => {
    eq(M.calendarVisible(calendar('alex@example.com')), true);
    eq(M.calendarVisible(calendar('hidden@group.calendar.google.com')), false);
    eq(M.calendarVisible(calendar('addressbook#contacts@group.v.calendar.google.com')), false);
    eq(M.calendarVisible(calendar('ru.russian#holiday@group.v.calendar.google.com')), false);
    eq(M.calendarVisible(calendar('addressbook#contacts@group.v.calendar.google.com'),
        {'addressbook#contacts@group.v.calendar.google.com': true}), true);
    eq(M.calendarVisible(calendar('copy1@group.calendar.google.com'),
        {'copy1@group.calendar.google.com': false}), false);
});

test('cancelled instance is dropped', () => {
    const all = fixtureMeetings({merge: false});
    eq(byId(all, 'weekly_20261019T090000Z'), undefined);
    ok(byId(all, 'weekly_20261012T090000Z').recurring);
});

test('invitation: self needsAction, can respond, organizer kept', () => {
    const m = byId(fixtureMeetings(), 'invite1');
    eq(m.selfResponse, 'needsAction');
    eq(m.canRespond, true);
    eq(m.isOrganizer, false);
    eq(m.organizer, {name: 'Team Lead', email: 'lead@example.org', self: false});
    eq(m.start, Date.parse('2026-10-12T08:00:00Z'));
    eq(m.attendees.length, 5);
    eq(m.attendees[3].optional, true);
});

test('own meeting: organizer cannot respond', () => {
    const m = byId(fixtureMeetings(), 'own1');
    eq(m.isOrganizer, true);
    eq(m.canRespond, false);
});

test('copy without attendees: no response, no organizer shown', () => {
    const m = byId(fixtureMeetings({merge: false}), 'copyA');
    eq(m.canRespond, false);
    eq(m.selfResponse, null);
    eq(m.organizer, null);
});

test('all-day keeps an exclusive end and touches each of its days', () => {
    const m = byId(fixtureMeetings(), 'trip');
    eq([m.allDayStart, m.allDayEnd], ['2026-10-12', '2026-10-15']);
    eq(['2026-10-11', '2026-10-12', '2026-10-14', '2026-10-15'].map(d => M.onDay(m, d)),
        [false, true, true, false]);
});

test('timed meeting belongs to its day', () => {
    const m = byId(fixtureMeetings(), 'tomorrow1');
    eq([M.onDay(m, '2026-10-12'), M.onDay(m, '2026-10-13')], [false, true]);
});

test('duplicates by start + title merge; the copy with a link is kept', () => {
    const merged = fixtureMeetings();
    const syncs = merged.filter(m => m.start === Date.parse('2026-10-12T14:00:00+03:00'));
    eq(syncs.length, 1);
    eq(syncs[0].eventId, 'copyA');
    eq(syncs[0].link.service, 'zoom');
});

test('duplicates: answerable copy wins, link moves over', () => {
    const base = {iCalUID: 'X', start: 1, end: 2, allDayStart: null, title: 'T', calendarPrimary: false};
    const a = {...base, key: 'a', canRespond: true, link: null};
    const b = {...base, key: 'b', canRespond: false, link: {url: 'https://a.ktalk.ru/1', service: 'ktalk'}};
    const [m] = M.mergeDuplicates([b, a]);
    eq(m.key, 'a');
    eq(m.link.service, 'ktalk');
});

test('untitled meetings at the same time stay apart', () => {
    const base = {iCalUID: null, start: 1, end: 2, allDayStart: null, title: null,
        canRespond: false, link: null, calendarPrimary: false};
    eq(M.mergeDuplicates([{...base, key: 'a'}, {...base, key: 'b'}]).length, 2);
});

test('day helpers in local time', () => {
    eq(M.dayKey(Date.parse('2026-10-12T23:30:00+03:00')), '2026-10-12');
    eq(M.dayKey(Date.parse('2026-10-12T21:30:00Z')), '2026-10-13');
    eq(M.addDays('2026-10-31', 1), '2026-11-01');
    eq(M.dayStart('2026-10-12'), Date.parse('2026-10-12T00:00:00+03:00'));
});

test('meeting rooms booked as resources become the location', () => {
    const base = {
        id: 'room1', status: 'confirmed', summary: 'Hybrid review',
        start: {dateTime: '2026-10-12T11:00:00+03:00'}, end: {dateTime: '2026-10-12T12:00:00+03:00'},
        organizer: {email: 'lead@example.org'},
        attendees: [
            {email: 'alex@example.com', self: true, responseStatus: 'accepted'},
            {email: 'lead@example.org', organizer: true, responseStatus: 'accepted'},
            {email: 'c_1@resource.calendar.google.com', displayName: 'Room 4.12 Baikal', resource: true,
                responseStatus: 'accepted'},
            {email: 'c_2@resource.calendar.google.com', displayName: 'Room 2 (declined)', resource: true,
                responseStatus: 'declined'},
        ],
        hangoutLink: 'https://meet.google.com/abc-defg-hij',
    };
    const opts = {accountId: 'a', calendar: calendar('alex@example.com')};
    const m = M.normalize(base, opts);
    eq(m.location, 'Room 4.12 Baikal');
    eq(m.attendees.map(a => a.email), ['alex@example.com', 'lead@example.org']);
    eq(m.link.service, 'meet');
    // A typed location wins; rooms still do not count as people.
    const typed = M.normalize({...base, location: 'Floor 4'}, opts);
    eq([typed.location, typed.attendees.length], ['Floor 4', 2]);
    // Only a room was invited: no people, so no organizer and no reply.
    const roomOnly = M.normalize({...base, attendees: [base.attendees[2]]}, opts);
    eq([roomOnly.attendees.length, roomOnly.organizer, roomOnly.canRespond], [0, null, false]);
});

await run();
