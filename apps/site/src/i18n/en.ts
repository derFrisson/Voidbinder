import type { Dict } from './de';

// English copy. Typed against the German dictionary, so a missing or extra key fails typecheck.
export const en: Dict = {
  meta: {
    lang: 'en',
    ogLocale: 'en_GB',
    title: 'Voidbinder · Collection app for four card games',
    description:
      'Voidbinder is an open-source app for Pokémon, Yu-Gi-Oh!, Magic: The Gathering and One Piece. It has an offline scanner and prices that name their source and date. Pre-alpha, waitlist open.',
  },
  a11y: {
    skip: 'Skip to content',
    nav: 'Main navigation',
    home: 'Voidbinder, home',
    language: 'Choose language',
    footer: 'Footer',
  },
  nav: {
    games: 'Games',
    scanner: 'Scanner',
    prices: 'Prices',
    openSource: 'Open source',
    cta: 'Waitlist',
  },
  hero: {
    title: 'The collection app for four card games, offline and with prices.',
    lede: 'Voidbinder keeps Pokémon, Yu‑Gi‑Oh!, Magic: The Gathering and, later, One\u00a0Piece. The scanner works on your device, and every price names its source and date.',
    primary: 'Join the waitlist',
    secondary: 'View the source',
    status: 'Pre-alpha · No download yet',
    poweredBy: 'powered by Voidcom',
    art: 'Five cards fanned out like a hand',
  },
  problem: {
    label: 'The problem',
    title: 'Your collection is scattered.',
    lede: 'If you collect more than one card game, you often need more than one app today. None of them does it all.',
    rows: [
      {
        term: 'One game per app',
        text: 'Most apps cover a single card game. Collect two and you keep two lists.',
      },
      {
        term: '€5 to €10 a month',
        text: 'Scanner and price history often sit behind a subscription, and that is per app.',
      },
      {
        term: 'English and Japanese only',
        text: 'German cards are often missing or carry the price of the English one.',
      },
      {
        term: 'Web only',
        text: 'No connection, no scanner and no catalogue, right when you are at a convention or in a shop.',
      },
    ],
  },
  games: {
    label: 'Four games',
    title: 'Four games in one collection.',
    lede: 'One binder instead of four apps. One Piece comes later, the other three first.',
    list: [
      { name: 'Pokémon', note: 'Planned for launch' },
      { name: 'Yu-Gi-Oh!', note: 'Planned for launch' },
      { name: 'Magic: The Gathering', note: 'Planned for launch' },
      { name: 'One Piece', note: 'Comes later' },
    ],
    art: 'A binder page with nine card pockets that fill row by row',
  },
  scanner: {
    label: 'Scanner',
    title: 'A scanner that needs no connection.',
    lede: 'The camera finds the card and reads its number and set code. Then it looks the card up in the catalogue on your device.',
    facts: [
      { term: 'Recognition', value: 'Card, number and set code are read on the device' },
      { term: 'Catalogue', value: 'Stored locally on the device, works offline' },
      { term: 'Variants', value: 'The picker shows every variant with its price' },
      { term: 'Price gap', value: 'Big differences between variants trigger a warning' },
      { term: 'Photos', value: 'Stay on your device' },
    ],
    screen: {
      status: 'Card found',
      code: 'SET · 025/198',
      action: 'Pick a variant',
    },
    art: 'A phone screen with a camera viewfinder that detects a card and reads its number',
  },
  prices: {
    label: 'Prices',
    title: 'Every price names its source and date.',
    lede: 'Prices come from TCGplayer, as daily data. Cardmarket is planned, depending on the terms of use.',
    variantsLabel: 'Variants',
    variants: [
      { name: 'Normal', price: '$0.40' },
      { name: 'Reverse holo', price: '$1.20' },
      { name: 'Holo', price: '$3.80' },
      { name: '1st edition', price: '$12.50' },
    ],
    chartSource: 'TCGplayer · Market price · 2026-10-09',
    chartNote: 'Example values',
    chartLabel: 'Price of the holo variant over 90 days, from $2.90 to $3.80',
    sourcesLabel: 'Sources',
    sources: [
      { name: 'TCGplayer', note: 'US dollar · Daily data' },
      { name: 'Cardmarket', note: 'Euro · Planned, depending on the terms' },
    ],
    estimate: 'Prices for individual conditions are estimates.',
  },
  deck: {
    label: 'Deck builder',
    title: 'Build decks from what you own.',
    lede: 'The deck builder knows the rules of each game and your collection. It shows what you are missing and what the rest costs.',
    facts: [
      { term: 'Rules', value: 'Deck rules per game' },
      { term: 'Formats', value: 'Legality per format, where the data allows' },
      { term: 'Matching', value: 'Against your collection' },
      { term: 'Missing list', value: 'What is missing and what the rest costs' },
    ],
    screen: {
      title: 'Deck 1',
      owned: 'Owned',
      missing: 'Missing',
      summary: 'Missing: 3 cards · $7.60',
    },
    art: 'A deck list with a count per card, owned and missing cards marked',
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack openings, live on stream.',
    lede: 'Your phone films the cards and OBS puts them on stream. The Streamer Kit is being built for Monday Pack Attack on Twitch.',
    facts: [
      { term: 'Camera', value: 'Your phone works as the camera for OBS' },
      { term: 'Detection', value: 'Pulled cards are recognised live' },
      { term: 'Overlay', value: 'Card and value show up as an overlay on stream' },
      { term: 'Total', value: 'Running value against the box price' },
      { term: 'Chat', value: 'Commands in Twitch chat' },
    ],
    link: 'Monday Pack Attack on twitch.tv/derFrisson',
    overlay: {
      live: 'Live',
      pack: 'Pack 3 of 10',
      last: 'Last pull',
      lastValue: '$4.20',
      total: 'Value so far',
      totalValue: '$18.40',
      box: 'Box price',
      boxValue: '$120.00',
    },
    caption: 'Example values, not a real stream.',
    art: 'A stream frame with an overlay: pack counter, last pulled card, value so far and box price',
  },
  openSource: {
    label: 'Open source',
    title: 'Open code, small price.',
    lede: 'Voidbinder is licensed under the AGPL-3.0 and lives on GitHub. You can run it yourself.',
    plans: [
      {
        name: 'Run it yourself',
        price: '€0',
        text: 'Source on GitHub under the AGPL-3.0. The server and the data are yours.',
      },
      {
        name: 'Hosted',
        price: 'Price to follow',
        text: 'We run it for you. It is meant to be cheap, but there is no price yet.',
      },
    ],
    scryfall: 'Data from Scryfall never sits behind a paywall.',
    link: 'Source on GitHub',
  },
  waitlist: {
    title: 'Sign up for the beta.',
    lede: 'You get one mail to confirm and one when there is something to test.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    consentBefore:
      'I agree that Voidbinder stores my email address to tell me when the beta starts. More in the ',
    consentLink: 'privacy policy',
    consentAfter: '.',
    submit: 'Sign up',
    sending: 'Sending',
    honeypot: 'Website, leave this empty',
    errors: {
      email: 'That email address does not look right. Please check it.',
      consent: 'Please tick the box, otherwise we may not store your address.',
      rate: 'Too many attempts. Please wait a minute.',
      server: 'That did not work. Please try again later.',
    },
  },
  status: {
    home: 'Back to the home page',
    pending: {
      title: 'Check your inbox.',
      text: 'We sent you a mail. Click the link in it to confirm your sign-up. The link works for 7 days. Nothing there? Check your spam folder.',
    },
    confirmed: {
      title: 'You are on the waitlist.',
      text: 'Thanks. We will write to you when there is something to test. You can unsubscribe with the link in every mail.',
    },
    unsubscribed: {
      title: 'You are unsubscribed.',
      text: 'We will not write to you again. You can sign up again at any time.',
    },
    expired: {
      title: 'This link no longer works.',
      text: 'It has expired or a newer one replaced it. Please sign up again.',
      action: 'Sign up again',
    },
    error: {
      email: {
        title: 'The email address is not valid.',
        text: 'Please check it and try again.',
      },
      consent: {
        title: 'We need your consent.',
        text: 'Without the tick we may not store your address.',
      },
      server: {
        title: 'That did not work.',
        text: 'Something went wrong on our side. Please try again later.',
      },
      action: 'Back to the form',
    },
    unsubscribe: {
      title: 'Unsubscribe from the waitlist?',
      text: 'One click and you are unsubscribed. We will not mail you again.',
      button: 'Unsubscribe',
      invalid: 'This unsubscribe link is incomplete. Please use the link from the mail.',
    },
  },
  footer: {
    tagline: 'Open-source app for trading cards.',
    poweredBy: 'powered by Voidcom',
    linksLabel: 'Links',
    imprint: 'Imprint',
    privacy: 'Privacy',
    github: 'GitHub',
    twitch: 'Twitch',
    license: 'Source under AGPL-3.0',
    trademarks:
      'Pokémon, Yu-Gi-Oh!, Magic: The Gathering and One Piece are trademarks of their respective owners. Voidbinder is not affiliated with them.',
  },
};
