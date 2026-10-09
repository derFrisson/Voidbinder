# Card imagery on voidbinder.de and in the app: fact sheet

Fetched 2026-10-09 from the official pages linked below. Every quote is verbatim from the page cited. Sections 6 and 7 are **general information, not legal advice**.

Note on Voidbinder's position: the operator is commercial, and the hosted tier is paid, while the code is AGPL-3.0 and self-hostable. Several policies below exempt only _free_ content, so the paid tier is the main issue throughout.

## 1. Wizards of the Coast: Fan Content Policy (Magic)

Source: https://company.wizards.com/en/legal/fancontentpolicy (last updated Nov 15, 2017)

- **Free only.** "You can't require payments, surveys, downloads, subscriptions, or email registration to access your Fan Content". "You can't sell or license your Fan Content to any third parties for any type of compensation".
- **Monetisation allowed:** "You can, however, subsidize your Fan Content by taking advantage of sponsorships, ad revenue, and donations—so long as it doesn't interfere with the Community's access to your Fan Content."
- **Art is OK:** "Q: Can I create a fan page about your games? And use Wizards' art? A: Yes! We love it! Just follow the policies outlined above." Websites count as Fan Content: "Fan Content includes fan art, videos, podcasts, blogs, websites, …".
- **No logos/trademarks:** "Don't use Wizards' logos and trademarks." / "You may not incorporate any Wizards of the Coast logos and trademarks in your Fan Content without our prior, written consent." Marks that are already printed on a card stay: "don't remove them … You can use those in your Fan Content as long as they aren't changed in any way."
- **Not covered:** "Fan Content does not include the verbatim copying and reposting of Wizards' IP"; anything outside the policy "you'll need our prior, written approval".
- **Required notice:** "[Title of your Fan Content] is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."
- The policy has no clause for apps or tools.

## 2. Scryfall (Magic data and images)

Source: https://scryfall.com/docs/api ("Use of Scryfall Data and Images")

