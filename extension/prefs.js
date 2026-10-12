import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {GoaAccounts} from './lib/goa.js';
import {GoogleCalendarApi, ApiError} from './lib/googleApi.js';
import {calendarVisible} from './core/meetings.js';

const VISIBILITY_KEY = 'calendar-visibility';

function spinRow(settings, key, title, subtitle, min, max) {
    const row = Adw.SpinRow.new_with_range(min, max, 1);
    row.title = title;
    row.subtitle = subtitle ?? '';
    settings.bind(key, row, 'value', 0);
    return row;
}

// A combo row bound to an enum key: [[nick, label], …].
function enumRow(settings, key, title, options) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(options.map(([, label]) => label))});
    const sync = () => {
        const i = Math.max(0, options.findIndex(([nick]) => nick === settings.get_string(key)));
        if (row.selected !== i)
            row.selected = i;
    };
    sync();
    row.connect('notify::selected', () => settings.set_string(key, options[row.selected][0]));
    settings.connect(`changed::${key}`, sync);
    return row;
}

function colorDot(color) {
    const label = new Gtk.Label({valign: Gtk.Align.CENTER});
    label.set_markup(`<span foreground="${GLib.markup_escape_text(color ?? '#888888', -1)}">●</span>`);
    return label;
}

export default class MeetWidgetPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 720);

        const page = new Adw.PreferencesPage({title: _('Meetings'), icon_name: 'x-office-calendar-symbolic'});
        window.add(page);

        const timing = new Adw.PreferencesGroup({title: _('Top bar and reminders')});
        timing.add(spinRow(settings, 'reminder-minutes', _('Remind before a meeting, minutes'),
            _('0 turns reminders off'), 0, 30));
        timing.add(spinRow(settings, 'highlight-minutes', _('Highlight the button before a meeting, minutes'),
            null, 0, 30));
        timing.add(spinRow(settings, 'panel-horizon-hours', _('Show upcoming meetings in the top bar, hours ahead'),
            null, 1, 24));
        const modes = ['smart', 'countdown', 'status'];
        const mode = new Adw.ComboRow({
            title: _('Top bar shows'),
            subtitle: _('Smart: time to the meeting or its end. Countdown: to the next start. Status: now, next or free.'),
            model: Gtk.StringList.new([_('Smart'), _('Countdown'), _('Status')]),
        });
        const title = new Adw.SwitchRow({
            title: _('Show the meeting title in the top bar'),
            subtitle: _('Turn off for screen sharing'),
        });
        const syncMode = () => {
            const i = Math.max(0, modes.indexOf(settings.get_string('panel-mode')));
            if (mode.selected !== i)
                mode.selected = i;
            // Only the smart mode has a title.
            title.sensitive = i === 0;
        };
        mode.connect('notify::selected', () => settings.set_string('panel-mode', modes[mode.selected]));
        settings.connect('changed::panel-mode', syncMode);
        syncMode();
        timing.add(mode);
        timing.add(enumRow(settings, 'panel-position', _('Place in the top bar'),
            [['left', _('Left')], ['center', _('Center')], ['right', _('Right')]]));
        // NO_SENSITIVITY: the mode, not key writability, decides if the row is active.
        settings.bind('show-title', title, 'active',
            Gio.SettingsBindFlags.DEFAULT | Gio.SettingsBindFlags.NO_SENSITIVITY);
        timing.add(title);
        for (const [key, text] of [
            ['show-invitations', _('Count invitations awaiting a reply')],
            ['pulse', _('Pulse when it is time to join')],
            ['join-shortcut-enabled', _('Join the current meeting with Ctrl+Alt+J')],
        ]) {
            const row = new Adw.SwitchRow({title: text});
            settings.bind(key, row, 'active', 0);
            timing.add(row);
        }
        page.add(timing);

        const sync = new Adw.PreferencesGroup({title: _('Updates')});
        sync.add(spinRow(settings, 'refresh-interval', _('Refresh every, minutes'), null, 1, 60));
        page.add(sync);

        this._calendarsPage = page;
        this._calendarGroups = [];
        const loading = new Adw.PreferencesGroup({title: _('Calendars')});
        loading.add(new Adw.ActionRow({title: _('Loading calendars…')}));
        this._setCalendarGroups([loading]);

        this._goa = new GoaAccounts();
        window.connect('close-request', () => {
            this._goa?.destroy();
            this._api?.destroy();
            return false;
        });
        this._loadCalendars(settings).catch(e => console.error(`gnome-meet-widget prefs: ${e.stack ?? e}`));
    }

    _setCalendarGroups(groups) {
        this._calendarGroups.forEach(g => this._calendarsPage.remove(g));
        this._calendarGroups = groups;
        groups.forEach(g => this._calendarsPage.add(g));
    }

    _message(text) {
        const group = new Adw.PreferencesGroup({title: _('Calendars')});
        const row = new Adw.ActionRow({title: text});
        row.add_prefix(new Gtk.Image({icon_name: 'dialog-information-symbolic'}));
        group.add(row);
        this._setCalendarGroups([group]);
    }

    async _loadCalendars(settings) {
        try {
            await this._goa.start();
        } catch {
            this._message(_('GNOME Online Accounts is not running.'));
            return;
        }
        const problem = this._goa.problem();
        if (problem) {
            this._message(problem === 'attention'
                ? _('Sign in to Google again in Online Accounts.')
                : _('No Google account with Calendar in Online Accounts.'));
            return;
        }

        this._api = new GoogleCalendarApi(this._goa);
        const groups = [];
        try {
            for (const account of this._goa.accounts()) {
                // eslint-disable-next-line no-await-in-loop
                const calendars = await this._api.calendars(account.id);
                groups.push(this._accountGroup(settings, account, calendars));
            }
        } catch (e) {
            this._message(e instanceof ApiError && e.kind === 'network'
                ? _('No network: the calendar list cannot be loaded.')
                : _('Cannot load calendars: %s').replace('%s', e.message));
            return;
        }
        this._setCalendarGroups(groups);
    }

    _accountGroup(settings, account, calendars) {
        const group = new Adw.PreferencesGroup({
            title: _('Calendars'),
            description: account.email,
        });
        const overrides = settings.get_value(VISIBILITY_KEY).deepUnpack();
        const sorted = [...calendars].sort((a, b) =>
            Number(b.primary === true) - Number(a.primary === true) ||
            (a.summaryOverride ?? a.summary).localeCompare(b.summaryOverride ?? b.summary));
        for (const calendar of sorted) {
            const row = new Adw.SwitchRow({
                title: GLib.markup_escape_text(calendar.summaryOverride ?? calendar.summary ?? calendar.id, -1),
                subtitle: calendar.selected ? '' : _('Hidden in Google Calendar'),
                active: calendarVisible(calendar, overrides),
            });
            row.add_prefix(colorDot(calendar.backgroundColor));
            row.connect('notify::active', () => {
                // Re-read: another window or the Shell may have changed the key.
                const current = settings.get_value(VISIBILITY_KEY).deepUnpack();
                current[calendar.id] = row.active;
                settings.set_value(VISIBILITY_KEY, new GLib.Variant('a{sb}', current));
            });
            group.add(row);
        }
        return group;
    }
}
