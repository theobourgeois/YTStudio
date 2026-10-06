# The Online panel

Photoshop's Libraries, for the whole internet: search for a picture and place it as a layer. It's a tab beside
Properties (and Styles) by default; a saved layout gets it there too (`homes` in `createDock`).

## Sources

| Tab | Source | Key | What comes back |
| --- | --- | --- | --- |
| Icons | [Iconify](https://iconify.design) (~200,000 open-source icons: Material, Phosphor, Tabler, Lucide, Font Awesome, emoji, brand logos) | none | vectors, drawn at any size, recoloured |
| Web | Bing's image search (scraped from `bing.com/images/async`; filters: Any, Transparent, Clip art, Line art, Photo) | none | the original file, else Bing's own copy |
| Photos | [Openverse](https://openverse.org) (Creative Commons: Flickr, Wikimedia…) | none (20 a page without one) | the original, with its licence and author |
| a link, typed in any tab | the page: gallery-dl's reading when it's installed (`GALLERY_DL_PATH`, else `gallery-dl` on the PATH), else its `og:image`, `twitter:image`, `image_src` and `<img>`s (largest of a `srcset`) | none | each picture |

DuckDuckGo's image search refuses scripts (its `i.js` answers 403), so the web is Bing's. This is an internal tool:
the web tab takes whatever Bing finds, licence or not.

## How it works

- The server (`server/photo/online.ts`, `/api/photo/online/search`, `/api/photo/projects/:id/online/place`)
  searches and downloads; the page never fetches a picture to place. Placing downloads into the data folder's tmp,
  has the helper (`prepare`) keep a PNG, JPEG or WebP as it is and make anything else (SVG, GIF, AVIF, TIFF) a PNG
  of its first frame, and adopts the file into the project's media with an `origin`, so placing the same result
  again reuses it. Then the tab places it as a dropped file is (`placeMedia`).
- **Iconify limits how many requests a computer makes** (Cloudflare answers 429 for a few minutes). So the page
  doesn't load icons one by one: the server asks for each set's shapes in one request (`/{prefix}.json?icons=…`),
  keeps them (`iconCache`), and hands the page thumbnails as data URLs and the helper an SVG it draws itself
  (`iconSvg`: the longer side `size` pixels, `currentColor` made the colour). A one-colour icon's thumbnail shows in
  the text's colour (a CSS mask); it's placed in the foreground colour at the panel's size (default a quarter of the
  canvas's shorter side, `iconSizeFor`).
- A 429 says when to try again (`retry-after`).
- **Place without background** (a result's right-click menu): Select Subject on the placed layer alone, made its
  mask. The model is shown the layer's box only (`cropSample`): on the whole canvas a photo on blank space is itself
  the subject. It waits for the layer's pixels to load first.
- The assistant has `search_online_images` and `place_online_image` (an icon's size and colour, a place, and
  `remove_background`).

## Tests

`server/photo/online.test.ts` runs against `online-stand-in.ts` (a made-up Iconify, Bing, Openverse and page) and
the real helper. The e2e suite sets `EDITOR_ONLINE_ASSETS=stand-in`, so it never touches the network.

## Later

- Pexels, Pixabay or Unsplash with a key (Settings), for stock photos better than Openverse's.
- GIPHY stickers; Poly Haven textures and HDRIs (CC0, no key), which the lighting effects would use.
- Trim a web PNG's transparent margin when it's placed.
