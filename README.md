# Ancestree

A family tree you can lay out by hand, where every person carries a diary of
their life.

Everything stays on your own machine. No accounts, no server, no build step —
the dependencies in `package.json` are only for the tests.

## Run it

Either open `index.html` in a browser, or:

```bash
node server.js          # http://localhost:5173
```

The server is optional and stores nothing — it just serves the folder over
`http`, which gives saving and downloads a normal origin to work with. The app
is a static site: any host will do.

**Your first visit is an empty board.** "Load sample family" in the bottom bar
fills it with the Millers if you want something to poke at first; it asks before
replacing a board that already has people on it.

## What it does

**Graphs that snap into place.** Drag any card. It snaps to the 20px grid, and
when it comes within range of another card's edge it magnets onto that line —
a dashed pink guide shows you which one it locked onto. **Tidy up** re-lays the
whole tree into proper generations: partners on the same row, children one row
below, parents centred over their children, nothing overlapping.

Select a card to get its action bar: add a parent, partner or child, or use
**Link partner** / **Link child** to join two people who are already on the
canvas. Links that would loop the tree (making someone their own ancestor) are
refused.

**A new person is named on the spot.** However they were added, their name
becomes a field on the card with the placeholder selected, so you can just type.
`Enter` finishes, `Esc` puts the old name back, clicking away keeps what you
typed. The book is still a click away for everything else.

**The lines are relationships, and you can click them.** A selected line
highlights along its whole route and offers **Remove link**; `Del` does the same.
Removing a partner line separates the couple — if they had children the union
stays with the left-hand partner, so nobody is orphaned. Removing a child line
detaches that person from their parents and leaves them on the canvas.

