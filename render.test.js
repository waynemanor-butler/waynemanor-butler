const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderReadme, commitMessage, dayOfService, escapeMarkdown, remark } = require('./render.js');

// Shapes match what iiSmitty/my-website publishes (November 2026)
const coffee = {
    totalSiteVisits: 161,
    currentBalance: 0,
    freeBeveragesRedeemed: 31,
    freeBeveragesAvailable: 1,
    lastVisitAt: '2026-11-14T14:39:18.100Z',
};
const watching = {
    inProgress: [
        { title: 'The Celebrity Traitors', episode: { season: 1, number: 4 }, watched: 4, aired: 9, lastWatchedAt: '2026-11-15T19:00:00.000Z' },
        { title: 'House', episode: { season: 3, number: 16, title: 'Top Secret' }, watched: 62, aired: 177, lastWatchedAt: '2026-10-19T07:43:00.000Z' },
    ],
    previous: { title: 'Reacher', episodes: 32, finishedAt: '2026-09-16T19:00:00.000Z' },
    movies: [{ title: 'Addams Family Values', year: 1993, watchedAt: '2026-09-30T19:00:00.000Z' }],
};
const sponsors = { sponsors: [{ login: 'someone', coffees: 2 }] };

// 19:00 SAST on 16 November 2026
const evening = new Date('2026-11-16T17:00:00Z');

test('the full ledger, from real-shaped data', () => {
    const readme = renderReadme({ coffee, watching, sponsors }, evening);
    assert.match(readme, /In service since 10 June 2026\. Today is day 160\./);
    assert.match(readme, /\| ☕ Coffee \| 161 visits\. Card at 0 of 10\. 1 free cup in reserve, 31 redeemed\. \|/);
    assert.match(readme, /\| ☕ Last visit \| 14 November 2026 \|/);
    assert.match(readme, /\| 📼 Now watching \| The Celebrity Traitors, S1E4 \(4 of 9\)<br>House, S3E16 \(62 of 177\) \|/);
    assert.match(readme, /\| 📼 Last finished \| Reacher, 32 episodes\. Finished 16 September 2026\. \|/);
    assert.match(readme, /\| 🎬 Last film \| Addams Family Values \(1993\), 30 September 2026 \|/);
    assert.match(readme, /\| 🤝 Patrons \| \[1 patron\]\(https:\/\/github\.com\/sponsors\/iiSmitty\), 2 coffees stood in all\. \|/);
    assert.match(readme, /<sub>Last inspected 16 November 2026 at 19:00 SAST\. All in order\.<\/sub>/);
});

test('the date and time are SAST, not UTC', () => {
    // 23:30 UTC on the 16th is already 01:30 on the 17th in Johannesburg
    const late = new Date('2026-11-16T23:30:00Z');
    assert.equal(dayOfService(late), 161);
    assert.match(renderReadme({}, late), /Last inspected 17 November 2026 at 01:30 SAST/);
});

test('his first day is day 1', () => {
    assert.equal(dayOfService(new Date('2026-06-10T08:00:00Z')), 1);
});

test('missing data leaves rows out rather than printing blanks', () => {
    const readme = renderReadme({ coffee: {}, watching: {}, sponsors: {} }, evening);
    assert.doesNotMatch(readme, /Coffee \||Last visit|Now watching|Last finished|Last film/);
    assert.doesNotMatch(readme, /undefined|NaN|null/);
    assert.match(readme, /\| 🤝 Patrons \| None as yet\./);
});

test('a show without an episode or counts still gets its title', () => {
    const readme = renderReadme({ watching: { inProgress: [{ title: 'Something' }] } }, evening);
    assert.match(readme, /\| 📼 Now watching \| Something \|/);
});

test('titles cannot break the table or the markdown', () => {
    assert.equal(escapeMarkdown('Law | Order\n*SVU*'), 'Law \\| Order \\*SVU\\*');
    const readme = renderReadme({ watching: { inProgress: [{ title: 'A | B <script>' }] } }, evening);
    assert.match(readme, /A \\\| B \\<script\\>/);
});

test('a quiet week, by the same rule as the site', () => {
    const now = Date.parse('2026-11-30T17:00:00Z');
    assert.equal(remark(coffee, watching, now), 'A quiet week. I have dusted regardless.');
});

test('a recent episode keeps the week from being quiet', () => {
    const now = Date.parse('2026-11-21T17:00:00Z'); // coffee 7 days stale, episode 6 days ago
    assert.equal(remark(coffee, watching, now), 'All in order.');
});

test('no coffee date never makes a week quiet', () => {
    const now = Date.parse('2027-01-30T17:00:00Z');
    assert.equal(remark({}, watching, now), 'All in order.');
});

test('he mentions a growing reserve of free cups', () => {
    assert.equal(remark({ ...coffee, freeBeveragesAvailable: 3 }, watching, evening), '3 free cups in reserve. Do spend one, sir.');
});

test('the commit message changes daily and names the day', () => {
    const today = commitMessage(evening);
    const tomorrow = commitMessage(new Date('2026-11-17T17:00:00Z'));
    assert.match(today, /^Day 160\. \S/);
    assert.match(tomorrow, /^Day 161\. \S/);
    assert.notEqual(today.slice(8), tomorrow.slice(8));
});
