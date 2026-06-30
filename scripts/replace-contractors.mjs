import { getSupabase } from "./supabase-admin.mjs";

const contractorNames = [
  "SES88 IT Solutions",
  "Telkha Network Inc.",
  "AMERS Network",
  "Expedire Services Inc",
  "Radiance",
  "BICAMO Systems Solutions",
  "1088 Octagram",
  "Transcends",
  "JBLO Telecom Corp.",
  "CHRIS CCTV INSTALLATION",
  "Golden Victory",
];

const supabase = getSupabase();
const canonical = new Set(contractorNames.map((name) => name.toLowerCase()));
const rows = contractorNames.map((name, display_order) => ({ name, active: true, display_order }));

const { error: upsertError } = await supabase.from("contractors").upsert(rows, { onConflict: "name" });
if (upsertError) throw upsertError;

const { data: existing, error: listError } = await supabase.from("contractors").select("id,name,active");
if (listError) throw listError;

const oldContractors = (existing ?? []).filter((contractor) => !canonical.has(contractor.name.toLowerCase()) && contractor.active);
if (oldContractors.length) {
  const { error: deactivateError } = await supabase.from("contractors").update({ active: false }).in("id", oldContractors.map((contractor) => contractor.id));
  if (deactivateError) throw deactivateError;
}

console.log(`Activated ${contractorNames.length} contractors and deactivated ${oldContractors.length} old contractors.`);
