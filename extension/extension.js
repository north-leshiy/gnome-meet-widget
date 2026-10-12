import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {GoaAccounts} from './lib/goa.js';
import {GoogleCalendarApi} from './lib/googleApi.js';
import {MeetingStore} from './lib/store.js';
import {Clock} from './lib/clock.js';
import {MeetIndicator} from './ui/indicator.js';
import {Reminders} from './ui/reminder.js';
import {JoinShortcut} from './ui/joinShortcut.js';

export default class MeetWidgetExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._goa = new GoaAccounts();
        this._api = new GoogleCalendarApi(this._goa);
        this._clock = new Clock();
        this._store = new MeetingStore({goa: this._goa, api: this._api, settings: this._settings});

        this._addIndicator();
        this._settings.connectObject('changed::panel-position', () => this._addIndicator(), this);

        this._reminders = new Reminders({
            store: this._store,
            clock: this._clock,
            settings: this._settings,
            openCard: key => this._indicator?.openOnCard(key),
        });

        this._joinShortcut = new JoinShortcut({
            settings: this._settings,
            store: this._store,
            openAgenda: () => this._indicator?.menu.open(),
        });

        this._unsubscribe = [
            this._clock.on('resumed', () => this._store.refresh()),
            this._clock.on('online', () => {
                if (this._store.stale)
                    this._store.refresh();
            }),
            // Midnight: the regular window moves to the new day.
            this._clock.on('tick', () => this._store.refreshIfNewDay()),
        ];

        // The extension may be disabled, or disabled and enabled again, before
        // GOA answers.
        const store = this._store;
        const reminders = this._reminders;
        this._goa.start()
            .catch(e => console.warn(`gnome-meet-widget: GOA: ${e.message}`))
            .then(() => this._store === store && store.start())
            .then(() => this._reminders === reminders && reminders.start());
    }

    // The button goes to the end of the left box, before the clock in the
    // center or to the start of the right box; moving it means a new button.
    _addIndicator() {
        if (this._indicator) {
            this._indicator.menu.close(BoxPointer.PopupAnimation.NONE);
            this._indicator.destroy();
        }
        this._indicator = new MeetIndicator({
            store: this._store,
            clock: this._clock,
            settings: this._settings,
            openPreferences: () => this.openPreferences(),
        });
        const box = this._settings.get_string('panel-position');
        Main.panel.addToStatusArea(this.uuid, this._indicator, box === 'left' ? -1 : 0, box);
    }

    disable() {
        this._settings.disconnectObject(this);
        this._unsubscribe.forEach(fn => fn());
        this._joinShortcut.destroy();
        this._joinShortcut = null;
        this._reminders.destroy();
        this._reminders = null;
        // An open menu would finish its closing animation on a destroyed actor.
        this._indicator.menu.close(BoxPointer.PopupAnimation.NONE);
        this._indicator.destroy();
        this._indicator = null;
        this._store.destroy();
        this._store = null;
        this._api.destroy();
        this._api = null;
        this._goa.destroy();
        this._goa = null;
        this._clock.destroy();
        this._clock = null;
        this._settings = null;
    }
}
