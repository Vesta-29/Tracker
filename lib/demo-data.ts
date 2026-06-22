import type { Installation, ReferenceData } from "@/lib/types";
import { requireLocation } from "@/lib/locations";

const cebuLahug = requireLocation({ regionCode: "0700000000", provinceCode: "0730600000", municipalityCode: "30600", barangayCode: "0730600041" });
const bulacanMuzon = requireLocation({ regionCode: "0300000000", provinceCode: "0301400000", municipalityCode: "0301420000", barangayCode: "0301420007" });
const albayRawis = requireLocation({ regionCode: "0500000000", provinceCode: "0500500000", municipalityCode: "0500506000", barangayCode: "0500506064" });
const lagunaCanlubang = requireLocation({ regionCode: "0400000000", provinceCode: "0403400000", municipalityCode: "0403405000", barangayCode: "0403405011" });
const angelesBalibago = requireLocation({ regionCode: "0300000000", provinceCode: "0330100000", municipalityCode: "30100", barangayCode: "0330100003" });
const batangasSabang = requireLocation({ regionCode: "0400000000", provinceCode: "0401000000", municipalityCode: "0401014000", barangayCode: "0401014054" });

export const defaultReferences: ReferenceData = {
  schoolDirectory: [],
  siteStatuses: [
    { id: "status-scheduled", value: "scheduled", name: "Scheduled", active: true, order: 0 },
    { id: "status-installed", value: "installed", name: "Installed", active: true, order: 1 },
    { id: "status-issue", value: "issue", name: "Issue", active: true, order: 2 },
    { id: "status-cancelled", value: "cancelled", name: "Cancelled", active: true, order: 3 },
  ],
  contractors: [
    { id: "ctr-lighthouse", name: "Lighthouse Network Services", active: true },
    { id: "ctr-northline", name: "Northline Systems", active: true },
    { id: "ctr-pacific", name: "Pacific Link Solutions", active: true },
    { id: "ctr-signalworks", name: "SignalWorks PH", active: true },
  ],
  unitTypes: [
    { id: "unit-satellite", name: "Satellite broadband", active: true },
    { id: "unit-wireless", name: "Fixed wireless", active: true },
    { id: "unit-fiber", name: "Fiber internet", active: true },
  ],
  componentTypes: [
    { id: "component-dish", name: "Dish antenna", active: true, defaultOnNewSite: true, fields: [{ id: "dish-serial", libraryFieldId: "library-serial", required: false, active: true, order: 0 }] },
    { id: "component-modem", name: "Modem", active: true, defaultOnNewSite: true, fields: [{ id: "modem-serial", libraryFieldId: "library-serial", required: true, active: true, order: 0 }, { id: "modem-mac", libraryFieldId: "library-mac", required: false, active: true, order: 1 }] },
    { id: "component-router", name: "Router", active: true, defaultOnNewSite: true, fields: [{ id: "router-serial", libraryFieldId: "library-serial", required: true, active: true, order: 0 }, { id: "router-mac", libraryFieldId: "library-mac", required: false, active: true, order: 1 }] },
    { id: "component-power", name: "Power supply", active: true, fields: [{ id: "power-serial", libraryFieldId: "library-serial", required: false, active: true, order: 0 }] },
    { id: "component-radio", name: "Outdoor radio", active: true, fields: [{ id: "radio-serial", libraryFieldId: "library-serial", required: true, active: true, order: 0 }, { id: "radio-mac", libraryFieldId: "library-mac", required: false, active: true, order: 1 }] },
    { id: "component-starlink", name: "Starlink Performance Kit", active: true, fields: [{ id: "starlink-kit", libraryFieldId: "library-kit", required: true, active: true, order: 0 }, { id: "starlink-serial", libraryFieldId: "library-serial", required: false, active: true, order: 1 }] },
  ],
  equipmentFields: [
    { id: "library-serial", label: "Serial number", type: "text", active: true },
    { id: "library-mac", label: "MAC address", type: "mac", active: true },
    { id: "library-kit", label: "Kit number", type: "text", active: true },
  ],
  customFields: [
    { id: "field-work-order", label: "Work order number", type: "text", required: false, active: true, order: 0, options: [] },
    { id: "field-priority", label: "Site priority", type: "dropdown", required: false, active: true, order: 1, options: [
      { id: "priority-standard", name: "Standard", active: true },
      { id: "priority-high", name: "High priority", active: true },
    ] },
  ],
  serviceVisitTypes: [
    { id: "visit-type-maintenance", name: "Maintenance", active: true },
    { id: "visit-type-repair", name: "Repair", active: true },
    { id: "visit-type-inspection", name: "Inspection", active: true },
    { id: "visit-type-replacement", name: "Equipment replacement", active: true },
    { id: "visit-type-other", name: "Other", active: true },
  ],
};

