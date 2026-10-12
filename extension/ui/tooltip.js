// Hover text under a top bar button; PanelMenu.Button has no tooltips.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DELAY_MS = 500;

export class Tooltip {
    // button: the panel button; text(): the text or null; blocked(): e.g. menu open
    constructor(button, {text, blocked}) {
        this._button = button;
        this._text = text;
        this._blocked = blocked;
        this._timeout = 0;
        // Same style as the dash tooltips.
        this._label = new St.Label({style_class: 'dash-label', visible: false});
        Main.layoutManager.uiGroup.add_child(this._label);
        this._hoverId = button.connect('notify::hover', () => this._onHover());
    }

    _onHover() {
        this._cancel();
        if (!this._button.hover) {
            this.hide();
            return;
        }
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DELAY_MS, () => {
            this._timeout = 0;
            this.show();
            return GLib.SOURCE_REMOVE;
        });
    }

    show() {
        const text = this._text();
        if (!this._label || !text || this._blocked())
            return;
        this._label.text = text;
        if (text.includes('\n'))
            this._label.add_style_class_name('meet-tooltip-multiline');
        else
            this._label.remove_style_class_name('meet-tooltip-multiline');
        this._label.opacity = 0;
        this._label.show();
        const [x, y] = this._button.get_transformed_position();
        const [w, h] = this._button.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(this._button);
        const [, natWidth] = this._label.get_preferred_width(-1);
        const left = Math.min(Math.max(monitor.x, Math.round(x + w / 2 - natWidth / 2)),
            monitor.x + monitor.width - natWidth);
        this._label.set_position(left, Math.round(y + h + 4));
        this._label.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    hide() {
        this._cancel();
        // The menu closes while the button is being destroyed, after destroy().
        if (!this._label)
            return;
        this._label.remove_all_transitions();
        this._label.hide();
    }

    _cancel() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
    }

    destroy() {
        this._cancel();
        this._button.disconnect(this._hoverId);
        this._label.destroy();
        this._label = null;
    }
}
