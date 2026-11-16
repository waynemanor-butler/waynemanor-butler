'use strict';

/**
 * Rewrites Alfred's profile README from the household data that
 * iiSmitty/my-website publishes (data/coffee-stats.json, watching.json and
 * sponsors.json), then prints the commit message to stdout.
 *
 * The README carries the day of service and the time of inspection, so it
 * changes every day and every run commits. That is on purpose: it keeps
 * GitHub from pausing the schedule, and a butler doesn't take days off.
 *
 * If any data file can't be fetched, nothing is written and the run fails,
 * so a bad morning never leaves a half-empty ledger on the profile.
 */

const fs = require('fs');
const path = require('path');

const DATA_BASE = 'https://raw.githubusercontent.com/iiSmitty/my-website/main/data/';
const README_PATH = path.join(__dirname, 'README.md');
const TIME_ZONE = 'Africa/Johannesburg';
const FIRST_DAY = '2026-06-10'; // his first entry in the household ledger
const DAY_MS = 24 * 60 * 60 * 1000;
const QUIET_DAYS = 7;           // the same quiet week that makes the site's PC Tired
const RESERVE_NUDGE = 3;        // free cups in reserve before he says something
const FETCH_ATTEMPTS = 3;

const SITE = 'https://andresmit.co.za';
const OWNER = 'https://github.com/iiSmitty';
const LEDGER = 'https://github.com/iiSmitty/my-website/commits?author=waynemanor-butler';
const SPONSORS = 'https://github.com/sponsors/iiSmitty';

// One a day, in turn, prefixed with the day of service
const ROUNDS = [
    'Evening rounds complete.',
    'Ledger checked, silver counted.',
    'Rounds done. Nothing amiss.',
    'Inspected and initialled.',
    'Doors locked, ledger balanced.',
    'The house is in order, sir.',
    'Evening inspection. Carry on, sir.',
];

// --- formatting ---

/** Text from outside (show titles) can't break the markdown it sits in */
function escapeMarkdown(text) {
    return String(text).replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>|#~]/g, '\\$&');
}

function validDate(iso) {
    const time = Date.parse(iso);
    return Number.isFinite(time) ? new Date(time) : null;
}

/** "14 November 2026", in SAST */
function longDate(date) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

/** "19:00", in SAST */
function clockTime(date) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

/** The calendar day in SAST as a UTC midnight, so days can be subtracted */
function sastDay(date) {
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    return Date.parse(`${ymd}T00:00:00Z`);
}

/** His first day is day 1 */
function dayOfService(now) {
    return Math.round((sastDay(now) - Date.parse(`${FIRST_DAY}T00:00:00Z`)) / DAY_MS) + 1;
}

function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}

function isCount(n) {
    return Number.isInteger(n) && n >= 0;
}

function episodeCode(episode) {
    if (!episode || !isCount(episode.season) || !isCount(episode.number)) return '';
    return `S${episode.season}E${episode.number}`;
}

// --- the ledger ---

function coffeeEntry(coffee) {
    const parts = [];
    if (isCount(coffee.totalSiteVisits)) parts.push(`${plural(coffee.totalSiteVisits, 'visit')}.`);
    if (isCount(coffee.currentBalance)) parts.push(`Card at ${coffee.currentBalance} of 10.`);
    const reserve = coffee.freeBeveragesAvailable;
    const redeemed = coffee.freeBeveragesRedeemed;
    if (isCount(reserve) && isCount(redeemed)) {
        parts.push(`${plural(reserve, 'free cup')} in reserve, ${redeemed} redeemed.`);
    } else if (isCount(redeemed)) {
        parts.push(`${plural(redeemed, 'free cup')} redeemed.`);
    }
    return parts.join(' ');
}

function watchingEntry(shows) {
    return shows
        .filter(show => show && show.title)
        .map(show => {
            const code = episodeCode(show.episode);
            const progress = isCount(show.watched) && isCount(show.aired) ? ` (${show.watched} of ${show.aired})` : '';
            return `${escapeMarkdown(show.title)}${code ? `, ${code}` : ''}${progress}`;
        })
        .join('<br>');
}

function finishedEntry(previous) {
    if (!previous || !previous.title) return '';
    const episodes = isCount(previous.episodes) ? `, ${plural(previous.episodes, 'episode')}` : '';
    const finished = validDate(previous.finishedAt);
    return `${escapeMarkdown(previous.title)}${episodes}${finished ? `. Finished ${longDate(finished)}.` : ''}`;
}

