# The app's new look

A plan for restyling the whole app, both the video editor and the music editor, in the look the Piano roll
now has (`src/suites/music/piano/draw.ts`). It's written to be handed to whoever builds it: what the look is,
what Théo decided, where everything to change lives, and the order to do it in.

## Why

The app looks like a SaaS dashboard: near-black flat panels, big rounded corners, soft floating shadows, grey
text on grey. The Piano roll, redone after FL Studio, is the first screen that looks like a creative tool.
It's also easier to see: its surfaces and lines are far apart in brightness, so the structure reads at a
glance. Théo wants everything to look like that, the video editor included.

Open the music suite, press F7 and look at the Piano roll in both themes before starting. It's the reference.
FL Studio's own screenshots are in `docs/fl-studio/img/`. Take the idea from them, not their artwork:
`docs/fl-studio/README.md` says why.

## Decisions (Théo, 2026-09-30)

- **Replace the current look.** No "classic" option is kept. But **build it as a theme system**: Théo will
  add more themes later, so a theme must be a set of values (colours, bevels, radii), not styles spread
  through components. Light and dark stay, as two variants of the new theme.
- **3D, but modern.** Buttons, toggles and other controls get a bit of depth (a lit top edge, a slight
  gradient, a darker outline, a pressed state that looks pushed in). Not the heavy, glossy 2005 look: it
  should still read as a modern app. When in doubt, less depth.
