export interface ExperienceService {
  id: string;
  name: string;
  partner: string;
  partner_url: string;
  city: string;
  region: "Канто" | "Кансай" | "Вся Япония" | "Другое";
  subcategory: ExperienceSubcategory[];
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
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["cooking"],
    price_from: null,
    currency: "JPY",
    duration_min: 120,
    description: "",
    agent_notes: "2–3 ч блок, обычно в первой половине дня. Партнёр уточняется.",
    tags: ["addable_to_tour", "booking_required", "indoor", "family_friendly"],
    booking_url: null,
  },
  {
    id: "ramen-cooking-tokyo",
    name: "Приготовление рамэн",
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
    partner: "TBD",
    partner_url: "",
    city: "Токио",
    region: "Канто",
    subcategory: ["crafts", "martial_arts"],
    price_from: null,
    currency: "JPY",
    duration_min: 120,
    description: "",
    agent_notes: "Двойная категория: ремесло и боевые искусства.",
    tags: ["addable_to_tour", "booking_required", "indoor", "adult_only"],
    booking_url: null,
  },
  {
    id: "swordsmanship-tokyo",
    name: "Владение мечом",
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
    id: "mario-karting-tokyo",
    name: "Марио-картинг",
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
