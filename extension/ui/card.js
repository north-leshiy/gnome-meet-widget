// Meeting details shown in place of the agenda.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {dayKey, addDays, isAllDay} from '../core/meetings.js';
import {dayTitle, timeRange, fmt} from '../core/format.js';
import {t, serviceName, serviceIcon, openUri, setMarkup, joinButton, copyButton, dayLabel} from './common.js';
import {LinkLabel} from './linkLabel.js';

// Description preview before "Show more".
const PREVIEW = {maxLines: 4, maxChars: 240};

const escape = s => GLib.markup_escape_text(s, -1);

const RESPONSE = {
    accepted: {glyph: '✓', name: () => _('Accepted')},
    tentative: {glyph: '?', name: () => _('Maybe')},
    declined: {glyph: '✕', name: () => _('Declined')},
    needsAction: {glyph: '·', name: () => _('No reply')},
};

function wrapLabel(text, style_class) {
    const l = new St.Label({text, style_class, x_expand: true});
    l.clutter_text.line_wrap = true;
    l.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return l;
}

function fieldRow(iconName, child) {
    const row = new St.BoxLayout({style_class: 'meet-card-field'});
    row.add_child(new St.Icon({icon_name: iconName, style_class: 'meet-card-field-icon',
        y_align: Clutter.ActorAlign.CENTER}));
    row.add_child(child);
    return row;
}

