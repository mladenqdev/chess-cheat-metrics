// Vite/Vitest ?raw imports (used for test fixtures)
declare module '*?raw' {
  const content: string;
  export default content;
}
