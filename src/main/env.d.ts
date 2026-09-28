/** A file imported with Vite's `?raw` suffix is its text, built into the main process. */
declare module '*?raw' {
  const text: string
  export default text
}
