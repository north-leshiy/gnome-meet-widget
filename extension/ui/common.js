import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// Translations for core/format.js and core/schedule.js.
export const t = {
    _: s => _(s),
    formatDate: key => {
        const [y, m, d] = key.split('-').map(Number);
        /* Translators: date of a day in the agenda header, strftime format */
        return GLib.DateTime.new_local(y, m, d, 0, 0, 0).format(_('%A, %e %B')).replace(/ {2}/, ' ');
    },
};

// St re-applies the theme to a label on every style change and drops colors
// set through Pango markup; set the markup again after that.
export function setMarkup(label, markup) {
    label._meetMarkup = markup;
    label.clutter_text.set_markup(markup);
    if (!label._meetMarkupHooked) {
        label._meetMarkupHooked = true;
        label.connect('style-changed', () => label.clutter_text.set_markup(label._meetMarkup));
    }
}

// "Today, 11 October"; a weekday title already has the date.
export function dayLabel(key, relative) {
    if (relative !== t.formatDate(key)) {
        const [y, m, d] = key.split('-').map(Number);
        /* Translators: day and month after "Today", strftime format */
        return `${relative}, ${GLib.DateTime.new_local(y, m, d, 0, 0, 0).format(_('%e %B')).trim()}`;
    }
    return relative;
}

export function serviceName(id) {
    switch (id) {
    case 'ktalk':
        return _('Kontur Talk');
    case 'zoom':
        return 'Zoom';
    case 'meet':
        return 'Google Meet';
    case 'telemost':
        return _('Telemost');
    case 'teams':
        return 'Microsoft Teams';
    case 'jitsi':
        return 'Jitsi Meet';
    default:
        return _('Video call');
    }
}

const SERVICE_ICONS = new Set(['ktalk', 'zoom', 'meet', 'telemost', 'teams', 'jitsi']);

function extensionIcon(file) {
    const uri = GLib.Uri.resolve_relative(import.meta.url, `../icons/${file}`, GLib.UriFlags.NONE);
    return new Gio.FileIcon({file: Gio.File.new_for_uri(uri)});
}

export function serviceIcon(id) {
    return SERVICE_ICONS.has(id) ? extensionIcon(`${id}.png`) : null;
}

export function joinButton(link, {style = 'primary', onJoined = null} = {}) {
    const label = _('Join');
    const box = new St.BoxLayout({style_class: 'meet-join-content', y_align: Clutter.ActorAlign.CENTER});
    box.add_child(new St.Icon({gicon: extensionIcon('meet-join-symbolic.svg'), icon_size: 16,
        y_align: Clutter.ActorAlign.CENTER}));
    box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
    const button = new St.Button({
        style_class: `button meet-join meet-join-${style}`,
        child: box,
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
        accessible_name: `${label}: ${serviceName(link.service)}`,
    });
    button.connect('clicked', () => {
        if (openUri(link.url))
            onJoined?.();
    });
    return button;
}

// Brand colors of the services for the round Join button in the agenda.
const SERVICE_COLORS = {
    ktalk: '#1a8cff', zoom: '#0b5cff', meet: '#00897b', telemost: '#16a34a',
    teams: '#5059c9', jitsi: '#1d76ba',
};

export function copyButton(url, {withLabel = false} = {}) {
    const icon = new St.Icon({icon_name: 'edit-copy-symbolic', icon_size: 16, y_align: Clutter.ActorAlign.CENTER});
    let child = icon;
    if (withLabel) {
        child = new St.BoxLayout({style_class: 'meet-join-content'});
        child.add_child(icon);
        child.add_child(new St.Label({text: _('Copy link'), y_align: Clutter.ActorAlign.CENTER}));
    }
    const copy = new St.Button({
        style_class: `meet-copy-button${withLabel ? ' meet-copy-text' : ''}`,
        child,
        accessible_name: _('Copy link'),
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
    });
    copy.connect('clicked', () => {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, url);
        icon.icon_name = 'object-select-symbolic';
    });
    return copy;
}

export function callControls(link, {onJoined = null} = {}) {
    const box = new St.BoxLayout({style_class: 'meet-call', y_align: Clutter.ActorAlign.CENTER});
    box.add_child(new St.Icon({
        gicon: serviceIcon(link.service) ?? new Gio.ThemedIcon({name: 'camera-web-symbolic'}),
        icon_size: 18,
        style_class: 'meet-service-icon',
        y_align: Clutter.ActorAlign.CENTER,
    }));
    box.add_child(copyButton(link.url));
    const join = new St.Button({
        style_class: 'meet-join-round',
        style: `background-color: ${SERVICE_COLORS[link.service] ?? '#3584e4'};`,
        child: new St.Icon({gicon: extensionIcon('meet-join-symbolic.svg'), icon_size: 16}),
        accessible_name: `${_('Join')}: ${serviceName(link.service)}`,
        y_align: Clutter.ActorAlign.CENTER,
        can_focus: true,
    });
    join.connect('clicked', () => {
        if (openUri(link.url))
            onJoined?.();
    });
    box.add_child(join);
    return box;
}

export function errorText(error) {
    switch (error) {
    case 'no-goa':
        return _('GNOME Online Accounts is not running.');
    case 'no-account':
        return _('No Google account with Calendar in Online Accounts.');
    case 'attention':
        return _('Sign in to Google again in Online Accounts.');
    default:
        return null;
    }
}

export function openUri(uri) {
    try {
        Gio.app_info_launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        return true;
    } catch (e) {
        Main.notifyError(_('Cannot open the link'), e.message);
        return false;
    }
}

export function openOnlineAccounts() {
    try {
        Gio.Subprocess.new(['gnome-control-center', 'online-accounts'], Gio.SubprocessFlags.NONE);
    } catch (e) {
        Main.notifyError(_('Cannot open Online Accounts'), e.message);
    }
}

export function googleCalendarDayUrl(key) {
    const [y, m, d] = key.split('-').map(Number);
    return `https://calendar.google.com/calendar/r/day/${y}/${m}/${d}`;
}
