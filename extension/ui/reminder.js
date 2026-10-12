// One notification per start minute. Fired reminders are saved so a Shell
// restart does not repeat them; a notification is withdrawn once its meeting
// is over, declined, moved or gone.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {dueReminders, stillRelevant, pruneReminded} from '../core/reminders.js';
import {fmt, truncate, timeRange, untilLabel} from '../core/format.js';
import {JsonFile} from '../lib/jsonFile.js';
import {t, openUri} from './common.js';

const MAX_JOIN_BUTTONS = 3;

export class Reminders {
    // deps: {store, clock, settings, openCard(meetingKey), now?, file?}
    constructor(deps) {
        this._store = deps.store;
        this._settings = deps.settings;
        this._openCard = deps.openCard;
        this._now = deps.now ?? (() => Date.now());
        this._file = deps.file ?? new JsonFile('reminded.json');
        this._reminded = new Map();
        this._active = new Map();   // notification → reminder keys
        this._source = null;
        this._loaded = false;

        this._unsubscribe = [
            this._store.onChanged(() => this._check()),
            deps.clock.on('tick', () => this._check()),
        ];
    }

    async start() {
        const saved = await this._file.read();
        if (this._destroyed)
            return;
        if (saved && typeof saved === 'object')
            this._reminded = pruneReminded(new Map(Object.entries(saved)), this._now());
        this._loaded = true;
        this._check();
    }

    destroy() {
        this._destroyed = true;
        this._unsubscribe.forEach(fn => fn());
        this._source?.destroy();
        this._source = null;
        this._active.clear();
    }

    _check() {
        // Before reminded.json is read every reminder would look new.
        if (!this._loaded || this._store.fetchedAt === null)
            return;
        const now = this._now();
        const meetings = this._store.meetings;

        for (const [notification, keys] of this._active) {
            if (!keys.some(k => stillRelevant(k, meetings, now)))
                notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
        }

        const minutes = this._settings.get_uint('reminder-minutes');
        const groups = dueReminders(meetings, now, minutes, this._reminded);
        if (!groups.length)
            return;
        for (const group of groups) {
            this._notify(group, now);
            group.keys.forEach(k => this._reminded.set(k, now));
        }
        this._reminded = pruneReminded(this._reminded, now);
        this._file.write(Object.fromEntries(this._reminded))
            .catch(e => console.warn(`gnome-meet-widget: reminded.json: ${e.message}`));
    }

    _ensureSource() {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: _('Meetings'),
                iconName: 'x-office-calendar-symbolic',
            });
            this._source.connect('destroy', () => {
                this._source = null;
                this._active.clear();
            });
            Main.messageTray.add(this._source);
        }
        return this._source;
    }

    _notify({start, meetings, keys}, now) {
        const first = meetings[0];
        const when = untilLabel(start, now, t);
        let title, body;
        if (meetings.length === 1) {
            title = fmt(_('%s %s'), first.title ?? _('(No title)'), when);
            body = timeRange(first.start, first.end);
            if (!first.link && first.location)
                body += `\n${first.location}`;
        } else {
            title = fmt(ngettext('%d meeting %s', '%d meetings %s', meetings.length), meetings.length, when);
            body = meetings.map(m => `${timeRange(m.start, m.end)}  ${m.title ?? _('(No title)')}`).join('\n');
        }

        const notification = new MessageTray.Notification({
            source: this._ensureSource(),
            title,
            body,
            urgency: MessageTray.Urgency.HIGH,
        });
        const withLinks = meetings.filter(m => m.link).slice(0, MAX_JOIN_BUTTONS);
        for (const m of withLinks) {
            const label = meetings.length === 1
                ? _('Join') : fmt(_('Join: %s'), truncate(m.title ?? _('(No title)'), 20));
            notification.addAction(label, () => openUri(m.link.url));
        }
        notification.connect('activated', () => this._openCard(first.key));
        notification.connect('destroy', () => this._active.delete(notification));
        this._active.set(notification, keys);
        this._source.addNotification(notification);
    }
}
