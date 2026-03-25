export type ExperienceFormat =
  | "masterclass"
  | "ceremony"
  | "performance"
  | "activity";

export interface ExperienceService {
  id: string;
  name: string;
  partner: string;
  partner_url: string;
  city: string;
  region: "Канто" | "Кансай" | "Вся Япония" | "Другое";
  subcategory: ExperienceSubcategory[];
  format: ExperienceFormat;
  price_from: number | null;
  currency: "JPY";
  duration_min: number | null;
  description: string;
  agent_notes: string;
  tags: ServiceTag[];
  booking_url: string | null;
}

export interface PracticalService {
  id: string;
  name: string;
  city: string;
  description: string;
  url: string | null;
  tags: ServiceTag[];
}

export type ExperienceSubcategory =
  | "cooking"
  | "crafts"
  | "martial_arts"
  | "theater"
  | "traditional"
  | "entertainment";

export type ServiceTag =
  | "addable_to_tour"
  | "booking_required"
  | "indoor"
  | "outdoor"
  | "family_friendly"
  | "adult_only"
  | "group_min_2"
  | "solo_ok";

export const experienceServices: ExperienceService[] = [
  {
    id: "tea-ceremony-kyoto",
    name: "Чайная церемония",
    format: "ceremony",
    partner: "Nishijin Tondaya",
    partner_url: "https://www.tondaya.co.jp/english/",
    city: "Киото",
    region: "Кансай",
    subcategory: ["traditional"],
    price_from: 3000,
    currency: "JPY",
    duration_min: 60,
    description:
      "Чайная церемония в историческом доме мачия Нисиджин, построенном в 1885 году. Объект национального культурного наследия Японии.",
    agent_notes: "Подходит как блок на 1–1.5 ч в маршруте по Нисиджину или Киото",
    tags: ["addable_to_tour", "booking_required", "indoor", "solo_ok"],
    booking_url: "https://select-type.com/p/?p=JDsfQYZeGWQ",
  },
  {
    id: "kimono-dressing-kyoto",
    name: "Одевание кимоно",
    format: "ceremony",
    partner: "Nishijin Tondaya",
    partner_url: "https://www.tondaya.co.jp/english/",
    city: "Киото",
    region: "Кансай",
    subcategory: ["traditional"],
    price_from: 4000,
    currency: "JPY",
    duration_min: 60,
    description:
      "Примерка и одевание кимоно в доме потомственного торговца шёлком. Доступно для мужчин и женщин, включая свадебное кимоно.",
    agent_notes: "Хорошо сочетается с прогулкой по Нисиджину после одевания",
    tags: ["addable_to_tour", "booking_required", "indoor", "solo_ok", "family_friendly"],
    booking_url: "https://select-type.com/p/?p=JDsfQYZeGWQ",
  },
  {
    id: "calligraphy-kyoto",
    name: "Каллиграфия",
    format: "masterclass",
    partner: "Nishijin Tondaya",
    partner_url: "https://www.tondaya.co.jp/english/",
    city: "Киото",
    region: "Кансай",
    subcategory: ["crafts"],
    price_from: 2000,
    currency: "JPY",
    duration_min: 45,
    description: "Урок японской каллиграфии в историческом доме мачия.",
    agent_notes: "Короткий блок, хорошо как дополнение к программе",
    tags: ["addable_to_tour", "booking_required", "indoor", "solo_ok", "family_friendly"],
    booking_url: "https://select-type.com/p/?p=JDsfQYZeGWQ",
  },
  {
    id: "ikebana-kyoto",
    name: "Икебана",
    format: "masterclass",
    partner: "Nishijin Tondaya",
    partner_url: "https://www.tondaya.co.jp/english/",
    city: "Киото",
    region: "Кансай",
    subcategory: ["crafts"],
    price_from: 3000,
    currency: "JPY",
    duration_min: 60,
    description: "Традиционное японское искусство составления цветочных композиций.",
    agent_notes: "Подходит для маршрута по Киото, особенно в сочетании с садами",
    tags: ["addable_to_tour", "booking_required", "indoor", "solo_ok"],
    booking_url: "https://select-type.com/p/?p=JDsfQYZeGWQ",
  },
  {
    id: "sushi-cooking-tokyo",
    name: "Приготовление суши",
    format: "masterclass",
    partner: "Tsukiji Cooking",
    partner_url: "https://tsukiji-cooking.com/",
    city: "Токио",
    region: "Канто",
    subcategory: ["cooking"],
    price_from: 17600,
    currency: "JPY",
    duration_min: 180,
    description:
      "Кулинарная школа у рынка Цукидзи: тур по внешнему рынку за свежими ингредиентами, затем совместная готовка в студии. Суши, рыба терияки, мисо-суп.",
    agent_notes: "3 ч блок с 10:00. Хорошо вписывается в первую половину дня в центральном Токио. Доступны также приватные занятия и уроки с мишленовским шефом.",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly", "solo_ok"],
    booking_url: "https://tsukiji-cooking.com/schedule",
  },
  {
    id: "ramen-cooking-tokyo",
    name: "Приготовление рамэн",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["cooking"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "ceramics-tokyo",
    name: "Керамика",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "sword-making-tokyo",
    name: "Производство мечей",
    format: "masterclass",
    partner: "Wabunka",
    partner_url: "https://lp.wabunka-lux.jp/special-feature/sword-making_experiences",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts", "martial_arts"],
    price_from: 50000,
    currency: "JPY",
    duration_min: 140,
    description:
      "Частные программы в мастерских действующих кузнецов-мечников. От знакомства с историей катаны и мастер-классов по полировке до самостоятельной ковки клинка из стали тамахагани.",
    agent_notes:
      "Программы от 140 мин. Самый доступный вход — посещение Музея японских мечей + урок полировки (¥50 000). Ковка с нуля — от ¥74 000. Все опыты приватные.",
    tags: ["addable_to_tour", "booking_required", "indoor", "adult_only", "solo_ok"],
    booking_url: "https://lp.wabunka-lux.jp/special-feature/sword-making_experiences",
  },
  {
    id: "swordsmanship-tokyo",
    name: "Владение мечом",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["martial_arts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor"],
    booking_url: null,
  },
  {
    id: "ninja-training-tokyo",
    name: "Ниндзя",
    format: "activity",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["martial_arts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "noh-theater-tokyo",
    name: "Театр Но",
    format: "performance",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["theater"],
    price_from: null,
    currency: "JPY",
    duration_min: null,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor"],
    booking_url: null,
  },
  {
    id: "kabuki-theater-tokyo",
    name: "Театр кабуки",
    format: "performance",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["theater"],
    price_from: null,
    currency: "JPY",
    duration_min: null,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor"],
    booking_url: null,
  },
  {
    id: "manga-drawing-tokyo",
    name: "Рисование манга",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "washi-paper-making-tokyo",
    name: "Изготовление рисовой бумаги",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "traditional-doll-making-tokyo",
    name: "Изготовление традиционных кукол",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "wax-food-model-making-tokyo",
    name: "Изготовление восковых макетов еды",
    format: "masterclass",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts"],
    price_from: null,
    currency: "JPY",
    duration_min: 90,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "knife-forging-kyoto",
    name: "Ковка ножа",
    format: "masterclass",
    partner: "Wabunka",
    partner_url: "https://lp.wabunka-lux.jp/special-feature/sword-making_experiences",
    city: "Киото",
    region: "Кансай",
    subcategory: ["crafts"],
    price_from: 33000,
    currency: "JPY",
    duration_min: 90,
    description:
      "Ковка традиционного японского ножа в исторической кузнице. Работа с настоящим кузнечным горном под руководством мастера, гравировка имени на готовом клинке.",
    agent_notes:
      "90–240 мин в зависимости от программы. Хорошо вписывается в маршрут по Нисиджину или Фусими. Все опыты приватные.",
    tags: ["addable_to_tour", "booking_required", "indoor", "solo_ok"],
    booking_url: "https://lp.wabunka-lux.jp/special-feature/sword-making_experiences",
  },
  {
    id: "mario-karting-tokyo",
    name: "Марио-картинг",
    format: "activity",
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["entertainment"],
    price_from: null,
    currency: "JPY",
    duration_min: 120,
    description: "",
    agent_notes: "",
    tags: ["addable_to_tour", "booking_required", "outdoor", "family_friendly"],
    booking_url: null,
  },
];

export const practicalServices: PracticalService[] = [
  {
    id: "world-nomads",
    name: "World Nomads",
    city: "Онлайн",
    description: "",
    url: null,
    tags: [],
  },
  {
    id: "iijmio",
    name: "IIJmio",
    city: "Вся Япония",
    description: "",
    url: null,
    tags: [],
  },
  {
    id: "toyota-rent-a-car",
    name: "Toyota Rent-a-Car",
    city: "Вся Япония",
    description: "",
    url: null,
    tags: [],
  },
  {
    id: "suica",
    name: "IC Card (Suica)",
    city: "Токио",
    description: "",
    url: null,
    tags: [],
  },
];
