// Read-only probe against the real GOA: lists Google accounts and the token
// length (never the token). With --watch keeps running and prints changes.
import GLib from 'gi://GLib';
import {GoaAccounts} from '../extension/lib/goa.js';

const goa = new GoaAccounts();
await goa.start();
print(`problem: ${goa.problem()}`);
for (const a of goa.accounts()) {
    const token = await goa.token(a.id);
    print(`${a.id} ${a.email} attention=${a.attentionNeeded} token.length=${token.length}`);
}
if (ARGV.includes('--watch')) {
    const loop = new GLib.MainLoop(null, false);
    goa.onChanged(() => print(`accounts-changed: ${JSON.stringify(goa.accounts())}`));
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Number(ARGV[1] ?? 20), () => loop.quit());
    loop.run();
}
