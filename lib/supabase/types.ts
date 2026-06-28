export type ServiceTier = "standard" | "plus" | "specialist";
export type AppointmentStatus = "booked" | "cancelled" | "completed";
export type Urgency = "low" | "normal" | "high";
export type Role = "admin" | "technician";

export type Profile = {
  id: string;
  role: Role;
  full_name: string | null;
  phone: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  customer_id: string;
  last_message_at: string;
  state_json: unknown;
};

export type Appointment = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  service_tier: ServiceTier;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  price_quoted: number | null;
  assigned_technician_id: string | null;
  created_at: string;
};

export type PricingRow = {
  id: string;
  pest_type: string;
  service_tier: ServiceTier;
  base_price: number;
  per_sqft: number;
  notes: string | null;
  requires_inspection: boolean;
};

export type Escalation = {
  id: string;
  customer_id: string;
  summary: string;
  urgency: Urgency;
  resolved: boolean;
  created_at: string;
};

export type TrackingState = "en_route" | "arrived" | null;

export type TechnicianPosition = {
  technician_id: string;
  appointment_id: string | null;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  heading: number | null;
  updated_at: string;
};

export type AppointmentTrackingToken = {
  token: string;
  appointment_id: string;
  created_at: string;
  revoked: boolean;
  revoked_at: string | null;
};

export type DeploymentTier = "tier2" | "tier3";

export type DeploymentSettings = {
  id: number;
  tier: DeploymentTier;
  updated_at: string;
  updated_by: string | null;
};

export type AmcStatus = "active" | "expired" | "cancelled" | "pending_renewal";

export type AmcContract = {
  customer_id: string;
  commenced_at: string;
  renews_at: string;
  lead_days: number;
  pest_type: string;
  annual_price: number | null;
  status: AmcStatus;
  reminder_sent_at: string | null;
  followup_sent_at: string | null;
  notes: string | null;
  created_at: string;
};
