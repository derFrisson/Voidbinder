import type { Dict } from './de';

// English copy (en-US). Typed against the German dictionary, so a missing or extra key fails
// typecheck. Same tone as the German, not a word-for-word translation.
export const en: Dict = {
  meta: {
    lang: 'en',
    ogLocale: 'en_US',
    title: 'Voidbinder · Your whole collection in one app',
    description:
      'Pokémon, Yu-Gi-Oh!, Magic and One Piece in one binder: scan, price, build decks. Works offline, with Cardmarket prices. Open source, waitlist open.',
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
    streamer: 'Streamers',
    cta: 'Join the waitlist',
    ctaShort: 'Waitlist',
  },
  hero: {
    title: 'Your whole collection. One app.',
    accent: 'With real prices.',
    lede: 'Pokémon, Yu\u2011Gi\u2011Oh!, Magic and One\u00a0Piece in one binder: scan it, price it, build decks with it. Works offline, with Cardmarket prices.',
    primary: 'Join the waitlist',
    secondary: 'View the source',
    trustLabel: 'In short',
    trust: ['Open source', 'Made in Germany', 'Works offline', '4 games'],
    art: 'A phone scans the example card Glimmerfuchs and shows it with its price, a deck list behind it',
    callout: 'Recognized offline',
    calloutNote: 'Image recognition runs on the phone',
    deck: {
      label: 'Deck list',
      meta: '60/60 cards · €41.70',
      tabs: ['List', 'Curve', 'Prices'],
      support: 'Item',
    },
    scan: {
      game: 'Pokémon',
      offline: 'Offline',
      detected: 'Recognized',
      condition: 'Near Mint',
      language: 'EN',
      add: 'Add to collection',
    },
    tabbar: ['Binder', 'Decks', 'Scan', 'Profile'],
  },
  cards: {
    fox: {
      type: 'Spark creature · Stage 1',
      attack: 'Spark Leap',
      flavor: 'Its tail glows when it smells a stranger.',
    },
    warden: {
      type: 'Shadow / Effect',
      flavor: 'Turn it face up and the field falls silent.',
      rule: 'When this card is flipped face up, no trap can be activated for one turn.',
    },
    coral: {
      type: 'Creature · Reef keeper',
      flavor: 'It only grows when the sky breaks.',
      rule: 'When a thunderstorm begins, each coral gets +1/+1.',
    },
    sail: {
      type: 'Crew · Harbor town',
      flavor: 'Sail against the wind and you arrive first.',
    },
  },
  games: {
    label: 'Games',
    title: 'Four games, one binder.',
    lede: 'Every game has its own sets, numbers and variants. Voidbinder knows them all and sorts your cards the way they sit in your binder.',
    soon: 'Coming later',
    list: [
      {
        name: 'Pokémon',
        text: 'Sets, numbers and variants down to Reverse Holo, in English and German printings.',
      },
      {
        name: 'Yu-Gi-Oh!',
        text: 'The scanner reads rarities and 1st Editions too, so your binder is priced right.',
      },
      {
        name: 'Magic: The Gathering',
        text: 'Foil or not: every printing of a card side by side, with a price for each edition.',
      },
      {
        name: 'One Piece',
        text: "It's on the list. Waiting for it? Tell us when you sign up.",
      },
    ],
  },
  scanner: {
    label: 'Scanner',
    title: 'Hold up the card. Done.',
    lede: 'No typing, no hunting for the right set. The app reads the card, finds the printing and suggests the matching variant.',
    facts: [
      'Number and set are recognized on the phone',
      'Works without a connection',
      'Pick the variant, each with its price',
    ],
    art: 'A camera viewfinder recognizes the example card Glimmerfuchs, number 042/198, 3.20 euros',
    live: 'Live recognition',
    hudSet: 'Funkenflug set',
    variants: 'Variants',
    prints: '3 printings',
    normal: 'Normal',
    holo: 'Holo',
    reverse: 'Reverse Holo',
  },
  prices: {
    label: 'Prices',
    title: "What's your collection worth?",
    lede: "Every card gets today's price, and the binder keeps the total. You see at a glance what your binder is worth and which card is moving.",
    worth: 'Collection value',
    count: '612 cards in 3 games',
    period: 'in 90 days',
    fine: 'Prices from Cardmarket and TCGplayer, updated daily. Condition prices are estimates. The cards and values on this page are examples.',
    chartTitle: 'Price history, 90 days',
    chartSource: 'Cardmarket, trend',
    chartLabel: 'The price rose from about 2.80 to 3.20 euros in 90 days',
    chartStart: '90 days ago',
    chartEnd: 'today',
  },
  reseller: {
    label: 'For sellers',
    title: 'Your stock, logged in minutes.',
    lede: 'A collection buy on the counter, a box from the basement, stock for the next show: card after card under the camera, and the list writes itself.',
    facts: [
      {
        title: 'Bulk scan',
        text: 'Slide cards under the camera one by one. The app counts them, spots duplicates and builds stacks.',
      },
      {
        title: 'Price history per card',
        text: "Every card in stock has its own history. You see what's rising and decide when to sell.",
      },
      {
        title: 'Export as Cardmarket CSV',
        text: 'Your stock as a CSV in Cardmarket format, with condition, language and quantity. Upload it instead of typing.',
      },
    ],
    art: 'Bulk scan in the app: 214 cards logged, a list with prices, export as Cardmarket CSV',
    screen: {
      label: 'Bulk scan',
      title: 'October batch',
      status: 'Running, slide in the next card',
      progress: '214 of ~300 cards',
      firstEdition: '1st Ed.',
      export: 'Export as Cardmarket CSV',
    },
  },
  streamer: {
    label: 'Streamer Kit',
    title: 'Pack openings on stream, every pull priced in the overlay.',
    lede: 'A browser overlay for OBS: you scan the card you pulled, and chat sees its name, its price and how the pack stands against the box price.',
    link: 'Monday Pack Attack on Twitch',
    art: 'Example stream overlay: last pull Nebelwächter at 18.40 euros, 46.90 euros pulled of an 89.00 euro box price',
    overlay: {
      live: 'Live',
      viewers: '1,204 viewers',
      last: 'Last pull',
      total: 'Pulled vs. box price',
      of: 'of',
      pack: 'Pack 7 of 18',
    },
  },
  openSource: {
    label: 'Open source',
    title: 'Open. And still easy.',
    lede: 'All of the code is open. Run Voidbinder yourself, or leave the server to us.',
    self: {
      label: 'Self-host',
      text: 'On your computer, your NAS or your server. Your data stays where you put it, and you can read every line.',
      link: 'View the source',
    },
    hosted: {
      label: 'Hosted',
      price: 'Less than a booster',
      period: 'a month.',
      text: 'We run the servers, the backups and the daily price sync, and your data stays in the EU. You just scan.',
      checks: ['Sync on all devices', 'Daily prices', 'Backups included', 'Data in the EU'],
    },
  },
  waitlist: {
    title: 'Get into the beta.',
    lede: "We'll email you when the beta starts. One email, no newsletter.",
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    consentBefore:
      'I agree that Voidbinder stores my email address to let me know when the beta starts. More in the ',
    consentLink: 'privacy policy',
    consentAfter: '.',
    submit: 'Sign up',
    sending: 'Sending',
    honeypot: 'Website, leave this empty',
    errors: {
      email: "That email address doesn't look right. Please check it.",
      consent: "Please check the box, otherwise we can't store your address.",
      rate: 'Too many attempts. Please wait a minute.',
      server: "That didn't work. Please try again later.",
    },
  },
  status: {
    label: 'Waitlist',
    home: 'Back to the home page',
    pending: {
      title: 'Check your inbox.',
      text: 'We sent you an email. Click the link in it to confirm your sign-up. The link works for 7 days. Nothing there? Check your spam folder.',
    },
    confirmed: {
      title: "You're on the waitlist.",
      text: "Thanks. We'll email you when there's something to test. You can unsubscribe with the link in every email.",
    },
    unsubscribed: {
      title: "You're unsubscribed.",
      text: "We won't email you again. You can sign up again at any time.",
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
        text: "Without the check mark we can't store your address.",
      },
      server: {
        title: "That didn't work.",
        text: 'Something went wrong on our side. Please try again later.',
      },
      action: 'Back to the form',
    },
    unsubscribe: {
      title: 'Unsubscribe from the waitlist?',
      text: "One click and you're unsubscribed. We won't email you again.",
      button: 'Unsubscribe',
      invalid: 'This unsubscribe link is incomplete. Please use the link from the email.',
    },
  },
  footer: {
    poweredBy: 'Powered by',
    imprint: 'Imprint',
    privacy: 'Privacy',
    github: 'GitHub',
    twitch: 'Twitch',
    trademarks:
      'Pokémon, Yu-Gi-Oh!, Magic: The Gathering and One Piece are trademarks of their respective owners. Voidbinder is an independent project.',
    rights: '© 2026 Voidbinder · Made with love in Germany',
  },
};
