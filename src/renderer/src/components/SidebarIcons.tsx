/**
 * The app's line icons. They began as the sidebar's, so every entry could
 * carry a glyph the way Favorites carries its heart, and the toolbar, the
 * settings sheet and the selection bar now draw from the same sheet. Drawn as
 * 1.3px strokes on a 16px grid to sit with the heart at 13px, and coloured by
 * whatever holds them.
 *
 * Shapes marked icon__fill fill in, as the heart does, when their entry is
 * pointed at or selected; the stylesheet decides when.
 */

function Icon({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Everything: a grid of thumbnails. */
export function LibraryIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect className="icon__fill" x="2" y="2" width="5" height="5" rx="1" />
      <rect className="icon__fill" x="9" y="2" width="5" height="5" rx="1" />
      <rect className="icon__fill" x="2" y="9" width="5" height="5" rx="1" />
      <rect className="icon__fill" x="9" y="9" width="5" height="5" rx="1" />
    </Icon>
  )
}

/** Hand-picked sets: layers stacked on one another. */
export function CollectionsIcon(): React.JSX.Element {
  return (
    <Icon>
      <path className="icon__fill" d="M8 2 14 5 8 8 2 5Z" />
      <path d="M2 8.2 8 11.2l6-3" />
      <path d="M2 11.2 8 14.2l6-3" />
    </Icon>
  )
}

/** A luggage-style tag with its eyelet. */
export function TagIcon(): React.JSX.Element {
  return (
    <Icon>
      {/* One path, so the eyelet stays a hole when the tag fills. */}
      <path
        className="icon__fill"
        fillRule="evenodd"
        d="M2.5 2.5h5.2l6 6-5.2 5.2-6-6Z M6.3 5.3a1 1 0 1 0-2 0a1 1 0 1 0 2 0Z"
      />
    </Icon>
  )
}

export function FolderIcon(): React.JSX.Element {
  return (
    <Icon>
      <path
        className="icon__fill"
        d="M2 4.2c0-.7.5-1.2 1.2-1.2h3l1.5 1.7h5.1c.7 0 1.2.5 1.2 1.2v6.1c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2Z"
      />
    </Icon>
  )
}

/** Where the library is read from: two chain links, joined. */
export function SourcesIcon(): React.JSX.Element {
  return (
    <Icon>
      <path className="icon__thicken" d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2.4-2.4a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
      <path className="icon__thicken" d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2.4 2.4a2.6 2.6 0 0 0 3.7 3.7l1-1" />
    </Icon>
  )
}

/** Scan: a frame's four corners, with a line sweeping across it. */
export function ScanIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M2 5.5V3.2c0-.7.5-1.2 1.2-1.2h2.3M10.5 2h2.3c.7 0 1.2.5 1.2 1.2v2.3M14 10.5v2.3c0 .7-.5 1.2-1.2 1.2h-2.3M5.5 14H3.2c-.7 0-1.2-.5-1.2-1.2v-2.3" />
      <path d="M4 8h8" />
    </Icon>
  )
}

/** Details: an "i" in a circle. */
export function InfoIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle className="icon__fill" cx="8" cy="8" r="6" />
      <path className="icon__knockout" d="M8 7.2v3.8M8 5v.1" />
    </Icon>
  )
}

/** EXIF: a camera. */
export function CameraIcon(): React.JSX.Element {
  return (
    <Icon>
      <path className="icon__fill" d="M2 5.5c0-.6.5-1 1-1h2l1-1.5h4l1 1.5h2c.5 0 1 .4 1 1v6.5c0 .6-.5 1-1 1H3c-.5 0-1-.4-1-1Z" />
      <circle className="icon__knockout" cx="8" cy="8.5" r="2.3" />
    </Icon>
  )
}

/** The item's description: a question mark in a circle. */
export function DescriptionIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle className="icon__fill" cx="8" cy="8" r="6" />
      <path className="icon__knockout" d="M6.2 6.1a1.85 1.85 0 1 1 1.85 2.2v1.1" />
      <path className="icon__knockout" d="M8 11.5v.1" />
    </Icon>
  )
}

/** Loop: a ring of two arrows, each chasing the other's tail. */
export function LoopIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M3.1 6.4a5.2 5.2 0 0 1 8.7-2h1.7" />
      <path d="M11.4 2.6 13.9 4.4 11.4 6.2" />
      <path d="M12.9 9.6a5.2 5.2 0 0 1-8.7 2H2.5" />
      <path d="M4.6 13.4 2.1 11.6 4.6 9.8" />
    </Icon>
  )
}

/** A tick, for a setting that is safe as it is. */
export function CheckIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M3 8.5l3.2 3L13 4.5" />
    </Icon>
  )
}

