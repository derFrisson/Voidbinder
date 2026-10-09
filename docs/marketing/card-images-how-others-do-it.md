# How other sites show card images publicly (VB-26)

Research run 2026-10-09. 46 sites in four groups: Magic, Pokémon, Yu-Gi-Oh!, and multi-game apps, marketplaces and shops. A first pass fetched every site. A second pass re-checked the main claims of the Magic, Pokémon and Yu-Gi-Oh! groups and the Pokémon lawsuits of the multi-game group. Its corrections are worked in below, and where it disagreed with the first pass the text says so.

This document extends [card-imagery-legal.md](card-imagery-legal.md) (the fact sheet) and [competitor-sites.md](competitor-sites.md). Where it corrects them, section 3.8 says so. Section 4 is **general information, not legal advice**.

Markers used throughout:

- **fetched**: the page was fetched on 2026-10-09 and the claim was read off it.
- **rechecked**: the second pass confirmed it independently.
- **secondary**: taken from a search snippet, news article, store listing or archive copy, not from the site itself.
- **unverified**: could not be checked. Treat it as an open point.
- **blocked**: the site refused automated fetching (HTTP 403 or a JavaScript challenge).

## 1. Short answer

Almost every site that shows card images copies them onto its own server or CDN and serves them from there. Hotlinking someone else's image files is rare (one Magic site does it for a few images, one dead Yu-Gi-Oh! simulator did it for all of them). Nobody we checked claims a licence from Wizards of the Coast, The Pokémon Company or Konami. They rely on a one-line notice in the footer or the store listing that names the rights holder and says the site is not affiliated, and many show no notice at all. Magic sites can also point to the Wizards Fan Content Policy, which only covers free content. Paid tiers are common, also from EU operators in Romania, Spain, Portugal, France, Austria and Denmark, and where we could check, the card images stay on the free path while the paywall covers tools. Apps with card images pass App Store and Google Play review. The enforcement on record mostly hits proxy makers, an NFT project and online dueling simulators, with one important exception: The Pokémon Company International sued a price guide (Beckett, 2010, settled) and the collection tracker Pokellector (2014, settlement talks, the app is still live) over card images. In short: self-hosting is normal, a disclaimer is what everyone uses, and none of it is a licence.

## 2. Comparison tables

"Notice" is summarised here. The verbatim wording is in section 3.2. Prices are as listed on 2026-10-09.

### 2.1 Magic: The Gathering

