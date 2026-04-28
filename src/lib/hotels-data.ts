import hotelsTripData from "@/data/hotels-trip.json";

export type Hotel = {
  name: string;
  tier: string;
  region: string;
  trip_url?: string | null;
  ryokan?: boolean;
};

const hotelsBase: Hotel[] = [
  { name: "Aman Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=2479231&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Bulgari Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=105122105&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Conrad Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1572622&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Four Seasons Hotel Tokyo at Otemachi", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=50988664&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hyatt Centric Ginza Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=12510735&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Imperial Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=993510&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Mandarin Oriental Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1503015&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Oakwood Premier Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=4641981&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Palace Hotel Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=737125&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Shangri-La Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=737125&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Peninsula Tokyo", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=987089&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Tokyo EDITION, Ginza", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=113698633&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "The Tokyo Station Hotel", tier: "luxury-center", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=686316&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Fufu Tokyo Ginza", tier: "luxury-center", region: "tokyo", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=132405202&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "HOSHINOYA Tokyo", tier: "luxury-center", region: "tokyo", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=6372841&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },

  { name: "Andaz Tokyo — A Concept by Hyatt", tier: "luxury-other", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1546744&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
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
  { name: "MONday Apart Premium Nihonbashi", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=59017972&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Solaria Nishitetsu Hotel Ginza", tier: "economy-premium", region: "tokyo", trip_url: "https://www.trip.com/hotels/detail/?cityId=294211&hotelId=1709267&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
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

  // ХАКОНЭ
  { name: "Centurion Hakone Bettei", tier: "luxury-other", region: "hakone", ryokan: true, trip_url: null },
  { name: "Espacio the Hakone Geihinkan Rin-Poh-Ki-Ryu", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: null },
  { name: "Fujiya Hotel", tier: "premium", region: "hakone", trip_url: null },
  { name: "Fufu Hakone", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=86051569&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Gora Kadan", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=1636286&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Gora KARAKU", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=67002722&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Hisui", tier: "premium", region: "hakone", ryokan: true, trip_url: null },
  { name: "Hakone Kamon", tier: "premium", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=21829157&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Kowakien Tenyu", tier: "premium", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=6706138&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Kyuan", tier: "premium", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=2855832&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Nanase", tier: "premium", region: "hakone", ryokan: true, trip_url: null },
  { name: "Hakone Retreat Före", tier: "luxury-other", region: "hakone", trip_url: null },
  { name: "Hakone Retreat villa 1f", tier: "luxury-other", region: "hakone", trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=6533639&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hakone Suishoen", tier: "premium", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=706135&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Hyatt Regency Resort & Spa", tier: "premium", region: "hakone", trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=706030&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel Indigo Hakone Gora, an IHG Hotel", tier: "premium", region: "hakone", trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=36832661&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Kanaya Resort Hakone", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=18075149&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Kinnotake Sengokuhara", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=707628&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Kinnotake Tonosawa", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=2199079&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Lux Hakone Yumoto", tier: "luxury-center", region: "hakone", ryokan: true, trip_url: null },
  { name: "Regina Resort Hakone Ungaiso", tier: "premium", region: "hakone", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=29573595&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Sengokubara Cocon", tier: "premium", region: "hakone", trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=115585454&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Tensui Saryo", tier: "premium", region: "hakone", ryokan: true, trip_url: null },
  { name: "The Hiramatsu Hotels & Resorts Sengokuhara Hakone", tier: "luxury-other", region: "hakone", trip_url: "https://www.trip.com/hotels/detail/?cityId=145921&hotelId=17511956&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },

  // КИОТО
  { name: "Aman Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Banyan Tree Higashiyama Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Dhawa Yura Kyoto - Banyan Group", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Dusit Thani Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Fauchon Hotel Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Four Seasons Hotel Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Good Nature Hotel Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Hilton Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Hotel Kanra Kyoto", tier: "premium", region: "kyoto", ryokan: true, trip_url: "https://www.trip.com/hotels/detail/?cityId=294214&hotelId=706115&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Hotel the Celestine Kyoto Gion", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Hotel the Mitsui Kyoto, a Luxury Collection Hotel & Spa", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Japanese Ryokan Seryo", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },
  { name: "Kyoto Nanzenji Ryokan Yachiyo Established in 1915", tier: "premium", region: "kyoto", ryokan: true, trip_url: null },
  { name: "NAZUNA Kyoto Gosho", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },
  { name: "Nazuna Kyoto Nijo-jo", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },
  { name: "On Sora Niwa Terrace Kyoto Bettei", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },
  { name: "Park Hyatt Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "Riverte Kyoto Kamogawa", tier: "premium", region: "kyoto", trip_url: "https://www.trip.com/hotels/detail/?cityId=294214&hotelId=124265029&Allianceid=6693408&SID=231989290&trip_sub3=D14363442" },
  { name: "Ryokan Genhouin", tier: "premium", region: "kyoto", ryokan: true, trip_url: null },
  { name: "Shoenso Hozugawatei", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },
  { name: "Suiran, a Luxury Collection Hotel, Kyoto", tier: "luxury-center", region: "kyoto", ryokan: true, trip_url: null },
  { name: "THe Gate Hotel Kyoto Takasegawa", tier: "premium", region: "kyoto", trip_url: null },
  { name: "The Blossom Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "The Ritz-Carlton, Kyoto", tier: "luxury-center", region: "kyoto", trip_url: null },
  { name: "The Thousand Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "Westin Miyako Kyoto", tier: "premium", region: "kyoto", trip_url: null },
  { name: "HOTEL VMG VILLA KYOTO", tier: "luxury-other", region: "kyoto", trip_url: null },
  { name: "YADORU KYOTO HANARE Mizunoe No Yado", tier: "luxury-other", region: "kyoto", ryokan: true, trip_url: null },

  // ФУДЗИ
  { name: "Fuji Gran Villa - TOKI -", tier: "luxury-other", region: "fuji", trip_url: null },
  { name: "Fuji Hoshinoya", tier: "luxury-center", region: "fuji", ryokan: true, trip_url: null },
  { name: "Hotel Mt. Fuji", tier: "premium", region: "fuji", trip_url: null },
  { name: "hotel norm. fuji", tier: "premium", region: "fuji", trip_url: null },
  { name: "VISION GLAMPING Resort&Spa", tier: "premium", region: "fuji", trip_url: null },

  // ЯКУСИМА
  { name: "Yakushima Pension Luana House", tier: "economy-premium", region: "yakushima", trip_url: "https://jp.trip.com/hotels/yakushima-hotel-detail-23205357/yakushima-pension-luana-house/?cityId=92473&checkIn=2026-05-07&checkOut=2026-05-08&adult=2&children=0&subStamp=3001547&crn=1&ages=&travelpurpose=0&curr=JPY&fgt=1&hasAidInUrl=true&mincurr=JPY&minprice=12937.00&mproom=1415136715&link=title&hoteluniquekey=H4sIAAAAAAAA_-Ny4WKSYBJi4mCUsuI43f10EasQo5HBTcEZjG9Xd3CvYGTcwch0kZEBCBp-HHN4CGG5nHToYmL0W8jKAOb6O0jx-BZ5m7iZRJh4prgZKrBoXJp2-DybB2MQm6OFpZuLY5QMF7NXQKSgR7DtzPovS-2lQDxFGC-JNStR1ysg47dIFyOTB-MqRoZPjHzIBsYbAAAcISJmpwAAAA&subChannel=&masterhotelid_tracelogid=e04ac2659cad43f4905a88d43c192f90&NewTaxDescForAmountshowtype0=F&detailFilters=17%7C1%7E17%7E1*80%7C2%7C1%7E80%7E2*19%7C92473%7E19%7E92473&hotelType=meta&trip_sub1=07_05_2026_1_localuniversal_23205357_JP_desktop_default___0_0-LANG_JP-landing&display=incavg&locale=ja-JP" },
];

const tripUrlByName = new Map(hotelsTripData.map((hotel) => [hotel.name, hotel.trip_url]));

export const hotels: Hotel[] = hotelsBase
  .map((hotel) => ({
    ...hotel,
    trip_url: tripUrlByName.get(hotel.name) ?? null,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
