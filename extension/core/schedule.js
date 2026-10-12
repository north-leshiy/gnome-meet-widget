// What the top bar shows and how a day of the agenda is laid out.

import {isAllDay, onDay, dayKey, addDays} from './meetings.js';
import {fmt, truncate, untilLabel, leftLabel, duration, minutesUntil, clock} from './format.js';

const MIN = 60 * 1000;

// Event types that are not meetings one joins.
const NOT_MEETINGS = new Set(['workingLocation', 'outOfOffice', 'focusTime', 'birthday']);

// Highlight stays this long after the start: people join a bit late.
const HIGHLIGHT_AFTER_START = 5 * MIN;
// The first minute after the start reads 'now'.
const STARTING = MIN;
// The agenda shows Join from this long before the start until the end.
const JOIN_BEFORE = 30 * MIN;
// Shorter gaps between meetings are not shown as free time.
const FREE_MIN = 15 * MIN;

export function countsForPanel(m) {
    return !isAllDay(m) && m.selfResponse !== 'declined' && !NOT_MEETINGS.has(m.eventType);
}

// Same start: the one with a call link first, then by title.
function byStartThenLink(a, b) {
    return a.start - b.start ||
        Number(b.link !== null) - Number(a.link !== null) ||
        (a.title ?? '').localeCompare(b.title ?? '');
}

function byEndThenLink(a, b) {
    return a.end - b.end ||
        Number(b.link !== null) - Number(a.link !== null) ||
        (a.title ?? '').localeCompare(b.title ?? '');
}

// State of the top bar button.
//   kind: 'error' | 'none' | 'upcoming' | 'starting' | 'current'
//   meeting: the meeting the label is about (null for none/error)
//   highlight: accent the button
//   running: a meeting is going on (clock icon); current: that meeting
//   next: the nearest future meeting, beyond the horizon too
//   freeUntil: start of the next meeting today when nothing runs, else null
// opts: {horizonMin, highlightMin, error}
export function panelState(meetings, now, {horizonMin, highlightMin, error = null}) {
    if (error)
        return {kind: 'error', meeting: null, highlight: false, running: false, current: null, next: null,
            freeUntil: null, error};

    const relevant = meetings.filter(countsForPanel);
    const upcoming = relevant.filter(m => m.start > now).sort(byStartThenLink);
    const current = relevant.filter(m => m.start <= now && now < m.end).sort(byEndThenLink);

    const next = upcoming[0] ?? null;
    const running = current.length > 0;
    const freeUntil = !running && next && dayKey(next.start) === dayKey(now) ? next.start : null;
    const base = {running, current: current[0] ?? null, next, freeUntil};

    if (next && next.start - now < highlightMin * MIN)
        return {...base, kind: 'upcoming', meeting: next, highlight: true};

    if (running) {
        const m = current[0];
        const since = now - m.start;
        return {
            ...base,
            kind: since < STARTING ? 'starting' : 'current',
            meeting: m,
            highlight: since < HIGHLIGHT_AFTER_START,
        };
    }

    if (next && next.start - now <= horizonMin * MIN)
        return {...base, kind: 'upcoming', meeting: next, highlight: false};

    return {...base, kind: 'none', meeting: null, highlight: false};
}

// 'at 16:30' today, 'tomorrow 09:30', null for later days (not loaded anyway).
function laterLabel(m, now, t) {
    const day = dayKey(m.start);
    if (day === dayKey(now))
        return fmt(t._('at %s'), clock(m.start));
    if (day === addDays(dayKey(now), 1))
        return fmt(t._('tomorrow %s'), clock(m.start));
    return null;
}

function smartLabel(state, now, t, showTitle) {
    let time, m = state.meeting;
    switch (state.kind) {
    case 'upcoming':
        time = untilLabel(m.start, now, t);
        break;
    case 'starting':
        time = t._('now');
        break;
    case 'current':
        time = leftLabel(m.end, now, t);
        break;
    default:
        m = state.next;
        time = m && laterLabel(m, now, t);
        if (!time)
            return null;
    }
    if (!showTitle)
        return time;
    return fmt(t._('%s · %s'), truncate(m.title ?? t._('(No title)')), time);
}

function countdownLabel(state, now, t) {
    if (state.kind === 'starting')
        return t._('now');
    const next = state.next;
    if (next && dayKey(next.start) === dayKey(now))
        return duration(minutesUntil(next.start, now), t);
    if (state.kind === 'current')
        return leftLabel(state.meeting.end, now, t);
    return next ? laterLabel(next, now, t) : null;
}

function statusLabel(state, now, t) {
    if (state.kind === 'current' || state.kind === 'starting')
        return fmt(t._('Now · %s'), leftLabel(state.meeting.end, now, t));
    if (state.kind === 'upcoming' && state.highlight)
        return fmt(t._('In %s'), duration(minutesUntil(state.meeting.start, now), t));
    if (state.freeUntil !== null)
        return fmt(t._('Free %s'), duration(minutesUntil(state.freeUntil, now), t));
    return null;
}