- Scope: "As part of the Wizards of the Coast Fan Content Policy, Scryfall provides our card data and image database free of charge for the primary purpose of creating additional Magic software …"
- **No paywall:** "You may not 'paywall' access to Scryfall data." / "If you have an account system, end-users should be able to access card data anonymously or with free accounts."
- "You may not simply repackage, republish, or proxy Scryfall data. Your software must create additional value for end-users." Also: "You may not use Scryfall logos or use the Scryfall name in a way that implies Scryfall has endorsed you".
- **No alteration:** "Do not cover, crop, or clip off the copyright or artist name on card images." "Do not distort, skew, or stretch …" "Do not blur, sharpen, desaturate, or color-shift card images." "Do not add your own watermarks, stamps, or logos to card images."
- **Art crops:** "list the artist name and copyright elsewhere in the same interface presenting the art crop, or use the full card image elsewhere in the same interface."
- **Rate limits** (https://scryfall.com/docs/api/rate-limits): "/cards/search — 2/second (500ms)", "All other methods — 10/second (100ms)", "The direct file origins located at *.scryfall.io do not have rate limits." "We encourage you to cache the data … at least for 24 hours." "If you need to rapidly look up card names, prices, or resolve a large number of card images, you must use the bulk data files."
- Scryfall's own footer (a model notice): "The literal and graphical information presented on this site about Magic: The Gathering, including card images and mana symbols, is copyright Wizards of the Coast, LLC. Scryfall is not produced by or endorsed by Wizards of the Coast."

## 3. The Pokémon Company International; TCGdex

- Pokémon has **no fan-content or developer licence.** Terms of Use (https://www.pokemon.com/us/legal/terms-of-use) say: "Because we receive thousands of such requests, our policy is to decline use of our trademarks and copyrights." Site content may be used "for personal, noncommercial home use only. In no instance may you: (i) Change or remove any copyright and other proprietary notices … (ii) Modify, or create derivative works based on, the content".
- Legal Information (https://www.pokemon.com/us/legal/information): "Pokémon, Pokémon character names, … are trademarks of Nintendo." Pokémon's use of fan art does not "constitute a grant to Fan Art's creator to use the Pokémon intellectual property or Fan Art beyond a personal, noncommercial home use."
- TCGdex (https://github.com/tcgdex/cards-database, README "Licenses"): "This database is not produced, endorsed, supported or affiliated with Nintendo or The Pokémon Company" and "The Database is licensed under the MIT License." The MIT licence covers TCGdex's own work. TCGdex grants **no** rights in the card images, and its FAQ (https://tcgdex.dev/faq) says nothing about image rights. On rate limits it says: "There are no published hard rate limits, but please be considerate. … cache responses locally".
- Peer notice, Limitless TCG (https://limitlesstcg.com/): "The literal and graphical information presented on this website about the Pokémon Trading Card Game, including card images and text, is copyright The Pokémon Company (Pokémon), Nintendo, Game Freak and/or Creatures. This website is not produced by, endorsed by, supported by, or affiliated with Pokémon, Nintendo, Game Freak or Creatures."

## 4. Konami (Yu-Gi-Oh!); YGOPRODeck

- Konami EU website terms (https://www.yugioh-card.com/eu/website-terms/): "You may not use the Website, or any of its content, for any commercial purpose whatsoever …" and "KONAMI, KONAMI OF EUROPE and associated logos are trademarks … You must not use these or any other registered or unregistered trade marks on the Website without our prior written permission." I found no Western fan-content or developer licence.
- Konami's only creator guideline is Japanese-only (https://www.konami.com/yugioh/guide/movieguideline, revised 2026-07-01): "日本国内に居住するお客様のみ、本ゲームのプレー動画等の投稿が可能です。" (only customers residing in Japan may post play videos). It also excludes "営利目的での投稿" (posts for commercial purposes).
- YGOPRODeck API guide (https://ygoprodeck.com/api-guide/): "Do not continually hotlink images directly from this site. Please download and re-host the images yourself. Failure to do so will result in an IP blacklist." "The rate limit is 20 requests per 1 second. If you exceed this, you are blocked from accessing the API for 1 hour." "Please download and store all data pulled from this API locally". The guide makes no claim that YGOPRODeck holds or grants image rights.
- YGOPRODeck notice (https://ygoprodeck.com/): "The literal and graphical information presented on this site about Yu-Gi-Oh!, including card images, the attribute, level/rank and type symbols, and card text, is copyright 4K Media Inc, a subsidiary of Konami Digital Entertainment, Inc. This website is not produced by, endorsed by, supported by, or affiliated with 4k Media or Konami Digital Entertainment."

## 5. Bandai (One Piece Card Game); optcgapi.com

- Official card list footer (https://en.onepiece-cardgame.com/cardlist/): "©Eiichiro Oda/Shueisha, Toei Animation" / "All images, text and data on this website may not be reproduced without permission." I found no fan or developer policy.
- IP regulation (https://en.onepiece-cardgame.com/news/02_382.html): "No cards, accessory items, or other goods derived from or copied from card designs released or sold by Bandai without authorization may be sold or distributed." "*These regulations do not signify formal permission or consent".
- optcgapi.com (https://optcgapi.com/): "A free to use API …" and "One Piece and the One Piece Trading Card Game data are trademarks of Eiichiro Oda, Bandai, Shonen Jump, and Viz Media." It has no licence or image terms.

## 6. German/EU view (general information, not legal advice)

- **Naming a game (Markennennung).** § 23 MarkenG (https://www.gesetze-im-internet.de/markeng/__23.html) lets third parties use a mark "zu Zwecken der Identifizierung oder zum Verweis auf Waren oder Dienstleistungen als die des Inhabers der Marke". This holds only (Abs. 2) "wenn die Benutzung durch den Dritten den anständigen Gepflogenheiten in Gewerbe oder Handel entspricht". In practice, "works with Magic: The Gathering cards" in plain text is descriptive; a logo or styled wordmark suggests affiliation.
- **Photos of cards you own.** Owning a card does not let you publish its artwork. Exhaustion in § 17 Abs. 2 UrhG (https://www.gesetze-im-internet.de/urhg/__17.html) covers only "Weiterverbreitung" of the physical copy. Putting a photo online is öffentliche Wiedergabe, and exhaustion does not apply to it. Your own photo has its own protection as a Lichtbild under § 72 UrhG, but the card art inside it does not become free.
- **§ 51 UrhG (quotation)** (https://www.gesetze-im-internet.de/urhg/__51.html) applies only "zum Zweck des Zitats, sofern die Nutzung in ihrem Umfang durch den besonderen Zweck gerechtfertigt ist". A quotation needs a discussion that the work serves. Decorative marketing imagery does not qualify.
- **§ 57 UrhG (unwesentliches Beiwerk)** (https://www.gesetze-im-internet.de/urhg/__57.html) applies only if the work is incidental "neben dem eigentlichen Gegenstand". That fits a card visible at the edge of a photo of a phone or binder, not a card shown as the subject.
- **Reseller advertising** (BGH 4.5.2000, I ZR 256/97 "Parfumflakon"; CJEU C-337/95 Dior/Evora) lets a seller depict protected goods to advertise _their resale_. The dejure.org listing (https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BGH&Datum=04.05.2000&Aktenzeichen=I%20ZR%20256/97) summarises it as "Das Anfertigen von Produktfotos ist zulässig". I did not retrieve the full text. Voidbinder does not sell cards, so this rule probably does not cover an app's marketing.
- **What EU apps do.** ManaBox ("Made by SkillDevs in A Coruña", https://manabox.app/) shows Scryfall-style images with: "ManaBox is an unofficial, fan made website and is NOT affiliated, endorsed or supported by Wizards of the Coast LLC nor Hasbro, Inc in any way. The Magic: The Gathering information, card images, mana icons and set icons found within this website are copyrighted by Wizards of the Coast LLC." Cardmarket, ligamagic, deckstats.net, tcgcollector.com and moxfield.com blocked automated fetching (HTTP 403), so their wording is **unverified**.

## 7. Recommendation matrix (general information, not legal advice)

Website = marketing for a commercial product, the strictest case. App = user-facing tool that ships card images inside a paid tier.

| Game      | (a) own card photos                                                                                                            | (b) official scans via API                                                                                                                                                  | (c) set symbols                                                                                             | (d) game/company logos                          | (e) game names in text                                       |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| Magic     | Website: incidental only (cards in a binder or on a phone, § 57). App: OK under FCP **if the card data stays reachable free**. | App: OK under Scryfall rules, unaltered, with card data on a free/anonymous path. Website: low–medium risk; hero use in paid-tier ads goes beyond the FCP's "free" premise. | Medium; ManaBox and others treat them as WotC copyright. Use inside the app only, never as site decoration. | **No** (FCP: no logos without written consent). | Yes, descriptive, plain text.                                |
| Pokémon   | Website: incidental only. App: high risk. Pokémon has no fan licence and "decline[s]" requests.                                | App: high risk, widely done (Limitless, TCGdex consumers). Website: **avoid**.                                                                                              | Avoid on the website.                                                                                       | **No.**                                         | Yes, descriptive ("Pokémon TCG"), plus the trademark notice. |
| Yu-Gi-Oh! | Website: incidental only. App: medium–high risk, no Western policy.                                                            | App: re-host the images, never hotlink. Website: **avoid**.                                                                                                                 | Avoid on the website.                                                                                       | **No.**                                         | Yes, descriptive.                                            |
| One Piece | Website: incidental only. App: high risk ("may not be reproduced without permission").                                         | App: high risk, and optcgapi grants nothing. Website: **avoid**.                                                                                                            | Avoid.                                                                                                      | **No.**                                         | Yes, descriptive.                                            |

**Safest website imagery:** app screenshots with original, made-up placeholder cards, or photos where real cards are small and incidental. No logos. Add a disclaimer block in the footer and on /impressum.

**Disclaimer texts** (adapted from the peer notices quoted above):

- Magic: "Voidbinder is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC." This is required verbatim by the FCP, with the title inserted.
- Pokémon: "Pokémon and Pokémon character names are trademarks of Nintendo. Card images and text are © The Pokémon Company, Nintendo, Game Freak and/or Creatures. Voidbinder is not produced by, endorsed by, supported by, or affiliated with Pokémon, Nintendo, Game Freak or Creatures."
- Yu-Gi-Oh!: "Yu-Gi-Oh! card images and text are © 4K Media Inc., a subsidiary of Konami Digital Entertainment, Inc. Voidbinder is not produced by, endorsed by, supported by, or affiliated with 4K Media or Konami Digital Entertainment."
- One Piece: "ONE PIECE Card Game card images and text © Eiichiro Oda/Shueisha, Toei Animation; the game is published by Bandai. Voidbinder is not produced by, endorsed by, or affiliated with Bandai, Shueisha or Toei Animation."
- Data sources: "Magic card data and images via Scryfall. Voidbinder is not endorsed by Scryfall."

## Open questions for a lawyer

1. Does a paid hosted tier take the app (and the site advertising it) outside the WotC FCP's "Free means FREE" condition, if card data stays free on the self-hosted AGPL build or a free account? Does that also satisfy Scryfall's "anonymously or with free accounts"?
2. Under German law, is showing real card artwork in app screenshots on a commercial site öffentliche Wiedergabe with no exception (§§ 51, 57 UrhG)? Does the reseller-advertising doctrine (Parfumflakon, Dior/Evora) reach a collection-tracking app that sells no cards?
3. Pokémon, Konami and Bandai have no licence: what takedown or Abmahnung exposure does a German operator face for showing their card images inside a paid app? Should we ask for a licence, or ship those games without images?
4. Are set symbols registered trademarks or only copyright works, and does showing them in a set filter count as § 23 Nr. 3 MarkenG reference use?
5. Can the app ship card images in an AGPL-3.0 repository or bundle at all, or must images stay fetched at runtime and outside the licensed code?
6. Which notice does German law need in the Impressum, and must the disclaimers appear in German too?
