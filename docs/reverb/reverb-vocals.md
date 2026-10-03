# Reverb on vocals: the research

The research behind our vocal reverb (`reverb.md`). Théo asked for "a really good reverb mostly for vocals"
(rap, trap, R&B, pop, hyperpop) and finds the FabFilter Pro-R 2 he uses "isn't the best". `reverb.md` was
designed from a first survey, and it was thin exactly where `pro-c.md` was before `pro-c-vocals.md`: its
survey named which reverbs engineers use but rarely how they set them, its classic units were a table row
each, its two models (VintageVerb and Pro-R 2) were never documented control by control, and every preset
value was marked **(inferred)**. This document fills that in, in five parts:

1. [What engineers do](#1-what-engineers-do): how about sixty mix engineers and producers put reverb on
   vocals, from their own session walk-throughs: send or insert, what's around the reverb, settings where they
   give them, and how much.
2. [The classic units, measured](#2-the-classic-units-measured): the thirteen reverbs those engineers name
   (EMT plates, the first digital units, the Lexicons, the AMS, the Bricasti, chambers, springs), from their
   manuals, brochures, preset sheets and published measurements, and what a mode after each would need.
3. [The two it's built on](#3-the-two-its-built-on): Valhalla VintageVerb mode by mode and FabFilter Pro-R 2
   control by control, both read from the plug-ins themselves (ranges, defaults, tooltips, factory presets),
   and Pro-R 2's shortcomings revisited.
4. [What other reverbs do](#4-what-other-reverbs-do): about eighty reverbs from their manuals (the DAWs' own,
   FL Studio's three among them, vocal ones, analogue models), the ideas worth taking, and what producers
   complain about.
5. [What the literature adds](#5-what-the-literature-adds): papers that measured or modelled these reverbs,
   or measured how much reverb listeners want, beyond the design literature `reverb.md` already uses.

[Sources](#6-sources) at the end, by part.

What it changes in the design is in `reverb.md` itself: section 1 (the survey, corrected), 4 (the panel's
ranges and controls), 6 (the modes' natural curves, the absorption filter, modulation, the ducker), 7 (the
presets, now with sources), 8 and 9 (the build order, the tests) and 10 (the questions). `reverb.md`'s new
section 12 lists every change and where it came from.

How sure each statement is: quotes in "…" are the source's own words; **(inferred)** is worked out rather
than read; **not stated** means no source we could read gives it; **(secondary)** is a write-up rather than
the person or maker. Many pages were read through a fetch tool that extracts text, so a few quotes may be its
rendering of the page; those asked for verbatim were checked. Gearspace, Reddit, Mix With The Masters and
the AES e-library refused automated reading or were down, and the session's web-search quota ran out part way
through, so some engineers, unit manuals (the SP2016's, the REV7's) and papers are missing: each part says
which.

---

## 1. What engineers do

How mix engineers and producers put reverb on vocals, from their own session walk-throughs, with settings
where they give them. How sure each statement is: quotes in "…" are the source's own words; **(inferred)** is
worked out rather than read; **not stated** means no source we could read gives it; **(secondary)** is a
write-up rather than the person. [Sources](#61-for-part-1-the-engineers) at the end.

### 1.1 The set-ups

Each row is one engineer's vocal reverb set-up: whether it's a send or an insert, what's before the reverb on
the send, the reverb(s), and what's after it on the return. Mostly from Sound On Sound's *Inside Track* and
*Secrets Of The Mix Engineers*. Settings only where the source gives them. Rap, trap, R&B, pop and hyperpop
first; the classic engineers after.

| Engineer (record) | Vocal reverb set-up | Settings and words |
| --- | --- | --- |
| **Seth Firkins** (Future, *Draco*, 2017) | Tracking: an aux with Auto-Tune, Extra Long Delay and D-Verb. Mix: an **insert** on the Vox bus, in "strict order": EQ7 → Waves De-Esser (5506 Hz) → RComp → **D-Verb** → AIR Flanger → L1 | Tracking reverb "set to a 12-15 percent mix with 12ms pre-delay and to a regular room sound". Mix: "Medium Room with a pre-delay of 15ms, a decay of 751ms, a high-frequency cut at 9.36kHz, and just 15 percent wet". "Give me good old D-Verb any time, and I can make it sound good" |
| **Thomas "Tillie" Mann** (Lil Baby, "Sum 2 Prove", 2020) | Two reverb sends and a half-note delay. "Verb": D-Verb (Large Hall) → EQ3 (lows out below 100 Hz). "Verb 2": RVerb → REQ (lows off) → S1 Imager | "I like rap vocals to be wet and wide." "I use the Imager on my reverbs probably 75 percent of the time." "I leave the vocals to be the centre point of the mix" |
| **Kesha Lee** (Lil Uzi Vert, "How To Talk", 2017) | Every vocal sends to a delay aux and a reverb aux. Delay aux: Mod Delay II (half notes) → Renaissance Reverb ("Hall 1", highs cut) → S1 Imager. Reverb aux: Renaissance Reverb | Delay "set to half notes, with feedback at 43 percent", then the reverb "with the highs cut on the reverb EQ". Decay, pre-delay: not stated |
| **Maddmix** (21 Savage, "A Lot", 2018) | "A small room reverb really subtly in the background"; a 30 ms EchoBoy slap send on J. Cole's verse. Template: Slate VerbSuite Classics, UAD Lexicon 480, RVerb, TrueVerb; EchoBoy, H-Delay | "They wanted the keep the vocals pretty dry, so I didn't use much reverb." The slap "just with a 30-millisecond EchoBoy delay, to widen the vocals a bit" |
| **Evan LaRay** (Cardi B, "Bodak Yellow", 2017) | "EFX1" effect track: EQ3 → CLA-76 → de-esser → H-Delay (1/8 ping-pong) → D-Verb (hall). A shared "Verb" aux (RVerb) on the vocal tracks. Ad-libs: D-Verb as an **insert**, then S1 Imager → L1 | "A D-Verb set to 'hall' with 7s decay and a 15ms pre-delay." The RVerb aux "pretty much glues everything together." On the ad-libs, "yet more space with the Waves S1 Imager" |
| **Jason "Cheese" Goldberg** (YoungBoy, "Loner Life", 2022) | Throws on copied words: "bright" and "dark" long reverb throw tracks; backing vocals: Doubler → Valhalla reverb → H-Delay → AIR Chorus | "I copied bits of vocal to these tracks, and added delay throws on the orange tracks, and reverbs on the green tracks." Numbers: not stated |
| **Ari Morris** (MoneyBagg Yo, "Wockesha", 2021) | Two reverb auxes and three delay auxes in the session, used "very minimally" | "Bagg hates the traditional ear candy like delay throws, reverb swells, reversing things and panning them around… Instead the feel with him is bone-dry, raw power" |
| **Koen Heldens** (Trippie Redd, *A Love Letter To You 5*, 2023) | Template: Harmonizer, "a standard hall reverb, plate reverb, half-note delay, quarter-note and eighth-note delay"; an H3000-style aux (Doubler, S1 Imager) for ad-libs and backing vocals | "Igor created all of Trippie's vocal effects, and I mostly left them the way they were." Numbers: not stated |
| **Joseph Colmenero** (Lil Tecca, "Ransom", 2019) | Vocal buses send to a reverb aux: EQ7 (lows and highs out) → RVerb; and a 1/4 H-Delay aux. Distant ad-libs: D-Verb added on their aux | "I also have the Avid EQ7 before the reverb, to take out the low end and high end. You don't want to have esses all over your reverb" |
| **Todd Hurtt** (Polo G, "Rapstar", 2021) | Vocal sends: a VintageVerb hall, a Renaissance plate, a **FabFilter Pro-R** chamber, a 1/4 H-Delay | "I have been using the FabFilter Pro-R recently." "I have to be careful how much I add, because Polo is not a fan of too many effects on his voice" |
| **Ethan Stevens** (Metro Boomin, 21 Savage & The Weeknd, "Creepin'", 2022) | Sends: Lexicon 224, Seventh Heaven, Eventide H9 Blackhole, H-Delay, EchoBoy, Doubler. The Weeknd's long reverb: Blackhole → Pro-Q 3 (only the mids through) → Saturn 2 → RComp, keyed from the lead (bus 127) | "The Weeknd's older stuff has a reverb with a long decay time… the Blackhole fit really well." "Since the decay time is so long, I side-chained it to Abel's lead." "While he's singing it's ducking some of the reverb, and when he's not singing, the decay rings out longer" |
| **Bainz** (Young Thug & Gunna, "Ski", 2021) | Three reverb sends (UAD Ocean Way, UAD Capitol Chambers, a Hall from tracking); a 1/4 EC-300 delay → RComp keyed from the vocal; a Bricasti plate | "There are tons of sends on the Slime track! Nine in total." "The faders on these tracks are for the most part really low. They are like little sprinkles that come and go." The delay's RComp "side-chained to the vocal, so it only sounds when the vocal isn't there" |
| **Travis Harrington** (Rod Wave, "Street Runner", 2021) | Sends to three delay auxes and a "Big Verb" aux: H-Delay → Studio Reverb ("Large Theater") → D-Verb | "I'm an excessive reverb user… For me reverb is the be-all and end-all when it comes to vocals and adding depth. Reverbs can also be used to add volume." "Large Theater', which is a really damp reverb." "This airy, reverb-coated vocal, that is still up front and does not get lost in the reverb" |
| **Jess Jackson** (Pop Smoke, "Woo", 2020) | Hardware: Yamaha SPX90 on the verse aux as "the main effect" on the lead; Yamaha Rev-7; a Behringer V-Verb plate; Eventide delays. Hook tracks send to V-Verb, Rev-7, Delay, Doubler | "I wanted that famous '80s reverb sound used on a lot of rap from the early '00s." The Rev-7 "has a shorter, metallic-sounding reverb that you can't really get from modern plug-ins" |
| **Kevin McCloskey** (DaBaby, "Intro", 2019) | Two reverb auxes (VintageVerb, Eventide SP2016), three delay auxes (EchoBoy, H-Delay, Valhalla Delay); ad-libs through JJP Vocals' Space ("like a stereo slap delay") | "Slightly more reverb in the hook." In the break "I automated the delay and the reverb, meaning that a little bit of signal remained there" |
| **Leandro "Dro" Hidalgo** (Stormzy, "Hide & Seek", 2023) | Returns that came with the session: iZotope Neoverb, VintageVerb, Valhalla Room, ModDelay 3 | "I'd never used the iZotope Neoverb, but they were happy with it, so I was not going to change it." Numbers: not stated |
| **Young Guru** (Jay-Z, Kanye West & Rihanna, "Run This Town", 2009) | Lexicon 480 and a quarter-note TC D•Two on Jay-Z and Kanye; Rihanna on two effect tracks, Reverb One and Mod Delay II | "Jay's vocals also had a Lexicon 480 reverb, and a quarter-note delay coming from a TC Electronics D•Two." Settings: not stated |
| **Chris Dennis** (Roddy Ricch, "The Box", 2019) | Little | "He doesn't like a lot of delay and reverb. He likes his stuff really clean, dry, and in your face" |
| **Alex Tumay** (Young Thug) | Throws drawn in while the artist records | "All my delay throws, all that stuff is being done, I have the track open, I'm drawing them in while he's recording". Reverb settings: not stated |
| **Derek "MixedByAli" Ali** (Kendrick Lamar, *To Pimp A Butterfly*, 2015) | Hardware sends: EMT 250 on Kendrick; AMS RMX16 on Thundercat's voice; Lexicon 480L | "For outboard I used the EMT 250 reverb." "The aux reverb tracks are mostly used for the vocals in that final section." Settings: not stated |
| **Matt Schaeffer** (Kendrick Lamar & SZA, "All The Stars", 2018) | SZA: sends to "SZA Verb" and "DVerb" (D-Verb → EQ3), "SZA Chamber" (RVerb → EQ3), two H-Delays. Kendrick: "FlangeVerb" (RVerb + MXR Flanger), "Huge Verb" (Altiverb → EQ3), "Hook Valhalla" (VintageVerb, Concert Hall, 1980s), an EMT 250 aux (EMT 250 set as a phaser → Valhalla Plate → MicroShift), a delay aux (EchoBoy → Reel Tape Flanger → RComp) | "I put an EQ after the reverb, because I don't like too much low end in reverb." The Valhalla "set to -12, so it only gives a tiny bit of ambience". Delays at 1/8 (one ping-pong, automated "to only come in on certain places") and 1/4 |
| **Tommee Profitt** (NF, "The Search", 2019) | Two VintageVerb auxes, "Voc vrb" and "big valass" ("the second reverb one is a bit longer"); a delay aux (ModDelay3 → VintageVerb → CLA-3A) and a Little AlterBoy aux, both with the VintageVerb after | The delays have the VintageVerb "because it makes these effects sound a bit more spacey"; the CLA-3A "makes the delay sound bolder and louder". "Each of the vocal tracks also has sends to the main Valhalla reverb, and the delay track, although the delay is automated. I only have it on certain words, probably just three or four moments in the track" |
| **Illangelo** (The Weeknd, "The Hills", 2015) | Five sends from the verse lead group. FX1: Altiverb 7 → H-Delay (pre-delay) → Pro-Q 2; FX2 an EP-34 slap; FX4 long delays (Timeless 2 → Pro-Q 2); FX5 another Altiverb. The chorus has another Altiverb with its own pre-delay (secondary: the fetch's paraphrase) | "Altiverb 7, which is my go-to reverb, then the Waves H-Delay for some pre-delay, and then the FabFilter Pro-Q2 EQ, which rolls off quite a bit of top end, to make sure the reverb does not sound too big frequency-wise." Long delays "enter in certain pockets". Numbers: not stated |
| **Patrizio "Teezio" Pigliapoco** (Chris Brown, "Heat", 2019) | Send 1: "140Verb" (VintageVerb); send 2: "HKDelay", printed. ValhallaShimmer for space | "I don't ever put reverb directly on the track, only if it's for a reverb that I'll use for nothing else, like a background vocal." "If a word is sung slightly late or early… the delay will not feel right with the word after that, so I manually move that delay." "If I want a vocal to have some space around it, I put the Shimmer on." Of Valhalla: "They are really cheap reverbs, but I love them" |
| **Rob Bisel** (SZA, "Kill Bill", 2023) | Lead bus (Pro-DS → Pro-Q 3 → CLA-3A → Pro-C 2) → five sends: VintageVerb, Guitar Rig spring, EchoBoy, Little MicroShift, MetaFlanger. Backing vocals: "BGV Spring" aux (UAD AKG BX15 + VintageVerb) | "The reverbs are pretty prominent, but the rest of the auxes are all subtle brush strokes." "Guitar Rig has the best spring reverb I've found." Numbers: not stated |
| **Stuart White** (Beyoncé & Jay-Z, "Apeshit", 2018) | Lead: a "Verb" aux (D-Verb + H-Reverb), a "Delay 1-4" aux (EchoBoy). The Migos parts arrived with D-Verb as an insert | On EchoBoy returns: "quite a lot of filtering… with the Waves REQ… colour with the SoundToys Devil-Loc… so it is separate from the main vocal, and compress it with the UAD LA3A and mix that in to taste". Numbers: not stated |
| **Jaycen Joshua** (rap, pop) | Sends: convolution plates and rooms, stacked | "Reverb is the kiss of death on rap vocals" (2010); later "using a dark short reverb to add warmth and low end to a vocal, as opposed to just using reverb to add 'space'. We'll stack multiple reverbs" (2024) |
| **Mike Dean** (Travis Scott, Kanye West) | Avid D-Verb; Valhalla | "The D-Verb. It makes stuff sound like it's in a room, what else do you want?" "I don't like stuff where I don't know what it is doing" |
| **Fabian Marasciullo** (Lil Wayne, "How To Love", 2011) | Waves RVerb: a short room and a slightly longer plate | The room "to give the snap some space and vibe" |
| **Leslie Brathwaite** (Pharrell, "Happy", 2014) | Three sends: one Altiverb, two delays "with different timing"; the backing vocals on the same ones | "I prefer to have the reverb on an aux as opposed to on the inserts, because I like to have everything that I send through it feel like it's in the same room." Delays "really subtle. I also took the low end out of the delay return, so they become like a whisper sounding in the distance." "I put the drums in a smaller space then the vocals" |
| **Noah "40" Shebib** (Drake, "Headlines", 2012) | Little | Drake wants it "pretty dry" |
| **Jesse Ray Ernster** (Burna Boy, "Time Flies", 2021) | No reverb on the lead: delays, and "a delay to feed a reverb". Throws as duplicate tracks with Valhalla Delay at 100 %. All effects into a "Lead Vocal All FX" aux with Pro-Q 3 | "I generally do not use reverbs on the lead vocal, but only delays, because they take up less space." "The pre-delay creates this ocean of ambience that does not take away from the intimacy and upfront nature of the lead vocal." The FX aux's Pro-Q 3 "takes out all top and bottom, which you don't need on vocal effects" |
| **Clint Gibbs** (Doja Cat, "Say So", 2020) | Every vocal sends to 1/8 and 1/4 delays and a Reverb aux (PatchWork with a Lexhall), all into an "FX Return" aux; a "Backspread" MicroShift. BG2 bus: VintageVerb as an insert | BG2: "the Valhalla Vintage Verb, with a 2.4s reverb, Mix at 18 percent." "When I have to mute a word, I will take the word before it and will delay it with some reverb to fill the empty space" |
| **Mitch McCarthy / Dan Nigro** (Olivia Rodrigo, "drivers license", 2021) | Lead inserts end in a VintageVerb (after Pro-DS and Soothe 2); seven auxes: Doubler (MicroShift), Parallel Vox (Distressor), Hall, Plate and Chorus Verb (each VintageVerb), 1/4 and 1/8 EchoBoys | "Dan did most of the delays and reverbs on the vocal, so I only tweaked the settings lightly." The doubler "more" in the chorus; in the verses "I backed it off and have the vocal more dry and in your face" |
| **Dan Nigro** (Olivia Rodrigo, "vampire", 2023) | Insert, at the end of the vocal chain: compressor → de-esser → VintageVerb | "After the compressor I have a de-esser and then a reverb. The reverb is always the flavour in the song." VintageVerb: "so easy to manipulate the mix and the decay. It makes it really easy and really quick to throw it on" |
| **Ian Kirkpatrick** (Dua Lipa, "Don't Start Now", 2019) | Return: VintageVerb → Xfer OTT → LFO Tool (ducking copying the vocal's) → UAD 1176. Effects sent to the mixer as stems | "The Valhalla VintageVerb is my reverb on the vocals, and there's also an Xfer OTT… so I have more control over it." "The LFO copies the automation of the main vocal. It would be crazy to automate the LFO on the main vocal, and not on the reverb on that vocal. And then I am compressing the reverb again with the UAD 1176." "You also can get such a crazy contrast sometimes by cutting off a reverb tail." "I am really touchy about mixers adding reverb, because the stereo field is so important to me" |
| **Benjamin Rice** (Lady Gaga & Ariana Grande, "Rain On Me", 2020) | Auxes: plate, room and church reverbs; eighth- and quarter-note delays, each with a reverb after it | "I have plate, room and church reverbs, and eighth- and quarter-note delays that also have reverbs on them when I need them." After a delay: "a Valhalla reverb after the delay, on like 5-10 percent, and push the pre-delay very far back so you don't hear it immediately, but you have this atmospheric tail in the back" |
| **Geoff Swan** (Charli XCX, "New Shapes", 2021) | Sends: a reverb, an H3000-style widener, a Weight Tank compressor aux, an H-Delay ping-pong; VintageVerb and ValhallaShimmer for a build | "Each of the singers has their own specific reverb, which is something that came from Linus." "I used effects like a Valhalla Vintage Verb and a Valhalla Shimmer to form a crescendo to build back to the final chorus." "The levels of most of these sends were heavily automated" |
| **Finneas** (Billie Eilish, *When We All Fall Asleep*, 2019) | Effects printed into the stems; Valhalla Room, Plate and Shimmer, "in very specific places" | "Pretty much every reverb that I use is by Valhalla — the Room, Plate, Shimmer… But I use reverbs in very specific places, and the rest of the album is dry." "That dryness is all about intimacy. A dry vocal sounds really intimate" |
| **Julian Bunetta** (Sabrina Carpenter, 2024) | No fixed sends; Valhallas, UAD EMT 140, Soundtoys SuperPlate | "I don't set up my sessions with dedicated sends to a big room and a small room and a short delay and a long delay. It's more fun when I just throw something on" |
| **Josh Gudwin** (Justin Bieber) | Words moved onto fully wet effect tracks | "I have certain effects (fully wet) on audio tracks I put certain words on to accentuate and effect certain parts of the vocal performance and word play" |
| **Jonathan Low** (Taylor Swift, "willow", 2021) | Sends: "Chamber" (UAD Capitol Chambers), "Plate" (UAD EMT 140), "Long Delay" (stereo EchoBoy → Altiverb spring) for throws in the choruses | The chamber "gives the vocal a nice density and size, without it being a long reverb"; the plate "for the longer tail". "These two reverbs work in conjunction, with the chamber for the upfront space determining where the vocal sits in the mix, and the plate more for the depth behind that" |
| **Rob Kinelski** (Billie Eilish, "bad guy", 2019) | Almost none: a Width aux with MicroShift | "The plan with the album was for most things to be super-dry. I added some reverb to an early mix, and they immediately said: 'Get rid of the reverb.'" "The less you put on a record, the bigger it sounds" |
| **Jon Castelli** (Kesha, "Praying", 2017) | Return: UAD AKG BX20 → Pro-MB → Fairchild 670; a quarter-note Mod Delay III; later EMT 140 and 250 added | "The Pro-MB controls the dense and harsh mid-range of the vocal verb, and the 670 once again is there because of the way it controls the reverb tail." "I muted the sends to the reverb and delay aux tracks in the verses." The demo had "a lot of reverb on the vocals… sounded a little dated" |
| **Tony Maserati** (Selena Gomez, "Rare", 2020; Robin Thicke, Jason Mraz) | On "Rare": effects printed to tracks, no auxes. Elsewhere: EchoBoy → Softube TSAR-1; UAD AMS RMX16; Relab LX480; Sonnox Oxford Reverb | "It would slow me down if I had to create an aux effect track every time I want to add a reverb or delay." "Sometimes your ear needs to be tricked, and sometimes that trick is a delay throw, or removing the reverb for a moment… It wakes up your ears." "A strange, ringy reverb in mono going straight to a dark chamber"; the LX480 "a shorter, thinner plate-type setting. It adds a little bit of airy brightness to a voice" |
| **George Seara** (Shawn Mendes, "Treat You Better", 2016) | TC System 6000: Chamber, Stage+Hall, an "AMS vibe" modulation; UAD AKG BX20. The ad-libs on the same two reverbs | "I also used some System 6000 Stage+Hall reverb and a bit of TC System 6000 'AMS vibe' for 'widening' the vocals." Template: "four delays from SoundToys Echo Boy, and four reverbs from UAD, the EMT 140, AKG BX20, and two Lexicon 224 reverbs" |
| **Chris Godbey** (Justin Timberlake, *The 20/20 Experience*, 2013) | An Extra Long Delay and a Reverb on an aux; an EchoBoy aux; for "Suit & Tie" 1/4 and 1/8 slap Echo Farms, a long Mod Delay "EQ'd heavily" | "There is quite a lot of reverb in the outro, for which I used [Avid] ReVibe and maybe some outboard Lexicon 960 as well, just occasionally" |
| **DJ Swivel** (The Chainsmokers & Halsey, "Closer", 2016) | Template of four Lexicon reverb auxes; H-Delays | "Usually they are a Lexicon hall, plate, and small room, and the fourth one is another Lexicon room." Settings: not stated |
| **Charlie Puth** (2022) | Valhalla; LiquidSonics Seventh Heaven | "My favourite reverbs are those by Valhalla … and the LiquidSonics Seventh Heaven, which is an emulation of the Bricasti M7" |
| **Curtis Douglas** (*KPop Demon Hunters*, 2025) | Send: de-esser → Lexicon 480L (mix 25 %) → LiquidSonics Verb Suite Classics (100 % wet) → EQ. Delay: de-esser → H-Delay (one side's polarity flipped) → EQ (mids out) → the same reverb at 12 % | "My usual de-esser, set fairly aggressively, into the Lexicon 480L, with a mix of 25 percent into the main vocal verb… fully wet… Then a fairly intense EQ, because I really didn't want low end in the reverb, or any of the mids clouding up the fundamental vocal frequencies." "I had one side of the H-Delay phase inverted, so it pushed the delays to the outside" |
| **Taesub Lee** (TWICE, "Scientist", 2022) | UAD Lexicon 480L among four sends | Backing vocals on the 480 alone, "so they are in a different space" |
| **Kieron Menzies & Dean Reid** (Lana Del Rey, "Lust For Life", 2017) | AIR Spring (monitored); auxes: Reverb One hall, AIR Spring, 1/4 EchoBoy → Pro-Q 2 (mids out), VintageVerb plate, Freq Echo, 1/16 EchoBoy slap, H-Delay vocoder delay, a "girl group" VintageVerb at 3.6 s | The spring "is one of the characteristic elements of her vocal sound." Of VintageVerb: "You can do like 60 seconds decay time on the reverb, it never ends" |
| **Mark Ralph** (Clean Bandit, "Solo", 2018) | Two reverb auxes (Altiverb, Valhalla Room) and an EchoBoy | "I completely cut the reverbs and delay in a couple of places, which is a DJ trick" |
| **Claudius Mittendorfer** (Panic! At The Disco, 2016) | Auxes: shimmer pitched up an octave → Altiverb Lexicon 480; "PLATE" (Trim, polarity flipped → Reel Tape Saturation → Valhalla Room); Altiverb Cello Studio 2 room; Waves Manny Marroquin Reverb plate; EchoBoy long, slap, mono slap, ping-pong | "I always have a ping-pong delay in my sessions." Settings: not stated |
| **Konstantin Kersting** (Tones And I, "Dance Monkey", 2019) | Lead bus sends: "a slap, a long delay, a reverb, a small plate and the vocoder track" | Settings: not stated |
| **Adam Thein** (Djo, "End Of Beginning", 2026) | Seventh Heaven; VintageVerb; Softube TSAR-1 | "For reverbs, the main one I used was the Liquidsonics Seventh Heaven." Vocal use: not stated |
| **Manny Marroquin** | Bricasti M7 | "The M7 just has THE sound that none of these other reverbs have" |
| **Dave Pensado** (pop, R&B) | Eventide 2016 Stereo Room on a send, band-limited; elsewhere a modified Revibe Large Natural Plate; delays (Supertap) doing much of the reverb's work | "I use the stereo room preset, and I tend to use a pretty long, 16th or 32nd note, pre-delay. I roll off the top end around 5k, sometimes 4k, plus I roll off the bottom end about two numbers, starting at 300Hz." The plate "dipped… at 8k because it sounded a little bit too expensive." "I personally don't like to use a lot of reverb" |
| **Phil Tan** (Rihanna, "SOS", 2006) | Renaissance Reverb, a short room | "a room with a short length, 1.68S — a longer time would have gotten in the way." "Sometimes you have to carve out a space for a reverb with EQ and by shaping the reverb characteristics — attack, release time, length, and so on" |
| **Jason Goldstein** (pop, R&B) | Two TC plates: "Stairway Plate" (the main one), "Ambient Plate" (longer, for throws); ducked delays | The long plate to "throw in at the tail end of words or between sections." "Dynamic delays are often called ducked delays, because they will 'duck' out of the way, coming up only at the tail end of words and phrases" |
| **Jack Joseph Puig** (pop, rock) | A TrueVerb per section | "The first verse… has its own reverb using a Waves Trueverb… I've rolled off above 1k and left all the low end to make it darker and fuller sounding." "There are different ambient feels and different attitudes for different sections" |
| **Robert Orton** (Lady Gaga, "Just Dance", 2008) | Revibe, very short, then a McDSP Filterbank | "set to a very short reverb, just to add a little bit of space behind the vocal, filtered with the McDSP Filterbank E6, which brightens the reverb a bit to give it some splash" |
| **Chris Lord-Alge** | A long Lexicon hall early in a song, delays tempo-set; Lexicon 224 and 480, Bricasti M7, AMS, EMT, SP2016 in the rack | "There were several delayed reverbs. The amount varied from section to section." The Ensemble reverb "a giant Lexicon 300 hall with a seven-second decay time." "You can't really beat the original digital reverbs" |
| **Bob Clearmountain** | SDE3000 slaps at 100 and 125 ms panned apart; Altiverb hall only for an ending | Slaps at "100ms and 125ms… panned left and right"; the hall "a little bit of Altiverb on a big Hall setting" |
| **Jimmy Douglass** (Timbaland, Aaliyah) | Lexicon 960 | "I use reverb only moderately." "Lexicon 960 for some general reverb across the vocals" |
| **Spike Stent** | Delays rather than reverb (EchoBoy) | "It's rare that I use reverb. I prefer to use plug-in delays these days, because you can really automate them" |
| **Rich Costey** | EMT plate and room mics | "an EMT plate and the room mics for general reverb" |
| **Michael Brauer** (Coldplay) | AMS non-linear, Lexicon PCM81 | "If you send everything to reverb, you don't hear it, but if you send only one thing to reverb, it'll be huge" |
| **Andrew Scheps** | Spring or EMT 140 | "I don't use a lot of reverb, but when I use it, it's either a spring, or a reverb like the 140" |
| **Tom Elmhirst** (Amy Winehouse, "Rehab", 2007) | Spring printed at tracking + EMT plate | "I'm not a big fan of digital reverbs anyway" |
| **Humberto Gatica** (pop ballads) | AMS RMX16 | "The classic long reverb that you can't change and that nothing else can duplicate" |
| **Matty Moon** (SOS, mixing Neue York's "Silence", 2020; an educator) | VintageVerb aux → EQ (cuts at 460 Hz and 5.41 kHz) → BF-76 | "A long (85ms) pre-delay helped keep this reverb out of the way of the dry vocal sound"; "I gave it a very long (6.82s) tail" |

### 1.2 What it adds up to

1. **Sends, almost always.** Nearly every engineer above puts the vocal's reverb on an aux. Brathwaite's
   reason: "I like to have everything that I send through it feel like it's in the same room"; Teezio: "I don't
   ever put reverb directly on the track, only if it's for a reverb that I'll use for nothing else, like a
   background vocal." The exceptions are telling: a short room *on the vocal bus* at low mix (Firkins'
   D-Verb, 15 % wet), a VintageVerb as the last insert of a pop lead (Nigro, McCarthy), a reverb as an insert
   on ad-libs or backing vocals (LaRay, Gibbs, Teezio). So the reverb must work both ways: 100 % wet on a send,
   15–25 % on an insert (`reverb.md` 4.1 Mix and Mix Lock; open question 4).
2. **Two or three spaces, each with a job.** A short room or chamber for where the voice sits and a longer
   plate or hall behind it: Low (Capitol chamber + EMT 140), Hurtt (VintageVerb hall + Renaissance plate +
   Pro-R chamber), Tillie (two), DJ Swivel (a Lexicon hall, plate and two rooms), Heldens' template (hall +
   plate), Rice (plate, room, church), Seara (chamber + Stage+Hall + a spring), Owsinski's three
   (0.3–0.6 s, 1.2–1.6 s, 2–3 s). Mike Senior's recipe: one "short (usually well under a second in length)
   and with perhaps only 5-10ms of pre-delay", one "longer and perhaps slightly brighter… with a fairly long
   pre-delay (maybe 30-70ms)". This confirms `reverb.md`'s Pairs (7) and `add_vocal_reverb`'s two sends (9.6).
3. **The return is band-limited, nearly always.** Lows out: Tillie (below 100 Hz), Schaeffer ("I don't like
   too much low end in reverb"), Senior ("somewhere in the 100-300Hz range"), Pensado (from 300 Hz), Curtis
   Douglas, Colmenero, Brathwaite (on delays). Tops off: Illangelo ("rolls off quite a bit of top end"),
   Pensado ("around 5k, sometimes 4k"), Firkins (9.36 kHz), Senior ("a very gentle low-pass filter rolling off
   from around 7kHz"), Puig (above 1 kHz, for a dark verse). Mids only: Stevens (a Pro-Q 3 "allowing only
   midrange through"), Ernster ("takes out all top and bottom, which you don't need on vocal effects"). Mid
   cuts: Senior (−5 dB over an octave at 580 Hz), Douglas ("or any of the mids clouding up the fundamental
   vocal frequencies"), Castelli (Pro-MB on "the dense and harsh mid-range"), Moon (460 Hz). **The documented
   high cuts (4–9.4 kHz) are lower than our vocal presets' 11 kHz** (7): see 1.3.
4. **Sibilance is kept out of the reverb**, before it (Colmenero's EQ7: "You don't want to have esses all
   over your reverb"; Douglas's de-esser "set fairly aggressively" before the 480L and before the delay) or
   after it (Gibbs' Pro-DS on the reverb). That's the De-ess on the input (`reverb.md` 6.3), now with
   engineers behind it.
5. **The return is ducked or compressed.** Keyed to the vocal: Stevens (RComp after the Blackhole, "while he's
   singing it's ducking some of the reverb, and when he's not singing, the decay rings out longer"), Bainz
   (on the delay), Kirkpatrick (LFO Tool copying the vocal's ducking, then OTT, then an 1176), Goldstein's
   ducked delays. Plain compression of the tail: Castelli's Fairchild ("the way it controls the reverb
   tail"), Stuart White's LA-3A and Profitt's CLA-3A on delay returns. Duck (`reverb.md` 6.11) covers the
   first; nothing in our design covers the second (4.1's "Glue" idea, part 4).
6. **Delay into reverb.** The reverb is often after a tempo delay on the same return: Kesha Lee (half-note
   Mod Delay, 43 % feedback, into a "Hall 1"), LaRay (1/8 ping-pong into a 7 s hall), Rice ("a Valhalla reverb
   after the delay, on like 5-10 percent, and push the pre-delay very far back"), Harrington, Ernster ("a
   delay to feed a reverb"), Profitt, Douglas, and Illangelo's H-Delay used as the pre-delay itself. Our
   pre-delay is one tap; an echo stage before the reverb (FutureVerb's echo modes, part 3) is the bigger
   version of the same habit **(inferred)**.
7. **Throws are edits, not automation.** Words are copied onto fully wet effect tracks: Cheese ("I copied bits
   of vocal to these tracks"), Bainz (15 ready-made throw tracks), Gudwin ("I put certain words on"), Tumay
   (drawn in while the artist records), Teezio (delays printed and moved by hand), Gibbs (a muted word's gap
   filled with the previous word's delay and reverb). In the app this is a duplicated clip on a track sent to
   a 100 % wet Reverb, which already works; `add_vocal_reverb` could make a "Throw" send too **(inferred)**.
8. **The vocal stays centred; the reverb is widened.** The S1 Imager on reverb returns (Tillie "probably 75
   percent of the time", Kesha Lee, LaRay, Ali), MicroShift doublers (Kinelski, McCarthy, Bisel), Seara's "AMS
   vibe" "for 'widening' the vocals". "I leave the vocals to be the centre point of the mix" (Tillie). Width to
   150 % (`reverb.md` 4.2) is the same; bass kept mono (6.9).
9. **Ridden by section.** Muted in verses (Castelli), more in the hook (McCloskey), heavily automated sends
   (Swan), a reverb per section (Puig), cut dead for contrast (Mark Ralph's "DJ trick", Kirkpatrick's "crazy
   contrast… by cutting off a reverb tail", Maserati's "removing the reverb for a moment… wakes up your
   ears"). Mix, Decay and Freeze automate (`reverb.md` 9.5); a tail cut dead is a Mix of 0 *with the tail
   dropped*, which our spillover (9.3) would otherwise let ring **(inferred: a "cut" option)**.
10. **Rap splits in two.** Dry: Joshua in 2010 ("Reverb is the kiss of death on rap vocals"), 40 for Drake,
    MoneyBagg Yo ("bone-dry, raw power"), Polo G, Roddy Ricch, 21 Savage's team. Wet: Tillie ("I like rap
    vocals to be wet and wide"), Harrington ("I'm an excessive reverb user… Reverbs can also be used to add
    volume"), LaRay. What both camps share is a short room close to the voice (Firkins' 751 ms; Maddmix's
    "small room reverb really subtly in the background"; Joshua's later "dark short reverb to add warmth").
11. **What they name.** In the rows above VintageVerb is the most named (Nigro, McCarthy, Bisel, Kirkpatrick,
    Gibbs, Swan, Hurtt, Teezio, Schaeffer, Profitt, McCloskey, Menzies & Reid, Moon, Heldens, Hidalgo: 15).
    Then, surprisingly for rap, **Avid D-Verb** (Firkins, Tillie, LaRay, Colmenero, Harrington, Schaeffer,
    White, Mike Dean: 8): a plain, cheap, slightly grainy room ("Give me good old D-Verb any time, and I can
    make it sound good"). Then Waves RVerb (7), Lexicons (480 / 224 / 960 / PCM: 8), Altiverb (5), EMT
    plates (5), springs (6). **Pro-R is named once** (Hurtt's chamber).
12. **The old units' "worse" sound is wanted.** Jess Jackson on Pop Smoke: "that famous '80s reverb sound
    used on a lot of rap from the early '00s", the Rev-7's "shorter, metallic-sounding reverb that you can't
    really get from modern plug-ins"; Ali's EMT 250 and AMS; Young Guru's 480; Pensado's 2016 for "its
    darkness". The eras (`reverb.md` 4.5, 6.10) and a short, metallic "80s Digital" colour have users.

### 1.3 How much

Every number the sources give, by what it's for. Mix levels on a send are rarely given; fader levels never
in dB except Schaeffer's.

| What | Documented |
| --- | --- |
| **A short room on a rap vocal** | Firkins: D-Verb "Medium Room with a pre-delay of 15ms, a decay of 751ms, a high-frequency cut at 9.36kHz, and just 15 percent wet" (insert); while tracking "a 12-15 percent mix with 12ms pre-delay". Phil Tan: "a room with a short length, 1.68S". Owsinski: "0.3 to 0.6 second Room or Plate". Senior: "well under a second" |
| **The main vocal plate or hall** | Paul White: "a plate reverb emulation with a decay time of 1.2 seconds or so and a pre-delay of 60-80ms"; Owsinski: plate "about 1.8 seconds of decay and a predelay of 20 milliseconds", "1.2 to 1.6 second Plate or Hall"; Gibbs: VintageVerb "with a 2.4s reverb, Mix at 18 percent" (backing vocals, insert) |
| **Long tails and throws** | LaRay: D-Verb hall "with 7s decay and a 15ms pre-delay" (after a 1/8 delay); CLA: a Lexicon hall "with a seven-second decay time"; Menzies & Reid: a "girl group" VintageVerb at 3.6 s; Moon: "a very long (6.82s) tail" with "a long (85ms) pre-delay"; Pensado: Reverb One "11.5 seconds long" into a flanger; Owsinski: "2 to 3 second Hall" |
| **Pre-delay** | 12–15 ms (Firkins, LaRay); 20 ms (Owsinski's plate; "A predelay in the 20 to 40ms range is the most common"); 35 ms (Senior's demo); 30–70 ms (Senior, the long reverb); 60–80 ms (White); 0–80 ms (White, 1996); 85 ms (Moon); "a pretty long, 16th or 32nd note" (Pensado); "very far back" (Rice) |
| **Mix on an insert** | 15 % (Firkins), 12–15 % (Firkins, tracking), 18 % (Gibbs), 25 % (Douglas, a 480L feeding a 100 % wet reverb), 5–10 % (Rice, a reverb after a delay) |
| **Return level** | Schaeffer: the Valhalla "set to -12, so it only gives a tiny bit of ambience". Bainz: "The faders on these tracks are for the most part really low… like little sprinkles". De Man's listening tests (part 5): reverb about 14 LU under the dry mix preferred, 9 LU or less judged too wet |
| **Return filters** | High-pass: 100 Hz (Tillie), 100–300 Hz (Senior), 240 Hz (Senior's example), 300 Hz (Pensado). Low-pass: 9.36 kHz (Firkins), ~7 kHz gentle (Senior), 5 kHz or 4 kHz (Pensado), 1 kHz (Puig, a dark verse), 7 kHz with HF damping at 6.5 kHz (White, 1996), 3.5 kHz with damping at 6 kHz (White's "vocal ambience"). Mid cuts: −5 dB at 580 Hz (Senior), 460 Hz and 5.41 kHz (Moon); a dip at 8 kHz "because it sounded a little bit too expensive" (Pensado). Boost: "a dB or two at 800 to 1kHz to either the send or return" (Owsinski) |
| **De-essing before the reverb** | Firkins 5506 Hz, Kesha Lee ~4230 Hz (both on the vocal bus feeding the sends); Douglas "set fairly aggressively" |
| **Ducking** | Kirkpatrick: "ducked by 10 percent when the kick hits, and in the verses that automation goes to 40-percent ducking", copied onto the reverb. Depths of the keyed compressors (Stevens, Bainz): **not stated** |
| **Delays feeding or beside the reverb** | Half note, 43 % feedback (Kesha Lee); 1/8 at 341 ms and 1/4 at 682 ms (Goldstein); a 30 ms slap (Maddmix); 100 and 125 ms slaps panned apart (Clearmountain); ~80 ms slaps (Marroquin); Supertap at 149, 298 and 587 ms (Pensado) |

What this means for `reverb.md` section 7:

- **Rap Room** (0.6 s, 20 ms, 250 Hz / 9 kHz) is Firkins' room within a few percent: keep it, and offer it as
  an insert preset at 15 % (the way he uses it).
- **Vocal Plate** (1.8 s, 1/32 ≈ 62 ms at 120 BPM) sits inside Owsinski's and White's ranges. Keep.
- **High Cut**: every documented vocal low-pass is at or under 9.4 kHz, most 5–7 kHz. Our vocal presets' 11 kHz
  is brighter than any of them: **lower the vocal presets' High Cut to 7–9 kHz** (Bright Pop Plate keeps
  its air on purpose).
- **Low Cut**: 200–300 Hz is the middle of the documented 100–300 Hz. Keep.
- **Insert mixes**: 12–25 %. Open question 4's proposal (25 % on an insert) is at the top of that: 18–20 % is
  the better default **(inferred)**.

### 1.4 What goes wrong, in their words

| Problem | Said | Cause, and the remedy in our design |
| --- | --- | --- |
| Mud, low end clouding the voice | "I don't like too much low end in reverb" (Schaeffer); "I really didn't want low end in the reverb, or any of the mids clouding up the fundamental vocal frequencies" (Curtis Douglas); Brathwaite takes "the low end out of the delay return" | The voice's 100–500 Hz decays as long as everything else and piles up under the dry sound. Low Cut on the output (200 Hz on vocal presets) and the Decay EQ shortening the bass (`reverb.md` 4.2, 4.6, 6.6); Studio's 600 Hz (4.3) |
| Sibilant splashes | "You don't want to have esses all over your reverb" (Colmenero); Curtis Douglas puts "my usual de-esser, set fairly aggressively" before his reverb and his delay | An "s" into a bright reverb lasts the whole decay. De-ess on the way in (4.2, 6.3); the plates' short top-end decay (5.1); High Cut |
| Too big, too bright | Pro-Q 2 "rolls off quite a bit of top end, to make sure the reverb does not sound too big frequency-wise" (Illangelo) | A long high-frequency decay reads as size and hiss. High Cut (11 kHz on vocal presets), the Decay EQ's top (4.2, 6.6) |
| Harsh mids in the tail | "The Pro-MB controls the dense and harsh mid-range of the vocal verb" (Castelli) | 2–5 kHz building up in a dense tail. The Post EQ (4.3 Output), the Decay EQ (6.6); a multiband on the return is beyond a reverb **(inferred)** |
| The tail fighting the words | Stevens ducks the Blackhole "while he's singing… and when he's not singing, the decay rings out longer"; Kirkpatrick: "It would be crazy to automate the LFO on the main vocal, and not on the reverb"; Bainz's delay "only sounds when the vocal isn't there" | The reverb masks the next syllable. Duck, with its release (4.2, 4.3 Ducking, 6.11); pre-delay (4.2) |
| A tail that won't sit still | Castelli's 670 "because of the way it controls the reverb tail"; Kirkpatrick's OTT and 1176 after the reverb "so I have more control over it"; Stevens' RComp | Compressing the return evens out the tail and holds its peaks. Duck covers the keyed case; plain compression of the return is not in our design **(inferred: a candidate for a "Glue" control later)** |
| Dated, too much | The demo had "a lot of reverb on the vocals… sounded a little dated" (Castelli); "Reverb is the kiss of death on rap vocals" (Joshua, 2010); "Get rid of the reverb" (Eilish, via Kinelski) | Long, loud, obvious tails. Presets that start short and low (`reverb.md` 7: Rap Room 0.6 s, Air 0.5 s), Mix Lock on sends (4.1) |
| The vocal pushed back, losing intimacy | Ernster: delays on the lead "because they take up less space"; "the pre-delay creates this ocean of ambience that does not take away from the intimacy and upfront nature of the lead vocal" | Early reflected energy smears the direct sound (Griesinger, `reverb.md` 1.3). Pre-delay ≥ 20 ms in vocal presets, Distance (4.2, 6.7) |
| Effects that don't follow the performance | Teezio moves a delay by hand when "a word is sung slightly late or early"; Gibbs fills a muted word with "the word before it… delay it with some reverb" | Throws are edited per word: automation of Mix or Freeze (4.1, 6.13); beyond that it's editing, not the reverb |
| The artist doesn't want it | MoneyBagg Yo "hates the traditional ear candy like delay throws, reverb swells"; Polo G "is not a fan of too many effects on his voice"; 21 Savage's team wanted "the vocals pretty dry" | Taste. Presets for the near-dry end (Air, Intimate, Rap Room: `reverb.md` 7) |

The words they use for good vocal reverb: **space, depth, glue** ("that pretty much glues everything
together": LaRay), **density and size** (Low), **airy** (Harrington's "airy, reverb-coated vocal, that is
still up front"; Maserati's "airy brightness"), **wet and wide** (Tillie), **atmospheric tail** (Rice),
**ocean of ambience** (Ernster), **warmth** (Joshua). For bad: **muddy, washed out** (FL Studio's Reeverb
manual), **dated** (Castelli), **esses all over** (Colmenero), **too big** (Illangelo), **clouding**
(Douglas), **the kiss of death** (Joshua), and a listener's "Why is the singer in the bathroom?" (De Man's
tests, part 5).

### 1.5 Tempo and decay

What engineers and teachers actually say about timing reverb to the song:

- **Pre-delay in note values is real but a minority.** Pensado states it ("a pretty long, 16th or 32nd note,
  pre-delay"); Owsinski teaches it as a method: "If you determined that a suitable 1/16-note delay time is
  150ms, cut it in half (75ms), then cut it in half again (37.5ms), and maybe even in half again (19ms,
  rounding it off)", and "the predelay is probably the most important in that the reverb seems more a part of
  the track when that parameter is timed". Pro-R 2 syncs it (quarter to 32nd, with an Offset). Most engineers
  and Sound On Sound writers give fixed values of 12–85 ms chosen for clarity (1.3).
- **Decay timed to the beat is folklore.** Owsinski: "Reverbs are timed to the track by triggering them off of
  a snare hit and adjusting the decay parameter so that the decay just dies before another snare hit (or two
  in some cases). The idea is to make the decay 'breathe' with the track." No engineer interview read gives a
  decay chosen that way; they choose by ear and arrangement (Tan's 1.68 s "a longer time would have gotten in
  the way"). A reverb's decay is its RT60, the time to fall 60 dB, not where it's heard to end, so "timed"
  decay is approximate at best **(inferred)**. Pro-R 2 syncs pre-delay and Auto Gate's hold, not decay.
- **Delays are timed, always.** Nearly every engineer sets delays in note values (Kesha Lee's half note,
  Goldstein's 341 / 682 ms, CLA's "quarter or eighth notes, perhaps the bridge section had dotted eighths").
- **No source prints the 60 000 / BPM formula** (`reverb.md` 1.3 states it as arithmetic, which it is).

So: keep Sync on Pre-delay (`reverb.md` 4.2, 6.3), with ms as the default in Init and note values in the
vocal presets; **don't add a tempo-synced Decay** (8.1's "later" list has one: drop it, or keep it as a
display hint, "1.8 s ≈ 3.6 beats", rather than a mode) **(inferred)**.

---

## 2. The classic units, measured

The reverbs vocal engineers name (section 1.1), each from its maker's manual first, then service documents,
papers and published measurements, then the plug-in makers who measured them. For each: what it is, its
controls, what makes its sound, what's been measured, its versions, what engineers say of it on vocals, and
**what a mode needs**: the numbers our engine (section 6: Dattorro's plate, the 16-line FDN, Jot's
absorption, velvet early energy, the eras of 6.10) would use to sound like it. Section 6.16's short table is
what this part replaces.

### 2.1 EMT 140 (steel plate)

**What it is.** A steel sheet hung on springs in a frame, shaken by a moving coil and heard by two contact
pickups. EMT's 1971 brochure for the 140 TS: "The steel reverberation plate is suspended in a welded tubular
frame which in turn is shock mounted inside the wooden outer case"; the frame "has three transverse bridges,
of which one mounts the magnet for the moving coil excitation system, while the other two are used for the two
contact microphones". The plate is about 1 m × 2 m and 0.5 mm thick: "steel, with a thickness of approximately
0.5 mm, and with a surface area of approximately 2 m²" (Bilbao); Costello's "1 meter x 2 meter x 0.5 mm
rectangular steel plate", "cold rolled steel" **(secondary)**. (UA's blog says "2 x 3m": the outlier.) EMT
dates it: "developed by the INSTITUT FUR RUNDFUNKTECHNIK and the inventor Dr. Walter Kuhl … manufactured by EMT
since 1956" (the 240 brochure); UA's manual says 1957. A stereo 140 st followed in 1961 **(secondary,
Wikipedia)**. The cabinet is 8' ½" long, 4' 4" high, 1' 1½" deep and weighs 170 kg (190 kg with the remote).

- **Two pickups, so stereo for free.** "The two signals obtained from the two contact microphones which are
  mounted at unequal distances from the driving coil are entirely uncorrelated" (EMT). The input is mono: the
  140 TS sums its two inputs ("A + B = M").
- **The damper** is a porous panel swung towards the plate: "with an extreme distance ratio of about 1:30. … to
  a distance of about 1/8" from the steel plate without touching the same. The minimum reverberation time
  reached at this distance is approximately 1 second at 500 Hz" (EMT). Waves, measuring Abbey Road's: "1/8"
  away from the plate for a one-second reverberation time, to 2" away from the plate for a five-second decay".
  The 140 FB-TS moves it by motor, with a meter reading the decay at the console.
- **The electronics**: valve amplifiers first, solid state (the EMT 162) from the 1970s; the 162's drive
  amplifier feeds the coil "through a compressor to prevent inadvertent drive overload" (EMT). UAD's model
  of the original electronics has "a cut filter centered at 80 Hz, with three available levels of attenuation:
  –4 dB, –10 dB, and –16 dB"; the Martech retrofit's shelves are at "90 Hz, 125 Hz, 180 Hz, 250 Hz, 270 Hz, and
  360 Hz" (UAD manual).

| Control (140 TS data sheet) | Range |
| --- | --- |
| Reverberation time, re 500 Hz | **1 to 4 s** (the damper), ±8 % scale accuracy; undamped "about 5 seconds at 500 cps" |
| Input for full drive | +1 dBm minimum, ≥ 5 kΩ |
| Output for full drive | +12 dBm (amplifier max. +24 dBm) |
| Noise, at T = 2 s | ≤ −50 dB unweighted (remote running), ≤ −60 dB weighted |
| Input filter | Original EMT: an 80 Hz cut of −4, −10 or −16 dB (UAD); Martech: shelves at 90 … 360 Hz |

**The curve.** EMT's own words: "about 5 seconds at 500 cps. Towards the low frequency end there is a rise and
towards the high frequency end a decline (to about 1.5 seconds at 10 kHz)". Its graph ("Reverberation times as
a function of frequencies for various distances between reverberation and damping plates") has three curves,
labelled 4.5 s, 2 s and 1 s. Read off the scan (about ±0.2 s) **(inferred: read from a graph)**:

| Damper | 100 Hz | 200 Hz | 500 Hz | 1 kHz | 2 kHz | 4 kHz | 10 kHz |
| --- | --- | --- | --- | --- | --- | --- | --- |
| "4.5 s" (open) | ~10.2 s | ~6.8 | ~4.7 | ~4.0 | ~3.2 | ~2.5 | ~1.3 |
| "2 s" | ~1.7 | ~1.55 | ~1.8 | ~2.15 | ~2.15 | ~2.0 | ~1.2 |
| "1 s" (closed) | ~0.75 | ~0.8 | ~0.85 | ~1.05 | ~1.1 | ~1.2 | ~0.85 |

So **the shape changes with the damper**: open, the bass booms (2.5 × the 1 kHz time at 100 Hz); at 2 s it's
nearly flat with a hump in the upper mids; closed, the bass is the *shortest* band. Every curve meets at about
1–1.3 s by 10 kHz. Costello: "At 10 kHz, the decay time on an EMT140 is <1 second, at any setting of the decay
damper", and the plate's decay setting "is essentially the RT60 at some arbitrary midrange frequency,
somewhere between 2 and 3.5 kHz" **(secondary)**; Valhalla Plate's Decay is the "RT60 between 2.9 kHz and 3.6
kHz", Soundtoys' at 500 Hz "because this is how decay time is listed on the EMT 140's control panel".

**Measured.**

- **Frequency response**: "the statistical mean value of the difference between 'peaks' (maxima) and 'valleys'
  (minima) of the response curve is 10 dB" (EMT, quoting Schroeder): the ordinary statistics of dense modes.
- **Echo density grows linearly, not with t²**: a plate "will deliver reflections which increase in density as
  a function of time. Reflections in a three-dimensional room, on the other hand, become more dense as a
  function of the square of the time" (EMT). In practice it's dense at once: "Instant onset of reverb. No fade
  in at all"; "Instant onset of high echo density" (Costello); "distinct reflections are notably absent"
  (Bilbao).
- **Modal density is constant with frequency**: n = A/(2κ), about **1.3 modes per Hz** for 2 m² of 0.5 mm steel
  **(inferred: computed with E = 2·10¹¹ Pa, ρ = 7850 kg/m³, ν = 0.3)**; EMT's own chart in the 240 brochure puts
  the 140 near 1.4 per Hz against "more than three per Hertz" needed to avoid colouration.
- **Dispersion**: bending waves travel faster the higher they are (phase velocity √(κω), group velocity twice
  that: Bilbao), "between ca. 20-620 m/s" over the audio band (Willemsen's thesis **(secondary)**). So the
  highs reach the pickups first: "Low frequencies can be delayed by around 10ms more than high frequencies"
  (LiquidSonics); the left–right onset difference is "in excess of 10 msec" in the lows and "less than 1
  msec" in the highs (Costello). With the pickup positions modellers take from Arcas (driver at (0.4, 0.415),
  pickups at (0.1, 0.45) and (0.85, 0.45) of the plate), the first arrivals work out at **19 / 29 ms at 50 Hz,
  6 / 9 ms at 500 Hz, 1.4 / 2.1 ms at 10 kHz** (left / right) **(inferred: computed)**.
- **Losses** (Arcas and Chaigne, as quoted by Willemsen **(secondary)**): thermoelastic damping (R₁ = 4.94·10⁻³,
  C₁ = 2.98·10⁻⁴ for the 140), radiation (its critical frequency near 24.5 kHz for 0.5 mm steel **(inferred)**),
  and the porous damper, which "changes this decay between roughly 0.6 – 5.5 seconds" (Abel et al., via
  Willemsen). Abel, Berners and Greenblatt modelled it as a fixed convolution of the onset plus an FDN whose
  decay follows the damper (via Willemsen).
- **No modulation**: "traditional plate reverbs are static devices that do not modulate in time"
  (LiquidSonics); Valhalla Plate's Mod "For realistic physical plates, this should be set to 0%".

**Versions.** 140 (mono, valves); 140 st (stereo, 1961); 140 TS (transistors); 140 FB-TS (the motorised
damper built in); 140 B (the remote alone) (EMT). Abbey Road's four (A–D, bought 1957): Waves sampled "11
damper positions", "approximately 1 to 5.4 seconds, depending on the plate", and "damper position 3 in Plate C
will give you a much shorter reverberation time than damper position 3 in Plate A"; Plate D is "all-valve",
"E81L, E80CC and EF804ES valves". SOS hears A as "large and expansive", B "a little brighter and tighter", D
"some valve-like roundness". UAD modelled three 140s from The Plant, Sausalito (A and B with EMT electronics, C
with Martech): reverb time 0.5–5.5 s in 0.1 s steps, and an added modulation of 0–10 cents at 0.01–1 Hz.
Arturia's Rev PLATE-140: minimum decay "400 milliseconds for the 'modern' plate and 850 milliseconds for the
two other models", maximum "up to 5 seconds".

**On vocals.** Waves: "We suggest using 15 ms for instruments and 40 ms for vocals" of pre-delay. Kevin Killen:
"the 'B' plate at 2.5 seconds, and a 250 Hz input filter, with the predelay anywhere from around 30
milliseconds to about 90 milliseconds"; Tucker Martine starts on "C" for its "darkness … less likely to crowd
the detail of a vocalist's articulation" (UA's roundtable). Paul White (SOS, 2006): "a typical vocal reverb
treatment might comprise a plate reverb emulation with a decay time of 1.2 seconds or so and a pre-delay of
60-80ms"; undamped plates ran "five seconds or more, which is too long for most routine applications". Don Gunn
on Valhalla's blog: "incredibly smooth and if not 'dark', then 'not bright'. It's the perfect timbre to give a
vocal presence without exaggerating the upper-mid frequencies". In the survey (1.1): Low, Castelli, Scheps,
Elmhirst.

**What a mode needs.** Our Plate (6.4) has a fixed curve (×1.5 / ×1 / ×0.7 / ×0.35 of Decay, 10 kHz capped at
1.2 s). EMT's graph says three things it doesn't do yet:

- **A curve that follows the damper.** Not fixed multipliers but a top that barely moves (≈0.85–1.3 s at
  10 kHz, ≈1.2–2.5 s at 4 kHz over the whole range) and a bass that goes from shorter than the mids to far
  longer: as a ratio to the 1 kHz time, 100 Hz is ×0.71 at the closed setting (1 kHz ≈ 1.05 s), ×0.79 at the
  middle (≈ 2.15 s) and ×2.5 open (≈ 4.0 s); 10 kHz is ×0.81, ×0.56 and ×0.33 **(inferred, from the table
  above)**. The simplest faithful rule is to keep the three measured curves as Jot targets and interpolate
  between them by the 1 kHz time (below 1 s, scale the closed curve; above 4 s, the open one with the top held
  at ~1.3 s) **(inferred)**. Valhalla Plate's Decay behaves this way too: lows shorter below about 1 s,
  tracking from 1 to 2 s, longer above 2 s (its controls page **(secondary)**).
- **Dispersion.** Highs first, lows up to ~10 ms later, and the two outputs' onsets apart by ~10 ms in the bass
  and under 1 ms in the top: a short chain of all-passes tuned to delay the lows (a "stretched" all-pass) on
  each output, with different lengths left and right **(inferred)**. Costello found the audible chirp "kind
  of annoying" when overdone: the stereo spread matters more than the "pew".
- **Density from the first millisecond and no early reflections**: Dattorro's input diffusers as now, no
  velvet early pattern, first arrivals 1–2 ms (highs) **(inferred)**.
- **Modal density about 1.3 per Hz**, constant: a network's modes per Hz equal its total delay in seconds, so
  ~1.3 s of delay in the loop **(inferred)**. Smooth Plate's 1.42 s is already there; Plate's 0.73 s is half,
  which is part of its "metal".
- **No modulation by default** (0 cents; UAD's optional 0–10 cents at 0.01–1 Hz is the most to offer). Our
  Plate's chorus default (0.9 Hz, 0.27 ms, about 3 cents) is Dattorro's, not the 140's.
- **An input high-pass** (80 Hz to 360 Hz, the EMT and Martech positions) and **a drive stage with a gentle
  compressor** before the plate (the 162's), both before the network; the return EQ is the console's (Abbey
  Road's band-pass, 2.12).
- **Pre-delay 30–90 ms** for vocals in its presets (Waves' 40 ms, Killen's 30–90).

### 2.2 EMT 240 (gold foil)

**What it is.** The small plate: a gold-alloy foil, "270 mm by 290 mm with a thickness of 18 microns",
deposited electrolytically ("±10%") (EMT's 240 brochure). Barry Rudolph dates it 1971 **(secondary)**. "Only
1/5th the volume of the previous EMT 140" in the leaflet, "one-tenth" in its article. Transducers the other
way round from the 140's: a piezo driver ("a thin disk of lead zirconate-titanate … glued directly on to the
foil", with a 5 g seismic mass) and a moving-coil pickup (a 12 mg coil, "turnover frequency of the pick-up
transducer of 100 Hz"). Its damper is again a plate whose distance is changed, with "frequency dependent
acoustic resistances", which "produces proportional damping of all frequencies and avoids formation of decay
peaks". It takes the 140's remote: "even the connecting plug is the same".

| Control (EMT) | Range |
| --- | --- |
| Reverberation time at 500 Hz | "1...4 seconds" (leaflet); "0.7...5 s" with the EMT 262 amplifier (article) |
| Density of resonances | ">3/Hz" |
| Signal to noise | ">65 dB" unweighted, ">60 dB" weighted |
| Output | "+21 dBm for 1% THD"; amplifier 40 Hz–15 kHz ±2 dB |
| Size, weight | 63 × 67 × 30 cm, 60 kg (leaflet); 67 kg (article) |

**Measured** (EMT's brochure).

- **Modal density** "3 to 4 resonances per Hz", "double the resonant density" of the 140.
- **The first reflection** comes at "three times the delay" of the 140's (a thin foil's bending waves are slow:
  about 17 m/s at 1 kHz against the steel plate's ~139 m/s **(inferred: computed)**).
- **Even decay**: "minimum dispersion"; "no flutter echo repeats"; "constant reverb decay according to an
  exponential function".
- **The curve** (EMT's Figure 2, read off the scan **(inferred)**): flat from about 50 Hz to 500 Hz at each
  setting (1, 2, 3, 4 s), a small bump around 0.7–1 kHz, then a roll-off: every curve meets near 1 s by 6–8 kHz
  and ~0.9 s at 10 kHz. The top is set by "inter-crystalline thermal conductivity damping". So unlike the
  140, **its bass doesn't grow** with the decay.

**Versions.** One unit, with the EMT 262 amplifier. Heritage Audio's HA240 is a modern reissue.

**On vocals.** Soundtoys (SuperPlate models it): "a smaller and lighter version of the 140 with a darker
sound and an overall shorter reverb time". Costello: "I kinda hated the EMT240 sound" **(secondary)**. No
engineer in the survey names it: **not stated**.

**What a mode needs.** A darker, smoother plate with a flat low end: T60 equal from 50 Hz to 500 Hz (bass
×1), a slight lift at 0.7–1 kHz, then the top falling to ~1 s by 6–8 kHz whatever the decay (so 4 kHz ≈ ×0.6
and 10 kHz ≈ min(0.45 D, 0.9 s) at D = 2 s **(inferred)**); 3–4 modes per Hz (3–4 s of delay in the loop: our
Smooth Plate scaled ×2.5, or the FDN's Hall set **(inferred)**); a first arrival later than the 140's (~3×)
and less dispersion; no modulation. It's the natural "Dark Plate" if a gold-foil choice is wanted.

### 2.3 EMT 250 (the first digital reverb)

**What it is.** "The first digital reverberation device to create ambience through a purely electronic system",
unveiled at the AES in 1976 (UAD's manual). Mix's history: algorithms by "Dr. Barry Blesser and Karl-Otto
Bäder", digital hardware by Ralph Zaorski, EMT's converters and lever panel; "16K of memory", "400 ICs", "$20,000
price on its debut" (UA says $25,000), "some 250 units were produced"; one input, four outputs; U.S. patent
4,181,820. Dattorro: "operated at a sample rate of 32 kHz, having only 8K words of memory" (so Mix's 16K and
Dattorro's 8K disagree: **not settled**), distributed in the US by Gotham Audio from 1977. Its word length and
converter: **not stated** (UA models "the A/D and D/A anti-aliasing filters (which are not linear-phase), system
latency, input clipping, and limited frequency response"; its input clips 6 dB over its 0 dB mark).

| Control (UAD's manual, from the hardware) | Range |
| --- | --- |
| Lever 1, Decay Time | **0.4–4.5 s at 1 kHz, in 16 steps** |
| Lever 2, LF Decay | ×0.5, ×1.0, ×1.5, ×2.0, **at 300 Hz** |
| Lever 3, HF Decay | ×0.25, ×0.33, ×0.5 and "max", **at 6 kHz**: "At the max position, the HF decay factor is x 1.0 at approximately three seconds" |
| Lever 4, Predelay | 0, 20, 40, 60 ms |
| Programs | Reverb, Delay (to 375 ms), Phase (a fixed 15 ms against 0–15 ms, no LFO), Chorus ("four delay processors, each having short delay times that are continuously and randomly modulated"), Echo, **Space**: "an extremely long decay time and linear distribution of the reverberation time with frequency (all frequencies decay at the same rate)", "approximately 10 seconds" |
| Outputs | Mono in, four outputs (front pair, rear pair) |

**Measured.** No published RT60, frequency response or IR analysis: **not stated**. What's said of its sound is
its modulation: "The EMT250 used an enormous amount of modulation, to the point where it sounded like a chorus
unit" (Costello, 2009); the old units' depth "goes far beyond what can be heard in any 'real world' acoustic
space … the extreme chorusing and detuning found in the EMT250". The depth and rate: **not stated**. Dattorro
(reverb.md 6.16): "the required eigentone density was emulated entirely by randomizing delay lines". Its noise:
UA's plug-in keeps it ("Noise is dynamic to the response of the effect processing, and the noise level differs
from program to program").

**Versions.** One hardware unit. UA's plug-in is "the very same
algorithm found in the original units", "re-engineered for plug-in use by EMT 250 creator Dr. Barry Blesser from
his original documentation", captured from Allen Sides' unit at Ocean Way.

**On vocals.** Derek Ali used it on Kendrick Lamar's vocals at the mix; Castelli has it beside the EMT 140
(1.1). UA lists Massenburg, Swedien and Sides among its users. A quote about it on vocals: **not stated** in
what we read.

**What a mode needs.** A short hall-plate with **stepped, coarse controls** (16 decays, four LF and four HF
multipliers, four pre-delays), a dark top (HF ×0.25–0.5 at 6 kHz: at a 2 s decay, 6 kHz dies in 0.5–1 s; the
"max" position saturates near 3 s), a bass from ×0.5 to ×2 at 300 Hz, **heavy random modulation** on every line
(chorus-like: our Random shape at its deep end, ~0.5–1 ms, **(inferred: no depth is published)**), a small
memory (8K words at 32 kHz is 0.26 s of delay in all: our Room set's size), mono in with four decorrelated
outputs, and the 1970s era (6.10). Its **Space** program is a ready target for our later Space mode: ~10 s with
every band decaying alike (Jot filters flat).

### 2.4 Lexicon 224 / 224X / 224XL

**What it is.** David Griesinger's design, "Unveiled at the AES show in 1978" (Mix), "$7,500 with two programs or
$7,900 with four", "at half the price of EMT's 250"; 224X in 1982, 224XL (with the LARC) in 1984 (Arturia).
Dattorro: "introduced in 1979 originally possessed only 16K words of memory, operating at a sample rate of 20
kHz. That memory amount doubled shortly thereafter." Arturia's model runs "at the sample rate of 20480Hz, as in
the original", with "a high frequency elliptical filter set at 8k, pre-emphasis, de-emphasis" and 12-bit
converters; UA's models "early AD/DA 12-bit gain stepping converters" and the input transformers. Costello: "a
fixed point processor, with a 16-bit word size, and a 20-bit saturating accumulator … about 24 dB of headroom
internally … HARD, digital clipping"; its modulation's "quirky multiplier … resulted in the linear interpolation
being quantized to fairly big subsample chunks (I think it was 32 or 64 chunks per sample). This resulted in a
'halo' of noise around reverbed signals". The 224XL: 34.125 kHz, its Concert Hall's damping filters inside the
loop (Costello, reverb.md 6.16). Two inputs, four outputs (A and C the stereo pair).

| Control (UAD's manual, firmware 4.4) | Range |
| --- | --- |
| Bass (decay below the crossover) | 0.6–70 s |
| Mid (decay above the crossover; "a slightly misleading label") | 0.6–70 s |
| Crossover | 100 Hz–10.9 kHz |
| Treble Decay | 100 Hz–10.9 kHz, "a frequency above which decay is very rapid"; "Treble Decay adjusts the AMOUNT of reverb tail highs, while Mid adjusts the TIME" |
| Depth | 0–71, "the apparent distance between a source and its reverb, much like the positioning of microphones in an echo chamber" |
| Diffusion (from software 4.0) | 0–63: "setting Diffusion higher than 40 can actually sound less dense. The fastest density buildup is achieved with Diffusion values near the middle of the range (approximately 32-37) … With low Diffusion values the early reverb will be 'grainy' and sparse, but will produce a clear, bright sound that is very useful with strings, horns, and vocals … in Lexicon 224, lower frequencies are generally less diffuse" |
| Predelay | per program: 0–107 ms (plates), 24–152 ms (halls), 24–255 ms (Room A) |
| Mode Enhancement | on/off, Amount 1–16 ("the amount of time between delay line updates", lower = more), Pitch Shift 1–16 ("the size of the delay line update steps"); it works "by continuously modulating certain delay lines (taps) … which increases the effective density without thickening the reverb itself". Arturia: Pitch Shift "Going to 4-5 will make the reverb tail sound like it contains a chorus" |
| Decay Optimization | 1–16; "dynamically reducing reverb diffusion and coloration in response to input signal levels" |

**Its programs** (UAD's Table 15, the factory defaults of firmware 4.4; decoded from the PDF's font):

| Program | Bass | Mid | Crossover | Treble Decay | Depth | Diffusion | Predelay | Mode Enh. / Pitch | Decay Opt. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 Small Concert Hall B | 3.0 s | 2.0 s | 540 Hz | 4.4 kHz | 23 | 21 | 24 ms | 2 / 1 | 5 |
| **P2 Vocal Plate** | 2.2 | 2.2 | 1 kHz | 10.9 kHz | 0 | **4** | 0 | 2 / 1 | 5 |
| P3 Large Concert Hall B | 3.4 | 2.6 | 540 Hz | 4.0 kHz | 21 | 1 | 24 | 2 / 1 | 5 |
| P4 Acoustic Chamber | 2.8 | 2.2 | 1 kHz | 6.6 kHz | 0 | fixed | 25 | 2 / 1 | 5 |
| P5 Percussion Plate A | 2.2 | 2.2 | 1 kHz | 10.9 kHz | 0 | 37 | 0 | 2 / 1 | 5 |
| P6 Small Concert Hall A | 3.0 | 2.0 | 540 Hz | 6.6 kHz | 23 | 28 | 24 | 2 / 1 | 5 |
| P7 Room A | 1.8 | 1.8 | 540 Hz | 4.4 kHz | 23 | 24 | 24 | 2 / 2 | 5 |
| P8 Constant Density Plate A | 1.8 | 1.8 | 540 Hz | 10.9 kHz | 23 | 37 | 5 | 7 / 1 | — |

The manual's words: Vocal Plate is "a plate reverb emulation optimized for voice. It has low initial density
and coloration, resulting in a clear, bright sound", the same algorithm as Percussion Plate ("high initial
density and coloration") with less diffusion; Concert Hall A "is brighter overall and the Treble Decay control is
more gentle", and the original manual recommends EQ "about +3 dB below 200 Hz to 'add to the richness and
naturalness of the reverb'"; Acoustic Chamber "sounds like a chamber, but with less initial density … best with
shorter reverb times (2 to 5 seconds)" and has a mono input; Constant Density Plate's "density does not increase
over time". Arturia: Concert Halls "are intended to put 'behind' the music, not with it"; Small Concert Hall A's
"decay only affects the sound after the first 300 ms"; Room A's "modulations are fast, and pitch shift makes a
nice pitch vibrato"; raising Diffusion has "a big side-effect: the timbre becomes more metallic".

**Measured.** No published RT60 or IR analysis: **not stated**. What's established is the chain: a 20 kHz (or
20.48 kHz) rate, an 8 kHz elliptic filter, emphasis around a 12-bit gain-ranging converter, 16-bit words with a
saturating 20-bit accumulator, and quantised modulation, all of which our 1970s era already copies (6.10).
Costello's 2013 edit: "the modulation source in the older Lexicons had a lot more to do with the noise
performance than I had originally thought. The modulation in my PCM70 is noisy as all get out."

**Versions.** 224 (1978, 20 kHz, software to 4.4: Diffusion arrived with 4.0); 224X (1982); 224XL (1984,
34.125 kHz, the LARC). Arturia: "the first 2 versions being more desirable for their warmer, thicker sound".
UAD's ("the very same algorithms and control processor code from the original hardware", 4.4) and
Arturia's Rev LX-24 (Vintage 12, Vintage 24 and Modern converters). VintageVerb's Concert Hall and Bright Hall
are Costello's 1970s showcases.

**On vocals.** UAD's manual: low Diffusion "very useful with strings, horns, and vocals". Arturia, on Mode
Enhancement: "Try this on exposed vocals: you should hear a more metallic reverb sound without the Mode
Enhancement". Kevin Killen and Chuck Zwicky made UA's presets for it. CLA: "You can't really beat the original
digital reverbs" (1.1). A named vocal setting from an engineer: **not stated**.

**What a mode needs.** Two modes in one unit:

- **A Vocal Plate**: flat decay (Bass = Mid, 2.2 s), the treble open (10.9 kHz, i.e. the band limit), **low
  diffusion** (4 of 63: sparse, "clear, bright"), no pre-delay, light Mode Enhancement. In our terms: Plate
  with Diffusion ~10–20 %, Jot flat to the 1970s band limit, modulation stepped and slow **(inferred)**. Its
  clarity comes from *less* onset density, the opposite of the plate class's instant density: worth a "Vocal
  Plate" preset on Plate at low Diffusion.
- **A Concert Hall**: bass ×1.5 below 540 Hz (3.0 / 2.0 s), the top decaying fast above 4.4–6.6 kHz, Depth as
  the early/late balance, 24 ms of pre-delay, Diffusion ~21–28, "chorus" (Mode Enhancement) on the taps; on
  the 224XL the damping in the loop. Costello's "halo" needs the 1/32- to 1/64-sample quantised reads our
  1970s era already has.
- Its "Depth" is our Distance; its split Bass/Mid decays with a crossover are what our Decay Rate EQ already
  draws (two bands are the minimum to offer).

### 2.5 Lexicon 480L

**What it is.** Lexicon's flagship of 1986, the successor of the 224XL, controlled from the same LARC remote:
two "high speed processors" (two machines, A and B, run singly, cascaded, or in mono / stereo split), "unique
18 bit A/D and D/A converters", "a dynamic range of 98 dB in the wet signal path", PCM 1610/1630 digital I/O
(manual). Software 4.10 was the last; UA's and Relab's plug-ins are both of it. Its reverbs are four
algorithms, which the manual tells apart:

- **Hall** and the **dense** Plate/Room algorithm (banks 1–4): "Two different algorithms … The primary
  difference between the two is the density of the reverberation. The algorithm with greater density is used
  primarily for Room and Plate programs … the dense algorithm has only two voices" of pre-echo. "Both
  algorithms have fixed, or 'static' reverberation characteristics." Costello: "the basic 'reverb' algorithms
  in the 480L had NO modulation. No chorusing modulation, no randomized modulation, nothing" (KVR, 2013).
- **Random Hall** (banks 11–12): "similar to the standard Hall program in the 480L, with the addition of random
  delay elements. These elements have several effects. First, there is a reduction of long-lived modes in the
  reverberant decay, which makes the decay less metallic and reduces the apparent reverb time. The apparent
  reverb time of RHALL is much closer to the value indicated by the display than the standard Hall … The
  random elements also improve the steady-state timbre of the program. The amount of coloration has been
  substantially reduced … especially at small settings of the spread control. In addition, the steepness of
  the filter in the TREBLE DECAY control has been increased." Full scale on RTM is infinite reverb.
- **Ambience** (banks 13–14): "intended to become a part of the direct sound — to give it both better blend
  and a definite position in space", unlike the halls' "cushion of reverberance".

Its philosophy, in the manual's words, is Griesinger's (his 1989 paper says the same): "once the reverberation
has decayed 15 dB it is no longer audible in the presence of the direct sound. So the time it takes for the
sound to build up and decay 15 dB determines the perceived reverb time"; pre-delay's "sharp attack … sounds
entirely different" from a real hall's "gradual buildup of energy"; and **"The Early Reflection Myth"**:
discrete early reflections give "a coarse, grainy sound", and "Too much early reflected energy makes the sound
muddy". So its pre-echoes are "diffused clusters of preechoes", their density set by Diffusion, to "be used
with caution".

| Control (Hall, Plate/Room; Random Hall adds the last four) | Range / what the manual says |
| --- | --- |
| RTM, mid reverb time | Seconds (presets 0.13 s to 5.46 s; Reverb Tail 32 s); "a master control for the stopped reverb time"; linked to Size in Reverb mode |
| SHP, Shape | 0–255. "With SHAPE all the way down, reverberation builds explosively, and decays quickly" (plates and small chambers); at 32 a slower build and brief sustain; at 64 "the sustain will be approximately the time value indicated by the SPREAD display (in milliseconds)"; towards 128 "a secondary plateau … a very diffused reflection off the back wall of a hall", optimal "at a SHAPE value of about 128"; near the top "an inverse sound". Spread works only above 8 |
| SPR, Spread | 0–255; "the duration of the initial contour of the reverberation envelope"; linked to Size |
| SIZ, Size | Metres, "roughly equal to the longest dimension of the space" (presets 4–39 m); sets "the rate of buildup of diffusion after the initial period" and scales RTM and Spread; "15 meters makes a very small room, and 38 meters is useful for a large hall"; "small sizes color the reverberation" |
| DIF, Diffusion | 0–99; "the degree to which initial echo density increases over time … For clearer and more natural vocals, mixes, and piano music, use low or moderate settings of diffusion" |
| BAS, Bass Multiply | × RTM below the crossover (presets 0.2× to 4×). "An ideal concert hall would have a BASS MULTIPLY setting of 1.2. It is rare when actual physical spaces exceed 1.5. Many (if not most) good recording environments have values of BASS MULTIPLY of 1.0 or less, and a value of 0.8 should be tried"; "we recommend values of 1.5X or less" |
| XOV, Crossover | Hz; "at least two octaves higher than the low frequency you want to boost"; "around 500 for boosting low frequencies, and around 1.5 kHz for cutting" |
| RTC, RT HF Cut | Hz; "the frequency above which sounds decay at a progressively faster rate" (all but the pre-echoes) |
| HFC, HF Cutoff | Hz; "a 6 dB/octave low-pass filter" on everything, pre-echoes included |
| PDL, Predelay | ms; "continuity between source and reverb is maintained up to around 40 ms … Much of the effect of PREDELAY can be better achieved by using medium values of SHAPE, and setting the desired apparent predelay with SPREAD" |
| DCO, Decay Optimization | Reverb 0–9 / Effects 0–9 (Relab: "20 steps"); "alters program characteristics in response to changes in input level, to make reverberation decay sound more natural … normally … REVERB 7"; Effects unlinks Spread from Size |
| Pre-echo levels and delays | Six (Hall) or two (dense) clusters, each a level (Off … Full) and a delay (ms), routed L>L, R>R, R>L, L>R; not moved by Predelay |
| MIX | Wet/dry, "a sine/cosine fade" |
| SPN, Spin (Random Hall, Ambience) | "affects the movement of many of the delay taps … The object of SPN and WAN is to continuously alter the timbre of the reverberant sound … It is not intended to make the position of instruments unstable. SPN should typically be 37 or higher. High values may make the pitch of piano or guitar unstable." In the Effects program: "SPIN sets the rate of WANDER. SPIN is a log control with a period of 8 … if you increase SPIN by eight units, the amount of audible spin increases by a factor of two. There is always some spin" |
| WAN, Wander | ms; "the distance in time that the early reflections will move. For best results WAN should be about 10ms at larger sizes" |
| SHL, Shelf | "adds pre-high frequency cutoff energy to the reverb output, allowing a double 'knee' in the low pass filter" |
| RLV, Reverb Level | Output gain (presets 160) |

**Its programs** (the manual's tables; "1.02 Hz" in the scan is 1.02 kHz). The vocal-relevant ones:

| Program | RTM | SHP | SPR | SIZ | HFC | PDL | BAS @ XOV | RTC | DIF | Spin / Wander | Pre-echoes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **A Plate** ("useful for everything from vocals to percussion") | 2.00 s | 0 | 0 | 20 m | 8.5 kHz | 0 | **0.6 × @ 752 Hz** | Full | 97 | — | −8, −9 dB at 14, 18 ms |
| Small Plate | 1.65 | 0 | 6 | 18 | 15.9 k | 2 | 1.0 @ 885 | 10.1 k | 99 | — | −2, −4 at 10, 6 |
| Thin Plate | 1.59 | 0 | 0 | 15 | Full | 0 | 0.6 @ 752 | 15.9 k | 85 | — | −6, −6 at 14, 18 |
| Fat Plate ("very large, highly-colored") | 1.98 | 97 | 130 | 34 | 9.3 k | 2 | 1.0 @ 1.59 k | 21.2 k | 75 | — | −6, −9 at 30, 30 |
| Snare Plate | 1.84 | 1 | 0 | 16 | Full | 60 | 0.6 @ 120 | Full | 95 | — | −9, −12 at 110, 152 |
| Lg Chamber ("can be used wherever a plate would normally be used, but with a more subtle acoustic sound") | 0.88 | 3 | 0 | 20 | 7.2 k | 10 | 1.0 @ 752 | 6.0 k | 99 | — | off |
| Small & Bright ("adds presence … without adding a lot of obvious reverberation") | 0.65 | 40 | 39 | 9 | 10.6 k | 6 | 0.8 @ 621 | 7.5 k | 81 | — | −14 ×4 at 14, 10, 28, 44 |
| Large Room | 0.70 | 52 | 82 | 19 | 6.6 k | 0 | 1.0 @ 752 | 3.8 k | 65 | — | off |
| Small Hall | 1.13 | 96 | 50 | 25 | 4.4 k | 24 | 1.0 @ 752 | 3.8 k | 99 | — | off |
| Medium Hall | 1.74 | 126 | 128 | 25 | 4.4 k | 24 | 1.2 @ 752 | 4.0 k | 99 | — | off |
| Large Hall | 2.19 | 126 | 179 | 37 | 2.9 k | 24 | 1.2 @ 752 | 4.2 k | 99 | — | off (+Stage: −12 … −8 dB at 16, 22, 64, 56, 112, 102 ms) |
| **Large RHall** | 2.09 | 120 | 158 | 38 | 3.4 k | 0 | 1.2 @ 493 | 3.6 k | 65 | 43 / 10 ms | off |
| Medium RHall | 2.06 | 120 | 127 | 30 | 3.4 k | 0 | 1.2 @ 493 | 3.6 k | 68 | 43 / 10 ms | off |
| Small RHall | 1.12 | 92 | 51 | 25 | 4.6 k | 0 | 1.0 @ 493 | 3.6 k | 65 | 43 / 10 ms | off |
| Large Chamber R | 0.90 | 3 | 0 | 21 | 7.2 k | 0 | 1.0 @ 1.16 k | 5.5 k | 99 | 43 / 3.1 ms | off |
| Small Room R | 0.32 | 16 | 0 | 11 | 7.5 k | 0 | 1.0 @ 493 | 3.6 k | 65 | 43 / 3.4 ms | off |
| Chorus Room ("a subtle chorus effect … useful for horns, strings, and vocals") | 0.12 | 255 | 12 | 2 | Full | 16 | 1.5 @ 2.2 k | 21.2 k | 5 | 48 / 1.3 ms | −4, −4 at 22, 12 |
| Wet & Tacky ("chorus-like random delay elements … add a shimmer") | 1.39 | 23 | 36 | 24 | 7.5 k | 0 | 0.8 @ 1.16 k | 4.4 k | 70 | 48 / 9.6 ms | −14 ×4 at 14–34 ms |
| Small Ambience | 1.10 | RTL 71 | — | 13 | ROL 2.9 k | 0 | — | — | 75 | 34 / 7.1 ms | — |
| Ambient Hall ("Fast, dense ambient attack. Reverberant characteristics of Large RHall") | 3.0 | RTL 106 | — | 36 | ROL 2.2 k | 27 | — | — | 94 | 29 / 25 ms | — |
| Announcer ("ambient spaciousness to a dry announcer's dialog track") | 0.69 | RTL 48 | — | 10 | ROL 2.9 k | 0 | — | — | 88 | 16 / 1.2 ms | — |

(Ambience's own controls: RT, "not of great importance to the sound"; RTL, the late part's level, "about 70
results in a natural blend"; ROL, "the -3dB point of a 6dB/octave filter on the output".)

**Measured.** The specification: 20 Hz–20 kHz +0.5/−1 dB; 98 dB dynamic range; THD+N < 0.015 % at 1 kHz;
"18 bit equivalent linear PCM"; 48 or 44.1 kHz. So, unlike the 224XL, **the 480L isn't band-limited**: its
darkness is in its presets (HF Cutoff at 2.9–4.4 kHz and RT HF Cut at 3.6–4.2 kHz on the halls). No published
RT60, echo-density or modulation-depth measurement: **not stated**; Spin's rate in Hz: **not stated**. Relab
claims "the only sample accurate dual-engine re-creation of the original hardware" (a "golden unit from the
famous Hit Factory"), testable only on algorithms "free of any modulation or randomization" (Hall or
Plate/Room, DCO at 0, its "18-bit, Saturation, RH bug, Mod Truncation" emulation on); "Settings above 160 [of
Reverb Level] will result in saturation of the internal calculations which can give a much more vintage
impression" (Relab). UA (Will Shanks, to *Recording*): "the 480L is so clean to begin with, modeling its input
stage was just not that relevant"; "we discovered many bugs, if you will… nearly all of these are faithfully
captured"; "it was the Random algorithm that took up the most resources" **(secondary)**. Griesinger (1991),
on the random delays: "there is a pitch shift associated with any delay change. Given randomly changing delays
there is a finite probability they will all decide to shift in the same direction at once, and a beautiful
decay will go flat or sharp. We have developed a special algorithm for delay change which minimizes the pitch
shift"; and the reverberators' time variation "must be sufficiently fast that the autocorrelation of any
reverberator with itself is also zero after a delay of about 1 second".

**Versions.** The 480L (1986, software to 4.10; the Classic Cart added "Programs for additional plates": their
values **not stated**); its successors the 960L and PCM96 (2.6). UAD's (2018, "Licensed and endorsed by
Lexicon", from 4.10, all five algorithms and the Effects one, 61 % of a SHARC per stereo instance); Relab
LX480 (Essentials, Complete, Dual Engine V4; adds a "Random Hall HD" with "clusters of thousands of
reflections with tuned modulation" in its early system); Softube TSAR-1 is an original design, not a model.

**On vocals.** Don Gunn (Tape Op, UAD 480L): "Vocals take on a depth and dimension when placed in a Random
Hall patch"; "I found myself gravitating to the Random algorithm to create spacious vocal reverbs". Rich
Tozzoli (Mix): "I've always loved the 480's plates, and to me, these sound spot-on, especially on vocals".
Paul Lavigne (Sonicstate) settled on "the same 'ambience' algorithm which just added bright space without
clouding the vocals". Sam Inglis (SOS, LX480 Essentials): "It doesn't exaggerate sibilance or transients;
nor is any ringing or metallic quality audible in the mid‑range", and "noticeably darker than that of most
modern algorithmic reverb plug‑ins". Paul White (SOS): "A significant part of the 'Lexicon sound' is the use
of modulation within the feedback paths of the reverb algorithm" (true of Random Hall; not of the static
algorithms, by the manual and Costello). Maserati's LX480 "shorter, thinner plate-type setting", Lee's
backing vocals on the 480 (1.1).

**What a mode needs.** The 480L gives us the most concrete recipe of any unit:

- **Shape and Spread as the early envelope**, which our velvet early energy can draw exactly: Shape 0 an
  explosive onset (plates, chambers: velvet off, the network straight in); Shape 32–64 a softer build, then a
  plateau lasting ≈ Spread ms; Shape ~128 a second, lower plateau later (the "back wall"); 255 a build that
  ends louder than it starts (inverse). Spread 0–255 ≈ 0–250 ms of build and sustain **(inferred: the manual's
  "approximately the time value indicated by the SPREAD display (in milliseconds)")**. Large Hall's 126 / 179
  is our Hall's default shape; our Attack and the Hall's "sparse to dense 10 .. 120 ms" should become these two
  controls.
- **Size as metres** that scale the line lengths, decay and Spread together (15 m a small room, 38 m a large
  hall), and density's build after the onset; Diffusion as the onset's density only.
- **Static by default** for Hall, Plate and Room (no modulation at all); **Random** as its own mode, whose
  randomisers are not a smooth chorus. Lexicon's later PCM Native manual says what the two controls are:
  "Spin controls the rate of randomization. In most cases, values between 1–2 Hz are appropriate. Typically,
  these values should be smaller for plates and chambers or for very small rooms", and "Wander controls the
  amount by which various delay values may be modulated, or the maximum size of randomizer steps, and is
  expressed in a time value (typically milliseconds)". A 10 ms excursion swept smoothly at 1–2 Hz would bend
  the pitch by about a semitone (`1731 · 2π · f · A`, 6.8), so the 480L's moves must be **steps made without
  the pitch moving**: Griesinger's "special algorithm for delay change which minimizes the pitch shift"
  **(inferred: the algorithm isn't published)**. For us that's a tap that jumps by up to Wander (≈10 ms in
  big spaces, ≈3 ms in rooms, ≈1.3 ms in the chorus room) at a random moment about Spin times a second,
  crossfaded between the old and new positions over a few milliseconds, every line on its own clock so they
  never move "in the same direction at once" **(inferred)**. Our Random shape (a smooth 0.2 ms walk at
  0.5 Hz) can't do this; it needs a second read head per line, as EchoBoy's crossfaded note changes have.
- **Decay bands as the 480L sets them**: halls Bass ×1.2 at ~500–750 Hz, RT HF Cut 3.6–4.2 kHz (with Random
  Hall's "steeper" treble filter), output HF Cutoff 3–4.5 kHz at 6 dB/oct; **plates Bass ×0.6 at 752 Hz** (the
  bass *shorter*: as the M7's vocal plates, 2.11), top decay full and output 8.5 kHz; rooms ×1.0, wood rooms
  ×0.8. Our Hall's ×1.4 at 125 Hz and Plate's ×1.5 are longer than any vocal preset of the 480L
  **(inferred)**.
- **Pre-echoes as diffused clusters**, not discrete taps, six with their own routing (L>L, R>R, R>L, L>R), off
  in most presets; Ambience as early energy with a late part at "about 70" (our Ambience's −10 dB late level is
  close), Wander moving its early taps by ~7 ms.
- **For the 1980s era**: not a 15 kHz band limit but 18-bit converters, saturation of the internal sums when
  driven (Relab's "above 160"), and quantised modulation ("Mod Truncation") **(inferred from Relab's emulation
  options)**.

### 2.6 Lexicon PCM70, PCM90, 960L (and PCM Native)

The 480L's descendants. They matter here less as units than for what their manuals say about the same
controls, more plainly than the 480L's.

**PCM70** (1980s). Its manual we could read only as scanned images: controls and presets **not stated**.
Costello owns one: "The modulation in my PCM70 is noisy as all get out", the source of VintageVerb's 1970s and
1980s modulation ("which can really be heard on long sustained synth notes going through longer reverbs").

**PCM90** (its user guide). Five algorithms: Random Hall, Ambience, Rich Plate, Concert Hall, Chamber/Room.

- **Rich Plate**: "mimics the sound of metal plates. It has a dense, smooth, colored sound … Larger sizes and
  longer reverb times are particularly effective on vocals and brass". Its **Attack** "sets the sharpness of
  the initial response … High settings cause an explosive sound, while low settings cause the sound to build up
  more slowly with time. Attack only affects the level of sound within the first 50 milliseconds".
- **Concert Hall**: "very clean, and designed to remain behind the direct sound … a relatively low initial echo
  density which builds up gradually over time"; its **Chorus** "randomizes delay times and introduces
  modulation to make reverberation sound less metallic. Increasing Chorus increases the rate of modulation …
  increase the setting until pitch wobble becomes noticeable, then lower it slightly"; **Definition** (1–99 %)
  makes the late build "choppier".
- **Ambience**: "To avoid any coloration from these strong reflections, the time delays and amplitudes are
  random functions".
- **Chamber**: "an even, relatively dimensionless reverberation, with little change in color as the sound
  decays"; **Room** "may be too colored for some sustained musical tones".
- **Spin** "should typically be set to values between 10% and 50%"; **Wander** "should be set to about 10ms"
  for larger sizes; **Low Rt** "1.5X or less" for a natural hall; **Rt HC** "a 6dB/octave low-pass filter
  [that] attenuates the reverberated signal … Setting a low frequency for this parameter can actually shorten
  the reverb time, as it damps the audio as it recirculates"; **Pre Delay** to 1000 ms; **Diffusion** "For
  clearer and more natural vocals … low or moderate settings".
- Its vocal presets, described (values **not stated** in the guide): Plates "**1.0 Vocal Plate**: A short plate
  with low diffusion great for a solo vocal track"; "Vocal Plate2: A large plate with a moderate decay time,
  great for backing vocals"; "SmVoxPlate: A small bright plate"; "VoclEkoPlate: A large dark plate with just
  the right amount of delay"; "Bright Vox: A large bright plate with a long decay time". Halls: "Vocal Hall …
  a short, clear reverb decay that doesn't get in the way of the source"; "Vocal Magic … a short decay that is
  perfect as a vocal reverb". Rooms: "Brite Vocal … using a bit of predelay to separate the bright reverb from
  the source for definition and clarity"; "Vocal Space: A short Mid RT and small Size … due to the use of Shape
  and Spread"; "S VocalSpace … A Decay Level of -8dB keeps the reverb from becoming overpowering".
- Converters: 10 Hz–20 kHz ±0.5 dB, 100 dB dynamic range (A/D), 44.1 or 48 kHz.

**960L** (its manual). Up to 96 kHz, multichannel. "Random Hall … Its reverberators change over time in
controlled random ways to avoid the buildup of tinny, grainy, metallic, or other colorations"; "As Shape is
raised from zero to about 30% the onset of the late reverberation goes from abrupt to gradual … At this point,
the sustain will be approximately the time value indicated by the Spread display, in milliseconds", the
back-wall plateau "reaching optimal loudness when Shape is at about 2/3 of its range"; Spin and Wander "High
settings can be used to break up small-room modes, as when recording a voice-over in an announce booth, but
extreme settings can have pitch effects". Chamber: "a more rapid build-up of reflection density than Random
Hall. Reverberant tails are randomized". Plate: "high initial diffusion and a relatively bright, colored
sound".

**PCM Native** (Lexicon's plug-ins; its manual). The plainest statement of Spin and Wander anywhere: "Spin
controls the rate of randomization. In most cases, values between 1–2 Hz are appropriate. Typically, these
values should be smaller for plates and chambers or for very small rooms"; "Wander controls the amount by which
various delay values may be modulated, or the maximum size of randomizer steps, and is expressed in a time
value (typically milliseconds)". Concert Hall's Chorus Type: "Standard Chorus, Random Chorus, and Extreme
Chorus"; RT HiCut's damping "Light, Normal, and Heavy. The Normal value gives filter response identical to
previous Lexicon® reverbs"; "The most natural reverbs use room sizes that vary from about 24 meters to 45
meters". SOS on it (reverb.md 1.2): for vocals, "the Plate algorithms with the two delayed reflections, set at
between 100ms and 300ms".

**On vocals.** Lexicon's own words above: the vocal plate is short, **low in diffusion**; the vocal hall short
and clear; the vocal room bright, with pre-delay. An engineer naming a PCM on vocals: Brauer's PCM81 (1.1), with
no setting.

**What a mode needs.** Three rules repeated across every Lexicon manual, so worth building in:

- **Vocal presets use low Diffusion** (224 Vocal Plate 4 of 63, PCM90 "low diffusion"), the plate's density
  coming from the network, not the onset.
- **Spin ≈ 1–2 Hz, smaller for plates, chambers and small rooms; Wander in ms as a step size**; Concert
  Hall-style Chorus as a separate, smoother modulation (Standard / Random / Extreme), as our two Mod Shapes are.
- **Plate Attack on the first 50 ms** (explosive ↔ slower build), and Rt HC as a filter *in the loop*
  (it shortens the decay), distinct from an output High Cut.

### 2.7 AMS RMX16

**What it is.** "World's first microprocessor-controlled, full-bandwidth digital reverberator" (AMS, of its
DMX15R of September 1981, succeeded "just six months later, in March 1982, by the RMX16": SOS). Designed by
Mark Crabtree. Its original manual (527-030, Issue 3) describes the chain: an anti-alias filter, sample and
hold, the input "scaled by 1, 2 4, or 8 … a two bit exponent number is generated"; "The twelve bit result and
the two bit range data are converted into linear sixteen-bit format" (a gain-ranging converter, as the
Lexicon 224's); "the equivalent of over 1,000 delay taps, each with its associated amplitude weighting";
"The 128K byte memory is used for audio delay generation and as scratchpad memory. Internal data word length
in the 22MHz arithmetic processors is twenty eight bits." Mono in, two outputs. Its sample rate isn't in AMS's
manuals; SOS gives "12-bit, 40kHz A-Ds" **(secondary)**.

| Spec (original manual) | Value |
| --- | --- |
| Frequency response | "20Hz to 18KHz : - 3dB, + 0dB" |
| Dynamic range | 90 dB; S/N "typically 86dB" |
| Distortion | "Less than 0.03% at 1KHz" |
| Delay mode | "0 to 1.6s in 1ms increments" |

| Control | Range |
| --- | --- |
| Program | 1–9 in EPROM (more by barcode wand: 10–18) |
| Pre-delay | 0 to a per-program maximum (200–300 ms for the reverbs), 10 ms nudges, 1 ms from the keypad |
| Decay | 0.1 s steps; "Both the minimum and the maximum decay times are dependent upon the program" (not published) |
| HI decay filter | 0 to −9, as a **"Half decay time frequency"**: 0 = 18 kHz (flat), −1 15 k, −2 10 k, −3 8 k, −4 6.5 k, −5 5 k, −6 3.5 k, −7 2 k, −8 1.5 k, −9 1 kHz. They "apply to the final, reverberant phase … early reflections are also affected in certain programs" |
| LO decay filter | At 350 Hz: "a quarter of the indicated time at a setting of −9, to four times at +9" |

**Its programs** (original manual; UA's and the 500's say the same):

| # | Program | In the manual's words | Filters |
| --- | --- | --- | --- |
| 1 | Ambience | "between a hall and a plate … dimensional elements are deliberately minimised … lower coloration"; at 9.9 with flat filters it lets "voices to be added into the sound one at a time to create a 'choir' effect" | HI, LO |
| 2 | Room A1 | "'live' room … Colouration is made deliberately high to simulate standing waves"; keep decay "to 1 or 2 seconds", HF "say -7,-8" | HI |
| 3 | **Hall C1** | "strong initial reflections thus defining the size of the hall distinctly, giving high presence, making it very useful for vocals" | HI, LO |
| 4 | Plate A1 | "high diffusion … Percussive sounds are rapidly smoothed … Colouration is medium and decay even"; times "accurate to about 5 seconds" | HI, LO |
| 5 | Hall B3 | "similar to Hall C1, but has lower energy initial reflections" | HI, LO |
| 6 | Chorus | "five voice program … very useful for 'filling out' voices"; pre-delay is the voices' spacing, Decay the depth of a random pitch movement | HI |
| 7 | Echo | two taps, Decay as feedback | HI, LO |
| 8 | Nonlin 2 | "decays only very slightly for a period of time … and then dies away very rapidly" | HI |
| 9 | Reverse 1 | builds up, then stops | — |
| (14) | Hall A1 (barcode) | "Used by some to great effect, especially on vocals - it was replaced to allow greater smoothness in decay" | HI |

No factory defaults are published; the manual's example display is "PLATE A1 2.0 0-5" (2.0 s, LO 0, HI −5).

**Measured.** No independent IR, RT60 or noise measurement found: **not stated**. Hugh Robjohns (SOS)
contrasts it with the 224XL, "where a chorusing process on the reverb tails is intrinsic": the RMX16's tails
aren't chorused **(inferred, from his contrast)**. LiquidSonics' sampled Nonlinear (after it, through the
M7 V2): a non-decaying part from "around 50 ms" to "300 ms", then "an exponential decay with an RT60 of around
200 ms".

**Versions.** DMX15R (1981); RMX16 (1982); UA's plug-in (2014), "an exact instruction-for-instruction model of
each of the original algorithms" from Crabtree's own schematics, and SOS: "byte–for–byte identical", the
converter modelled too; the RMX16 500-series (2020), the same code on a SHARC, 24-bit 48 kHz.

**On vocals.** Humberto Gatica: "The classic long reverb that you can't change and that nothing else can
duplicate"; Maserati, "for sort of a darker reverb sound"; Ali on Kendrick Lamar (1.1). Robjohns on Ambience:
"fundamentally neutral but expansive–sounding … warm and flattering, but without imposing any significant
character of its own". MusicRadar: Ambience "works well for enriching vocals" **(secondary)**.

**What a mode needs.** A Hall after Hall C1: strong, distinct early reflections that set the size ("high
presence"), an even decay, no chorus in the tail (Random at its lowest or off), an 18 kHz band limit and the
1980s era's gain-ranged 12-bit converter **(inferred: the AMS's own chain)**. Its decay filters translate
straight into Jot targets: HI at setting n puts T60 = D/2 at the table's frequency (so the vocal-typical −5 is
T60(5 kHz) = 0.5 D); LO is a shelf at 350 Hz from ×¼ to ×4 **(inferred)**. An Ambience after it: low
colouration, "dimensional elements … minimised", decays to "9.9" (near-infinite). Nonlin, later: a flat
plateau of 50–300 ms, then a 200 ms RT60.

### 2.8 Eventide SP2016

**What it is.** Eventide's digital reverb of the early 1980s, now a plug-in (SP2016 Reverb) and an H9 / H9000
algorithm. `reverb.md` 1.2 gives its plug-in's modes from Eventide's guide: Stereo Room, Room, Hi-Density Plate,
with EQ inside the feedback loop, and Position (an early / late balance) and Diffusion. Its hardware
architecture, sample rate and memory: **not stated** in anything we read (the hardware's manual wasn't found;
the search quota ran out before it could be looked for).

**On vocals.** The clearest vocal user in the survey is Dave Pensado: "My all-time favourite hardware reverb is
probably the Eventide 2016. I love its darkness… I manage to sneak them in on almost every mix. I use the stereo
room preset, and I tend to use a pretty long, 16th or 32nd note, pre-delay. I roll off the top end around 5k,
sometimes 4k, plus I roll off the bottom end about two numbers, starting at 300Hz" (1.1). Mick Guzauski on its
Stereo Room for vocals (`reverb.md` 1.2); Kevin McCloskey keeps one of two reverb auxes on it for DaBaby (1.1);
Chris Lord-Alge keeps one in his rack.

**Measured.** **Not stated**: no RT60, IR or modulation measurement found.

**What a mode needs.** What's known is a sound, not a design: a **dark stereo room** of medium length, used
with a long, tempo-related pre-delay and the return band-passed at about 300 Hz–4/5 kHz. That's a preset
on our Room with the Post EQ doing the band-pass ("Dark Room" **(inferred)**), not a mode. The "EQ inside the
feedback" is our Jot absorption already.

### 2.9 Quantec QRS and Yardstick

**What it is.** Wolfgang Schwarz's Quantec Room Simulator (1982), a German "room simulator" whose controls
are a room's, not a reverb's. Its modern form is Logic Pro's **Quantec Room Simulator** (QRS and YardStick
models, made with Quantec), whose guide gives the ranges: Room Size "from 1 m³ to 1,000,000 m³", Reverb Delay
"up to 200 ms", and reverb-time multipliers "from a maximum increase of 10 x to a decrease of 0.1 x" acting
"below 500 Hz" and "above 1 kHz" (QRS) or "below 1 kHz" and "above 1 kHz" with movable crossovers
(YardStick). "These multipliers offer control over the reverb tail's frequency response, achieving a natural
room reverb effect that can't be replicated with EQ alone." "The ring around the knob displays the reverb time
range based on the chosen room size." Dry, 1st Reflection and Reverb have separate levels: raising the
reflection "adds intimacy and presence, and lowering it creates a more open, spacious feel". Freeze captures
the tail and routes "only through Freeze, bypassing the main reverb"; **Add** layers further captures (the
overview: popular "allowing musicians to layer voices"). **Enhance** "replaces the reverb tail with a dense
reflection cluster… improves the clarity and spatial quality of the source signal". AD/DA Drive adds "up to
30 dB of gain to recreate the character of 1980s QRS digital converters… with automatic gain compensation".
"Density values above 100% balance a high initial reflection density with a slight risk of a metallic-sounding
reverb tail." The hardware's internals: **not stated**.

**Others' readings of it.** Costello built VintageVerb's Palace mode on "a digital 'room simulator' hardware
reverb from the 1980s" whose Size runs "10 m3, 100 m3, 1000 m3, all the way up to… 1,000,000 m3" (the QRS
**(inferred)**, part 3): "The 1980s room simulator hardware didn't have modulated delays"; its 1970s colour is
8 kHz bandwidth, its 1980s 15 kHz; "keeping Attack at 0% is recommended for emulating the 1980s room simulator";
its QResque presets set Late Diffusion to 0 % and Attack to 100 % for "the 'reverb from the back of the hall'
sound, which pushes the reverb back behind the sound source". Relab's Sonsig Rev-A has a QRS render mode
("low-fi… steep high frequency cutoff"). Slate's VerbSuite Classics FG-QRS: "We love it on vocals".

**On vocals.** Slate's line above; no engineer in 1.1 names it. Its Freeze was used to layer voices (Logic).

**What a mode needs.** A Hall whose late sound **arrives after a gap and stands back** ("reverb from the back
of the hall"): sparse first reflection at its own level, little late diffusion, no modulation, a room size
in m³ that sets lengths and the decay range together, two decay multipliers, a steep band limit at 8 or
15 kHz with a drivable converter **(inferred)**. Most of that is our Distance at its far end (6.7) plus the
1980s era. Its Freeze with **Add** (layering) is worth copying into ours (6.13): Freeze-and-add is what a
vocalist stacking a chord into a pad wants **(inferred)**.

### 2.10 Yamaha REV7 and SPX90

**What it is.** Yamaha's affordable digital reverbs of the mid-1980s (the REV7 a dedicated reverb, the SPX90
a multi-effect). Their manuals, programs and internals: **not stated** in what we could read (the search quota
ran out before their manuals could be found).

**On vocals.** One engineer, but a telling one: Jess Jackson on Pop Smoke's "Woo" put the lead vocal through an
SPX90 as "the main effect", with a REV7 beside it: "I wanted that famous '80s reverb sound used on a lot of rap
from the early '00s"; the REV7 "has a shorter, metallic-sounding reverb that you can't really get from modern
plug-ins" (1.1).

**What a mode needs.** Too little is known to model either unit. What Jackson asks for is a **short, slightly
metallic, bright-edged plate-room** with the old converters' grain: our Plate at small Size, low Diffusion and
the 1980s era, as a preset ("80s Rap Plate" **(inferred)**). It's the one place in the survey where the metal
our design avoids is wanted, which argues for keeping Plate's Diffusion able to go low enough to ring.

### 2.11 Bricasti M7

**What it is.** A closed algorithmic reverb (2007): "The M7 is a real-time synthesized algorithmic reverb
processor"; its program names "are meant to give the impression and general sound of those spaces or devices,
but not necessarily to be exact sampled or modeled responses" (manual). Brian Zolner (Bricasti) to SOS: "three
different reverb engines, each of which can be adjusted separately: one to handle the early reverberation …
one to cover the late decay tail; and a third that looks after the early reverberation below 80Hz"; "the early
part of the Bricasti reverb … is actually very dense and complex"; Bricasti "use less modulation within their
algorithms, because their approach doesn't suffer from the inherent coloration of reverb algorithms that are
based on all-pass and comb recirculating filters" **(secondary: SOS's report of his words)**. SOS: "a powerful
DSP engine that uses six dual-core Analog Devices DSPs". 24-bit, 96 kHz converters (">117dB A-Weighted");
digital I/O at 44.1 to 192 kHz; "DC to 24 kHz @ 48 kHz"; true stereo, and "it can add up to 10 dB of gain to
the signal!" (manual). Its internal word length: **not stated**.

| Control (manual, V2 addendum) | Range |
| --- | --- |
| Reverb Time | 0.1–30 s ("Mid-frequency reverb time") |
| Size | 1–24 ("apparent size of the late reverberant field") |
| Pre Delay | 0–500 ms, on the late and VLF parts only: "altering the pre-delay only affects the late and very low frequency reverb components, not the early reflections" (Seventh Heaven's manual) |
| Diffusion | 1–9 ("initial diffusion") |
| Density | 1–9 ("how the echo density builds up over time") |
| Modulation | Off, 1–9 ("in the later part of the reverberant field") |
| Roll Off | 80 Hz–28 kHz (a low-pass on the reverb's output) |
| HF RT Multiply, HF Crossover | 0.2–1.0 ×, 200 Hz–16 kHz |
| LF RT Multiply, LF Crossover | 0.2–4.0 ×, 80 Hz–4.8 kHz |
| VLF Cut | 0 to −18 dB, of the "very low frequency content of the initial part of both the early and late" fields |
| Early / Reverb mix | 0–20 each |
| Early Rolloff | 80 Hz–20 kHz |
| Early Select | patterns 0–20 (V1), 20–31 added in V2 ("spread out more … slower early reverb build up") |
| Delay Time, Level, Mod (V2) | 100 ms–1 s, −20 to −6 dB, into the late reverb only: "a diffused set of 8 voices spread in time" |

**Its programs** (Bricasti's V1 preset sheet). The vocal ones and a representative of each kind; columns are
the sheet's (PD ms, RT s, HF × at Hz, LF × at Hz, VLF dB, Mod, Early/Reverb, Early Select, Roll Off Hz):

| Program | PD | RT | Size | Diff | Dens | HF | LF | VLF | Mod | E / R | ESel | Roll Off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **VOX Plate** | 24 | 1.50 | 5 | 5 | 7 | 0.90 @ 5.6 k | 0.85 @ 1.2 k | −19 | 3 | 20 / 20 | 15 | 6.4 k |
| Bright Plate | 0 | 2.00 | 4 | 3 | 7 | 0.80 @ 5.6 k | 0.70 @ 1.2 k | −15 | 2 | 20 / 20 | 15 | 7.6 k |
| Dark Plate | 0 | 1.50 | 4 | 3 | 7 | 0.80 @ 4.0 k | 0.90 @ 800 | −15 | 2 | 20 / 20 | 8 | 4.8 k |
| Rich Plate A | 0 | 1.90 | 5 | 8 | 4 | 1.00 @ 6.4 k | 0.95 @ 800 | −9 | 3 | 18 / 20 | 4 | 9.2 k |
| Gold Plate | 0 | 1.80 | 10 | 2 | 8 | 0.80 @ 3.6 k | 1.20 @ 480 | −10 | off | 15 / 20 | 2 | 5.2 k |
| Dense Plate | 0 | 1.70 | 3 | 3 | Hi | 0.80 @ 4.8 k | 0.90 @ 1.0 k | −15 | 7 | 20 / 20 | 4 | 5.6 k |
| Echo Plate | 60 | 1.70 | 3 | 4 | 8 | 0.80 @ 4.8 k | 0.90 @ 1.0 k | −15 | 2 | 18 / 20 | 19 | 5.6 k |
| Large Plate | 0 | 2.20 | 10 | 1 | 9 | 0.80 @ 3.2 k | 1.10 @ 800 | −10 | off | 20 / 20 | 7 | 4.8 k |
| Small Plate | 0 | 0.90 | 5 | 3 | 9 | 0.80 @ 4.8 k | 0.95 @ 400 | −10 | — | 20 / 18 | 4 | 5.6 k |
| **Bright VOX** (Chambers) | 0 | 1.60 | 3 | 7 | 4 | 0.75 @ 5.6 k | 0.75 @ 800 | −10 | 2 | 20 / 20 | 9 | 8.0 k |
| Large Chamber | 10 | 1.40 | 5 | 5 | 3 | 0.80 @ 4.0 k | 0.95 @ 720 | −15 | 1 | 20 / 20 | 6 | 6.4 k |
| Medium Chamber | 4 | 1.25 | 3 | 5 | 3 | 0.85 @ 4.8 k | 0.90 @ 800 | −12 | 1 | 20 / 20 | 5 | 6.4 k |
| A&M Chamber | 20 | 2.20 | 15 | 5 | 4 | 0.80 @ 5.6 k | 1.05 @ 800 | −14 | 1 | 15 / 20 | 7 | 6.4 k |
| **Small Vox Room** | 0 | 0.95 | Sm | 4 | 6 | 0.55 @ 1.8 k | 1.75 @ 2.0 k | −12 | 2 | 20 / 8 | 1 | 7.2 k |
| Studio A | 4 | 0.70 | 2 | 2 | 8 | 0.85 @ 6.4 k | 0.70 @ 1.2 k | −3 | 1 | 20 / 15 | 4 | 8.4 k |
| Large Room | 0 | 1.10 | 5 | 4 | 4 | 0.65 @ 2.4 k | 0.95 @ 800 | −12 | 2 | 20 / 16 | 7 | 6.0 k |
| Small Hall | 0 | 1.40 | 6 | 5 | 5 | 0.75 @ 3.6 k | 1.05 @ 800 | −10 | 2 | 16 / 20 | 6 | 5.6 k |
| Med Hall | 24 | 1.80 | 23 | 6 | 3 | 0.75 @ 4.8 k | 1.20 @ 800 | −10 | 4 | 10 / 20 | 13 | 6.4 k |
| Large Hall | 10 | 2.20 | 28 | 7 | 2 | 0.75 @ 3.2 k | 1.20 @ 800 | −12 | 4 | 7 / 20 | 17 | 5.2 k |
| Concert Hall | 18 | 2.20 | 20 | 5 | 1 | 0.75 @ 3.2 k | 1.20 @ 560 | −10 | 6 | 20 / 20 | 19 | 5.2 k |
| Small Amb | 0 | 0.45 | 4 | 3 | 3 | 0.90 @ 3.6 k | 0.90 @ 800 | −11 | off | 20 / 13 | 1 | 6.0 k |
| Large Ambience | 10 | 0.80 | 15 | 3 | 3 | 0.85 @ 3.6 k | 0.90 @ 800 | −10 | off | 20 / 10 | 12 | 6.0 k |

The sheet's "VOX Plate" and "Bright VOX" sit where the manual's list has "Vocal Plate" and "Vocal Chamber"
**(inferred, from the order)**. Some cells are letters ("Sm", "Hi") or blank, and a few values fall outside the
manual's ranges (Size 28, VLF −19). The V2 vocal programs (Vocal Plate A and B, Vocal Shimmer, VOX Ambience,
Long Vox Space): values **not stated** in anything we could read. The manual: Plates are "especially well suited
for popular multi-track recordings"; Ambience for "adding 'air' to voice and solo instruments".

**Measured.** Analog response "10 hz- 20 kHz -.002 dB" (manual). SOS (Paul White) looked at its impulse: "the
strong early reflections decay to only a few percent of their original level before the reverb tail starts to
build up, and it is only in the later decay period that the decay curve starts to look exponential". No
published RT60-per-band or modulation measurement: **not stated**. LiquidSonics, who sampled it (Seventh
Heaven, "All reverb samples are recorded at 96 kHz"): "The early and VLF reverb components typically use
independent modulation at slightly different rates"; "The M7 typically has the cross-fed paths (left to right,
right to left) a little lower in the mix than the direct channels"; "the very low frequency reverb time will
non-linearly track the decay time", the VLF part being "up to around 200 Hz"; "version 1 has a faster roll-off
filter than version 2".

**Versions.** V1 (2007); V2 (2010) added a second late algorithm ("more coloration, being more effect like"),
the delay, and a Non Linear algorithm "based on the classic AMS RMX 16". V2's modulation is "higher in level and
more profound than in V1 … designed to be noticed": 1–3 "more of a sine wave like effect, with smooth left to
right movement, deep and consistent, and not randomized"; 6–9 "a randomized pattern, with the delay taps moving
randomly"; 4–5 a blend (V2 addendum). Seventh Heaven (free, thirty programs) and Seventh Heaven Professional
("Fusion-IR", time-varying sampled responses) are its plug-in form.

**On vocals.** Manny Marroquin: "The M7 just has THE sound that none of these other reverbs have" (1.1). Sam
Inglis (SOS, on Seventh Heaven): "a lush chamber for an exposed solo vocal … this is pretty much without peer";
"very short ambiences that never become metallic or ringy". Paul White (SOS): "extremely dense and detailed,
adding air around a sound … without making it sound splashy or gritty". Joel Hamilton (Tape Op #69) put a
vocal in "Studio A" **(via a summarising fetch)**. Puth, Thein and Low reach for it through Seventh Heaven
(1.1).

**What a mode needs.** The M7's vocal presets say what an "expensive" vocal reverb is in numbers, and they
differ from our defaults in three ways:

- **The bass is shorter than the mids on plates and chambers**, not longer: LF ×0.7–0.95 at 800 Hz–1.2 kHz
  (VOX Plate ×0.85, Bright VOX ×0.75), only the halls go over 1 (×1.2 at 560–800 Hz). Our Smooth Plate's ×1.3
  at 125 Hz and Chamber's ×1.6 are the opposite; a vocal mode after the M7 wants ×0.85 below ~1 kHz
  **(inferred)**.
- **The top decays a little faster and is cut low**: HF ×0.75–0.9 at 4–5.6 kHz on plates, ×0.55–0.65 at
  1.8–2.4 kHz on rooms; and the **output rolled off at 4.8–8 kHz** (VOX Plate 6.4 kHz, the halls 5.2–6.4 kHz).
  That roll-off is the M7's darkness: a 12 dB/oct-ish low-pass at 6.4 kHz on our Post EQ for its modes
  **(inferred; the slope is not stated, V1's "faster" than V2's)**.
- **The lows of the onset taken out**: VLF Cut −10 to −19 dB on vocal presets: a low shelf (below ~200 Hz) on
  the early part and the first ~100 ms of the late part, which keeps a vocal's chest out of the reverb
  **(inferred)**.

And otherwise: three engines (early, late, VLF below ~80–200 Hz), pre-delay on the late part only (our early
taps stay put), 1.5 s at 24 ms for the VOX Plate, Mod 2–3 (gentle, late only; no published depth), dense early
energy that falls away before the tail builds (velvet taps strong at first, then a gap of a few dB before the
FDN, **(inferred)**), and cross-feed lower than the direct paths in the stereo outputs.

### 2.12 Echo chambers: Capitol, Abbey Road

**What they are.** Real rooms with a loudspeaker and microphones: the sound most often meant by "chamber" on a
vocal. **Capitol Studios** (Hollywood) has eight chambers under its car park; UAD's Capitol Chambers models four
of them. From its manual: "each chamber's dedicated speaker pair receives a mono summed input"; their natural
decay is "approximately 5 to 9.5 seconds", Decay goes "down to a minimum of one second"; four microphone pairs
and a Position, "From the maximum distance stock positions, to direct speaker-to-microphone effects": "As the
mics are moved closer to the speaker, the room will sound tighter and the source will sound more present… the
room gets more diffused when the mics are farther away". Predelay 0–250 ms; a 6 dB/oct low cut at 80–750 Hz
("on the microphone path for shaping the reverb return signal", though the same page also says "going into the
chamber"); Bass, Mid, Treble at 125 Hz, 500 Hz and 5 kHz, ±10 dB; Width 0–100 %. Changes of chamber, mics or
decay cause "algorithmic recalculations… sonic artifacts can occur": automating them is "Not recommended".

**Abbey Road**'s Studio Two chamber, in Waves' Abbey Road Chambers: the send goes through a loop with "three
filters in Feedback Loop… Since the signal can enter the loop several times on its way to the chamber, these
filters can have an accumulative effect" (Top Cut to 3.5 kHz at 24 dB/oct, a Bass Cut, a 3.5 kHz mid ±6 dB),
"each time the feedback loop passes through the tape machine it undergoes drive processing" (the echo
chamber fed by a tape delay with feedback: the "STEED" practice). The send filter: "a passive filter with two
frequencies filtered at the corner frequencies of 500Hz and 10,000Hz when patching a chamber" (Valhalla, on
Abbey Road's practice **(secondary)**); elsewhere "virtually all energy above 10 kHz and below 600 Hz".
FutureVerb's Studio colour is this band-pass (`reverb.md` 1.2). Motown's famous reverb was its attic chambers
(UA).

**Measured.** No open measurement of a studio echo chamber's RT60, frequency response or echo density was
found (part 5's Gaps). UA's "5 to 9.5 seconds" undamped and the minimum of one second are the only numbers.

**On vocals.** Jonathan Low on Taylor Swift: the Capitol Chambers "gives the vocal a nice density and size,
without it being a long reverb… the chamber for the upfront space determining where the vocal sits in the mix"
(1.1); Bainz keeps one of his three reverb sends on it; Waves' RVerb "SZA Chamber" is Schaeffer's; Sam Inglis
calls Seventh Heaven's chamber "a lush chamber for an exposed solo vocal" (2.11).

**What a mode needs.** Our **Chamber** (`reverb.md` 6.4) aimed at this: dense from the first few
milliseconds, a decay that's short *in use* (0.9–1.5 s) though the room could ring for 5–9 s, a mono-summed
input (a chamber has one speaker pair fed in mono) with decorrelated stereo out, a **microphone distance**
as its Distance (close: tighter, more present; far: more diffuse), and **the band-pass** as part of the sound
(Studio: 600 Hz and 10 kHz, steep). A "Studio" Chamber preset already exists (section 7's Vocal Chamber);
Abbey Road's tape-delay feed is our pre-delay with feedback, which we don't have (part 4's Hybrid Reverb has
"Feedback" on its pre-delay) **(inferred)**.

### 2.13 Springs: AKG BX20, Accutronics / Fender

**What they are.** Helical springs driven at one end and picked up at the other: "highly dispersive" echoes,
"mainly related to the region below F_C", a transition frequency set with the echo period by the wire's and
helix's sizes (Parker and Bilbao, part 5). The **AKG BX20** (a large studio spring in a cabinet) and **BX15**
are the studio units; Accutronics / Fender tanks the guitar-amp ones. Models: UAD's AKG BX20 and BX15, Arturia
Rev SPRING-636 (eight tanks, Decay "only effective when the knob is released", a preamp to +60 dB), Softube
Spring Reverb (Springs ONE to THREE, Tension, Shake, Bass and Treble "applied before the signal goes into the
reverb tank"; on an insert "typically… between 0 and 20%"; "as a send effect on vocal tracks to get that
vintage vibe"), Guitar Rig's, Altiverb's and AIR Spring (part 4).

**On vocals.** More than expected: Castelli's vocal reverb on Kesha's "Praying" is "UAD AKG BX20 → Pro-MB →
Fairchild 670"; Seara uses a "bit of the UAD AKG BX20 which is an incredible spring reverb emulation" on Shawn
Mendes; Bisel's SZA backing vocals go to a BX15 and he says "Guitar Rig has the best spring reverb I've found";
Low throws through EchoBoy into an Altiverb spring; Lana Del Rey's AIR Spring "is one of the characteristic
elements of her vocal sound"; Scheps: "it's either a spring, or a reverb like the 140"; Elmhirst prints a spring
at tracking (all 1.1). Six of the engineers in 1.1 name a spring.

**Measured.** Physics, not measurements, in what we read (Parker and Bilbao; Välimäki, Parker and Abel's
parametric model as "a spectral delay filter", a cascade of stretched all-passes in a loop with "a random
modulation… applied to the delay line to introduce blurring" (part 5)).

**What a mode needs.** Not planned (`reverb.md` 8.1). If wanted: the parametric model of part 5 (stretched
all-passes for the chirp, a long multi-tap loop, random delay modulation, a 40 Hz DC blocker) is cheap and
shares its all-pass chain with the plate's dispersion lean (6.9) **(inferred)**. Given six engineers in 1.1, a
**Spring** mode deserves a place on 8.1's "later" list.

### 2.14 Side by side

| Unit | Kind | Bandwidth / rate | Decay (as the unit sets it) | Bass and top | Modulation | Onset and density | Colour | On vocals |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| EMT 140 | Steel plate, 2 × 1 m | Analog | 1–4 s at 500 Hz (damper), ~5 s open | Bass follows the damper (×0.7 closed to ×2.5 open at 100 Hz); 10 kHz ≈ 0.85–1.3 s at any setting | None (static) | Instant, dense, no early reflections; lows ~10 ms behind highs | Bright edge, "smooth… not bright" (Gunn) | The pop / R&B lead plate (Low, Castelli, Scheps); 40 ms pre-delay (Waves) |
| EMT 240 | Gold-foil plate | Analog | 0.7–5 s | Flat bass; top to ~1 s by 6–8 kHz | None | Later first arrival, 3–4 modes/Hz | Darker, smoother | Rarely named |
| EMT 250 | First digital (1976) | 32 kHz, 8K or 16K words | 0.4–4.5 s at 1 kHz, 16 steps | LF ×0.5–2 at 300 Hz; HF ×0.25–max at 6 kHz | Heavy, random ("a chorus unit") | Small memory; randomised delays | Dark, chorused, noisy | Ali on Kendrick Lamar |
| Lexicon 224 / XL | Algorithmic (1978) | 20 kHz, then 34.125 kHz (XL) | 0.6–70 s; Bass / Mid with crossover | Split bass and mid decays; treble decay | Quantised ("halo"); chorus on Concert Hall | Low diffusion on the Vocal Plate | Grainy, dark | CLA, Jess Jackson's era; Seara's template |
| Lexicon 480L | Algorithmic (1986) | 18-bit converters | RT Mid, Bass ×, crossover, HF cut | Halls bass ×1.2 at ~500–750 Hz; plates bass ×0.6 | Spin / Wander as stepped randomisation; Hall static | Shape / Spread draw the build | Smooth, "airy brightness" (Maserati, LX480) | Young Guru, Ali, Taesub Lee, Curtis Douglas |
| Lexicon PCM70 / 90 / 960L | Algorithmic | — | As the 480L family | — | Spin 1–2 Hz, Wander in ms | Low diffusion for vocals | Noisy modulation (PCM70, Costello) | Douglass (960L), Brauer (PCM81) |
| AMS RMX16 | Algorithmic (1982) | ~40 kHz (SOS), 18 kHz band limit, 12-bit gain-ranged | 0.1 s steps, program limits | HI as half-decay frequency (18 → 1 kHz); LO ×¼–×4 at 350 Hz | None in the tail | Hall C1: strong early reflections | Neutral, "warm and flattering" (Ambience) | Gatica, Ali, Maserati ("darker") |
| Eventide SP2016 | Algorithmic | **not stated** | — | EQ in the loop | — | — | "Its darkness" (Pensado) | Pensado's Stereo Room, Guzauski |
| Quantec QRS | Room simulator (1982) | Steep band limit (8 / 15 kHz in Palace's reading) | Room size 1–10⁶ m³ sets the range; multipliers ×0.1–×10 | Two multipliers, below 500 Hz and above 1 kHz | None | Separate first reflection; reverb "from the back of the hall" | Open, realistic | Slate: "We love it on vocals" |
| Yamaha REV7 / SPX90 | Algorithmic (mid-80s) | **not stated** | — | — | — | — | "Shorter, metallic-sounding" (Jackson) | Pop Smoke's lead |
| Bricasti M7 | Algorithmic (2007), three engines | 24-bit, to 192 kHz | 0.1–30 s | Vocal plates LF ×0.85 at 1.2 kHz, HF ×0.9 at 5.6 kHz, output rolled off at 6.4 kHz; VLF cut −19 dB | Light, late only (V2 sine 1–3, random 6–9) | Dense early field, falls before the tail builds | "Dense and detailed… not splashy or gritty" | Marroquin, Puth, Thein (via Seventh Heaven) |
| Echo chambers | Real rooms | Analog | 5–9.5 s undamped, used ~1 s | Band-passed send (600 Hz–10 kHz at Abbey Road) | Air only | Dense at once | "Density and size, without… a long reverb" (Low) | Low, Bainz, Schaeffer |
| Springs | Helical springs | Analog | Short to long | Dispersive below F_C | Random blurring in models | Chirped onset | "Vintage vibe" | Castelli, Seara, Bisel, Low, Lana Del Rey |

**What the units say together, against `reverb.md`** (each **(inferred)** from the rows above):

1. **Vocal plates and chambers have the bass *shorter* than the mids**, not longer: the M7's VOX Plate ×0.85
   at 1.2 kHz, Bright VOX ×0.75, the 480L's plates ×0.6 at 752 Hz; only halls go over 1 (×1.2). An EMT 140's
   bass is shorter at short settings too. Our natural curves (Plate ×1.5, Smooth Plate ×1.3, Chamber ×1.6 at
   125 Hz) are hall-like: **the vocal modes' natural bass should be ×0.8–0.9** below about 1 kHz, Hall ×1.2.
2. **The top is cut low on the output**: 4.8–8 kHz (M7 6.4 kHz, 480L halls 3–4.5 kHz, VintageVerb's vocal
   presets 4–7 kHz), plus a faster top decay. Our vocal presets' 11 kHz is brighter than every unit.
3. **Low onset diffusion on vocals**: the 224's Vocal Plate (4 of 63), the PCM90's, the 480L manual's "low or
   moderate", D-Verb's guide. Our vocal presets' 75–90 % is too high.
4. **Plates are static**: the EMT 140 has no modulation; the 480L's Hall, Plate and Room run static; the M7
   modulates lightly and only late. Our Plate's chorus default should be off or near it; modulation belongs to
   halls and to the effect presets.
5. **Lexicon's randomisation moves in steps without bending pitch**, not as a smooth walk: a second read head
   per line, crossfaded (6.8 needs a third shape, "Wander").
6. **Shape and Spread** (480L) are a better pair of controls for the early build than our Hall's fixed
   sparse-to-dense pattern; our velvet taps can draw them exactly.
7. **The bass of the onset is cut** (M7's VLF Cut −10 to −19 dB): a low shelf on the early energy and the first
   ~100 ms of the late part keeps a vocal's chest out of the reverb.
8. **Wanted colours we don't cover**: the EMT 250's heavy chorus, the 80s short metallic plate (REV7), the
   spring (six engineers), Freeze with Add (Quantec).

---

## 3. The two it's built on

The design (sections 2, 4 and 6 of `reverb.md`) takes its idea of a reverb from Valhalla VintageVerb and its
Decay Rate EQ, Distance and display from FabFilter Pro-R 2. This part documents both as `pro-c.md` documents
Pro-C 3: every mode and control, with its range, default and the maker's own words, then what reviewers and
users say. It ends by replacing `reverb.md` 1.4's guesses about Pro-R 2 with what was found.

How sure each statement is: quotes in "…" are the source's own words; **(inferred)** is worked out rather
than read; **not stated** means no source we could read gives it; **(secondary)** is a write-up rather than
the maker. Valhalla publishes no manual ("ValhallaDSP plugins are self documenting. Just roll over the
controls to read the tool tip"), so VintageVerb's ranges, defaults and tooltips were **read from the plugin
itself**: the free 4.0.5 demo (identical to the full version except that it fades out every 45 seconds),
loaded as a VST3 in Spotify's `pedalboard` host, which reports each parameter's range, default and the text
the plugin shows for any value; the tooltips are the strings in its binary, and its factory presets are the
XML files its installer carries. valhalladsp.com is behind Cloudflare and was read through web.archive.org.
[Sources](#63-for-part-3-vintageverb-and-pro-r-2) at the end.

### 3.1 Valhalla VintageVerb, mode by mode

**What it is.** "A postmodern reverb plugin, inspired by the classic hardware digital reverbs of the 1970s and
1980s" (the launch post, 18 December 2012), by Sean Costello, tuned with the engineer Don Gunn. Today: "22
classic digital reverbs and 3 color modes inspired by the most beloved reverb hardware from the 1970s and
1980s", $50, version 4.0.5 (15 March 2024). The idea `reverb.md` takes from it: the **Mode** ("a super
powerful, high-level control that allows you to switch between 22 different reverb algorithms"; "each 'mode'
is a distinct algorithm, with different sonic characteristics") and the **Color**, an era chosen apart from
the algorithm. MusicRadar's review: "This simple decision to have the Color as a separate option, rather than
building it into the reverb algorithms themselves, results in an impressive level of sonic flexibility
without sacrificing simplicity and ease of use."

#### 3.1.1 The modes

The list is verified against three of Valhalla's own sources: the product page (22 modes), the plugin's mode
menu (the same 22; its internal order puts Bright Hall eighth, after the first seven), and Costello's posts.
"Added" is from the version notes on the product page, Costello's KVR launch thread (which he edited with
each release) and his blog posts. **A trap in the product page's changelog**: it's headed "Changes since:",
so each list sits under the version *before* the one that brought it (Chamber1979 and Hall1984 are listed
under "3.0.0", but came in 4.0.0; Palace under "2.5.0", but came in 3.0.0; Cathedral under "2.1.5", in
2.2.0).

Descriptions are the product page's; tooltips are the plugin's own, word for word. "Modelled on" is what
Costello says; a named unit he doesn't name is **(inferred)**.

| Mode | Added | What Costello says it is / modelled on | Its character / what it's for (tooltip, then Valhalla) | What it means for our modes |
| --- | --- | --- | --- | --- |
| **Concert Hall** | 1.0.0, Dec 2012 (launch, one of 8) | "Based on the hall algorithms of the late 1970s and early 1980s." The 480L's Classic Cart Concert Hall "would be closest" (KVR, 2013). With Bright Hall, "the best showcases of these 'old school' artifacts" of noisy modulation | "slow attack, low initial echo density, chorused modulation, dark tone". "Huge spatial image, echo density that can be adjusted from very sparse to very dense, and lush chorusing modulation" | Our **Hall** (4.4, 6.4): a slow build and chorus. Its sparse-to-dense build is what our Hall's velvet "800 → 3000 /s" early energy imitates |
| **Bright Hall** | 1.0.0, Dec 2012 | "Similar to the Concert Hall algorithm, but with a brighter initial sound, and deeper and lusher modulation" | "slow attack, low initial echo density, lush chorused modulation, bright tone" | A brighter Hall preset, not a mode: our Decay EQ and Post EQ do it (**inferred**) |
| **Plate** | 1.0.0, Dec 2012 | "Inspired by early 1980s plate algorithms" | "fast and diffuse attack, bright tone, fast build of echo density, chorused modulation". "Highly diffuse, bright initial sound, high echo density, lush chorused modulation" | Our **Plate** (Dattorro's figure-eight, 6.5.1), chorus modulation as in 6.4 |
| **Room** | 1.0.0, Dec 2012 | "Emulates the sound of early 1980s room algorithms" | "fast grainy attack, sparser early echo density, darker tone, chorused modulation". "Medium diffusion/early echo density, somewhat darker sound" | Our **Room**. VintageVerb's is grainy and dark; ours aims cleaner (velvet early energy, 6.7) |
| **Chamber** | 1.0.0, Dec 2012 | "A transparent and dense algorithm." For "the other 480L presets", use Chamber (KVR, 2013) | "fast and diffuse attack, high echo density, low coloration, chorused modulation". "Less coloration than Plate/Room algorithms". MusicRadar's favourite: "beautifully smooth yet dense texture" | Our **Chamber** (6.4): dense, quick, no distinct echoes |
| **Random Space** | 1.0.0, Dec 2012 | "More diffusion than the late 1980s algorithms that inspired it." "Use Random Space for Random Hall presets" (the 480L's; KVR, 2013) | "slow diffuse attack, slower echo build, spacious, randomized delay modulation". "DEEP and WIDE… The modulation uses internal delay randomization, to reduce metallic artifacts without the pitch change that can occur in the algorithms with chorused modulation" | Our Random **Mod Shape** (4.3, 6.8), and later **Space** |
| **Chorus Space** | 1.0.0, Dec 2012 | "Same as Random Space, but with the delay randomization replaced with lush chorused modulation" | "slow diffuse attack, slower echo build, spacious, chorused modulation" | Our Chorus Mod Shape on a long network (Space, later). The "Deep Vocal space" factory preset uses it |
| **Ambience** | 1.0.0, Dec 2012; fixed in the release after 1.7.1 "to avoid 'echoes' that a few users reported" | "Combines time varying randomized early reflections with a full-featured reverb tail, with the balance between early and late reverb controlled by the Attack knob" | "dense randomized early reflections, diffuse reverb tail, random+chorused modulation". "Useful for adding 'air' to drums, vocals, and any place where a reverb should be felt but not heard". Don Gunn: "I use Ambience when I want the impression of the space without hearing the space" | Our **Ambience** (4.4, 6.4: velvet early energy is most of the sound). Its Attack as an early/late balance is what our Distance does across all modes |
| **Sanctuary** | 1.0.1, 2013 | "Inspired by a classic German digital reverberator from the 1970s" (the EMT 250: its factory presets are "EMT Snare Air", "EMT Long Hall", "EMT Huge Hall"…). "Incorporates the bit reduction and floating-point gain control used in the A/D and D/A convertors of the early digital hardware" | "fast attack w/discrete early reflections, high initial echo density, detuned modulation". Its Attack sets "the level of the early reflections… 0% = loudest early reflections. 100% = late reverb only". In a 2013 blind shoot-out on Gearspace, "the consensus was that Vee3 (only using Sanctuary) was the favourite" (its organiser, on KVR) | Our **1970s** era takes its gain-ranging converter (6.10). No EMT 250 mode is planned |
| **Dirty Hall** | 1.5.0, 2014 | "A fresh look at the Concert Hall algorithm, with the goal being to emulate the strange fixed point and convertor artifacts of early 1980s reverb hardware". "I tuned Dirty Hall and Dirty Plate modes using a classic 1984 reverberator" (the 224XL **(inferred)**). "The Dirty modes… are the ones that are most faithful to late 70s / early 80s digital hardware reverbs… a Lexicon 224XL and AMS RMX-16: floating point convertor quantization, steep lowpass antialiasing filters, fixed point quantization of the audio signal, and fixed point quantization of the modulation signals (the 224XL sounds like an old modem with high amounts of modulation)" | "slow attack, low initial echo density, lush chorused modulation, dark and dirty tone". "Lusher and denser than the Concert Hall algorithm, with loads of warmth and grit on tap". "The best reverb modes for adding depth and character to synthesizer sounds" | Our **1980s** and **1970s** eras on the Hall (6.10) are this: the dirt as an era, not a mode |
| **Dirty Plate** | 1.5.0, 2014 | "All the warm and gritty artifacts of Dirty Hall, applied to an old-school digital plate algorithm" | "fast diffuse attack, high initial echo density, lush chorused modulation, bright tone". "Just the right amount of metallic sheen. Drums come alive". Don Gunn: "for bigger, splashier sounds, to make snare hits sound explosive" | Our **Plate** in the 1980s era (Classic Plate preset, section 7) |
| **Smooth Plate** | 1.5.0, 2014 | "The complete opposite of Dirty Plate." "The Smooth modes are a modern update of the 'classic' Lexicon reverb algorithms. A great deal of attention was spent on having realistic & unobtrusive filtering, as well as shaping the reverb output taps for a natural exponential decay. The Smooth modes are the best reverb algorithms for 'expensive' sounding vocals and realistic rooms." "I added a tapered decay for a smooth, natural exponential response" | "fast diffuse attack, fairly dense initial echo density, **chorused** modulation, exponential decay". "Smooth decay at all settings, from short to near-eternal. Lush chorusing, with none of the metal found in Dirty Plate. The most transparent and naturalistic reverb in ValhallaVintageVerb" | Our **Smooth Plate**, the vocal default (4.4, 6.5.2). **Two differences**: VintageVerb's modulates by chorus, ours by a random walk (6.4: "Random, 0.5 Hz"); and its smoothness comes partly from **shaped output taps**, which 6.5.2 doesn't mention |
| **Smooth Room** | 1.5.0, 2014 | "A smooth and transparent room reverb, in the Smooth Plate style. Useful for emulating the Room/Hall algorithms of late 1980s hardware" | "fast diffuse attack, sparser early echo density, chorus modulation, exponential decay" | Our **Room** at low Distance, Now era (**inferred**) |
| **Smooth Random** | 1.5.0, 2014 | "A random room/hall algorithm… Randomized delay modulation, similar to Random Space, but with a much tighter initial attack and smoother decay. A good 'jack of all trades' reverb algorithm" | "fast diffuse attack, random modulation, exponential decay" | The model for our FDN modes with Random modulation (Room, Chamber in 6.4) |
| **Nonlin** | 1.5.0, 2014 | What it's modelled on: **not stated** (an AMS RMX16 "Non Lin 2" was asked for on KVR in 2013) | "variable slope set by attack, chorus modulation, no decay". Attack: "0% = exponential decay. 50% = flat (gated). 100% = inverse." Size sets the duration | Our later **Nonlin** (4.4, 6.4): its three envelopes on one knob are the design to copy |
| **Chaotic Hall** | 1.7.1, May 2017 | "What would 'old school' digital reverb algorithms sound like if they were made using tape delays?" "Fairly close to Dirty Hall in its basic structure, just with 'chaotic' elements": tape saturation and pre/de-emphasis, "tape modulation noise" for quantisation noise, and "a more 'chaotic' modulation source… closer to the wow/flutter/tape crinkle noise" for the random walk | "slow attack, low initial echo density, chorused and chaotic modulation, dark and dirty tone". "Subtle wow and flutter chorusing that adds depth without making your reverb seasick" | Nothing yet. A third Mod Shape ("Chaotic") is a cheap later option (**inferred**) |
| **Chaotic Chamber** | 1.7.1, May 2017 | "Closer to the Smooth algorithms, but with the 'digital' artifacts of the Smooth algorithms replaced with 'analog' artifacts… some unique signal dependent diffusion parameters, which results in a clearer sounding reverb tale" | "fast attack, sparser late echo density, chorused and chaotic modulation, exponential decay". "Use this algorithm on pretty much any input, and it will sound good". Five factory vocal presets use it | As above. Costello's finding matters for us: "the analog-style saturation reduces ringing in the tail, and the tape chorusing results in less random pitch shifts than the random walk modulation" |
| **Chaotic Neutral** | The release after 1.7.1, 2019 (version **not stated**) | "Combines chaotic modulation with a fairly 'colorless' algorithm architecture, for a reverb that sounds like the input – just with reverb!" | "medium attack, high initial echo density, balanced chaotic modulation, clean and neutral tone" | As above |
| **Cathedral** | 2.2.0, November 2021 | "An updated version of an FV-1 algorithm created by Sean Costello in 2014" | "medium attack, medium initial echo density, balanced ensemble modulation, clean and neutral tone". "Long, clear decays… and a realistic high frequency decay. Perfect for synths, vocals, and anything that needs a big open reverb" | Our later **Space** (4.4) |
| **Palace** | 3.0.0, January 2023 | "Loosely inspired by a digital 'room simulator' hardware reverb from the 1980s" (the Quantec QRS **(inferred)**: its "QResque 10m5 Room" presets match the "room simulator" whose Size Costello describes as "10 m3, 100 m3, 1000 m3, all the way up to… 1,000,000 m3"). "Higher echo density and lush modulation" added; "The 1980s room simulator hardware didn't have modulated delays. But Palace does!" | "room / large spaces simulator, sparse initial echo density, lush balanced modulation". "More realistic and open than the other room algorithms". "Turn up the Mod Depth… Or, leave Mod Depth at 0% for a realistic large hall". "Use a small Size setting in the Palace mode for drums, or use a huge Size for big vocal and synth reverbs" | Its "reverb from the back of the hall" setting (below) is what our **Distance** at high values aims for (4.2, 6.7) |
| **Chamber1979** | 4.0.0, 13 December 2023 | "Inspired by the Chamber algorithm in a renowned digital reverb from the late 1970s" (the Lexicon 224 **(inferred)**). Costello fixed its "seasick modulation" with ValhallaRoom's techniques, and its long minimum decay and metal with "publications by Jean-Marc Jot (including his early 90s PhD thesis)… I had never tried these techniques with nested allpass reverb algorithms… but they WORKED". Adds the 224's "aperture filter" in the 70s and 80s colours | "late 70s chamber algorithm. lower initial echo density, lush balanced modulation". "Lots of color and character. Great for very short room reverbs and ambiences, smooth vocal and acoustic chambers, and huge synth reverbs" | The precedent for Jot's absorption in our loops (6.6) and the aperture lift in our 1970s era (6.10) |
| **Hall1984** | 4.0.0, 13 December 2023 | The same Jot techniques applied to Concert Hall: "less metallic sound, and far greater control over the reverb time… I changed the modulation to be more distributed within the network". "To pay tribute to my favorite reverb hardware from the early 1980s" | "slow attack, low initial echo density, lush random modulation, bright initial tone". "Perfect for dark 70s digital halls, brighter 80s halls, and crystal clear modern reverbs" | Our **Hall** (6.5.3): Jot's absorption, modulation spread through the network. Costello: "I feel like these new reverb algorithms are the best ones yet in ValhallaVintageVerb" |

What Costello recommends, by mode family ("The MODES", 2023): the Dirty modes for "depth and character to
synthesizer sounds"; **the Smooth modes for "'expensive' sounding vocals and realistic rooms"**; the Chaotic
modes "for longer synth verbs that still sit well in the mix"; Palace "for any situation where you want to
add 'room' sound". On Valhalla's "best reverb for…" page: "VintageVerb, for example, is equally adept at short
vocal reverbs and huge ambient washes"; "the various Smooth algorithms are perfect for realistic acoustic
spaces".

#### 3.1.2 The Colors (eras)

| Color | Product page | Tooltip | Launch post (2012) |
| --- | --- | --- | --- |
| **1970s** | "Replicates the reduced bandwidth of the earliest digital reverberators (10 kHz maximum output frequency). Downsampled internally to reproduce the artifacts of running at a lower sampling rate. The modulation is dark and noisy and can produce strange and random sidebands with sustained notes. This is intentional." | "downsampled (10 KHz bandwidth), dark, noisier modulation" | "Dark (bandlimited), with lossy & noisy interpolation artifacts." |
| **1980s** | "Full bandwidth/sampling rate, for a brighter sound than the 1970s. The modulation is still dark and noisy but will produce different artifacts than the 1970s mode as it is running at the full sampling rate." | "no downsampling (full bandwidth), dark, noisier modulation" | "Brighter than 1970s mode, but with similar lossy & noisy interpolation artifacts." |
| **NOW** | "Full bandwidth/sampling rate. The modulation is clean and colorless, versus the funky artifacts of the 1970s/1980s modes." | "no downsampling (full bandwidth), bright, clean modulation" | "Bright, clean, and shiny." |

- **Palace is different**: "Setting COLOR to 70s results in an 8 kHz bandwidth, 80s to 15 kHz, and NOW to full
  bandwidth. The overall tonality is much brighter than most of the other VintageVerb algorithms at the same
  color settings, in order to match the 80s hardware."
- **Chamber1979 and Hall1984** add the 224's "aperture filter" in the 70s and 80s colours, "with the
  appropriate cutoff for each era" (the cutoffs: **not stated**). It "ends up adding some unexpected
  brightness to the reverb sound, even at low sampling rates".
- The GUI changes colour with the era; NOW has a Lightness / Darkness choice (from 1.7.1).
- Where the artefacts come from (Costello, "Algorithmic reverbs, distortion, and noise", edited January
  2013): "the modulation source in the older Lexicons had a lot more to do with the noise performance than I
  had originally thought. The modulation in my PCM70 is noisy as all get out… In the 1970s and 1980s modes, I
  make use of this noisy modulation, which can really be heard on long sustained synth notes going through
  longer reverbs."

**Against `reverb.md`**: our **1980s** era band-limits at 15 kHz (4.5, 6.10). VintageVerb's 1980s is "full
bandwidth" in every mode but Palace; the 15 kHz figure is Palace's (and the 224XL's). Its 1980s is noisy
modulation at full bandwidth. Either keep our 15 kHz and say it's Palace's, or make our 1980s full
bandwidth with the quantised, noisy modulation alone (**inferred**: a choice for Théo).

#### 3.1.3 The controls

Read from the 4.0.5 plugin (range, the default it reports to a host, and the value at 25 / 50 / 75 % of the
knob, which shows its taper). Tooltips word for word.

| Section | Control | Range | Default | Taper (25 / 50 / 75 %) | Tooltip |
| --- | --- | --- | --- | --- | --- |
| | **Mix** | 0 … 100 % | 100 % | linear | "MIX: controls the balance of the input signal with the reverb. Click on the mix label above the knob to lock or unlock the mix level" |
| | **Mix lock** | on / off | off | | "MIX lock: click to lock and unlock the mix knob." "the knob will fade in color when muted". (for FutureVerb's identical lock, Valhalla gives the reason: "very useful when browsing through presets, or for setting the mix to 100% on a send" (search excerpt)) |
| | **PreDelay** | 0 … 500 ms | 20 ms | 20 / 100 / 256 ms | "PREDELAY: sets the amount of delay before reverb". No tempo sync |
| | **Decay** | 0.20 … 70.00 s | 4.00 s | 0.86 / 7.00 / 26.75 s | "DECAY: sets the reverb decay time for mid frequencies" |
| DAMPING | **BassMult** | 0.25 … 4.00 × | 1.50 × | 0.40 / 1.00 / 2.17 × | "scales the reverb decay time for bass frequencies, relative to the DECAY parameter" |
| | **BassFreq** (parameter BassXover) | 100 Hz … 10 kHz | 300 Hz | 140 / 700 / 3190 Hz | "controls the transition frequency at which BassMult takes effect". 4.0.5 "Restored Damping BassFreq range to original 100 Hz – 10000 Hz specifications" |
| | **HighShelf** | −24 … 0 dB | −24 dB | linear (−18 / −12 / −6) | "controls the steepness of the high frequency damping filter in the reverb. -24 db provides the deepest high freq cut, while 0 dB bypasses the Damping HighFreq filter" |
| | **HighFreq** | 100 Hz … 20 kHz | 6000 Hz | 1850 / 6000 / 12110 Hz | "controls decay of high frequencies in the reverb" |
| SHAPE | **Size** | 0 … 100 % | 100 % | linear | "sets the relative room size of the reverb". One mode adds "a size value of 0% corresponds to the original 70s hardware" (which mode: **not stated**; Chamber1979 **(inferred)**) |
| | **Attack** | 0 … 100 % | 50 % | linear | "controls the initial attack of the reverb decay. Larger Attack percentage = longer attack time", with "can be used to adjust the perceived distance from the source within the reverb". Ambience: early/late balance ("0% = randomized early reflections only"); Sanctuary: early reflection level; Nonlin: the slope |
| DIFFUSION | **Early** | 0 … 100 % | 100 % | linear | "Early Diffusion: controls the initial echo density" |
| | **Late** | 0 … 100 % | 100 % | linear | "Late Diffusion: controls the rate at which echo density builds over time" |
| MODULATION | **Rate** | 0.10 … 10.00 Hz | 2.53 Hz | linear (2.57 / 5.05 / 7.52) | "controls the rate of modulation within the reverb" |
| | **Depth** | 0 … 100 % | 38 % | linear | "controls the amount of modulation within the reverb". "Things are scaled to a sensible millisecond range internally" (Costello, KVR 2012): the depth in ms per mode is **not stated** |
| EQ | **High Cut** | 100 Hz … 20 kHz | 8000 Hz | 1850 / 6000 / 12110 Hz | "controls high frequencies of reverb output" |
| | **Low Cut** | 10 Hz … 1.5 kHz | 10 Hz | linear (380 / 760 / 1130 Hz) | "controls low frequencies of reverb output" |
| | **Mode** | 22 modes | Concert Hall | | "mode: selects the reverb algorithm to use" |
| | **Color** | 1970s, 1980s, NOW | 1970s | | "era: selects the reverb algorithm to use" (sic) |

- **Not there**: no tempo-synced pre-delay, no ducking, no freeze, no width, no gate, no de-esser, no
  displays, no undo or A/B. Presets copy and paste "in a text format". The window resizes freely.
- **Filter slopes and shapes**: **not stated** for the cuts and the damping shelf.
- **How its controls map to the Lexicons** (Costello, KVR 2013): "Lexicon Diffusion = Vee3 Early Diffusion.
  The Vee3 Late Diffusion corresponds to what was called 'Definition' in some older Lexicons, although the
  Definition control worked backwards"; "Mod Rate = Spin, measured in Hz; Mod Depth = Wander, but measured in
  percentage instead of milliseconds"; for Attack, "multiplying the Lexicon Spread value by 0.39"; and the
  Lexicons' RT HiCut is the Damping HighFreq. He warns "the older Lexicon stuff had a very loose relationship
  between the displayed and actual decay times".
- MusicRadar (2013): Attack "determines how long it takes for the reverb to kick in, functioning thus in all
  modes except Ambience and Sanctuary". Its one complaint: "No offline manual."

**Against `reverb.md` 4.2–4.3**: our ranges sit inside VintageVerb's except **Mod Rate** (ours 0.05 … 5 Hz,
default 0.5 Hz; its 0.1 … 10 Hz, default 2.53 Hz, and its vocal presets run 0.5 … 3 Hz: see 3.1.5). Its
damping is a **shelf depth at a frequency** (−24 … 0 dB at 100 Hz … 20 kHz) on top of Decay and BassMult;
ours is a Decay EQ in seconds (6.6), closer to Pro-R 2's. Its **Attack** knob (the build) has no twin on our
main row; our Distance (4.2) and the Shape display (4.6) carry it.

#### 3.1.4 How the modes work, from what Costello has published

- **Diffusion and vocals** (2010): series all-passes "can sound similar to comb filters… A periodic series of
  pulses will cause the filters to 'ring out.' Unfortunately for reverb designers, a periodic series of
  pulses is a great description of a vocal waveform… a setting that sounds good for drums might sound far too
  metallic for vocals." Turning the all-passes' coefficients down "may also result in a slightly grainy echo
  sound on sibilants, but for the most part the sound of the reverberator on vocals will be improved". His
  VintageVerb advice: "adjust the Diffusion until the time response on sibilance is smooth (i.e. without
  obvious echo patterns), and then bring the Diffusion down just a touch to reduce coloration."
- **Size** ("Reverb 101: Size", 2018): Size scales "some/all of the delay lengths"; bigger gives "a slower
  attack", "less metallic decays", "more discrete echoes in the initial part of the decay. This can sound
  grainy when processing sources with strong transients, such as percussion or vocal sibilants", and less
  obvious modulation. "For a richer reverb sound, set the Size as big as you can get away with, until either
  the attack is too slow or you start hearing objectionable grain"; "For sounds that have slow attacks
  without prominent transients (such as pads, orchestral, some vocals), feel free to crank the Size way up";
  for a really short decay, turn Size down "so that you have maximum echo density during the audible part".
- **The Smooth modes**: shaped output taps "for a natural exponential decay" and "realistic & unobtrusive
  filtering"; "a tapered decay". Chaotic Chamber is "closer to the Smooth algorithms".
- **Random against chorus modulation**: Random Space's "internal delay randomization, to reduce metallic
  artifacts without the pitch change that can occur in the algorithms with chorused modulation". But the
  Chaotic modes' "tape chorusing results in less random pitch shifts than the random walk modulation used in
  the other modes", and in Chamber1979 he removed the original's "seasick modulation" with ValhallaRoom's
  techniques for "less random pitch shifts". So a random walk isn't automatically the gentlest (**inferred**:
  test 10's pitch-spread bound should cover our Random shape too).
- **Saturation in the loop** (Chaotic modes): "adding chaos to these algorithms resulted in more clarity and
  transparency in many cases… the analog-style saturation reduces ringing in the tail".
- **Jot in a Lexicon loop** (4.0.0): nested all-pass loops with Jot's decay techniques got "short decay
  times" and "sounded much less metallic"; in Hall1984, "far greater control over the reverb time". This is
  the precedent `reverb.md` 6.6 cites.
- **The old hardware's dirt** (2011/2013): the 224 had "a 16-bit word size, and a 20-bit saturating
  accumulator… about 24 dB of headroom"; its "quirky multiplier" quantised the interpolation "to fairly big
  subsample chunks (I think it was 32 or 64 chunks per sample)", "a 'halo' of noise"; clipping in the nodes
  gives "a somewhat higher noise floor" rather than runaway. "At Valhalla DSP, our philosophy is that a little
  noise isn't necessarily a bad thing… The high frequency attenuation of linear interpolation can result in a
  far less 'glassy' high end than modern high fidelity interpolation techniques."
- **Palace's controls**: "An Early Diff value of 40% corresponds to the early 80s hardware"; "Set Late
  Diffusion to 0% to obtain that authentic 'reflection off the back of the concert hall' sound… I like to keep
  this at 50% or lower for the smoothest sound with the least coloration"; "keeping Attack at 0% is
  recommended for emulating the 1980s room simulator". The QResque presets (4.0.0): "Early Diffusion is set to
  50%, the Late Diffusion to 0%, and the Attack to 100%. This replicates the 'reverb from the back of the hall'
  sound, which pushes the reverb back behind the sound source."
- **How he tunes**: "I tune all the Valhalla plugins playing one or more analog synths as a live interactive
  sound source, along with the standard recordings of drums / vocals / piano / etc."

#### 3.1.5 Its factory presets for vocals

Every preset in the 4.0.5 installer with "Vocal", "Vox" or "Voc" in its name: 36 of 213 (folders: Factory by
type, and Designer presets by Don Gunn and Eric Beam). Values as the 4.0.5 plugin reads them (Mix is 100 % in
all). "Ver." is the version the preset was saved in. Don Gunn's prefixes name the mode (SP Smooth Plate, DH
Dirty Hall, SRand Smooth Random, NL Nonlin).

| Preset | Mode | Color | Decay | PreDelay | Size | Attack | BassMult @ Freq | HighShelf @ HighFreq | Early / Late Diff. | Mod Rate, Depth | Low / High Cut |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Don Gunn: SP-Pop Vocal | Smooth Plate | 1980s | 1.80 s | 23 ms | 70 % | 55 % | 1.25 × @ 1820 Hz | −13 dB @ 5400 Hz | 80 / 60 % | 2.53 Hz, 60 % | 70 Hz / 4050 Hz |
| Don Gunn: SP-Wide Lead Vocal | Smooth Plate | 1980s | 2.25 s | 23 ms | 70 % | 80 % | 1.25 × @ 550 Hz | −11 dB @ 5600 Hz | 60 / 80 % | 2.53 Hz, 60 % | 70 Hz / 6200 Hz |
| Don Gunn: SP-Amazing Vocal | Smooth Plate | 1980s | 3.80 s | 31 ms | 100 % | 55 % | 1.50 × @ 510 Hz | −12 dB @ 6300 Hz | 100 / 100 % | 3.00 Hz, 65 % | 70 Hz / 5800 Hz |
| Don Gunn: SP-Short Vocal Plate | Smooth Plate | 1980s | 0.70 s | 7 ms | 50 % | 40 % | 1.50 × @ 400 Hz | −12 dB @ 6300 Hz | 100 / 80 % | 1.80 Hz, 40 % | 70 Hz / 5800 Hz |
| Don Gunn: DH-Small Vocal Hall | Dirty Hall | 1970s | 0.75 s | 13 ms | 100 % | 25 % | 1.50 × @ 1820 Hz | −12 dB @ 6300 Hz | 100 / 100 % | 2.80 Hz, 60 % | 60 Hz / 6300 Hz |
| Don Gunn: DH-Delayed Vocal | Dirty Hall | 1980s | 2.60 s | 29 ms | 80 % | 60 % | 1.50 × @ 1820 Hz | −12 dB @ 6300 Hz | 40 / 60 % | 2.80 Hz, 75 % | 60 Hz / 6300 Hz |
| Don Gunn: SRand-Dark Wide Vox | Smooth Random | 1970s | 2.60 s | 17 ms | 0 % | 60 % | 1.25 × @ 550 Hz | −12 dB @ 6300 Hz | 50 / 100 % | 1.81 Hz, 82 % | 70 Hz / 6460 Hz |
| Don Gunn: NL-Vocal Width | Nonlin | 1980s | 0.20 s | 10 ms | 60 % | 18 % | 1.25 × @ 400 Hz | −12 dB @ 6300 Hz | 0 / 0 % | 1.81 Hz, 47 % | 70 Hz / 4630 Hz |
| Plates: Vocal Plate | Plate | NOW | 0.71 s | 20 ms | 44 % | 20 % | 1.00 × @ 7560 Hz | −12 dB @ 5500 Hz | 19 / 100 % | 1.80 Hz, 19 % | off / 20 kHz |
| Plates: Vox Plate | Plate | NOW | 1.19 s | 0 ms | 67 % | 14 % | 1.20 × @ 420 Hz | −24 dB @ 4800 Hz | 58 / 100 % | 1.01 Hz, 19 % | off / 12 kHz |
| Halls: Vocal Hall | Concert Hall | NOW | 2.17 s | 8 ms | 100 % | 10 % | 2.00 × @ 700 Hz | −10 dB @ 6000 Hz | 100 / 100 % | 2.25 Hz, 23 % | 50 Hz / 7000 Hz |
| Halls: Small Vocal Hall | Concert Hall | 1980s | 1.15 s | 23 ms | 50 % | 18 % | 1.40 × @ 430 Hz | −24 dB @ 4000 Hz | 49 / 100 % | 0.46 Hz, 100 % | 90 Hz / 4000 Hz |
| Halls: Deep Vocal space | Chorus Space | 1980s | 1.95 s | 23 ms | 68 % | 30 % | 1.40 × @ 430 Hz | −24 dB @ 4000 Hz | 100 / 50 % | 0.46 Hz, 82 % | 90 Hz / 4000 Hz |
| Halls: 84 Ballad Vocal | Hall1984 | 1980s | 2.10 s | 29 ms | 50 % | 53 % | 1.00 × @ 400 Hz | −12 dB @ 7000 Hz | 100 / 81 % | 0.58 Hz, 78 % | 210 Hz / 5300 Hz |
| Halls: 84 Lush Vocal | Hall1984 | 1980s | 2.19 s | 31 ms | 50 % | 100 % | 1.50 × @ 590 Hz | −24 dB @ 6000 Hz | 100 / 100 % | 0.64 Hz, 68 % | 260 Hz / 8000 Hz |
| Halls: 84 Smooth Vox Hall | Hall1984 | 1970s | 3.80 s | 0 ms | 100 % | 45 % | 0.35 × @ 920 Hz | −24 dB @ 10.9 kHz | 72 / 100 % | 0.79 Hz, 50 % | off / 10.9 kHz |
| Rooms: Dark Vocal Room | Room | 1970s | 1.60 s | 9 ms | 50 % | 19 % | 1.00 × @ 400 Hz | −12 dB @ 8000 Hz | 49 / 80 % | 0.80 Hz, 0 % | off / 15 kHz |
| Rooms: Short Vocal Ambience | Ambience | NOW | 0.60 s | 23 ms | 15 % | 10 % | 1.00 × @ 400 Hz | −24 dB @ 6000 Hz | 70 / 100 % | 0.80 Hz, 100 % | off / 3000 Hz |
| Chambers: Live Vox Chamber | Chamber | 1980s | 0.78 s | 0 ms | 70 % | 19 % | 1.50 × @ 250 Hz | −24 dB @ 4500 Hz | 30 / 80 % | 0.32 Hz, 36 % | 330 Hz / 15 kHz |
| Chambers: 79 Vocal Chamber | Chamber1979 | 1970s | 3.00 s | 0 ms | 100 % | 0 % | 1.50 × @ 300 Hz | −24 dB @ 6000 Hz | 100 / 100 % | 0.54 Hz, 50 % | off / 20 kHz |
| Chambers: 79 Vocal EchoVerb | Chamber1979 | 1980s | 2.19 s | 31 ms | 100 % | 100 % | 1.50 × @ 590 Hz | −24 dB @ 6000 Hz | 0 / 0 % | 0.54 Hz, 68 % | 260 Hz / 8000 Hz |
| Chaotic: CC-Small Vox Chamber | Chaotic Chamber | 1970s | 0.98 s | 23 ms | 68 % | 36 % | 1.25 × @ 550 Hz | −15.6 dB @ 6000 Hz | 70 / 50 % | 2.53 Hz, 71 % | 450 Hz / 5300 Hz |
| Chaotic: CC-Short Vocal Chamber | Chaotic Chamber | 1980s | 1.60 s | 17 ms | 82 % | 30 % | 1.47 × @ 500 Hz | −17.2 dB @ 5430 Hz | 100 / 100 % | 1.61 Hz, 76 % | 350 Hz / 3760 Hz |
| Chaotic: CC-Spacious Vocal | Chaotic Chamber | 1970s | 2.13 s | 31 ms | 55 % | 80 % | 1.20 × @ 580 Hz | −18 dB @ 6230 Hz | 45 / 60 % | 2.72 Hz, 70 % | 600 Hz / 10 kHz |
| Chaotic: CC-Tiny Meat Vocal | Chaotic Chamber | 1980s | 0.70 s | 6 ms | 100 % | 100 % | 1.20 × @ 580 Hz | −18 dB @ 6230 Hz | 35 / 10 % | 2.33 Hz, 57 % | 310 Hz / 4250 Hz |
| Chaotic: CC-Large Bright Chamber Vocal | Chaotic Chamber | 1980s | 2.80 s | 69 ms | 24 % | 59 % | 1.50 × @ 4760 Hz | −24 dB @ 6830 Hz | 100 / 100 % | 1.99 Hz, 85 % | 350 Hz / 5600 Hz |
| Chaotic: CH-Short Dense Vocal Hall | Chaotic Hall | 1970s | 1.50 s | 23 ms | 73 % | 0 % | 2.00 × @ 1110 Hz | −13 dB @ 6800 Hz | 100 / 100 % | 1.99 Hz, 75 % | 480 Hz / 10 kHz |
| Chaotic: CH-UberWide Long Vocal | Chaotic Hall | 1980s | 3.20 s | 31 ms | 58 % | 80 % | 2.11 × @ 2750 Hz | −24 dB @ 5100 Hz | 49 / 36 % | 1.99 Hz, 59 % | 670 Hz / 4970 Hz |
| Chaotic: CN-Vocal Chamber | Chaotic Neutral | NOW | 1.20 s | 20 ms | 45 % | 30 % | 1.30 × @ 400 Hz | −24 dB @ 6000 Hz | 70 / 80 % | 0.90 Hz, 33 % | 80 Hz / 5100 Hz |
| Cathedral: CathedralVocalChamber | Cathedral | 1980s | 5.00 s | 15 ms | 60 % | 100 % | 1.58 × @ 200 Hz | −12 dB @ 1500 Hz | 100 / 100 % | 0.90 Hz, 0 % | 600 Hz / 10 kHz |
| Palace: PALACE-Short Vocal | Palace | 1970s | 0.68 s | 57 ms | 51 % | 38 % | 0.80 × @ 470 Hz | −16 dB @ 6000 Hz | 82 / 100 % | 1.09 Hz, 76 % | 220 Hz / 6060 Hz |
| Palace: PALACE-Air Vocal | Palace | 1970s | 6.55 s | 54 ms | 100 % | 34 % | 0.97 × @ 470 Hz | −24 dB @ 6000 Hz | 60 / 100 % | 2.43 Hz, 70 % | 790 Hz / 6290 Hz |
| Palace: QResque 10m4 Vocal | Palace | 1970s | 2.00 s | 0 ms | 46 % | 100 % | 0.50 × @ 300 Hz | 0 dB (off) | 50 / 0 % | 0.10 Hz, 0 % | off / 20 kHz |
| Sanctuary: Vocal Air | Sanctuary | 1980s | 1.30 s | 13 ms | 100 % | 22 % | 1.00 × @ 550 Hz | −12 dB @ 7500 Hz | 75 / 0 % | 1.50 Hz, 81 % | 70 Hz / 6000 Hz |
| Sanctuary: Vocal Spread | Sanctuary | 1970s | 0.40 s | 9 ms | 100 % | 39 % | 1.00 × @ 550 Hz | −24 dB @ 20 kHz | 100 / 0 % | 2.57 Hz, 53 % | 70 Hz / 20 kHz |
| Sanctuary: Spacious Vocal | Sanctuary | 1980s | 2.30 s | 17 ms | 0 % | 1 % | 1.20 × @ 550 Hz | −12 dB @ 6500 Hz | 100 / 0 % | 2.57 Hz, 60 % | 120 Hz / 6610 Hz |

What they add up to **(inferred, from the table)**:

- **Decay**: 0.6 … 3.8 s; the lead-vocal plates 0.7 … 2.25 s.
- **Pre-delay is short**: 0 … 31 ms in 33 of 36 (only Palace's and one Chaotic Chamber go to 54 … 69 ms).
  `reverb.md` 7's vocal default is 62 ms (1/32 at 120 BPM).
- **The top is cut hard, twice**: High Cut at 4 … 7 kHz in most (only the NOW plates and a few others open
  to 10 … 20 kHz), *and* the damping shelf at −12 … −24 dB from about 6 kHz in the loop. `reverb.md` 7 cuts
  at 8 … 16 kHz. With a 1970s or 1980s Color on top, these reverbs are dark.
- **Low Cut** 60 … 90 Hz in Don Gunn's, 200 … 800 Hz in the newer factory ones (and 600 Hz in Cathedral's
  and CC-Spacious Vocal, the Abbey Road figure).
- **Modulation is faster than ours**: Don Gunn's vocal presets run 1.8 … 3.0 Hz at 40 … 82 %, the Hall1984
  and Chamber1979 ones 0.5 … 0.9 Hz. `reverb.md` 4.2 defaults to 0.5 Hz and tops out at 5 Hz.
- **Colour**: 1980s in 19, 1970s in 12, NOW in 5. The vintage eras are the norm on vocals.
- **Diffusion**: Early at 100 % in most; Late often 100 %, but 0 % in Sanctuary and the "EchoVerb" and
  QResque ones (discrete echoes on purpose).

#### 3.1.6 What reviewers and users say, on vocals

- **Engineers**: the most-named vocal reverb in `reverb.md` 1.1 (Olivia Rodrigo's three VintageVerb auxes,
  Chris Brown's *Indigo*, SZA's "Kill Bill", Matt Schaeffer, Adam Thein). Patrizio "Teezio" Pigliapoco: "They
  are really cheap reverbs, but I love them."
- **MusicRadar / Computer Music** (2013, 9 modes then): "Another cracking plugin… a great Lexicon-style
  wingman to ValhallaRoom." "VintageVerb begs to have that top end opened up, letting its gorgeous, airy highs
  wash over you, never sounding harsh or abrasive." But: "Subtlety isn't its strong point, as even its
  shortest reverbs really leave their mark in the mix". Against: "No offline manual. Not a reverb for every
  occasion."
- **Musician Wave** (v2.0.2, **secondary**): "even in its default setting provides a silky, lush ambiance
  that fits like a glove in a mix"; "I don't find this reverb being particularly effective at being subtle.
  I gravitate towards it for ambient, warm vocals or lush sounding strings in a slow ballad, but it might not
  be my first choice for an upfront pop vocal in a dance track (Valhalla's own Plate reverb excels at that,
  however)."
- **Quoted on Valhalla's page**: "The best $50 I've ever spent in my musical life" (Equipboard); "This is
  always the first reverb I use in a project. For just about everything" (Get That Pro Sound).
- **A KVR user** on Chaotic Hall (2017): "I just opened an existing mix that has VVV with the old Hall
  algorithm on the main reverb bus… and switched it to chaotic hall without any other changes. I like what I'm
  hearing a lot".
- Gearspace's and Reddit's threads refused automated reading: **not read**.

**What this means for ours (inferred)**: the one recurring reservation is that VintageVerb is lush rather
than subtle, "not my first choice for an upfront pop vocal". Our Distance, ducking and de-esser (4.2, 6.11)
are aimed at exactly that gap; the Smooth Plate default must be able to sit *behind* a dry pop vocal, which
the ducking test (14) and a listening check should both cover.


### 3.2 FabFilter Pro-R 2, control by control

**What it is.** FabFilter's algorithmic reverb. Pro-R came out in 2016 (MusicTech), Pro-R 2 on 2 November 2023
("a transformative update"), 2.01 the next day "to fix a crash when selecting a presets on mono tracks"; the
current installer is 2.06. $169 / £144 at launch (MusicRadar). Its aim, in the manual: "a high-quality
algorithmic reverb should sound natural or vintage, has enough density and still sits in the mix perfectly
without causing undesirable coloration or phase problems. At the same time, it should not confuse you with
over-technical controls and too many options". The product page: "user-friendly, non-technical controls like
Brightness, Character and Distance… without requiring a degree in reverb science." How it works inside:
**not stated** (FabFilter publishes no DSP).

New in 2 (the manual's list): Dolby Atmos up to 9.1.6 with surround cross-feeding; the **Vintage** and
**Plate** algorithms; **Ducking**; **Thickness** ("density and saturation"); **IR import**; **Auto Gate**;
Speakers options for the EQ bands; mid/side and L/R on the Post EQ; **Freeze**; a preset browser with tags
and favourites; output metering; a piano display; and the Decay Rate knob widened "to go from 25% to 400%".

The ranges and defaults below are the plug-in's own, read from the 2.06 trial in a host as for VintageVerb
(141 parameters; the trial was run with a temporary home folder, and the preference files it still wrote
were removed). The default is FabFilter's "Default Setting" preset, which loads with each new instance.
Quotes are the manual's unless marked "help" (the interactive help hints in the plug-in).

![FabFilter Pro-R 2, which Théo uses](img/pro-r-2-interface.jpg)

#### 3.2.1 The main controls

| Control | Range | Default | Taper (25 / 50 / 75 %) | What FabFilter says it does |
| --- | --- | --- | --- | --- |
| **Space** | 200 ms … 10 s | 2.5 s | 1.0 / 2.5 / 4.6 s | "Smartly and smoothly combines the room model and decay time of the reverb, ranging from a very small ambience space (200 ms) to a cathedral-like ten-second reverb… choose from over a dozen carefully designed room models and seamlessly vary between them, without hearing clicks or unwanted artifacts." The yellow label shows the final decay time. Room icons round the knob are shortcuts. (SOS counted "12 room models"; the product page says "dozens") |
| **Decay Rate** | 25 … 400 % | 100 % | 50 / 100 / 200 % (log) | "Adjust the reverb decay from 25% to 400% of the decay that corresponds to the current Space setting." Help: it tweaks "the decay time without altering the room sound". (The manual's feature list still says "from 50% to 200%", Pro-R 1's range) |
| **Style** | Modern, Vintage, Plate | Modern | | **Modern**: "the original Pro-R version 1 style, which is the best style to create very natural, realistic sounding spaces". **Vintage**: "Based on the sound and character of the early digital reverbs. It excels in the large spaces and longer decay times, bringing lots of character and beautiful shimmer"; help: "a very different topology, recreating the warm and lush sound of the early digital reverb classics"; product page: "classic digital reverb units of the '80s and '90s". **Plate**: "Replicates the sound of vintage plate reverbs, with quite a fast build up and a pleasant metallic vibe" |
| **Predelay** | 0 … 500 ms | 0.6 ms (practically none) | 10 / 50 / 190 ms | "Moving the reverb tail away from a vocal can highly improve the clarity and transparency of a mix… Higher predelay settings tend to increase the perceived room size. Increasing predelay instead of the overall decay time can work well in achieving a less intrusive, more natural reverb" |
| **Predelay Sync** | Free, 1/4, 1/8, 1/16, 1/32 note | Free | | Synchronises to the host tempo; the knob then becomes **Predelay Offset** |
| **Predelay Offset** | 50 … 200 % | 100 % | | "Scale the predelay from 50% to 200% of the synchronized time. This way, you can easily achieve dotted (150%) or triplet (67%) effects" |
| **Character** | 0 … 100 % | 30 % | linear | "At 0%, the reverb is as transparent and predictable as possible. Turning the knob up to 50% gradually introduces some modulation and more pronounced early reflections together with subtle yet noticeable late echoes. From 50% and up, the reverb begins modulating more and more, up to a chorus-like effect at 100% which works well on vocals and synths." (Pro-R 1 labelled it Clean, Lively, Chorus: SOS) |
| **Thickness** | −100 … +100 % | 0 % | linear | "An intuitive combination of density and saturation. Turning it up will make the reverb more dense, but will also introduce subtle non-linearities and dynamics to the sound. Turning it down will result in a more airy, sparse reverb. Note: The audible effect can vary quite a lot depending on the program material." Product page: "adds saturation and compression" |
| **Distance** | 0 … 100 % | 50 % | linear | "At 0%, the reverb sounds as if you are quite close to the sound source, with more pronounced and brighter early reflections. Increasing the Distance sounds like walking away from the sound source in the current space, resulting in a longer build-up and a more diffuse tail" |
| **Brightness** | −100 … +100 % | 0 % | linear | "Adjusts the clarity and high/low frequency balance of the reverb. Lower Brightness values correspond to spaces with more high-frequency absorption… The average room or hall has a pretty dark reverb sound. Therefore, turning down the Brightness a bit often gives you a more natural and realistic sounding reverb." Its intro: "affecting not only overall brightness, but also the decay of high frequencies" |
| **Stereo Width** | 0 … 120 % | 70 % | linear | "Does not just mix the output signal to mono, but also controls internal stereo linking and channel cross-feeding… At 50%, channel cross-feeding is at its maximum… up to a 100% where channels operate completely independent (i.e. multi-mono). Above 100%, the side signal is amplified". Help: "full mono (0%) via true stereo (50%) to multi-mono (100%) and extended stereo (120%)" |
| **Ducking** | 0 … 48 dB | 0 dB (off) | linear | "Sets the range of the integrated, intelligent ducking feature. It's a fast and easy way to get better separation between wet and dry signals, especially for vocals. Ducking triggers on the input signal of the plug-in." Its threshold, attack and release are **not the user's** (no such parameter among the 141) and **not stated** |
| **Auto Gate** | 0 … 999 ms hold, on/off; Sync Free, 1/4 … 1/32 with an Offset 50 … 200 % | 250 ms, off | | "The intelligent algorithm has automatic threshold and attack/release settings, tuned to work perfectly when applied to separate drum sounds. Be creative and do try auto gate on other program material as well" |
| **Freeze** | on / off; click and hold freezes while held | off | | "'Eternal' decay, reusing only the existing contents of the 'reverb tank'". "Distance and Thickness, won't affect the sound anymore since they are mainly applied to the input of the reverb. Others, like Character, Brightness, Ducking and Auto Gate, can still be adjusted." (The help hint lists Brightness among those that stop working: the two disagree) |
| **Mix** | 0 … 100 % | 22.5 % | linear | "If you are using Pro-R 2 as a send effect, you should set it to 100%" |
| **Lock Mix** | on / off | off | | "Locks the mix setting to its current value while loading presets… When locked, you can still manually change the mix or automate it… If you change the Lock Mix setting, new Pro-R 2 instances will automatically pick up the new setting" |
| **Input / Output** | level −∞ … +36 dB, pan ±1 | 0 dB, centre | | Input before processing ("does not affect the dry signal", help); Output after the mix. Global Bypass "applies soft bypassing to avoid clicks" |

Knobs: drag ("reacts to the speed"), mouse wheel, double-click to type ("1k", "A4", "2x" = +6 dB, "50%"),
Cmd-click to reset, Shift for fine, Alt-drag for linked pairs. The product page adds "Smart Parameter
Interpolation for smooth parameter transitions".

#### 3.2.2 The Decay Rate EQ

"Many traditional algorithmic reverbs offer a low/high crossover system… FabFilter Pro-R 2 takes this concept
to the next level". The blue curve shapes the decay time across frequency, relative to Space × Decay Rate.

| Setting | Range / choices | Default |
| --- | --- | --- |
| Bands | up to 6 | the Default Setting has two: a Low Shelf at 15 Hz, 75 %, and a wide Bell (Q 0.25) at 2.2 kHz, 77 % |
| Shape | Bell, Low Shelf, High Shelf, Notch | Bell |
| Frequency | 10 Hz … 30 kHz | 1 kHz (a new band) |
| Rate | **12.5 … 200 %** per band | 100 % |
| Q | 0.05 … 20 (shelves 0.05 … 1) | 1.0 |
| Speakers | surround only: which speakers it affects | All (excl. LFE) |

- Gestures, as Pro-Q's: drag the curve to make a band (a shelf at the far left or right); double-click or
  Cmd-click low in the display for a notch; wheel for Q; Alt to constrain; Alt-click to bypass a band;
  Cmd-Alt-click to change its shape; multiple selected bands' rates scale "relative to each other".
- What it's for, in reviewers' words: "if a preset is sounding a little muddy on your source, gently 'dipping'
  the decay time in the low mid-range can add clarity… you could notch out sibilant frequencies in a vocal
  reverb" (SOS, Pro-R 1). MusicRadar (Pro-R 1): "we wish there was a global bypass button for it". SOS: "it
  would perhaps be useful to be able to save presets for it independently".
- **Against `reverb.md`**: 1.4 gives the Decay Rate EQ as "six bands, 25–400 %". The bands go **12.5 …
  200 %**; 25 … 400 % is the Decay Rate knob. Combined, a frequency can last 3 % … 800 % of Space's time
  **(inferred)**. Our Decay EQ (6.6) in real seconds against the mode's natural curve is a different
  scale; worth saying so in 4.6.

#### 3.2.3 The Post EQ

"Using up to six EQ bands, you can freely equalize the final reverb sound. The reverb gain is automatically
adjusted to compensate for EQ changes, so you don't have to manually adjust the Mix setting or the send
level".

| Setting | Range / choices | Default |
| --- | --- | --- |
| Bands | up to 6 | none in the Default Setting |
| Shape | Bell, Low Shelf, Low Cut, High Shelf, High Cut | Bell |
| Frequency | 10 Hz … 30 kHz | 2 kHz |
| Gain | −30 … +30 dB | |
| Q | 0.025 … 40 | 2.0 |
| Slope (cuts) | 6, 12, 24, 48, 96 dB/oct | 12 dB/oct |
| Stereo Placement | Left, Right, Stereo, Mid, Side | Stereo |
| Display range | ±9, ±18, ±30 dB (Post EQ only) | ±18 dB |

FabFilter's own advice for the post filter on vocals (its Learn pages): "For vocals it's not uncommon to place
the cut-off frequency (LPF) as low as 2 kHz, since harsh 'S' sounds are often not very flattering with the
sound of a reverb."

#### 3.2.4 The display, IR import, surround, the rest

- **Spectrum analyzer**: "The thin white line shows the real-time output spectrum… Behind the white line, soft
  yellow curves appear that fall off and fade in relation to the current reverb time, which might of course
  vary at different parts of the spectrum." Modes: Reverb+Post (default), Pre+Post, Off. An output level
  meter at the right. An optional **piano display** (88 keys): click a band's dot to snap it to a note.
- **IR import**: WAV or AIFF, from the preset browser or by dropping a file. Pro-R "converts it to Decay Rate
  EQ, Post EQ and main control settings. The reverb style will always be set to Modern". "The results will
  never match perfectly, but will certainly be 'ballpark'". Transient responses only, not sine sweeps.
  MusicTech: "we find the results a little mixed when it comes to accuracy… some examples that were quite far
  off". The factory "Sweet Chamber" was "Imported from an EMT244 impulse and slightly further tweak".
- **Surround and Atmos**: up to 9.1.6; a Tilt slider per main control ("more at the front, less at the
  back"); LFE (default −∞: dry), Center and Top wet levels (0 dB); Cross Feed 0 … 200 % (default 100 %).
- **MIDI Learn**, **Undo / Redo**, **A/B** with **Copy**; the window in Medium, Large, Extra Large or full
  screen.
- **Presets**: "conveniently ordered in folders based on room size". The 2.06 installer has 274: Ambience
  (39), Small (55), Medium (59), Large (68), Very Large (25), Gated (11), Tempo Synced (15), plus Basic and
  Default Setting. 95 are Pro-R 2 presets by the sound designer "bManic", with a description and tags; the
  rest are Pro-R 1's, which "sound 99% the same". 55 are tagged Vocals. The name dims once edited; MIDI
  program changes can load them; Lock Mix keeps the mix.

#### 3.2.5 Its factory presets for vocals

Every preset with "Vocal" in its name, then the Pro-R 2 presets whose description recommends them for
vocals. "Decay" is Space × Decay Rate (what the yellow label shows). Pro-R 1 presets (v1) are a binary
format: they were decoded field by field, the layout checked against the Tempo Synced presets' names and
against the same values in the Pro-R 2 ones **(inferred mapping; Thickness, Ducking and Style don't exist
in them)**. Decay EQ: LS / HS shelves, Bell, Notch, with the band's rate. Post EQ: LC / HC cuts with slopes,
(M) / (S) mid or side only.

| Preset | Fmt | Style | Decay | Predelay | Dist. | Bright. | Char. | Thick. | Width | Duck | Mix | Decay Rate EQ | Post EQ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ambience / Vocal Reflections | v1 | Modern | 0.16 s | 0 ms | 64 % | −42 % | 0 % | — | 47 % | — | 25 % | LS 92 Hz 21 %; Bell 149 Hz 118 %; HS 7.2 kHz 12 % | LC 141 Hz 12 dB; Bell 823 Hz −4.9 dB; HC 9.8 kHz 12 dB; Bell 6.6 kHz +5.5 dB; Bell 123 Hz +4.1 dB |
| Ambience / Vocal Reflections Rich | v1 | Modern | 0.13 s | 4 ms | 80 % | +22 % | 1 % | — | 61 % | — | 32 % | Bell 8.1 kHz 40 % | LC 168 Hz 12 dB; HC 10.6 kHz 12 dB |
| Ambience / Vocal Reflections Warm | v1 | Modern | 0.13 s | 4 ms | 53 % | −42 % | 1 % | — | 61 % | — | 29 % | LS 361 Hz 167 %; HS 2.8 kHz 15 % | LS 149 Hz −6.3 dB; Bell 526 Hz −3.5 dB; LC 28 Hz 24 dB |
| Ambience / Vocal Backings Bright | v1 | Modern | 0.12 s | 0 ms | 85 % | −6 % | 73 % | — | 47 % | — | 50 % | LS 64 Hz 21 %; Bell 4.9 kHz 141 %; Notch 7.6 kHz 17 % | LC 141 Hz 12 dB; Bell 2.2 kHz −5.6 dB; Bell 8.8 kHz +3.5 dB; Bell 123 Hz +4.1 dB |
| Small / Vocal Clear Space | v1 | Modern | 0.93 s | 12 ms | 83 % | −43 % | 0 % | — | 45 % | — | 28 % | Bell 8.7 kHz 57 %; LS 417 Hz 52 %; Bell 2.6 kHz 60 % | LC 168 Hz 12 dB; HC 11.7 kHz 12 dB; Bell 3.9 kHz +1.8 dB; Bell 1.3 kHz −5.8 dB |
| Small / Vocal Gloss | v1 | Modern | 0.70 s | 9 ms | 86 % | −100 % | 32 % | — | 70 % | — | 26 % | HS 4.3 kHz 200 %; Bell 7.8 kHz 39 % | HS 6.1 kHz +8.2 dB; Bell 7.7 kHz −4.5 dB; LC 148 Hz 12 dB; HC 12 kHz 24 dB |
| Small / Vocal Rich Space | v1 | Modern | 0.56 s | 17 ms | 66 % | +52 % | 56 % | — | 65 % | — | 34 % | Bell 8.1 kHz 40 %; Bell 280 Hz 117 % | LC 168 Hz 12 dB; HC 10.6 kHz 12 dB; Bell 1.3 kHz −4.3 dB |
| Medium / Vocal Gold Plate | v1 | Modern | 1.50 s | 17 ms | 59 % | 0 % | 100 % | — | 73 % | — | 20 % | Bell 491 Hz 147 %; HS 5.1 kHz 69 %; LS 82 Hz 65 % | Bell 7.6 kHz −3.0 dB; LC 122 Hz 6 dB; Bell 464 Hz −1.6 dB |
| Medium / Vocal Gold Room | v1 | Modern | 1.58 s | 17 ms | 59 % | 0 % | 26 % | — | 73 % | — | 24 % | as Gold Plate | as Gold Plate |
| Medium / Vocal Wood Room | v1 | Modern | 0.90 s | 20 ms | 39 % | +60 % | 40 % | — | 70 % | — | 25 % | Bell 751 Hz 139 % | LS 199 Hz +6.0 dB; LC 104 Hz 12 dB; HC 3.2 kHz 6 dB |
| Medium / Vocal Wood Room 02 | v2 | Modern | 2.23 s | 20 ms | 40 % | +15 % | 6 % | +62 % | 70 % | 0 | 12 % | Bell 950 Hz 141 %; Bell 197 Hz 120 %; Bell 434 Hz 59 %; Bell 6.8 kHz 60 % | LS 75 Hz +6.0 dB; LC 101 Hz 6 dB; HC 4.5 kHz 6 dB; Bell 13.5 kHz +11.4 dB; Bell 2.1 kHz −4.4 dB |
| Medium / Vocal Plate Modulated | v2 | Plate | 3.57 s | 4 ms | 35 % | −62 % | 69 % | −17 % | 109 % | 0.7 dB | 51 % | Bell 520 Hz 62 %; Bell 1.5 kHz 150 %; Bell 12.3 kHz 143 %; Bell 110 Hz 161 %; Notch 22 Hz 20 % | Bell 436 Hz −13.5 dB; Bell 14.7 kHz +11.5 dB; Bell 917 Hz −4.7 dB (S); Bell 15.3 kHz +5.6 dB (M); Bell 2.0 kHz −6.4 dB; Bell 709 Hz −4.7 dB |
| Medium / Vocal to Mix Glue | v1 | Modern | 4.08 s | 41 ms | 27 % | +50 % | 34 % | — | 60 % | — | 30 % | Bell 379 Hz 52 %; Bell 2.1 kHz 70 %; Bell 332 Hz 130 %; LS 103 Hz 52 %; HS 10 Hz 50 % | Bell 2.6 kHz +4.0 dB; LC 132 Hz 24 dB; HC 5.5 kHz 24 dB; Bell 298 Hz −6.5 dB |
| Large / Vocal Hall | v1 | Modern | 2.17 s | 19 ms | 69 % | +14 % | 30 % | — | 70 % | — | 25 % | HS 5.7 kHz 65 %; LS 603 Hz 170 %; Bell 7.3 kHz 71 % | LC 142 Hz 12 dB; Bell 7.6 kHz −4.4 dB |
| Large / Vocal Hall Large | v1 | Modern | 2.50 s | 19 ms | 69 % | +14 % | 30 % | — | 70 % | — | 22 % | HS 5.7 kHz 65 %; LS 725 Hz 166 %; Bell 7.3 kHz 71 % | LC 142 Hz 12 dB; Bell 7.6 kHz −4.4 dB |
| Large / Vocal Hall Bright | v1 | Modern | 3.00 s | 8 ms | 60 % | +30 % | 70 % | — | 70 % | — | 50 % | — | LS 99 Hz −9.4 dB |
| Very Large / Huge Bright Vocal Space | v1 | Modern | 4.03 s | 88 ms | 89 % | −76 % | 35 % | — | 59 % | — | 49 % | Bell 7.4 kHz 74 %; HS 1.7 kHz 160 %; Bell 264 Hz 79 % | LC 87 Hz 12 dB; HS 7.5 kHz +6.3 dB; Bell 736 Hz −1.4 dB; Bell 8.2 kHz −2.8 dB |
| Tempo Synced / Vocal Slap | v1 | Modern | 0.57 s | 1/32 × 100 % | 50 % | +23 % | 30 % | — | 70 % | — | 35 % | HS 2.3 kHz 34 %; Bell 280 Hz 159 % | LC 152 Hz 12 dB; HC 5.3 kHz 12 dB |
| Tempo Synced / Vocal Power Slapback | v1 | Modern | 0.10 s | 1/16 × 111 % | 100 % | −40 % | 69 % | — | 45 % | — | 20 % | Bell 1.4 kHz 42 %; Bell 336 Hz 131 %; Bell 6.2 kHz 141 % | HC 6.4 kHz 12 dB; LC 185 Hz 24 dB; four bells ±3 dB |
| Tempo Synced / Vocal Triol Slapback Room | v1 | Modern | 0.75 s | 1/16 × 66 % | 100 % | +94 % | 7 % | — | 100 % | — | 22 % | HS 10 Hz 47 %; Bell 600 Hz 119 %; Bell 3.6 kHz 138 % | HC 5.8 kHz 12 dB; LC 185 Hz 24 dB; three bells ±3 dB |
| Small / Ducked Carpet and Tiles ("Also works surprisingly well for vocals!") | v2 | Vintage | 0.67 s | 5 ms | 1 % | +41 % | 7 % | +68 % | 62 % | 14.2 dB | 26 % | LS 53 Hz 30 %; Bell 334 Hz 75 %; HS 176 Hz 60 % | Bell 258 Hz −17.7 dB; LS 6.3 kHz +8.4 dB; Bell 1.5 kHz −14 dB; LC 117 Hz 12 dB; two low bells |
| Medium / Center Plate ("Great for solo vocals and leads") | v2 | Plate | 3.31 s | 7 ms | 8 % | −26 % | 0 % | +86 % | 65 % | 2.0 dB | 19 % | five bands, 305 Hz … 6.3 kHz, 62 … 128 % | Bell 297 Hz −6.2 dB; HS 5.2 kHz +11.6 dB; HC 16.5 kHz 6 dB; Bell 1.1 kHz −4.7 dB (S); Bell 3.2 kHz −3.2 dB; Bell 138 Hz −4.8 dB |
| Medium / Transparent Plate ("Very good for vocals") | v2 | Plate | 3.49 s | 7 ms | 11 % | +28 % | 70 % | +6 % | 97 % | 0 | 37 % | LS 10.9 kHz 137 %; HS 166 Hz 75 %; LS 48 Hz 12 %; Bell 259 Hz 60 % | Bell 268 Hz −11.4 dB; HC 16.4 kHz 12 dB; Bell 1.2 kHz −5.2 dB (M); LS 61 Hz −8.6 dB; Bell 806 Hz −7.3 dB; Bell 289 Hz −6 dB (S) |
| Large / Large Late Plate ("Great for vocals and solo instruments") | v2 | Plate | 4.12 s | 103 ms | 51 % | −38 % | 4 % | −45 % | 120 % | 1.3 dB | 19 % | Bell 536 Hz 133 %; LS 18.3 kHz 128 % | Bell 445 Hz −19.4 dB; Bell 179 Hz −7.2 dB; Bell 326 Hz −20 dB; Bell 3.1 kHz −4.7 dB; Bell 597 Hz −7.7 dB (S) |
| Large / Vintage Hall ("Great for vocals!") | v2 | Vintage | 4.19 s | 3 ms | 69 % | −37 % | 2 % | −62 % | 86 % | 3.0 dB | 13 % | Bell 685 Hz 83 %; LS 103 Hz 45 %; HS 6.8 kHz 40 % | Bell 139 Hz −3.9 dB; HS 3.7 kHz +9.6 dB; small bells |
| Large / Vintage Plate with Modulation ("Great for vocals!") | v2 | Plate | 4.52 s | 72 ms | 82 % | +45 % | 70 % | −24 % | 52 % | 0 | 8 % | Bell 19.4 kHz 54 % | Bell 85 Hz +8.1 dB; Bell 136 Hz −16.7 dB; Bell 65 Hz −10.2 dB; Bell 7.6 kHz −6.7 dB; Bell 402 Hz −7.6 dB; HS 8.4 kHz +2.1 dB |
| Very Large / Huge Clear Plate ("Great for euphoric vocals and choirs") | v2 | Plate | 9.77 s | 46 ms | 23 % | +2 % | 50 % | −31 % | 79 % | 0 | 18 % | LS 611 Hz 176 %; HS 1.8 kHz 75 %; LS 79 Hz 13 %; two bells 60 % | Bell 268 Hz −11.4 dB; Bell 1.1 kHz −10.6 dB; Bell 321 Hz −11 dB (S); LS 196 Hz −12.3 dB (S); Bell 422 Hz −5.1 dB (M) |

What they add up to **(inferred, from the table)**:

- **Short pre-delays**: 0 … 20 ms in most; five go past 40 ms (41 … 103 ms). FabFilter's synced vocal presets use 1/16 and
  1/32.
- **Mix is an insert's** (8 … 51 %), and Lock Mix exists so a send can stay at 100 %.
- **The Decay Rate EQ makes the top die early** (a high shelf, bell or notch at 2.3 … 8.7 kHz at 12 … 74 % in most) and
  often **the low mids last longer** (a low shelf or bell at 280 … 750 Hz at 117 … 176 %). The Pro-R 2 plates
  instead cut the low mids *in level* hard on the Post EQ (−6 … −20 dB around 250 … 450 Hz) and lift the air
  (+8 … +12 dB at 3.7 … 15 kHz).
- **Ducking is barely used** in the factory vocal presets (0 … 3 dB; 14 dB in one drum-room preset).
- **Character** is low on the clean presets, 70 … 100 % on the modulated plates and backing vocals.

#### 3.2.6 What reviewers and users say

| Source | Praise | Criticism |
| --- | --- | --- |
| **MusicTech** (Pro-R 2, November 2023, 9/10) | "High-quality algorithms that sit well in the mix"; "Clear, intuitive layout that's easy to dial in"; "the thick sounding Vintage style can sit really well in the mix, and can give anything an instant dose of 80s vibe"; "it's easier than most to tailor results that will sit well in the mix"; ducking and gate built in are "a nice timesaver" | "It may not be the most characterful reverb in our toolkit"; "Missed opportunity not to add some extended FabFilter modulation options"; "Still missing a spring algorithm"; "IR import accuracy can be hit and miss"; Thickness: "turning the dial up often results in a reduction of reverb volume as the signal is flattened"; ducking and gate: "it would be nice if you had the option to trigger via the plugin's sidechain input" |
| **Sound On Sound** (Pro-R 1, Sam Inglis, March 2017) | "Inasmuch as it has a character, that character could best be described using terms such as smooth, rich, sophisticated and classy"; "very hard to make Pro-R sound bad"; "stereo patches tend to hold up pretty well when a mix is auditioned in mono"; the Decay Rate EQ: "The genius of this idea is that… the EQ-like interface makes it feel immediately familiar" | "Nor would it be an obvious choice for grotty springs, clangy plates or gritty lo-fi vintage digital"; "It doesn't typically have the 'you are there' quality"; wishes: Decay Rate EQ presets of their own, "the Distance parameter developed to effect more precise placement", "a comb filter option" |
| **MusicRadar / Computer Music** (Pro-R 1) | "Rich and evocative, equally at home generating super-sized Hollywood-style staging as it is airy, intimate vocal treatments"; "the Decay Rate EQ, Post EQ and syncable Predelay are simply brilliant" | "It might sacrifice some depth to achieve functional simplicity"; "You might occasionally wish for more control"; the question "whether or not those professional users are going to be happy having things like early reflection weighting, tail modulation, reverb time and room modelling distilled down to single multipurpose knobs"; no global bypass for the Decay Rate EQ |
| **KVR users** (read through a summarising fetch) | recko (2024, 5/5): "I always wanted a reverb like this even when it doesn't existed! Full and comprehensive EQ…"; Den* (2017, 5/5): "Amazing very flexible very good sounding reverb. it can sound however you want." | None in the two reviews |
| **The product page** | Dave Pensado: "I believe FabFilter Pro-R is truly ground breaking!" | |
| **Engineers** (`reverb.md` 1.1) | | Nobody in the survey names Pro-R or Pro-R 2 as their vocal reverb |

Gearspace, Reddit and FabFilter's own forum refused automated reading (a challenge page or 403), and Sound On
Sound has no review of Pro-R 2 at the addresses tried: **not read**.

### 3.3 Why Pro-R 2 falls short, revisited

`reverb.md` 1.4 guessed. What the sources now say, complaint by complaint. Théo's own words are only "isn't
the best", so which of these he hears is **not stated**: question for him (section 10).

| Complaint | Who says it (quote) | What ours does (`reverb.md`) |
| --- | --- | --- |
| **Not much character**: clean and classy, not the plate, Lexicon or lo-fi sound vocals are made with | MusicTech: "It may not be the most characterful reverb in our toolkit". SOS (Pro-R 1): "nor would it be an obvious choice for grotty springs, clangy plates or gritty lo-fi vintage digital" | Distinct modes (4.4, 6.4) and the eras on any of them (4.5, 6.10), as VintageVerb. Its Vintage and Plate styles answer part of this; ours go further with eras on every mode **(inferred)** |
| **Modulation is one macro** with no rate or depth | MusicTech: "Missed opportunity not to add some extended FabFilter modulation options". Manual: Character mixes modulation, "more pronounced early reflections" and "late echoes" in one knob | Mod Rate, Mod Depth (4.2) and Mod Shape (4.3, 6.8) apart from the early sound. Note VintageVerb's vocal presets modulate at 0.5 … 3 Hz (3.1.5): our 0.5 Hz default and 5 Hz top deserve a second look |
| **Macros hide the controls engineers expect** | MusicRadar (Pro-R 1): "early reflection weighting, tail modulation, reverb time and room modelling distilled down to single multipurpose knobs"; "You might occasionally wish for more control" | Size, Distance, Diffusion and Decay apart (4.2), the advanced panel (4.3) |
| **Ducking is a range only**: no threshold, attack, release or hold, no external key | Manual: "the range of the integrated, intelligent ducking feature"; the plug-in has no other ducking parameter. MusicTech: "it would be nice if you had the option to trigger via the plugin's sidechain input" | Duck with Threshold (Auto or dB), Attack, Release (or a note value), Hold, and tail or all (4.3, 6.11); a sidechain key later (8.1) |
| **Nothing for sibilance on the way in** | FabFilter's own advice is a post low-pass "as low as 2 kHz, since harsh 'S' sounds are often not very flattering"; SOS suggests notching the Decay Rate EQ | De-ess before the network (4.2, 6.3), so the tail keeps its top |
| **Space ties room and length**: corrected | 1.4 said "size and length are one gesture". The help says Decay Rate tweaks "the decay time without altering the room sound" (25 … 400 %), and reviewers liked Space: "Unified Space control works well" (MusicRadar) | Size and Decay apart (4.2), as VintageVerb. Not a fault of Pro-R 2's, but a difference |
| **Pre-delay sync is coarse** | Pro-R 2: 1/4 … 1/32 with an Offset 50 … 200 % (read from the plug-in). MusicRadar says Pro-R 1 synced "from 1/64 to 2 beats" (**secondary**, not checked) | 1/64 … 1/2, straight, dotted or triplet, plus Offset (4.2, 4.3) |
| **Thickness changes the level** | MusicTech: "turning the dial up often results in a reduction of reverb volume" | No Thickness; the eras' saturation is small and in the loop (6.10). Nothing to copy **(inferred)** |
| **No spring** | MusicTech: "Still missing a spring algorithm" | No spring either (not planned in 8.1) |
| **The Decay Rate EQ can't be saved or bypassed alone** | SOS: presets "for it independently of the main preset menu"; MusicRadar: "we wish there was a global bypass button for it" | **Not in the design**: a candidate for 4.6 / 4.9 **(inferred)** |
| **IR import is hit and miss** | MusicTech: "IR import accuracy can be hit and miss" | No IR import (8.2) |
| **Not what the engineers use** | `reverb.md` 1.1: no engineer names it | The basis is what they do name (2.2) |

What it does best, and we keep (confirmed): the Decay Rate EQ drawn over the decaying spectrum, Distance
(close: "more pronounced and brighter early reflections"; far: "a longer build-up and a more diffuse
tail"), the synced pre-delay with an Offset, Freeze, Lock Mix, the Post EQ's automatic gain compensation,
and a display reviewers keep praising.

---

## 4. What other reverbs do

About eighty reverbs read from their manuals and makers' pages (section 1.2's twenty are mostly left out
here, and VintageVerb and Pro-R 2 have a part of their own). The DAWs' own: FL Studio's Fruity Reeverb 2,
Fruity Convolver and LuxeVerb (4.3); Ableton's Reverb and Hybrid Reverb; Logic's ChromaVerb, Space Designer,
SilverVerb and Quantec Room Simulator (Apple's guide is now 12.3, not 11); Pro Tools' D-Verb (Digidesign's 2009
guide; Avid's pages refused us) and Space (its product page only); Bitwig's Reverb and Convolution; REAPER's
ReaVerbate and ReaVerb; Studio One's (now Fender Studio Pro) Mixverb, Open AIR 2, Room Reverb and Studio Verb;
Cubase's REVerence, REVelation, RoomWorks, RoomWorks SE and Shimmer. Vocal ones: iZotope Nectar 4's reverb and
Neoverb; Exponential Audio's R4 and PhoenixVerb (manuals), Stratus and Symphony (archived pages and Michael
Carnes's tips); Waves H-Reverb, CLA Vocals, CLA Epic, Renaissance Reverb (RVerb), Abbey Road Reverb Plates,
Abbey Road Chambers and Space Rider; sonible smart:reverb 2; Baby Audio Crystalline and Spaced Out. Plates and
vintage: Soundtoys Little Plate and SuperPlate; UAD Pure Plate, EMT 140, Capitol Chambers, Lexicon 480L, AMS
RMX16 and Sound City Studios; Slate VerbSuite Classics; Arturia Rev INTENSITY, Rev PLATE-140, Rev SPRING-636,
Rev LX-24 and Efx AMBIENT; Softube TSAR-1, TSAR-1R and Spring Reverb; Relab LX480 and Sonsig Rev-A. The
specialists: Eventide Blackhole, SP2016 Reverb, ShimmerVerb and MangledVerb; LiquidSonics Seventh Heaven
Professional, Cinematic Rooms Professional, Tai Chi, Lustrous Plates, HD Cart and Illusion; ValhallaShimmer;
Native Instruments Raum (its page). 2C's Aether and B2, and Valhalla's Room, Plate and Supermassive, are taken
from section 1.2 rather than read again. Kilohearts' Reverb page was gone (404); Unfiltered Audio Sandman
wasn't read.

The short version: **ducking is everywhere in the specialists and nowhere in the DAWs**; the good duckers
duck the tail only, have a release, and take a key from another track. **Only Waves H-Reverb de-esses inside
the reverb.** Everybody has Mix Lock. Multipliers of the decay time, with crossovers, are the classic damping
design, and Logic's ChromaVerb already draws them as an EQ of ratios, as our Decay EQ does. Size changes that
click or mute, and presets that cut tails, are common enough that several manuals tell you not to automate.

### 4.1 Ideas worth taking

Each with where it's from and what we do with it (`reverb.md` section numbers).

| Idea | From | Ours |
| --- | --- | --- |
| **Duck only the tail, not the early sound** | Seventh Heaven Professional: "By ducking only the reverb (not the reflections) one retains the spatialisation effect of the early room without compromising intelligibility with excessive reverb tail fighting with the dry" (the same words in Cinematic Rooms, HD Cart, Illusion). HD Cart ducks "the reverb, reflections, or the combination of the two"; Illusion ducks Reflections, Reverb, Reverb + VLF or Wet. Illusion: "The trouble with just running a compressor or ducker over an entire reverb as a mixer insert effect is that it affects the early reflections as well" | Duck What: Tail (default) / All (4.3, 6.11). Confirmed as the right default |
| **A ducker with its times** | Seventh Heaven Pro: Threshold, Ratio, Release, Trim, a GR meter and "a small selection of envelope attack times". Waves H-Reverb's Duck: Threshold "0 to -50 … where 0 = +10 dBFS", Recovery "30–3000 ms; Default: 300 ms". Exponential R4's Tail Suppress has Tail Recovery, whose "Range of this parameter is dependent on reverb time"; Carnes: "dial in just a little suppression, let's say 2dB … Set the 'Tail Recovery' at minimum … absolutely no hint of pumping". Crystalline instead offers two characters: "'Ducker Gentle' mode offers a slow and natural ducker setting, while the standard ducker mode has a more pumpy feel" | Ours has Threshold (Auto), Attack, Release, Hold (4.3). **Proposed**: Release to 3 s (H-Reverb's 3000 ms; a long ballad tail wants it), and a Trim isn't needed (Duck is a depth, not a ratio). Carnes's 2 dB is a reminder that our vocal presets' −4 dB is already firm |
| **The duck key from another track** | LuxeVerb: "Right-click the control to directly select an Input Mixer Track… Available sidechain inputs depend on the Mixer track sends to LuxeVerb's Mixer track". Cinematic Rooms: "the level of a vocal track could duck the late tail of a synth reverb to temporarily make space in the mix"; also Seventh Heaven Pro, Tai Chi ("Duck SC"), HD Cart, Arturia Rev INTENSITY ("select a side-chain signal with vocals, for example") and Rev LX-24. R4 keys from "Input… Output… or both". Pro-R 2 can't: "Pro-R 2 is not set up to be used with external side-chain" (FabFilter, 4.2) | 8.1 puts it "later (when effects get sidechains)". **Proposed: now.** Pro-C already has an external key made of a 0 % send (`setProCSidechain`, read after the sender's fader); the reverb's Duck can use the same mechanism, so a vocal on its own track ducks a shared reverb bus even when other tracks feed it |
| **Ducking in beats** | Spaced Out: "With Sync ON, the ducker syncs to quarter notes on the DAW's grid" | Release in note values (6.11) already |
| **Shorten the decay instead of turning it down** | Soundtoys SuperPlate's Auto-Decay: "instead of reducing the volume of the reverb, it dynamically reduces the decay time… This lets you play into long reverbs while avoiding excessive reverb buildup"; "it reacts best with… vocals"; Recovery "from 1 ms (very fast), to 500 ms (quite slow)"; "the decay time is always reduced, never increased"; rings round the Threshold and Decay knobs show it working. LuxeVerb's Envelope can target Decay. The Lexicon 480L's Decay Optimisation ("Reverb 7 is a good start setting") and Rev LX-24's, which "can tell the difference between drums and vocals" | 6.11 has it as "a second option, later". **Proposed: with Duck (step 3 of 8.1)**: it's a lane on the T60 curve, and the one ducking that doesn't make the tail jump in level. SuperPlate's two rings are the display to copy |
| **One envelope, signed: duck one way, gate the other** | LuxeVerb's Scale: "Positive values lead to 'gated reverb'… negative values that lead to 'sidechain reverb' where the reverb tail dips (or ducks)"; a Low Cut on the detector because "Low frequencies can confuse the envelope follower"; Attack "Normally leave this set to minimum" | Not proposed as one control: our Duck and a later gate are different jobs on a vocal. **Proposed**: a fixed high-pass (about 150 Hz **(inferred)**) on the ducker's detector, so a bass-heavy key doesn't hold the tail down |
| **A gate that closes, not cuts** | Cinematic Rooms' gate: "when the signal falls below -20 dB, the gate waits 50 ms before responding, and then reduces the signal by 25 dB over a period of 200 ms… re-open over… 10 ms", with a 3 dB hysteresis; Lustrous Plates: "Hysteresis and hold are typically used in conjunction to reduce chatter". Rev LX-24's gate "will close lower than that, to avoid constant opening / closing in reverb tails". Mixverb: Threshold "-36 dB to 12 dB", Release "10 ms to 250 ms". R4's gate has Hold, which "will keep the gate from thrashing open and closed" | Ours has no gate yet (Nonlin later, 4.4). **When it comes**: Cinematic Rooms' five numbers (threshold, hysteresis, hold, range, close time), so it never sounds like Pro-R 2's ("more like a cut than a drop", 4.2) |
| **De-ess inside the reverb** | Waves H-Reverb only: "DeEss keys a de-essing filter on the input (dry signal not affected!) … create bright reverbs that have less of a high-frequency spray on sibilants", Range "0 to -24 dBFS; Default: -18". No other manual read has one | De-ess (4.2, 6.3), on the way in, the dry untouched. **Proposed**: the range to 24 dB (H-Reverb's default is −18, past our 18 dB top) |
| **Keep loud consonants out with dynamics on the input** | R4's Warp, a compressor / expander on the reverb's input ("Below the threshold, the input signal is boosted…"; Carnes: "it's to modulate the reverb send based on level"); SuperPlate's Solid State preamp compressor "providing a more consistent and even input level going into the reverb"; Neoverb's Smooth "softens the transients of signals entering Neoverb"; Illusion compresses the Input | Not proposed: the vocal is compressed before the send (Pro-C), and De-ess takes the "s". A transient softener on the input is a candidate if plosives splash (5.4) |
| **Pre-delay in note values, fine ones** | Neoverb: "from 128th notes to eighth notes, as well as quarter-note and quarter-note triplet values", dotted and triplet; H-Reverb: "1/2 … 1/128; Default: 3/256"; Abbey Road Chambers "1/64t … 1/8d"; Rev INTENSITY "1/32 and 1"; also LuxeVerb, Fruity Reeverb 2, ChromaVerb, Hybrid Reverb, Space Designer, Studio Verb, Lustrous Plates, Tai Chi, Cinematic Rooms (0 to 500 ms), Blackhole, R4 (with tap tempo), Sonsig Rev-A | Pre-delay Sync 1/64 .. 1/2, straight, dotted, triplet (4.2). Enough: 1/128 at 120 BPM is 15.6 ms, under Griesinger's 20 ms |
| **Keep both the ms and the note value** | Sonsig Rev-A: "Presets are saved with both the normal and tempo sync modes' predelay values" | **Proposed**: the document keeps a pre-delay in ms and one in note values, Sync picks which, so switching Sync back and forth loses neither |
| **How long a pre-delay** | ChromaVerb: "use the longest possible Predelay value before you start to hear side effects, such as an audible echo… reduce the Predelay setting slightly"; Abbey Road Plates: "15 ms for instruments and 40 ms for vocals"; TSAR-1: "the Predelay should usually be set below 50 ms"; D-Verb: "Long Pre-Delay settings place the reverberant field behind rather than on top of the original audio signal"; Relab LX480 against: "Predelay is best for special effects" | Vocal presets 20–125 ms (7). ChromaVerb's method is worth putting in the knob's tooltip **(proposed, small)** |
| **Decay in note values** | ChromaVerb: "Decay sync button: Turn on to restrict Decay values to divisions synchronized with the host application tempo"; Crystalline syncs "the reverb pre-delay and decay time"; Illusion; smart:reverb 2's tail cutoff "in seconds or in beats" | "Later" (8.1). Kept later: a T60 in beats doesn't end on the beat (it's a −60 dB time); a gate in beats (Nonlin) is what actually does |
| **Pre-delay with feedback** (an echo before the reverb) | Hybrid Reverb ("Feedback sets the amount of the predelay's output that is fed back"), Raum ("Increase the feedback using a short delay for metallic, comb-filter sounds, and sync it for echo"), LuxeVerb's feedback Delay, Cinematic Rooms' Reverb Echo | Not proposed: EchoBoy in the slot before does it, with styles (FutureVerb's echo section is the same idea) |
| **Negative pre-delay** | Renaissance Reverb: "-160 ms to 160 ms" (negative delays the dry); Open AIR 2 "-150 to 300 ms" truncates the impulse; ReaVerb's pre-reverb "added to the audio signal ahead of the dry signal" | Not proposed: it delays the dry, so latency, and ours is 0 (6.15) |
| **Distance as early against late** | ChromaVerb: Distance "Set the perceived distance from the source by altering early and late energy", Early/Late Mix "These vary depending on the Distance parameter value"; REVelation: below 50 % "the sound source moves towards the front of the room", above "towards the back"; SP2016's Position "one of the most useful controls in adjusting the reverb to fit your mix"; R4: "If the reverb tail is higher and early level is lower, that might give a sense of more distant micing"; also Room Reverb, Studio Verb, Capitol Chambers' mic Position, Rev LX-24 (0 to 71), Rev INTENSITY, Hybrid's Quartz | Distance (4.2, 6.7) and Early Send (4.3). The field agrees it's a main control; ours stays on the knob row |
| **Distance that moves level too** | smart:reverb 2: "Moving the source further away reduces its presence and increases the wet signal… also controls a dedicated Distance Filter"; its tip: "enable Auto Gain and disable the Distance Filter" for a plain mix | Ours: Distance changes the early / late balance and the early filter, not Mix. **Proposed**: Distance keeps the wet sound's loudness the same, so it can be turned without re-balancing the send **(inferred)** |
| **Size apart from Decay** | LuxeVerb: Size "has no effect on the decay time of the reverb tail (which is controlled exclusively by Decay)"; Crystalline: "'Size' … is detached from the 'Length' control"; R4. Against: Fruity Reeverb 2 ("the Room Size should be adjusted according to the decay time"), the 480L ("Adjust Size before Reverb Time"), HD Cart (locking the time "will also invisibly lock the size parameter"), QRS ("The ring around the knob displays the reverb time range based on the chosen room size"); Neoverb's Space macro holds "the ratio of Time to Size" constant | Size doesn't change Decay (4.2): the absorption follows. The newer designs agree |
| **Size changes without artefacts** | Ableton's Smooth: "If set to None, the Diffusion Network's delay times are changed immediately, which can cause artifacts… If set to Slow or Fast, new delay times are updated over a specific time period". ValhallaShimmer: "All of the sliders have been designed to be tweaked in real time and have a smoothed response to avoid clicks". Rev INTENSITY's "Size Inertia". Those that don't: the 480L ("adjusting Size while a signal is present momentarily changes to dry signal"), TSAR-1 ("parts of the reverb becomes muted when parameters change… Do not use automation to modulate or gradually change parameters"), Capitol Chambers ("sonic artifacts can occur"; automation "Not recommended"), Rev SPRING-636 ("decay time changes are only effective when the knob is released"), Space Designer ("cannot be fully automated") | 6.12 and 9.3: slow glides under 3.5 cents, a second network for jumps, tested (9.7 test 16). Ableton's Slow / Fast is the same two speeds made a menu; ours chooses by how fast the change is |
| **No cut tails on a preset change** | REVerence: impulses "preloaded into RAM to guarantee artifact-free switching", and "a crossfade is performed when switching programs"; the AMS RMX16 mutes instead: "When changing basic reverberation programs, the output is muted so that 'memory flush-out' is not output"; R4: "When you relocate… the reverb tails may be cleared or allowed to ring" (a preference); ReaVerb: "stop and then restart playback for those changes to be employed" | Spillover (6.12, 9.3, test 17): the old network rings out beside the new one. Better than all four |
| **Mix Lock** | Nearly universal: SP2016 (Mix Lock and I/O Lock: "the current input and output gains will be preserved"), Studio One's Mixverb and Studio Verb, REVerence, REVelation, Cubase's Shimmer, Crystalline's Wet Lock, R4 (the mix "not changed when you load new presets"), Rev LX-24, Relab LX480, Sonsig Rev-A, Little Plate's Parameter Lock ("Our presets are almost all 100 percent wet"), Slate (Dry/Wet "not saved in the Presets"), the 480L ("global parameters"), Capitol Chambers' Wet Solo | Mix Lock (4.1). Confirmed |
| **Lock any control while browsing** | LiquidSonics, everywhere: "Many of the controls can be held (locked) when preset changes occur" (Cinematic Rooms); Tai Chi: "if you have a decay time and pre-delay that suits the track well but you want to experiment with other reverb programs… simply lock them in place"; HD Cart locks whole blocks ("ducker/compressor, gate and EQ") with one padlock; Seventh Heaven Pro: "lock the filters and decay time while rapidly moving between presets"; Rev LX-24 locks values "when changing algorithms" | **Proposed, later**: locks for Pre-delay (with Sync), Decay and the two EQs, in the preset menu (not a padlock on every knob). The pre-delay lock matters most: it's set to the song, the preset isn't |
| **A/B** | R4's Compare ("temporarily takes the plugin back to the original preset"); Slate's A/B Snapshots ("Clicking on the arrow between the two buttons will copy the current Snapshot to the other"); Rev LX-24 ("Each Preset is actually two Presets in one!"); the 480L's Machine A / B ("useful for auditioning or automating between different reverbs"); smart:reverb 2 ("Store up to 8 different plug-in states"); Blackhole's Hotswitch; TSAR-1 shows "the former setting… within the parentheses" | A/B and Revert (4.1). Confirmed |
| **Damping as multipliers of the decay, with crossovers** | The classic design: the 480L ("Bass Multiply sets the reverb time for low-frequency signals as a multiplier… try values of 1.5 or less"), Relab LX480 (Bass Multiply "0.2x to 4.0x", "we recommend values around 1.2x to 1.3x"; High Crossover "A typical setting for simulating real halls is 4.6kHz"), the RMX16 (LF "a quarter of the indicated time at a setting of -9, to four times at +9", at 350 Hz), Quantec QRS ("from a maximum increase of 10 x to a decrease of 0.1 x"; "a natural room reverb effect that can't be replicated with EQ alone"), H-Reverb (LF and HF Ratio "x0.1–x2"), Hybrid Reverb's Bass Mult and Prism's Low / High Mult, RoomWorks (level percentages), REVelation, Seventh Heaven ("specified as a multiplier of the main decay time"), Illusion ("a 0.8-0.9x multiplier could be used to tame them"), Fruity Reeverb 2's BASS and CROSS | The Decay EQ (4.6), ×0.25 .. ×4. The hardware's useful range is narrow (1.2–1.5× bass); our natural curves (6.4: ×1.1 .. ×1.6 at 125 Hz) sit there, and a band's label should say the seconds |
| **Damping as an EQ of ratios, drawn** | ChromaVerb: "The Damping EQ adjusts the frequencies of the decay signal. It is divided into four bands, with independent high and low shelving EQ bands, and two parametric EQ bands"; each band's "Ratio field: Set the Decay parameter timing ratio"; the display has "A Damping EQ curve… overlaid" on the live signal | The Decay EQ is the same idea with six bands (Pro-R 2's number), drawn as real seconds (4.6). ChromaVerb is the stock precedent |
| **Absorption inside the loop, tone outside** | SP2016: its EQ "affect[s] parameters deep within the feedback structure… more pronounced effects at longer decay times"; Abbey Road Chambers: "these filters can have an accumulative effect"; D-Verb's Hi Frequency Cut (decay) "acts in conjunction with" a post 6 dB/oct Low-Pass; Relab LX480's internal "6dB or 12dB" filters and its output filters that attenuate "both the reverberation and the early reflections"; SuperPlate: "all the EQs are post-reverb, while the Low and High Cut filters are pre-reverb"; Nectar's filters "only applied to the wet (processed) output"; Bitwig puts any device in the loop (Tank FX) | 6.1: absorption in the loop (length), Post EQ outside (level), cuts in and out. Matches the best of them |
| **Steeper cuts** | SuperPlate's Low and High Cut at 6, 12 or 24 dB; Hybrid Reverb's EQ "from a gentle 6 dB/octave to a steep 96 dB/octave"; the Fruity Reeverb 2 complaint that its 600 Hz cut lets 50 Hz through (4.2) | Ours: 12 dB/oct, 24 in Studio (4.2, 4.3). **Proposed**: a slope choice (12 / 24 dB/oct) on Low Cut and High Cut, from the knob's menu |
| **Mono bass at any width** | Hybrid Reverb: "Bass Mono converts frequencies lower than 180 Hz… to mono"; ChromaVerb's Mono Maker ("a frequency below which stereo information is removed"); Crystalline's Sides: "a high-pass filter that removes stereo information from the low end of the reverb… especially helpful for creating wide vocal or lead instrument reflections without muddying-up your low end"; smart:reverb 2's Mono Below | Ours keeps the bass unwidened only above 100 % Width (6.9). **Proposed**: a Mono Below frequency in the advanced panel's Output group (off .. 500 Hz, 150 Hz in the vocal presets **(inferred)**), at every Width |
| **Width warnings** | R4: "High widths may cause some cancellation upon fold-down. A narrower tail might be useful in focusing the source more tightly"; SuperPlate: "Shrinking the width of the reverb and placing it in the same location as the source sound can move a sound 'back'"; Exponential's Stratus / Symphony: "every single reverb channel is decorrelated" | Width capped at 150 %, tested in mono (6.9, tests 7–8) |
| **Lower diffusion and density for vocals** | D-Verb: "Use low or moderate settings for clearer and more natural-sounding vocals"; the 480L and LX480 the same; Rev LX-24: "Use a lower setting for a more natural reverberant space good on vocals", its Vocal Plate "has less initial diffusion"; TSAR-1: "a sparse reverb will often sound clearer than a dense reverb"; Illusion: "Lower densities… well suited to vocals", "a low amount of diffusion lightens the reverb maintaining clarity"; Tai Chi: "too much diffusion may often cause a reverb to sound metallic" | **A check on section 7**: our vocal presets' Diffusion is 75–90 %, above what every manual advises. Costello's advice (1.2) is the other side: up until sibilance is smooth, then "down just a touch". Tune by ear on real vocals; Smooth Plate's velvet early energy may allow less |
| **Gentle modulation for natural vocals** | SuperPlate: "for vocals… use minimal modulation and keep the rate fairly low"; UAD EMT 140: depth "0 - 10 cents", "can… reduce ringing on some source material"; TSAR-1's Random: "a lush and uncolored reverb, without any 'pitchy' or 'chorus-y' effects"; HD Cart's Spin "similar to a chorus, but without any of the audible phase effect"; the 480L: Spin "37 or higher. However, higher values may make the pitch of piano or guitar unstable". Chorus on purpose: Cinematic Rooms ("on the right sources like synths, vocals… it can really add an extra dimension"), the RMX16's Chorus "designed to be used mainly with voices" | Defaults of 1–3 cents, Random shape (6.8); chorus presets on purpose (7, Chorus Verb). Matches |
| **Re-roll the pattern if it rings** | RoomWorks' Variation: "generates a new version of the same reverb program using altered reflection patterns. This is helpful if some sounds are causing odd ringing… There are 1000 possible variations" | **Proposed, small**: a Variation number in the advanced panel, the seed of the velvet taps and the random modulation (6.7, 6.8: today seeded by the effect id) |
| **Saturation: on the input, in the loop, or the converters** | Quantec QRS's AD/DA Drive "up to 30 dB of gain to recreate the character of 1980s QRS digital converters… with automatic gain compensation"; SuperPlate's preamps ("the reverb signal itself will not be distorted as such"); Rev PLATE-140's drive ("the volume gain is compensated"); Rev LX-24's Drive "situated before the input highpass"; H-Reverb's Drive "like a vintage hardware reverb getting a hot input" and "Digital Off/12 bit/8 bit"; R4's overdrive with a crossover because "overdrive actually creates high harmonics… Otherwise there can be aliasing effects"; Relab LX480's Sat ("a more present reverb sound") and 18Bit; Abbey Road Chambers' tape drive in the loop; Hybrid Reverb's Vintage; Eventide MangledVerb (distortion after the reverb) | The eras' converters, band limits and soft clip (4.5, 6.10). **Proposed, later**: a Drive on the era's input converter, its gain compensated (QRS's and PLATE-140's), kept out of the Now era |
| **Plate dispersion** | Lustrous Plates (1.2); Illusion: "a plate smoothly disperses sound by delaying different frequencies by different amounts… Dial it back on drums and up on vocals or guitar" | Later (6.9), the plate's lean |
| **The level set for an insert** | Little Plate: "As you pass about 70 percent, the dry signal will quickly and smoothly begin to drop"; UAD Pure Plate's Mix is "logarithmic… 12 o'clock position, the mix value is 15%"; TSAR-1: "as a send effect… always be set at 100%… insert… 15–40% is a good starting point"; Softube Spring "between 0 and 20%" | **Proposed**: Mix's taper puts 10–40 % across the middle of the knob (Pure Plate's 15 % at 12 o'clock), keeping equal-power gains (4.1). Section 10 question 4 (default Mix) is the same decision |
| **Presets at one level** | TSAR-1's presets are "designed with a -6 dB reference level… corresponds to a Mix level of 27%"; Fruity Convolver's Normalize; REVerence's Auto Gain; Space Designer's "reverb volume compensation" ("the perceived—not the actual—volume") | Our modes are normalised in power (6.9). **Proposed**: every factory preset's wet loudness matched within 1 dB (an offline check beside test 21), so browsing compares sounds, not levels |
| **Freeze, and freeze that takes input** | Two kinds everywhere. Ableton's Freeze with Cut ("preventing the input signal from adding to the frozen reverberation") and Flat ("If Flat is off, the frozen reverberation will lose energy in the attenuated frequency bands"); Hybrid Reverb's Freeze In; LuxeVerb's Freeze and Sustain; the RMX16's "Freeze/add" and "Freeze/mute input"; Quantec's Add ("capture another portion of the reverb tail… Repeat to layer sounds"). R4: "early reflections are shut off during freeze". Sonsig Rev-A's freeze is "a unique, dynamic snapshot, with a constant volume". LuxeVerb's Freeze "is intended for Automation. Keyboard Controller will allow you to trigger Freeze or Sustain from a Piano roll" | Freeze and Decay ∞ (6.13) are the two kinds; the energy keeper is Rev-A's "constant volume". **Proposed**: Alt-click (or holding F) makes Freeze momentary, released on let-go (Crystalline's reviewers asked for it, 4.2) |
| **Kill: the input off, the tail heard** | Blackhole: "KILL kills the input to the reverb section allowing you to hear the reverb tail fade out"; SP2016: "a quick way to remove the input from the reverberator so that you can listen to the tail… The Kill button can be helpful in evaluating the how the EQ is affecting the sound"; ShimmerVerb's Pitch Kill; the 480L's input mute ("any delay, echo, or reverb tail continues") | **Proposed, small**: a momentary Kill in the top bar while the mouse is held, not saved or automated, for hearing the tail against the Decay display |
| **Reverse** | ReaVerb: "Reverse – reverses the Reverb – a nifty effect for vocals, guitar solos and song intros/outros"; H-Reverb: "Reverses the direction of the reverb time envelope to achieve breathy, upward-swelling, reverse-type reverb"; Renaissance Reverb, the RMX16, Space Designer, smart:reverb 2 (Reverse and Bounce), Crystalline; Blackhole's Gravity "in its inverse mode"; MangledVerb under Decay 70 | Nonlin, later (4.4). H-Reverb's way (an envelope over velvet taps, not a reversed recording) is the one that fits our engine **(inferred)** |
| **Shimmer** | ValhallaShimmer: "By setting the Shift amount to +12 semitones, and the Feedback to 0.5 or greater, the classic Eno/Lanois 'shimmer' sound is produced"; its SingleReverse mode, "where each grain is reversed before it is pitch-shifted. This results in a smoother pitch shifting sound". Cubase's Shimmer: "a reverb and pitch shifter in a delay loop", "we recommend setting a value of +12 semitones", a filter bank. Eventide ShimmerVerb: two shifters in cents, then a 3-band crossover whose levels set the feedback. LuxeVerb's (4.3). Hybrid Reverb's Shimmer | Later (8.1). When built: LuxeVerb's place (after the diffusion, most of the network in the loop), ShimmerVerb's band levels so the octave-up doesn't get shrill, Valhalla's reversed grains. Hyperpop throws (7) |
| **"Shimmer" as a long top, no pitch** | Crystalline: Shimmer "makes the high frequencies of the reverb tail decay slower… You can set the frequency cutoff point as well as the multiplier… (either at 2x, 4x or 6x the length)"; Sparkle "extra shine on vocals or snares" | A high shelf of the Decay EQ (4.6) does exactly this. Worth a preset, not a control |
| **Show the shape: early taps and the tail** | Room Reverb: "Early reflections are represented by vertical lines, and the reverb tail is represented by a colored envelope"; Open AIR 2's "Log Time" and "Log Level" views; REVerence's waveform and spectrogram; Hybrid Reverb's impulse "changes based on the Attack, Decay, and Size settings"; Relab LX480's tabs with draggable handles | The Shape display (4.6) is Room Reverb's picture. Open AIR's log time is worth a toggle: the early taps are crowded at the left on a linear axis **(proposed, small)** |
| **A test click or burst through the reverb** | Studio Verb's Ping: "sends a short burst of noise into the reverb, triggering the full frequency spectrum"; REVerence's Play ("a short click is played. This provides a neutral test sound"); Cubase's Shimmer "Play Sample Sound" | `verbAudition`, "later" (4.6). Three stock reverbs have it: **proposed for step 4** (with the Shape display it explains) |
| **See the dynamics working** | SuperPlate's rings round Threshold and Decay; LuxeVerb's display of the input envelope (blue), the threshold (orange) and the Wet or Decay line, over the wet signal ("If the Envelope (Blue) curve never rises above the Threshold (Orange) line, there won't be an activation"); Seventh Heaven's GR meter | Ours: a Duck bar (4.6, 4.7). **Proposed**: while the Ducking group is open, the display shows the key's level, the threshold and the reduction over time (LuxeVerb's), so the threshold is set by eye |
| **A clip light on the input** | LuxeVerb's Wet Gain "will flash red when the internal input limiter is triggered"; SP2016's Limit LEDs, also lit when "the internal reverb 'matrix' is overdriven"; the 480L's "ovld" | **Proposed**: the In meter (4.7) lights when the loop's guard (6.13) clips |
| **Quality and CPU modes** | Ableton's Density ("Sparse uses minimal CPU resources, while High delivers the richest"); ChromaVerb's Quality ("Low produces a grainy reverb with noisy modulation. High sounds clean and precise. Ultra delivers a smooth, expensive-sounding reverb"); RoomWorks' Efficiency and an Export setting that "uses the maximum CPU power"; Room Reverb's Eco; Crystalline's Eco; Cinematic Rooms' "Reduced CPU Processing Mode"; Lustrous Plates trades latency for CPU; R4 stops below a threshold ("The default is set at -108 dB… Tip: —54 dB sounds bad") | Ours: Eco absorption when the Decay EQ is flat, idle below −120 dBFS (6.14). No "export quality": the export must equal playback (test 18). R4's −108 dB sits near our −120, and its tip is why ours is that low |
| **Latency** | Exponential Audio states it: "44.1/48K - 32 samples"; ReaVerb's "ZL – option to enable zero latency: useful when tracking"; Capitol Chambers "subject to increased latency"; Space Designer compensates the dry | 0 (6.15) |
| **One knob, or a macro** | TSAR-1R: "Time parameter adjusts an internal predelay, the early reflections, diffusion, density and decay time"; Neoverb's Space; CLA Vocals' Reverb fader "+/- 10" over four colours (Tight, Large, Chamber); Nectar's FX X/Y pad (Y the reverb's mix, X its width, pre-delay and decay); Blackhole's Ribbon ("program two settings for any combination of the controls and seamlessly morph") and Hotswitch; Spaced Out's centre circle ("three parameters in one mouse movement"); Waves Space Rider's Rider, which "can follow the input envelope" | Not proposed: the presets and the assistant are our one-knob paths ("a short dark room under this rap vocal"), and Decay with its Decay EQ is already one gesture for length. Blackhole's Ribbon is an automation clip on several controls; not built |
| **Content-aware set-up** | Neoverb's Reverb Assistant "analyzes your musical material, and then tweaks the parameters", its Unmasking ("if Neoverb detects masking, it applies a tuned EQ curve"); smart:reverb 2's Learn, which "does not set any parameters or select a reverb style. It simply adapts the reverb engine", its Clarity ("an intelligent sidechain-driven process, but you do not need to manage any routing"), Group Mode (up to 7); Nectar 4's Vocal Assistant sets only the reverb's mix | Not proposed as a Learn button (the reviews, 4.2, find the results lifeless). The assistant's `add_vocal_reverb` (9.6) is ours: visible, undoable edits. **Proposed, later**: it reads the song's tempo for the pre-delay (it does) and the vocal's sibilance band for De-ess Freq (the server can analyse media) |
| **Presets by use, vocals by voice** | Neoverb: "Vocals: Presets for male, female, and background vocals"; TSAR-1: "the modern presets focus on application (drums, vocals, orchestral sounds, etc)", with Vocal Chamber, Vocal Church, Vocal Plate ("This reverb is meant to be heard") and Vocal Whisper; H-Reverb by application and by engineer; R4's 1200 by keyword; Crystalline's by creator (a con, 4.2) | Folders by use (4.1, 7). Our Lead / Pairs / Backing / Throws is already finer than most. A "whisper" preset is worth adding (TSAR's, for bedroom pop) beside Intimate |
| **Two engines in one** | Relab LX480's Cascade and splits ("Ambience on Engine A… combine that it with Random Hall on Engine B"); Hybrid Reverb's Serial / Parallel; Neoverb's three engines on a Blend pad; CLA Epic's routing matrix | Not proposed: two sends (the Pairs, 7), which the mixer already shows and the assistant makes in one step |
| **Bloom: how long the tail takes to arrive** | Cinematic Rooms' Reverb Bloom; ChromaVerb's Attack ("either the volume or the density build-up time"); Slate's Attack; Tai Chi's Spread & Shape; REVelation's Shape; the 480L's Shape and Spread (1.2) | Distance sets the build (6.7); Space mode has an Attack (6.4). Not proposed separately for the vocal modes |

### 4.2 What producers complain about

What the reviews and forums we could read say. Reddit, Gearspace, Sweetwater and producelikeapro refused
automated reading, so this is the Image-Line forum (logged out it shows threads cut short; its search page
shows each post's excerpt, marked "(IL search excerpt)"), KVR, FabFilter's forum, Sound On Sound, MusicTech,
MusicRadar, Tape Op, Attack Magazine and Production Expert. Each with what our design does about it.

- **Metallic, "tinny" tails, above all in FL's own reverbs.** "i like Reeverb 2 but it always sound so
  'tinny'!" (NBG); "I think Reeverb 2 is awful" (MvR); "Fruity Reeverb 2...too metallic, how ever I set it, I
  can't get it to sound right" (Mc UB, IL search excerpt); on its room size, "a burst of energy, with a sort
  of metallic clang" (TheDichotomist, IL search excerpt). Image-Line's own FL 12.9 note added "Modulated
  reverb… to break up 'ringing' or 'metallic' sounds" (Scott, IL search excerpt), and a user found the "slight
  metallic clang… has been mostly extinguished" since (Alphons). LuxeVerb fares no better: "probably the most
  metallic sounding and weird resonating Reverb I ever heard in my life" (Trancit, 2025); "more metallic and
  plastic like than I would like for a full mix" (AtomicOverdrive, 2026); a staff answer was "For a start all
  reverb is 'tinny'" (Scott). The cause, from a developer: "short feedback delays and sparse diffusion will
  cause the metallic ringing… if the algorithm you are working with relies on allpass filters… you need to
  modulate them" (HISEnberg, HISE forum). Ours: enough delay memory, prime lengths, Jot's absorption so no mode
  outlasts its band, no short input all-passes in the vocal modes, slow modulation (5.4, 6.5, 6.8), and three
  tests that fail a ringing tail (9.7 tests 4–6). This is the complaint FL users would judge ours by first.
- **Cuts too gentle to clear the mud.** "if I low cut at 600hz in the plugin, on the send channel I can see
  frequencies as low as 50hz being allowed through… I am guessing the cutoff slops in the plugin are not very
  steep?" (thedss, on Fruity Reeverb 2); "As you observed they are not very steep" (nucleon). Paul White on
  Neoverb: "I found myself rolling off the low end of the EQ both pre‑ and post‑reverb". Ours: cuts in both
  places (4.2, 4.3), 12 dB/oct, Studio's at 24; the slope choice proposed in 4.1.
- **Sibilance.** Sound On Sound's advice is to fix it on the send: "it's sometimes enough to use them
  [de-essers] only in series with the reverb send if it's only the reverb that's causing the problem", and
  "using bright reverbs" is named among the causes. No reviewer we could read complained of a particular
  reverb's "s". Ours: De-ess on the way in (6.3, test 15) and plate-like natural curves that cap the top's decay
  (6.4).
- **The tail fighting the voice.** Attack Magazine wants "an upfront sound accompanied by a wall of reverb"
  rather than a "swampy mess", and sidechain-compresses the reverb for "big reverb without the wash". Ours:
  Duck (6.11) with its release, on the tail only, and Auto-Decay (proposed, 4.1).
- **Ducking without its times, and gates that cut** (Pro-R 2). "the Auto Gate's release time seems very sharp
  - it feels more like a cut than a drop… Same with the ducking… I only get access to the ducking amount /
  depth. And sometimes it feels too slow to release. I'd like access to the attack and release times"
  (Peter Hajba, FabFilter forum, 2023); "The sharp closing of the gate doesn't really sound useful or musical"
  (Marco Silbermann); "FF likes to keep things uncomplicated… Pro R2 could have been a real game changer but I
  feel FF missed the mark" (John Sienkiewicz); FabFilter: "We'll consider it for future updates!" Ours:
  Threshold, Attack, Release and Hold in the advanced panel, the depth on the main row (4.2, 4.3); a gate,
  when it comes, closes over time (4.1).
- **No key from another track** (Pro-R 2, in FL Studio). An FL user's sidechained ducking didn't work;
  FabFilter: "Pro-R 2 is not set up to be used with external side-chain. The ducking only works on the normal
  input." MusicTech on its gate: "it would be nice if you had the option to trigger via the plugin's sidechain
  input". Ours: proposed now, on Pro-C's key mechanism (4.1).
- **Too many controls, or controls that hide what they do.** Tape Op on Pro-R 2: "the ten knobs, four buttons,
  and crazy EQ squiggles on the main display looked like 'too much' to my eyes" (Larry Crane, who came round);
  on Crystalline: "there are no numbers, values, or other quantitative markers" (Dave Hidek); on Pro-R 2's
  Thickness: "turning the dial up often results in a reduction of reverb volume" (MusicTech); on VintageVerb's
  eras: "its much harder tp get the sound I want and basicly I always end up using it in Now mode" (Tendou,
  KVR); Sam Inglis on Seventh Heaven Professional: pre-delay "could, perhaps, be promoted to the main set of
  controls". Ours: ten knobs on one row and two on a Vocal row, with values in units while touched
  (4.2), the rest behind Advanced, pre-delay first on the row, the era a menu defaulting to Now (4.5), and controls that don't move
  the level as a side effect (Distance, proposed in 4.1).
- **Presets.** "Would have liked presets ordered by type rather than programmer – a minor gripe!" (MusicRadar on
  Crystalline); "One of the first things you'll notice about Smart:Reverb is its lack of presets"
  (MusicTech); on Pro-R: "so powerful is the Decay Rate EQ that it would perhaps be useful to be able to save
  presets for it independently" (Sam Inglis, SOS). Ours: folders by use (7); Copy / Paste curve on the display
  (4.8); locks for the EQs proposed (4.1).
- **CPU, and crackles in silence.** "It's my 4th time demoing it… is sooo CPU hungry!" (e@rs, on Pro-R; FabFilter:
  it "depends a lot on the type of preset… and also the reverb length"); Crystalline "does come at the cost of
  eating up a chunky slice of RAM and CPU cycles" (MusicTech); with u-he's Uhbik-A, "the crackles happens to me
  when the plugin is sent (apparently) absolute silence" (mabian, KVR), the classic denormal fault. Against
  that, "Fruity Reeverb 2 and Delay 2 uses each perhaps 0.1% of a nowadays CPU core" (jbarkerhill92, IL search
  excerpt): FL users are used to a free reverb. Ours: flush-to-zero, idle detection, a test that a silent send
  costs under 10 % and has no spikes (6.14, test 11), a budget of under 3 % of a core (6.14).
- **Clicks and blow-ups when Size moves.** "Is there any automation or modulation of Size happening?
  That...is the one parameter on Valhalla reverbs that can make audible noises" (Winstontaneous, KVR); 2C's
  developer on Aether: "The nature of the algorithm (and really most reverbs in general) result in some
  'discontinuities' when changing some parameters… they can act like feeding an impulse… into the reverb"
  (Andrew Souter, KVR); a Pro-R 2 bug where "quickly tweaking the size, makes the reverb go mental with noise
  at 150+ dB" (Patrik Rydberg, FabFilter forum, fixed). Tempo-synced pre-delay "can cause problems if your
  project contains tempo changes because the resulting change in the pre-delay time can create weird
  pitch-shift artefacts" (MusicTech on Crystalline). Ours: Size glides or spills over (6.12, 9.3), the loop's
  soft clip and NaN guard (6.13), and the pre-delay crossfades rather than slides, so tempo automation
  doesn't bend it (6.3); test 16.
- **Tails cut off.** On Denise Perfect Room: "Seems like it cuts out whenever I change it, and comes back with
  a click" (lwj, KVR). In FL Studio, Smart Disable: "Smart disable should be off for reverbs and anything that
  has a 'tail'" (reflex, IL search excerpt); "Smart disable turns it off after 5 seconds of no input"
  (Gho5tly, IL search excerpt). Ours: spillover on mode and preset changes (9.3, test 17), and ours is an
  effect of the app, not a plug-in under Smart Disable: it goes idle only when its own output is under
  −120 dBFS (6.14). The opposite wish, clearing a tail at once, is the engine's double Stop
  (`Engine::silence`, which clears every effect's state).
- **Modulation that's heard.** Crystalline's "can sound a bit incongruous when it stands out too far"
  (MusicTech); "Shimmer is too nonlinear for my liking" (nadpitt, KVR); FL users asked for "little pitch
  changes, to create additional movement and depth" in Reeverb 2 (mrelectronicvein). No reviewer we read
  used "seasick". Ours: 1–3 cents by default, random walks (6.8).
- **"AI" set-up that guesses wrong.** On Neoverb: "Why would the AI assistant think I want to remove all the
  bass from everything? It devours resources only to deliver a lifeless terrible sound" (assbot, KVR); on
  smart:reverb: "Those hoping for a quick fix… may be disappointed, as this isn't a set-and-forget plug-in",
  and "the sound lacks some character" (MusicTech); on Antares' Vocal Reverb: "It depends on what you want – to
  hand over control to AI or do the legwork yourself" (Attack). Ours: no Learn button; the assistant edits
  through the same controls, each an undo step the user can see (9.6).
- **Stock reverbs without character.** On Fruity Reeverb 2: "It does not add a distinct color or identity to
  your sound… It sounds as good as your decisions" (michaelmusco.com, 2026); Image-Line forum threads point
  people to Valhalla ("Give ValhallaRoom a try. Chances are you'll end up buying it instantly", IL search
  excerpt). Ours: modes and eras are characters (4.4, 4.5), and the presets show each one at its best (7).
- **Convolution's limits** (FL's Convolver). "Please add option for stereo impulse responses. Currently you only
  get symmetrical reverb left and right" (OldSageWisdom, 2026); "We need a proper IR browser for this"
  (Parter). Not ours to fix: we have no convolution (section 3).
- **Not found**: a complaint we could read about a reverb's latency, about mono collapse, or about grainy early
  reflections specifically (the nearest: "I wish it had an option to control the amount of aliasing in the
  reverb", APZX on VintageVerb, KVR).

### 4.3 FL Studio's own reverbs

Our app follows FL Studio, and Théo knows its reverbs, so here they are control by control, from Image-Line's
manual. FL ships four: Fruity Reeverb (legacy: "This is a legacy plugin, we recommend Fruity Reeverb 2"),
**Fruity Reeverb 2**, **Fruity Convolver**, and **LuxeVerb**, the newest, which the manual calls "an advanced
algorithmic reverb" and which the other pages now list as an alternative. LuxeVerb matters most to us: it
already has a ducker with a sidechain from another mixer track, Freeze and a shimmer. Fruity Reeverb 2's page
gives no ranges for its knobs (only "reverberations of up to 20 seconds duration"); where a range isn't on the
page it's **not stated** here rather than taken from the plug-in.

#### Fruity Reeverb 2

"Fruity Reeverb 2 can create lush and smooth reverberations of up to 20 seconds duration and is the most
sophisticated reverb in the FL Studio stable" (the page's words; LuxeVerb came later). Algorithms by Ultrafunk
and Daniel Schaack. The page opens with a warning that is the whole of FL's mixing advice on reverb:
"Reverb is one of those effects that is easy to overdo in a mix, creating a washed out and 'muddy' sound…
Rarely should you use reverb on the Master track".

| Control | What the manual says | Ours |
| --- | --- | --- |
| **MID / SIDE** | "Process the Mid or Side components of the input signal. The default is MID processing, summed mono (Left+Right)." Side "can be useful when you are processing a complete mix… without washing out the details"; "instruments panned close to center will remain unaffected" | Input Mono / Stereo / Auto (4.3, 6.3). A Side input isn't proposed: it's for a whole mix, not a vocal (a centred vocal would get no reverb at all) |
| **H.CUT** | "Use this to remove high frequencies from the reverb, or to make the room sound duller" | High Cut (4.2), on the output; Input High Cut in the advanced panel (4.3) |
| **L.CUT** | "attenuating the bass frequencies before being passed to the reverb engine": an input filter | Low Cut (4.2, output) and Input Low Cut (4.3): we have both places, FL has the input one |
| **DELAY** (pre-delay) | "the delay time between the direct input signal and the first reverb reflection. There is a TEMPO switch that selects 'tempo based' predelay." "Predelay creates a slap-back echo effect that can add atmosphere and muffle the signal, so use it wisely." Note values: **not stated** | Pre-delay with Sync (4.2): the same idea, with the note values listed and dotted / triplet, and Offset (4.3) |
| **SIZE** | "the size of the virtual room… (the display will give you feedback)". "the Room Size should be adjusted according to the decay time. Small rooms sound better with a short decay time, large rooms sound better with longer reverb times." | Size (4.2), but independent of Decay ("Doesn't change Decay (the absorption follows)"). FL's advice is a hint that the two interact in its engine **(inferred)**; ours doesn't need the user to match them |
| **DIFF** | "A low diffusion setting makes the reflections sound more distinct and sparse, like closely spaced echoes. A high diffusion setting creates a dense series of reflections, so close they sound more like a constant decaying noise." | Diffusion (4.2), the same meaning |
| **MOD** and **SPEED** | "Modulates the reverb time, to break up 'metallic' ringing sounds associated with artfical [sic] reverb. Small values make the reverb sound smoother and more natural. Extreme modulation values can add a detuned sound". SPEED: "Speed of the sine-wave modulation" | Mod Rate and Depth (4.2), and a Random shape beside the sine (4.3, 6.8), which hides the metal without the detune FL warns of |
| **BASS** and **CROSS** | BASS "Adjusts the decay time of the bass frequencies"; "A bright room has less bass response, while warm rooms have a more bass response." CROSS: "the point below which bass frequencies will be boosted by the Bass knob" | The classic Lexicon-style multiplier and crossover. Ours is the Decay EQ (4.6): a low-shelf band *is* BASS and CROSS (×0.25 .. ×4 at a frequency), drawn as seconds |
| **DEC** | "the time it takes for the signal to decay to -60dB (1/1000 of the maximum amplitude)". Up to 20 s | Decay 0.1 .. 60 s, then ∞ (4.2), the RT60 at 1 kHz, measured (9.7 test 1) |
| **DAMP** | "Damping refers to the rate at which the high frequencies decay… Setting this parameter to the maximum value will bypass the High Damping, displaying OFF" | A high-shelf band of the Decay EQ (4.6). FL's OFF at the top of the knob is a convention worth keeping for our cuts: "20: off" (4.2) is the same |
| **DRY**, **ER**, **WET** | Three levels. DRY: "When using Reeverb 2 in a Send mixer track this should be set to 0% (minimum)." ER: "the relative level of the first reflections". WET: "When using Reeverb 2 in a Send Channel this should be set to 100% (maximum)." | One Mix (4.1) with Mix Lock, plus Distance (4.2) for the early / late balance. FL makes the user set Dry to 0 on a send; ours does it for them (`add_vocal_reverb` puts it at 100 % wet, 9.6) |
| **SEP** | "Adjusts the stereo separation of the wet reverb signal. Any dry signal bypassing the reverb is left unaltered." | Width (4.2), 0 .. 150 %, the bass never widened (6.9) |

What it doesn't have: ducking, de-essing, freeze, a gate, a decay display beyond the room picture, presets
on the page (FL's preset menu has its own), A/B. Not stated on the page: its CPU, latency (it's an algorithmic
reverb, so none would be expected **(inferred)**), what happens to the tail when a preset changes.

#### Fruity Convolver

"a real-time Convolution plugin that can be used to add reverberation, create special effects, apply an acoustic
impulse (audio signature) captured from audio equipment/plugins or perform as a linear phase equalizer". Its
credits say "Convolution engine by: LiquidSonics" (the makers of Seventh Heaven). Two areas: knobs on top, and
an editor below that switches between the impulse and an EQ of the impulse.

| Control | What the manual says | Ours |
| --- | --- | --- |
| **Dry**, **Wet** | "Adjusts the level of the dry signal (0 to 100%)"; the wet "(reverb / convolution) sound (0 to 100%)" | Mix (4.1) |
| **Input stereo separation** | "Turn left to maximize stereo separation of the input or right to create a mono input." | Input Mono / Stereo and Input Cross (4.3) |
| **Wet stereo separation** | "Enhance or reduce the stereo effect in the wet output." | Width (4.2) |
| **Normalize** | "Loudness normalization… there can be dramatic differences in gain between them [impulses]." | Our modes' late power gain is normalised "the same in every mode" (6.9), so a mode change doesn't jump in level |
| **Delay** | "Adds a delay to the first reflection from the impulse." Many impulses start with silence; "Fruity Convolver will detect these delays and use the (delay) time to lower CPU load." | Pre-delay (4.2). The CPU trick is convolution's; ours costs nothing in its pre-delay anyway |
| **Self-conv** | "The impulse is convolved with itself before being convolved with the input. This creates a similar effect to putting a reverb on the impulse." | Not proposed |
| **Stretch** | "Uses high quality resampling to change the length & pitch of the impulse… This is not time stretching so the frequency of the impulse response is shifted lower with stretching". "It usually sounds right, unlike time-stretching on the impulse with constant pitch… that often results in phasing artifacts." | Size (4.2). The convolver's stretch changes the pitch; ours mustn't: lengths glide under 3.5 cents when automated, and a fast change starts a second network (6.12, 9.3) |
| **Eq** | "Balance between the Equalized and Normal impulse response." The EQ "acts on the impulse itself, not directly on the audio", drawn over "a frequency spectrograph with time on the vertical axis"; "+12 dB… middle line = no change and bottom of the display = 100% cut (-infinite dB)" | The Post EQ (4.6) changes the level of the wet sound; the Decay EQ (4.6) its length. The convolver can only do the first (an EQ of a fixed impulse can't change how long a band lasts except by its envelope) |
| **Updating** | "There may be a short period of silence when the convolution algorithm updates. Note: Don't touch the Delay, Stretch, Self convolve or Eq controls if an interruption to the sound will be an issue (during live performance for example)." | The opposite of ours: every control glides or crossfades, tails survive edits (6.12, 9.3) |
| **Envelopes** (Pan, Volume, Stereo Separation, an all-purpose one) | "Several standard envelope controls… that act on the Impulse sound": points and tension handles drawn over the impulse, Edison's editor | The Shape display (4.6) shows the reverb's envelope but doesn't edit it freely. A drawn envelope over the tail is Nonlin's territory (4.4, later) |
| **Trigger impulse** | "create a 'click' impulse to create impulses from plugin effects": one instance before an effect fires a click, another after records it | Our `verbAudition` (4.6, later) plays a click through the reverb to hear its shape; the same idea, for listening, not capture |
| **PDC** | "manually set the latency Fruity Convolver reports to FL Studio"; the linear-phase presets "auto-set the Latency control" | Latency 0 (6.15); nothing to set |

What a vocalist gets from it: real spaces and hardware impulses (none shipped by us: "Not a convolution
reverb", section 3), at the price of glitches when its main controls move and no ducking or de-essing. Its
editor's spectrograph is the nearest FL comes to Pro-R 2's decaying spectrum.

#### LuxeVerb

FL's newest reverb (code by Kyle Spratt). Of FL's reverbs, the one whose ideas overlap ours most.

| Control | What the manual says | Ours |
| --- | --- | --- |
| **Wet Gain** (input) | "Level control for the input to the reverb path… Great for 'Reverb throws' where you create bursts of reverb." It "will flash red when the internal input limiter is triggered" | Throws are done by automating the send (7, Throw Wash). An input-level light is cheap and worth having on the In meter (4.7) |
| **High Cut**, **Low Cut** (input) | "Removes high frequencies being input to the reverb." "This filter is included in feedback path (when Reverb Mix is used)." Low Cut "to avoid muddying up the mix" | Input Low / High Cut (4.3) |
| **Decay** | "Overall duration of reverb tail. Approximately in seconds to the -60 dB level." | Decay (4.2), exactly in seconds at 1 kHz, tested (9.7 test 1) |
| **Brightness** | "Set to 100% for the brightest sound (analogous to an acoustic space with hard surfaces), and reduce in order dampen the high frequencies" | A high-shelf band of the Decay EQ (4.6) |
| **Size** | "Spacing of the echo arrivals… this control has no effect on the decay time of the reverb tail (which is controlled exclusively by Decay). Use small values (0 – 10) to simulate an electromechanical or plate-like response, moderate values (10 – 50) for a more 'acoustic' response, and large values (> 50) for cavernous" | Size (4.2): the same independence from Decay. The plate-at-small-sizes rule is one engine doing all; ours has modes (4.4) |
| **Diffusion** | "Mixes in an more 'diffusers' before the reverb… Use this to smooth out the early part of the reverb response" | Diffusion (4.2) |
| **Character** | "Set midway (0.5) for the smoothest and most diffuse reverb tail"; away from it "the reverb arrivals… bunch up, creating a fuzzy-echo effect" | Not proposed as a knob: our modes fix their structure (6.4) |
| **P.Delay** and **T** | "Overall pre-delay on the input to the reverb, in milliseconds." T: "Pre-delay will be tempo-synced, in steps." | Pre-delay with Sync (4.2) |
| **Mod Amp**, **Mod Freq** | "Amplitude of modulation of delay line lengths… produces a chorus-like effect in the reverb tail." | Mod Depth and Rate (4.2) |
| **Freeze Mode**: Normal, Freeze, Sustain | Freeze "Cuts the input to the reverb and sustains the sound"; Sustain "Similar to Freeze, but the input to the reverb is left open, so the sound will continue to build". "This switch is intended for Automation. Keyboard Controller will allow you to trigger Freeze or Sustain from a Piano roll." | Freeze, and Decay ∞ (input left open, 6.13): the same two. Freeze is automatable (9.5); playing it from notes isn't proposed |
| **HQ** | "HQ On – Higher fidelity with more sustained high frequencies, at the expense of some additional CPU usage. HQ Off – Interpolation is grittier and the high frequencies die out more quickly." | No switch: all-pass interpolation in the loop always (6.2); the grit is the eras' job (4.5) |
| **Pitch** (Feedback: Pitch Shift ±12 semitones, Gain, Delay with T, Reverb Mix, its own Low and High Cut; or Feedforward: two voices, each Pitch ±12, Amp, Delay with T) | Feedback is injected "after the Input Low / High Cut filters, pre-delay, and the diffusion stage… Most of the reverb engine is therefore included in the feedback loop." Its cuts "define the frequency band in which the feedback loop operates". The section can be switched off "to save CPU" | Shimmer is "later" (8.1). LuxeVerb's form (a pitch shifter in a loop around the reverb, band-limited, with its own delay) is the one to copy when it comes |
| **Dry**, **Wet** (dB), **Limiter** | Output gains; "Disable the limiter on the wet output" | Mix and Output (4.3); ours limits only at ∞ (6.13) |
| **Peak Freq**, **Gain**, **Q** | One peaking filter "applied to wet signal at end of chain" | The Post EQ (4.6) |
| **Width** | "Set to 0 for a mono wet signal. 1.25 will give the default output of the reverb. While > 1.25 will widen" | Width (4.2): 100 % is as made, up to 150 % |
| **Envelope**: Mode (Off / Wet / Decay), Side Chain, Threshold, Scale, Low Cut, Offset, Attack, Decay, Smooth | "modulate the Reverb > Decay or Output > Wet parameter based on the plugins dry input or a sidechain signal… to create 'Gated' or 'Sidechain' reverb sounds." Scale: "Positive values lead to 'gated reverb'… negative values that lead to 'sidechain reverb' where the reverb tail dips (or ducks)." Side Chain: "Right-click the control to directly select an Input Mixer Track… Available sidechain inputs depend on the Mixer track sends to LuxeVerb's Mixer track." Attack: "Normally leave this set to minimum." Low Cut on the detector: "Low frequencies can confuse the envelope follower" | Our Duck (4.2, 4.3, 6.11) ducks Wet; Auto-Decay (6.11, later) would be LuxeVerb's Decay target. **Worth taking**: one envelope with a signed amount (duck one way, gate the other), a high-pass on the detector, and the sidechain picked from the tracks that send to it (Pro-C's way: `setProCSidechain` makes the send). See 4.1 |
| **Display** | Curves of the input envelope (blue), the threshold (orange), Wet (green) or Decay (red), over "a representation of the wet (reverberated) signal output" | Our Duck meter (4.7) and the Shape display's dotted duck line (4.6). LuxeVerb's live envelope-and-threshold view is clearer for setting a threshold; worth borrowing for the ducker (4.1) |

What FL's users meet, then: a classic Lexicon-style algorithmic box (Reeverb 2, with bass multiplier and
crossover and synced pre-delay), a convolver whose controls interrupt the sound, and a modern one with
ducking, gating, sidechain, freeze and shimmer. None has a de-esser, a decay-by-frequency display or vocal
presets.

---

## 5. What the literature adds

Papers that measured or modelled the reverbs vocal engineers use, and papers on perception and mixing
practice, beyond the design literature `reverb.md` already uses (Dattorro; Jot & Chaigne; Smith's PASP;
Schlecht & Habets 2017; Prawda et al. 2019 and 2020; the FDN Toolbox; the velvet-noise papers; Lokki &
Hiipakka; Werner; Heldmann & Schlecht; Signalsmith; Griesinger).

| Paper | What it found | What it means for us |
| --- | --- | --- |
| **Arcas & Chaigne**, "On the quality of plate reverberation" (Applied Acoustics, 2010), and **Arcas** (ICA 2007), as restated by Willemsen (SMC 2017 and his Aalborg thesis) | An EMT 140 measured and modelled: a steel plate 2 × 1 m, 0.5 mm thick, simply supported, the driver at (0.4, 0.415) of its sides and the pickups at (0.1, 0.45) and (0.85, 0.45). Three losses: thermoelastic (rising with frequency), radiation, and the porous damping plate, whose distance sets the low-frequency decay. "Higher frequencies propagate faster through a metal plate than lower frequencies": the group velocity runs from about 20 to 620 m/s over the audio band. Below 14 kHz such a plate has 18 218 modes | Why a plate is dense at once and has no early reflections (6.4, Plate: no early taps), and why its top dies first and its bass is the damper's (6.4's natural curves: the 10 kHz cap, ×1.5 at 125 Hz). The dispersion is a 30-to-1 spread of speeds, so 6.9's "lean" (low frequencies ~10 ms late) is the plate's physics, not a quirk of one unit **(inferred)**. 18 000 modes is three times the 6000 Schroeder-style density Dal Santo cites (below): our Plate's 0.73 s of delay is 35 000 modes at 48 kHz, plenty |
| **Abel, Berners & Greenblatt**, an EMT 140 emulation with a hybrid reverberator (AES 127th, 2009) (its abstract as a search excerpt: the AES library was down; and Willemsen's account) | The EMT 140 is "approximately linear and time invariant"; its impulse response has "a whip-like onset and high echo density". The onset is "only weakly dependent on the damping control", so it's a short convolution; an FDN fitted to the tail runs beside it, echo density, EQ and decay matched at the hand-over. The damper moves the low-frequency decay between roughly 0.6 and 5.5 s (Willemsen, citing this paper) | A plate's start is fixed and only its tail follows the damper: our Decay should leave the Plate's first 20–50 ms alone and change only how the tail falls (it does: the input diffusers and taps don't depend on Decay). The "whip" is the dispersion (above): a reason to build 6.9's lean. Decay's range in Plate (0.4 to ~8 s) covers the damper's 0.6–5.5 s **(inferred)** |
| **Willemsen et al.**, a virtual-analogue plate reverb on a modal description (SMC 2017; and Willemsen's thesis) | A modal plate (each mode a resonator, its loss from the thermoelastic and radiation laws) in real time; 18 218 modes for the EMT 140, 14 614 once the modes the driver can't excite are dropped (a node at its position), 4593 with the driver in the middle; 9.2 s of sound took about 12 s in MATLAB. Moving the pickups or the size while sound plays gives "flanging and pitch bend effects" | A physical plate is affordable now, but its cost is tens of thousands of resonators against our ~0.75 thousand operations a sample for the Plate (6.14): the figure-eight stays. Moving Size while playing bends pitch in a real plate too: 6.12's 0.2 %-a-sample glide is the right fix |
| **Prawda, Välimäki & Serafin**, "Evaluation of accurate artificial reverberation algorithm" (SMC 2020) | The graphic-EQ FDN (16 lines, 10–100 ms, our 6.6 design) against three measured rooms: the T60 error passed the 5 % just-noticeable difference "in many cases" (an office the worst; a concert hall within 5 % at 63–500 Hz and 2 kHz, 20 % and 50 % off at 8 and 16 kHz), yet "for the qualities reverberance, clarity, and distance, on average 75–79 % of participants noticed only a slight or no difference", with speech and singing voice alike. Misses came where the attenuation needed went past the EQ's ±12 dB, "especially when long delay lines are used to approximate short reverbs" | Test 1's ±10 % (9.7) is the right size: errors past the 5 % JND weren't heard as different on voices. The top octaves are where the design misses (6.6's 4.5 % at 16 kHz is its best case): keep 16 kHz at ±20 % in test 1 and smooth the Decay EQ as 6.6 says. **Watch the corner** of long lines and short decays: Hall at Size 100 % with Decay 0.4 s asks its longest line (111 ms × 2.5) for about −42 dB a pass at 1 kHz, and with the natural curve's ×0.4 at 10 kHz, −104 dB there: a spread of about 60 dB between bands, five times what the graphic EQ is accurate over. The broadband gain takes the mean, but not the spread. So test 1 at Decay 0.4 s must run at Size 100 % too, and Size's range may need to shrink as Decay does (or the shortest decays come from the shelf stage alone) **(inferred: our arithmetic)** |
| **Dal Santo, Prawda, Schlecht & Välimäki**, "Differentiable feedback delay network for colorless reverberation" (DAFx 2023) | The feedback matrix and input and output gains of small FDNs (N = 4, 6, 8) learnt by gradient descent for a flat magnitude response, with a loss against sparse impulse responses. The loudest modes fell by "around 3 dB"; in a MUSHRA test (11 listeners, decaying white noise as the reference) it was "consistently graded as the most colorless", ahead of a random orthogonal and a Householder matrix. Colouration is tied to "the wide distribution of modal excitation values": "modes with strong excitations are perceived as metallic ringing" | Metal is a few modes 3 dB too loud, not too few modes. Test 4 (9.7) measures exactly that (the 99.9th percentile of bin over median). The optimisation is offline: we could learn a better input vector b and tap signs for each mode once, at build time, and ship them as constants **(inferred; later)** |
| **Dal Santo, Prawda, Schlecht & Välimäki**, "Optimizing tiny colorless feedback delay networks" (EURASIP JASMP, 2025) | The same for FDNs of as few as four lines, cheaper to train. "More than 6000 modes are needed for an IR to be perceived as rather colorless" (the total delay in samples is the mode count); delays "logarithmically distributed co-prime numbers"; "the concentration of delays around a certain value may lead to a perceivable strong energy fluctuation over time". Eight comb filters of 53–165 samples ring with resonances about 20 dB louder than the same at 533–1654 samples: "avoid strongly recirculating short delays and instead use long delay lines" | Our sets pass the 6000-mode floor many times over (Room's 0.26 s is 12 500 modes at 48 kHz, more at Size 100 %). Their delay rule is ours (6.4: geometric spreads, primes, ±3 % jitter). Short lines ring: Room's shortest lines (7 ms, about 340 samples) are the ones to watch in test 4 at Size 0 % (×0.5: 3.5 ms) **(inferred)** |
| **Välimäki, Prawda & Schlecht**, "Two-stage attenuation filter for artificial reverberation" (IEEE SPL, 2024) | A graphic EQ "does not adjust the gain at the ends of the frequency range, around dc and the Nyquist limit": with a broadband gain alone a hall's T60 came out "0.4 s below 20 Hz, although 7 s is expected", and "using GEQ only results in instability" (the loop reaches unity gain at DC or Nyquist: a tail that never dies). The fix: a first-order shelf first (it sets the decay at DC and Nyquist, crossover e.g. 300 Hz), then a third-octave graphic EQ for what's left. Over 1000 measured rooms and delays of 10–300 ms, the largest T60 error was 14 %, against over 100 % for the median-gain and notch designs | **A change to 6.6.** Our absorption is ten peak sections, a 20.2 kHz shelf and a broadband gain fitted around the median: exactly the design this paper finds unstable at the ends. Put Jot's first-order shelving filter (6.6's Eco filter, already specified) *before* the graphic EQ in every line, designed from the 31.5 Hz and 16 kHz targets, and fit the EQ to the remainder. Then the Eco and full filters share their first stage, and Eco is the full filter with its EQ flat. **A new check for test 1** (9.7): the T60 at 20 Hz and at 20 kHz finite and within ×2 of the end bands' targets, and no band of the IR still above −60 dB at 3 × T60 |
| **Lee, Bryan & Abel**, a hybrid fixed / switched convolution reverberator (DAFx 2010) | An EMT 140 and a marble lobby rebuilt from their impulse responses: the first part convolved exactly, the late field from a switched convolution with a 70 ms comb, so "less than half a second of convolution" stands in for any length, with "direct control over the equalization and late-field frequency dependent decay rate". It says an FDN finds it "difficult … to provide a good match to the temporal and equalization characteristics of the measured response" | The emulation route (UAD's EMT 140 works this way: Abel was at Universal Audio) is a measured start plus a parametric tail. We have no measured plate to start from, so ours is all parametric; what this tells us is that the start is what makes a plate sound like *that* plate, so it's where an A/B against an EMT 140 recording would show the difference (a later test, not in 9.7) **(inferred)** |
| **Michon, Ducceschi, Cochard, Skare, Webb & Russo**, modal reverberation on CPU, GPU and FPGA (Frontiers in Signal Processing, 2025) | A simply supported plate, "a first approximation to plate reverb units such as the EMT140", run as independent modes at 48 kHz, "three multiplies and two adds per mode". On a CPU, 70 000 modes on one M1 core and 420 000 on eight M2 Max threads within 0.8 s per second of sound; 618 000 on an RTX 4070 | An EMT 140's ~18 000 modes (Willemsen, above) is 90 000 operations a sample, about 30 × our whole Hall (6.14's 2.5–3 thousand): a physical plate would fit on one core but not as one effect among many on a mixer **(inferred)**. A "Physical plate" mode stays out of the first version (8.1) |
| **Parker & Bilbao**, "Spring reverberation: a physical perspective" (DAFx 2009) | A spring's echoes are "highly dispersive", in two regions split at a transition frequency F_C (a minimum of the propagation speed), the high one much quieter; the sound is "mainly related to the region below F_C", set by F_C and the echo period T_D, both from the wire's and helix's sizes (T_D ≈ 4LR/r · √(ρ/E)). Below F_C each frequency travels at three speeds | We build no spring (5.1's modes). What carries over: dispersion is what makes the mechanical reverbs sound like themselves, and it's cheap to imitate with a chain of all-passes (the next row), the same block as 6.9's plate lean |
| **Gamper, Parker & Välimäki**, automated calibration of a parametric spring reverb (DAFx 2011), on **Välimäki, Parker & Abel**, "Parametric spring reverberation effect" (JAES, 2010; abstract only) | The parametric spring is "a spectral delay filter" (a cascade of stretched all-passes: a Schroeder all-pass around K − 1 samples of delay plus a first-order fractional all-pass) inside a loop with a long multi-tap delay, a 40 Hz DC blocker and "a random modulation … applied to the delay line to introduce blurring of the response over time"; its parameters can be fitted from a recorded impulse response automatically | 6.9's plate lean (64 first-order all-passes on one side) is a spectral delay filter; stretched all-passes (each a first-order all-pass in z^−K) give the same group-delay curve with fewer sections, so the lean could cost 8 sections instead of 64 **(inferred; check its ripple)**. Random delay modulation is how they too blur a recursive structure (6.8's Random shape) |
| **Fagerström, Schlecht & Välimäki**, "Non-exponential reverberation modeling using dark velvet noise" (arXiv 2403.20090, submitted to JAES) | Velvet noise whose every pulse goes through one of a set of "dictionary filters", chosen with probabilities that change over time, fits a hall's frequency-dependent decay "with mean and maximum T60 errors of 4 % and 8 %", with half the filters of filtered velvet noise; the model can be "gated", its T60 changed and its spectral evolution and broadband decay "decoupled" | The way to build Nonlin (6.4, later): our plan is velvet taps under one envelope, which gives a gated or reverse tail of one colour. Routing the pulses to a few filters (a dark one more often as time goes on) gives a gated tail that darkens as it goes, as a real gated room does **(inferred)** |
| **Our calculation** from Arcas's EMT 140 constants (thermoelastic R1 = 4.94·10⁻³, C1 = 2.98·10⁻⁴ rad m²/s; radiation from the plate's size; the damping plate left out), as restated by Willemsen | The bare plate's T60: 22 s at 63 Hz, 7.5 s at 125 Hz, 3.6 s at 250 Hz, then a plateau of 2.2–2.6 s from 500 Hz to 4 kHz (thermoelastic loss levels off at 2.35 s), falling only to 2.0 s at 10 kHz and 1.6 s at 16 kHz as radiation takes over **(inferred: worked out from the restated formulas)** | Two things for 6.4. The plate's long bass is the plate itself, and the damper is what tames it: our Plate's ×1.5 at 125 Hz is a damper set fairly close. But the physics gives about 2 s at 10 kHz, where 5.1 and 6.4 (after Costello) cap the Plate at 1.2 s: the short top of a real EMT 140 must come from something the model leaves out (the transducers, the damping plate at high frequencies, the electronics: **not stated** by any source read). The cap stays, since it's what engineers hear and like on vocals, but it's a measured unit's colour, not plate physics |
| **De Man, McNally & Reiss**, "Perceptual evaluation and analysis of reverberation in multitrack music production" (JAES 65(1/2), 2017) | 24 master's students made 80 mixes of 10 songs; 34 skilled listeners rated them. "35.44 % [of comments] mention reverberation"; listeners disagreed on too much or too little "in only 4 of the 525 comments". "The preference rating for a mix the subject found too reverberant is significantly lower than if it was considered too dry": "better to err on the 'dry' side". With the reverb's loudness measured against the dry mix's (relative reverb loudness, EBU loudness of wet minus dry), "every mix with a relative reverb loudness of −9 LU or higher was judged to be too reverberant, and −14 LU appears to be a more desirable loudness". Decay matters too: a logistic model on loudness plus the early decay time (EDT) fitted better (likelihood ratio 7.749, p = .005); mixes with a quiet but long tail were heard as too wet, those with a "strong, yet short and clear" reverb as too dry | **A target for presets and the assistant**: a Lead Vocal preset at its suggested send should land near −14 LU against the dry vocal, never above −9 LU **(inferred: their numbers are for whole mixes, not a vocal alone)**. `add_vocal_reverb` (9.6) could set the send so, and the panel could show the measured reverb loudness beside the meters (4.7) **(inferred; new)**. That EDT counts as well as level is why Duck (6.11) and a shorter Decay make a vocal sound drier at the same Mix. And since too wet costs more than too dry, every preset should start on the dry side |
| **De Man**, "Towards a better understanding of mix engineering" (PhD thesis, Queen Mary University of London, 2017) | 31 % of all listeners' statements concern vocals; "within the category 'space', 58 % of the statements were related to reverb"; reverb "is mentioned in 15 % of all comments by subjects without music production experience, but this increases to 33 % for mix engineers", and "a consistent dislike for overly reverberant mixes can be seen across all levels". His rules: "It is better to err on the side of too little reverb"; "The total reverb loudness should be about −14 LU"; "For a higher perceived amount of reverberation, increase the reverb loudness and/or reverb time". Verbatim listener comments include "Vocals too wet." and "Why is the singer in the bathroom?" | Non-engineers notice reverb half as often as engineers but dislike too much of it just as much: Théo's listeners will hear a too-wet vocal before a too-dry one. Supports 5.2 ("stay behind the voice") and the ducker being on in every Lead Vocal preset |
| **Lindau, Kosanke & Weinzierl**, perceptual mixing time in binaural room responses (JAES 60(11), 2012) | The moment a room's tail can't be told from a diffuse one, found by an adaptive listening test in nine rooms: `t_mp50 = 20 · V/S + 12` ms (V/S the volume over surface, R² 81.5 %), "about two mean free path lengths", and "a reflection density of less than 200 s⁻¹ is perceived as diffuse even by trained listeners" (171 s⁻¹ from the second formula), "considerably lower than those traditionally suggested". Reverberation time predicts nothing beyond its covariation with volume. From an impulse response, Abel and Huang's echo density (the profile reaching 1) predicts it best: `t_mp50 = 0.8 · t_mix − 8` ms (R² 74.7 %). Listeners were most sensitive with a drum sample "with strong transients" | **Checks test 3's numbers** (9.7): a 5 × 4 × 3 m room gives 25 ms, our Room's target exactly; a 40 × 25 × 10 m hall 73 ms, against Hall's 80 ms **(inferred: our arithmetic)**. Abel–Huang's measure is the right one for test 3, and the perceptual mixing time comes a little before η reaches 1, so "0.9 by the mixing time" is a fair pass mark. Their drum finding: run test 3's listening checks with a transient source, not only a vocal. Mixing time doesn't depend on Decay, so test 3 need not run at every Decay |
| **Furlong & O'Donovan**, perceptually relevant artefacts of synthetic reverberation and the EarWig distribution (DAFx 2001) | Graininess and flutter are modulations of each partial's envelope after the reverb: "graineyness can be attributed to a noise-like modulation of signal partials while fluttering is produced by a more regular, less rapid modulation"; peaks in the spectrum of a partial's temporal envelope mark them (shown on a 1480 Hz vibraphone partial through Schroeder reverbs, prime delays fluttering more slowly) | **A test 9.7 lacks**: tests 3 to 6 look at the IR, none at what a held note does in the tail. Add one: a sustained vocal-range tone (or a sung note) through each mode, the envelope of its partial in the tail, and the spectrum of that envelope: no peak between 1 and 30 Hz more than a few dB above the same through a decaying Gaussian noise IR **(inferred: thresholds to set by measuring the reference)**. It would also catch modulation heard as warble (6.8) |
| **Schlecht & Habets**, "Modal decomposition of feedback delay networks" (IEEE TSP; arXiv 1901.08865, 2019) | Every mode of an FDN computed (a pole-finding method up to three orders of magnitude faster): for random lossless FDNs "the mode frequencies are nearly equidistributed and the residue magnitudes follow a log-Rayleigh distribution", so "relatively few modes are contributing a large portion of the late reverberation energy"; adding attenuation filters changed the residues by 0.48 dB on average | The theory under Dal Santo's results and under test 4: the loudest few modes are what's heard as metal, and their spread is random, so a statistical pass mark (test 4's 99.9th percentile against a noise reference) is the right shape |
| **Ibnyahya & Reiss**, "Differentiable attenuation filters for feedback delay networks" (DAFx 2025) | Parametric EQ bands whose frequency, gain and Q are shared by all lines (only the gain scaled by line length) fitted to T60 curves from 1000 rooms: 12 bands matched the two-stage filter (31-band graphic EQ) "while using only 38 % of the operations" (108 against 284 in its table, a 100 ms line at 48 kHz); a 4-band one stays "within ±25 %" | A cheaper middle step between 6.6's Eco filter (6 operations) and the full one (94 here, 284 in the third-octave version): a shelf plus a few parametric bands where the Decay EQ's own bells are. Since our Decay EQ is drawn as bells and shelves anyway, the absorption could use the user's bands directly, scaled per line, with no least-squares solve **(inferred; the exact loss per band is then the self-similarity approximation 6.6 already accepts)** |
| **Koo, Paik & Lee**, "Reverb conversion of mixed vocal tracks using an end-to-end convolutional deep neural network" (ICASSP 2021) | A network that takes the reverb off one vocal and puts another track's on, trained on 32 h of dry studio vocals (singing, rapping, speaking; 34 vocalists) reverberated by "multiple reverb plug-ins"; in a listening test its conversions were preferred at a rate of 64.8 %. Its premise: "even such experienced audio engineers cannot easily judge what the applied reverb is and its detailed settings", because reverbs are black boxes with EQ and compression around them | The only paper found on vocal reverb in finished music. It's not something to build in the engine (a neural network, not a reverb), but it frames a later **Match** feature: the assistant hearing a reference vocal and choosing our mode and settings. The parameters to find would be ours (Decay per band, pre-delay, Size, Mix), which the next two rows show can be estimated |
| **Lee, Choi & Lee**, "Differentiable artificial reverberation" (IEEE/ACM TASLP, 2022; arXiv 2105.13940) (abstract and method read) | Velvet-noise and delay-network reverbs made differentiable by replacing their IIR filters with FIR approximations (frequency sampling), so a network can learn to set their parameters from an impulse response or "blind" from reverberant speech; end-to-end training improved on earlier non-end-to-end estimators "in both objective metrics and subjective listening test results" | Our modes are delay networks with graphic-EQ absorption, the kind this makes learnable. A Match feature could train an estimator offline against our own engine's parameters (rendered with `engineReverb`), then run it in the server when asked **(inferred; later)** |
| **Steinmetz, Ithapu & Calamia**, "Filtered noise shaping for time domain room impulse response estimation from reverberant speech" (WASPAA 2021) (abstract read) | FiNS estimates a room's impulse response straight from reverberant speech, modelled "as a summation of decaying filtered noise signals, along with direct sound and early reflection components"; it matched the target's T60 and DRR and was preferred in a listening test over deep-learning baselines | Its model of a tail (filtered noises, each its own decay) is our test reference (9.7 tests 4 to 6: a Gaussian noise shaped by the T60 curve), used here as a generator: a sign that "decaying noise per band" is the agreed picture of a good tail |
| **Götz, Dal Santo, Schlecht, Välimäki & Habets**, "Matching reverberant speech through learned acoustic embeddings and feedback delay networks" (ICASSP 2026; arXiv 2510.23158) | FDN parameters (per-band decay times and the direct-to-reverberant ratio) estimated blind from reverberant speech; Fréchet audio distance 0.109 against 0.523 for the earlier ARP-net; estimating parameters "is most challenging in the lowest and highest octave bands, where speech does not sufficiently excite the acoustic response" | For Match: a vocal excites little below 125 Hz or above 8 kHz, so a matched Decay EQ should leave the end bands to the mode's natural curve rather than trust an estimate there **(inferred)** |
| **Gabrielli & Ducceschi**, the 1st DAFx parameter-estimation challenge: plate reverberation (DAFx 2026) | Plates as "an archetypal dense, modal and weakly damped acoustic system", simulated as damped Kirchhoff–Love modes with a two-parameter loss `σ = η0 + η1·Ω²` (set by a T60 at DC and one at 500 Hz). Physical parameters could be recovered "down to machine precision"; modal ones were "considerably harder" (best relative error 0.33 on a 0–2 scale), and "every method recovers modal frequencies and decay rates far more accurately than modal gains". No real plate was measured | The plate's loss law used in the field is a constant plus a term rising with the square of frequency, i.e. T60 falling as `1/(a + b·f²)`: a two-number family our Plate's natural curve could be drawn from instead of four hand-set multipliers **(inferred)**. That gains are the hard part echoes Dal Santo: how loud each mode is, not where it is, is what's hard to control and to hear |

What it changes in `reverb.md`, in order of weight:

1. **6.6, the absorption filter**: a first-order shelf in front of the graphic EQ in every line (Välimäki, Prawda and Schlecht 2024), so the decay at DC and Nyquist is set, not left to the EQ's median gain; the Eco filter becomes the full filter's first stage. Test 1 gains a check at 20 Hz and 20 kHz.
2. **9.7, a new test**: the envelope of a held partial in the tail, its spectrum free of the peaks that mark graininess and flutter (Furlong and O'Donovan).
3. **Presets and `add_vocal_reverb`**: aim for a reverb about 14 LU under the dry vocal, never within 9 LU (De Man, McNally and Reiss); err dry.
4. **6.4 and 5.1, the Plate's top end**: keep the 1.2 s cap at 10 kHz, but say it's the EMT 140's measured colour; plate physics alone gives about 2 s there (our calculation).
5. **Test 3's mixing times** stand: Lindau's formula gives 25 ms for a small room and 73 ms for a hall, and Abel–Huang's echo density is the measure that predicts it.
6. **Test 1's ±10 %** stands: a FDN of this design misses the 5 % JND in many bands yet sounds the same on voices to three listeners in four (Prawda, Välimäki and Serafin).

**Gaps.** No paper read measures or reverse-engineers the digital classics: the EMT 250, the Lexicon 224, 224XL and 480L, the AMS RMX16 and the Bricasti M7 have no published topology or measurement (section 6.16 stands: what's known comes from Dattorro, manuals and Costello). No open measurement of a studio echo chamber (Capitol, Abbey Road) was found, nor of the EMT 140's RT60 against damper position beyond the "roughly 0.6–5.5 s" low-frequency range Willemsen quotes from Abel. Nothing measures how much reverb listeners want on a *vocal* rather than on a whole mix (De Man's −14 LU is a mix's), nor ducking, nor pre-delay for pop vocals beyond Griesinger. Nobody measured how many cents of modulation a reverb tail can carry before it's heard as pitch: 6.8's 3-cent line is still **(inferred)**. No study puts a threshold on the plate's dispersion "lean" (6.9). Nothing covers sibilance in a reverb tail (the De-ess's thresholds in 6.3 stay ours to tune). And why a real EMT 140's top octave dies faster than its physics predicts is **not stated** anywhere read.

---

## 6. Sources

Read for this document, 2–3 October 2026. Everything in `reverb.md` 11 stands behind it too.

### 6.1 For part 1: the engineers

Read for this document (2026-10-02). Quotes came back through a fetch tool that extracts text; those asked
for verbatim were checked by a second fetch. Gearspace and Reddit were not read; Mix With The Masters' video
pages and Produce Like A Pro returned 403; the session's search quota ran out before Jimmy Cash, DJ Durel,
Serban Ghenea, Shaan Singh, the *Brat* team, 100 gecs and SOPHIE's engineers could be searched (none of them
has a Sound On Sound *Inside Track* found).

**Sound On Sound, *Inside Track* (Paul Tingen)**

- Future "Draco" (Seth Firkins), May 2017: https://www.soundonsound.com/techniques/inside-track-future-draco
- Lil Baby "Sum 2 Prove" (Thomas "Tillie" Mann), June 2020: https://www.soundonsound.com/techniques/inside-track-lil-baby-sum-2-prove
- Lil Uzi Vert "How To Talk" (Kesha Lee), December 2017: https://www.soundonsound.com/techniques/inside-track-lil-uzi-vert
- 21 Savage "A Lot" (Maddmix), March 2019: https://www.soundonsound.com/techniques/inside-track-21-savage?page=2
- Cardi B "Bodak Yellow" (Evan LaRay), February 2018: https://www.soundonsound.com/techniques/inside-track-cardi-b-bodak-yellow
- YoungBoy "Loner Life" (Jason "Cheese" Goldberg), October 2022: https://www.soundonsound.com/techniques/inside-track-youngboy-loner-life
- MoneyBagg Yo "Wockesha" (Ari Morris), January 2022: https://www.soundonsound.com/techniques/inside-track-moneybagg-yo-wockesha
- Trippie Redd *A Love Letter To You 5* (Koen Heldens), October 2023: https://www.soundonsound.com/techniques/inside-track-trippie-redd-love-letter-you-5
- Lil Tecca "Ransom" (Joseph Colmenero), November 2019: https://www.soundonsound.com/techniques/inside-track-lil-tecca-ransom
- Polo G "Rapstar" (Todd Hurtt), September 2021: https://www.soundonsound.com/techniques/inside-track-polo-g-rapstar?page=2
- Metro Boomin *Heroes & Villains* (Ethan Stevens), April 2023: https://www.soundonsound.com/techniques/inside-track-metro-boomin-heroes-villains
- Young Thug & Gunna "Ski" (Bainz), July 2021: https://www.soundonsound.com/techniques/inside-track-young-thug-gunna-ski
- Rod Wave "Street Runner" (Travis Harrington): https://www.soundonsound.com/techniques/inside-track-rod-wave-street-runner
- Pop Smoke "Woo" (Jess Jackson), November 2020: https://www.soundonsound.com/techniques/inside-track-pop-smoke-woo
- DaBaby "Intro" (Kevin McCloskey): https://www.soundonsound.com/techniques/inside-track-dababy-intro?page=2
- Stormzy "Hide & Seek" (Leandro "Dro" Hidalgo), January 2023: https://www.soundonsound.com/techniques/inside-track-stormzy-hide-seek
- Kendrick Lamar *To Pimp A Butterfly* (Derek Ali), June 2015: https://www.soundonsound.com/techniques/inside-track-kendrick-lamars-pimp-butterfly
- Kendrick Lamar & SZA "All The Stars" (Matt Schaeffer), May 2018: https://www.soundonsound.com/techniques/inside-track-kendrick-lamar-black-panther-all-stars
- NF "The Search" (Tommee Profitt): https://www.soundonsound.com/techniques/inside-track-nf-search?page=2
- The Weeknd "The Hills" (Illangelo), December 2015: https://www.soundonsound.com/techniques/inside-track-weeknd
- Chris Brown "Heat" (Patrizio Pigliapoco), September 2019: https://www.soundonsound.com/techniques/inside-track-chris-brown-heat
- SZA "Kill Bill" (Rob Bisel), March 2023: https://www.soundonsound.com/techniques/inside-track-sza-kill-bill
- Beyoncé & Jay-Z "Apeshit" (Stuart White), September 2018: https://www.soundonsound.com/techniques/inside-track-beyonce-and-jay-z-apeshit
- Pharrell "Happy" (Leslie Brathwaite), May 2014: https://www.soundonsound.com/techniques/inside-track-pharrell-williams-happy
- Drake "Headlines" (Noah "40" Shebib), March 2012: https://www.soundonsound.com/techniques/noah-40-shebib-recording-drakes-headlines
- Burna Boy "Time Flies" (Jesse Ray Ernster): https://www.soundonsound.com/techniques/inside-track-burna-boy-time-flies
- Doja Cat "Say So" (Clint Gibbs), July 2020: https://www.soundonsound.com/techniques/inside-track-doja-cat-ft-nicki-minaj-say-so
- Olivia Rodrigo "drivers license" (Mitch McCarthy), April 2021: https://www.soundonsound.com/techniques/inside-track-olivia-rodrigo-drivers-license
- Olivia Rodrigo "vampire" (Dan Nigro), April 2024: https://www.soundonsound.com/techniques/inside-track-olivia-rodrigo-vampire
- Dua Lipa "Don't Start Now" (Ian Kirkpatrick), May 2020: https://www.soundonsound.com/techniques/inside-track-dua-lipa-dont-start-now
- Lady Gaga "Rain On Me" (Benjamin Rice), August 2020: https://www.soundonsound.com/techniques/inside-track-lady-gaga-rain-me
- Charli XCX "New Shapes" (Geoff Swan), June 2022: https://www.soundonsound.com/techniques/inside-track-charli-xcx-new-shapes
- Julian Bunetta, September 2024: https://www.soundonsound.com/techniques/inside-track-julian-bunetta
- Taylor Swift "willow" (Jonathan Low), March 2021: https://www.soundonsound.com/techniques/inside-track-taylor-swift-willow
- Billie Eilish "bad guy" (Rob Kinelski), July 2019: https://www.soundonsound.com/techniques/inside-track-billie-eilish-bad-guy; Finneas: https://www.soundonsound.com/people/billie-eilish?page=2
- Kesha "Praying" (Jon Castelli), November 2017: https://www.soundonsound.com/techniques/inside-track-kesha-praying
- Selena Gomez "Rare" (Tony Maserati), April 2020: https://www.soundonsound.com/techniques/inside-track-selena-gomez-rare
- Shawn Mendes "Treat You Better" (George Seara), December 2016: https://www.soundonsound.com/techniques/inside-track-shawn-mendes-treat-you-better
- Justin Timberlake *The 20/20 Experience* (Chris Godbey): https://www.soundonsound.com/techniques/inside-track-justin-timberlakes-2020-experience
- The Chainsmokers & Halsey "Closer" (DJ Swivel): https://www.soundonsound.com/techniques/inside-track-chainsmokers-closer
- *KPop Demon Hunters* (Curtis Douglas), 2025: https://www.soundonsound.com/techniques/inside-track-kpop-demon-hunters
- TWICE "Scientist" (Taesub Lee), February 2022: https://www.soundonsound.com/techniques/inside-track-twice-scientist?page=2
- Lana Del Rey "Lust For Life" (Kieron Menzies & Dean Reid): https://www.soundonsound.com/techniques/inside-track-lana-del-rey-lust-life
- Clean Bandit "Solo" (Mark Ralph): https://www.soundonsound.com/techniques/inside-track-clean-bandit-solo?page=3
- Panic! At The Disco (Claudius Mittendorfer): https://www.soundonsound.com/techniques/inside-track-panic-disco
- Tones And I "Dance Monkey" (Konstantin Kersting), January 2020: https://www.soundonsound.com/techniques/inside-track-tones-and-dance-monkey?page=2
- Djo "End Of Beginning" (Adam Thein), April 2026: https://www.soundonsound.com/techniques/inside-track-djo-end-beginning
- Rihanna "SOS" / "Unfaithful" (Phil Tan), February 2007: https://www.soundonsound.com/techniques/inside-track-rihanna-sos-unfaithful
- Matty Moon, mixing Neue York's "Silence", October 2020: https://www.soundonsound.com/techniques/sound-design-mix
- Read, no vocal reverb content: Steve Lacy "Bad Habit", *Barbie*, FKA Twigs "Eusexua", Lil Nas X "Old Town Road"

**Sound On Sound, *Secrets Of The Mix Engineers* and technique articles**

- Dave Pensado, January 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-david-pensado
- Chris Lord-Alge, May 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-chris-lord-alge
- Jason Goldstein, April 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-jason-goldstein
- Jack Joseph Puig, November 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-jj-puig
- Robert Orton, March 2009: https://www.soundonsound.com/techniques/secrets-mix-engineers-robert-orton
- Michael Brauer, November 2008: https://www.soundonsound.com/techniques/secrets-mix-engineers-michael-brauer
- Bob Clearmountain, February 2009: https://www.soundonsound.com/techniques/secrets-mix-engineers-bob-clearmountain
- Manny Marroquin, December 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-manny-marroquin
- Jaycen Joshua, August 2010: https://www.soundonsound.com/techniques/secrets-mix-engineers-jaycen-joshua
- Spike Stent, February 2010: https://www.soundonsound.com/techniques/secrets-mix-engineers-mark-spike-stent
- Fabian Marasciullo, August 2008: https://www.soundonsound.com/techniques/secrets-mix-engineers-fabian-marasciullo; December 2011: https://www.soundonsound.com/techniques/fabian-marasciullo-recording-lil-waynes-how-love
- Young Guru, December 2009: https://www.soundonsound.com/techniques/secrets-mix-engineers-young-guru
- Jimmy Douglass, July 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-jimmy-douglass
- Rich Costey, March 2008: https://www.soundonsound.com/techniques/secrets-mix-engineers-rich-costey
- Tom Elmhirst, August 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-tom-elmhirst
- Tony Maserati, March 2007: https://www.soundonsound.com/techniques/secrets-mix-engineers-tony-maserati
- Mike Senior, "How To Use Reverb Like A Pro: 1", July 2008: https://www.soundonsound.com/node/4910076 (pages 2–4); Part 2, August 2008: https://www.soundonsound.com/techniques/how-use-reverb-pro-part-2
- Paul White, "Choosing The Right Reverb", March 2006: https://www.soundonsound.com/techniques/choosing-right-reverb; "Improving The Sound Of Your Reverb", August 1996: https://www.soundonsound.com/techniques/improving-sound-your-reverb

**Other interviews and teaching**

- Jaycen Joshua, Mix With The Masters community Q&A "Lead Vocal Reverb", June 2024: https://community.mwtm.com/t/lead-vocal-reverb/7296
- Alex Tumay, Red Bull Music Academy lecture, 2016: https://www.redbullmusicacademy.com/lectures/alex-tumay-lecture/
- Chris Dennis (Roddy Ricch), Revolt, March 2020: https://revolt.tv/2020/3/19/21186606/roddy-ricch-engineer-chris-dennis-interview
- Josh Gudwin, Mix, August 2021: https://www.mixonline.com/recording/profiles/josh-gudwin-on-mixing-part-2-bringing-it-for-justin-bieber
- Finneas, Mix, January 2020: https://www.mixonline.com/recording/finneas-on-producing-billie-eilishs-number-one-album-in-his-bedroom
- Rob Kinelski, Waves, July 2019: https://www.waves.com/breaking-the-mix-rules-with-billie-eilish-rob-kinelski; UA: https://www.uaudio.com/blogs/ua/helping-billie-eilish-craft-hits
- Patrizio Pigliapoco, Antares, October 2018: https://www.antarestech.com/blog/patrizio-pigliapoco
- Bobby Owsinski, Music Connection, January 2013: https://www.musicconnection.com/reverb-delay-tips-tricks-pros/ (pages 1–3); "How To Time Reverb To The Pulse Of The Song", July 2019: https://bobbyowsinskiblog.com/reverb-timing/; ProSoundWeb, July 2011: https://www.prosoundweb.com/inside-the-studio-the-quick-and-easy-mix-effects-setup/
- FabFilter Pro-R 2 help, main controls and pre-delay: https://www.fabfilter.com/help/pro-r/using/maincontrols, https://www.fabfilter.com/help/pro-r/using/predelay
- Read, nothing on reverb: Ethan Stevens in XXL (https://www.xxlmag.com/engineer-ethan-stevens-future-gunna-interview/), Bainz in Recording (https://www.recordingmag.com/news/recording-vocals-in-the-control-room-with-bainz-young-thugs-go-to-mix-engineer/), Kesha Lee in RBMA Daily, Mitch McCarthy in Mix, Dan Nigro in MusicRadar and UA, A. G. Cook in MusicRadar, Tape Notes' Charli XCX page
- Everything in `reverb.md`'s Sources ("Engineers, in their own words") also stands behind the rows carried over from it

### 6.2 For part 2: the units

Read for this part (2026-10-02). valhalladsp.com through the Internet Archive's copies. Numbers read off a
scanned graph are marked **(inferred)** where they're used.

**The plates (2.1, 2.2)**

- EMT 140 TS Reverberation Unit brochure, April 1971 (text, technical data, RT graph): https://www.barryrudolph.com/recall/manuals/emt140ts.pdf
- EMT 240 Gold Foil leaflet and article (technical data, RT graph, modal density): https://www.preservationsound.com/wp-content/uploads/2013/09/EMT_240_reverb.pdf
- UAD plug-ins manual, the EMT 140 chapter: https://media.uaudio.com/assetlibrary/u/a/uad_plug-ins_manual.pdf
- UA: EMT 140 product page https://www.uaudio.com/products/emt-140; "EMT reverb history" https://www.uaudio.com/blogs/ua/emt-reverb-history; "EMT 140 & 250 explained" https://www.uaudio.com/blogs/ua/emt-140-250-classic-uad-reverbs-explained; "5-minute EMT 140" https://www.uaudio.com/blogs/ua/5-minute-emt-140; "How to use reverb on vocals" https://www.uaudio.com/blogs/ua/how-to-use-reverb-on-vocals; "Reverb roundtable" (Killen, Martine) https://www.uaudio.com/blogs/ua/reverb-roundtable; "Recreating the reverb of Motown" https://www.uaudio.com/blogs/ua/recreating-the-reverb-of-motown; UA WebZine, history of EMT (2004): https://web.archive.org/web/2010/http://www.uaudio.com/webzine/2004/may/text/content4.html
- Waves Abbey Road Reverb Plates user guide: https://assets.wavescdn.com/pdf/plugins/abbey-road-reverb-plates.pdf; SOS review: https://www.soundonsound.com/reviews/waves-abbey-road-reverb-plates
- Arturia Rev PLATE-140 manual: https://www.arturia.com/api/download/products/rev-plate140/manual/ReverbPlate_Manual_1_0_0_EN.pdf
- Soundtoys SuperPlate user's guide: https://www.soundtoys.com/wp-content/uploads/SuperPlate-Manual.pdf
- LiquidSonics Lustrous Plates user guide: https://us-east-1.linodeobjects.com/liquidsonics/software/lustrous-plates/manual/Lustrous_Plates_Manual.pdf
- Valhalla DSP (Costello): "The physics and psychophysics of plates" https://web.archive.org/web/2024/https://valhalladsp.com/2015/11/08/the-physics-and-psychophysics-of-plates/; "Chambers versus plates" https://web.archive.org/web/2024/https://valhalladsp.com/2015/11/07/chambers-versus-plates/; "Plate tips" (Don Gunn) https://web.archive.org/web/2024/https://valhalladsp.com/2017/06/15/plate-tips/; "ValhallaPlate: the reverb modes" https://web.archive.org/web/2024/https://valhalladsp.com/2015/11/08/valhallaplate-the-reverb-modes/; "ValhallaPlate: the controls" https://web.archive.org/web/2024/https://valhalladsp.com/2015/11/08/valhallaplate-the-controls/; "Chambers and plates and bears, oh my" https://web.archive.org/web/2024/https://valhalladsp.com/2017/05/23/chambers-and-plates-and-bears-oh-my/
- S. Bilbao, "Electromechanical effects" (DAFx 2010 tutorial): https://ccrma.stanford.edu/~bilbao/dafx10/electro.pdf; plate reverberation page: https://www2.ph.ed.ac.uk/~sbilbao/platerevpage.htm
- S. Willemsen, *Virtual analog simulation and extensions of plate reverberation*, master's thesis, Aalborg 2017 (Arcas and Chaigne's losses and positions, Abel et al.'s hybrid, quoted): https://projekter.aau.dk/projekter/files/259831180/Master_Thesis_Silvin_Willemsen_SMC171032___2.pdf
- M. Ducceschi, C. Webb, plate reverberation, ICA 2016: http://mdphys.org/PDF/icaPLA_2016.pdf
- R. Michon et al., modal reverberation, Frontiers in Signal Processing 2025: https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2025.1522604/pdf
- P. White, "Choosing the right reverb", SOS, March 2006: https://www.soundonsound.com/techniques/choosing-right-reverb
- MusicTech, "Vintage: EMT 140S" (secondary): https://musictech.com/reviews/emt-140s
- Barry Rudolph, Heritage Audio HA240 review (secondary): https://www.barryrudolph.com/reviews/heritage_audio_ha240.html
- Aberdeen museum, EMT 140 no. 569: https://emuseum.aberdeencity.gov.uk/objects/28886/emt-140-no-569-reverberation-plate
- Wikipedia, Elektromesstechnik (secondary): https://en.wikipedia.org/wiki/EMT_140

**AMS RMX16 (2.7)**

- RMX16 user manual 527-030, Issue 3 (theory of operation, specifications, programs): https://www.barryrudolph.com/recall/manuals/ams_neve_rmx_16.pdf
- RMX16 500 Series user manual, Issue 2: https://www.ams-neve.com/wp-content/uploads/2021/08/rmx-16-500-series-user-manual-issue-2.pdf
- UA, AMS RMX16 Expanded manual: https://media.uaudio.com/support/manuals/dd/AMS%20RMX16%20Expanded%20Manual.pdf; product page: https://www.uaudio.com/products/rmx-16-expanded; press release, 16 September 2014: https://www.uaudio.com/blogs/press/ams-rmx-16
- SOS, UA RMX16 (H. Robjohns, 2015): https://www.soundonsound.com/reviews/ua-rmx16; AMS RMX16 500 (2020): https://www.soundonsound.com/reviews/ams-rmx16
- MusicRadar / Computer Music, RMX16 plug-in review (secondary): https://www.musicradar.com/reviews/tech/ams-neve-ams-rmx16-digital-reverb-612089

**Bricasti M7 (2.11)**

- M7 owner's manual, rev. 5.02.08: https://www.bricasti.com/images/M7.pdf
- M7 preset parameter sheet: https://www.bricasti.com/images/preset_sheet.pdf
- M7 V2 manual addendum (23 July 2010): https://www.bricasti.com/images/M7_V2_Manual_Addendum.pdf
- Bricasti M7 page and downloads: https://www.bricasti.com/en/pro/m7.php, https://www.bricasti.com/en/pro/downloads.php
- LiquidSonics Seventh Heaven Professional user guide v1.5.7: https://us-east-1.linodeobjects.com/liquidsonics/software/seventh-heaven-professional/manual/Seventh_Heaven_Professional_Manual.pdf
- SOS, Bricasti Model 7 (P. White, 2008): https://www.soundonsound.com/reviews/bricasti-design-model-7; Seventh Heaven Professional (S. Inglis, 2017): https://www.soundonsound.com/reviews/liquidsonics-seventh-heaven-professional
- Tape Op #69, M7 review (J. Hamilton, via a summarising fetch): https://tapeop.com/reviews/gear/69/m7-stereo-reverb-processor
- SOS Inside Track, Jorja Smith "Try Me": https://www.soundonsound.com/techniques/inside-track-jorja-smith-try-me

**Lexicon 480L (2.5)**

- Lexicon 480L owner's manual (software 4.0; programs, parameters, specifications): https://freeverb3-vst.sourceforge.io/doc/Lexicon/lexicon_480l.pdf
- D. Griesinger, "Practical processors and programs for digital reverberation", Lexicon, 21 March 1989: https://freeverb3-vst.sourceforge.io/doc/10.1.1.72.5367.pdf
- D. Griesinger, "Improving room acoustics through time-variant synthetic reverberation" (1991; the time-variant reverberators): https://freeverb3-vst.sourceforge.io/doc/test.pdf
- freeverb3's reference list (where these papers are kept): https://freeverb3-vst.sourceforge.io/ref.shtml
- Relab LX480 product page: https://relabdevelopment.com/lx480-dual-engine-reverb/; learning centre: https://relabdevelopment.com/lc-article-taxonomy/lx480-dual-engine-reverb/; "How to do a sample-accurate test": https://relabdevelopment.com/learning-center/how-to-do-a-sample-accurate-test-to-compare-the-relab-lx480-to-the-lexicon-480l/; "How to create vintage reverb sounds": https://relabdevelopment.com/learning-center/how-to-create-vintage-reverb-sounds-using-the-lx480/; "How to create realistic sounding spaces": https://relabdevelopment.com/learning-center/how-to-create-realistic-sounding-spaces-using-the-lx480-dual-engine-reverb-plug-in/; "What's new in LX480 V4": https://relabdevelopment.com/learning-center/the-relab-lx480-dual-engine-reverb-plug-in/whats-new-in-lx480-v4/; factory banks (Random Hall, Plates): https://relabdevelopment.com/learning-center/the-original-factory-preset-pack/lx480-original-factory-preset-bank-random-hall/, https://relabdevelopment.com/learning-center/the-original-factory-preset-pack/lx480-original-factory-preset-bank-plates/
- KVR: Relab on RHall HD: https://www.kvraudio.com/forum/viewtopic.php?p=6705434; Costello on the 480L's algorithms (January 2013): https://www.kvraudio.com/forum/viewtopic.php?p=5191283
- UAD 480L reviews: Tape Op #132 (D. Gunn): https://tapeop.com/reviews/gear/132/lexicon-480l-plug-in; SOS (P. White): https://www.soundonsound.com/reviews/universal-audio-uad-97; Mix (R. Tozzoli): https://www.mixonline.com/technology/review-universal-audio-uad-lexicon-480l-plug-in; *Recording* (P. Vnuk Jr., with W. Shanks): https://recordingmag.com/?p=7746; Sonicstate (P. Lavigne): https://sonicstate.com/news/2018/11/12/lexicon-480l-powered-plug-in/; Production Expert (M. Cousins): https://www.production-expert.com/video-reviews/2017/5/9/review-relab-development-lx480-reverb-plugin
- SOS, Relab LX480 Essentials (S. Inglis, 2021): https://www.soundonsound.com/node/4926629
- Audiofanzine, LX480 Lite news: https://en.audiofanzine.com/algorithmic-reverb/relab-development/lx480-lite/news/a.play,n.7457.html
- Softube TSAR-1: https://www.softube.com/plug-ins/tsar-1-reverb
- Wikipedia, Lexicon (company) (secondary): https://en.wikipedia.org/wiki/Lexicon_(company)

**EMT 250 and Lexicon 224 (2.3, 2.4)**

- UAD plug-ins manual, chapters 10 (EMT 250) and 17 (Lexicon 224): https://media.uaudio.com/assetlibrary/u/a/uad_plug-ins_manual.pdf
- J. Dattorro, "Effect Design, Part 1" (footnotes 5 and 6 on the 224 and the EMT 250): https://ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf (read as https://freeverb3-vst.sourceforge.io/doc/EffectDesignPart1.pdf)
- Mix, "1976 EMT Model 250 digital reverb": https://www.mixonline.com/technology/1976-emt-model-250-digital-reverb-377973; "1978 Lexicon 224 digital reverb": https://www.mixonline.com/technology/1978-lexicon-224-digital-reverb-383667
- Arturia Rev LX-24 manual: https://www.arturia.com/api/download/products/rev-lx-24/manual/rev-lx-24_Manual_1_0_1_EN.pdf
- S. Costello, "Algorithmic reverbs, distortion, and noise" (2011, edited 2013): https://valhalladsp.com/2011/07/07/algorithmic-reverbs-distortion-and-noise/; "Modulation in reverbs: reality and unreality" (2009): https://valhalladsp.com/2009/07/30/modulation-in-reverbs-reality-and-unreality/ (both through the Internet Archive)

**Lexicon PCM90, 960L, PCM Native (2.6)**

- PCM90 user guide (freeverb3's Lexicon folder, through the Internet Archive): https://web.archive.org/web/2020id_/http://freeverb3vst.osdn.jp:80/doc/Lexicon/pcm90.pdf
- 960L owner's manual, rev. 2 (same folder): https://web.archive.org/web/2020id_/http://freeverb3vst.osdn.jp:80/doc/Lexicon/lexicon_960L_rev2_manual.pdf
- PCM70 owner's manual (same folder; scanned, not readable as text): https://web.archive.org/web/2020id_/http://freeverb3vst.osdn.jp:80/doc/Lexicon/pcm70-om.pdf
- Lexicon PCM Native Reverb Bundle owner's manual: https://goknight.com/content/documentation/PCM_Reverb_Manual_18-0708-C%20(1).pdf

**SP2016, Quantec, Yamaha, chambers and springs (2.8–2.10, 2.12, 2.13)**

These sections were written from sources read for the other parts (their researcher stalled before reading
the units' own manuals, and the session's search quota had run out): the engineers in part 1 (Pensado, Jess
Jackson, Low, Castelli, Seara, Bisel), Costello's Palace notes (part 3), and the manuals in part 4:

- Logic Pro, Quantec Room Simulator, its QRS and YardStick controls (guide 12.3): https://support.apple.com/guide/logicpro/lgcpd2222833, https://support.apple.com/guide/logicpro/lgcpc78cf8c2, https://support.apple.com/guide/logicpro/lgcp1f4184df
- Slate Digital VerbSuite Classics user guide: https://support.slatedigital.com/hc/en-us/article_attachments/115001296108
- Relab Sonsig Rev-A manual: https://relabdevelopment.com/public/manuals/Sonsig_Rev-A_Manual.pdf
- UA, Capitol Chambers manual: https://help.uaudio.com/hc/en-us/articles/18741463946516
- Waves Abbey Road Chambers user guide: https://assets.wavescdn.com/pdf/plugins/abbey-road-chambers.pdf
- Eventide SP2016 Reverb user guide (as cited in `reverb.md` 11): https://www.eventideaudio.com/downloads/sp2016-reverb-user-guide/
- Arturia Rev SPRING-636 manual: https://www.arturia.com/api/download/products/rev-spring636/manual/rev-spring-636_Manual_1_0_2_EN.pdf
- Softube Spring Reverb manual: https://www.softube.com/user-manuals/Spring-Reverb
- J. Parker, S. Bilbao, "Spring reverberation: a physical perspective", DAFx 2009 (part 5)
- **Not read**: the SP2016's, REV7's and SPX90's own manuals; any measurement of a studio chamber

### 6.3 For part 3: VintageVerb and Pro-R 2

Read 2026-10-02. valhalladsp.com (Cloudflare) through web.archive.org; KVR's forum through web.archive.org;
KVR's product pages through a summarising fetch.

**Valhalla VintageVerb**

- Valhalla DSP, "Valhalla VintageVerb" (product page, version 4.0.5, modes, colours, changelog):
  https://valhalladsp.com/shop/reverb/valhalla-vintage-verb/ (archived:
  https://web.archive.org/web/2025/https://valhalladsp.com/shop/reverb/valhalla-vintage-verb/); its 2016
  version (15 modes, "new in 1.5.0")
- Sean Costello, "Valhalla VintageVerb: The MODES" (2023): https://valhalladsp.com/2023/02/10/valhallavintageverb-the-modes/
- Sean Costello, "ValhallaVintageVerb 4.0.0 Update. New Reverb Modes: Chamber1979 and Hall1984." (2023):
  https://valhalladsp.com/2023/12/13/valhallavintageverb-4-0-0-new-reverb-modes-chamber1979-and-hall1984/
- Sean Costello, "ValhallaVintageVerb Updated to 3.0.0. New Reverb Mode: Palace!" (2023):
  https://valhalladsp.com/2023/01/25/valhallavintageverb-updated-to-3-0-0-new-reverb-mode-palace/
- Sean Costello, "ValhallaVintageVerb 1.7.1 update released. Chaos. Reigns." (2017):
  https://valhalladsp.com/2017/05/06/valhallavintageverb-1-7-1-chaos-reigns/
- Valhalla DSP, "The Best Reverb Plugin For…" (2022): https://valhalladsp.com/2022/09/29/the-best-reverb-plugin-for/
- Sean Costello, "Diffusion, vocals, and real rooms" (2010): https://valhalladsp.com/2010/06/07/diffusion-vocals-and-real-rooms/
- Sean Costello, "Reverb 101: Size" (2018): https://valhalladsp.com/2018/07/09/reverb-101-size/
- Sean Costello, "Algorithmic reverbs, distortion, and noise" (2011, edited 2013):
  https://valhalladsp.com/2011/07/07/algorithmic-reverbs-distortion-and-noise/
- Valhalla DSP, "Demos & Downloads" (the demo installers): https://valhalladsp.com/demos-downloads/; the
  4.0.5 demo read for ranges, defaults, tooltips and factory presets:
  https://valhallaproduction.s3.us-west-2.amazonaws.com/vintageverb/demo/ValhallaVintageVerbOSXDemo_4_0_5.dmg
- KVR forum, "ValhallaVintageVerb 1.7.1. Two new reverb modes (Chaotic Hall, Chaotic Chamber)" (the launch
  thread, Costello's first post with the versions; Mod Rate = Spin): https://www.kvraudio.com/forum/viewtopic.php?t=368492
- KVR forum, "Post yer ValhallaVintageVerb presets (& preset requests) here!" (Costello on matching the
  Lexicons): https://www.kvraudio.com/forum/viewtopic.php?t=372920
- Synthtopia, "ValhallaVintageVerb – 'A Postmodern Reverb Plugin'" (launch, 19 December 2012): https://synthtopia.com/?p=46466
- Computer Music / MusicRadar, "ValhallaDSP VintageVerb review" (2013): https://www.musicradar.com/reviews/tech/valhalladsp-vintageverb-574692
- Musician Wave, "ValhallaDSP VintageVerb Review": https://www.musicianwave.com/valhalla-dsp-vintageverb-review/
- Valhalla FutureVerb's user guide (the Mix lock's purpose):
  https://val-media-offload.s3.amazonaws.com/wp-content/uploads/2025/11/19234817/ValhallaFutureVerb-User-Guide-v1.2.pdf
  (as cited in `reverb.md` 11)

**FabFilter Pro-R 2**

- FabFilter, "FabFilter Pro-R 2 user manual" (PDF): https://www.fabfilter.com/downloads/pdf/help/ffpror2-manual.pdf;
  online help: https://www.fabfilter.com/help/pro-r
- FabFilter, "FabFilter Pro-R 2 - Reverb Plug-In" (product page): https://www.fabfilter.com/products/pro-r-2-reverb-plugin
- FabFilter, news (Pro-R 2 released 2 November 2023; 2.01): https://www.fabfilter.com/news
- FabFilter, download page (the 2.06 trial, read for ranges, defaults, help hints and factory presets):
  https://www.fabfilter.com/download; https://cdn-b.fabfilter.com/downloads/ffpror206.dmg
- FabFilter Learn, "Basic reverb controls": https://www.fabfilter.com/learn/reverb/basic-reverb-controls/;
  "How to use reverb": https://www.fabfilter.com/learn/reverb/how-to-use-reverb/
- Alex Holmes, "FabFilter Pro-R 2 is a flexible reverb that you'll use more often than you think", MusicTech
  (16 November 2023): https://musictech.com/reviews/plug-ins/fabfilter-pro-r-2-review/
- Sam Inglis, "FabFilter Pro-R", Sound On Sound (March 2017): https://www.soundonsound.com/reviews/fabfilter-pro-r
- Computer Music / MusicRadar, "FabFilter Pro-R review": https://www.musicradar.com/reviews/tech/fabfilter-pro-r-646592
- Matt Mullen, MusicRadar news on Pro-R 2's release: https://www.musicradar.com/news/fabfilter-pro-r-2-reverb-plugin
- KVR, "Pro-R 2 by FabFilter" and its user reviews: https://www.kvraudio.com/product/pro-r-2-by-fabfilter,
  https://www.kvraudio.com/product/pro-r-2-by-fabfilter/reviews

**Tools**

- Spotify, `pedalboard` 0.9.17 (a Python plug-in host; used to read parameter ranges, defaults and the text
  each plug-in shows for a value): https://github.com/spotify/pedalboard

### 6.4 For part 4: other reverbs

**FL Studio** (Image-Line's online manual)

- Fruity Reeverb 2 https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20Reeverb%202.htm
- Fruity Convolver https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20Convolver.htm
- LuxeVerb https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/LuxeVerb.htm
- Fruity Reeverb (legacy) https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20Reeverb.htm
- FL Studio 20.99 beta thread (LuxeVerb's first feedback, ksprt's answers) https://forum.image-line.com/viewtopic.php?p=1768610

**The other DAWs**

- Ableton, "Live Audio Effect Reference" (Live 12: Reverb, Hybrid Reverb) https://www.ableton.com/en/manual/live-audio-effect-reference/
- Apple, Logic Pro User Guide 12.3 (support.apple.com/guide/logicpro/, pages lgcp18cc0940, lgcp11de9ce7,
  lgcp0f5cd663, lgcp304c206a, lgcp779bc314, lgcpe44e3b28 for ChromaVerb; lgce357aa791, lgcef2af4d05,
  lgcef2af48f5, lgcef2af57c5, lgcef2af4784, lgcef2af49ae, lgcee0be400c, lgcece95b995, lgcef2af52db for Space
  Designer; lgcef29693d1 SilverVerb; lgcpd2222833, lgcpc78cf8c2, lgcp1f4184df Quantec Room Simulator)
- Digidesign, *DigiRack Plug-ins Guide* (2009, D-Verb), a mirror https://apps.spokane.edu/InternetContent/AutoWebs/steveg/DigiRack%20Plug-ins%20Guide.pdf
- Avid Space product page, archived copy of https://www.avid.com/plugins/space (web.archive.org)
- Bitwig user guide, Reverb and Convolution https://www.bitwig.com/userguide/latest/reverb15
- REAPER Effects Guide (2021) https://www.reaper.fm/userguide/REAPEREffectsGuide2021.pdf; Up and Running: A REAPER
  User Guide v7.81 https://www.reaper.fm/userguide/ReaperUserGuide781c.pdf
- Fender Studio Pro (Studio One) manual, "Reverb" (Mixverb, Open AIR 2, Room Reverb, Studio Verb) https://fenderstudiopromanual.fender.com/en/Content/Built-In_Effects_Topics/Reverb.htm
- Steinberg, Cubase Pro 15 Plug-in Reference (reverence_r, revelation_r, roomworks_r, roomworks_se_r,
  shimmer_reverb_r) under https://www.steinberg.help/r/cubase-pro/cubaseplugref/15.0/en/_shared/topics/plug_ref/

**Vocal reverbs**

- iZotope Nectar 4 help: Reverb https://docs.izotope.com/nectar4/en/reverb/index.html, Dimension
  https://docs.izotope.com/nectar4/en/dimension/index.html, Auto-Level https://docs.izotope.com/nectar4/en/alm/index.html,
  Vocal Assistant https://docs.izotope.com/nectar4/en/assistant/index.html, Global Controls
  https://docs.izotope.com/nectar4/en/global-controls/index.html, Delay https://docs.izotope.com/nectar4/en/delay/index.html
- iZotope Neoverb documentation https://docs.izotope.com/neoverb/en/print/index.html
- Exponential Audio, R4 User Guide (2018) https://www.barryrudolph.com/recall/manuals/r4.pdf; PhoenixVerb / R2 User
  Guide (2015) https://www.barryrudolph.com/recall/manuals/exp_stereo.pdf; Symphony (archived)
  http://web.archive.org/web/20181223215731/https://www.exponentialaudio.com/symphony/; Stratus (archived)
  http://web.archive.org/web/2018/https://www.exponentialaudio.com/stratus/
- Production Expert, Michael Carnes's reverb tips (secondary) https://www.production-expert.com/production-expert-1/2018/10/2/expert-reverb-tips-amp-tricks-from-the-reverb-maestro-michael-carnes-at-exponential-audio
- Waves user guides: H-Reverb https://assets.wavescdn.com/pdf/plugins/h-reverb.pdf; CLA Vocals
  https://assets.wavescdn.com/pdf/plugins/cla-vocals.pdf; CLA Epic https://assets.wavescdn.com/pdf/plugins/cla-epic.pdf;
  Renaissance Reverb https://assets.wavescdn.com/pdf/plugins/renaissance-reverb.pdf; Abbey Road Reverb Plates
  https://assets.wavescdn.com/pdf/plugins/abbey-road-reverb-plates.pdf; Abbey Road Chambers
  https://assets.wavescdn.com/pdf/plugins/abbey-road-chambers.pdf; Space Rider https://assets.wavescdn.com/pdf/plugins/space-rider.pdf
- sonible smart:reverb 2 manual https://www.sonible.com/wp-content/uploads/2025/07/manual-smartReverb2.pdf; product
  page https://www.sonible.com/smartreverb/
- Baby Audio: Crystalline manual https://babyaudiosoftware.s3.us-east-2.amazonaws.com/Crystalline+Baby+Audio+Manual.pdf
  and page https://babyaud.io/crystalline; Spaced Out manual
  https://babyaudiosoftware.s3.us-east-2.amazonaws.com/Spaced+Out+Baby+Audio+Manual.pdf and page https://babyaud.io/spaced-out-plugin

**Plates and vintage**

- Soundtoys: Little Plate User's Guide https://www.soundtoys.com/wp-content/uploads/Little-Plate-Manual.pdf; SuperPlate
  User's Guide https://www.soundtoys.com/wp-content/uploads/SuperPlate-Manual.pdf
- Universal Audio manuals on help.uaudio.com: Pure Plate https://help.uaudio.com/hc/en-us/articles/4419497304340,
  Capitol Chambers (article 18741463946516), EMT 140 (33030978351892), Lexicon 480L (33194625601044), Sound City
  Studios (18738187503380); AMS RMX16 Expanded Manual https://media.uaudio.com/support/manuals/dd/AMS%20RMX16%20Expanded%20Manual.pdf
- Slate Digital, VerbSuite Classics User Guide v2 https://support.slatedigital.com/hc/en-us/article_attachments/115001296108
- Arturia manuals (arturia.com/api/download/products/…): rev-intensity ReverbIntensity_Manual_1_0_1_EN.pdf, rev-plate140
  ReverbPlate_Manual_1_0_0_EN.pdf, rev-spring636 rev-spring-636_Manual_1_0_2_EN.pdf, rev-lx-24
  rev-lx-24_Manual_1_0_1_EN.pdf, efx-ambient efx-ambient_Manual_1_0_0_EN.pdf
- Softube: TSAR-1 and TSAR-1R https://www.softube.com/user-manuals/tsar-1-reverb; Spring Reverb https://www.softube.com/user-manuals/Spring-Reverb
- Relab: LX480 manual https://relabdevelopment.com/public/manuals/LX480_Manual.pdf; Sonsig Rev-A manual
  https://relabdevelopment.com/public/manuals/Sonsig_Rev-A_Manual.pdf

**The specialists**

- Eventide: Blackhole user guide https://www.barryrudolph.com/recall/manuals/eventideblackhole.pdf; SP2016 Reverb user
  guide https://www.barryrudolph.com/recall/manuals/eventide_sp2016.pdf; ShimmerVerb manual
  https://manualsnet.com/eventide/anthology-xii-shimmerverb; MangledVerb manual https://manualsnet.com/eventide/anthology-xii-mangledverb;
  Blackhole page https://www.eventideaudio.com/plug-ins/blackhole/
- LiquidSonics manuals: Seventh Heaven Professional https://us-east-1.linodeobjects.com/liquidsonics/software/seventh-heaven-professional/manual/Seventh_Heaven_Professional_Manual.pdf;
  Cinematic Rooms Professional https://us-east-1.linodeobjects.com/liquidsonics/software/cinematic-rooms/manual/Cinematic_Rooms_Professional_Manual.pdf;
  Tai Chi https://us-east-1.linodeobjects.com/reverbfoundry/downloads/tai_chi/documents/Tai_Chi_User_Guide.pdf;
  Lustrous Plates https://us-east-1.linodeobjects.com/liquidsonics/software/lustrous-plates/manual/Lustrous_Plates_Manual.pdf;
  HD Cart https://us-east-1.linodeobjects.com/reverbfoundry/downloads/hd_cart/documents/HD-Cart_User_Guide.pdf;
  Illusion https://us-east-1.linodeobjects.com/liquidsonics/software/illusion/manual/Illusion_Manual.pdf
- ValhallaShimmer page (archived) https://web.archive.org/web/2024/https://valhalladsp.com/shop/reverb/valhalla-shimmer/
- Native Instruments Raum page https://www.native-instruments.com/en/products/komplete/effects/raum/

**Reviews and forums** (4.2)

- Image-Line forum: "Reeverb 2 - always tinny sound?" https://forum.image-line.com/viewtopic.php?t=144783; "Precomputed
  Effects" https://forum.image-line.com/viewtopic.php?p=1287706; "Fruity Reeverb 2 High / Low Cut"
  https://forum.image-line.com/viewtopic.php?t=325892; "Using Reverb" https://forum.image-line.com/viewtopic.php?t=141939;
  "Reeverb 2 room size" https://forum.image-line.com/viewtopic.php?t=237841; "Whats your favorite free reverb?"
  https://forum.image-line.com/viewtopic.php?t=159243; "Improvement suggestions for a couple of plugins"
  https://forum.image-line.com/viewtopic.php?t=170155; "Any plans to update fruity convolver"
  https://forum.image-line.com/viewtopic.php?t=340483; "What's your default reverb?" https://forum.image-line.com/viewtopic.php?t=337294;
  "Recommend good free reverbs!" https://forum.image-line.com/viewtopic.php?t=88169; "LuxeVerb vs. Fruity Reverb 2 vs.
  ValhallaVintageVerb" https://forum.image-line.com/viewtopic.php?t=293675; "FL STUDIO 2026?"
  https://forum.image-line.com/viewtopic.php?t=338342; searches https://forum.image-line.com/search.php?keywords=reeverb+metallic,
  https://forum.image-line.com/search.php?keywords=luxeverb+metallic, https://forum.image-line.com/search.php?keywords=smart+disable+reverb+tail
- FabFilter forum: "Pro-R2 Gating / Ducking attack / release time?" https://prod.fabfilter.com/forum/add-comment?id=7463;
  "Ducking Pro-R" https://prod.fabfilter.com/forum/topic/7195/ducking-pro-r; Pro-R 2 ducking with a sidechain in FL Studio
  https://prod.fabfilter.com/forum/topic/8086/fabfilter-pro-r2-ducking-not-working-when-sidechaining-in-fl-studio; "Pro R2 bug"
  https://prod.fabfilter.com/forum/topic/7495/pro-r2-bug; "Pro-R high CPU usage" https://prod.fabfilter.com/forum/add-comment?id=3566;
  "CPU overload" https://prod.fabfilter.com/forum/add-comment?id=3260
- KVR forum: Denise Perfect Room thread https://www.kvraudio.com/forum/viewtopic.php?p=7589618; VintageVerb vs Room
  https://www.kvraudio.com/forum/viewtopic.php?p=8250220; VintageVerb clicking on a send https://www.kvraudio.com/forum/viewtopic.php?p=9142787;
  2C-Aether https://www.kvraudio.com/forum/viewtopic.php?p=3573061; Uhbik-A and denormals https://www.kvraudio.com/forum/viewtopic.php?p=4625870;
  MTurboReverb tails https://www.kvraudio.com/forum/viewtopic.php?p=8553947; replacing 2CAudio reverbs
  https://www.kvraudio.com/forum/viewtopic.php?p=9072321
- KVR user reviews: VintageVerb https://www.kvraudio.com/product/valhallavintageverb-by-valhalla-dsp/reviews; ValhallaRoom
  https://www.kvraudio.com/product/valhallaroom-by-valhalla-dsp/reviews; Neoverb https://www.kvraudio.com/product/neoverb-by-izotope/reviews
- Sound On Sound: Neoverb https://www.soundonsound.com/reviews/izotope-neoverb; Pro-R https://www.soundonsound.com/reviews/fabfilter-pro-r;
  Seventh Heaven Professional https://www.soundonsound.com/reviews/liquidsonics-seventh-heaven-professional; "Q. How can I avoid
  over-sibilant vocal recordings?" https://www.soundonsound.com/sound-advice/q-how-can-avoid-over-sibilant-vocal-recordings
- MusicTech: Pro-R 2 https://musictech.com/reviews/plug-ins/fabfilter-pro-r-2-review/; smart:reverb https://musictech.com/reviews/sonible-smartreverb/;
  Neoverb https://musictech.com/reviews/plug-ins/izotope-neoverb/; Crystalline https://musictech.com/reviews/plug-ins/baby-audio-crystalline-review/
- MusicRadar, Crystalline https://www.musicradar.com/reviews/baby-audio-crystalline
- Tape Op: Pro-R 2 https://tapeop.com/reviews/gear/159/pro-r-2-reverb-plug-in; Crystalline https://tapeop.com/reviews/gear/150/crystalline-reverb-plug-in
- Attack Magazine: compressing reverbs https://www.attackmagazine.com/technique/tutorials/compressing-reverbs-for-clarity/; Antares
  Vocal Reverb https://www.attackmagazine.com/reviews/gear-software/vocal-reverb-by-antares/; KSHMR Reverb
  https://www.attackmagazine.com/reviews/gear-software/kshmr-reverb-injecting-rhythm-into-the-reverb-plugin-format/
- Production Expert, Seventh Heaven review https://www.production-expert.com/video-reviews/2017/4/26/review-seventh-heaven-reverb-plug-ins-by-liquidsonics
- HISE forum, the metallic diffuser https://forum.hise.audio/post/90042
- Michael Musco, "Fruity Reeverb 2 review" (2026) https://www.michaelmusco.com/2026/03/fruity-reeverb-2-review.html

**Couldn't read**: Avid's own D-Verb and Space guides (403); Logic 11's guide (redirects to 12.3); official Stratus
and Symphony manuals; Kilohearts' Reverb docs (404); Reddit, Gearspace, Sweetwater, producelikeapro (refused).

### 6.5 For part 5: the literature

Read 2026-10-02. Full text unless marked. The AES e-library was in maintenance throughout, so AES papers are known only through search excerpts or later papers that restate them, as marked.

- K. Arcas, A. Chaigne, "On the quality of plate reverberation", *Applied Acoustics* 71(2), 147–156, 2010; K. Arcas, "Physical modelling and measurements of plate reverberation", ICA 2007: **not read**, known through S. Willemsen's restatement (below). Arcas's thesis (ENSTA, 2009), its record only: https://bibnum.ensta.fr/6000/
- S. Willemsen, "Virtual analog simulation and extensions of plate reverberation", Master's thesis, Aalborg University, 2017 (with its SMC 2017 paper, "Willemsen et al.", as an appendix): https://projekter.aau.dk/projekter/files/259831180/Master_Thesis_Silvin_Willemsen_SMC171032___2.pdf
- J. S. Abel, D. P. Berners, A. Greenblatt, "An emulation of the EMT 140 plate reverberator using a hybrid reverberator structure", AES 127th Convention, paper 7928, 2009: **search excerpt of the abstract** (AES page https://aes2.org/publications/elibrary-page/?id=15123 unavailable) and Willemsen's account
- S. Bilbao's plate reverberation page (no numbers used): https://www2.ph.ed.ac.uk/~sbilbao/platerevpage.htm; his publication list: https://www2.ph.ed.ac.uk/~sbilbao/pubs.html
- K. Prawda, V. Välimäki, S. Serafin, "Evaluation of accurate artificial reverberation algorithm", SMC 2020: https://acris.aalto.fi/ws/portalfiles/portal/52515500/Evaluation_of_accurate_artificial_reverberation_algorithm.pdf
- G. Dal Santo, K. Prawda, S. J. Schlecht, V. Välimäki, "Differentiable feedback delay network for colorless reverberation", DAFx 2023: https://www.dafx.de/paper-archive/2023/DAFx23_paper_32.pdf
- G. Dal Santo, K. Prawda, S. J. Schlecht, V. Välimäki, "Optimizing tiny colorless feedback delay networks", *EURASIP J. Audio, Speech, and Music Processing* 2025:13: https://arxiv.org/pdf/2402.11216v4
- V. Välimäki, K. Prawda, S. J. Schlecht, "Two-stage attenuation filter for artificial reverberation", *IEEE Signal Processing Letters* 31, 391–395, 2024: https://aaltodoc.aalto.fi/bitstreams/c50f106e-b845-40b7-95c1-a13d7b09d916/download (code: https://github.com/KPrawda/Two_stage_filter)
- K. S. Lee, N. J. Bryan, J. S. Abel, "Approximating measured reverberation using a hybrid fixed/switched convolution structure", DAFx 2010: https://dafx.de/paper-archive/2010/DAFx10/LeeBryanAbel_DAFx10_P88.pdf
- Michon, Ducceschi, Cochard, Skare, Webb and Russo (surnames as the page gives them), "Evaluating CPU, GPU, and FPGA performance in the context of modal reverberation: a comparative analysis", *Frontiers in Signal Processing* 5:1522604, 2025 (read through a page summariser, with its quotes checked): https://www.frontiersin.org/journals/signal-processing/articles/10.3389/frsip.2025.1522604/full
- J. Parker, S. Bilbao, "Spring reverberation: a physical perspective", DAFx 2009: https://www.dafx.de/paper-archive/2009/papers/paper_84.pdf
- H. Gamper, J. Parker, V. Välimäki, "Automated calibration of a parametric spring reverb model", DAFx 2011: https://dafx.de/paper-archive/2011/Papers/39_e.pdf
- V. Välimäki, J. Parker, J. S. Abel, "Parametric spring reverberation effect", *JAES* 58(7/8), 547–562, 2010: **search excerpt of the abstract** (https://aes2.org/publications/elibrary-page/?id=15511), and Gamper et al.'s description
- J. Fagerström, S. J. Schlecht, V. Välimäki, "Non-exponential reverberation modeling using dark velvet noise", submitted to *JAES* (arXiv 2403.20090, 2024): https://arxiv.org/pdf/2403.20090
- B. De Man, K. McNally, J. D. Reiss, "Perceptual evaluation and analysis of reverberation in multitrack music production", *JAES* 65(1/2), 108–116, 2017: http://www.brechtdeman.com/publications/pdf/jaes-DREAMS-hires.pdf
- B. De Man, "Towards a better understanding of mix engineering", PhD thesis, Queen Mary University of London, 2017 (the reverb parts: ch. 4.3, appendix A): http://www.brechtdeman.com/publications/pdf/PhD-thesis.pdf
- A. Lindau, L. Kosanke, S. Weinzierl, "Perceptual evaluation of model- and signal-based predictors of the mixing time in binaural room impulse responses", *JAES* 60(11), 2012: https://depositonce.tu-berlin.de/bitstreams/bbeac92e-3512-4baa-882e-00c8548e3de5/download
- D. Furlong, J. O'Donovan, "Quantitative characterisation of perceptually relevant artifacts of synthetic reverberation using the EarWig distribution", DAFx 2001: https://dafx.de/paper-archive/2001/papers/furlong.pdf
- S. J. Schlecht, E. A. P. Habets, "Modal decomposition of feedback delay networks", *IEEE Trans. Signal Processing* (arXiv 1901.08865, 2019): https://arxiv.org/pdf/1901.08865
- I. Ibnyahya, J. D. Reiss, "Differentiable attenuation filters for feedback delay networks", DAFx 2025 (arXiv 2511.20380): https://arxiv.org/pdf/2511.20380
- J. Koo, S. Paik, K. Lee, "Reverb conversion of mixed vocal tracks using an end-to-end convolutional deep neural network", ICASSP 2021 (arXiv 2103.02147): https://arxiv.org/pdf/2103.02147
- S. Lee, H.-S. Choi, K. Lee, "Differentiable artificial reverberation", *IEEE/ACM TASLP* 30, 2541–2556, 2022 (arXiv 2105.13940): **abstract and method** only: https://arxiv.org/pdf/2105.13940
- C. J. Steinmetz, V. K. Ithapu, P. Calamia, "Filtered noise shaping for time domain room impulse response estimation from reverberant speech", WASPAA 2021 (arXiv 2107.07503): **abstract only**: https://arxiv.org/pdf/2107.07503
- P. Götz, G. Dal Santo, S. J. Schlecht, V. Välimäki, E. A. P. Habets, "Matching reverberant speech through learned acoustic embeddings and feedback delay networks", ICASSP 2026 (arXiv 2510.23158): https://arxiv.org/pdf/2510.23158
- L. Gabrielli, M. Ducceschi, "The 1st DAFx challenge: physical and modal parameter estimation for plate reverberation", DAFx 2026: https://dafx.de/paper-archive/2026/papers/DAFx26_challenge_76.pdf
- Looked at and not used: C. J. Steinmetz, N. J. Bryan, J. D. Reiss, "Style transfer of audio effects with differentiable signal processing", *JAES* 70(9), 2022 (https://arxiv.org/pdf/2207.08759; its effects are EQ and compression, no reverb); J. Koo et al., "Music mixing style transfer", ICASSP 2023 (https://arxiv.org/pdf/2211.02247; convolution reverb one of six effects, no reverb findings); A. I. Mezza, R. Giampiccolo, E. De Sena, A. Bernardini, differentiable FDNs with learnable delays, *EURASIP JASMP* 2024 (https://arxiv.org/pdf/2404.00082); G. Dal Santo et al., "Learning filters in feedback delay networks from noisy room impulse responses" (https://arxiv.org/pdf/2512.16318).
- **Not read** (closed, unavailable or out of time): V. Välimäki, J. Parker, L. Savioja, J. O. Smith, J. S. Abel, "Fifty years of artificial reverberation" (IEEE TASLP 20(5), 2012) and "More than 50 years of artificial reverberation" (AES 60th conference, 2016); S. Bilbao, K. Arcas, A. Chaigne, "A physical model for plate reverberation" (ICASSP 2006) and S. Bilbao, "A digital plate reverberation algorithm" (JAES 55(3), 2007); S. Bilbao, J. Parker, "A virtual model of spring reverberation" (IEEE TASLP, 2009/10); J. S. Abel, S. Coffin, K. Spratt, modal reverberators (JASA 2013, AES 2014); S. J. Schlecht, E. A. P. Habets, "Time-varying feedback matrices in feedback delay networks" (JASA 2015) and "Feedback delay networks: echo density and mixing time" (IEEE/ACM TASLP 2017); Abel and Huang's echo density (AES 2006); E. T. Chourdakis, J. D. Reiss, intelligent reverberation (JAES 65, 2017; AES 2016); B. Leonard, R. King, G. Sikora, reverberation level preference (AES 2012, 2013); J. Paulus, C. Uhle, J. Herre, perceived and preferred level of late reverberation (AES 2011; AES 60th, 2016); M. Karjalainen, H. Järveläinen, "More about this reverberation science: perceptually good late reverberation" (AES 111th, 2001); the primary sources for the 5 % RT just-noticeable difference (Seraphim; Meng et al. 2006, cited by De Man and by Prawda) and the 5–6 dB DRR one (Zahorik 2002, cited by De Man).
