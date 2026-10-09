// German copy of the app. This object defines the shape every locale must match (`Dict`).
// `{name}` placeholders are filled by `fmt()`. `‑` is a non-breaking hyphen.
export const de = {
  links: {
    imprint: 'https://voidbinder.de/de/impressum/',
    privacy: 'https://voidbinder.de/de/datenschutz/',
  },
  nav: {
    main: 'Hauptnavigation',
    tabs: 'App-Navigation',
    home: 'Voidbinder, zur Startseite',
    collection: 'Sammlung',
    decks: 'Decks',
    search: 'Suche',
    profile: 'Profil',
    signIn: 'Anmelden',
    breadcrumb: 'Pfad',
    back: 'Zurück',
  },
  top: {
    search: 'Karte, Set oder Nummer suchen',
    scanPile: 'Scan-Stapel',
    scanPileHint: 'Der Scan-Stapel kommt mit der Handy-App.',
  },
  state: {
    loading: 'Lädt …',
    error: 'Das hat nicht geklappt. Prüfe die Verbindung und versuch es noch einmal.',
    retry: 'Erneut versuchen',
    notFound: 'Das gibt es hier nicht.',
  },
  games: {
    pokemon: 'Pokémon',
    yugioh: 'Yu‑Gi‑Oh!',
    mtg: 'Magic: The Gathering',
    onepiece: 'One Piece',
  },
  home: {
    title: 'Spiele',
    lede: 'Wähle ein Spiel und blättere durch seine Sets.',
    sets: '{count} Sets',
    noSets: 'Noch keine Sets importiert',
    later: 'kommt später',
  },
  game: {
    count: '{count} Sets',
    empty: 'Für dieses Spiel sind noch keine Sets importiert.',
  },
  set: {
    count: '{count} Karten',
    empty: 'In diesem Set gibt es keine Karten mit diesen Filtern.',
  },
  card: {
    prints: '{count} Drucke',
  },
  search: {
    title: 'Suche',
    soon: 'Die Kartensuche mit Filtern kommt als Nächstes.',
  },
  collection: {
    title: 'Sammlung',
    soon: 'Hier entsteht deine Sammlung mit Habe- und Will-Liste.',
  },
  decks: {
    title: 'Decks',
    soon: 'Hier entsteht der Deckbau mit „Was fehlt mir“.',
  },
  form: {
    email: 'E-Mail-Adresse',
    password: 'Passwort',
    passwordHint: 'Mindestens 10 Zeichen',
    name: 'Name',
    required: 'Pflichtfeld',
  },
  signIn: {
    title: 'Anmelden',
    lede: 'Melde dich an, um deine Sammlung und Decks zu sehen.',
    submit: 'Anmelden',
    forgot: 'Passwort vergessen?',
    noAccount: 'Noch kein Konto?',
    toSignUp: 'Konto erstellen',
  },
  signUp: {
    title: 'Konto erstellen',
    lede: 'Kostenlos. Wir schicken dir einen Link, mit dem du deine Adresse bestätigst.',
    submit: 'Konto erstellen',
    consentBefore: 'Ich habe die ',
    consentLink: 'Datenschutzerklärung',
    consentAfter: ' gelesen und stimme ihr zu.',
    optIn:
      'Meine Scans dürfen als Trainingsdaten für die Kartenerkennung genutzt werden. Freiwillig und jederzeit im Profil änderbar.',
    haveAccount: 'Schon ein Konto?',
    toSignIn: 'Anmelden',
    sentTitle: 'Schau in dein Postfach',
    sentBody:
      'Wir haben einen Link an {email} geschickt. Er gilt eine Stunde. Danach kannst du dich anmelden.',
  },
  verify: {
    title: 'E-Mail bestätigen',
    checking: 'Wir prüfen deinen Link …',
    done: 'Deine E-Mail-Adresse ist bestätigt. Du kannst dich jetzt anmelden.',
    failed: 'Der Link ist ungültig oder abgelaufen. Lass dir einen neuen schicken.',
    missing:
      'Öffne den Link aus unserer Mail, um deine Adresse zu bestätigen. Keine Mail bekommen?',
    resend: 'Neuen Link senden',
    resent:
      'Falls es ein unbestätigtes Konto mit dieser Adresse gibt, ist ein neuer Link unterwegs.',
    toSignIn: 'Zur Anmeldung',
  },
  reset: {
    title: 'Passwort zurücksetzen',
    requestLede:
      'Gib deine E-Mail-Adresse ein. Wir schicken dir einen Link für ein neues Passwort.',
    request: 'Link senden',
    requested:
      'Falls es ein Konto mit dieser Adresse gibt, ist ein Link unterwegs. Er gilt eine Stunde.',
    newPassword: 'Neues Passwort',
    repeat: 'Passwort wiederholen',
    submit: 'Passwort speichern',
    done: 'Dein Passwort ist geändert und alle Sitzungen sind beendet. Melde dich neu an.',
    toSignIn: 'Zur Anmeldung',
  },
  errors: {
    invalid: 'E-Mail-Adresse oder Passwort stimmt nicht.',
    unverified: 'Bitte bestätige zuerst deine E-Mail-Adresse. Der Link ist in deinem Postfach.',
    rateLimited: 'Zu viele Versuche. Warte eine Minute und versuch es dann noch einmal.',
    tokenInvalid: 'Der Link ist ungültig oder abgelaufen.',
    generic: 'Das hat nicht geklappt. Versuch es noch einmal.',
    email: 'Gib eine gültige E-Mail-Adresse ein.',
    password: 'Das Passwort braucht mindestens 10 Zeichen.',
    mismatch: 'Die Passwörter stimmen nicht überein.',
    name: 'Gib einen Namen ein.',
    consent: 'Ohne deine Zustimmung können wir kein Konto anlegen.',
    displayName: 'Der Anzeigename braucht 2 bis 40 Zeichen.',
  },
  profile: {
    title: 'Profil',
    signedInAs: 'Angemeldet als',
    settings: 'Einstellungen',
    displayName: 'Anzeigename',
    displayNameHint: '2 bis 40 Zeichen, für andere sichtbar',
    language: 'Sprache',
    currency: 'Währung',
    languages: { de: 'Deutsch', en: 'English' },
    currencies: { EUR: 'Euro (€)', USD: 'US‑Dollar ($)' },
    optIn: 'Trainingsdaten',
    optInHint:
      'Meine Scans dürfen als Trainingsdaten für die Kartenerkennung genutzt werden. Aus, bis du es einschaltest.',
    save: 'Speichern',
    saved: 'Gespeichert.',
    signOut: 'Abmelden',
    deleteTitle: 'Konto löschen',
    deleteHint:
      'Wir löschen dein Konto und deine Daten nach einer Frist. Meldest du dich vorher wieder an, bleibt alles erhalten.',
    delete: 'Konto löschen',
    confirmTitle: 'Konto wirklich löschen?',
    confirmBody:
      'Du wirst auf allen Geräten abgemeldet. Meldest du dich innerhalb der Frist wieder an, ist die Löschung zurückgenommen.',
    confirm: 'Ja, Konto löschen',
    cancel: 'Abbrechen',
    deleted: 'Die Löschung ist beantragt und du bist abgemeldet.',
  },
  footer: {
    label: 'Fußzeile',
    notices: 'Rechtehinweise',
    poweredBy: 'Powered by',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    source: 'Quellcode',
  },
  // Rights notices per game (docs/marketing/card-imagery-legal.md, section 7). Wizards' Fan Content
  // Policy requires its notice verbatim, so the Magic notice is English in both locales.
  notices: {
    mtg: 'Voidbinder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.',
    pokemon:
      'Pokémon und die Namen der Pokémon-Figuren sind Marken von Nintendo. Kartenbilder und -texte © The Pokémon Company, Nintendo, Game Freak und/oder Creatures. Voidbinder wird nicht von Pokémon, Nintendo, Game Freak oder Creatures produziert, befürwortet oder unterstützt und ist mit ihnen nicht verbunden.',
    yugioh:
      'Yu-Gi-Oh!-Kartenbilder und -texte © 4K Media Inc., eine Tochtergesellschaft von Konami Digital Entertainment, Inc. Voidbinder wird nicht von 4K Media oder Konami Digital Entertainment produziert, befürwortet oder unterstützt und ist mit ihnen nicht verbunden.',
    onepiece:
      'Kartenbilder und -texte des ONE PIECE Card Game © Eiichiro Oda/Shueisha, Toei Animation; das Spiel wird von Bandai herausgegeben. Voidbinder wird nicht von Bandai, Shueisha oder Toei Animation produziert oder befürwortet und ist mit ihnen nicht verbunden.',
    scryfall:
      'Magic-Kartendaten und -bilder über Scryfall. Voidbinder wird nicht von Scryfall befürwortet.',
  },
};

export type Dict = typeof de;
