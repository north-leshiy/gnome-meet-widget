import {test, eq, run} from './lib/assert.js';
import {at} from './lib/fixtures.js';
import * as R from '../extension/core/reminders.js';

const mk = (title, from, to, extra = {}) => ({
    key: `k/${title}`, title, start: at(from), end: at(to), allDayStart: null,
    eventType: 'default', selfResponse: null, canRespond: false, link: null, ...extra,
});
const none = new Map();
const titles = groups => groups.map(g => g.meetings.map(m => m.title));

test('two minutes before', () => {
    const ms = [mk('Sync', '10:00', '10:30')];
    eq(titles(R.dueReminders(ms, at('09:57'), 2, none)), []);
    eq(titles(R.dueReminders(ms, at('09:58'), 2, none)), [['Sync']]);
});

test('added right before the start: fires at once', () => {
    const ms = [mk('Late add', '15:00', '15:30')];
    eq(titles(R.dueReminders(ms, at('14:59') + 30 * 1000, 2, none)), [['Late add']]);
});

test('started meetings and declined ones never fire', () => {
    eq(titles(R.dueReminders([mk('Started', '10:00', '11:00')], at('10:00'), 2, none)), []);
    eq(titles(R.dueReminders([mk('No', '10:01', '11:00', {selfResponse: 'declined'})], at('10:00'), 2, none)), []);
});

test('disabled with 0 minutes', () => {
    eq(R.dueReminders([mk('Sync', '10:01', '10:30')], at('10:00'), 0, none), []);
});

test('fires once; a moved meeting fires again', () => {
    const m = mk('Sync', '10:00', '10:30');
    const reminded = new Map([[R.reminderKey(m), at('09:58')]]);
    eq(titles(R.dueReminders([m], at('09:59'), 2, reminded)), []);
    const moved = {...m, start: at('10:30'), end: at('11:00')};
    eq(titles(R.dueReminders([moved], at('10:28'), 2, reminded)), [['Sync']]);
});

test('meetings starting in the same minute share one reminder', () => {
    const ms = [mk('B', '12:00', '13:00'), mk('A', '12:00', '12:30'), mk('C', '12:01', '12:30')];
    eq(titles(R.dueReminders(ms, at('11:59'), 2, none)), [['A', 'B'], ['C']]);
});

test('withdraw: ended, declined, moved or vanished', () => {
    const m = mk('Sync', '10:00', '10:30');
    const key = R.reminderKey(m);
    eq(R.stillRelevant(key, [m], at('10:10')), true);
    eq(R.stillRelevant(key, [m], at('10:30')), false);
    eq(R.stillRelevant(key, [{...m, selfResponse: 'declined'}], at('10:10')), false);
    eq(R.stillRelevant(key, [{...m, start: at('11:00'), end: at('11:30')}], at('10:10')), false);
    eq(R.stillRelevant(key, [], at('10:10')), false);
});

test('reminded keys older than a day are pruned', () => {
    const r = new Map([['old', at('09:00', '2026-10-10')], ['new', at('09:00')]]);
    eq([...R.pruneReminded(r, at('10:00')).keys()], ['new']);
});

await run();