function filmEntry(movies) {
    const film = Array.isArray(movies) && movies.find(movie => movie && movie.title);
    if (!film) return '';
    const year = isCount(film.year) ? ` (${film.year})` : '';
    const watched = validDate(film.watchedAt);
    return `${escapeMarkdown(film.title)}${year}${watched ? `, ${longDate(watched)}` : ''}`;
}

function patronsEntry(sponsors) {
    if (!Array.isArray(sponsors) || sponsors.length === 0) return `None as yet. [The door is open.](${SPONSORS})`;
    const coffees = sponsors.reduce((sum, sponsor) => sum + (isCount(sponsor && sponsor.coffees) ? sponsor.coffees : 0), 0);
    return `[${plural(sponsors.length, 'patron')}](${SPONSORS}), ${plural(coffees, 'coffee')} stood in all.`;
}

/** The latest episode, finished series or film the data knows of */
function lastWatched(watching) {
    const times = [
        ...(watching.inProgress || []).map(show => show && show.lastWatchedAt),
        watching.previous && watching.previous.finishedAt,
        ...(watching.movies || []).map(movie => movie && movie.watchedAt),
    ].map(validDate).filter(Boolean).map(date => date.getTime());
    return times.length ? Math.max(...times) : null;
}

/** One dry line under the ledger. Only known dates make a week quiet, as on the site. */
function remark(coffee, watching, now) {
    const coffeeAt = validDate(coffee.lastVisitAt);
    const watchedAt = lastWatched(watching);
    const stale = time => time !== null && now - time > QUIET_DAYS * DAY_MS;
    if (coffeeAt && stale(coffeeAt.getTime()) && stale(watchedAt)) {
        return 'A quiet week. I have dusted regardless.';
    }
    if (isCount(coffee.freeBeveragesAvailable) && coffee.freeBeveragesAvailable >= RESERVE_NUDGE) {
        return `${plural(coffee.freeBeveragesAvailable, 'free cup')} in reserve. Do spend one, sir.`;
    }
    return 'All in order.';
}

function renderReadme({ coffee = {}, watching = {}, sponsors = {} }, now) {
    const rows = [
        ['☕ Coffee', coffeeEntry(coffee)],
        ['☕ Last visit', validDate(coffee.lastVisitAt) ? longDate(validDate(coffee.lastVisitAt)) : ''],
        ['📼 Now watching', watchingEntry(watching.inProgress || [])],
        ['📼 Last finished', finishedEntry(watching.previous)],
        ['🎬 Last film', filmEntry(watching.movies)],
        ['🤝 Patrons', patronsEntry(sponsors.sponsors)],
    ].filter(([, entry]) => entry);

    return [
        '<!-- Rewritten every evening by .github/workflows/inspect.yml from the data in iiSmitty/my-website. Hand edits will not survive the night. -->',
        '',
        `Butler to [Master Wayne](${OWNER}). I keep the household ledger for [andresmit.co.za](${SITE}); my entries are in [the commit history](${LEDGER}).`,
        '',
        `In service since ${longDate(new Date(`${FIRST_DAY}T12:00:00Z`))}. Today is day ${dayOfService(now)}.`,
        '',
        '#### The household ledger',
        '',
        '| Account | Entry |',
        '| --- | --- |',
        ...rows.map(([account, entry]) => `| ${account} | ${entry} |`),
        '',
        `<sub>Last inspected ${longDate(now)} at ${clockTime(now)} SAST. ${remark(coffee, watching, now)}</sub>`,
        '',
    ].join('\n');
}

function commitMessage(now) {
    const day = dayOfService(now);
    return `Day ${day}. ${ROUNDS[((day % ROUNDS.length) + ROUNDS.length) % ROUNDS.length]}`;
}

// --- fetching ---

async function fetchJson(name) {
    let lastError;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await fetch(DATA_BASE + name, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
            return JSON.parse((await response.text()).replace(/^﻿/, ''));
        } catch (error) {
            lastError = error;
            if (attempt < FETCH_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, attempt * 5000));
        }
    }
    throw lastError;
}

async function main() {
    const [coffee, watching, sponsors] = await Promise.all(
        ['coffee-stats.json', 'watching.json', 'sponsors.json'].map(fetchJson)
    );
    const now = new Date();
    fs.writeFileSync(README_PATH, renderReadme({ coffee, watching, sponsors }, now));
    process.stdout.write(commitMessage(now));
}

if (require.main === module) {
    main().catch(error => {
        console.error(`The rounds were cut short: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { renderReadme, commitMessage, dayOfService, escapeMarkdown, remark };
