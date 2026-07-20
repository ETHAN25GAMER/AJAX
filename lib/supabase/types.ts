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

export type CustomerAcquisition = {
  source_type: string | null;
  source_id: string | null;
  source_url: string | null;
  headline: string | null;
};

export type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
  tags: string[];
  acquisition: CustomerAcquisition | null;
  acquired_at: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  customer_id: string;
  last_message_at: string;
  state_json: unknown;
  agent_paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  nudged_at: string | null;
  recovery_sent_at: string | null;
  flow_state: unknown;
};

export type Appointment = {
  id: string;
  customer_id: string;
  confirmation_code: string;
  pest_type: string;
  slot_start: string;
  slot_end: string;
  status: AppointmentStatus;
  price_quoted: number | null;
  assigned_technician_id: string | null;
  reminder_sent_at: string | null;
  reminder_confirmed_at: string | null;
  csat_requested_at: string | null;
  created_at: string;
};

export type MessageDirection = "inbound" | "outbound_agent" | "outbound_staff";

export type MessageEvent = {
  id: string;
  conversation_id: string;
  customer_id: string;
  direction: MessageDirection;
  at: string;
};

export type Feedback = {
  id: string;
  appointment_id: string;
  customer_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
};

export type PricingRow = {
  id: string;
  pest_type: string;
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

export type PaymentPurpose = "deposit" | "amc_renewal";
export type PaymentStatus = "created" | "paid" | "failed";

export type Payment = {
  id: string;
  customer_id: string;
  appointment_id: string | null;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider_ref: string | null;
  link_url: string | null;
  created_at: string;
  paid_at: string | null;
};

export type CampaignStatus = "draft" | "sending" | "done";
export type CampaignRecipientStatus = "queued" | "sent" | "skipped" | "failed";

export type Campaign = {
  id: string;
  name: string;
  template_name: string;
  template_params: string[];
  segment: unknown;
  status: CampaignStatus;
  created_by: string | null;
  created_at: string;
  launched_at: string | null;
  completed_at: string | null;
};

export type CampaignRecipient = {
  campaign_id: string;
  customer_id: string;
  status: CampaignRecipientStatus;
  detail: string | null;
  sent_at: string | null;
};

export type JourneyTrigger = "job_completed" | "customer_created";
export type JourneyEnrollmentStatus = "active" | "done" | "cancelled";

export type Journey = {
  id: string;
  name: string;
  trigger: JourneyTrigger;
  enabled: boolean;
  enabled_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type JourneyStep = {
  journey_id: string;
  position: number;
  delay_days: number;
  template_name: string;
  template_params: string[];
};

export type JourneyEnrollment = {
  journey_id: string;
  customer_id: string;
  trigger_ref: string;
  current_position: number;
  next_run_at: string;
  status: JourneyEnrollmentStatus;
  enrolled_at: string;
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
