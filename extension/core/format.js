// Human-readable times. Translations come in as `t` ({_(s), formatDate(key)})
// so that tests can pass identity stubs.

const MIN = 60 * 1000;

// printf-like substitution of %s and %d, in order.
export function fmt(template, ...args) {
    let i = 0;
    return template.replace(/%[sd]/g, () => String(args[i++]));
}

// Whole minutes from `from` to `to`, rounded up: 30 s ahead is 1 min.
export function minutesUntil(to, from) {
    return Math.max(0, Math.ceil((to - from) / MIN));
}

// '45 min', '1 h', '1 h 20 min'.
export function duration(minutes, t) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0)
        return fmt(t._('%d min'), m);
    if (m === 0)
        return fmt(t._('%d h'), h);
    return fmt(t._('%d h %d min'), h, m);
}

export function untilLabel(start, now, t) {
    return fmt(t._('in %s'), duration(minutesUntil(start, now), t));
}

export function leftLabel(end, now, t) {
    return fmt(t._('%s left'), duration(minutesUntil(end, now), t));
}

// Shorten to at most `max` characters, the ellipsis included.
export function truncate(text, max = 24) {
    const chars = [...(text ?? '')];
    if (chars.length <= max)
        return chars.join('');
    return `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

const pad = n => String(n).padStart(2, '0');

export function clock(ms) {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function timeRange(start, end) {
    return `${clock(start)}–${clock(end)}`;
}

// 'Today', 'Tomorrow', 'Yesterday' or a localized date for other days.
// `key` and `today` are 'YYYY-MM-DD'; addDays comes from core/meetings.js.
export function dayTitle(key, today, addDays, t) {
    if (key === today)
        return t._('Today');
    if (key === addDays(today, 1))
        return t._('Tomorrow');
    if (key === addDays(today, -1))
        return t._('Yesterday');
    return t.formatDate(key);
}
