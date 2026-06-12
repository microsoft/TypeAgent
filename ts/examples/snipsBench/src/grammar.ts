// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar templates for the SNIPS intents.
 *
 * Each template is parameterized by the *slot wildcard type* — either the
 * built-in `wildcard` (greedy, unbounded, stops only at a following literal
 * anchor) or `NP` (greedy, stops at the first function word). The two compiled
 * arms share an identical grammar; only this type differs. The third arm
 * (title-aware) refines the `wildcard` arm's captures positionally (see
 * refine.ts), so it needs no separate grammar.
 *
 * Grammars are deliberately compact: a handful of high-frequency frames per
 * intent, capturing the slots where the boundary question actually bites.
 * Coverage is partial by design — what matters for the experiment is that all
 * arms see the same grammar.
 */

export type SlotType = "wildcard" | "NP";

const HEADER = `// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
`;

/** Build a returning literal-set rule: `<rule> = a -> "a" | b -> "b" ;` */
function litRule(rule: string, phrases: string[]): string {
    return (
        `<${rule}> =\n    ` +
        phrases.map((p) => `${p} -> "${p}"`).join("\n  | ") +
        " ;"
    );
}

/** A name-capture rule returning its (greedy) slot value, typed by the arm. */
function nameRule(rule: string, S: SlotType): string {
    return `<${rule}> = $(x:${S}) -> x ;`;
}

// ── AddToPlaylist ───────────────────────────────────────────────────────────
export function addToPlaylistGrammar(S: SlotType): string {
    return `${HEADER}
<Start> = <AddCmd>;

<AddCmd> =
    <V> $(artist:${S}) <P> (my | the | your | a)? $(playlist:<PName>) -> { actionName: "AddToPlaylist", parameters: { artist, playlist } } ;

<V> = add | put | please add | add the ;
<P> = to | into | onto | on ;

<PName> =
    $(p:${S}) playlist -> p
  | playlist $(p:${S}) -> p
  | $(p:${S}) -> p ;
`;
}

// ── PlayMusic ───────────────────────────────────────────────────────────────
const SERVICES = [
    "spotify",
    "deezer",
    "pandora",
    "youtube",
    "google music",
    "last fm",
    "lastfm",
    "iheart",
    "groove shark",
    "itunes",
    "soundcloud",
    "slacker",
    "zvooq",
    "vimeo",
];
export function playMusicGrammar(S: SlotType): string {
    return `${HEADER}
<Start> = <P>;

<P> =
    play $(track:${S}) by $(artist:${S}) on $(service:<Svc>) -> { actionName: "PlayMusic", parameters: { track, artist, service } }
  | play $(track:${S}) by $(artist:${S}) -> { actionName: "PlayMusic", parameters: { track, artist } }
  | <Listen> $(artist:${S}) on $(service:<Svc>) -> { actionName: "PlayMusic", parameters: { artist, service } }
  | <Listen> $(artist:${S}) -> { actionName: "PlayMusic", parameters: { artist } } ;

<Listen> = play | listen to | play some | i want to listen to ;

${litRule("Svc", SERVICES)}
`;
}

// ── RateBook (control: numbers + closed sets, boundary-insensitive) ──────────
const RB_UNITS = ["stars", "points", "star", "point"];
const RB_TYPES = [
    "book",
    "novel",
    "textbook",
    "album",
    "saga",
    "essay",
    "chronicle",
    "series",
];
const RB_SELECT = [
    "this",
    "the current",
    "current",
    "my current",
    "my",
    "this current",
];
export function rateBookGrammar(S: SlotType): string {
    // Control intent: rating_value / best_rating pinned by the Num type (digits
    // or number-words), types/units/select are closed literal sets. No free slot
    // uses ${S}, so the NP arm equals the wildcard arm here (boundaries N/A).
    void S;
    return `${HEADER}
<Start> = <R>;

<R> =
    <Lead> $(rating_value:Num) out of $(best_rating:Num) -> { actionName: "RateBook", parameters: { rating_value, best_rating } }
  | <Lead> $(rating_value:Num) $(rating_unit:<Unit>) -> { actionName: "RateBook", parameters: { rating_value, rating_unit } }
  | <Lead> a $(rating_value:Num) -> { actionName: "RateBook", parameters: { rating_value } } ;

<Lead> = rate | give | <RateVerb> $(sel:<Sel>) $(typ:<Typ>) a? | <RateVerb> $(sel:<Sel>) $(typ:<Typ>) ;
<RateVerb> = rate | give | i give | i rate | i want to give ;

${litRule("Unit", RB_UNITS)}
${litRule("Typ", RB_TYPES)}
${litRule("Sel", RB_SELECT)}
`;
}

// ── SearchCreativeWork ──────────────────────────────────────────────────────
const SCW_TYPES = [
    "tv show",
    "tv series",
    "video game",
    "television show",
    "book",
    "novel",
    "movie",
    "show",
    "game",
    "saga",
    "trailer",
    "photograph",
    "picture",
    "television",
    "series",
    "painting",
    "soundtrack",
    "song",
    "album",
    "video",
    "program",
];
export function searchCreativeWorkGrammar(S: SlotType): string {
    return `${HEADER}
<Start> = <S>;

<S> =
    <Lead> (the | a | an | this)? $(object_type:<OType>) called $(object_name:<Name>) -> { actionName: "SearchCreativeWork", parameters: { object_type, object_name } }
  | <Lead> (the | a | an | this)? $(object_type:<OType>) $(object_name:<Name>) -> { actionName: "SearchCreativeWork", parameters: { object_type, object_name } }
  | <Lead> $(object_name:<Name>) $(object_type:<OType>) -> { actionName: "SearchCreativeWork", parameters: { object_name, object_type } }
  | <Lead> $(object_name:<Name>) -> { actionName: "SearchCreativeWork", parameters: { object_name } } ;

<Lead> = find | search for | search | look for | show me | show | open | get
       | play | i want to find | can you find | please find | find me
       | i d like to see | i d like to watch ;

${nameRule("Name", S)}
${litRule("OType", SCW_TYPES)}
`;
}