**Nothing asks "are you sure".** Browsers can suppress dialogs, and a suppressed
`confirm()` returns false, which meant deleting quietly did nothing at all.
So every destructive step just happens, says what it did, and offers **Undo** in
the toast right where the loss occurred — with **Undo**/**Redo** in the toolbar
and `Ctrl+Z` / `Ctrl+Shift+Z` as well. Where a step genuinely cannot be undone —
deleting a whole tree — an in-app dialog asks first. Not the browser's, so a
blocked dialog cannot swallow it.

**Several partners, and children by each.** A person can be in any number of
relationships, each with its own children. Tidy-up keeps a whole partnership
group together — nobody unrelated is ever parked between a couple, because two
cards side by side read as married and that would make the drawing say something
untrue. Each family drops onto its own bus so two sets of children never merge
into one row of siblings, and where somebody has so many partners that one
connector has to reach past a card, it is routed *under* the row so it visibly
goes around rather than hiding behind.

Set what a relationship was — **married**, **partners**, or **ended**, and the
years it ran — either in the person's book under **Relationships**, or by
selecting the line itself. The year boxes take digits only. The line is captioned (`m. 1948 – 1961`), an
unmarried partnership is dashed, and one that ended carries the genealogical
double-slash. Relationships order chronologically, so remarriages read left to
right. Nothing is drawn when no dates are recorded, so trees that do not track
this stay clean.

**Two couples whose children share a row get their own bus depth.** Someone who
marries into another family sits beside their spouse, so their own parents' line
has to reach across the chart to collect them — at a shared depth that line
merges with the other couple's and every child below looks like it belongs to
whichever you happen to trace back to. Buses are packed into lanes per row so
that cannot happen.

**Where two connectors cross**, the horizontal one arcs over the other — the
drafting convention, which reads as "these do not meet" without needing a legend
the way a second colour would. Lines belonging to the same union share their
route by design and are left alone, as are junctions where lines genuinely meet.

**Partners from different generations** — someone partnered with a descendant —
are rare but real, and are drawn as a dashed curve instead of the usual squared
connector. Such a couple cannot share a generation row, so they keep their own,
and partnering never rewrites who anyone's parents are.

**Photos.** Drag an image file straight onto a card, or open someone's book and
click their portrait. The picture is cropped square and downscaled to a 256px
thumbnail before it is stored — a 240 KB photo lands at about 4 KB — so trees
stay small in the browser. People without a photo keep their initials.
"Remove photo" in the book puts them back.

**A book for each life.** Click the book icon on a card, or double-click it.
The left page is who they were and a table of contents; the right page is the
open chapter, on ruled paper, which you just type into. It saves as you write.

**Gender** is a field on each person (Woman / Man / Unspecified) that sets the
card's tint and matches the legend in the bottom bar.

**Born as** records the surname someone carried before marrying. It shows on the
card (`born Buljan`, under the name), in the book, and as its own row in the
detailed export. A long one is ellipsed — the card has 72px of content height
and a two-line name already claims most of it.

Born and Died are date pickers, with a `≈` button beside each that swaps in a plain text box for the dates genealogy is
actually made of — `c. 1880`, `spring 1943`, `before the war`. The field
remembers which kind it is by looking at the value, so an approximate date stays
editable as text next time you open the book. Switching back to the picker never
discards what you wrote: it cannot display `c. 1880`, so it shows it alongside as
`was c. 1880` until you pick a real date. Cards show only years (`1921 – 1998`),
pulled out of either form.

"Known for" is two lines; anything longer is cut with an ellipsis and shown in
full when you hover it — click to edit.

**Exporting one life.** At the foot of the Chapters list in someone's book,
**Markdown** downloads their chapters as a document — the person, their dates,
and every chapter in order. **PDF** opens a print view; your browser's *Save as
PDF* turns it into a file. There is no bundled PDF library: the browser's own
print engine typesets better than anything this project could carry, and it
keeps the app dependency-free.

A chapter has a start date and, if you want one, an **end date** — press
"+ end date" for anything that covers a stretch rather than a day. The contents
mark a spanning chapter with `→`, and an end date that falls before the start
is refused rather than stored.

**Many trees, one browser.** The count beside the title opens your shelf: every
tree you have made, newest first, with how many people are in each. **+ New
tree** opens an empty board — it never touches the one you were on — and each
tree is stored separately. Deleting one asks first, and that is the single
action here that undo cannot reach.

**Back up all trees** writes your whole shelf into one file. Import reads it
back, so a new browser can be restored in one step.

**Getting a tree out.** **Export** offers three forms:

| | |
|---|---|
| **JSON** | the whole tree, the only form that can be imported back |
| **SVG** | a vector drawing of the canvas, portraits and all, in one file |
| **Detailed SVG** | a proper chart: large portraits, room for long names, full dates with day and month, birth surname, birthplace, a two-line "known for", and how many chapters each book holds |
| **PNG** | the canvas drawing as an image, rendered at 2× |

The detailed export scales the arrangement up around its much bigger cards, so
the layout you built is preserved without them colliding. A sparse person gets a
sparse card — rows appear only where there is something to show.

Text is fitted by measuring it, not by counting characters: long words are
broken, anything that still will not fit is ellipsed, and each card clips its
own contents so a font substituted on another machine cannot let text escape.

**Import** reads JSON only — a picture cannot be turned back into a family tree
— and always opens as a *new* tree, so an import can never overwrite your work.
It takes either a single tree or a whole backup.

There is no sharing feature. Send someone the JSON (or the picture) and they can
open it themselves; nothing is uploaded anywhere, and there is no server holding
copies of anyone's diaries.

## Keys

`N` new person · `A` tidy up · `F` fit to screen · `Enter` open book ·
`Del` remove the selected person or link · `Esc` deselect ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo, redo · drag background to pan ·
`Ctrl+scroll` to zoom. The toolbar shows the current percentage; click it for a
box to type an exact zoom into, with presets and Fit beside it.

## Layout

```
index.html        markup for the canvas, the book, the menus and dialogs
styles.css        all of the styling
js/state.js       the document, graph queries and edits, undo
js/library.js     the shelf: many trees in localStorage, and migration
js/photo.js       cropping and downscaling a picked file into a portrait
js/layout.js      the "Tidy up" engine — generations, then a tidy x-pass
js/tree.js        canvas: rendering, pan/zoom, dragging, snapping, edges
js/book.js        the two-page life book
js/exchange.js    export to JSON/SVG/detailed SVG/PNG, import from JSON
js/main.js        toolbar, tree picker, keyboard, startup
server.js         optional zero-dependency static file server
test/             npm test — five jsdom suites plus a real-browser pass
```

## What a prototype this size doesn't do yet

- **Trees live in one browser.** They are kept in `localStorage`, which does not
  follow you to another browser or device and does not survive clearing site
  data. The app asks for persistent storage so it is not evicted under disk
  pressure, but "Back up all trees" is the real answer — and the only way to move
  a shelf between machines.
- **No sharing.** To give someone a tree you send them the file. There is
  deliberately no upload, no link, and nothing holding copies of anyone's
  diaries — but equally no way for two people to work on the same tree.
- **A child belongs to exactly one union.** Step-parents and adoption have no
  separate notion — you can record the partnership, but a child hangs from one
  couple only.
- **Four or more partners will crowd.** Three lay out cleanly; beyond that more
  than one connector has to reach past a card, and while none of them hide
  behind anything, the row gets wide.
- **Separating a couple keeps the children with the left-hand partner.** That is
  at least predictable from the canvas, but there is no way to choose the other
  one, or to split them between the two.
- **A cross-generation link routes as the crow flies** and can pass behind other
  cards. It is legible and clearly marked, but not routed around obstacles.
- **Photos are stored inside the document**, not as files, and only the
  thumbnail is kept — the original resolution is gone once you drop it in. That
  keeps export self-contained, but it is not somewhere to archive the only copy
  of a family photograph. One portrait per person, no albums.
- **Browser storage is finite** (a few MB). A tree with many photos can reach
  it; the app now says so plainly instead of failing quietly, but the fix is to
  Export.
- **Approximate dates are text, not data.** `c. 1880` is stored as typed, and
  nothing sorts or reasons about it beyond pulling a four-digit year out for the
  card. Chapter dates are still exact-only.
- **Undo is the only safety net, and it does not survive a reload.** Nothing is
  confirmed before it happens, and the history is in memory only — so deleting
  someone and then reloading makes it permanent. The 60-step limit applies too.
  Export is the real backup.

## Tests

```bash
npm install
npx playwright install chromium   # once, for the browser suite
npm test                          # or: npm test browser
```

Six suites, run against a real instance of the app: the document model and
layout, the tree shelf, the wired-up page, export/import, photos, and a
real-Chromium pass.

That last one earns its keep. The first five run in `jsdom`, which does no
layout and no hit-testing — it once reported a page as fine while every click
was being swallowed by an invisible overlay. Only the browser suite can catch
that, so it also holds a regression test that puts the bug back and proves the
click dies. Without Chromium installed it reports `SKIPPED` rather than
pretending to pass.
