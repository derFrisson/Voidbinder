// Writes dist/_headers (Workers static assets) from src/security-headers.ts after `expo export`.
import { writeFileSync } from 'node:fs';
import { securityHeaders } from '../src/security-headers.ts';

const lines = Object.entries(securityHeaders).map(([name, value]) => `  ${name}: ${value}`);
writeFileSync(
  new URL('../dist/_headers', import.meta.url),
  // Hashed bundles never change; everything else (index.html) is revalidated.
  `/*\n${lines.join('\n')}\n\n/_expo/static/*\n  Cache-Control: public, max-age=31536000, immutable\n`,
);
