// Expo configures Metro for the pnpm workspace by itself (SDK 52+); NativeWind adds Tailwind.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
// The web fonts are the site's woff2 files (src/fonts.ts).
config.resolver.assetExts.push('woff2');

module.exports = withNativeWind(config, { input: './src/global.css' });
