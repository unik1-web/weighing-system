// Local storage implementation (Supabase removed)
// All data is stored locally in browser localStorage

export type WeightSource = 'manual' | 'instrument';
export type TicketStatus = 'open' | 'completed';

export interface Vehicle {
  id: string;
  vehicle_number: string;
  vehicle_brand: string;
  default_tare_weight: number | null;
  notes: string;
  created_at: string;
}

export interface Driver {
  id: string;
  name: string;
  notes: string;
  created_at: string;
}

export interface Cargo {
  id: string;
  name: string;
  default_price: number | null;
  notes: string;
  created_at: string;
}

export interface Shipper {
  id: string;
  name: string;
  inn: string;
  notes: string;
  created_at: string;
}

export interface Receiver {
  id: string;
  name: string;
  inn: string;
  notes: string;
  created_at: string;
}

export interface Carrier {
  id: string;
  name: string;
  inn: string;
  notes: string;
  created_at: string;
}

export interface WeighingTicket {
  id: string;
  ticket_number: number | null;
  vehicle_number: string;
  vehicle_brand: string;
  trailer_number: string;
  driver_name: string;
  cargo_name: string;
  shipper_name: string;
  receiver_name: string;
  carrier_name: string;
  price: number;
  vat_rate: number;
  gross_weight: number | null;
  tare_weight: number | null;
  net_weight: number | null;
  total_amount: number | null;
  gross_source: WeightSource;
  tare_source: WeightSource;
  gross_raw: string | null;
  tare_raw: string | null;
  gross_datetime: string | null;
  tare_datetime: string | null;
  scale_device: string;
  operator_id: string | null;
  operator_name: string;
  status: TicketStatus;
  notes: string;
  created_at: string;
  completed_at: string | null;
}

export type DictionaryTable = 'vehicles' | 'drivers' | 'cargos' | 'shippers' | 'receivers' | 'carriers';

export interface DictionaryEntry {
  id: string;
  name: string;
  notes?: string;
  default_price?: number | null;
  default_tare_weight?: number | null;
  vehicle_brand?: string;
  vehicle_number?: string;
  inn?: string;
  created_at: string;
}

export const DICTIONARY_LABELS: Record<DictionaryTable, string> = {
  vehicles: 'Автомобили',
  drivers: 'Водители',
  cargos: 'Грузы',
  shippers: 'Грузоотправители',
  receivers: 'Грузополучатели',
  carriers: 'Грузоперевозчики',
};

// Mock supabase client for compatibility
export const supabase = {
  from: (table: DictionaryTable | 'weighing_tickets' | 'settings' | 'profiles' | 'users') => ({
    select: (columns?: string) => ({
      eq: (field: string, value: any) => ({
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }),
      order: (field: string, opts?: any) => ({
        limit: (n: number) => Promise.resolve({ data: [], error: null }),
      }),
    }),
    insert: (data: any) => ({
      select: (columns?: string) => ({
        single: () => Promise.resolve({ data: null, error: null }),
      }),
    }),
    update: (data: any) => ({
      eq: (field: string, value: any) => Promise.resolve({ error: null }),
    }),
    delete: () => ({
      eq: (field: string, value: any) => Promise.resolve({ error: null }),
    }),
  }),
  auth: {
    signInWithPassword: () => Promise.resolve({ error: null }),
    signUp: () => Promise.resolve({ error: null }),
    signOut: () => Promise.resolve(),
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: (callback: Function) => ({
      subscription: { unsubscribe: () => {} },
    }),
  },
};