// ── SearchScreeningEvent ────────────────────────────────────────────────────
const SSE_OBJTYPE = [
    "movie times",
    "movie schedules",
    "movie schedule",
    "showtimes",
    "show times",
    "movie times",
    "times",
];
const SSE_MOVIETYPE = ["animated movies", "films", "film", "movies", "movie"];
const SSE_LOCTYPE = [
    "movie house",
    "movie theatre",
    "movie theater",
    "cinema",
    "theater",
    "theatre",
    "movie houses",
];
export function searchScreeningEventGrammar(S: SlotType): string {
    return `${HEADER}
<Start> = <S>;

<S> =
    <Lead> $(object_type:<OType>) for $(location_name:<Name>) -> { actionName: "SearchScreeningEvent", parameters: { object_type, location_name } }
  | <Lead> $(object_location_type:<LType>) showing $(movie_name:<Name>) -> { actionName: "SearchScreeningEvent", parameters: { object_location_type, movie_name } }
  | <Lead> $(movie_type:<MType>) <Tail>? -> { actionName: "SearchScreeningEvent", parameters: { movie_type } }
  | <Lead> $(object_type:<OType>) -> { actionName: "SearchScreeningEvent", parameters: { object_type } }
  | <Lead> $(movie_name:<Name>) -> { actionName: "SearchScreeningEvent", parameters: { movie_name } } ;

<Lead> = find | show | show me | give me | is | are | what | when | find me
       | get | i want to see ;
<Tail> = in the area | nearby | near me | in the neighbourhood | in the neighborhood ;

${nameRule("Name", S)}
${litRule("OType", SSE_OBJTYPE)}
${litRule("MType", SSE_MOVIETYPE)}
${litRule("LType", SSE_LOCTYPE)}
`;
}

// ── BookRestaurant ──────────────────────────────────────────────────────────
const BR_RTYPE = [
    "restaurant",
    "spot",
    "place",
    "bistro",
    "brasserie",
    "taverna",
    "pub",
    "bar",
    "diner",
    "cafe",
    "food truck",
    "steakhouse",
    "joint",
];
export function bookRestaurantGrammar(S: SlotType): string {
    // party_size_number pinned by the Num type; city captured after "in" (the
    // one ${S}-typed slot, so the boundary arms differ only on city).
    void S;
    return `${HEADER}
<Start> = <B>;

<B> =
    <Lead> a? $(restaurant_type:<RType>) for $(party_size_number:Num) in $(city:${S}) -> { actionName: "BookRestaurant", parameters: { restaurant_type, party_size_number, city } }
  | <Lead> a? $(restaurant_type:<RType>) for $(party_size_number:Num) -> { actionName: "BookRestaurant", parameters: { restaurant_type, party_size_number } }
  | <Lead> a? $(restaurant_type:<RType>) in $(city:${S}) -> { actionName: "BookRestaurant", parameters: { restaurant_type, city } }
  | <Lead> a? $(restaurant_type:<RType>) -> { actionName: "BookRestaurant", parameters: { restaurant_type } } ;

<Lead> = book | i need to book | i want to book | i d like to book
       | book me | reserve | please book ;

${litRule("RType", BR_RTYPE)}
`;
}

// ── GetWeather ──────────────────────────────────────────────────────────────
export function getWeatherGrammar(S: SlotType): string {
    // Location label (city/state/country/poi) needs a gazetteer; we capture a
    // single `city` slot after a preposition (accepting label noise) so the
    // location-vs-time boundary is exercised. timeRange left to free capture.
    return `${HEADER}
<Start> = <W>;

<W> =
    <Lead> in $(city:${S}) -> { actionName: "GetWeather", parameters: { city } }
  | <Lead> for $(city:${S}) -> { actionName: "GetWeather", parameters: { city } }
  | <Lead> $(city:${S}) -> { actionName: "GetWeather", parameters: { city } } ;

<Lead> = what is the weather | what s the weather | weather | will it
       | what will the weather be like | is it | how is the weather
       | what is the forecast | i need a forecast | give me the weather
       | tell me the weather | will it be | what is the weather like
       | what is the weather forecast | weather forecast ;
`;
}

// ── Registry ────────────────────────────────────────────────────────────────
export interface IntentGrammar {
    intent: string;
    build: (slot: SlotType) => string;
}

export const GRAMMARS: IntentGrammar[] = [
    { intent: "AddToPlaylist", build: addToPlaylistGrammar },
    { intent: "PlayMusic", build: playMusicGrammar },
    { intent: "RateBook", build: rateBookGrammar },
    { intent: "SearchCreativeWork", build: searchCreativeWorkGrammar },
    { intent: "SearchScreeningEvent", build: searchScreeningEventGrammar },
    { intent: "BookRestaurant", build: bookRestaurantGrammar },
    { intent: "GetWeather", build: getWeatherGrammar },
];
