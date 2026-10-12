import {test, eq, run} from './lib/assert.js';
import {at} from './lib/fixtures.js';
import {fixtureMeetings} from './lib/meetings.js';
import * as S from '../extension/core/schedule.js';

const t = {_: s => s};
const opts = {horizonMin: 180, highlightMin: 5};
const mk = (title, from, to, extra = {}) => ({
    key: title, title, start: at(from), end: at(to), allDayStart: null, allDayEnd: null,
    eventType: 'default', selfResponse: null, canRespond: false, link: null, ...extra,
});
const label = (ms, now, o = opts, l = {}) => S.panelLabel(S.panelState(ms, now, o), now, t, l);

test('declined meeting is skipped', () => {
    const ms = [mk('A', '10:10', '10:30', {selfResponse: 'declined'}), mk('B', '10:40', '11:00')];
    eq(label(ms, at('10:00')), 'B · in 40 min');
});

test('all-day only: nothing on the panel', () => {
    const vacation = {...mk('Vacation', '00:00', '00:00'), start: null, end: null,
        allDayStart: '2026-10-12', allDayEnd: '2026-10-13'};
    eq(S.panelState([vacation], at('10:00'), opts).kind, 'none');
});

test('meeting in an hour and a half', () => {
    eq(label([mk('Planning', '11:25', '12:00')], at('10:00')), 'Planning · in 1 h 25 min');
});

test('running meeting shows time left', () => {
    eq(label([mk('Sync', '09:30', '10:20')], at('10:00')), 'Sync · 20 min left');
});

test('title hidden for screen sharing', () => {
    eq(label([mk('Sync', '10:12', '11:00')], at('10:00'), opts, {showTitle: false}), 'in 12 min');
});

test('beyond the horizon: the start time instead of a countdown', () => {
    const st = S.panelState([mk('Late', '15:00', '16:00')], at('10:00'), opts);
    eq([st.kind, S.panelLabel(st, at('10:00'), t)], ['none', 'Late · at 15:00']);
});

test('back to back: the next one takes over inside the highlight window', () => {
    const ms = [mk('A', '11:00', '12:00'), mk('B', '12:00', '13:00')];
    const st = S.panelState(ms, at('11:57'), opts);
    eq([st.meeting.title, st.highlight], ['B', true]);
    eq(label(ms, at('11:57')), 'B · in 3 min');
});

test('parallel meetings: the one ending first', () => {
    const ms = [mk('B', '10:00', '12:00'), mk('A', '10:15', '11:30')];
    eq(label(ms, at('10:40')), 'A · 50 min left');
});

test('same start: the one with a call link', () => {
    const ms = [mk('Plain', '11:00', '12:00'),
        mk('Call', '11:00', '12:00', {link: {url: 'https://a.ktalk.ru/1', service: 'ktalk'}})];
    eq(S.panelState(ms, at('10:30'), opts).meeting.title, 'Call');
});

test('highlight window: 4 min before yes, 6 min after no, first minute is now', () => {
    const ms = [mk('M', '10:00', '11:00')];
    eq(S.panelState(ms, at('09:56'), opts).highlight, true);
    eq(S.panelState(ms, at('09:54'), opts).highlight, false);
    eq(S.panelState(ms, at('10:03'), opts).highlight, true);
    eq(S.panelState(ms, at('10:06'), opts).highlight, false);
    eq(label(ms, at('10:00') + 30 * 1000), 'M · now');
    eq(label(ms, at('10:06')), 'M · 54 min left');
});

test('error state wins', () => {
    eq(S.panelState([mk('M', '10:10', '11:00')], at('10:00'), {...opts, error: 'no-account'}).kind, 'error');
});

test('working location and birthdays do not count', () => {
    const ms = [mk('Office', '09:00', '18:00', {eventType: 'workingLocation'})];
    eq(S.panelState(ms, at('10:00'), opts).kind, 'none');
});

const TOMORROW = '2026-10-13';
const modeLabel = (ms, now, mode, l = {}) => label(ms, now, opts, {mode, ...l});

test('smart: nothing in the horizon, a meeting later today', () => {
    eq(modeLabel([mk('Late', '16:30', '17:00')], at('10:00'), 'smart'), 'Late · at 16:30');
    eq(modeLabel([mk('Late', '16:30', '17:00')], at('10:00'), 'smart', {showTitle: false}), 'at 16:30');
});

