# Heirloom — family tree prototype

A family tree you can lay out by hand, where every person carries a diary of
their life, and the whole thing can be handed to someone else with a link.

No build step, no accounts, and nothing to install to run it — the dependencies
in `package.json` are only for the tests.

## Run it

Either open `index.html` in a browser, or:

```bash
node server.js          # http://localhost:5173
```

The server is optional. It only adds short share links and a normal `http://`
origin (which makes saving and the clipboard behave better than `file://`).

The first run loads a sample family so there is something to poke at. Your work
is saved to the browser automatically — "Start fresh" in the bottom bar clears it.

## The three pieces you asked for

**Graphs that snap into place.** Drag any card. It snaps to the 20px grid, and
when it comes within range of another card's edge it magnets onto that line —
a dashed pink guide shows you which one it locked onto. **Tidy up** re-lays the
whole tree into proper generations: partners on the same row, children one row
below, parents centred over their children, nothing overlapping.

Select a card to get its action bar: add a parent, partner or child, or use
**Link partner** / **Link child** to join two people who are already on the
canvas. Links that would loop the tree (making someone their own ancestor) are
refused.

**Photos.** Drag an image file straight onto a card, or open someone's book and
click their portrait. The picture is cropped square and downscaled to a 256px
thumbnail before it is stored — a 240 KB photo lands at about 4 KB — so trees
stay small enough to fit in a link. People without a photo keep their initials.
"Remove photo" in the book puts them back.

**A book for each life.** Click the book icon on a card, or double-click it.
The left page is who they were and a table of contents; the right page is the
open chapter, on ruled paper, which you just type into. It saves as you write.
The badge on a card counts the chapters in their book.

Born and Died are date pickers, with a `≈` button beside each (it appears when
you hover the row) that swaps in a plain text box for the dates genealogy is
actually made of — `c. 1880`, `spring 1943`, `before the war`. The field
remembers which kind it is by looking at the value, so an approximate date stays
editable as text next time you open the book. Switching back to the picker never
discards what you wrote: it cannot display `c. 1880`, so it shows it alongside as
`was c. 1880` until you pick a real date. Cards show only years (`1921 – 1998`),
pulled out of either form.

"Known for" is two lines; anything longer is cut with an ellipsis and shown in
full when you hover it — click to edit.

A chapter has a start date and, if you want one, an **end date** — press
"+ end date" for anything that covers a stretch rather than a day. The contents
mark a spanning chapter with `→`, and an end date that falls before the start
is refused rather than stored.

**Sharing.** Press **Share** for a link. Anyone who opens it gets a read-only
copy of the tree *and* every life book in it, with a "Make a copy I can edit"
button if they want their own. Your tree is untouched by whatever they do.

With the server running, the link is short (`#s=63c051c9`) and the snapshot
lives in `./shares/` — delete a file there to revoke that link. Without it, the
whole tree is packed into the link itself (`#d=…`), which means it works from a
plain file with no server at all; a nine-person family with diaries comes to
about 1.5 KB. Photos are the one thing heavy enough to matter there, so when a
tree has any, the share dialog shows what they cost and lets you leave them out
of that link — your own copy keeps them either way. There is also Export/Import
for a `.json` file.

## Keys

`N` new person · `A` tidy up · `F` fit to screen · `Enter` open book ·
`Del` remove · `Ctrl+Z` / `Ctrl+Shift+Z` undo, redo · drag background to pan ·
`Ctrl+scroll` to zoom.

## Layout

```
index.html        markup for the canvas, book and share dialog
styles.css        all of the styling
js/state.js       the document, graph queries and edits, undo, saving
js/photo.js       cropping and downscaling a picked file into a portrait
js/layout.js      the "Tidy up" engine — generations, then a tidy x-pass
js/tree.js        canvas: rendering, pan/zoom, dragging, snapping, guides
js/book.js        the two-page life book
js/share.js       link encoding, export/import, opening a shared tree
server.js         optional zero-dependency static server + share storage
test/             npm test — five jsdom suites plus a real-browser pass
```

## What a prototype this size doesn't do yet

- **Sharing is a snapshot, not a live document.** Press Share again after making
  changes and you get a new link; the old one still shows the older tree. Shared
  links are also read-only by design — there is no collaborative editing, and no
  accounts, so a link *is* the permission. Anyone who has it can read everything.
- **Share storage is a folder of files** with no expiry and no access control.
  Fine on your own machine; it is not ready to face the internet as-is.
- **One partnership per couple.** A person can have several partners, but
  remarriages and step-families draw as separate unions rather than anything
  cleverer, and a child belongs to exactly one union.
- **Photos are stored inside the document**, not as files, and only the
  thumbnail is kept — the original resolution is gone once you drop it in. That
  keeps sharing and export self-contained, but it is not somewhere to archive
  the only copy of a family photograph. One portrait per person, no albums.
- **Browser storage is finite** (a few MB). A tree with many photos can reach
  it; the app now says so plainly instead of failing quietly, but the fix is to
  Export.
- **Approximate dates are text, not data.** `c. 1880` is stored as typed, and
  nothing sorts or reasons about it beyond pulling a four-digit year out for the
  card. Chapter dates are still exact-only.
- Undo covers the last 60 edits and is not persisted across a reload.

## Tests

```bash
npm install
npx playwright install chromium   # once, for the browser suite
npm test                          # or: npm test browser
```

Six suites, run against a real instance of the app: the document model and
layout, share-link encoding, the wired-up page, sharing end to end, photos, and
a real-Chromium pass.

That last one earns its keep. The first five run in `jsdom`, which does no
layout and no hit-testing — it once reported a page as fine while every click
was being swallowed by an invisible overlay. Only the browser suite can catch
that, so it also holds a regression test that puts the bug back and proves the
click dies. Without Chromium installed it reports `SKIPPED` rather than
pretending to pass.