- **The accent stays blue** (`--brand`). Don't bring in FL's green and orange as the app's colours: that's
  too much copying. (The Piano roll's notes, blue since 2026-09-30, and its orange play marker are its content.)
- **The font stays** (DM Sans, Geist Mono). A font change may come later, as part of a theme.
- **Everything changes**, the assistant's chat included. No screen keeps the old look.

## What the look is

What the Piano roll does that the rest of the app doesn't:

1. **Mid-tone surfaces with clear steps.** Not near-black: a blue-grey family, each level visibly apart
   (the desktop behind, a panel, a raised control, a sunken field). In dark mode the Piano roll's grid is
   `#2c333c` on a page of `#16191d`: the work area is *lighter* than the chrome around it.
2. **Lines darker than the surfaces they divide.** A divider is a groove, not a light hairline.
3. **Depth on things you can press.** A 1px lighter line along a control's top edge, a slight top-to-bottom
   gradient, a 1px darker outline. Pressed or on, the gradient flips and the highlight goes, so it looks
   pushed in. Fields (inputs, number displays, search) are the reverse: sunken, darker than their
   surroundings, with an inner shadow along the top.
4. **Small corners and few shadows.** 2 to 4 px corners (the windows are now `rounded-sm`), and shadows
   only on things that float (menus, dialogs, windows), short and dark. No big soft glows.
5. **Dense.** Smaller controls and tighter spacing; it's a tool for a big screen.
6. **Colour means something.** Blue is the accent (selected, focused, on). Red is for deletion and the
   playhead. Clip and note colours are content. Everything else is the neutral family.

In light mode the same rules apply to a light blue-grey family (the Piano roll's light palette: rows
`#eef1f5`, lines `#d3d9e1`, bar lines `#949eaa`). Light mode is the harder one: FL Studio has no light mode,
so there's nothing to copy. Check it as carefully as dark.

## How theming works today

- `src/index.css` holds everything: about 50 CSS variables in `:root` (light) and `.dark` (dark), mapped to
  Tailwind colours in `@theme inline` (`bg-card`, `text-muted-foreground`, `bg-brand`...). `--radius` sets
  the radius scale (`rounded-sm` to `rounded-xl`).
- `src/stores/theme.ts` (`useTheme`: light, dark or system) toggles the `dark` class on `<html>`.
  `components/header/theme-menu.tsx` is the menu.
- Components use the Tailwind tokens. Only a few files hard-code colours: `assistant/edits.ts`,
  `components/assistant/provider-icon.tsx`, `components/captions/caption-sample.tsx`,
  `components/properties/text-controls.tsx`, and the Piano roll (`piano/draw.ts`, `piano/cursors.ts`).
  Check each: some are content (a caption's sample colours) and should stay.
- Canvases draw with colours of their own and don't follow the CSS: the Piano roll (`piano/draw.ts`
  `readPalette`, one palette per theme), the timeline's clip strips (`components/timeline/clip-media.tsx`),
  the source trimmer (`components/preview/source-trimmer.tsx`) and the effects' thumbnails
  (`components/effects/thumbnails.ts`).
- The UI primitives are 19 shadcn files in `src/components/ui/` (button, toggle, toggle-group, input, select,
  slider, switch, dropdown-menu, context-menu, popover, dialog, alert-dialog, tooltip, scroll-area, progress,
  separator, label, sonner, tag-chip). Most of the app is built from them.
- The corners: about 150 uses of `rounded-lg`, `-xl` and `-2xl`, 90 of `rounded-md` and 60 of
  `rounded-full` across the components. Shadows: about 20 `shadow-*`, mostly `shadow-xl`.

## Where it is

- **Done (2026-09-30):** steps 1 to 3. The theme system (`src/themes/studio.css`, `THEMES` in
  `stores/theme.ts`, the theme menu lists themes and light / dark / system), the palette (every text colour
  passes on every surface: the gallery's first section measures it), the depth utilities (`raised`,
  `pressed`, `raised-brand`, `pressed-brand`, `sunken`, `floating` in `index.css`), the radius scale (4px), the
  scrollbars, the Piano roll's grid colours as theme variables (`--piano-*`), and every primitive in
  `components/ui/`. The light accent is a little darker than before (`#2c67d0`) so it passes as text.
- **Checking** is the component gallery (`/gallery`, `src/gallery/`, a suite adds its controls in its own
  `gallery.tsx`) and `scripts/ui-sheet.ts`, which screenshots the gallery and the screens in every theme.
- **Next:** step 4, the sweep, area by area.

## The plan

Do it in this order. After each step, look at every screen in both themes (see "Checking" below) before going
on.

### 1. The theme system

- Make a theme a named set of values, and the current `dark` / `light` into variants of one theme.
  Suggested shape: a `Theme` in `src/stores/theme.ts` has an id, a name and its two variants; each variant
  is a set of CSS variables, applied as a class on `<html>` (for example `theme-studio dark`) with the
  values in `src/index.css` (or a `src/themes/` folder, one CSS file per theme). The menu in
  `theme-menu.tsx` then lists themes and the light / dark / system choice separately. There's only one theme
  now; the point is that the second is a new file and a line in a list, not a sweep.
- Keep `.dark` meaning "a dark variant is showing": components use `dark:` variants and the Piano roll's
  `readPalette` looks for `.dark`.
- Put everything a theme may change into variables, beyond colours:
  - surface levels, for example `--surface-0` (the desktop, the stage) to `--surface-3` (raised controls),
    plus `--sunken` (fields). Keep the existing names (`--background`, `--card`, `--muted`...) working as
    aliases so nothing breaks while the sweep goes on, then retire the ones nobody uses.
  - `--line`, `--line-strong`: dividers (darker than surfaces).
  - bevels: `--bevel-highlight` (the lit top edge), `--bevel-shadow` (the outline), `--raised` and `--pressed`
    (the gradients), `--inset` (a field's inner shadow). Expose them as Tailwind utilities (for example
    `bevel`, `bevel-pressed`, `sunken`) in `@layer utilities`, so components say "raised" rather than
    spelling out gradients.
  - `--radius` (small: about 4px), and a `--shadow-float` for menus, dialogs and windows.
- **Canvases read the theme too.** Move the Piano roll's palette out of `draw.ts` into the theme (CSS
  variables read once per theme change; `readPalette` already runs per frame and knows the element, so it can
  read computed styles and cache them). Do the same for the timeline's clip strips and the source trimmer. A
  future theme must restyle the canvases without touching drawing code.
- Write down the look in CLAUDE.md's Conventions: the design line ("minimal, like T3 Code; a darker One Dark
  palette") changes to this. Update Théo's design memory (`ui-design-direction`) too.

### 2. The palette

- Dark: start from the Piano roll's (`DARK` in `piano/draw.ts`): the grid rows `#2c333c` / `#262c34`, lines
  `#20252c` to `#12151a`, the ruler `#1d2127`. The page around panels can stay darker (the desktop, the
  stage), with panels a step or two lighter, as the Piano roll's grid sits lighter than its window.
- Light: from `LIGHT` in the same file.
- The accent stays `--brand` (`#6aacf0` dark, `#3b7ae8` light). Keep the clip colours (`--clip-*`) and
  `--playhead`; adjust them if they stop reading on the new surfaces.
- Text: foreground and muted-foreground must pass contrast on every surface level (4.5:1 for text, 3:1 for
  icons and lines that carry meaning). Muted text on a raised control is where it usually fails.

### 3. The primitives (`src/components/ui/`)

In order of how much of the app each one is:

- **button**: `default` (the blue one) raised with the bevel; `outline` and `secondary` raised in the
  neutral family; `ghost` flat until hovered, then raised; pressed state (`active:`) pushed in.
  Smaller default height (h-8 rather than h-9), `rounded-sm`.
