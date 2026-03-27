export interface PoiTicket {
  name_ru: string;
  price: number | null;
  type: string;
  available: boolean;
  valid_now: boolean;
  purchase_link: string;
}

export interface Poi {
  id: string;
  record_id: string;
  name_ru: string;
  name_en: string;
  name_jp: string;
  description_ru: string;
  description_en: string;
  category: string;
  tags: string[];
  is_featured: boolean;
  maps_link: string;
  official_website: string;
  hours_ru: string;
  has_tickets: boolean;
  min_ticket_price: number;
  max_ticket_price: number;
  tickets?: PoiTicket[];
}
