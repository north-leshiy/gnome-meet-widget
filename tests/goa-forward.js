// Test-only: serves org.gnome.OnlineAccounts on the nested devkit bus by
// forwarding to GOA of the real session. A nested goa-daemon cannot unlock
// the user's keyring (no prompt in a headless Shell), so tokens time out.
//
//   gjs -m tests/goa-forward.js <real-session-bus-address>
// Runs on the bus in DBUS_SESSION_BUS_ADDRESS (the nested one). Mirrors Google
// accounts only, exposes just what lib/goa.js uses, and forwards the
// CalendarDisabled/AttentionNeeded changes.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'org.gnome.OnlineAccounts';
const ROOT = '/org/gnome/OnlineAccounts';

const IFACES = `<node>
  <interface name="org.gnome.OnlineAccounts.Account">
    <property name="ProviderType" type="s" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="PresentationIdentity" type="s" access="read"/>
    <property name="CalendarDisabled" type="b" access="readwrite"/>
    <property name="AttentionNeeded" type="b" access="read"/>
    <method name="EnsureCredentials"><arg name="expires_in" type="i" direction="out"/></method>
  </interface>
  <interface name="org.gnome.OnlineAccounts.OAuth2Based">
    <method name="GetAccessToken">
      <arg name="access_token" type="s" direction="out"/>
      <arg name="expires_in" type="i" direction="out"/>
    </method>
  </interface>
</node>`;
const info = Gio.DBusNodeInfo.new_for_xml(IFACES);
const [ACCOUNT_INFO, OAUTH_INFO] = info.interfaces;

const real = Gio.DBusConnection.new_for_address_sync(ARGV[0],
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    null, null);
const realManager = Gio.DBusObjectManagerClient.new_sync(real, Gio.DBusObjectManagerClientFlags.NONE,
    NAME, ROOT, null, null);

const server = new Gio.DBusObjectManagerServer({object_path: ROOT});
const skeletons = new Map();

function forward(path, iface, method) {
    return (params, invocation) => {
        real.call(NAME, path, iface, method, null, null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
            try {
                invocation.return_value(c.call_finish(res));
            } catch (e) {
                invocation.return_gerror(e);
            }
        });
    };
}

function mirror(obj) {
    const path = obj.get_object_path();
    const account = obj.get_interface('org.gnome.OnlineAccounts.Account');
    if (!account || account.get_cached_property('ProviderType')?.unpack() !== 'google')
        return;
    const get = n => account.get_cached_property(n);

    const accountSkel = Gio.DBusExportedObject.wrapJSObject(ACCOUNT_INFO, {
        get ProviderType() {
            return 'google';
        },
        get Identity() {
            return get('Identity').unpack();
        },
        get PresentationIdentity() {
            return get('PresentationIdentity').unpack();
        },
        get CalendarDisabled() {
            return get('CalendarDisabled').unpack();
        },
        set CalendarDisabled(v) {
            real.call_sync(NAME, path, 'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', ['org.gnome.OnlineAccounts.Account', 'CalendarDisabled',
                    new GLib.Variant('b', v)]), null, Gio.DBusCallFlags.NONE, -1, null);
        },
        get AttentionNeeded() {
            return get('AttentionNeeded').unpack();
        },
        EnsureCredentialsAsync: forward(path, 'org.gnome.OnlineAccounts.Account', 'EnsureCredentials'),
    });
    const oauthSkel = Gio.DBusExportedObject.wrapJSObject(OAUTH_INFO, {
        GetAccessTokenAsync: forward(path, 'org.gnome.OnlineAccounts.OAuth2Based', 'GetAccessToken'),
    });

    const skel = Gio.DBusObjectSkeleton.new(path);
    skel.add_interface(accountSkel);
    skel.add_interface(oauthSkel);
    server.export(skel);
    skeletons.set(path, {skel, accountSkel});

    account.connect('g-properties-changed', (_p, changed) => {
        for (const name of Object.keys(changed.deepUnpack()))
            accountSkel.emit_property_changed(name, get(name));
    });
}

realManager.get_objects().forEach(mirror);
realManager.connect('object-added', (_m, obj) => mirror(obj));
realManager.connect('object-removed', (_m, obj) => {
    const path = obj.get_object_path();
    if (skeletons.has(path)) {
        server.unexport(path);
        skeletons.delete(path);
    }
});

const nested = Gio.DBus.session;
server.set_connection(nested);
Gio.bus_own_name_on_connection(nested, NAME, Gio.BusNameOwnerFlags.NONE,
    () => print(`goa-forward: serving ${skeletons.size} Google account(s)`),
    () => {
        printerr('goa-forward: name is taken on the nested bus');
        loop.quit();
    });

const loop = new GLib.MainLoop(null, false);
loop.run();
