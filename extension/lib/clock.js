// Time signals for the UI and the store:
//   tick     every minute, on a time zone change and on a clock jump
//   resumed  after suspend
//   online   the network came back

import GnomeDesktop from 'gi://GnomeDesktop';
import Gio from 'gi://Gio';

export class Clock {
    constructor() {
        this._listeners = {tick: new Set(), resumed: new Set(), online: new Set()};

        this._wallClock = new GnomeDesktop.WallClock();
        this._clockId = this._wallClock.connect('notify::clock', () => this._emit('tick'));

        this._sleepId = Gio.DBus.system.signal_subscribe(
            'org.freedesktop.login1', 'org.freedesktop.login1.Manager', 'PrepareForSleep',
            '/org/freedesktop/login1', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _n, params) => {
                const [aboutToSuspend] = params.deepUnpack();
                if (!aboutToSuspend) {
                    this._emit('resumed');
                    this._emit('tick');
                }
            });

        this._network = Gio.NetworkMonitor.get_default();
        this._wasOnline = this._network.network_available;
        this._networkId = this._network.connect('network-changed', (_m, available) => {
            if (available && !this._wasOnline)
                this._emit('online');
            this._wasOnline = available;
        });
    }

    destroy() {
        this._wallClock.disconnect(this._clockId);
        this._wallClock = null;
        Gio.DBus.system.signal_unsubscribe(this._sleepId);
        this._network.disconnect(this._networkId);
        Object.values(this._listeners).forEach(s => s.clear());
    }

    on(name, fn) {
        this._listeners[name].add(fn);
        return () => this._listeners[name].delete(fn);
    }

    _emit(name) {
        for (const fn of this._listeners[name]) {
            try {
                fn();
            } catch (e) {
                console.error(`gnome-meet-widget: ${name} listener: ${e.stack ?? e}`);
            }
        }
    }
}