/** A magnifying glass, for a setting that looks further. */
export function SearchIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.2 10.2L14 14" />
    </Icon>
  )
}

/** A warning triangle, for a setting to be careful with. */
export function WarningIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M8 2L14.5 13.5h-13z" />
      <path d="M8 6.5v3" />
      <path d="M8 11.6v.1" />
    </Icon>
  )
}

/** General: three sliders, set at different heights. */
export function SlidersIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M2 4h12M2 8h12M2 12h12" />
      <circle className="icon__fill" cx="5" cy="4" r="1.6" />
      <circle className="icon__fill" cx="10.5" cy="8" r="1.6" />
      <circle className="icon__fill" cx="7" cy="12" r="1.6" />
    </Icon>
  )
}

/** Toys: a pulse, rising and falling. */
export function PulseIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M1.5 8h2.5l1.5-4 2.5 8 2-6 1.2 2h3.3" />
    </Icon>
  )
}

/** Sharing: two people, one a little behind the other. */
export function PeopleIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle className="icon__fill" cx="6" cy="5.2" r="2.3" />
      <path className="icon__fill" d="M1.8 13.5c0-2.4 1.9-4.2 4.2-4.2s4.2 1.8 4.2 4.2Z" />
      <path d="M10.4 3.2a2.3 2.3 0 0 1 0 4.2M11.8 9.6c1.4.5 2.4 1.9 2.4 3.9" />
    </Icon>
  )
}

/** AI: a four-pointed sparkle, and a small one beside it. */
export function SparkleIcon(): React.JSX.Element {
  return (
    <Icon>
      <path className="icon__fill" d="M7 2.5l1.2 3.3 3.3 1.2-3.3 1.2L7 11.5 5.8 8.2 2.5 7l3.3-1.2Z" />
      <path className="icon__fill" d="M12 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6Z" />
    </Icon>
  )
}

/** A waste basket, for the selection bar's Trash. */
export function TrashIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3h3v1.5" />
      <path d="M4.3 4.5l.7 8.2h6l.7-8.2" />
      <path d="M6.8 7v3.5M9.2 7v3.5" />
    </Icon>
  )
}

/** A folder with an arrow into it, for moving a selection somewhere else. */
export function MoveIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M2 4.5h4l1.2 1.5H14v7H2z" />
      <path d="M6 9.5h4.5" />
      <path d="M9 7.8l1.8 1.7L9 11.2" />
    </Icon>
  )
}

/** Images: a framed picture, with its sun and its horizon. */
export function ImageIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="2" y="3.2" width="12" height="9.6" rx="1.4" />
      <circle cx="5.6" cy="6.4" r="1.1" />
      <path d="M2.4 11.4 6 8.2l2.3 2 2.1-1.7 3.2 2.9" />
    </Icon>
  )
}

/** Videos: a play triangle in its frame. */
export function VideoIcon(): React.JSX.Element {
  return (
    <Icon>
      <rect x="2" y="3.2" width="12" height="9.6" rx="1.4" />
      <path d="M6.7 5.9 10.7 8l-4 2.1Z" />
    </Icon>
  )
}

/** Filters: a funnel, narrowing what comes through. */
export function FunnelIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M2.2 3.2h11.6L9.4 8.3v4.3l-2.8 1.4V8.3Z" />
    </Icon>
  )
}

/** Sort: rows of falling length, with an arrow pointing down them. */
export function SortIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M2.4 4.2h7.2M2.4 8h5M2.4 11.8h2.8" />
      <path d="M12.7 4.2v7.6" />
      <path d="M14.4 10.1 12.7 11.8 11 10.1" />
    </Icon>
  )
}

/**
 * The divider between how many and how much: a platter seen face on.
 *
 * Round on purpose. It sits where the app's middot separator sits everywhere
 * else, and a shape with no top or bottom parts the two numbers rather than
 * labelling the one after it, which an upright drive or cylinder does. What it
 * depicts matters less than that: the "GB" behind it has already said storage.
 */
export function StorageIcon(): React.JSX.Element {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="1.7" />
      {/* The glint off the surface, which is what keeps it from reading as a
          plain ring at 13px. */}
      <path d="M11.4 4.6 9.3 6.7" />
    </Icon>
  )
}

/** A pasted link is fetched, not searched: an arrow coming down into a tray. */
export function DownloadIcon(): React.JSX.Element {
  return (
    <Icon>
      <path d="M8 2.4v6.8" />
      <path d="M5.2 6.6 8 9.4l2.8-2.8" />
      <path d="M2.8 11v1.4c0 .7.5 1.2 1.2 1.2h8c.7 0 1.2-.5 1.2-1.2V11" />
    </Icon>
  )
}
