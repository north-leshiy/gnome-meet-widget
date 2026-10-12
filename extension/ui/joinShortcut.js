// Ctrl+Alt+J joins the current or the nearest meeting.
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {joinCandidates} from '../core/schedule.js';
import {openUri} from './common.js';

const KEY = 'join-shortcut';

export class JoinShortcut {
    // deps: {settings, store, openAgenda(), now?}
    constructor(deps) {
        this._settings = deps.settings;
        this._store = deps.store;
        this._openAgenda = deps.openAgenda;
        this._now = deps.now ?? (() => Date.now());
        this._bound = false;
        this._settings.connectObject('changed::join-shortcut-enabled', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const want = this._settings.get_boolean('join-shortcut-enabled');
        if (want === this._bound)
            return;
        if (want) {
            Main.wm.addKeybinding(KEY, this._settings, Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.activate());
        } else {
            Main.wm.removeKeybinding(KEY);
        }
        this._bound = want;
    }

    // One meeting: open its link; several: the agenda to pick; none: say so.
    activate() {
        const candidates = joinCandidates(this._store.meetings, this._now());
        if (candidates.length === 1)
            openUri(candidates[0].link.url);
        else if (candidates.length > 1)
            this._openAgenda();
        else
            Main.notify(_('No meeting to join right now'), '');
    }

    destroy() {
        this._settings.disconnectObject(this);
        if (this._bound)
            Main.wm.removeKeybinding(KEY);
        this._bound = false;
    }
}
