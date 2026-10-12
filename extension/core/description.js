// Meeting description to Pango markup with link ranges. A small tokenizer
// with a tag whitelist, not a DOM parser.
//
// render(html) returns {text, markup, links, truncated}:
//   text    plain text as shown
//   markup  Pango markup; every piece of text is escaped, only <b>, <i>, <u>
//           and <span> for links are ever produced
//   links   [{start, end, url}] in code points of `text` (Clutter positions
//           are characters, not UTF-16 units)
//   truncated  true when maxLines/maxChars cut the text and '…' was added

import {decodeEntities, cleanUrl} from './links.js';

export function escapeMarkup(s) {
    return s.replace(/[&<>"']/g, c =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
}

const HTML_HINT = /<\/?(p|br|div|ul|ol|li|a|b|i|u|strong|em|span|font)\b[^>]*>/i;
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

class Builder {
    constructor(linkColor) {
        this._linkColor = linkColor;
        this.chunks = [];       // {text, bold, italic, underline, url}
        this.length = 0;        // code points so far
        this.links = [];
        this.tail = '';         // last two characters, for line-break decisions
    }

    append(text, style) {
        if (!text)
            return;
        const len = [...text].length;
        if (style.url) {
            const last = this.links[this.links.length - 1];
            if (last && last.url === style.url && last.end === this.length)
                last.end += len;
            else
                this.links.push({start: this.length, end: this.length + len, url: style.url});
        }
        this.chunks.push({text, ...style});
        this.length += len;
        this.tail = (this.tail + text).slice(-2);
    }

    // Text that may contain bare urls; they become links unless already in one.
    appendText(text, style) {
        if (style.url) {
            this.append(text, style);
            return;
        }
        let pos = 0;
        for (const m of text.matchAll(URL_RE)) {
            const url = cleanUrl(m[0]);
            this.append(text.slice(pos, m.index), style);
            this.append(url, {...style, url});
            pos = m.index + url.length;
        }
        this.append(text.slice(pos), style);
    }

    // Make the output end with `n` newlines (never at the very start).
    breakLines(n) {
        if (this.length === 0)
            return;
        const have = (/\n*$/.exec(this.tail) ?? [''])[0].length;
        if (have < n)
            this.append('\n'.repeat(n - have), {});
    }

    // Drop trailing whitespace and newlines.
    _trimEnd() {
        while (this.chunks.length) {
            const last = this.chunks[this.chunks.length - 1];
            const trimmed = last.text.replace(/\s+$/, '');
            if (trimmed === last.text)
                break;
            const cut = [...last.text].length - [...trimmed].length;
            this.length -= cut;
            if (trimmed) {
                last.text = trimmed;
                break;
            }
            this.chunks.pop();
        }
    }

    // Keep at most maxLines lines and maxChars characters (a preview).
    _cut(maxLines, maxChars) {
        let lines = 1, count = 0;
        for (let i = 0; i < this.chunks.length; i++) {
            const chars = [...this.chunks[i].text];
            for (let j = 0; j < chars.length; j++) {
                if (chars[j] === '\n')
                    lines++;
                if (lines > maxLines || count >= maxChars) {
                    this.chunks[i] = {...this.chunks[i], text: chars.slice(0, j).join('')};
                    this.chunks.length = this.chunks[i].text ? i + 1 : i;
                    this.length = count;
                    return true;
                }
                count++;
            }
        }
        return false;
    }

    finish({maxLines = Infinity, maxChars = Infinity} = {}) {
        this._trimEnd();
        let truncated = false;
        if (this._cut(maxLines, maxChars)) {
            this._trimEnd();
            truncated = true;
        }
        for (const l of this.links)
            l.end = Math.min(l.end, this.length);
        this.links = this.links.filter(l => l.end > l.start);

        const text = this.chunks.map(c => c.text).join('');
        const markup = this.chunks.map(c => {
            let s = escapeMarkup(c.text);
            if (c.url)
                s = `<span foreground="${this._linkColor}" underline="single">${s}</span>`;
            if (c.underline)
                s = `<u>${s}</u>`;
            if (c.italic)
                s = `<i>${s}</i>`;
            if (c.bold)
                s = `<b>${s}</b>`;
            return s;
        }).join('');
        if (truncated)
            return {text: `${text}…`, markup: `${markup}…`, links: this.links, truncated};
        return {text, markup, links: this.links, truncated};
    }
}

function renderPlain(src, b) {
    b.appendText(src.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n'), {});
}

function renderHtml(src, b) {
    const depth = {bold: 0, italic: 0, underline: 0};
    const lists = [];   // {ordered, n}
    let url = null;
    const style = () => ({
        bold: depth.bold > 0, italic: depth.italic > 0, underline: depth.underline > 0, url,
    });

    const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|<|[^<]+/g;
    let m;
    while ((m = TOKEN.exec(src)) !== null) {
        const [tok, closing, rawName, attrs] = m;
        if (rawName === undefined) {
            if (tok.startsWith('<!--'))
                continue;
            // Text (or a stray '<'): collapse whitespace like a browser.
            const text = decodeEntities(tok).replace(/\s+/g, ' ');
            const atLineStart = b.length === 0 || b.tail.endsWith('\n');
            b.appendText(atLineStart ? text.replace(/^ /, '') : text, style());
            continue;
        }

        const name = rawName.toLowerCase();
        if (!closing && (name === 'script' || name === 'style')) {
            // Skip everything up to the closing tag, or the rest when unclosed.
            const end = new RegExp(`</${name}\\s*>`, 'ig');
            end.lastIndex = TOKEN.lastIndex;
            const e = end.exec(src);
            TOKEN.lastIndex = e ? end.lastIndex : src.length;
            continue;
        }

        const delta = closing ? -1 : 1;
        switch (name) {
        case 'b': case 'strong':
            depth.bold = Math.max(0, depth.bold + delta);
            break;
        case 'i': case 'em':
            depth.italic = Math.max(0, depth.italic + delta);
            break;
        case 'u':
            depth.underline = Math.max(0, depth.underline + delta);
            break;
        case 'br':
            if (/\n\n$/.test(b.tail))
                break;
            b.append('\n', {});
            break;
        case 'p': case 'div':
            b.breakLines(1);
            break;
        case 'ul': case 'ol':
            if (closing)
                lists.pop();
            else
                lists.push({ordered: name === 'ol', n: 0});
            b.breakLines(1);
            break;
        case 'li':
            if (!closing) {
                b.breakLines(1);
                const list = lists[lists.length - 1];
                const indent = '  '.repeat(Math.max(0, lists.length - 1));
                const bullet = list?.ordered ? `${++list.n}. ` : '• ';
                b.append(indent + bullet, {});
            }
            break;
        case 'a':
            if (closing) {
                url = null;
            } else {
                const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
                const raw = href ? decodeEntities(href[1] ?? href[2] ?? href[3]).trim() : '';
                url = SAFE_HREF.test(raw) ? raw : null;
            }
            break;
        default:
            // Unknown tags are dropped, their text stays.
            break;
        }
    }
}

export function render(src, {linkColor = '#3584e4', maxLines, maxChars} = {}) {
    const b = new Builder(linkColor);
    if (src) {
        if (HTML_HINT.test(src))
            renderHtml(src, b);
        else
            renderPlain(src, b);
    }
    return b.finish({maxLines, maxChars});
}
