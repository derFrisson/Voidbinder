/// <reference types="expo/types" />

// Bundled images (the card backs, VB-120): Metro and Vite both resolve the import to a source.
declare module '*.webp' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