export class MeetingCard {
    // host: {now(), close(), back(), rsvp: RsvpBlock factory or null}
    constructor(host, meeting) {
        this._host = host;
        this._meeting = meeting;
        this._attendeesOpen = false;
        this._descriptionOpen = false;

        this.actor = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'meet-card',
            x_expand: true,
        });

        this._header = new St.BoxLayout({style_class: 'meet-card-header'});
        this.actor.add_child(this._header);

        this._body = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'meet-card-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            child: this._body,
        });
        this.actor.add_child(this._scroll);
        this.render();
    }

    get meeting() {
        return this._meeting;
    }

    setMaxHeight(px) {
        this._scroll.style = `max-height: ${px}px;`;
    }

    update(meeting) {
        this._meeting = meeting;
        this.render();
    }

    _renderHeader(m) {
        this._header.destroy_all_children();
        const back = new St.Button({
            style_class: 'meet-card-close',
            child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16}),
            accessible_name: _('Back'),
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
        });
        back.connect('clicked', () => this._host.back());
        this._header.add_child(back);

        const titles = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        titles.add_child(wrapLabel(m.title ?? _('(No title)'), 'meet-card-title'));
        titles.add_child(new St.Label({
            text: isAllDay(m) ? _('All day') : timeRange(m.start, m.end),
            style_class: 'meet-card-time',
        }));
        this._header.add_child(titles);

        const logo = m.link && serviceIcon(m.link.service);
        if (logo) {
            this._header.add_child(new St.Icon({gicon: logo, icon_size: 20, style_class: 'meet-card-logo',
                accessible_name: serviceName(m.link.service), y_align: Clutter.ActorAlign.START}));
        }
        if (m.htmlLink) {
            const open = new St.Button({
                style_class: 'meet-icon-button',
                child: new St.Icon({icon_name: 'x-office-calendar-symbolic', icon_size: 16}),
                accessible_name: _('Open in Google Calendar'),
                y_align: Clutter.ActorAlign.START,
                can_focus: true,
            });
            open.connect('clicked', () => {
                if (openUri(m.htmlLink))
                    this._host.close();
            });
            this._header.add_child(open);
        }
    }

    render() {
        const m = this._meeting;
        const now = this._host.now();
        this._renderHeader(m);
        this._body.destroy_all_children();

        if (m.link) {
            const box = new St.BoxLayout({style_class: 'meet-card-actions'});
            box.add_child(joinButton(m.link, {
                style: m.end !== null && m.end <= now ? 'secondary' : 'primary',
                onJoined: () => this._host.close(),
            }));
            box.add_child(copyButton(m.link.url, {withLabel: true}));
            this._body.add_child(box);
        }

        if (m.canRespond && this._host.rsvp) {
            this._body.add_child(this._host.rsvp(m, updated => this.update(updated)));
            if (m.recurring) {
                this._body.add_child(wrapLabel(_('The reply applies to this occurrence only.'),
                    'meet-card-hint'));
            }
        } else if (!m.canRespond && !m.isOrganizer && m.attendees.length) {
            this._body.add_child(wrapLabel(_('Reply in the source calendar.'), 'meet-card-hint'));
        }

        this._body.add_child(fieldRow('preferences-system-time-symbolic', wrapLabel(this._when(m, now), 'meet-card-text')));

        if (m.location && m.location !== m.link?.url)
            this._body.add_child(fieldRow('mark-location-symbolic', wrapLabel(m.location, 'meet-card-text')));

        if (m.organizer) {
            const who = m.organizer.self ? _('You') : m.organizer.name ?? m.organizer.email;
            this._body.add_child(fieldRow('avatar-default-symbolic',
                wrapLabel(fmt(_('Organizer: %s'), who), 'meet-card-text')));
        }

        // The color dot is a widget: St overrides Pango foreground colors of labels.
        const calendar = new St.BoxLayout({style_class: 'meet-card-calendar', x_expand: true});
        if (m.calendarColor && /^#[0-9a-f]{3,8}$/i.test(m.calendarColor)) {
            calendar.add_child(new St.Widget({
                style_class: 'meet-calendar-dot',
                style: `background-color: ${m.calendarColor};`,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        calendar.add_child(new St.Label({text: m.calendarName, style_class: 'meet-card-text', x_expand: true}));
        this._body.add_child(fieldRow('view-list-symbolic', calendar));

        if (m.attendees.length)
            this._attendees(m);

        if (m.descriptionHtml)
            this._description(m);
    }

    _when(m, now) {
        const today = dayKey(now);
        if (isAllDay(m)) {
            const last = addDays(m.allDayEnd, -1);
            const first = dayTitle(m.allDayStart, today, addDays, t);
            return last === m.allDayStart ? first : `${first} – ${dayTitle(last, today, addDays, t)}`;
        }
        const key = dayKey(m.start);
        return dayLabel(key, dayTitle(key, today, addDays, t));
    }

    _expander(iconName, text, open, onToggle) {
        const content = new St.BoxLayout({style_class: 'meet-card-field', x_expand: true});
        content.add_child(new St.Icon({icon_name: iconName, style_class: 'meet-card-field-icon',
            y_align: Clutter.ActorAlign.CENTER}));
        content.add_child(new St.Label({text, style_class: 'meet-card-text', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        content.add_child(new St.Icon({icon_name: open ? 'pan-down-symbolic' : 'pan-end-symbolic',
            style_class: 'meet-card-field-icon', y_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'meet-card-expander', child: content, x_expand: true,
            can_focus: true});
        button.connect('clicked', onToggle);
        return button;
    }

    _attendees(m) {
        this._body.add_child(this._expander('system-users-symbolic',
            fmt(_('Attendees: %d'), m.attendees.length), this._attendeesOpen, () => {
                this._attendeesOpen = !this._attendeesOpen;
                this.render();
            }));
        if (!this._attendeesOpen)
            return;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'meet-card-attendees'});
        const sorted = [...m.attendees].sort((a, b) => Number(b.self) - Number(a.self));
        for (const a of sorted) {
            const r = RESPONSE[a.response] ?? RESPONSE.needsAction;
            const row = new St.BoxLayout({style_class: 'meet-attendee'});
            row.add_child(new St.Label({text: r.glyph, style_class: `meet-attendee-status meet-response-${a.response}`,
                accessible_name: r.name()}));
            const marks = [a.self && _('you'), a.organizer && _('organizer'), a.optional && _('optional')]
                .filter(Boolean);
            const name = a.name ?? a.email ?? '?';
            const label = new St.Label({style_class: 'meet-attendee-name', x_expand: true});
            setMarkup(label, marks.length
                ? `${escape(name)} <span alpha="60%">(${escape(marks.join(', '))})</span>`
                : escape(name));
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            row.add_child(label);
            box.add_child(row);
        }
        this._body.add_child(box);
    }

    _description(m) {
        const desc = new LinkLabel(m.descriptionHtml, {
            onOpen: () => this._host.close(),
            ...this._descriptionOpen ? {} : PREVIEW,
        });
        desc.add_style_class_name('meet-card-description');
        this._body.add_child(desc);
        if (!desc.truncated && !this._descriptionOpen)
            return;
        const toggle = new St.Button({
            style_class: 'meet-footer-link meet-card-more',
            label: this._descriptionOpen ? _('Show less') : _('Show more'),
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
        });
        toggle.connect('clicked', () => {
            this._descriptionOpen = !this._descriptionOpen;
            this.render();
        });
        this._body.add_child(toggle);
    }
}
