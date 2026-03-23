import hotelsTripData from "@/data/hotels-trip.json";

export type Hotel = {
  name: string;
  tier: string;
  region: string;
  trip_url?: string | null;
};

const hotelsBase: Hotel[] = [
  { name: "Aman Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=2479231&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Bulgari Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=105122105&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Conrad Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1572622&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Four Seasons Hotel Tokyo at Otemachi", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=50988664&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hyatt Centric Ginza Tokyo", tier: "luxury-center", region: "tokyo" },
  { name: "Imperial Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=993510&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Mandarin Oriental Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1503015&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Oakwood Premier Tokyo", tier: "luxury-center", region: "tokyo" },
  { name: "Palace Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=737125&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Shangri-La Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=737125&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Peninsula Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=987089&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Tokyo EDITION, Ginza", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=113698633&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Tokyo Station Hotel", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=686316&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },

  { name: "Andaz Tokyo — A Concept by Hyatt", tier: "luxury-other", region: "tokyo" },
  { name: "Grand Hyatt Tokyo (Roppongi)", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=688554&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Janu Tokyo", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=114016363&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Toranomon Hills, The Unbound Collection By Hyatt", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=109842731&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Mesm Tokyo, Autograph Collection (Takeshiba)", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=50999069&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Ritz Carlton Tokyo (Roppongi)", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1503027&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Okura Tokyo", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=44009577&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Prince Gallery Tokyo Kioicho, a Luxury Collection Hotel (Akasaka)", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=5840930&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Tokyo EDITION, Toranomon", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=57007078&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },

  { name: "Dai-Ichi Hotel Tokyo", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=688586&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Mercure Tokyo Hibiya", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=109964575&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Ginza Hotel by Granbell", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=104683909&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Royal Park Canvas Ginza Corridor", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=92691811&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Royal Park Hotel Ginza 6-Chome", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=113614997&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel GrandBach Tokyo Ginza", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=92691811&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Mitsui Garden Hotel Ginza Premier", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=688381&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Gate Hotel Tokyo by Hulic", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=21905069&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel The Celestine Ginza", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=7383309&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Blossom Hibiya", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=34011678&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Millennium Mitsui Garden Hotel Tokyo", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1683161&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Karaksa Hotel Premier Tokyo Ginza", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=23645343&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Muji Hotel Ginza", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=76284241&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Royal Park Hotel Iconic Tokyo Shiodome", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=688618&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Metropolitan Tokyo Marunouchi", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1330921&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Ginza Creston", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=686253&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Dormy Inn Premium Ginza Natural Hot Spring", tier: "premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=76219489&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },

  { name: "Ginza Grand Hotel", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=994572&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Agora Tokyo Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=54566129&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Keihan Tsukiji Ginza Grande", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=15918866&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "KOKO HOTEL Tsukiji Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=78690884&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "MONday Apart Premium Nihonbashi", tier: "economy-premium", region: "tokyo" },
  { name: "Solaria Nishitetsu Hotel Ginza", tier: "economy-premium", region: "tokyo" },
  { name: "Hotel Gracery Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=688252&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Remm Hibiya", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1458596&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Remm plus Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=42171789&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Remm Tokyo Kyobashi", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=23747919&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Musse Ginza Meitetsu", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=12255760&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Daiwa Roynet Hotel Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=3095695&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Daiwa Roynet Hotel Shinbashi", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=30785438&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Sotetsu Fresa Inn Ginza-Nanachome", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=5611704&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Sotetsu Fresa Inn Ginza-Sanchome", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=9193491&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "the b ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=70434780&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
];

const tripUrlByName = new Map(hotelsTripData.map((hotel) => [hotel.name, hotel.trip_url]));

export const hotels: Hotel[] = hotelsBase.map((hotel) => ({
  ...hotel,
  trip_url: tripUrlByName.get(hotel.name) ?? null,
}));
