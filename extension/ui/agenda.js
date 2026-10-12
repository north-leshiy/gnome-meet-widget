// The day's agenda in the menu. Rebuilt on every change: a day holds a dozen
// rows at most.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {agendaDay} from '../core/schedule.js';
import {dayKey, addDays} from '../core/meetings.js';
import {dayTitle, fmt, clock, untilLabel, leftLabel, duration, minutesUntil} from '../core/format.js';
import {t, errorText, openUri, openOnlineAccounts, googleCalendarDayUrl, setMarkup, callControls,
    serviceName, dayLabel} from './common.js';

const DAYS_BACK = 7;
const DAYS_AHEAD = 30;

const escape = s => GLib.markup_escape_text(s, -1);

function iconButton(iconName, accessibleName, onClick) {
    const b = new St.Button({
        style_class: 'meet-icon-button',
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
        accessible_name: accessibleName,
        can_focus: true,
    });
    b.connect('clicked', onClick);
    return b;
}

export class Agenda {
    // host: {store, now(), openCard(meeting), close(), openPreferences()}
    constructor(host) {
        this._host = host;
        this._offset = 0;
        this._scrollToNow = false;

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'meet-agenda',
            x_expand: true,
        });
        this.actor.connect('destroy', () => {
            this._destroyed = true;
        });

        const top = new St.BoxLayout({style_class: 'meet-agenda-top'});
        top.add_child(new St.Label({text: _('Meetings'), style_class: 'meet-agenda-name', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        top.add_child(iconButton('x-office-calendar-symbolic', _('Open Google Calendar'), () => {
            openUri(googleCalendarDayUrl(this.dayKey));
            this._host.close();
        }));
        this._refresh = iconButton('view-refresh-symbolic', _('Refresh'), () => this._host.store.refresh());
        top.add_child(this._refresh);
        top.add_child(iconButton('emblem-system-symbolic', _('Settings'), () => {
            this._host.openPreferences();
            this._host.close();
        }));
        this.actor.add_child(top);

        const header = new St.BoxLayout({style_class: 'meet-agenda-header'});
        this._prev = iconButton('go-previous-symbolic', _('Previous day'), () => this.shift(-1));
        this._next = iconButton('go-next-symbolic', _('Next day'), () => this.shift(1));
        this._title = new St.Label({
            style_class: 'meet-agenda-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._prev);
        header.add_child(this._title);
        header.add_child(this._next);
        this.actor.add_child(header);

        this._allDay = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'meet-allday',
        });
        this.actor.add_child(this._allDay);

        this._rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'meet-agenda-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            child: this._rows,
        });
        this.actor.add_child(this._scroll);

        this._footer = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'meet-agenda-footer',
        });
        this.actor.add_child(this._footer);
    }

    get dayKey() {
        return addDays(dayKey(this._host.now()), this._offset);
    }

    reset() {
        this._offset = 0;
        this._scrollToNow = true;
    }

    shift(delta) {
        this._offset = Math.max(-DAYS_BACK, Math.min(DAYS_AHEAD, this._offset + delta));
        this._scrollToNow = this._offset === 0;
        this.render();
    }

    get scrollValue() {
        return this._scroll.vadjustment.value;
    }

    restoreScroll(value) {
        this._afterLayout(() => {
            this._scroll.vadjustment.value = value;
        });
    }

    setMaxHeight(px) {
        this._scroll.style = `max-height: ${px}px;`;
    }

    render() {
        const store = this._host.store;
        const now = this._host.now();
        const key = this.dayKey;

        const relative = dayTitle(key, dayKey(now), addDays, t);
        this._title.text = dayLabel(key, relative);
        this._refresh.reactive = !store.loading;
        this._refresh.opacity = store.loading ? 90 : 255;
        this._prev.reactive = this._offset > -DAYS_BACK;
        this._next.reactive = this._offset < DAYS_AHEAD;
        this._prev.opacity = this._prev.reactive ? 255 : 90;
        this._next.opacity = this._next.reactive ? 255 : 90;

        this._generation = (this._generation ?? 0) + 1;
        this._allDay.destroy_all_children();
        this._rows.destroy_all_children();
        this._footer.destroy_all_children();

        const errText = errorText(store.error);
        if (errText && store.fetchedAt === null) {
            this._renderError(errText);
            this._renderFooter();
            return;
        }

        const meetings = store.day(key);
        if (meetings === null) {
            this._rows.add_child(new St.Label({text: _('Loading…'), style_class: 'meet-agenda-empty'}));
        } else {
            this._renderDay(agendaDay(meetings, key, now));
        }
        if (errText)
            this._renderError(errText);
        this._renderFooter();

        if (this._scrollToNow && this._nowAnchor) {
            this._scrollToNow = false;
            const line = this._nowAnchor;
            this._afterLayout(() => {
                const adj = this._scroll.vadjustment;
                adj.value = Math.max(0, line.get_allocation_box().y1 - adj.page_size / 3);
            });
        }
    }

    _renderDay(day) {
        for (const {meeting, declined} of day.allDay) {
            const label = new St.Label({style_class: 'meet-allday-item', x_expand: true,
                x_align: Clutter.ActorAlign.START});
            setMarkup(label, declined
                ? `<s>${escape(meeting.title ?? _('(No title)'))}</s>`
                : escape(meeting.title ?? _('(No title)')));
            const item = new St.Button({style_class: 'meet-allday-button', child: label, x_expand: true});
            item.connect('clicked', () => this._host.openCard(meeting));
            this._allDay.add_child(item);
        }
        this._allDay.visible = day.allDay.length > 0;

        this._nowAnchor = null;
        if (!day.rows.length) {
            this._rows.add_child(new St.Label({text: _('No meetings'), style_class: 'meet-agenda-empty'}));
            return;
        }
        // Free time that is already over is noise.
        const freeBefore = new Map(day.free.filter(f => !f.past).map(f => [f.beforeIndex, f]));
        // A long day scrolls to the first row that is not over yet.
        day.rows.forEach((row, i) => {
            if (freeBefore.has(i))
                this._rows.add_child(this._makeFree(freeBefore.get(i)));
            const actor = this._makeRow(row);
            if (i === day.nowIndex)
                this._nowAnchor = actor;
            this._rows.add_child(actor);
        });
    }

    _marker(parallel) {
        const marker = new St.Widget({style_class: 'meet-row-marker', y_expand: true});
        if (parallel !== null)
            marker.add_style_class_name(`meet-parallel-${parallel % 3}`);
        return marker;
    }

    _timeLabel(ms) {
        return new St.Label({text: clock(ms), style_class: 'meet-row-time', y_align: Clutter.ActorAlign.CENTER});
    }

    // Place or call service; meetings about to start or running show the
    // time left instead.
    _subtitle(row, now) {
        const m = row.meeting;
        const where = m.location && m.location !== m.link?.url && !/^https?:\/\//.test(m.location)
            ? m.location : m.link ? serviceName(m.link.service) : null;
        let when = null;
        if (!row.declined && row.current)
            when = leftLabel(m.end, now, t);
        else if (!row.declined && row.joinable)
            when = untilLabel(m.start, now, t);
        return {when, where};
    }

    _makeRow(row) {
        const m = row.meeting;
        // The box carries hover and state colors, so the highlight covers the
        // marker and the Join button as well.
        const box = new St.BoxLayout({style_class: 'meet-row', x_expand: true, reactive: true, track_hover: true});
        for (const [flag, cls] of [['past', 'meet-row-past'], ['current', 'meet-row-current'],
            ['declined', 'meet-row-declined']]) {
            if (row[flag])
                box.add_style_class_name(cls);
        }
        // St ignores 'opacity' in CSS.
        if (row.declined && !row.past)
            box.opacity = 140;
        box.add_child(this._marker(row.parallel));

        const content = new St.BoxLayout({x_expand: true, style_class: 'meet-row-content'});
        content.add_child(this._timeLabel(m.start));

        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({style_class: 'meet-row-title', x_expand: true});
        const titleText = escape(m.title ?? _('(No title)'));
        setMarkup(title, row.declined ? `<s>${titleText}</s>` : titleText);
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        const {when, where} = this._subtitle(row, this._host.now());
        if (when || where) {
            const sub = new St.BoxLayout({style_class: 'meet-row-sub'});
            if (when)
                sub.add_child(new St.Label({text: when, style_class: 'meet-row-sub-soon'}));
            if (when && where)
                sub.add_child(new St.Label({text: '·'}));
            if (where) {
                const place = new St.Label({text: where, x_expand: true});
                place.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                sub.add_child(place);
            }
            text.add_child(sub);
        }
        content.add_child(text);
        if (row.needsReply) {
            content.add_child(new St.Icon({
                icon_name: 'mail-unread-symbolic',
                style_class: 'meet-row-reply',
                accessible_name: _('Awaiting your reply'),
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        const open = new St.Button({
            style_class: 'meet-row-button',
            child: content,
            x_expand: true,
            can_focus: true,
            accessible_name: m.title ?? _('(No title)'),
        });
        open.connect('clicked', () => this._host.openCard(m));
        box.add_child(open);

        if (m.link && !row.past)
            box.add_child(callControls(m.link, {onJoined: () => this._host.close()}));
        return box;
    }

    _makeFree(slot) {
        const now = this._host.now();
        const box = new St.BoxLayout({style_class: 'meet-row meet-free', x_expand: true});
        if (slot.current)
            box.add_style_class_name('meet-free-current');
        box.add_child(new St.Widget({style_class: 'meet-row-marker meet-free-marker', y_expand: true}));
        const content = new St.BoxLayout({x_expand: true, style_class: 'meet-row-content meet-free-content'});
        content.add_child(this._timeLabel(slot.start));
        const length = slot.current
            ? leftLabel(slot.end, now, t)
            : duration(minutesUntil(slot.end, slot.start), t);
        content.add_child(new St.Label({
            text: fmt(_('Free · %s'), length),
            style_class: 'meet-free-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(content);
        return box;
    }

    _renderError(text) {
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'meet-error'});
        const label = new St.Label({text, style_class: 'meet-error-text'});
        label.clutter_text.line_wrap = true;
        box.add_child(label);
        const button = new St.Button({
            style_class: 'button meet-error-button',
            label: _('Open Online Accounts'),
            x_align: Clutter.ActorAlign.START,
        });
        button.connect('clicked', () => {
            openOnlineAccounts();
            this._host.close();
        });
        box.add_child(button);
        this._rows.add_child(box);
    }

    _renderFooter() {
        const store = this._host.store;
        const show = store.fetchedAt !== null && (store.stale || store.lastFailure);
        this._footer.visible = Boolean(show);
        if (!show)
            return;
        this._footer.add_child(new St.Label({
            text: fmt(_('Updated at %s'), clock(store.fetchedAt)),
            style_class: 'meet-status-text',
        }));
    }

    // fn may touch actors of this render, so skip it if the rows were rebuilt.
    _afterLayout(fn) {
        const generation = this._generation;
        const laters = global.compositor.get_laters();
        laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            if (!this._destroyed && generation === this._generation)
                fn();
            return GLib.SOURCE_REMOVE;
        });
    }
}
