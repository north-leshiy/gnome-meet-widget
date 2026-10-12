// Google accounts from GNOME Online Accounts over plain D-Bus, so the
// extension does not depend on the Goa typelib. Used by the Shell and prefs.

import Gio from 'gi://Gio';

Gio._promisify(Gio.DBusProxy.prototype, 'call', 'call_finish');

const BUS_NAME = 'org.gnome.OnlineAccounts';
const MANAGER_PATH = '/org/gnome/OnlineAccounts';
const ACCOUNT = 'org.gnome.OnlineAccounts.Account';
const OAUTH2 = 'org.gnome.OnlineAccounts.OAuth2Based';

function prop(proxy, name) {
    return proxy.get_cached_property(name)?.unpack() ?? null;
}

export class GoaError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;   // 'no-goa' | 'no-account' | 'attention'
    }
}

export class GoaAccounts {
    constructor() {
        this._manager = null;
        this._listeners = new Set();
    }

    async start(cancellable = null) {
        const manager = await new Promise((resolve, reject) => {
            Gio.DBusObjectManagerClient.new_for_bus(
                Gio.BusType.SESSION, Gio.DBusObjectManagerClientFlags.NONE,
                BUS_NAME, MANAGER_PATH, null, cancellable,
                (_o, res) => {
                    try {
                        resolve(Gio.DBusObjectManagerClient.new_for_bus_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                });
        });
        // disable() may have come while the manager was being created.
        if (this._destroyed)
            return;
        this._manager = manager;
        const changed = () => this._emit();
        this._signals = [
            this._manager.connect('object-added', changed),
            this._manager.connect('object-removed', changed),
            this._manager.connect('interface-proxy-properties-changed', changed),
            this._manager.connect('notify::name-owner', changed),
        ];
    }

    destroy() {
        this._destroyed = true;
        if (this._manager)
            this._signals.forEach(id => this._manager.disconnect(id));
        this._manager = null;
        this._listeners.clear();
    }

    // Called on any change of the account set or of an account's properties.
    onChanged(fn) {
        this._listeners.add(fn);
        return () => this._listeners.delete(fn);
    }

    _emit() {
        for (const fn of this._listeners) {
            try {
                fn();
            } catch (e) {
                console.error(`gnome-meet-widget: accounts listener: ${e.message}`);
            }
        }
    }

    // Google accounts with the calendar enabled: [{id, email, attentionNeeded}].
    accounts() {
        if (!this._manager?.name_owner)
            return [];
        return this._manager.get_objects().flatMap(obj => {
            const account = obj.get_interface(ACCOUNT);
            if (!account || prop(account, 'ProviderType') !== 'google' ||
                prop(account, 'CalendarDisabled') !== false)
                return [];
            const path = obj.get_object_path();
            return [{
                id: path.slice(path.lastIndexOf('/') + 1),
                email: prop(account, 'PresentationIdentity') ?? prop(account, 'Identity'),
                attentionNeeded: prop(account, 'AttentionNeeded') === true,
            }];
        });
    }

    // Why there is no usable account, or null when there is one.
    problem() {
        if (!this._manager?.name_owner)
            return 'no-goa';
        const list = this.accounts();
        if (!list.length)
            return 'no-account';
        if (list.every(a => a.attentionNeeded))
            return 'attention';
        return null;
    }

    _iface(accountId, name) {
        const obj = this._manager?.get_object(`${MANAGER_PATH}/Accounts/${accountId}`);
        const iface = obj?.get_interface(name);
        if (!iface)
            throw new GoaError('no-account', `account ${accountId} is gone`);
        return iface;
    }

    // GOA refreshes the token itself when it expires.
    async token(accountId, cancellable = null) {
        const reply = await this._iface(accountId, OAUTH2).call(
            'GetAccessToken', null, Gio.DBusCallFlags.NONE, -1, cancellable);
        const [token] = reply.deepUnpack();
        return token;
    }

    // Ask GOA to re-check the credentials (after a 401). Throws when the
    // account needs the user to sign in again.
    async ensureCredentials(accountId, cancellable = null) {
        try {
            await this._iface(accountId, ACCOUNT).call(
                'EnsureCredentials', null, Gio.DBusCallFlags.NONE, -1, cancellable);
        } catch (e) {
            if (e instanceof GoaError || e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            throw new GoaError('attention', e.message);
        }
    }
}
