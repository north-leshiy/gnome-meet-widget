import {test, eq, run} from './lib/assert.js';
import {at} from './lib/fixtures.js';
import * as F from '../extension/core/format.js';
import {addDays} from '../extension/core/meetings.js';

const t = {_: s => s, formatDate: key => `date:${key}`};

test('minutes are rounded up', () => {
    eq(F.untilLabel(at('10:00'), at('10:00') - 30 * 1000, t), 'in 1 min');
    eq(F.untilLabel(at('10:00'), at('09:47'), t), 'in 13 min');
    eq(F.untilLabel(at('10:00'), at('09:59') + 1, t), 'in 1 min');
});

test('hours and minutes', () => {
    eq(F.untilLabel(at('11:00'), at('10:00'), t), 'in 1 h');
    eq(F.untilLabel(at('11:25'), at('10:00'), t), 'in 1 h 25 min');
    eq(F.leftLabel(at('10:20'), at('10:00'), t), '20 min left');
});

test('fmt fills %s and %d in order', () => {
    eq(F.fmt('%d h %d min', 1, 5), '1 h 5 min');
});

test('title is cut to 24 chars including the ellipsis', () => {
    eq(F.truncate('Short'), 'Short');
    eq(F.truncate('a'.repeat(24)), 'a'.repeat(24));
    const long = F.truncate('Квартальное планирование продуктовой команды');
    eq([...long].length <= 24, true);
    eq(long.endsWith('…'), true);
});

test('clock and range in local time', () => {
    eq(F.timeRange(at('09:05'), at('10:30')), '09:05–10:30');
});

test('day titles', () => {
    const today = '2026-10-12';
    eq(['2026-10-12', '2026-10-13', '2026-10-11', '2026-10-20'].map(k => F.dayTitle(k, today, addDays, t)),
        ['Today', 'Tomorrow', 'Yesterday', 'date:2026-10-20']);
});

await run();
