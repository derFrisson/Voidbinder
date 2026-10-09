import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Legal pages (VB-18): src/content/legal/<locale>/<slug>.md, id = "<locale>/<slug>".
const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Month of the last change, shown as "Stand: 2026-10". */
    updated: z.string().regex(/^\d{4}-\d{2}$/),
  }),
});

export const collections = { legal };
