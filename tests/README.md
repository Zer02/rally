# Rally tests

Three suites. Together they check the rules in the database, the same rules in
the front end, and what a phone actually shows. Nothing here touches your real
Supabase project: the database tests build throwaway databases, and the browser
tests run the real app against made-up data.

| Command | What it checks | Needs |
|---|---|---|
| `npm run test:js` | The score and points rules in `src/lib/score.ts` | Node only. Takes a second. |
| `npm run test:db` | Every migration, replayed in order, plus the rules as the database enforces them | A local Postgres (see below) |
| `npm run test:browser` | Every page at 375px, 320px and 1280px (no sideways scroll, nothing cut off), the tab bar, the remove "x", the points key, the profile lists, and score entry | Playwright (see below) |
| `npm test` | `js` + `db` | Postgres |

`npm test` fails, loudly, if Postgres can't be reached. It does not quietly skip.

## What the database tests prove

- The base schema and **every** `supabase-migration-v*.sql` file apply, in version
  order, with no SQL errors; the recent ones can be run twice without changing anything,
  and refuse to run when the version before them is missing.
- `rr_games_to_win()`, `rr_score_is_legal()` and `rr_match_points()` give the right
  answer for every score from 0-0 to 9-9, and `src/lib/score.ts` gives the *same*
  answer for all of them. If someone changes the rule in one place only, this fails.
- Reporting a match accepts legal scores, refuses the rest with a reason, and refuses a
  second report of the same match.
- A staged season (singles, doubles, a challenge, a ladder match, three weeks) produces
  exactly the round robin points and battle pass XP that an independent calculation in
  the test predicts, including full rate for five matches a week and the trickle after.
  Syncing twice changes nothing; removing a match takes back its points and XP.
- Upgrading a database that already holds results from an earlier version keeps its
  history, and the score audit lists results that no longer count as a legal score.

## Running the database tests

You need a Postgres you can create databases in (a local install or a throwaway Docker
container is fine; **do not point this at your real Supabase database**). Connection
settings are the usual `PG*` variables:

```
docker run -d --name rally-pg -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:16
export PGHOST=localhost PGUSER=postgres PGPASSWORD=pw
npm run test:db
```

The tests create and drop their own databases (names start with `rally_t_`). They use
the `psql` command line, so `psql` must be installed. `tests/db/stub-supabase.sql`
stands in for the parts of Supabase that migrations lean on (the `auth` schema, roles).

## Running the browser tests

Playwright is not a project dependency (it is large), so install it once, without
saving it to `package.json`:

```
npm i --no-save playwright
npx playwright install chromium
npm run test:browser
```

Or point `CHROME_PATH` at an installed Chrome/Chromium instead of the second line. The
app runs with `src/lib/supabase.ts` swapped for `tests/browser/harness/`, which serves
the made-up data in `fixtures.ts`. A few switches change it per test (signed out, no
ladder matches, one unreported match); see the top of `supabase-mock.ts`.

## When you change a rule

1. Change it in the database (a new migration) **and** in `src/lib/score.ts`.
2. Run `npm test`. A mismatch between the two shows up as a failing "the front end and
   the database agree" test.
3. If the change moves what a page shows, run `npm run test:browser` too.

When you add a migration, nothing needs registering: the tests pick up every
`supabase-migration-v*.sql` file in the repo root.
