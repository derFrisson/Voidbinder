import { z } from 'zod';

export const LocaleSchema = z.enum(['de', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export type Email = z.infer<typeof EmailSchema>;

export const GameSchema = z.enum(['pokemon', 'yugioh', 'mtg', 'onepiece']);
export type Game = z.infer<typeof GameSchema>;
