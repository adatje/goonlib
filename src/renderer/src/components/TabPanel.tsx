/** Every tab in the Settings sheet, in the order the rail lists them. */
export type SheetTab =
  | 'app'
  | 'styling'
  | 'controls'
  | 'solo'
  | 'patterns'
  | 'together'
  | 'providers'
  | 'tagging'
  | 'duplicates'

/**
 * One tab's content. Hidden rather than unmounted when another tab is showing,
 * so a half-typed key, a pattern half-drawn, or a preview still playing all
 * survive a look at another tab.
 */
export function TabPanel(props: {
  id: SheetTab
  tab: SheetTab
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="tabpanel"
      id={`settings-panel-${props.id}`}
      aria-labelledby={`settings-tab-${props.id}`}
      className="tabpanel"
      hidden={props.tab !== props.id}
    >
      {props.children}
    </div>
  )
}
