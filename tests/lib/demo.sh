# shellcheck shell=bash
# Sourced after devkit-prep.sh: replace the store contents with a synthetic day
# around the current time and open the menu. For design checks and screenshots.
# DEMO_THEME=light|dark switches the Shell color scheme first.
case ${DEMO_THEME:-} in
  light) E "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', 'prefer-light'); 'x'" >/dev/null ;;
  dark) E "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', 'prefer-dark'); 'x'" >/dev/null ;;
esac
E "$IND i.menu.close(); const now = Date.now(); const base = {allDayStart: null, allDayEnd: null, eventType: 'default', selfResponse: null, canRespond: false, isOrganizer: false, recurring: false, link: null, attendees: [], location: null, descriptionHtml: null, organizer: null, htmlLink: 'https://calendar.google.com/', calendarName: 'Работа', calendarColor: '#3584e4'}; const L = (s, u) => ({url: u, service: s}); const cur = Math.floor(now / 60e3) * 60e3; i._store._meetings = [
 {...base, key: 'trip', title: 'Конференция в Казани', start: null, end: null, allDayStart: new Date(now).toISOString().slice(0,10), allDayEnd: '2999-01-01'},
 {...base, key: 'a', title: 'Стендап команды', start: cur - 6 * 3600e3, end: cur - 6 * 3600e3 + 15 * 60e3, link: L('zoom', 'https://us06web.zoom.us/j/123')},
 {...base, key: 'b', title: 'Ревью архитектуры', start: cur - 4 * 3600e3, end: cur - 3 * 3600e3, link: L('meet', 'https://meet.google.com/abc-defg-hij')},
 {...base, key: 'c', title: 'Собеседование', start: cur - 3.5 * 3600e3, end: cur - 2.75 * 3600e3},
 {...base, key: 'd', title: 'Дизайн-критика интерфейса виджета встреч', start: cur - 20 * 60e3, end: cur + 25 * 60e3, link: L('ktalk', 'https://team.ktalk.ru/room1')},
 {...base, key: 'e', title: 'Квартальное планирование', start: cur + 15 * 60e3, end: cur + 75 * 60e3, link: L('telemost', 'https://telemost.yandex.ru/j/1'), canRespond: true, selfResponse: 'needsAction'},
 {...base, key: 'f', title: 'Необязательное демо', start: cur + 2 * 3600e3, end: cur + 2.5 * 3600e3, selfResponse: 'declined', link: L('teams', 'https://teams.microsoft.com/l/meetup-join/1')},
 {...base, key: 'g', title: '1:1 с Алексеем', start: cur + 3 * 3600e3, end: cur + 3.5 * 3600e3, link: L('zoom', 'https://us06web.zoom.us/j/456')},
 {...base, key: 'h', title: 'Созвон с подрядчиком', start: cur + 3 * 3600e3, end: cur + 4 * 3600e3, link: L('jitsi', 'https://meet.jit.si/x')},
 {...base, key: 'k', title: 'Обед', start: cur + 4.5 * 3600e3, end: cur + 5.5 * 3600e3, location: 'Кафе на первом этаже'},
]; i._store._fetchedAt = now; i._store._emit(); i.menu.open(); }); 'x'" >/dev/null
