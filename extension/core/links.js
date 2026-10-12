// Finds the video call link of an event: conferenceData, hangoutLink,
// location, then description. Only https links to known services count, so
// a shared document or a client download page is skipped.

const nonRoot = path => path.length > 1;

// id is stable and used by the UI to pick a translated service name.
const SERVICES = [
    {id: 'ktalk', hosts: ['ktalk.ru'], path: nonRoot},
    {id: 'zoom', hosts: ['zoom.us'], path: p => /^\/(j|my|w)\//.test(p)},
    {id: 'meet', hosts: ['meet.google.com'], path: nonRoot, exact: true},
    {id: 'telemost', hosts: ['telemost.yandex.ru', 'telemost.360.yandex.ru'], path: nonRoot, exact: true},
    {id: 'teams', hosts: ['teams.microsoft.com', 'teams.live.com'],
        path: p => /^\/(l\/meetup-join|meet)\//.test(p)},
    {id: 'jitsi', hosts: ['meet.jit.si'], path: nonRoot, exact: true},
];

const ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

export function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X'
                ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code < 0x110000
                ? String.fromCodePoint(code) : m;
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    });
}

const TRAILING = /[.,;:!?)\]}>'"»”’]+$/;

// Strip punctuation that came along from the surrounding sentence.
export function cleanUrl(url) {
    return url.replace(TRAILING, '');
}

function parseUrl(url) {
    const m = /^https:\/\/([^/?#:\s]+)(?::\d+)?([^?#\s]*)/i.exec(url);
    if (!m)
        return null;
    return {host: m[1].toLowerCase(), path: m[2] || '/'};
}

// Service id for a call link, or null when the url is not one.
export function serviceOf(url) {
    const u = parseUrl(url);
    if (!u)
        return null;
    for (const s of SERVICES) {
        const hostOk = s.hosts.some(h =>
            u.host === h || (!s.exact && u.host.endsWith(`.${h}`)));
        if (hostOk && s.path(u.path))
            return s.id;
    }
    return null;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

// All http(s) urls of a plain text, cleaned, in order of appearance.
function urlsInText(text) {
    return [...text.matchAll(URL_RE)].map(m => cleanUrl(m[0]));
}

// All urls of an HTML (or plain) fragment in document order: href attributes
// and urls in the visible text. Tags are blanked out with spaces so that
// positions of text urls stay comparable with positions of tags.
export function urlsInHtml(html) {
    const found = [];
    const blanked = html.replace(/<[^>]*>/g, (tag, pos) => {
        const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        if (href) {
            const raw = decodeEntities(href[1] ?? href[2] ?? href[3]).trim();
            if (/^https?:\/\//i.test(raw))
                found.push({pos, url: cleanUrl(raw)});
        }
        return ' '.repeat(tag.length);
    });
    for (const m of blanked.matchAll(URL_RE))
        found.push({pos: m.index, url: cleanUrl(decodeEntities(m[0]))});
    found.sort((a, b) => a.pos - b.pos);
    return found.map(f => f.url);
}

function firstCallLink(urls) {
    for (const url of urls) {
        const service = serviceOf(url);
        if (service)
            return {url, service};
    }
    return null;
}

// {url, service} or null for a Google Calendar event resource.
export function findCallLink(event) {
    const video = (event.conferenceData?.entryPoints ?? [])
        .filter(p => p.entryPointType === 'video')
        .map(p => p.uri ?? '');
    const link = firstCallLink([...video, event.hangoutLink ?? '']);
    if (link)
        return link;

    if (event.location) {
        const inLocation = firstCallLink(urlsInText(decodeEntities(event.location)));
        if (inLocation)
            return inLocation;
    }

    if (event.description)
        return firstCallLink(urlsInHtml(event.description));

    return null;
}
