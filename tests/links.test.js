import {test, eq, run} from './lib/assert.js';
import {fixture} from './lib/fixtures.js';
import * as L from '../extension/core/links.js';

const cal = fixture('calendar.json');
const ev = id => Object.values(cal.events).flat().find(e => e.id === id);

test('Meet from conferenceData wins over Zoom in the description', () => {
    eq(L.findCallLink(ev('invite1')), {url: 'https://meet.google.com/abc-defg-hij', service: 'meet'});
});

test('ktalk in location', () => {
    eq(L.findCallLink(ev('weekly_20261012T090000Z')), {url: 'https://team.ktalk.ru/weekly', service: 'ktalk'});
    eq(L.findCallLink({location: 'https://webpractik.ktalk.ru/abc123'}),
        {url: 'https://webpractik.ktalk.ru/abc123', service: 'ktalk'});
});

test('Zoom only in an HTML href, &amp; decoded, query kept', () => {
    eq(L.findCallLink(ev('copyA')), {url: 'https://us06web.zoom.us/j/123?pwd=a&from=addon', service: 'zoom'});
});

test('trailing sentence dot is stripped', () => {
    eq(L.findCallLink(ev('parallel1')), {url: 'https://team.ktalk.ru/xyz', service: 'ktalk'});
});

test('document link and zoom download page are not calls', () => {
    eq(L.findCallLink(ev('copyB')), null);
    eq(L.findCallLink(ev('tomorrow1')), null);
    eq(L.findCallLink({description: 'https://zoom.us/download'}), null);
});

test('room name without a link', () => {
    eq(L.findCallLink(ev('own1')), null);
});

test('service dictionary', () => {
    eq(L.serviceOf('https://ontico.ktalk.ru/room'), 'ktalk');
    eq(L.serviceOf('https://ktalk.ru/'), null);
    eq(L.serviceOf('https://evil-ktalk.ru/x'), null);
    eq(L.serviceOf('https://ktalk.ru.evil.com/x'), null);
    eq(L.serviceOf('http://team.ktalk.ru/x'), null);
    eq(L.serviceOf('https://zoom.us/my/alex'), 'zoom');
    eq(L.serviceOf('https://company.zoom.us/w/123'), 'zoom');
    eq(L.serviceOf('https://zoom.us/pricing'), null);
    eq(L.serviceOf('https://telemost.yandex.ru/j/1'), 'telemost');
    eq(L.serviceOf('https://telemost.360.yandex.ru/j/1'), 'telemost');
    eq(L.serviceOf('https://teams.microsoft.com/l/meetup-join/19%3a'), 'teams');
    eq(L.serviceOf('https://teams.microsoft.com/downloads'), null);
    eq(L.serviceOf('https://meet.jit.si/room'), 'jitsi');
    eq(L.serviceOf('https://docs.google.com/document/d/x'), null);
});

test('location field order: location before description', () => {
    eq(L.findCallLink({location: 'https://a.ktalk.ru/1', description: 'https://zoom.us/j/2'}).service, 'ktalk');
});

test('url cleanup', () => {
    eq(L.cleanUrl('https://a.ktalk.ru/x).'), 'https://a.ktalk.ru/x');
    eq(L.cleanUrl('https://zoom.us/j/1?pwd=a&b=c'), 'https://zoom.us/j/1?pwd=a&b=c');
    eq(L.decodeEntities('a&amp;b&#39;&#x41;&unknown;'), "a&b'A&unknown;");
});

test('href and text urls keep document order', () => {
    eq(L.urlsInHtml('see https://x.org/1 then <a href="https://y.org/2">y</a>'),
        ['https://x.org/1', 'https://y.org/2']);
    eq(L.urlsInHtml('<a href="javascript:alert(1)">x</a>'), []);
});

await run();
