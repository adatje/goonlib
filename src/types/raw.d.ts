/**
 * Vite inlines a file's contents as a string when imported with `?raw`. Used by
 * the co-watching client so its markup can live in a real .html file.
 */
declare module '*.html?raw' {
  const content: string
  export default content
}
