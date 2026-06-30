import { getSupabase, upsert } from "./supabase-admin.mjs";

const dryRun = process.argv.includes("--dry-run");
const siteStatuses = [
  ["scheduled", "Scheduled"],
  ["installed", "Installed"],
  ["issue", "Issue"],
  ["cancelled", "Cancelled"],
].map(([value, name], display_order) => ({ value, name, active: true, display_order }));
const contractors = [
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
].map((name, display_order) => ({ name, active: true, display_order }));
const unitTypes = ["Satellite broadband", "Fixed wireless", "Fiber internet"].map((name, display_order) => ({ name, active: true, display_order }));
const defaultComponentTypes = new Set(["Dish antenna", "Modem", "Router"]);
const componentTypes = ["Dish antenna", "Modem", "Router", "Power supply", "Outdoor radio", "Starlink Performance Kit"].map((name, display_order) => ({ name, active: true, display_order, default_on_new_site: defaultComponentTypes.has(name) }));
const equipmentFields = [
  { label: "Serial number", field_type: "text", active: true },
  { label: "MAC address", field_type: "mac", active: true },
  { label: "Kit number", field_type: "text", active: true },
];
const serviceVisitTypes = ["Maintenance", "Repair", "Inspection", "Equipment replacement", "Other"].map((name, display_order) => ({ name, active: true, display_order }));

if (dryRun) {
  console.log(`Validated reference seed: ${siteStatuses.length} site statuses, ${contractors.length} contractors, ${unitTypes.length} solutions, ${componentTypes.length} component types, ${equipmentFields.length} equipment fields, ${serviceVisitTypes.length} visit types.`);
  process.exit(0);
}

const supabase = getSupabase();
await upsert(supabase, "installation_status_options", siteStatuses, "value");
await upsert(supabase, "contractors", contractors);
await upsert(supabase, "unit_types", unitTypes);
await upsert(supabase, "component_types", componentTypes);
await upsert(supabase, "equipment_field_library", equipmentFields, "label,field_type");
await upsert(supabase, "service_visit_types", serviceVisitTypes);

const [{ data: types, error: typesError }, { data: fields, error: fieldsError }] = await Promise.all([
  supabase.from("component_types").select("id,name"),
  supabase.from("equipment_field_library").select("id,label"),
]);
if (typesError) throw typesError;
if (fieldsError) throw fieldsError;
const type = (name) => types.find((row) => row.name === name)?.id;
const field = (label) => fields.find((row) => row.label === label)?.id;
const attachments = [
  ["Dish antenna", "Serial number", false], ["Modem", "Serial number", true], ["Modem", "MAC address", false],
  ["Router", "Serial number", true], ["Router", "MAC address", false], ["Power supply", "Serial number", false],
  ["Outdoor radio", "Serial number", true], ["Outdoor radio", "MAC address", false],
  ["Starlink Performance Kit", "Kit number", true], ["Starlink Performance Kit", "Serial number", false],
].map(([typeName, fieldLabel, required], order) => ({ component_type_id: type(typeName), library_field_id: field(fieldLabel), required, active: true, display_order: order }));
await upsert(supabase, "component_field_definitions", attachments, "component_type_id,library_field_id");

const customFields = [
  { label: "Work order number", field_type: "text", required: false, active: true, display_order: 0 },
  { label: "Site priority", field_type: "dropdown", required: false, active: true, display_order: 1 },
];
await upsert(supabase, "custom_field_definitions", customFields, "label");
const { data: priority, error: priorityError } = await supabase.from("custom_field_definitions").select("id").eq("label", "Site priority").single();
if (priorityError) throw priorityError;
await upsert(supabase, "custom_field_options", ["Standard", "High priority"].map((name) => ({ field_id: priority.id, name, active: true })), "field_id,name");
console.log("Reference seed complete.");
