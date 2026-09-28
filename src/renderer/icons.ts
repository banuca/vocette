/**
 * The interface icon set.
 *
 * Every icon is drawn on the same grid as Lucide — 24×24, 2px stroke, round
 * caps and joins, `currentColor` — so they sit together evenly and inherit the
 * colour of whatever they are placed in. They are redrawn here rather than
 * copied from any package: nothing is installed, nothing is fetched at
 * runtime, there is no icon font and no sprite sheet, and there is no
 * third-party licence attached to the artwork.
 *
 * This replaced a set of text glyphs (`⌁`, `⚙`, `◌`, `⌕`, `×`). Those cost
 * nothing either, but they are drawn by whichever font the operating system
 * happens to resolve, so they arrived at a different size, weight and baseline
 * on every platform — and `⌁` in particular is not a control icon anywhere
 * except in the imagination of whoever picked it.
 *
 * The microphone and stop icons live with the recording control, because they
 * belong to its state machine rather than to this general set.
 */

export type IconName =
  | 'history'
  | 'settings'
  | 'info'
  | 'search'
  | 'copy'
  | 'trash'
  | 'close'
  | 'check'
  | 'alert'
  | 'keyboard'
  | 'home'
  | 'key'
  | 'lock'
  | 'empty'
  | 'sparkle'

/** The body of each icon: paths only, sharing one set of stroke attributes. */
const PATHS: Record<IconName, string> = {
  // A clock face with an arrow curling back on itself.
  history:
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7.5V12l3.2 1.9"/>',
  // Sliders, not a cog. A cog simplified enough to survive 16px loses its
  // notched rim and becomes a circle with eight spokes — which is a sun, and
  // sat in the sidebar directly above the theme switch, which really is one.
  settings:
    '<path d="M4 7h10M18 7h2M4 12h3M11 12h9M4 17h8M16 17h4"/>' +
    '<circle cx="16" cy="7" r="2"/><circle cx="9" cy="12" r="2"/>' +
    '<circle cx="14" cy="17" r="2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5"/><path d="M12 8h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  copy:
    '<rect x="9" y="9" width="11" height="11" rx="2.5"/>' +
    '<path d="M5.5 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v.5"/>',
  trash:
    '<path d="M4 6.5h16"/><path d="M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5"/>' +
    '<path d="M6.5 6.5l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/>' +
    '<path d="M10.5 10.5v6M13.5 10.5v6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M4.5 12.5l5 5 10-11"/>',
  alert:
    '<path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3.1L13.7 3.9a2 2 0 0 0-3.4 0Z"/>' +
    '<path d="M12 9.5v4"/><path d="M12 17h.01"/>',
  keyboard:
    '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/>' +
    '<path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01' +
    'M6.5 13h.01M17 13h.01"/><path d="M9.5 13h5"/><path d="M8 16.3h8"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.6V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.6"/><path d="M9.8 20.5v-6h4.4v6"/>',
  key: '<circle cx="8" cy="14.5" r="4.5"/><path d="M11.4 11.6 20 3.5"/><path d="M17 6.5l2.2 2.2"/><path d="M14.6 8.9l2.2 2.2"/>',
  // A padlock: private by default, which a key would have muddled with the
  // optional API key.
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
  // Deliberately not a magnifying glass or a document: an empty history is not
  // a failed search and not a missing file, it is simply a page not yet
  // written on.
  empty: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3.4"/><path d="M12 8.5v7M8.5 12h7"/>',
  // Pro: a four-pointed spark with a small one beside it. Not a star, which
  // reads as "favourite", and not a crown, which would oversell a word list.
  sparkle:
    '<path d="M11 5C11.7 10 14 12.3 19 13C14 13.7 11.7 16 11 21C10.3 16 8 13.7 3 13C8 12.3 10.3 10 11 5Z"/>' +
    '<path d="M19 3v4M17 5h4"/>'
}

/**
 * One icon as an SVG string, sized in `em` so it follows the text it sits
 * beside. Returns markup, because every caller is already building markup.
 */
export function icon(name: IconName, size = 16): string {
  return (
    `<svg class="icon" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  )
}
