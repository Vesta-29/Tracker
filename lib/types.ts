export type Status = string;
export type IslandGroup = "Luzon" | "Visayas" | "Mindanao";

export type Component = {
  id: string;
  type: string;
  values: Record<string, string>;
  duplicateMacAcknowledged?: boolean;
  notes: string;
  installedAt?: string;
  removedAt?: string;
  installedViaVisitId?: string;
  removedViaVisitId?: string;
};

export type ReferenceOption = {
  id: string;
  name: string;
  active: boolean;
  order?: number;
};

export type StatusReferenceOption = ReferenceOption & {
  value: Status;
};

export type CustomFieldType = "text" | "number" | "date" | "dropdown";
export type ComponentFieldType = "text" | "mac" | "integer" | "boolean";

export type ComponentFieldAttachment = {
  id: string;
  libraryFieldId: string;
  required: boolean;
  active: boolean;
  order: number;
};

export type EquipmentFieldLibraryItem = {
  id: string;
  label: string;
  type: ComponentFieldType;
  active: boolean;
};

export type ComponentTypeOption = ReferenceOption & {
  defaultOnNewSite?: boolean;
  fields: ComponentFieldAttachment[];
};

export type CustomFieldOption = ReferenceOption;

export type CustomFieldDefinition = {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  active: boolean;
  order: number;
  options: CustomFieldOption[];
};

export type InstallationCustomValue = Record<string, string>;

export type ServiceVisitStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export type AuditEvent = {
  id: string;
  action: string;
  actor: string;
  createdAt: string;
  summary: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  changedFields?: string[];
};

export type ServiceVisitComponentChange = {
  id: string;
  action: "installed" | "removed";
  componentId: string;
  componentType: string;
  summary: string;
};

export type ServiceVisit = {
  id: string;
  dbId?: string;
  type: string;
  status: ServiceVisitStatus;
  ticketReference: string;
  contractor: string;
  scheduledDate: string;
  completedDate?: string;
  notes: string;
  photos: { name: string; url: string }[];
  componentChanges: ServiceVisitComponentChange[];
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Installation = {
  id: string;
  dbId?: string;
  siteName: string;
  legacyKitNumber?: string;
  unitType: string;
  contractor: string;
  installerTeamLead: string;
  installDate: string;
  activationDate?: string;
  status: Status;
  islandGroup: IslandGroup | "";
  region: string;
  regionCode: string;
  province: string;
  provinceCode: string;
  municipality: string;
  municipalityCode: string;
  barangay: string;
  barangayCode: string;
  longitude: string;
  latitude: string;
  beneficiaryContacts: BeneficiaryContact[];
  beneficiaryName: string;
  beneficiaryRole: string;
  beneficiaryPhone: string;
  remarks: string;
  components: Component[];
  customValues: InstallationCustomValue;
  photos: { name: string; url: string }[];
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  serviceVisits: ServiceVisit[];
  auditEvents: AuditEvent[];
};

export type BeneficiaryContact = {
  id: string;
  name: string;
  role: string;
  phone: string;
};

export type SchoolDirectoryEntry = {
  id: string;
  schoolId: string;
  schoolName: string;
  islandGroup: IslandGroup | "";
  region: string;
  regionCode: string;
  province: string;
  provinceCode: string;
  municipality: string;
  municipalityCode: string;
  barangay: string;
  barangayCode: string;
  sourceRow: number;
  warning: string;
};

export type SchoolDirectoryStatus = {
  filename: string;
  totalRows: number;
  completeRows: number;
  partialRows: number;
  skippedRows: number;
  uploadedBy: string;
  uploadedAt: string;
};

export type ReferenceData = {
  schoolDirectory: ReferenceOption[];
  siteStatuses: StatusReferenceOption[];
  contractors: ReferenceOption[];
  unitTypes: ReferenceOption[];
  componentTypes: ComponentTypeOption[];
  equipmentFields: EquipmentFieldLibraryItem[];
  customFields: CustomFieldDefinition[];
  serviceVisitTypes: ReferenceOption[];
};

export type Profile = {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "staff" | "guest";
  active: boolean;
};