export const demoInstallations: Installation[] = [
  {
    id: "INS-2026-0018", siteName: "", legacyKitNumber: "KIT-10482", unitType: "Satellite broadband", contractor: "Lighthouse Network Services", installerTeamLead: "",
    installDate: "2026-05-28", status: "installed", ...cebuLahug,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "Activation confirmed.", createdBy: "Maria Santos", createdAt: "2026-05-28T09:10:00", updatedBy: "Maria Santos",
    updatedAt: "2026-05-28T10:31:00", photos: [], customValues: { "field-work-order": "WO-260528-14", "field-priority": "Standard" }, components: [
      { id: "C-1", type: "Dish antenna", values: { "dish-serial": "DSH-62884" }, notes: "", installedAt: "2026-05-28T09:10:00" },
      { id: "C-2", type: "Modem", values: { "modem-serial": "MDM-81124", "modem-mac": "A4:5E:60:11:28:9C" }, notes: "", installedAt: "2026-05-28T09:10:00" },
    ],
    serviceVisits: [{ id: "VISIT-0004", type: "Inspection", status: "completed", ticketReference: "TKT-2486", contractor: "Lighthouse Network Services", scheduledDate: "2026-05-29", completedDate: "2026-05-29", notes: "Post-installation signal inspection completed. No corrective work required.", photos: [], componentChanges: [], createdBy: "Maria Santos", updatedBy: "Maria Santos", createdAt: "2026-05-28T14:20:00", updatedAt: "2026-05-29T10:15:00" }],
    auditEvents: [{ id: "AUDIT-001", action: "created", actor: "Maria Santos", createdAt: "2026-05-28T09:10:00", summary: "Maria Santos created this site record." }, { id: "AUDIT-002", action: "updated", actor: "Maria Santos", createdAt: "2026-05-28T10:31:00", summary: "Maria Santos updated status from Scheduled to Installed.", changedFields: ["status"], beforeData: { status: "scheduled" }, afterData: { status: "installed" } }],
  },
  {
    id: "INS-2026-0017", siteName: "", legacyKitNumber: "KIT-10479", unitType: "Fixed wireless", contractor: "Northline Systems", installerTeamLead: "",
    installDate: "2026-05-27", status: "issue", ...bulacanMuzon,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "Waiting for replacement outdoor radio.", createdBy: "Maria Santos", createdAt: "2026-05-27T13:12:00", updatedBy: "Jon Reyes",
    updatedAt: "2026-05-28T08:20:00", photos: [], customValues: { "field-priority": "High priority" }, components: [
      { id: "C-3", type: "Outdoor radio", values: { "radio-serial": "ODR-30295", "radio-mac": "10:62:E5:40:19:AF" }, notes: "Intermittent signal", installedAt: "2026-05-27T13:12:00" },
    ],
    serviceVisits: [{ id: "VISIT-0003", type: "Repair", status: "scheduled", ticketReference: "TKT-2491", contractor: "Northline Systems", scheduledDate: "2026-05-31", notes: "Investigate intermittent signal and replace outdoor radio if required.", photos: [], componentChanges: [], createdBy: "Jon Reyes", updatedBy: "Jon Reyes", createdAt: "2026-05-28T08:20:00", updatedAt: "2026-05-28T08:20:00" }],
    auditEvents: [{ id: "AUDIT-003", action: "created", actor: "Maria Santos", createdAt: "2026-05-27T13:12:00", summary: "Maria Santos created this site record." }, { id: "AUDIT-004", action: "updated", actor: "Jon Reyes", createdAt: "2026-05-28T08:20:00", summary: "Jon Reyes updated 2 site details: status and remarks.", changedFields: ["status", "remarks"], beforeData: { status: "installed" }, afterData: { status: "issue" } }],
  },
  {
    id: "INS-2026-0016", siteName: "", legacyKitNumber: "KIT-10474", unitType: "Satellite broadband", contractor: "Pacific Link Solutions", installerTeamLead: "",
    installDate: "2026-05-26", status: "installed", ...albayRawis,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "", createdBy: "Jon Reyes", createdAt: "2026-05-26T15:40:00", updatedBy: "Jon Reyes",
    updatedAt: "2026-05-26T16:44:00", photos: [], customValues: {}, components: [
      { id: "C-4", type: "Dish antenna", values: { "dish-serial": "DSH-62010" }, notes: "", installedAt: "2026-05-26T15:40:00" },
      { id: "C-5", type: "Router", values: { "router-serial": "RTR-78426" }, notes: "", installedAt: "2026-05-26T15:40:00" },
    ],
    serviceVisits: [], auditEvents: [{ id: "AUDIT-005", action: "created", actor: "Jon Reyes", createdAt: "2026-05-26T15:40:00", summary: "Jon Reyes created this site record." }],
  },
  {
    id: "INS-2026-0015", siteName: "", legacyKitNumber: "KIT-10471", unitType: "Fiber internet", contractor: "SignalWorks PH", installerTeamLead: "",
    installDate: "2026-05-26", status: "scheduled", ...lagunaCanlubang,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "Site access confirmed for morning schedule.", createdBy: "Jon Reyes", createdAt: "2026-05-26T09:15:00", updatedBy: "Jon Reyes",
    updatedAt: "2026-05-26T09:15:00", photos: [], customValues: {}, components: [], serviceVisits: [], auditEvents: [{ id: "AUDIT-006", action: "created", actor: "Jon Reyes", createdAt: "2026-05-26T09:15:00", summary: "Jon Reyes created this site record." }],
  },
  {
    id: "INS-2026-0014", siteName: "", legacyKitNumber: "KIT-10465", unitType: "Fixed wireless", contractor: "Northline Systems", installerTeamLead: "",
    installDate: "2026-05-24", status: "cancelled", ...angelesBalibago,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "Cancelled by site coordinator.", createdBy: "Maria Santos", createdAt: "2026-05-24T13:44:00", updatedBy: "Maria Santos",
    updatedAt: "2026-05-25T11:12:00", photos: [], customValues: {}, components: [], serviceVisits: [], auditEvents: [{ id: "AUDIT-007", action: "created", actor: "Maria Santos", createdAt: "2026-05-24T13:44:00", summary: "Maria Santos created this site record." }],
  },
  {
    id: "INS-2026-0013", siteName: "", legacyKitNumber: "KIT-10458", unitType: "Satellite broadband", contractor: "Lighthouse Network Services", installerTeamLead: "",
    installDate: "2026-05-23", status: "installed", ...batangasSabang,
    longitude: "", latitude: "", beneficiaryContacts: [], beneficiaryName: "", beneficiaryRole: "", beneficiaryPhone: "", remarks: "", createdBy: "Maria Santos", createdAt: "2026-05-23T15:10:00", updatedBy: "Maria Santos",
    updatedAt: "2026-05-23T15:10:00", photos: [], customValues: {}, components: [], serviceVisits: [], auditEvents: [{ id: "AUDIT-008", action: "created", actor: "Maria Santos", createdAt: "2026-05-23T15:10:00", summary: "Maria Santos created this site record." }],
  },
];
