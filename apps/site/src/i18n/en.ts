import type { Dict } from './de';

// English copy. Typed against the German dictionary, so a missing or extra key fails typecheck.
export const en: Dict = {
  meta: {
    lang: 'en',
    ogLocale: 'en_GB',
    title: 'Voidbinder · One app for your whole card collection',
    description:
      'Voidbinder keeps Pokémon, Yu-Gi-Oh!, Magic: The Gathering and One Piece in one open-source app, with German cards, Cardmarket prices and an offline scanner.',
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
    title: 'Your whole collection in one binder.',
    lede: 'Voidbinder keeps Pokémon, Yu\u2011Gi\u2011Oh!, Magic: The Gathering and One Piece in one app: with German cards, Cardmarket prices and a scanner that works without a connection. Open source, for iOS, Android and the web.',
    primary: 'Join the waitlist',
    secondary: 'View the source',
    status: 'Pre-alpha · Beta sign-up open',
    art: 'Five cards fanned out like a hand',
  },
  problem: {
    label: 'The problem',
    title: 'Four games, four apps, four subscriptions.',
    lede: 'If you collect more than one game, your collection is spread across several apps today. Each does a little, none does it all.',
    rows: [
      {
        term: 'One game per app',
        text: 'Most apps cover exactly one card game. Collect two and you keep two lists and two wish lists.',
      },
      {
        term: '€5 to €10 a month',
        text: 'Scanner, price history and export often sit behind a subscription, and that is per app.',
      },
      {
        term: 'English and Japanese only',
        text: 'German prints are missing or lumped in with the English card, wrong price included.',
      },
      {
        term: 'Web only',
        text: 'No connection, no scanner and no catalog, right when you are at a convention or in a shop.',
      },
    ],
  },
  games: {
    label: 'Four games',
    title: 'One binder for Pokémon, Yu\u2011Gi\u2011Oh!, Magic and One Piece.',
    lede: 'Every card gets its pocket, whatever the game. Sets, languages and variants stay apart, the collection stays one.',
    list: [
      { name: 'Pokémon', note: 'Sets, languages, variants' },
      { name: 'Yu-Gi-Oh!', note: 'Sets, languages, rarities' },
      { name: 'Magic: The Gathering', note: 'Sets, languages, foils' },
      { name: 'One Piece', note: 'Sets, languages, parallels' },
    ],
    art: 'A binder page with nine card pockets that fill row by row',
  },
  scanner: {
    label: 'Scanner',
    title: 'Scans without a connection.',
    lede: 'Recognition runs on your device: the camera finds the card, reads its number and set code and looks it up in the local catalog. No upload, no waiting for a server.',
    facts: [
      { term: 'Recognition', value: 'Text recognition on the device' },
      { term: 'Catalog', value: 'Stored locally, updates over Wi-Fi' },
      { term: 'Connection', value: 'Not needed' },
    ],
    screen: {
      status: 'Card found',
      code: 'SET · 025/198',
      action: 'Add to collection',
    },
    art: 'A phone screen with a camera viewfinder that detects a card and reads its number',
  },
  prices: {
    label: 'Prices',
    title: 'Prices from Cardmarket, in euros.',
    lede: 'For German cards the European market is what counts. Voidbinder shows the Cardmarket price of every variant and, where it fits, TCGplayer in US dollars. Always with source and date.',
    variantsLabel: 'Variants',
    variants: [
      { name: 'Normal', price: '€0.40' },
      { name: 'Reverse holo', price: '€1.20' },
      { name: 'Holo', price: '€3.80' },
      { name: '1st edition', price: '€12.50' },
    ],
    chartSource: 'Cardmarket · Trend price · 2026-10-09',
    chartNote: 'Example values',
    chartLabel: 'Price of the holo variant over 90 days, from €2.90 to €3.80',
    sourcesLabel: 'Sources',
    sources: [
      { name: 'Cardmarket', note: 'Euro · Trend price' },
      { name: 'TCGplayer', note: 'US dollar · Market price' },
    ],
  },
  deck: {
    label: 'Deck builder',
    title: 'Build decks from what you own.',
    lede: 'The deck builder knows your collection. It shows which cards are already in your binder, what is missing and what the rest costs.',
    facts: [
      { term: 'Formats', value: 'Per game, with rule checks' },
      { term: 'Matching', value: 'Against your collection, pocket by pocket' },
      { term: 'Missing list', value: 'With Cardmarket prices' },
    ],
    screen: {
      title: 'Deck 1',
      owned: 'Owned',
      missing: 'Missing',
      summary: 'Missing: 3 cards · €7.60',
    },
    art: 'A deck list with a count per card, owned and missing cards marked',
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack openings, live on stream.',
    lede: 'The Streamer Kit lays your pack openings over the stream: every card you pull appears with its value, plus a count per pack. It grew out of Monday Pack Attack on Twitch.',
    link: 'Monday Pack Attack on twitch.tv/derFrisson',
    overlay: {
      live: 'Live',
      pack: 'Pack 3 of 10',
      last: 'Last pull',
      lastValue: '€4.20',
      total: 'Value so far',
      totalValue: '€18.40',
    },
    art: 'A stream frame with an overlay: pack counter, last pulled card and running value',
  },
  openSource: {
    label: 'Open source',
    title: 'Open code, fair price.',
    lede: 'Voidbinder is licensed under the AGPL-3.0. You can run it yourself, no subscription. If you would rather not, use the hosted version for a small price that covers running it.',
    plans: [
      {
        name: 'Run it yourself',
        price: '€0',
        text: 'Source on GitHub, AGPL-3.0. Your data on your server.',
      },
      {
        name: 'Hosted',
        price: 'Price to follow',
        text: 'We run the servers, backups and price data. Cheaper than the usual €5 to €10 a month.',
      },
    ],
    link: 'Source on GitHub',
  },
  voidcom: {
    label: 'Powered by Voidcom',
    title: 'Built by the team behind Voidcom.',
    lede: 'Voidcom is a voice, video and chat app made in Europe. Voidbinder shares its design language and its standards: open technology, little data, no tricks.',
    link: 'Visit voidcom.app',
  },
  waitlist: {
    title: 'Get into the beta.',
    lede: 'Sign up and we will write to you when the beta starts.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    consentBefore:
      'I agree that Voidbinder stores my email address to tell me when the beta starts. More in the ',
    consentLink: 'privacy policy',
    consentAfter: '.',
    submit: 'Sign up',
    honeypot: 'Website, leave this empty',
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
