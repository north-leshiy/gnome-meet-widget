// Google Calendar API v3 client. The token is taken from GOA for every request.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_S = 15;

const EVENT_FIELDS = 'id,iCalUID,status,summary,start,end,location,description,attendees,' +
    'organizer,conferenceData/entryPoints,hangoutLink,htmlLink,recurringEventId,eventType,etag';
const CALENDAR_FIELDS = 'id,summary,summaryOverride,primary,selected,accessRole,backgroundColor';

const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded']);

export class ApiError extends Error {
    // kind: 'auth' | 'rate' | 'forbidden' | 'gone' | 'conflict' | 'network' | 'server'
    constructor(kind, status, reason, message) {
        super(message);
        this.kind = kind;
        this.status = status;
        this.reason = reason;
    }
}

function classify(status, reason) {
    if (status === 401)
        return 'auth';
    if (status === 429 || RATE_REASONS.has(reason))
        return 'rate';
    if (status === 403)
        return 'forbidden';
    if (status === 404 || status === 410)
        return 'gone';
    if (status === 412)
        return 'conflict';
    return 'server';
}

function query(params) {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
}

const isCancelled = e => e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

export class GoogleCalendarApi {
    // goa: {token(accountId, c), ensureCredentials(accountId, c)} — lib/goa.js
    constructor(goa) {
        this._goa = goa;
        this._session = new Soup.Session({timeout: TIMEOUT_S, user_agent: 'gnome-meet-widget'});
    }

    destroy() {
        this._session.abort();
        this._session = null;
    }

    async _request(accountId, method, url, {body = null, etag = null, cancellable = null} = {}) {
        for (let attempt = 0; ; attempt++) {
            const token = await this._goa.token(accountId, cancellable);
            const msg = Soup.Message.new(method, url);
            msg.request_headers.append('Authorization', `Bearer ${token}`);
            if (etag)
                msg.request_headers.append('If-Match', etag);
            if (body !== null) {
                msg.set_request_body_from_bytes('application/json',
                    new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
            }

            let bytes;
            try {
                bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
            } catch (e) {
                if (isCancelled(e))
                    throw e;
                throw new ApiError('network', 0, null, e.message);
            }

            const status = msg.get_status();
            const data = bytes?.get_size() ? bytes.get_data() : null;
            const text = data ? new TextDecoder().decode(data) : '';

            if (status === 401 && attempt === 0) {
                await this._goa.ensureCredentials(accountId, cancellable);
                continue;
            }
            if (status >= 200 && status < 300)
                return text ? JSON.parse(text) : null;

            let reason = null;
            let message = `HTTP ${status}`;
            try {
                const err = JSON.parse(text).error;
                reason = err?.errors?.[0]?.reason ?? err?.status ?? null;
                message = `HTTP ${status}: ${err?.message ?? reason ?? ''}`;
            } catch {
                // Not JSON, keep the status only.
            }
            throw new ApiError(classify(status, reason), status, reason, message);
        }
    }

    async _pages(accountId, url, params, cancellable) {
        const items = [];
        let pageToken;
        do {
            // eslint-disable-next-line no-await-in-loop
            const page = await this._request(accountId, 'GET',
                `${url}?${query({...params, pageToken})}`, {cancellable});
            items.push(...page.items ?? []);
            pageToken = page.nextPageToken;
        } while (pageToken);
        return items;
    }

    calendars(accountId, cancellable = null) {
        return this._pages(accountId, `${BASE}/users/me/calendarList`,
            {maxResults: 250, fields: `nextPageToken,items(${CALENDAR_FIELDS})`}, cancellable);
    }

    // Instances of recurring events come one by one (singleEvents).
    events(accountId, calendarId, timeMin, timeMax, cancellable = null) {
        return this._pages(accountId, `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
            singleEvents: true,
            orderBy: 'startTime',
            timeMin: new Date(timeMin).toISOString(),
            timeMax: new Date(timeMax).toISOString(),
            maxResults: 250,
            fields: `nextPageToken,items(${EVENT_FIELDS})`,
        }, cancellable);
    }

    event(accountId, calendarId, eventId, cancellable = null) {
        return this._request(accountId, 'GET',
            `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${
                query({fields: EVENT_FIELDS})}`, {cancellable});
    }

    // If-Match keeps the patch from overwriting a newer version of the event.
    patchAttendees(accountId, calendarId, eventId, attendees, {etag, sendUpdates, cancellable = null}) {
        return this._request(accountId, 'PATCH',
            `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${
                query({sendUpdates, fields: EVENT_FIELDS})}`,
            {body: {attendees}, etag, cancellable});
    }
}
