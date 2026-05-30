export type Status = "scheduled" | "installed" | "issue" | "cancelled";

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
};

export type CustomFieldType = "text" | "number" | "date" | "dropdown";
export type ComponentFieldType = "text" | "mac";

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
  siteName: string;
  legacyKitNumber?: string;
  unitType: string;
  contractor: string;
  installDate: string;
  status: Status;
  region: string;
  province: string;
  municipality: string;
  barangay: string;
  address: string;
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

export type ReferenceData = {
  contractors: ReferenceOption[];
  unitTypes: ReferenceOption[];
  componentTypes: ComponentTypeOption[];
  equipmentFields: EquipmentFieldLibraryItem[];
  customFields: CustomFieldDefinition[];
  serviceVisitTypes: ReferenceOption[];
};
