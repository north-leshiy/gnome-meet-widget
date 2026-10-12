import GLib from 'gi://GLib';
import {test, eq, ok, run} from './lib/assert.js';
import {fixture} from './lib/fixtures.js';
import {render, escapeMarkup} from '../extension/core/description.js';

const cal = fixture('calendar.json');
const ev = id => Object.values(cal.events).flat().find(e => e.id === id);
const linkTexts = r => r.links.map(l => [...r.text].slice(l.start, l.end).join(''));

test('agenda list and a captioned link', () => {
    const r = render(ev('copyA').description);
    eq(r.text, 'Agenda:\n• status\n• risks\nLink: join the call.');
    eq(r.links.map(l => l.url), ['https://us06web.zoom.us/j/123?pwd=a&from=addon']);
    eq(linkTexts(r), ['join the call']);
    ok(r.markup.includes('underline="single">join the call</span>'));
});

test('plain text keeps newlines and links bare urls', () => {
    const r = render('Line one\nПодключайтесь: https://team.ktalk.ru/xyz.\n\n\n\nEnd');
    eq(r.text, 'Line one\nПодключайтесь: https://team.ktalk.ru/xyz.\n\nEnd');
    eq(linkTexts(r), ['https://team.ktalk.ru/xyz']);
});

test('script and style are removed with their content', () => {
    const r = render('<p>Hi</p><script>alert("x")</script><style>p{color:red}</style><b>there');
    eq(r.text, 'Hi\nthere');
    ok(!r.markup.includes('alert'));
    ok(!r.markup.includes('color'));
});

test('unclosed tags and an unclosed script do not break anything', () => {
    eq(render('<b>bold <i>both').text, 'bold both');
    eq(render('<p>before<script>never closed').text, 'before');
    eq(render('<p>a < b and <unknown attr="1">c</unknown>').text, 'a < b and c');
});

test('handlers and javascript: never become links', () => {
    const r = render('<a href="javascript:alert(1)" onclick="x()">click</a> <a href=\'https://ok.org/\'>ok</a>');
    eq(r.links.map(l => l.url), ['https://ok.org/']);
    ok(!r.markup.includes('onclick'));
    ok(!r.markup.includes('javascript'));
});

test('everything is escaped', () => {
    const r = render('<p>Tom &amp; Jerry &lt;3 "quotes" \'single\'</p>');
    eq(r.text, 'Tom & Jerry <3 "quotes" \'single\'');
    eq(r.markup, escapeMarkup(r.text));
    eq(escapeMarkup(r.text), GLib.markup_escape_text(r.text, -1));
});

test('markup is valid Pango', () => {
    for (const id of ['copyA', 'invite1', 'parallel1']) {
        const r = render(ev(id).description);
        // Throws on invalid markup.
        imports.gi.Pango.parse_markup(r.markup, -1, '\0');
    }
});

test('link ranges count code points', () => {
    const r = render('🙂 https://a.ktalk.ru/1');
    eq(r.links, [{start: 2, end: 22, url: 'https://a.ktalk.ru/1'}]);
});

test('ordered and nested lists, br and empty input', () => {
    eq(render('<ol><li>one</li><li>two<ul><li>sub</li></ul></li></ol>').text, '1. one\n2. two\n  • sub');
    eq(render('a<br>b<br><br><br>c').text, 'a\nb\n\nc');
    eq(render(null), {text: '', markup: '', links: [], truncated: false});
});

test('preview: cut by lines with an ellipsis, links clamped', () => {
    const html = '<p>one</p><p>two <a href="https://x.example/long">a link here</a></p><p>three</p><p>four</p>';
    const r = render(html, {maxLines: 2});
    eq(r.text, 'one\ntwo a link here…');
    eq(r.truncated, true);
    eq(r.links, [{start: 8, end: 19, url: 'https://x.example/long'}]);
    imports.gi.Pango.parse_markup(r.markup, -1, '\0');
});

test('preview: cut by characters inside a bold run', () => {
    const r = render('<b>abcdefghij</b> tail', {maxChars: 4});
    eq(r.text, 'abcd…');
    eq(r.markup, '<b>abcd</b>…');
});

test('preview: short text is not truncated', () => {
    const r = render('<p>one</p><p>two</p>', {maxLines: 4, maxChars: 200});
    eq([r.text, r.truncated], ['one\ntwo', false]);
});

await run();
