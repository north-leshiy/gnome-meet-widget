// Top bar button. Its menu shows either the day's agenda or a meeting card.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {panelState, panelLabel, panelTooltip, pendingInvitations} from '../core/schedule.js';
import {t, errorText} from './common.js';
import {fmt} from '../core/format.js';
import {Agenda} from './agenda.js';
import {MeetingCard} from './card.js';
import {Tooltip} from './tooltip.js';

const MIN = 60 * 1000;
const ICON = 'x-office-calendar-symbolic';
const RUNNING_ICON = 'appointment-soon-symbolic';
const PULSE_MS = 900;
const ERROR_ICON = 'dialog-warning-symbolic';

export const MeetIndicator = GObject.registerClass(
class MeetIndicator extends PanelMenu.Button {
    // deps: {store, clock, settings, openPreferences, rsvp, now}
    _init(deps) {
        super._init(0.5, _('Meetings'));
        this._deps = deps;
        this._store = deps.store;
        this._settings = deps.settings;
        this._now = deps.now ?? (() => Date.now());
        this._card = null;

        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box meet-panel-box'});
        this._icon = new St.Icon({icon_name: ICON, style_class: 'system-status-icon'});
        this._label = new St.Label({style_class: 'meet-panel-label', y_align: Clutter.ActorAlign.CENTER});
        this._badge = new St.Label({style_class: 'meet-panel-badge', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._icon);
        box.add_child(this._label);
        box.add_child(this._badge);
        this.add_child(box);
        this._pulsing = false;
        this._tooltip = new Tooltip(this, {
            text: () => this._tooltipText,
            blocked: () => this.menu.isOpen,
        });

        this.menu.box.add_style_class_name('meet-menu');
        this._view = new St.Bin({x_expand: true});
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_style_class_name('meet-menu-item');
        item.add_child(this._view);
        this.menu.addMenuItem(item);

        this._agenda = new Agenda({
            store: this._store,
            now: this._now,
            openCard: m => this.showCard(m),
            close: () => this.menu.close(),
            openPreferences: () => deps.openPreferences(),
        });
        this._view.child = this._agenda.actor;

        this.menu.connect('open-state-changed', (_m, open) => {
            this._tooltip.hide();
            if (open)
                this._onOpen();
            else
                this._showAgenda();
        });

        this._unsubscribe = [
            this._store.onChanged(() => this._sync()),
            deps.clock.on('tick', () => this._sync()),
        ];
        this._settings.connectObject(
            'changed::show-title', () => this._syncPanel(),
            'changed::highlight-minutes', () => this._syncPanel(),
            'changed::panel-horizon-hours', () => this._syncPanel(),
            'changed::panel-mode', () => this._syncPanel(),
            'changed::show-invitations', () => this._syncPanel(),
            'changed::pulse', () => this._syncPanel(),
            this);
        this._sync();
    }

    _onDestroy() {
        this._unsubscribe.forEach(fn => fn());
        this._settings.disconnectObject(this);
        this._tooltip.destroy();
        super._onDestroy();
    }

    _onOpen() {
        // Only a safety net: a day almost always fits on the screen as a whole.
        const height = Math.floor(Main.layoutManager.primaryMonitor.height * 0.85) - 160;
        this._agenda.setMaxHeight(height);
        this._maxHeight = height;
        this._agenda.reset();
        this._showAgenda();
        this._store.refreshIfOlder(MIN);
    }

    // Open the menu right on a meeting's card (from a reminder).
    openOnCard(meetingKey) {
        const m = this._store.meetings.find(x => x.key === meetingKey);
        this.menu.open();
        if (m)
            this.showCard(m);
    }

    showCard(meeting) {
        this._agendaScroll = this._agenda.scrollValue;
        this._card = new MeetingCard({
            now: this._now,
            close: () => this.menu.close(),
            back: () => this._showAgenda(true),
            rsvp: this._deps.rsvp ?? null,
        }, meeting);
        this._card.setMaxHeight(this._maxHeight ?? 500);
        this._view.child = this._card.actor;
    }

    _showAgenda(restoreScroll = false) {
        if (this._card) {
            this._card.actor.destroy();
            this._card = null;
        }
        this._view.child = this._agenda.actor;
        this._agenda.render();
        if (restoreScroll && this._agendaScroll !== undefined)
            this._agenda.restoreScroll(this._agendaScroll);
    }

    _sync() {
        this._syncPanel();
        if (!this.menu.isOpen)
            return;
        if (this._card) {
            // Keep the card on the fresh copy of its meeting, if it is still there.
            const fresh = this._store.meetings.find(m => m.key === this._card.meeting.key);
            if (fresh && fresh !== this._card.meeting)
                this._card.update(fresh);
        } else {
            this._agenda.render();
        }
    }

    _syncPanel() {
        const now = this._now();
        const meetings = this._store.meetings;
        const state = panelState(meetings, now, {
            horizonMin: this._settings.get_uint('panel-horizon-hours') * 60,
            highlightMin: this._settings.get_uint('highlight-minutes'),
            error: this._store.error,
        });
        const text = panelLabel(state, now, t, {
            mode: this._settings.get_string('panel-mode'),
            showTitle: this._settings.get_boolean('show-title'),
        });
        this._label.text = text ?? '';
        this._label.visible = text !== null;

        const invitations = state.kind === 'error' ? 0 : pendingInvitations(meetings, now);
        const showBadge = invitations > 0 && this._settings.get_boolean('show-invitations');
        this._badge.text = `✉${invitations}`;
        this._badge.visible = showBadge;

        this._icon.icon_name = state.kind === 'error' ? ERROR_ICON : state.running ? RUNNING_ICON : ICON;
        if (state.highlight)
            this.add_style_class_name('meet-highlight');
        else
            this.remove_style_class_name('meet-highlight');
        this._setPulse(state.highlight && (state.kind === 'upcoming' || state.kind === 'starting') &&
            this._settings.get_boolean('pulse'));

        this._tooltipText = panelTooltip(state, now, t, invitations);
        const accessible = state.kind === 'error' ? errorText(state.error) : text ?? _('No upcoming meetings');
        this.accessible_name = showBadge ? `${accessible}, ${fmt(_('Invitations awaiting reply: %d'), invitations)}`
            : accessible;
    }

    // St has no CSS animations, so the pulse is an opacity transition.
    _setPulse(on) {
        if (on === this._pulsing)
            return;
        this._pulsing = on;
        this.remove_transition('opacity');
        this.opacity = 255;
        if (on) {
            this.ease({
                opacity: 150,
                duration: PULSE_MS,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1,
                autoReverse: true,
            });
        }
    }
});