| Site                                        | Operator, country                                                                   | Image host                                                                                                                            | Access, paid tier                                                                                           | Notice                                                                         | Store app                                                            | Verified                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------- |
| [Scryfall](https://scryfall.com/)           | Scryfall, LLC, US (state unverified)                                                | cards.scryfall.io (the origin)                                                                                                        | free, no login, no paid tier; Patreon                                                                       | Fan Content Policy notice plus WotC copyright line                             | none (only third-party "Scry MTG")                                   | fetched, rechecked           |
| [Moxfield](https://moxfield.com/)           | founders Harry Finocchiaro and John Tull (secondary); entity and country unverified | assets.moxfield.net (secondary)                                                                                                       | free, Patreon (secondary)                                                                                   | not readable                                                                   | none                                                                 | blocked                      |
| [Archidekt](https://archidekt.com/)         | Archidekt LLC, branded Space Cow Media, US (Buffalo NY, secondary)                  | card-images.archidekt.com and a Google Cloud bucket; also hotlinks some cards.scryfall.io art crops and svgs.scryfall.io mana symbols | free; Patreon removes ads                                                                                   | WotC trademark line, "Archidekt is unaffiliated"                               | none                                                                 | fetched, rechecked           |
| [ManaBox](https://manabox.app/)             | SkillDevs S.C., A Coruña (Spain inferred from city and entity form)                 | no card images on the website; the app database is offline, image origin unknown                                                      | free app with ads; PRO $2.49/month or $22.99/year                                                           | WotC copyright, "NOT affiliated"                                               | iOS since 2019-05-11, Google Play                                    | fetched, rechecked           |
| [MTGGoldfish](https://www.mtggoldfish.com/) | MTGGoldfish, Inc., US (San Mateo CA, secondary)                                     | cards.mtggoldfish.com (own ids)                                                                                                       | free; Premium $5.99/month or $59.88/year                                                                    | WotC trademark line, "not affiliated"                                          | none                                                                 | fetched, rechecked           |
| [MTGStocks](https://www.mtgstocks.com/)     | not disclosed                                                                       | static.mtgstocks.com/cardimages (own ids)                                                                                             | free; a Premium tier exists, price unverified                                                               | WotC copyright, "not ... affiliated"                                           | none                                                                 | fetched; operator unverified |
| [Deckbox](https://deckbox.org/)             | Leaping Frog Studios SRL, Baia Mare, Romania; hosted at Hetzner                     | s.deckbox.org                                                                                                                         | free ("Your collection stays free"); Premium $5.99/month or $47.88/year                                     | website: an ownership credit on /contact only; Play listing: "not affiliated"  | Google Play; no iOS app                                              | fetched, rechecked           |
| [EchoMTG](https://www.echomtg.com/)         | ThoughtBomb Studios, LLC, San Diego, US                                             | assets.echomtg.com behind an image proxy                                                                                              | free Basic (500 cards); $4, $8, $12 and $25 per month tiers                                                 | footer "property of Wizards of the Coast"; terms invoke the Fan Content Policy | iOS since 2014-04-24, Google Play                                    | fetched, rechecked           |
| [Delver Lens](https://www.delverlab.com/)   | Delver Lab, Belo Horizonte, Brazil                                                  | no card images on the website; app ships a local database, image origin unknown                                                       | free app; Delver Pro $4.99/month or $49.99/year                                                             | in the Play description only                                                   | iOS since 2024-06-25, Google Play                                    | fetched, rechecked           |
| [CardCastle](https://cardcastle.co/)        | OzGuild Pty. Ltd., Canberra, Australia                                              | inside the logged-in app, host not visible                                                                                            | login required; free Squire tier browses only the first 1,000 cards; Knight tier $9/month (secondary, 2022) | WotC trademark and copyright, "unaffiliated"; nothing for Pokémon or Konami    | iOS since 2018-08-18 (Magic only)                                    | fetched, rechecked           |
| [TappedOut](https://tappedout.net/)         | TappedOut.net, LLC, Florida law, US                                                 | static.tappedout.net, some paths marked "\_user-added"                                                                                | free                                                                                                        | WotC copyright, "This site is unaffiliated"; DMCA page                         | an Android app existed (com.tappedout), now 404 on Play (unverified) | fetched, rechecked           |
| [EDHREC](https://edhrec.com/)               | Space Cow Media, US (secondary)                                                     | card-images.edhrec.com, Scryfall ids and path layout, re-encoded copies on S3/CloudFront                                              | free; Patreon, ads                                                                                          | Fan Content Policy notice                                                      | none                                                                 | fetched, rechecked           |

### 2.2 Pokémon TCG

| Site                                                                      | Operator, country                                                 | Image host                                                | Access, paid tier                                                                         | Notice                                                                                  | Store app                                   | Verified                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- |
| [Limitless TCG](https://limitlesstcg.com/)                                | Robin Schulz, Gdańsk, Poland (named individual with a Polish NIP) | limitlesstcg.nyc3.cdn.digitaloceanspaces.com (own bucket) | free; Patreon removes ads; Playwire ads; TCGplayer affiliate link                         | "literal and graphical information" template                                            | none                                        | fetched, rechecked           |
| [Pokellector](https://www.pokellector.com/)                               | Makazu Co, US (App Store seller)                                  | den-cards.pokellector.com (served by BunnyCDN)            | free website; app with quarterly or yearly subscriptions                                  | "not affiliated with ... The Pokemon Company International"                             | iOS id600580227; Google Play (secondary)    | fetched, rechecked           |
| [TCG Collector](https://www.tcgcollector.com/)                            | Egon Olieux (secondary), country unknown                          | unknown                                                   | free; Premium $3.99/month or $40/year (secondary)                                         | not readable                                                                            | no first-party app                          | blocked                      |
| [pokemontcg.io](https://pokemontcg.io/) / [Scrydex](https://scrydex.com/) | individual project; Scrydex terms under Wisconsin law             | images.pokemontcg.io                                      | API deprecated, existing keys work until 2027-03-01; Scrydex from $29/month, no free tier | "not produced, endorsed, supported, or affiliated with Nintendo or The Pokémon Company" | n/a                                         | fetched, rechecked           |
| [TCGdex](https://tcgdex.net/)                                             | open-source project, operator not stated                          | assets.tcgdex.net                                         | free, GitHub Sponsors                                                                     | "not produced, endorsed, supported, or affiliated with ..."; website GPL-3.0, data MIT  | none                                        | fetched                      |
| [Pokécardex](https://www.pokecardex.com/)                                 | NUMELEK, Villeurbanne, France                                     | pokecardex.b-cdn.net (seen on /app only)                  | free website; app €1.99/week, €3.99/month or €39.99/year                                  | App Store: "n'est pas une application officielle Pokemon"                               | iOS, Google Play                            | fetched (listing), rechecked |
| [PkmnCards](https://pkmncards.com/)                                       | unnamed individual, since 2011                                    | pkmncards.com/wp-content/uploads                          | free; TCGplayer affiliate                                                                 | template, extended with Wizards of the Coast                                            | none                                        | fetched, rechecked           |
| [Pokémon Zone](https://www.pokemon-zone.com/)                             | unknown                                                           | unknown (TCG Pocket game assets, not scans)               | free (secondary)                                                                          | "unofficial fan site" (secondary)                                                       | none                                        | blocked                      |
| [Dex](https://dextcg.com/)                                                | Dexbit Lda, Maia, Portugal                                        | static.dextcg.com                                         | free; Dex+ $3.99/month to $109 lifetime (US store), €3.99 to €119 (EU store)              | "Not affiliated with Nintendo or The Pokémon Company."                                  | iOS since 2021, Google Play                 | fetched, rechecked           |
| [TCG Album](https://tcgalbum.com/)                                        | Fredrik Gustafsson, Vienna, Austria (UID ATU81450537)             | cdn.tcgalbum.com                                          | free up to 50 cards; Premium €4.99/month, Family €9.99/month                              | trademark notice only, German and English                                               | Google Play only; the App Store link is 404 | fetched, rechecked           |
| [Serebii](https://www.serebii.net/card/)                                  | Joe Merrick, UK (secondary)                                       | unverified                                                | free, ads                                                                                 | own copyright plus "Trademark & © of Nintendo"; no "not affiliated" sentence            | none                                        | fetched                      |
| [Bulbapedia](https://bulbapedia.bulbagarden.net/)                         | Bulbagarden (secondary)                                           | archives.bulbagarden.net (secondary)                      | free, ads                                                                                 | copyright line, US fair use rationale                                                   | none                                        | blocked                      |

### 2.3 Yu-Gi-Oh!

| Site                                                                     | Operator, country                                                                                  | Image host                                       | Access, paid tier                                                                | Notice                                                                  | Store app                                                        | Verified                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| [YGOPRODeck](https://ygoprodeck.com/) (db.ygoprodeck.com redirects here) | founded by Alan O'Connor; owned by BiFrost Entertainment, Norway, since 2024 (secondary)           | images.ygoprodeck.com                            | free; Premium €4.99/month for ad removal, Deck Brew, extra cubes, cosmetic perks | "literal and graphical information" template naming 4K Media and Konami | none (a Windows companion app)                                   | fetched, rechecked                                                  |
| [Yugipedia](https://yugipedia.com/)                                      | founded by Dan Parker, Canada; acquired by GGRecon (UK) in Dec 2023; current owner unclear         | ms.yugipedia.com                                 | free, ads                                                                        | US fair use disclaimer                                                  | none (the "Yugipedia Deck Builder" app is an unrelated operator) | policy pages fetched via API, card page via archive copy, rechecked |
| [DuelingBook](https://www.duelingbook.com/)                              | not disclosed                                                                                      | images.duelingbook.com, inside the logged-in app | free account, ads                                                                | none                                                                    | none                                                             | fetched                                                             |
| [Master Duel Meta](https://www.masterduelmeta.com/)                      | Duel Links Meta LLC, US (state unknown)                                                            | s3.duellinksmeta.com, resized through wsrv.nl    | free, ads                                                                        | own copyright line only                                                 | none                                                             | fetched                                                             |
| [YGOrganization](https://ygorganization.com/)                            | Dan Parker, Canada (Ontario law in its terms); back in his ownership from GGRecon per its own post | cdn.ygorganization.com                           | free, ads, Patreon                                                               | terms: "independent fan-operated site"                                  | none                                                             | fetched, rechecked                                                  |
| [Konami card database](https://www.db.yugioh-card.com/yugiohdb/)         | Konami Digital Entertainment, Japan (the rights holder)                                            | own host, per-image token                        | free browsing; terms allow personal, non-commercial use only                     | official copyright lines                                                | Yu-Gi-Oh! Neuron (iOS; Google Play secondary)                    | fetched, rechecked                                                  |
| [YugiohPrices](https://yugiohprices.com/)                                | Studio Bebop, US (secondary)                                                                       | static-7.studiobebop.net                         | was free, affiliate-funded                                                       | own copyright only                                                      | historic Android app (secondary)                                 | dead; archive copies only                                           |
| [Dueling Nexus](https://duelingnexus.com/)                               | not disclosed                                                                                      | hotlinked from ygopro.online                     | free account, ads                                                                | own copyright only                                                      | none                                                             | app 404; archive copy                                               |

### 2.4 Multi-game apps, marketplaces and shops

The second-pass verdicts for this group were not available to this report except for the Pokémon lawsuits, so "fetched" here means first pass only.

| Site                                                   | Operator, country                                            | Image host                                                 | Access, paid tier                             | Notice                                                 | Store app                            | Verified                 |
| ------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------ | ------------------------------------ | ------------------------ |
| [cardcluster.de](https://cardcluster.de/)              | unknown                                                      | unknown                                                    | unknown                                       | not readable                                           | none found                           | blocked                  |
| [Collectr](https://www.getcollectr.com/)               | Collectr Inc, Vaughan, Ontario, Canada                       | public.getcollectr.com for UI assets; card host unverified | free; PRO $7.99/month or $59.99/year          | TCGplayer non-endorsement line only                    | iOS, Google Play                     | fetched                  |
| [CollX](https://www.collx.app/)                        | CollX LLC, Haddonfield NJ, US                                | unknown                                                    | Pro $9.99/month, Gold $24.99/month            | own copyright; DMCA agent                              | iOS, Android                         | fetched                  |
| [TCGplayer](https://www.tcgplayer.com/)                | TCGplayer, Inc. (eBay since 2022), Syracuse NY, US           | tcgplayer-cdn.tcgplayer.com                                | free marketplace                              | copyright line per publisher                           | iOS                                  | fetched                  |
| [Cardmarket](https://www.cardmarket.com/)              | Sammelkartenmarkt GmbH & Co. KG, Berlin, Germany             | unknown                                                    | free to browse                                | own copyright on help and news pages; main site unread | none found                           | blocked                  |
| [CardTrader](https://www.cardtrader.com/)              | Gray Fox SRL, Milan, Italy                                   | cardtrader.com/uploads                                     | free to browse                                | "respective owners" clause in the terms                | apps per site navigation, unverified | fetched                  |
| [Card Kingdom](https://www.cardkingdom.com/)           | Card Kingdom and Mox Boarding House, Seattle, US (secondary) | cardkingdom.com/images                                     | free                                          | own copyright only                                     | n/a                                  | fetched                  |
| [PriceCharting](https://www.pricecharting.com/)        | PriceCharting LLC, US                                        | unknown                                                    | free; Collector $5.99/month                   | own copyright and affiliate line                       | iOS                                  | archive copy (secondary) |
| [TCGCSV](https://tcgcsv.com/)                          | individual ("CptSpaceToaster")                               | republishes tcgplayer-cdn.tcgplayer.com URLs               | free, Patreon                                 | none                                                   | n/a                                  | fetched                  |
| [Ludex](https://www.ludex.com/)                        | Ludex, Inc., Chicago, US (secondary)                         | unknown                                                    | free scans; $9.99 to $24.99/month (secondary) | own copyright only                                     | iOS, Android                         | fetched                  |
| [Dragon Shield](https://mtg.dragonshield.com/)         | Arcane Tinmen ApS, Denmark                                   | files.dragonshield.com (Magic)                             | Premium $3.99/month                           | own copyright only                                     | three iOS apps: MTG, Poké, YGO       | fetched                  |
| [Kartenklinik](https://kartenklinik.de/)               | Dominik Brand, Georgensgmünd, Germany                        | own photos of customer cards                               | paid restoration service                      | own copyright only                                     | n/a                                  | fetched                  |
| [Gate to the Games](https://www.gate-to-the-games.de/) | Gate to the Games GmbH, Sülzetal, Germany                    | gate-to-the-games.de/bilder                                | shop                                          | own copyright only                                     | n/a                                  | fetched                  |
| [cardicuno](https://www.cardicuno.de/)                 | Cardicuno GmbH, Stuttgart, Germany                           | own WordPress uploads                                      | shop                                          | own copyright only                                     | n/a                                  | fetched                  |

## 3. Patterns

### 3.1 Self-hosting is the norm, hotlinking is rare

Every site whose image host we could read serves card images from its own domain or bucket: cards.scryfall.io, card-images.edhrec.com, cards.mtggoldfish.com, static.mtgstocks.com, s.deckbox.org, assets.echomtg.com, static.tappedout.net, limitlesstcg.nyc3.cdn.digitaloceanspaces.com, den-cards.pokellector.com, assets.tcgdex.net, static.dextcg.com, pkmncards.com, cdn.tcgalbum.com, images.ygoprodeck.com, ms.yugipedia.com, images.duelingbook.com, s3.duellinksmeta.com, cdn.ygorganization.com, tcgplayer-cdn.tcgplayer.com, cardtrader.com, cardkingdom.com, files.dragonshield.com. The second pass confirmed the Magic and Pokémon hosts and images.ygoprodeck.com and ms.yugipedia.com. The other Yu-Gi-Oh! and multi-game hosts come from the first pass only.

Two sites mirror Scryfall. EDHREC and Archidekt store their own copies under Scryfall's card ids and path layout (`/front/<1st char>/<2nd char>/<uuid>`). The EDHREC file is a re-encoded copy (78,154 bytes against 71,712 from cards.scryfall.io, different SHA-1), served from S3/CloudFront, not a proxy.

Hotlinking found:

- Archidekt's homepage preloads five art crops from cards.scryfall.io and loads mana symbols from svgs.scryfall.io. Its card art otherwise comes from its own host (fetched, rechecked).
- Dueling Nexus loaded all card images from ygopro.online (archive copy of its app bundle, 2026-08-21). The first pass said these assets now return 404. The second pass found that only the ygopro.online root redirects to yugi.wiki; 20 of 20 sampled card image paths still return 200. Dueling Nexus itself returns 404.
- TCGCSV republishes TCGplayer's image URLs and hosts no images.

The sources themselves push towards self-hosting. YGOPRODeck: "Do not continually hotlink images directly from this site. Please download and re-host the images yourself. Failure to do so will result in an IP blacklist." (https://ygoprodeck.com/api-guide/). Scrydex, the successor of pokemontcg.io, recommends caching card images locally and hosting them on your own CDN (https://scrydex.com/docs/getting-started/best-practices#images, second pass).

### 3.2 Notices that recur

Nobody invents its own wording. Five templates cover almost every site.

**(a) The Wizards Fan Content Policy notice.** EDHREC uses the prescribed text: "EDHREC is unofficial Fan Content permitted under the Fan Content Policy . Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC." (https://edhrec.com/). Scryfall: "Portions of Scryfall are unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy." (https://scryfall.com/). EchoMTG does it in its terms, section 6.4: "The use of third-party images on this site is subject to the Wizards of the Coast Fan Content Policy" (https://www.echomtg.com/legal/terms-and-conditions/, second pass).

**(b) The "literal and graphical information" template**, used for all three games:

- Magic, Scryfall: "The literal and graphical information presented on this site about Magic: The Gathering, including card images and mana symbols, is copyright Wizards of the Coast, LLC. Scryfall is not produced by or endorsed by Wizards of the Coast." (https://scryfall.com/)
- Pokémon, Limitless TCG: "The literal and graphical information presented on this website about the Pokémon Trading Card Game, including card images and text, is copyright The Pokémon Company (Pokémon), Nintendo, Game Freak and/or Creatures. This website is not produced by, endorsed by, supported by, or affiliated with Pokémon, Nintendo, Game Freak or Creatures." (https://limitlesstcg.com/legal, site-wide footer). PkmnCards uses a variant that adds Wizards of the Coast for the early sets (https://pkmncards.com/about/).
- Yu-Gi-Oh!, YGOPRODeck: "The literal and graphical information presented on this site about Yu-Gi-Oh!, including card images, the attribute, level/rank and type symbols, and card text, is copyright 4K Media Inc, a subsidiary of Konami Digital Entertainment, Inc. This website is not produced by, endorsed by, supported by, or affiliated with 4k Media or Konami Digital Entertainment." (https://ygoprodeck.com/)
- MTGStocks uses a shorter variant: "The information presented on this site about Magic: The Gathering, both literal and graphical, is copyrighted by Wizards of the Coast (a subsidiary of Hasbro, Inc.). This website is not produced, endorsed, supported, or affiliated with Wizards of the Coast." (https://www.mtgstocks.com/prints/111393)

**(c) A one-line "not affiliated" sentence.** ManaBox: "ManaBox is an unofficial, fan made website and is NOT affiliated, endorsed or supported by Wizards of the Coast LLC nor Hasbro, Inc in any way. The Magic: The Gathering information, card images, mana icons and set icons found within this website are copyrighted by Wizards of the Coast LLC." (https://manabox.app/). Pokellector: "The Pokellector Website and Mobile Applications are not affiliated with, sponsored or endorsed by, or in any way associated with Pokemon or The Pokemon Company International Inc" (https://www.pokellector.com/). Dex: "© 2026 Dexbit. Not affiliated with Nintendo or The Pokémon Company." (https://dextcg.com/). YGOrganization: "YGOrganization is an independent fan-operated site. It is not affiliated with, endorsed by, or sponsored by Konami Digital Entertainment or any official Yu-Gi-Oh! rights holders." (https://ygorganization.com/tos-pp). TCG Album states a trademark notice only, without mentioning copyright in the card images: "Pokémon und alle zugehörigen Namen, Zeichen und Bilder sind eingetragene Marken von Nintendo, Creatures Inc. und GAME FREAK inc. Diese App ist kein offizielles Produkt dieser Unternehmen und steht in keiner Verbindung zu ihnen." (https://tcgalbum.com/impressum)

**(d) A copyright line per publisher.** TCGplayer: "Magic: The Gathering and its respective properties are © Wizards of the Coast. Yu-Gi-Oh! and its respective properties are © 2026 Studio Dice/SHUEISHA, TV TOKYO, KONAMI. [...] ©2026 Pokémon. ©1995 - 2026 Nintendo/Creatures Inc./GAME FREAK Inc. TM, ®Nintendo." (https://shop.tcgplayer.com/books)

**(e) A generic "respective owners" clause.** CardTrader: "Other trademarks, graphics and logos may appear on CardTrader, but not be owned by CardTrader, including but not limited to graphics and logos for: Magic: The Gathering, Pokémon, Yu-Gi-Oh!, [...] These materials are the property of their respective owners who may or may not be connected to or affiliated directly with CardTrader." (https://static.cardtrader.com/en/pages/terms-of-service). Deckbox: "Images, logos, and product names are © and ™ by their respective owners (Wizards of the Coast, Blizzard Entertainment, Fantasy Flight Games)." (https://deckbox.org/contact)

Many show **only their own copyright line**: Collectr, CollX, Ludex, PriceCharting, Card Kingdom, Dragon Shield, Master Duel Meta, Dueling Nexus, Gate to the Games, cardicuno, Kartenklinik. DuelingBook shows no notice at all.

Two wikis state a **legal basis**, both US fair use. Yugipedia: "Any images, whose copyright belongs to the said companies or people are used on Yugipedia under the United States fair use policy and are for documentation, illustrative or educational purposes." (https://yugipedia.com/wiki/Yugipedia:General_disclaimer, via the wiki API). Bulbagarden Archives: "while complying with the principles of the fair use doctrine" (https://archives.bulbagarden.net/wiki/Archives:About, secondary, archive copy). The German PokéWiki only says some images are used "mit Genehmigung bzw. als Bildzitat" (pokewiki.de, PokéWiki:Urheberrecht, second pass, secondary).

### 3.3 Nobody claims a licence

None of the 46 sites claims a licence from Wizards, The Pokémon Company, Konami or Bandai, apart from the rights holders' own products (Konami's database and the Neuron app). That is absence of a claim on public pages, not proof that no private agreement exists. The Fan Content Policy is a permission Wizards grants to everyone, not a licence, and it covers free content only (fact sheet §1). Data providers grant no image rights either: TCGdex licenses its data under MIT and says nothing about images, and Scrydex says "Scrydex does not claim ownership of third-party intellectual property." (https://scrydex.com/terms). Its docs say "you are free to include the provided card images in your applications" and that the user is responsible for copyright compliance (https://scrydex.com/docs/getting-started/best-practices#images, second pass).

Konami's own database forbids what a scraper would do. Its terms grant "a personal, limited, revocable non-transferable license to access and use the Services and Materials solely as incorporated therein, solely for your personal, non-commercial purposes" and prohibit to "Create a database by systematically downloading and storing Materials." and to "Use any robot, spider, site search/retrieval application or other manual or automatic device to retrieve, index, “scrape”, “data mine” or in any way gather Materials ... without Konami’s express prior written consent." (https://legal.konami.com/games/neuron/terms/tou/en/). Its images need a per-image token; a wrong or missing token returns a placeholder image (second pass).

### 3.4 Paid tiers and the free path

Paid tiers next to public card images are common: MTGGoldfish, Deckbox, EchoMTG, ManaBox, Delver Lens, CardCastle, Dex, Pokécardex, TCG Album, Pokellector, YGOPRODeck, Collectr, CollX, Ludex, PriceCharting, Dragon Shield. What the paywall covers:

- MTGGoldfish and Deckbox serve card images to anonymous visitors; their paid tiers gate tools (deck finder, ad removal, alerts, scanner additions, tags). Second pass confirmed both.
- YGOPRODeck keeps card data, images and the API free ("our API is and always will be completely free to use", https://ygoprodeck.com/api-guide/). Premium gates ad removal, the Deck Brew tool, extra cubes and cosmetic perks.
- Limitless TCG keeps everything free and sells ad removal through Patreon.
- Dex, Pokécardex and TCG Album keep the card database free and sell the scanner, more folders or cards, exports and statistics (second pass).
- Exceptions: CardCastle's free tier can only browse the first 1,000 cards of your own collection (https://support.cardcastle.co/en/articles/2031522, second pass), and Deckbox Premium gates uploading your own photos and scans.
- For the apps (ManaBox, Delver Lens, CardCastle, Collectr) the image behaviour inside the app is **unverified**; the store listings say nothing about it.

Scryfall itself is free by design. Its 2018 partnership post: "This will allow us to end our paid membership program, fund full-time employees" (https://scryfall.com/blog/category/news).

### 3.5 EU operators

Paid products with card images, run from the EU, with a disclaimer at most:

- **Deckbox**, Leaping Frog Studios SRL, Baia Mare, Romania, hosted at Hetzner, Magic, Premium subscription (https://deckbox.org/contact). Its website carries no Wizards disclaimer; only its Play listing does.
- **ManaBox**, SkillDevs S.C., A Coruña, Magic, PRO subscription (https://manabox.app/).
- **Dex**, Dexbit Lda, Maia, Portugal, Pokémon, Dex+ subscription, 100K+ Play downloads (https://dextcg.com/, Play listing com.dextcg.app).
- **Pokécardex**, NUMELEK, Villeurbanne, France, Pokémon with French scans, weekly to yearly subscriptions (https://apps.apple.com/FR/app/id6451395407).
- **TCG Album**, Fredrik Gustafsson, Vienna, Austria, Pokémon, Premium €4.99/month (https://tcgalbum.com/impressum).
- **Dragon Shield**, Arcane Tinmen ApS, Denmark, Magic, Pokémon and Yu-Gi-Oh! apps with Premium (App Store).
- **Limitless TCG**, Robin Schulz, Gdańsk, Poland, Pokémon and One Piece, free with ads and Patreon.
- **YGOPRODeck**, owned by a Norwegian publisher (EEA, secondary), Yu-Gi-Oh!, Premium €4.99/month.

The German entries in this research are resellers (Cardmarket, Gate to the Games, cardicuno) or a service (Kartenklinik). Their situation is covered by the reseller-advertising rule in the fact sheet §6, which does not reach Voidbinder. cardcluster.de, the closest German benchmark, could not be read at all.

### 3.6 Store presence

Store review lets card images through. Magic: ManaBox, EchoMTG, CardCastle, Delver Lens, Dragon Shield. Pokémon: Pokellector, Dex, Pokécardex, Dragon Shield "Poké TCG Scanner", plus TCG Album on Google Play. Yu-Gi-Oh!: "Yugipedia Deck Builder" by Logick LLC (500K+ Play downloads, ads and in-app purchases, notice "This app is NOT affiliated with, sponsored, endorsed, or approved by Studio Dice, Shueisha, TV Tokyo, or Konami.", https://play.google.com/store/apps/details?id=com.logickllc.yugipedia.android), Dragon Shield "YGO Scanner". Multi-game: Collectr, CollX, Ludex, PriceCharting, TCGplayer. Being live in a store shows the app was published, not that anyone checked its rights. The database sites (Scryfall, Moxfield, Archidekt, EDHREC, MTGGoldfish, MTGStocks, Limitless, YGOPRODeck) have no store app.

### 3.7 Takedowns and lawsuits

Found, all **secondary** (news reports, wiki summaries, court dockets read by the second pass, not the letters themselves):

- **The Pokémon Company International v. Beckett Media**, filed 2010-07-16 in Dallas, N.D. Tex. 3:10-cv-01392, over "publishing full scans of numerous Supreme Victors and HGSS trading cards" in a monthly price guide (https://pocketmonsters.net/news/842). The docket shows a notice of settlement on 2011-02-07 and a stipulated final judgment on 2011-04-06 (CourtListener, second pass). The magazine was reportedly cancelled in late September 2010 (Bulbanews, secondary; not on the cited pocketmonsters.net page).
- **The Pokémon Company International v. Pokellector**, filed 2014-01-23, W.D. Wash. 2:14-cv-00112, against a collection-tracking site and app where "when users click on the name of the card, an image of the card appears on the screen". The copyright claim was that the images were "identical to the cards copyrighted by Pokémon except for ... the addition of the Pokellector logo" (https://www.techdirt.com/2014/02/12/pokemon-vs-pokellector-trademarkcopyright-dispute/). By 2014-08-15 "the Parties have recently engaged in settlement discussions" (https://www.cardboardconnection.com/law-cards-pokemon-v-pokellector-case-might-end-soon). The outcome is not public. Pokellector is still in the App Store with subscriptions (v3.2.1, 2024-10-17, https://apps.apple.com/us/app/pokellector-card-collector/id600580227) and still self-hosts card images.
- **Nihon Ad Systems v. Dueling Network** (Yu-Gi-Oh!): on 2016-03-24 a law firm acting for NAS, the rights manager, demanded removal of "images of cards, sleeves, and characters" from the online dueling simulator (https://yugipedia.com/wiki/Nihon_Ad_Systems; YGOrganization report of 2016-03-25). The site went offline on 2016-07-05 "for legal reasons"; the link to NAS is reported as speculation. The YGOrganization report says there was "no evidence to imply any involvement on the behalf of Konami". YGOPro was pulled the same month (https://www.vice.com/en/article/yu-gi-oh-online/).
- **Wizards of the Coast**: Card Conjurer, a custom-card and proxy maker (cease-and-desist 2022-11-03, https://techraptor.net/tabletop/news/wizards-cds-card-conjurer-causing-closure); MTG Print, a proxy site (reported 2023-03-18, https://aetherhub.com/Article/WOTC-Sending-Cease--Desist-Letters-To-Proxy-Websites); mtgDAO, an NFT project (2022-02-04, https://www.geekwire.com/2022/wizards-of-the-coast-sends-takedown-notice-to-organizers-of-fan-made-magic-nft-project/). A Hasbro letter to Cockatrice and a 2013 Magic Online letter came up in search and are **unverified**.
- **Nintendo** sent Serebii a cease-and-desist in 2010 for early images of Pokémon Black and White, game images, not cards (https://bulbapedia.bulbagarden.net/wiki/Serebii.net, archive copy). The 2024 Pokémon DMCA wave hit the fan-game hub Relic Castle, not a card site (https://www.nintendolife.com/news/2024/03/pokemon-fan-game-site-relic-castle-shut-down-following-dmca-takedown-notice).

No action was found against the other sites in this research. That is absence of search results, not proof; private letters and Abmahnungen are rarely published. Note: the first pass of the Pokémon group reported no action against any Pokémon card database. That was wrong. It missed Pokellector, which the multi-game pass found.

Pattern: Wizards acts against people who make or sell card copies (proxies, custom cards, NFTs), not against databases and collection tools. NAS acted against an online play simulator. The Pokémon Company is the only rights holder on record that went to court over card images in a price guide and in a collection tracker, which is the closest match to Voidbinder.

### 3.8 Corrections to the earlier documents

- Fact sheet §6 says ManaBox "shows Scryfall-style images". manabox.app shows no card images, and where the app gets its images is unknown.
- Fact sheet §2 quotes part of Scryfall's footer. The full footer also begins with the Fan Content Policy sentence quoted in 3.2 (a).
- Fact sheet §6 lists tcgcollector.com, moxfield.com and Cardmarket as blocked. They were still blocked on 2026-10-09.
- competitor-sites.md describes Archidekt's imagery as "real card images (Scryfall)". More precisely: mostly Archidekt's own copies keyed by Scryfall ids, plus a few hotlinked art crops and mana symbols.
- competitor-sites.md lists Dragon Shield as MTG and YGO with the disclaimer "n/v". There is also a Pokémon app, and the only notice is "Dragon Shield™, © Arcane Tinmen Aps, 2026" (https://mtg.dragonshield.com/).
- competitor-sites.md lists Delver Lens's disclaimer as "no (footer joke)". The Play description has one: "★Magic: the Gathering is copyrighted by Wizards of the Coast. Delver Lens is not produced, endorsed, supported, or affiliated with Wizards of the Coast." (https://play.google.com/store/apps/details?id=delverlab.delverlens)
- The fact sheet's recommendation matrix rates Pokémon images in the app as "high risk, widely done". This research confirms both halves and adds the two lawsuits in 3.7.

## 4. What this means for Voidbinder's plan

**General information, not legal advice.**

The plan: public card images, self-hosted in R2, from Scryfall (Magic), TCGdex (Pokémon) and YGOPRODeck (Yu-Gi-Oh!); a disclaimer per game; card data and images on a free path, with the paid tier selling tools.

What the field supports:

- **Self-hosting in R2 matches what everyone does.** YGOPRODeck requires it, Scrydex recommends it, EDHREC and Archidekt do it for Scryfall images. Keying the R2 objects by the source's own id (Scryfall uuid, TCGdex id, YGOPRODeck card id) is the EDHREC/Archidekt pattern and keeps the copies traceable to their source.
- **Keep images unaltered.** Scryfall's rules forbid cropping the copyright line, re-colouring and watermarks (fact sheet §2). Re-encoding to WebP is what Scryfall, EDHREC and Archidekt do themselves.
- **The free path is the field's default.** Every paid product we could check keeps card images reachable without paying. Avoid a CardCastle-style cap on how many cards a free user can browse; it would break Scryfall's "anonymously or with free accounts" rule.
- **Disclaimers.** The texts in the fact sheet §7 already follow templates (a) and (b) of section 3.2. For Magic, the Fan Content Policy text is the one the policy prescribes. Peers put the notice in the site footer and in the store description; doing both is cheap.
- **Keep the images out of the repository.** Every peer serves images from a separate host. R2 does that and keeps the AGPL repository free of third-party artwork (fact sheet open question 5).
- **Never source Yu-Gi-Oh! images from Konami's own database.** Its terms forbid building a database from it. YGOPRODeck's terms do not say where its scans come from.

Where the risk sits, per game:

- **Magic: lowest.** Wizards publishes a fan policy, Scryfall gives images out for exactly this purpose, EU paid peers (Deckbox, ManaBox) have run for years, and Wizards' enforcement targets proxies and NFTs. The open point is still the paid tier versus "Free means FREE" (fact sheet question 1).
- **Yu-Gi-Oh!: medium.** No Western fan policy, one documented rights-manager action, against an online play simulator, not a database. YGOPRODeck, now owned by a Norwegian publisher, runs a paid tier on the same images with a notice only.
- **Pokémon: highest.** No fan policy, a public "decline" stance (fact sheet §3), and the only rights holder in this research that sued over card images in a price guide and in a collection tracker. Many EU paid peers (Dex, Pokécardex, TCG Album, Limitless) run without any action found, but that says nothing about what happens when Voidbinder grows. This research raises the fact sheet's "high risk" with direct precedent rather than lowering it.

Suggestion, not part of this ticket: a per-game switch that turns card images off quickly, so a complaint can be answered within hours without taking a game offline.

### Open questions for the lawyer

These add to the six questions in the fact sheet.

1. The Pokémon Company sued Beckett (2010) and Pokellector (2014) over card images. Given that, should Voidbinder ship Pokémon images at launch, ship Pokémon without images, or ask The Pokémon Company first? What does a German Abmahnung in such a case typically demand, and how fast must we react?
2. Copies in our own R2 bucket are our own Vervielfältigung (§ 16 UrhG) and öffentliche Zugänglichmachung (§ 19a UrhG). Linking to the source's files is treated differently under CJEU case law on hyperlinks and framing (for the lawyer to assess: Svensson C-466/12, BestWater C-348/13; not checked here). Does self-hosting raise our exposure compared to hotlinking, given that YGOPRODeck forbids hotlinking and Scryfall asks for caching?
3. Do the peers' notices ("not affiliated", "copyright X") have any legal effect in Germany beyond avoiding a false impression of affiliation, and do they reduce damages or costs if a claim comes?
4. Yugipedia and Bulbapedia rely on US fair use. Is there anything in German or EU law that covers a free, public card database inside a commercial product, or are §§ 51 and 57 UrhG (fact sheet §6) the only candidates?
5. YGOPRODeck and TCGdex do not say where their scans come from. Does using re-hosted scans of unknown origin change our position, for example if they were taken from an official database against its terms?
6. Does a separate free website or account that shows the card images keep the paid app inside the Fan Content Policy, as MTGGoldfish, Deckbox and EchoMTG appear to assume? (Extends fact sheet question 1.)

### Questions for the data sources

- Scryfall: does a full copy of the image files in our R2 bucket, used only inside Voidbinder, conflict with "You may not simply repackage, republish, or proxy Scryfall data" (fact sheet §2)? EDHREC and Archidekt do it; ask in writing anyway.
- TCGdex: confirm that bulk download of images for self-hosting is welcome (its FAQ only asks users to cache responses).

### Still to check by hand

- cardcluster.de: open https://cardcluster.de/de/impressum in a browser, copy the operator and footer notice, and check in DevTools where card images load from.
- Cardmarket: footer text and image host on a card page.
- Moxfield, TCG Collector: footer notice and image host.

## 5. Sources

All checked 2026-10-09 unless an archive capture date is given. "2nd" = also fetched by the second pass.

Magic:

- https://scryfall.com/ and https://scryfall.com/docs/api/images (2nd); https://scryfall.com/blog/category/news
- https://moxfield.com/ (blocked); https://articles.starcitygames.com/magic-the-gathering/moxfield-announces-social-media-platform-dedicated-to-magic-the-gathering/ (secondary)
- https://archidekt.com/ (2nd); https://archidekt.com/terms
- https://manabox.app/ (2nd); https://apps.apple.com/us/app/manabox-mtg/id1460407674 (2nd)
- https://www.mtggoldfish.com/ and https://www.mtggoldfish.com/premium (2nd)
- https://www.mtgstocks.com/prints/111393 (2nd); https://www.mtgstocks.com/news/278-mtgjson-partnership
- https://deckbox.org/contact, https://deckbox.org/premium (2nd); https://play.google.com/store/apps/details?id=org.deckbox.app (2nd)
- https://www.echomtg.com/, https://www.echomtg.com/plans/; https://www.echomtg.com/legal/terms-and-conditions/ (2nd); https://play.google.com/store/apps/details?id=com.thoughtbombstudios.echomtg
- https://www.delverlab.com/; https://play.google.com/store/apps/details?id=delverlab.delverlens; https://apps.apple.com/us/app/mtg-delver-tcg-scanner/id6504142186 (2nd)
- https://cardcastle.co/, https://cardcastle.co/terms; https://support.cardcastle.co/en/articles/2031522 and /6234130 (2nd)
- https://tappedout.net/mtg-card/lightning-bolt/, https://tappedout.net/terms-of-use/, https://tappedout.net/dmca-requests/ (2nd)
- https://edhrec.com/ (2nd)
- https://company.wizards.com/en/legal/fancontentpolicy (2nd)
- Wizards actions (secondary): https://techraptor.net/tabletop/news/wizards-cds-card-conjurer-causing-closure, https://aetherhub.com/Article/WOTC-Sending-Cease--Desist-Letters-To-Proxy-Websites (archive copy), https://www.geekwire.com/2022/wizards-of-the-coast-sends-takedown-notice-to-organizers-of-fan-made-magic-nft-project/ (archive copy)

Pokémon:

- https://limitlesstcg.com/legal, https://limitlesstcg.com/about, https://limitlesstcg.com/cards/SVI/1 (2nd); https://onepiece.limitlesstcg.com/cards/OP01-001
- https://www.pokellector.com/ (2nd); https://apps.apple.com/us/app/pokellector-card-collector/id600580227 (2nd)
- https://www.tcgcollector.com/ (blocked; search snippets only)
- https://pokemontcg.io/, https://docs.pokemontcg.io/, https://scrydex.com/pricing, https://scrydex.com/terms, https://scrydex.com/docs/getting-started/best-practices#images (2nd)
- https://tcgdex.net/, https://tcgdex.dev/, https://raw.githubusercontent.com/tcgdex/cards-database/master/README.md (2nd)
- https://www.pokecardex.com/app; https://apps.apple.com/FR/app/id6451395407 (2nd)
- https://pkmncards.com/about/ (2nd)
- https://www.pokemon-zone.com/ (blocked; snippet only)
- https://dextcg.com/ (2nd); https://apps.apple.com/app/id1555489854, https://apps.apple.com/pt/app/id1555489854 (2nd)
- https://tcgalbum.com/impressum, https://tcgalbum.com/preise (2nd); https://play.google.com/store/apps/details?id=com.tcgalbum.app (2nd)
- https://www.serebii.net/, https://www.serebii.net/card/scarletviolet/
- https://bulbapedia.bulbagarden.net/wiki/BP:Copyrights (blocked, snippet); https://archives.bulbagarden.net/wiki/Archives:About (archive copy, 2nd); https://bulbapedia.bulbagarden.net/wiki/Serebii.net (archive copy, 2nd)
- https://www.nintendolife.com/news/2024/03/pokemon-fan-game-site-relic-castle-shut-down-following-dmca-takedown-notice (2nd)

Yu-Gi-Oh!:

- https://ygoprodeck.com/, https://ygoprodeck.com/premium/, https://ygoprodeck.com/api-guide/, https://ygoprodeck.com/help/ (2nd); https://www.webrokr.com/ygoprodeck-acquisition-by-bifrost-entertainment/ (secondary)
- https://yugipedia.com/api.php?action=parse&page=Yugipedia:General_disclaimer (2nd); https://web.archive.org/web/20260801203834/https://yugipedia.com/wiki/Blue-Eyes_White_Dragon (archive 2026-08-01)
- https://www.ggrecon.com/articles/ggrecon-acquires-yugipedia-and-ygorganization/ (2nd)
- https://ygorganization.com/tos-pp, https://ygorganization.com/about-us, https://ygorganization.com/anniversary-post-12-years-of-ygorganization; https://ygorganization.com/cd-order-filed-against-dueling-network/ (2nd)
- https://www.duelingbook.com/, https://www.duelingbook.com/welcome, https://www.duelingbook.com/privacy-policy
- https://www.masterduelmeta.com/cards/Blue-Eyes%20White%20Dragon
- https://www.db.yugioh-card.com/yugiohdb/, https://legal.konami.com/games/neuron/terms/tou/en/ (2nd); https://apps.apple.com/us/app/yu-gi-oh-neuron/id1518141847 (2nd)
- https://web.archive.org/web/20241228220110/https://yugiohprices.com/ and https://web.archive.org/web/20250120091142/https://yugiohprices.com/about (archive)
- https://duelingnexus.com/blog/; https://web.archive.org/web/20260821123748js_/https://duelingnexus.com/static/js/app.1820a1c1d1812d50648e.js (archive 2026-08-21, 2nd); https://ygopro.online/ (2nd)
- https://yugipedia.com/wiki/Nihon_Ad_Systems (archive copy, 2nd); https://www.vice.com/en/article/yu-gi-oh-online/ (2nd)
- https://play.google.com/store/apps/details?id=com.logickllc.yugipedia.android (2nd)

Multi-game:

- https://cardcluster.de/de/impressum (blocked)
- https://www.getcollectr.com/, https://app.getcollectr.com/settings, https://apps.apple.com/us/app/collectr-tcg-collector-app/id1603892248
- https://www.collx.app/, https://www.collx.app/terms
- https://shop.tcgplayer.com/books; https://tcgcsv.com/tcgplayer/3/3170/products, https://tcgcsv.com/faq
- https://help.cardmarket.com/en/new-user-guide (www.cardmarket.com blocked)
- https://www.cardtrader.com/, https://static.cardtrader.com/en/pages/terms-of-service
- https://www.cardkingdom.com/mtg/foundations/llanowar-elves
- https://web.archive.org/web/20261006145805/https://www.pricecharting.com/category/pokemon-cards (archive 2026-10-06)
- https://www.ludex.com/, https://www.ludex.com/privacy-notice/
- https://mtg.dragonshield.com/
- https://kartenklinik.de/impressum/, https://www.gate-to-the-games.de/info/Impressum, https://www.cardicuno.de/impressum
- Pokémon lawsuits: https://pocketmonsters.net/news/842, https://www.techdirt.com/2014/02/12/pokemon-vs-pokellector-trademarkcopyright-dispute/, https://www.cardboardconnection.com/law-cards-pokemon-v-pokellector-case-might-end-soon (2nd); CourtListener dockets N.D. Tex. 3:10-cv-01392 and W.D. Wash. 2:14-cv-00112 (2nd, secondary)