// Text next to the icon, or null for the icon alone.
// mode: 'smart' | 'countdown' | 'status'; showTitle applies to smart only.
export function panelLabel(state, now, t, {mode = 'smart', showTitle = true} = {}) {
    if (state.kind === 'error')
        return null;
    switch (mode) {
    case 'countdown':
        return countdownLabel(state, now, t);
    case 'status':
        return statusLabel(state, now, t);
    default:
        return smartLabel(state, now, t, showTitle);
    }
}

// Invitations awaiting a reply that are not over yet.
export function pendingInvitations(meetings, now) {
    const today = dayKey(now);
    return meetings.filter(m => m.canRespond && m.selfResponse === 'needsAction' &&
        (isAllDay(m) ? m.allDayEnd > today : m.end > now)).length;
}

// Meetings Ctrl+Alt+J can join: running ones first, then those that start
// within JOIN_BEFORE.
export function joinCandidates(meetings, now) {
    const ok = meetings.filter(m => m.link && !isAllDay(m) && m.selfResponse !== 'declined' &&
        now >= m.start - JOIN_BEFORE && now < m.end);
    const running = ok.filter(m => m.start <= now).sort(byEndThenLink);
    const soon = ok.filter(m => m.start > now).sort(byStartThenLink);
    return [...running, ...soon];
}

export function panelTooltip(state, now, t, invitations = 0) {
    if (state.kind === 'error')
        return null;
    const lines = [];
    const title = m => m.title ?? t._('(No title)');
    // The running one even when the label already counts down to the next.
    if (state.current)
        lines.push(fmt(t._('Now: %s until %s'), title(state.current), clock(state.current.end)));
    const next = state.next;
    if (next) {
        const day = dayKey(next.start);
        if (day === dayKey(now))
            lines.push(fmt(t._('Next at %s: %s'), clock(next.start), title(next)));
        else if (day === addDays(dayKey(now), 1))
            lines.push(fmt(t._('Next tomorrow at %s: %s'), clock(next.start), title(next)));
    }
    if (!lines.length)
        lines.push(t._('No more meetings'));
    if (invitations > 0)
        lines.push(fmt(t._('Invitations awaiting reply: %d'), invitations));
    return lines.join('\n');
}

// Connected runs of overlapping meetings; returns a group number per meeting
// (index in `sorted`), null for meetings that overlap nothing.
function parallelGroups(sorted) {
    const groups = new Array(sorted.length).fill(null);
    let runStart = 0;
    let runEnd = -Infinity;
    let next = 0;
    const close = end => {
        if (end - runStart > 1) {
            for (let i = runStart; i < end; i++)
                groups[i] = next;
            next++;
        }
    };
    sorted.forEach((m, i) => {
        // Back-to-back meetings (end == next start) do not overlap.
        if (m.start >= runEnd) {
            close(i);
            runStart = i;
            runEnd = m.end;
        } else {
            runEnd = Math.max(runEnd, m.end);
        }
    });
    close(sorted.length);
    return groups;
}

// Gaps of at least FREE_MIN between the meetings that take time; each slot is
// drawn before the first row that starts at or after it.
function freeSlots(rows, now) {
    const busy = rows.filter(r => !r.declined && countsForPanel(r.meeting)).map(r => r.meeting);
    const slots = [];
    let end = null;
    for (const m of busy) {
        if (end !== null && m.start - end >= FREE_MIN) {
            const start = end;
            slots.push({
                start,
                end: m.start,
                beforeIndex: rows.findIndex(r => r.meeting.start >= start),
                past: m.start <= now,
                current: start <= now && now < m.start,
            });
        }
        end = end === null ? m.end : Math.max(end, m.end);
    }
    return slots;
}

// One day of the agenda.
//   allDay: all-day events of the day
//   rows: timed meetings with their display flags
//   nowIndex: first row that is not over yet; null on other days
//   free: gaps between meetings
export function agendaDay(meetings, key, now) {
    const day = meetings.filter(m => onDay(m, key));

    const allDay = day.filter(isAllDay)
        .sort((a, b) => a.allDayStart.localeCompare(b.allDayStart) ||
            (a.title ?? '').localeCompare(b.title ?? ''))
        .map(m => ({meeting: m, declined: m.selfResponse === 'declined'}));

    const timed = day.filter(m => !isAllDay(m) && m.eventType !== 'workingLocation')
        .sort((a, b) => a.start - b.start || a.end - b.end ||
            (a.title ?? '').localeCompare(b.title ?? ''));
    const groups = parallelGroups(timed);

    const rows = timed.map((m, i) => ({
        meeting: m,
        past: m.end <= now,
        current: m.start <= now && now < m.end,
        declined: m.selfResponse === 'declined',
        needsReply: m.canRespond && m.selfResponse === 'needsAction',
        joinable: m.link !== null && now >= m.start - JOIN_BEFORE && now < m.end,
        parallel: groups[i],
    }));

    let nowIndex = null;
    if (key === dayKey(now)) {
        nowIndex = rows.findIndex(r => r.meeting.end > now);
        if (nowIndex === -1)
            nowIndex = rows.length;
    }

    return {allDay, rows, nowIndex, free: freeSlots(rows, now)};
}