- **toggle, toggle-group**: off raised, on pushed in and tinted with the accent. The transport's toggles,
  the Piano roll's tool buttons and the timeline's toolbar all use these (or should: some hand-roll a
  `<button>`, move them over).
- **input, select trigger, textarea-like fields**: sunken. The music suite's `Lcd` is the model of a
  number display.
- **slider, switch, progress**: a sunken track, a raised thumb.
- **dropdown-menu, context-menu, popover, tooltip, dialog, alert-dialog**: a surface a step lighter than
  what's under them, a 1px outline, `--shadow-float`, small radius; menu items highlighted with the accent
  at low opacity, the way the Piano roll's selection is.
- **scroll-area** and the global scrollbar (`index.css`): a sunken track and a visible thumb, like the
  Piano roll's scrollbars.
- **sonner** (toasts), **tag-chip**, **separator** (a groove), **label**.

### 4. The sweep

Every component file, both editors. For each: surfaces to the new levels, corners down (`rounded-lg`,
`-xl`, `-2xl` to `rounded-sm` or `rounded-md`; keep `rounded-full` only where round means something: knobs,
dots, avatars, the record light), soft shadows removed except on floating things, hand-rolled buttons moved
onto the primitives. Do it area by area and look at each:

- **Platform**: the sidebar (`components/sidebar/`: project list, new project picker, chat status), the
  header (`components/header/`), the settings and export dialogs, the empty state
  (`components/workspace/empty-state.tsx`).
- **The assistant** (`components/assistant/`): the chat panel, messages, tool steps, the model and thinking
  pickers, Markdown, the activity pill. It's the most SaaS-looking part now: make the panel a surface like
  the others, the input a sunken field, the send button a raised one.
- **The video editor**: the left panel and its tabs (`workspace/left-panel.tsx`), the Media bin and cards
  (`components/media/`), the Library (`components/library/`), Effects and presets (`components/effects/`:
  the grid, chips, cards), Captions (`components/captions/`), Properties (`components/properties/`: param
  rows, the stopwatch, keyframe lanes), the preview and its transport (`components/preview/`), the timeline
  (`components/timeline/`): toolbar, track headers, ruler (like the Piano roll's), clips (beveled like the
  Piano roll's notes: a lit top edge, a darker outline, small corners), transition markers, the playhead.
- **The music editor** (`src/suites/music/`): the transport bar, the pattern picker, windows' title bars
  (`window.tsx`), the channel rack (step buttons raised, lit when on; the channel buttons; the mute lights),
  knobs (`knob.tsx`), LCDs (`lcd.tsx`), the channel settings and picker, the audio dialog. The Piano roll
  only needs its chrome (its toolbar, lane header, scrollbars) to match.

### 5. Checking

- **Screenshots of every screen, in both variants.** The easy way is a Playwright script against a
  throwaway server (the e2e setup in `playwright.config.ts` shows how: a data dir, the fake engine, the
  fake assistant), which opens each screen and saves a picture. Screens: the empty state, the new project
  picker, the video editor with a few clips (each left-panel tab, a clip selected with Properties, a
  dialog, a context menu, the assistant open with a conversation), the music editor (the rack with the
  starter kit, a channel's settings, the Piano roll with notes, the audio dialog, a knob's menu).
- `pnpm typecheck && pnpm test && pnpm test:e2e`. The e2e tests find things by role and label, so a restyle
  shouldn't break them; one that does has probably lost an accessible name.
- The desktop app (`pnpm dev:desktop`): its title bar areas (`index.css`, `html.desktop`) must still drag
  and leave room for the window buttons.
- Performance: a bevel is a gradient and a shadow; the timeline renders hundreds of clips and the rack
  hundreds of steps. Keep them cheap (a `box-shadow` inset plus a gradient background, no filters, no
  blur) and run `pnpm tsx scripts/perf.ts` before and after on the timeline.

## Things to watch

- **The newest video editor screens count too.** PR #22 (with #24 in it) is on main since 2026-09-30:
  masks, shape layers, text animators, expressions, parenting, nested sequences, time remapping, beat sync
  and the graph editor. Their panels and on-canvas handles need the same sweep as everything else.
- Don't change what things *do*. This is a look, not a redesign of layouts or interactions: FL-style windows
  in the music editor and Premiere-style panels in the video editor stay as they are.
- Content colours stay content: clip colours, caption styles, notes, waveforms, video frames. Only the
  chrome changes.
- Keep both variants equally good. The dark one is the default (`stores/theme.ts`).
