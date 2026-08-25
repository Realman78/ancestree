# Ancestree

Build a family tree by hand, and give every person a book to write their life
into.

Most family-tree tools are good at the diagram and stop there — names, dates, a
box on a chart. Ancestree treats the chart as half the point. Click anyone and a
two-page book opens where you write down what they did, what happened to them,
what they were like. The tree is how you find people; the books are why you keep
it.

Everything runs in your browser. No account, no server, no upload.

## Try it

Open `index.html` in a browser — that is the whole install.

Or serve it, which some browsers prefer to `file://`:

```bash
node server.js          # http://localhost:5173
```

That server is a plain static file server with no dependencies, and it stores
nothing.

Your first visit is an empty board. **Load sample family** in the bottom bar
fills it with the Millers if you want something to poke at first.

## What it does

**A canvas you arrange yourself.** Drag cards around; they snap to a grid and
magnet onto each other's edges. **Tidy up** lays the whole tree out into
generations — partners on a row, children below, parents centred over them,
nothing overlapping. Zoom, pan, fit to screen.

**A life book for each person.** Portrait, dates, birthplace, the surname they
were born with, what they were known for — then chapters. Each chapter has a
title, a date or a span of dates, and as much text as you want. It saves as you
type.

**Relationships that match real families.** Someone can have several partners,
each with their own children. Mark a relationship as married, unmarried
partners, or ended, and record the years it ran. Remarriages, half-siblings,
two families joined by a marriage — the layout keeps couples together and never
seats a stranger between two people who were married.

**Photos.** Drag an image onto a card, or pick one in the book. It is cropped
square and shrunk to a thumbnail before being stored, so a tree stays small.

**As many trees as you like**, side by side, switchable from the title bar.

**Ways out:**

| | |
|---|---|
| **JSON** | the whole tree — the only form that can be imported back |
| **SVG** | a vector drawing of the canvas |
| **Detailed SVG** | a chart with large portraits, full dates, places and notes |
| **PNG** | the canvas as an image |
| **Chapters** | one person's written life, as Markdown or as a PDF through your browser's print dialog |
| **Backup** | every tree you have, in a single file |

**Undo everywhere.** Nothing asks "are you sure" — it happens, tells you what it
did, and offers Undo.

**Works offline, and installs.** Once you have opened it, it keeps working with
no connection — on a plane, in a basement, at a relative's house with bad wifi.
Your browser will also offer to install it as its own app.

## Keys

`N` new person · `A` tidy up · `F` fit to screen · `Enter` open book ·
`Del` remove the selected person or link · `Esc` deselect ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo and redo · drag the background to pan ·
`Ctrl+scroll` to zoom

## Where your data lives

In your browser's local storage, on your own machine. That has a consequence
worth stating plainly: **it does not follow you to another browser or device,
and clearing your site data deletes it.** Use **Back up all trees** and keep the
file somewhere safe — that backup is also how you move a tree to another
computer.

There is no sharing feature, by design. To give someone a tree, send them the
file.

## Working on it

```bash
npm install
npx playwright install chromium   # once, for the browser tests
npm test
```

Seven suites run against a real instance of the app: the document model and
layout, the tree shelf, the wired-up page, export and import, photos, a
real-Chromium pass that does layout and hit-testing — the only one that can
catch "it renders, but nothing is clickable" — and an offline pass that pulls
the network out from under a live page.

```
index.html        the canvas, the book, the menus
styles.css        all of the styling
sw.js             offline cache — network first, so it can never pin an old build
manifest.webmanifest  makes it installable
js/state.js       the document, relationships, undo
js/library.js     many trees in local storage
js/layout.js      the "Tidy up" engine
js/tree.js        canvas: rendering, dragging, connectors
js/book.js        the two-page life book
js/photo.js       cropping and shrinking a portrait
js/exchange.js    export and import
js/main.js        toolbar, keyboard, startup
server.js         optional static file server
```

No build step and no runtime dependencies — the packages in `package.json` are
only for the tests.

## Known limits

- A child belongs to one couple; there is no separate notion of step-parents or
  adoption.
- Approximate dates (`c. 1880`) are stored as text — nothing sorts or reasons
  about them beyond pulling out a year.
- Only a thumbnail of each photo is kept, so this is not the place to archive
  the only copy of a family photograph.
- Undo does not survive a page reload.

## Open source, and why that matters here

Ancestree is MIT licensed, and everything it does is in this repository — a few
files of plain JavaScript you can read in an afternoon.

That is worth saying plainly for an app like this one. It asks you to write down
your family's private history: births, deaths, marriages that ended, whatever
your grandmother told you once. So it should be **checkable**, not merely
promised, that none of it goes anywhere.

There is no analytics, no telemetry, no account, and nothing to log in to.
Nothing you write is ever sent anywhere.

The only requests the app makes are for its own files — the page, the stylesheet,
the scripts — from wherever you loaded it. `js/` contains no `fetch` call at all;
the one in `sw.js` is the offline cache asking for those same files, and it
refuses any address that is not this app's own. Watch your browser's network tab
while you use it and you will see nothing else.

The optional `server.js` serves files and stores nothing.

Your family's history stays on your machine, in a file you own.