test('smart: the next meeting is tomorrow', () => {
    const ms = [mk('Early', '09:30', '10:00', {start: at('09:30', TOMORROW), end: at('10:00', TOMORROW)})];
    eq(modeLabel(ms, at('18:00'), 'smart', {showTitle: false}), 'tomorrow 09:30');
});

test('smart: past meetings only, icon only', () => {
    eq(modeLabel([mk('Done', '08:00', '09:00')], at('10:00'), 'smart'), null);
});

test('countdown: time to the next start, no title', () => {
    eq(modeLabel([mk('Late', '13:10', '14:00')], at('10:00'), 'countdown'), '3 h 10 min');
    eq(modeLabel([mk('Soon', '10:05', '11:00')], at('10:00'), 'countdown'), '5 min');
    const ms = [mk('Early', '09:30', '10:00', {start: at('09:30', TOMORROW), end: at('10:00', TOMORROW)})];
    eq(modeLabel(ms, at('18:00'), 'countdown'), 'tomorrow 09:30');
});

test('countdown: during the last meeting of the day, time left', () => {
    eq(modeLabel([mk('Last', '17:00', '18:00')], at('17:35'), 'countdown'), '25 min left');
    // With another meeting later today the countdown goes to it.
    eq(modeLabel([mk('Now', '17:00', '18:00'), mk('Next', '19:00', '19:30')], at('17:35'), 'countdown'),
        '1 h 25 min');
});

test('status: free, now, in', () => {
    eq(modeLabel([mk('Noon', '12:00', '12:30')], at('11:20'), 'status'), 'Free 40 min');
    eq(modeLabel([mk('Sync', '11:00', '12:00')], at('11:35'), 'status'), 'Now · 25 min left');
    eq(modeLabel([mk('Sync', '11:00', '12:00')], at('10:57'), 'status'), 'In 3 min');
    eq(modeLabel([mk('Done', '08:00', '09:00')], at('10:00'), 'status'), null);
});

test('state: current flag for the clock icon', () => {
    eq(S.panelState([mk('Sync', '11:00', '12:00')], at('11:35'), opts).running, true);
    eq(S.panelState([mk('Sync', '11:00', '12:00')], at('10:35'), opts).running, false);
});

test('pending invitations: not over, needs action only', () => {
    const inv = extra => ({canRespond: true, selfResponse: 'needsAction', ...extra});
    const ms = [
        mk('A', '12:00', '13:00', inv()),
        mk('B', '09:00', '09:30', inv()),
        mk('C', '15:00', '16:00', inv({selfResponse: 'accepted'})),
        mk('D', '10:00', '11:00', inv({start: at('10:00', TOMORROW), end: at('11:00', TOMORROW)})),
        mk('E', '14:00', '15:00', {canRespond: false, selfResponse: 'needsAction'}),
    ];
    eq(S.pendingInvitations(ms, at('10:00')), 2);
});

test('join candidates: running first, then upcoming within 30 min', () => {
    const link = {link: {url: 'https://a.ktalk.ru/1', service: 'ktalk'}};
    const ms = [
        mk('Later', '10:25', '11:00', link),
        mk('Running', '09:30', '10:30', link),
        mk('Far', '12:00', '13:00', link),
        mk('NoLink', '10:00', '10:30'),
        mk('Declined', '10:05', '10:30', {...link, selfResponse: 'declined'}),
    ];
    eq(S.joinCandidates(ms, at('10:00')).map(m => m.title), ['Running', 'Later']);
    eq(S.joinCandidates(ms, at('11:30')).map(m => m.title), ['Far']);
    eq(S.joinCandidates(ms, at('13:30')), []);
});

