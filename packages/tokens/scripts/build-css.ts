// Writes dist/tokens.css from src/tokens.ts (`pnpm build`, after tsc). Node 24 strips the types.
import { mkdirSync, writeFileSync } from 'node:fs';
import { tokensCss } from '../src/css.ts';

const dist = new URL('../dist/', import.meta.url);
mkdirSync(dist, { recursive: true });
writeFileSync(new URL('tokens.css', dist), tokensCss());
