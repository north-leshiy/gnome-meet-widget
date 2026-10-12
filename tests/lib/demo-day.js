// Evaluated inside the nested devkit Shell by tests/screenshots.sh.
// Defines globalThis.__demo(nextInMin): freezes the store and fills it with a
// synthetic English workday around the current time, the next meeting starting
// in about `nextInMin` minutes. Returns a promise of the indicator.
globalThis.__demo = (nextInMin, step = 5) => import('resource:///org/gnome/shell/ui/main.js').then(Main => {
    const ind = Main.panel.statusArea['gnome-meet-widget@north-leshiy.github.io'];
    const store = ind._store;
    store.refresh = () => {};
    store._refresh = async () => {};

    const MIN = 60e3;
    const now = Date.now();
    // Rounded to `step` minutes so the agenda shows tidy times.
    const next = Math.ceil((now + nextInMin * MIN) / (step * MIN)) * step * MIN;
    const today = new Date(now);
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3);

    const person = (name, response = 'accepted', extra = {}) => ({
        name, email: `${name.split(' ')[0].toLowerCase()}@example.com`, response,
        optional: false, organizer: false, self: false, ...extra,
    });
    const me = response => person('Alex Morgan', response, {self: true});
    const link = (service, url) => ({service, url});
    const base = {
        allDayStart: null, allDayEnd: null, eventType: 'default', selfResponse: 'accepted',
        canRespond: false, isOrganizer: false, recurring: false, link: null, attendees: [],
        location: null, descriptionHtml: null, organizer: null,
        htmlLink: 'https://calendar.google.com/', calendarName: 'Work', calendarColor: '#3584e4',
    };
    const at = (offsetMin, durMin) => ({start: next + offsetMin * MIN, end: next + (offsetMin + durMin) * MIN});

    const planning = {
        ...base, key: 'planning', title: 'Q4 roadmap planning', ...at(0, 60),
        link: link('meet', 'https://meet.google.com/abc-defg-hij'),
        selfResponse: 'needsAction', canRespond: true, recurring: true,
        location: 'Atlas meeting room, 3rd floor',
        organizer: {name: 'Priya Shah', email: 'priya@example.com', self: false},
        attendees: [
            person('Priya Shah', 'accepted', {organizer: true}), me('needsAction'),
            person('Daniel Kim'), person('Sofia Rossi'), person('Tom Becker', 'tentative'),
            person('Lena Novak', 'declined'), person('Marco Silva', 'needsAction', {optional: true}),
        ],
        descriptionHtml: 'Let\'s agree on what ships before the end of the year.<br><br>' +
            '<b>Agenda</b><ul><li>Results of Q3 and what slipped</li><li>Top 5 bets for Q4</li>' +
            '<li>Hiring plan</li></ul>Draft: <a href="https://docs.example.com/q4">docs.example.com/q4</a><br>' +
            'Please read the draft before the meeting and leave comments, it will save us half an hour.',
    };

    store._meetings = [
        {...base, key: 'offsite', title: 'Berlin offsite', start: null, end: null,
            allDayStart: iso(today), allDayEnd: iso(tomorrow), calendarName: 'Team', calendarColor: '#9141ac'},
        {...base, key: 'standup', title: 'Daily standup', ...at(-240, 15), recurring: true,
            link: link('zoom', 'https://us06web.zoom.us/j/1234567890')},
        {...base, key: 'review', title: 'Architecture review', ...at(-180, 60),
            link: link('teams', 'https://teams.microsoft.com/l/meetup-join/1')},
        {...base, key: 'critique', title: 'Design critique', ...at(-45, 45),
            link: link('ktalk', 'https://team.ktalk.ru/design')},
        planning,
        {...base, key: 'demo', title: 'Sprint demo (optional)', ...at(90, 30), selfResponse: 'declined',
            link: link('jitsi', 'https://meet.jit.si/sprint-demo')},
        {...base, key: 'oneone', title: '1:1 with Daniel', ...at(150, 30),
            link: link('telemost', 'https://telemost.yandex.ru/j/123')},
        {...base, key: 'vendor', title: 'Vendor sync', ...at(165, 45), selfResponse: 'needsAction', canRespond: true,
            link: link('zoom', 'https://us06web.zoom.us/j/987654321')},
        {...base, key: 'lunch', title: 'Team lunch', ...at(240, 60), location: 'Café on the ground floor',
            calendarName: 'Personal', calendarColor: '#2ec27e'},
    ];
    store._windowDay = iso(today);
    store._days.clear();
    store._error = null;
    store._lastFailure = null;
    store._fetchedAt = now;
    store._emit();
    return ind;
});
'ok';