test('tooltip: now, next and invitations', () => {
    const ms = [mk('Sync', '11:00', '12:00'), mk('Review', '13:00', '14:00')];
    const tip = (now, n = 0) => S.panelTooltip(S.panelState(ms, now, opts), now, t, n);
    eq(tip(at('11:30'), 2), 'Now: Sync until 12:00\nNext at 13:00: Review\nInvitations awaiting reply: 2');
    eq(tip(at('10:00')), 'Next at 11:00: Sync');
    eq(tip(at('15:00')), 'No more meetings');
    // Back to back: the label counts down to Review, the tooltip names both.
    const b2b = [mk('Sync', '11:00', '12:00'), mk('Review', '12:00', '13:00')];
    eq(S.panelTooltip(S.panelState(b2b, at('11:57'), opts), at('11:57'), t, 0),
        'Now: Sync until 12:00\nNext at 12:00: Review');
    const tomorrow = [mk('Early', '09:30', '10:00', {start: at('09:30', TOMORROW), end: at('10:00', TOMORROW)})];
    eq(S.panelTooltip(S.panelState(tomorrow, at('18:00'), opts), at('18:00'), t, 0), 'Next tomorrow at 09:30: Early');
});

test('agenda of the fixture day at 13:10', () => {
    const day = S.agendaDay(fixtureMeetings(), '2026-10-12', at('13:10'));
    // Birthdays that Google puts into the primary calendar stay in the all-day strip.
    eq(day.allDay.map(r => r.meeting.title), ['Business trip', "Someone's birthday"]);
    eq(day.rows.map(r => r.meeting.title),
        ['Architecture review', 'Parallel call', 'Weekly sync', 'Project sync', 'Optional demo',
            'Planning with the team']);
    const flags = k => day.rows.map(r => r[k]);
    eq(flags('past'), [true, true, true, false, false, false]);
    eq(flags('declined'), [false, false, false, false, true, false]);
    eq(flags('needsReply'), [true, false, false, false, false, false]);
    // Review 11:00–12:00, parallel 11:30–12:15, weekly 12:00–12:30 chain together.
    eq(flags('parallel'), [0, 0, 0, null, null, null]);
    // Project sync at 14:00 is 50 min away: no Join yet.
    eq(flags('joinable'), [false, false, false, false, false, false]);
    eq(day.nowIndex, 3);
});

test('agenda: current meeting and now line', () => {
    const day = S.agendaDay(fixtureMeetings(), '2026-10-12', at('14:10'));
    eq(day.rows.findIndex(r => r.current), 3);
    eq(day.nowIndex, 3);
});

test('agenda: join button from 30 min before the start until the end', () => {
    const ms = [mk('Z', '12:00', '13:00', {link: {url: 'https://zoom.us/j/1', service: 'zoom'}})];
    const j = now => S.agendaDay(ms, '2026-10-12', now).rows[0].joinable;
    eq([j(at('11:29')), j(at('11:30')), j(at('12:59')), j(at('13:00'))], [false, true, true, false]);
});

test('agenda: other days have no now line, trip spans days', () => {
    const day = S.agendaDay(fixtureMeetings(), '2026-10-13', at('13:10'));
    eq(day.nowIndex, null);
    eq(day.allDay.map(r => r.meeting.title), ['Business trip']);
    eq(day.rows.map(r => r.meeting.title), ['Standup']);
});

test('agenda: free slots between meetings, declined ones do not take time', () => {
    const day = S.agendaDay(fixtureMeetings(), '2026-10-12', at('13:10'));
    const slots = day.free.map(f => [new Date(f.start).toTimeString().slice(0, 5),
        new Date(f.end).toTimeString().slice(0, 5), f.beforeIndex, f.past, f.current]);
    // 12:30–14:00 after the parallel chain; 14:45–16:00 spans the declined demo
    // and is drawn before it, in start order.
    eq(slots, [['12:30', '14:00', 3, false, true], ['14:45', '16:00', 4, false, false]]);
});

test('agenda: short gaps and edges of the day are not free slots', () => {
    const ms = [mk('A', '10:00', '11:00'), mk('B', '11:10', '12:00'), mk('C', '12:15', '13:00')];
    const day = S.agendaDay(ms, '2026-10-12', at('09:00'));
    eq(day.free.map(f => f.beforeIndex), [2]);
    eq(S.agendaDay(ms, '2026-10-12', at('12:20')).free[0].past, true);
});

test('agenda: empty day', () => {
    eq(S.agendaDay(fixtureMeetings(), '2026-10-17', at('13:10')).rows, []);
});

test('back-to-back is not parallel', () => {
    const day = S.agendaDay([mk('A', '10:00', '11:00'), mk('B', '11:00', '12:00')], '2026-10-12', at('09:00'));
    eq(day.rows.map(r => r.parallel), [null, null]);
});

await run();
