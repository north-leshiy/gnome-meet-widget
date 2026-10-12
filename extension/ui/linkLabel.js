// Label with clickable links, like the Shell's URLHighlighter, but the link
// ranges come from core/description.js so <a href>text</a> works too.
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {render} from '../core/description.js';
import {openUri} from './common.js';

export const LinkLabel = GObject.registerClass(
class MeetLinkLabel extends St.Label {
    // maxLines/maxChars cut the text to a preview ending with '…'.
    _init(html, {onOpen = null, maxLines, maxChars} = {}) {
        super._init({reactive: true, style_class: 'meet-link-label', x_expand: true});
        this._html = html;
        this._limits = {maxLines, maxChars};
        this.truncated = false;
        this._onOpen = onOpen;
        this._links = [];
        this._cursorChanged = false;
        this.clutter_text.line_wrap = true;
        this.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;

        this._linkColor = '#3584e4';
        this.connect('style-changed', () => {
            const [hasColor, color] = this.get_theme_node().lookup_color('link-color', false);
            const value = hasColor ? color.to_string().substring(0, 7) : this._linkColor;
            if (value !== this._linkColor || !this._links.length) {
                this._linkColor = value;
                this._render();
            }
        });
        this._render();

        this._click = new Clutter.ClickGesture();
        // get_coords_abs() is a Graphene.Point, not an array.
        const linkUnderClick = () => {
            const {x, y} = this._click.get_coords_abs();
            return this._linkAt(x, y);
        };
        this._click.connect('may-recognize', () => linkUnderClick() !== null);
        this._click.connect('recognize', () => {
            const link = linkUnderClick();
            if (link && openUri(link.url))
                this._onOpen?.();
        });
        this.add_action(this._click);
    }

    _render() {
        const {text, markup, links, truncated} = render(this._html, {linkColor: this._linkColor, ...this._limits});
        this.truncated = truncated;
        try {
            this.clutter_text.set_markup(markup);
            this._links = links;
        } catch (e) {
            // Broken markup must not break the menu: plain text, no links.
            console.warn(`gnome-meet-widget: description markup: ${e.message}`);
            this.clutter_text.set_text(text);
            this._links = [];
        }
    }

    _linkAt(x, y) {
        // Positions are relative to the inner ClutterText, not to the padded label.
        const [ok, lx, ly] = this.clutter_text.transform_stage_point(x, y);
        if (!ok)
            return null;
        const pos = this.clutter_text.coords_to_position(lx, ly);
        if (pos < 0)
            return null;
        return this._links.find(l => l.start <= pos && pos < l.end) ?? null;
    }

    vfunc_motion_event(event) {
        const over = this._linkAt(...event.get_coords()) !== null;
        if (over !== this._cursorChanged) {
            this.set_cursor_type(over ? Clutter.CursorType.POINTER : Clutter.CursorType.DEFAULT);
            this._cursorChanged = over;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        if (this._cursorChanged) {
            this._cursorChanged = false;
            this.set_cursor_type(Clutter.CursorType.DEFAULT);
        }
        return super.vfunc_leave_event(event);
    }
});
