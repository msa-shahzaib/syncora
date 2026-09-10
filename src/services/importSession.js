'use strict';

const crypto = require('crypto');

const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map();

function createSession(data) {
    const id = crypto.randomUUID();
    sessions.set(id, { data, expiresAt: Date.now() + SESSION_TTL_MS });
    return id;
}

function getSession(id) {
    const entry = sessions.get(id);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        sessions.delete(id);
        return null;
    }
    return entry.data;
}

function deleteSession(id) {
    sessions.delete(id);
}

setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of sessions.entries()) {
        if (now > entry.expiresAt) sessions.delete(id);
    }
}, 5 * 60 * 1000).unref();

module.exports = { createSession, getSession, deleteSession };